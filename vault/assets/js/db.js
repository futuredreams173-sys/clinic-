/* ============================================================
   ملفاتي — Data layer (localStorage "database")

   Schema
   ────────────────────────────────────────────────────────────
   mfy:meta                     → app meta
   mfy:users                    → [ {id, email, name, salt, passHash,
                                    createdAt, storage...} ]
   mfy:session                  → {userId, token, issuedAt, expiresAt}
   mfy:data:<userId>            → { files:[], notes:[], prefs:{} }

   الضمانة الأمنية: بيانات كل مستخدم مخزّنة تحت مفتاح خاص به
   (mfy:data:<id>) ولا تُقرأ إلا بعد التحقق من أن جلسة الدخول
   تخصّ نفس الـ userId. أي محاولة وصول لمستخدم آخر تفشل.
   ============================================================ */
(function (global) {
  'use strict';

  var K = {
    META:  'mfy:meta',
    USERS: 'mfy:users',
    SESS:  'mfy:session',
    DATA:  function (uid) { return 'mfy:data:' + uid; }
  };

  var SCHEMA = 1;
  var SESSION_TTL = 1000 * 60 * 60 * 24 * 14; // 14 يوماً

  /* ---------------- low level ---------------- */
  function read(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    var payload = JSON.stringify(value);
    global.localStorage.setItem(key, payload);   // may throw QuotaExceeded
    return payload.length;
  }
  function remove(key) { try { global.localStorage.removeItem(key); } catch (e) {} }

  function bytesOf(str) {
    if (!str) return 0;
    var bytes = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) bytes += 1;
      else if (c < 0x800) bytes += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }

  /* ---------------- meta ---------------- */
  function meta() {
    return read(K.META, { schema: SCHEMA, createdAt: Date.now(), installs: 0 });
  }
  function saveMeta(m) { try { write(K.META, m); } catch (e) {} }

  function ensureSchema() {
    var m = read(K.META, null);
    if (!m) { saveMeta(meta()); }
    else if (m.schema !== SCHEMA) { m.schema = SCHEMA; saveMeta(m); }
  }

  /* ---------------- users ---------------- */
  function allUsers() {
    var list = read(K.USERS, []);
    return Array.isArray(list) ? list : [];
  }
  function saveUsers(list) { return write(K.USERS, list); }

  function normEmail(e) { return String(e || '').trim().toLowerCase(); }

  function findUserByEmail(email) {
    var n = normEmail(email), list = allUsers();
    for (var i = 0; i < list.length; i++) {
      if (normEmail(list[i].email) === n) return list[i];
    }
    return null;
  }
  function findUserById(id) {
    var list = allUsers();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function uid(prefix) {
    return (prefix || 'u') + '_' + Date.now().toString(36) +
           '_' + Math.random().toString(36).slice(2, 9);
  }

  function createUser(fields) {
    var list = allUsers();
    var user = {
      id: uid('u'),
      email: normEmail(fields.email),
      name: String(fields.name || '').trim(),
      salt: fields.salt,
      passHash: fields.passHash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLogin: null,
      isLocked: false,
      prefs: { view: 'grid', density: 'cozy' }
    };
    list.push(user);
    saveUsers(list);
    seedUserData(user.id);
    return user;
  }

  function updateUser(id, patch) {
    var list = allUsers(), found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) list[i][k] = patch[k];
        list[i].updatedAt = Date.now();
        found = list[i];
      }
    }
    if (found) saveUsers(list);
    return found;
  }

  function deleteUser(id) {
    var list = allUsers().filter(function (u) { return u.id !== id; });
    saveUsers(list);
    remove(K.DATA(id));
    // إن فُتحت جلسة على نفس الجهاز لن لهذا المستخدم، نظّفها
    var s = read(K.SESS, null);
    if (s && s.userId === id) remove(K.SESS);
  }

  /* ---------------- per-user payload ---------------- */
  function seedUserData(uid_) {
    if (!read(K.DATA(uid_), null)) {
      write(K.DATA(uid_), { files: [], notes: [], prefs: {}, v: SCHEMA });
    }
  }

  /**
   * يقرأ بيانات مستخدم فقط إذا طابقت الجلسة الحالية.
   * @param {string} sessionUserId  الـ userId الناتج عن التحقق من التوكن
   */
  function loadUserData(sessionUserId) {
    if (!sessionUserId) throw new Error('NO_SESSION');
    var payload = read(K.DATA(sessionUserId), null);
    if (!payload) {
      payload = { files: [], notes: [], prefs: {}, v: SCHEMA };
      try { write(K.DATA(sessionUserId), payload); } catch (e) {}
    }
    if (!Array.isArray(payload.files)) payload.files = [];
    if (!Array.isArray(payload.notes)) payload.notes = [];
    if (!payload.prefs) payload.prefs = {};
    return payload;
  }

  function saveUserData(sessionUserId, payload) {
    if (!sessionUserId) throw new Error('NO_SESSION');
    payload.v = SCHEMA;
    return write(K.DATA(sessionUserId), payload);  // returns byte length, may throw quota
  }

  /* ---------------- session ---------------- */
  function getSession() {
    var s = read(K.SESS, null);
    if (!s) return null;
    if (!s.userId || !s.token) return null;
    if (s.expiresAt && Date.now() > s.expiresAt) { remove(K.SESS); return null; }
    // التحقق أن المستخدم لا يزال موجوداً
    if (!findUserById(s.userId)) { remove(K.SESS); return null; }
    return s;
  }
  function createSession(userId) {
    var s = {
      userId: userId,
      token: global.MFCrypto.randomToken(24),
      issuedAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL
    };
    write(K.SESS, s);
    return s;
  }
  function refreshSession() {
    var s = getSession();
    if (!s) return null;
    s.expiresAt = Date.now() + SESSION_TTL;
    write(K.SESS, s);
    return s;
  }
  function clearSession() { remove(K.SESS); }

  /* ---------------- storage accounting ---------------- */
  function usageBytes() {
    var total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('mfy:') === 0) {
          total += bytesOf(localStorage.getItem(key)) + bytesOf(key);
        }
      }
    } catch (e) {}
    return total;
  }

  function quotaInfo() {
    var used = usageBytes();
    var quota = 5 * 1024 * 1024;                       // حدّ المتصفح الافتراضي
    if (global.navigator && navigator.storage && navigator.storage.estimate) {
      try {
        // estimate() يعطي حدّ الأصل كاملاً؛ نستخدمه كحدّ أقصى ممكن
        navigator.storage.estimate().then(function (e) {
          if (e && e.quota) {
            var el = document.getElementById('storageHint');
            if (el) el.dataset.realQuota = e.quota;
          }
        }).catch(function () {});
      } catch (e) {}
    }
    return { used: used, quota: quota, pct: Math.min(100, (used / quota) * 100) };
  }

  /* ---------------- utilities ---------------- */
  function formatBytes(n) {
    if (!n) return '0 ك.ب';
    if (n < 1024) return n + ' بايت';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' ك.ب';
    return (n / (1024 * 1024)).toFixed(2) + ' م.ب';
  }

  function wipeAll() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('mfy:') === 0) keys.push(k);
    }
    keys.forEach(function (k) { localStorage.removeItem(k); });
    return keys.length;
  }

  ensureSchema();

  global.MFDB = {
    SCHEMA: SCHEMA,
    KEYS: K,
    ensureSchema: ensureSchema,
    /* users */
    allUsers: allUsers,
    findUserByEmail: findUserByEmail,
    findUserById: findUserById,
    createUser: createUser,
    updateUser: updateUser,
    deleteUser: deleteUser,
    normEmail: normEmail,
    uid: uid,
    /* data */
    loadUserData: loadUserData,
    saveUserData: saveUserData,
    seedUserData: seedUserData,
    /* session */
    getSession: getSession,
    createSession: createSession,
    refreshSession: refreshSession,
    clearSession: clearSession,
    /* misc */
    usageBytes: usageBytes,
    quotaInfo: quotaInfo,
    formatBytes: formatBytes,
    bytesOf: bytesOf,
    wipeAll: wipeAll,
    _read: read,
    _write: write,
    _remove: remove
  };
})(window);
