# CodeArena — Live Coding Contest Platform

A full-stack, production-ready live coding contest platform for 500 concurrent college participants. Deployable 100% on free-tier infrastructure.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + TypeScript + Tailwind CSS → **Vercel** |
| Backend | Node.js + Express + TypeScript + Socket.io → **Render Free** |
| Database | TiDB Serverless (MySQL-compatible) via **Prisma** |
| Cache / Leaderboard | **Render Free Redis** (25MB) |
| Code Execution | **Piston API** (public, free, no key) |
| AI Grading | **Anthropic Claude Haiku** (async, non-blocking) |
| Auth | **Firebase Auth** (Google Sign-In, domain-restricted) |
| Job Queue | **BullMQ** (backed by same Redis instance) |

---

## Project Structure

```
contest-platform/
├── backend/              # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── config/       # firebase, redis, database, logger
│   │   ├── middleware/   # auth (Firebase token + domain check)
│   │   ├── routes/       # admin, problems, submissions, leaderboard, results
│   │   ├── services/     # contestState, leaderboard, problemAssigner, draftSaver, pistonRunner, aiGrader
│   │   ├── socket/       # Socket.io handlers
│   │   └── workers/      # BullMQ grading worker
│   └── prisma/           # Schema + migrations
├── frontend/             # React + Vite + Tailwind
│   └── src/
│       ├── config/       # Firebase client
│       ├── contexts/     # AuthContext, ContestContext
│       ├── hooks/        # useAntiCheat
│       ├── lib/          # api (axios), socket (Socket.io client)
│       └── pages/        # Login, HoldingScreen, ContestPage, AdminDashboard, Leaderboard, Results
├── scripts/              # One-time admin scripts
├── render.yaml           # Render deployment config
└── vercel.json           # Vercel deployment config
```

---

## Quick Setup

### Prerequisites
- Node.js 18+
- A [Firebase project](https://console.firebase.google.com) with Google Sign-In enabled
- A [TiDB Serverless](https://tidbcloud.com) cluster (free)
- A [Render account](https://render.com) (free)
- A [Vercel account](https://vercel.com) (free)
- An [Anthropic API key](https://console.anthropic.com) (for AI grading)

### 1. Clone and install

```bash
# Backend
cd backend
npm install
npx prisma generate

# Frontend
cd ../frontend
npm install
```

### 2. Configure environment

```bash
# Backend
cp backend/.env.example backend/.env
# Fill in: FIREBASE_*, DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY, COLLEGE_EMAIL_DOMAIN

# Frontend
cp frontend/.env.example frontend/.env
# Fill in: VITE_FIREBASE_*, VITE_COLLEGE_EMAIL_DOMAIN, VITE_BACKEND_URL
```

### 3. Initialize database

```bash
cd backend
npx prisma db push   # Creates tables in TiDB Serverless
```

### 4. Set admin claim (one-time, before contest)

```bash
cd scripts
node setAdminClaim.js dean@college.edu
# The admin must sign out and sign in again for the claim to take effect
```

### 5. Run locally

```bash
# Terminal 1 — Backend
cd backend
npm run dev

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Open http://localhost:5173

---

## Deployment

### Backend → Render

1. Connect your Git repo to Render
2. Render will detect `render.yaml` and create the services automatically
3. In Render dashboard, set all `sync: false` env vars manually:
   - `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`
   - `DATABASE_URL` (TiDB Serverless connection string with SSL)
   - `ANTHROPIC_API_KEY`
   - `COLLEGE_EMAIL_DOMAIN`, `FRONTEND_URL`

### Frontend → Vercel

1. Connect your Git repo to Vercel
2. Set build settings:
   - **Framework**: Vite
   - **Build Command**: `cd frontend && npm run build`
   - **Output Directory**: `frontend/dist`
3. Add environment variables in Vercel dashboard:
   - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
   - `VITE_COLLEGE_EMAIL_DOMAIN`, `VITE_BACKEND_URL` (your Render backend URL)

### TiDB Serverless SSL Setup

TiDB Serverless requires SSL. Use this connection string format:
```
mysql://user:password@gateway.host.tidbcloud.com:4000/dbname?ssl={"rejectUnauthorized":true}
```

---

## Pre-Event Checklist

- [ ] Run `npx prisma db push` to create tables
- [ ] Set admin claim for the Dean's Google account
- [ ] Add problems to the admin dashboard
- [ ] Set up **UptimeRobot** to ping `https://your-backend.onrender.com/health` every 10 minutes (prevent Render cold start)
- [ ] Do a dry run with 5-10 test accounts
- [ ] Run a load test: `npx artillery run load-test.yml` (optional but recommended)

---

## Contest Flow

```
WAITING  →  Admin presses Start  →  RUNNING  →  Timer expires / Stop  →  ENDED
                                        ↕
                                      PAUSED
```

- **WAITING**: Students see holding screen with live connection count. No problem content sent.
- **RUNNING**: Server assigns first problem to every connected student simultaneously. Monaco editor unlocks.
- **PAUSED**: Editor locks with overlay. Server freezes timers (remaining time stored, not computed).
- **ENDED**: Results screen, leaderboard, post-contest export.

---

## AP Formula

```
AP = (base_points × test_pass_ratio + ai_score × ai_weight × base_points) × speed_multiplier

speed_multiplier = max(0.5, 1 - time_taken / max_time)

base_points: EASY=100, MEDIUM=200, HARD=350 (configurable via env)
ai_weight: 0.3 (configurable via env)
```

---

## Anti-Cheat Escalation

| Violation Count | Action |
|----------------|--------|
| 1st | Warning toast |
| 2nd | −10 AP penalty |
| 3rd | Auto-submit + account locked |

All events timestamped and visible in admin dashboard. Students are notified at login that monitoring is active.

---

## Important Free-Tier Limits

| Service | Limit | Mitigation |
|---------|-------|-----------|
| Render RAM | 512MB | Keep payloads small; never send full problem bank |
| Render Redis | 25MB | Hot state only (leaderboard, drafts, session); flush old data |
| Piston API | ~5 req/sec | BullMQ concurrency=3, limiter max=5/sec |
| TiDB Serverless | RU budget | Hot data in Redis; batch writes; draft flush every 60s |
| Firebase Auth | Free | Generous free tier, no concerns at 500 users |
