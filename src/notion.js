// Notion API client — adapted for existing "Today" DB schema
//
// Property mapping (DB "Today" → Stratt concept):
//   Name (title)       → Task title
//   Context (select)   → Project (GMA, HOSEL, SALES, etc.)
//   Priority (select)  → Priority (High/Medium/Low)
//   Urgency (select)   → Urgency (🔴 Fire, 🟡 Important, etc.)
//   Energy (select)    → Energy (⚡ High, 🔋 Med, 😴 Low)
//   State (status)     → Status (To do, In progress, Completed)
//   Deadline (date)    → Due date
//   Do Date (date)     → Planned do date
//   Estimate (number)  → Minutes estimate
//   Block (select)     → Time block (AM/PM/Power Block)
//   Source (select)    → Source (EIT, Side Gig, etc.)
//   Assigned By (text) → Who assigned the task
//   Notes (text)       → AI-generated context
//   Resource (url)     → Link

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function notionHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

/**
 * Create a new task in the existing "Today" Notion DB
 */
export async function createTask(taskData, env) {
  const properties = {
    'Name': {
      title: [{ text: { content: taskData.title || 'Untitled Task' } }],
    },
  };

  // Select properties
  if (taskData.project) {
    properties['Context'] = { select: { name: taskData.project } };
  }
  if (taskData.urgency) {
    properties['Urgency'] = { select: { name: taskData.urgency } };
  }
  if (taskData.energy) {
    properties['Energy'] = { select: { name: taskData.energy } };
  }
  if (taskData.block) {
    properties['Block'] = { select: { name: taskData.block } };
  }
  if (taskData.source) {
    properties['Source'] = { select: { name: taskData.source } };
  }

  // Map AI priority to existing Priority values
  if (taskData.urgency) {
    const priorityMap = {
      '🔴 Fire': 'High Priority',
      '🟡 Important': 'Medium Priority',
      '🟢 Wait': 'Low Priority',
      '⚪ Someday': 'Low Priority',
    };
    const mapped = priorityMap[taskData.urgency];
    if (mapped) {
      properties['Priority'] = { select: { name: mapped } };
    }
  }

  // Status — default to "To do"
  properties['State'] = { status: { name: 'To do' } };

  // Number: estimate (minutes)
  if (taskData.estimate) {
    properties['Estimate'] = { number: taskData.estimate };
  }

  // Date: deadline + do_date (sync both so Notion views work)
  if (taskData.due_date) {
    properties['Deadline'] = { date: { start: taskData.due_date } };
    properties['Do Date'] = { date: { start: taskData.due_date } };
  }

  // Rich text: assigned_by, context → Notes
  if (taskData.assigned_by) {
    properties['Assigned By'] = {
      rich_text: [{ text: { content: taskData.assigned_by } }],
    };
  }
  if (taskData.context) {
    properties['Notes'] = {
      rich_text: [{ text: { content: taskData.context } }],
    };
  }

  // URL: resource (link, video, article)
  if (taskData.resource) {
    properties['Resource'] = { url: taskData.resource };
  }

  const response = await fetch(`${NOTION_BASE}/pages`, {
    method: 'POST',
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify({
      parent: { database_id: env.NOTION_TASKS_DB_ID },
      properties,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Notion create error ${response.status}: ${err}`);
  }

  return await response.json();
}

/**
 * Query tasks from Notion with filters
 * @param {string} queryType - "today" | "upcoming" | "overdue" | "all_active" | "weekly_report" | "backlog"
 *
 * Query philosophy (ADHD-optimized):
 * - User doesn't care about To do vs In progress — only "done" vs "not done"
 * - "today" = tasks due today or overdue (what needs attention NOW)
 * - "upcoming" = tasks due in next 7 days (planning view)
 * - "all_active" = everything not completed (for LIST_TASKS)
 * - "backlog" = Someday items or no deadline (ideas, links, low priority)
 */
export async function queryTasks(queryType, env) {
  let filter;
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  switch (queryType) {
    case 'today':
      // Tasks that need attention TODAY:
      // - Deadline or Do Date is today or earlier AND not completed
      // Simple approach: just check both date fields
      filter = {
        and: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          {
            or: [
              { property: 'Do Date', date: { on_or_before: today } },
              { property: 'Deadline', date: { on_or_before: today } },
            ],
          },
        ],
      };
      break;

    case 'upcoming':
      // Tasks due in the next 7 days (after today, before next week)
      filter = {
        and: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          {
            or: [
              {
                and: [
                  { property: 'Do Date', date: { after: today } },
                  { property: 'Do Date', date: { on_or_before: nextWeek } },
                ],
              },
              {
                and: [
                  { property: 'Deadline', date: { after: today } },
                  { property: 'Deadline', date: { on_or_before: nextWeek } },
                ],
              },
            ],
          },
        ],
      };
      break;

    case 'overdue':
      // Tasks past deadline and NOT completed
      filter = {
        and: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          {
            or: [
              { property: 'Deadline', date: { before: today } },
              { property: 'Do Date', date: { before: today } },
            ],
          },
        ],
      };
      break;

    case 'all_active':
      // All tasks not completed, excluding Someday (those go to backlog)
      filter = {
        and: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          { property: 'Urgency', select: { does_not_equal: '⚪ Someday' } },
        ],
      };
      break;

    case 'weekly_report':
      // Completed tasks this week (last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      filter = {
        and: [
          { property: 'State', status: { equals: 'Completed' } },
          { property: 'Deadline', date: { on_or_after: weekAgo } },
        ],
      };
      break;

    case 'backlog':
      // Backlog: Someday urgency items (simple, reliable filter)
      filter = {
        and: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          { property: 'Urgency', select: { equals: '⚪ Someday' } },
        ],
      };
      break;

    default:
      filter = undefined;
  }

  const body = {
    filter,
    sorts: [
      { property: 'Deadline', direction: 'ascending' },
    ],
    page_size: 100,
  };

  const response = await fetch(
    `${NOTION_BASE}/databases/${env.NOTION_TASKS_DB_ID}/query`,
    {
      method: 'POST',
      headers: notionHeaders(env.NOTION_API_KEY),
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Notion query error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.results.map(parseNotionTask);
}

// ─── Fuzzy Search ────────────────────────────────────

/**
 * Normalize text for fuzzy matching (remove diacritics, lowercase)
 */
function normalizeText(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/đ/g, 'd')
    .replace(/[^\w\s]/g, '') // remove special chars
    .trim();
}

/**
 * Score how well a query matches a task title
 * Higher score = better match. Returns 0 if no match.
 */
function fuzzyScore(query, title) {
  const nq = normalizeText(query);
  const nt = normalizeText(title);

  // Exact match
  if (nt === nq) return 100;

  // Substring match
  if (nt.includes(nq)) return 80;
  if (nq.includes(nt)) return 70;

  // Word-level match: count how many query words appear in title
  const queryWords = nq.split(/\s+/).filter(w => w.length > 1);
  const titleWords = nt.split(/\s+/);

  if (queryWords.length === 0) return 0;

  let matchedWords = 0;
  for (const qw of queryWords) {
    if (titleWords.some(tw => tw.includes(qw) || qw.includes(tw))) {
      matchedWords++;
    }
  }

  const wordScore = Math.round((matchedWords / queryWords.length) * 60);
  return wordScore;
}

/**
 * Find best matching task from a list
 * Returns null if no decent match found (score < 30)
 */
function findBestMatch(tasks, searchTitle) {
  let bestMatch = null;
  let bestScore = 0;

  for (const task of tasks) {
    const title = task.properties?.Name?.title?.[0]?.text?.content || '';
    const score = fuzzyScore(searchTitle, title);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = task;
    }
  }

  return bestScore >= 30 ? bestMatch : null;
}

/**
 * Update a task's status by searching for it by title (fuzzy)
 */
export async function updateTaskStatus(taskTitle, newStatus, env) {
  const statusMap = {
    '✅ Done': 'Completed',
    '❌ Dropped': 'Completed',
    'Done': 'Completed',
    'Dropped': 'Completed',
    'Closed': 'Completed',
    'closed': 'Completed',
    'done': 'Completed',
    'xong': 'Completed',
    'hoàn thành': 'Completed',
    'completed': 'Completed',
    'drop': 'Completed',
    'In progress': 'In progress',
    'in progress': 'In progress',
    'doing': 'In progress',
    'To do': 'To do',
    'todo': 'To do',
    'Pending': 'Pending / Wait for approved',
    'pending': 'Pending / Wait for approved',
  };
  const mappedStatus = statusMap[newStatus] || statusMap[newStatus.toLowerCase()] || 'Completed';

  const searchResponse = await fetch(
    `${NOTION_BASE}/databases/${env.NOTION_TASKS_DB_ID}/query`,
    {
      method: 'POST',
      headers: notionHeaders(env.NOTION_API_KEY),
      body: JSON.stringify({
        filter: {
          property: 'State',
          status: { does_not_equal: 'Completed' },
        },
        page_size: 100,
      }),
    }
  );

  if (!searchResponse.ok) {
    throw new Error(`Notion search error: ${await searchResponse.text()}`);
  }

  const searchData = await searchResponse.json();
  const match = findBestMatch(searchData.results, taskTitle);

  if (!match) {
    return null;
  }

  const updateResponse = await fetch(`${NOTION_BASE}/pages/${match.id}`, {
    method: 'PATCH',
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify({
      properties: {
        'State': { status: { name: mappedStatus } },
      },
    }),
  });

  if (!updateResponse.ok) {
    throw new Error(`Notion update error: ${await updateResponse.text()}`);
  }

  return parseNotionTask(await updateResponse.json());
}

/**
 * Edit task properties (deadline, urgency, estimate, project, etc.)
 */
export async function editTask(taskTitle, updates, env) {
  // Search for task
  const searchResponse = await fetch(
    `${NOTION_BASE}/databases/${env.NOTION_TASKS_DB_ID}/query`,
    {
      method: 'POST',
      headers: notionHeaders(env.NOTION_API_KEY),
      body: JSON.stringify({
        filter: {
          property: 'State',
          status: { does_not_equal: 'Completed' },
        },
        page_size: 100,
      }),
    }
  );

  if (!searchResponse.ok) {
    throw new Error(`Notion search error: ${await searchResponse.text()}`);
  }

  const searchData = await searchResponse.json();
  const match = findBestMatch(searchData.results, taskTitle);

  if (!match) {
    return null;
  }

  // Build update properties
  const properties = {};

  if (updates.deadline) {
    properties['Deadline'] = { date: { start: updates.deadline } };
    properties['Do Date'] = { date: { start: updates.deadline } };
  }
  if (updates.urgency) {
    properties['Urgency'] = { select: { name: updates.urgency } };
  }
  if (updates.estimate) {
    properties['Estimate'] = { number: parseInt(updates.estimate) || updates.estimate };
  }
  if (updates.project) {
    properties['Context'] = { select: { name: updates.project } };
  }
  if (updates.energy) {
    properties['Energy'] = { select: { name: updates.energy } };
  }
  if (updates.block) {
    properties['Block'] = { select: { name: updates.block } };
  }
  if (updates.source) {
    properties['Source'] = { select: { name: updates.source } };
  }
  if (updates.assigned_by || updates.stakeholders || updates.assigned) {
    const value = updates.assigned_by || updates.stakeholders || updates.assigned;
    properties['Assigned By'] = {
      rich_text: [{ text: { content: value } }],
    };
  }
  if (updates.notes || updates.context) {
    const value = updates.notes || updates.context;
    properties['Notes'] = {
      rich_text: [{ text: { content: value } }],
    };
  }
  if (updates.title || updates.name) {
    const value = updates.title || updates.name;
    properties['Name'] = {
      title: [{ text: { content: value } }],
    };
  }
  if (updates.resource || updates.link || updates.url) {
    const value = updates.resource || updates.link || updates.url;
    properties['Resource'] = { url: value };
  }
  if (updates.priority) {
    properties['Priority'] = { select: { name: updates.priority } };
  }
  if (updates.status) {
    const statusMap = {
      'To do': 'To do',
      'In progress': 'In progress',
      'Completed': 'Completed',
      'Pending': 'Pending / Wait for approved',
    };
    properties['State'] = { status: { name: statusMap[updates.status] || updates.status } };
  }

  if (Object.keys(properties).length === 0) {
    console.warn('editTask: no recognized fields in updates:', JSON.stringify(updates));
    // Still return the task so caller knows it was found, but log the issue
    return parseNotionTask(match);
  }

  const updateResponse = await fetch(`${NOTION_BASE}/pages/${match.id}`, {
    method: 'PATCH',
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify({ properties }),
  });

  if (!updateResponse.ok) {
    throw new Error(`Notion edit error: ${await updateResponse.text()}`);
  }

  return parseNotionTask(await updateResponse.json());
}

/**
 * Archive (soft-delete) a task by title — fuzzy search
 */
export async function archiveTask(taskTitle, env) {
  // Search all non-archived tasks
  const searchResponse = await fetch(
    `${NOTION_BASE}/databases/${env.NOTION_TASKS_DB_ID}/query`,
    {
      method: 'POST',
      headers: notionHeaders(env.NOTION_API_KEY),
      body: JSON.stringify({ page_size: 100 }),
    }
  );

  if (!searchResponse.ok) {
    throw new Error(`Notion search error: ${await searchResponse.text()}`);
  }

  const searchData = await searchResponse.json();
  const match = findBestMatch(searchData.results, taskTitle);

  if (!match) return null;

  const title = match.properties?.Name?.title?.[0]?.text?.content || 'Untitled';

  // Archive the page
  const archiveResponse = await fetch(`${NOTION_BASE}/pages/${match.id}`, {
    method: 'PATCH',
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify({ archived: true }),
  });

  if (!archiveResponse.ok) {
    throw new Error(`Notion archive error: ${await archiveResponse.text()}`);
  }

  return { id: match.id, title };
}

/**
 * Bulk archive tasks — archive all tasks matching a filter
 * Returns array of archived task titles
 */
export async function bulkArchiveTasks(filter, env) {
  const searchResponse = await fetch(
    `${NOTION_BASE}/databases/${env.NOTION_TASKS_DB_ID}/query`,
    {
      method: 'POST',
      headers: notionHeaders(env.NOTION_API_KEY),
      body: JSON.stringify({ filter, page_size: 100 }),
    }
  );

  if (!searchResponse.ok) {
    throw new Error(`Notion search error: ${await searchResponse.text()}`);
  }

  const searchData = await searchResponse.json();
  const archived = [];

  for (const page of searchData.results) {
    const title = page.properties?.Name?.title?.[0]?.text?.content || 'Untitled';
    await fetch(`${NOTION_BASE}/pages/${page.id}`, {
      method: 'PATCH',
      headers: notionHeaders(env.NOTION_API_KEY),
      body: JSON.stringify({ archived: true }),
    });
    archived.push(title);
  }

  return archived;
}

/**
 * List all tasks (for cleanup review)
 */
export async function listAllTasks(env) {
  const response = await fetch(
    `${NOTION_BASE}/databases/${env.NOTION_TASKS_DB_ID}/query`,
    {
      method: 'POST',
      headers: notionHeaders(env.NOTION_API_KEY),
      body: JSON.stringify({
        sorts: [{ property: 'Name', direction: 'ascending' }],
        page_size: 100,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Notion list error: ${await response.text()}`);
  }

  const data = await response.json();
  return data.results.map(parseNotionTask);
}

/**
 * Parse a Notion page into a clean task object
 * Adapted for "Today" DB property names
 */
function parseNotionTask(page) {
  const p = page.properties;
  return {
    id: page.id,
    title: p?.Name?.title?.[0]?.text?.content || 'Untitled',
    project: p?.Context?.select?.name || '',
    urgency: p?.Urgency?.select?.name || '',
    energy: p?.Energy?.select?.name || '',
    priority: p?.Priority?.select?.name || '',
    status: p?.State?.status?.name || '',
    estimate: p?.Estimate?.number || 0,
    due_date: p?.Deadline?.date?.start || '',
    do_date: p?.['Do Date']?.date?.start || '',
    block: p?.Block?.select?.name || '',
    source: p?.Source?.select?.name || '',
    assigned_by: p?.['Assigned By']?.rich_text?.[0]?.text?.content || '',
    notes: p?.Notes?.rich_text?.[0]?.text?.content || '',
    resource: p?.Resource?.url || '',
  };
}

/**
 * Backfill: copy Deadline → Do Date for tasks that have Deadline but no Do Date
 */
export async function backfillDoDate(env) {
  // Query all tasks with Deadline set but Do Date empty
  const response = await fetch(
    `${NOTION_BASE}/databases/${env.NOTION_TASKS_DB_ID}/query`,
    {
      method: 'POST',
      headers: notionHeaders(env.NOTION_API_KEY),
      body: JSON.stringify({
        filter: {
          and: [
            { property: 'Deadline', date: { is_not_empty: true } },
            { property: 'Do Date', date: { is_empty: true } },
          ],
        },
        page_size: 100,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Notion backfill query error: ${await response.text()}`);
  }

  const data = await response.json();
  const tasks = data.results;
  let updated = 0;

  for (const task of tasks) {
    const deadline = task.properties?.Deadline?.date?.start;
    if (!deadline) continue;

    await fetch(`${NOTION_BASE}/pages/${task.id}`, {
      method: 'PATCH',
      headers: notionHeaders(env.NOTION_API_KEY),
      body: JSON.stringify({
        properties: {
          'Do Date': { date: { start: deadline } },
        },
      }),
    });
    updated++;
  }

  return { total: tasks.length, updated };
}
