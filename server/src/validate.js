'use strict';

/**
 * طبقة التحقق — نُقلت بالكامل من كود الواجهة إلى الخادم.
 * كل قاعدة هنا تُرجع رمز خطأ (i18n key) تفهمه الواجهة وتعرضه بالعربية أو الإنجليزية،
 * دون أن تحتاج الواجهة إلى معرفة القاعدة نفسها.
 */

const DOC_TYPES = Object.freeze(['nid', 'iqama', 'passport']);
const CATEGORIES = Object.freeze(['citizen', 'domestic', 'insured']);

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** تحويل الأرقام العربية/الفارسية إلى لاتينية */
function toLatinDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
}

/** تنقية رقم الوثيقة حسب نوعها */
function normalizeDocumentNumber(type, raw) {
  const value = toLatinDigits(raw).trim();
  if (type === 'passport') return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return value.replace(/\D/g, '');
}

/** تنقية رقم الجوال وحمله على الصيغة المحلية 05XXXXXXXX */
function normalizePhone(raw) {
  let value = toLatinDigits(raw).replace(/\D/g, '');
  if (value.startsWith('00966')) value = '0' + value.slice(5);
  else if (value.startsWith('966')) value = '0' + value.slice(3);
  else if (value.startsWith('5') && value.length === 9) value = '0' + value;
  return value;
}

const DOC_RULES = Object.freeze({
  nid: { pattern: /^1\d{9}$/, error: 'eNid' },
  iqama: { pattern: /^2\d{9}$/, error: 'eIqama' },
  passport: { pattern: /^[A-Za-z0-9]{6,12}$/, error: 'ePass' },
});

/** يُرجع رمز الخطأ أو null */
function documentNumberError(type, number) {
  if (!number) return 'eRequired';
  const rule = DOC_RULES[type];
  if (!rule) return 'eDocType';
  return rule.pattern.test(number) ? null : rule.error;
}

// ─── التاريخ الهجري (أم القرى) ────────────────────────────────────────────────
const HIJRI_FORMATTER = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function hijriParts(date) {
  const parts = {};
  for (const part of HIJRI_FORMATTER.formatToParts(date)) parts[part.type] = part.value;
  return { day: Number(parts.day), month: Number(parts.month), year: Number(parts.year) };
}

/**
 * يحوّل تاريخاً هجرياً (أم القرى) إلى ميلادي.
 * نجرب نافذة زمنية حول تقدير تقريبي ونعيد أول يوم يطابق القيم الثلاث.
 */
function hijriToGregorian(year, month, day) {
  if (!(year >= 1300 && year <= 1600) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 30)) {
    return null;
  }
  const approxYear = Math.round(622 + (year - 1) * 0.970229 + ((month - 1) * 29.5 + day) / 365.25);
  const anchor = Date.UTC(approxYear, 0, 1);
  for (let offset = -60; offset <= 420; offset += 1) {
    const candidate = new Date(anchor + offset * 86400000);
    const parts = hijriParts(candidate);
    if (parts.year === year && parts.month === month && parts.day === day) return candidate;
  }
  return null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** يُرجع رمز الخطأ أو null، ويكتب الناتج في value.birthDate */
function resolveBirthDate(input) {
  const hijri = input.birthDateHijri;

  if (hijri && typeof hijri === 'object') {
    const date = hijriToGregorian(Number(hijri.year), Number(hijri.month), Number(hijri.day));
    if (!date) return { error: 'eDob' };
    return { value: date.toISOString().slice(0, 10) };
  }

  const raw = String(input.birthDate ?? '').trim();
  if (!raw) return { error: 'eRequired' };

  const match = ISO_DATE.exec(raw);
  if (!match) return { error: 'eDob' };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { error: 'eDob' };
  }

  const today = new Date();
  if (date > today) return { error: 'eDob' };
  if (year < 1900) return { error: 'eDob' };

  return { value: raw };
}

/**
 * التحقق الكامل من حمولة تسجيل/تحديث المراجع.
 * @returns {{ ok: boolean, errors: Record<string,string>, value: object }}
 */
function validatePatientPayload(body) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = {};

  // النوع والفئة
  const documentType = String(input.documentType ?? '').trim().toLowerCase();
  if (!DOC_TYPES.includes(documentType)) errors.documentType = 'eDocType';

  const category = String(input.category ?? '').trim().toLowerCase();
  if (!CATEGORIES.includes(category)) errors.category = 'eCategory';

  // المواطن يسجّل بالهوية الوطنية حصراً
  if (category === 'citizen' && DOC_TYPES.includes(documentType) && documentType !== 'nid') {
    errors.documentType = 'eCitizenDoc';
  }

  // رقم الوثيقة
  const documentNumber = normalizeDocumentNumber(documentType, input.documentNumber);
  const docError = documentNumberError(documentType, documentNumber);
  if (docError) errors.documentNumber = docError;

  // تاريخ الميلاد (ميلادي أو هجري)
  const birth = resolveBirthDate(input);
  if (birth.error) errors.birthDate = birth.error;

  // الجوال
  const phoneLocal = normalizePhone(input.phone);
  if (!phoneLocal) errors.phone = 'eRequired';
  else if (!/^05\d{8}$/.test(phoneLocal)) errors.phone = 'ePhone';

  // التأمين
  let insurer = null;
  let policyNumber = null;
  if (category === 'insured') {
    insurer = String(input.insurer ?? '').trim();
    policyNumber = String(input.policyNumber ?? '').trim();
    if (!insurer) errors.insurer = 'eRequired';
    if (!policyNumber) errors.policyNumber = 'eRequired';
    if (insurer.length > 120) errors.insurer = 'eTooLong';
    if (policyNumber.length > 64) errors.policyNumber = 'eTooLong';
  }

  // رمز الدخول (سرّ المستخدم — يُخزَّن مُشتقاً فقط)
  const pin = String(input.pin ?? '');
  if (!pin) errors.pin = 'eRequired';
  else if (pin.length < 6) errors.pin = 'ePinShort';
  else if (pin.length > 64) errors.pin = 'ePinLong';

  // الموافقة
  if (input.consent !== true) errors.consent = 'eConsent';

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      documentType,
      documentNumber,
      category,
      birthDate: birth.value || '',
      phone: phoneLocal ? `+966${phoneLocal.slice(1)}` : '',
      phoneLocal,
      insurer,
      policyNumber,
      pin,
    },
  };
}

/** تحقق مبسّط لحمولة إنشاء زيارة */
function validateVisitPayload(body) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = {};

  const patientId = input.patientId ? String(input.patientId).trim() : '';
  const documentType = String(input.documentType ?? '').trim().toLowerCase();
  const documentNumber = normalizeDocumentNumber(documentType, input.documentNumber);

  if (!patientId) {
    if (!DOC_TYPES.includes(documentType)) errors.documentType = 'eDocType';
    const docError = documentNumberError(documentType, documentNumber);
    if (docError) errors.documentNumber = docError;
  }

  const reason = input.reason ? String(input.reason).trim().slice(0, 280) : null;

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { patientId, documentType, documentNumber, reason },
  };
}

/** إخفاء رقم الوثيقة في الردود (يظهر أول رقم وآخر رقمين فقط) */
function maskDocument(value) {
  const text = String(value ?? '');
  if (text.length <= 4) return text;
  return text.slice(0, 1) + '•'.repeat(text.length - 3) + text.slice(-2);
}

module.exports = {
  DOC_TYPES,
  CATEGORIES,
  toLatinDigits,
  normalizeDocumentNumber,
  normalizePhone,
  documentNumberError,
  hijriToGregorian,
  resolveBirthDate,
  validatePatientPayload,
  validateVisitPayload,
  maskDocument,
};
