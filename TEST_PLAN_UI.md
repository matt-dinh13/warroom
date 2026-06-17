# 🧪 Test Plan UI v2.0 — cho Worker 2 (verify sau khi Worker 1 làm [PLAN_UI.md](PLAN_UI.md))

> Bổ sung cho [TEST_PLAN.md](TEST_PLAN.md). File kia test backend/planner; file này test **mặt UI v2.0 + versioning/rollback**.
> Worker 2 chỉ verify + báo cáo pass/fail, **KHÔNG tự fix** (fail → trả Worker 1 kèm repro).
> Hành vi planner (chọn việc/RAIL) đã test ở TEST_PLAN.md — ở đây chỉ test **UI có hiển thị & thao tác đúng** trên output đó.

---

## 0. Quy tắc (đọc trước)

- **Thứ tự bắt buộc:** Tier 1 (versioning) TRƯỚC — vì rủi ro lớn nhất là làm hỏng bản cũ. Fail Tier 1 = BLOCKER, dừng và báo ngay.
- **An toàn dữ liệu Notion:** mọi task test prefix `ZZTEST_`, cleanup (archive) cuối phiên (giống TEST_PLAN.md §0).
- **Harness:** tái dùng/ mở rộng `test-browser.mjs` (đã có ở root) cho DOM/interaction; routing dùng `curl`.
- **Báo cáo cuối (format cố định):**
```
## UI TEST REPORT — <ngày>
Routing/rollback: PASS/FAIL   (BLOCKER nếu fail)
Today view: X/Y
Navigation: X/Y
Estimate + small fixes: X/Y
Visual/regression: X/Y
FAILS: [ID] mô tả | repro | expected | actual
Cleanup ZZTEST_: yes/no
```

---

## TIER 1 — Versioning & Rollback ⭐ (BLOCKER, test đầu tiên)

Theo [PLAN_UI.md](PLAN_UI.md) §8. Dùng `curl -sI` / `curl -s` (rẻ, deterministic).

- [ ] **V1 Bản cũ còn nguyên:** `GET /v1` → 200, trả HTML bản cũ (kiểm marker đặc trưng v1, vd tab "💬 Chat" mặc định / cấu trúc cũ). Mọi asset v1 (`/app.js`, `/style.css`) → 200.
- [ ] **V2 Bản mới có:** `GET /v2` → 200, trả HTML v2. Assets dưới `/v2/` (`/v2/app.js`, `/v2/style.css`) → 200, **không 404** (kiểm đường dẫn tương đối trỏ đúng).
- [ ] **V3 Công tắc mặc định:** với `DEFAULT_UI='v1'` → `GET /` trả v1. Đổi `DEFAULT_UI='v2'` + deploy → `GET /` trả v2. (Verify đúng 1 công tắc điều khiển.)
- [ ] **V4 Rollback:** đổi `DEFAULT_UI` lại `'v1'` → `GET /` về v1 ngay, không lỗi. (Đây là kịch bản roll back thật.)
- [ ] **V5 API dùng chung:** từ cả `/v1` và `/v2`, gọi `/api/health` + 1 lệnh chat → cùng hoạt động (không fork backend).
- [ ] **V6 localStorage không đạp nhau:** mở `/v1` tạo ít lịch sử chat → mở `/v2` → v2 KHÔNG vỡ/đọc nhầm dữ liệu v1 (key namespace riêng `stratt_v2_*`). Chuyển qua lại không mất/hỏng state.
- [ ] **V7 PWA manifest:** `start_url` vẫn `/`; `manifest.json` load 200; (kiểm icon ở Tier 4).

> Nếu bất kỳ V1-V4 fail → **BLOCKER**: bản cũ hoặc đường rollback hỏng → dừng, báo ngay.

---

## TIER 2 — Today view (tính năng lõi của v2)

Mở `/v2` (hoặc `/` khi DEFAULT_UI=v2). Cần vài task `ZZTEST_` + đã chạy `xếp lịch` để có plan.

### DOM / render (script hoá bằng test-browser.mjs)
- [ ] **T1 Mặc định Today:** v2 mở ra ở tab "Hôm nay" (không phải Chat). `#today-view` (hoặc id tương đương) visible.
- [ ] **T2 Thẻ "Việc tiếp theo":** hiển thị đúng task đầu tiên-chưa-xong trong timeline planner; có title to + meta (estimate/project/giờ) + 2 nút Xong / Để sau.
- [ ] **T3 Timeline:** render các block planner đúng thứ tự giờ; anchor (họp) đánh dấu "cố định"; việc đã xong gạch mờ; có vạch "now" nếu trong khung giờ làm.
- [ ] **T4 Empty state:** khi chưa có plan hôm nay → hiện nút lớn "Xếp lịch hôm nay" (KHÔNG để màn trống).
- [ ] **T5 Banner park/đẩy:** khi planner có auto-park/đẩy → hiện banner gọn "đã park N · đẩy M" + lối undo (resume).

### Interaction
- [ ] **T6 Xong:** bấm Xong trên thẻ → task → Completed (verify Notion), thẻ tự nhảy sang việc kế tiếp.
- [ ] **T7 Để sau:** bấm Để sau → task bị đẩy/xuống slot sau (verify thay đổi), thẻ cập nhật.
- [ ] **T8 Xếp lại:** bấm "Xếp lại" → gọi re-plan từ giờ hiện tại (xem TEST_PLAN.md S11); timeline cập nhật, confirm "ok" áp dụng được.

---

## TIER 3 — Navigation & hạ vai trò Board/Calendar

- [ ] **N1 Bottom nav:** có 4 mục Hôm nay / Lịch / Board / Ghi(+); "Hôm nay" active mặc định; chuyển tab hoạt động.
- [ ] **N2 Capture "Ghi" luôn sẵn:** nút + mở ô nhập từ bất kỳ tab nào; gõ "tạo task `ZZTEST_` X" → vào luồng capture/confirm như cũ (không phải nhảy hẳn vào tab Chat).
- [ ] **N3 Board hạ cấp:** Board KHÔNG còn là tab mặc định; cột "To Do" giới hạn top N + nút "xem thêm" (không xổ toàn bộ).
- [ ] **N4 Calendar phản chiếu plan:** sau `xếp lịch`, các block tự xếp hiện trên calendar; modal tap-để-xếp giờ chỉ còn để CHỈNH (không phải tương tác chính).
- [ ] **N5 Chat vẫn còn:** truy cập được như ô nhập + log hội thoại (không bị xoá, chỉ hạ vai trò).

---

## TIER 4 — Estimate inline + lỗi nhỏ

- [ ] **E1 Estimate sửa tại chỗ:** trên card (Board/Today), tap số estimate → sửa → lưu (verify Notion cập nhật).
- [ ] **E2 Estimate "đề xuất":** task planner tự đoán estimate hiện mờ + dấu `~`.
- [ ] **E3 Icon PWA:** `/icon-192.png` và `/icon-512.png` > 0 byte, load 200, hiển thị logo (không còn rỗng).
- [ ] **E4 Nhãn cột:** cột Pending đổi thành "🅿️ Để dành" (khớp ngôn ngữ park/resume).

---

## TIER 5 — Visual / theme / responsive (manual, eyeball + screenshot)

- [ ] **R1 Theme giữ navy Phong Thủy:** v2 dùng đúng token màu cũ (navy/OKLCH), KHÔNG sinh hệ màu mới.
- [ ] **R2 Light/Dark:** nút toggle theme hoạt động trên v2; cả 2 mode đọc được.
- [ ] **R3 iPad/responsive:** layout Today + nav hiển thị tốt ở khổ iPad (PWA), touch target ≥44px.
- [ ] **R4 Không lỗi console:** mở v2, thao tác cơ bản → console không có error đỏ; không 404 asset.
- [ ] **R5 Bớt-đi không thêm:** Today view gọn hơn Board cũ (1 việc nổi + timeline + 1 nút), không nhồi filter/sidebar vào mặc định.

---

## 6. Phụ thuộc / skip
- Chạy SAU khi Worker 1 hoàn tất [PLAN_UI.md](PLAN_UI.md). Nếu mới làm 1 phần (vd chỉ Today view, chưa đụng nav) → test phần đó, ghi rõ phần chưa làm.
- Tier 2-3 cần planner đã chạy + có task `ZZTEST_`; nếu planner chưa verify (TEST_PLAN.md) thì làm cái đó trước.
- Việc đổi `DEFAULT_UI` + deploy (V3/V4) cần quyền deploy — nếu test trên local `wrangler dev`, mô phỏng bằng cách đổi hằng số rồi reload.
```
