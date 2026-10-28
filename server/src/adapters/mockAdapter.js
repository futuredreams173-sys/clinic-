'use strict';

/**
 * MockAdapter — محاكي الأنظمة الصحية (رقيم / صحتي).
 *
 * يعيش داخل الخادم فقط. الواجهة لا تحتوي أي محاكاة:
 * كل مزامنة تمرّ عبر الشبكة إلى هذه الطبقة.
 *
 * العقد (Adapter Pattern) — لا يتغيّر عند استبداله بمحوّل رسمي:
 *   findPatient(type, number)   → patient | null
 *   createPatient(patient)      → { id }
 *   updatePatient(id, patient)  → { id }
 *   registerVisit(id, visit)    → { visitId, patientId }
 */
class MockAdapter {
  constructor(name, options = {}) {
    this.name = name;
    this.failRate = clamp01(options.failRate ?? 0.15);
    const delay = options.delay ?? [500, 1400];
    this.minDelay = Math.max(0, Number(delay[0]) || 0);
    this.maxDelay = Math.max(this.minDelay, Number(delay[1]) || 0);
    this.patients = new Map();
    this.visits = new Map();
    this.counter = 100000;
  }

  _sleep() {
    if (this.maxDelay <= 0) return Promise.resolve();
    const span = this.maxDelay - this.minDelay;
    const ms = this.minDelay + Math.random() * span;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _maybeFail() {
    if (this.failRate > 0 && Math.random() < this.failRate) {
      const error = new Error(`${this.name}: timeout (simulated)`);
      error.code = 'UPSTREAM_TIMEOUT';
      throw error;
    }
  }

  async findPatient(type, number) {
    await this._sleep();
    this._maybeFail();
    return this.patients.get(`${type}:${number}`) || null;
  }

  async createPatient(patient) {
    await this._sleep();
    this._maybeFail();
    const id = `${this.name.slice(0, 2).toUpperCase()}-${++this.counter}`;
    this.patients.set(`${patient.documentType}:${patient.documentNumber}`, { id, ...patient });
    return { id };
  }

  async updatePatient(id, patient) {
    await this._sleep();
    this._maybeFail();
    this.patients.set(`${patient.documentType}:${patient.documentNumber}`, { id, ...patient });
    return { id };
  }

  async registerVisit(id, visit) {
    await this._sleep();
    this._maybeFail();
    const visitId = `${this.name.slice(0, 2).toUpperCase()}-V${++this.counter}`;
    this.visits.set(visitId, { visitId, patientId: id, ...visit });
    return { visitId, patientId: id };
  }
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * ينشئ أنظمة المزامنة.
 * قابل للضبط بالبيئة: MOCK_FAIL_RATE، MOCK_MIN_DELAY، MOCK_MAX_DELAY
 */
function createMockSystems(overrides = {}) {
  const failRate = overrides.failRate ?? Number(process.env.MOCK_FAIL_RATE ?? 0.15);
  const delay =
    overrides.delay ??
    [Number(process.env.MOCK_MIN_DELAY ?? 400), Number(process.env.MOCK_MAX_DELAY ?? 1100)];

  return {
    raqeem: new MockAdapter('raqeem', { failRate, delay }),
    sehhaty: new MockAdapter('sehhaty', { failRate: Math.min(1, failRate * 1.6), delay }),
  };
}

module.exports = { MockAdapter, createMockSystems };
