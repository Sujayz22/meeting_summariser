const fs = require('fs');
const db = require('../db/client');
const { transcribeAudio } = require('./asrService');
const { generateSummary } = require('./summaryService');

/**
 * Runs full async pipeline: ASR -> LLM -> DB Updates
 * Cleanly decoupled from express route request/response lifecycle.
 */
async function processMeetingPipeline(meetingId, filePath) {
  console.log(`🚀 Pipeline started for Meeting ID: ${meetingId}`);

  try {
    // ----------------------------------------------------
    // STAGE 1: ASR Transcription
    // ----------------------------------------------------
    console.log(`🎙️ [Stage 1/2] Transcribing audio for meeting ${meetingId}...`);
    const transcript = await transcribeAudio(filePath);
    
    await db.query(
      `UPDATE meetings 
       SET transcript = $1, status = $2, updated_at = now() 
       WHERE id = $3`,
      [transcript, 'transcribed', meetingId]
    );
    console.log(`✅ [Stage 1/2] Transcription complete for meeting ${meetingId}.`);

    // ----------------------------------------------------
    // STAGE 2: LLM Summarization
    // ----------------------------------------------------
    console.log(`🧠 [Stage 2/2] Generating summary & action items for meeting ${meetingId}...`);
    const summaryResult = await generateSummary(transcript);

    await db.query(
      `UPDATE meetings 
       SET summary = $1, key_decisions = $2::jsonb, action_items = $3::jsonb, status = $4, updated_at = now() 
       WHERE id = $5`,
      [
        summaryResult.summary,
        JSON.stringify(summaryResult.key_decisions),
        JSON.stringify(summaryResult.action_items),
        'summarized',
        meetingId
      ]
    );
    console.log(`🎉 [Stage 2/2] Pipeline successfully finished for meeting ${meetingId}!`);

  } catch (err) {
    console.error(`❌ Pipeline failed for meeting ${meetingId}:`, err.message);
    
    await db.query(
      `UPDATE meetings 
       SET error_message = $1, status = $2, updated_at = now() 
       WHERE id = $3`,
      [err.message, 'failed', meetingId]
    );

  } finally {
    // Cleanup temporary uploaded audio file
    if (filePath && fs.existsSync(filePath)) {
      try {
        await fs.promises.unlink(filePath);
        console.log(`🧹 Cleaned up temporary upload file: ${filePath}`);
      } catch (unlinkErr) {
        console.warn(`Could not delete file ${filePath}:`, unlinkErr.message);
      }
    }
  }
}

/**
 * Re-runs LLM summarization stage on an existing transcript.
 */
async function resummarizeMeeting(meetingId, transcript) {
  console.log(`🔄 Re-summarizing meeting ${meetingId}...`);
  
  await db.query(
    `UPDATE meetings SET status = $1, error_message = null, updated_at = now() WHERE id = $2`,
    ['transcribed', meetingId]
  );

  try {
    const summaryResult = await generateSummary(transcript);
    
    await db.query(
      `UPDATE meetings 
       SET summary = $1, key_decisions = $2::jsonb, action_items = $3::jsonb, status = $4, error_message = null, updated_at = now() 
       WHERE id = $5`,
      [
        summaryResult.summary,
        JSON.stringify(summaryResult.key_decisions),
        JSON.stringify(summaryResult.action_items),
        'summarized',
        meetingId
      ]
    );
    console.log(`✅ Re-summarization complete for meeting ${meetingId}.`);
    return summaryResult;

  } catch (err) {
    console.error(`❌ Re-summarization failed for meeting ${meetingId}:`, err.message);
    await db.query(
      `UPDATE meetings SET error_message = $1, status = $2, updated_at = now() WHERE id = $3`,
      [err.message, 'failed', meetingId]
    );
    throw err;
  }
}

module.exports = {
  processMeetingPipeline,
  resummarizeMeeting
};
