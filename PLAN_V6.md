# 🛠️ Stratt v6 — Plan cải tiến: Độ tin cậy · Parked · Dọn field

> Trạng thái hiện tại: **v5.8** · Mục tiêu plan này: **v6.0**
> Người viết plan: session brainstorm (không execute) · Người execute: agent khác
> Nguyên tắc: plan này mô tả **chính xác file/hàm/dòng** cần đổi. Agent execute phải đọc lại code trước khi sửa (số dòng có thể trôi).

---

## 0. Bối cảnh — vòng luẩn quẩn cần phá

Ba vấn đề của Matt nối thành một vòng:

```
Agent điền field sai/chập chờn (P2)
        │ → Matt quay sang nhập tay trên Notion
        ▼
Notion quá nhiều cột → mệt khi set tay (P1)
        │ → bỏ bê, task dồn lại
        ▼
queryTasks('today') + auto-defer 23:30 đẩy mọi task chưa-Completed sang mai mãi mãi (P3)
        │ → agent nhắc hoài → nản → quay lại đầu
```

Plan đánh vào 3 nút thắt theo thứ tự ưu tiên:

| Phase | Tên | Đánh vào | Vì sao trước |
|-------|-----|----------|--------------|
| **V6.1** | Reliability (confirm-card + deterministic-first) | P2 | Gỡ nguyên nhân khiến Matt bỏ cuộc |
| **V6.2** | Parked state + hỏi-trước-defer | P3 | Chặn nag/guilt-loop |
| **V6.3** | Dọn field Notion + auto-derive | P1 | Làm khi luồng đã ổn |

Mỗi phase **độc lập, ship được riêng**. Làm xong V6.1 có thể deploy trước khi bắt đầu V6.2.

---

## 0.1 Quyết định cần Matt chốt TRƯỚC khi execute

Agent execute nên hỏi Matt 3 điểm này (mặc định = khuyến nghị nếu Matt không phản hồi):

1. **Trạng thái Parked dùng cơ chế nào?**
   - **(A — khuyến nghị)** Tái dùng status Notion có sẵn `Pending / Wait for approved`. **Không cần đụng schema Notion.** Ship nhanh.
   - (B) Thêm status mới `🅿️ Parked`. Sạch nghĩa hơn nhưng **bắt buộc Matt tự thêm option trong Notion UI** (status property không tạo option qua API được).
   - Plan dưới viết theo **(A)**, có note chỗ đổi nếu chọn (B).

2. **Confirm-card hiện khi nào?**
   - **(A — khuyến nghị)** *Confidence-gated*: chỉ hiện khi deterministic parser KHÔNG chắc hoặc đi qua AI. Khi parser bắt rõ ràng → tạo thẳng (giữ tốc độ <1s).
   - (B) Luôn hiện trước mọi lần tạo. An toàn nhất nhưng thêm 1 chạm mỗi task.

3. **Gom 15 intent → 7 (mục V6.1-D)** là phần rủi ro nhất (ripple sang analytics/responses). Làm trong v6.0 hay tách v6.1 sau? Khuyến nghị: **làm cuối cùng trong V6.1, sau khi đã có test**.

---

# 🟢 PHASE V6.1 — Reliability (ưu tiên #1)

**Goal:** giảm phụ thuộc vào "một lần gọi MiniMax trả JSON hoàn hảo". Nâng độ tin từ ~70% lên ~85-90% + làm cho phần sai sót còn lại *chịu được* nhờ confirm-card.

Gồm 4 việc: **A** deterministic-first · **B** JSON-repair retry · **C** confirm-card · **D** gom intent.

---

## V6.1-A — Deterministic-first capture

**Vấn đề:** `tryDirectParse` ([src/triage.js:21](src/triage.js)) hiện chỉ là *fallback* (Phase 3.5, [src/triage.js:469](src/triage.js)) và chỉ chạy sau khi AI đã được gọi. Phần lớn câu "tạo task..." không cần AI.

**Việc cần làm:**

1. **Tách `tryDirectParse` + `enrichWithScheduledTime` từ `triage.js` sang `src/parsers.js`** (dọn nợ kỹ thuật AUDIT L4). Export chúng. Cập nhật import ở `triage.js` và `index.js` ([src/index.js:4](src/index.js) đang `import { processChat, tryDirectParse } from './triage.js'`).

2. **Thêm hàm `scoreDirectParse(msg)` trong `parsers.js`** trả về `{ task, confidence }`:
   - `confidence = 'high'` khi: có keyword tạo (`tạo|thêm|add|create`) **VÀ** bóc được title sạch **VÀ** ít nhất 1 trong {project hợp lệ, time, estimate, due_date/weekday}.
   - `confidence = 'low'` khi chỉ có title trần (không field phụ) hoặc title nghi ngờ (chứa dấu `?`, từ hỏi "có nên", "hay là"...).
   - `null` khi không phải intent tạo.

3. **Trong `processChat` ([src/triage.js:172](src/triage.js)), chèn PHASE 1.5 — Deterministic capture, NGAY SAU Phase 1 instant commands, TRƯỚC khi build taskCtx + gọi AI:**
   ```
   const direct = scoreDirectParse(msg);
   if (direct && direct.confidence === 'high') {
     // Theo quyết định 0.1#2:
     //  - Nếu confirm-card BẬT (V6.1-C): trả pending_action, KHÔNG tạo ngay
     //  - Nếu confirm-card TẮT: tạo thẳng như Phase 3.5 hiện tại
     // → bỏ qua hoàn toàn việc gọi MiniMax
   }
   ```
   Khi đi nhánh này: vẫn ghi analytics `captures: { direct_parse: n }`, `ai_calls` KHÔNG tăng (đây là điểm lợi chính — đo bằng `instant_ratio` sẽ tăng).

4. **Giữ Phase 3.5 hiện tại** làm lưới an toàn cuối (khi AI nhận intent CAPTURE nhưng không tạo).

**Files:** `src/parsers.js` (thêm export), `src/triage.js` (xóa 2 hàm, thêm Phase 1.5), `src/index.js` (đổi import nguồn `tryDirectParse`).

**Acceptance:**
- "tạo task review code GMA 45 phút" → tạo (hoặc confirm-card) mà KHÔNG gọi MiniMax. Kiểm bằng log "Cache MISS"/absence of AI latency, hoặc `stats` thấy `instant_ratio` tăng.
- "có nên tạo task review không?" → confidence thấp → vẫn đi AI.

---

## V6.1-B — JSON-repair retry trong minimax.js

**Vấn đề:** `callMiniMax` ([src/minimax.js:18](src/minimax.js)) retry khi 5xx/timeout ([src/minimax.js:40-65](src/minimax.js)) nhưng **không retry khi parse JSON fail** — rơi thẳng vào Strategy 4 trả `CLARIFY` ([src/minimax.js:97-105](src/minimax.js)).

**Việc cần làm:**

1. Tách phần "gọi API + lấy content" thành hàm nội bộ `callOnce(msgPayload)`.
2. Trong `callMiniMax`: sau khi cả 4 strategy parse fail (trước dòng [src/minimax.js:99](src/minimax.js) return CLARIFY), thực hiện **1 lần repair**:
   - Append vào `msgPayload`: `{ role: 'user', content: 'Câu trả lời trước KHÔNG phải JSON hợp lệ. Trả về DUY NHẤT một JSON object theo schema (intent, response_text, notion_action). KHÔNG markdown, KHÔNG text ngoài JSON.' }`
   - Gọi lại `callOnce` 1 lần, chạy lại 4 strategy parse.
   - Nếu vẫn fail → mới trả CLARIFY như cũ.
3. Ghi log `console.warn('MiniMax JSON repair attempt')` để đo qua log.

**Lưu ý chi phí:** repair chỉ chạy khi parse fail (hiếm) → không tăng latency case thường. Vẫn nằm trong timeout 60s tổng.

**Files:** `src/minimax.js`.

**Acceptance:** mô phỏng response text thuần (không JSON) → lần 2 trả JSON hợp lệ → intent đúng thay vì CLARIFY. (Khó test offline; thêm log + theo dõi `ai_failure_rate` trong `stats` giảm.)

---

## V6.1-C — Confirm-card (đòn bẩy lớn nhất)

**Mục tiêu:** thay vì im lặng tạo task rồi sai, hiện thẻ "Tôi hiểu: …" cho Matt xác nhận 1 chạm. Làm độ chập chờn *chịu được*.

**Hiện trạng cần biết:**
- Web chat: `sendChat` ([public/app.js:234](public/app.js)) render `data.response_text` thành text thuần qua `addMessage`/`formatMessage` ([public/app.js:260-279](public/app.js)). Chưa có nút bấm.
- Telegram: đã có inline keyboard + `handleCallbackQuery` ([src/telegram.js:80](src/telegram.js)) với map `action_*`. callback_data giới hạn 64 byte → KHÔNG nhét full task được.
- Đã có sẵn endpoint quick-add không-AI: `POST /api/tasks/create` ([src/index.js:232](src/index.js)).

**Thiết kế (thống nhất web + Telegram qua KV draft):**

1. **Lưu draft trong KV.** Thêm trong `triage.js` (cạnh `getLastPlan`/`saveLastPlan`, [src/triage.js:153-165](src/triage.js)):
   - `savePendingTask(chatId, taskData, env)` → KV key `pending:${chatId}`, TTL 600s.
   - `getPendingTask(chatId, env)` / `clearPendingTask(chatId, env)`.

2. **Khi capture cần xác nhận** (nhánh deterministic-high của V6.1-A, hoặc AI CAPTURE khi confirm-card BẬT):
   - KHÔNG gọi `createTask`.
   - `savePendingTask(chatId, taskData)`.
   - Trả result mới:
     ```
     {
       intent: 'CONFIRM_CAPTURE',
       response_text: buildConfirmCard(taskData),   // hàm mới trong responses.js
       needs_confirmation: true,
       pending_action: { type: 'create', data: taskData }   // web đọc field này
     }
     ```
   - `buildConfirmCard(d)` (responses.js): "📝 Xác nhận tạo:\n📌 {title}\n📂 {project} · {urgency}\n⏱ {estimate}p · 📅 {due}\n\nĐúng không?" — phỏng theo `buildCaptureConfirmation` ([src/responses.js:104](src/responses.js)) nhưng đổi tiêu đề thành xác nhận.

3. **Resolve confirm:**
   - **Lệnh tự nhiên** (rẻ nhất, làm trước): thêm vào instant commands ([src/commands.js:13](src/commands.js)) hoặc xử lý đầu `processChat`: nếu có pending task và msg khớp `^(ok|đúng|tạo|yes|y|ừ|uh|chuẩn)$` → `createTask(pending)` + clear + trả `buildCaptureConfirmation`. Nếu msg khớp `^(không|sửa|hủy|no|cancel)$` → clear + "OK bỏ, gõ lại nhé."
   - **Web nút bấm:** `app.js` khi `data.needs_confirmation && data.pending_action` → render 2 nút trong message bot:
     - `[✅ Tạo]` → `POST /api/tasks/create` với `data.pending_action.data` (endpoint đã tồn tại, chỉ cần đảm bảo nhận đủ field: hiện chỉ nhận title/project/urgency/source/deadline/resource — **mở rộng để nhận estimate, scheduled_time, assigned_by, block, context, due_date**, xem [src/index.js:246-254](src/index.js)).
     - `[✏️ Sửa]` → đổ lại text vào ô input cho Matt sửa rồi gửi lại.
     - Cần thêm hàm render nút trong `app.js` (tạo `<button>` trong `.message-content`, gắn listener). `formatMessage` đang escape HTML → render nút phải đi đường riêng (tạo DOM element, không qua `formatMessage`).
   - **Telegram nút bấm:** trong `sendTelegramMessage` cho message confirm, kèm `inline_keyboard` `[{text:'✅ Tạo', callback_data:'confirm_create'}, {text:'❌ Bỏ', callback_data:'confirm_cancel'}]`. Mở rộng `handleCallbackQuery` ([src/telegram.js:80](src/telegram.js)) + `actionMap` để xử lý `confirm_create`/`confirm_cancel` → đọc `getPendingTask(chatId)` → tạo/clear.

4. **Phân biệt rõ:** UPDATE/EDIT/DELETE/QUERY **KHÔNG** đi confirm-card (chỉ CAPTURE). done/xong vẫn instant như cũ.

**Files:** `src/triage.js` (pending helpers + nhánh CONFIRM), `src/responses.js` (`buildConfirmCard`), `src/commands.js` hoặc đầu processChat (resolve bằng lệnh), `src/index.js` (mở rộng `/api/tasks/create`), `public/app.js` (render nút + handler), `src/telegram.js` (inline keyboard + callback).

**Acceptance:**
- Web: "tạo task họp Hải 2pm mai 45p" → hiện card + 2 nút → bấm Tạo → task xuất hiện trên board đúng field.
- Web: gõ "ok" sau card cũng tạo.
- Telegram: cùng flow qua inline keyboard.
- "done review code" → KHÔNG hiện card (vẫn instant).

> ⚠️ Đây là phần nhiều file nhất. Khuyến nghị execute theo thứ tự: KV helpers → responses → resolve-bằng-lệnh (test trên web/telegram bằng text) → nút web → nút telegram. Mỗi bước test được riêng.

---

## V6.1-D — Gom 15 intent → ~7 (RỦI RO NHẤT, làm cuối)

**Vấn đề:** `SYSTEM_PROMPT` ([src/prompts.js:6](src/prompts.js)) liệt kê 15 intent. Model 2.7 phân loại 15 lớp dễ sai → nhiều case rơi CLARIFY.

**Đề xuất gom:** `CAPTURE` · `UPDATE` · `EDIT` · `DELETE` · `QUERY` · `MATERIALS` · `CLARIFY`. Phần phân loại con (TRIAGE/LIST/OVERDUE/LOAD/REPORT/BACKLOG) dồn vào `notion_action.query_type`.

**Ripple cần xử lý đồng bộ (đừng bỏ sót):**
- `prompts.js`: rút gọn enum intent + INTENT ALIGNMENT + few-shot + RULES 10-16.
- `triage.js` intent auto-correction ([src/triage.js:500-521](src/triage.js)): `intentMap` đổi theo.
- `triage.js` analytics capture/completion tracking ([src/triage.js:532-545](src/triage.js)): các so sánh `=== 'CAPTURE_BATCH'`, `'TRIAGE'`, `'LIST_TASKS'` (xem cả `saveLastPlan` [src/triage.js:492](src/triage.js)).
- `case 'query'` ([src/triage.js:409](src/triage.js)) phải route theo `query_type` → gọi đúng response builder (hiện query chỉ trả raw, response_text để AI lo). Cần map `query_type → buildTriageResponse/buildListResponse/...` giống instant commands.
- Analytics intent names trong `stats` ([src/analytics.js:189](src/analytics.js)) chỉ là hiển thị → tự thích nghi.

**Vì rủi ro cao:** chỉ làm sau khi V6.1-A/B/C đã ổn và có test smoke (mục Testing). Nếu thời gian gấp → **tách phase riêng v6.1.x**, không block phần còn lại.

**Files:** `src/prompts.js`, `src/triage.js`.

---

# 🟡 PHASE V6.2 — Parked state + hỏi-trước-defer

**Goal:** task để-dành im lặng, không bị nhắc; chặn guilt-loop bằng hỏi-1-lần thay vì defer vô tận.

**Cơ chế (theo quyết định 0.1#1, mặc định A = tái dùng `Pending / Wait for approved`):**

## V6.2-A — Loại Parked khỏi các query "đang sống"

Trong `queryTasks` ([src/notion.js:202](src/notion.js)), thêm clause loại trạng thái Parked vào các filter sau:
- `today` ([src/notion.js:226](src/notion.js))
- `overdue` ([src/notion.js:264](src/notion.js))
- `all_active` ([src/notion.js:278](src/notion.js))

Thêm vào mỗi `and`:
```
{ property: 'State', status: { does_not_equal: 'Pending / Wait for approved' } }
```
> Nếu chọn phương án (B) status mới → đổi thành `'🅿️ Parked'` ở mọi chỗ.

**Thêm query type mới `parked`:**
```
case 'parked':
  filter = { property: 'State', status: { equals: 'Pending / Wait for approved' } };
  break;
```
Thêm `'parked'` vào `ALL_QUERY_TYPES` ([src/notion.js:56](src/notion.js)) + scope invalidation phù hợp (`status` scope nên thêm `'parked'` vào [src/notion.js:64](src/notion.js)).

**Board:** giữ Parked HIỂN THỊ trên board nhưng tách cột riêng (để không bị quên). `board_all` ([src/notion.js:287](src/notion.js)) hiện đã lấy mọi non-Completed → Parked vẫn xuất hiện. Trong `public/app.js` render board: thêm cột/nhóm "🅿️ Parked" lọc theo `status === 'Pending / Wait for approved'`. (Tùy chọn — có thể làm ở V6.3.)

## V6.2-B — Lệnh park / resume

- **Instant command** ([src/commands.js:13](src/commands.js)): thêm
  - `{ type: 'park', regex: /^(?:park|để dành|khoan làm)\s+(\S+(?:\s+\S+){0,5})$/i }`
  - `{ type: 'resume', regex: /^(?:resume|làm lại|tiếp tục)\s+(\S+(?:\s+\S+){0,5})$/i }`
  - `{ type: 'parked_list', regex: /^(?:parked|để dành|đang park)$/i }`
- `executeInstantCommand` ([src/commands.js:44](src/commands.js)):
  - `park` → `updateTaskStatus(name, 'Pending', env)` (statusMap đã map `'Pending' → 'Pending / Wait for approved'`, [src/notion.js:536](src/notion.js)). Trả "🅿️ Đã park '{title}'. Sẽ im cho tới khi 'resume'."
  - `resume` → `updateTaskStatus(name, 'To do', env)` + set lại Do Date = hôm nay (để hiện lại trên today). Cần hàm nhỏ hoặc dùng `editTask(name, { status:'To do', deadline: today })`.
  - `parked_list` → `queryTasks('parked', env)` + builder mới `buildParkedResponse` trong responses.js.
- **AI path:** thêm RULE trong prompts: "để dành / park / khoan làm X → EDIT với updates.status='Pending'; làm lại/resume X → status='To do'". (Nếu đã gom intent ở V6.1-D thì là UPDATE/EDIT.)

## V6.2-C — Auto-defer bỏ qua Parked (tự động xong)

`sendAutoDeferSummary` ([src/reminders.js:113](src/reminders.js)) dùng `queryTasks('today')` → sau V6.2-A, Parked đã không nằm trong 'today' → **tự động không bị defer, không tính vào summary**. ✅ Không cần sửa thêm. Morning briefing ([src/reminders.js:50](src/reminders.js)) + drift check ([src/reminders.js:87](src/reminders.js)) cũng dùng 'today' → tự im với Parked.

> Kiểm tra: xác nhận task Pending không lọt vào nhánh `remaining` ([src/reminders.js:124](src/reminders.js)). Sau V6.2-A thì không, vì nó không có trong list 'today'.

## V6.2-D — Hỏi-trước-defer cho chronic-defer (chống guilt-loop)

**Hiện trạng:** `getChronicDefers(env, 3)` ([src/analytics.js:156](src/analytics.js)) đã có, chỉ hiển thị trong `stats`. Auto-defer vẫn im lặng `bumpDeferCount` mỗi đêm ([src/reminders.js:146](src/reminders.js)).

**Việc cần làm trong `sendAutoDeferSummary` ([src/reminders.js:113](src/reminders.js)):**
- Trước khi defer, gọi `getChronicDefers(env, 3)`.
- Với task trong `remaining` mà ĐÃ defer ≥3 lần: **KHÔNG defer im lặng**. Thay vào đó gửi 1 message Telegram riêng kèm inline keyboard:
  ```
  🔁 "{title}" né {count} lần rồi. Tính sao?
  [🅿️ Park] [✂️ Chia nhỏ] [🗑️ Drop]
  ```
  callback_data: `chronic_park:{shortid}` / `chronic_split:{shortid}` / `chronic_drop:{shortid}`.
  - Vì callback_data ≤64 byte: lưu map `{shortid → taskId}` trong KV `chronicmap:{date}` TTL 1 ngày, hoặc dùng prefix taskId rút gọn. Notion page id 32 hex → `chronic_park:` (13) + 32 = 45 byte, **vừa đủ <64** → có thể nhét thẳng taskId, KHÔNG cần KV map. Dùng cách này.
- `handleCallbackQuery` ([src/telegram.js:80](src/telegram.js)) xử lý 3 callback mới:
  - `chronic_park` → `updateTaskStatusById(taskId, 'Pending', env)` + `clearDeferCount(env, taskId)`.
  - `chronic_drop` → archive (cần thêm hàm `archiveTaskById` trong notion.js — hiện chỉ có `archiveTask` theo title) + `clearDeferCount`.
  - `chronic_split` → trả gợi ý "Gõ: chia nhỏ {title}" (split phức tạp, để AI lo) hoặc mở mini-flow sau.
- Task chronic mà Matt chưa bấm gì → **vẫn defer như cũ** (không để task biến mất), nhưng chỉ hỏi **1 lần/ngày** cho mỗi task (tránh spam — đã tự nhiên vì mỗi đêm 1 message).

**Files:** `src/reminders.js`, `src/telegram.js`, `src/notion.js` (`archiveTaskById`).

## V6.2-E — Weekly Parked digest (chống "park rồi quên luôn")

Parked là vô thời hạn → rủi ro quên. Thêm 1 cron điểm lại:
- Trong `handleScheduled` ([src/reminders.js:11](src/reminders.js)): thêm nhánh, ví dụ **sáng thứ 2 8:05** (`vnDay===1 && vnHour===8 && vnMin===5`) → `sendParkedDigest(env)`:
  - `queryTasks('parked', env)`; nếu rỗng → không gửi.
  - Liệt kê ≤10 task Parked + nút inline `[Resume tất cả?]` hoặc gợi ý "resume {tên}".
- **Quan trọng:** kiểm `wrangler.toml` xem cron schedule có khớp phút 5 không. Hiện crons fire theo các mốc trong `handleScheduled`. Cần đảm bảo `wrangler.toml` có trigger cho phút :05 (xem mục Manual/Config).

**Files:** `src/reminders.js`, có thể `wrangler.toml`.

## V6.2-F — Note vs Task

"note/lưu lại/tham khảo X" → MATERIALS (project=MATERIALS, urgency=⚪ Someday) — **đã có sẵn** (prompts RULE 7 [src/prompts.js:90](src/prompts.js), đã loại khỏi today/board). Task-làm-sau → Parked. Chỉ cần đảm bảo prompt phân biệt rõ; không cần code mới.

---

# 🔵 PHASE V6.3 — Dọn field Notion + auto-derive

**Goal:** bớt số field Matt phải set tay; dọn cột rác; auto-điền field suy ra được.

## V6.3-A — Manual Notion (Matt làm tay, 1 lần) — checklist

> Agent execute KHÔNG làm được qua API. Viết hướng dẫn cho Matt, đánh dấu khi xong.

- [ ] **Xóa cột `Priority`** (đã đánh dấu 🗑️ ở v5.7, code không dùng).
- [ ] **Xóa/ẩn `Energy`** (code không đụng).
- [ ] **Ẩn `Parent item` / `Sub-item`** relation (code không đụng) khỏi view nhập tay.
- [ ] **(Nếu chọn Parked phương án B)** Thêm status option `🅿️ Parked` vào property `State`.
- [ ] **Tạo Notion view "⚡ Quick Add"**: chỉ hiện `Name`, `Context`(project), `Urgency`, `Deadline`, `Estimate` — ẩn phần còn lại, set default `Urgency = 🟡 Important`.
- [ ] **(Tùy chọn) Thêm view/cột nhóm "Parked"** để soi task đang park.

## V6.3-B — Auto-derive Block từ scheduled_time

`Block` (☀️AM/🌤️PM/🌙Power Block) hiếm khi được set. Trong `createTask` ([src/notion.js:105](src/notion.js)), khi có `scheduled_time` mà KHÔNG có `block`:
```
giờ < 12  → '☀️ AM'
12 ≤ giờ < 18 → '🌤️ PM'
giờ ≥ 18 → '🌙 Power Block'   // hoặc '🌙 Evening' — xem lưu ý
```
> ⚠️ Lưu ý ngữ nghĩa: `🌙 Power Block` đang mang nghĩa "ghim, không auto-defer" (prompts RULE 24, reminders [src/reminders.js:122](src/reminders.js)). Auto-derive giờ-tối thành Power Block sẽ vô tình ghim task tối → KHÔNG bị defer. **Quyết định:** chỉ auto-derive AM/PM; KHÔNG auto-set Power Block (Power Block chỉ khi Matt nói rõ "power block/giữ lại/pin"). Giờ ≥18 → để trống Block hoặc dùng nhãn Evening nếu Notion có option đó. Agent execute confirm option Block khả dụng trong Notion trước.

**Files:** `src/notion.js` (createTask).

## V6.3-C — Làm rõ 3 cột ngày (Deadline / Do Date / Scheduled)

**Hiện trạng:** `createTask` copy `Deadline = Do Date = due_date` y hệt ([src/notion.js:135-143](src/notion.js)); `editTask` cũng vậy ([src/notion.js:616-619](src/notion.js)). Ba cột ngày gây rối.

**Định nghĩa đề xuất (chốt với Matt):**
| Cột | Nghĩa | Dùng cho |
|-----|-------|----------|
| `Deadline` | Hạn cứng (do người khác/cam kết) | overdue thực sự |
| `Do Date` | Ngày *định làm* (di chuyển khi defer) | query 'today', board |
| `Scheduled` | Giờ cụ thể trên lịch | calendar grid |

**Thay đổi tối thiểu (an toàn):**
- Khi có `scheduled_time` → `Do Date` = ngày của scheduled (không phải copy mù due_date). Deadline giữ = due_date nếu Matt nói deadline, ngược lại để trống.
- Khi KHÔNG có deadline rõ ràng → **đừng set Deadline** (chỉ set Do Date = hôm nay). Tránh tạo "overdue giả" khi task chỉ là việc-định-làm-hôm-nay.
- `auto-defer` đã chỉ đụng `Do Date` ([src/reminders.js:143](src/reminders.js)) → đúng hướng, giữ nguyên.

> ⚠️ **Rủi ro cao:** đổi semantics ngày ảnh hưởng query 'today'/'overdue' và toàn bộ task cũ. **Bắt buộc:** (1) làm sau cùng; (2) test kỹ 'today'/'overdue' trước/sau; (3) cân nhắc backfill. Nếu ngại rủi ro → **giữ nguyên hành vi copy hiện tại**, chỉ làm V6.3-A + V6.3-B. Đánh dấu mục này **OPTIONAL**.

**Files:** `src/notion.js` (createTask, editTask).

---

# 🧪 Testing (xuyên suốt, không có CI — bám smoke test sẵn có)

Hiện chỉ có smoke test thủ công: `test-agent.sh`, `test-full.sh`, `test-calendar.sh`, `test-ui.sh`, `test-browser.mjs`.

**Mỗi phase phải bổ sung case vào `test-agent.sh` trước khi coi là xong:**
- V6.1-A: "tạo task X 30p" không tăng `ai_calls` (kiểm qua `/api/analytics` hoặc log).
- V6.1-C: chuỗi tạo → confirm "ok" → task tồn tại; tạo → "không" → không tạo.
- V6.2: park X → X biến khỏi `plan`/`list`/`overdue`, hiện trong `parked`; resume X → quay lại.
- V6.2-D: mô phỏng task deferCount≥3 → 23:30 gửi message hỏi (test thủ công qua Telegram).
- V6.3-B: tạo task "9am" → Block=☀️ AM tự động.

**Regression bắt buộc chạy lại:** `done N`, `done <tên>`, `plan`, `list`, `overdue`, calendar schedule — đảm bảo confirm-card/Parked không phá luồng cũ.

---

# 📋 Thứ tự execute đề xuất

1. **V6.1-A** (deterministic-first + tách parsers) — gỡ nợ AUDIT L4, lợi ngay.
2. **V6.1-B** (JSON-repair) — nhỏ, độc lập, rủi ro thấp.
3. **V6.1-C** (confirm-card) — nhiều file; làm theo sub-order: KV → responses → resolve-bằng-lệnh → nút web → nút telegram.
4. **Deploy + dùng thử vài ngày.**
5. **V6.2-A→C** (Parked core).
6. **V6.2-D** (hỏi-trước-defer) + **V6.2-E** (digest).
7. **Deploy + dùng thử.**
8. **V6.3-A** (Matt làm tay Notion) + **V6.3-B** (auto Block).
9. **V6.1-D** (gom intent) — khi đã có test, nếu Matt muốn.
10. **V6.3-C** (semantics ngày) — OPTIONAL, rủi ro cao, cuối cùng.

---

# ⚙️ Manual / Config cần lưu ý

- **`wrangler.toml`**: kiểm cron triggers hiện có khớp các mốc phút mới (V6.2-E dùng :05). Nếu cron chỉ fire :00/:30 thì đổi mốc digest về :00 hoặc thêm trigger. Đọc `[triggers] crons` trước.
- **`/api/tasks/create`** ([src/index.js:232](src/index.js)) cần mở rộng nhận thêm field (estimate, scheduled_time, assigned_by, block, due_date) cho confirm-card web — hiện chỉ nhận title/project/urgency/source/deadline/resource.
- **Version bump**: cập nhật `version: '5.8.0'` trong health check ([src/index.js:202](src/index.js)) → `6.0.0`, và header version comment các file đụng tới.
- **Cache invalidation**: thêm `'parked'` vào `ALL_QUERY_TYPES` + `INVALIDATION_SCOPES.status` ([src/notion.js:56-68](src/notion.js)).
- **Cập nhật docs**: ghi changelog vào `context.md` / `AUDIT.md` (đánh dấu L4 đã fix khi tách parsers).

---

# 🚫 KHÔNG đụng (out of scope plan này)

- Auth SHA-256 (OK cho single-user).
- Thư mục `sandbox/` (không liên quan dự án).
- Đổi model khỏi MiniMax-M2.7 (Matt đã chốt giữ).
- Rate limiter / CORS (AUDIT M2/M3 — chấp nhận được).

---

# 🎯 Định nghĩa "Done" cho v6.0

- [ ] Tạo task qua chat có confirm-card (web + Telegram); deterministic parse né AI cho câu rõ ràng.
- [ ] `ai_failure_rate` trong `stats` giảm so với baseline v5.8.
- [ ] Park/resume hoạt động; task Parked im hoàn toàn (không briefing, không drift, không auto-defer).
- [ ] Task né ≥3 lần được hỏi Park/Drop thay vì defer im lặng; có digest Parked hằng tuần.
- [ ] Block auto-derive AM/PM; cột Priority/Energy đã dọn trên Notion.
- [ ] Smoke test mở rộng pass; regression done/plan/list/overdue/calendar pass.
