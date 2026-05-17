# ⚔️ War Room — Hướng Dẫn Deploy & Thiết Lập

> Hướng dẫn từ A-Z cho người chưa biết Cloudflare.
> Cập nhật: 2026-05-17

---

## 📋 Checklist Trước Khi Deploy

- [x] Code hoàn thiện tại `/Users/mac/rocky/warroom/`
- [x] Notion DB kết nối thành công
- [x] MiniMax AI hoạt động
- [x] Test local OK (`npm run dev`)
- [ ] Lấy Telegram Chat ID
- [ ] Deploy lên Cloudflare
- [ ] Set production secrets
- [ ] Set Telegram webhook

---

## 1️⃣ Tạo Tài Khoản Cloudflare (nếu chưa có)

1. Vào [dash.cloudflare.com](https://dash.cloudflare.com)
2. Sign up bằng email
3. **FREE plan** — đủ dùng cho War Room:
   - 100,000 requests/ngày
   - 5 Cron Triggers
   - 10ms CPU time/request

---

## 2️⃣ Cài Wrangler CLI & Login

```bash
# Đã cài rồi (trong package.json), chỉ cần login
cd /Users/mac/rocky/warroom
npx wrangler login
```

Browser sẽ mở → **"Allow Wrangler to make changes..."** → Click **Allow**.

Verify:
```bash
npx wrangler whoami
# Sẽ hiện tên account + account ID
```

---

## 3️⃣ Lấy Telegram Chat ID

1. Mở Telegram, tìm bot **@JarvisF13_bot**
2. Gửi tin nhắn bất kỳ (ví dụ: "hello")
3. Chạy lệnh này trong terminal:

```bash
curl -s "https://api.telegram.org/bot8004145772:AAEJeeCZdZPc10POfeFoaDlLsEukFcFrhKE/getUpdates" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for u in data.get('result', []):
    chat = u.get('message', {}).get('chat', {})
    print(f'Chat ID: {chat.get(\"id\")}')
    print(f'Name: {chat.get(\"first_name\",\"\")} {chat.get(\"last_name\",\"\")}')
"
```

4. Copy số **Chat ID** (dạng số, ví dụ: `123456789`)
5. Update file `.dev.vars`: thay `TELEGRAM_CHAT_ID=PENDING` → `TELEGRAM_CHAT_ID=<your-chat-id>`

---

## 4️⃣ Deploy Lên Cloudflare

```bash
cd /Users/mac/rocky/warroom
npx wrangler deploy
```

Output sẽ hiện URL dạng:
```
Published warroom (x.xx sec)
  https://warroom.<your-subdomain>.workers.dev
```

**Lưu URL này!** Đây là production URL.

---

## 5️⃣ Set Production Secrets

Chạy từng lệnh, paste value khi terminal hỏi:

```bash
# App password
npx wrangler secret put APP_PASSWORD
# Paste: warroom2026

# MiniMax API key
npx wrangler secret put MINIMAX_API_KEY
# Paste: sk-cp-h3rjDL... (full key)

# Notion API key
npx wrangler secret put NOTION_API_KEY
# Paste: ntn_257145164334... (full key)

# Notion Database ID
npx wrangler secret put NOTION_TASKS_DB_ID
# Paste: 1a65fcb4-61d1-814c-9f08-e65b9e28af64

npx wrangler secret put NOTION_DAILY_DB_ID
# Paste: 1a65fcb4-61d1-814c-9f08-e65b9e28af64

# Telegram
npx wrangler secret put TELEGRAM_BOT_TOKEN
# Paste: 8004145772:AAEJeeCZdZPc10POfeFoaDlLsEukFcFrhKE

npx wrangler secret put TELEGRAM_CHAT_ID
# Paste: <your-chat-id từ bước 3>
```

---

## 6️⃣ Set Telegram Webhook

Sau khi deploy xong, set webhook để Telegram gửi messages tới Worker:

```bash
# Thay YOUR_WORKER_URL bằng URL từ bước 4
curl -X POST "https://api.telegram.org/bot8004145772:AAEJeeCZdZPc10POfeFoaDlLsEukFcFrhKE/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://YOUR_WORKER_URL/api/telegram", "allowed_updates": ["message"]}'
```

Hoặc dùng endpoint built-in (cần login trước):
```bash
curl -c /tmp/cookies.txt -X POST https://YOUR_WORKER_URL/api/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"warroom2026"}'

curl -b /tmp/cookies.txt -X POST https://YOUR_WORKER_URL/api/setup-telegram
```

Verify:
```bash
curl -s "https://api.telegram.org/bot8004145772:AAEJeeCZdZPc10POfeFoaDlLsEukFcFrhKE/getWebhookInfo" | python3 -m json.tool
# url phải trỏ đến YOUR_WORKER_URL/api/telegram
```

---

## 7️⃣ Test Production

### Web:
1. Mở `https://YOUR_WORKER_URL` trong browser
2. Login với password
3. Gõ "plan today" → phải thấy tasks từ Notion

### Telegram:
1. Mở @JarvisF13_bot trên Telegram
2. Gõ `/start` → phải thấy menu commands
3. Gõ `/plan` → phải thấy tasks
4. Gõ "review slide GMA cho anh Hải" → phải capture task

### Cron:
- Cron sẽ tự chạy theo schedule
- Check logs: `npx wrangler tail` (xem realtime logs)

---

## 🔧 Quản Lý Sau Deploy

### Xem Logs Realtime
```bash
npx wrangler tail
# Hiện mọi request + console.log/error trong realtime
```

### Re-deploy sau khi sửa code
```bash
npx wrangler deploy
```

### Update 1 secret
```bash
npx wrangler secret put MINIMAX_API_KEY
# Paste new key
```

### Xem danh sách secrets
```bash
npx wrangler secret list
```

### Xóa 1 secret
```bash
npx wrangler secret delete OLD_SECRET_NAME
```

---

## ⏰ Cron Triggers — Auto Reminders

War Room sẽ tự động gửi tin nhắn Telegram theo lịch:

| Giờ (VN) | UTC | Nội dung |
|----------|-----|----------|
| **07:00** | 00:00 | ☀️ Morning Briefing — Top 3 tasks, overdue warning, load % |
| **13:00** | 06:00 | 🌤️ Afternoon Check — Tasks đang In Progress, remaining To Do |
| **22:00** | 15:00 | 🌙 Evening Wrap-up — Carry-over tasks, reminder nghỉ ngơi |

### Customize schedule:
Sửa file `wrangler.toml` → phần `[triggers]`:
```toml
[triggers]
crons = ["0 0 * * *", "0 6 * * *", "0 15 * * *"]
# Format: "minute hour * * *" (UTC)
# VN = UTC + 7
```

---

## 📱 Telegram Bot Commands

| Command | Mô tả |
|---------|--------|
| `/start` | Menu commands |
| `/plan` | Plan hôm nay (= "plan today") |
| `/overdue` | Check task quá hạn |
| `/load` | Check workload |
| `/report` | Weekly report |
| `/done [task]` | Đánh dấu task xong |
| *Gõ tự do* | Capture task mới |

---

## ❓ FAQ

### Q: Deploy bị lỗi "authentication error"
A: Chạy `npx wrangler login` lại.

### Q: Telegram bot không phản hồi
A: Check webhook: `curl -s "https://api.telegram.org/bot.../getWebhookInfo"`. URL phải trỏ đúng.

### Q: Cron không chạy
A: Cron chỉ chạy trên production (không chạy local). Check `npx wrangler tail` để xem logs.

### Q: Notion bị 401
A: API key hết hạn hoặc integration bị revoke. Tạo key mới rồi `npx wrangler secret put NOTION_API_KEY`.

### Q: Muốn đổi password
A: `npx wrangler secret put APP_PASSWORD` → paste mật khẩu mới.

### Q: Free plan có giới hạn gì?
A: 100K requests/ngày, 5 cron triggers, 10ms CPU/request. Dư sức cho 1 người dùng.
