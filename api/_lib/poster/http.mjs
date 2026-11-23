// Small helpers shared by the three endpoints.
import { safeEqual, hmac } from './crypto.mjs';
import { SESSION_HOURS } from './config.mjs';

export const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...headers } });
}

export function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' https://fsfconsult.vercel.app; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      // 'same-origin', not 'no-referrer': with no-referrer browsers send "Origin: null" on our own form posts.
      'Referrer-Policy': 'same-origin',
      ...NO_STORE,
      ...headers,
    },
  });
}

export function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

export function checkBearer(request, secret) {
  return Boolean(secret) && safeEqual(bearer(request), secret);
}

export function clientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

// ---- status page session (HttpOnly cookie, HMAC-signed, 12 h) ----
const COOKIE = 'fsfp_session';

function sessionKey(env) {
  return `${env.ADMIN_PASSWORD || ''}|${env.TOKEN_ENC_KEY || ''}`;
}

export function makeSessionCookie(env, nowMs = Date.now()) {
  const exp = nowMs + SESSION_HOURS * 3600 * 1000;
  const value = `${exp}.${hmac(String(exp), sessionKey(env))}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function hasSession(request, env, nowMs = Date.now()) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookies = request.headers.get('cookie') || '';
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < nowMs) return false;
  return safeEqual(sig, hmac(exp, sessionKey(env)));
}

// Actions must come from our own page: same Origin and a custom header (blocks cross-site forms).
export function sameOrigin(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
