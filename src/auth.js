// Password gate middleware — SHA-256 hash + secure cookies

const COOKIE_NAME = 'warroom_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Hash password using SHA-256 (Web Crypto API)
 */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '_warroom_salt_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'wrm_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check if request is authenticated
 */
export async function isAuthenticated(request, env) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = parseCookies(cookieHeader);
  const expectedHash = await hashPassword(env.APP_PASSWORD);
  return cookies[COOKIE_NAME] === expectedHash;
}

/**
 * Handle login attempt
 */
export async function handleLogin(password, env) {
  if (password === env.APP_PASSWORD) {
    const hash = await hashPassword(password);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${COOKIE_NAME}=${hash}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`,
      },
    });
  }

  return new Response(JSON.stringify({ success: false, error: 'Sai mật khẩu' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
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
