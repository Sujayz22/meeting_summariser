const fs = require('fs');
const path = require('path');

/**
 * Validates audio file extension.
 * Duration-based routing (REST vs Batch API) is handled in asrService.js.
 */
function validateAudioFile(file) {
  if (!file) {
    throw new Error('No audio file provided');
  }

  const allowedExtensions = ['.mp3', '.wav', '.m4a', '.mp4', '.aac', '.ogg', '.flac'];
  const ext = path.extname(file.originalname || file.filename || '').toLowerCase();

  if (ext && !allowedExtensions.includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Supported types: ${allowedExtensions.join(', ')}`);
  }

  return { valid: true, size: file.size };
}

module.exports = {
  validateAudioFile,
};
