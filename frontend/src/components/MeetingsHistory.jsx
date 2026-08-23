'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  History, RefreshCw, ChevronRight, FileAudio,
  CheckCircle2, Clock, AlertTriangle, Loader2,
  Sparkles, FileText, ListChecks, CheckSquare,
  Search, X,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

const STATUS_CONFIG = {
  processing:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.2)',  icon: Loader2,       label: 'Transcribing',  pulse: true  },
  transcribed: { color: '#38bdf8', bg: 'rgba(56,189,248,0.1)',  border: 'rgba(56,189,248,0.2)',  icon: Loader2,       label: 'Summarising',   pulse: true  },
  summarized:  { color: '#10b981', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.2)',  icon: CheckCircle2,  label: 'Ready',         pulse: false },
  failed:      { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.2)',   icon: AlertTriangle, label: 'Failed',        pulse: false },
};

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60)    return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function truncate(str, max = 80) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function StatusIcon({ status, size = 13 }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.failed;
  const Icon = cfg.icon;
  return (
    <Icon
      size={size}
      style={{
        color: cfg.color,
        animation: cfg.pulse ? 'spin 1.5s linear infinite' : 'none',
        flexShrink: 0,
      }}
    />
  );
}

function MeetingRow({ meeting, isActive, onSelect }) {
  const cfg = STATUS_CONFIG[meeting.status] || STATUS_CONFIG.failed;
  const hasSummary = meeting.status === 'summarized';

  return (
    <div
      className="history-row"
      onClick={() => onSelect(meeting.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(meeting.id)}
      style={{
        '--row-color': cfg.color,
        '--row-bg': cfg.bg,
        '--row-border': isActive ? cfg.color : cfg.border,
        background: isActive ? cfg.bg : 'transparent',
      }}
    >
      {/* Left accent bar */}
      <div className="history-row-accent" style={{ background: cfg.color }} />

      {/* File icon */}
      <div className="history-row-icon" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
        <FileAudio size={14} style={{ color: cfg.color }} />
      </div>

      {/* Content */}
      <div className="history-row-content">
        <div className="history-row-filename">
          {meeting.original_filename || 'Untitled Recording'}
        </div>

        {/* Summary preview */}
        {meeting.summary && (
          <div className="history-row-preview">
            {truncate(meeting.summary, 75)}
          </div>
        )}

        {/* Stats row */}
        <div className="history-row-meta">
          <div className="history-status-badge" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}>
            <StatusIcon status={meeting.status} size={10} />
            {cfg.label}
          </div>

          {meeting.word_count > 0 && (
            <span className="history-stat">
              <FileText size={10} />
              {meeting.word_count.toLocaleString()}w
            </span>
          )}
          {meeting.key_decisions_count > 0 && (
            <span className="history-stat">
              <ListChecks size={10} />
              {meeting.key_decisions_count}
            </span>
          )}
          {meeting.action_items_count > 0 && (
            <span className="history-stat">
              <CheckSquare size={10} />
              {meeting.action_items_count}
            </span>
          )}

          <span className="history-time">{timeAgo(meeting.created_at)}</span>
        </div>
      </div>

      <ChevronRight size={14} className="history-row-chevron" style={{ color: isActive ? cfg.color : undefined }} />
    </div>
  );
}

export default function MeetingsHistory({ activeMeetingId, onSelect }) {
  const [meetings, setMeetings] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all'); // 'all' | 'summarized' | 'processing' | 'failed'

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${API_URL}/api/meetings`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const { meetings: list } = await res.json();

      // Enrich each meeting with stats we can derive from the list endpoint
      // (full details fetched lazily only when selected)
      setMeetings(list || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh on mount and whenever active meeting changes (e.g. just finished)
  useEffect(() => { load(); }, [load, activeMeetingId]);

  // Auto-refresh every 5s if any meeting is still in-progress
  useEffect(() => {
    const hasInProgress = meetings.some(m => m.status === 'processing' || m.status === 'transcribed');
    if (!hasInProgress) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [meetings, load]);

  const filtered = meetings.filter(m => {
    const matchStatus = filter === 'all' || m.status === filter;
    const matchSearch = !search || m.original_filename?.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const counts = {
    all: meetings.length,
    summarized: meetings.filter(m => m.status === 'summarized').length,
    processing: meetings.filter(m => m.status === 'processing' || m.status === 'transcribed').length,
    failed: meetings.filter(m => m.status === 'failed').length,
  };

  if (loading) {
    return (
      <div className="history-panel glass-card">
        <div className="history-panel-header">
          <div className="skeleton" style={{ height: 14, width: '50%' }} />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton" style={{ height: 72, marginBottom: 6, borderRadius: 10 }} />
        ))}
      </div>
    );
  }

  if (meetings.length === 0 && !error) return null;

  return (
    <div className="history-panel glass-card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* ─── Header ─── */}
      <div className="history-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <History size={15} style={{ color: 'var(--indigo)' }} />
          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            History
          </span>
          <span style={{ fontSize: '0.72rem', background: 'rgba(99,102,241,0.15)', color: 'var(--indigo)', borderRadius: 99, padding: '1px 7px', fontWeight: 700 }}>
            {counts.all}
          </span>
        </div>
        <button
          className="btn btn-ghost"
          onClick={load}
          title="Refresh"
          style={{ padding: '0.2rem 0.4rem' }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* ─── Search ─── */}
      <div className="history-search-wrap">
        <Search size={13} className="history-search-icon" />
        <input
          className="history-search"
          placeholder="Search recordings…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="history-search-clear" onClick={() => setSearch('')}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* ─── Filter tabs ─── */}
      <div className="history-filters">
        {[
          { key: 'all',       label: 'All',       count: counts.all },
          { key: 'summarized',label: 'Done',      count: counts.summarized },
          { key: 'processing',label: 'Active',    count: counts.processing },
          { key: 'failed',    label: 'Failed',    count: counts.failed },
        ].map(tab => (
          <button
            key={tab.key}
            className={`history-filter-tab ${filter === tab.key ? 'active' : ''}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="history-filter-count">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ─── Error state ─── */}
      {error && (
        <div style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--red)' }}>
          ⚠ Could not load — {error}
        </div>
      )}

      {/* ─── List ─── */}
      <div className="history-list">
        {filtered.length === 0 ? (
          <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {search ? `No results for "${search}"` : 'No meetings found.'}
          </div>
        ) : (
          filtered.map(m => (
            <MeetingRow
              key={m.id}
              meeting={m}
              isActive={m.id === activeMeetingId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>

      {/* ─── Powered-by footer ─── */}
      {meetings.length > 0 && (
        <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <Sparkles size={10} style={{ color: 'var(--indigo)' }} />
          Sarvam AI · Gemini {counts.summarized > 0 ? `· ${counts.summarized} processed` : ''}
        </div>
      )}
    </div>
  );
}
