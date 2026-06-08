// Stratt v5.0 — Frontend (Chat + Kanban Board)
// No gamification. Tab switching. Board with filters + quick add.

const API = '/api';
const STORAGE_KEY = 'stratt_history_v5';
const MAX_HISTORY = 50;
const BOARD_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

// ═══ State ═══
let isAuthed = false;
let currentTab = 'chat';
let boardData = { active: [], doneToday: [], materials: [] };
let boardRefreshTimer = null;
let wakeLockSentinel = null;

// Calendar state
let calWeekStart = null; // Date object (Monday)
let calTasks = [];
let calModalTaskId = null;
let calNowLineTimer = null;
let calViewMode = 'day'; // 'day' or 'week'
let calSelectedDate = null; // Date object for day view

// ═══ DOM ═══
const $ = id => document.getElementById(id);

// Auth
const authScreen = $('auth-screen');
const appScreen = $('app-screen');
const authForm = $('auth-form');
const authPassword = $('auth-password');
const authError = $('auth-error');
const authSubmit = $('auth-submit');

// Header
const headerTime = $('header-time');
const tabChat = $('tab-chat');
const tabBoard = $('tab-board');
const tabCalendar = $('tab-calendar');

// Chat
const chatView = $('chat-view');
const chatMessages = $('chat-messages');
const chatForm = $('chat-form');
const chatInput = $('chat-input');
const chatSubmit = $('chat-submit');

// Board
const boardView = $('board-view');
const filterProject = $('filter-project');
const filterUrgency = $('filter-urgency');
const quickAddTitle = $('quick-add-title');
const quickAddProject = $('quick-add-project');
const btnQuickAdd = $('btn-quick-add');
const btnRefreshBoard = $('btn-refresh-board');
const boardLoading = $('board-loading');

// ═══ Init ═══
document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 60000);
  checkAuth();
  setupEventListeners();
});

function setupEventListeners() {
  // Auth
  authForm.addEventListener('submit', handleLogin);

  // Tabs
  tabChat.addEventListener('click', () => switchTab('chat'));
  tabBoard.addEventListener('click', () => switchTab('board'));
  tabCalendar.addEventListener('click', () => switchTab('calendar'));

  // Chat
  chatForm.addEventListener('submit', handleChatSubmit);
  chatInput.addEventListener('input', () => {
    chatSubmit.disabled = !chatInput.value.trim();
    autoResize(chatInput);
  });
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatForm.requestSubmit(); }
  });

  // Quick actions
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => sendChat(btn.dataset.action));
  });

  // Board
  btnRefreshBoard.addEventListener('click', () => fetchBoard(true));
  btnQuickAdd.addEventListener('click', handleQuickAdd);
  quickAddTitle.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleQuickAdd(); }
  });
  filterProject.addEventListener('change', renderBoard);
  filterUrgency.addEventListener('change', renderBoard);

  // Wake Lock
  $('btn-wake-lock').addEventListener('click', toggleWakeLock);

  // Logout
  $('btn-logout').addEventListener('click', handleLogout);
}

// ═══ Logout ═══
async function handleLogout() {
  if (!confirm('Logout khỏi Stratt?')) return;
  try { await fetch(`${API}/logout`, { method: 'POST' }); } catch {}
  // Clear all local data
  localStorage.removeItem(STORAGE_KEY);
  stopBoardRefresh();
  if (wakeLockSentinel) { await wakeLockSentinel.release(); wakeLockSentinel = null; }
  // Back to login
  isAuthed = false;
  appScreen.classList.remove('active');
  authScreen.classList.add('active');
  chatMessages.innerHTML = '';
  authPassword.value = '';
  authPassword.setAttribute('readonly', '');
  authPassword.focus();
}

// ═══ Clock ═══
function updateClock() {
  const now = new Date();
  const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const h = vnDate.getUTCHours();
  const m = String(vnDate.getUTCMinutes()).padStart(2, '0');
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  if (headerTime) headerTime.textContent = `${dayNames[vnDate.getUTCDay()]} ${h}:${m}`;
}

// ═══ Auth ═══
async function checkAuth() {
  try {
    const res = await fetch(`${API}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '__ping__' }),
    });
    if (res.ok) { showApp(); }
  } catch {}
}

async function handleLogin(e) {
  e.preventDefault();
  const pw = authPassword.value;
  if (!pw) return;
  authSubmit.querySelector('.btn-text').hidden = true;
  authSubmit.querySelector('.btn-loader').hidden = false;
  authError.hidden = true;
  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    const data = await res.json();
    if (data.success) { showApp(); }
    else { authError.hidden = false; authPassword.focus(); }
  } catch { authError.textContent = 'Lỗi kết nối'; authError.hidden = false; }
  authSubmit.querySelector('.btn-text').hidden = false;
  authSubmit.querySelector('.btn-loader').hidden = true;
}

function showApp() {
  isAuthed = true;
  authScreen.classList.remove('active');
  appScreen.classList.add('active');
  restoreChatHistory();
  chatInput.focus();
  scrollToBottom();
}

// ═══ Tab Switching ═══
function switchTab(tab) {
  currentTab = tab;
  tabChat.classList.toggle('active', tab === 'chat');
  tabBoard.classList.toggle('active', tab === 'board');
  tabCalendar.classList.toggle('active', tab === 'calendar');
  chatView.classList.toggle('active', tab === 'chat');
  boardView.classList.toggle('active', tab === 'board');
  $('calendar-view').classList.toggle('active', tab === 'calendar');

  if (tab === 'board') {
    fetchBoard();
    startBoardRefresh();
  } else {
    stopBoardRefresh();
  }
  if (tab === 'calendar') {
    if (!calWeekStart) calInitWeek();
    fetchCalendar();
    startCalNowLine();
  } else {
    stopCalNowLine();
  }
  if (tab === 'chat') chatInput.focus();
}

// ═══ Chat ═══
async function handleChatSubmit(e) {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg) return;
  chatInput.value = '';
  chatSubmit.disabled = true;
  autoResize(chatInput);
  await sendChat(msg);
}

async function sendChat(message) {
  addMessage(message, 'user');
  const loadingEl = addMessage('⏳ Đang xử lý...', 'bot');

  try {
    const res = await fetch(`${API}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    loadingEl.remove();

    if (res.ok) {
      addMessage(data.response_text || data.error || '(no response)', 'bot');
    } else {
      addMessage(`❌ ${data.error || 'Lỗi server'}`, 'bot');
    }
  } catch (err) {
    loadingEl.remove();
    addMessage(`❌ Lỗi kết nối: ${err.message}\n💡 Thử lại?`, 'bot');
  }

  saveChatHistory();
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

// Chat History
function saveChatHistory() {
  const msgs = [];
  chatMessages.querySelectorAll('.message').forEach(el => {
    const sender = el.classList.contains('user') ? 'user' : 'bot';
    const content = el.querySelector('.message-content')?.innerHTML || '';
    msgs.push({ sender, content });
  });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-MAX_HISTORY))); } catch {}
}

function restoreChatHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (saved.length) {
      chatMessages.innerHTML = '';
      saved.forEach(m => {
        const div = document.createElement('div');
        div.className = `message ${m.sender}`;
        const avatar = m.sender === 'bot' ? '🤖' : '👤';
        div.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-content">${m.content}</div>`;
        chatMessages.appendChild(div);
      });
    }
  } catch {}
}

// ═══ Board ═══
async function fetchBoard(showSpinner = false) {
  if (showSpinner) { boardLoading.hidden = false; }

  try {
    const res = await fetch(`${API}/tasks`);
    if (!res.ok) throw new Error('Failed to fetch');
    boardData = await res.json();
    renderBoard();
  } catch (err) {
    console.error('Board fetch error:', err);
  }

  boardLoading.hidden = true;
}

function renderBoard() {
  const projectFilter = filterProject.value;
  const urgencyFilter = filterUrgency.value;

  // Filter function
  const matchFilter = task => {
    if (projectFilter !== 'all' && task.project !== projectFilter) return false;
    if (urgencyFilter !== 'all' && task.urgency !== urgencyFilter) return false;
    return true;
  };

  // Categorize active tasks
  const todo = boardData.active.filter(t => t.status === 'To do' && matchFilter(t));
  const progress = boardData.active.filter(t => t.status === 'In progress' && matchFilter(t));
  const pending = boardData.active.filter(t =>
    (t.status === 'Pending / Wait for approved' || t.status === 'Pending') && matchFilter(t)
  );
  const done = boardData.doneToday.filter(matchFilter);

  // Materials shown when project filter is MATERIALS
  let materialsInTodo = [];
  if (projectFilter === 'MATERIALS') {
    materialsInTodo = boardData.materials.filter(matchFilter);
    todo.push(...materialsInTodo);
  }

  // Render
  renderColumn('cards-todo', todo, 'count-todo');
  renderColumn('cards-progress', progress, 'count-progress');
  renderColumn('cards-pending', pending, 'count-pending');
  renderColumn('cards-done', done, 'count-done');
}

function renderColumn(containerId, tasks, countId) {
  const container = $(containerId);
  $(countId).textContent = tasks.length;

  const urgencyOrder = { '🔴 Fire': 0, '🟡 Important': 1, '🟢 Wait': 2, '⚪ Someday': 3 };
  tasks.sort((a, b) => {
    const ua = urgencyOrder[a.urgency] ?? 9;
    const ub = urgencyOrder[b.urgency] ?? 9;
    if (ua !== ub) return ua - ub;
    return (a.due_date || '9999').localeCompare(b.due_date || '9999');
  });

  container.innerHTML = tasks.map(t => {
    const today = new Date().toISOString().split('T')[0];
    const isOverdue = t.due_date && t.due_date < today && t.status !== 'Completed';
    const deadlineBadge = t.due_date
      ? `<span class="card-badge ${isOverdue ? 'overdue' : ''}">📅 ${t.due_date.substring(5)}</span>`
      : '';
    const estBadge = t.estimate ? `<span class="card-badge">⏱ ${t.estimate}p</span>` : '';
    const projectBadge = t.project ? `<span class="card-badge project">${t.project}</span>` : '';
    const resourceLink = t.resource ? `<span class="card-badge">🔗</span>` : '';

    // Status action buttons
    let actions = '';
    if (t.status === 'To do') {
      actions = `
        <div class="card-status-actions">
          <button class="status-action-btn" onclick="changeStatus('${t.id}','In progress')">▶ Start</button>
          <button class="status-action-btn" onclick="changeStatus('${t.id}','Completed')">✅ Done</button>
        </div>`;
    } else if (t.status === 'In progress') {
      actions = `
        <div class="card-status-actions">
          <button class="status-action-btn" onclick="changeStatus('${t.id}','Completed')">✅ Done</button>
          <button class="status-action-btn" onclick="changeStatus('${t.id}','To do')">⏸ Pause</button>
        </div>`;
    } else if (t.status === 'Pending / Wait for approved' || t.status === 'Pending') {
      actions = `
        <div class="card-status-actions">
          <button class="status-action-btn" onclick="changeStatus('${t.id}','In progress')">▶ Resume</button>
          <button class="status-action-btn" onclick="changeStatus('${t.id}','Completed')">✅ Done</button>
        </div>`;
    }

    return `
      <div class="task-card" data-urgency="${t.urgency || ''}" data-id="${t.id}">
        <div class="card-title">${escapeHtml(t.title)}</div>
        <div class="card-meta">
          ${projectBadge}${deadlineBadge}${estBadge}${resourceLink}
        </div>
        ${actions}
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Change task status via board
window.changeStatus = async function(taskId, newStatus) {
  // Optimistic UI update
  const card = document.querySelector(`[data-id="${taskId}"]`);
  if (card) { card.style.opacity = '0.5'; card.style.pointerEvents = 'none'; }

  try {
    const res = await fetch(`${API}/tasks/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: taskId, status: newStatus }),
    });
    if (!res.ok) throw new Error('Update failed');
    await fetchBoard();
  } catch (err) {
    console.error('Status change error:', err);
    if (card) { card.style.opacity = '1'; card.style.pointerEvents = 'auto'; }
    alert('❌ Lỗi cập nhật status. Thử lại?');
  }
};

// Quick Add
async function handleQuickAdd() {
  const title = quickAddTitle.value.trim();
  if (!title) return;
  const project = quickAddProject.value;

  btnQuickAdd.disabled = true;
  btnQuickAdd.textContent = '...';

  try {
    const res = await fetch(`${API}/tasks/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, project }),
    });
    if (!res.ok) throw new Error('Create failed');
    quickAddTitle.value = '';
    await fetchBoard();
  } catch (err) {
    console.error('Quick add error:', err);
    alert('❌ Lỗi tạo task. Thử lại?');
  }

  btnQuickAdd.disabled = false;
  btnQuickAdd.textContent = '+ Add';
}

// Board auto-refresh
function startBoardRefresh() {
  stopBoardRefresh();
  boardRefreshTimer = setInterval(() => { if (currentTab === 'board') fetchBoard(); }, BOARD_REFRESH_MS);
}

function stopBoardRefresh() {
  if (boardRefreshTimer) { clearInterval(boardRefreshTimer); boardRefreshTimer = null; }
}

// ═══ Wake Lock (iPad always-on) ═══
async function toggleWakeLock() {
  const btn = $('btn-wake-lock');
  if (wakeLockSentinel) {
    await wakeLockSentinel.release();
    wakeLockSentinel = null;
    btn.classList.remove('active');
    btn.title = 'Keep screen on';
  } else {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      btn.classList.add('active');
      btn.title = 'Screen lock ON';
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
        btn.classList.remove('active');
      });
    } catch (err) {
      console.warn('Wake Lock not supported:', err);
      btn.title = 'Not supported';
    }
  }
}

// ═══ CALENDAR ═══

const CAL_START_HOUR = 7;
const CAL_END_HOUR = 23;
const CAL_SLOTS = (CAL_END_HOUR - CAL_START_HOUR) * 2; // 32 half-hours
const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

// Helper: get YYYY-MM-DD from Date using local timezone (not UTC)
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function calInitWeek() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  calWeekStart = new Date(now);
  calWeekStart.setDate(now.getDate() + diff);
  calWeekStart.setHours(0, 0, 0, 0);
  calSelectedDate = new Date(now);
  calSelectedDate.setHours(0, 0, 0, 0);
}

function calShiftNav(delta) {
  if (calViewMode === 'day') {
    calSelectedDate.setDate(calSelectedDate.getDate() + delta);
    // Update weekStart if day is outside current week
    const dayDiff = Math.round((calSelectedDate - calWeekStart) / 86400000);
    if (dayDiff < 0 || dayDiff > 6) {
      const d = calSelectedDate.getDay();
      const diff = d === 0 ? -6 : 1 - d;
      calWeekStart = new Date(calSelectedDate);
      calWeekStart.setDate(calSelectedDate.getDate() + diff);
    }
  } else {
    calWeekStart.setDate(calWeekStart.getDate() + delta * 7);
    calSelectedDate = new Date(calWeekStart);
  }
  fetchCalendar();
}

function calGoToday() {
  calInitWeek();
  fetchCalendar();
}

function calSetViewMode(mode) {
  calViewMode = mode;
  $('cal-view-day')?.classList.toggle('active', mode === 'day');
  $('cal-view-week')?.classList.toggle('active', mode === 'week');
  renderCalendar();
}

async function fetchCalendar() {
  const loading = $('cal-loading');
  if (loading) loading.hidden = false;
  if (!calWeekStart) calInitWeek();
  const ws = localDateStr(calWeekStart);
  try {
    const res = await fetch(`${API}/calendar?week=${ws}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    calTasks = data.tasks || [];
    renderCalendar();
  } catch (err) {
    console.error('Calendar fetch error:', err);
    // Still render empty grid so UI isn't blank
    renderCalendar();
  } finally {
    if (loading) loading.hidden = true;
  }
}

function renderCalendar() {
  const grid = $('cal-grid');
  if (!grid || !calWeekStart) return;
  grid.innerHTML = '';
  const today = localDateStr(new Date());
  const isDayView = calViewMode === 'day';
  const numDays = isDayView ? 1 : 7;
  const baseDate = isDayView ? calSelectedDate : calWeekStart;

  // Toggle grid class
  grid.classList.toggle('day-view', isDayView);

  // Update label
  if (isDayView) {
    const DAY_NAMES_FULL = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    $('cal-week-label').textContent = `${DAY_NAMES_FULL[calSelectedDate.getDay()]} ${calSelectedDate.getDate()}/${calSelectedDate.getMonth() + 1}`;
  } else {
    const we = new Date(calWeekStart);
    we.setDate(we.getDate() + 6);
    const fmt = d => `${d.getDate()}/${d.getMonth() + 1}`;
    $('cal-week-label').textContent = `${fmt(calWeekStart)} — ${fmt(we)} / ${calWeekStart.getFullYear()}`;
  }

  // Time gutter header (top-left corner)
  const gutterHeader = document.createElement('div');
  gutterHeader.className = 'cal-time-gutter-header';
  grid.appendChild(gutterHeader);

  // Day headers
  for (let d = 0; d < numDays; d++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + d);
    const dateStr = localDateStr(date);
    const header = document.createElement('div');
    header.className = 'cal-day-header' + (dateStr === today ? ' today' : '');
    header.innerHTML = `<span class="cal-day-name">${DAY_NAMES[date.getDay()]}</span><span class="cal-day-num">${date.getDate()}</span>`;
    header.style.gridColumn = d + 2;
    header.style.gridRow = 1;
    grid.appendChild(header);
  }

  // Time slots + cells
  for (let s = 0; s < CAL_SLOTS; s++) {
    const hour = CAL_START_HOUR + Math.floor(s / 2);
    const min = (s % 2) * 30;
    const row = s + 2; // row 1 is header

    // Time gutter label (only on hour marks)
    if (s % 2 === 0) {
      const gutter = document.createElement('div');
      gutter.className = 'cal-time-gutter';
      gutter.style.gridRow = row;
      gutter.textContent = `${hour}:00`;
      grid.appendChild(gutter);
    } else {
      // Empty gutter for half-hour
      const gutter = document.createElement('div');
      gutter.className = 'cal-time-gutter';
      gutter.style.gridRow = row;
      gutter.style.borderRight = '1px solid var(--border-1)';
      grid.appendChild(gutter);
    }

    // Day cells
    for (let d = 0; d < numDays; d++) {
      const cell = document.createElement('div');
      cell.className = 'cal-cell' + (s % 2 === 0 ? ' hour-start' : '');
      cell.style.gridColumn = d + 2;
      cell.style.gridRow = row;
      // Click to schedule (empty slot)
      const cellDate = new Date(baseDate);
      cellDate.setDate(cellDate.getDate() + d);
      const cellDateStr = localDateStr(cellDate);
      const cellTime = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      cell.addEventListener('click', () => {
        // If there's a dragged task, could schedule it here
        // For now just open modal if we have a pending task
      });
      cell.dataset.date = cellDateStr;
      cell.dataset.time = cellTime;
      grid.appendChild(cell);
    }
  }

  // Place scheduled tasks
  const scheduled = calTasks.filter(t => t.scheduled);
  const unscheduled = calTasks.filter(t => !t.scheduled);

  scheduled.forEach(task => {
    // Parse raw ISO string directly (avoid timezone conversion)
    // Notion returns: "2026-06-08T10:00:00.000+00:00"
    const dateStr = task.scheduled.split('T')[0];
    const timePart = task.scheduled.split('T')[1] || '00:00';
    const hours = parseInt(timePart.split(':')[0]) || 0;
    const mins = parseInt(timePart.split(':')[1]) || 0;

    // Find which day column
    const dayDiff = Math.round((new Date(dateStr) - new Date(localDateStr(baseDate))) / 86400000);
    if (dayDiff < 0 || dayDiff >= numDays) return;

    const slotIndex = (hours - CAL_START_HOUR) * 2 + Math.floor(mins / 30);
    if (slotIndex < 0 || slotIndex >= CAL_SLOTS) return;

    const duration = task.estimate || 30;
    const slotSpan = Math.max(1, Math.ceil(duration / 30));
    const rowStart = slotIndex + 2;

    // Find the parent cell to position relative to
    const col = dayDiff + 2;
    const block = document.createElement('div');
    block.className = 'cal-task';
    block.dataset.urgency = task.urgency || '';
    block.dataset.taskId = task.id;
    block.innerHTML = `<div class="cal-task-title">${task.title}</div><div class="cal-task-project">${task.project} · ${duration}m</div>`;
    block.style.gridColumn = col;
    block.style.gridRow = `${rowStart} / span ${slotSpan}`;
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      openScheduleModal(task);
    });
    grid.appendChild(block);
  });

  // Unscheduled list
  const unschedList = $('cal-unscheduled-list');
  $('cal-unscheduled-count').textContent = unscheduled.length;
  unschedList.innerHTML = '';
  unscheduled.forEach(task => {
    const urgIcon = task.urgency?.substring(0, 2) || '⚪';
    const chip = document.createElement('div');
    chip.className = 'cal-unsched-chip';
    chip.innerHTML = `<span class="chip-urgency">${urgIcon}</span><span>${task.title}</span>${task.estimate ? `<span class="chip-est">${task.estimate}m</span>` : ''}`;
    chip.addEventListener('click', () => openScheduleModal(task));
    unschedList.appendChild(chip);
  });

  // Current time line
  updateCalNowLine();
}

function updateCalNowLine() {
  // Remove existing
  document.querySelectorAll('.cal-now-line').forEach(el => el.remove());

  const now = new Date();
  const today = localDateStr(now);
  const h = now.getHours();
  const m = now.getMinutes();
  if (h < CAL_START_HOUR || h >= CAL_END_HOUR) return;

  const isDayView = calViewMode === 'day';
  const numDays = isDayView ? 1 : 7;
  const baseDate = isDayView ? calSelectedDate : calWeekStart;
  if (!baseDate) return;
  const dayDiff = Math.round((new Date(today) - new Date(localDateStr(baseDate))) / 86400000);
  if (dayDiff < 0 || dayDiff >= numDays) return;

  const totalMins = (h - CAL_START_HOUR) * 60 + m;
  const slotFraction = totalMins / 30;
  const row = Math.floor(slotFraction) + 2;
  const fractional = slotFraction % 1;

  // Find the cell at that position
  const col = dayDiff + 2;
  const cells = document.querySelectorAll(`.cal-cell[data-date="${today}"]`);
  const targetCell = cells[Math.floor(slotFraction)];
  if (!targetCell) return;

  const line = document.createElement('div');
  line.className = 'cal-now-line';
  line.style.top = (fractional * 100) + '%';
  targetCell.appendChild(line);
}

function startCalNowLine() {
  stopCalNowLine();
  calNowLineTimer = setInterval(updateCalNowLine, 60000);
}
function stopCalNowLine() {
  if (calNowLineTimer) { clearInterval(calNowLineTimer); calNowLineTimer = null; }
}

// ─── Schedule Modal ───
function openScheduleModal(task) {
  calModalTaskId = task.id;
  $('cal-modal-title').textContent = task.title;
  const overlay = $('cal-modal-overlay');

  if (task.scheduled) {
    // Parse raw ISO string (avoid timezone conversion)
    $('cal-modal-date').value = task.scheduled.split('T')[0];
    const timePart = task.scheduled.split('T')[1] || '00:00';
    const h = timePart.split(':')[0].padStart(2, '0');
    const m = timePart.split(':')[1]?.substring(0, 2).padStart(2, '0') || '00';
    $('cal-modal-time').value = `${h}:${m}`;
  } else {
    // Default to today + next half-hour
    const now = new Date();
    $('cal-modal-date').value = localDateStr(now);
    const nextH = now.getMinutes() < 30 ? now.getHours() : now.getHours() + 1;
    const nextM = now.getMinutes() < 30 ? '30' : '00';
    $('cal-modal-time').value = `${String(nextH).padStart(2, '0')}:${nextM}`;
  }
  $('cal-modal-duration').value = task.estimate || 30;
  $('cal-modal-remove').style.display = task.scheduled ? '' : 'none';

  overlay.hidden = false;
}

function closeScheduleModal() {
  $('cal-modal-overlay').hidden = true;
  calModalTaskId = null;
}

async function saveSchedule() {
  if (!calModalTaskId) return;
  const date = $('cal-modal-date').value;
  const time = $('cal-modal-time').value;
  if (!date || !time) return;

  const scheduledISO = `${date}T${time}:00`;
  $('cal-modal-save').disabled = true;
  try {
    await fetch(`${API}/calendar/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: calModalTaskId, scheduled: scheduledISO }),
    });
    closeScheduleModal();
    fetchCalendar();
  } catch (err) {
    console.error('Schedule error:', err);
  } finally {
    $('cal-modal-save').disabled = false;
  }
}

async function removeSchedule() {
  if (!calModalTaskId) return;
  try {
    await fetch(`${API}/calendar/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: calModalTaskId, scheduled: null }),
    });
    closeScheduleModal();
    fetchCalendar();
  } catch (err) {
    console.error('Remove schedule error:', err);
  }
}

// Calendar event listeners (set up in DOMContentLoaded)
document.addEventListener('DOMContentLoaded', () => {
  $('cal-prev')?.addEventListener('click', () => calShiftNav(-1));
  $('cal-next')?.addEventListener('click', () => calShiftNav(1));
  $('cal-today')?.addEventListener('click', calGoToday);
  $('cal-refresh')?.addEventListener('click', () => fetchCalendar());
  $('cal-view-day')?.addEventListener('click', () => calSetViewMode('day'));
  $('cal-view-week')?.addEventListener('click', () => calSetViewMode('week'));
  $('cal-modal-close')?.addEventListener('click', closeScheduleModal);
  $('cal-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === $('cal-modal-overlay')) closeScheduleModal();
  });
  $('cal-modal-save')?.addEventListener('click', saveSchedule);
  $('cal-modal-remove')?.addEventListener('click', removeSchedule);
});

