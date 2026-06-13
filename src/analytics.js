// Analytics v1.0 — lightweight usage tracking via KV
// Design principles:
//   - Fire-and-forget: never throws, never blocks main flow
//   - One KV write per request (caller accumulates a delta, flushes once)
//   - Daily buckets keyed by VN date, 90-day TTL
//   - Read endpoint aggregates last N days

const ANALYTICS_PREFIX = 'analytics:';
const RETENTION_DAYS = 90;
const TTL_SECONDS = RETENTION_DAYS * 86400;

/** VN date string YYYY-MM-DD */
export function getDateKey(offsetDays = 0) {
  const d = new Date(Date.now() + 7 * 3600000 + offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Empty daily record shape */
function emptyDay() {
  return {
    interactions: 0,          // total chat messages processed
    captures: {},             // by source: { chat_web, chat_telegram, board, direct_parse }
    completions: {},          // by method: { done_num, done_name, natural, board }
    intents: {},              // intent distribution: { CAPTURE, TRIAGE, UPDATE, ... }
    sources: {},              // request source: { web, telegram }
    ai_calls: 0,              // MiniMax invocations
    ai_failures: 0,           // fallback triggered (AI didn't return usable JSON action)
    ai_latency_ms: 0,         // cumulative — divide by ai_calls for avg
    instant_commands: 0,      // handled by regex Phase 1 (AI calls saved)
    deletes: 0,
    edits: 0,
    defers: 0,                // auto-defer cron moved tasks to tomorrow
    errors: 0,                // exceptions caught
    hourly_capture: {},       // { "9": 3, "14": 2 } — captures by VN hour
    hourly_complete: {},      // { "10": 1 } — completions by VN hour
    is_weekend: 0,            // count of weekend interactions
    is_weekday: 0,            // count of weekday interactions
  };
}

/** Current VN hour as string key */
export function getHourKey() {
  const d = new Date(Date.now() + 7 * 3600000);
  return String(d.getUTCHours());
}

/** Is current VN day a weekend */
export function isWeekendVN() {
  const day = new Date(Date.now() + 7 * 3600000).getUTCDay();
  return day === 0 || day === 6;
}

/** Deep-merge a delta into a daily record (additive for numbers, nested counters) */
function mergeDelta(base, delta) {
  for (const [key, val] of Object.entries(delta)) {
    if (typeof val === 'number') {
      base[key] = (base[key] || 0) + val;
    } else if (val && typeof val === 'object') {
      if (!base[key] || typeof base[key] !== 'object') base[key] = {};
      for (const [k2, v2] of Object.entries(val)) {
        base[key][k2] = (base[key][k2] || 0) + v2;
      }
    }
  }
  return base;
}

/**
 * Record a delta into today's bucket. Single read-modify-write.
 * Never throws — analytics must not break the app.
 */
export async function recordDelta(env, delta) {
  if (!env.CHAT_MEMORY || !delta) return;
  try {
    const key = `${ANALYTICS_PREFIX}${getDateKey()}`;
    const existing = (await env.CHAT_MEMORY.get(key, 'json')) || emptyDay();
    const merged = mergeDelta(existing, delta);
    await env.CHAT_MEMORY.put(key, JSON.stringify(merged), { expirationTtl: TTL_SECONDS });
  } catch (err) {
    console.error('Analytics record error:', err);
  }
}

/**
 * Read aggregated summary for the last N days.
 * Returns { range, daily: [...], totals: {...}, derived: {...} }
 */
export async function getSummary(env, days = 7) {
  if (!env.CHAT_MEMORY) return null;
  const daily = [];
  const totals = emptyDay();

  for (let i = 0; i < days; i++) {
    const dateKey = getDateKey(-i);
    let rec;
    try {
      rec = await env.CHAT_MEMORY.get(`${ANALYTICS_PREFIX}${dateKey}`, 'json');
    } catch { rec = null; }
    if (rec) {
      daily.push({ date: dateKey, ...rec });
      mergeDelta(totals, rec);
    } else {
      daily.push({ date: dateKey, empty: true });
    }
  }

  daily.reverse(); // oldest → newest

  // Derived metrics
  const totalCaptures = sumObj(totals.captures);
  const totalCompletions = sumObj(totals.completions);
  const aiTotal = totals.ai_calls || 0;
  const derived = {
    avg_ai_latency_ms: aiTotal ? Math.round(totals.ai_latency_ms / aiTotal) : 0,
    ai_failure_rate: aiTotal ? +(totals.ai_failures / aiTotal * 100).toFixed(1) : 0,
    instant_ratio: (aiTotal + totals.instant_commands)
      ? +(totals.instant_commands / (aiTotal + totals.instant_commands) * 100).toFixed(1)
      : 0,
    completion_ratio: totalCaptures ? +(totalCompletions / totalCaptures * 100).toFixed(1) : 0,
    total_captures: totalCaptures,
    total_completions: totalCompletions,
  };

  return { range_days: days, daily, totals, derived };
}

function sumObj(obj) {
  if (!obj) return 0;
  return Object.values(obj).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
}

// ─── Per-task defer tracking (guilt-loop detection) ──────────
// Keyed by Notion page id. Counts how many times a task was auto-deferred.
const DEFER_PREFIX = 'defercount:';

export async function bumpDeferCount(env, taskId, taskTitle) {
  if (!env.CHAT_MEMORY || !taskId) return 0;
  try {
    const key = `${DEFER_PREFIX}${taskId}`;
    const existing = (await env.CHAT_MEMORY.get(key, 'json')) || { title: taskTitle, count: 0 };
    existing.count++;
    existing.title = taskTitle || existing.title;
    existing.last = getDateKey();
    // Keep 30 days — if a task isn't touched in 30d it's likely done/dropped
    await env.CHAT_MEMORY.put(key, JSON.stringify(existing), { expirationTtl: 30 * 86400 });
    return existing.count;
  } catch { return 0; }
}

export async function clearDeferCount(env, taskId) {
  if (!env.CHAT_MEMORY || !taskId) return;
  try { await env.CHAT_MEMORY.delete(`${DEFER_PREFIX}${taskId}`); } catch {}
}

/** List tasks deferred >= threshold times (guilt-loop candidates) */
export async function getChronicDefers(env, threshold = 3) {
  if (!env.CHAT_MEMORY) return [];
  try {
    const list = await env.CHAT_MEMORY.list({ prefix: DEFER_PREFIX });
    const out = [];
    for (const k of list.keys) {
      const rec = await env.CHAT_MEMORY.get(k.name, 'json');
      if (rec && rec.count >= threshold) {
        rec.id = k.name.substring(DEFER_PREFIX.length);
        out.push(rec);
      }
    }
    return out.sort((a, b) => b.count - a.count);
  } catch { return []; }
}

/**
 * Build a human-readable stats summary (for chat "stats" command + Telegram)
 */
export function buildStatsReport(summary) {
  if (!summary) return '📊 Chưa có dữ liệu analytics.';
  const { totals, derived, range_days } = summary;

  let r = `📊 Analytics — ${range_days} ngày qua\n\n`;
  r += `📝 Tạo: ${derived.total_captures} task\n`;
  r += `✅ Hoàn thành: ${derived.total_completions} (${derived.completion_ratio}% so với tạo)\n`;
  r += `🔄 Tương tác: ${totals.interactions}\n`;
  if (totals.defers) r += `⏭️ Auto-defer: ${totals.defers}\n`;

  r += `\n⚙️ Hệ thống:\n`;
  r += `• AI calls: ${totals.ai_calls} (avg ${derived.avg_ai_latency_ms}ms)\n`;
  r += `• Instant commands: ${totals.instant_commands} (${derived.instant_ratio}% né AI)\n`;
  r += `• AI fail rate: ${derived.ai_failure_rate}%\n`;
  if (totals.errors) r += `• ⚠️ Errors: ${totals.errors}\n`;

  // Top intents
  const topIntents = Object.entries(totals.intents || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topIntents.length) {
    r += `\n🎯 Intent hay dùng:\n`;
    topIntents.forEach(([k, v]) => { r += `• ${k}: ${v}\n`; });
  }

  // Capture sources
  const srcs = Object.entries(totals.captures || {}).sort((a, b) => b[1] - a[1]);
  if (srcs.length) {
    r += `\n📥 Nguồn tạo task:\n`;
    srcs.forEach(([k, v]) => { r += `• ${k}: ${v}\n`; });
  }

  // Hourly activity — find productive window
  const hourly = {};
  for (const [h, c] of Object.entries(totals.hourly_capture || {})) hourly[h] = (hourly[h] || 0) + c;
  for (const [h, c] of Object.entries(totals.hourly_complete || {})) hourly[h] = (hourly[h] || 0) + c;
  const topHours = Object.entries(hourly).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (topHours.length) {
    r += `\n⏰ Giờ active nhất:\n`;
    topHours.forEach(([h, c]) => { r += `• ${String(h).padStart(2, '0')}:00 — ${c} hoạt động\n`; });
  }

  // Weekday vs weekend
  if (totals.is_weekday || totals.is_weekend) {
    r += `\n📅 Weekday: ${totals.is_weekday || 0} · Weekend: ${totals.is_weekend || 0}\n`;
  }

  return r.trim();
}

/**
 * Append chronic-defer warning to a report (call separately — needs async KV scan)
 */
export function buildDeferReport(chronicDefers) {
  if (!chronicDefers || !chronicDefers.length) return '';
  let r = `\n\n🔁 Task né nhiều lần (guilt loop):\n`;
  chronicDefers.slice(0, 5).forEach(d => {
    r += `• "${d.title}" — defer ${d.count} lần\n`;
  });
  r += `💡 Cân nhắc drop hoặc chia nhỏ.`;
  return r;
}
