


# 🎙️ Meeting Summarizer

A full-stack application that converts raw meeting recordings into accurate transcripts via **Sarvam AI STT** and generates structured executive summaries, key decisions, and action items via **Google Gemini AI (Gemini 3.6 Flash)**.

# Demo Video:

https://github.com/user-attachments/assets/f46a192b-ac1d-464b-aace-402d059a5ab6

## 📐 Architecture Diagram

```
[Next.js Frontend] ───(1) POST /api/meetings (Audio Upload)───> [Express API]
        │                                                            │
        │                                                   (2) Insert Row (status: processing)
        │                                                            │
        │                                                   (3) Async Pipeline Execution
        │                                                            ├──> [Sarvam AI ASR]  ──(4) Update transcript
        │                                                            └──> [Google Gemini] ──(5) Update summary JSON
        │                                                                                         │
        └──────────────(6) Poll GET /api/meetings/:id ────────────────────────────────────────────┘
                                                                                                   │
                                                                                        [PostgreSQL Database]
```

---

## 🛠️ Tech Stack & Trade-Offs

| Layer | Choice | Tradeoff / Rationale |
|---|---|---|
| **ASR** | Sarvam AI API (`saaras:v3`) | Single API call without self-hosting overhead; custom chunking logic handles files > 25MB. |
| **Summarization** | Google Gemini AI (`gemini-3.6-flash`) | High quality structured JSON extraction with automated fallback across Gemini 3 Flash models. |
| **Backend** | Node.js + Express | Lightweight, fast asynchronous handling for multi-part file uploads and API endpoints. |
| **Database** | PostgreSQL | Relational consistency for meetings metadata combined with `JSONB` flexibility for key decisions & action items. |
| **Frontend** | Next.js (App Router) | Modern React server & client components with interactive task checklist, owner avatars & glassmorphism UI. |

---

## 🚀 Quickstart & Setup

### Prerequisites
- Node.js (v18+)
- PostgreSQL database (local or hosted instance)

### 1. Environment Configuration

Copy `.env.example` in `backend/`:
```bash
cp backend/.env.example backend/.env
```
Fill in your API keys in `backend/.env`:
```env
PORT=5000
DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5432/meeting_summarizer
SARVAM_API_KEY=your_sarvam_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. Local Development Run

**Backend Server:**
```bash
cd backend
npm install
npm run dev
```

**Frontend App:**
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📡 API Documentation & Example Requests

### 1. Upload Meeting Audio
`POST /api/meetings`

Uploads an audio file (`.mp3`, `.wav`, `.m4a`) and kicks off async processing.

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/meetings \
  -F "audio=@/path/to/meeting.mp3"
```

**Response (202 Accepted):**
```json
{
  "meetingId": "8f3b2d10-e74a-4a2b-b912-3a5619d08401",
  "status": "processing",
  "message": "Meeting audio uploaded successfully. Processing pipeline started."
}
```

---

### 2. Fetch Meeting Details & Summary
`GET /api/meetings/:id`

Retrieves meeting status, speech-to-text transcript, structured summary, key decisions, and action items.

**cURL Example:**
```bash
curl http://localhost:5000/api/meetings/8f3b2d10-e74a-4a2b-b912-3a5619d08401
```

**Response (200 OK):**
```json
{
  "id": "8f3b2d10-e74a-4a2b-b912-3a5619d08401",
  "original_filename": "team-roadmap.mp3",
  "status": "summarized",
  "transcript": "Product Strategy Sync: Welcome everyone. In today's sync, Alice presented the Q3 roadmap...",
  "summary": "The team reviewed the Q3 roadmap for the Meeting Summarizer service. Key discussion topics included handling large audio files (>25MB) using Sarvam AI ASR chunking and enforcing structured JSON outputs from Gemini LLM.",
  "key_decisions": [
    "Approved Sarvam AI ASR audio chunking approach for files larger than 25MB.",
    "Standardised on Gemini 3.6 Flash for high-speed structured JSON summarization.",
    "Targeted public Docker container deployment by Monday."
  ],
  "action_items": [
    {
      "task": "Finalize meeting summarizer API documentation",
      "owner": "Alice",
      "due": "Friday"
    },
    {
      "task": "Deploy Docker container to production environment",
      "owner": "Charlie",
      "due": "Monday"
    }
  ],
  "error_message": null,
  "created_at": "2026-08-22T17:30:00.000Z",
  "updated_at": "2026-08-22T17:30:15.000Z"
}
```

---

### 3. Re-Summarize Transcript
`POST /api/meetings/:id/resummarize`

Re-executes the Google Gemini LLM stage on an existing transcript.

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/meetings/8f3b2d10-e74a-4a2b-b912-3a5619d08401/resummarize
```

**Response (200 OK):**
```json
{
  "meetingId": "8f3b2d10-e74a-4a2b-b912-3a5619d08401",
  "status": "transcribed",
  "message": "Re-summarization started."
}
```

---
