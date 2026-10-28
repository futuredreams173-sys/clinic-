'use strict';

const express = require('express');

const { validateVisitPayload, normalizeDocumentNumber } = require('../validate');
const { bearerToken, patientForToken } = require('../auth');
const { mapVisit } = require('../db');
const { syncVisit } = require('../sync');
const { makeId, fail, failValidation } = require('../http');

const router = express.Router();

/**
 * POST /visits
 * ينشئ زيارة (رقم انتظار) ويزامنها مع رقيم وصحتي عبر MockAdapter داخل الخادم.
 *
 * الجسم: { patientId } أو { documentType, documentNumber }  + reason?
 * يتطلب: Authorization: Bearer <token>
 */
router.post('/visits', async (req, res, next) => {
  try {
    const db = req.app.locals.db;

    const parsed = validateVisitPayload(req.body);
    if (!parsed.ok) return failValidation(res, parsed.errors);

    const token = bearerToken(req);
    if (!token) return fail(res, 401, 'AUTH_REQUIRED');

    const session = patientForToken(db, token);
    if (!session) return fail(res, 401, 'INVALID_SESSION');

    const { patientId, documentType, documentNumber, reason } = parsed.value;

    // تحديد المراجع: بالمعرّف أو بالوثيقة — ويجب أن يطابق صاحب الجلسة
    let patient = null;
    if (patientId) {
      patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
    } else {
      patient = db
        .prepare('SELECT * FROM patients WHERE document_type = ? AND document_number = ?')
        .get(documentType, normalizeDocumentNumber(documentType, documentNumber));
    }

    if (!patient) return fail(res, 404, 'PATIENT_NOT_FOUND');
    if (patient.id !== session.id) return fail(res, 403, 'FORBIDDEN');

    const createdAt = new Date().toISOString();
    const today = createdAt.slice(0, 10);

    const { next: queueNumber } = db
      .prepare(
        `SELECT COALESCE(MAX(queue_number), 100) + 1 AS next
           FROM visits WHERE substr(created_at, 1, 10) = ?`
      )
      .get(today);

    const visitId = makeId('V');
    db.prepare(
      `INSERT INTO visits (id, patient_id, queue_number, status, reason, created_at)
       VALUES (?, ?, ?, 'waiting', ?, ?)`
    ).run(visitId, patient.id, queueNumber, reason, createdAt);

    const visitRow = db.prepare('SELECT * FROM visits WHERE id = ?').get(visitId);

    const sync = await syncVisit({
      db,
      systems: req.app.locals.systems,
      patient,
      visit: visitRow,
    });

    return res.status(201).json({
      visit: mapVisit(visitRow),
      sync,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
