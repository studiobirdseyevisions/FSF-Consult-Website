// Private status page (/poster) and its actions. Password login, HttpOnly session cookie.
import { html, json, hasSession, makeSessionCookie, clearSessionCookie, sameOrigin, clientIp } from './http.mjs';
import { safeEqual } from './crypto.mjs';
import { formatEat, eatLocalToUtc, utcToEatLocal } from './time.mjs';
import { addEvent, resetForRetry } from './publish.mjs';
import { runDue, tokenStatus } from './runner.mjs';
import { isDryRun, LATE_WINDOW_MS } from './config.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `
:root{--navy:#25285E;--ink:#2D2D2D;--paper:#F0EFEF;--card:#fff;--line:#d9d8de;--muted:#6b6b76;--ok:#1f7a4d;--warn:#a15c00;--bad:#b3261e}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:var(--navy);color:#fff;padding:14px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
header h1{margin:0;font-size:18px}main{max-width:900px;margin:0 auto;padding:16px}
h2{font-size:16px;margin:24px 0 8px;color:var(--navy)}
.banner{padding:10px 12px;border-radius:8px;margin:8px 0;background:#fff;border-left:4px solid var(--muted)}
.banner.bad{border-color:var(--bad);background:#fdecea}.banner.warn{border-color:var(--warn);background:#fff4e0}.banner.ok{border-color:var(--ok)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin:8px 0}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.muted{color:var(--muted);font-size:13px}
.badge{font-size:12px;padding:2px 8px;border-radius:999px;background:#e8e8ee}
.s-needs_approval{background:#fff4e0}.s-queued{background:#e6ecff}.s-publishing{background:#e6f4ff}.s-published{background:#e3f4ea}.s-failed{background:#fdecea}.s-paused{background:#eee}
.thumbs{display:flex;gap:4px;flex-wrap:wrap;margin:8px 0}.thumbs img{width:56px;height:70px;object-fit:cover;border-radius:4px;border:1px solid var(--line)}
.thumbs a.vid{display:inline-flex;align-items:center;justify-content:center;width:56px;height:70px;border-radius:4px;background:#222;color:#fff;font-size:12px;text-decoration:none}
button{font:inherit;border:1px solid var(--navy);background:#fff;color:var(--navy);border-radius:8px;padding:6px 12px;cursor:pointer}
button.primary{background:var(--navy);color:#fff}button.danger{border-color:var(--bad);color:var(--bad)}
input{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:8px;max-width:100%}
details summary{cursor:pointer;color:var(--navy)}pre{white-space:pre-wrap;word-break:break-word;margin:6px 0;font:13px/1.4 ui-monospace,monospace;background:#f7f7f9;padding:8px;border-radius:6px}
.err{color:var(--bad)}a{color:var(--navy)}
`;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

function loginPage(message = '') {
  return page('FSF Poster: sign in', `<header><h1>FSF Poster</h1></header><main>
<form class="card" method="post" action="/api/poster/admin?op=login" style="max-width:360px">
<p><strong>Sign in</strong></p>${message ? `<p class="err">${esc(message)}</p>` : ''}
<p><input type="password" name="password" autocomplete="current-password" placeholder="Password" required autofocus style="width:100%"></p>
<p><button class="primary" type="submit">Sign in</button></p></form></main>`);
}

const LABEL = { needs_approval: 'Needs your approval', queued: 'Queued', paused: 'Paused', publishing: 'Publishing', published: 'Published', failed: 'Failed', deleted: 'Deleted' };
const TYPE = { image: 'Feed image', carousel: 'Carousel', reel: 'Reel', story: 'Story' };

function buttons(p) {
  const b = (action, label, cls = '') => `<button class="${cls}" data-action="${action}" data-id="${esc(p.id)}">${label}</button>`;
  const out = [];
  if (p.status === 'needs_approval') out.push(b('approve', 'Approve', 'primary'), b('pause', 'Pause'));
  if (p.status === 'queued') out.push(b('pause', 'Pause'));
  if (p.status === 'paused') out.push(b('resume', 'Resume', 'primary'));
  if (p.status === 'failed') out.push(b('retry', 'Retry', 'primary'));
  if (['needs_approval', 'queued', 'paused', 'failed'].includes(p.status)) out.push(b('publish_now', 'Publish now'));
  if (p.status !== 'publishing') out.push(b('delete', p.status === 'published' ? 'Remove from list' : 'Delete', 'danger'));
  return out.join(' ');
}

function postCard(p) {
  const thumbs = p.media.map((m, i) => m.kind === 'image'
    ? `<a href="${esc(m.url)}" target="_blank" rel="noopener"><img src="${esc(m.url)}" alt="${esc(m.alt || `item ${i + 1}`)}" loading="lazy"></a>`
    : `<a class="vid" href="${esc(m.url)}" target="_blank" rel="noopener">video</a>`).join('');
  const alts = p.media.filter((m) => m.alt).map((m, i) => `<li>${esc(m.alt)}</li>`).join('');
  const editable = ['needs_approval', 'queued', 'paused', 'failed'].includes(p.status);
  return `<div class="card" id="post-${esc(p.id)}">
<div class="row"><strong>${esc(formatEat(p.publish_at))}</strong><span class="badge">${esc(TYPE[p.type] || p.type)}</span><span class="badge s-${esc(p.status)}">${esc(LABEL[p.status] || p.status)}</span><span class="muted">${esc(p.id)}</span></div>
<div class="thumbs">${thumbs}</div>
${p.caption ? `<details><summary>Caption (${p.caption.length} characters)</summary><pre>${esc(p.caption)}</pre></details>` : '<div class="muted">No caption</div>'}
${alts ? `<details><summary>Alt text</summary><ol>${alts}</ol></details>` : ''}
${p.note ? `<div class="muted">Note: ${esc(p.note)}</div>` : ''}
${p.last_error ? `<p class="err">${esc(p.last_error)}</p>` : ''}
${p.next_attempt_at && p.status === 'queued' ? `<div class="muted">Next try: ${esc(formatEat(p.next_attempt_at))} (attempt ${p.attempts + 1} of 5)</div>` : ''}
${p.permalink ? `<p><a href="${esc(p.permalink)}" target="_blank" rel="noopener">Open on Instagram</a> · ${esc(formatEat(p.published_at))}</p>` : p.status === 'published' ? `<p class="muted">Published ${esc(formatEat(p.published_at))}</p>` : ''}
<div class="row">${buttons(p)}</div>
${editable ? `<div class="row" style="margin-top:8px"><input type="datetime-local" value="${esc(utcToEatLocal(p.publish_at))}" data-time-for="${esc(p.id)}" aria-label="New time in EAT"><button data-action="reschedule" data-id="${esc(p.id)}">Change time (EAT)</button></div>` : ''}
<details><summary class="muted">History</summary><pre>${esc((p.history || []).map((h) => `${formatEat(h.at)}  ${h.event}`).join('\n'))}</pre></details>
</div>`;
}

export async function renderDashboard({ store, env, now = Date.now() }) {
  const [posts, last, quota, authErr, tok] = await Promise.all([store.allPosts(), store.lastRun(), store.getQuota(), store.getAuthError(), tokenStatus(store, env)]);
  const banners = [];
  if (isDryRun(env)) banners.push(`<div class="banner warn"><strong>Test mode:</strong> this deployment never posts to Instagram (preview or POSTER_DRY_RUN).</div>`);
  if (authErr) banners.push(`<div class="banner bad"><strong>Publishing is held:</strong> Instagram rejected the access token (${esc(authErr.message)}). Make a new token, paste it into Vercel as IG_ACCESS_TOKEN and redeploy, or <button data-action="clear_token_error">Try again</button></div>`);
  if (!tok.present) banners.push(`<div class="banner bad">No Instagram token set (IG_ACCESS_TOKEN).</div>`);
  if (!env.TOKEN_ENC_KEY) banners.push(`<div class="banner warn">TOKEN_ENC_KEY is not set, so the token can't be refreshed automatically.</div>`);
  const lastAge = last ? (now - Date.parse(last.at)) / 60000 : Infinity;
  if (lastAge > 30) banners.push(`<div class="banner bad">The timer has not run for ${last ? Math.round(lastAge) + ' minutes' : 'a while (never)'}. Check GitHub → Actions → "FSF poster timer".</div>`);

  let tokenLine = 'unknown';
  if (tok.expires_at) {
    const days = Math.floor((Date.parse(tok.expires_at) - now) / 86400000);
    tokenLine = `${days} days left (until ${formatEat(tok.expires_at)})`;
    if (days < 14) banners.push(`<div class="banner bad">The Instagram token expires in ${days} days and automatic refresh is failing${tok.last_refresh_error ? `: ${esc(tok.last_refresh_error)}` : ''}.</div>`);
  } else if (tok.present) tokenLine = 'set; expiry known after the first automatic refresh (within a day)';

  const groups = {
    'Needs your approval': posts.filter((p) => p.status === 'needs_approval'),
    'Coming up': posts.filter((p) => ['queued', 'paused', 'publishing'].includes(p.status)),
    Failed: posts.filter((p) => p.status === 'failed'),
    'Published (latest 30)': posts.filter((p) => p.status === 'published').sort((a, b) => (b.published_at || '').localeCompare(a.published_at || '')).slice(0, 30),
  };
  const sections = Object.entries(groups).map(([name, list]) => `<h2>${esc(name)} (${list.length})</h2>${list.length ? list.map(postCard).join('') : '<p class="muted">Nothing here.</p>'}`).join('');

  const body = `<header><h1>FSF Poster · @fsfconsult</h1><div class="row"><button data-action="run_now">Run now</button><button data-action="logout">Sign out</button></div></header><main>
${banners.join('')}
<div class="grid">
<div class="card"><div class="muted">Last timer run</div><strong>${last ? esc(formatEat(last.at)) : 'never'}</strong>${last?.skipped ? `<div class="muted">${esc(last.skipped)}</div>` : ''}</div>
<div class="card"><div class="muted">Instagram posts used, last 24 h</div><strong>${quota ? `${quota.usage} of ${quota.total}` : '—'}</strong></div>
<div class="card"><div class="muted">Access token</div><strong>${esc(tokenLine)}</strong></div>
</div>
<p class="muted">All times are East Africa Time (EAT, UTC+3). The timer runs about every 5 minutes, so posts go out a few minutes after their time. Posts more than 6 hours late are not sent automatically.</p>
${sections}
<p id="msg" class="muted" aria-live="polite"></p>
</main>
<script>
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action, id = btn.dataset.id;
  const confirmText = { delete: 'Delete this post from the queue? (It does not delete anything already on Instagram.)', publish_now: 'Publish this post to Instagram now?', approve: 'Approve this post? It will be published at its time.' }[action];
  if (confirmText && !confirm(confirmText)) return;
  const payload = { action, id };
  if (action === 'reschedule') payload.local = document.querySelector('[data-time-for="' + CSS.escape(id) + '"]').value;
  btn.disabled = true;
  document.getElementById('msg').textContent = action === 'publish_now' || action === 'run_now' ? 'Working… (videos can take up to a minute)' : 'Saving…';
  try {
    const r = await fetch('/api/poster/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FSFP': '1' }, body: JSON.stringify(payload), credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (action === 'logout') { location.href = '/poster'; return; }
    if (!r.ok || !j.ok) { alert(j.error || ('Error ' + r.status)); btn.disabled = false; document.getElementById('msg').textContent = ''; return; }
    if (j.message) alert(j.message);
    location.reload();
  } catch (err) { alert('Network error'); btn.disabled = false; }
});
</script>`;
  return page('FSF Poster', body);
}

export async function handleAdminGet(request, { env, store, now = Date.now() }) {
  if (!env.ADMIN_PASSWORD) return html(page('FSF Poster', '<main><p>ADMIN_PASSWORD is not set in Vercel yet.</p></main>'), 503);
  if (!hasSession(request, env, now)) return html(loginPage());
  return html(await renderDashboard({ store, env, now }));
}

async function login(request, { env, store, now }) {
  const ip = clientIp(request);
  if ((await store.loginFailures(ip)) >= 10) return html(loginPage('Too many wrong tries. Wait 15 minutes.'), 429);
  const form = await request.formData().catch(() => null);
  const pw = form?.get('password');
  if (!safeEqual(typeof pw === 'string' ? pw : '', env.ADMIN_PASSWORD)) {
    await store.addLoginFailure(ip);
    return html(loginPage('Wrong password.'), 401);
  }
  return new Response(null, { status: 303, headers: { Location: '/poster', 'Set-Cookie': makeSessionCookie(env, now), 'Cache-Control': 'no-store' } });
}

export async function handleAdminPost(request, { env, store, now = Date.now(), runner = runDue }) {
  if (!env.ADMIN_PASSWORD) return json({ ok: false, error: 'ADMIN_PASSWORD not set' }, 503);
  const op = new URL(request.url).searchParams.get('op');
  if (op === 'login') {
    if (!sameOrigin(request)) return html(loginPage('Please sign in from the page itself.'), 403);
    return login(request, { env, store, now });
  }
  if (!hasSession(request, env, now)) return json({ ok: false, error: 'Signed out. Reload the page.' }, 401);
  if (!sameOrigin(request) || request.headers.get('x-fsfp') !== '1') return json({ ok: false, error: 'forbidden' }, 403);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad request' }, 400); }
  const { action, id } = body || {};
  const at = new Date(now).toISOString();

  if (action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  if (action === 'clear_token_error') { await store.clearAuthError(); return json({ ok: true }); }
  if (action === 'run_now') {
    const s = await runner({ store, env });
    return json({ ok: true, message: s.skipped ? `Held: ${s.skipped}` : `Due ${s.due}: published ${s.published}, still processing ${s.waiting}, will retry ${s.retry}, failed ${s.failed}.` });
  }

  if (typeof id !== 'string') return json({ ok: false, error: 'missing id' }, 400);
  if (!(await store.lock(id))) return json({ ok: false, error: 'This post is being published right now. Try again in a minute.' }, 409);
  let runAfter = false;
  try {
    const p = await store.getPost(id);
    if (!p || p.status === 'deleted') return json({ ok: false, error: 'Post not found' }, 404);
    const deny = () => json({ ok: false, error: `Not possible while the post is "${LABEL[p.status] || p.status}".` }, 409);
    switch (action) {
      case 'approve':
        if (p.status !== 'needs_approval') return deny();
        p.status = 'queued'; p.approved_at = at; addEvent(p, now, 'approved by the user');
        break;
      case 'pause':
        if (!['needs_approval', 'queued'].includes(p.status)) return deny();
        p.status = 'paused'; addEvent(p, now, 'paused by the user');
        break;
      case 'resume':
        if (p.status !== 'paused') return deny();
        p.status = p.approved_at ? 'queued' : 'needs_approval'; addEvent(p, now, 'resumed by the user');
        break;
      case 'retry':
        if (p.status !== 'failed') return deny();
        resetForRetry(p);
        if (now - Date.parse(p.publish_at) > LATE_WINDOW_MS) p.publish_at = at;
        p.approved_at = p.approved_at || at;
        addEvent(p, now, 'retry requested by the user');
        break;
      case 'reschedule': {
        if (!['needs_approval', 'queued', 'paused', 'failed'].includes(p.status)) return deny();
        const utc = eatLocalToUtc(body.local);
        if (!utc) return json({ ok: false, error: 'Pick a date and time.' }, 400);
        if (Date.parse(utc) < now - 60000) return json({ ok: false, error: 'That time is in the past. Use "Publish now" instead.' }, 400);
        if (p.status === 'failed') { resetForRetry(p); if (!p.approved_at) p.status = 'needs_approval'; }
        p.publish_at = utc; p.force = false; addEvent(p, now, `time changed to ${formatEat(utc)}`);
        break;
      }
      case 'publish_now':
        if (!['needs_approval', 'queued', 'paused', 'failed'].includes(p.status)) return deny();
        resetForRetry(p);
        p.publish_at = at; p.force = true; p.approved_at = p.approved_at || at;
        addEvent(p, now, 'publish now requested by the user');
        runAfter = true;
        break;
      case 'delete':
        if (p.status === 'publishing') return deny();
        p.status = 'deleted'; addEvent(p, now, 'deleted by the user');
        break;
      default:
        return json({ ok: false, error: 'unknown action' }, 400);
    }
    await store.savePost(p);
  } finally {
    await store.unlock(id);
  }
  if (runAfter) {
    const s = await runner({ store, env, onlyId: id });
    const p = await store.getPost(id);
    const msg = p.status === 'published' ? 'Published.' : p.status === 'publishing' ? 'Instagram is still processing the video; it will finish on the next timer run.' : `Not published yet: ${p.last_error || s.skipped || p.status}`;
    return json({ ok: true, message: msg });
  }
  return json({ ok: true });
}
