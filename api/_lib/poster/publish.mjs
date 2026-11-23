// Publishes one post. Works as a small state machine that can stop and carry on in the next run:
//   (carousel children) -> container -> wait until FINISHED -> media_publish -> permalink.
// Before publishing it always checks the container status, so a post is never published twice.
import { IgError } from './instagram.mjs';
import { LATE_WINDOW_MS, MAX_ATTEMPTS, BACKOFF_MIN, VIDEO_STUCK_MS, STATUS_WAIT_MS, STATUS_POLL_MS } from './config.mjs';
import { formatEat } from './time.mjs';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Waiting extends Error {}

export function addEvent(post, at, event) {
  post.history = post.history || [];
  post.history.push({ at: new Date(at).toISOString(), event });
  if (post.history.length > 40) post.history.splice(0, post.history.length - 40);
}

function containerParams(post) {
  const m = post.media[0];
  switch (post.type) {
    case 'image':
      return { image_url: m.url, caption: post.caption || undefined, alt_text: m.alt || undefined };
    case 'reel':
      return {
        media_type: 'REELS', video_url: m.url, caption: post.caption || undefined,
        share_to_feed: post.share_to_feed === false ? 'false' : 'true', cover_url: post.cover_url || undefined,
      };
    case 'story':
      return m.kind === 'video' ? { media_type: 'STORIES', video_url: m.url } : { media_type: 'STORIES', image_url: m.url };
    default:
      throw new IgError({ message: `Unknown post type ${post.type}`, kind: 'permanent' });
  }
}

// Polls a container until it settles or the wait runs out. Returns the status_code.
async function waitForContainer(id, ctx, createdAt) {
  const deadline = ctx.now() + (ctx.waitMs ?? STATUS_WAIT_MS);
  for (;;) {
    const s = await ctx.ig.containerStatus(id);
    const code = s.status_code;
    if (code === 'ERROR') throw new IgError({ message: `Instagram could not process the media: ${s.status || 'no detail'}`, kind: 'permanent' });
    if (code === 'EXPIRED') return 'EXPIRED';
    if (code === 'FINISHED' || code === 'PUBLISHED') return code;
    if (createdAt && ctx.now() - Date.parse(createdAt) > VIDEO_STUCK_MS) {
      throw new IgError({ message: 'Instagram was still processing the video after 1 hour', kind: 'permanent' });
    }
    if (ctx.now() + (ctx.pollMs ?? STATUS_POLL_MS) > deadline) throw new Waiting();
    await (ctx.sleep || defaultSleep)(ctx.pollMs ?? STATUS_POLL_MS);
  }
}

function clearContainers(post) {
  post.container_id = null;
  post.container_created_at = null;
  post.child_ids = [];
  post.children_created_at = null;
}

async function ensureContainer(post, ctx) {
  if (post.container_id) return;
  const at = () => new Date(ctx.now()).toISOString();
  if (post.type === 'carousel') {
    post.child_ids = post.child_ids || [];
    for (let i = post.child_ids.length; i < post.media.length; i++) {
      const m = post.media[i];
      const params = m.kind === 'image'
        ? { image_url: m.url, is_carousel_item: 'true', alt_text: m.alt || undefined }
        : { video_url: m.url, media_type: 'VIDEO', is_carousel_item: 'true' };
      const r = await ctx.ig.createContainer(params);
      if (!post.children_created_at) post.children_created_at = at();
      post.child_ids.push(r.id);
      await ctx.persist(post);
    }
    for (let i = 0; i < post.child_ids.length; i++) {
      if (post.media[i].kind !== 'video') continue;
      const code = await waitForContainer(post.child_ids[i], ctx, post.children_created_at);
      if (code === 'EXPIRED') {
        clearContainers(post);
        throw new IgError({ message: 'Carousel items expired before publishing; they will be created again', kind: 'transient' });
      }
    }
    const r = await ctx.ig.createContainer({ media_type: 'CAROUSEL', children: post.child_ids.join(','), caption: post.caption || undefined });
    post.container_id = r.id;
  } else {
    const r = await ctx.ig.createContainer(containerParams(post));
    post.container_id = r.id;
  }
  post.container_created_at = at();
  addEvent(post, ctx.now(), 'media sent to Instagram');
  await ctx.persist(post);
}

async function markPublished(post, ctx, mediaId) {
  post.status = 'published';
  post.media_id = mediaId || null;
  post.published_at = new Date(ctx.now()).toISOString();
  post.last_error = null;
  post.next_attempt_at = null;
  if (mediaId) {
    try {
      const info = await ctx.ig.mediaInfo(mediaId);
      post.permalink = info.permalink || null;
    } catch { /* the post is live; the link is a nice-to-have */ }
  }
  addEvent(post, ctx.now(), post.permalink ? `published: ${post.permalink}` : 'published');
}

// Returns 'published' | 'waiting' | 'retry' | 'failed' | 'auth'.
export async function processPost(post, ctx) {
  const now = ctx.now();
  if (!post.force && !post.container_id && now - Date.parse(post.publish_at) > LATE_WINDOW_MS) {
    post.status = 'failed';
    post.last_error = `Missed window: more than 6 hours late (due ${formatEat(post.publish_at)}), so it was not posted. Use "Publish now" or change the time.`;
    addEvent(post, now, 'not posted: more than 6 h late');
    return 'failed';
  }
  post.status = 'publishing';
  try {
    await ensureContainer(post, ctx);
    const code = await waitForContainer(post.container_id, ctx, post.container_created_at);
    if (code === 'EXPIRED') {
      clearContainers(post);
      throw new IgError({ message: 'Instagram container expired (24 h); it will be created again', kind: 'transient' });
    }
    if (code === 'PUBLISHED') {
      await markPublished(post, ctx, post.media_id);
      return 'published';
    }
    let res;
    try {
      res = await ctx.ig.publish(post.container_id);
    } catch (e) {
      if (e instanceof IgError && e.ambiguous) {
        const s = await ctx.ig.containerStatus(post.container_id).catch(() => null);
        if (s?.status_code === 'PUBLISHED') {
          await markPublished(post, ctx, null);
          return 'published';
        }
      }
      throw e;
    }
    await markPublished(post, ctx, res.id);
    return 'published';
  } catch (err) {
    if (err instanceof Waiting) {
      post.last_error = null;
      addEvent(post, ctx.now(), 'Instagram is still processing the video; checking again next run');
      return 'waiting';
    }
    const e = err instanceof IgError ? err : new IgError({ message: `Unexpected error: ${err?.message || err}`, kind: 'transient' });
    if (e.kind === 'auth') {
      post.status = 'queued';
      post.last_error = `Instagram rejected the access token: ${e.message}`;
      addEvent(post, ctx.now(), 'held: access token problem');
      return 'auth';
    }
    post.attempts = (post.attempts || 0) + 1;
    post.last_error = e.message;
    if (e.kind === 'transient' && post.attempts < MAX_ATTEMPTS) {
      const wait = BACKOFF_MIN[Math.min(post.attempts - 1, BACKOFF_MIN.length - 1)];
      post.status = 'queued';
      post.next_attempt_at = new Date(ctx.now() + wait * 60000).toISOString();
      addEvent(post, ctx.now(), `try ${post.attempts} failed (${e.message}); next try in ${wait} min`);
      return 'retry';
    }
    post.status = 'failed';
    post.next_attempt_at = null;
    addEvent(post, ctx.now(), `failed: ${e.message}`);
    return 'failed';
  }
}

// Resets a post for another go (status page "Retry" / "Publish now").
export function resetForRetry(post) {
  clearContainers(post);
  post.attempts = 0;
  post.next_attempt_at = null;
  post.last_error = null;
  post.status = 'queued';
}
