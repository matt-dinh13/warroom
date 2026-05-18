// Triage logic v3.0 — ADHD-optimized responses + gamification
import { callMiniMax } from './minimax.js';
import { createTask, queryTasks, updateTaskStatus, editTask, archiveTask, listAllTasks } from './notion.js';
import { SYSTEM_PROMPT } from './prompts.js';
import { recordCompletion, recordBatch, getStats, buildStatsFooter, buildAchievementMsg } from './gamification.js';

// ─── Conversation Memory ─────────────────────────────
const MEMORY_TTL = 86400; // 24h — persist context throughout the day
const MAX_MEMORY = 5;

async function getConversation(chatId, env) {
  if (!env.CHAT_MEMORY) return [];
  try {
    return (await env.CHAT_MEMORY.get(`chat:${chatId}`, 'json')) || [];
  } catch { return []; }
}

async function saveConversation(chatId, messages, env) {
  if (!env.CHAT_MEMORY) return;
  try {
    await env.CHAT_MEMORY.put(`chat:${chatId}`, JSON.stringify(messages.slice(-MAX_MEMORY * 2)), {
      expirationTtl: MEMORY_TTL,
    });
  } catch {}
}

// ─── Main Entry ──────────────────────────────────────
export async function processChat(userMessage, env, chatId = 'web') {
  // Inject datetime context
  const { dateContext, dayType, capacity, vnHour } = getVNContext();
  const enrichedMessage = `${dateContext}\n${userMessage}`;

  // Build conversation with memory
  const history = await getConversation(chatId, env);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: enrichedMessage },
  ];

  const aiResult = await callMiniMax(null, null, env.MINIMAX_API_KEY, messages);

  // Save conversation memory (user + AI response will be saved at end)
  const updatedHistory = [
    ...history,
    { role: 'user', content: enrichedMessage },
  ];

  // Execute Notion action
  let notionResult = null;
  const action = aiResult.notion_action;

  // ─── Direct intent overrides (bypass AI's notion_action) ──────

  // TRIAGE: "plan today", "hôm nay", "ưu tiên" → query today's tasks from Notion
  if (!action && /plan\s*today|h[oô]m nay|[uư]u ti[eê]n|today|plan$/i.test(userMessage)) {
    try {
      const todayTasks = await queryTasks('today', env);
      const stats = await getStats(chatId, env);
      aiResult.response_text = buildTriageResponse(todayTasks, stats);
      aiResult.intent = 'TRIAGE';
      notionResult = todayTasks;
    } catch (err) {
      console.error('Triage query error:', err);
    }
  }

  // OVERDUE: "overdue", "quên", "bỏ sót" → query overdue tasks
  if (!action && !notionResult && /overdue|qu[eê]n|b[oỏ]\s*s[oó]t|b[oỏ]\s*qu[eê]n/i.test(userMessage)) {
    try {
      const overdueTasks = await queryTasks('overdue', env);
      aiResult.response_text = buildOverdueResponse(overdueTasks);
      aiResult.intent = 'OVERDUE_CHECK';
      notionResult = overdueTasks;
    } catch (err) {
      console.error('Overdue query error:', err);
    }
  }

  // LOAD_CHECK: "check load", "overload", "quá tải"
  if (!action && !notionResult && /check\s*load|overload|qu[aá]\s*t[aả]i/i.test(userMessage)) {
    try {
      const activeTasks = await queryTasks('all_active', env);
      aiResult.response_text = buildLoadCheckResponse(activeTasks);
      aiResult.intent = 'LOAD_CHECK';
      notionResult = activeTasks;
    } catch (err) {
      console.error('Load check error:', err);
    }
  }

  // BACKLOG: "backlog", "có gì làm không", "rảnh", "pick"
  if (!action && !notionResult && /backlog|c[oó]\s*g[iì]\s*l[aà]m|r[aả]nh|pick|[yý]\s*t[uư][oở]ng/i.test(userMessage)) {
    try {
      const backlogTasks = await queryTasks('backlog', env);
      aiResult.response_text = buildBacklogResponse(backlogTasks);
      aiResult.intent = 'BACKLOG_BROWSE';
      notionResult = backlogTasks;
    } catch (err) {
      console.error('Backlog query error:', err);
    }
  }

  // LIST_TASKS: When AI returns LIST_TASKS intent, always query Notion directly
  if (aiResult.intent === 'LIST_TASKS' || (!action && !notionResult && /li[eệ]t k[eê]|list\s*task|xem\s*task|task\s*ch[uư]a\s*[đd][oó]ng|task\s*[đd]ang\s*m[oở]|xem\s*h[eế]t/i.test(userMessage))) {
    try {
      const activeTasks = await queryTasks('all_active', env);
      if (!activeTasks || activeTasks.length === 0) {
        aiResult.response_text = '✨ Không có task nào đang mở!\n\n💡 Gõ task mới để bắt đầu.';
      } else {
        const grouped = {};
        activeTasks.forEach(t => {
          const st = t.status || 'To do';
          if (!grouped[st]) grouped[st] = [];
          grouped[st].push(t);
        });
        const statusIcons = { 'In progress': '🔥', 'To do': '📋', 'Pending / Wait for approved': '⏳' };
        let lines = [`📊 **${activeTasks.length} tasks đang mở:**\n`];
        for (const [status, tasks] of Object.entries(grouped)) {
          const icon = statusIcons[status] || '📌';
          lines.push(`${icon} **${status}** (${tasks.length})`);
          tasks.forEach((t, i) => {
            const project = t.project ? ` [${t.project}]` : '';
            const urgency = t.urgency ? ` ${t.urgency}` : '';
            const deadline = t.due_date ? ` ⏰${t.due_date}` : '';
            lines.push(`  ${i + 1}. ${t.title}${project}${urgency}${deadline}`);
          });
          lines.push('');
        }
        lines.push('💡 Gõ "xoá [tên]" để xoá, "plan" để sắp xếp.');
        aiResult.response_text = lines.join('\n');
      }
      aiResult.intent = 'LIST_TASKS';
    } catch (err) {
      console.error('List tasks error:', err);
      aiResult.response_text += `\n\n⚠️ Lỗi query: ${err.message}`;
    }
  }

  // ─── Safety net: CAPTURE without notion_action ──────────────
  // AI sometimes returns plain text instead of JSON for CAPTURE
  const captureIntents = ['CAPTURE', 'CAPTURE_BATCH', 'CAPTURE_SPLIT'];
  if (captureIntents.includes(aiResult.intent) && !action) {
    console.warn('AI returned CAPTURE intent without notion_action, attempting fallback parse');
    // Try to create task from AI's response text (it usually contains the parsed data)
    const fallbackTask = tryParseCaptureFromAIResponse(aiResult.response_text, userMessage);
    if (fallbackTask) {
      try {
        notionResult = await createTask(fallbackTask, env);
        if (notionResult) {
          const d = fallbackTask;
          let confirmMsg = `✅ Đã tạo task:\n📌 ${d.title || 'Untitled'}`;
          if (d.project) confirmMsg += `\n📂 ${d.project}`;
          if (d.urgency) confirmMsg += ` | ${d.urgency}`;
          if (d.energy) confirmMsg += ` | ${d.energy}`;
          if (d.estimate) confirmMsg += `\n⏱ ${d.estimate}p`;
          if (d.due_date) confirmMsg += ` | 📅 ${d.due_date}`;
          if (d.assigned_by) confirmMsg += `\n👤 ${d.assigned_by}`;
          confirmMsg += `\n\n💡 Gõ "plan" để xem ưu tiên.`;
          aiResult.response_text = confirmMsg;
        }
      } catch (err) {
        console.error('Capture fallback error:', err);
        aiResult.response_text = '⚠️ **Lỗi hệ thống**: Không tạo được task.\n\n' +
          `💡 Lỗi: ${err.message}\nThử lại hoặc gõ rõ hơn.`;
      }
    } else {
      aiResult.response_text = '⚠️ **Lỗi hệ thống**: AI không gửi đúng data để tạo task.\n\n' +
        '💡 Thử lại: gõ rõ từng task, VD:\n' +
        '"Review deck GMA deadline 20/5"\n' +
        'hoặc gửi nhiều task:\n' +
        '"task1, task2, task3"';
    }
  }

  // ─── CAPTURE fallback for CLARIFY intent with task-like content ──────
  // AI returned CLARIFY but user clearly wanted to create a task AND AI's response shows it parsed correctly
  if (!action && aiResult.intent === 'CLARIFY' && !notionResult &&
      /t[aạ]o|capture|th[eê]m|add/i.test(userMessage) &&
      /đ[aã] t[aạ]o|📌/i.test(aiResult.response_text)) {
    const fallbackTask = tryParseCaptureFromAIResponse(aiResult.response_text, userMessage);
    if (fallbackTask) {
      try {
        notionResult = await createTask(fallbackTask, env);
        if (notionResult) {
          const d = fallbackTask;
          let confirmMsg = `✅ Đã tạo task:\n📌 ${d.title || 'Untitled'}`;
          if (d.project) confirmMsg += `\n📂 ${d.project}`;
          if (d.urgency) confirmMsg += ` | ${d.urgency}`;
          if (d.energy) confirmMsg += ` | ${d.energy}`;
          if (d.estimate) confirmMsg += `\n⏱ ${d.estimate}p`;
          if (d.due_date) confirmMsg += ` | 📅 ${d.due_date}`;
          if (d.assigned_by) confirmMsg += `\n👤 ${d.assigned_by}`;
          confirmMsg += `\n\n💡 Gõ "plan" để xem ưu tiên.`;
          aiResult.response_text = confirmMsg;
          aiResult.intent = 'CAPTURE';
        }
      } catch (err) {
        console.error('Capture CLARIFY fallback error:', err);
      }
    }
  }

  // ─── EDIT fallback: AI returned plain text instead of JSON ──────
  // Detect EDIT intent from user message when AI failed to return notion_action
  if (!action && /s[uử]a|edit|change|[đd][ổo]i|update|c[aậ]p nh[aậ]t|stakeholder|assigned|giao cho/i.test(userMessage)) {
    const editFallback = tryParseEditFromMessage(userMessage, aiResult.response_text);
    if (editFallback) {
      try {
        const editResult = await editTask(editFallback.task_title, editFallback.updates, env);
        if (editResult) {
          notionResult = editResult;
          const changes = Object.entries(editFallback.updates).map(([k, v]) => `  • ${k}: ${v}`).join('\n');
          aiResult.response_text = `✏️ Đã sửa "${editResult.title}":\n${changes}\n\n💡 Gõ "plan" để xem lại.`;
          aiResult.intent = 'EDIT';
        }
      } catch (err) {
        console.error('Edit fallback error:', err);
      }
    }
  }

  if (action) {
    try {
      switch (action.type) {
        case 'create':
          // If intent is CAPTURE_SPLIT, handle parent + subtasks together
          if (aiResult.intent === 'CAPTURE_SPLIT' && action.data?.parent && action.data?.subtasks) {
            const parent = await createTask(action.data.parent, env);
            for (const sub of action.data.subtasks) {
              await createTask({
                ...sub,
                project: action.data.parent.project,
                urgency: action.data.parent.urgency,
                source: action.data.parent.source,
                context: `Sub-task of: ${action.data.parent.title}`,
              }, env);
            }
            notionResult = parent;
            aiResult.response_text = `✅ Đã tạo + chia nhỏ:\n📌 ${action.data.parent.title}\n📦 ${action.data.subtasks.length} sub-tasks\n\n💡 Gõ "plan" để xem.`;
          } else {
            notionResult = await createTask(action.data, env);
            // Build confirmation response after successful creation
            if (notionResult) {
              const d = action.data;
              let confirmMsg = `✅ Đã tạo task:\n📌 ${d.title || 'Untitled'}`;
              if (d.project) confirmMsg += `\n📂 ${d.project}`;
              if (d.urgency) confirmMsg += ` | ${d.urgency}`;
              if (d.energy) confirmMsg += ` | ${d.energy}`;
              if (d.estimate) confirmMsg += `\n⏱ ${d.estimate}p`;
              if (d.due_date) confirmMsg += ` | 📅 ${d.due_date}`;
              if (d.block) confirmMsg += ` | ${d.block}`;
              if (d.assigned_by) confirmMsg += `\n👤 ${d.assigned_by}`;
              if (d.source) confirmMsg += ` | ${d.source}`;
              confirmMsg += `\n\n💡 Gõ "plan" để xem ưu tiên.`;
              aiResult.response_text = confirmMsg;
            }
          }
          break;

        case 'create_batch': {
          const tasks = action.data?.tasks || [];
          const created = [];
          for (const t of tasks) {
            await createTask(t, env);
            created.push(t);
          }
          const { newAchievements, stats } = await recordBatch(chatId, env, created.length);
          aiResult.response_text = buildBatchResponse(created, stats, newAchievements);
          break;
        }

        case 'query':
          notionResult = await queryTasks(action.data?.query_type || 'today', env);
          if (Array.isArray(notionResult)) {
            const stats = await getStats(chatId, env);
            switch (aiResult.intent) {
              case 'TRIAGE':
                aiResult.response_text = buildTriageResponse(notionResult, stats);
                break;
              case 'OVERDUE_CHECK':
                aiResult.response_text = buildOverdueResponse(notionResult);
                break;
              case 'LOAD_CHECK':
                aiResult.response_text = buildLoadCheckResponse(notionResult);
                break;
              case 'REPORT':
                aiResult.response_text = buildReportResponse(notionResult, stats);
                break;
              case 'BACKLOG_BROWSE':
                aiResult.response_text = buildBacklogResponse(notionResult);
                break;
            }
          }
          break;

        case 'update':
          if (action.data?.task_title && action.data?.new_status) {
            notionResult = await updateTaskStatus(action.data.task_title, action.data.new_status, env);
            if (!notionResult) {
              aiResult.response_text = `❌ Không tìm thấy "${action.data.task_title}".\n💡 Gõ chính xác hơn.`;
            } else {
              const isFire = (notionResult.urgency || '').includes('Fire');
              const { xpGained, newAchievements, stats } = await recordCompletion(chatId, env, isFire);
              aiResult.response_text = buildCompletionResponse(notionResult, xpGained, newAchievements, stats);
            }
          }
          break;

        case 'edit':
          if (action.data?.task_title && action.data?.updates) {
            notionResult = await editTask(action.data.task_title, action.data.updates, env);
            if (!notionResult) {
              aiResult.response_text = `❌ Không tìm thấy "${action.data.task_title}".\n💡 Gõ chính xác hơn.`;
            } else {
              const changes = Object.entries(action.data.updates).map(([k, v]) => `  • ${k}: ${v}`).join('\n');
              aiResult.response_text = `✏️ Đã sửa "${notionResult.title}":\n${changes}\n\n💡 Gõ "plan" để xem lại.`;
            }
          }
          break;

        case 'delete':
          if (action.data?.task_title) {
            const archived = await archiveTask(action.data.task_title, env);
            if (!archived) {
              aiResult.response_text = `❌ Không tìm thấy "${action.data.task_title}".\n💡 Gõ chính xác hơn hoặc "dọn dẹp" để xem danh sách.`;
            } else {
              aiResult.response_text = `🗑️ Đã xoá: "${archived.title}"\n\n💡 Gõ "plan" để xem task còn lại.`;
            }
          }
          break;

        case 'cleanup':
          const allTasks = await listAllTasks(env);
          if (allTasks.length === 0) {
            aiResult.response_text = '✨ Database trống. Không có gì để dọn!';
          } else {
            const taskList = allTasks.map((t, i) => {
              const status = t.status || 'Unknown';
              const urgency = t.urgency ? ` | ${t.urgency}` : '';
              return `${i + 1}. ${t.title} [${status}${urgency}]`;
            }).join('\n');
            aiResult.response_text = `🧹 **Dọn dẹp** — ${allTasks.length} tasks:\n\n${taskList}\n\n💡 Gõ "xoá [tên task]" để xoá từng cái, hoặc "xoá completed" để xoá hết task đã xong.`;
          }
          break;

        case 'list': {
          const activeTasks = await queryTasks('all_active', env);
          if (!activeTasks || activeTasks.length === 0) {
            aiResult.response_text = '✨ Không có task nào đang mở!\n\n💡 Gõ task mới để bắt đầu.';
          } else {
            // Group by status
            const grouped = {};
            activeTasks.forEach(t => {
              const st = t.status || 'To do';
              if (!grouped[st]) grouped[st] = [];
              grouped[st].push(t);
            });

            const statusIcons = { 'In progress': '🔥', 'To do': '📋', 'Pending / Wait for approved': '⏳' };
            let lines = [`📊 **${activeTasks.length} tasks đang mở:**\n`];

            for (const [status, tasks] of Object.entries(grouped)) {
              const icon = statusIcons[status] || '📌';
              lines.push(`${icon} **${status}** (${tasks.length})`);
              tasks.forEach((t, i) => {
                const project = t.project ? ` [${t.project}]` : '';
                const urgency = t.urgency ? ` ${t.urgency}` : '';
                const deadline = t.due_date ? ` ⏰${t.due_date}` : '';
                lines.push(`  ${i + 1}. ${t.title}${project}${urgency}${deadline}`);
              });
              lines.push('');
            }

            lines.push('💡 Gõ "sắp xếp" hoặc "plan" để tổ chức lại.');
            aiResult.response_text = lines.join('\n');
          }
          break;
        }
      }

      // Handle CAPTURE_SPLIT — only if action.type is NOT 'create' (avoid duplicate)
      if (aiResult.intent === 'CAPTURE_SPLIT' && action.type !== 'create' && action.data?.parent && action.data?.subtasks) {
        const parent = await createTask(action.data.parent, env);
        for (const sub of action.data.subtasks) {
          await createTask({
            ...sub,
            project: action.data.parent.project,
            urgency: action.data.parent.urgency,
            source: action.data.parent.source,
            context: `Sub-task of: ${action.data.parent.title}`,
          }, env);
        }
        notionResult = parent;
        aiResult.response_text = `✅ Đã tạo + chia nhỏ:\n📌 ${action.data.parent.title}\n📦 ${action.data.subtasks.length} sub-tasks\n\n💡 Gõ "plan" để xem.`;
      }
    } catch (err) {
      console.error('Notion error:', err);
      aiResult.response_text += `\n\n⚠️ Lỗi: ${err.message}`;
    }
  }

  // ─── Final guard: strip hallucinated "đã tạo" claims ──────
  // If no Notion write happened but AI claims success, strip the lie
  // Skip if we already handled via fallback (notionResult is set)
  if (!notionResult && !captureIntents.includes(aiResult.intent) &&
      aiResult.intent !== 'EDIT' &&
      /đã tạo|đã capture|đã lưu|created|saved/i.test(aiResult.response_text)) {
    // Check if this was supposed to be a capture
    if (/task|tạo|capture|thêm|add/i.test(userMessage)) {
      aiResult.response_text += '\n\n⚠️ **Lưu ý**: Task chưa được lưu vào Notion. Gõ lại rõ hơn để tạo thật.';
    }
  }

  // ─── Save conversation memory ──────────────────────────────
  const finalHistory = [
    ...updatedHistory,
    { role: 'assistant', content: aiResult.response_text || '' },
  ];
  await saveConversation(chatId, finalHistory, env);

  return {
    intent: aiResult.intent,
    response_text: aiResult.response_text,
    needs_confirmation: aiResult.needs_confirmation || false,
    follow_up_question: aiResult.follow_up_question || null,
    task_count: Array.isArray(notionResult) ? notionResult.length : undefined,
  };
}

// ─── Context ─────────────────────────────────────────

function getVNContext() {
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
  const dayIcon = isWeekend ? '🏠' : '🏢';

  return {
    dateContext: `[Context: ${dayNames[dayNum]} ${vnDate.getUTCDate()}/${vnDate.getUTCMonth() + 1}/${vnDate.getUTCFullYear()}, ${vnHour}:${String(vnDate.getUTCMinutes()).padStart(2, '0')}, ${dayType}, capacity ${capacity}p, block: ${block}]`,
    dayType, capacity, vnHour, dayIcon, isWeekend,
  };
}

// ─── Response Builders (ADHD-optimized: short, focused, next action) ──

function buildLoadBar(pct) {
  const filled = Math.min(Math.round(pct / 10), 10);
  const empty = 10 - filled;
  const icon = pct > 100 ? '🔴' : pct > 80 ? '🟡' : '🟢';
  return `${icon} ${'━'.repeat(filled)}${'░'.repeat(empty)} ${pct}%`;
}

function buildTriageResponse(tasks, stats) {
  const { capacity, dayIcon, dayType } = getVNContext();

  if (!tasks.length) {
    return `📭 Không có task nào cần làm hôm nay.\nChill đi Matt! 🎮\n\n💡 Gõ "backlog" để pick ý tưởng.${buildStatsFooter(stats)}`;
  }

  const urgencyOrder = { '🔴 Fire': 0, '🟡 Important': 1, '🟢 Wait': 2, '⚪ Someday': 3 };
  tasks.sort((a, b) => {
    const ua = urgencyOrder[a.urgency] ?? 9;
    const ub = urgencyOrder[b.urgency] ?? 9;
    if (ua !== ub) return ua - ub;
    return (a.due_date || '9999').localeCompare(b.due_date || '9999');
  });

  // All tasks returned by 'today' query are actionable (no backlog in this view)
  const next = tasks[0];
  const totalEst = tasks.slice(0, 3).reduce((s, t) => s + (t.estimate || 0), 0);
  const loadPct = Math.round((totalEst / capacity) * 100);

  let r = `${dayIcon} Hôm nay — ${tasks.length} tasks (${capacity}p)\n\n`;

  // NEXT task — prominent
  if (next) {
    const est = next.estimate ? `${next.estimate}p` : '?p';
    const dl = next.due_date ? ` · 📅 ${next.due_date}` : '';
    r += `▶️ TIẾP THEO:\n`;
    r += `${next.urgency || '🟡'} ${next.title}\n`;
    r += `📂 ${next.project || '?'} · ⏱ ${est}${dl}\n\n`;
  }

  // Summary of remaining
  if (tasks.length > 1) {
    r += `📋 +${tasks.length - 1} task nữa:`;
    tasks.slice(1, 4).forEach(t => {
      r += `\n  • ${t.urgency || '🟡'} ${t.title}`;
    });
    if (tasks.length > 4) r += `\n  ... +${tasks.length - 4} nữa`;
    r += '\n';
  }

  r += `\n${buildLoadBar(loadPct)}`;
  r += buildStatsFooter(stats);
  r += `\n\n💡 Gõ "done ${next?.title?.split(' ').slice(0, 3).join(' ') || 'task'}" hoặc "xem hết"`;

  return r;
}

function buildCompletionResponse(task, xpGained, newAchievements, stats) {
  const level = stats.xp >= 0 ? stats.xp : 0;
  let r = `✅ Done: "${task.title}"\n`;
  r += `+${xpGained} XP!`;
  r += buildStatsFooter(stats);

  if (stats.today_completed > 0) {
    const goal = 5;
    const pct = Math.round((stats.today_completed / goal) * 100);
    const filled = Math.min(Math.round(stats.today_completed / goal * 10), 10);
    r += `\n${'━'.repeat(filled)}${'░'.repeat(10 - filled)} ${stats.today_completed}/${goal} daily`;
  }

  r += buildAchievementMsg(newAchievements);
  r += `\n\n💡 Gõ "plan" để xem task tiếp.`;
  return r;
}

function buildBatchResponse(tasks, stats, newAchievements) {
  let r = `✅ Đã tạo ${tasks.length} tasks:\n`;
  tasks.forEach((t, i) => {
    r += `  ${i + 1}. ${t.urgency || '🟡'} ${t.title} (${t.project || '?'})\n`;
  });
  r += buildStatsFooter(stats);
  r += buildAchievementMsg(newAchievements);
  r += `\n\n💡 Gõ "plan" để xem ưu tiên.`;
  return r;
}

function buildOverdueResponse(tasks) {
  if (!tasks.length) return '✅ Không có task quá hạn!\n💪 Good job Matt!';

  const next = tasks[0];
  let r = `⚠️ ${tasks.length} task quá hạn\n\n`;
  r += `▶️ Quan trọng nhất:\n`;
  r += `${next.urgency || '🟡'} ${next.title}\n`;
  r += `📂 ${next.project || '?'} · 📅 ${next.due_date || '?'}\n`;

  if (tasks.length > 1) r += `\n📋 +${tasks.length - 1} task khác quá hạn`;
  r += `\n\n💡 Gõ "done ${next.title?.split(' ').slice(0, 2).join(' ')}" hoặc "sửa deadline"`;
  return r;
}

function buildLoadCheckResponse(tasks) {
  const totalEst = tasks.reduce((s, t) => s + (t.estimate || 0), 0);
  const { capacity } = getVNContext();
  const weekCap = capacity * 5 + 120 * 2;
  const loadPct = Math.round((totalEst / weekCap) * 100);

  // Separate overdue from upcoming
  const today = new Date().toISOString().split('T')[0];
  const overdue = tasks.filter(t => (t.due_date && t.due_date < today) || (t.do_date && t.do_date < today));
  const active = tasks.filter(t => !overdue.includes(t));

  let r = `📊 Load Check\n\n`;
  r += `📌 ${tasks.length} tasks active · ⏱ ${totalEst}p (~${Math.round(totalEst / 60)}h)\n`;
  r += `📅 Weekly capacity: ${weekCap}p (~${Math.round(weekCap / 60)}h)\n`;
  if (overdue.length > 0) r += `⚠️ ${overdue.length} task quá hạn!\n`;
  r += `\n${buildLoadBar(loadPct)}`;

  if (loadPct > 100) {
    r += `\n\n🔴 OVERLOAD! Cần drop ~${Math.round((totalEst - weekCap) / 60)}h.`;
    const droppable = tasks.filter(t => t.urgency === '🟢 Wait').slice(0, 2);
    if (droppable.length) {
      r += '\n💡 Suggest defer/drop:\n';
      droppable.forEach(t => { r += `  • ${t.title}\n`; });
    }
  } else if (loadPct > 80) {
    r += `\n\n🟡 Heavy — cẩn thận!`;
  } else {
    r += `\n\n✅ OK — còn room.`;
  }
  return r;
}

function buildReportResponse(tasks, stats) {
  const completed = tasks.filter(t => t.status === 'Completed');
  const totalTime = completed.reduce((s, t) => s + (t.estimate || 0), 0);

  let r = `📊 Weekly Report\n\n`;
  r += `✅ ${completed.length} tasks (~${Math.round(totalTime / 60)}h)\n`;

  // By project
  const byProj = {};
  completed.forEach(t => { byProj[t.project || '?'] = (byProj[t.project || '?'] || 0) + 1; });
  if (Object.keys(byProj).length) {
    r += '\n📂 ';
    r += Object.entries(byProj).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p}(${c})`).join(' · ');
  }

  r += buildStatsFooter(stats);
  r += `\n\n💡 Keep going! 💪`;
  return r;
}

function buildBacklogResponse(tasks) {
  if (!tasks.length) return '📭 Backlog trống.\n💡 Gửi link/video/idea để lưu!';

  let r = `💡 Backlog — ${tasks.length} items (không deadline, pick khi rảnh)\n\n`;
  const byProj = {};
  tasks.forEach(t => {
    const p = t.project || 'Chưa phân loại';
    if (!byProj[p]) byProj[p] = [];
    byProj[p].push(t);
  });

  for (const [proj, items] of Object.entries(byProj)) {
    r += `📂 ${proj}\n`;
    items.slice(0, 5).forEach((t, i) => {
      const link = t.resource ? ' 🔗' : '';
      r += `  ${i + 1}. ${t.title}${link}\n`;
    });
    if (items.length > 5) r += `  ... +${items.length - 5} nữa\n`;
    r += '\n';
  }
  r += '💡 Gõ "pick [tên]" để chuyển thành task active.';
  return r;
}

// ─── Edit Fallback Parser ─────────────────────────────────────
// When AI returns plain text instead of JSON for EDIT commands,
// try to extract task_title and updates from the user message + AI response

function tryParseEditFromMessage(userMessage, aiResponse) {
  const msg = userMessage.toLowerCase();

  // Field patterns: "sửa [field] task [name] thành/sang/: [value]"
  // or "sửa task [name], [field]: [value]"
  const fieldAliases = {
    assigned_by: /(?:stakeholder|assigned|giao cho|ng[uư][oờ]i giao|assigned.?by)/i,
    deadline: /(?:deadline|h[aạ]n|due.?date|ng[aà]y)/i,
    urgency: /(?:urgency|[uư]u ti[eê]n|m[uứ]c [đd][oộ])/i,
    estimate: /(?:estimate|th[oờ]i gian|[đd][oộ] d[aà]i|bao l[aâ]u)/i,
    project: /(?:project|d[uự] [aá]n|context)/i,
    energy: /(?:energy|n[aă]ng l[uư][oợ]ng)/i,
    block: /(?:block|kh[uố]i|slot)/i,
    source: /(?:source|ngu[oồ]n)/i,
    notes: /(?:note|ghi ch[uú]|context)/i,
    title: /(?:title|t[eê]n|rename)/i,
    resource: /(?:resource|link|url)/i,
  };

  // Try to find which field is being edited
  let detectedField = null;
  for (const [field, regex] of Object.entries(fieldAliases)) {
    if (regex.test(userMessage)) {
      detectedField = field;
      break;
    }
  }

  if (!detectedField) return null;

  // Try to extract task title — look for "task [name]" pattern
  // Common patterns:
  // "sửa stakeholders task ABC thành XYZ"
  // "sửa task ABC, stakeholders: XYZ"
  // "update assigned_by cho task ABC: XYZ"
  let taskTitle = null;
  let value = null;

  // Pattern 1: "task [title] thành/sang/: [value]"
  const p1 = userMessage.match(/task\s+(.+?)(?:\s*(?:th[aà]nh|sang|=|:)\s*)(.+)/i);
  if (p1) {
    // Check if field keyword is in the "title" part — split it out
    const rawTitle = p1[1].trim();
    const rawValue = p1[2].trim();

    // Remove field keyword from title if present
    let cleanTitle = rawTitle;
    for (const regex of Object.values(fieldAliases)) {
      cleanTitle = cleanTitle.replace(regex, '').trim();
    }
    // Remove trailing comma, colon
    cleanTitle = cleanTitle.replace(/[,:\s]+$/, '').trim();

    if (cleanTitle) {
      taskTitle = cleanTitle;
      value = rawValue;
    }
  }

  // Pattern 2: "sửa task [title], [field]: [value]"
  if (!taskTitle) {
    const p2 = userMessage.match(/(?:s[uử]a|edit|update|[đd][ổo]i|c[aậ]p nh[aậ]t)\s+(?:task\s+)?(.+?)[,]\s*.+?(?::|th[aà]nh|sang|=)\s*(.+)/i);
    if (p2) {
      let cleanTitle = p2[1].trim();
      for (const regex of Object.values(fieldAliases)) {
        cleanTitle = cleanTitle.replace(regex, '').trim();
      }
      cleanTitle = cleanTitle.replace(/[,:\s]+$/, '').trim();
      if (cleanTitle) {
        taskTitle = cleanTitle;
        value = p2[2].trim();
      }
    }
  }

  // Pattern 3: Try to extract from AI response (it often mentions the task name)
  if (!taskTitle && aiResponse) {
    const titleMatch = aiResponse.match(/📌\s*(.+?)(?:\n|$)/);
    if (titleMatch) {
      taskTitle = titleMatch[1].trim();
    }
  }

  // Extract value from AI response if we couldn't get it from user message
  if (!value && aiResponse) {
    // Look for field-specific patterns in AI response
    const valuePatterns = [
      /(?:Stakeholders?|Assigned|Giao cho)[:\s]*(.+?)(?:\n|$)/i,
      /(?:Deadline|Hạn)[:\s]*(.+?)(?:\n|$)/i,
      /(?:Notes?|Ghi chú)[:\s]*(.+?)(?:\n|$)/i,
    ];
    for (const pat of valuePatterns) {
      const m = aiResponse.match(pat);
      if (m) { value = m[1].trim(); break; }
    }
  }

  if (!taskTitle || !value) return null;

  // Post-process value based on field type
  if (detectedField === 'deadline' && value) {
    // Convert DD/MM or DD/MM/YYYY to ISO format
    const dateMatch = value.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
    if (dateMatch) {
      const year = dateMatch[3] || '2026';
      value = `${year}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
    }
    // Also try ISO from AI response
    if (aiResponse) {
      const isoMatch = aiResponse.match(/(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) value = isoMatch[1];
    }
  }
  if (detectedField === 'estimate' && value) {
    const numMatch = value.match(/(\d+)/);
    if (numMatch) value = parseInt(numMatch[1]);
  }

  return {
    task_title: taskTitle,
    updates: { [detectedField]: value },
  };
}

// ─── Capture Fallback Parser ──────────────────────────────────
// When AI returns plain text instead of JSON for CAPTURE commands,
// parse the structured response text to extract task data

function tryParseCaptureFromAIResponse(aiResponse, userMessage) {
  if (!aiResponse) return null;

  // Extract title from 📌 line
  const titleMatch = aiResponse.match(/📌\s*(.+?)(?:\n|$)/);
  if (!titleMatch) return null;

  const title = titleMatch[1].trim();
  if (!title) return null;

  const task = { title };

  // Extract project from 📂 line or [PROJECT] pattern
  const projectMatch = aiResponse.match(/📂\s*(\w+)/);
  if (projectMatch) task.project = projectMatch[1];

  // Extract urgency
  if (/🔴|Fire/i.test(aiResponse)) task.urgency = '🔴 Fire';
  else if (/🟡|Important/i.test(aiResponse)) task.urgency = '🟡 Important';
  else if (/🟢|Wait/i.test(aiResponse)) task.urgency = '🟢 Wait';
  else if (/⚪|Someday/i.test(aiResponse)) task.urgency = '⚪ Someday';

  // Extract energy
  if (/⚡|High/i.test(aiResponse)) task.energy = '⚡ High';
  else if (/🔋|Med/i.test(aiResponse)) task.energy = '🔋 Med';
  else if (/😴|Low/i.test(aiResponse)) task.energy = '😴 Low';

  // Extract estimate (number followed by p or phút)
  const estMatch = aiResponse.match(/⏱\s*(\d+)p/);
  if (estMatch) task.estimate = parseInt(estMatch[1]);

  // Extract deadline (date pattern)
  const dateMatch = aiResponse.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    task.due_date = dateMatch[1];
  } else {
    // Try DD/MM format from user message
    const ddmm = userMessage.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
    if (ddmm) {
      const year = ddmm[3] || '2026';
      task.due_date = `${year}-${ddmm[2].padStart(2, '0')}-${ddmm[1].padStart(2, '0')}`;
    }
  }

  // Extract assigned_by
  const assignedMatch = aiResponse.match(/👤\s*(.+?)(?:\n|$)/);
  if (assignedMatch) task.assigned_by = assignedMatch[1].trim();

  // Extract source from project
  if (task.project) {
    const sourceMap = {
      'GMA': 'EIT', 'HOSEL': 'EIT', 'SALES': 'EIT', 'EMPULSE': 'EIT', 'KV': 'EIT',
      'EDU': 'Side Gig', 'TEACH': 'Side Gig',
      'LEARN': 'Self', 'PERSONAL': 'Personal',
    };
    task.source = sourceMap[task.project] || 'EIT';
  }

  // Extract block
  if (/☀️|AM/i.test(aiResponse)) task.block = '☀️ AM';
  else if (/🌤️|PM/i.test(aiResponse)) task.block = '🌤️ PM';
  else if (/🌙|Power Block/i.test(aiResponse)) task.block = '🌙 Power Block';

  return task;
}
