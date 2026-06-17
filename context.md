# 🚀 Stratt — Project Context

> File này chứa đủ context để developer mới (hoặc AI agent) tiếp tục phát triển mà không cần hỏi lại.
> Cập nhật lần cuối: 2026-06-17 (v2.0 UI — Today-first + parallel versioning)


---

## 1. SẢN PHẨM

**Stratt** (named after Commander Stratt from Project Hail Mary) là web app giúp Matt (Senior BA, ADHD) quản lý task từ nhiều nguồn.

**Flow:** Chat input → Instant Regex commands HOẶC MiniMax AI parse → Notion CRUD → trả kết quả.

**Key UX:**
- AI nhớ ngữ cảnh hội thoại (5 tin nhắn, KV memory) + task context injection
- AI personality: sarcastic, proactive (warn overdue/overload)
- **Auto-Schedule:** Nói giờ ("2pm chiều nay") → task tự có Scheduled datetime → hiện trên calendar grid
- **Kanban Board** tab: 4 cột (To Do, In Progress, Pending, Done Today), filter + quick add
- **Calendar Timeblock** tab: Day/Week toggle, 7:00–23:00, 30-min blocks, tap-to-schedule
- Instant commands (~60% messages skip AI, <1s response)
- Smart cron reminders (Telegram), skip khi không cần
- Materials storage (links, guides, notes)
- **PWA** installable trên iPad, Wake Lock always-on
- **Light/Dark mode** toggle (🌙/☀️) — persists via localStorage
- **Phong Thủy color theme** (Mệnh Thủy 💧 — Navy blue accent, cả 2 modes)

**Không có:** Gamification (XP, streak, achievements) — đã bỏ ở v5.0.

---

## 2. ARCHITECTURE

```
User ──→ Web Chat ──→ /api/chat ─────────┐
                                          ├→ commands.js (regex instant)
User ──→ Telegram ──→ /api/telegram ──┘   │  ↓ fallback
                                          ├→ triage.js → MiniMax + Notion
User ──→ Board Tab ──→ /api/tasks ───────→├→ notion.js (direct CRUD)
                       /api/tasks/create   │
                       /api/tasks/update   ↕
                                         KV: CHAT_MEMORY (conversation context)
                              │
                              └→ src/planner.js (v7) — buildDayPlan pure scheduler for `xếp lịch`/`xếp lại`

Cron (5 schedules) ─→ reminders.js ─→ Notion query ─→ Telegram message

Cloudflare Worker (src/index.js)
  ├→ Rate Limiter (30 req/min per IP)
  ├→ src/auth.js          — SHA-256 password gate + Secure cookies + Logout
  ├→ src/commands.js      — Instant regex commands (plan, list, overdue, xếp lịch, xếp lại, lịch tuần)
  ├→ src/planner.js       — (v7) Pure day scheduler: buildDayPlan (anchors + scoring + must-include guard + auto-park/push)
  ├→ src/triage.js        — Agentic orchestrator + memory + context injection + intent correction + enrichWithScheduledTime() + apply_plan resolve
  │    ├→ src/minimax.js    — MiniMax-M2.7 (timeout + retry)
  │    ├→ src/notion.js     — Notion CRUD + pagination + retry-backoff (supports scheduled_time)
  │    ├→ src/prompts.js    — Sarcastic prompt (v5.3) + 13 few-shot examples (incl. time scheduling)
  │    ├→ src/responses.js  — Response builders (sarcastic roast + next-task suggestion + calendar confirmation)
  │    └→ src/parsers.js    — Fallback JSON parsers
  ├→ src/telegram.js      — Webhook + inline keyboard + HTML parse mode
  ├→ src/reminders.js     — Smart cron (skip logic, no gamification)
  └→ Static assets (Cloudflare [assets] binding)
```

---

## 3. TECH STACK

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | Vanilla HTML/CSS/JS | SPA, dark theme, Inter + JetBrains Mono, OKLCH colors |
| Backend | Cloudflare Workers | ESM modules, no bundler needed |
| AI | MiniMax-M2.7 | Direct API, multi-turn, JSON output, 15s timeout + retry |
| Database | Notion API | "Today" DB, pagination, retry-backoff |
| Memory | Cloudflare KV | `CHAT_MEMORY` namespace, 5 msg × 24h TTL |
| Auth | SHA-256 + Secure cookies | HttpOnly, SameSite=Strict, 30-day TTL, logout support |
| Deploy | Cloudflare Workers | `wrangler deploy`, secrets via `wrangler secret put` |
| PWA | manifest.json + meta tags | Installable on iPad/mobile, Wake Lock API |

---

## 4. DESIGN SYSTEM — Phong Thủy (Mệnh Thủy 💧)

**User:** Matt, born 07/07/1996 (Bính Tý — Giản Hạ Thủy)

| Hành | Role | Color | CSS Token | Usage |
|------|------|-------|-----------|-------|
| 💧 Thủy | Bản mệnh | Navy Blue (hue 250) | `--accent` | Buttons, active tab, links |
| 🥇 Kim | Sinh ta | Cool Silver (hue 250, low chroma) | `--surface-*`, `--text-*` | Surfaces, text, borders |
| 🌿 Mộc | Ta sinh | Jade Teal (hue 170) | `--success`, `--wait` | Done, positive feedback |
| 🔥 Hỏa | Bị khắc | Coral Red (hue 22) | `--fire`, `--error` | Urgency, errors |
| 🏔️ Thổ | Khắc ta | Warm Amber (hue 65) | `--important`, `--warning` | Important, warnings |

**Color space:** OKLCH. No pure black/white. Tinted neutrals toward navy (hue 250).
**Impeccable skill applied:** No side-stripe borders, no gradient text, no glassmorphism, ease-out-quart motion.

---

## 5. NOTION DB MAPPING

Database **"Today"** (`1a65fcb4-61d1-814c-9f08-e65b9e28af64`).

### Property Mapping

| DB Property | Type | Stratt Concept | Notes |
|-------------|------|------------------|-------|
| `Name` | title | Task title | — |
| `Context` | select | Project | GMA, HOSEL, SALES, EMPULSE, KV, EDU, TEACH, LEARN, PERSONAL, Life, EIT, Gigs, MATERIALS |
| `Urgency` | select | Urgency level | 🔴 Fire, 🟡 Important, 🟢 Wait, ⚪ Someday |
| `State` | status | Status | To do, In progress, Pending / Wait for approved, Completed |
| `Deadline` | date | Due date | — |
| `Do Date` | date | Planned do date | — |
| `Scheduled` | date | Scheduled datetime | With time (e.g. 2026-06-09T09:00) |

> **v5.7:** `Priority` (trùng Urgency) và `Energy` (không dùng trong logic) đã bị bỏ khỏi code. Cột Notion còn tồn tại nhưng không còn được ghi.
> - `Priority`: đã overwrite toàn bộ 92 task → marker "🗑️ XÓA CỘT NÀY". **Chờ user xóa cột trong Notion.**
> - `Energy`: giữ nguyên cột + 27 giá trị có chủ đích (dành cho Sprint 3 nếu làm energy-based scheduling).
| `Estimate` | number | Minutes estimate | — |
| `Block` | select | Time block | ☀️ AM, 🌤️ PM, 🌙 Power Block |
| `Source` | select | Source | EIT, Side Gig, Self, Personal |
| `Assigned By` | rich_text | Who assigned | — |
| `Notes` | rich_text | AI context/summary | — |
| `Resource` | url | Related link | — |

---

## 6. FILE STRUCTURE

```
stratt/  (local dir: warroom/)
├── wrangler.toml           # CF Workers config + KV binding + cron
├── package.json            # Only dep: wrangler
├── .dev.vars               # 🔒 Local secrets (git-ignored)
├── .gitignore
├── context.md              # ← This file
├── auditlog.md             # Change history
├── DEPLOY_GUIDE.md         # Step-by-step deploy guide
├── test-full.sh            # Integration test suite (35 tests)
├── test-ui.sh              # UI structure validation (70 tests)
├── test-calendar.sh        # Calendar + Logout tests (41 tests)
├── test-agent.sh           # AI agent stress test (25 tests: adversarial, slang, edge cases)
├── test-browser.mjs        # Puppeteer Chrome E2E (35 tests)
├── src/
│   ├── index.js            # Worker entry — routes + rate limiter
│   ├── auth.js             # SHA-256 auth (login + logout)
│   ├── commands.js         # Instant regex commands (12 patterns incl. v7 planner)
│   ├── minimax.js          # MiniMax-M2.7 client (timeout + retry)
│   ├── planner.js          # (v7) Pure day scheduler — buildDayPlan (no LLM)
│   ├── notion.js           # Notion CRUD + pagination + retry-backoff
│   ├── triage.js           # Agentic orchestrator + context injection + intent fix
│   ├── prompts.js          # Sarcastic prompt v5.2 + 11 few-shot + intent alignment
│   ├── responses.js        # Response builders (buildTriage, etc.)
│   ├── parsers.js          # Fallback JSON parsers
│   ├── telegram.js         # Webhook + inline keyboard
│   └── reminders.js        # Smart cron (skip logic)
└── public/
    ├── index.html           # v1 SPA (Auth + Chat + Board + Calendar tabs) — legacy, served at / and /v1
    ├── style.css            # v1 OKLCH Phong Thủy design tokens
    ├── app.js               # v1 Frontend (chat + kanban + wake lock)
    ├── manifest.json        # PWA manifest
    ├── icon-192.png         # PWA icon (navy gradient + 🚀)
    ├── icon-512.png         # PWA icon (navy gradient + 🚀)
    └── v2/                  # (v2.0) Today-first UI — served at /v2 when DEFAULT_UI='v2'
        ├── index.html       # 3 tabs: Hôm nay (default) / Chat / Board
        ├── style.css        # @import /style.css + Today card/timeline styles
        └── app.js           # Render /api/today, actions: Xong/Để sau, replan, overflow banner
```

---

## 7. API ENDPOINTS

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth` | No | Login → set SHA-256 cookie |
| POST | `/api/logout` | No | Logout → clear cookie |
| POST | `/api/chat` | Cookie | Main chat (Regex/AI + Notion + Memory) |
| GET | `/api/tasks` | Cookie | Board: all active + done today + materials |
| POST | `/api/tasks/create` | Cookie | Quick add task (bypass AI) |
| POST | `/api/tasks/update` | Cookie | Update task status by page ID |
| GET | `/api/calendar` | Cookie | Calendar: all active tasks for week |
| POST | `/api/calendar/schedule` | Cookie | Set/remove scheduled datetime |
| GET | `/api/health` | No | Health check (v6.3.1) |
| POST | `/api/telegram` | Chat ID | Telegram webhook + callback_query |
| POST | `/api/setup-telegram` | Cookie | Set Telegram webhook URL |
| POST | `/api/mark-columns-for-deletion` | Cookie | One-time: mark database columns for manual deletion |
| GET | `/api/today[?replan=1]` (v7) | Cookie | Day plan from Planner engine: `{ plan, replan, generated_at }` |

---

## 8. INSTANT COMMANDS (Regex, no AI)

| Command | Intent | Pattern |
|---------|--------|---------|
| `plan` | TRIAGE | `^plan$` |
| `list` | LIST_TASKS | `^list$` |
| `overdue` | OVERDUE_CHECK | `^overdue$` |
| `check load` | LOAD_CHECK | `^check\s+load$` |
| `report` | REPORT | `^report$` |
| `backlog` | BACKLOG_BROWSE | `^backlog$` |
| `materials` | MATERIALS | `^materials$` |
| `done N` | UPDATE | `^done\s+\d+$` |
| `done [name]` | UPDATE | `^done\s+.+$` |
| `park [name]` | EDIT | `^(?:park\|để dành\|khoan làm)\s+(\S+(?:\s+\S+){0,5})$` |
| `resume [name]` | EDIT | `^(?:resume\|làm lại\|tiếp tục)\s+(\S+(?:\s+\S+){0,5})$` |
| `parked` | LIST_TASKS | `^(?:parked\|để dành\|đang park)$` |
| `xếp lịch` (v7) | DAY_PLAN | `^(?:xếp lịch\|plan ngày\|lên lịch)$/i` |
| `xếp lại` (v7) | DAY_PLAN | `^(?:xếp lại\|re-?plan\|lên lại)$/i` |
| `lịch tuần` (v7) | WEEK_INTAKE | `^(?:lịch tuần\|tuần này)$/i` |

All other messages → MiniMax AI fallback.


---

## 9. ENVIRONMENT VARIABLES

```
MINIMAX_API_KEY     — MiniMax platform key
NOTION_API_KEY      — Notion integration key
NOTION_TASKS_DB_ID  — "Today" database UUID
NOTION_DAILY_DB_ID  — (same as tasks for now)
APP_PASSWORD        — Login password
TELEGRAM_BOT_TOKEN  — Bot token from @BotFather
TELEGRAM_CHAT_ID    — Matt's Telegram chat ID
```

**KV Namespaces:** `CHAT_MEMORY — 2e87de8f1a4e45d09ac79fcc88a92d86`

---

## 10. CRON SCHEDULE

| Slot | VN Time | UTC Cron | Days | Purpose |
|------|---------|----------|------|---------|
| Wake-up | 08:00 | `0 1 * * 1-5` | T2-T6 | Morning briefing |
| Work hours | :30 marks | `30 3-9 * * 1-5` | T2-T6 | Drift, afternoon, push |
| Weekend AM | 09:30 | `30 2 * * 6` | T7 | Weekend morning |
| Weekend PM | 20:00 | `0 13 * * 6` | T7 | Weekend evening |
| Power Block | 23:30 | `30 16 * * 1-5` | T2-T6 | Auto-defer + summary |

---

## 11. KNOWN LIMITATIONS

1. No "Dropped" status — All done/dropped → Completed.
2. Day type detection — Hardcoded: Friday = WFH, others = Office.
3. Single user — No multi-user support.
4. KV Memory TTL — 24 hours of inactivity.
5. 5 cron limit — CF free plan, internal dispatch.
6. Rate limiter per-isolate — Resets on recycle. Fine for single-user.
7. Notion pagination — Max 100 tasks per query with `has_more` support.
8. **UI v2.0** is Today-first and lives at `/v2`; default at `/` is still v1 until `DEFAULT_UI='v2'` is flipped in `src/index.js` + redeploy.

---

## 12. VERSION HISTORY

| Version | Date | Key Changes |
|---------|------|-------------|
| 1.0 | 2026-05-17 | Initial build: Chat + AI + Notion |
| 1.1 | 2026-05-17 | Security + Telegram + Cron |
| 2.0 | 2026-05-17 | SHA-256 auth, rate limiting, chat history |
| 2.1 | 2026-05-17 | Conversation memory, EDIT, fuzzy search |
| 3.0 | 2026-05-18 | Gamification (XP/Streak/Achievements) |
| 3.1 | 2026-05-18 | Rebrand War Room → Stratt. DELETE/CLEANUP |
| 3.2 | 2026-05-18 | LIST_TASKS, anti-hallucination, Do Date sync |
| 3.3 | 2026-05-18 | Robust JSON parser, memory TTL 24h |
| 3.4 | 2026-05-18 | Bug fixes: memory, auth, weekly report |
| 3.5 | 2026-05-18 | CAPTURE/EDIT fallback, editTask all fields |
| 3.6 | 2026-05-18 | Query redesign, regex fallbacks |
| 4.0 | 2026-05-18 | Engine-first, done-by-number, auto-defer |
| 4.1 | 2026-05-18 | Disabled regex (false positives), AI-only |
| **5.0** | **2026-06-07** | **Major rewrite — kanban, Phong Thủy, no gamification** |
| **5.1** | **2026-06-07** | **Calendar timeblock, logout, anti-autofill** |
| **5.2** | **2026-06-08** | **Agentic upgrade — sarcastic personality, context injection, intent correction, 25 stress tests** |
| **5.3** | **2026-06-08** | **Calendar Day/Week View, Light mode, Auto-schedule time parsing** |
| **5.4** | **2026-06-08** | **Vietnamese weekday parsing, multi-day batch creation, calendar timezone alignment fixes** |
| **5.4.1** | **2026-06-08** | **Audit fixes — require() bug, XSS calendar, version sync, dead code cleanup. See AUDIT.md** |
| **5.4.2** | **2026-06-08** | **Audit hardening — Telegram webhook secret, done_name guard (≤6 words), removed debug logs** |
| **5.5** | **2026-06-08** | **Analytics — usage tracking (captures/completions/AI health/intents), /api/analytics endpoint, "stats" command** |
| **5.6** | **2026-06-08** | **Reliability (Sprint 2): Notion write retry (429-safe), per-query cache invalidation, pin task (Power Block/In progress skip auto-defer)** |
| **5.7** | **2026-06-08** | **Schema cleanup — bỏ Priority (trùng Urgency) + Energy (ghost field) khỏi code & prompt. Confirmation gọn hơn** |
| **5.8** | **2026-06-08** | **Analytics v2 (behavioral): hourly heatmap, weekday/weekend split, per-task defer tracking (guilt-loop detection), chronic-defer report trong "stats"** |
| **5.9** | **2026-06-08** | **Default calendar to week view, Completed tasks visible on timeline, 24h toggle checkbox** |
| **5.9.1** | **2026-06-08** | **Increase MiniMax API timeout to 60 seconds** |
| **5.9.2** | **2026-06-08** | **Notion task caching in Cloudflare KV & AI duplicate verification grounding** |
| **5.9.3** | **2026-06-08** | **Robust scheduled_time normalization (time-only inputs) in createTask/editTask** |
| **6.0** | **2026-06-13** | **Phase V6.1 — Reliability upgrade: deterministic-first capture, JSON-repair retry, Confirm-card validation for task captures** |
| **6.1** | **2026-06-13** | **Phase V6.2 — Parked state: Pending status isolation, weekly digest cron (Monday 8:00), interactive auto-defer prompts (Park/Split/Drop)** |
| **6.2** | **2026-06-13** | **Phase V6.3 — Notion DB cleanup: auto Block (AM/PM) derivation from scheduled_time, /api/mark-columns-for-deletion endpoint** |
| **6.3** | **2026-06-13** | **Phase V6 Round 2 Fixes — early return analytics flush, overload warning in resolve path, direct_parse vs AI analytics split** |
| **7.0** | **2026-06-17** | **Planner Engine P1 (core deterministic): `buildDayPlan` pure scheduler (gems: urgency+deadline+defer scoring, must-include guard, auto-park/push). Instant commands `xếp lịch`/`xếp lại`/`lịch tuần`. `applyDayPlan` batch writer. Reuses v6 confirm-card (ok→apply). 0 LLM in core.** |
| **2.0** (UI) | **2026-06-17** | **UI v2 Today-first: parallel versioning (`/v1` rollback-safe, `/v2` opt-in via `DEFAULT_UI`). Today tab default — next-action card + timeline + overflow banner. Wires `/api/today`. Real PWA icons (1902/8080 byte). v1 board/calendar chưa đụng (mục 2/3/4 PLAN_UI — làm sau khi dogfood).** |
| **2.0.1** (UI) | **2026-06-17** | **UI v2 Fix Round (PLAN_UI_FIXES): F1 wrangler.toml `binding='ASSETS'` + `run_worker_first=true` (fix `/v1` 500). F2 port v1 chat (sendChat/addMessage/confirm-card) sang v2 + nút `+` capture ở header. F3 nhãn cột Pending → "🅿️ Để dành" (chỉ display, giữ `data-status`).** |
| **2.0.2** (UI) | **2026-06-17** | **UI v2 Fix Round 2: F1.1 BLOCKER redirect loop — `serveVersionedAsset` đổi sang fetch canonical-path (`/v2/`, `/`) thay vì tự chèn `/index.html`. Cloudflare Assets canonical-hoá `/index.html` → 307 → loop. Trailing-slash là canonical → 200 thẳng. F2/F3 xác nhận còn nguyên. 6/6 HTTP 200, 0 Location header, `DEFAULT_UI` flip 2 chiều work.** |



