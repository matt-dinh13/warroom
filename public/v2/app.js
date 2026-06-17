// ═══ Stratt v2.0 — Today-first UI (frontend) ═══
// Plan: PLAN_UI.md mục 1 (Today tab) + 5 (lỗi nhỏ).
// Wires /api/today for plan, /api/chat for actions.

const STORAGE_THEME = 'stratt_theme_v2';
const STORAGE_TAB = 'stratt_tab_v2';

// ─── Auth ──────────────────────────────────────
document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.hidden = true;
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      document.getElementById('auth-screen').classList.remove('active');
      document.getElementById('app-screen').classList.add('active');
      initApp();
    } else {
      errEl.textContent = 'Sai mật khẩu';
      errEl.hidden = false;
    }
  } catch (err) {
    errEl.textContent = 'Lỗi kết nối';
    errEl.hidden = false;
  }
});

// ─── Logout ────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  location.reload();
});

// ─── Theme ─────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById('btn-theme').textContent = theme === 'light' ? '☀️' : '🌙';
  try { localStorage.setItem(STORAGE_THEME, theme); } catch {}
}
document.getElementById('btn-theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
});
try {
  const saved = localStorage.getItem(STORAGE_THEME);
  if (saved) applyTheme(saved);
} catch {}

// ─── Header time ───────────────────────────────
function tickTime() {
  const vn = new Date(Date.now() + 7 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('header-time').textContent =
    `${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}`;
}
setInterval(tickTime, 30000);
tickTime();

// ─── Tabs ──────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-view').forEach(v => v.classList.toggle('active', v.id === `${tab}-view`));
  try { localStorage.setItem(STORAGE_TAB, tab); } catch {}
  if (tab === 'today') loadToday();
  if (tab === 'board') loadBoardLite();
}

// ─── Today: load plan ──────────────────────────
let currentPlan = null;
let doneTaskIds = new Set(); // track locally-completed tasks in this session

async function loadToday(opts = {}) {
  const loading = document.getElementById('today-loading');
  const empty = document.getElementById('today-empty');
  const content = document.getElementById('today-content');

  loading.hidden = false;
  empty.hidden = true;
  content.hidden = true;

  try {
    const url = '/api/today' + (opts.replan ? '?replan=1' : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentPlan = data.plan;
    renderToday(currentPlan);
  } catch (err) {
    loading.textContent = '❌ Lỗi tải plan: ' + err.message;
  }
}

function renderToday(plan) {
  const loading = document.getElementById('today-loading');
  const empty = document.getElementById('today-empty');
  const content = document.getElementById('today-content');

  loading.hidden = true;

  if (!plan || !plan.timeline || plan.timeline.length === 0) {
    empty.hidden = false;
    content.hidden = true;
    return;
  }

  empty.hidden = true;
  content.hidden = false;

  // Strip already-done tasks
  const visibleTimeline = plan.timeline.filter(item => {
    if (item.kind === 'anchor') return true;
    if (!item.task || !item.task.id) return false;
    return !doneTaskIds.has(item.task.id);
  });

  // Date / daytype header
  const today = plan.meta?.today || '';
  const dt = plan.meta?.dayType || 'office';
  const dayTypeLabel = { office: '🏢 Office', wfh: '🏠 WFH', weekend: '🌿 Weekend' }[dt] || dt;
  const vnDate = new Date(today + 'T00:00:00Z');
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  document.getElementById('today-date').textContent =
    `${dayNames[vnDate.getDay()]} ${today.slice(5).replace('-', '/')}`;
  document.getElementById('today-daytype').textContent = dayTypeLabel;

  // ─── Next action: first non-done, non-anchor task
  const firstPlanned = visibleTimeline.find(it => it.kind === 'planned');
  const nextCard = document.getElementById('next-card');
  if (firstPlanned && firstPlanned.task) {
    const t = firstPlanned.task;
    nextCard.hidden = false;
    document.getElementById('next-title').textContent = t.title;
    const est = t.estimate ? `⏱ ${t.estimate}p` : '⏱ ?p';
    const proj = t.project ? ` · 📂 ${t.project}` : '';
    const dl = t.due_date ? ` · 📅 ${t.due_date}` : '';
    document.getElementById('next-meta').textContent =
      `${t.urgency || '🟡'} ${est}${proj}${dl} · 🕒 ${firstPlanned.time}`;
    document.getElementById('btn-next-done').onclick = () => completeTask(t);
    document.getElementById('btn-next-skip').onclick = () => skipTask(t);
  } else {
    nextCard.hidden = true;
  }

  // ─── Timeline rows
  const tl = document.getElementById('today-timeline');
  tl.innerHTML = '';
  for (const item of visibleTimeline) {
    if (item.kind === 'lunch' || !item.task) {
      const row = document.createElement('div');
      row.className = 'timeline-row lunch';
      row.textContent = '🍜 Nghỉ trưa';
      tl.appendChild(row);
      continue;
    }
    const t = item.task;
    const row = document.createElement('div');
    row.className = 'timeline-row';
    if (item.kind === 'anchor') row.classList.add('anchor');
    if (doneTaskIds.has(t.id)) row.classList.add('done');
    const ic = item.kind === 'anchor' ? '📌' : (t.urgency || '🟡');
    const est = t.estimate ? `${t.estimate}p` : '?p';
    row.innerHTML = `
      <span class="tl-time">${item.time}</span>
      <span class="tl-title"><span class="tl-icon">${ic}</span>${escapeHtml(t.title || 'Untitled')}</span>
      <span class="tl-meta">${est}${t.project ? ' · ' + t.project : ''}</span>
    `;
    tl.appendChild(row);
  }

  // ─── Progress
  const totalPlanned = plan.timeline.filter(it => it.kind === 'planned').length;
  const doneCount = plan.timeline.filter(it => it.kind === 'planned' && doneTaskIds.has(it.task?.id)).length;
  const focusH = ((plan.meta?.focusCap || 0) / 60).toFixed(1);
  const usedH = ((plan.meta?.used || 0) / 60).toFixed(1);
  document.getElementById('today-progress').textContent =
    `✅ ${doneCount}/${totalPlanned} xong · ${usedH}h / ${focusH}h`;

  // ─── Overflow banner
  const banner = document.getElementById('overflow-banner');
  const bannerText = document.getElementById('overflow-text');
  const parts = [];
  if (plan.parked && plan.parked.length) {
    parts.push(`🅿️ Đã park ${plan.parked.length}: ${plan.parked.slice(0, 3).map(t => t.title).join(', ')}${plan.parked.length > 3 ? '…' : ''}`);
  }
  if (plan.pushed && plan.pushed.length) {
    parts.push(`➡️ Đẩy ${plan.pushed.length} sang mai: ${plan.pushed.slice(0, 3).map(t => t.title).join(', ')}${plan.pushed.length > 3 ? '…' : ''}`);
  }
  if (plan.overflow && plan.overflow.length) {
    parts.push(`⚠️ Việc bắt buộc vượt giờ. Bạn quyết: ${plan.overflow.map(t => t.title).join(', ')}`);
  }
  if (parts.length) {
    banner.hidden = false;
    bannerText.textContent = parts.join('\n');
  } else {
    banner.hidden = true;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function completeTask(task) {
  if (!task || !task.id) return;
  try {
    const res = await fetch('/api/tasks/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, status: 'Completed' }),
    });
    if (res.ok) {
      doneTaskIds.add(task.id);
      renderToday(currentPlan);
    } else {
      alert('❌ Không thể đánh dấu xong. Thử lại.');
    }
  } catch (err) {
    alert('❌ Lỗi: ' + err.message);
  }
}

function skipTask(task) {
  // Soft action: just remove from view. Backend: defer to tomorrow.
  if (!task || !task.id) return;
  if (!confirm(`Đẩy "${task.title}" sang mai?`)) return;
  fetch('/api/tasks/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: task.id, do_date: 'tomorrow' }),
  }).then(r => {
    if (r.ok) {
      doneTaskIds.add(task.id);
      renderToday(currentPlan);
    }
  });
}

document.getElementById('btn-plan-now').addEventListener('click', async () => {
  // Trigger server-side plan: send "xếp lịch" to chat
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'xếp lịch' }),
  });
  const data = await res.json();
  if (data.needs_confirmation) {
    // Auto-confirm so Matt doesn't have to type "ok"
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'ok' }),
    });
  }
  loadToday();
});

document.getElementById('btn-replan').addEventListener('click', () => loadToday({ replan: true }));
document.getElementById('btn-refresh-today').addEventListener('click', () => loadToday());

// ─── Header + capture button (jump to chat) ───
document.getElementById('btn-capture').addEventListener('click', () => {
  switchTab('chat');
  // Focus after tab switch renders
  setTimeout(() => {
    const input = document.getElementById('chat-input');
    if (input) { input.focus(); }
  }, 50);
});

// ─── Chat (v2 lean — ported from v1) ───────────
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatSubmit = document.getElementById('chat-submit');
const chatMessages = document.getElementById('chat-messages');

chatInput.addEventListener('input', () => {
  chatSubmit.disabled = !chatInput.value.trim();
  autoResize(chatInput);
});
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (chatInput.value.trim()) chatForm.dispatchEvent(new Event('submit'));
  }
});
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg) return;
  chatInput.value = '';
  chatSubmit.disabled = true;
  autoResize(chatInput);
  await sendChat(msg);
});

async function sendChat(message) {
  addMessage(message, 'user');
  const loadingEl = addMessage('⏳ Đang xử lý...', 'bot');
  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    loadingEl.remove();
    if (res.ok) {
      if (data.needs_confirmation && data.pending_action) {
        addConfirmMessage(data.response_text || '', data.pending_action);
      } else {
        addMessage(data.response_text || data.error || '(no response)', 'bot');
        // If a task was created or completed, refresh Today view silently next visit
      }
    } else {
      addMessage(`❌ ${data.error || 'Lỗi server'}`, 'bot');
    }
  } catch (err) {
    loadingEl.remove();
    addMessage(`❌ Lỗi kết nối: ${err.message}\n💡 Thử lại?`, 'bot');
  }
  scrollToBottom();
  // After any chat action, refresh Today in background
  if (currentPlan) loadToday();
}

function addConfirmMessage(text) {
  const div = document.createElement('div');
  div.className = 'message bot confirm-message';
  div.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="confirm-text">${formatMessage(text)}</div>
      <div class="confirm-buttons" style="margin-top: 10px; display: flex; gap: 8px;">
        <button class="confirm-btn-yes" style="padding: 6px 12px; background: var(--success); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">✅ Tạo</button>
        <button class="confirm-btn-no"  style="padding: 6px 12px; background: var(--error);   color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">✏️ Sửa</button>
      </div>
    </div>
  `;
  div.querySelector('.confirm-btn-yes').addEventListener('click', () => {
    div.querySelector('.confirm-buttons').remove();
    sendChat('ok');
  });
  div.querySelector('.confirm-btn-no').addEventListener('click', () => {
    div.querySelector('.confirm-buttons').remove();
    const userMsgs = chatMessages.querySelectorAll('.message.user');
    const last = userMsgs[userMsgs.length - 1];
    if (last) {
      chatInput.value = last.querySelector('.message-content').textContent || '';
      autoResize(chatInput);
      chatSubmit.disabled = false;
    }
    sendChat('hủy');
  });
  chatMessages.appendChild(div);
  scrollToBottom();
}

function addMessage(text, sender) {
  const div = document.createElement('div');
  div.className = `message ${sender}`;
  const avatar = sender === 'bot' ? '🤖' : '👤';
  div.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">${formatMessage(text)}</div>
  `;
  chatMessages.appendChild(div);
  scrollToBottom();
  return div;
}

function formatMessage(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}

function scrollToBottom() {
  requestAnimationFrame(() => { chatMessages.scrollTop = chatMessages.scrollHeight; });
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ─── Board Lite ────────────────────────────────
async function loadBoardLite() {
  const loading = document.getElementById('board-lite-loading');
  const container = document.getElementById('board-lite');
  loading.hidden = false;
  container.innerHTML = '';
  try {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    const tasks = (data.tasks || []).filter(t => t.status !== 'Completed' && t.project !== 'MATERIALS');
    const urgencyClass = {
      '🔴 Fire': 'urgency-fire',
      '🟡 Important': 'urgency-important',
      '🟢 Wait': 'urgency-wait',
      '⚪ Someday': 'urgency-someday',
    };
    const urgencyIcon = { '🔴 Fire': '🔴', '🟡 Important': '🟡', '🟢 Wait': '🟢', '⚪ Someday': '⚪' };
    tasks.slice(0, 20).forEach(t => {
      const el = document.createElement('div');
      el.className = `board-lite-task ${urgencyClass[t.urgency] || ''}`;
      el.innerHTML = `
        <span class="urgency-icon">${urgencyIcon[t.urgency] || '🟡'}</span>
        <span>${escapeHtml(t.title)}</span>
        <span class="project-tag">${t.project || '—'}${t.estimate ? ' · ' + t.estimate + 'p' : ''}</span>
      `;
      container.appendChild(el);
    });
    if (tasks.length > 20) {
      const more = document.createElement('p');
      more.className = 'board-lite-hint';
      more.textContent = `+${tasks.length - 20} task nữa. Mở v1 để xem tất cả.`;
      container.appendChild(more);
    }
    loading.hidden = true;
  } catch (err) {
    loading.textContent = '❌ ' + err.message;
  }
}

// ─── Init ──────────────────────────────────────
function initApp() {
  // Restore tab
  try {
    const saved = localStorage.getItem(STORAGE_TAB);
    if (saved && saved !== 'today') switchTab(saved);
    else loadToday();
  } catch {
    loadToday();
  }
}

// Auto-login if already authed? Skip — auth gate is required every time (cookies handle session).
