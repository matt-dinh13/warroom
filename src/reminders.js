// Cron-triggered auto reminders v3.0
// Consolidated to 5 cron triggers (CF free plan limit)
// Internal dispatch uses VN hour/minute to determine which notification to send
import { queryTasks } from './notion.js';
import { sendTelegramMessage } from './telegram.js';
import { getStats, buildStatsFooter } from './gamification.js';

/**
 * Handle scheduled (cron) event
 * Consolidated crons fire multiple times; dispatch by VN time
 */
export async function handleScheduled(event, env) {
  const now = new Date(event.scheduledTime);
  const vnHour = (now.getUTCHours() + 7) % 24;
  const vnMin = now.getUTCMinutes();
  const vnDay = new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCDay();
  const isWeekend = vnDay === 0 || vnDay === 6;

  console.log(`Cron fired: VN ${vnHour}:${String(vnMin).padStart(2, '0')}, day ${vnDay}, weekend=${isWeekend}`);

  try {
    // Weekday slots
    if (!isWeekend) {
      if (vnHour === 8 && vnMin === 0) {
        await sendMorningBriefing(env);
      } else if (vnHour === 10 && vnMin === 30) {
        await sendDriftCheck(env, 1); // Drift #1 (merged with morning check)
      } else if (vnHour === 13 && vnMin === 30) {
        await sendAfternoonReminder(env);
      } else if (vnHour === 15 && vnMin === 30) {
        await sendPushSlot(env);
      } else if (vnHour === 16 && vnMin === 30) {
        await sendDriftCheck(env, 2); // Drift #2
      } else if (vnHour === 23 && vnMin === 0) {
        await sendPowerBlockReminder(env);
      }
      // Other :30 marks (11:30, 12:30, 14:30) — no action, skip silently
    }

    // Weekend slots (T7 cron also handles CN via day check)
    if (isWeekend) {
      if (vnHour === 9 && vnMin === 30) {
        await sendMorningReminder(env);
      } else if (vnHour === 20 && vnMin === 0) {
        await sendWeekendEvening(env);
      }
    }

    // Friday WFH morning (vnDay=5 is Friday, not weekend)
    if (vnDay === 5 && vnHour === 9 && vnMin === 30) {
      // Already handled by 30 3-9 cron at 10:30, but 09:30 T6 doesn't fire
      // because T6 cron is 30 2 * * 6 (Saturday). So Friday 09:30 needs 30 2 * * 1-5
      // which fires at VN 9:30 BUT 30 3-9 starts at 10:30... skip for now
    }
  } catch (err) {
    console.error('Cron handler error:', err);
  }
}

// ─── Morning Briefing (8:00 AM) — First thing Matt sees ──────

async function sendMorningBriefing(env) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const tasks = await queryTasks('today', env);
  const overdue = await queryTasks('overdue', env);
  const stats = await getStats(String(chatId), env);

  const vnDate = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const dayNames = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  const dayNum = vnDate.getUTCDay();
  const isFriday = dayNum === 5;
  const dayType = isFriday ? '🏠 WFH' : '🏢 Office';
  const capacity = isFriday ? 420 : 330;

  // Sort by urgency
  const urgencyOrder = { '🔴 Fire': 0, '🟡 Important': 1, '🟢 Wait': 2, '⚪ Someday': 9 };
  const actionable = tasks.filter(t => t.urgency !== '⚪ Someday')
    .sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9));

  let msg = `☀️ Chào Matt! ${dayNames[dayNum]} ${vnDate.getUTCDate()}/${vnDate.getUTCMonth() + 1}\n`;
  msg += `${dayType} — ${capacity}p\n\n`;

  if (actionable.length === 0) {
    msg += '📭 Không có task! Relax hoặc pick từ backlog.\n';
  } else {
    msg += `📋 Hôm nay (${actionable.length} tasks):\n`;
    actionable.slice(0, 3).forEach((t, i) => {
      const est = t.estimate ? `${t.estimate}p` : '?p';
      msg += `${i + 1}. ${t.urgency || '🟡'} ${t.title} — ${est}\n`;
    });
    if (actionable.length > 3) msg += `  +${actionable.length - 3} nữa\n`;
  }

  if (overdue.length > 0) {
    msg += `\n⚠️ ${overdue.length} task quá hạn!`;
  }

  msg += `\n${buildStatsFooter(stats)}`;

  if (stats.today_completed > 0) {
    msg += `\n💪 Hôm qua: ${stats.today_completed} tasks done!`;
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'HTML',
    buildBriefingKeyboard()
  );
}

// ─── Drift Checks (11:00 AM + 16:30 PM) ──────────────────────

async function sendDriftCheck(env, slot) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  // Check stale "In Progress" tasks
  const tasks = await queryTasks('today', env);
  const inProgress = tasks.filter(t => t.status === 'In progress');

  let msg;
  if (slot === 1) {
    msg = '⚡ DRIFT CHECK (11:00)\n\n';
    if (inProgress.length > 0) {
      msg += `🔔 Đang In Progress:\n`;
      inProgress.forEach(t => { msg += `  • ${t.title}\n`; });
      msg += `\nXong chưa? Focus lại!`;
    } else {
      msg += '⏳ Chưa start task nào?\nBắt đầu task đầu tiên đi Matt!';
      const next = tasks.filter(t => t.urgency !== '⚪ Someday')[0];
      if (next) msg += `\n\n▶️ ${next.urgency || '🟡'} ${next.title}`;
    }
  } else {
    msg = '⚡ DRIFT CHECK (16:30)\n\n';
    if (inProgress.length > 0) {
      msg += `🔔 Vẫn In Progress:\n`;
      inProgress.forEach(t => { msg += `  • ${t.title}\n`; });
      msg += `\nCòn 1h! Close hoặc defer.`;
    } else {
      const remaining = tasks.filter(t => t.status === 'To do' && t.urgency !== '⚪ Someday');
      msg += `📋 Còn ${remaining.length} task To do.\n`;
      msg += remaining.length > 0
        ? `Close cái gì nhanh đi!`
        : 'Clean! 🎯 Power down sớm.';
    }
  }

  msg += '\n\n💡 Gõ "done [task]" hoặc "plan"';
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'HTML',
    buildQuickKeyboard()
  );
}

// ─── Push Slot (15:30) ────────────────────────────────────────

async function sendPushSlot(env) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const tasks = await queryTasks('today', env);
  const remaining = tasks.filter(t => t.status === 'To do' && t.urgency !== '⚪ Someday');
  const completed = tasks.filter(t => t.status === 'Completed');

  let msg = `🔥 Còn 2h! (15:30)\n\n`;
  msg += `✅ Done: ${completed.length} | 📋 Còn: ${remaining.length}\n`;

  if (remaining.length > 0) {
    const quick = remaining.filter(t => (t.estimate || 30) <= 30).slice(0, 2);
    if (quick.length > 0) {
      msg += '\n⚡ Quick wins:\n';
      quick.forEach(t => {
        const est = t.estimate ? `${t.estimate}p` : '?p';
        msg += `  • ${t.title} (${est})\n`;
      });
    }
    msg += '\n💡 Push thêm 1 cái nhanh!';
  } else {
    msg += '\n✅ All done! Impressive 🎉';
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'HTML',
    buildQuickKeyboard()
  );
}

// ─── Existing slots (updated format) ─────────────────────────

async function sendMorningReminder(env) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const tasks = await queryTasks('today', env);
  const actionable = tasks.filter(t => t.urgency !== '⚪ Someday');
  const totalEstimate = actionable.reduce((s, t) => s + (t.estimate || 0), 0);

  const vnDay = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCDay();
  const isWeekend = vnDay === 0 || vnDay === 6;
  const capacity = isWeekend ? 120 : vnDay === 5 ? 420 : 330;

  let msg = `📋 Morning Check\n\n`;
  msg += `📌 ${actionable.length} tasks · ⏱ ${totalEstimate}p/${capacity}p\n`;

  const next = actionable[0];
  if (next) {
    msg += `\n▶️ ${next.urgency || '🟡'} ${next.title}`;
    if (next.estimate) msg += ` (${next.estimate}p)`;
  }

  msg += '\n\n💡 Gõ "plan" để xem chi tiết.';
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'HTML',
    buildQuickKeyboard()
  );
}

async function sendAfternoonReminder(env) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const tasks = await queryTasks('today', env);
  const inProgress = tasks.filter(t => t.status === 'In progress');
  const toDo = tasks.filter(t => t.status === 'To do' && t.urgency !== '⚪ Someday');

  let msg = `🌤️ Afternoon Check (13:30)\n\n`;

  if (inProgress.length > 0) {
    msg += '🔔 In Progress:\n';
    inProgress.forEach(t => { msg += `  • ${t.title}\n`; });
  }

  msg += `\n📋 Còn ${toDo.length} task To do.`;

  const next = toDo[0];
  if (next) msg += `\n▶️ Tiếp: ${next.title}`;

  msg += '\n\n💡 Focus 2h chiều!';
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'HTML',
    buildQuickKeyboard()
  );
}

async function sendPowerBlockReminder(env) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const tasks = await queryTasks('today', env);
  const stats = await getStats(String(chatId), env);
  const completed = tasks.filter(t => t.status === 'Completed');
  const remaining = tasks.filter(t => t.status !== 'Completed' && t.urgency !== '⚪ Someday');

  let msg = `🌙 Power Block (23:00)\n\n`;
  msg += `✅ Hôm nay: ${completed.length} tasks done!\n`;
  msg += buildStatsFooter(stats);

  if (remaining.length > 0) {
    msg += `\n\n📋 Còn ${remaining.length} task. Pick 1 quick?`;
    const quick = remaining.filter(t => (t.estimate || 30) <= 25)[0];
    if (quick) msg += `\n▶️ ${quick.title}`;
  } else {
    msg += '\n\n✅ All clear! Rest well Matt 💤';
  }

  msg += '\n\n⚠️ Max 1h. Đừng hyperfocus!';
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'HTML',
    buildQuickKeyboard()
  );
}

async function sendWeekendEvening(env) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const tasks = await queryTasks('today', env);
  const stats = await getStats(String(chatId), env);
  const remaining = tasks.filter(t => t.status !== 'Completed' && t.urgency !== '⚪ Someday');

  let msg = `🏠 Weekend Check (20:00)\n\n`;
  msg += `📋 ${remaining.length} task còn lại.\n`;
  msg += buildStatsFooter(stats);
  msg += '\n\n💡 Relax & prep for Monday!';

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'HTML',
    buildQuickKeyboard()
  );
}

// ─── Keyboards ────────────────────────────────────────────────

function buildBriefingKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📋 Plan', callback_data: 'action_plan' },
        { text: '💡 Backlog', callback_data: 'action_backlog' },
        { text: '📊 Load', callback_data: 'action_load' },
      ],
    ],
  };
}

function buildQuickKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📋 Plan', callback_data: 'action_plan' },
        { text: '⚠️ Overdue', callback_data: 'action_overdue' },
      ],
    ],
  };
}
