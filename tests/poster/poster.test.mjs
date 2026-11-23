// Run: node --test tests/poster/
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryCommander, createStore } from '../../api/_lib/poster/store.mjs';
import { normalizePost, checkMediaOnline } from '../../api/_lib/poster/validate.mjs';
import { processPost, resetForRetry } from '../../api/_lib/poster/publish.mjs';
import { runDue, resolveToken } from '../../api/_lib/poster/runner.mjs';
import { IgError, classify, igClient } from '../../api/_lib/poster/instagram.mjs';
import { formatEat, eatLocalToUtc, utcToEatLocal, parseZoned } from '../../api/_lib/poster/time.mjs';
import { encrypt, decrypt } from '../../api/_lib/poster/crypto.mjs';
import { handlePost, handleGet } from '../../api/_lib/poster/agent.mjs';
import { handleAdminGet, handleAdminPost } from '../../api/_lib/poster/admin.mjs';
import { makeSessionCookie } from '../../api/_lib/poster/http.mjs';

const BASE = 'https://fsfconsult.vercel.app/campaign/2026-11/';
const T0 = Date.parse('2026-11-24T15:00:00Z'); // 18:00 EAT

function clock(start = T0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; }, sleep: async (ms) => { t += ms; } };
}

function fakeIg({ statuses = [], publishError = null, createError = null } = {}) {
  const calls = [];
  let n = 0;
  const st = [...statuses];
  return {
    calls,
    createContainer: async (p) => { calls.push(['create', p]); if (createError) throw createError; return { id: `c${++n}` }; },
    containerStatus: async (id) => { calls.push(['status', id]); return { status_code: st.length ? st.shift() : 'FINISHED' }; },
    publish: async (id) => { calls.push(['publish', id]); if (publishError) { const e = publishError; publishError = null; throw e; } return { id: 'm1' }; },
    mediaInfo: async () => ({ permalink: 'https://www.instagram.com/p/abc/' }),
    publishingLimit: async () => ({ data: [{ quota_usage: 3, config: { quota_total: 50 } }] }),
    refreshToken: async () => ({ access_token: 'NEWTOKEN', expires_in: 5184000 }),
  };
}

function mkPost(over = {}) {
  const { post, errors } = normalizePost({
    id: 'test-post', type: 'image', publish_at: '2026-11-24T19:00+03:00',
    media: [{ url: BASE + 's2-feed.jpg', alt: 'FSF graphic' }], caption: 'Hello #FSF', ...over,
  }, { now: T0 - 3600000 });
  assert.deepEqual(errors, []);
  return post;
}

const env0 = { IG_ACCESS_TOKEN: 'ENVTOKEN', IG_USER_ID: '123', TOKEN_ENC_KEY: 'k'.repeat(64), CRON_SECRET: 'cron', AGENT_API_KEY: 'agent', ADMIN_PASSWORD: 'pw' };
const newStore = (c) => createStore(memoryCommander(c.now), {});

// ---------- time ----------
test('EAT conversions', () => {
  assert.equal(parseZoned('2026-11-24T19:00+03:00'), '2026-11-24T16:00:00.000Z');
  assert.equal(parseZoned('2026-11-24T19:00'), null, 'zone required');
  assert.equal(formatEat('2026-11-24T16:00:00Z'), 'Tue 24 Nov 2026, 19:00 EAT');
  assert.equal(eatLocalToUtc('2026-11-24T19:00'), '2026-11-24T16:00:00.000Z');
  assert.equal(utcToEatLocal('2026-11-24T16:00:00Z'), '2026-11-24T19:00');
});

// ---------- validation ----------
test('validation catches bad posts', () => {
  const v = (o) => normalizePost({ id: 'abc', type: 'image', publish_at: '2026-11-24T19:00+03:00', media: [BASE + 'a.jpg'], ...o }, { now: T0 - 3600000 });
  assert.match(v({ media: ['https://evil.example/a.jpg'] }).errors.join(), /must start with/);
  assert.match(v({ media: [BASE + 'a.png'] }).errors.join(), /jpg/);
  assert.match(v({ type: 'carousel' }).errors.join(), /2 to 10/);
  assert.match(v({ type: 'carousel', media: Array(11).fill(BASE + 'a.jpg') }).errors.join(), /2 to 10/);
  assert.match(v({ type: 'reel' }).errors.join(), /mp4/);
  assert.match(v({ publish_at: '2026-11-20T19:00+03:00' }).errors.join(), /past/);
  assert.match(v({ caption: 'x'.repeat(2201) }).errors.join(), /2200/);
  assert.match(v({ caption: Array(31).fill('#a').join(' ') }).errors.join(), /hashtags/);
  assert.match(v({ id: 'Bad ID' }).errors.join(), /id must/);
  const story = v({ type: 'story', caption: 'hi', media: [{ url: BASE + 's.jpg', alt: 'x' }] });
  assert.equal(story.errors.length, 0);
  assert.equal(story.post.caption, '');
  assert.equal(story.post.media[0].alt, null);
  assert.equal(story.warnings.length, 2);
});

test('online media check: status, type, size', async () => {
  const post = mkPost({ type: 'carousel', media: [BASE + 'a.jpg', BASE + 'b.jpg', BASE + 'v.mp4'] });
  const fetchImpl = async (url) => {
    if (url.endsWith('a.jpg')) return new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '1000' } });
    if (url.endsWith('b.jpg')) return new Response(null, { status: 404 });
    return new Response(null, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(400 * 1048576) } });
  };
  const errs = await checkMediaOnline(post, fetchImpl);
  assert.equal(errs.length, 2);
  assert.match(errs.join(), /404/);
  assert.match(errs.join(), /300 MB/);
});

// ---------- publishing ----------
test('feed image: container with alt text, then publish, then permalink', async () => {
  const c = clock(); const ig = fakeIg(); const post = mkPost();
  const out = await processPost(post, { ig, now: c.now, sleep: c.sleep, persist: async () => {} });
  assert.equal(out, 'published');
  assert.equal(post.status, 'published');
  assert.equal(post.permalink, 'https://www.instagram.com/p/abc/');
  assert.deepEqual(ig.calls[0], ['create', { image_url: BASE + 's2-feed.jpg', caption: 'Hello #FSF', alt_text: 'FSF graphic' }]);
  assert.deepEqual(ig.calls.map((x) => x[0]), ['create', 'status', 'publish']);
});

test('carousel: children first, then parent with children ids and caption', async () => {
  const c = clock(); const ig = fakeIg();
  const post = mkPost({ type: 'carousel', media: [{ url: BASE + '1.jpg', alt: 'one' }, BASE + '2.jpg', BASE + '3.mp4'] });
  const out = await processPost(post, { ig, now: c.now, sleep: c.sleep, persist: async () => {} });
  assert.equal(out, 'published');
  const creates = ig.calls.filter((x) => x[0] === 'create').map((x) => x[1]);
  assert.deepEqual(creates[0], { image_url: BASE + '1.jpg', is_carousel_item: 'true', alt_text: 'one' });
  assert.deepEqual(creates[2], { video_url: BASE + '3.mp4', media_type: 'VIDEO', is_carousel_item: 'true' });
  assert.deepEqual(creates[3], { media_type: 'CAROUSEL', children: 'c1,c2,c3', caption: 'Hello #FSF' });
});

test('reel: waits across runs while video is IN_PROGRESS, never re-creates', async () => {
  const c = clock(); const ig = fakeIg({ statuses: Array(20).fill('IN_PROGRESS') });
  const post = mkPost({ type: 'reel', media: [BASE + 'r.mp4'], cover_url: BASE + 'cover.jpg' });
  const ctx = { ig, now: c.now, sleep: c.sleep, persist: async () => {}, waitMs: 20000, pollMs: 5000 };
  assert.equal(await processPost(post, ctx), 'waiting');
  assert.equal(post.status, 'publishing');
  assert.equal(post.attempts, 0);
  const first = ig.calls.find((x) => x[0] === 'create')[1];
  assert.equal(first.media_type, 'REELS');
  assert.equal(first.cover_url, BASE + 'cover.jpg');
  assert.equal(first.share_to_feed, 'true');
  // next run: video done
  ig.calls.length = 0;
  const ig2 = { ...ig, containerStatus: async () => ({ status_code: 'FINISHED' }) };
  assert.equal(await processPost(post, { ...ctx, ig: ig2 }), 'published');
  assert.equal(ig.calls.filter((x) => x[0] === 'create').length, 0);
});

test('story video uses STORIES and no caption', async () => {
  const c = clock(); const ig = fakeIg();
  const post = mkPost({ type: 'story', media: [BASE + 's.mp4'], caption: '' });
  await processPost(post, { ig, now: c.now, sleep: c.sleep, persist: async () => {} });
  assert.deepEqual(ig.calls[0][1], { media_type: 'STORIES', video_url: BASE + 's.mp4' });
});

test('ERROR status fails at once with the reason', async () => {
  const c = clock(); const ig = fakeIg({ statuses: ['ERROR'] });
  const post = mkPost();
  assert.equal(await processPost(post, { ig, now: c.now, sleep: c.sleep, persist: async () => {} }), 'failed');
  assert.match(post.last_error, /could not process/);
});

test('transient errors back off and stop after 5 attempts', async () => {
  const c = clock();
  const post = mkPost();
  const ctx = (ig) => ({ ig, now: c.now, sleep: c.sleep, persist: async () => {} });
  const waits = [];
  for (let i = 0; i < 5; i++) {
    const ig = fakeIg({ createError: new IgError({ message: 'server busy', kind: 'transient' }) });
    const out = await processPost(post, ctx(ig));
    if (i < 4) { assert.equal(out, 'retry'); waits.push((Date.parse(post.next_attempt_at) - c.now()) / 60000); }
    else assert.equal(out, 'failed');
  }
  assert.deepEqual(waits, [5, 10, 20, 40]);
  assert.equal(post.status, 'failed');
});

test('permanent error fails straight away', async () => {
  const c = clock();
  const post = mkPost();
  const ig = fakeIg({ createError: classify({ code: 100, error_subcode: 2207026, message: 'Unsupported format' }, 400) });
  assert.equal(await processPost(post, { ig, now: c.now, sleep: c.sleep, persist: async () => {} }), 'failed');
  assert.match(post.last_error, /Unsupported format \(code 100\/2207026\)/);
});

test('ambiguous publish timeout: container PUBLISHED means done, no second publish', async () => {
  const c = clock();
  const ig = fakeIg({ statuses: ['FINISHED', 'PUBLISHED'], publishError: new IgError({ message: 'timeout', kind: 'transient', ambiguous: true }) });
  const post = mkPost();
  assert.equal(await processPost(post, { ig, now: c.now, sleep: c.sleep, persist: async () => {} }), 'published');
  assert.equal(ig.calls.filter((x) => x[0] === 'publish').length, 1);
});

test('expired container is cleared and retried', async () => {
  const c = clock(); const ig = fakeIg({ statuses: ['EXPIRED'] });
  const post = mkPost();
  assert.equal(await processPost(post, { ig, now: c.now, sleep: c.sleep, persist: async () => {} }), 'retry');
  assert.equal(post.container_id, null);
});

test('more than 6 h late is skipped unless forced', async () => {
  const c = clock(Date.parse('2026-11-24T23:00:00Z'));
  const post = mkPost();
  assert.equal(await processPost(post, { ig: fakeIg(), now: c.now, sleep: c.sleep, persist: async () => {} }), 'failed');
  assert.match(post.last_error, /Missed window/);
  resetForRetry(post); post.force = true;
  assert.equal(await processPost(post, { ig: fakeIg(), now: c.now, sleep: c.sleep, persist: async () => {} }), 'published');
});

test('auth error holds the post without using an attempt', async () => {
  const c = clock();
  const post = mkPost();
  const ig = fakeIg({ createError: classify({ code: 190, type: 'OAuthException', message: 'Invalid token' }, 400) });
  assert.equal(await processPost(post, { ig, now: c.now, sleep: c.sleep, persist: async () => {} }), 'auth');
  assert.equal(post.attempts, 0);
  assert.equal(post.status, 'queued');
});

// ---------- runner ----------
test('runDue publishes only approved, due posts; holds everything after an auth error', async () => {
  const c = clock(T0 + 3600000 + 60000); // 19:01 EAT
  const store = newStore(c);
  const due = mkPost({ id: 'due-one' }); due.status = 'queued'; await store.savePost(due);
  const waiting = mkPost({ id: 'not-approved' }); await store.savePost(waiting);
  const later = mkPost({ id: 'later-one', publish_at: '2026-11-25T19:00+03:00' }); later.status = 'queued'; await store.savePost(later);
  const ig = fakeIg();
  const s = await runDue({ store, env: env0, now: c.now, sleep: c.sleep, ig });
  assert.equal(s.due, 1); assert.equal(s.published, 1);
  assert.equal((await store.getPost('due-one')).status, 'published');
  assert.equal((await store.getPost('not-approved')).status, 'needs_approval');
  assert.equal((await store.getPost('later-one')).status, 'queued');
  assert.equal(s.token, 'refreshed');

  // auth failure -> held on the next runs
  const p2 = mkPost({ id: 'due-two' }); p2.status = 'queued'; await store.savePost(p2);
  const bad = fakeIg({ createError: classify({ code: 190, message: 'expired' }, 400) });
  const s2 = await runDue({ store, env: env0, now: c.now, sleep: c.sleep, ig: bad });
  assert.equal(s2.auth, 1);
  const s3 = await runDue({ store, env: env0, now: c.now, sleep: c.sleep, ig: fakeIg() });
  assert.match(s3.skipped, /rejected/);
  // a new token in env clears the hold
  const s4 = await runDue({ store, env: { ...env0, IG_ACCESS_TOKEN: 'BRANDNEW' }, now: c.now, sleep: c.sleep, ig: fakeIg() });
  assert.equal(s4.published, 1);
});

test('lock stops two runs publishing the same post', async () => {
  const c = clock(T0 + 3600000 + 60000);
  const store = newStore(c);
  const p = mkPost(); p.status = 'queued'; await store.savePost(p);
  assert.equal(await store.lock(p.id), true); // another run holds it
  const s = await runDue({ store, env: env0, now: c.now, sleep: c.sleep, ig: fakeIg() });
  assert.equal(s.published, 0);
});

test('token refresh: encrypted at rest, weekly, env token change wins', async () => {
  const c = clock();
  const store = newStore(c);
  await runDue({ store, env: env0, now: c.now, ig: fakeIg() });
  const rec = await store.getTokenRecord();
  assert.ok(!JSON.stringify(rec).includes('NEWTOKEN'), 'token must be encrypted');
  assert.equal((await resolveToken(store, env0)).token, 'NEWTOKEN');
  const s = await runDue({ store, env: env0, now: c.now, ig: fakeIg() });
  assert.equal(s.token, 'fresh');
  assert.equal((await resolveToken(store, { ...env0, IG_ACCESS_TOKEN: 'PASTED' })).token, 'PASTED');
  assert.equal(decrypt(encrypt('x', 'k'), 'k'), 'x');
});

test('daily limit reached: nothing published, no attempts used', async () => {
  const c = clock(T0 + 3600000 + 60000);
  const store = newStore(c);
  const p = mkPost(); p.status = 'queued'; await store.savePost(p);
  const ig = { ...fakeIg(), publishingLimit: async () => ({ data: [{ quota_usage: 50, config: { quota_total: 50 } }] }) };
  const s = await runDue({ store, env: env0, now: c.now, ig });
  assert.match(s.skipped, /limit/);
  assert.equal((await store.getPost(p.id)).attempts, 0);
});

test('igClient never leaks the token into error messages', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { code: 100, message: 'Bad param' } }), { status: 400 });
  const ig = igClient({ userId: '1', token: 'SECRET-TOKEN', fetchImpl });
  await assert.rejects(ig.createContainer({ image_url: 'x' }), (e) => !e.message.includes('SECRET') && e.kind === 'permanent');
  const ig2 = igClient({ userId: '1', token: 'SECRET-TOKEN', fetchImpl: async () => { throw new Error('connect ECONNREFUSED https://graph.instagram.com/?access_token=SECRET-TOKEN'); } });
  await assert.rejects(ig2.publish('c1'), (e) => !e.message.includes('SECRET') && e.ambiguous === true);
});

// ---------- endpoints ----------
const req = (url, init = {}) => new Request('https://fsfconsult.vercel.app' + url, init);

test('agent endpoint: needs key, adds as needs_approval, refuses duplicates', async () => {
  const c = clock(); const store = newStore(c);
  const okFetch = async () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '5000' } });
  const body = { id: 'steph-1', type: 'image', publish_at: '2026-11-25T19:00+03:00', media: [{ url: BASE + 's1-feed.jpg', alt: 'x' }], caption: 'hi' };
  const mk = (key, b = body) => req('/api/poster/posts', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await handlePost(mk('wrong'), { env: env0, store, fetchImpl: okFetch, now: c.now() })).status, 401);
  const r = await handlePost(mk('agent'), { env: env0, store, fetchImpl: okFetch, now: c.now() });
  assert.equal(r.status, 201);
  assert.equal((await store.getPost('steph-1')).status, 'needs_approval');
  assert.equal((await handlePost(mk('agent'), { env: env0, store, fetchImpl: okFetch, now: c.now() })).status, 409);
  assert.equal((await handlePost(mk('agent', { ...body, replace: true, caption: 'new' }), { env: env0, store, fetchImpl: okFetch, now: c.now() })).status, 200);
  assert.equal((await store.getPost('steph-1')).caption, 'new');
  const list = await (await handleGet(req('/api/poster/posts', { headers: { Authorization: 'Bearer agent' } }), { env: env0, store })).json();
  assert.equal(list.count, 1);
});

test('status page: login required, actions need same origin + header, approve/pause/delete work', async () => {
  const c = clock(); const store = newStore(c);
  const page = await handleAdminGet(req('/poster'), { env: env0, store, now: c.now() });
  assert.match(await page.text(), /Sign in/);

  const wrong = await handleAdminPost(req('/api/poster/admin?op=login', { method: 'POST', headers: { Origin: 'https://fsfconsult.vercel.app', host: 'fsfconsult.vercel.app', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=nope' }), { env: env0, store, now: c.now() });
  assert.equal(wrong.status, 401);
  const good = await handleAdminPost(req('/api/poster/admin?op=login', { method: 'POST', headers: { Origin: 'https://fsfconsult.vercel.app', host: 'fsfconsult.vercel.app', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=pw' }), { env: env0, store, now: c.now() });
  assert.equal(good.status, 303);
  const cookie = good.headers.get('set-cookie').split(';')[0];

  const p = mkPost({ id: 'to-approve', caption: '<script>alert(1)</script>' }); await store.savePost(p);
  const dash = await (await handleAdminGet(req('/poster', { headers: { cookie } }), { env: env0, store, now: c.now() })).text();
  assert.match(dash, /Needs your approval \(1\)/);
  assert.ok(!dash.includes('<script>alert(1)'), 'captions are escaped');

  const act = (payload, headers = {}) => handleAdminPost(req('/api/poster/admin', { method: 'POST', headers: { cookie, Origin: 'https://fsfconsult.vercel.app', host: 'fsfconsult.vercel.app', 'X-FSFP': '1', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) }), { env: env0, store, now: c.now(), runner: async () => ({}) });
  assert.equal((await act({ action: 'approve', id: 'to-approve' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await handleAdminPost(req('/api/poster/admin', { method: 'POST', headers: { Origin: 'https://fsfconsult.vercel.app', host: 'fsfconsult.vercel.app', 'X-FSFP': '1' }, body: '{}' }), { env: env0, store, now: c.now() })).status, 401);
  assert.equal((await act({ action: 'approve', id: 'to-approve' })).status, 200);
  assert.equal((await store.getPost('to-approve')).status, 'queued');
  assert.equal((await act({ action: 'approve', id: 'to-approve' })).status, 409);
  await act({ action: 'pause', id: 'to-approve' });
  assert.equal((await store.getPost('to-approve')).status, 'paused');
  await act({ action: 'resume', id: 'to-approve' });
  assert.equal((await store.getPost('to-approve')).status, 'queued');
  await act({ action: 'reschedule', id: 'to-approve', local: '2026-11-26T20:30' });
  assert.equal((await store.getPost('to-approve')).publish_at, '2026-11-26T17:30:00.000Z');
  await act({ action: 'delete', id: 'to-approve' });
  assert.equal((await store.getPost('to-approve')).status, 'deleted');

  const expired = makeSessionCookie(env0, c.now() - 13 * 3600 * 1000).split(';')[0];
  const old = await handleAdminGet(req('/poster', { headers: { cookie: expired } }), { env: env0, store, now: c.now() });
  assert.match(await old.text(), /Sign in/);
});
