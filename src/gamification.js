// Gamification module — XP, Streaks, Achievements for ADHD motivation

const STATS_KEY_PREFIX = 'stats:';

const ACHIEVEMENTS = {
  first_blood: { name: '🩸 First Blood', condition: 'Complete 1 task', check: s => s.total_completed >= 1 },
  hat_trick: { name: '🎩 Hat Trick', condition: '3 tasks in 1 day', check: s => s.today_completed >= 3 },
  on_fire: { name: '🔥 On Fire', condition: '3-day streak', check: s => s.streak >= 3 },
  warrior: { name: '⚔️ Warrior', condition: '7-day streak', check: s => s.streak >= 7 },
  mountain: { name: '🏔️ Mountain', condition: '50 tasks total', check: s => s.total_completed >= 50 },
  centurion: { name: '💯 Centurion', condition: '100 tasks total', check: s => s.total_completed >= 100 },
  firefighter: { name: '🧑‍🚒 Firefighter', condition: '5 🔴 Fire tasks', check: s => s.fire_completed >= 5 },
  batch_master: { name: '🧠 Brain Dump', condition: 'Dump 3+ tasks at once', check: s => s.max_batch >= 3 },
};

const LEVELS = [
  { level: 1, xp: 0, title: 'Recruit' },
  { level: 2, xp: 50, title: 'Private' },
  { level: 3, xp: 150, title: 'Corporal' },
  { level: 4, xp: 300, title: 'Sergeant' },
  { level: 5, xp: 500, title: 'Lieutenant' },
  { level: 6, xp: 800, title: 'Captain' },
  { level: 7, xp: 1200, title: 'Major' },
  { level: 8, xp: 1800, title: 'Colonel' },
  { level: 9, xp: 2500, title: 'General' },
  { level: 10, xp: 3500, title: 'Commander' },
];

function getLevel(xp) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].xp) return LEVELS[i];
  }
  return LEVELS[0];
}

function getNextLevel(xp) {
  for (const l of LEVELS) {
    if (xp < l.xp) return l;
  }
  return null; // Max level
}

export async function getStats(chatId, env) {
  if (!env.CHAT_MEMORY) return defaultStats();
  try {
    const data = await env.CHAT_MEMORY.get(`${STATS_KEY_PREFIX}${chatId}`, 'json');
    return data || defaultStats();
  } catch { return defaultStats(); }
}

export async function saveStats(chatId, stats, env) {
  if (!env.CHAT_MEMORY) return;
  try {
    await env.CHAT_MEMORY.put(`${STATS_KEY_PREFIX}${chatId}`, JSON.stringify(stats));
  } catch {}
}

function defaultStats() {
  return {
    streak: 0,
    today_completed: 0,
    total_completed: 0,
    fire_completed: 0,
    max_batch: 0,
    last_active: '',
    xp: 0,
    achievements: [],
  };
}

/**
 * Record a task completion and return XP gained + new achievements
 */
export async function recordCompletion(chatId, env, isFire = false) {
  const stats = await getStats(chatId, env);
  const today = getTodayVN();

  // Update streak
  if (stats.last_active === today) {
    // Same day, increment
    stats.today_completed++;
  } else {
    const yesterday = getYesterdayVN();
    if (stats.last_active === yesterday) {
      stats.streak++;
    } else if (stats.last_active !== today) {
      stats.streak = 1; // Reset
    }
    stats.today_completed = 1;
  }
  stats.last_active = today;
  stats.total_completed++;
  if (isFire) stats.fire_completed++;

  // Calculate XP
  let xpGained = 10; // base
  if (isFire) xpGained += 15;
  if (stats.today_completed === 3) xpGained += 15; // hat trick
  if (stats.streak === 3) xpGained += 30;
  if (stats.streak === 7) xpGained += 100;

  stats.xp += xpGained;

  // Check new achievements
  const newAchievements = [];
  for (const [id, ach] of Object.entries(ACHIEVEMENTS)) {
    if (!stats.achievements.includes(id) && ach.check(stats)) {
      stats.achievements.push(id);
      newAchievements.push(ach);
    }
  }

  await saveStats(chatId, stats, env);

  return { xpGained, newAchievements, stats };
}

/**
 * Record a batch capture
 */
export async function recordBatch(chatId, env, count) {
  const stats = await getStats(chatId, env);
  if (count > stats.max_batch) stats.max_batch = count;
  stats.xp += 5;

  const newAchievements = [];
  for (const [id, ach] of Object.entries(ACHIEVEMENTS)) {
    if (!stats.achievements.includes(id) && ach.check(stats)) {
      stats.achievements.push(id);
      newAchievements.push(ach);
    }
  }

  await saveStats(chatId, stats, env);
  return { newAchievements, stats };
}

/**
 * Build gamification footer for responses
 */
export function buildStatsFooter(stats) {
  const level = getLevel(stats.xp);
  const next = getNextLevel(stats.xp);
  const streakEmoji = stats.streak >= 7 ? '⚔️' : stats.streak >= 3 ? '🔥' : '📅';

  let footer = `\n${streakEmoji} Streak: ${stats.streak}d | ⭐ ${stats.xp} XP (${level.title})`;

  if (next) {
    const progress = Math.round(((stats.xp - level.xp) / (next.xp - level.xp)) * 100);
    footer += ` → ${next.title} ${progress}%`;
  }

  return footer;
}

/**
 * Build achievement unlock message
 */
export function buildAchievementMsg(achievements) {
  if (!achievements.length) return '';
  return '\n\n🏆 ' + achievements.map(a => `${a.name}`).join(' ');
}

function getTodayVN() {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().split('T')[0];
}

function getYesterdayVN() {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000 - 86400000);
  return vn.toISOString().split('T')[0];
}
