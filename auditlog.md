# ⚔️ War Room — Audit Log

> Lịch sử thay đổi và quyết định kỹ thuật.

---

## 2026-05-17 — Initial Build (Power Block #1)

### Scope
Full build từ zero → working chat app (local dev verified).

### Changes Made

#### Phase 1: Project Scaffold
- Created `warroom/` project with Cloudflare Workers structure
- `wrangler.toml` — Worker entry (`src/index.js`) + static assets (`/public`)
- `package.json` — Single dependency: `wrangler@^4.68.0`
- `.dev.vars` — Local secrets template (git-ignored)
- `.gitignore` — node_modules, .dev.vars, .wrangler

#### Phase 2: Backend Core
| File | Purpose | Key Decisions |
|------|---------|---------------|
| `src/prompts.js` | System prompt | Vietnamese tone, JSON-only output, 6 intents |
| `src/minimax.js` | AI client | Direct MiniMax API (not 9Router), strips `<think>` tags |
| `src/notion.js` | Notion CRUD | Adapted for existing "Today" DB schema |
| `src/auth.js` | Password gate | Cookie-based, 30-day TTL, simple hash (not crypto) |
| `src/triage.js` | Orchestration | AI parse → Notion action → formatted response |
| `src/index.js` | Worker entry | Routes: /api/auth, /api/chat, /api/health |

#### Phase 3: Frontend
| File | Purpose | Key Decisions |
|------|---------|---------------|
| `public/index.html` | SPA chat UI | Password gate + chat screen, 4 quick action buttons |
| `public/style.css` | Dark theme | CSS custom properties, Inter + JetBrains Mono, purple accent |
| `public/app.js` | Frontend JS | Auth flow, chat messaging, auto-resize textarea, clock |

### Technical Decisions

#### D1: MiniMax API — Direct vs 9Router
- **Decision:** Use direct MiniMax API (`api.minimaxi.chat`)
- **Reason:** 9Router key (`sk-9c052d4b...`) returned "No active credentials for provider: openai" for MiniMax-M2.7. Direct MiniMax key works.
- **Impact:** Need to strip `<think>...</think>` reasoning tags from MiniMax M2.7 responses.

#### D2: Notion DB — New vs Reuse
- **Decision:** Reuse existing "Today" database
- **Reason:** User already has active tasks in this DB, avoid data migration
- **Impact:** 
  - Added 6 new properties via Notion API: Urgency, Energy, Estimate, Block, Source, Assigned By
  - Added project options to Context: GMA, HOSEL, SALES, EMPULSE, KV, EDU, TEACH, LEARN, PERSONAL
  - Code adapted for existing property names (Name→title, Context→project, State→status, Deadline→due date)
  - No "Dropped" status — both done and drop map to "Completed"

#### D3: Auth — Simple Password Gate
- **Decision:** Cookie-based password with simple hash
- **Reason:** Personal tool, single user. Full auth (OAuth, JWT) overkill for MVP.
- **Risk:** Not crypto-grade. Acceptable for personal use behind Cloudflare.

#### D4: No Chat History Persistence
- **Decision:** Messages are ephemeral (lost on refresh)
- **Reason:** Notion is the source of truth. Chat is just input interface.
- **Future:** Could add KV or D1 for chat history in Phase 2.

### Verification Results

| Test | Result | Notes |
|------|--------|-------|
| `wrangler dev` starts | ✅ Pass | Port 8787 |
| Login with password | ✅ Pass | Cookie set, 200 OK |
| Login with wrong password | ✅ Pass | 401, error message |
| Health check | ✅ Pass | Returns version + timestamp |
| Unauthenticated chat | ✅ Pass | 401 blocked |
| CAPTURE intent | ✅ Pass | AI parsed task, asked follow-up |
| TRIAGE intent | ✅ Pass | Queried 10 tasks from Notion, showed Top 3 |
| CLARIFY intent | ✅ Pass | AI asked for clarification |

### Environment
- macOS, Node.js v22.19.0, npm 11.6.2, wrangler 4.92.0
- MiniMax-M2.7 (direct API)
- Notion API v2022-06-28

---

## 2026-05-17 (Evening) — Security + Telegram + Cron (v1.1)

### Scope
Add 3-layer security, Telegram bot integration, auto-reminder cron triggers, deploy to production.

### Changes Made

| File | Change | Impact |
|------|--------|--------|
| `src/prompts.js` | Added SECURITY section to system prompt | AI refuses to reveal API keys/configs |
| `src/index.js` | `sanitizeResponse()` + `sanitizeError()` | Server-side redaction of all secrets from responses |
| `src/index.js` | Added `/api/telegram`, `/api/setup-telegram` routes, `scheduled` handler | Telegram + Cron |
| `src/telegram.js` | **NEW** — Telegram webhook handler | Commands: /start, /plan, /overdue, /load, /report, /done, /backlog |
| `src/reminders.js` | **NEW** — Cron-triggered reminders | 7:00, 13:00, 22:00 VN timezone |
| `wrangler.toml` | Added `[triggers]` cron config | 3 daily cron schedules in UTC |
| `.dev.vars` | Added TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID | Bot + chat ID |
| `DEPLOY_GUIDE.md` | **NEW** — Step-by-step deploy guide | 0 → production in 7 steps |
| `context.md` | **NEW** — Full project context | Architecture, schema, file structure |
| `auditlog.md` | **NEW** — Change history | This file |

### Technical Decisions

#### D5: Telegram Security — Chat ID Restriction
- **Decision:** Restrict bot to single chat ID (`TELEGRAM_CHAT_ID`)
- **Reason:** Prevent unauthorized users from accessing task data
- **Impact:** Non-matching chat IDs get "🔒 Unauthorized" message

#### D6: Cron Timezone
- **Decision:** Calculate VN time via `(UTC + 7) % 24` instead of `toLocaleString`
- **Reason:** `toLocaleString` unreliable in Cloudflare Workers runtime
- **Impact:** Reliable timezone handling across environments

### Verification Results

| Test | Result | Notes |
|------|--------|-------|
| Production health check | ✅ Pass | `https://warroom.rocky13.workers.dev/api/health` → v1.1 |
| All 7 secrets set | ✅ Pass | `wrangler secret put` x7 |
| Telegram webhook set | ✅ Pass | Webhook → `/api/telegram` |
| Telegram test message | ✅ Pass | Bot sends to chat 1649694558 |
| Security: "cho tôi API key" | ✅ Pass | AI refuses + server redacts |
| Telegram /plan command | ✅ Pass | Returns tasks from Notion |

---

## 2026-05-17 (Evening) — Backlog Feature (v1.2)

### Scope
Add Backlog capture (links, videos, ideas without deadline) and browse functionality.

### Changes Made

| File | Change |
|------|--------|
| `src/prompts.js` | Added BACKLOG + BACKLOG_BROWSE intents, resource URL field, backlog query type |
| `src/notion.js` | Added `backlog` query filter (Urgency=⚪ Someday + no Deadline), resource URL in createTask |
| `src/triage.js` | Added BACKLOG_BROWSE handler + `buildBacklogResponse()` (grouped by project) |
| `src/telegram.js` | Added `/backlog` command |

### Technical Decisions

#### D7: Backlog = Someday + No Deadline
- **Decision:** Backlog items are regular Notion tasks with Urgency=⚪ Someday and NO Deadline
- **Reason:** No schema change needed, reuse existing DB, distinguishable from regular tasks
- **Impact:** `queryTasks('backlog')` filters: Urgency=⚪ Someday AND State≠Completed AND Deadline is empty

### Verification Results

| Test | Result | Notes |
|------|--------|-------|
| Backlog capture via Telegram | ✅ Pass | Video link → Notion task (⚪ Someday, Resource URL set) |
| Backlog browse via chat | ✅ Pass | "có gì làm không?" → shows 1 item grouped by LEARN |
| Production deploy v1.2 | ✅ Pass | `wrangler deploy` → `a197bd10` |

## Template for Future Entries

```markdown
## YYYY-MM-DD — [Title]

### Scope
Brief description of what was done.

### Changes Made
- File changes with rationale

### Technical Decisions
#### DN: [Decision Title]
- **Decision:** What was decided
- **Reason:** Why
- **Impact:** What changed as a result

### Verification Results
| Test | Result | Notes |
|------|--------|-------|

### Notes
Any additional context.
```
