// Triage v5.3 — Agentic orchestrator (sarcastic, context-aware)
// Phase 1: Instant commands (regex, <1s)
// Phase 2: AI-powered (MiniMax, 5-15s) with task context injection
// Phase 3: Fallback parsers (when AI returns plain text)

import { callMiniMax } from './minimax.js';
import { createTask, queryTasks, updateTaskStatus, editTask, archiveTask } from './notion.js';
import { SYSTEM_PROMPT, PROJECT_SOURCE_MAP } from './prompts.js';
import { matchInstantCommand, executeInstantCommand } from './commands.js';
import { getVNContext, buildCaptureConfirmation, buildCompletionResponse, buildConfirmCard } from './responses.js';
import { tryParseCaptureFromAIResponse, detectFallbackIntent, extractUpdateTarget, tryDirectParse, scoreDirectParse, enrichWithScheduledTime } from './parsers.js';
import { recordDelta, getHourKey, isWeekendVN } from './analytics.js';

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

// ─── Pending Task Draft Helpers (for confirmation) ──────
export async function savePendingTask(chatId, taskData, env, viaAI = true) {
  if (!env.CHAT_MEMORY) return;
  try {
    await env.CHAT_MEMORY.put(`pending:${chatId}`, JSON.stringify({ tasks: taskData, viaAI }), { expirationTtl: 600 });
  } catch (err) {
    console.error('savePendingTask error:', err);
  }
}

export async function getPendingTask(chatId, env) {
  if (!env.CHAT_MEMORY) return null;
  try {
    const raw = await env.CHAT_MEMORY.get(`pending:${chatId}`, 'json');
    if (!raw) return null;
    if (raw.tasks !== undefined && raw.viaAI !== undefined) {
      return raw;
    }
    // Fallback for old format
    return { tasks: raw, viaAI: true };
  } catch {
    return null;
  }
}


export async function clearPendingTask(chatId, env) {
  if (!env.CHAT_MEMORY) return;
  try {
    await env.CHAT_MEMORY.delete(`pending:${chatId}`);
  } catch {}
}

async function flushAIAnalytics(env, analytics, intent, { aiFailure = false } = {}) {
  try {
    analytics.intents = { [intent]: 1 };
    if (aiFailure) analytics.ai_failures = 1;
    await recordDelta(env, analytics);
  } catch (err) {
    console.error('flushAIAnalytics error:', err);
  }
}

// ─── Main Entry ───────────────────────────────────────
export async function processChat(userMessage, env, chatId = 'web') {
  const msg = userMessage.trim();
  const source = chatId === 'web' ? 'web' : 'telegram';
  const t0 = Date.now();

  // Resolve pending confirmation if any
  const pending = await getPendingTask(chatId, env);
  if (pending) {
    const lower = msg.toLowerCase();
    if (/^(ok|đúng|tạo|yes|y|ừ|uh|chuẩn)$/i.test(lower)) {
      await clearPendingTask(chatId, env);
      const tasks = Array.isArray(pending.tasks) ? pending.tasks : [pending.tasks];
      try {
        for (const t of tasks) {
          await createTask(t, env);
        }
        let responseText = '';
        if (tasks.length > 1) {
          const confirmTexts = tasks.map(t => buildCaptureConfirmation(t));
          responseText = `✅ Đã tạo ${tasks.length} tasks:\n\n${confirmTexts.join('\n---\n')}`;
        } else {
          responseText = buildCaptureConfirmation(tasks[0]);
        }
        // Overload warning
        try {
          const todayCount = (await queryTasks('today', env))?.length || 0;
          if (todayCount > 6) responseText += `\n\n⚠️ ${todayCount} tasks rồi đó, thêm nữa tính ở lại đêm à?`;
        } catch {}

        // Record analytics
        try {
          const finalIntent = tasks.length > 1 ? 'CAPTURE_BATCH' : 'CAPTURE';
          const captureSource = pending.viaAI ? `chat_${source}` : 'direct_parse';
          const count = tasks.length;
          const wknd = isWeekendVN();
          await recordDelta(env, {
            interactions: 1,
            sources: { [source]: 1 },
            is_weekend: wknd ? 1 : 0,
            is_weekday: wknd ? 0 : 1,
            intents: { [finalIntent]: 1 },
            captures: { [captureSource]: count },
            hourly_capture: { [getHourKey()]: count }
          });
        } catch (err) {
          console.error('Confirm capture analytics error:', err);
        }

        // Save conversation memory
        const history = await getConversation(chatId, env);
        const finalHistory = [...history, { role: 'user', content: msg }, { role: 'assistant', content: responseText }];
        await saveConversation(chatId, finalHistory, env);

        return buildResult(tasks.length > 1 ? 'CAPTURE_BATCH' : 'CAPTURE', responseText, tasks.length);
      } catch (err) {
        console.error('Confirm capture Notion error:', err);
        const errText = `❌ Lỗi tạo task: ${err.message}`;
        return buildResult('CLARIFY', errText);
      }
    } else if (/^(không|sửa|hủy|no|cancel)$/i.test(lower)) {
      await clearPendingTask(chatId, env);
      const responseText = "OK bỏ, gõ lại nhé.";
      
      const history = await getConversation(chatId, env);
      const finalHistory = [...history, { role: 'user', content: msg }, { role: 'assistant', content: responseText }];
      await saveConversation(chatId, finalHistory, env);

      return buildResult('CLARIFY', responseText);
    }
    // If it is anything else, clear pending task and fall through to normal triage flow
    await clearPendingTask(chatId, env);
  }

  // ═══ PHASE 1: Instant Commands (regex, <1s) ═══════
  const cmd = matchInstantCommand(msg);
  if (cmd) {
    const result = await executeInstantCommand(cmd, env, chatId, getLastPlan, saveLastPlan);
    if (result) {
      // Analytics: instant command (no AI)
      const hk = getHourKey();
      const wknd = isWeekendVN();
      const d = {
        interactions: 1, instant_commands: 1,
        sources: { [source]: 1 }, intents: { [result.intent]: 1 },
        is_weekend: wknd ? 1 : 0, is_weekday: wknd ? 0 : 1,
      };
      if (cmd.type === 'done_num' || cmd.type === 'done_name') {
        d.completions = { [cmd.type]: 1 };
        d.hourly_complete = { [hk]: 1 };
      }
      await recordDelta(env, d);
      return result;
    }
  }

  // ═══ PHASE 1.5: Deterministic capture ═══════
  const direct = scoreDirectParse(msg);
  if (direct && direct.confidence === 'high') {
    const tasks = Array.isArray(direct.tasks) ? direct.tasks : [direct.tasks];
    await savePendingTask(chatId, direct.tasks, env, false);

    let responseText = '';
    if (tasks.length > 1) {
      responseText = `📝 Xác nhận tạo ${tasks.length} tasks:\n` +
        tasks.map((t, idx) => `  ${idx + 1}. ${t.title}`).join('\n') +
        `\n\nĐúng không?`;
    } else {
      responseText = buildConfirmCard(tasks[0]);
    }

    // Save conversation memory
    const history = await getConversation(chatId, env);
    const finalHistory = [...history, { role: 'user', content: msg }, { role: 'assistant', content: responseText }];
    await saveConversation(chatId, finalHistory, env);

    // Record analytics for deterministic capture confirm
    const wknd = isWeekendVN();
    await recordDelta(env, {
      interactions: 1,
      sources: { [source]: 1 },
      is_weekend: wknd ? 1 : 0,
      is_weekday: wknd ? 0 : 1,
      intents: { CONFIRM_CAPTURE: 1 },
    });

    return {
      intent: 'CONFIRM_CAPTURE',
      response_text: responseText,
      needs_confirmation: true,
      pending_action: { type: 'create', data: direct.tasks }
    };
  }

  // ═══ PHASE 2: AI-Powered ═══════
  const { dateContext } = getVNContext();

  // Build task context for agentic awareness
  let taskCtx = '';
  try {
    // Calculate week range in VN timezone (+07:00)
    const nowLocal = new Date(Date.now() + 7 * 3600000);
    const day = nowLocal.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(nowLocal);
    monday.setUTCDate(nowLocal.getUTCDate() + diff);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const pad = n => String(n).padStart(2, '0');
    const ws = `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
    const we = `${sunday.getUTCFullYear()}-${pad(sunday.getUTCMonth() + 1)}-${pad(sunday.getUTCDate())}`;

    const [todayTasks, overdueTasks, weekTasks] = await Promise.all([
      queryTasks('today', env),
      queryTasks('overdue', env),
      queryTasks('calendar_week', env, { weekStart: ws, weekEnd: we }),
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

    // Extract scheduled tasks for duplicate prevention grounding
    const weekdays = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const scheduledList = (weekTasks || [])
      .filter(t => t.scheduled)
      .map(t => {
        const vnDate = new Date(new Date(t.scheduled).getTime() + 7 * 3600000);
        const dayOfWeek = weekdays[vnDate.getUTCDay()];
        const timeStr = `${String(vnDate.getUTCHours()).padStart(2, '0')}:${String(vnDate.getUTCMinutes()).padStart(2, '0')}`;
        return `[${dayOfWeek} ${timeStr}] "${t.title}" (${t.project || 'No project'}, ${t.status})`;
      });

    if (scheduledList.length > 0) {
      taskCtx += `\n[🗓️ Lịch tuần này:\n${scheduledList.join('\n')}]`;
    }
  } catch (err) {
    console.error('Context injection error:', err);
  }

  const enrichedMessage = `${dateContext}${taskCtx}\n${msg}`;
  const history = await getConversation(chatId, env);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: enrichedMessage },
  ];

  const aiStart = Date.now();
  const aiResult = await callMiniMax(null, null, env.MINIMAX_API_KEY, messages);
  const aiLatency = Date.now() - aiStart;
  const updatedHistory = [...history, { role: 'user', content: enrichedMessage }];

  // Analytics delta accumulator (flushed before each return below)
  const wknd = isWeekendVN();
  const analytics = {
    interactions: 1,
    sources: { [source]: 1 },
    ai_calls: 1,
    ai_latency_ms: aiLatency,
    is_weekend: wknd ? 1 : 0,
    is_weekday: wknd ? 0 : 1,
  };

  let notionResult = null;
  const action = aiResult.notion_action;
  let responseText = aiResult.response_text || '';

  if (action) {
    try {
      switch (action.type) {
        case 'create': {
          const taskData = action.data || {};

          // Normalize project name (case-insensitive)
          if (taskData.project) {
            const upper = taskData.project.toUpperCase();
            const validProjects = ['GMA', 'HOSEL', 'SALES', 'EMPULSE', 'KV', 'EDU', 'TEACH', 'LEARN', 'PERSONAL', 'MATERIALS'];
            if (validProjects.includes(upper)) {
              taskData.project = upper;
            }
          }

          // Auto-map source from project
          if (taskData.project && !taskData.source) {
            taskData.source = PROJECT_SOURCE_MAP[taskData.project] || 'EIT';
          }
          // Auto-set materials defaults
          if (taskData.project === 'MATERIALS') {
            taskData.urgency = '⚪ Someday';
          }

          // Default due_date to today if not set
          if (!taskData.due_date) {
            const now = new Date(Date.now() + 7 * 3600000);
            taskData.due_date = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;
          }

          // Enrich with scheduled_time if user mentioned a time
          enrichWithScheduledTime(taskData, msg);

          if (aiResult.intent === 'CAPTURE_SPLIT' && action.data?.parent && action.data?.subtasks) {
            const parent = action.data.parent;
            if (parent.project && !parent.source) parent.source = PROJECT_SOURCE_MAP[parent.project] || 'EIT';
            const subtasks = action.data.subtasks.map(sub => ({
              ...sub,
              project: parent.project,
              urgency: parent.urgency,
              source: parent.source
            }));
            const draftData = [parent, ...subtasks];
            await savePendingTask(chatId, draftData, env, true);

            const responseText = `📝 Xác nhận tạo & chia nhỏ:\n📌 ${parent.title}\n📂 Project: ${parent.project || '?'}\n⏱ Chia thành ${action.data.subtasks.length} sub-tasks\n\nĐúng không?`;
            
            const history = await getConversation(chatId, env);
            const finalHistory = [...history, { role: 'user', content: msg }, { role: 'assistant', content: responseText }];
            await saveConversation(chatId, finalHistory, env);

            await flushAIAnalytics(env, analytics, 'CONFIRM_CAPTURE');

            return {
              intent: 'CONFIRM_CAPTURE',
              response_text: responseText,
              needs_confirmation: true,
              pending_action: { type: 'create', data: draftData }
            };
          } else {
            await savePendingTask(chatId, taskData, env, true);
            const responseText = buildConfirmCard(taskData);

            const history = await getConversation(chatId, env);
            const finalHistory = [...history, { role: 'user', content: msg }, { role: 'assistant', content: responseText }];
            await saveConversation(chatId, finalHistory, env);

            await flushAIAnalytics(env, analytics, 'CONFIRM_CAPTURE');

            return {
              intent: 'CONFIRM_CAPTURE',
              response_text: responseText,
              needs_confirmation: true,
              pending_action: { type: 'create', data: taskData }
            };
          }
        }
        case 'create_batch': {
          let batchTasks = [];

          if (action.data) {
            if (Array.isArray(action.data.tasks)) {
              batchTasks = action.data.tasks;
            } else if (Array.isArray(action.data)) {
              batchTasks = action.data;
            }
          }

          if (batchTasks.length === 0) {
            const parsed = tryDirectParse(msg);
            if (parsed) batchTasks = Array.isArray(parsed) ? parsed : [parsed];
          }

          for (const t of batchTasks) {
            // Normalize each task
            if (t.project) {
              const upper = t.project.toUpperCase();
              const validProjects = ['GMA', 'HOSEL', 'SALES', 'EMPULSE', 'KV', 'EDU', 'TEACH', 'LEARN', 'PERSONAL', 'MATERIALS'];
              if (validProjects.includes(upper)) t.project = upper;
            }
            if (t.project && !t.source) t.source = PROJECT_SOURCE_MAP[t.project] || 'EIT';
            if (t.project === 'MATERIALS') t.urgency = '⚪ Someday';
            if (!t.due_date) {
              const now = new Date(Date.now() + 7 * 3600000);
              t.due_date = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;
            }
            if (!t.urgency) t.urgency = '🟡 Important';
            enrichWithScheduledTime(t, msg);
          }

          if (batchTasks.length > 0) {
            await savePendingTask(chatId, batchTasks, env, true);
            const responseText = `📝 Xác nhận tạo ${batchTasks.length} tasks:\n` +
              batchTasks.map((t, idx) => `  ${idx + 1}. ${t.title}`).join('\n') +
              `\n\nĐúng không?`;

            const history = await getConversation(chatId, env);
            const finalHistory = [...history, { role: 'user', content: msg }, { role: 'assistant', content: responseText }];
            await saveConversation(chatId, finalHistory, env);

            await flushAIAnalytics(env, analytics, 'CONFIRM_CAPTURE');

            return {
              intent: 'CONFIRM_CAPTURE',
              response_text: responseText,
              needs_confirmation: true,
              pending_action: { type: 'create', data: batchTasks }
            };
          }
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
      analytics.errors = 1;
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
        // Normalize project
        if (fallbackTask.project) {
          const upper = fallbackTask.project.toUpperCase();
          const validProjects = ['GMA', 'HOSEL', 'SALES', 'EMPULSE', 'KV', 'EDU', 'TEACH', 'LEARN', 'PERSONAL', 'MATERIALS'];
          if (validProjects.includes(upper)) fallbackTask.project = upper;
        }
        if (fallbackTask.project && !fallbackTask.source) {
          fallbackTask.source = PROJECT_SOURCE_MAP[fallbackTask.project] || 'EIT';
        }
        // Default due_date
        if (!fallbackTask.due_date) {
          const now = new Date(Date.now() + 7 * 3600000);
          fallbackTask.due_date = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;
        }
        enrichWithScheduledTime(fallbackTask, msg);

        await savePendingTask(chatId, fallbackTask, env, true);
        const confirmText = buildConfirmCard(fallbackTask);
        const history = await getConversation(chatId, env);
        const finalHistory = [...history, { role: 'user', content: msg }, { role: 'assistant', content: confirmText }];
        await saveConversation(chatId, finalHistory, env);

        await flushAIAnalytics(env, analytics, 'CONFIRM_CAPTURE', { aiFailure: true });

        return {
          intent: 'CONFIRM_CAPTURE',
          response_text: confirmText,
          needs_confirmation: true,
          pending_action: { type: 'create', data: fallbackTask }
        };
      }
    }
  }

  // ═══ PHASE 3.5: CAPTURE_BATCH fallback (AI returned intent but didn't create) ═══
  if (!notionResult && (aiResult.intent === 'CAPTURE_BATCH' || (aiResult.intent === 'CAPTURE' && !action))) {
    const directResult = tryDirectParse(msg);
    if (directResult) {
      const tasks = Array.isArray(directResult) ? directResult : [directResult];
      await savePendingTask(chatId, directResult, env, true);
      let responseText = '';
      if (tasks.length > 1) {
        responseText = `📝 Xác nhận tạo ${tasks.length} tasks:\n` +
          tasks.map((t, idx) => `  ${idx + 1}. ${t.title}`).join('\n') +
          `\n\nĐúng không?`;
      } else {
        responseText = buildConfirmCard(tasks[0]);
      }

      const history = await getConversation(chatId, env);
      const finalHistory = [...history, { role: 'user', content: msg }, { role: 'assistant', content: responseText }];
      await saveConversation(chatId, finalHistory, env);

      await flushAIAnalytics(env, analytics, 'CONFIRM_CAPTURE', { aiFailure: true });

      return {
        intent: 'CONFIRM_CAPTURE',
        response_text: responseText,
        needs_confirmation: true,
        pending_action: { type: 'create', data: directResult }
      };
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
  if (finalIntent === 'CLARIFY' && notionResult) {
    if (action) {
      // AI returned notion_action — map type to intent
      const intentMap = {
        'create': 'CAPTURE',
        'create_batch': 'CAPTURE_BATCH',
        'update': 'UPDATE',
        'edit': 'EDIT',
        'delete': 'DELETE',
        'query': 'LIST_TASKS',
      };
      finalIntent = intentMap[action.type] || finalIntent;
    } else if (/✅ Đã tạo|📌/.test(responseText)) {
      // Fallback parser created a task
      finalIntent = 'CAPTURE';
    } else if (/✅ Done|Cuối cùng|tưởng quên/.test(responseText)) {
      finalIntent = 'UPDATE';
    }
  }

  // ═══ Analytics finalization ═══════
  try {
    analytics.intents = { [finalIntent]: 1 };

    // Detect AI failure: AI returned no usable action but a fallback had to handle it
    if (!action && notionResult) {
      analytics.ai_failures = 1;
    }

    // Capture tracking
    if (finalIntent === 'CAPTURE' || finalIntent === 'CAPTURE_BATCH' || finalIntent === 'CAPTURE_SPLIT') {
      const captureSource = action ? `chat_${source}` : 'direct_parse';
      const count = (finalIntent === 'CAPTURE_BATCH' && typeof notionResult === 'number') ? notionResult : 1;
      analytics.captures = { [captureSource]: count };
      analytics.hourly_capture = { [getHourKey()]: count };
    }
    // Completion tracking (natural language done via AI/fallback)
    if (finalIntent === 'UPDATE' && notionResult) {
      analytics.completions = { natural: 1 };
      analytics.hourly_complete = { [getHourKey()]: 1 };
    }
    if (finalIntent === 'EDIT' && notionResult) analytics.edits = 1;
    if (finalIntent === 'DELETE' && notionResult) analytics.deletes = 1;

    await recordDelta(env, analytics);
  } catch (err) {
    console.error('Analytics finalize error:', err);
  }

  return buildResult(finalIntent, responseText, Array.isArray(notionResult) ? notionResult.length : undefined);
}
