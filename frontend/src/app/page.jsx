'use client';

import { useState } from 'react';
import UploadCard from '../components/UploadCard';
import MeetingDetails from '../components/MeetingDetails';
import MeetingsHistory from '../components/MeetingsHistory';

export default function Home() {
  const [activeMeetingId, setActiveMeetingId] = useState(null);

  return (
    <main className="app-shell">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-logo" aria-hidden="true">🎙️</div>
        <h1>Meeting Summarizer</h1>
        <p className="header-sub">
          Upload a recording — get a transcript, executive summary, key decisions &amp; action items in seconds.
        </p>
      </header>

      {!activeMeetingId ? (
        /* Centered upload container */
        <div style={{ maxWidth: '680px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <UploadCard onUploadSuccess={(id) => setActiveMeetingId(id)} />
          <MeetingsHistory
            activeMeetingId={activeMeetingId}
            onSelect={(id) => setActiveMeetingId(id)}
          />
        </div>
      ) : (
        /* Two-column view when viewing results */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 280px',
            gap: '1.5rem',
            alignItems: 'start',
          }}
          className="main-grid"
        >
          <div>
            <MeetingDetails
              meetingId={activeMeetingId}
              onNewUpload={() => setActiveMeetingId(null)}
            />
          </div>

          <aside>
            <MeetingsHistory
              activeMeetingId={activeMeetingId}
              onSelect={(id) => setActiveMeetingId(id)}
            />
          </aside>
        </div>
      )}

      <style jsx global>{`
        @media (max-width: 768px) {
          .main-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
