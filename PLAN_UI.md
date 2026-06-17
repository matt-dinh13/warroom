# 🎨 Stratt — UI Pass: màn "Hôm nay" + dời trọng tâm sang quyết+làm

> **Thời điểm:** làm SAU khi Planner Engine ([PLAN_PLANNER.md](PLAN_PLANNER.md)) đã chạy & verify. File này là front-end cho planner đã có sẵn.
> **Nguyên tắc xuyên suốt:** ADHD → **bớt đi, đừng thêm**. Ít thứ trên màn hình > nhiều tính năng. Không đụng lớp thẩm mỹ (design system đã tốt) — chỉ đổi **information architecture** + luồng.
> ⚠️ Planner build ở session trước → worker **kiểm lại tên hàm/endpoint thật** (`buildDayPlan`/`applyDayPlan`, lệnh `xếp lịch`/`xếp lại`...) trước khi wire; tên dưới đây theo plan, có thể đã khác.

---

## 0. Chẩn đoán (vì sao đổi)

App mở ra ở **Chat** (dòng lệnh trống) — với người đang ngợp, màn hình trống đòi tự nghĩ ra lệnh là đúng cái khó nhất. 3 tab hiện có (Chat / Board / Calendar) **không tab nào trả lời "giờ làm gì?"**:
- Board cột "To Do" đổ toàn bộ task → cú hích gây tê liệt.
- Calendar bắt xếp tay từng task → đúng việc tẻ nhạt planner đã làm hộ.

→ Thiếu màn hình quan trọng nhất: **"việc tiếp theo của bạn là cái này"**.

---

## 1. ⭐ Tab mặc định mới: "Hôm nay" (Today / Now) — mặt trước của Planner

**App mở ra ở đây, không phải Chat.** Đây là deliverable chính của file này.

### Layout (mobile-first, iPad)
```
┌─ Hôm nay · T4 17/6 · Office ───────────┐
│  ▶ VIỆC TIẾP THEO                       │
│  🔴 Fix bug GMA                         │
│  ⏱ 45p · 📂 GMA · 🕙 10:00              │
│      [ ✅ Xong ]   [ ⏭ Để sau ]         │
├─────────────────────────────────────────┤
│  Lịch hôm nay                           │
│  🕙 10:00 ▓ Fix bug GMA (45p)           │
│  🕦 10:55 ░ Họp sprint — cố định        │
│  🕛 11:40 ▓ Spec HOSEL (60p)            │
│  🍜 12:00 Nghỉ trưa                     │
│  ... (cuộn)                             │
├─────────────────────────────────────────┤
│  ✅ 2/6 xong · ~4h10 còn lại            │
│  [ 🧠 Xếp lại lịch ]                     │
└─────────────────────────────────────────┘
```

### Hành vi
- **Thẻ "Việc tiếp theo"** = task đầu tiên chưa-xong trong timeline planner. To, rõ, 1 việc duy nhất → gỡ "không biết bắt đầu từ đâu".
  - `✅ Xong` → gọi update status Completed (tái dùng path done), tự nhảy sang việc kế.
  - `⏭ Để sau` → đẩy task xuống cuối/sang slot sau (re-plan nhẹ hoặc bump).
- **Timeline** = render output planner (`buildDayPlanResponse`/dữ liệu plan). Việc đã xong gạch mờ. Anchor (họp) đánh dấu "cố định".
- **Nút "Xếp lại lịch"** → gọi lệnh `xếp lại` (re-plan từ giờ hiện tại). Đây là nút quan trọng nhất cho ADHD — kế hoạch sáng sẽ vỡ, một chạm xếp lại.
- **Khi chưa có plan hôm nay** → hiện 1 nút lớn `🧠 Xếp lịch hôm nay` (gọi `xếp lịch`) thay vì màn trống.
- **Khi planner báo overflow/auto-park** → hiện banner gọn ở cuối: "🅿️ Đã park 4 · ➡️ đẩy 1 · [xem]" + undo (`resume`).

### Wire
- Đọc plan: tái dùng endpoint planner đã có (hoặc thêm `GET /api/today` trả plan hiện tại nếu chưa có).
- Action thẻ: tái dùng `/api/tasks/update` (done), `/api/chat` cho `xếp lịch`/`xếp lại` (confirm "ok" áp dụng — đã có infra confirm-card).

---

## 2. Hạ vai trò Board (overview, không phải nơi làm việc hằng ngày)

- Board **không còn là tab mặc định** (Today chiếm chỗ đó).
- Cột "To Do" giới hạn hiển thị **top N (vd 8)** theo điểm ưu tiên + nút "xem thêm (+12)". Đừng xổ 30 thẻ.
- (Tùy chọn) thêm toggle "Focus" chỉ hiện top 3.
- Giữ nguyên kanban cho lúc cần nhìn tổng thể — chỉ thôi để nó là cú đập đầu tiên vào mắt.

## 3. Lật Calendar: phản chiếu plan, không bắt xếp tay

- Sau khi `xếp lịch`, calendar **hiển thị các block planner đã tự xếp** (không còn để trống chờ kéo-thả).
- Modal Date/Time/Duration ([index.html](public/index.html) `#cal-modal`) chỉ còn để **chỉnh ngoại lệ** (kéo 1 block sang giờ khác), không phải tương tác chính.
- Sidebar "Unscheduled" → đổi nghĩa thành "việc planner chưa nhét được hôm nay" (vào backlog/park), không phải "việc bạn quên xếp".

## 4. Sửa estimate ngay trên thẻ (1 chạm) — nuôi chất lượng planner

- Planner sống nhờ `estimate`. Hiện sửa estimate phải qua chat/edit.
- Cho con số estimate trên card (board + Today) **bấm-sửa-tại-chỗ** (tap → input số → lưu qua `/api/tasks/update` hoặc edit endpoint).
- Task estimate "đề xuất" (planner tự đoán) hiện mờ kèm dấu `~` → nhắc Matt xác nhận. Đây là chỗ UI nối thẳng vào điểm yếu lớn nhất của planner.

---

## 5. Lỗi nhỏ cụ thể (gộp luôn, khỏi bàn)

- [ ] **Icon PWA rỗng:** `public/icon-192.png` và `icon-512.png` đang **0 byte** → icon home-screen iPad trống. Tạo icon thật (logo 🚀 trên nền navy `--surface-0`), 192 & 512. `manifest.json` đã trỏ sẵn.
- [ ] **Nhãn cột "Pending":** Board cột "⏳ Pending" ([index.html](public/index.html)) map vào status tái dùng cho Parked → đổi nhãn "🅿️ Để dành" cho khớp ngôn ngữ park/resume.
- [ ] (Tùy) Urgency hiện là viền trên 2px — cân nhắc thêm chấm màu + emoji góc để quét nhanh hơn (lựa chọn, không bắt buộc).

---

## 6. Files đụng tới

| File | Việc |
|---|---|
| `public/index.html` | Thêm tab "Hôm nay" + `#today-view`; đổi tab mặc định; sửa nhãn cột Pending. |
| `public/app.js` | Render Today view (next-action card + timeline) wire vào planner; default tab = today; giới hạn To Do; calendar phản chiếu plan; estimate inline edit. |
| `public/style.css` | Style cho `#today-view` (next-action card, timeline rows) — **tái dùng token sẵn có**, không thêm hệ màu mới. |
| `public/manifest.json` + icons | Icon PWA thật. |

---

## 7. Thứ tự & phạm vi
1. Tab "Hôm nay" (mục 1) — **làm trước, là 80% giá trị.**
2. Lỗi nhỏ (mục 5) — gộp cùng, vài phút.
3. Estimate inline (mục 4).
4. Hạ Board / lật Calendar (mục 2,3) — sau, khi Today đã quen tay.

**Một pass tập trung, không kéo dài.** Làm xong mục 1 + 5 là đã đổi hẳn trải nghiệm mỗi sáng. Đừng over-build.

---

## 8. ⭐ Versioning & rollback (BẮT BUỘC — đọc trước khi code)

> Chiến lược Matt chốt: **làm UI 2.0 thành bộ file song song, ẩn bản cũ chứ KHÔNG xoá** — để roll back được nếu v2 không ổn.

**Vì sao an toàn:** thay đổi 100% ở front-end (`public/*`); backend + planner + mọi `/api/*` giữ nguyên. Cả 2 version gọi chung API → không fork backend, không migration dữ liệu.

### Cách làm
1. **KHÔNG đụng file v1.** Giữ nguyên `public/index.html`, `public/app.js`, `public/style.css` (bản cũ, vẫn chạy được nguyên vẹn).
2. **Tạo v2 là bộ file tự-tham-chiếu riêng:**
   - `public/v2/index.html` + `public/v2/app.js` + `public/v2/style.css` (gọn nhất: gom v2 vào thư mục `v2/`, các đường dẫn trong html trỏ tương đối `./app.js`, `./style.css`).
   - v2 dùng lại y nguyên các endpoint `/api/*` hiện có.
3. **Routing trong [src/index.js](src/index.js)** (chỗ cuối `return env.ASSETS.fetch(request)`): thêm 1 lớp chọn version TRƯỚC khi fetch asset:
   - `/v2` (và assets dưới nó) → serve `public/v2/*`.
   - `/v1` → luôn serve bản cũ (`public/index.html`...), **giữ vĩnh viễn làm đường rollback**.
   - `/` (gốc) → serve theo **một công tắc duy nhất** `DEFAULT_UI` (hằng số hoặc env var: `'v1' | 'v2'`).
   - Cơ chế: rewrite path rồi mới `env.ASSETS.fetch` (vd `/` + DEFAULT_UI='v2' → fetch `/v2/index.html`).
4. **Giai đoạn build/dogfood:** để `DEFAULT_UI='v1'`. Matt vào thẳng **`/v2`** dùng thử, bản live ở `/` không hề đổi → **zero rủi ro trong lúc làm**.
5. **Khi v2 đã ổn:** đổi `DEFAULT_UI='v2'` (sửa 1 dòng + `wrangler deploy`, ~30s). `/` giờ là v2.
6. **Rollback:** đổi lại `DEFAULT_UI='v1'` + deploy. Bản cũ chưa bao giờ mất, luôn ở `/v1`.

### Lưu ý kỹ thuật
- **PWA manifest:** giữ `start_url: '/'` trong [manifest.json](public/manifest.json) → app trên iPad tự nhận version mặc định. (Muốn ghim hẳn v2 lên home-screen sớm thì cài từ `/v2`.)
- **localStorage dùng chung origin:** v1 và v2 chia sẻ key (vd chat history `STORAGE_KEY`). Nếu v2 đổi cấu trúc lưu → **namespace key riêng** (`stratt_v2_*`) để 2 bản không đạp nhau khi roll qua lại.
- **Không có service worker** trong repo (chỉ manifest) → không lo SW cache giữ bản cũ. Nếu sau này thêm SW, phải version-hoá cache name.
- **Dọn về sau:** khi v2 chạy ổn định vài tuần, có thể xoá `/v1` — nhưng đó là quyết định riêng sau, không nằm trong pass này.
