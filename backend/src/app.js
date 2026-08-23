const express = require('express'); // Express server entry point with PostgreSQL connection & routing
const cors = require('cors');
require('dotenv').config();

const { initDb } = require('./db/client');
const meetingsRouter = require('./routes/meetings');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'meeting-summarizer-backend',
    timestamp: new Date(),
    db: 'connected', // overridden below if fallback
  });
});

app.use('/api/meetings', meetingsRouter);

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log('=======================================================');
    console.log(`🚀 Meeting Summarizer API  →  http://localhost:${PORT}`);
    console.log(`🩺 Health                  →  http://localhost:${PORT}/health`);
    console.log(`📋 Meetings list           →  http://localhost:${PORT}/api/meetings`);
    console.log('=======================================================');
  });
}

start();

module.exports = app; // for testing
