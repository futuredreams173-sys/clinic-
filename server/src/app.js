'use strict';

const express = require('express');

const { openDatabase } = require('./db');
const { createMockSystems } = require('./adapters/mockAdapter');
const patientsRouter = require('./routes/patients');
const visitsRouter = require('./routes/visits');

/**
 * ينشئ تطبيق Express جاهزاً للاختبار أو للتشغيل.
 * @param {{ db?: object, dbPath?: string, systems?: object, mock?: object, corsOrigin?: string }} options
 */
function createApp(options = {}) {
  const db = options.db ?? openDatabase(options.dbPath ?? ':memory:');
  const systems = options.systems ?? createMockSystems(options.mock ?? {});
  const corsOrigin = options.corsOrigin ?? process.env.CORS_ORIGIN ?? '*';

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(express.json({ limit: '64kb' }));

  // ترويسات الأمان + CORS (بدون اعتماديات إضافية)
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', corsOrigin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  });

  app.locals.db = db;
  app.locals.systems = systems;

  const health = (req, res) =>
    res.json({
      status: 'ok',
      systems: Object.keys(systems),
      time: new Date().toISOString(),
    });

  app.get('/health', health);
  app.get('/api/health', health);

  // المسارات مكشوفة على الجذر وعلى /api
  for (const base of ['/', '/api']) {
    app.use(base, patientsRouter);
    app.use(base, visitsRouter);
  }

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' } }));

  // معالج أخطاء موحّد
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error && error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON' } });
    }
    if (error && error.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    }
    console.error('[api] unhandled error:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
  });

  return app;
}

module.exports = { createApp };
