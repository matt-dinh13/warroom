// Fallback parsers v5.0 — extract task data when AI returns plain text
// Used when MiniMax fails to return proper JSON

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

  // Energy
  if (/⚡|High/i.test(aiResponse)) task.energy = '⚡ High';
  else if (/🔋|Med/i.test(aiResponse)) task.energy = '🔋 Med';
  else if (/😴|Low/i.test(aiResponse)) task.energy = '😴 Low';

  // Estimate
  const estMatch = aiResponse.match(/⏱\s*(\d+)p/);
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
    const { PROJECT_SOURCE_MAP } = require('./prompts.js');
    task.source = PROJECT_SOURCE_MAP[task.project] || 'EIT';
  }

  // Block
  if (/☀️|AM/i.test(aiResponse)) task.block = '☀️ AM';
  else if (/🌤️|PM/i.test(aiResponse)) task.block = '🌤️ PM';
  else if (/🌙|Power Block/i.test(aiResponse)) task.block = '🌙 Power Block';

  return task;
}

/**
 * Parse task data directly from user message when AI fails completely
 */
export function tryParseTaskFromUserMessage(msg) {
  let text = msg.replace(/^(?:tạo\s*(?:task)?|capture|thêm|add|nhờ|giúp|làm)\s*:?\s*/i, '').trim();
  if (!text || text.length < 3) return null;

  const task = {};
  const projects = ['GMA', 'HOSEL', 'SALES', 'EMPULSE', 'KV', 'EDU', 'TEACH', 'LEARN', 'PERSONAL', 'MATERIALS'];
  const sourceMap = { 'GMA': 'EIT', 'HOSEL': 'EIT', 'SALES': 'EIT', 'EMPULSE': 'EIT', 'KV': 'EIT', 'EDU': 'Side Gig', 'TEACH': 'Side Gig', 'LEARN': 'Self', 'PERSONAL': 'Personal', 'MATERIALS': 'Self' };

  // Extract project
  for (const p of projects) {
    if (new RegExp(`\\b${p}\\b`, 'i').test(text)) {
      task.project = p;
      task.source = sourceMap[p] || 'EIT';
      text = text.replace(new RegExp(`[,.]?\\s*(?:project|dự án)?\\s*${p}`, 'i'), '').trim();
      break;
    }
  }

  // Extract urgency
  if (/fire|kh[aẩ]n|g[aấ]p/i.test(text)) { task.urgency = '🔴 Fire'; text = text.replace(/[,.]?\s*(?:urgency\s*)?(?:fire|khẩn|gấp)/i, '').trim(); }
  else if (/important|quan\s*tr[oọ]ng/i.test(text)) { task.urgency = '🟡 Important'; text = text.replace(/[,.]?\s*(?:urgency\s*)?(?:important|quan trọng)/i, '').trim(); }

  // Extract deadline
  const dateMatch = text.match(/(?:deadline|hạn|ngày)?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/i);
  if (dateMatch) {
    const year = dateMatch[3] || '2026';
    task.due_date = `${year}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
    text = text.replace(/[,.]?\s*(?:deadline|hạn|ngày)?\s*\d{1,2}\/\d{1,2}(?:\/\d{4})?/i, '').trim();
  }

  // Extract estimate
  const estMatch = text.match(/(\d+)\s*(?:p|phút|min)/i);
  if (estMatch) { task.estimate = parseInt(estMatch[1]); text = text.replace(/[,.]?\s*\d+\s*(?:p|phút|min)/i, '').trim(); }

  // Clean remaining text as title
  text = text.replace(/[,.]?\s*(?:estimate|urgency|project|deadline)\s*/gi, '').replace(/[,.\s]+$/, '').trim();
  if (!text || text.length < 2) return null;

  task.title = text;
  if (!task.urgency) task.urgency = '🟡 Important';
  if (!task.energy) task.energy = '🔋 Med';

  // Auto-set materials
  if (task.project === 'MATERIALS') {
    task.urgency = '⚪ Someday';
  }

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
