# LCARS API — Claude Code Context
## LCARS ESPINOSA COMMAND v3 — Backend

This is the Node.js/Express backend for Luis Espinosa's personal LCARS command interface.
Deployed on Render. Auto-deploys on every `git push` to main.

---

## Repo & Deploy

- **GitHub**: `lespinosa-debug/lcars-api`
- **Live URL**: `https://lcars-api.onrender.com`
- **Platform**: Render (free tier — cold starts after inactivity)
- **Runtime**: Node.js / Express

### Standard deploy command
```bash
cd ~/lcars-api && npm install && git add -A && git commit -m "<message>" && git push
```

---

## Project Structure

```
lcars-api/
├── server.js        ← main Express app, all routes, store, Twilio, Claude AI
├── checkin.js       ← scheduled check-in cron module (morning/afternoon/evening/weekly)
├── store.json       ← persistent JSON store (nuggets, tasks, events, briefings)
├── package.json
└── CLAUDE.md        ← you are here
```

---

## Key Architecture

### Persistent Store (`store.json`)
- In-memory `store` object synced to `store.json` on every write
- Survives Render restarts
- Shape: `{ nuggets: [], tasks: [], events: [], lastBriefing: '', lastBriefingTime: '' }`
- `saveStore()` writes to disk — always call this after mutating store

### SMS (Twilio)
- A2P 10DLC campaign submitted, pending carrier vetting
- Twilio client initialized with `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`
- SMS TO: `+19545399989` (Luis's number, env var `TWILIO_TO`)
- SMS FROM: env var `TWILIO_FROM`

### Email (Nodemailer / Gmail)
- Sends FROM: `luislre@gmail.com` (env var `GMAIL_USER`)
- Sends TO: `lespinosa@frostflorida.com` (env var `CHECKIN_EMAIL`)
- Auth: Gmail App Password (env var `GMAIL_PASS`)

### Claude AI Integration
- Uses Anthropic API for SMS command responses (`/help`, `/nugget`, free chat)
- SMS conversation memory stored in `store.conversationHistory`

### Wake Ping
- Frontend pings `/api/ping` on load to wake Render from cold start
- Calendar fetch retries if API is cold

---

## API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/ping` | Wake ping / health check |
| GET | `/api/store` | Return full store JSON |
| POST | `/api/store` | Update store (nuggets, tasks) |
| GET | `/api/calendar` | Proxy iCal URLs, returns parsed events |
| POST | `/api/sms` | Twilio webhook — incoming SMS handler |
| GET | `/api/briefing` | Return latest AI briefing text |
| GET | `/api/checkin/:type` | Manual trigger: morning/afternoon/evening/weekly |

---

## Check-in Schedule (`checkin.js`)

| Time | Briefing | Channels |
|------|----------|---------|
| 8:15 AM ET daily | ☀️ Morning | LCARS store + SMS + Email |
| 2:00 PM ET daily | 🔆 Afternoon | LCARS store + SMS + Email |
| 6:00 PM ET daily | 🌆 Evening Wrap | LCARS store + SMS + Email |
| Sunday 7:00 PM ET | 🖖 Weekly | LCARS store + SMS + Email |

To fire manually (for testing):
```
https://lcars-api.onrender.com/api/checkin/morning
https://lcars-api.onrender.com/api/checkin/afternoon
https://lcars-api.onrender.com/api/checkin/evening
https://lcars-api.onrender.com/api/checkin/weekly
```

---

## Environment Variables (set in Render dashboard)

| Var | Value | Purpose |
|-----|-------|---------|
| `TWILIO_ACCOUNT_SID` | from Twilio console | SMS auth |
| `TWILIO_AUTH_TOKEN` | from Twilio console | SMS auth |
| `TWILIO_FROM` | Twilio phone number | SMS sender |
| `TWILIO_TO` | `+19545399989` | SMS recipient (Luis) |
| `ANTHROPIC_API_KEY` | from Anthropic console | Claude AI |
| `GMAIL_USER` | `luislre@gmail.com` | Email sender |
| `GMAIL_PASS` | 16-char App Password | Gmail auth |
| `CHECKIN_EMAIL` | `lespinosa@frostflorida.com` | Email recipient |
| `LCARS_API_URL` | `https://lcars-api.onrender.com` | Self-reference for calendar fetch |

---

## Calendar Feed URLs

```
Index 0 — Orange — FROST WORK:
https://calendar.google.com/calendar/ical/lespinosa%40frostflorida.com/private-1bb59553e99af6e8fc4f4d2074182626/basic.ics

Index 1 — Red — LCARS:
webcal://p135-caldav.icloud.com/published/2/MTAzNTE5Mzk4NDIxMDM1MRH7oMYq2vnBm9PGGEMy-6_OjOARgb-NBp5vXUkh4D1m

Indices 2–5: reserved, currently commented out in index.html
```

---

## Key Rules

- Always call `saveStore(store)` after mutating store data
- Never hardcode phone numbers or API keys — always use env vars
- Render cold starts take ~30s — the wake ping handles this
- `webcal://` URLs need to be converted to `https://` for server-side fetch
- Commit messages should be brief and descriptive — no "update" without context
- When adding new routes, document them in this file
