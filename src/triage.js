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

// ─── Last Plan Cache (for "done 1/2/3") ─────────────
const LAST_PLAN_PREFIX = 'lastplan:';

async function getLastPlan(chatId, env) {
  if (!env.CHAT_MEMORY) return [];
  try { return (await env.CHAT_MEMORY.get(`${LAST_PLAN_PREFIX}${chatId}`, 'json')) || []; } catch { return []; }
}
async function saveLastPlan(chatId, tasks, env) {
  if (!env.CHAT_MEMORY) return;
  try {
    const s = tasks.map(t => ({ title: t.title, id: t.id, urgency: t.urgency, project: t.project }));
    await env.CHAT_MEMORY.put(`${LAST_PLAN_PREFIX}${chatId}`, JSON.stringify(s), { expirationTtl: MEMORY_TTL });
  } catch {}
}

function buildResult(intent, text, taskCount) {
  return { intent, response_text: text, needs_confirmation: false, follow_up_question: null, task_count: taskCount };
}

function buildCaptureConfirmation(d) {
  let r = `✅ Đã tạo task:\n📌 ${d.title || 'Untitled'}`;
  if (d.project) r += `\n📂 ${d.project}`;
  if (d.urgency) r += ` | ${d.urgency}`;
  if (d.energy) r += ` | ${d.energy}`;
  if (d.estimate) r += `\n⏱ ${d.estimate}p`;
  if (d.due_date) r += ` | 📅 ${d.due_date}`;
  if (d.assigned_by) r += `\n👤 ${d.assigned_by}`;
  r += `\n\n💡 Gõ "plan" để xem ưu tiên.`;
  return r;
}

// ─── Main Entry (Engine-First) ───────────────────────────────
// Phase 1: Regex commands → execute directly (instant, no AI)
// Phase 2: AI only for natural language capture (ambiguous input)
export async function processChat(userMessage, env, chatId = 'web') {
  const { dateContext, dayType, capacity, vnHour } = getVNContext();
  const msg = userMessage.trim();

  // ═══ PHASE 1: Direct Commands (NO AI call, instant) ═══════

  // DONE BY NUMBER: "done 1", "xong 2"
  const doneNumMatch = msg.match(/^(?:done|xong)\s+(\d+)$/i);
  if (doneNumMatch) {
    const idx = parseInt(doneNumMatch[1]) - 1;
    const lastPlan = await getLastPlan(chatId, env);
    if (!lastPlan.length) return buildResult('UPDATE', '❌ Chưa có plan. Gõ "plan" trước rồi "done 1".');
    if (idx < 0 || idx >= lastPlan.length) return buildResult('UPDATE', `❌ Chỉ có ${lastPlan.length} tasks. Gõ "done 1" đến "done ${lastPlan.length}".`);
    const result = await updateTaskStatus(lastPlan[idx].title, 'Completed', env);
    if (!result) return buildResult('UPDATE', `❌ Không tìm thấy "${lastPlan[idx].title}".`);
    const isFire = (result.urgency || '').includes('Fire');
    const { xpGained, newAchievements, stats } = await recordCompletion(chatId, env, isFire);
    return buildResult('UPDATE', buildCompletionResponse(result, xpGained, newAchievements, stats));
  }

  // DONE BY NAME: "done [name]", "xong [name]"
  const doneNameMatch = msg.match(/^(?:done|xong|drop)\s+(.+)$/i);
  if (doneNameMatch) {
    const result = await updateTaskStatus(doneNameMatch[1].trim(), 'Completed', env);
    if (!result) return buildResult('UPDATE', `❌ Không tìm thấy "${doneNameMatch[1]}".\n💡 Gõ "plan" để xem danh sách.`);
    const isFire = (result.urgency || '').includes('Fire');
    const { xpGained, newAchievements, stats } = await recordCompletion(chatId, env, isFire);
    return buildResult('UPDATE', buildCompletionResponse(result, xpGained, newAchievements, stats));
  }

  // PLAN: "plan", "plan today", "hôm nay"
  if (/^(?:plan\s*(?:today)?|h[oô]m\s*nay|[uư]u\s*ti[eê]n|today)$/i.test(msg)) {
    const tasks = await queryTasks('today', env);
    const stats = await getStats(chatId, env);
    if (tasks.length > 0) await saveLastPlan(chatId, tasks, env);
    return buildResult('TRIAGE', buildTriageResponse(tasks, stats), tasks.length);
  }

  // OVERDUE
  if (/overdue|qu[eê]n|b[oỏ]\s*(?:s[oó]t|qu[eê]n)/i.test(msg)) {
    const tasks = await queryTasks('overdue', env);
    return buildResult('OVERDUE_CHECK', buildOverdueResponse(tasks), tasks.length);
  }

  // LOAD CHECK
  if (/^(?:check\s*load|load|overload|qu[aá]\s*t[aả]i)$/i.test(msg)) {
    const tasks = await queryTasks('all_active', env);
    return buildResult('LOAD_CHECK', buildLoadCheckResponse(tasks), tasks.length);
  }

  // BACKLOG
  if (/backlog|c[oó]\s*g[iì]\s*l[aà]m|r[aả]nh|[yý]\s*t[uư][oở]ng/i.test(msg)) {
    const tasks = await queryTasks('backlog', env);
    return buildResult('BACKLOG_BROWSE', buildBacklogResponse(tasks), tasks.length);
  }

  // LIST
  if (/^(?:list|xem\s*h[eế]t|li[eệ]t\s*k[eê])$/i.test(msg) || /li[eệ]t k[eê]|list\s*task|xem\s*task/i.test(msg)) {
    const tasks = await queryTasks('all_active', env);
    return buildResult('LIST_TASKS', buildListResponse(tasks), tasks.length);
  }

  // DELETE: "xoá [task]"
  const deleteMatch = msg.match(/^(?:xo[aá]|delete|remove)\s+(.+)$/i);
  if (deleteMatch) {
    const archived = await archiveTask(deleteMatch[1].trim(), env);
    if (!archived) return buildResult('DELETE', `❌ Không tìm thấy "${deleteMatch[1]}".`);
    return buildResult('DELETE', `🗑️ Đã xoá: "${archived.title}"\n\n💡 Gõ "plan" để xem task còn lại.`);
  }

  // REPORT
  if (/^(?:report|summary|b[aá]o\s*c[aá]o)$/i.test(msg)) {
    const tasks = await queryTasks('weekly_report', env);
    const stats = await getStats(chatId, env);
    return buildResult('REPORT', buildReportResponse(tasks, stats));
  }

  // ═══ PHASE 2: AI-Powered (natural language capture) ═══════
  const enrichedMessage = `${dateContext}\n${msg}`;
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
          if (aiResult.intent === 'CAPTURE_SPLIT' && action.data?.parent && action.data?.subtasks) {
            await createTask(action.data.parent, env);
            for (const sub of action.data.subtasks) {
              await createTask({ ...sub, project: action.data.parent.project, urgency: action.data.parent.urgency, source: action.data.parent.source }, env);
            }
            notionResult = true;
            responseText = `✅ Đã tạo + chia nhỏ:\n📌 ${action.data.parent.title}\n📦 ${action.data.subtasks.length} sub-tasks\n\n💡 Gõ "plan" để xem.`;
          } else {
            notionResult = await createTask(taskData, env);
            responseText = buildCaptureConfirmation(taskData);
            // 2-MINUTE RULE
            if ((taskData.estimate || 30) <= 5) {
              const todayTasks = await queryTasks('today', env);
              const inProgress = todayTasks.filter(t => t.status === 'In progress');
              if (inProgress.length === 0) {
                responseText += `\n\n⚡ Chỉ ${taskData.estimate || 5}p — làm luôn đi! Gõ "done ${taskData.title?.split(' ').slice(0, 2).join(' ')}" khi xong.`;
              } else {
                responseText += `\n\n💡 Đang focus [${inProgress[0].title}] — pick sau khi xong!`;
              }
            }
            // CONTEXT SWITCH WARNING
            if ((taskData.estimate || 30) > 5) {
              const todayTasks = await queryTasks('today', env);
              const inProgress = todayTasks.filter(t => t.status === 'In progress');
              if (inProgress.length > 0) {
                responseText += `\n\n⚡ Đang có "${inProgress[0].title}" in progress. Finish trước hay switch?`;
              }
            }
          }
          break;
        }
        case 'create_batch': {
          const tasks = action.data?.tasks || [];
          for (const t of tasks) await createTask(t, env);
          const { newAchievements, stats } = await recordBatch(chatId, env, tasks.length);
          notionResult = true;
          responseText = buildBatchResponse(tasks, stats, newAchievements);
          break;
        }
        case 'update':
          if (action.data?.task_title && action.data?.new_status) {
            notionResult = await updateTaskStatus(action.data.task_title, action.data.new_status, env);
            if (!notionResult) { responseText = `❌ Không tìm thấy "${action.data.task_title}".`; }
            else {
              const isFire = (notionResult.urgency || '').includes('Fire');
              const { xpGained, newAchievements, stats } = await recordCompletion(chatId, env, isFire);
              responseText = buildCompletionResponse(notionResult, xpGained, newAchievements, stats);
            }
          }
          break;
        case 'edit':
          if (action.data?.task_title && action.data?.updates) {
            notionResult = await editTask(action.data.task_title, action.data.updates, env);
            if (!notionResult) { responseText = `❌ Không tìm thấy "${action.data.task_title}".`; }
            else {
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
          if (Array.isArray(notionResult)) {
            const stats = await getStats(chatId, env);
            if (aiResult.intent === 'TRIAGE') responseText = buildTriageResponse(notionResult, stats);
            else if (aiResult.intent === 'OVERDUE_CHECK') responseText = buildOverdueResponse(notionResult);
            else if (aiResult.intent === 'LOAD_CHECK') responseText = buildLoadCheckResponse(notionResult);
            else if (aiResult.intent === 'REPORT') responseText = buildReportResponse(notionResult, stats);
            else if (aiResult.intent === 'BACKLOG_BROWSE') responseText = buildBacklogResponse(notionResult);
          }
          break;
      }
    } catch (err) {
      console.error('Notion error:', err);
      responseText += `\n\n⚠️ Lỗi: ${err.message}`;
    }
  }

  // ─── Fallbacks when AI returns plain text ──────────────────
  if (!action && !notionResult) {
    if (/📌|📋|Task:|đ[aã]\s*t[aạ]o|captured/i.test(responseText) && /t[aạ]o|capture|th[eê]m|add|task/i.test(responseText + msg)) {
      const fallbackTask = tryParseCaptureFromAIResponse(responseText, msg);
      if (fallbackTask) {
        try { notionResult = await createTask(fallbackTask, env); responseText = buildCaptureConfirmation(fallbackTask); } catch {}
      }
    }
    if (!notionResult && /s[uử]a|edit|[đd][ổo]i|update|stakeholder|assigned/i.test(msg)) {
      const editFb = tryParseEditFromMessage(msg, responseText);
      if (editFb) {
        try {
          const r = await editTask(editFb.task_title, editFb.updates, env);
          if (r) { notionResult = r; responseText = `✏️ Đã sửa "${r.title}":\n${Object.entries(editFb.updates).map(([k,v])=>`  • ${k}: ${v}`).join('\n')}\n\n💡 Gõ "plan" để xem lại.`; }
        } catch {}
      }
    }
  }

  // Save memory
  const finalHistory = [...updatedHistory, { role: 'assistant', content: responseText }];
  await saveConversation(chatId, finalHistory, env);

  return buildResult(aiResult.intent || 'CLARIFY', responseText, Array.isArray(notionResult) ? notionResult.length : undefined);
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
    tasks.slice(1, 4).forEach((t, i) => {
      r += `\n  ${i + 2}. ${t.urgency || '🟡'} ${t.title}`;
    });
    if (tasks.length > 4) r += `\n  ... +${tasks.length - 4} nữa`;
    r += '\n';
  }

  r += `\n${buildLoadBar(loadPct)}`;
  r += buildStatsFooter(stats);
  r += `\n\n💡 Gõ "done 1" để hoàn thành task đầu, hoặc "xem hết"`;

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

function buildListResponse(tasks) {
  if (!tasks || !tasks.length) return '✨ Không có task nào đang mở!\n\n💡 Gõ task mới để bắt đầu.';
  const grouped = {};
  tasks.forEach(t => { const st = t.status || 'To do'; if (!grouped[st]) grouped[st] = []; grouped[st].push(t); });
  const icons = { 'In progress': '🔥', 'To do': '📋', 'Pending / Wait for approved': '⏳' };
  let lines = [`📊 **${tasks.length} tasks đang mở:**\n`];
  for (const [status, items] of Object.entries(grouped)) {
    lines.push(`${icons[status] || '📌'} **${status}** (${items.length})`);
    items.forEach((t, i) => {
      const p = t.project ? ` [${t.project}]` : '';
      const u = t.urgency ? ` ${t.urgency}` : '';
      const d = t.due_date ? ` ⏰${t.due_date}` : '';
      lines.push(`  ${i + 1}. ${t.title}${p}${u}${d}`);
    });
    lines.push('');
  }
  lines.push('💡 Gõ "done [tên]" hoặc "plan" để focus.');
  return lines.join('\n');
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

  // Extract title from 📌 or 📋 Task: line
  const titleMatch = aiResponse.match(/(?:📌|📋)\s*(?:Task:\s*)?(.+?)(?:\s*\||\n|$)/);
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
