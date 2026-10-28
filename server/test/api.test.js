'use strict';

// يجب ضبط البيئة قبل تحميل الوحدات التي تقرأها عند التحميل
process.env.PIN_ITERATIONS = '1000';
process.env.SYNC_BACKOFF_MS = '0';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../src/app');
const { hijriToGregorian } = require('../src/validate');

let app;
let server;
let base;

before(async () => {
  app = createApp({ dbPath: ':memory:', mock: { failRate: 0, delay: [0, 0] } });
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  app.locals.db.close();
});

async function api(pathname, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(base + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

function patientPayload(overrides = {}) {
  return {
    documentType: 'nid',
    documentNumber: '1234567890',
    category: 'citizen',
    birthDate: '1990-01-01',
    phone: '0551234567',
    pin: 'Secret123',
    consent: true,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /health', () => {
  test('يرد بالحالة ok ويعرض الأنظمة الموصولة', async () => {
    const res = await api('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.deepEqual(res.body.systems.sort(), ['raqeem', 'sehhaty']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /patients', () => {
  test('ينشئ مراجعاً جديداً ويعيد رمز جلسة ورقم وثيقة مُخفى', async () => {
    const res = await api('/patients', { method: 'POST', body: patientPayload() });

    assert.equal(res.status, 201);
    assert.equal(res.body.created, true);
    assert.match(res.body.patient.id, /^PT-/);
    assert.equal(res.body.patient.documentType, 'nid');
    assert.equal(res.body.patient.maskedDocumentNumber, '1•••••••90');
    assert.equal(res.body.patient.phone, '+966551234567');
    assert.match(res.body.token, /^[a-f0-9]{64}$/);
    assert.deepEqual(res.body.visits, []);

    // لا يُعاد أي سرّ في الردّ
    assert.equal(JSON.stringify(res.body).includes('Secret123'), false);
    assert.equal(res.body.patient.pin, undefined);
    assert.equal(res.body.patient.pinHash, undefined);
  });

  test('يخزّن رمز الدخول مُشتقاً ورمز الجلسة مُجزَّأً — لا نصّ صريح', () => {
    const row = app.locals.db
      .prepare('SELECT * FROM patients WHERE document_number = ?')
      .get('1234567890');

    assert.ok(row, 'الصف موجود');
    assert.equal(row.pin_hash.includes('Secret123'), false);
    assert.match(row.pin_hash, /^[a-f0-9]{64}$/);
    assert.match(row.pin_salt, /^[a-f0-9]{32}$/);
    assert.match(row.token_hash, /^[a-f0-9]{64}$/);

    const dump = JSON.stringify(app.locals.db.prepare('SELECT * FROM patients').all());
    assert.equal(dump.includes('Secret123'), false);
  });

  test('يرفض رمز دخول خاطئاً للمراجع الموجود (401)', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ pin: 'WrongPass1' }),
    });

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_PIN');
  });

  test('يقبل إعادة تسجيل نفس الوثيقة بالرمز الصحيح ويُصدر جلسة جديدة', async () => {
    const res = await api('/patients', { method: 'POST', body: patientPayload() });

    assert.equal(res.status, 200);
    assert.equal(res.body.created, false);
    assert.match(res.body.token, /^[a-f0-9]{64}$/);
    assert.equal(res.body.patient.maskedDocumentNumber, '1•••••••90');
  });

  test('يرفض رقم هوية لا يبدأ بـ 1 (422)', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentNumber: '2234567890' }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    assert.equal(res.body.error.fields.documentNumber, 'eNid');
  });

  test('يرفض تسجيل المواطن بغير الهوية الوطنية (422)', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentNumber: '2345678901', documentType: 'iqama' }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.fields.documentType, 'eCitizenDoc');
  });

  test('يرفض رقم جوال غير صحيح (422)', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentNumber: '1345678901', phone: '12345' }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.fields.phone, 'ePhone');
  });

  test('يرفض المشمول بالتأمين دون شركة أو بوليصة (422)', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({
        documentNumber: '1445678901',
        category: 'insured',
        insurer: '',
        policyNumber: '',
      }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.fields.insurer, 'eRequired');
    assert.equal(res.body.error.fields.policyNumber, 'eRequired');
  });

  test('يقبل المشمول بالتأمين مع شركة وبوليصة', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({
        documentType: 'iqama',
        documentNumber: '2445678901',
        category: 'insured',
        insurer: 'بوبا العربية',
        policyNumber: 'POL-9911',
      }),
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.patient.insurer, 'بوبا العربية');
    assert.equal(res.body.patient.policyNumber, 'POL-9911');
  });

  test('يرفض رقم جواز غير صالح (422)', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentType: 'passport', documentNumber: 'A1', category: 'insured', insurer: 'X', policyNumber: 'Y' }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.fields.documentNumber, 'ePass');
  });

  test('يقبل رقم الجواز ويحوّله إلى أحرف كبيرة', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({
        documentType: 'passport',
        documentNumber: 'ab1234567',
        category: 'insured',
        insurer: 'تعاونية',
        policyNumber: 'P-1',
      }),
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.patient.documentNumber, 'AB1234567');
  });

  test('يوحّد الأرقام العربية الهندية إلى لاتينية', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentNumber: '١٥٥٥٥٥٥٥٥٥' }),
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.patient.documentNumber, '1555555555');
  });

  test('يرفض تاريخ ميلاد في المستقبل (422)', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentNumber: '1666666666', birthDate: '2999-01-01' }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.fields.birthDate, 'eDob');
  });

  test('يرفض تاريخ ميلاد غير موجود (422)', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentNumber: '1777777777', birthDate: '1990-02-31' }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.fields.birthDate, 'eDob');
  });

  test('يحوّل تاريخ الميلاد الهجري (أم القرى) إلى ميلادي على الخادم', async () => {
    const gregorian = hijriToGregorian(1410, 6, 3);
    assert.ok(gregorian, 'التحويل نجح');
    assert.equal(gregorian.toISOString().slice(0, 10), '1990-01-01');

    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({
        documentNumber: '1888888888',
        birthDate: undefined,
        birthDateHijri: { year: 1410, month: 6, day: 3 },
      }),
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.patient.birthDate, '1990-01-01');
  });

  test('يرفض طلباً بلا رمز دخول (422)', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentNumber: '1999999999', pin: '' }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.fields.pin, 'eRequired');
  });

  test('يرفض رمز دخول قصيراً (422)', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentNumber: '1999999998', pin: '123' }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.fields.pin, 'ePinShort');
  });

  test('يرفض غياب الموافقة (422)', async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentNumber: '1999999997', consent: false }),
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.fields.consent, 'eConsent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /patients/:docType/:docNo', () => {
  let token;

  before(async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentNumber: '1234567890' }),
    });
    token = res.body.token;
  });

  test('يرفض الطلب دون جلسة (401)', async () => {
    const res = await api('/patients/nid/1234567890');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTH_REQUIRED');
  });

  test('يرفض رمز جلسة غير معروف (401)', async () => {
    const res = await api('/patients/nid/1234567890', { token: 'a'.repeat(64) });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTH_REQUIRED');
  });

  test('يعيد ملف المراجع لصاحب الجلسة', async () => {
    const res = await api('/patients/nid/1234567890', { token });

    assert.equal(res.status, 200);
    assert.equal(res.body.patient.id.length > 3, true);
    assert.equal(res.body.patient.maskedDocumentNumber, '1•••••••90');
    assert.ok(Array.isArray(res.body.visits));
  });

  test('يمنع أي مستخدم آخر من قراءة بيانات غيره (403)', async () => {
    const other = await api('/patients', {
      method: 'POST',
      body: patientPayload({
        documentType: 'iqama',
        documentNumber: '2345678901',
        category: 'domestic',
      }),
    });
    assert.equal(other.status, 201);

    const res = await api('/patients/nid/1234567890', { token: other.body.token });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('يعيد 404 لرقم وثيقة غير مسجّل', async () => {
    const res = await api('/patients/nid/1000000001', { token });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'PATIENT_NOT_FOUND');
  });

  test('يعمل أيضاً على المسار /api/patients/...', async () => {
    const res = await api('/api/patients/nid/1234567890', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.patient.documentNumber, '1234567890');
  });

  test('يستأنف الجلسة على جهاز جديد برمز الدخول', async () => {
    const res = await api('/patients/nid/1234567890/session', {
      method: 'POST',
      body: { pin: 'Secret123' },
    });

    assert.equal(res.status, 200);
    assert.match(res.body.token, /^[a-f0-9]{64}$/);

    const bad = await api('/patients/nid/1234567890/session', {
      method: 'POST',
      body: { pin: 'nope' },
    });
    assert.equal(bad.status, 401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /visits', () => {
  let token;
  let patientId;

  before(async () => {
    const res = await api('/patients', {
      method: 'POST',
      body: patientPayload({ documentNumber: '1234567890' }),
    });
    token = res.body.token;
    patientId = res.body.patient.id;
  });

  test('ينشئ زيارة ويزامنها مع رقيم وصحتي', async () => {
    const res = await api('/visits', {
      method: 'POST',
      token,
      body: { patientId, reason: 'مراجعة عامة' },
    });

    assert.equal(res.status, 201);
    assert.match(res.body.visit.id, /^V-/);
    assert.equal(res.body.visit.patientId, patientId);
    assert.equal(res.body.visit.status, 'waiting');
    assert.ok(res.body.visit.queueNumber > 100);
    assert.equal(res.body.sync.raqeem.status, 'ok');
    assert.equal(res.body.sync.sehhaty.status, 'ok');
    assert.ok(res.body.sync.raqeem.externalId);
    assert.ok(res.body.sync.sehhaty.externalId);
  });

  test('يرفع رقم الانتظار بمقدار واحد لكل زيارة جديدة', async () => {
    const first = await api('/visits', { method: 'POST', token, body: { patientId } });
    const second = await api('/visits', { method: 'POST', token, body: { patientId } });

    assert.equal(second.body.visit.queueNumber, first.body.visit.queueNumber + 1);
  });

  test('يقبل تحديد المراجع برقم الوثيقة', async () => {
    const res = await api('/visits', {
      method: 'POST',
      token,
      body: { documentType: 'nid', documentNumber: '1234567890' },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.visit.patientId, patientId);
  });

  test('يرفض الزيارة دون جلسة (401)', async () => {
    const res = await api('/visits', { method: 'POST', body: { patientId } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTH_REQUIRED');
  });

  test('يمنع إنشاء زيارة لمراجع آخر (403)', async () => {
    const other = await api('/patients', {
      method: 'POST',
      body: patientPayload({
        documentType: 'iqama',
        documentNumber: '2555555555',
        category: 'domestic',
      }),
    });

    const res = await api('/visits', {
      method: 'POST',
      token: other.body.token,
      body: { patientId },
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('يعيد 404 لمراجع غير موجود', async () => {
    const res = await api('/visits', {
      method: 'POST',
      token,
      body: { patientId: 'PT-NOPE' },
    });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'PATIENT_NOT_FOUND');
  });

  test('تُعرض الزيارات مع حالة المزامنة في ملف المراجع', async () => {
    const res = await api('/patients/nid/1234567890', { token });

    assert.equal(res.status, 200);
    assert.ok(res.body.visits.length >= 3);
    assert.equal(res.body.visits[0].sync.raqeem.status, 'ok');
    assert.equal(res.body.visits[0].sync.sehhaty.status, 'ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MockAdapter — فشل الأنظمة الصحية', () => {
  let failing;
  let failingServer;
  let failingBase;

  before(async () => {
    failing = createApp({
      dbPath: ':memory:',
      mock: { failRate: 1, delay: [0, 0] },
    });
    failingServer = await new Promise((resolve) => {
      const s = failing.listen(0, '127.0.0.1', () => resolve(s));
    });
    failingBase = `http://127.0.0.1:${failingServer.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => failingServer.close(resolve));
    failing.locals.db.close();
  });

  test('يسجّل فشل المزامنة بدل إسقاط الزيارة', async () => {
    const create = await fetch(`${failingBase}/patients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        patientPayload({ documentNumber: '1123456789', phone: '0550000001' })
      ),
    });
    const { token, patient } = await create.json();

    const res = await fetch(`${failingBase}/visits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ patientId: patient.id }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.sync.raqeem.status, 'fail');
    assert.equal(body.sync.sehhaty.status, 'fail');
    assert.match(body.sync.raqeem.detail, /simulated/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('مسارات غير معروفة', () => {
  test('تعيد 404 بصيغة JSON', async () => {
    const res = await api('/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('ترفض JSON تالفاً بـ 400', async () => {
    const res = await fetch(`${base}/patients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ bad json',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_JSON');
  });
});
