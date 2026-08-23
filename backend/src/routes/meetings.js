const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4, validate: uuidValidate } = require('uuid');

const db = require('../db/client');
const { validateAudioFile } = require('../services/audioService');
const { processMeetingPipeline, resummarizeMeeting } = require('../services/pipeline');

// ─── Upload directory ────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ─── Multer configuration ────────────────────────────────────────────────────
const ALLOWED_MIME = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
  'audio/ogg', 'audio/flac', 'audio/x-flac',
  'video/mp4', // some recorders produce mp4 containers
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.audio';
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unsupported MIME type: ${file.mimetype}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB outer limit; ASR chunking handles >25 MB
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseMeeting(row) {
  let keyDecisions = row.key_decisions ?? [];
  let actionItems = row.action_items ?? [];

  if (typeof keyDecisions === 'string') {
    try { keyDecisions = JSON.parse(keyDecisions); } catch { keyDecisions = []; }
  }
  if (typeof actionItems === 'string') {
    try { actionItems = JSON.parse(actionItems); } catch { actionItems = []; }
  }

  return {
    id: row.id,
    original_filename: row.original_filename,
    status: row.status,
    transcript: row.transcript ?? null,
    summary: row.summary ?? null,
    key_decisions: Array.isArray(keyDecisions) ? keyDecisions : [],
    action_items: Array.isArray(actionItems) ? actionItems : [],
    error_message: row.error_message ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateUUID(id, res) {
  if (!uuidValidate(id)) {
    res.status(400).json({ error: `Invalid meeting ID format: "${id}"` });
    return false;
  }
  return true;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/meetings
 * List all meetings (most recent first)
 */
router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT
         id,
         original_filename,
         status,
         summary,
         transcript,
         key_decisions,
         action_items,
         created_at,
         updated_at
       FROM meetings
       ORDER BY created_at DESC
       LIMIT 50`,
      []
    );

    const meetings = (result.rows || []).map(row => {
      let keyDecisions = row.key_decisions ?? [];
      let actionItems  = row.action_items  ?? [];
      if (typeof keyDecisions === 'string') { try { keyDecisions = JSON.parse(keyDecisions); } catch { keyDecisions = []; } }
      if (typeof actionItems  === 'string') { try { actionItems  = JSON.parse(actionItems);  } catch { actionItems  = []; } }

      const wordCount = row.transcript ? row.transcript.trim().split(/\s+/).filter(Boolean).length : 0;

      return {
        id:                  row.id,
        original_filename:   row.original_filename,
        status:              row.status,
        summary:             row.summary ?? null,
        word_count:          wordCount,
        key_decisions_count: Array.isArray(keyDecisions) ? keyDecisions.length : 0,
        action_items_count:  Array.isArray(actionItems)  ? actionItems.length  : 0,
        created_at:          row.created_at,
        updated_at:          row.updated_at,
      };
    });

    return res.json({ meetings });
  } catch (err) {
    console.error('Error in GET /api/meetings:', err);
    return res.status(500).json({ error: 'Failed to fetch meetings list.' });
  }
});

/**
 * POST /api/meetings
 * Upload audio file → creates DB row → kicks off async pipeline
 */
router.post('/', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required. Send as multipart field "audio".' });
    }

    // Additional extension validation (belt-and-suspenders over MIME filter)
    try {
      validateAudioFile(req.file);
    } catch (valErr) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: valErr.message });
    }

    const meetingId = uuidv4();

    await db.query(
      `INSERT INTO meetings (id, original_filename, status) VALUES ($1, $2, $3)`,
      [meetingId, req.file.originalname, 'processing']
    );

    // Fire-and-forget — pipeline runs after response is sent
    setImmediate(() => {
      processMeetingPipeline(meetingId, req.file.path).catch((err) => {
        console.error(`Unhandled pipeline error for ${meetingId}:`, err);
      });
    });

    return res.status(202).json({
      meetingId,
      status: 'processing',
      message: 'Audio uploaded. Processing pipeline started.',
    });

  } catch (err) {
    console.error('Error in POST /api/meetings:', err);
    return res.status(500).json({ error: 'Internal error processing audio upload.' });
  }
});

/**
 * GET /api/meetings/:id
 * Full meeting details: status, transcript, summary, key_decisions, action_items
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;

  try {
    const result = await db.query(`SELECT * FROM meetings WHERE id = $1`, [id]);

    if (!result.rows?.length) {
      return res.status(404).json({ error: `Meeting "${id}" not found.` });
    }

    return res.json(parseMeeting(result.rows[0]));

  } catch (err) {
    console.error(`Error in GET /api/meetings/${id}:`, err);
    return res.status(500).json({ error: 'Internal error fetching meeting.' });
  }
});

/**
 * POST /api/meetings/:id/resummarize
 * Re-runs LLM summarization on an existing transcript (no re-upload needed)
 */
router.post('/:id/resummarize', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;

  try {
    const result = await db.query(`SELECT id, transcript, status FROM meetings WHERE id = $1`, [id]);

    if (!result.rows?.length) {
      return res.status(404).json({ error: `Meeting "${id}" not found.` });
    }

    const meeting = result.rows[0];

    if (!meeting.transcript) {
      return res.status(400).json({ error: 'Meeting has no transcript yet — wait for transcription to complete.' });
    }

    if (meeting.status === 'processing' || meeting.status === 'transcribed') {
      return res.status(409).json({ error: `Meeting is currently ${meeting.status}. Wait for pipeline to finish first.` });
    }

    setImmediate(() => {
      resummarizeMeeting(id, meeting.transcript).catch((err) => {
        console.error(`Async re-summarization error for ${id}:`, err);
      });
    });

    return res.json({
      meetingId: id,
      status: 'processing',
      message: 'Re-summarization started. Poll GET /api/meetings/:id for updated results.',
    });

  } catch (err) {
    console.error(`Error in POST /api/meetings/${id}/resummarize:`, err);
    return res.status(500).json({ error: 'Internal error triggering re-summarization.' });
  }
});

// ─── Multer error handler (file size, bad MIME, etc.) ────────────────────────
router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum upload size is 100 MB.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  next(err);
});

module.exports = router;
