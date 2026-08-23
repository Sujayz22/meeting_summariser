'use client';

import { useState, useRef, useCallback } from 'react';
import { UploadCloud, FileAudio, AlertCircle, X } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
const MAX_DISPLAY_MB = 100;

export default function UploadCard({ onUploadSuccess }) {
  const [file, setFile]             = useState(null);
  const [dragOver, setDragOver]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [progress, setProgress]     = useState(0);   // 0–100
  const [error, setError]           = useState(null);
  const inputRef                    = useRef(null);

  /* ── drag helpers ── */
  const onDragOver  = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = ()  => setDragOver(false);
  const onDrop      = (e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) acceptFile(dropped);
  };

  const acceptFile = useCallback((f) => {
    setError(null);
    if (f.size > MAX_DISPLAY_MB * 1024 * 1024) {
      setError(`File is ${(f.size / 1024 / 1024).toFixed(1)} MB. Maximum is ${MAX_DISPLAY_MB} MB.`);
      return;
    }
    setFile(f);
  }, []);

  const handleInputChange = (e) => {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
    // reset input so same file can be re-selected
    e.target.value = '';
  };

  const clearFile = (e) => {
    e.stopPropagation();
    setFile(null);
    setError(null);
    setProgress(0);
  };

  const handleUpload = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    setProgress(0);

    const formData = new FormData();
    formData.append('audio', file);

    try {
      // Use XMLHttpRequest for real upload progress
      const meetingId = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 90)); // 90% = upload done
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 202 || xhr.status === 200) {
            setProgress(100);
            const data = JSON.parse(xhr.responseText);
            resolve(data.meetingId);
          } else {
            let msg = 'Upload failed.';
            try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
            reject(new Error(msg));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error — is the backend running?')));
        xhr.addEventListener('timeout', () => reject(new Error('Upload timed out. Try a smaller file.')));

        xhr.open('POST', `${API_URL}/api/meetings`);
        xhr.timeout = 5 * 60 * 1000; // 5 min
        xhr.send(formData);
      });

      onUploadSuccess(meetingId);

    } catch (err) {
      setError(err.message);
      setProgress(0);
    } finally {
      setUploading(false);
    }
  };

  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(2) : '0';
  const needsChunking = file && file.size > 25 * 1024 * 1024;

  return (
    <div className="glass-card fade-in">
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: '1.25rem', position: 'relative' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', letterSpacing: '-0.01em' }}>
          Upload Meeting Recording
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Select an audio file from your device to begin AI processing
        </p>
        {file && !uploading && (
          <button 
            className="btn btn-ghost" 
            onClick={clearFile} 
            title="Clear selection"
            style={{ position: 'absolute', right: 0, top: 0 }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Drop zone */}
      <label
        className={`dropzone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        htmlFor="audio-input"
        style={{ display: 'block' }}
      >
        <input
          id="audio-input"
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg"
          onChange={handleInputChange}
          style={{ display: 'none' }}
          disabled={uploading}
        />

        <UploadCloud className="dropzone-icon" />

        {file ? (
          <div>
            <p style={{ fontWeight: '600', color: '#a5b4fc', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <FileAudio size={18} />
              {file.name}
            </p>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {fileSizeMB} MB
              {needsChunking && (
                <span style={{ marginLeft: '8px', color: 'var(--amber)', fontSize: '0.78rem' }}>
                  ⚡ File &gt;25 MB — will be chunked automatically
                </span>
              )}
            </p>
          </div>
        ) : (
          <div>
            <p style={{ fontWeight: '600', fontSize: '0.95rem' }}>
              {dragOver ? 'Drop it here!' : 'Drag & drop or click to browse'}
            </p>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
              MP3, WAV, M4A, AAC, FLAC · Up to 100 MB
            </p>
          </div>
        )}
      </label>

      {/* Progress bar */}
      {(uploading || progress > 0) && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
            <span>{progress < 100 ? 'Uploading…' : 'Upload complete — pipeline starting…'}</span>
            <span>{progress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="error-banner" style={{ marginTop: '1rem' }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>{error}</span>
        </div>
      )}

      {/* Upload button */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem' }}>
        <button
          id="upload-submit-btn"
          className="btn btn-primary"
          onClick={handleUpload}
          disabled={!file || uploading}
          style={{ minWidth: '200px', padding: '0.8rem 2rem', fontSize: '0.95rem' }}
        >
          {uploading ? (
            <>
              <span className="pulsing">●</span>
              Processing…
            </>
          ) : (
            <>
              <UploadCloud size={16} />
              Analyse Meeting
            </>
          )}
        </button>
      </div>
    </div>
  );
}
