// Telegram Bot handler — webhook + Markdown + inline keyboard

const TELEGRAM_API = 'https://api.telegram.org/bot';

/**
 * Handle incoming Telegram webhook update
 */
export async function handleTelegramWebhook(update, env, processChat) {
  // Handle inline keyboard callback
  if (update.callback_query) {
    return await handleCallbackQuery(update.callback_query, env, processChat);
  }

  const message = update.message;
  if (!message || !message.text) {
    return new Response('OK');
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
      '• `/backlog` — Xem ý tưởng/link\n' +
      '• `/overdue` — Check task quá hạn\n' +
      '• `/load` — Check load\n' +
      '• `/report` — Weekly report\n' +
      '• `/done [task]` — Đánh dấu xong\n' +
      '• `/edit [task]` — Sửa task\n' +
      '\nGửi link/video/idea → lưu Backlog.',
      'Markdown',
      buildMainKeyboard()
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

  if (text.startsWith('/done ')) {
    chatMessage = `xong ${text.substring(6)}`;
  } else if (text.startsWith('/edit ')) {
    chatMessage = `sửa ${text.substring(6)}`;
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
    const result = await processChat(chatMessage, env, String(chatId));

    let responseText = result.response_text || 'Không có response.';

    if (result.follow_up_question) {
      responseText += `\n\n❓ ${result.follow_up_question}`;
    }

    // Escape Markdown special chars in task data but keep our formatting
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      responseText,
      'Markdown',
      buildMainKeyboard()
    );
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
 * Handle inline keyboard callback queries
 */
async function handleCallbackQuery(query, env, processChat) {
  const chatId = query.message.chat.id;
  const data = query.data;

  // Acknowledge the callback
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

  // Show typing
  await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  });

  try {
    const result = await processChat(chatMessage, env, String(chatId));
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      result.response_text || 'Không có response.',
      'Markdown',
      buildMainKeyboard()
    );
  } catch (err) {
    console.error('Callback error:', err);
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `⚠️ Lỗi: ${err.message?.substring(0, 100) || 'Unknown'}`
    );
  }

  return new Response('OK');
}

/**
 * Build inline keyboard with main actions
 */
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
 * Send a message via Telegram Bot API with optional keyboard
 */
export async function sendTelegramMessage(botToken, chatId, text, parseMode = null, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    text: text,
  };

  if (parseMode) {
    body.parse_mode = parseMode;
  }

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Telegram send error:', err);

    // If Markdown parsing failed, retry without parse_mode
    if (parseMode && err.includes('parse')) {
      body.parse_mode = undefined;
      const retryResponse = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return retryResponse;
    }
  }

  return response;
}

/**
 * Set webhook URL for the bot (include callback_query)
 */
export async function setTelegramWebhook(botToken, webhookUrl) {
  const response = await fetch(`${TELEGRAM_API}${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query'],
    }),
  });

  return response.json();
}
