# 🔧 Stratt v6 — Round 2: Fix sau review + việc còn lại

> Tiếp nối [PLAN_V6.md](PLAN_V6.md). File này = task cho agent execute sau khi review vòng 1.
> Nguyên tắc: đọc lại code trước khi sửa (số dòng có thể trôi). Sau mỗi nhóm: `npx wrangler deploy --dry-run` phải xanh.

Thứ tự đề xuất: **A (bug) → C (đánh dấu cột Notion) → B (việc còn lại)**. A1 nên làm trước khi deploy.

---

# A. BUG FIXES (từ review vòng 1)

## A1 — [TRUNG BÌNH] Analytics rò rỉ ở mọi nhánh confirm-card ⚠️ làm trước

**Vấn đề:** Trong `processChat` ([src/triage.js](src/triage.js)), object `analytics` (chứa `ai_calls`, `ai_latency_ms`, `interactions`, `sources`, `is_weekend/weekday`) được tạo ngay sau `const aiResult = await callMiniMax(...)`. Nhưng các nhánh capture giờ `return {…CONFIRM_CAPTURE}` **sớm**, bỏ qua `recordDelta(env, analytics)` ở cuối hàm. → `ai_calls`/`ai_latency`/`ai_failures` **không được ghi** cho mọi lần tạo task qua AI. Làm méo `ai_failure_rate` & `instant_ratio` — đúng các chỉ số dùng để đo v6 có khá hơn v5.8 không.

**4 nhánh return sớm cần xử lý** (đều trong khối `if (action)` hoặc Phase 3/3.5):
1. `case 'create'` — nhánh `CAPTURE_SPLIT` (parent + subtasks).
2. `case 'create'` — nhánh `else` (task đơn).
3. `case 'create_batch'`.
4. Phase 3 fallback capture (`tryParseCaptureFromAIResponse`).
5. Phase 3.5 fallback (`CAPTURE_BATCH`/`CAPTURE` không action).

**Cách sửa (helper, gọn nhất):** thêm helper trong triage.js:
```js
async function flushAIAnalytics(env, analytics, intent, { aiFailure = false } = {}) {
  try {
    analytics.intents = { [intent]: 1 };
    if (aiFailure) analytics.ai_failures = 1;
    await recordDelta(env, analytics);
  } catch (err) { console.error('flushAIAnalytics error:', err); }
}
```
Gọi `await flushAIAnalytics(env, analytics, 'CONFIRM_CAPTURE')` **ngay trước** mỗi `return {…needs_confirmation:true}` ở nhánh 1-3.
Với nhánh 4 & 5 (fallback parser chạy vì AI không trả action) → gọi với `{ aiFailure: true }`.

**Phase 1.5 (deterministic, AI KHÔNG được gọi):** nhánh này return trước khi `analytics` tồn tại. Thêm ghi delta riêng ngay trước return:
```js
const wknd = isWeekendVN();
await recordDelta(env, {
  interactions: 1,
  sources: { [source]: 1 },
  is_weekend: wknd ? 1 : 0,
  is_weekday: wknd ? 0 : 1,
  intents: { CONFIRM_CAPTURE: 1 },
});
```
> Lưu ý: KHÔNG ghi `captures` ở bước show confirm — `captures` chỉ ghi khi user bấm "ok" (nhánh resolve đã làm). Mỗi message là 1 `interactions` riêng → đếm cả lúc show và lúc confirm là đúng (2 message = 2 interaction).

**Acceptance:** tạo 1 task qua AI → confirm "ok". Gọi `GET /api/analytics?days=1`: `ai_calls` tăng đúng 1, `interactions` = 2 (message tạo + "ok"), `captures` có 1.

---

## A2 — [THẤP] Mất cảnh báo overload khi tạo

**Vấn đề:** nhánh `case 'create'` cũ kiểm `today > 6` → nhắc "6 tasks rồi đó…". Khi chuyển sang confirm-card, đoạn này bị bỏ. Giờ tạo task không còn nudge quá tải.

**Cách sửa:** chuyển nudge sang **nhánh resolve "ok"** (đầu `processChat`, sau khi `createTask` thành công). Sau khi build `responseText`, thêm:
```js
try {
  const todayCount = (await queryTasks('today', env))?.length || 0;
  if (todayCount > 6) responseText += `\n\n⚠️ ${todayCount} tasks rồi đó, thêm nữa tính ở lại đêm à?`;
} catch {}
```
**Acceptance:** khi đã có >6 task hôm nay, confirm tạo task mới → response kèm cảnh báo.

---

## A3 — [THẤP, optional] Phân biệt nguồn capture direct_parse vs AI

**Vấn đề:** nhánh resolve ghi `captures: { confirm_command: count }` cho mọi nguồn → mất phân biệt "né AI" (deterministic) vs "qua AI". Plan muốn thấy `direct_parse`.

**Cách sửa:** đổi shape KV pending thành `{ tasks, viaAI }`:
- `savePendingTask`: lưu `{ tasks: <data>, viaAI: <bool> }` (Phase 1.5 → `viaAI:false`; các nhánh AI → `viaAI:true`).
- `getPendingTask`/resolve: đọc `pending.tasks` + `pending.viaAI`.
- Resolve ghi `captures: { [pending.viaAI ? ('chat_'+source) : 'direct_parse']: count }`.
> Kiểm: `pending_action.data` trong HTTP response hiện web KHÔNG dùng (web bấm Tạo = gửi "ok", resolve ở server) → đổi shape KV an toàn. Vẫn nên giữ `pending_action` trong response cho nhất quán.

**Acceptance:** "tạo task X 30 phút GMA" → confirm → `captures.direct_parse` tăng (không phải confirm_command).

---

# B. VIỆC CÒN LẠI (chưa làm ở vòng 1)

## B1 — V6.1-D: Gom 15 intent → ~7 (làm sau khi dogfood ổn)
Giữ nguyên spec ở [PLAN_V6.md](PLAN_V6.md) mục **V6.1-D**. Nhắc lại ripple bắt buộc đồng bộ: `prompts.js` (enum + few-shot + RULES 10-16), `triage.js` `intentMap` + analytics intent compare + `case 'query'` route theo `query_type`. **Rủi ro cao → chỉ làm khi đã có smoke test mở rộng.**

## B2 — V6.3-C: Làm rõ semantics Deadline/Do Date/Scheduled (OPTIONAL, rủi ro cao)
Giữ nguyên spec [PLAN_V6.md](PLAN_V6.md) mục **V6.3-C**. Mặc định: **giữ nguyên hành vi copy hiện tại**, chỉ làm nếu Matt yêu cầu.

## B3 — Cột "Parked" trên Kanban board (THẤP)
Task Parked (`Pending / Wait for approved`) hiện vẫn lọt vào `board_all` ([src/notion.js](src/notion.js)) → hiện lẫn trên board. Thêm cột/nhóm riêng "🅿️ Parked" trong render board (`public/app.js`) lọc `status === 'Pending / Wait for approved'`, để tách khỏi To do/In progress. (Không bắt buộc — chỉ để gọn mắt.)

## B4 — Telegram confirm thiếu nút "Sửa" (THẤP)
Web có `[✅ Tạo] [✏️ Sửa]`; Telegram chỉ có `[✅ Tạo] [❌ Bỏ]`. Chấp nhận được (Telegram bấm Bỏ rồi gõ lại). Chỉ làm nếu muốn parity: thêm nút Sửa → gửi text gợi ý gõ lại.

---

# C. TASK: Đánh dấu cột Notion cần xoá (để Matt xoá tay nhanh)

**Mục tiêu:** Matt muốn xoá cột thừa **bằng tay** trên Notion (an toàn, thấy rõ trước khi xoá). Cột rỗng dễ bỏ sót → agent ghi **sentinel "DELETE ME"** vào TẤT CẢ rows của các cột cần xoá, để mỗi dòng hiện chữ rõ ràng, Matt eyeball + xoá cột trong 10 giây.

**Cột cần đánh dấu** (xác nhận lại với Matt; từ plan V6.3-A): `Priority`, `Energy`, `Parent item`, `Sub-item`.

### Cách làm: one-off endpoint có auth (theo mẫu `/api/backfill-dodate` [src/index.js](src/index.js))

Thêm `POST /api/mark-columns-for-deletion` (yêu cầu auth, giống các route khác), body `{ columns: ["Priority","Energy",...] }`. Logic (viết hàm trong `notion.js`):

1. **Đọc schema DB:** `GET /v1/databases/{NOTION_TASKS_DB_ID}` → lấy `properties[col].type` cho từng cột yêu cầu. (Bắt buộc — vì agent KHÔNG biết trước type của Priority/Energy.)
2. **Paginate toàn bộ pages** (như `listAllTasks`), với mỗi page PATCH các cột theo **sentinel đúng type**:

| Type Notion | Sentinel ghi vào |
|---|---|
| `rich_text` / `title` | `"DELETE ME"` |
| `select` | `{ select: { name: "DELETE ME" } }` (ghi tên mới → Notion tự tạo option) |
| `status` | `{ status: { name: "DELETE ME" } }` ⚠️ status KHÔNG auto-tạo option qua API → nếu cột là `status`, **skip + báo Matt thêm option tay** |
| `multi_select` | `{ multi_select: [{ name: "DELETE ME" }] }` |
| `number` | `99999` |
| `date` | `{ date: { start: "1999-01-01" } }` |
| `checkbox` | `true` |
| `relation` / `people` / `files` | **KHÔNG ghi được text** → skip, báo Matt: "cột relation/people, xoá trực tiếp (code không dùng)" |

3. **Trả summary:** `{ [col]: { type, updated, skipped, note } }` để Matt biết cột nào đã đánh dấu, cột nào phải xoá tay trực tiếp.

> ⚠️ Lưu ý quan trọng: `Parent item`/`Sub-item` gần như chắc chắn là **relation** → KHÔNG đánh dấu được bằng text. Endpoint cần báo rõ để Matt xoá 2 cột này trực tiếp (chúng rỗng, code không đụng → xoá an toàn).

### Sau khi Matt xoá xong (manual checklist — Matt làm)
- [ ] Chạy `POST /api/mark-columns-for-deletion {columns:["Priority","Energy"]}` (qua app đã login, hoặc curl kèm cookie auth).
- [ ] Vào Notion DB "Today" → thấy cột `Priority`/`Energy` toàn "DELETE ME" → xoá cột.
- [ ] Xoá trực tiếp `Parent item`/`Sub-item` (relation, rỗng).
- [ ] (Tùy chọn) Xoá option rác "DELETE ME" còn sót trong select sau khi đã xoá cột — thường tự mất theo cột.
- [ ] Xoá/để-trống endpoint `/api/mark-columns-for-deletion` sau khi dùng (one-off, tránh để hở).

> 💡 Phương án nhanh hơn (nếu Matt muốn cho phép xoá tự động): Notion API xoá hẳn property bằng `PATCH /v1/databases/{id}` với `{ properties: { "Priority": null } }`. Mặc định KHÔNG dùng — Matt đã chọn xoá tay cho chắc.

**Acceptance:** sau khi gọi endpoint, mọi row trong Notion hiện "DELETE ME" (hoặc sentinel tương ứng) ở các cột select/text/number/date yêu cầu; summary liệt kê đúng cột skip (relation/status).

---

# Tổng kết thứ tự execute
1. **A1** (analytics flush) — trước deploy.
2. **A2, A3** — gộp cùng A1 nếu tiện.
3. **C** (endpoint đánh dấu cột) → Matt xoá cột tay.
4. Deploy + dogfood vài ngày.
5. **B3/B4** nếu thấy cần.
6. **B1** (gom intent) → **B2** (semantics ngày) — cuối, sau khi có test.
