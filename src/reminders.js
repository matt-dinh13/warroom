// Cron-based reminders — runs on schedule, sends to Telegram

import { queryTasks } from './notion.js';
import { sendTelegramMessage } from './telegram.js';

/**
 * Handle scheduled cron event
 * @param {ScheduledEvent} event - Cloudflare cron event
 * @param {object} env - Cloudflare env
 */
export async function handleScheduled(event, env) {
  // Vietnam = UTC+7
  const now = new Date();
  const vnHour = (now.getUTCHours() + 7) % 24;

  try {
    if (vnHour === 7) {
      await sendMorningBriefing(env);
    } else if (vnHour === 13) {
      await sendAfternoonCheck(env);
    } else if (vnHour === 22) {
      await sendEveningWrapup(env);
    } else {
      // Fallback: if triggered manually or at unexpected time, send morning briefing
      await sendMorningBriefing(env);
    }
  } catch (err) {
    console.error('Cron error:', err);
  }
}

/**
 * 7:00 AM — Morning Briefing
 * "Chào Matt! Đây là plan hôm nay."
 */
async function sendMorningBriefing(env) {
  const tasks = await queryTasks('today', env);
  const overdue = await queryTasks('overdue', env);

  const now = new Date();
  const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const day = `${dayNames[vnDate.getUTCDay()]} ${vnDate.getUTCDate()}/${vnDate.getUTCMonth() + 1}`;

  const dayNum = vnDate.getUTCDay();
  const isFriday = dayNum === 5;
  const isWeekend = dayNum === 0 || dayNum === 6;
  const dayType = isWeekend ? '🏠 Weekend' : isFriday ? '🏠 WFH' : '🏢 Office';
  const capacity = isWeekend ? 120 : isFriday ? 420 : 330;

  let msg = `☀️ Chào buổi sáng Matt! (${day} — ${dayType})\n\n`;

  if (overdue.length > 0) {
    msg += `⚠️ ${overdue.length} task QUÁ HẠN:\n`;
    overdue.slice(0, 3).forEach((t) => {
      msg += `  🔴 [${t.project}] ${t.title} — 📅 ${t.due_date}\n`;
    });
    msg += '\n';
  }

  if (tasks.length > 0) {
    // Sort by urgency
    const urgencyOrder = { '🔴 Fire': 0, '🟡 Important': 1, '🟢 Wait': 2, '⚪ Someday': 3 };
    tasks.sort((a, b) => {
      const ua = urgencyOrder[a.urgency] ?? 9;
      const ub = urgencyOrder[b.urgency] ?? 9;
      return ua - ub;
    });

    const top3 = tasks.slice(0, 3);
    const totalEst = top3.reduce((sum, t) => sum + (t.estimate || 0), 0);

    msg += `📋 Top 3 hôm nay:\n`;
    top3.forEach((t, i) => {
      const urg = t.urgency || t.priority || '';
      const est = t.estimate ? `${t.estimate}p` : '?p';
      msg += `${i + 1}. ${urg} [${t.project}] ${t.title} — ${est}\n`;
    });

    const loadPct = Math.round((totalEst / capacity) * 100);
    msg += `\n📊 Load: ${totalEst}/${capacity} phút (${loadPct}%)`;

    if (tasks.length > 3) {
      msg += `\n📦 +${tasks.length - 3} task khác trong queue`;
    }
  } else {
    msg += '📭 Không có task active. Free day! 🎉';
  }

  msg += '\n\n💡 Gõ /plan để xem chi tiết.';

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg);
}

/**
 * 1:00 PM — Afternoon Check
 * Quick reminder about remaining tasks
 */
async function sendAfternoonCheck(env) {
  const tasks = await queryTasks('today', env);

  if (tasks.length === 0) return; // Don't bother if no tasks

  const inProgress = tasks.filter(t => t.status === 'In progress');
  const todo = tasks.filter(t => t.status === 'To do');

  let msg = `🌤️ Afternoon Check:\n\n`;

  if (inProgress.length > 0) {
    msg += `🔄 Đang làm:\n`;
    inProgress.forEach(t => {
      msg += `  • [${t.project}] ${t.title}\n`;
    });
    msg += '\n';
  }

  msg += `📋 Còn ${todo.length} task To Do.`;

  if (todo.length > 5) {
    msg += ` ⚠️ Nhiều quá — cân nhắc DEFER/DROP!`;
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg);
}

/**
 * 10:00 PM — Evening Wrap-up
 * Summary of what's left, reminder to prepare for tomorrow
 */
async function sendEveningWrapup(env) {
  const tasks = await queryTasks('today', env);
  const overdue = await queryTasks('overdue', env);

  if (tasks.length === 0 && overdue.length === 0) return;

  let msg = `🌙 Evening Wrap-up:\n\n`;

  if (overdue.length > 0) {
    msg += `⚠️ ${overdue.length} task quá hạn — xử lý sáng mai!\n`;
  }

  const remaining = tasks.filter(t => t.status !== 'Completed');
  if (remaining.length > 0) {
    msg += `📋 ${remaining.length} task active carry over sang ngày mai.\n`;
    remaining.slice(0, 3).forEach(t => {
      msg += `  • [${t.project}] ${t.title}\n`;
    });
  }

  msg += '\n🎮 Game time! Nghỉ ngơi đi Matt. 21:00-23:00 = sacred.';

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg);
}
