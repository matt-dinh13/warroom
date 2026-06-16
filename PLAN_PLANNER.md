# 🧠 Stratt v7 — Planner Engine: tự xếp task vào khung giờ

> Tiếp nối [PLAN_V6.md](PLAN_V6.md) + [PLAN_V6_FIXES.md](PLAN_V6_FIXES.md).
> **Đây là hướng chính sau review chiến lược 2026-06-16.** Stratt giỏi NHẬN việc; phần này cho nó biết SẮP việc.
> Người execute: agent khác. Nguyên tắc: plan/brainstorm only ở session này.

---

## 0. Vấn đề & định hướng (đã chốt với Matt)

Matt quá tải → không biết bắt đầu từ đâu → ngợp → không biết phân phối lại. Công cụ hiện chỉ *đo & nhắc* sự quá tải, không *hấp thụ* nó. Cần một **Daily Planner**: đọc hết task → chọn việc vừa sức ngày → xếp vào khung giờ thật → việc thừa tự park/đẩy rồi báo.

**Lựa chọn Matt đã chốt:**
| Khía cạnh | Quyết định |
|---|---|
| Lịch cố định | Matt tự nhập meeting (task có `scheduled_time`); **agent hỏi lịch đầu tuần** để gom mốc cố định. KHÔNG tích hợp Google Calendar. |
| Phong cách | **Quyết hẳn** — xếp sẵn giờ-by-giờ, Matt làm theo. |
| Cắt việc | **Tự park/đẩy** cho vừa sức, báo sau (autonomy cao, có rail). |
| Khung giờ | Office **10:00–17:00**; WFH bắt đầu **9:00**. Lunch giả định 12:00–13:00 (⚠️ cần Matt xác nhận). |
| Estimate | Cả hai: planner **đề xuất estimate** cho task trống, Matt cũng chủ động set. |

> 🎯 **Điểm vàng:** lõi planner (chọn việc + xếp giờ) là **thuật toán thuần, KHÔNG cần MiniMax**. Nghĩa là tính năng giá trị nhất lại *không* phụ thuộc vào điểm yếu lớn nhất của hệ thống (AI chập chờn). LLM chỉ dùng để (a) parse lịch tuần dạng văn nói, (b) tùy chọn câu chữ. → vừa giải bài toán scheduling, vừa né bài toán độ tin cậy.

---

## 1. Cấu hình khung giờ

Thêm config (trong `responses.js` cạnh `getVNContext`, hoặc file `config.js` mới):
```js
const WORK_HOURS = {
  office:  { start: 10, end: 17 },   // T2-T5
  wfh:     { start: 9,  end: 17 },   // T6 (và ngày Matt đánh dấu WFH qua intake tuần)
  weekend: { start: 10, end: 16 },   // nhẹ
};
const LUNCH = { start: 12, end: 13 };  // ⚠️ xác nhận với Matt
const BUFFER_MIN = 10;                 // đệm giữa 2 task
```
- Day type lấy từ `getVNContext` (đã có isFriday/isWeekend) — Friday = wfh. Intake tuần (mục 4) có thể override day type cho từng ngày (VD "thứ 3 tôi WFH").
- `capacity` hiện có (330 office / 420 wfh / 120 weekend) = **trần phút focus**. Work window dùng để *đặt* task; capacity dùng để *giới hạn* tổng.

---

## 2. Planner Engine — `src/planner.js` (file mới)

Hàm chính: `buildDayPlan(tasks, { dayType, capacity, workHours, now }) → { timeline, selected, parked, pushed, overflow }`. **Pure function, dễ test.**

### Bước 2.1 — Gom & phân loại candidates
- Input `tasks` = `queryTasks('all_active')` + task có `scheduled` hôm nay (anchors). Loại Completed, Parked (`Pending / Wait for approved`), MATERIALS.
- Tách:
  - **Anchors** = task có `scheduled` rơi vào ngày target → khối cố định, đặt nguyên.
  - **Floating** = task chưa có giờ.

### Bước 2.2 — Fill estimate đề xuất
- Floating task thiếu `estimate` → gán đề xuất:
  - heuristic v1 đơn giản: Fire/Important → 45p; Wait → 30p; Someday → 30p; hoặc mặc định **30p**.
  - đánh dấu `estimate_suggested: true` để hiển thị "~30p (đề xuất)" cho Matt sửa.

### Bước 2.3 — Chấm điểm & xếp hạng floating
```
score = urgencyWeight + deadlineBonus + deferNudge
  urgencyWeight: 🔴100 / 🟡50 / 🟢20 / ⚪5
  deadlineBonus: overdue +200 · hôm nay +150 · ≤2 ngày +80 · ≤7 ngày +30
  deferNudge:    +10 mỗi lần đã defer (chronic nổi lên)
```

### Bước 2.4 — Tính giờ focus khả dụng
`available = (work window) − (anchors) − lunch − buffers`. So với `capacity`, lấy `min(available, capacity)`.

### Bước 2.5 — Chọn-để-vừa-sức (triage)
- Greedy theo score giảm dần, cộng dồn `estimate` tới khi chạm trần.
- **Must-include guard (RAIL):** task 🔴 Fire **hoặc** deadline ≤ hôm nay = BẮT BUỘC chọn.
  - Nếu riêng must-include đã > trần → **KHÔNG auto-park must-do**. Trả `overflow` + thông điệp: *"Ngay cả việc bắt buộc đã vượt giờ (~Xh/Yh). Cần cắt/đẩy gì đó — bạn quyết."* (ép Matt quyết, không im lặng).
- **Việc không được chọn → xử lý + báo:**
  - urgency Wait/Someday **và** không deadline gần → **auto-park** (status Pending).
  - còn lại → **đẩy Do Date** sang ngày tới còn room.
  - ⚠️ **RAIL:** không bao giờ auto-park Fire / deadline gần. Mọi auto-park/đẩy phải vào `report` + undo 1 chạm (`resume X`).

### Bước 2.6 — Xếp vào timeline
- Đặt anchors đúng giờ. Chèn lunch + buffer.
- Lấp khe trống bằng `selected`, thứ tự: **việc nặng/Fire vào buổi sáng** (peak focus), việc nhẹ buổi chiều. Power Block (🌙) giữ buổi tối nếu có.
- (v2: dùng analytics hourly heatmap [src/analytics.js](src/analytics.js) để xếp theo giờ Matt năng suất thật — chưa làm v1.)

### Bước 2.7 — Output
Trả `{ timeline: [{time, task, kind}], parked: [...], pushed: [...], overflow: [...] }`.

---

## 3. Áp dụng kế hoạch (tái dùng infra confirm-card v6)

- `buildDayPlanResponse(plan)` trong `responses.js` → render giờ-by-giờ + report park/đẩy (mẫu trong phần "ví dụ" dưới).
- **Reuse `savePendingTask`/getPending/clear** (đã có ở v6): lưu nguyên kế hoạch như pending dạng `{ type:'apply_plan', plan }`. Matt gõ **"ok"** (hoặc nút) → `applyDayPlan(plan, env)`:
  - `selected`: ghi `scheduled_time` + `Do Date` (hàm batch trong `notion.js`, dùng `updateTaskScheduleById`/`editTask`).
  - `parked`: `updateTaskStatusById(id, 'Pending')`.
  - `pushed`: PATCH `Do Date` sang ngày đích.
- Vì là "quyết hẳn", apply ghi nguyên ngày trong 1 lượt. Báo lại "đã xếp 6 việc, park 4, đẩy 1".

> Đây là chỗ confirm-card v6 phát huy đúng giá trị: xác nhận **một kế hoạch** (đáng confirm) thay vì xác nhận từng task lẻ (phiền).

---

## 4. Intake đầu tuần — `lịch tuần`

Theo ý Matt "agent hỏi lịch từ đầu tuần":
- **Trigger:** lệnh `lịch tuần` (instant command) + tự động **sáng thứ 2** (mở rộng nhánh cron 8:00 thứ 2 trong [src/reminders.js](src/reminders.js), nơi đã có parked digest).
- Agent hỏi: *"Tuần này có gì cố định? (họp, hẹn, ngày WFH) — gõ tự nhiên, mình xếp."*
- Matt trả lời văn nói → **dùng MiniMax** parse thành các task có `scheduled_time` (đây là chỗ LLM thực sự cần) → tạo anchor cho cả tuần. Day-type override (WFH ngày nào) lưu KV `weekcfg:{weekStart}`.
- Daily planner đọc anchors này mỗi sáng.

---

## 5. Lệnh & trigger

| Lệnh | Việc |
|---|---|
| `xếp lịch` / `plan ngày` | Daily planner cho hôm nay → kế hoạch + confirm. |
| `xếp lại` | **Re-plan giữa ngày** (RAIL quan trọng cho ADHD): chạy lại từ `now` → cuối ngày, chỉ task chưa xong, bỏ anchor đã qua. |
| `lịch tuần` | Intake đầu tuần (mục 4). |
| Cron 8:00 (T2-T6) | Morning briefing **thay bằng** output planner (thay `sendMorningBriefing` flat-list bằng `buildDayPlanResponse`). |
| Cron 8:00 thứ 2 | + nhắc `lịch tuần`. |

Thêm vào `SAFE_COMMANDS` ([src/commands.js](src/commands.js)): `plan_day` (`/^(?:xếp lịch|plan ngày|lên lịch)$/i`), `replan` (`/^(?:xếp lại|re-?plan|lên lại)$/i`), `week_intake` (`/^(?:lịch tuần|tuần này)$/i`).

---

## 6. Files đụng tới (tổng quan)

| File | Việc |
|---|---|
| `src/planner.js` (mới) | Engine: gom, fill estimate, score, select, sequence. Pure functions. |
| `src/responses.js` | `buildDayPlanResponse`, config WORK_HOURS/LUNCH, reconcile capacity. |
| `src/commands.js` | 3 lệnh mới (`plan_day`/`replan`/`week_intake`) + execute. |
| `src/triage.js` | Wire pending `apply_plan` vào nhánh resolve "ok" (cạnh confirm-capture v6). |
| `src/notion.js` | `applyDayPlan` batch writer; `updateTaskScheduleById` nếu chưa có; query phục vụ planner. |
| `src/reminders.js` | Morning briefing → planner output; thứ 2 nhắc lịch tuần. |
| `src/minimax.js`/`prompts.js` | Prompt parse "lịch tuần" → scheduled tasks (chỉ phần intake). |

---

## 7. Ví dụ output (đích nhắm)

```
📅 Thứ 4 16/6 — Office (focus ~5.5h)

🕙 10:00  🔴 Fix bug thanh toán GMA (45p)
🕦 10:55  📌 [Họp] Review sprint — cố định
🕛 11:40  🔴 Viết spec API HOSEL (60p)
🍜 12:40  Nghỉ trưa
🕐 13:00  🟡 Chuẩn bị deck SALES (~45p · đề xuất)
🕑 14:00  🟡 Trả lời feedback Empulse (30p)
🕒 15:00  📌 [Họp] 1-1 — cố định
🕓 16:00  🟡 Review PR (30p)

✅ Khít 4h10 / 5.5h. Gõ "ok" để chốt lịch.

🅿️ Auto-park 4 (chưa gấp): Nghiên cứu X · Đọc Y ...
➡️ Đẩy mai (deadline T6 còn kịp): Soạn báo cáo
⚠️ "Refactor auth" né 4 lần — park / chia nhỏ?
```

---

## 8. Phasing đề xuất

- **P1 — Core deterministic planner** (mục 1,2,3 + lệnh `xếp lịch`/`xếp lại`): giá trị cao nhất, không đụng LLM. Ship trước.
- **P2 — Intake tuần** (mục 4): cần LLM parse, thêm cron T2.
- **P3 — Morning briefing → planner** (mục 5): thay flat-list bằng plan.
- **P4 — Energy-aware** (analytics heatmap), tinh chỉnh estimate heuristic.

---

## 9. Rủi ro & lưu ý thành thật

- **Estimate thiếu** → chất lượng xếp phụ thuộc heuristic. Mitigate: đề xuất + cho sửa; theo thời gian Matt set quen tay.
- **Lunch/buffer là giả định** → cần Matt xác nhận, để config.
- **"Quyết hẳn" + auto-park = autonomy cao** → 3 RAIL bắt buộc (must-do guard, không park việc gấp, undo dễ + report rõ). Nếu thiếu rail, planner sẽ park nhầm và mất niềm tin → hỏng cả tính năng.
- **Re-plan giữa ngày là bắt buộc**, không phải nice-to-have: kế hoạch sáng sẽ vỡ; không có `xếp lại` thì "quyết hẳn" thành gánh nặng tội lỗi.
- **Quan hệ với v6 fixes:** planner KHÔNG phụ thuộc confirm-card polish. Đề nghị ưu tiên planner P1 trước các fix B/C của v6.
```
