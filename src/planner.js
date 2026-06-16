// Planner Engine v7.0 — pure deterministic day scheduler (no AI)
// Sections 1 + 2 of PLAN_PLANNER.md.
//
// Input: tasks (caller queries Notion) + day config.
// Output: { timeline, selected, parked, pushed, overflow }
//
// Hard rules (RAILs — do not break):
//   1. Must-include guard: 🔴 Fire OR deadline <= today MUST be in selected.
//   2. If must-include alone > capacity → no auto-park must-do; return overflow.
//   3. Never auto-park Fire / deadline-<=today. Only Wait/Someday + no near deadline.
//   4. Every park/push decision lands in parked/pushed for transparent reporting
//      and 1-tap undo (resume X / edit X).

const WORK_HOURS = {
  office:  { start: 10, end: 17 },
  wfh:     { start: 9,  end: 17 },
  weekend: { start: 10, end: 16 },
};

const LUNCH = { start: 12, end: 13 };
const BUFFER_MIN = 10;

const CAPACITY = { office: 330, wfh: 420, weekend: 120 };

function urgencyWeight(u) {
  if (u === '🔴 Fire') return 100;
  if (u === '🟡 Important') return 50;
  if (u === '🟢 Wait') return 20;
  return 5;
}

function daysBetween(aISO, bISO) {
  if (!aISO || !bISO) return null;
  const a = new Date(aISO + 'T00:00:00Z').getTime();
  const b = new Date(bISO + 'T00:00:00Z').getTime();
  return Math.round((a - b) / 86400000);
}

function deadlineBonus(deadline, today) {
  if (!deadline) return 0;
  const d = daysBetween(deadline, today);
  if (d === null) return 0;
  if (d < 0) return 200;
  if (d === 0) return 150;
  if (d <= 2) return 80;
  if (d <= 7) return 30;
  return 0;
}

function isMustInclude(task, today) {
  if (task.urgency === '🔴 Fire') return true;
  if (task.due_date && daysBetween(task.due_date, today) <= 0) return true;
  return false;
}

function isUrgentEnoughToKeep(task, today) {
  if (task.urgency === '🔴 Fire') return true;
  if (task.urgency === '🟡 Important') {
    if (task.due_date && daysBetween(task.due_date, today) <= 2) return true;
  }
  return false;
}

function isParkable(task, today) {
  if (isMustInclude(task, today)) return false;
  if (task.urgency === '🟢 Wait' || task.urgency === '⚪ Someday') {
    if (!task.due_date) return true;
    if (daysBetween(task.due_date, today) > 2) return true;
  }
  return false;
}

function suggestEstimate(task) {
  if (task.urgency === '🔴 Fire' || task.urgency === '🟡 Important') return 45;
  return 30;
}

// Pull HH:MM from a Notion Scheduled value like "2026-06-17T10:00:00+07:00".
function parseScheduledHM(scheduled) {
  if (!scheduled || !scheduled.includes('T')) return null;
  const time = scheduled.split('T')[1] || '';
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return { hour: parseInt(m[1], 10), min: parseInt(m[2], 10) };
}

function hmToMinutes(hm) { return hm.hour * 60 + hm.min; }
function minutesToHm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return { hour: h, min: m };
}
function fmtHm(hm) {
  return `${String(hm.hour).padStart(2, '0')}:${String(hm.min).padStart(2, '0')}`;
}
function addMinutes(hm, delta) {
  return minutesToHm(hmToMinutes(hm) + delta);
}

function getDayType(now, override) {
  if (override) return override;
  const day = now.getDay();
  if (day === 0 || day === 6) return 'weekend';
  if (day === 5) return 'wfh';
  return 'office';
}

function getTodayStr(now) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getNextWorkday(today, dayType) {
  // For now just tomorrow's date — engine only does single-day plan.
  const t = new Date(today + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isMorningTask(task) {
  if (task.urgency === '🔴 Fire') return true;
  if (task.urgency === '🟡 Important' && (task.estimate || 0) >= 45) return true;
  return false;
}

/**
 * Build a deterministic day plan.
 * @param {Array} tasks — list of task objects (already parsed via parseNotionTask).
 *   Each task may have: id, title, urgency, project, status, estimate, due_date,
 *   do_date, scheduled, block, source.
 * @param {object} opts
 *   - dayType: 'office' | 'wfh' | 'weekend' (auto-detected from `now` if omitted)
 *   - capacity: override max focus minutes (defaults from dayType)
 *   - workHours: { start, end } override
 *   - lunch: { start, end } override
 *   - bufferMin: number (default 10)
 *   - now: Date (defaults to current VN time)
 *   - startFromNow: boolean — for `xếp lại` (re-plan), skip past anchors
 *   - fromTime: { hour, min } — when startFromNow, when to start placing
 * @returns { timeline, selected, parked, pushed, overflow, meta }
 */
export function buildDayPlan(tasks, opts = {}) {
  const now = opts.now || new Date(Date.now() + 7 * 3600000);
  const dayType = getDayType(now, opts.dayType);
  const wh = opts.workHours || WORK_HOURS[dayType];
  const lunch = opts.lunch || LUNCH;
  const bufferMin = opts.bufferMin ?? BUFFER_MIN;
  const cap = opts.capacity ?? CAPACITY[dayType];
  const today = getTodayStr(now);

  // ─── 2.1 Split anchors / floating / skip
  const anchors = [];
  const floating = [];
  const skipped = [];

  const startMin = opts.startFromNow && opts.fromTime
    ? hmToMinutes(opts.fromTime)
    : hmToMinutes({ hour: wh.start, min: 0 });

  for (const t of tasks) {
    if (!t || !t.id) continue;
    if (t.status === 'Completed' || t.status === 'Pending / Wait for approved') {
      skipped.push(t);
      continue;
    }
    if (t.project === 'MATERIALS') {
      skipped.push(t);
      continue;
    }
    const hm = parseScheduledHM(t.scheduled);
    if (hm) {
      const m = hmToMinutes(hm);
      // For re-plan, drop anchors already past.
      if (opts.startFromNow && m < startMin - bufferMin) {
        skipped.push(t);
        continue;
      }
      anchors.push({ task: t, startMin: m, endMin: m + Math.max(t.estimate || 30, 15) });
    } else {
      floating.push(t);
    }
  }

  // ─── 2.2 Fill estimate for floating
  for (const t of floating) {
    if (!t.estimate || t.estimate <= 0) {
      t.estimate = suggestEstimate(t);
      t.estimate_suggested = true;
    }
  }

  // ─── 2.3 Score floating
  const deferMap = opts.deferMap || new Map();
  const scored = floating.map(t => {
    const score = urgencyWeight(t.urgency)
      + deadlineBonus(t.due_date, today)
      + (deferMap.get(t.id) || 0) * 10;
    return { task: t, score };
  });
  scored.sort((a, b) => b.score - a.score);

  // ─── 2.4 Compute available minutes
  // Window minutes minus lunch minus anchors that fall inside.
  const windowMin = (wh.end - wh.start) * 60;
  const lunchStart = lunch.start * 60;
  const lunchEnd = lunch.end * 60;

  let anchorTotal = 0;
  for (const a of anchors) {
    const dur = a.endMin - a.startMin;
    anchorTotal += dur + bufferMin;
  }
  // Subtract lunch IF it falls inside the work window.
  let lunchCost = 0;
  if (lunchStart >= wh.start * 60 && lunchEnd <= wh.end * 60) {
    lunchCost = (lunchEnd - lunchStart);
  }

  // For re-plan, available starts from `now`, not wh.start.
  let available;
  if (opts.startFromNow && opts.fromTime) {
    const remainingWindow = Math.max(0, (wh.end * 60) - startMin);
    available = remainingWindow - anchorTotal - (lunchStart < startMin ? 0 : lunchCost);
  } else {
    available = windowMin - anchorTotal - lunchCost;
  }
  available = Math.max(0, available);
  const focusCap = Math.min(available, cap);

  // ─── 2.5 Select-to-fit
  const selected = [];
  let used = 0;
  const overflow = [];
  const parked = [];
  const pushed = [];

  // Pass 1: must-include (Fire / deadline<=today)
  const mustPass = [];
  const restPass = [];
  for (const s of scored) {
    if (isMustInclude(s.task, today)) mustPass.push(s);
    else restPass.push(s);
  }

  for (const s of mustPass) {
    const dur = s.task.estimate + bufferMin;
    if (used + dur <= focusCap + 0.5) {
      selected.push({ ...s, kind: 'must' });
      used += dur;
    } else {
      overflow.push({ ...s, reason: 'must_overflow' });
    }
  }

  // If must-include alone overflows the cap, return early — let Matt decide.
  if (overflow.length > 0) {
    return {
      timeline: layoutTimeline(selected, anchors, opts, wh, lunch),
      selected: selected.map(s => s.task),
      parked: [],
      pushed: [],
      overflow: overflow.map(s => s.task),
      meta: { dayType, capacity: cap, focusCap, used, available, today, mustOverflow: true },
    };
  }

  // Pass 2: fill with rest by score
  for (const s of restPass) {
    const dur = s.task.estimate + bufferMin;
    if (used + dur <= focusCap + 0.5) {
      selected.push({ ...s, kind: 'fit' });
      used += dur;
      continue;
    }
    // Could not fit — park or push
    if (isParkable(s.task, today)) {
      parked.push({ ...s.task, reason: 'no_room' });
    } else {
      pushed.push({ ...s.task, reason: 'no_room', to_date: getNextWorkday(today, dayType) });
    }
  }

  // ─── 2.6 Order: morning heavy, afternoon light, power block to end
  const orderedSelected = orderForTimeline(selected);

  // ─── 2.7 Output
  return {
    timeline: layoutTimeline(orderedSelected, anchors, opts, wh, lunch),
    selected: orderedSelected.map(s => s.task),
    parked,
    pushed,
    overflow: [],
    meta: { dayType, capacity: cap, focusCap, used, available, today },
  };
}

function orderForTimeline(selected) {
  // Separate by morning-preferred vs afternoon-preferred, keep relative score order.
  const morning = selected.filter(s => isMorningTask(s.task));
  const afternoon = selected.filter(s => !isMorningTask(s.task));
  return [...morning, ...afternoon];
}

function layoutTimeline(orderedSelected, anchors, opts, wh, lunch) {
  // Build a single timeline: anchors at fixed times, floating fills gaps.
  const items = [];
  const startMin = opts.startFromNow && opts.fromTime
    ? hmToMinutes(opts.fromTime)
    : wh.start * 60;
  const endMin = wh.end * 60;
  const bufferMin = opts.bufferMin ?? BUFFER_MIN;
  const lunchStart = lunch.start * 60;
  const lunchEnd = lunch.end * 60;

  // Add anchors first
  for (const a of anchors) {
    items.push({
      time: fmtHm(minutesToHm(a.startMin)),
      kind: 'anchor',
      task: a.task,
    });
  }

  // Fill gaps with selected (morning first, then afternoon)
  let cursor = startMin;
  // If cursor is before lunch, respect it; if past lunch, skip to after lunch.
  // We walk forward through the window.
  let idx = 0;
  while (cursor < endMin && idx < orderedSelected.length) {
    // Skip past anchors already in `items` and lunch.
    const hm = minutesToHm(cursor);

    // If cursor is inside an anchor window, jump past it.
    const insideAnchor = anchors.find(a => cursor >= a.startMin && cursor < a.endMin);
    if (insideAnchor) {
      cursor = insideAnchor.endMin + bufferMin;
      continue;
    }

    // If inside lunch, jump past lunch.
    if (cursor >= lunchStart && cursor < lunchEnd) {
      cursor = lunchEnd;
      continue;
    }

    const s = orderedSelected[idx];
    const dur = s.task.estimate || 30;
    items.push({
      time: fmtHm(hm),
      kind: 'planned',
      task: s.task,
    });
    cursor += dur + bufferMin;
    idx++;
  }

  items.sort((a, b) => a.time.localeCompare(b.time));
  return items;
}

// Exposed config getters for responses.js and reminders.js.
export function getWorkHours() { return WORK_HOURS; }
export function getLunch() { return LUNCH; }
export function getBufferMin() { return BUFFER_MIN; }
export function getCapacity() { return CAPACITY; }
