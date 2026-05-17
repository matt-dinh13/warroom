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

## 2026-05-17 (Night) — Security Hardening + UX (v2.0)

### Scope
Nâng cấp bảo mật và UX: SHA-256 auth, rate limiting, datetime injection, chat history.

### Changes Made

| File | Change | Impact |
|------|--------|--------|
| `src/auth.js` | Rewrite: SHA-256 hashing (crypto.subtle) + salt | Passwords never stored in plain text |
| `src/auth.js` | Secure + HttpOnly + SameSite=Strict cookies | Chống XSS + CSRF |
| `src/index.js` | Rate limiter (30 req/min per IP via CF-Connecting-IP) | Chống brute force |
| `src/index.js` | `await isAuthenticated()` (async due to SHA-256) | Consistent async auth |
| `src/triage.js` | Inject VN datetime + day type + block into AI messages | AI biết thời gian |
| `public/app.js` | localStorage chat history (50 msg, restore on load) | Messages survive refresh |

### Technical Decisions

#### D8: SHA-256 Password Hashing
- **Decision:** Hash password with SHA-256 + salt using Web Crypto API
- **Reason:** `crypto.subtle` available in Workers, zero dependencies
- **Impact:** Auth functions now async. Cookie value is `wrm_` + hex hash

#### D9: Rate Limiting (In-Memory)
- **Decision:** Per-isolate Map with 60s window, 30 req max
- **Reason:** Lightweight, no external dependency, sufficient for single-user
- **Impact:** Resets when Worker isolate recycles (acceptable tradeoff)

---

## 2026-05-17 (Night) — Full Sprint 2+3 (v2.1)

### Scope
Conversation memory, EDIT intent, fuzzy search, CAPTURE_SPLIT, Telegram UI overhaul.

### Changes Made

| File | Change | Impact |
|------|--------|--------|
| `wrangler.toml` | Added KV namespace `CHAT_MEMORY` binding | Conversation persistence |
| `src/minimax.js` | Multi-turn message support (accepts full messages array) | Enables conversation context |
| `src/triage.js` | Full rewrite: KV memory (5 msg × 1h), EDIT handler, CAPTURE_SPLIT | AI remembers context |
| `src/triage.js` | Enhanced response builders: card layout, load bars, project breakdown | Better readability |
| `src/notion.js` | Fuzzy search: diacritics normalization + word-level scoring (≥30) | Vietnamese text matching |
| `src/notion.js` | `editTask()`: update deadline/urgency/estimate/project/energy/block | EDIT support |
| `src/prompts.js` | Added EDIT, CAPTURE_SPLIT intents, datetime awareness, sub-task rules | Expanded AI capabilities |
| `src/telegram.js` | Inline keyboard (Plan/Backlog/Load/Overdue/Report buttons) | 1-tap actions |
| `src/telegram.js` | `parse_mode: Markdown` + auto-fallback | Better formatting |
| `src/telegram.js` | Callback query handler + `/edit` command | Inline button support |

### Technical Decisions

#### D10: KV vs D1 for Conversation Memory
- **Decision:** KV with 1h TTL, 5 message pairs max
- **Reason:** Lightweight, auto-expire, no schema needed. D1 overkill for ephemeral context.
- **Impact:** Memory resets after 1h inactivity — acceptable for ADHD use case (sessions are short)

#### D11: Fuzzy Search Algorithm
- **Decision:** Custom scoring: exact (100) > substring (80/70) > word-match (0-60)
- **Reason:** Vietnamese text needs diacritics stripping (`NFD + regex`), simple Levenshtein too slow
- **Impact:** "workshop" matches "BA [AI] - Workshop set up", threshold ≥ 30

#### D12: Telegram Markdown Fallback
- **Decision:** Send with `parse_mode: Markdown`, retry without if Telegram API returns parse error
- **Reason:** Some AI responses contain unescaped Markdown chars that break Telegram
- **Impact:** Clean formatting when possible, plain text as safe fallback

### Verification Results

| Test | Result | Notes |
|------|--------|-------|
| Web login (SHA-256) | ✅ Pass | New hash format `wrm_...` |
| "plan today" → card layout | ✅ Pass | Load bar + emoji numbers |
| "check load" → datetime aware | ✅ Pass | Shows correct VN time + day type |
| KV binding active | ✅ Pass | Deploy confirms CHAT_MEMORY bound |
| Git push | ✅ Pass | main → `0806057` |

---

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
