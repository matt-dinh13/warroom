// Fallback parsers v5.3 — extract task data when AI returns plain text
// Used when MiniMax fails to return proper JSON

import { PROJECT_SOURCE_MAP } from './prompts.js';

/**
 * Try to parse task data from AI's plain text response
 * Used when AI returns formatted text instead of JSON for CAPTURE
 */
export function tryParseCaptureFromAIResponse(aiResponse, userMessage) {
  if (!aiResponse) return null;

  let titleMatch = aiResponse.match(/📌\s*(.+?)(?:\s*\||\n|$)/);
  if (!titleMatch) titleMatch = aiResponse.match(/📋\s*(?:Task:\s*)?(.+?)(?:\s*\||\n|$)/);
  if (!titleMatch) return null;

  const title = titleMatch[1].trim();
  if (!title) return null;

  const task = { title };

  // Project
  const projectMatch = aiResponse.match(/📂\s*(\w+)/);
  if (projectMatch) task.project = projectMatch[1];

  // Urgency
  if (/🔴|Fire/i.test(aiResponse)) task.urgency = '🔴 Fire';
  else if (/🟡|Important/i.test(aiResponse)) task.urgency = '🟡 Important';
  else if (/🟢|Wait/i.test(aiResponse)) task.urgency = '🟢 Wait';
  else if (/⚪|Someday/i.test(aiResponse)) task.urgency = '⚪ Someday';

  // Estimate
  const estMatch = aiResponse.match(/⏱[️\ufe0f]?\s*(\d+)\s*p/);
  if (estMatch) task.estimate = parseInt(estMatch[1]);

  // Deadline
  const dateMatch = aiResponse.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    task.due_date = dateMatch[1];
  } else {
    const ddmm = userMessage.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
    if (ddmm) {
      const year = ddmm[3] || '2026';
      task.due_date = `${year}-${ddmm[2].padStart(2, '0')}-${ddmm[1].padStart(2, '0')}`;
    }
  }

  // Assigned
  const assignedMatch = aiResponse.match(/👤\s*(.+?)(?:\n|$)/);
  if (assignedMatch) task.assigned_by = assignedMatch[1].trim();

  // Source from project
  if (task.project) {
    task.source = PROJECT_SOURCE_MAP[task.project] || 'EIT';
  }

  // Block
  if (/☀️|AM/i.test(aiResponse)) task.block = '☀️ AM';
  else if (/🌤️|PM/i.test(aiResponse)) task.block = '🌤️ PM';
  else if (/🌙|Power Block/i.test(aiResponse)) task.block = '🌙 Power Block';

  return task;
}

/**
 * Detect if message is an update/edit/delete intent (for fallback guard)
 */
export function detectFallbackIntent(msg) {
  const isUpdate = /c[aậ]p\s*nh[aậ]t|chuy[eể]n|close|done|xong|completed|ho[aà]n\s*th[aà]nh|drop/i.test(msg);
  const isEdit = /s[uử]a|edit|[đd][ổo]i|stakeholder|assigned/i.test(msg);
  const isDelete = /xo[aá]|delete|remove|b[oỏ]/i.test(msg);
  return { isUpdate, isEdit, isDelete };
}

/**
 * Try to extract task name from update message
 */
export function extractUpdateTarget(msg) {
  const match = msg.match(/^(.+?)\s+(?:c[aậ]p\s*nh[aậ]t|chuy[eể]n|close|done|xong|completed|ho[aà]n\s*th[aà]nh|drop)/i)
    || msg.match(/^(?:close|done|xong|ho[aà]n\s*th[aà]nh|drop)\s+(.+)$/i);
  if (match) {
    const taskName = match[1].trim();
    if (taskName.length >= 3) return taskName;
  }
  return null;
}

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

// If user mentioned a specific time (10am, 2pm, 14:00, etc.),
// parse it and set scheduled_time on the task data
export function enrichWithScheduledTime(taskData, userMsg) {
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

/**
 * Score a message for direct parse confidence
 */
export function scoreDirectParse(msg) {
  const direct = tryDirectParse(msg);
  if (!direct) return null;

  const tasks = Array.isArray(direct) ? direct : [direct];
  if (tasks.length === 0) return null;

  const firstTask = tasks[0];
  const title = firstTask.title;
  if (!title) return null;

  const lower = msg.toLowerCase();
  
  // Check if message is a question or doubtful
  const isDoubtful = /\?|có nên|hay là|nên chăng/i.test(lower);

  // Check for presence of extra fields
  // 1. Project: was there a project match?
  const hasProject = /(?:dự án|project|DA)\s+(\S+)/i.test(msg);
  // 2. Estimate: did they specify estimate?
  const hasEstimate = /(\d+)\s*(?:phút|min(?:ute)?s?|p(?!m\b))/i.test(msg);
  // 3. Time: did they specify time?
  const hasTime = /(\d{1,2})\s*[:]\s*(\d{2})\s*(?:am|pm|sáng|chiều|tối)?/i.test(msg)
    || /(\d{1,2})\s*(?:am|pm|sáng|chiều|tối)/i.test(msg);
  // 4. Due date or Weekday
  const hasWeekday = /thứ\s*\d|chủ\s*nhật/i.test(lower);
  const hasRelativeDate = /mai|ngày mai|tomorrow|hôm nay|today/i.test(lower);
  const hasAbsoluteDate = /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/.test(msg);
  const hasDateOrWeekday = hasWeekday || hasRelativeDate || hasAbsoluteDate;

  const hasExtraFields = hasProject || hasEstimate || hasTime || hasDateOrWeekday;

  let confidence = 'low';
  if (!isDoubtful && hasExtraFields) {
    confidence = 'high';
  }

  return { tasks: direct, confidence };
}

