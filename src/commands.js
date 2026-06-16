// Instant command matching v5.3 — anchored regex, zero false positives
// Only exact command words match. Natural language goes to AI.

import { queryTasks, updateTaskStatus, editTask } from './notion.js';
import { getSummary, buildStatsReport, buildDeferReport, getChronicDefers, clearDeferCount } from './analytics.js';
import {
  buildTriageResponse, buildOverdueResponse, buildLoadCheckResponse,
  buildListResponse, buildReportResponse, buildBacklogResponse,
  buildMaterialsResponse, buildCompletionResponse, buildParkedResponse,
  buildDayPlanResponse,
} from './responses.js';
import { buildDayPlan } from './planner.js';

async function savePlanPending(chatId, plan, env) {
  if (!env.CHAT_MEMORY) return;
  try {
    await env.CHAT_MEMORY.put(`pending:${chatId}`, JSON.stringify({ type: 'apply_plan', plan, viaAI: false }), { expirationTtl: 600 });
  } catch (err) {
    console.error('savePlanPending error:', err);
  }
}

// ─── Safe Commands (anchored ^...$) ─────────────────────
const SAFE_COMMANDS = [
  { type: 'plan',        regex: /^(?:plan|plan today|hôm nay|hôm nay làm gì)$/i },
  { type: 'overdue',     regex: /^(?:overdue|quá hạn|bỏ quên|bỏ sót)$/i },
  { type: 'load',        regex: /^(?:check load|load|quá tải|overload)$/i },
  { type: 'list',        regex: /^(?:list|liệt kê|xem tasks?|all tasks?)$/i },
  { type: 'report',      regex: /^(?:report|báo cáo|summary|tuần)$/i },
  { type: 'backlog',     regex: /^(?:backlog|ý tưởng|có gì làm|có gì làm không)$/i },
  { type: 'materials',   regex: /^(?:materials?|tài liệu|link|guides?)$/i },
  { type: 'stats',       regex: /^(?:stats|thống kê|analytics|số liệu)$/i },
  { type: 'done_num',    regex: /^(?:done|xong)\s+(\d+)$/i },
  // done_name: max ~6 words to avoid matching full sentences ("xong việc rồi nghỉ thôi")
  { type: 'done_name',   regex: /^(?:done|xong)\s+(\S+(?:\s+\S+){0,5})$/i },
  { type: 'park',        regex: /^(?:park|để dành|khoan làm)\s+(\S+(?:\s+\S+){0,5})$/i },
  { type: 'resume',      regex: /^(?:resume|làm lại|tiếp tục)\s+(\S+(?:\s+\S+){0,5})$/i },
  { type: 'parked_list', regex: /^(?:parked|để dành|đang park)$/i },
  // Planner v7 — daily plan / re-plan / week intake
  { type: 'plan_day',    regex: /^(?:xếp lịch|plan ngày|lên lịch)$/i },
  { type: 'replan',      regex: /^(?:xếp lại|re-?plan|lên lại)$/i },
  { type: 'week_intake', regex: /^(?:lịch tuần|tuần này)$/i },
];

/**
 * Try to match a message against instant commands.
 * Returns { type, match } or null.
 */
export function matchInstantCommand(msg) {
  const trimmed = msg.trim();
  for (const cmd of SAFE_COMMANDS) {
    const match = trimmed.match(cmd.regex);
    if (match) return { type: cmd.type, match };
  }
  return null;
}

/**
 * Execute an instant command (no AI needed).
 * Returns { intent, response_text, task_count? } or null if can't execute.
 */
export async function executeInstantCommand(cmd, env, chatId, getLastPlan, saveLastPlan) {
  const buildResult = (intent, text, taskCount) => ({
    intent, response_text: text, needs_confirmation: false, follow_up_question: null, task_count: taskCount,
  });

  switch (cmd.type) {
    case 'plan': {
      const tasks = await queryTasks('today', env);
      if (saveLastPlan) await saveLastPlan(chatId, tasks, env);
      return buildResult('TRIAGE', buildTriageResponse(tasks), tasks.length);
    }
    case 'overdue': {
      const tasks = await queryTasks('overdue', env);
      return buildResult('OVERDUE_CHECK', buildOverdueResponse(tasks), tasks.length);
    }
    case 'load': {
      const tasks = await queryTasks('all_active', env);
      return buildResult('LOAD_CHECK', buildLoadCheckResponse(tasks), tasks.length);
    }
    case 'list': {
      const tasks = await queryTasks('all_active', env);
      if (saveLastPlan) await saveLastPlan(chatId, tasks, env);
      return buildResult('LIST_TASKS', buildListResponse(tasks), tasks.length);
    }
    case 'report': {
      const tasks = await queryTasks('weekly_report', env);
      return buildResult('REPORT', buildReportResponse(tasks), tasks.length);
    }
    case 'backlog': {
      const tasks = await queryTasks('backlog', env);
      return buildResult('BACKLOG_BROWSE', buildBacklogResponse(tasks), tasks.length);
    }
    case 'materials': {
      const tasks = await queryTasks('materials', env);
      return buildResult('MATERIALS', buildMaterialsResponse(tasks), tasks.length);
    }
    case 'stats': {
      const summary = await getSummary(env, 7);
      const chronic = await getChronicDefers(env, 3);
      return buildResult('STATS', buildStatsReport(summary) + buildDeferReport(chronic));
    }
    case 'done_num': {
      const idx = parseInt(cmd.match[1]) - 1;
      const lastPlan = await getLastPlan(chatId, env);
      if (!lastPlan.length) return buildResult('UPDATE', '❌ Chưa có plan. Gõ "plan" trước rồi "done 1".');
      if (idx < 0 || idx >= lastPlan.length) return buildResult('UPDATE', `❌ Chỉ có ${lastPlan.length} tasks. Gõ "done 1" đến "done ${lastPlan.length}".`);
      const result = await updateTaskStatus(lastPlan[idx].title, 'Completed', env);
      if (!result) return buildResult('UPDATE', `❌ Không tìm thấy "${lastPlan[idx].title}".`);
      if (result.id) await clearDeferCount(env, result.id);
      const remaining = await queryTasks('today', env);
      return buildResult('UPDATE', buildCompletionResponse(result, remaining.length, remaining));
    }
    case 'done_name': {
      const taskName = cmd.match[1].trim();
      const result = await updateTaskStatus(taskName, 'Completed', env);
      if (!result) return buildResult('UPDATE', `❌ Không tìm thấy "${taskName}".`);
      if (result.id) await clearDeferCount(env, result.id);
      const remaining = await queryTasks('today', env);
      return buildResult('UPDATE', buildCompletionResponse(result, remaining.length, remaining));
    }
    case 'park': {
      const taskName = cmd.match[1].trim();
      const result = await updateTaskStatus(taskName, 'Pending', env);
      if (!result) return buildResult('EDIT', `❌ Không tìm thấy "${taskName}".`);
      if (result.id) await clearDeferCount(env, result.id);
      return buildResult('EDIT', `🅿️ Đã park "${result.title}". Sẽ im cho tới khi "resume".`);
    }
    case 'resume': {
      const taskName = cmd.match[1].trim();
      const now = new Date(Date.now() + 7 * 3600000); // VN time
      const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;
      const result = await editTask(taskName, { status: 'To do', deadline: today }, env);
      if (!result) return buildResult('EDIT', `❌ Không tìm thấy "${taskName}".`);
      if (result.id) await clearDeferCount(env, result.id);
      return buildResult('EDIT', `▶️ Đã resume "${result.title}" quay lại plan hôm nay.`);
    }
    case 'parked_list': {
      const tasks = await queryTasks('parked', env);
      return buildResult('LIST_TASKS', buildParkedResponse(tasks), tasks.length);
    }
    case 'plan_day': {
      const tasks = await queryTasks('all_active', env);
      const chronic = await getChronicDefers(env, 3);
      const deferMap = new Map(chronic.map(c => [c.id, c.count]));
      const plan = buildDayPlan(tasks, { deferMap });
      await savePlanPending(chatId, plan, env);
      return {
        ...buildResult('DAY_PLAN', buildDayPlanResponse(plan), plan.selected.length),
        needs_confirmation: true,
        pending_action: { type: 'apply_plan', data: plan },
      };
    }
    case 'replan': {
      const tasks = await queryTasks('all_active', env);
      const chronic = await getChronicDefers(env, 3);
      const deferMap = new Map(chronic.map(c => [c.id, c.count]));
      const now = new Date(Date.now() + 7 * 3600000);
      const fromTime = { hour: now.getUTCHours(), min: now.getUTCMinutes() };
      const plan = buildDayPlan(tasks, { deferMap, startFromNow: true, fromTime });
      await savePlanPending(chatId, plan, env);
      return {
        ...buildResult('DAY_PLAN', buildDayPlanResponse(plan), plan.selected.length),
        needs_confirmation: true,
        pending_action: { type: 'apply_plan', data: plan },
      };
    }
    case 'week_intake': {
      // P2 — week intake via LLM. For v1 just prompt Matt to type fixed items.
      return buildResult('WEEK_INTAKE',
        '📅 Tuần này có gì cố định? (họp, hẹn, ngày WFH)\n' +
        'Gõ tự nhiên, ví dụ: "T3 14h họp GMA, T5 WFH cả ngày".');
    }
    default:
      return null;
  }
}
