/**
 * Start all BullMQ workers in one process. Run from repo root after build:
 *   node dist/workers/run-all.js
 * Or: npm run start:workers
 */
const path = require('path');

const workers = [
  'sms.worker.js',
  'email.worker.js',
  'push.worker.js',
  'pdf.worker.js',
  'booking-expire.worker.js',
];

const dir = path.join(__dirname);
workers.forEach((w) => {
  require(path.join(dir, w));
});

console.log('[Workers] All workers started. Press Ctrl+C to stop.');
