'use strict';

const crypto = require('node:crypto');

/**
 * أسرار الخادم:
 * - رمز الدخول (PIN) يُخزَّن مُشتقاً بـ PBKDF2 فقط، ولا يُحفظ نصّه أبداً.
 * - رمز الجلسة (token) يُخزَّن مُجزَّأً بـ SHA-256 فقط.
 * لا يوجد أي سرّ مكتوب في كود الواجهة.
 */

const ITERATIONS = Number(process.env.PIN_ITERATIONS || 120000);
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function derivePin(pin, salt) {
  return crypto.pbkdf2Sync(String(pin), salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
}

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: derivePin(pin, salt) };
}

function verifyPin(pin, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = Buffer.from(derivePin(pin, salt), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/** يُصدر رمز جلسة جديداً ويعيد النص الصريح + البصمة للتخزين */
function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: sha256(token) };
}

/** يستخرج الرمز من ترويسة Authorization */
function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+([A-Fa-f0-9]{64})$/.exec(header.trim());
  return match ? match[1] : null;
}

/** يجلِب المراجع المطابق لرمز الجلسة أو null */
function patientForToken(db, token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM patients WHERE token_hash = ?').get(sha256(token));
  return row || null;
}

module.exports = {
  ITERATIONS,
  sha256,
  hashPin,
  verifyPin,
  issueToken,
  bearerToken,
  patientForToken,
};
