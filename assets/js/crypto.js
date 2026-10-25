/* ============================================================
   ملفاتي — Crypto layer
   PBKDF2-SHA256 key derivation  +  AES-GCM content encryption
   كل مفتاح مشتق من كلمة مرور المستخدم، ولا يُخزَّن أبداً.
   ============================================================ */
(function (global) {
  'use strict';

  var subtle = (global.crypto && global.crypto.subtle) ? global.crypto.subtle : null;
  var te = new TextEncoder();
  var td = (typeof TextDecoder !== 'undefined') ? new TextDecoder() : null;

  var ITERATIONS = 160000;   // PBKDF2 rounds
  var SALT_BYTES = 16;
  var IV_BYTES   = 12;       // GCM nonce
  var KEY_BITS   = 256;

  /* ---------- byte / string helpers ---------- */
  function toB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function fromB64(b64) {
    var s = atob(b64), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function randomBytes(n) {
    var b = new Uint8Array(n);
    (global.crypto || global.msCrypto).getRandomValues(b);
    return b;
  }
  function randomToken(n) {
    return toB64(randomBytes(n || 24)).replace(/[+/=]/g, '').slice(0, 40);
  }

  /* ---------- availability ---------- */
  function supported() {
    return !!(subtle && global.btoa && global.atob && td);
  }

  /* ---------- key derivation ---------- */
  async function deriveBits(password, saltB64) {
    if (!supported()) throw new Error('WEAK_ENV');
    var base = await subtle.importKey(
      'raw', te.encode(String(password)), 'PBKDF2', false, ['deriveBits']
    );
    var bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: fromB64(saltB64), iterations: ITERATIONS, hash: 'SHA-256' },
      base, KEY_BITS
    );
    return new Uint8Array(bits);
  }

  async function deriveKey(password, saltB64) {
    if (!supported()) throw new Error('WEAK_ENV');
    var bits = await deriveBits(password, saltB64);
    return subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  /* SHA-256 عام — يُستخدم لبناء مُتحقِّق حتمي من كلمة المرور */
  async function digest(bytes) {
    if (!supported()) throw new Error('WEAK_ENV');
    return new Uint8Array(await subtle.digest('SHA-256', bytes));
  }

  /**
   * مُتحقِّق حتمي (deterministic) لبصمة كلمة المرور.
   * ⚠ لا يُستخدم أي تشفير بتشفير عشوائي هنا، وإلا فشل الدخول دائماً.
   */
  async function verifier(password, saltB64) {
    var bits = await deriveBits(password, saltB64);
    var label = te.encode('|mfy:verifier:v1|');
    var buf = new Uint8Array(bits.length + label.length);
    buf.set(bits, 0);
    buf.set(label, bits.length);
    return toB64(await digest(buf));
  }

  function newSalt() { return toB64(randomBytes(SALT_BYTES)); }

  /* ---------- content encryption ----------
     Payload shape stored in localStorage:
       { v:1, s:<iv b64>, d:<ciphertext b64> }  */
  async function encryptText(key, plain) {
    if (!key) return { v: 1, p: String(plain) };        // degraded mode (no WebCrypto)
    var iv = randomBytes(IV_BYTES);
    var ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, te.encode(String(plain)));
    return { v: 1, s: toB64(iv), d: toB64(new Uint8Array(ct)) };
  }

  async function decryptText(key, payload) {
    if (!payload) return '';
    if (typeof payload === 'string') return payload;     // legacy plaintext
    if (payload.p !== undefined) return payload.p;        // degraded mode
    if (!key) throw new Error('LOCKED');
    try {
      var pt = await subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(payload.s) }, key, fromB64(payload.d)
      );
      return td.decode(pt);
    } catch (e) { throw new Error('DECRYPT_FAILED'); }
  }

  /* Nonce-safe: encrypt base64 blobs (uploaded file bodies) */
  async function encryptBlob(key, b64) { return encryptText(key, b64); }
  async function decryptBlob(key, payload) { return decryptText(key, payload); }

  /* ---------- constant-time-ish compare ---------- */
  function secureEqual(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a.length !== b.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }

  /* ---------- lightweight fingerprint (never used for auth) ---------- */
  async function fingerprint(str) {
    if (subtle) {
      var h = await subtle.digest('SHA-256', te.encode(String(str)));
      return toB64(new Uint8Array(h)).slice(0, 22);
    }
    var hash = 5381;
    for (var i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    return 'fp' + hash.toString(36);
  }

  /* Simple display-only password score (0..4) */
  function passwordScore(pw) {
    pw = String(pw || '');
    if (!pw) return 0;
    var s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
    if (pw.length < 6) s = Math.min(s, 1);
    return Math.min(s, 4);
  }

  global.MFCrypto = {
    supported: supported,
    deriveKey: deriveKey,
    deriveBits: deriveBits,
    digest: digest,
    verifier: verifier,
    newSalt: newSalt,
    encryptText: encryptText,
    decryptText: decryptText,
    encryptBlob: encryptBlob,
    decryptBlob: decryptBlob,
    toB64: toB64,
    fromB64: fromB64,
    randomBytes: randomBytes,
    randomToken: randomToken,
    secureEqual: secureEqual,
    fingerprint: fingerprint,
    passwordScore: passwordScore,
    ITERATIONS: ITERATIONS
  };
})(window);
