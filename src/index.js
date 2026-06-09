// Worker entry point — route API requests

import { isAuthenticated, handleLogin, handleLogout } from './auth.js';
import { processChat, tryDirectParse } from './triage.js';
import { handleTelegramWebhook, setTelegramWebhook } from './telegram.js';
import { handleScheduled } from './reminders.js';
import { backfillDoDate, queryTasks, createTask, updateTaskStatusById, updateTaskSchedule } from './notion.js';
import { recordDelta, getSummary, buildStatsReport, getChronicDefers, clearDeferCount } from './analytics.js';

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

        // POST /api/logout — Logout (clear cookie)
        if (path === '/api/logout' && request.method === 'POST') {
          const response = handleLogout();
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

          let result;
          try {
            result = await processChat(message, env, 'web');
          } catch (chatErr) {
            console.error('Chat processing error:', chatErr);
            const isTimeout = chatErr.message?.includes('abort') || chatErr.name === 'AbortError';

            // Fallback: try direct parse for task creation even when AI fails
            if (isTimeout) {
              const directTask = tryDirectParse(message);
              if (directTask) {
                try {
                  const { buildCaptureConfirmation } = await import('./responses.js');
                  const tasks = Array.isArray(directTask) ? directTask : [directTask];
                  for (const t of tasks) {
                    await createTask(t, env);
                  }
                  const confirmTexts = tasks.map(t => buildCaptureConfirmation(t));
                  result = {
                    intent: 'CAPTURE',
                    response_text: tasks.length > 1
                      ? `✅ Đã tạo ${tasks.length} tasks:\n\n${confirmTexts.join('\n---\n')}`
                      : confirmTexts[0],
                    needs_confirmation: false,
                  };
                } catch (createErr) {
                  console.error('Direct create fallback error:', createErr);
                  result = {
                    intent: 'CLARIFY',
                    response_text: `❌ Tạo task thất bại: ${createErr.message?.substring(0, 80)}`,
                    needs_confirmation: false,
                  };
                }
              } else {
                result = {
                  intent: 'CLARIFY',
                  response_text: '⏳ AI đang bận hoặc quá tải. Thử lại hoặc dùng lệnh nhanh:\n• `plan` — xem ưu tiên\n• `list` — danh sách task',
                  needs_confirmation: false,
                };
              }
            } else {
              result = {
                intent: 'CLARIFY',
                response_text: `❌ Lỗi xử lý: ${chatErr.message?.substring(0, 100)}. Thử lại nhé.`,
                needs_confirmation: false,
              };
            }
          }

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
              version: '5.8.0',
              telegram: !!env.TELEGRAM_BOT_TOKEN,
              cron: true,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // ─── Board API Endpoints ─────────────────────────

        // GET /api/tasks — Fetch all tasks for kanban board
        if (path === '/api/tasks' && request.method === 'GET') {
          if (!(await isAuthenticated(request, env))) {
            return new Response(
              JSON.stringify({ error: 'Unauthorized' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const refresh = url.searchParams.get('refresh');
          const [active, doneToday, materials] = await Promise.all([
            queryTasks('board_all', env, { refresh }),
            queryTasks('board_done_today', env, { refresh }),
            queryTasks('materials', env, { refresh }),
          ]);
          return new Response(
            JSON.stringify({ active, doneToday, materials }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // POST /api/tasks/create — Quick add (no AI)
        if (path === '/api/tasks/create' && request.method === 'POST') {
          if (!(await isAuthenticated(request, env))) {
            return new Response(
              JSON.stringify({ error: 'Unauthorized' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const body = await request.json();
          if (!body.title?.trim()) {
            return new Response(
              JSON.stringify({ error: 'Title is required' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const taskData = {
            title: body.title.trim(),
            project: body.project || 'PERSONAL',
            urgency: body.project === 'MATERIALS' ? '⚪ Someday' : (body.urgency || '🟡 Important'),
            source: body.source || 'EIT',
          };
          if (body.deadline) taskData.due_date = body.deadline;
          if (body.resource) taskData.resource = body.resource;
          const result = await createTask(taskData, env);
          await recordDelta(env, { captures: { board: 1 } });
          return new Response(
            JSON.stringify({ success: true, task: result }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // POST /api/tasks/update — Update status by page ID
        if (path === '/api/tasks/update' && request.method === 'POST') {
          if (!(await isAuthenticated(request, env))) {
            return new Response(
              JSON.stringify({ error: 'Unauthorized' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const body = await request.json();
          if (!body.id || !body.status) {
            return new Response(
              JSON.stringify({ error: 'id and status are required' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const result = await updateTaskStatusById(body.id, body.status, env);
          if (body.status === 'Completed') {
            await recordDelta(env, { completions: { board: 1 } });
            await clearDeferCount(env, body.id);
          }
          return new Response(
            JSON.stringify({ success: true, task: result }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // GET /api/calendar?week=YYYY-MM-DD — Calendar view tasks
        if (path === '/api/calendar' && request.method === 'GET') {
          if (!(await isAuthenticated(request, env))) {
            return new Response(
              JSON.stringify({ error: 'Unauthorized' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const weekParam = url.searchParams.get('week');
          // Use the provided date or today (in UTC — CF Workers run in UTC)
          const refDate = weekParam ? new Date(weekParam + 'T12:00:00Z') : new Date();
          // Adjust to Monday (ISO week start)
          const day = refDate.getUTCDay();
          const diff = day === 0 ? -6 : 1 - day;
          const monday = new Date(refDate);
          monday.setUTCDate(refDate.getUTCDate() + diff);
          const sunday = new Date(monday);
          sunday.setUTCDate(monday.getUTCDate() + 6);

          // Format as YYYY-MM-DD strings
          const pad = n => String(n).padStart(2, '0');
          const ws = `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
          const we = `${sunday.getUTCFullYear()}-${pad(sunday.getUTCMonth() + 1)}-${pad(sunday.getUTCDate())}`;

          const refresh = url.searchParams.get('refresh');
          const tasks = await queryTasks('calendar_week', env, { weekStart: ws, weekEnd: we, refresh });
          return new Response(
            JSON.stringify({ weekStart: ws, weekEnd: we, tasks }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // POST /api/calendar/schedule — Set scheduled time for a task
        if (path === '/api/calendar/schedule' && request.method === 'POST') {
          if (!(await isAuthenticated(request, env))) {
            return new Response(
              JSON.stringify({ error: 'Unauthorized' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const body = await request.json();
          if (!body.id) {
            return new Response(
              JSON.stringify({ error: 'id is required' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const result = await updateTaskSchedule(body.id, body.scheduled || null, env);
          return new Response(
            JSON.stringify({ success: true, task: result }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // GET /api/analytics?days=7 — Usage analytics (requires auth)
        if (path === '/api/analytics' && request.method === 'GET') {
          if (!(await isAuthenticated(request, env))) {
            return new Response(
              JSON.stringify({ error: 'Unauthorized' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const days = Math.min(parseInt(url.searchParams.get('days') || '7'), 90);
          const summary = await getSummary(env, days);
          const chronicDefers = await getChronicDefers(env, 3);
          return new Response(
            JSON.stringify({ ...(summary || {}), chronic_defers: chronicDefers }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // POST /api/telegram — Telegram webhook endpoint
        if (path === '/api/telegram' && request.method === 'POST') {
          // Verify secret token (set during setWebhook) to block spoofed requests
          const secret = env.TELEGRAM_WEBHOOK_SECRET;
          if (secret) {
            const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
            if (provided !== secret) {
              return new Response('Forbidden', { status: 403 });
            }
          }
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
          const result = await setTelegramWebhook(env.TELEGRAM_BOT_TOKEN, webhookUrl, env.TELEGRAM_WEBHOOK_SECRET || null);
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
