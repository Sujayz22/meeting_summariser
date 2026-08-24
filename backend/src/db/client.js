const { Pool } = require('pg');
require('dotenv').config();

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/meeting_summarizer';

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 1000,
});

const fs = require('fs');
const path = require('path');

const memoryDbFile = path.join(__dirname, '../../uploads/memory_db.json');

// ─── In-memory fallback (used when Postgres is unavailable locally) ───────────
const memoryStore = new Map();
let useMemoryFallback = process.env.DISABLE_POSTGRES === 'true';

function loadMemoryStore() {
  try {
    if (fs.existsSync(memoryDbFile)) {
      const data = fs.readFileSync(memoryDbFile, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        parsed.forEach(([id, row]) => memoryStore.set(id, row));
      }
    }
  } catch (err) {
    console.error('Failed to load local fallback DB:', err);
  }
}

function persistMemoryStore() {
  try {
    const uploadDir = path.dirname(memoryDbFile);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const entries = [...memoryStore.entries()];
    fs.writeFileSync(memoryDbFile, JSON.stringify(entries, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist local fallback DB:', err);
  }
}

// Load existing persisted memory store if available
loadMemoryStore();

pool.on('error', () => {
  useMemoryFallback = true;
});

// ─── Public query interface ────────────────────────────────────────────────────
async function query(text, params = []) {
  if (useMemoryFallback) {
    return handleMemoryQuery(text, params);
  }
  try {
    return await pool.query(text, params);
  } catch (err) {
    useMemoryFallback = true;
    return handleMemoryQuery(text, params);
  }
}

// ─── Memory store handler ──────────────────────────────────────────────────────
function parseJsonSafe(val) {
  if (val == null) return null;
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return val; }
}

function handleMemoryQuery(text, params) {
  const t = text.trim().toUpperCase();

  // ── INSERT ──
  if (t.startsWith('INSERT INTO MEETINGS')) {
    const [id, original_filename, status] = params;
    const now = new Date();
    const row = {
      id,
      original_filename,
      status: status || 'processing',
      transcript: null,
      summary: null,
      key_decisions: null,
      action_items: null,
      error_message: null,
      created_at: now,
      updated_at: now,
    };
    memoryStore.set(id, row);
    persistMemoryStore();
    return { rows: [row], rowCount: 1 };
  }

  // ── SELECT all (list) ──
  if (t.startsWith('SELECT') && t.includes('FROM MEETINGS') && !t.includes('WHERE')) {
    const rows = [...memoryStore.values()].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    return { rows, rowCount: rows.length };
  }

  // ── SELECT by id ──
  if (t.startsWith('SELECT') && t.includes('FROM MEETINGS') && t.includes('WHERE')) {
    const id = params[0];
    const row = memoryStore.get(id);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }

  // ── UPDATE ──
  if (t.startsWith('UPDATE MEETINGS')) {
    const id = params[params.length - 1];
    const row = memoryStore.get(id);
    if (!row) return { rows: [], rowCount: 0 };

    // Identify which UPDATE pattern this is by counting params
    const lower = text.toLowerCase();

    if (lower.includes('transcript =') && lower.includes('status =') && params.length === 3) {
      // Stage 1: transcript + status
      row.transcript = params[0];
      row.status = params[1];
    } else if (lower.includes('summary =') && lower.includes('key_decisions =') && params.length === 5) {
      // Stage 2: summary + key_decisions + action_items + status
      row.summary = params[0];
      row.key_decisions = parseJsonSafe(params[1]);
      row.action_items = parseJsonSafe(params[2]);
      row.status = params[3];
    } else if (lower.includes('error_message =') && lower.includes('status =') && params.length === 3) {
      // Error path
      row.error_message = params[0];
      row.status = params[1];
    } else if (lower.includes('status =') && params.length === 2) {
      // Simple status flip (e.g., back to 'transcribed' before re-summarize)
      row.status = params[0];
    }

    row.updated_at = new Date();
    memoryStore.set(id, row);
    persistMemoryStore();
    return { rows: [row], rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
}

// ─── Schema bootstrap ─────────────────────────────────────────────────────────
async function initDb() {
  const sql = `
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    CREATE TABLE IF NOT EXISTS meetings (
      id          UUID        PRIMARY KEY,
      original_filename TEXT  NOT NULL,
      status      TEXT        NOT NULL DEFAULT 'processing',
      transcript  TEXT,
      summary     TEXT,
      key_decisions JSONB,
      action_items  JSONB,
      error_message TEXT,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now()
    );
  `;
  try {
    await pool.query(sql);
    console.log('✅ PostgreSQL schema verified / initialized.');
  } catch (err) {
    console.log('💾 Running with built-in in-memory database store (standalone mode).');
    useMemoryFallback = true;
  }
}

module.exports = { query, initDb, pool };
