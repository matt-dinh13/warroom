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
  // When AI returns LIST_TASKS intent, always query Notion directly
  if (aiResult.intent === 'LIST_TASKS' || (!action && /li[eệ]t k[eê]|list\s*task|xem\s*task|task\s*ch[uư]a\s*[đd][oó]ng|task\s*[đd]ang\s*m[oở]/i.test(userMessage))) {
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
  // AI sometimes hallucinates "đã tạo" but doesn't send notion_action
  const captureIntents = ['CAPTURE', 'CAPTURE_BATCH', 'CAPTURE_SPLIT'];
  if (captureIntents.includes(aiResult.intent) && !action) {
    console.error('BUG: AI returned CAPTURE intent without notion_action!', JSON.stringify(aiResult));
    aiResult.response_text = '⚠️ **Lỗi hệ thống**: AI không gửi đúng data để tạo task.\n\n' +
      '💡 Thử lại: gõ rõ từng task, VD:\n' +
      '"Review deck GMA deadline 20/5"\n' +
      'hoặc gửi nhiều task:\n' +
      '"task1, task2, task3"';
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
              aiResult.response_text = `❌ Không tìm thấy "${action.data.task_title}".`;
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
  if (!notionResult && !captureIntents.includes(aiResult.intent) &&
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
    return `📭 Không có task nào active.\nChill đi Matt! 🎮${buildStatsFooter(stats)}`;
  }

  const urgencyOrder = { '🔴 Fire': 0, '🟡 Important': 1, '🟢 Wait': 2, '⚪ Someday': 3 };
  tasks.sort((a, b) => {
    const ua = urgencyOrder[a.urgency] ?? 9;
    const ub = urgencyOrder[b.urgency] ?? 9;
    if (ua !== ub) return ua - ub;
    return (a.due_date || '9999').localeCompare(b.due_date || '9999');
  });

  const actionable = tasks.filter(t => t.urgency !== '⚪ Someday');
  const next = actionable[0];
  const totalEst = actionable.slice(0, 3).reduce((s, t) => s + (t.estimate || 0), 0);
  const loadPct = Math.round((totalEst / capacity) * 100);

  let r = `${dayIcon} Plan hôm nay (${capacity}p)\n\n`;

  // NEXT task — prominent
  if (next) {
    const est = next.estimate ? `${next.estimate}p` : '?p';
    const dl = next.due_date ? ` · 📅 ${next.due_date}` : '';
    r += `▶️ TIẾP THEO:\n`;
    r += `${next.urgency || '🟡'} ${next.title}\n`;
    r += `📂 ${next.project || '?'} · ⏱ ${est}${dl}\n\n`;
  }

  // Summary
  const remaining = actionable.length - 1;
  const queueCount = tasks.length - actionable.length;
  if (remaining > 0) r += `📋 +${remaining} task nữa`;
  if (queueCount > 0) r += ` | 📦 +${queueCount} backlog`;
  r += `\n${buildLoadBar(loadPct)}`;
  r += buildStatsFooter(stats);
  r += `\n\n💡 Gõ "xem hết" hoặc "done ${next?.title?.split(' ').slice(0, 2).join(' ') || 'task'}"`;

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

  let r = `📊 Load Check\n\n`;
  r += `📌 ${tasks.length} tasks · ⏱ ${totalEst}p (~${Math.round(totalEst / 60)}h)\n`;
  r += `📅 Weekly: ${weekCap}p (~${Math.round(weekCap / 60)}h)\n\n`;
  r += buildLoadBar(loadPct);

  if (loadPct > 100) {
    r += `\n\n🔴 OVERLOAD! Drop ~${Math.round((totalEst - weekCap) / 60)}h.`;
    const droppable = tasks.filter(t => t.urgency === '⚪ Someday' || t.urgency === '🟢 Wait').slice(0, 2);
    if (droppable.length) {
      r += '\n💡 Suggest drop:\n';
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

  let r = `💡 Backlog — ${tasks.length} items\n\n`;
  const byProj = {};
  tasks.forEach(t => {
    const p = t.project || '?';
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
  r += '💡 Gõ "pick [tên]" để bắt đầu.';
  return r;
}
