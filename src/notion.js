// Notion API client — adapted for existing "Today" DB schema
//
// Property mapping (DB "Today" → War Room concept):
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

  // Date: deadline
  if (taskData.due_date) {
    properties['Deadline'] = { date: { start: taskData.due_date } };
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
 * @param {string} queryType - "today" | "overdue" | "all_active" | "weekly_report" | "backlog"
 */
export async function queryTasks(queryType, env) {
  let filter;
  const today = new Date().toISOString().split('T')[0];

  switch (queryType) {
    case 'today':
      // Active tasks: To do + In progress
      filter = {
        or: [
          { property: 'State', status: { equals: 'To do' } },
          { property: 'State', status: { equals: 'In progress' } },
          { property: 'State', status: { equals: 'Pending / Wait for approved' } },
        ],
      };
      break;

    case 'overdue':
      // Tasks with deadline before today and NOT completed
      filter = {
        and: [
          { property: 'Deadline', date: { before: today } },
          { property: 'State', status: { does_not_equal: 'Completed' } },
        ],
      };
      break;

    case 'all_active':
      // All tasks that are not Completed
      filter = {
        property: 'State',
        status: { does_not_equal: 'Completed' },
      };
      break;

    case 'weekly_report':
      // Completed tasks
      filter = {
        property: 'State',
        status: { equals: 'Completed' },
      };
      break;

    case 'backlog':
      // Backlog: Urgency = ⚪ Someday AND NOT completed AND no Deadline
      filter = {
        and: [
          { property: 'Urgency', select: { equals: '⚪ Someday' } },
          { property: 'State', status: { does_not_equal: 'Completed' } },
          { property: 'Deadline', date: { is_empty: true } },
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
  };
  const mappedStatus = statusMap[newStatus] || newStatus;

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
  }
  if (updates.urgency) {
    properties['Urgency'] = { select: { name: updates.urgency } };
  }
  if (updates.estimate) {
    properties['Estimate'] = { number: updates.estimate };
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

  if (Object.keys(properties).length === 0) {
    return parseNotionTask(match); // Nothing to update
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
