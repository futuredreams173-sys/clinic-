'use strict';

const path = require('node:path');

const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'clinic.db');

const app = createApp({ dbPath });

const server = app.listen(port, host, () => {
  console.log(`clinic-api → http://localhost:${port}`);
  console.log(`  database : ${dbPath}`);
  console.log(`  health   : http://localhost:${port}/health`);
  console.log('  routes   : POST /patients · GET /patients/:docType/:docNo · POST /visits');
});

function shutdown(signal) {
  console.log(`\n[api] ${signal} received — shutting down`);
  server.close(() => {
    try {
      app.locals.db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(signal));
