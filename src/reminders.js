// Cron-triggered auto reminders v5.0
// Smart: shorter messages, skip when no tasks, no gamification
import { queryTasks } from './notion.js';
import { sendTelegramMessage } from './telegram.js';

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
    if (!isWeekend) {
      if (vnHour === 8 && vnMin === 0) {
        await sendMorningBriefing(env);
      } else if (vnHour === 10 && vnMin === 30) {
        await sendDriftCheck(env);
      } else if (vnHour === 13 && vnMin === 30) {
        await sendDriftCheck(env);
      } else if (vnHour === 15 && vnMin === 30) {
        await sendDriftCheck(env);
      } else if (vnHour === 16 && vnMin === 30) {
        await sendDriftCheck(env);
      } else if (vnHour === 23 && vnMin === 30) {
        await sendAutoDeferSummary(env);
      }
    }

    if (isWeekend) {
      if (vnHour === 9 && vnMin === 30) {
        await sendMorningBriefing(env);
      } else if (vnHour === 20 && vnMin === 0) {
        await sendAutoDeferSummary(env);
      }
    }
  } catch (err) {
    console.error('Cron handler error:', err);
  }
}

// ─── Morning Briefing ──────────────────────────────────────
async function sendMorningBriefing(env) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const tasks = await queryTasks('today', env);
  if (!tasks.length) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '📭 Không có task hôm nay.\n💡 Gõ /plan hoặc pick từ backlog.', 'HTML',
      buildKeyboard()
    );
    return;
  }

  const vnDate = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const dayNum = vnDate.getUTCDay();

  const urgencyOrder = { '🔴 Fire': 0, '🟡 Important': 1, '🟢 Wait': 2, '⚪ Someday': 9 };
  tasks.sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9));

  const today = vnDate.toISOString().split('T')[0];
  const overdue = tasks.filter(t => (t.due_date && t.due_date < today) || (t.do_date && t.do_date < today));

  let msg = `📋 ${dayNames[dayNum]} ${vnDate.getUTCDate()}/${vnDate.getUTCMonth() + 1} — ${tasks.length} tasks\n\n`;

  tasks.slice(0, 4).forEach((t, i) => {
    const est = t.estimate ? ` (${t.estimate}p)` : '';
    msg += `${t.urgency || '🟡'} ${t.title}${est}\n`;
  });
  if (tasks.length > 4) msg += `+${tasks.length - 4}\n`;

  if (overdue.length > 0) msg += `\n⚠️ ${overdue.length} quá hạn`;

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'HTML', buildKeyboard());
}

// ─── Drift Check (smart — skip if nothing important) ──────
async function sendDriftCheck(env) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const tasks = await queryTasks('today', env);
  const important = tasks.filter(t => t.urgency === '🔴 Fire' || t.urgency === '🟡 Important');

  // Skip if no important tasks
  if (!important.length) return;

  const inProgress = tasks.filter(t => t.status === 'In progress');

  let msg;
  if (inProgress.length > 0) {
    msg = `🔔 In Progress:\n`;
    inProgress.forEach(t => { msg += `  • ${t.title}\n`; });
    msg += `\nXong chưa?`;
  } else {
    msg = `⏳ Chưa start task nào\n`;
    if (important[0]) msg += `▶️ ${important[0].urgency} ${important[0].title}`;
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'HTML', buildKeyboard());
}

// ─── Auto-Defer + Daily Summary (23:30) ────────────────────
async function sendAutoDeferSummary(env) {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const tasks = await queryTasks('today', env);
  const completed = tasks.filter(t => t.status === 'Completed');
  const remaining = tasks.filter(t => t.status !== 'Completed');

  // Auto-defer remaining tasks to tomorrow
  const tomorrow = new Date(Date.now() + 7 * 60 * 60 * 1000 + 86400000).toISOString().split('T')[0];
  let deferred = 0;
  for (const task of remaining) {
    if (task.id && task.due_date) {
      try {
        await fetch(`https://api.notion.com/v1/pages/${task.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ properties: { 'Do Date': { date: { start: tomorrow } } } }),
        });
        deferred++;
      } catch {}
    }
  }

  let msg = `🌙 ${completed.length} done`;
  if (deferred > 0) msg += ` · ${deferred} → mai`;
  if (!completed.length && !deferred) msg += `\n💤 Nghỉ ngơi. Mai mới.`;
  else if (deferred > 0) msg += `\n💤 Rest well.`;
  else msg += `\n🎉 Great day!`;

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, 'HTML', buildKeyboard());
}

// ─── Keyboard ──────────────────────────────────────────────
function buildKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📋 Plan', callback_data: 'action_plan' },
        { text: '⚠️ Overdue', callback_data: 'action_overdue' },
        { text: '📊 Load', callback_data: 'action_load' },
      ],
    ],
  };
}
