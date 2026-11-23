// FSF Poster: shared settings. No secrets live here; they come from Vercel env vars.

export const GRAPH_HOST = 'https://graph.instagram.com';
export const GRAPH_VERSION = 'v27.0';

export const DEFAULT_MEDIA_PREFIX = 'https://fsfconsult.vercel.app/campaign/';

export const TYPES = ['image', 'carousel', 'reel', 'story'];
export const STATUSES = ['needs_approval', 'queued', 'paused', 'publishing', 'published', 'failed', 'deleted'];

export const CAROUSEL_MAX = 10; // Meta allows 20; FSF keeps 10.
export const CAPTION_MAX = 2200;
export const HASHTAG_MAX = 30;
export const MENTION_MAX = 20;
export const ALT_MAX = 1000;

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const REEL_MAX_BYTES = 300 * 1024 * 1024;
export const STORY_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

export const LATE_WINDOW_MS = 6 * 60 * 60 * 1000; // skip posts more than 6 h late
export const MAX_ATTEMPTS = 5;
export const BACKOFF_MIN = [5, 10, 20, 40]; // minutes after attempt 1, 2, 3, 4
export const VIDEO_STUCK_MS = 60 * 60 * 1000; // a container still processing after 1 h = failed
export const LOCK_SECONDS = 300;
export const RUN_BUDGET_MS = 40 * 1000; // stop starting new posts after this
export const STATUS_WAIT_MS = 30 * 1000; // how long one run waits for a video to finish
export const STATUS_POLL_MS = 5 * 1000;
export const TOKEN_REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
export const TOKEN_RETRY_MS = 24 * 60 * 60 * 1000;
export const SESSION_HOURS = 12;

export function mediaPrefix(env) {
  return env.POSTER_MEDIA_PREFIX || DEFAULT_MEDIA_PREFIX;
}

// Preview deployments never post for real and use their own keys in the database,
// so testing on a preview can't touch the production queue.
export function isDryRun(env) {
  return env.POSTER_DRY_RUN === '1' || (env.VERCEL_ENV && env.VERCEL_ENV !== 'production');
}

export function keyPrefix(env) {
  if (env.POSTER_KEY_PREFIX) return env.POSTER_KEY_PREFIX;
  return env.VERCEL_ENV && env.VERCEL_ENV !== 'production' ? 'fsfp-preview:' : 'fsfp:';
}
