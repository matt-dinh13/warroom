// Worker entry point — route API requests

import { isAuthenticated, handleLogin } from './auth.js';
import { processChat } from './triage.js';
import { handleTelegramWebhook, setTelegramWebhook } from './telegram.js';
import { handleScheduled } from './reminders.js';
import { backfillDoDate } from './notion.js';

// ─── Security: Never leak secrets in any response ───────────
const SECRET_KEYS = ['MINIMAX_API_KEY', 'NOTION_API_KEY', 'NOTION_TASKS_DB_ID', 'NOTION_DAILY_DB_ID', 'APP_PASSWORD', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];

function sanitizeResponse(result, env) {
  let text = JSON.stringify(result);

  // Strip any env secret values that might have leaked through AI output
  for (const key of SECRET_KEYS) {
    const val = env[key];
    if (val && val.length > 4) {
      // Replace full value and partial prefixes (first 8+ chars)
      text = text.replaceAll(val, '[REDACTED]');
      if (val.length > 12) {
        text = text.replaceAll(val.substring(0, 12), '[REDACTED]');
      }
    }
  }

  return JSON.parse(text);
}

function sanitizeError(errMessage, env) {
  let msg = errMessage || 'Unknown error';
  for (const key of SECRET_KEYS) {
    const val = env[key];
    if (val && val.length > 4) {
      msg = msg.replaceAll(val, '[REDACTED]');
    }
  }
  return msg;
}

// ─── Rate Limiting (in-memory, per-isolate) ───────────────
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 30; // requests per window
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

export default {
  async fetch(request, env, ctx) {
    // Rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(clientIP)) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Thử lại sau 1 phút.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } }
      );
    }
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ─── API Routes ───────────────────────────────────
    if (path.startsWith('/api/')) {
      try {
        // POST /api/auth — Login
        if (path === '/api/auth' && request.method === 'POST') {
          const body = await request.json();
          const response = await handleLogin(body.password || '', env);
          // Add CORS headers to auth response
          const newHeaders = new Headers(response.headers);
          Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
          return new Response(response.body, {
            status: response.status,
            headers: newHeaders,
          });
        }

        // POST /api/chat — Main chat endpoint (requires auth)
        if (path === '/api/chat' && request.method === 'POST') {
          if (!(await isAuthenticated(request, env))) {
            return new Response(
              JSON.stringify({ error: 'Chưa đăng nhập' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          const body = await request.json();
          const message = body.message?.trim();

          if (!message) {
            return new Response(
              JSON.stringify({ error: 'Message trống' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          // Lightweight auth check — don't call AI for ping
          if (message === '__ping__') {
            return new Response(
              JSON.stringify({ intent: 'PING', response_text: 'pong' }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          const result = await processChat(message, env, 'web');

          // Security: sanitize before sending to client
          const safeResult = sanitizeResponse(result, env);

          return new Response(JSON.stringify(safeResult), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // GET /api/health — Health check
        if (path === '/api/health') {
          return new Response(
            JSON.stringify({
              status: 'ok',
              timestamp: new Date().toISOString(),
              version: '2.0.0',
              telegram: !!env.TELEGRAM_BOT_TOKEN,
              cron: true,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // POST /api/telegram — Telegram webhook endpoint
        if (path === '/api/telegram' && request.method === 'POST') {
          const update = await request.json();
          return await handleTelegramWebhook(update, env, processChat);
        }

        // POST /api/setup-telegram — Set webhook URL (requires auth)
        if (path === '/api/setup-telegram' && request.method === 'POST') {
          if (!(await isAuthenticated(request, env))) {
            return new Response(
              JSON.stringify({ error: 'Unauthorized' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          const workerUrl = url.origin;
          const webhookUrl = `${workerUrl}/api/telegram`;
          const result = await setTelegramWebhook(env.TELEGRAM_BOT_TOKEN, webhookUrl);
          return new Response(
            JSON.stringify({ webhook_url: webhookUrl, telegram_response: result }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // POST /api/backfill-dodate — One-time: copy Deadline → Do Date (requires auth)
        if (path === '/api/backfill-dodate' && request.method === 'POST') {
          if (!(await isAuthenticated(request, env))) {
            return new Response(
              JSON.stringify({ error: 'Unauthorized' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const result = await backfillDoDate(env);
          return new Response(
            JSON.stringify({ success: true, ...result }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // 404 for unknown API routes
        return new Response(
          JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        console.error('API Error:', err);
        return new Response(
          JSON.stringify({ error: 'Internal server error', details: sanitizeError(err.message, env) }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ─── Static Assets (handled by Cloudflare) ─────────
    return env.ASSETS.fetch(request);
  },

  // ─── Cron Triggers (auto-reminders via Telegram) ──────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env));
  },
};
