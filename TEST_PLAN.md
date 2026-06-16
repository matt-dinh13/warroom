# 🧪 Stratt — Test Plan cho Worker 2 (verify sau khi Worker 1 implement)

> Đầu vào: Worker 1 đã làm [PLAN_V6_FIXES.md](PLAN_V6_FIXES.md) (bug A1-A3, đánh dấu cột C) + [PLAN_PLANNER.md](PLAN_PLANNER.md) (Planner Engine).
> Mục tiêu: verify **độc lập**, tốn token tối thiểu. Worker 2 KHÔNG sửa code — chỉ test + báo cáo pass/fail. Nếu fail → ghi rõ repro, KHÔNG tự fix (trả về cho Worker 1).

---

## 0. Quy tắc test (đọc trước)

**Thứ tự theo độ rẻ token → đắt.** Dừng và báo ngay nếu một tier fail nặng.

| Tier | Cần gì | Side-effect |
|---|---|---|
| 1. Pre-flight (build/syntax) | wrangler | không |
| 2. **Unit test planner** (pure func) | node | **không** ⭐ trọng tâm |
| 3. Smoke endpoint | wrangler dev + keys | ⚠️ ghi Notion thật |
| 4. Manual UX (web/Telegram) | trình duyệt/Telegram | ⚠️ ghi Notion thật |

### ⚠️ An toàn dữ liệu Notion (BẮT BUỘC)
Tier 3-4 ghi vào DB "Today" thật. Để không làm bẩn dữ liệu Matt:
- Mọi task test phải có prefix tiêu đề **`ZZTEST_`** (VD `ZZTEST_review code`).
- **Cleanup cuối phiên:** archive toàn bộ task `ZZTEST_*` (gọi `bulkArchiveTasks` với filter Name contains `ZZTEST_`, hoặc xoá tay).
- KHÔNG chạy auto-defer/cron thật lên dữ liệu thật — test cron bằng cách gọi trực tiếp hàm với data giả (xem Tier 2/3).
- Nếu có DB Notion staging riêng → ưu tiên trỏ `.dev.vars` sang đó.

### Báo cáo cuối (format cố định — để người đọc chỉ liếc summary)
```
## TEST REPORT — <ngày>
Build: PASS/FAIL
Unit planner: X/Y pass
Smoke: X/Y pass
Manual UX: X/Y pass
FAILS:
- [ID] <mô tả ngắn> | repro: <...> | expected: <...> | actual: <...>
Cleanup: ZZTEST_ tasks archived? yes/no
```

---

## TIER 1 — Pre-flight (gần như miễn phí)

- [ ] **T1.1 Build:** `npx wrangler deploy --dry-run --outdir /tmp/st-test` → exit 0, không lỗi import/bundle.
- [ ] **T1.2 Syntax:** `node --check` từng file trong `src/` (đặc biệt file mới `src/planner.js`).
- [ ] **T1.3 Export sanity:** grep nhanh các hàm mới được export đúng: `buildDayPlan` (planner.js), `applyDayPlan` (notion.js), `buildDayPlanResponse` (responses.js), lệnh `plan_day/replan/week_intake` (commands.js).

---

## TIER 2 — Unit test Planner Engine ⭐ (trọng tâm, 0 side-effect)

> `buildDayPlan` được thiết kế **pure function** ([PLAN_PLANNER.md](PLAN_PLANNER.md) mục 2). Worker 2 **tạo file `test-planner.mjs`** dùng `node:assert`, import từ `src/planner.js`, chạy `node test-planner.mjs`. Đây là phần test giá trị nhất — KHÔNG cần Notion, KHÔNG cần MiniMax, deterministic.

Mỗi case = 1 fixture mảng task + assert kết quả. Cần phủ:

- [ ] **U1 Anchor cố định:** task có `scheduled` 10:00 → xuất hiện đúng 10:00 trong `timeline`, không bị dời.
- [ ] **U2 Vừa sức:** tổng `estimate` của `selected` ≤ capacity ngày. Task vượt trần → không nằm trong selected.
- [ ] **U3 Must-include guard (RAIL):** task 🔴 Fire và task deadline=hôm nay **luôn** trong `selected` kể cả khi điểm thấp.
- [ ] **U4 Overcommit must-do:** nếu chỉ riêng Fire+deadline-hôm-nay đã > capacity → trả `overflow` + KHÔNG auto-park các must-do đó (kiểm `parked` không chứa chúng).
- [ ] **U5 Auto-park đúng đối tượng (RAIL):** chỉ task ⚪Someday/🟢Wait **và** không deadline gần mới vào `parked`. Task Fire/deadline-gần **tuyệt đối không** trong `parked`.
- [ ] **U6 Đẩy vs park:** task Important không vừa nhưng có deadline gần → vào `pushed` (dời Do Date), không phải `parked`.
- [ ] **U7 Fill estimate:** task thiếu `estimate` → được gán đề xuất (mặc định 30p / heuristic) và đánh dấu `estimate_suggested`.
- [ ] **U8 Sequencing:** có lunch (12:00–13:00) chèn vào, có buffer giữa task, **không task nào overlap**, việc 🔴/nặng nằm buổi sáng.
- [ ] **U9 Re-plan giữa ngày:** gọi với `now=14:00` → timeline chỉ từ 14:00→17:00, bỏ anchor đã qua, bỏ task Completed.
- [ ] **U10 Khung giờ:** dayType office → window 10–17; wfh → 9–17; weekend → cấu hình weekend. Task không tràn ngoài window.
- [ ] **U11 Rỗng/biên:** 0 task → timeline rỗng, không crash. 1 task lớn hơn cả ngày → overflow hợp lý.

**Pass = tất cả assert xanh.** Ghi số pass/tổng.

---

## TIER 3 — Smoke endpoint (ghi Notion thật → dùng `ZZTEST_`)

Chạy `npx wrangler dev` (cần `.dev.vars` đủ key) hoặc test trên deployment. Dùng curl kèm cookie auth (login trước qua `/api/auth`).

### v6 fixes
- [ ] **S1 (A1 analytics):** gọi `/api/analytics?days=1`, ghi baseline `ai_calls`. Tạo 1 task qua AI (câu mơ hồ ép qua AI, VD "ê nhờ làm `ZZTEST_` báo cáo gấp") → confirm "ok". Gọi lại analytics: `ai_calls` +1, `interactions` +2, `captures` +1. **(Đây là bug chính cần xác nhận đã fix.)**
- [ ] **S2 (A2 overload):** tạo >6 task `ZZTEST_` hôm nay → tạo thêm 1 + confirm → response chứa cảnh báo "tasks rồi đó…".
- [ ] **S3 (A3 nguồn, nếu làm):** "tạo task `ZZTEST_` X 30 phút dự án GMA" → confirm → `captures.direct_parse` tăng (không phải `confirm_command`).

### v6 đã build (confirm-card / Parked)
- [ ] **S4 Confirm tạo:** "tạo task `ZZTEST_` Y 30p" → response `needs_confirmation:true` + `pending_action`. Gửi "ok" → task tồn tại trong Notion (query). Gửi case khác "hủy" → KHÔNG tạo.
- [ ] **S5 Pending clear:** sau "ok", gửi "ok" lần nữa → không tạo trùng (pending đã clear).
- [ ] **S6 Park/Resume:** tạo `ZZTEST_` Z → `park ZZTEST_ Z` → biến mất khỏi `plan`/`list`/`overdue`, có trong `parked`. `resume ZZTEST_ Z` → quay lại `plan`.
- [ ] **S7 Parked exclusion:** task Parked không xuất hiện trong query `today`/`overdue`/`all_active`.
- [ ] **S8 Auto-derive Block:** tạo `ZZTEST_` "9am" → task có Block=☀️ AM; "14h" → 🌤️ PM; KHÔNG tự set Power Block.

### Notion column marking (C)
- [ ] **S9:** gọi `POST /api/mark-columns-for-deletion {columns:["Priority","Energy"]}` → trả summary. Verify: cột select/text có "DELETE ME" ở vài row; cột relation (Parent/Sub-item) được **skip + báo** chứ không crash. (Cẩn thận: chạy trên DB staging hoặc chấp nhận ghi thật rồi Matt xoá.)

### Planner integration
- [ ] **S10 Xếp lịch:** tạo vài task `ZZTEST_` (có/không giờ, urgency khác nhau) → gửi `xếp lịch` → response là timeline giờ-by-giờ + report park/đẩy. Gửi "ok" → query Notion xác nhận: selected có `scheduled_time`+`Do Date`, parked → status Pending, pushed → Do Date sang mai.
- [ ] **S11 Xếp lại:** sau khi có lịch, gửi `xếp lại` → timeline bắt đầu từ giờ hiện tại.
- [ ] **S12 Lịch tuần:** gửi `lịch tuần` → agent hỏi; trả lời văn nói "thứ 3 họp 10h, thứ 5 WFH" → tạo anchor scheduled tương ứng (kiểm parse đúng).

### Regression (không được vỡ)
- [ ] **S13:** `done N` (sau `plan`), `done <tên>`, `plan`, `list`, `overdue`, `report`, `backlog`, `materials`, `stats` — tất cả trả đúng, không 500.

---

## TIER 4 — Manual UX (web + Telegram)

- [ ] **M1 Web confirm:** mở app → "tạo task `ZZTEST_` họp 2pm 45p" → hiện thẻ + 2 nút. Bấm **✅ Tạo** → task tạo. Lần khác bấm **✏️ Sửa** → input được nạp lại + nháp huỷ.
- [ ] **M2 Telegram confirm:** gửi task qua Telegram → inline `✅ Tạo`/`❌ Bỏ` hoạt động.
- [ ] **M3 Chronic-defer prompt:** (khó tái hiện tự nhiên) — set thủ công KV `defercount:<id>` count=3 cho 1 task `ZZTEST_` có Do Date hôm nay, gọi trực tiếp `sendAutoDeferSummary(env)` → Telegram nhận message "né 3 lần" + nút Park/Split/Drop. Bấm từng nút → verify: Park→Pending, Drop→archived, Split→gợi ý chia nhỏ.
- [ ] **M4 Parked digest:** gọi trực tiếp `sendParkedDigest(env)` với ≥1 task Parked → Telegram nhận digest; 0 task → KHÔNG gửi.
- [ ] **M5 Morning briefing = planner:** gọi `sendMorningBriefing(env)` → nội dung là timeline planner (không còn flat-list cũ).
- [ ] **M6 Calendar:** task đã `scheduled_time` hiện đúng ô trên calendar grid; kéo-thả đổi giờ vẫn lưu.

---

## 5. Ma trận RAIL (kiểm riêng — đây là chỗ dễ sai & nguy hiểm nhất)

Planner "tự park" → 3 rail PHẢI đúng (trùng U3/U4/U5 nhưng kiểm lại end-to-end ở S10):
- [ ] **R1:** task 🔴 Fire KHÔNG bao giờ bị auto-park/đẩy im lặng.
- [ ] **R2:** task deadline ≤ vài ngày KHÔNG bị auto-park.
- [ ] **R3:** mọi task bị park/đẩy đều xuất hiện trong report cho Matt + `resume` được.
- [ ] **R4:** must-do tràn giờ → hệ thống **hỏi Matt cắt**, không tự quyết.

Nếu bất kỳ R nào fail → đánh dấu **BLOCKER**, báo ngay (mất niềm tin = hỏng cả tính năng).

---

## 6. Phụ thuộc / điều kiện bỏ qua
- Nếu Worker 1 chưa làm Planner (mới xong fixes v6) → chạy Tier 1 + S1-S9 + M1-M4, **skip** Tier 2/S10-S12/M5 và ghi "planner chưa build".
- Nếu thiếu Telegram token trong env → skip M2-M5, ghi rõ.
- B1 (gom intent) / B2 (semantics ngày) trong PLAN_V6_FIXES là optional — chỉ test nếu Worker 1 báo đã làm.
