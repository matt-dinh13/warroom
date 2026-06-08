// Telegram Bot handler v3.0 — HTML parse mode + inline keyboard

const TELEGRAM_API = 'https://api.telegram.org/bot';

export async function handleTelegramWebhook(update, env, processChat) {
  if (update.callback_query) {
    return await handleCallbackQuery(update.callback_query, env, processChat);
  }

  const message = update.message;
  if (!message || !message.text) return new Response('OK');

  const chatId = message.chat.id;
  const text = message.text.trim();

  // Security: only allowed chat ID
  const allowedChatId = parseInt(env.TELEGRAM_CHAT_ID);
  if (allowedChatId && chatId !== allowedChatId) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '🔒 Unauthorized.');
    return new Response('OK');
  }

  if (text === '/start') {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '🚀 <b>Stratt Online</b>\n\n' +
      'Gõ task hoặc dùng commands:\n' +
      '• /plan — Plan hôm nay\n' +
      '• /backlog — Xem ý tưởng\n' +
      '• /overdue — Task quá hạn\n' +
      '• /load — Check load\n' +
      '• /report — Weekly report\n' +
      '• /done [task] — Đánh dấu xong\n' +
      '• /edit [task] — Sửa task\n' +
      '• stats — Xem analytics\n\n' +
      '💡 Gửi nhiều task 1 lúc để brain dump!',
      'HTML', buildMainKeyboard()
    );
    return new Response('OK');
  }

  // Map commands
  const commandMap = {
    '/plan': 'plan today',
    '/overdue': 'bỏ quên gì không?',
    '/load': 'check load',
    '/report': 'weekly report',
    '/backlog': 'có gì làm không?',
  };

  let chatMessage = text;
  if (text.startsWith('/done ')) chatMessage = `xong ${text.substring(6)}`;
  else if (text.startsWith('/edit ')) chatMessage = `sửa ${text.substring(6)}`;
  else if (commandMap[text]) chatMessage = commandMap[text];

  // Typing indicator
  await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  });

  try {
    const result = await processChat(chatMessage, env, String(chatId));
    let responseText = result.response_text || 'Không có response.';
    if (result.follow_up_question) responseText += `\n\n❓ ${result.follow_up_question}`;

    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, formatForTelegram(responseText), 'HTML',
      buildMainKeyboard()
    );
  } catch (err) {
    console.error('Telegram error:', err);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `⚠️ Lỗi: ${err.message?.substring(0, 100) || 'Unknown'}`
    );
  }

  return new Response('OK');
}

async function handleCallbackQuery(query, env, processChat) {
  const chatId = query.message.chat.id;
  const data = query.data;

  await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: query.id }),
  });

  const actionMap = {
    'action_plan': 'plan today',
    'action_backlog': 'có gì làm không?',
    'action_load': 'check load',
    'action_overdue': 'bỏ quên gì không?',
    'action_report': 'weekly report',
  };

  const chatMessage = actionMap[data];
  if (!chatMessage) return new Response('OK');

  await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  });

  try {
    const result = await processChat(chatMessage, env, String(chatId));
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      formatForTelegram(result.response_text || 'Không có response.'), 'HTML', buildMainKeyboard()
    );
  } catch (err) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `⚠️ Lỗi: ${err.message?.substring(0, 100) || 'Unknown'}`
    );
  }

  return new Response('OK');
}

/**
 * Convert Markdown response → Telegram HTML, strip JSON dumps, improve spacing
 */
function formatForTelegram(text) {
  if (!text) return 'Không có response.';

  let t = text;

  // Strip raw JSON blocks (AI sometimes dumps JSON in response)
  t = t.replace(/```json[\s\S]*?```/g, '');
  t = t.replace(/```[\s\S]*?```/g, '');
  // Strip standalone JSON objects
  t = t.replace(/\{[\s\S]*?"intent"[\s\S]*?\}/g, '');

  // Escape HTML special chars first (before adding our own HTML)
  t = t.replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;');

  // Convert Markdown bold **text** → <b>text</b>
  t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Convert Markdown italic *text* → <i>text</i> (single asterisk)
  t = t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');

  // Add spacing between major sections (emoji headers)
  t = t.replace(/(▶️|📋|📊|🔴|📂|💡|⚠️|✅|🏢|🏠)/g, '\n$1');

  // Clean up excessive newlines (3+ → 2)
  t = t.replace(/\n{3,}/g, '\n\n');

  // Trim
  t = t.trim();

  // Telegram message limit: 4096 chars
  if (t.length > 4000) {
    t = t.substring(0, 3990) + '\n\n... (truncated)';
  }

  return t;
}

function buildMainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📋 Plan', callback_data: 'action_plan' },
        { text: '💡 Backlog', callback_data: 'action_backlog' },
        { text: '📊 Load', callback_data: 'action_load' },
      ],
      [
        { text: '⚠️ Overdue', callback_data: 'action_overdue' },
        { text: '📊 Report', callback_data: 'action_report' },
      ],
    ],
  };
}

/**
 * Send Telegram message with HTML parse mode + auto-fallback
 */
export async function sendTelegramMessage(botToken, chatId, text, parseMode = null, replyMarkup = null) {
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  if (replyMarkup) body.reply_markup = replyMarkup;

  const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Telegram send error:', err);

    // Retry without parse_mode if formatting failed
    if (parseMode && (err.includes('parse') || err.includes('can\'t'))) {
      delete body.parse_mode;
      return await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
  }
  return response;
}

export async function setTelegramWebhook(botToken, webhookUrl, secretToken = null) {
  const body = {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query'],
  };
  if (secretToken) body.secret_token = secretToken;

  const response = await fetch(`${TELEGRAM_API}${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}
