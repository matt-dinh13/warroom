// War Room — Frontend Chat Logic v3.0
// Markdown renderer + urgency colors + ADHD-optimized display

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── Elements ────────────────────────────────
const authScreen = $('#auth-screen');
const chatScreen = $('#chat-screen');
const authForm = $('#auth-form');
const authPassword = $('#auth-password');
const authError = $('#auth-error');
const authSubmit = $('#auth-submit');
const chatForm = $('#chat-form');
const chatInput = $('#chat-input');
const chatSubmit = $('#chat-submit');
const chatMessages = $('#chat-messages');
const headerTime = $('#header-time');

// ─── State ────────────────────────────────────────
let isProcessing = false;
const HISTORY_KEY = 'warroom_history';
const MAX_HISTORY = 50;

// ─── Init ──────────────────────────────────────
function init() {
  checkAuth();
  updateClock();
  setInterval(updateClock, 1000);
  restoreHistory();

  authForm.addEventListener('submit', handleLogin);
  chatForm.addEventListener('submit', handleChat);

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    chatSubmit.disabled = !chatInput.value.trim();
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatInput.value.trim()) chatForm.requestSubmit();
    }
  });

  $$('.quick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action && !isProcessing) {
        chatInput.value = action;
        chatSubmit.disabled = false;
        chatForm.requestSubmit();
      }
    });
  });
}

// ─── Auth ──────────────────────────────────────
async function checkAuth() {
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'health' }),
      });
      if (chatRes.status !== 401) {
        showChat();
        return;
      }
    }
  } catch {}
  showAuth();
}

async function handleLogin(e) {
  e.preventDefault();
  const password = authPassword.value.trim();
  if (!password) return;

  setAuthLoading(true);
  authError.hidden = true;

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    if (data.success) {
      showChat();
    } else {
      authError.textContent = data.error || 'Sai mật khẩu';
      authError.hidden = false;
      authPassword.value = '';
      authPassword.focus();
    }
  } catch (err) {
    authError.textContent = 'Lỗi kết nối server';
    authError.hidden = false;
  } finally {
    setAuthLoading(false);
  }
}

function setAuthLoading(loading) {
  const btnText = authSubmit.querySelector('.btn-text');
  const btnLoader = authSubmit.querySelector('.btn-loader');
  if (loading) {
    btnText.hidden = true;
    btnLoader.hidden = false;
    authSubmit.disabled = true;
  } else {
    btnText.hidden = false;
    btnLoader.hidden = true;
    authSubmit.disabled = false;
  }
}

function showAuth() {
  authScreen.classList.add('active');
  chatScreen.classList.remove('active');
  authPassword.focus();
}

function showChat() {
  authScreen.classList.remove('active');
  chatScreen.classList.add('active');
  chatInput.focus();
}

// ─── Chat ──────────────────────────────────────
async function handleChat(e) {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message || isProcessing) return;

  isProcessing = true;
  chatSubmit.disabled = true;

  addMessage(message, 'user');
  chatInput.value = '';
  chatInput.style.height = 'auto';

  const typingEl = addTypingIndicator();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (res.status === 401) {
      removeTypingIndicator(typingEl);
      showAuth();
      return;
    }

    const data = await res.json();
    removeTypingIndicator(typingEl);

    if (data.error) {
      addMessage(`⚠️ ${data.error}`, 'bot');
    } else {
      addMessage(data.response_text || 'Không có response', 'bot');
    }

    if (data.follow_up_question) {
      setTimeout(() => addMessage(data.follow_up_question, 'bot'), 500);
    }
  } catch (err) {
    removeTypingIndicator(typingEl);
    addMessage(`⚠️ Lỗi kết nối: ${err.message}`, 'bot');
  } finally {
    isProcessing = false;
    chatSubmit.disabled = false;
    chatInput.focus();
  }
}

// ─── Markdown Renderer ─────────────────────────
function renderMarkdown(text) {
  // Escape HTML first
  let html = escapeHtml(text);

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  // Bold text **text** → <b>text</b>
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

  // Urgency pills — colorize urgency tags
  html = html.replace(/🔴\s*(Fire|[^<\n]+)/g, '<span class="urgency-pill urgency-fire">🔴 $1</span>');
  html = html.replace(/🟡\s*(Important|[^<\n]+)/g, '<span class="urgency-pill urgency-important">🟡 $1</span>');
  html = html.replace(/🟢\s*(Wait|[^<\n]+)/g, '<span class="urgency-pill urgency-wait">🟢 $1</span>');
  html = html.replace(/⚪\s*(Someday|[^<\n]+)/g, '<span class="urgency-pill urgency-someday">⚪ $1</span>');

  // Load bar styling
  html = html.replace(/(━+)(░+)\s*(\d+%)/g, '<span class="load-bar"><span class="load-filled">$1</span><span class="load-empty">$2</span> <span class="load-pct">$3</span></span>');

  // XP and streak highlights
  html = html.replace(/(\+\d+ XP!?)/g, '<span class="xp-gain">$1</span>');
  html = html.replace(/(Streak:\s*\d+d)/g, '<span class="streak-badge">$1</span>');

  // Achievement badges
  html = html.replace(/(🏆[^<]*)/g, '<span class="achievement-unlock">$1</span>');

  // Section headers (▶️, 📋, 📊, etc. at start of line)
  html = html.replace(/(^|<br>)(▶️\s*[^<]+)/g, '$1<span class="section-header section-next">$2</span>');
  html = html.replace(/(^|<br>)(⚡\s*[^<]+)/g, '$1<span class="section-header section-drift">$2</span>');

  // Next action footer
  html = html.replace(/(💡\s*[^<]+)/g, '<span class="next-action">$1</span>');

  return html;
}

// ─── Message Rendering ─────────────────────────
function addMessage(text, type, time = null, save = true) {
  const msg = document.createElement('div');
  msg.className = `message ${type}`;

  const displayTime = time || new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const avatar = type === 'user' ? '👤' : '🤖';

  // Use markdown renderer for bot messages, plain escape for user
  const rendered = type === 'bot' ? renderMarkdown(text) : escapeHtml(text);

  msg.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      <div class="msg-body">${rendered}</div>
      <span class="msg-time">${displayTime}</span>
    </div>
  `;

  chatMessages.appendChild(msg);
  scrollToBottom();

  if (save) saveToHistory(text, type, displayTime);
}

function saveToHistory(text, type, time) {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    history.push({ text, type, time });
    while (history.length > MAX_HISTORY) history.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

function restoreHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (history.length === 0) return;
    history.forEach(({ text, type, time }) => {
      addMessage(text, type, time, false);
    });
  } catch {}
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  chatMessages.innerHTML = '';
}

function addTypingIndicator() {
  const msg = document.createElement('div');
  msg.className = 'message bot typing-msg';
  msg.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  chatMessages.appendChild(msg);
  scrollToBottom();
  return msg;
}

function removeTypingIndicator(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── Clock ──────────────────────────────────────
function updateClock() {
  const now = new Date();
  headerTime.textContent = now.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ─── Start ──────────────────────────────────────
init();
