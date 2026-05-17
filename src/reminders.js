// Cron-based reminders — day-aware schedule, sends to Telegram
//
// Schedule (VN timezone):
//   T2-T5 (Office): 10:30 morning, 13:30 afternoon, 23:00 power block
//   T6 (WFH):       09:30 morning, 13:30 afternoon, 23:00 power block
//   T7-CN (Weekend): 09:30 weekly review, 20:00 prep tuần mới

import { queryTasks } from './notion.js';
import { sendTelegramMessage } from './telegram.js';

/**
 * Handle scheduled cron event
 */
export async function handleScheduled(event, env) {
  const now = new Date();
  const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const vnHour = vnDate.getUTCHours();
  const vnMinute = vnDate.getUTCMinutes();
  const dayNum = vnDate.getUTCDay(); // 0=CN, 1=T2... 5=T6, 6=T7

  const isWeekend = dayNum === 0 || dayNum === 6;
  const isFriday = dayNum === 5;
  const isMorning = vnHour < 12;
  const isAfternoon = vnHour >= 12 && vnHour < 18;

  try {
    if (isWeekend) {
      // Weekend: 9:30 = weekly review, 20:00 = prep
      if (isMorning) {
        await sendWeekendReview(env, dayNum);
      } else {
        await sendWeekendPrep(env);
      }
    } else if (isMorning) {
      // Weekday morning: 10:30 (Office) or 9:30 (WFH Friday)
      await sendMorningBriefing(env, isFriday);
    } else if (isAfternoon) {
      // Weekday afternoon: 13:30
      await sendAfternoonCheck(env);
    } else {
      // Weekday evening: 23:00 = Power Block
      await sendPowerBlockReminder(env);
    }
  } catch (err) {
    console.error('Cron error:', err);
  }
}

// ─── Weekday Messages ────────────────────────────────

/**
 * 10:30 (T2-T5) / 9:30 (T6) — Morning Briefing
 */
async function sendMorningBriefing(env, isFriday) {
  const tasks = await queryTasks('today', env);
  const overdue = await queryTasks('overdue', env);

  const now = new Date();
  const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const day = `${dayNames[vnDate.getUTCDay()]} ${vnDate.getUTCDate()}/${vnDate.getUTCMonth() + 1}`;

  const dayType = isFriday ? '🏠 WFH' : '🏢 Office';
  const capacity = isFriday ? 420 : 330;

  let msg = `☀️ Morning Briefing — ${day} (${dayType})\n\n`;

  if (overdue.length > 0) {
    msg += `⚠️ ${overdue.length} task QUÁ HẠN:\n`;
    overdue.slice(0, 3).forEach((t) => {
      msg += `  🔴 [${t.project}] ${t.title} — 📅 ${t.due_date}\n`;
    });
    msg += '\n';
  }

  if (tasks.length > 0) {
    const urgencyOrder = { '🔴 Fire': 0, '🟡 Important': 1, '🟢 Wait': 2, '⚪ Someday': 3 };
    tasks.sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9));

    const top3 = tasks.filter(t => t.urgency !== '⚪ Someday').slice(0, 3);
    const totalEst = top3.reduce((sum, t) => sum + (t.estimate || 0), 0);
    const loadPct = Math.round((totalEst / capacity) * 100);

    msg += `📋 Top 3 hôm nay:\n`;
    top3.forEach((t, i) => {
      const est = t.estimate ? `${t.estimate}p` : '?p';
      const block = t.block ? ` ${t.block}` : '';
      msg += `${i + 1}. ${t.urgency || ''} [${t.project}] ${t.title} — ${est}${block}\n`;
    });

    msg += `\n📊 Load: ${totalEst}/${capacity}p (${loadPct}%)`;
    if (loadPct > 100) msg += ' 🔴 OVERLOAD!';
    if (tasks.length > 3) msg += `\n📦 +${tasks.length - 3} task khác`;
  } else {
    msg += '📭 Không có task active. Free day! 🎉';
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg);
}

/**
 * 13:30 T2-T6 — Afternoon Check
 */
async function sendAfternoonCheck(env) {
  const tasks = await queryTasks('today', env);
  if (tasks.length === 0) return;

  const inProgress = tasks.filter(t => t.status === 'In progress');
  const todo = tasks.filter(t => t.status === 'To do');

  let msg = `🌤️ Afternoon Check:\n\n`;

  if (inProgress.length > 0) {
    msg += `🔄 Đang làm:\n`;
    inProgress.forEach(t => { msg += `  • [${t.project}] ${t.title}\n`; });
    msg += '\n';
  }

  msg += `📋 Còn ${todo.length} task To Do.`;
  if (todo.length > 5) msg += ` ⚠️ Nhiều quá — DEFER/DROP!`;

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg);
}

/**
 * 23:00 T2-T6 — Power Block Reminder
 */
async function sendPowerBlockReminder(env) {
  const tasks = await queryTasks('today', env);
  const pbTasks = tasks.filter(t => t.block === '🌙 Power Block' && t.status !== 'Completed');
  const lowEnergy = tasks.filter(t => t.energy === '😴 Low' && t.status !== 'Completed');
  const candidates = pbTasks.length > 0 ? pbTasks : lowEnergy;

  let msg = `⚡ Power Block — 23:00-01:00\n\n`;

  if (candidates.length > 0) {
    msg += `🎯 Suggest:\n`;
    candidates.slice(0, 2).forEach((t, i) => {
      const est = t.estimate ? `${t.estimate}p` : '?p';
      msg += `${i + 1}. [${t.project}] ${t.title} — ${est}\n`;
    });
    msg += '\n💡 Pick 1 task max. Đừng overdo.';
  } else {
    msg += '📭 Không có task Power Block. Nghỉ hoặc xem /backlog.';
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg);
}

// ─── Weekend Messages ────────────────────────────────

/**
 * 9:30 T7+CN — Weekend Review
 */
async function sendWeekendReview(env, dayNum) {
  const tasks = await queryTasks('all_active', env);
  const overdue = await queryTasks('overdue', env);
  const backlog = await queryTasks('backlog', env);

  const dayName = dayNum === 6 ? 'Thứ 7' : 'Chủ Nhật';

  let msg = `☀️ Weekend Review — ${dayName}\n\n`;

  // Overdue summary
  if (overdue.length > 0) {
    msg += `⚠️ ${overdue.length} task quá hạn cần xử lý:\n`;
    overdue.slice(0, 5).forEach(t => {
      msg += `  🔴 [${t.project}] ${t.title}\n`;
    });
    msg += '\n';
  }

  // Active tasks summary by project
  const byProject = {};
  tasks.filter(t => t.urgency !== '⚪ Someday').forEach(t => {
    const p = t.project || '?';
    byProject[p] = (byProject[p] || 0) + 1;
  });

  const totalActive = tasks.filter(t => t.urgency !== '⚪ Someday').length;
  msg += `📊 Active: ${totalActive} tasks\n`;
  for (const [proj, count] of Object.entries(byProject)) {
    msg += `  📂 ${proj}: ${count}\n`;
  }

  // Backlog tease
  if (backlog.length > 0) {
    msg += `\n💡 ${backlog.length} ý tưởng trong Backlog — /backlog để xem.`;
  }

  msg += '\n\n🎮 Enjoy weekend! Gõ /plan nếu muốn làm gì đó.';

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg);
}

/**
 * 20:00 T7+CN — Weekend Evening Prep
 */
async function sendWeekendPrep(env) {
  const overdue = await queryTasks('overdue', env);
  const tasks = await queryTasks('today', env);

  const now = new Date();
  const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const isSunday = vnDate.getUTCDay() === 0;

  let msg = `🌙 Weekend Wrapup — ${isSunday ? 'Prep T2' : 'Enjoy!'}\n\n`;

  if (overdue.length > 0) {
    msg += `⚠️ ${overdue.length} task quá hạn carry over:\n`;
    overdue.slice(0, 3).forEach(t => {
      msg += `  • [${t.project}] ${t.title}\n`;
    });
    msg += '\n';
  }

  const remaining = tasks.filter(t => t.status !== 'Completed');
  if (remaining.length > 0) {
    msg += `📋 ${remaining.length} task active cho tuần tới.\n`;
  }

  if (isSunday) {
    msg += '\n💡 Sunday prep: review overdue + plan T2 sáng mai.';
  }

  msg += '\n🎮 Game time! 21:00-23:00 = sacred.';

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg);
}
