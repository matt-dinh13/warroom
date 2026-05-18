# 🚀 Stratt — Audit Log

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

## 2026-05-18 — ADHD Optimization + Gamification (v3.0)

### Scope
PO-driven redesign targeting ADHD-specific pain points: drift zones, task paralysis, dopamine deficit, information overload.

### Changes Made

| File | Change | Impact |
|------|--------|--------|
| `src/gamification.js` | NEW: XP system, streak tracking, 8 achievements, 10 levels | Dopamine loop |
| `src/prompts.js` | Added CAPTURE_BATCH, shorter response rules, next action requirement | Multi-task brain dump |
| `src/triage.js` | Rewrite: NEXT-task-only display, gamification integration, completion rewards | Reduces overwhelm |
| `src/reminders.js` | Rewrite: consolidated 5 crons, drift checks (10:30 + 16:30), push slot (15:30), 8AM briefing | Anti-drift |
| `src/telegram.js` | Switch from Markdown to HTML parse mode, updated keyboards | Reliable formatting |
| `public/app.js` | Markdown renderer: bold, urgency pills, load bar, XP animation, section headers | Rich web display |
| `public/style.css` | Added urgency colors, XP/streak badges, achievement glow animation | Visual hierarchy |
| `wrangler.toml` | Consolidated 12 logical crons → 5 triggers (CF free plan limit) | Infrastructure |

### Technical Decisions

#### D13: Cron Consolidation (12 → 5)
- **Decision:** Use `30 3-9 * * 1-5` (fires every :30 from 10:30-16:30 VN) + internal dispatch
- **Reason:** CF free plan limits to 5 cron triggers; previous 12 separate entries impossible
- **Impact:** Some :30 marks fire with no action (11:30, 12:30, 14:30) — harmless, no message sent

#### D14: Gamification Architecture (KV-based)
- **Decision:** Store stats in `CHAT_MEMORY` KV with `stats:` prefix, no TTL (persistent)
- **Reason:** Streak/XP must persist across sessions; KV is the only storage available
- **Impact:** Stats survive forever (no auto-expire); memory msgs still expire at 1h

#### D15: Telegram HTML vs Markdown
- **Decision:** Switch to `parse_mode: HTML` with fallback
- **Reason:** Markdown parse errors were frequent with AI-generated content; HTML is more forgiving
- **Impact:** Use `<b>`, `<i>` tags in response text. Retry without parse_mode on failure

#### D16: "NEXT Task Only" Response Pattern
- **Decision:** Plan shows only 1 task prominently + summary counts
- **Reason:** ADHD research: >3 options = decision paralysis. Show NEXT action clearly
- **Impact:** Users see focused view; can type "xem hết" for full list

### Verification Results

| Test | Result | Notes |
|------|--------|-------|
| Deploy (5 cron triggers) | ✅ Pass | After fixing CF cron syntax |
| Bold markdown rendering | ✅ Pass | **text** → `<b>text</b>` |
| Urgency color pills (web) | ✅ Pass | 🟡 shows yellow text |
| Plan response (web) | ✅ Pass | Clean, focused layout |
| Check load (web) | ✅ Pass | Table + bold formatting |
| Git push | ✅ Pass | v3.0 |

---

## 2026-05-18 — Rebrand + DELETE (v3.1)

### Scope
Rebrand from "War Room" to "Stratt" (Commander Stratt, Project Hail Mary). Add DELETE/CLEANUP commands.

### Changes Made

| File | Change | Impact |
|------|--------|--------|
| `wrangler.toml` | Worker name: warroom → stratt | New domain: stratt.rocky13.workers.dev |
| `public/index.html` | All branding: ⚔️ War Room → 🚀 Stratt | Login + chat header |
| `public/app.js` | localStorage key: warroom_history → stratt_history | Frontend |
| `src/auth.js` | Cookie: warroom_auth → stratt_auth, salt updated | Auth |
| `src/telegram.js` | Start message: War Room Online → Stratt Online | Telegram |
| `src/notion.js` | NEW: archiveTask, bulkArchiveTasks, listAllTasks | DELETE support |
| `src/prompts.js` | Added DELETE/CLEANUP intents | AI detection |
| `src/triage.js` | Added delete/cleanup handlers | Task deletion |
| `APP_PASSWORD` | Changed from warroom2026 → HailMary13 | Security |

### Technical Decisions

#### D17: Rebrand Strategy
- **Decision:** Create new CF worker "stratt", delete old "warroom"
- **Reason:** CF free plan cron limit is per-account; old worker must be deleted first
- **Impact:** All secrets re-set, Telegram webhook updated, old domain gone

#### D18: Soft Delete (Archive)
- **Decision:** Use Notion `archived: true` instead of hard delete
- **Reason:** Recoverable if user accidentally deletes wrong task
- **Impact:** Tasks disappear from views but can be restored in Notion

### Verification Results

| Test | Result | Notes |
|------|--------|-------|
| Deploy stratt | ✅ Pass | stratt.rocky13.workers.dev |
| Login with new password | ✅ Pass | HailMary13 |
| Branding (🚀 Stratt) | ✅ Pass | Login + header |
| Plan command | ✅ Pass | Working |
| Delete command | ✅ Pass | Archive task |
| Cleanup command | ✅ Pass | List all tasks |
| Telegram webhook | ✅ Pass | Updated to new domain |
| Git push | ✅ Pass | v3.1 |

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
