'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { maskDocument } = require('./validate');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS patients (
  id               TEXT PRIMARY KEY,
  document_type    TEXT NOT NULL,
  document_number  TEXT NOT NULL,
  category         TEXT NOT NULL,
  birth_date       TEXT NOT NULL,
  phone            TEXT NOT NULL,
  insurer          TEXT,
  policy_number    TEXT,
  pin_hash         TEXT NOT NULL,
  pin_salt         TEXT NOT NULL,
  token_hash       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  CHECK (document_type IN ('nid','iqama','passport')),
  CHECK (category IN ('citizen','domestic','insured'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_patients_document
  ON patients(document_type, document_number);

CREATE INDEX IF NOT EXISTS ix_patients_token
  ON patients(token_hash);

CREATE TABLE IF NOT EXISTS visits (
  id            TEXT PRIMARY KEY,
  patient_id    TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  queue_number  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'waiting',
  reason        TEXT,
  created_at    TEXT NOT NULL,
  CHECK (status IN ('waiting','called','done','cancelled'))
);

CREATE INDEX IF NOT EXISTS ix_visits_patient
  ON visits(patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id    TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  system      TEXT NOT NULL,
  status      TEXT NOT NULL,
  detail      TEXT,
  external_id TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_sync_visit
  ON sync_events(visit_id, system, id DESC);
`;

/**
 * يفتح قاعدة البيانات ويهيّئ المخطط.
 * @param {string} file مسار الملف أو ':memory:'
 */
function openDatabase(file = ':memory:') {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  db.exec(SCHEMA);
  return db;
}

// ─── محوّلات الصفوف ───────────────────────────────────────────────────────────

function mapPatient(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentType: row.document_type,
    documentNumber: row.document_number,
    maskedDocumentNumber: maskDocument(row.document_number),
    category: row.category,
    birthDate: row.birth_date,
    phone: row.phone,
    insurer: row.insurer,
    policyNumber: row.policy_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVisit(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    queueNumber: row.queue_number,
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function mapSyncEvent(row) {
  if (!row) return null;
  return {
    system: row.system,
    status: row.status,
    detail: row.detail,
    externalId: row.external_id,
    at: row.created_at,
  };
}

/** أحدث حالة مزامنة لكل نظام لزيارة معيّنة */
function latestSyncBySystem(db, visitId) {
  const rows = db
    .prepare(
      `SELECT s.* FROM sync_events s
         JOIN (SELECT system, MAX(id) AS id FROM sync_events WHERE visit_id = ? GROUP BY system) last
           ON last.id = s.id
        WHERE s.visit_id = ?`
    )
    .all(visitId, visitId);

  const result = {};
  for (const row of rows) result[row.system] = mapSyncEvent(row);
  return result;
}

/** يجمع زيارات مراجع مع حالة المزامنة لكل زيارة */
function visitsWithSync(db, patientId, limit = 20) {
  const rows = db
    .prepare('SELECT * FROM visits WHERE patient_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(patientId, limit);

  return rows.map((row) => ({
    ...mapVisit(row),
    sync: latestSyncBySystem(db, row.id),
  }));
}

module.exports = {
  openDatabase,
  mapPatient,
  mapVisit,
  mapSyncEvent,
  latestSyncBySystem,
  visitsWithSync,
};
