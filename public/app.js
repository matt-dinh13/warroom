// War Room — Frontend Chat Logic

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
  // Check if already authenticated (try a health check)
  checkAuth();
  
  // Update clock
  updateClock();
  setInterval(updateClock, 1000);

  // Restore chat history
  restoreHistory();

  // Auth form
  authForm.addEventListener('submit', handleLogin);

  // Chat form
  chatForm.addEventListener('submit', handleChat);

  // Textarea auto-resize + enter to send
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

  // Quick action buttons
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
      // Try chat to see if authed
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

  // Add user message
  addMessage(message, 'user');
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // Show typing indicator
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

    // If needs confirmation, show follow-up
    if (data.follow_up_question) {
      setTimeout(() => {
        addMessage(data.follow_up_question, 'bot');
      }, 500);
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

// ─── Message Rendering ─────────────────────────
function addMessage(text, type, time = null, save = true) {
  const msg = document.createElement('div');
  msg.className = `message ${type}`;

  const displayTime = time || new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const avatar = type === 'user' ? '👤' : '🤖';

  msg.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      <p>${escapeHtml(text)}</p>
      <span class="msg-time">${displayTime}</span>
    </div>
  `;

  chatMessages.appendChild(msg);
  scrollToBottom();

  // Save to localStorage
  if (save) saveToHistory(text, type, displayTime);
}

function saveToHistory(text, type, time) {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    history.push({ text, type, time });
    // Keep only last MAX_HISTORY messages
    while (history.length > MAX_HISTORY) history.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

function restoreHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (history.length === 0) return;
    history.forEach(({ text, type, time }) => {
      addMessage(text, type, time, false); // false = don't re-save
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
