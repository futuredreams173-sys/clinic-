'use strict';

const express = require('express');

const {
  validatePatientPayload,
  normalizeDocumentNumber,
  DOC_TYPES,
} = require('../validate');
const { hashPin, verifyPin, issueToken, bearerToken, patientForToken, sha256 } = require('../auth');
const { mapPatient, visitsWithSync } = require('../db');
const { makeId, fail, failValidation } = require('../http');

const router = express.Router();

const nowIso = () => new Date().toISOString();

/**
 * POST /patients
 * تسجيل مراجع جديد، أو تحديث ملفه وإصدار جلسة جديدة.
 *
 * الجسم:
 *   { documentType, documentNumber, category, birthDate | birthDateHijri,
 *     phone, insurer?, policyNumber?, pin, consent }
 */
router.post('/patients', (req, res) => {
  const db = req.app.locals.db;
  const parsed = validatePatientPayload(req.body);
  if (!parsed.ok) return failValidation(res, parsed.errors);

  const { documentType, documentNumber, category, birthDate, phone, insurer, policyNumber, pin } =
    parsed.value;

  const existing = db
    .prepare('SELECT * FROM patients WHERE document_type = ? AND document_number = ?')
    .get(documentType, documentNumber);

  const issued = issueToken();
  const timestamp = nowIso();

  if (existing) {
    if (!verifyPin(pin, existing.pin_salt, existing.pin_hash)) {
      return fail(res, 401, 'INVALID_PIN');
    }

    db.prepare(
      `UPDATE patients
          SET category = ?, birth_date = ?, phone = ?, insurer = ?, policy_number = ?,
              token_hash = ?, updated_at = ?
        WHERE id = ?`
    ).run(category, birthDate, phone, insurer, policyNumber, issued.hash, timestamp, existing.id);

    const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(existing.id);
    return res.status(200).json({
      created: false,
      token: issued.token,
      patient: mapPatient(row),
      visits: visitsWithSync(db, row.id),
    });
  }

  const { salt, hash } = hashPin(pin);
  const id = makeId('PT');

  db.prepare(
    `INSERT INTO patients
       (id, document_type, document_number, category, birth_date, phone, insurer,
        policy_number, pin_hash, pin_salt, token_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    documentType,
    documentNumber,
    category,
    birthDate,
    phone,
    insurer,
    policyNumber,
    hash,
    salt,
    issued.hash,
    timestamp,
    timestamp
  );

  const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  return res.status(201).json({
    created: true,
    token: issued.token,
    patient: mapPatient(row),
    visits: [],
  });
});

/**
 * GET /patients/:docType/:docNo
 * يتطلب جلسة صالحة تخصّ نفس المراجع — لا يمكن لأي مستخدم قراءة بيانات غيره.
 */
router.get('/patients/:docType/:docNo', (req, res) => {
  const db = req.app.locals.db;

  const documentType = String(req.params.docType || '').toLowerCase();
  if (!DOC_TYPES.includes(documentType)) return fail(res, 400, 'INVALID_DOCUMENT_TYPE');

  const documentNumber = normalizeDocumentNumber(documentType, req.params.docNo);
  if (!documentNumber) return fail(res, 400, 'INVALID_DOCUMENT_NUMBER');

  const token = bearerToken(req);
  if (!token) return fail(res, 401, 'AUTH_REQUIRED');

  const row = db
    .prepare('SELECT * FROM patients WHERE document_type = ? AND document_number = ?')
    .get(documentType, documentNumber);

  if (!row) return fail(res, 404, 'PATIENT_NOT_FOUND');

  const authorized = patientForToken(db, token);
  if (!authorized) return fail(res, 401, 'AUTH_REQUIRED');
  if (authorized.id !== row.id) return fail(res, 403, 'FORBIDDEN');

  return res.json({
    patient: mapPatient(row),
    visits: visitsWithSync(db, row.id),
  });
});

/**
 * POST /patients/:docType/:docNo/session
 * استئناف جلسة على جهاز جديد: يتحقق من رمز الدخول ويُصدر token حديثاً.
 */
router.post('/patients/:docType/:docNo/session', (req, res) => {
  const db = req.app.locals.db;

  const documentType = String(req.params.docType || '').toLowerCase();
  if (!DOC_TYPES.includes(documentType)) return fail(res, 400, 'INVALID_DOCUMENT_TYPE');

  const documentNumber = normalizeDocumentNumber(documentType, req.params.docNo);
  if (!documentNumber) return fail(res, 400, 'INVALID_DOCUMENT_NUMBER');

  const pin = String((req.body && req.body.pin) || '');
  if (!pin) return failValidation(res, { pin: 'eRequired' });

  const row = db
    .prepare('SELECT * FROM patients WHERE document_type = ? AND document_number = ?')
    .get(documentType, documentNumber);

  if (!row) return fail(res, 404, 'PATIENT_NOT_FOUND');
  if (!verifyPin(pin, row.pin_salt, row.pin_hash)) return fail(res, 401, 'INVALID_PIN');

  const issued = issueToken();
  db.prepare('UPDATE patients SET token_hash = ?, updated_at = ? WHERE id = ?').run(
    issued.hash,
    nowIso(),
    row.id
  );

  const fresh = db.prepare('SELECT * FROM patients WHERE id = ?').get(row.id);
  return res.json({
    token: issued.token,
    patient: mapPatient(fresh),
    visits: visitsWithSync(db, row.id),
  });
});

module.exports = router;

// يُستخدم في الاختبارات للتحقق من عدم تخزين السرّ صراحةً
module.exports.__hashForTest = sha256;
