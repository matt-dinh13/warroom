// Telegram Bot handler — webhook + send message utilities

const TELEGRAM_API = 'https://api.telegram.org/bot';

/**
 * Handle incoming Telegram webhook update
 * @param {object} update - Telegram update object
 * @param {object} env - Cloudflare env
 * @param {function} processChat - The triage function to reuse
 * @returns {Promise<Response>}
 */
export async function handleTelegramWebhook(update, env, processChat) {
  const message = update.message;
  if (!message || !message.text) {
    return new Response('OK'); // Ignore non-text messages
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  // Security: Only allow configured chat ID
  const allowedChatId = parseInt(env.TELEGRAM_CHAT_ID);
  if (allowedChatId && chatId !== allowedChatId) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '🔒 Unauthorized. Bot này chỉ dành cho Matt.'
    );
    return new Response('OK');
  }

  // Handle /start command
  if (text === '/start') {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '⚔️ *War Room Online*\n\n' +
      'Gõ task hoặc dùng commands:\n' +
      '• `/plan` — Plan hôm nay\n' +
      '• `/backlog` — Xem ý tưởng/link đã lưu\n' +
      '• `/overdue` — Check task quá hạn\n' +
      '• `/load` — Check load\n' +
      '• `/report` — Weekly report\n' +
      '• `/done [task]` — Đánh dấu xong\n' +
      '\nGửi link/video/idea → lưu vào Backlog.',
      'Markdown'
    );
    return new Response('OK');
  }

  // Map Telegram commands to chat messages
  const commandMap = {
    '/plan': 'plan today',
    '/overdue': 'bỏ quên gì không?',
    '/load': 'check load',
    '/report': 'weekly report',
    '/backlog': 'có gì làm không?',
  };

  let chatMessage = text;

  // Handle /done command
  if (text.startsWith('/done ')) {
    chatMessage = `xong ${text.substring(6)}`;
  } else if (commandMap[text]) {
    chatMessage = commandMap[text];
  }

  // Show "typing" indicator
  await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  });

  try {
    // Reuse the same triage logic as web chat
    const result = await processChat(chatMessage, env);

    // Format response for Telegram
    let responseText = result.response_text || 'Không có response.';

    // Add follow-up question if any
    if (result.follow_up_question) {
      responseText += `\n\n❓ ${result.follow_up_question}`;
    }

    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, responseText);
  } catch (err) {
    console.error('Telegram handler error:', err);
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `⚠️ Lỗi: ${err.message?.substring(0, 100) || 'Unknown error'}`
    );
  }

  return new Response('OK');
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage(botToken, chatId, text, parseMode = null) {
  const body = {
    chat_id: chatId,
    text: text,
  };

  if (parseMode) {
    body.parse_mode = parseMode;
  }

  const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Telegram send error:', err);
  }

  return response;
}

/**
 * Set webhook URL for the bot
 */
export async function setTelegramWebhook(botToken, webhookUrl) {
  const response = await fetch(`${TELEGRAM_API}${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message'],
    }),
  });

  return response.json();
}
