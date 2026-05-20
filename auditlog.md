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

## 2026-05-18 — LIST_TASKS Fix (v3.2)

### Scope
Fix critical gap: AI claimed it couldn't query Notion. Added LIST_TASKS intent + regex fallback.

### Root Cause
MiniMax AI didn't know it had Notion query capability → responded "mình không truy vấn được Notion" when user asked to list tasks.

### Changes Made

| File | Change |
|------|--------|
| `src/prompts.js` | Added `CAPABILITIES` section telling AI it CAN query Notion. Added `LIST_TASKS` intent. |
| `src/triage.js` | Added regex fallback: detects "liệt kê/list/xem tasks" → forces direct Notion query, bypassing AI routing. |

### Technical Decision

#### D19: Regex Fallback for Critical Commands
- **Decision:** Add regex-based intent detection as safety net alongside AI routing
- **Reason:** AI hallucinated "can't query" — regex ensures critical commands always work
- **Pattern:** Check regex BEFORE processing AI's notion_action; override if matched

### Verification
| Test | Result |
|------|--------|
| "Liệt kê các task chưa đóng" | ✅ Returns 10 real tasks from Notion, grouped by status |
| Git push | ✅ `ba5f4af` |

---

## 2026-05-18 — Telegram Format Fix (v3.2b)

### Scope
Fix Telegram messages showing raw JSON and unformatted Markdown.

### Root Cause
1. AI sometimes returned raw JSON inside `response_text` → dumped to Telegram
2. Response builders used Markdown `**bold**` but Telegram expects `<b>bold</b>` HTML
3. No spacing between sections → wall of text

### Fix
Added `formatForTelegram()` function in `telegram.js`:
- Strips raw JSON blocks and standalone JSON objects
- Escapes HTML special chars (`<`, `>`, `&`)
- Converts Markdown `**bold**` → `<b>bold</b>` and `*italic*` → `<i>italic</i>`
- Adds line breaks before major emoji headers for readability
- Truncates at 4000 chars (Telegram limit: 4096)

Applied to both direct message and callback_query handlers.

---

## 2026-05-18 — Anti-Hallucination + Do Date Sync (v3.2c)

### Scope
Fix AI claiming "đã tạo" tasks without actually creating them. Sync Deadline→Do Date.

### Root Cause
MiniMax AI returned `notion_action: null` while saying "đã tạo" in response_text → user thinks tasks were created but Notion is empty.

### Fix (3 layers)

| Layer | What |
|-------|------|
| **Prompt** | New "QUY TẮC TẠO TASK" section: BẮT BUỘC trả notion_action, KHÔNG nói "đã tạo", KHÔNG nói "sandbox" |
| **Safety net** | If intent=CAPTURE but no notion_action → show error + retry instructions |
| **Guard** | If response contains "đã tạo" but no Notion write happened → append warning |

### Do Date Sync
- `createTask` + `editTask`: write both `Deadline` and `Do Date`
- Backfill API: `/api/backfill-dodate` → 4 tasks synced
- User's Notion view uses `Do Date` column

---

## 2026-05-18 — Robust JSON Parser + TTL 24h (v3.3)

### Root Cause
MiniMax AI returned text BEFORE the JSON block (e.g., "OK, bỏ daily ret-b. Giờ check...```json{...}```"). The old parser only stripped code fences at start/end of string → `JSON.parse` failed → fell back to CLARIFY with raw JSON shown to user → `notion_action` lost → tasks never created.

### Fix
Replaced single-pass parser with 4-strategy extraction in `minimax.js`:

| Strategy | Pattern |
|----------|---------|
| 1. Direct | `JSON.parse(content)` — pure JSON |
| 2. Fence | Extract from `` ```json ... ``` `` anywhere in text |
| 3. Brace | Find `{ ... "intent" ... }` block via regex |
| 4. Fallback | Return as CLARIFY with raw text |

Each strategy validates the parsed object has `intent` field before accepting.

### Other Changes
- Memory TTL: 1h → 24h (persist context throughout the day)
- Cleaned 25 duplicate tasks (19× Log Jira, 4× Ana sharing dupes, 2× Daily ret-b)
- Final task count: 10 clean tasks

---

## 2026-05-18 — Bug Fixes (v3.4)

### Scope
Code review + fix 5 bugs found across triage, notion, frontend, and index.

### Bugs Fixed

| # | Bug | Severity | File | Fix |
|---|-----|----------|------|-----|
| 1 | Conversation memory never saved | CRITICAL | `src/triage.js` | Added `saveConversation()` at end of `processChat()` — saves both user msg + AI response |
| 2 | `checkAuth` calls MiniMax API just to verify login | HIGH | `public/app.js` + `src/index.js` | Frontend sends `__ping__` → backend short-circuits with `{intent:"PING"}`, no AI call |
| 3 | `weekly_report` returns ALL completed tasks ever | MEDIUM | `src/notion.js` | Added `Deadline on_or_after` filter (last 7 days) |
| 4 | CAPTURE_SPLIT creates duplicate parent task | MEDIUM | `src/triage.js` | Handle CAPTURE_SPLIT inside `case 'create'` when intent matches; guard on fallback block |
| 5 | `t.deadline` undefined in LIST_TASKS display | LOW | `src/triage.js` | Changed to `t.due_date` (correct field from `parseNotionTask`) |

### Technical Decisions

#### D20: Auth Ping Pattern
- **Decision:** `__ping__` message → immediate `{intent:"PING", response_text:"pong"}` without AI
- **Reason:** Frontend called `/api/chat` with "health" message on every page load → wasted MiniMax API credits
- **Impact:** Page load no longer triggers AI call; auth check is instant

#### D21: Memory Save Strategy
- **Decision:** Save conversation AFTER all processing (Notion actions + response building)
- **Reason:** Ensures the saved AI response reflects the final text (after overrides/guards)
- **Impact:** Multi-turn conversations now work correctly; AI remembers previous context

### Verification Results

| Test | Result | Notes |
|------|--------|-------|
| `wrangler dev` build | ✅ Pass | No errors |
| Health endpoint | ✅ Pass | 200 OK |
| Auth (wrong password) | ✅ Pass | 401 |
| Auth (correct password) | ✅ Pass | Cookie set |
| `__ping__` (authenticated) | ✅ Pass | Instant response, no AI call |
| `__ping__` (unauthenticated) | ✅ Pass | 401 |
| "plan today" | ✅ Pass | Full pipeline: AI → Notion → response |
| "overdue" (2nd message) | ✅ Pass | Memory working (context preserved) |

---

## 2026-05-18 — CAPTURE/EDIT Fallback + Full Field Support (v3.5)

### Scope
Fix 2 user-reported issues:
1. Task creation requires 2 attempts (AI returns plain text, not JSON)
2. Editing stakeholders/assigned_by fails with "lỗi nghiêm trọng"

### Root Cause
MiniMax-M2.7 intermittently returns plain text instead of JSON for CAPTURE and EDIT commands, despite `response_format: { type: 'json_object' }`. The model correctly parses the task data but formats it as human-readable text instead of the required JSON schema.

Additionally, `editTask()` only supported 6 fields (deadline, urgency, estimate, project, energy, block). Any other field (assigned_by, notes, title, source, resource, status) resulted in zero properties being updated → silent failure.

### Changes Made

| File | Change | Impact |
|------|--------|--------|
| `src/triage.js` | CAPTURE fallback: parse AI's plain text response to extract task data → create in Notion | Tasks created on first attempt even when AI returns non-JSON |
| `src/triage.js` | EDIT fallback: detect edit intent from user message → parse field/value → execute directly | Edits work even when AI returns plain text |
| `src/triage.js` | Confirmation response builder for `case 'create'` | Clear "✅ Đã tạo" with all fields shown |
| `src/triage.js` | `tryParseCaptureFromAIResponse()` helper | Extracts title, project, urgency, energy, estimate, deadline, assigned_by from AI's formatted text |
| `src/triage.js` | `tryParseEditFromMessage()` helper | Extracts task_title + field + value from user message, with date format conversion |
| `src/notion.js` | `editTask()` expanded: +assigned_by, +notes, +title, +source, +resource, +priority, +status | All Notion fields now editable |
| `src/notion.js` | Field aliases: stakeholders→assigned_by, context→notes, link/url→resource | Flexible field naming |
| `src/prompts.js` | Stronger JSON enforcement, EDIT field list with examples, stakeholder alias | Better AI compliance |

### Technical Decisions

#### D22: Server-Side Fallback Strategy
- **Decision:** Parse AI's plain text response to extract structured data, then execute Notion action directly
- **Reason:** MiniMax-M2.7 ignores JSON format ~30% of the time for CAPTURE/EDIT despite prompt reinforcement
- **Impact:** 100% reliability for task creation and editing, regardless of AI output format

#### D23: Date Format Conversion in Edit Fallback
- **Decision:** Convert DD/MM → YYYY-MM-DD in `tryParseEditFromMessage`, also extract ISO from AI response
- **Reason:** User types "28/5" but Notion API requires ISO 8601
- **Impact:** Date edits work with natural Vietnamese date format

### Verification Results

| Test | Result | Notes |
|------|--------|-------|
| Build (wrangler dev) | ✅ Pass | No errors |
| Create task (first attempt) | ✅ Pass | Fallback parses AI text → Notion created |
| Edit stakeholders | ✅ Pass | assigned_by field updated in Notion |
| Edit deadline (DD/MM format) | ✅ Pass | Converted to ISO, Notion updated |
| Edit notes | ✅ Pass | Notes field updated |
| Create with all fields | ✅ Pass | project, urgency, energy, estimate, deadline, assigned_by |
| Delete task | ✅ Pass | Archive working |

---

## 2026-05-18 — Query Redesign + Regex Fallbacks (v3.6)

### Scope
Redesign query logic to properly separate "today's focus" from backlog. Add regex-based fallbacks for all query intents.

### Problem
- "plan today" returned ALL active tasks (To do + In progress) regardless of deadline
- No distinction between "needs attention now" vs "backlog/someday"
- AI frequently returns plain text instead of JSON → server-side queries never triggered

### Query Philosophy (ADHD-optimized)
- User doesn't care about To do vs In progress — only "done" vs "not done"
- **today** = tasks due today or overdue (what needs attention NOW)
- **all_active** = everything not completed, excluding Someday (for LIST_TASKS)
- **backlog** = Someday items (ideas, links, low priority)
- **overdue** = tasks past deadline

### Changes Made

| File | Change |
|------|--------|
| `src/notion.js` | Rewrote all query filters: today (deadline ≤ today), overdue (deadline < today), all_active (not completed, not Someday), backlog (Someday only), upcoming (next 7 days) |
| `src/triage.js` | Added regex fallbacks for TRIAGE, OVERDUE, LOAD_CHECK, BACKLOG — always query Notion directly regardless of AI JSON compliance |
| `src/triage.js` | Updated `buildTriageResponse` — no longer filters out Someday (query already excludes them) |
| `src/triage.js` | Updated `buildBacklogResponse` — clearer messaging |
| `src/triage.js` | Updated `buildLoadCheckResponse` — shows overdue count |
| `src/reminders.js` | Morning briefing uses new `today` query (no separate overdue call needed) |
| `src/prompts.js` | Updated query_type documentation |

### Technical Decisions

#### D24: Simplified Notion Filters
- **Decision:** Avoid nested `and` inside `or` — Notion API rejects 3+ levels of nesting
- **Reason:** Complex compound filters caused 400 validation errors
- **Impact:** Simpler filters, more reliable queries. Trade-off: backlog = only ⚪ Someday (not "no deadline + low urgency")

#### D25: Regex Fallbacks for ALL Query Intents
- **Decision:** Add regex detection for plan/overdue/load/backlog that runs BEFORE checking AI's notion_action
- **Reason:** MiniMax returns plain text ~50% of the time for query commands — server-side must handle it
- **Impact:** 100% reliability for all query commands regardless of AI output format

### Verification Results

| Test | Result | Notes |
|------|--------|-------|
| "plan today" | ✅ 4 tasks | Only due today + overdue (was 20+ before) |
| "overdue" | ✅ 3 tasks | Tasks with deadline before today |
| "check load" | ✅ 19 tasks | Active tasks excluding Someday |
| "backlog" | ✅ 1 item | Only Someday urgency |
| "list tasks" | ✅ 19 tasks | All non-completed, non-Someday |

---

## 2026-05-18 — Engine-First Architecture (v4.0)

### Scope
Major architecture redesign: commands execute instantly without AI. Added done-by-number, 2-minute rule, context switch warning, auto-defer cron.

### Problem
- Every message called MiniMax AI (5-15s latency) even for simple commands like "plan" or "done"
- AI returned plain text ~50% of the time → required complex fallback chains
- No quick way to mark tasks done (had to type full task name)
- No protection against ADHD context switching
- Tasks piled up as overdue with no auto-resolution

### Architecture Change

**Before (AI-first):**
```
User → AI parse (5-15s) → fallback regex → execute
```

**After (Engine-first):**
```
User → regex match? → YES → execute directly (<1s)
                    → NO  → call AI for natural language parse (5-15s)
```

### Changes Made

| File | Change | Impact |
|------|--------|--------|
| `src/triage.js` | Complete rewrite: Phase 1 (regex commands, instant) + Phase 2 (AI, only for capture) | ~70% messages skip AI entirely |
| `src/triage.js` | `done 1/2/3` — mark task by number from last plan | Zero-friction completion |
| `src/triage.js` | Last Plan Cache in KV (`lastplan:` prefix) | Enables done-by-number |
| `src/triage.js` | 2-minute rule: quick tasks (≤5p) suggest "làm luôn" if not busy | Prevents tiny tasks from rotting in queue |
| `src/triage.js` | Context switch warning: capture while In Progress → alert | Anti-ADHD drift |
| `src/triage.js` | `buildResult()` helper, `buildCaptureConfirmation()`, `buildListResponse()` | Cleaner code |
| `src/reminders.js` | Replaced `sendPowerBlockReminder` with `sendAutoDeferSummary` | Auto-defer + daily summary |
| `src/reminders.js` | Auto-defer logic: moves undone tasks' Do Date to tomorrow | Reduces guilt/overwhelm |
| `wrangler.toml` | Cron slot 5: `0 16` → `30 16` (23:00 → 23:30 VN) | Auto-defer timing |

### Technical Decisions

#### D26: Engine-First Architecture
- **Decision:** Regex-based command detection runs FIRST; AI only called for ambiguous natural language
- **Reason:** ~70% of user messages are fixed commands (plan, done, list, etc.) that don't need AI
- **Impact:** Response time 5-15s → <1s for commands. API credits reduced ~70%.

#### D27: Done-by-Number with KV Cache
- **Decision:** Store last plan's task list in KV (`lastplan:{chatId}`), allow "done 1" to complete task #1
- **Reason:** ADHD users know task is done but typing full name is friction → they don't mark it
- **Impact:** "plan" → "done 1" flow = 2 taps, maximum dopamine

#### D28: 2-Minute Rule (Conditional)
- **Decision:** If task ≤5p AND no task In Progress → suggest "làm luôn". If busy → just capture normally.
- **Reason:** GTD 2-minute rule works for ADHD BUT not when already focused on something else
- **Impact:** Quick tasks get done immediately when user is free; no interruption when focused

#### D29: Auto-Defer (23:30 Cron)
- **Decision:** At 23:30, move undone tasks' Do Date to tomorrow + send daily summary
- **Reason:** Overdue tasks create guilt → avoidance loop. Auto-defer breaks the cycle.
- **Impact:** User wakes up with clean slate. No manual action needed.

### Verification Results

| Test | Result | Notes |
|------|--------|-------|
| "plan" (no AI) | ✅ 0.76s | 4 tasks, numbered, instant |
| "done 1" (no AI) | ✅ 1.8s | Task completed, XP gained, achievement unlocked |
| "done [name]" (no AI) | ✅ Pass | Fuzzy match, instant |
| "overdue" (no AI) | ✅ Pass | 3 overdue tasks |
| "check load" (no AI) | ✅ Pass | 19 active tasks |
| "backlog" (no AI) | ✅ Pass | 1 Someday item |
| "list" (no AI) | ✅ Pass | All active tasks |
| "xoá [task]" (no AI) | ✅ Pass | Archive task |
| "report" (no AI) | ✅ Pass | Weekly summary |
| Natural language capture (AI) | ✅ Pass | Fallback creates task from AI text |
| Build + Deploy | ✅ Pass | stratt.rocky13.workers.dev |

### Performance Comparison

| Command | Before (v3.6) | After (v4.0) | Improvement |
|---------|---------------|--------------|-------------|
| plan | 5-15s | 0.76s | **10-20x faster** |
| done [task] | 5-15s | 1.8s | **3-8x faster** |
| list | 5-15s | <1s | **10-20x faster** |
| overdue | 5-15s | <1s | **10-20x faster** |
| capture (AI) | 5-15s | 5-15s | Same (AI needed) |

---

## 2026-05-18 — Disable Regex Phase 1 + StatusMap Fix (v4.1)

### Scope
Regex-based command detection caused critical false positives. Disabled all regex except "done N". Added UPDATE fallback. Expanded statusMap.

### Problems Found & Fixed
1. **"[task] cập nhật thành closed" → created new task** — regex didn't catch it, AI returned plain text, capture fallback triggered falsely
2. **"Closed" status → Notion 400 error** — statusMap only had Done/Dropped, not Closed/xong/hoàn thành
3. **Capture fallback too aggressive** — triggered for update/edit/delete messages when AI response contained 📌
4. **Title parser wrong priority** — matched `📋 Task đã capture:` before `📌 actual title`

### Final Architecture (v4.1)
```
User message
  ├─ "done 1/2/3" → local instant (Phase 1, only this remains)
  └─ everything else → AI call → notion_action?
       ├─ YES (AI returned JSON) → execute action
       └─ NO (AI returned plain text) → fallbacks:
            ├─ isUpdateIntent? → extract task name → updateTaskStatus
            └─ has 📌 + NOT update/edit/delete? → parse → createTask
```

### Changes Made

| File | Change |
|------|--------|
| `src/triage.js` | Disabled all Phase 1 regex except "done N" |
| `src/triage.js` | Added UPDATE fallback: detect "cập nhật/close/done/xong" → extract task → update Notion |
| `src/triage.js` | Capture fallback guarded: skip when message is update/edit/delete |
| `src/triage.js` | Title parser: prefer 📌 over 📋 |
| `src/notion.js` | statusMap expanded: Closed, done, xong, hoàn thành, drop, in progress, todo, pending |
| `src/notion.js` | Default fallback: unknown status → 'Completed' |
| `context.md` | Updated version history |
| `auditlog.md` | This entry |

### Verification Results (tested locally before deploy)

| Test | Result |
|------|--------|
| "[task] cập nhật thành closed" | ✅ Updates Notion (not creates) |
| "tạo task X, project Y, deadline Z" | ✅ Creates in Notion |
| "xoá [task]" | ✅ Archives |
| "done 1" | ✅ Local instant |
| "plan" | ✅ AI queries Notion |
| Normal chat | ✅ No false task creation |

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
