// Checks a post sent by an agent and turns it into a stored post record.
import {
  TYPES, CAROUSEL_MAX, CAPTION_MAX, HASHTAG_MAX, MENTION_MAX, ALT_MAX,
  IMAGE_MAX_BYTES, REEL_MAX_BYTES, STORY_VIDEO_MAX_BYTES, mediaPrefix,
} from './config.mjs';
import { parseZoned } from './time.mjs';
import { randomId } from './crypto.mjs';

export function kindOf(url) {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (/\.(jpe?g)$/.test(path)) return 'image';
  if (/\.(mp4|mov)$/.test(path)) return 'video';
  return null;
}

function okUrl(url, prefix) {
  return typeof url === 'string' && url.startsWith(prefix) && /^[\x21-\x7e]+$/.test(url) && !url.includes('..');
}

// Returns { post, errors, warnings }. `now` is ms.
export function normalizePost(input, { env = {}, now = Date.now(), createdBy = 'agent' } = {}) {
  const errors = [];
  const warnings = [];
  const prefix = mediaPrefix(env);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: ['Body must be a JSON object'], warnings };

  const type = input.type;
  if (!TYPES.includes(type)) errors.push(`type must be one of: ${TYPES.join(', ')}`);

  let id = input.id;
  if (id === undefined || id === null || id === '') id = `post-${new Date(now).toISOString().slice(0, 10)}-${randomId(3)}`;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) errors.push('id must be 3-64 characters: lowercase letters, digits and dashes');

  const publishAt = parseZoned(input.publish_at);
  if (!publishAt) errors.push('publish_at must be an ISO time with a zone, e.g. "2026-11-24T19:00+03:00"');
  else if (Date.parse(publishAt) < now - 5 * 60 * 1000) errors.push('publish_at is in the past');

  const rawMedia = Array.isArray(input.media) ? input.media : [];
  const media = rawMedia.map((m) => (typeof m === 'string' ? { url: m } : m || {}));
  if (!media.length) errors.push('media must list at least one file');
  media.forEach((m, i) => {
    if (!okUrl(m.url, prefix)) errors.push(`media[${i}].url must start with ${prefix} (plain ASCII, no spaces)`);
    m.kind = typeof m.url === 'string' ? kindOf(m.url) : null;
    if (!m.kind) errors.push(`media[${i}] must be a .jpg/.jpeg image or .mp4/.mov video`);
    if (m.alt !== undefined && m.alt !== null && m.alt !== '') {
      if (typeof m.alt !== 'string' || m.alt.length > ALT_MAX) errors.push(`media[${i}].alt must be text up to ${ALT_MAX} characters`);
      if (m.kind === 'video' || type === 'story' || type === 'reel') { warnings.push(`media[${i}].alt dropped: Instagram supports alt text on feed and carousel images only`); m.alt = null; }
    } else m.alt = null;
  });

  if (type === 'image' && (media.length !== 1 || media[0]?.kind !== 'image')) errors.push('image posts need exactly one .jpg');
  if (type === 'reel' && (media.length !== 1 || media[0]?.kind !== 'video')) errors.push('reels need exactly one .mp4/.mov');
  if (type === 'story' && media.length !== 1) errors.push('stories need exactly one file');
  if (type === 'carousel' && (media.length < 2 || media.length > CAROUSEL_MAX)) errors.push(`carousels need 2 to ${CAROUSEL_MAX} files`);

  let caption = input.caption ?? '';
  if (typeof caption !== 'string') { errors.push('caption must be text'); caption = ''; }
  if (type === 'story' && caption) { warnings.push('caption dropped: Instagram stories have no caption, so put the words in the image'); caption = ''; }
  if (caption.length > CAPTION_MAX) errors.push(`caption is ${caption.length} characters; the limit is ${CAPTION_MAX}`);
  const tags = (caption.match(/#[\p{L}\p{N}_]+/gu) || []).length;
  if (tags > HASHTAG_MAX) errors.push(`caption has ${tags} hashtags; the limit is ${HASHTAG_MAX}`);
  const mentions = (caption.match(/@[A-Za-z0-9._]+/g) || []).length;
  if (mentions > MENTION_MAX) errors.push(`caption has ${mentions} @mentions; the limit is ${MENTION_MAX}`);

  let coverUrl = null;
  let shareToFeed = true;
  if (type === 'reel') {
    if (input.cover_url) {
      if (!okUrl(input.cover_url, prefix) || kindOf(input.cover_url) !== 'image') errors.push(`cover_url must be a .jpg under ${prefix}`);
      else coverUrl = input.cover_url;
    }
    if (input.share_to_feed === false) shareToFeed = false;
  }

  const note = typeof input.note === 'string' ? input.note.slice(0, 500) : '';
  const by = typeof input.created_by === 'string' ? input.created_by.slice(0, 32) : createdBy;

  if (errors.length) return { errors, warnings };
  const iso = new Date(now).toISOString();
  return {
    errors,
    warnings,
    post: {
      id, type, publish_at: publishAt,
      media: media.map((m) => ({ url: m.url, kind: m.kind, alt: m.alt })),
      caption, cover_url: coverUrl, share_to_feed: shareToFeed, note,
      status: 'needs_approval', attempts: 0, next_attempt_at: null,
      container_id: null, container_created_at: null, child_ids: [],
      media_id: null, permalink: null, last_error: null, published_at: null,
      created_by: by, created_at: iso, approved_at: null,
      history: [{ at: iso, event: `added by ${by}` }],
    },
  };
}

// Checks every URL is live on the site, has the right type and isn't too big for Instagram.
export async function checkMediaOnline(post, fetchImpl = fetch) {
  const errors = [];
  const items = post.media.map((m) => ({ ...m }));
  if (post.cover_url) items.push({ url: post.cover_url, kind: 'image', cover: true });
  await Promise.all(items.map(async (m) => {
    let res;
    try {
      res = await fetchImpl(m.url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    } catch {
      errors.push(`${m.url}: could not be reached`);
      return;
    }
    if (res.status !== 200) { errors.push(`${m.url}: HTTP ${res.status} (must be 200, no redirects)`); return; }
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const size = Number(res.headers.get('content-length') || 0);
    if (m.kind === 'image' && !type.startsWith('image/jpeg')) errors.push(`${m.url}: served as ${type || 'unknown'}, Instagram needs JPEG`);
    if (m.kind === 'video' && !/^video\/(mp4|quicktime)/.test(type)) errors.push(`${m.url}: served as ${type || 'unknown'}, needs MP4/MOV`);
    const max = m.kind === 'image' ? IMAGE_MAX_BYTES : post.type === 'story' ? STORY_VIDEO_MAX_BYTES : REEL_MAX_BYTES;
    if (size && size > max) errors.push(`${m.url}: ${(size / 1048576).toFixed(1)} MB, the limit is ${max / 1048576} MB`);
  }));
  return errors;
}
