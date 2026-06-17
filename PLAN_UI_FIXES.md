# 🔧 UI v2.0 — Fix Round (cho Worker 1, sau report của Worker 2)

> Nguồn: [TEST_PLAN_UI.md](TEST_PLAN_UI.md) report ngày 17/6. Phạm vi Matt chốt: **Lean + capture tại chỗ.**
> Today view đã PASS 5/5 — KHÔNG đụng. Chỉ làm 3 việc dưới. **KHÔNG build bottom-nav/Calendar/estimate-inline** (gác lại — xem §4).

---

## F1 — [BLOCKER] Sửa routing/rollback (V1, V3, V4)

**Gốc rễ (đã xác minh):** `wrangler.toml` khối `[assets]` thiếu binding + run-first → `env.ASSETS` undefined (gây `/v1` → 500) và file tĩnh phục vụ trước worker (công tắc `DEFAULT_UI` vô hiệu ở `/`). Code `serveVersionedAsset` trong [src/index.js](src/index.js) **đã đúng** — chỉ thiếu config để nó chạy.

**Sửa — [wrangler.toml](wrangler.toml):**
```toml
[assets]
directory = "./public"
binding = "ASSETS"
run_worker_first = true
```
- `binding = "ASSETS"` → `env.ASSETS` định nghĩa được → hết 500 ở `/v1`.
- `run_worker_first = true` → worker chạy trước → `serveVersionedAsset` đánh chặn được `/`, `/v1`, `/v2` → công tắc `DEFAULT_UI` hoạt động.

**Không cần sửa gì khác cho routing** — v2 đã dùng path tuyệt đối `/v2/app.js`, `/v2/style.css` nên chạy đúng cả khi serve ở `/`.

**Verify (Worker 1 tự check trước khi giao lại):**
- `curl -i /v1` → 200, ra HTML bản cũ.
- `curl -i /v2` → 200, ra v2.
- Đổi `DEFAULT_UI='v2'` → `curl /` ra v2; đổi lại `'v1'` → `curl /` ra v1.
- Kiểm `run_worker_first` không phá `/api/*` (vẫn trả JSON) và không phá asset gốc (`/manifest.json`, `/icon-192.png`, `/style.css`, `/app.js` vẫn 200).

---

## F1.1 — [BLOCKER round 2] Sửa vòng lặp redirect trong serveVersionedAsset

**Triệu chứng (report 17/6):** `/v2/` → 307 về chính nó → `ERR_TOO_MANY_REDIRECTS`. Xảy ra SAU khi bật `run_worker_first`.

**Gốc rễ (đã xác minh):** `serveVersionedAsset` rewrite `/v2/` → `env.ASSETS.fetch('/v2/index.html')`. Cloudflare Assets canonical-hoá đường dẫn `/index.html` → trả **307 về `/v2/`**. `env.ASSETS.fetch` KHÔNG follow redirect → trả nguyên 307 về browser → browser xin `/v2/` → worker rewrite lại `/v2/index.html` → **lặp vô hạn**. Tương tự `/v1` rewrite `/index.html` → 307 về `/`.

**Fix: fetch dạng thư mục canonical (`/v2/`, `/`), KHÔNG tự chèn `index.html`.** Thay nguyên hàm `serveVersionedAsset` trong [src/index.js](src/index.js):
```js
async function serveVersionedAsset(request, url, env) {
  const path = url.pathname;
  const get = (p) => env.ASSETS.fetch(new Request(new URL(p, url), request));

  // v2 page → serve v2 dir index qua dạng canonical '/v2/' (tránh redirect index.html)
  if (path === '/v2' || path === '/v2/') return get('/v2/');
  // v2 sub-asset (/v2/app.js, /v2/style.css) → giữ nguyên
  if (path.startsWith('/v2/')) return env.ASSETS.fetch(request);

  // v1 page → v1 nằm ở public root → serve qua '/' (canonical, không 307)
  if (path === '/v1' || path === '/v1/') return get('/');
  // v1 sub-asset (/v1/style.css) → bỏ prefix /v1, lấy từ root
  if (path.startsWith('/v1/')) return get(path.slice(3) || '/');

  // root → theo DEFAULT_UI (dùng dạng thư mục canonical)
  if (path === '/') return get(DEFAULT_UI === 'v2' ? '/v2/' : '/');

  // còn lại = asset dùng chung (css/js/manifest/icon) → giữ nguyên
  return env.ASSETS.fetch(request);
}
```
**Vì sao hết loop:** `env.ASSETS.fetch('/v2/')` và `('/')` là đường dẫn canonical (trailing-slash) → Assets serve thẳng index 200, KHÔNG 307. `env.ASSETS.fetch` không gọi ngược lại worker → không đệ quy.

**Lưu ý:** GIỮ `html_handling` mặc định (auto-trailing-slash) — fix này dựa vào nó. (Phương án thay thế nếu muốn kiểm soát tuyệt đối: thêm `html_handling = "none"` vào `[assets]` rồi fetch thẳng `index.html` — nhưng khi đó phải tự map cả `/` → `/index.html`. Cách trên gọn hơn, không cần đổi config thêm.)

**Verify lại (Worker 1):** `curl -i /v2/`, `/v2`, `/v1`, `/v1/`, `/` đều **200, KHÔNG 3xx lặp**; `/v1/style.css` 200; `/v2/app.js` 200; đổi `DEFAULT_UI` 2 chiều → `/` ra đúng bản.

---

## F2 — Thêm capture TẠI CHỖ trong v2 (đừng bắt nhảy về v1)

**Vấn đề:** v2 hiện đẩy capture sang v1 (tab Chat chỉ là stub link). Capture là thao tác thường xuyên nhất — bắt rời v2 mỗi lần thêm task = đúng ma sát cần diệt.

**Làm:** biến tab **Chat của v2** thành capture thật (không cần Calendar, không cần lịch sử dài — chỉ cần gõ task → confirm-card → tạo).
- Trong [public/v2/index.html](public/v2/index.html): thay stub `#chat-view` bằng ô nhập thật (textarea + nút gửi) — bê layout từ v1 (`.chat-input-area`, `.input-wrapper`, `#chat-input`, `#chat-submit`) + vùng message.
- Trong [public/v2/app.js](public/v2/app.js): port lại từ v1 `app.js` (đã chạy tốt) các hàm `sendChat`, `addMessage`, `addConfirmMessage` (confirm-card), `formatMessage`. **Tái dùng nguyên** — đừng viết mới. Cùng endpoint `/api/chat`.
- Thêm 1 lối vào capture từ tab **Hôm nay**: nút `+` ở header (hoặc 1 ô nhập gọn dưới timeline) → focus sang ô capture. 1 chạm để thêm task mà không rời màn Hôm nay.

**Acceptance:** ở `/v2`, gõ "tạo task `ZZTEST_` X 30p" → hiện confirm-card → "ok" → task tạo (verify), KHÔNG phải mở v1.

> Giữ link "Board/Calendar đầy đủ ở v1" như hiện tại — OK cho bản lean. Chỉ capture là phải có tại chỗ.

---

## F3 — Đổi nhãn cột "Pending" → "🅿️ Để dành" (E4)

- Trong [public/index.html](public/index.html) (v1 board) cột `data-status="Pending"`: đổi `column-title` "⏳ Pending" → "🅿️ Để dành".
- Nếu v2 có cột tương tự thì đổi luôn; v2 board hiện là stub-link nên có thể bỏ qua.
- ⚠️ **CHỈ đổi nhãn hiển thị.** KHÔNG đổi tên status Notion thật `Pending / Wait for approved` trong `notion.js`/`responses.js` — đó là giá trị status thực, đổi sẽ vỡ query/park.

---

## §4 — GÁC LẠI (KHÔNG làm trong round này)

Đây là các "FAIL" trong report nhưng thực ra là phase 2-4 PLAN_UI / design choice — **chưa build có chủ đích**, đừng đụng:
- **N1** Bottom nav 4 mục → giữ header-tabs hiện tại (Hôm nay/Chat/Board).
- **N4** Calendar trong v2 → vẫn ở v1.
- **E1/E2** Estimate sửa-tại-chỗ + dấu `~` đề xuất → phase sau.
- Board đầy đủ trong v2 → vẫn link sang v1.

Quyết định build tiếp các mục này **chỉ sau khi dogfood Today view** thấy thực sự giúp. Tránh over-build.

---

## §5 — Re-test (Worker 2, sau khi Worker 1 xong)

Chạy lại [TEST_PLAN_UI.md](TEST_PLAN_UI.md), nhưng **cập nhật kỳ vọng** để report không nhiễu:
- **Tier 1 (V1-V7)** → phải PASS hết (BLOCKER đã fix).
- **N2 (capture tồn tại)** + **N5 (ô nhập chat tồn tại)** → giờ phải PASS (do F2).
- **E4** → PASS (do F3).
- **N1, N4, E1, E2** → đánh **SKIP (deferred by design)**, KHÔNG tính FAIL.
- Today view (T1-T8) → vẫn PASS như cũ.

Mục tiêu round này: **Routing/rollback PASS + capture tại chỗ PASS** → đủ điều kiện dogfood v2 (vẫn để `DEFAULT_UI='v1'`, Matt vào `/v2` dùng thử).
