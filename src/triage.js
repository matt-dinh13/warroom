// Triage logic — orchestrate MiniMax AI + Notion actions
// v2.0: conversation memory, EDIT, CAPTURE_SPLIT, better formatting

import { callMiniMax } from './minimax.js';
import { createTask, queryTasks, updateTaskStatus, editTask } from './notion.js';
import { SYSTEM_PROMPT } from './prompts.js';

// ─── Conversation Memory ─────────────────────────────

const MEMORY_TTL = 3600; // 1 hour
const MAX_MEMORY = 5; // last 5 messages

async function getConversation(chatId, env) {
  if (!env.CHAT_MEMORY) return [];
  try {
    const data = await env.CHAT_MEMORY.get(`chat:${chatId}`, 'json');
    return data || [];
  } catch { return []; }
}

async function saveConversation(chatId, messages, env) {
  if (!env.CHAT_MEMORY) return;
  try {
    // Keep only last MAX_MEMORY exchanges
    const trimmed = messages.slice(-MAX_MEMORY * 2);
    await env.CHAT_MEMORY.put(`chat:${chatId}`, JSON.stringify(trimmed), {
      expirationTtl: MEMORY_TTL,
    });
  } catch {}
}

// ─── Main Entry ──────────────────────────────────────

/**
 * Process a chat message: AI parse → Notion action → response
 * @param {string} userMessage - User's chat input
 * @param {object} env - Cloudflare env bindings
 * @param {string} chatId - User identifier for conversation memory
 * @returns {Promise<object>} { response_text, intent, ... }
 */
export async function processChat(userMessage, env, chatId = 'web') {
  // Step 0: Inject datetime context
  const now = new Date();
  const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const dayNames = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  const dayNum = vnDate.getUTCDay();
  const isFriday = dayNum === 5;
  const isWeekend = dayNum === 0 || dayNum === 6;
  const dayType = isWeekend ? 'Weekend' : isFriday ? 'WFH' : 'Office';
  const capacity = isWeekend ? 120 : isFriday ? 420 : 330;
  const vnHour = vnDate.getUTCHours();
  const block = vnHour < 12 ? '☀️ AM' : vnHour < 18 ? '🌤️ PM' : '🌙 Evening';

  const dateContext = `[Context: ${dayNames[dayNum]} ${vnDate.getUTCDate()}/${vnDate.getUTCMonth() + 1}/${vnDate.getUTCFullYear()}, ${vnHour}:${String(vnDate.getUTCMinutes()).padStart(2, '0')}, ${dayType}, capacity ${capacity}p, block: ${block}]`;

  // Step 1: Build conversation with memory
  const history = await getConversation(chatId, env);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: `${dateContext}\n${userMessage}` },
  ];

  const aiResult = await callMiniMax(null, null, env.MINIMAX_API_KEY, messages);

  // Save to memory
  history.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: aiResult.response_text || '' }
  );
  await saveConversation(chatId, history, env);

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
              aiResult.response_text = `❌ Không tìm thấy task "${action.data.task_title}".\n💡 Gõ chính xác hơn hoặc dùng từ khóa chính.`;
            }
          }
          break;

        case 'edit':
          if (action.data?.task_title && action.data?.updates) {
            notionResult = await editTask(
              action.data.task_title,
              action.data.updates,
              env
            );
            if (!notionResult) {
              aiResult.response_text = `❌ Không tìm thấy task "${action.data.task_title}".`;
            } else {
              const changes = Object.entries(action.data.updates)
                .map(([k, v]) => `  • ${k}: ${v}`)
                .join('\n');
              aiResult.response_text = `✏️ Đã cập nhật "${notionResult.title}":\n${changes}`;
            }
          }
          break;
      }

      // Handle CAPTURE_SPLIT: create parent + sub-tasks
      if (aiResult.intent === 'CAPTURE_SPLIT' && action.data?.parent && action.data?.subtasks) {
        const parent = await createTask(action.data.parent, env);
        const parentTitle = action.data.parent.title;
        const subtaskResults = [];

        for (const sub of action.data.subtasks) {
          const subtask = {
            ...sub,
            project: action.data.parent.project,
            urgency: action.data.parent.urgency,
            source: action.data.parent.source,
            context: `Sub-task of: ${parentTitle}`,
          };
          await createTask(subtask, env);
          subtaskResults.push(sub);
        }

        let response = `✅ Đã tạo + chia nhỏ task:\n${'─'.repeat(24)}\n\n`;
        response += `📌 ${parentTitle}\n`;
        response += `   📂 ${action.data.parent.project || '?'} · ${action.data.parent.urgency || ''}\n\n`;
        response += `📦 ${subtaskResults.length} sub-tasks:\n`;
        subtaskResults.forEach((s, i) => {
          const est = s.estimate ? `${s.estimate}p` : '?p';
          response += `  ${i + 1}. ${s.title} — ${est}\n`;
        });
        aiResult.response_text = response;
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

function getVNDayInfo() {
  const now = new Date();
  const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const dayNum = vnDate.getUTCDay();
  const isFriday = dayNum === 5;
  const isWeekend = dayNum === 0 || dayNum === 6;
  return {
    capacity: isWeekend ? 120 : isFriday ? 420 : 330,
    dayType: isWeekend ? '🏠 Weekend' : isFriday ? '🏠 WFH' : '🏢 Office',
  };
}

function formatTask(t, index) {
  const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  const num = nums[index] || `${index + 1}.`;
  const est = t.estimate ? `${t.estimate}p` : '?p';
  const block = t.block ? ` · ${t.block}` : '';
  const deadline = t.due_date ? ` · 📅 ${t.due_date}` : '';
  const urg = t.urgency || '';
  return `${num} ${urg} ${t.title}\n   📂 ${t.project || '?'} · ⏱ ${est}${block}${deadline}`;
}

function buildLoadBar(pct) {
  const filled = Math.min(Math.round(pct / 10), 10);
  const empty = 10 - filled;
  const icon = pct > 100 ? '🔴' : pct > 80 ? '🟡' : '🟢';
  return `${icon} ${'█'.repeat(filled)}${'░'.repeat(empty)} ${pct}%`;
}

function buildTriageResponse(tasks) {
  if (!tasks.length) {
    return '📭 Không có task nào active.\nChill đi Matt! 🎮';
  }

  const urgencyOrder = { '🔴 Fire': 0, '🟡 Important': 1, '🟢 Wait': 2, '⚪ Someday': 3 };
  tasks.sort((a, b) => {
    const ua = urgencyOrder[a.urgency] ?? 9;
    const ub = urgencyOrder[b.urgency] ?? 9;
    if (ua !== ub) return ua - ub;
    return (a.due_date || '9999').localeCompare(b.due_date || '9999');
  });

  const top3 = tasks.filter(t => t.urgency !== '⚪ Someday').slice(0, 3);
  const totalEstimate = top3.reduce((sum, t) => sum + (t.estimate || 0), 0);
  const totalAll = tasks.reduce((sum, t) => sum + (t.estimate || 0), 0);
  const { capacity, dayType } = getVNDayInfo();

  let response = `📋 Plan hôm nay (${dayType} — ${capacity}p)\n${'─'.repeat(24)}\n\n`;

  top3.forEach((t, i) => {
    response += formatTask(t, i) + '\n\n';
  });

  const loadPct = Math.round((totalEstimate / capacity) * 100);
  response += `${buildLoadBar(loadPct)}\n⏱ Top 3: ${totalEstimate}/${capacity}p`;

  if (tasks.length > 3) {
    response += `\n📦 +${tasks.length - 3} task khác (tổng ${totalAll}p)`;
  }

  return response;
}

function buildOverdueResponse(tasks) {
  if (!tasks.length) {
    return '✅ Không có task quá hạn.\nGood job Matt! 💪';
  }

  let response = `⚠️ ${tasks.length} task quá hạn\n${'─'.repeat(24)}\n\n`;
  tasks.forEach((t, i) => {
    response += formatTask(t, i) + '\n\n';
  });
  response += '💡 Reschedule hoặc gõ "done [tên]" để clear.';
  return response;
}

function buildLoadCheckResponse(tasks) {
  const totalEstimate = tasks.reduce((sum, t) => sum + (t.estimate || 0), 0);
  const taskCount = tasks.length;
  const { capacity } = getVNDayInfo();
  const weeklyCapacity = capacity * 5 + 120 * 5;

  let response = `📊 Load Check\n${'─'.repeat(24)}\n\n`;
  response += `📌 Active: ${taskCount} tasks\n`;
  response += `⏱ Tổng: ${totalEstimate}p (~${Math.round(totalEstimate / 60)}h)\n`;
  response += `📅 Weekly: ${weeklyCapacity}p (~${Math.round(weeklyCapacity / 60)}h)\n\n`;

  const loadPct = Math.round((totalEstimate / weeklyCapacity) * 100);
  response += buildLoadBar(loadPct);

  if (loadPct > 100) {
    response += `\n\n🔴 OVERLOAD! Cần DROP ~${Math.round((totalEstimate - weeklyCapacity) / 60)}h.`;
    const droppable = tasks
      .filter(t => t.urgency === '⚪ Someday' || t.urgency === '🟢 Wait')
      .slice(0, 3);
    if (droppable.length) {
      response += '\n\n💡 Suggest DROP:\n';
      droppable.forEach((t) => {
        response += `  • [${t.project}] ${t.title}\n`;
      });
    }
  } else if (loadPct > 80) {
    response += `\n\n🟡 Heavy — đừng nhận thêm task.`;
  } else {
    response += `\n\n✅ OK — còn room.`;
  }

  return response;
}

function buildReportResponse(tasks) {
  const completed = tasks.filter(t => t.status === 'Completed');
  const totalTime = completed.reduce((sum, t) => sum + (t.estimate || 0), 0);

  // Group by project
  const byProject = {};
  completed.forEach(t => {
    const proj = t.project || '?';
    byProject[proj] = (byProject[proj] || 0) + 1;
  });

  let response = `📊 Weekly Report\n${'─'.repeat(24)}\n\n`;
  response += `✅ Completed: ${completed.length} tasks (~${Math.round(totalTime / 60)}h)\n`;

  // Project breakdown
  if (Object.keys(byProject).length > 0) {
    response += '\n📂 By project:\n';
    for (const [proj, count] of Object.entries(byProject).sort((a, b) => b[1] - a[1])) {
      response += `  • ${proj}: ${count}\n`;
    }
  }

  if (completed.length) {
    response += '\n✅ Tasks:\n';
    completed.slice(0, 10).forEach((t) => {
      const est = t.estimate ? ` (${t.estimate}p)` : '';
      response += `  • [${t.project}] ${t.title}${est}\n`;
    });
    if (completed.length > 10) {
      response += `  ... +${completed.length - 10} nữa`;
    }
  } else {
    response += '\nChưa có task completed tuần này.';
  }

  return response;
}

function buildBacklogResponse(tasks) {
  if (!tasks.length) {
    return '📭 Backlog trống.\nGửi link, video, hoặc idea để lưu!';
  }

  let response = `💡 Backlog — ${tasks.length} ý tưởng\n${'─'.repeat(24)}\n\n`;

  const byProject = {};
  tasks.forEach((t) => {
    const proj = t.project || 'Chưa phân loại';
    if (!byProject[proj]) byProject[proj] = [];
    byProject[proj].push(t);
  });

  for (const [project, items] of Object.entries(byProject)) {
    response += `📂 ${project}\n`;
    items.forEach((t, i) => {
      const link = t.resource ? ' 🔗' : '';
      const note = t.notes ? ` — ${t.notes.substring(0, 40)}` : '';
      response += `  ${i + 1}. ${t.title}${link}${note}\n`;
    });
    response += '\n';
  }

  response += '💡 Gõ "pick [tên]" hoặc "done [tên]"';
  return response;
}
