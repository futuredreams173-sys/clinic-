'use strict';

const crypto = require('node:crypto');

/** معرّفات قصيرة قابلة للقراءة: PT-MF3K9A2B */
function makeId(prefix) {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${stamp}${random}`;
}

/** رد خطأ موحّد */
function fail(res, status, code, extra = {}) {
  return res.status(status).json({ error: { code, ...extra } });
}

/** رد خطأ تحقق */
function failValidation(res, fields) {
  return fail(res, 422, 'VALIDATION_FAILED', { fields });
}

module.exports = { makeId, fail, failValidation };
