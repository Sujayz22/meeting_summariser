const fs = require('fs');
const os = require('os');
const path = require('path');
const { SarvamAIClient } = require('sarvamai');
const { parseFile } = require('music-metadata');

// ─── Constants ────────────────────────────────────────────────────────────────
const REST_MAX_DURATION_SECONDS = 28;     // Sarvam REST limit is 30 s; use 28 s to be safe
const CHUNK_DURATION_SECONDS = 25;        // Each time-split chunk for REST path
const SARVAM_TIMEOUT_SECONDS = 180;      // Per-request timeout for REST calls
const MAX_REST_RETRIES = 3;              // Retry attempts for transient errors
const BATCH_POLL_INTERVAL_SECONDS = 5;  // How often to poll batch job status
const BATCH_TIMEOUT_SECONDS = 900;       // 15 min max wait for batch completion

/**
 * Main entry point.
 * Detects audio duration and routes to:
 *   - REST API  → short clips (≤ 28 s)
 *   - Batch API → anything longer (Sarvam handles it natively, no chunking needed)
 */
async function transcribeAudio(filePath) {
  const apiKey = process.env.SARVAM_API_KEY;
  const useMock = !apiKey || apiKey === 'your_sarvam_api_key_here';

  if (useMock) {
    console.warn('⚠️  SARVAM_API_KEY not configured. Using mock transcription.');
    return getMockTranscript();
  }

  const client = new SarvamAIClient({
    apiSubscriptionKey: apiKey,
    timeoutInSeconds: SARVAM_TIMEOUT_SECONDS,
  });

  const durationSeconds = await getAudioDuration(filePath);
  console.log(`🎵 Audio duration: ${durationSeconds.toFixed(1)}s`);

  if (durationSeconds <= REST_MAX_DURATION_SECONDS) {
    console.log('📡 Using Sarvam REST API (short clip)...');
    return transcribeViaRest(client, filePath);
  }

  console.log(`📦 Audio exceeds ${REST_MAX_DURATION_SECONDS}s — using Sarvam Batch API...`);
  return transcribeViaBatch(client, filePath);
}

// ─── REST path ────────────────────────────────────────────────────────────────

async function transcribeViaRest(client, filePath) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_REST_RETRIES; attempt++) {
    const audioFile = fs.createReadStream(filePath);
    try {
      const response = await client.speechToText.transcribe(
        { file: audioFile, model: 'saaras:v3', mode: 'transcribe' },
        { timeoutInSeconds: SARVAM_TIMEOUT_SECONDS },
      );
      const text = response?.transcript ?? response?.text;
      if (typeof text !== 'string' || text.trim() === '') {
        throw new Error('Sarvam AI returned empty transcript.');
      }
      console.log(`✅ REST transcription complete (${text.trim().split(' ').length} words).`);
      return text.trim();
    } catch (err) {
      lastErr = err;
      if (isRetryable(err) && attempt < MAX_REST_RETRIES) {
        const backoffMs = attempt * 3000;
        console.warn(`⚠️  REST attempt ${attempt}/${MAX_REST_RETRIES} failed: ${err.message}. Retrying in ${backoffMs / 1000}s...`);
        await sleep(backoffMs);
      } else {
        throw new Error(`Sarvam AI SDK error: ${err.message}`);
      }
    }
  }
  throw new Error(`Sarvam AI SDK error: ${lastErr.message}`);
}

// ─── Batch API path ───────────────────────────────────────────────────────────

async function transcribeViaBatch(client, filePath) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarvam-batch-'));

  try {
    // 1. Create the job
    const job = await client.speechToTextJob.createJob({
      model: 'saaras:v3',
      mode: 'transcribe',
    });
    console.log(`🗂️  Batch job created: ${job.jobId}`);

    // 2. Upload the file using streaming Axios with retry (bypasses Node fetch failures)
    console.log('⬆️  Uploading audio to Sarvam batch storage...');
    await uploadBatchFilesWithAxios(client, job.jobId, [filePath]);

    // 3. Start processing
    await job.start();
    console.log('🚀 Batch job started. Polling for completion...');

    // 4. Poll until done
    const finalStatus = await job.waitUntilComplete(
      BATCH_POLL_INTERVAL_SECONDS,
      BATCH_TIMEOUT_SECONDS,
    );
    console.log(`📊 Batch job status: ${finalStatus.status}`);

    // 5. Download outputs using Axios with retry
    await downloadBatchOutputsWithAxios(client, job.jobId, outputDir);

    // 6. Read and concatenate all transcript JSON files
    return readBatchOutputs(outputDir);

  } finally {
    // Cleanup temp output dir
    try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ─── Robust Axios-based Batch Upload & Download Helpers ───────────────────────

const axios = require('axios');

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
  };
  return mimeTypes[ext] || 'audio/wav';
}

async function uploadBatchFilesWithAxios(client, jobId, filePaths) {
  const fileNames = filePaths.map((p) => path.basename(p));
  const uploadLinksResponse = await client.speechToTextJob.getUploadLinks({
    job_id: jobId,
    files: fileNames,
  });

  for (const filePath of filePaths) {
    const fileName = path.basename(filePath);
    const fileUrl = uploadLinksResponse.upload_urls[fileName].file_url;
    const mimeType = getMimeType(filePath);
    const stats = fs.statSync(filePath);

    let uploaded = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`⬆️  Uploading ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB) - attempt ${attempt}/3...`);

        await axios.put(fileUrl, fs.createReadStream(filePath), {
          headers: {
            'x-ms-blob-type': 'BlockBlob',
            'Content-Type': mimeType,
            'Content-Length': stats.size,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 600000, // 10 minutes timeout for large file upload
        });

        console.log(`✅ Upload successful for ${fileName}`);
        uploaded = true;
        break;
      } catch (err) {
        lastError = err;
        console.warn(`⚠️  Upload failed for ${fileName} on attempt ${attempt}: ${err.message}`);
        await sleep(attempt * 3000);
      }
    }

    if (!uploaded) {
      throw new Error(`Upload failed for ${fileName}: ${lastError ? lastError.message : 'Unknown error'}`);
    }
  }
}

async function downloadBatchOutputsWithAxios(client, jobId, outputDir) {
  const jobStatus = await client.speechToTextJob.getStatus(jobId);
  const mappings = (jobStatus.job_details || [])
    .filter(detail => detail.inputs && detail.outputs && detail.inputs.length > 0 && detail.outputs.length > 0 && detail.state === "Success")
    .map(detail => ({
      input_file: detail.inputs[0].file_name,
      output_file: detail.outputs[0].file_name
    }));

  if (mappings.length === 0) {
    throw new Error('No successful output files found in batch job details.');
  }

  const fileNames = mappings.map((m) => m.output_file);
  const downloadLinksResponse = await client.speechToTextJob.getDownloadLinks({
    job_id: jobId,
    files: fileNames,
  });

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const mapping of mappings) {
    const url = downloadLinksResponse.download_urls[mapping.output_file].file_url;
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 180000 });
    const outputPath = path.join(outputDir, `${mapping.input_file}.json`);
    fs.writeFileSync(outputPath, Buffer.from(response.data));
  }
}

/**
 * Reads Sarvam batch output JSON files from outputDir and joins transcripts.
 * Sarvam writes one JSON file per input audio file, with a `transcript` field.
 */
function readBatchOutputs(outputDir) {
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    throw new Error('Sarvam Batch API completed but produced no output files.');
  }

  const segments = [];
  for (const file of files.sort()) {
    const raw = fs.readFileSync(path.join(outputDir, file), 'utf8');
    const data = JSON.parse(raw);

    // Batch API response shape: { transcript: string } or { segments: [{text}] }
    const text =
      data?.transcript ??
      data?.segments?.map(s => s.text ?? s.transcript ?? '').join(' ');

    if (typeof text === 'string' && text.trim()) {
      segments.push(text.trim());
    }
  }

  if (segments.length === 0) {
    throw new Error('Sarvam Batch API output files contained no transcript text.');
  }

  const fullTranscript = segments.join(' ');
  console.log(`✅ Batch transcription complete (${fullTranscript.split(' ').length} words).`);
  return fullTranscript;
}

// ─── Duration detection ───────────────────────────────────────────────────────

/**
 * Gets audio duration in seconds using music-metadata (pure JS, no native deps).
 * Falls back to Infinity (→ Batch path) if metadata cannot be read.
 */
async function getAudioDuration(filePath) {
  try {
    const metadata = await parseFile(filePath, { duration: true });
    const duration = metadata?.format?.duration;
    if (typeof duration === 'number' && isFinite(duration) && duration > 0) {
      return duration;
    }
    console.warn('⚠️  Could not read audio duration from metadata; defaulting to Batch API path.');
    return Infinity;
  } catch (err) {
    console.warn(`⚠️  music-metadata error: ${err.message}; defaulting to Batch API path.`);
    return Infinity;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRetryable(err) {
  return /timeout|ECONNRESET|ENOTFOUND|socket hang up/i.test(err.message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMockTranscript() {
  return `[Mock] Product Strategy Sync: Welcome everyone. In today's sync, Alice presented the Q3 roadmap for the Meeting Summarizer service. Bob raised a concern regarding audio files longer than 30 seconds, and Charlie confirmed that the Sarvam AI Batch API handles this effectively. Alice agreed to finalize the API docs by Friday, and Charlie will deploy the Docker container to production by Monday. Everyone agreed on prioritizing structured JSON responses for summary output.`;
}

module.exports = { transcribeAudio };
