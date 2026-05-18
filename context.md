# 🚀 Stratt — Project Context

> File này chứa đủ context để developer mới (hoặc AI agent) tiếp tục phát triển mà không cần hỏi lại.
> Cập nhật lần cuối: 2026-05-18 (v3.2)

---

## 1. SẢN PHẨM

**Stratt** (named after Commander Stratt from Project Hail Mary) là web chat app giúp Matt (Senior BA, ADHD) quản lý task từ nhiều nguồn.

**Flow:** Chat input → MiniMax AI parse/triage → Notion CRUD → trả kết quả về chat.

**Key UX:** AI nhớ ngữ cảnh hội thoại (5 tin nhắn), nhận biết ngày/giờ/day type, tự chia task lớn thành sub-tasks. Gamification (XP/Streak/Achievements) tạo dopamine loop. Brain dump (nhiều task 1 lúc). ADHD-optimized: chỉ show 1 task tiếp theo, anti-drift reminders.

---

## 2. ARCHITECTURE

```
User ──→ Web Chat ──→ /api/chat ─────────┐
                                         ├→ triage.js → MiniMax + Notion
User ──→ Telegram ──→ /api/telegram ──┘       ↕
                                        KV: CHAT_MEMORY (conversation context)

Cron (5 schedules) ─→ reminders.js ─→ Notion query ─→ Telegram message

Cloudflare Worker (src/index.js)
  ├→ Rate Limiter (30 req/min per IP)
  ├→ src/auth.js          — SHA-256 password gate + Secure cookies
  ├→ src/triage.js        — Orchestration + memory + ADHD response builders
  │    ├→ src/minimax.js    — MiniMax-M2.7 (multi-turn support)
  │    ├→ src/notion.js     — Notion CRUD + fuzzy search + edit
  │    ├→ src/prompts.js    — System prompt + security rules
  │    └→ src/gamification.js — XP, Streaks, Achievements, Levels
  ├→ src/telegram.js      — Webhook + inline keyboard + HTML parse mode
  ├→ src/reminders.js     — Consolidated cron (5 triggers) + drift checks
  └→ Static assets (Cloudflare [assets] binding)
```

---

## 3. TECH STACK

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | Vanilla HTML/CSS/JS | Single-page, dark theme, Inter + JetBrains Mono |
| Backend | Cloudflare Workers | ESM modules, no bundler needed |
| AI | MiniMax-M2.7 | Direct API, multi-turn messages, JSON output |
| Database | Notion API | Existing "Today" DB, adapted schema |
| Memory | Cloudflare KV | `CHAT_MEMORY` namespace, 5 msg × 1h TTL |
| Auth | SHA-256 + Secure cookies | HttpOnly, SameSite=Strict, 30-day TTL |
| Deploy | Cloudflare Workers | `wrangler deploy`, secrets via `wrangler secret put` |

---

## 4. NOTION DB MAPPING

Tái sử dụng database **"Today"** (`1a65fcb4-61d1-814c-9f08-e65b9e28af64`).

### Property Mapping (DB Name → Stratt Concept)

| DB Property | Type | Stratt Concept | Notes |
|-------------|------|------------------|-------|
| `Name` | title | Task title | — |
| `Context` | select | Project | GMA, HOSEL, SALES, EMPULSE, KV, EDU, TEACH, LEARN, PERSONAL |
| `Priority` | select | Priority | High/Medium/Low (auto-mapped from Urgency) |
| `Urgency` | select | Urgency level | 🔴 Fire, 🟡 Important, 🟢 Wait, ⚪ Someday |
| `Energy` | select | Energy required | ⚡ High, 🔋 Med, 😴 Low |
| `State` | status | Status | To do, In progress, Pending / Wait for approved, Completed |
| `Deadline` | date | Due date | — |
| `Do Date` | date | Planned do date | — |
| `Estimate` | number | Minutes estimate | — |
| `Block` | select | Time block | ☀️ AM, 🌤️ PM, 🌙 Power Block |
| `Source` | select | Source | EIT, Side Gig, Self, Personal |
| `Assigned By` | rich_text | Who assigned | — |
| `Notes` | rich_text | AI context/summary | — |
| `Resource` | url | Related link | — |

### Status Mapping

| Stratt Intent | Notion State |
|----------------|--------------|
| New task | → `To do` |
| Done / Xong | → `Completed` |
| Drop | → `Completed` (no separate "Dropped" status) |

---

## 5. AI SYSTEM PROMPT

File: `src/prompts.js`

**Key behaviors:**
- Ngôn ngữ: Tiếng Việt, giữ English keywords
- Tone: trực diện, ngắn gọn, không sáo rỗng
- Thiếu info → HỎI LẠI (không assume)
- Drop → confirm trước
- Luôn show load % khi plan
- Overload → CẢNH BÁO
- KHÔNG BAO GIỜ nói "mình không truy vấn được Notion" — AI CÓ THỂ query trực tiếp
- Task > 60p → auto chia nhỏ (CAPTURE_SPLIT)
- Sử dụng datetime context header

**Intent detection:**
| Intent | Trigger Examples |
|--------|-----------------|
| CAPTURE | Mô tả task mới có deadline/urgency |
| CAPTURE_SPLIT | Task > 60p → parent + sub-tasks |
| BACKLOG | Link, video, idea, "lưu lại/someday" |
| BACKLOG_BROWSE | "có gì làm không/rảnh/pick" |
| TRIAGE | "ưu tiên", "plan today", "hôm nay" |
| LIST_TASKS | "liệt kê/list/xem tasks/task chưa đóng" |
| OVERDUE_CHECK | "quên", "overdue", "bỏ sót" |
| UPDATE | "done/xong/drop" + tên task |
| EDIT | "sửa/đổi/reschedule" + field + task |
| REPORT | "summary", "báo cáo", "report" |
| LOAD_CHECK | "overload", "quá tải", "check load" |
| DELETE | "xoá/delete/remove/bỏ" + tên task |
| CLEANUP | "dọn dẹp/cleanup/xoá hết" |
| CLARIFY | Không rõ ý định |

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
├── src/
│   ├── index.js            # Worker entry — routes + rate limiter + cron handler
│   ├── auth.js             # SHA-256 password gate (Secure cookies)
│   ├── minimax.js          # MiniMax-M2.7 client (multi-turn)
│   ├── notion.js           # Notion CRUD + fuzzy search + editTask
│   ├── triage.js           # Orchestration + KV memory + response builders
│   ├── prompts.js          # System prompt + security rules
│   ├── telegram.js         # Webhook + inline keyboard + Markdown
│   ├── reminders.js        # Consolidated cron (5 triggers) + drift checks
│   └── gamification.js     # XP, Streaks, Achievements, Levels
└── public/
    ├── index.html           # Chat UI (SPA)
    ├── style.css            # Dark theme + urgency pills + XP animations
    └── app.js               # Frontend + markdown renderer + urgency colors
```

---

## 7. API ENDPOINTS

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth` | No | Login → set SHA-256 cookie |
| POST | `/api/chat` | Cookie | Main chat (AI + Notion + Memory) |
| GET | `/api/health` | No | Health check (v2.0) |
| POST | `/api/telegram` | Chat ID | Telegram webhook + callback_query |
| POST | `/api/setup-telegram` | Cookie | Set Telegram webhook URL |

---

## 8. ENVIRONMENT VARIABLES

```
MINIMAX_API_KEY     — MiniMax platform key (sk-cp-...)
NOTION_API_KEY      — Notion integration key (ntn_...)
NOTION_TASKS_DB_ID  — "Today" database UUID
NOTION_DAILY_DB_ID  — (same as tasks for now)
APP_PASSWORD        — Login password
TELEGRAM_BOT_TOKEN  — Bot token from @BotFather
TELEGRAM_CHAT_ID    — Matt's Telegram chat ID (1649694558)
```

**KV Namespaces:**
```
CHAT_MEMORY — 2e87de8f1a4e45d09ac79fcc88a92d86
```

---

## 9. CRON SCHEDULE

| Slot | VN Time | UTC Cron | Days | Purpose |
|------|---------|----------|------|--------|
| Wake-up | 08:00 | `0 1 * * 1-5` | T2-T6 | Morning briefing |
| Work hours | :30 marks | `30 3-9 * * 1-5` | T2-T6 | Dispatches: 10:30 drift, 13:30 afternoon, 15:30 push, 16:30 drift |
| Weekend AM | 09:30 | `30 2 * * 6` | T7 | Weekend morning |
| Weekend PM | 20:00 | `0 13 * * 6` | T7 | Weekend evening |
| Power Block | 23:00 | `0 16 * * 1-5` | T2-T6 | Night session |

> **Note:** Consolidated from 12 logical slots to 5 cron triggers (CF free plan limit). Internal dispatch in `reminders.js` routes by VN hour/minute.

---

## 10. DEV COMMANDS

```bash
# Local dev
cd warroom && npm run dev     # http://localhost:8787

# Deploy
npm run deploy                # = wrangler deploy

# Set production secrets
wrangler secret put MINIMAX_API_KEY
wrangler secret put NOTION_API_KEY
# etc.

# View production logs
npx wrangler tail
```

---

## 11. KNOWN LIMITATIONS

1. **No "Dropped" status** — DB only has "Completed". All done/dropped → Completed.
2. **Day type detection** — Hardcoded: Friday = WFH, others = Office, weekend = 120min.
3. **Single user** — No multi-user support, single shared password.
4. **KV Memory TTL** — Conversation context expires after 1 hour of inactivity.
5. **5 cron limit** — CF free plan. Consolidated via internal dispatch.
6. **CN cron** — Sunday shares T7 cron trigger; dispatch handles separately.

---

## 12. VERSION HISTORY

| Version | Date | Key Changes |
|---------|------|-------------|
| 1.0 | 2026-05-17 | Initial build: Chat + AI + Notion |
| 1.1 | 2026-05-17 | Security + Telegram + Cron |
| 1.2 | 2026-05-17 | Backlog feature |
| 2.0 | 2026-05-17 | SHA-256 auth, rate limiting, datetime injection, chat history |
| 2.1 | 2026-05-17 | Conversation memory, EDIT, fuzzy search, Telegram keyboard, CAPTURE_SPLIT |
| 3.0 | 2026-05-18 | Gamification (XP/Streak/Achievements), CAPTURE_BATCH, ADHD response optimization, urgency colors, HTML Telegram, 8AM briefing, drift checks, push slot |
| 3.1 | 2026-05-18 | Rebrand: War Room → Stratt. DELETE/CLEANUP commands. New domain: stratt.rocky13.workers.dev |
| 3.2 | 2026-05-18 | LIST_TASKS intent + regex fallback. AI CAPABILITIES section. Telegram format fix (MD→HTML, strip JSON). Password: HailMary13 |
