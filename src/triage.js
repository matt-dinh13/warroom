// Triage logic — orchestrate MiniMax AI + Notion actions

import { callMiniMax } from './minimax.js';
import { createTask, queryTasks, updateTaskStatus } from './notion.js';
import { SYSTEM_PROMPT } from './prompts.js';

/**
 * Process a chat message: AI parse → Notion action → response
 * @param {string} userMessage - User's chat input
 * @param {object} env - Cloudflare env bindings
 * @returns {Promise<object>} { response_text, intent, ... }
 */
export async function processChat(userMessage, env) {
  // Step 1: Call AI to parse intent + extract data
  const aiResult = await callMiniMax(SYSTEM_PROMPT, userMessage, env.MINIMAX_API_KEY);

  // Step 2: Execute Notion action based on AI response
  let notionResult = null;
  const action = aiResult.notion_action;

  if (action) {
    try {
      switch (action.type) {
        case 'create':
          notionResult = await createTask(action.data, env);
          break;

        case 'query':
          notionResult = await queryTasks(action.data?.query_type || 'today', env);

          // If AI returned TRIAGE, build a better response with actual data
          if (aiResult.intent === 'TRIAGE' && Array.isArray(notionResult)) {
            aiResult.response_text = buildTriageResponse(notionResult);
          } else if (aiResult.intent === 'OVERDUE_CHECK' && Array.isArray(notionResult)) {
            aiResult.response_text = buildOverdueResponse(notionResult);
          } else if (aiResult.intent === 'LOAD_CHECK' && Array.isArray(notionResult)) {
            aiResult.response_text = buildLoadCheckResponse(notionResult);
          } else if (aiResult.intent === 'REPORT' && Array.isArray(notionResult)) {
            aiResult.response_text = buildReportResponse(notionResult);
          } else if (aiResult.intent === 'BACKLOG_BROWSE' && Array.isArray(notionResult)) {
            aiResult.response_text = buildBacklogResponse(notionResult);
          }
          break;

        case 'update':
          if (action.data?.task_title && action.data?.new_status) {
            notionResult = await updateTaskStatus(
              action.data.task_title,
              action.data.new_status,
              env
            );
            if (!notionResult) {
              aiResult.response_text = `❌ Không tìm thấy task "${action.data.task_title}". Thử gõ chính xác hơn?`;
            }
          }
          break;
      }
    } catch (err) {
      console.error('Notion action error:', err);
      aiResult.response_text += `\n\n⚠️ Lỗi Notion: ${err.message}`;
    }
  }

  return {
    intent: aiResult.intent,
    response_text: aiResult.response_text,
    needs_confirmation: aiResult.needs_confirmation || false,
    follow_up_question: aiResult.follow_up_question || null,
    task_count: Array.isArray(notionResult) ? notionResult.length : undefined,
  };
}

// ─── Response Builders ───────────────────────────────────────

function buildTriageResponse(tasks) {
  if (!tasks.length) {
    return '📭 Không có task nào active. Chill đi Matt! 🎮';
  }

  // Sort: Fire first, then Important, then by due date
  const urgencyOrder = { '🔴 Fire': 0, '🟡 Important': 1, '🟢 Wait': 2, '⚪ Someday': 3 };
  tasks.sort((a, b) => {
    const ua = urgencyOrder[a.urgency] ?? 9;
    const ub = urgencyOrder[b.urgency] ?? 9;
    if (ua !== ub) return ua - ub;
    return (a.due_date || '9999').localeCompare(b.due_date || '9999');
  });

  // Take top 3
  const top3 = tasks.slice(0, 3);
  const totalEstimate = top3.reduce((sum, t) => sum + (t.estimate || 0), 0);
  const totalAll = tasks.reduce((sum, t) => sum + (t.estimate || 0), 0);

  // Detect day type (simple: weekday check)
  const day = new Date().getDay();
  const isFriday = day === 5;
  const isWeekend = day === 0 || day === 6;
  const capacity = isWeekend ? 120 : isFriday ? 420 : 330; // WFH Friday, Office other days
  const dayType = isWeekend ? '🏠 Weekend' : isFriday ? '🏠 WFH' : '🏢 Office';

  let response = `📋 Plan hôm nay (${dayType} — ${capacity} phút):\n\n`;

  top3.forEach((t, i) => {
    const est = t.estimate ? `${t.estimate} phút` : '? phút';
    const block = t.block || '';
    const urg = t.urgency || t.priority || '';
    response += `${i + 1}. ${urg} [${t.project}] ${t.title} — ${est} ${block}\n`;
  });

  const loadPct = Math.round((totalEstimate / capacity) * 100);
  const loadStatus = loadPct > 100 ? '🔴 OVERLOAD' : loadPct > 80 ? '🟡 Heavy' : '✅ OK';

  response += `\n📊 Top 3 Load: ${totalEstimate}/${capacity} phút (${loadPct}%) ${loadStatus}`;

  if (tasks.length > 3) {
    response += `\n📦 Còn ${tasks.length - 3} task khác trong queue (tổng ${totalAll} phút)`;
  }

  return response;
}

function buildOverdueResponse(tasks) {
  if (!tasks.length) {
    return '✅ Không có task quá hạn. Good job Matt! 💪';
  }

  let response = `⚠️ ${tasks.length} task quá hạn:\n\n`;
  tasks.forEach((t, i) => {
    response += `${i + 1}. ${t.urgency} [${t.project}] ${t.title} — 📅 ${t.due_date || 'no date'}\n`;
  });
  response += '\n💡 Suggest: Reschedule hoặc Drop task không còn relevant.';

  return response;
}

function buildLoadCheckResponse(tasks) {
  const totalEstimate = tasks.reduce((sum, t) => sum + (t.estimate || 0), 0);
  const taskCount = tasks.length;

  const day = new Date().getDay();
  const isFriday = day === 5;
  const dailyCapacity = isFriday ? 420 : 330;
  const weeklyCapacity = dailyCapacity * 5 + 120 * 5; // include power blocks

  let response = `📊 Load Check:\n\n`;
  response += `📌 Active tasks: ${taskCount}\n`;
  response += `⏱️ Tổng estimate: ${totalEstimate} phút (~${Math.round(totalEstimate / 60)}h)\n`;
  response += `📅 Weekly capacity: ${weeklyCapacity} phút (~${Math.round(weeklyCapacity / 60)}h)\n`;

  const loadPct = Math.round((totalEstimate / weeklyCapacity) * 100);

  if (loadPct > 100) {
    response += `\n🔴 OVERLOAD ${loadPct}%! Cần DROP hoặc DEFER ${Math.round((totalEstimate - weeklyCapacity) / 60)}h task.`;

    // Suggest tasks to drop (lowest urgency first)
    const droppable = tasks
      .filter(t => t.urgency === '⚪ Someday' || t.urgency === '🟢 Wait')
      .slice(0, 3);

    if (droppable.length) {
      response += '\n\n💡 Suggest DROP/DEFER:\n';
      droppable.forEach((t) => {
        response += `  • [${t.project}] ${t.title} (${t.urgency})\n`;
      });
    }
  } else if (loadPct > 80) {
    response += `\n🟡 Heavy load (${loadPct}%). Cẩn thận, đừng nhận thêm task.`;
  } else {
    response += `\n✅ Load OK (${loadPct}%). Còn room để nhận task mới.`;
  }

  return response;
}

function buildReportResponse(tasks) {
  // In existing DB, "Completed" covers both done & dropped
  const completed = tasks.filter(t => t.status === 'Completed');
  const totalTime = completed.reduce((sum, t) => sum + (t.estimate || 0), 0);

  let response = `📊 Weekly Report:\n\n`;
  response += `✅ Completed: ${completed.length} tasks (~${Math.round(totalTime / 60)}h)\n`;

  if (completed.length) {
    response += '\nCompleted:\n';
    completed.slice(0, 15).forEach((t) => {
      response += `  ✅ [${t.project}] ${t.title}\n`;
    });
  } else {
    response += '\nChưa có task nào completed tuần này.';
  }

  return response;
}

function buildBacklogResponse(tasks) {
  if (!tasks.length) {
    return '📭 Backlog trống. Gửi link, video, hoặc ý tưởng bất kỳ để lưu vào đây!';
  }

  let response = `💡 Backlog — ${tasks.length} ý tưởng đang chờ:\n\n`;

  // Group by project
  const byProject = {};
  tasks.forEach((t) => {
    const proj = t.project || 'Chưa phân loại';
    if (!byProject[proj]) byProject[proj] = [];
    byProject[proj].push(t);
  });

  for (const [project, items] of Object.entries(byProject)) {
    response += `📂 ${project}:\n`;
    items.forEach((t, i) => {
      const link = t.resource ? ` 🔗` : '';
      const note = t.notes ? ` — ${t.notes.substring(0, 50)}` : '';
      response += `  ${i + 1}. ${t.title}${link}${note}\n`;
    });
    response += '\n';
  }

  response += '💡 Muốn bắt đầu cái nào? Gõ "pick [tên]" hoặc "done [tên]".';

  return response;
}
