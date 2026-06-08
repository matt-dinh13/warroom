# 🔍 Stratt — Project Audit (v5.3)

> Ngày audit: 2026-06-08
> Phạm vi: toàn bộ codebase (src/, public/, config)
> Phương pháp: đọc code thủ công, phân tích luồng dữ liệu, test cục bộ

---

## Tóm tắt điều hành

Stratt là một CF Workers app quản lý task qua chat (AI + Notion), có kèm Telegram bot, kanban board và calendar. Codebase **lành mạnh ở mức tốt** sau khi tách module ở v5.0. Audit này phát hiện **1 bug critical** (đã fix), **2 vấn đề bảo mật mức trung bình** (1 đã fix), và một số nợ kỹ thuật.

| Hạng mục | Điểm | Ghi chú |
|----------|------|---------|
| Kiến trúc | 8/10 | Module hóa tốt, tách concern rõ |
| Độ tin cậy | 7/10 | Có retry, fallback, cache. Phụ thuộc AI là điểm yếu cố hữu |
| Bảo mật | 6/10 | Auth yếu cho mục đích cá nhân OK; vài lỗ hổng nhỏ |
| Khả năng bảo trì | 7/10 | Doc tốt, nhưng có code trùng lặp & version lệch (đã sửa) |
| Test | 5/10 | Có test-full.sh nhưng là smoke test thủ công, không CI |

---

## 🔴 Critical (đã fix trong audit này)

### C1. `require()` trong ESM Workers — parsers.js
- **Mô tả:** `tryParseCaptureFromAIResponse` gọi `require('./prompts.js')` để lấy `PROJECT_SOURCE_MAP`. Cloudflare Workers chạy ESM thuần, không có CommonJS `require` → ném `ReferenceError`.
- **Tác động:** Khi AI trả plain text (không JSON) cho task CÓ project → nhánh fallback crash → toàn bộ request lỗi 500. Lỗi ẩn, chỉ nổ ở nhánh hiếm.
- **Fix:** Chuyển sang `import { PROJECT_SOURCE_MAP } from './prompts.js'` ở đầu file. ✅

---

## 🟡 Trung bình

### M1. XSS qua task title trong calendar (đã fix)
- **Mô tả:** `renderCalendar` chèn `task.title` và `task.project` vào DOM qua `innerHTML` không escape.
- **Tác động:** Task title chứa `<script>` hoặc `<img onerror>` → thực thi khi render calendar. Rủi ro thấp (single-user, data từ chính user) nhưng vẫn là lỗ hổng.
- **Fix:** Bọc `escapeHtml()` cho title + project trong calendar block. ✅

### M2. Rate limiter per-isolate (chưa fix — chấp nhận được)
- **Mô tả:** `rateLimitMap` là Map in-memory, reset mỗi khi CF spawn isolate mới. Không phải global rate limit thật.
- **Tác động:** Dễ bypass nếu có nhiều isolate. Với app single-user → rủi ro thấp.
- **Khuyến nghị:** Nếu cần nghiêm túc, dùng Durable Object hoặc KV-based counter. Hiện tại để nguyên.

### M3. CORS wildcard + cookie auth
- **Mô tả:** `Access-Control-Allow-Origin: *` kết hợp cookie `SameSite=Strict`. SameSite=Strict đã chặn phần lớn CSRF, nhưng wildcard CORS vẫn là thói quen không tốt.
- **Khuyến nghị:** Giới hạn origin về domain thật (`stratt.rocky13.workers.dev`). Rủi ro thực tế thấp nhờ SameSite.

---

## 🟢 Thấp / Nợ kỹ thuật

### L1. `done_name` command có thể đóng nhầm task
- `/^(?:done|xong)\s+(.{3,})$/i` match "xong việc rồi nghỉ thôi" → fuzzy search. May là threshold ≥30 chặn phần lớn, nhưng vẫn có rủi ro đóng nhầm task gần giống.
- **Khuyến nghị:** Yêu cầu xác nhận khi fuzzy score 30-50 (vùng mơ hồ).

### L2. Code trùng lặp parser (đã dọn)
- `tryParseTaskFromUserMessage` (parsers.js) là dead code, trùng chức năng `tryDirectParse` (triage.js). Đã xóa. ✅

### L3. Version string lệch (đã đồng bộ)
- health=5.0.0, triage=5.2, commands/responses=5.0. Đã đồng bộ tất cả về 5.3. ✅

### L4. `tryDirectParse` vẫn nằm trong triage.js
- Logic parse phức tạp (weekday, time) nằm trong triage.js thay vì parsers.js. Nên chuyển về parsers.js để gom 1 chỗ. (Chưa làm — không gấp.)

### L5. Console.log debug còn sót
- `minimax.js` log "MiniMax raw (first 300)", triage.js log "Phase 3.5 check", "create_batch tasks". Hữu ích khi debug nhưng nên gắn cờ `DEBUG` env để tắt ở production.

### L6. Telegram webhook không verify secret token
- `/api/telegram` nhận mọi POST. Ai biết URL có thể giả update. Chat ID check chặn xử lý, nhưng vẫn tốn 1 AI call nếu spoof đúng chat ID format.
- **Khuyến nghị:** Set `secret_token` khi `setWebhook` và verify header `X-Telegram-Bot-Api-Secret-Token`.

---

## Đánh giá theo module

| Module | Trạng thái | Ghi chú |
|--------|-----------|---------|
| `index.js` | ✅ Tốt | Routing rõ, sanitize secrets, timeout fallback thông minh |
| `triage.js` | 🟡 OK | Orchestration tốt nhưng dài (Phase 1/2/3/3.5), `tryDirectParse` nên tách |
| `commands.js` | ✅ Tốt | Anchored regex sạch, zero false positive |
| `parsers.js` | ✅ Tốt (sau fix) | Đã bỏ require(), bỏ dead code |
| `responses.js` | ✅ Tốt | Builder thuần, không side effect |
| `notion.js` | ✅ Tốt | Pagination, retry, cache token. Fuzzy search hợp lý |
| `minimax.js` | ✅ Tốt | Timeout 60s + retry, multi-strategy JSON extraction |
| `prompts.js` | ✅ Tốt | Few-shot examples mạnh, intent alignment rõ |
| `auth.js` | 🟡 OK | SHA-256 + salt cố định. Đủ cho cá nhân, không nên dùng đa người dùng |
| `telegram.js` | 🟡 OK | Thiếu webhook secret verify (L6) |
| `reminders.js` | ✅ Tốt | Smart skip, auto-defer hợp lý |
| `public/app.js` | 🟡 OK (sau fix) | Đã vá XSS calendar. Còn vài innerHTML nhưng data controlled |

---

## Khuyến nghị ưu tiên

1. ~~Fix `require()` (C1)~~ — ✅ Done
2. ~~Vá XSS calendar (M1)~~ — ✅ Done
3. ~~Đồng bộ version (L3)~~ — ✅ Done
4. ~~Dọn dead code (L2)~~ — ✅ Done
5. **Telegram webhook secret (L6)** — nên làm nếu lo bị spoof
6. **Gắn cờ DEBUG cho console.log (L5)** — dọn log production
7. **Tách `tryDirectParse` về parsers.js (L4)** — gom logic parse 1 chỗ

---

## Kết luận

Sau khi fix C1 + M1 + L2 + L3 trong audit này, dự án ở trạng thái **ổn định, an toàn cho mục đích cá nhân**. Điểm yếu lớn nhất vẫn là **sự phụ thuộc vào MiniMax trả JSON đúng** — đã được giảm thiểu tốt qua lớp fallback nhiều tầng. Không có vấn đề nào chặn việc sử dụng hàng ngày.
