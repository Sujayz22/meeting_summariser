import './globals.css';

export const metadata = {
  title: 'Meeting Summarizer — AI Transcription & Structured Notes',
  description:
    'Upload your meeting audio and get an accurate transcript, executive summary, key decisions, and action items powered by Sarvam AI and GPT-4o-mini.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
