// Triage v5.3 — Agentic orchestrator (sarcastic, context-aware)
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

// ─── Direct Task Parser (fallback when AI fails) ─────────
// Parses "tạo task..." messages directly without AI
// Returns: single task object OR array of tasks (for multi-day)
export function tryDirectParse(msg) {
  const lower = msg.toLowerCase();
  if (!/tạo|thêm|add|create/.test(lower)) return null;

  const VALID_PROJECTS = ['GMA', 'HOSEL', 'SALES', 'EMPULSE', 'KV', 'EDU', 'TEACH', 'LEARN', 'PERSONAL', 'MATERIALS'];
  const now = new Date(Date.now() + 7 * 3600000); // VN time
  const vnDate = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;

  // ── Title: after "tên" or "task" keyword
  let title = null;
  const titleMatch = msg.match(/(?:tên|task)\s+(.+?)(?:\n|,|$)/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  } else {
    const firstLine = msg.split('\n')[0].replace(/^.*?(?:tạo|thêm|add|create)\s*(?:task)?\s*/i, '').trim();
    if (firstLine) title = firstLine;
  }
  if (!title) return null;

  // ── Project
  let project = null;
  const projMatch = msg.match(/(?:dự án|project|DA)\s+(\S+)/i);
  if (projMatch) {
    const upper = projMatch[1].toUpperCase();
    project = VALID_PROJECTS.includes(upper) ? upper : projMatch[1];
  }

  // ── Estimate
  let estimate = null;
  const estMatch = msg.match(/(\d+)\s*(?:phút|min(?:ute)?s?|p(?!m\b))/i);
  if (estMatch) estimate = parseInt(estMatch[1]);

  // ── Time (2:30pm, 10am, 14:00...)
  let hour = null, min = 0;
  const timeMatch = msg.match(/(\d{1,2})\s*[:]\s*(\d{2})\s*(?:am|pm|sáng|chiều|tối)?/i)
    || msg.match(/(\d{1,2})\s*(?:am|pm|sáng|chiều|tối)/i);
  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    min = parseInt(timeMatch[2] || '0') || 0;
    if (/pm|chiều|tối/i.test(msg) && hour < 12) hour += 12;
    if (/am|sáng/i.test(msg) && hour === 12) hour = 0;
  }

  // ── Weekday parsing (thứ 2 = Monday ... thứ 7 = Saturday, chủ nhật = Sunday)
  const DAY_MAP = { '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6 };
  const weekdayMatches = [...lower.matchAll(/thứ\s*(\d)/g)].map(m => DAY_MAP[m[1]]).filter(d => d !== undefined);
  if (/chủ\s*nhật/i.test(lower)) weekdayMatches.push(0);

  // Calculate next occurrence of each weekday
  function nextWeekday(targetDay) {
    const d = new Date(now);
    const currentDay = d.getUTCDay();
    let diff = targetDay - currentDay;
    if (diff <= 0) diff += 7; // always next occurrence
    d.setUTCDate(d.getUTCDate() + diff);
    return d;
  }

  // ── Build task(s)
  function buildTask(dateObj) {
    const dateStr = vnDate(dateObj);
    const task = {
      title,
      urgency: '🟡 Important',
      energy: '🔋 Med',
    };
    if (project) {
      task.project = project;
      task.source = PROJECT_SOURCE_MAP[project] || 'EIT';
    }
    if (estimate) task.estimate = estimate;
    task.due_date = dateStr;
    if (hour !== null) {
      task.scheduled_time = `${dateStr}T${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
    }
    return task;
  }

  if (weekdayMatches.length > 0) {
    // Multi-day: return array of tasks
    const tasks = weekdayMatches.map(day => buildTask(nextWeekday(day)));
    return tasks.length === 1 ? tasks[0] : tasks;
  }

  // No weekday specified → use today
  return buildTask(now);
}

// ─── Scheduled Time Parser ─────────────────────────────
// If user mentioned a specific time (10am, 2pm, 14:00, etc.),
// parse it and set scheduled_time on the task data
function enrichWithScheduledTime(taskData, userMsg) {
  if (taskData.scheduled_time) return; // AI already set it
  const timeMatch = userMsg.match(/(\d{1,2})\s*(?:h|:?\s*(?:00|30)?\s*)?\s*(?:am|pm|sáng|chiều|tối)/i)
    || userMsg.match(/(\d{1,2}):(\d{2})/)
    || userMsg.match(/(\d{1,2})\s*(?:am|pm)/i);
  if (!timeMatch) return;

  let hour = parseInt(timeMatch[1]);
  const min = parseInt(timeMatch[2] || '0') || 0;
  if (/pm|chiều|tối/i.test(userMsg) && hour < 12) hour += 12;
  if (/am|sáng/i.test(userMsg) && hour === 12) hour = 0;

  const now = new Date(Date.now() + 7 * 3600000); // VN time
  const vnDateStr = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  let schedDate = taskData.due_date || vnDateStr(now);
  if (/mai|ngày mai|tomorrow/i.test(userMsg)) {
    schedDate = vnDateStr(new Date(now.getTime() + 86400000));
  }
  taskData.scheduled_time = `${schedDate}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  if (!taskData.due_date) taskData.due_date = schedDate;

  // Also try to extract estimate if missing
  if (!taskData.estimate) {
    const estMatch = userMsg.match(/(\d+)\s*(?:phút|min(?:ute)?s?|p(?!m\b))/i);
    if (estMatch) taskData.estimate = parseInt(estMatch[1]);
  }
}

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
          // Use AI's task data array, or fall back to direct parser
          let batchTasks = [];

          // Try AI's data first
          if (action.data) {
            if (Array.isArray(action.data.tasks)) {
              batchTasks = action.data.tasks;
            } else if (Array.isArray(action.data)) {
              batchTasks = action.data;
            }
          }

          // Fallback: parse from original message
          if (batchTasks.length === 0) {
            const parsed = tryDirectParse(msg);
            if (parsed) batchTasks = Array.isArray(parsed) ? parsed : [parsed];
          }

          console.log('create_batch tasks:', batchTasks.length, batchTasks.map(t => t.title + ' / ' + t.due_date));

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
            if (!t.energy) t.energy = '🔋 Med';
            enrichWithScheduledTime(t, msg);
            await createTask(t, env);
          }

          if (batchTasks.length > 0) {
            notionResult = true;
            const confirmTexts = batchTasks.map(t => buildCaptureConfirmation(t));
            responseText = batchTasks.length > 1
              ? `✅ Đã tạo ${batchTasks.length} tasks:\n\n${confirmTexts.join('\n---\n')}`
              : confirmTexts[0];
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
          notionResult = await createTask(fallbackTask, env);
          responseText = buildCaptureConfirmation(fallbackTask);
        } catch {}
      }
    }
  }

  // ═══ PHASE 3.5: CAPTURE_BATCH fallback (AI returned intent but didn't create) ═══
  console.log('Phase 3.5 check:', { notionResult: !!notionResult, intent: aiResult.intent, hasAction: !!action });
  if (!notionResult && (aiResult.intent === 'CAPTURE_BATCH' || (aiResult.intent === 'CAPTURE' && !action))) {
    const directResult = tryDirectParse(msg);
    console.log('Phase 3.5 directResult:', directResult);
    if (directResult) {
      try {
        const tasks = Array.isArray(directResult) ? directResult : [directResult];
        for (const t of tasks) {
          await createTask(t, env);
        }
        notionResult = true;
        if (tasks.length > 1) {
          const confirmTexts = tasks.map(t => buildCaptureConfirmation(t));
          responseText = `✅ Đã tạo ${tasks.length} tasks:\n\n${confirmTexts.join('\n---\n')}`;
        } else {
          responseText = buildCaptureConfirmation(tasks[0]);
        }
      } catch (err) {
        console.error('CAPTURE_BATCH fallback error:', err);
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

  return buildResult(finalIntent, responseText, Array.isArray(notionResult) ? notionResult.length : undefined);
}
