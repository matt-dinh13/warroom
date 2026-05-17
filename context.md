# ⚔️ War Room — Project Context

> File này chứa đủ context để developer mới (hoặc AI agent) tiếp tục phát triển mà không cần hỏi lại.
> Cập nhật lần cuối: 2026-05-17

---

## 1. SẢN PHẨM

**War Room** là web chat app giúp Matt (Senior BA, ADHD) quản lý task từ nhiều nguồn.

**Flow:** Chat input → MiniMax AI parse/triage → Notion CRUD → trả kết quả về chat.

**Không có:** Dashboard, chart, calendar UI, chat history persistence. Notion = display layer.

---

## 2. ARCHITECTURE

```
User ──→ Web Chat ──→ /api/chat ─────────┐
                                        ├→ triage.js → MiniMax + Notion
User ──→ Telegram ──→ /api/telegram ──┘

Cron (7h, 13h, 22h VN) ─→ reminders.js ─→ Notion query ─→ Telegram message

Cloudflare Worker (src/index.js)
  ├→ src/auth.js       — Cookie-based password gate
  ├→ src/triage.js     — Orchestration: intent → action → response
  │    ├→ src/minimax.js  — MiniMax-M2.7 direct API
  │    ├→ src/notion.js   — Notion API CRUD
  │    └→ src/prompts.js  — System prompt + security rules
  ├→ src/telegram.js   — Telegram webhook handler + send
  ├→ src/reminders.js  — Cron-triggered auto reminders
  └→ Static assets (Cloudflare [assets] binding)
```

---

## 3. TECH STACK

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | Vanilla HTML/CSS/JS | Single-page, dark theme, Inter + JetBrains Mono |
| Backend | Cloudflare Workers | ESM modules, no bundler needed |
| AI | MiniMax-M2.7 | Direct API (`api.minimaxi.chat`), OpenAI-compatible format |
| Database | Notion API | Existing "Today" DB, adapted schema |
| Auth | Cookie-based | Simple password gate, not crypto-grade |
| Deploy | Cloudflare Pages | `wrangler deploy`, secrets via `wrangler secret put` |

---

## 4. NOTION DB MAPPING

Tái sử dụng database **"Today"** (`1a65fcb4-61d1-814c-9f08-e65b9e28af64`).

### Property Mapping (DB Name → War Room Concept)

| DB Property | Type | War Room Concept | Notes |
|-------------|------|------------------|-------|
| `Name` | title | Task title | — |
| `Context` | select | Project | GMA, HOSEL, SALES, EMPULSE, KV, EDU, TEACH, LEARN, PERSONAL |
| `Priority` | select | Priority | High/Medium/Low (auto-mapped from Urgency) |
| `Urgency` | select | Urgency level | 🔴 Fire, 🟡 Important, 🟢 Wait, ⚪ Someday (NEW) |
| `Energy` | select | Energy required | ⚡ High, 🔋 Med, 😴 Low (NEW) |
| `State` | status | Status | To do, In progress, Pending / Wait for approved, Completed |
| `Deadline` | date | Due date | — |
| `Do Date` | date | Planned do date | — |
| `Estimate` | number | Minutes estimate | NEW |
| `Block` | select | Time block | ☀️ AM, 🌤️ PM, 🌙 Power Block (NEW) |
| `Source` | select | Source | EIT, Side Gig, Self, Personal (NEW) |
| `Assigned By` | rich_text | Who assigned | NEW |
| `Notes` | rich_text | AI context/summary | Reused existing |
| `Resource` | url | Related link | Existing |
| `Parent item` / `Sub-item` | relation | Task hierarchy | Existing, self-relation |

### Status Mapping

| War Room Intent | Notion State |
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

**Intent detection:**
| Intent | Trigger Examples |
|--------|-----------------|
| CAPTURE | Mô tả task mới |
| TRIAGE | "ưu tiên", "plan today", "hôm nay" |
| OVERDUE_CHECK | "quên", "overdue", "bỏ sót" |
| UPDATE | "done/xong/drop" + tên task |
| REPORT | "summary", "báo cáo", "report" |
| LOAD_CHECK | "overload", "quá tải", "check load" |
| CLARIFY | Không rõ ý định |

**Output:** Always JSON with `intent`, `response_text`, `notion_action`, `needs_confirmation`, `follow_up_question`.

---

## 6. FILE STRUCTURE

```
warroom/
├── wrangler.toml           # CF Workers config (main + assets + cron)
├── package.json            # Only dep: wrangler
├── .dev.vars               # 🔒 Local secrets (git-ignored)
├── .gitignore
├── context.md              # ← This file
├── auditlog.md             # Change history
├── DEPLOY_GUIDE.md         # Step-by-step deploy guide
├── src/
│   ├── index.js            # Worker entry — routes /api/* + cron handler
│   ├── auth.js             # Password gate (cookie, 30-day)
│   ├── minimax.js          # MiniMax-M2.7 client (direct API)
│   ├── notion.js           # Notion CRUD (adapted for "Today" DB)
│   ├── triage.js           # Orchestration + response builders
│   ├── prompts.js          # System prompt + security rules
│   ├── telegram.js         # Telegram webhook handler + send
│   └── reminders.js        # Cron-triggered auto reminders (7h, 13h, 22h VN)
└── public/
    ├── index.html           # Chat UI (SPA)
    ├── style.css            # Dark theme (CSS custom properties)
    └── app.js               # Frontend logic (auth, chat, quick actions)
```

---

## 7. API ENDPOINTS

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth` | No | Login → set cookie |
| POST | `/api/chat` | Cookie | Main chat (AI + Notion) |
| GET | `/api/health` | No | Health check |
| POST | `/api/telegram` | Chat ID | Telegram webhook (auto-set) |
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

**⚠️ SECURITY:** Xem Security Rules trong implementation_plan.md

---

## 9. DEV COMMANDS

```bash
# Local dev
cd warroom && npm run dev     # http://localhost:8787

# Deploy
npm run deploy                # = wrangler deploy

# Set production secrets
wrangler secret put MINIMAX_API_KEY
wrangler secret put NOTION_API_KEY
wrangler secret put NOTION_TASKS_DB_ID
wrangler secret put NOTION_DAILY_DB_ID
wrangler secret put APP_PASSWORD
```

---

## 10. KNOWN LIMITATIONS

1. **No chat history** — Messages lost on refresh. Notion is the source of truth.
2. **No "Dropped" status** — DB only has "Completed". All done/dropped → Completed.
3. **Day type detection** — Hardcoded: Friday = WFH, others = Office, weekend = 120min.
4. **Fuzzy match** — Task update uses simple `includes()` match, not proper fuzzy search.
5. **Single user** — No multi-user support, single shared password.
6. **No rate limiting** — Could hit MiniMax/Notion rate limits under heavy use.

---

## 11. PHASE 2 BACKLOG

- [ ] Chat history persistence (KV or D1)
- [x] Telegram bot for mobile capture
- [x] Auto-reminder cron (morning/afternoon/evening)
- [ ] Resend email: daily morning briefing
- [ ] Block Timer (Pomodoro in chat)
- [ ] Voice input (Telegram voice → text)
- [ ] Recurring tasks
- [ ] BaZi energy overlay
- [ ] AI learn patterns from people → auto-tag project
- [ ] Proper fuzzy search (Levenshtein distance)
- [ ] Multi-user auth with roles
- [ ] Telegram inline keyboard for quick actions
