// Triage v5.2 — Agentic orchestrator (sarcastic, context-aware)
// Phase 1: Instant commands (regex, <1s)
// Phase 2: AI-powered (MiniMax, 5-15s) with task context injection
// Phase 3: Fallback parsers (when AI returns plain text)

import { callMiniMax } from './minimax.js';
import { createTask, queryTasks, updateTaskStatus, editTask, archiveTask } from './notion.js';
import { SYSTEM_PROMPT, PROJECT_SOURCE_MAP } from './prompts.js';
import { matchInstantCommand, executeInstantCommand } from './commands.js';
import { getVNContext, buildCaptureConfirmation, buildCompletionResponse } from './responses.js';
import { tryParseCaptureFromAIResponse, detectFallbackIntent, extractUpdateTarget } from './parsers.js';

// ─── Conversation Memory ─────────────────────────────
const MEMORY_TTL = 86400; // 24h
const MAX_MEMORY = 5;

async function getConversation(chatId, env) {
  if (!env.CHAT_MEMORY) return [];
  try { return (await env.CHAT_MEMORY.get(`chat:${chatId}`, 'json')) || []; } catch { return []; }
}

async function saveConversation(chatId, messages, env) {
  if (!env.CHAT_MEMORY) return;
  try {
    await env.CHAT_MEMORY.put(`chat:${chatId}`, JSON.stringify(messages.slice(-MAX_MEMORY * 2)), {
      expirationTtl: MEMORY_TTL,
    });
  } catch {}
}

// ─── Last Plan Cache (for "done N") ─────────────────
async function getLastPlan(chatId, env) {
  if (!env.CHAT_MEMORY) return [];
  try { return (await env.CHAT_MEMORY.get(`lastplan:${chatId}`, 'json')) || []; } catch { return []; }
}

async function saveLastPlan(chatId, tasks, env) {
  if (!env.CHAT_MEMORY) return;
  try {
    const s = tasks.map(t => ({ title: t.title, id: t.id, urgency: t.urgency, project: t.project }));
    await env.CHAT_MEMORY.put(`lastplan:${chatId}`, JSON.stringify(s), { expirationTtl: MEMORY_TTL });
  } catch {}
}

function buildResult(intent, text, taskCount) {
  return { intent, response_text: text, needs_confirmation: false, follow_up_question: null, task_count: taskCount };
}

// ─── Main Entry ───────────────────────────────────────
export async function processChat(userMessage, env, chatId = 'web') {
  const msg = userMessage.trim();

  // ═══ PHASE 1: Instant Commands (regex, <1s) ═══════
  const cmd = matchInstantCommand(msg);
  if (cmd) {
    const result = await executeInstantCommand(cmd, env, chatId, getLastPlan, saveLastPlan);
    if (result) return result;
  }

  // ═══ PHASE 2: AI-Powered ═══════
  const { dateContext } = getVNContext();

  // Build task context for agentic awareness
  let taskCtx = '';
  try {
    const [todayTasks, overdueTasks] = await Promise.all([
      queryTasks('today', env),
      queryTasks('overdue', env),
    ]);
    const todayCount = todayTasks?.length || 0;
    const overdueCount = overdueTasks?.length || 0;
    const totalEst = (todayTasks || []).reduce((s, t) => s + (t.estimate || 0), 0);
    taskCtx = `\n[📊 Workload: ${todayCount} tasks hôm nay (~${Math.round(totalEst / 60)}h), ${overdueCount} overdue]`;
    if (overdueCount > 0 && overdueTasks[0]) {
      const daysSince = overdueTasks[0].due_date
        ? Math.floor((Date.now() - new Date(overdueTasks[0].due_date).getTime()) / 86400000)
        : '?';
      taskCtx += `\n[🔴 Overdue: "${overdueTasks[0].title}" (quá ${daysSince} ngày)]`;
    }
  } catch {}

  const enrichedMessage = `${dateContext}${taskCtx}\n${msg}`;
  const history = await getConversation(chatId, env);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: enrichedMessage },
  ];

  const aiResult = await callMiniMax(null, null, env.MINIMAX_API_KEY, messages);
  const updatedHistory = [...history, { role: 'user', content: enrichedMessage }];

  let notionResult = null;
  const action = aiResult.notion_action;
  let responseText = aiResult.response_text || '';

  if (action) {
    try {
      switch (action.type) {
        case 'create': {
          const taskData = action.data || {};
          // Auto-map source from project
          if (taskData.project && !taskData.source) {
            taskData.source = PROJECT_SOURCE_MAP[taskData.project] || 'EIT';
          }
          // Auto-set materials defaults
          if (taskData.project === 'MATERIALS') {
            taskData.urgency = '⚪ Someday';
          }

          if (aiResult.intent === 'CAPTURE_SPLIT' && action.data?.parent && action.data?.subtasks) {
            const parent = action.data.parent;
            if (parent.project && !parent.source) parent.source = PROJECT_SOURCE_MAP[parent.project] || 'EIT';
            await createTask(parent, env);
            for (const sub of action.data.subtasks) {
              await createTask({ ...sub, project: parent.project, urgency: parent.urgency, source: parent.source }, env);
            }
            notionResult = true;
            responseText = `✅ Đã tạo + chia nhỏ:\n📌 ${parent.title}\n📦 ${action.data.subtasks.length} sub-tasks\n\n💡 Gõ "plan" để xem.`;
          } else {
            notionResult = await createTask(taskData, env);
            // Check overload
            let overloadWarning = '';
            try {
              const todayCount = (await queryTasks('today', env))?.length || 0;
              if (todayCount > 6) {
                overloadWarning = `\n\n⚠️ ${todayCount} tasks rồi đó, thêm nữa tính ở lại đêm à?`;
              }
            } catch {}
            responseText = buildCaptureConfirmation(taskData) + overloadWarning;
          }
          break;
        }
        case 'create_batch': {
          const tasks = action.data?.tasks || [];
          for (const t of tasks) {
            if (t.project && !t.source) t.source = PROJECT_SOURCE_MAP[t.project] || 'EIT';
            if (t.project === 'MATERIALS') t.urgency = '⚪ Someday';
            await createTask(t, env);
          }
          notionResult = true;
          let r = `✅ Đã tạo ${tasks.length} tasks:\n`;
          tasks.forEach((t, i) => { r += `  ${i + 1}. ${t.urgency || '🟡'} ${t.title} (${t.project || '?'})\n`; });
          r += `\n💡 Gõ "plan" để xem ưu tiên.`;
          responseText = r;
          break;
        }
        case 'update':
          if (action.data?.task_title && action.data?.new_status) {
            notionResult = await updateTaskStatus(action.data.task_title, action.data.new_status, env);
            if (!notionResult) {
              responseText = `❌ Không tìm thấy "${action.data.task_title}".`;
            } else {
              const remaining = await queryTasks('today', env);
              responseText = buildCompletionResponse(notionResult, remaining.length, remaining);
            }
          }
          break;
        case 'edit':
          if (action.data?.task_title && action.data?.updates) {
            notionResult = await editTask(action.data.task_title, action.data.updates, env);
            if (!notionResult) {
              responseText = `❌ Không tìm thấy "${action.data.task_title}".`;
            } else {
              const changes = Object.entries(action.data.updates).map(([k, v]) => `  • ${k}: ${v}`).join('\n');
              responseText = `✏️ Đã sửa "${notionResult.title}":\n${changes}\n\n💡 Gõ "plan" để xem lại.`;
            }
          }
          break;
        case 'delete':
          if (action.data?.task_title) {
            const archived = await archiveTask(action.data.task_title, env);
            responseText = archived ? `🗑️ Đã xoá: "${archived.title}"` : `❌ Không tìm thấy "${action.data.task_title}".`;
          }
          break;
        case 'query':
          notionResult = await queryTasks(action.data?.query_type || 'today', env);
          // Let AI's response_text be used, or override with builder
          break;
      }
    } catch (err) {
      console.error('Notion error:', err);
      responseText += `\n\n⚠️ Lỗi: ${err.message}`;
    }
  }

  // ═══ PHASE 3: Fallback (AI returned plain text) ═══════
  if (!action && !notionResult) {
    const { isUpdate, isEdit, isDelete } = detectFallbackIntent(msg);

    // UPDATE fallback
    if (isUpdate) {
      const taskName = extractUpdateTarget(msg);
      if (taskName) {
        try {
          const result = await updateTaskStatus(taskName, 'Completed', env);
          if (result) {
            notionResult = result;
            const remaining = await queryTasks('today', env);
            responseText = buildCompletionResponse(result, remaining.length, remaining);
          }
        } catch (err) {
          console.error('Update fallback error:', err);
        }
      }
    }

    // CAPTURE fallback (only if not update/edit/delete)
    if (!notionResult && !isUpdate && !isEdit && !isDelete && /📌|📋/.test(responseText)) {
      const fallbackTask = tryParseCaptureFromAIResponse(responseText, msg);
      if (fallbackTask) {
        try {
          notionResult = await createTask(fallbackTask, env);
          responseText = buildCaptureConfirmation(fallbackTask);
        } catch {}
      }
    }
  }

  // Save last plan for "done N"
  if (Array.isArray(notionResult) && (aiResult.intent === 'TRIAGE' || aiResult.intent === 'LIST_TASKS')) {
    await saveLastPlan(chatId, notionResult, env);
  }

  // Save conversation memory
  const finalHistory = [...updatedHistory, { role: 'assistant', content: responseText }];
  await saveConversation(chatId, finalHistory, env);

  // ═══ Intent auto-correction ═══════
  // MiniMax often returns intent=CLARIFY even when it performed an action
  let finalIntent = aiResult.intent || 'CLARIFY';
  if (finalIntent === 'CLARIFY' && action && notionResult) {
    const intentMap = {
      'create': 'CAPTURE',
      'create_batch': 'CAPTURE_BATCH',
      'update': 'UPDATE',
      'edit': 'EDIT',
      'delete': 'DELETE',
      'query': 'LIST_TASKS',
    };
    finalIntent = intentMap[action.type] || finalIntent;
  }

  return buildResult(finalIntent, responseText, Array.isArray(notionResult) ? notionResult.length : undefined);
}
