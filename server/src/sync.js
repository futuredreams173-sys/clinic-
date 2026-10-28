'use strict';

/**
 * مزامنة زيارة مع الأنظمة الصحية — تحلّ محل syncTo() التي كانت في الواجهة.
 * ثلاث محاولات بفواصل متزايدة، ثم تُسجَّل النتيجة في sync_events.
 */

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = Number(process.env.SYNC_BACKOFF_MS ?? 300);

/** تحويل سجل المريض إلى نموذج موحّد قريب من FHIR Patient */
function toPatientRecord(patient) {
  return {
    documentType: patient.document_type,
    documentNumber: patient.document_number,
    birthDate: patient.birth_date,
    telecom: patient.phone,
    category: patient.category,
    coverage: patient.insurer
      ? { payor: patient.insurer, policy: patient.policy_number }
      : null,
    source: 'self-registration-kiosk',
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * يزامن زيارة واحدة مع نظام واحد.
 * @returns {Promise<{status:'ok'|'fail', externalId?:string, detail?:string}>}
 */
async function syncOne(adapter, patientRecord, visit) {
  let lastError = 'unknown error';

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const existing = await adapter.findPatient(
        patientRecord.documentType,
        patientRecord.documentNumber
      );
      const { id } = existing
        ? await adapter.updatePatient(existing.id, patientRecord)
        : await adapter.createPatient(patientRecord);

      const result = await adapter.registerVisit(id, {
        queue: visit.queue_number,
        time: visit.created_at,
      });

      return { status: 'ok', externalId: result.visitId };
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      }
    }
  }

  return { status: 'fail', detail: lastError.slice(0, 200) };
}

/**
 * يزامن زيارة مع كل الأنظمة بالتوازي ويحفظ الأحداث.
 * @returns {Promise<Record<string, {status:string, externalId?:string, detail?:string}>>}
 */
async function syncVisit({ db, systems, patient, visit }) {
  const record = toPatientRecord(patient);
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO sync_events (visit_id, system, status, detail, external_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const entries = await Promise.all(
    Object.entries(systems).map(async ([name, adapter]) => {
      const result = await syncOne(adapter, record, visit);
      insert.run(
        visit.id,
        name,
        result.status,
        result.detail ?? null,
        result.externalId ?? null,
        now
      );
      return [name, result];
    })
  );

  return Object.fromEntries(entries);
}

module.exports = { syncVisit, syncOne, toPatientRecord, MAX_ATTEMPTS };
