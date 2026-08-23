const { GoogleGenAI } = require('@google/genai');

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an assistant that converts raw meeting transcripts into structured notes.

Given the transcript below, output valid JSON with this exact shape:
{
  "summary": "3-5 sentence overview of what the meeting was about",
  "key_decisions": ["decision 1", "decision 2"],
  "action_items": [
    { "task": "...", "owner": "name or 'unassigned'", "due": "date or 'unspecified'" }
  ]
}

Only include decisions/actions that are explicitly stated or clearly implied — do not invent content.
Respond ONLY with valid JSON. No markdown fences, no explanation.`;

const MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
const MAX_ATTEMPTS = 3;

/**
 * Summarizes raw meeting transcript using Gemini into structured JSON.
 */
async function generateSummary(transcript) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.warn('⚠️ GEMINI_API_KEY not configured. Returning mock structured summary.');
    return getMockSummary();
  }

  const ai = new GoogleGenAI({ apiKey });

  let lastErr;
  for (const modelName of MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        console.log(`🧠 Calling Gemini ${modelName} (Attempt ${attempt}/${MAX_ATTEMPTS})...`);

        const response = await ai.models.generateContent({
          model: modelName,
          contents: `${SYSTEM_PROMPT}\n\nTranscript:\n${transcript}`,
          config: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        });

        const rawText = response.text?.trim();
        if (!rawText) throw new Error('Gemini returned an empty response.');

        // Strip markdown fences if model wraps in ```json ... ``` anyway
        const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        const parsed = JSON.parse(cleaned);

        const normalized = normalizeSummaryPayload(parsed);
        console.log(`✅ Gemini (${modelName}) summary generated successfully.`);
        return normalized;

      } catch (err) {
        lastErr = err;
        const errMsg = err.message || String(err);

        // If model is not found / 404, break attempt loop to try next model in fallback list immediately
        const isNotFound = err.status === 404 || /not_found|404|no longer available/i.test(errMsg);
        if (isNotFound) {
          console.warn(`⚠️ Model ${modelName} not found/deprecated. Trying next model...`);
          break;
        }

        const isQuota = /quota|429|resource_exhausted|rate.?limit/i.test(errMsg);
        if (isQuota) {
          console.warn(`⚠️ Gemini quota/rate-limit (${modelName}): ${errMsg}`);
          return getQuotaFallbackSummary(transcript, errMsg);
        }

        console.error(`❌ Gemini (${modelName}) attempt ${attempt}/${MAX_ATTEMPTS} failed:`, errMsg);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(attempt * 1500);
        }
      }
    }
  }

  // All models and attempts exhausted with non-quota error → throw so pipeline marks meeting as failed
  throw new Error(`Gemini summarization failed after trying all models (${MODELS.join(', ')}): ${lastErr?.message || 'Unknown error'}`);
}

// ─── Normalise + Helpers ──────────────────────────────────────────────────────

function normalizeSummaryPayload(parsed) {
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : 'Summary unavailable.',
    key_decisions: Array.isArray(parsed.key_decisions) ? parsed.key_decisions : [],
    action_items: Array.isArray(parsed.action_items)
      ? parsed.action_items.map(item => ({
          task: item.task || 'Unspecified task',
          owner: item.owner || 'unassigned',
          due: item.due || 'unspecified',
        }))
      : [],
  };
}

function getQuotaFallbackSummary(transcript, errMsg) {
  const words = transcript ? transcript.trim().split(/\s+/) : [];
  const preview = words.slice(0, 80).join(' ');

  return {
    summary: `[LLM Unavailable] Gemini API error: "${errMsg}". Transcript was successfully generated (${words.length} words).\n\nPreview: "${preview}${words.length > 80 ? '...' : ''}"`,
    key_decisions: [
      'Speech-to-Text transcription completed successfully via Sarvam AI.',
      `Gemini summarization failed: ${errMsg}. Update GEMINI_API_KEY in backend/.env and click Re-summarize.`,
    ],
    action_items: [
      {
        task: 'Verify GEMINI_API_KEY in backend/.env has quota available',
        owner: 'Admin',
        due: 'Immediate',
      },
    ],
  };
}

function getMockSummary() {
  return {
    summary: 'The team reviewed the Q3 roadmap for the Meeting Summarizer service. Key discussion topics included handling large audio files using Sarvam AI ASR and enforcing structured JSON outputs from the LLM. Deliverables and timelines were agreed upon.',
    key_decisions: [
      'Approved Sarvam AI ASR approach for audio transcription.',
      'Switched LLM summarization from OpenAI to Gemini.',
      'Targeted Docker deployment by Monday.',
    ],
    action_items: [
      { task: 'Finalize meeting summarizer API documentation', owner: 'Alice', due: 'Friday' },
      { task: 'Deploy Docker container to production environment', owner: 'Charlie', due: 'Monday' },
    ],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { generateSummary };
