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
  chatView.classList.toggle('active', tab === 'chat');
  boardView.classList.toggle('active', tab === 'board');

  if (tab === 'board') {
    fetchBoard();
    startBoardRefresh();
  } else {
    stopBoardRefresh();
    chatInput.focus();
  }
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
