// Agent endpoint logic (see api/poster/posts.mjs).
//   GET  /api/poster/posts[?status=queued]   list posts
//   POST /api/poster/posts                   add a post (it waits for the user's Approve)
//        body may include "replace": true to change a post that is still waiting for approval.
// Agents cannot approve, delete or publish.
import { normalizePost, checkMediaOnline } from './validate.mjs';
import { addEvent } from './publish.mjs';
import { formatEat } from './time.mjs';
import { checkBearer, json } from './http.mjs';
import { STATUSES } from './config.mjs';

export function publicView(p) {
  return {
    id: p.id, type: p.type, status: p.status,
    publish_at: p.publish_at, publish_at_eat: formatEat(p.publish_at),
    media: p.media, caption: p.caption, cover_url: p.cover_url, share_to_feed: p.share_to_feed, note: p.note,
    attempts: p.attempts, next_attempt_at: p.next_attempt_at, last_error: p.last_error,
    permalink: p.permalink, published_at: p.published_at,
    created_by: p.created_by, created_at: p.created_at, approved_at: p.approved_at,
    history: p.history,
  };
}

export async function handleGet(request, { env, store }) {
  if (!checkBearer(request, env.AGENT_API_KEY)) return json({ ok: false }, 401);
  const status = new URL(request.url).searchParams.get('status');
  if (status && !STATUSES.includes(status)) return json({ ok: false, error: `status must be one of ${STATUSES.join(', ')}` }, 400);
  const posts = (await store.allPosts()).filter((p) => (status ? p.status === status : p.status !== 'deleted'));
  return json({ ok: true, count: posts.length, posts: posts.map(publicView) });
}

export async function handlePost(request, { env, store, fetchImpl = fetch, now = Date.now() }) {
  if (!checkBearer(request, env.AGENT_API_KEY)) return json({ ok: false }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, errors: ['Body must be JSON'] }, 400); }
  const { post, errors, warnings } = normalizePost(body, { env, now, createdBy: 'agent' });
  if (errors.length) return json({ ok: false, errors, warnings }, 400);

  const existing = await store.getPost(post.id);
  if (existing && existing.status !== 'deleted') {
    if (!(body.replace === true && existing.status === 'needs_approval')) {
      return json({ ok: false, errors: [`id "${post.id}" already exists (status ${existing.status}). Only posts still waiting for approval can be replaced, with "replace": true.`] }, 409);
    }
    post.history = [...(existing.history || [])];
    post.created_at = existing.created_at;
    addEvent(post, now, `replaced by ${post.created_by}`);
  }

  if (body.skip_media_check !== true || env.VERCEL_ENV === 'production') {
    const mediaErrors = await checkMediaOnline(post, fetchImpl);
    if (mediaErrors.length) return json({ ok: false, errors: mediaErrors, warnings }, 400);
  }

  await store.savePost(post);
  return json({ ok: true, id: post.id, status: post.status, publish_at_eat: formatEat(post.publish_at), warnings,
    next: 'Waiting for the user to approve it on the status page (/poster).' }, existing ? 200 : 201);
}

