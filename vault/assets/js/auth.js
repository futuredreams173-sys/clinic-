/* ============================================================
   ملفاتي — Auth layer
   ────────────────────────────────────────────────────────────
   • التسجيل: PBKDF2-SHA256 (160k) + ملح عشوائي لكل مستخدم
   • الدخول:  إعادة الاشتقاق والمقارنة مع passHash
   • الجلسة:  توكن عشوائي مع انتهاء صلاحية
   • العزل:   لا تُقرأ أي بيانات إلا بعد نجاح التحقق،
              والمفتاح المشتق يبقى في الذاكرة فقط (لا يُخزَّن)
   ============================================================ */
(function (global) {
  'use strict';

  var C = global.MFCrypto;
  var DB = global.MFDB;

  var session = null;     // {userId, token, ...}
  var dataKey = null;     // مفتاح AES المشتق — في الذاكرة فقط
  var currentUser = null;
  var listeners = [];

  var errors = {
    EMAIL_INVALID: 'صيغة البريد الإلكتروني غير صحيحة.',
    EMAIL_TAKEN: 'هذا البريد مسجَّل مسبقاً. استخدم تسجيل الدخول.',
    EMAIL_EMPTY: 'الرجاء إدخال البريد الإلكتروني.',
    PASS_SHORT: 'كلمة المرور يجب أن تكون 8 محارف على الأقل.',
    PASS_EMPTY: 'الرجاء إدخال كلمة المرور.',
    PASS_MISMATCH: 'كلمتا المرور غير متطابقتين.',
    NAME_EMPTY: 'الرجاء إدخال الاسم الكامل.',
    BAD_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    LOCKED: 'هذا الحساب مقفل مؤقتاً بعد محاولات فاشلة كثيرة.',
    NO_SESSION: 'انتهت الجلسة. الرجاء تسجيل الدخول من جديد.',
    EMAIL_TAKEN_LOCKED: 'لا يمكن حذف الحساب.'
  };

  function on(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function emit(evt) { listeners.forEach(function (fn) { try { fn(evt); } catch (e) {} }); }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

  /* تأخير اصطناعي لمنع تخمين سريع عبر واجهة المستخدم */
  function throttle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- hash (حتمي: نفس كلمة المرور + نفس الملح ⟵ نفس الناتج) ---------- */
  async function hashPassword(password, saltB64) {
    return C.verifier(password, saltB64);
  }

  /* ---------- register ---------- */
  async function register(input) {
    var name = String(input.name || '').trim();
    var email = DB.normEmail(input.email);
    var pass = String(input.password || '');
    var pass2 = String(input.confirm || input.password || '');

    if (!name) throw new Error(errors.NAME_EMPTY);
    if (!email) throw new Error(errors.EMAIL_EMPTY);
    if (!EMAIL_RE.test(email)) throw new Error(errors.EMAIL_INVALID);
    if (DB.findUserByEmail(email)) throw new Error(errors.EMAIL_TAKEN);
    if (pass.length < 8) throw new Error(errors.PASS_SHORT);
    if (pass !== pass2) throw new Error(errors.PASS_MISMATCH);
    if (!C.supported()) throw new Error('بيئة المتصفح لا تدعم التشفير الآمن (WebCrypto).');

    var salt = C.newSalt();
    var passHash = await hashPassword(pass, salt);

    var user = DB.createUser({ name: name, email: email, salt: salt, passHash: passHash });
    dataKey = await C.deriveKey(pass, salt);
    currentUser = user;
    session = DB.createSession(user.id);
    DB.updateUser(user.id, { lastLogin: Date.now() });

    emit({ type: 'login', user: user });
    return user;
  }

  /* ---------- login ---------- */
  var attempts = {};   // email -> count (per tab, منع التخمين)

  async function login(input) {
    var email = DB.normEmail(input.email);
    var pass = String(input.password || '');

    if (!email) throw new Error(errors.EMAIL_EMPTY);
    if (!pass) throw new Error(errors.PASS_EMPTY);

    var key = 'k:' + email;
    if (attempts[key] && attempts[key] >= 8) throw new Error(errors.LOCKED);

    var user = DB.findUserByEmail(email);
    // ن executer نفس العملية زمنياً حتى لو لم يكن الحساب موجوداً (منع timing oracle تقريبي)
    if (!user) {
      await C.deriveKey(pass, C.newSalt()).catch(function () {});
      await throttle(420);
      attempts[key] = (attempts[key] || 0) + 1;
      throw new Error(errors.BAD_CREDENTIALS);
    }

    var ok = false;
    try {
      var candidate = await hashPassword(pass, user.salt);
      ok = C.secureEqual(candidate, user.passHash);
    } catch (e) { ok = false; }

    if (!ok) {
      await throttle(380);
      attempts[key] = (attempts[key] || 0) + 1;
      if (attempts[key] >= 8) throw new Error(errors.LOCKED);
      throw new Error(errors.BAD_CREDENTIALS);
    }

    delete attempts[key];

    // اشتقاق مفتاح تشفير المحتوى (يبقى في الذاكرة فقط)
    dataKey = await C.deriveKey(pass, user.salt);
    currentUser = DB.updateUser(user.id, { lastLogin: Date.now(), isLocked: false }) || user;
    session = DB.createSession(user.id);

    emit({ type: 'login', user: currentUser });
    return currentUser;
  }

  /* ---------- restore session on load ---------- */
  async function restore() {
    var s = DB.getSession();
    if (!s) { session = null; currentUser = null; dataKey = null; return null; }
    var u = DB.findUserById(s.userId);
    if (!u) { DB.clearSession(); return null; }
    session = s;
    currentUser = u;
    // لا يمكن إعادة اشتقاق المفتاح بدون كلمة المرور، لذا نطلبها مرة واحدة
    dataKey = null;
    emit({ type: 'restore', user: u, needsUnlock: true });
    return u;
  }

  /**
   * يفتح قفل البيانات بعد إدخال كلمة المرور مجدداً (عند استئناف جلسة محفوظة).
   */
  async function unlock(password) {
    if (!currentUser) throw new Error(errors.NO_SESSION);
    var candidate = await hashPassword(String(password || ''), currentUser.salt);
    if (!C.secureEqual(candidate, currentUser.passHash)) throw new Error(errors.BAD_CREDENTIALS);
    dataKey = await C.deriveKey(String(password || ''), currentUser.salt);
    session = DB.refreshSession() || session;
    emit({ type: 'unlock', user: currentUser });
    return currentUser;
  }

  /* ---------- logout / lock ---------- */
  function logout() {
    DB.clearSession();
    session = null; currentUser = null; dataKey = null;
    emit({ type: 'logout' });
  }

  function lock() {
    // يبقي الجلسة صالحة لكن يقفل محتوى البيانات حتى إدخال كلمة المرور
    dataKey = null;
    emit({ type: 'lock' });
  }

  /* ---------- profile ops ---------- */
  async function changePassword(oldPw, newPw) {
    if (!currentUser) throw new Error(errors.NO_SESSION);
    var candidate = await hashPassword(String(oldPw || ''), currentUser.salt);
    if (!C.secureEqual(candidate, currentUser.passHash)) throw new Error('كلمة المرور الحالية غير صحيحة.');
    if (String(newPw).length < 8) throw new Error(errors.PASS_SHORT);

    // ملح جديد + مفتاح جديد ⟵ نعيد تشفير كل المحتوى
    var oldKey = await C.deriveKey(String(oldPw || ''), currentUser.salt);
    var salt = C.newSalt();
    var passHash = await hashPassword(newPw, salt);
    var newKey = await C.deriveKey(newPw, salt);

    var readKey = dataKey || oldKey;   // نستخدم المفتاح المتاح مهما كانت الحالة
    var payload = DB.loadUserData(session.userId);
    var reEncrypted = 0;

    for (var i = 0; i < payload.files.length; i++) {
      var f = payload.files[i];
      if (f.body) {
        var plain = await C.decryptText(readKey, f.body);
        f.body = await C.encryptText(newKey, plain);
        reEncrypted++;
      }
      if (f.thumb && typeof f.thumb === 'object') {
        var th = await C.decryptText(readKey, f.thumb);
        f.thumb = await C.encryptText(newKey, th);
      }
    }
    for (var j = 0; j < payload.notes.length; j++) {
      var n = payload.notes[j];
      if (n.content) {
        var txt = await C.decryptText(readKey, n.content);
        n.content = await C.encryptText(newKey, txt);
        reEncrypted++;
      }
    }
    DB.saveUserData(session.userId, payload);

    DB.updateUser(currentUser.id, { salt: salt, passHash: passHash });
    currentUser = DB.findUserById(currentUser.id);
    dataKey = newKey;
    emit({ type: 'password-changed', reEncrypted: reEncrypted });
    return reEncrypted;
  }

  async function updateProfile(fields) {
    if (!currentUser) throw new Error(errors.NO_SESSION);
    var patch = {};
    if (fields.name && String(fields.name).trim()) patch.name = String(fields.name).trim();
    if (fields.email) {
      var em = DB.normEmail(fields.email);
      if (!EMAIL_RE.test(em)) throw new Error(errors.EMAIL_INVALID);
      var other = DB.findUserByEmail(em);
      if (other && other.id !== currentUser.id) throw new Error(errors.EMAIL_TAKEN);
      patch.email = em;
    }
    currentUser = DB.updateUser(currentUser.id, patch) || currentUser;
    emit({ type: 'profile-updated', user: currentUser });
    return currentUser;
  }

  async function deleteAccount() {
    if (!currentUser) throw new Error(errors.NO_SESSION);
    var id = currentUser.id;
    DB.deleteUser(id);
    session = null; currentUser = null; dataKey = null;
    emit({ type: 'deleted' });
  }

  /* ---------- accessors ---------- */
  function isAuthed() { return !!(session && currentUser); }
  function isUnlocked() { return !!dataKey; }
  function getUser() { return currentUser; }
  function getSession() { return session; }
  function getDataKey() { return dataKey; }
  function getSessionUserId() {
    // المصدر الوحيد الموثوق لتحديد المالك: الجلسة المُتحقَّق منها
    var s = DB.getSession();
    return s ? s.userId : null;
  }

  global.MFAuth = {
    errors: errors,
    on: on,
    register: register,
    login: login,
    restore: restore,
    unlock: unlock,
    logout: logout,
    lock: lock,
    changePassword: changePassword,
    updateProfile: updateProfile,
    deleteAccount: deleteAccount,
    isAuthed: isAuthed,
    isUnlocked: isUnlocked,
    getUser: getUser,
    getSession: getSession,
    getDataKey: getDataKey,
    getSessionUserId: getSessionUserId,
    emailValid: function (e) { return EMAIL_RE.test(String(e || '')); },
    score: C.passwordScore
  };
})(window);
