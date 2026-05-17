// Password gate middleware — simple cookie-based auth

const COOKIE_NAME = 'warroom_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Check if request is authenticated
 */
export function isAuthenticated(request, env) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = parseCookies(cookieHeader);
  return cookies[COOKIE_NAME] === hashPassword(env.APP_PASSWORD);
}

/**
 * Handle login attempt
 */
export function handleLogin(password, env) {
  if (password === env.APP_PASSWORD) {
    const hash = hashPassword(password);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${COOKIE_NAME}=${hash}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`,
      },
    });
  }

  return new Response(JSON.stringify({ success: false, error: 'Sai mật khẩu' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Simple hash for password (not crypto-grade, just for gate)
 */
function hashPassword(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return 'wrm_' + Math.abs(hash).toString(36);
}

/**
 * Parse cookie header into object
 */
function parseCookies(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  cookieStr.split(';').forEach((pair) => {
    const [key, ...vals] = pair.trim().split('=');
    if (key) cookies[key.trim()] = vals.join('=').trim();
  });
  return cookies;
}
