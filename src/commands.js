// Instant command matching v5.3 — anchored regex, zero false positives
// Only exact command words match. Natural language goes to AI.

import { queryTasks, updateTaskStatus } from './notion.js';
import {
  buildTriageResponse, buildOverdueResponse, buildLoadCheckResponse,
  buildListResponse, buildReportResponse, buildBacklogResponse,
  buildMaterialsResponse, buildCompletionResponse,
} from './responses.js';

// ─── Safe Commands (anchored ^...$) ─────────────────────
const SAFE_COMMANDS = [
  { type: 'plan',     regex: /^(?:plan|plan today|hôm nay|hôm nay làm gì)$/i },
  { type: 'overdue',  regex: /^(?:overdue|quá hạn|bỏ quên|bỏ sót)$/i },
  { type: 'load',     regex: /^(?:check load|load|quá tải|overload)$/i },
  { type: 'list',     regex: /^(?:list|liệt kê|xem tasks?|all tasks?)$/i },
  { type: 'report',   regex: /^(?:report|báo cáo|summary|tuần)$/i },
  { type: 'backlog',  regex: /^(?:backlog|ý tưởng|có gì làm|có gì làm không)$/i },
  { type: 'materials',regex: /^(?:materials?|tài liệu|link|guides?)$/i },
  { type: 'done_num', regex: /^(?:done|xong)\s+(\d+)$/i },
  // done_name: max ~6 words to avoid matching full sentences ("xong việc rồi nghỉ thôi")
  { type: 'done_name',regex: /^(?:done|xong)\s+(\S+(?:\s+\S+){0,5})$/i },
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
    case 'done_num': {
      const idx = parseInt(cmd.match[1]) - 1;
      const lastPlan = await getLastPlan(chatId, env);
      if (!lastPlan.length) return buildResult('UPDATE', '❌ Chưa có plan. Gõ "plan" trước rồi "done 1".');
      if (idx < 0 || idx >= lastPlan.length) return buildResult('UPDATE', `❌ Chỉ có ${lastPlan.length} tasks. Gõ "done 1" đến "done ${lastPlan.length}".`);
      const result = await updateTaskStatus(lastPlan[idx].title, 'Completed', env);
      if (!result) return buildResult('UPDATE', `❌ Không tìm thấy "${lastPlan[idx].title}".`);
      const remaining = await queryTasks('today', env);
      return buildResult('UPDATE', buildCompletionResponse(result, remaining.length, remaining));
    }
    case 'done_name': {
      const taskName = cmd.match[1].trim();
      const result = await updateTaskStatus(taskName, 'Completed', env);
      if (!result) return buildResult('UPDATE', `❌ Không tìm thấy "${taskName}".`);
      const remaining = await queryTasks('today', env);
      return buildResult('UPDATE', buildCompletionResponse(result, remaining.length, remaining));
    }
    default:
      return null;
  }
}
