// Notion API client — adapted for existing "Today" DB schema
//
// Property mapping (DB "Today" → Stratt concept):
//   Name (title)       → Task title
//   Context (select)   → Project (GMA, HOSEL, SALES, etc.)
//   Urgency (select)   → Urgency (🔴 Fire, 🟡 Important, etc.)
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

function formatScheduledTime(t) {
  if (!t) return null;
  // If it has a date-time format (contains T) but no offset (+ or - or Z at the end)
  if (t.includes('T') && !/[+-]\d{2}:\d{2}$|Z$/i.test(t)) {
    if (t.split('T')[1].split(':').length === 2) {
      return `${t}:00+07:00`;
    }
    return `${t}+07:00`;
  }
  return t;
}

export async function invalidateCache(env, types = null) {
  if (!env.CHAT_MEMORY) return;
  try {
    const newToken = Date.now().toString();
    // types = null → invalidate ALL query types (safe default).
    // types = ['today',...] → invalidate only those (scoped).
    const targets = types || ALL_QUERY_TYPES;
    await Promise.all(
      targets.map(t => env.CHAT_MEMORY.put(`cache:token:${t}`, newToken, { expirationTtl: 86400 }))
    );
  } catch (err) {
    console.error('Failed to invalidate cache:', err);
  }
}

// All cacheable query types
const ALL_QUERY_TYPES = [
  'today', 'upcoming', 'overdue', 'all_active', 'board_all',
  'board_done_today', 'weekly_report', 'backlog', 'materials', 'calendar_week', 'parked',
];

// Which query types each write op affects (scoped invalidation)
const INVALIDATION_SCOPES = {
  create: ['today', 'upcoming', 'overdue', 'all_active', 'board_all', 'calendar_week', 'backlog', 'materials', 'parked'],
  status: ['today', 'upcoming', 'overdue', 'all_active', 'board_all', 'board_done_today', 'weekly_report', 'calendar_week', 'parked'],
  edit: ['today', 'upcoming', 'overdue', 'all_active', 'board_all', 'calendar_week', 'backlog', 'materials', 'parked'],
  archive: ['today', 'upcoming', 'overdue', 'all_active', 'board_all', 'backlog', 'materials', 'calendar_week', 'parked'],
  schedule: ['board_all', 'calendar_week'],
};

function parseTimeStr(tStr) {
  let match = tStr.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    return { hour: parseInt(match[1]), min: parseInt(match[2]) };
  }
  match = tStr.match(/(\d{1,2})\s*(?:h|:?\s*(?:00|30)?\s*)?\s*(?:am|pm|sáng|chiều|tối)/i)
    || tStr.match(/(\d{1,2})\s*(?:am|pm)/i);
  if (match) {
    let hour = parseInt(match[1]);
    const min = 0;
    if (/pm|chiều|tối/i.test(tStr) && hour < 12) hour += 12;
    if (/am|sáng/i.test(tStr) && hour === 12) hour = 0;
    return { hour, min };
  }
  return null;
}

function normalizeScheduledTime(tStr, defaultDate) {
  if (!tStr) return null;
  if (tStr.includes('T')) return tStr;

  const parsed = parseTimeStr(tStr);
  if (parsed) {
    const datePart = defaultDate ? defaultDate.substring(0, 10) : new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0];
    const hour = String(parsed.hour).padStart(2, '0');
    const min = String(parsed.min).padStart(2, '0');
    return `${datePart}T${hour}:${min}`;
  }
  return tStr;
}


/**
 * Create a new task in the existing "Today" Notion DB
 */
export async function createTask(taskData, env) {
  // Auto-derive Block from scheduled_time if block is not set
  if (taskData.scheduled_time && !taskData.block) {
    const normalized = normalizeScheduledTime(taskData.scheduled_time, taskData.due_date);
    if (normalized && normalized.includes('T')) {
      const timePart = normalized.split('T')[1];
      const hour = parseInt(timePart.split(':')[0]);
      if (!isNaN(hour)) {
        if (hour < 12) {
          taskData.block = '☀️ AM';
        } else if (hour < 18) {
          taskData.block = '🌤️ PM';
        }
      }
    }
  }

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
  if (taskData.block) {
    properties['Block'] = { select: { name: taskData.block } };
  }
  if (taskData.source) {
    properties['Source'] = { select: { name: taskData.source } };
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
  } else {
    // No deadline → set Do Date to today so task appears on board
    const now = new Date(Date.now() + 7 * 3600000); // VN time
    const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;
    properties['Do Date'] = { date: { start: today } };
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

  // Scheduled datetime (for calendar grid)
  if (taskData.scheduled_time) {
    const normalized = normalizeScheduledTime(taskData.scheduled_time, taskData.due_date);
    properties['Scheduled'] = { date: { start: formatScheduledTime(normalized) } };
  }

  const response = await fetchWithRetry(`${NOTION_BASE}/pages`, {
    method: 'POST',
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify({
      parent: { database_id: env.NOTION_TASKS_DB_ID },
      properties,
    }),
  });

  const result = await response.json();
  await invalidateCache(env, INVALIDATION_SCOPES.create);
  return result;
}

// ─── Retry with backoff (Notion rate limit: 3 req/s) ────
async function fetchWithRetry(url, options, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    const res = await fetch(url, options);
    if (res.ok) return res;
    if (res.status === 429 && i < maxRetries) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    const err = await res.text();
    throw new Error(`Notion API ${res.status}: ${err}`);
  }
}

/**
 * Query tasks from Notion with filters + pagination
 * @param {string} queryType - "today" | "upcoming" | "overdue" | "all_active" | "weekly_report" | "backlog" | "materials" | "board_all" | "board_done_today" | "calendar_week"
 * @param {object} env
 * @param {object} options - Extra params (e.g. { weekStart, weekEnd } for calendar_week)
 */
export async function queryTasks(queryType, env, options = {}) {
  const forceRefresh = options.refresh === true || options.refresh === 'true';
  let token = '0';
  let cacheKey = '';
  if (env.CHAT_MEMORY && !forceRefresh) {
    try {
      token = (await env.CHAT_MEMORY.get(`cache:token:${queryType}`)) || '0';
      cacheKey = `cache:query:${queryType}:${JSON.stringify(options)}:${token}`;
      const cached = await env.CHAT_MEMORY.get(cacheKey, 'json');
      if (cached) {
        console.log(`Cache HIT for ${queryType} with token ${token}`);
        return cached;
      }
      console.log(`Cache MISS for ${queryType} with token ${token}`);
    } catch (err) {
      console.error('Cache read error:', err);
    }
  }

  let filter;
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  switch (queryType) {
    case 'today':
      filter = {
        and: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          { property: 'State', status: { does_not_equal: 'Pending / Wait for approved' } },
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
      filter = {
        and: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          { property: 'State', status: { does_not_equal: 'Pending / Wait for approved' } },
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
      filter = {
        and: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          { property: 'State', status: { does_not_equal: 'Pending / Wait for approved' } },
          { property: 'Urgency', select: { does_not_equal: '⚪ Someday' } },
        ],
      };
      break;

    case 'board_all':
      // For kanban board: all non-completed tasks INCLUDING Someday (but not MATERIALS)
      filter = {
        and: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          { property: 'Context', select: { does_not_equal: 'MATERIALS' } },
        ],
      };
      break;

    case 'board_done_today': {
      // For kanban Done column: completed today
      filter = {
        and: [
          { property: 'State', status: { equals: 'Completed' } },
          { property: 'Deadline', date: { on_or_after: today } },
        ],
      };
      break;
    }

    case 'weekly_report': {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      filter = {
        and: [
          { property: 'State', status: { equals: 'Completed' } },
          { property: 'Deadline', date: { on_or_after: weekAgo } },
        ],
      };
      break;
    }

    case 'backlog':
      filter = {
        and: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          { property: 'Urgency', select: { equals: '⚪ Someday' } },
        ],
      };
      break;

    case 'materials':
      // Materials: Context=MATERIALS, not completed
      filter = {
        and: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          { property: 'Context', select: { equals: 'MATERIALS' } },
        ],
      };
      break;

    case 'calendar_week': {
      // Calendar: fetch active tasks OR completed tasks that are scheduled
      filter = {
        or: [
          { property: 'State', status: { does_not_equal: 'Completed' } },
          { property: 'Scheduled', date: { is_not_empty: true } }
        ]
      };
      break;
    }

    case 'parked':
      filter = {
        and: [
          { property: 'State', status: { equals: 'Pending / Wait for approved' } }
        ]
      };
      break;

    default:
      filter = undefined;
  }

  // Paginated query
  let allResults = [];
  let cursor = undefined;
  do {
    const body = {
      filter,
      sorts: [{ property: 'Deadline', direction: 'ascending' }],
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const response = await fetchWithRetry(
      `${NOTION_BASE}/databases/${env.NOTION_TASKS_DB_ID}/query`,
      {
        method: 'POST',
        headers: notionHeaders(env.NOTION_API_KEY),
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();
    allResults.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  const result = allResults.map(parseNotionTask);

  if (env.CHAT_MEMORY) {
    try {
      if (forceRefresh) {
        token = Date.now().toString();
        await env.CHAT_MEMORY.put(`cache:token:${queryType}`, token, { expirationTtl: 86400 });
      }
      const finalCacheKey = `cache:query:${queryType}:${JSON.stringify(options)}:${token}`;
      await env.CHAT_MEMORY.put(finalCacheKey, JSON.stringify(result), { expirationTtl: 300 }); // 5 minutes TTL
    } catch (err) {
      console.error('Cache write error:', err);
    }
  }

  return result;
}

/**
 * Update task status by Notion page ID (for kanban board — no fuzzy search needed)
 */
export async function updateTaskStatusById(pageId, newStatus, env) {
  const statusMap = {
    'To do': 'To do',
    'In progress': 'In progress',
    'Completed': 'Completed',
    'Pending': 'Pending / Wait for approved',
  };
  const mapped = statusMap[newStatus] || newStatus;

  const response = await fetchWithRetry(`${NOTION_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify({
      properties: { 'State': { status: { name: mapped } } },
    }),
  });

  const result = parseNotionTask(await response.json());
  await invalidateCache(env, INVALIDATION_SCOPES.status);
  return result;
}

/**
 * Update a task's scheduled datetime
 */
export async function updateTaskSchedule(pageId, scheduledISO, env) {
  const props = scheduledISO
    ? { 'Scheduled': { date: { start: formatScheduledTime(scheduledISO) } } }
    : { 'Scheduled': { date: null } };

  const response = await fetchWithRetry(`${NOTION_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify({ properties: props }),
  });

  const result = parseNotionTask(await response.json());
  await invalidateCache(env, INVALIDATION_SCOPES.schedule);
  return result;
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
  const { match } = findBestMatchWithScore(tasks, searchTitle);
  return match;
}

/**
 * Find best match and return both the match and its score
 */
function findBestMatchWithScore(tasks, searchTitle) {
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

  return { match: bestScore >= 30 ? bestMatch : null, score: bestScore };
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

  const updateResponse = await fetchWithRetry(`${NOTION_BASE}/pages/${match.id}`, {
    method: 'PATCH',
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify({
      properties: {
        'State': { status: { name: mappedStatus } },
      },
    }),
  });

  const result = parseNotionTask(await updateResponse.json());
  await invalidateCache(env, INVALIDATION_SCOPES.status);
  return result;
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
  if (updates.scheduled_time) {
    const existingDate = match.properties?.Deadline?.date?.start || match.properties?.['Do Date']?.date?.start || new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0];
    const defaultDate = updates.deadline || existingDate;
    const normalized = normalizeScheduledTime(updates.scheduled_time, defaultDate);
    properties['Scheduled'] = { date: { start: formatScheduledTime(normalized) } };
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

  const updateResponse = await fetchWithRetry(`${NOTION_BASE}/pages/${match.id}`, {
    method: 'PATCH',
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify({ properties }),
  });

  const result = parseNotionTask(await updateResponse.json());
  await invalidateCache(env, INVALIDATION_SCOPES.edit);
  return result;
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
  const archiveResponse = await fetchWithRetry(`${NOTION_BASE}/pages/${match.id}`, {
    method: 'PATCH',
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify({ archived: true }),
  });

  const result = { id: match.id, title };
  await invalidateCache(env, INVALIDATION_SCOPES.archive);
  return result;
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

  if (archived.length > 0) {
    await invalidateCache(env);
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
    status: p?.State?.status?.name || '',
    estimate: p?.Estimate?.number || 0,
    due_date: p?.Deadline?.date?.start || '',
    do_date: p?.['Do Date']?.date?.start || '',
    scheduled: p?.Scheduled?.date?.start || '',
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

  if (updated > 0) {
    await invalidateCache(env);
  }
  return { total: tasks.length, updated };
}

/**
 * Archive a task by Notion page ID directly (no fuzzy search)
 */
export async function archiveTaskById(pageId, env) {
  const response = await fetchWithRetry(`${NOTION_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(env.NOTION_API_KEY),
    body: JSON.stringify({ archived: true }),
  });

  const result = parseNotionTask(await response.json());
  await invalidateCache(env, INVALIDATION_SCOPES.archive);
  return result;
}

/**
 * Retrieve a task by Notion page ID directly (no fuzzy search)
 */
export async function getTaskById(pageId, env) {
  const response = await fetchWithRetry(`${NOTION_BASE}/pages/${pageId}`, {
    method: 'GET',
    headers: notionHeaders(env.NOTION_API_KEY),
  });
  return parseNotionTask(await response.json());
}

/**
 * Flags cells in specific Notion database columns with sentinel values ("DELETE ME") for manual deletion.
 */
export async function markColumnsForDeletion(columns, env) {
  // 1. Retrieve DB schema to find property types
  const dbRes = await fetch(`${NOTION_BASE}/databases/${env.NOTION_TASKS_DB_ID}`, {
    method: 'GET',
    headers: notionHeaders(env.NOTION_API_KEY),
  });
  if (!dbRes.ok) {
    throw new Error(`Failed to retrieve database schema: ${await dbRes.text()}`);
  }
  const dbData = await dbRes.json();
  const properties = dbData.properties || {};

  const colConfigs = {};
  const summary = {};

  for (const col of columns) {
    const prop = properties[col];
    if (!prop) {
      summary[col] = { status: 'skipped', note: 'Column not found in Notion schema' };
      continue;
    }
    const type = prop.type;
    if (type === 'relation' || type === 'people' || type === 'files') {
      summary[col] = { type, status: 'skipped', note: 'Relation/People/Files column. Must be deleted directly in Notion UI.' };
      continue;
    }
    if (type === 'status') {
      summary[col] = { type, status: 'skipped', note: 'Status column. Cannot auto-create status options via API. Please delete directly in Notion UI.' };
      continue;
    }

    let payloadValue;
    if (type === 'rich_text') {
      payloadValue = { rich_text: [{ text: { content: 'DELETE ME' } }] };
    } else if (type === 'title') {
      payloadValue = { title: [{ text: { content: 'DELETE ME' } }] };
    } else if (type === 'select') {
      payloadValue = { select: { name: 'DELETE ME' } };
    } else if (type === 'multi_select') {
      payloadValue = { multi_select: [{ name: 'DELETE ME' }] };
    } else if (type === 'number') {
      payloadValue = { number: 99999 };
    } else if (type === 'date') {
      payloadValue = { date: { start: '1999-01-01' } };
    } else if (type === 'checkbox') {
      payloadValue = { checkbox: true };
    } else {
      summary[col] = { type, status: 'skipped', note: `Unsupported column type: ${type}. Please delete directly in Notion UI.` };
      continue;
    }

    colConfigs[col] = payloadValue;
    summary[col] = { type, status: 'marked', updated: 0 };
  }

  // If no columns can be marked, return summary early
  const activeCols = Object.keys(colConfigs);
  if (activeCols.length === 0) {
    return summary;
  }

  // 2. Query all pages and patch them
  let cursor = undefined;
  let hasMore = true;
  do {
    const queryBody = { page_size: 100 };
    if (cursor) queryBody.start_cursor = cursor;

    const res = await fetch(`${NOTION_BASE}/databases/${env.NOTION_TASKS_DB_ID}/query`, {
      method: 'POST',
      headers: notionHeaders(env.NOTION_API_KEY),
      body: JSON.stringify(queryBody),
    });
    if (!res.ok) {
      throw new Error(`Failed to query database pages: ${await res.text()}`);
    }

    const data = await res.json();
    const pages = data.results || [];
    cursor = data.next_cursor;
    hasMore = data.has_more;

    for (const page of pages) {
      // Build PATCH properties
      const patchProps = {};
      for (const col of activeCols) {
        patchProps[col] = colConfigs[col];
      }

      const patchRes = await fetch(`${NOTION_BASE}/pages/${page.id}`, {
        method: 'PATCH',
        headers: notionHeaders(env.NOTION_API_KEY),
        body: JSON.stringify({ properties: patchProps }),
      });

      if (patchRes.ok) {
        for (const col of activeCols) {
          summary[col].updated++;
        }
      } else {
        console.error(`Failed to patch page ${page.id}:`, await patchRes.text());
      }
    }
  } while (hasMore);

  // Invalidate cache since we modified properties of tasks
  await invalidateCache(env);

  return summary;
}



