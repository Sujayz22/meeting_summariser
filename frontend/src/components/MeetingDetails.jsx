'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, Clock, AlertTriangle,
  FileText, CheckSquare, ListChecks, Copy, Check,
  ChevronDown, ChevronUp, Plus, Calendar, Square, User
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
const POLL_INTERVAL_MS = 2500;
const TERMINAL_STATUSES = new Set(['summarized', 'failed']);

/* ── Helper utilities for Action Items ─────────────────────────────────── */
function getOwnerInitials(name) {
  if (!name || name.toLowerCase() === 'unassigned') return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function isUrgentDue(dueStr) {
  if (!dueStr) return false;
  const s = dueStr.toLowerCase();
  return s.includes('immediate') || s.includes('today') || s.includes('asap') || s.includes('urgent');
}

/* ── Pipeline step indicator ──────────────────────────────────────────── */
function PipelineSteps({ status }) {
  const steps = [
    { id: 'upload',    label: 'Uploaded'  },
    { id: 'asr',       label: 'Transcript'},
    { id: 'llm',       label: 'Summary'   },
    { id: 'done',      label: 'Complete'  },
  ];

  function stepState(id) {
    const order = { upload: 0, asr: 1, llm: 2, done: 3 };
    const current = {
      processing:  1,
      transcribed: 2,
      summarized:  3,
      failed:      -1,
    }[status] ?? 0;

    const idx = order[id];
    if (current === -1) return 'idle';
    if (idx < current)  return 'done';
    if (idx === current) return 'active';
    return 'idle';
  }

  return (
    <div className="pipeline-steps" role="list" aria-label="Processing stages">
      {steps.map((s) => {
        const state = stepState(s.id);
        return (
          <div key={s.id} className={`step step-${state}`} role="listitem">
            <div className="step-dot">
              {state === 'done' ? <Check size={12} /> : steps.indexOf(s) + 1}
            </div>
            <span className="step-label">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Skeleton card ────────────────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="glass-card fade-in">
      <div className="skeleton" style={{ height: '14px', width: '40%', marginBottom: '12px' }} />
      <div className="skeleton" style={{ height: '10px', width: '90%', marginBottom: '8px' }} />
      <div className="skeleton" style={{ height: '10px', width: '75%', marginBottom: '8px' }} />
      <div className="skeleton" style={{ height: '10px', width: '55%' }} />
    </div>
  );
}

/* ── Copy button ──────────────────────────────────────────────────────── */
function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);

  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <button className="btn btn-ghost copy-btn" onClick={copy} title={label} style={{ padding: '0.3rem 0.5rem' }}>
      {copied ? <Check size={14} style={{ color: 'var(--emerald)' }} /> : <Copy size={14} />}
    </button>
  );
}

/* ── Status badge ─────────────────────────────────────────────────────── */
function StatusBadge({ status }) {
  switch (status) {
    case 'processing':
      return <span className="badge badge-processing pulsing"><Clock size={12} /> Transcribing</span>;
    case 'transcribed':
      return <span className="badge badge-transcribed pulsing"><Clock size={12} /> Summarising</span>;
    case 'summarized':
      return <span className="badge badge-summarized"><CheckCircle2 size={12} /> Ready</span>;
    case 'failed':
      return <span className="badge badge-failed"><AlertTriangle size={12} /> Failed</span>;
    default:
      return <span className="badge">{status}</span>;
  }
}

/* ── Main component ───────────────────────────────────────────────────── */
export default function MeetingDetails({ meetingId, onNewUpload }) {
  const [meeting,          setMeeting]          = useState(null);
  const [loading,          setLoading]          = useState(true);
  const [fetchError,       setFetchError]       = useState(null);
  const [fetchErrorStatus, setFetchErrorStatus] = useState(null);
  const [resummarising,    setResummarising]    = useState(false);
  const [transcriptOpen,   setTranscriptOpen]   = useState(false);
  const [completedTasks,   setCompletedTasks]   = useState(new Set());
  const pollingRef = useRef(null);

  const toggleTask = (index) => {
    setCompletedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const fetchMeeting = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/meetings/${meetingId}`);
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const d = await res.json();
          if (d.error) msg = d.error;
        } catch {}
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      setMeeting(data);
      setFetchError(null);
      setFetchErrorStatus(null);
      return data;
    } catch (err) {
      setFetchError(err.message);
      setFetchErrorStatus(err.status || null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  /* Start polling; stop when terminal status reached or if fetch fails */
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const data = await fetchMeeting();
      if (cancelled) return;
      if (!data || TERMINAL_STATUSES.has(data.status)) return; // stop polling on error or terminal state
      pollingRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();

    return () => {
      cancelled = true;
      clearTimeout(pollingRef.current);
    };
  }, [fetchMeeting]);

  const handleResummarise = async () => {
    setResummarising(true);
    try {
      const res = await fetch(`${API_URL}/api/meetings/${meetingId}/resummarize`, { method: 'POST' });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Re-summarisation failed.');
      }
      // Restart polling
      setMeeting((m) => m ? { ...m, status: 'processing' } : m);
      clearTimeout(pollingRef.current);
      const tick = async () => {
        const data = await fetchMeeting();
        if (data && !TERMINAL_STATUSES.has(data.status)) {
          pollingRef.current = setTimeout(tick, POLL_INTERVAL_MS);
        }
      };
      pollingRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    } catch (err) {
      alert(err.message);
    } finally {
      setResummarising(false);
    }
  };

  /* ─── Render: initial load ─── */
  if (loading) {
    return (
      <div className="fade-in">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  /* ─── Render: fetch error ─── */
  if (fetchError && !meeting) {
    const is404 = fetchErrorStatus === 404;
    return (
      <div className="glass-card fade-in">
        <div className="error-banner" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={18} style={{ color: 'var(--amber)', flexShrink: 0 }} />
            <strong style={{ fontSize: '1rem' }}>
              {is404 ? 'Meeting Not Found (404)' : 'Error Loading Meeting'}
            </strong>
          </div>
          <p style={{ margin: 0, fontSize: '0.88rem', color: '#cbd5e1' }}>
            {is404
              ? `Meeting "${meetingId}" was not found. If the backend was recently restarted without a persistent database, previous temporary session data may no longer exist.`
              : `Could not load meeting (${fetchError}). Please verify that the backend API server is running.`}
          </p>
        </div>
        <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-primary" onClick={onNewUpload}>
            <Plus size={14} /> Upload New Recording
          </button>
          {!is404 && (
            <button className="btn btn-secondary" onClick={() => { setLoading(true); fetchMeeting(); }}>
              <RefreshCw size={14} /> Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const isInProgress = !TERMINAL_STATUSES.has(meeting.status);

  return (
    <div>
      {/* ── Header card ── */}
      <div className="glass-card fade-in">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px', fontFamily: 'monospace' }}>
              {meeting.id}
            </p>
            <h2 style={{ fontSize: '1.3rem', fontWeight: '700', letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meeting.original_filename}
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Uploaded {new Date(meeting.created_at).toLocaleString()}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
            <StatusBadge status={meeting.status} />
            <button className="btn btn-secondary" onClick={onNewUpload} id="new-upload-btn">
              <Plus size={14} /> New
            </button>
          </div>
        </div>

        {/* Pipeline steps */}
        <div style={{ marginTop: '1.25rem' }}>
          <PipelineSteps status={meeting.status} />
        </div>

        {/* Pipeline progress bar while in flight */}
        {isInProgress && (
          <div style={{ marginTop: '1rem' }}>
            <div className="progress-track">
              <div className="progress-fill indeterminate" />
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '6px', textAlign: 'center' }}>
              {meeting.status === 'processing' ? 'Transcribing audio via Sarvam AI…' : 'Generating structured summary via Gemini…'}
            </p>
          </div>
        )}

        {/* Error message with Retry button */}
        {meeting.error_message && (
          <div className="error-banner" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Pipeline error:</strong><br />
                {meeting.error_message}
              </div>
            </div>

            {meeting.transcript && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(239,68,68,0.2)', paddingTop: '0.6rem', marginTop: '0.2rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#fca5a5' }}>
                  Raw transcript is saved ({meeting.transcript.trim().split(/\s+/).length} words). You can retry summarization without re-transcribing.
                </span>
                <button
                  className="btn btn-primary"
                  onClick={handleResummarise}
                  disabled={resummarising}
                  style={{ fontSize: '0.82rem', padding: '0.4rem 0.9rem', flexShrink: 0 }}
                >
                  <RefreshCw size={13} className={resummarising ? 'pulsing' : ''} />
                  {resummarising ? 'Retrying…' : 'Retry Summarization'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Results (summarized only) ── */}
      {meeting.status === 'summarized' && (
        <>
          {/* Executive Summary */}
          <div className="glass-card fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="section-title" style={{ color: '#a5b4fc', marginBottom: 0 }}>
                <FileText size={18} /> Executive Summary
              </h3>
              <CopyButton text={meeting.summary} label="Copy summary" />
            </div>
            <hr className="divider" />
            <p style={{ color: '#cbd5e1', lineHeight: '1.75', fontSize: '0.95rem' }}>
              {meeting.summary}
            </p>
          </div>

          {/* Key Decisions */}
          <div className="glass-card fade-in">
            <h3 className="section-title" style={{ color: 'var(--emerald)' }}>
              <ListChecks size={18} /> Key Decisions
              <span style={{ marginLeft: 'auto', fontSize: '0.78rem', fontWeight: '500', color: 'var(--text-muted)' }}>
                {meeting.key_decisions.length} item{meeting.key_decisions.length !== 1 ? 's' : ''}
              </span>
            </h3>
            {meeting.key_decisions.length > 0 ? (
              <ul className="decisions-list">
                {meeting.key_decisions.map((dec, i) => (
                  <li key={i}>{dec}</li>
                ))}
              </ul>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No explicit decisions found.</p>
            )}
          </div>

          {/* Action Items */}
          <div className="glass-card fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <h3 className="section-title" style={{ color: '#f472b6', marginBottom: 0 }}>
                <CheckSquare size={18} /> Action Items
                <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', fontWeight: '500', color: 'var(--text-muted)' }}>
                  {meeting.action_items.length} item{meeting.action_items.length !== 1 ? 's' : ''}
                </span>
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {meeting.action_items.length > 0 && (
                  <CopyButton
                    text={meeting.action_items.map(item => `• ${item.task} (Owner: ${item.owner}, Due: ${item.due})`).join('\n')}
                    label="Copy action items"
                  />
                )}
                <button
                  id="resummarise-btn"
                  className="btn btn-ghost"
                  onClick={handleResummarise}
                  disabled={resummarising}
                  title="Re-run LLM summarisation"
                >
                  <RefreshCw size={14} className={resummarising ? 'pulsing' : ''} />
                  {resummarising ? 'Re-summarising…' : 'Re-summarise'}
                </button>
              </div>
            </div>
            <hr className="divider" style={{ margin: '0.75rem 0 1rem' }} />
            {meeting.action_items.length > 0 ? (
              <div className="action-items-list" id="action-items-list">
                {meeting.action_items.map((item, i) => {
                  const isDone = completedTasks.has(i);
                  const isUnassigned = !item.owner || item.owner.toLowerCase() === 'unassigned';
                  const isUnspecifiedDue = !item.due || item.due.toLowerCase() === 'unspecified';
                  const urgent = isUrgentDue(item.due);

                  return (
                    <div key={i} className={`action-item-card ${isDone ? 'completed' : ''}`}>
                      <div className="action-item-left">
                        <button
                          className={`action-checkbox-btn ${isDone ? 'checked' : ''}`}
                          onClick={() => toggleTask(i)}
                          title={isDone ? 'Mark as incomplete' : 'Mark as completed'}
                          aria-label={`Toggle task: ${item.task}`}
                        >
                          {isDone ? <CheckCircle2 size={19} /> : <Square size={19} />}
                        </button>
                        <span className="action-task-text">{item.task}</span>
                      </div>
                      <div className="action-item-meta">
                        <span className={`owner-badge ${isUnassigned ? 'unassigned' : ''}`} title={`Owner: ${item.owner}`}>
                          <span className={`owner-avatar ${isUnassigned ? 'unassigned' : ''}`}>
                            {getOwnerInitials(item.owner)}
                          </span>
                          <span>{isUnassigned ? 'Unassigned' : item.owner}</span>
                        </span>

                        <span
                          className={`due-badge ${isUnspecifiedDue ? 'unspecified' : urgent ? 'urgent' : ''}`}
                          title={`Due date: ${item.due}`}
                        >
                          <Calendar size={13} />
                          <span>{isUnspecifiedDue ? 'No due date' : item.due}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No action items found.</p>
            )}
          </div>
        </>
      )}

      {/* ── Transcript accordion (shown once available) ── */}
      {meeting.transcript && (
        <div className="glass-card fade-in">
          <button
            className="btn btn-ghost"
            style={{ width: '100%', justifyContent: 'space-between', padding: '0' }}
            onClick={() => setTranscriptOpen((o) => !o)}
            id="transcript-toggle-btn"
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '600', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              📜 Raw Transcript
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                ({meeting.transcript.split(' ').length} words)
              </span>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              {transcriptOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </span>
          </button>

          {transcriptOpen && (
            <div style={{ position: 'relative', marginTop: '0.5rem' }}>
              <div style={{ position: 'absolute', top: '8px', right: '8px' }}>
                <CopyButton text={meeting.transcript} label="Copy transcript" />
              </div>
              <div className="transcript-body">{meeting.transcript}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
