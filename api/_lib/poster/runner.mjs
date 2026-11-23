// One timer tick: publish what is due, check the daily limit, refresh the token weekly.
import { igClient, dryRunClient, IgError } from './instagram.mjs';
import { processPost } from './publish.mjs';
import { decrypt, encrypt, fingerprint } from './crypto.mjs';
import { isDryRun, RUN_BUDGET_MS, TOKEN_REFRESH_EVERY_MS, TOKEN_RETRY_MS } from './config.mjs';

export async function resolveToken(store, env) {
  const envToken = env.IG_ACCESS_TOKEN || '';
  const fp = envToken ? fingerprint(envToken) : null;
  const rec = await store.getTokenRecord();
  let token = envToken;
  let source = envToken ? 'env' : 'none';
  if (rec && rec.env_fp === fp && rec.box && env.TOKEN_ENC_KEY) {
    try { token = decrypt(rec.box, env.TOKEN_ENC_KEY); source = 'refreshed'; } catch { /* fall back to env token */ }
  }
  return { token, fp, source, rec: rec && rec.env_fp === fp ? rec : null };
}

// Public summary for the status page; never includes the token.
export async function tokenStatus(store, env) {
  const t = await resolveToken(store, env);
  return {
    present: Boolean(t.token),
    source: t.source,
    refreshed_at: t.rec?.refreshed_at || null,
    expires_at: t.rec?.expires_at || null,
    last_refresh_error: t.rec?.last_refresh_error || null,
    enc_key_set: Boolean(env.TOKEN_ENC_KEY),
  };
}

async function maybeRefreshToken(store, env, ig, tok, nowMs) {
  if (!env.TOKEN_ENC_KEY || !tok.token) return 'skipped';
  const rec = tok.rec;
  if (rec?.refreshed_at && nowMs - Date.parse(rec.refreshed_at) < TOKEN_REFRESH_EVERY_MS) return 'fresh';
  if (rec?.next_try_at && nowMs < Date.parse(rec.next_try_at)) return 'later';
  try {
    const r = await ig.refreshToken();
    if (!r?.access_token) throw new Error('no token in reply');
    await store.setTokenRecord({
      env_fp: tok.fp,
      box: encrypt(r.access_token, env.TOKEN_ENC_KEY),
      refreshed_at: new Date(nowMs).toISOString(),
      expires_at: r.expires_in ? new Date(nowMs + Number(r.expires_in) * 1000).toISOString() : null,
      last_refresh_error: null,
    });
    return 'refreshed';
  } catch (e) {
    await store.setTokenRecord({
      ...(rec || { env_fp: tok.fp }),
      next_try_at: new Date(nowMs + TOKEN_RETRY_MS).toISOString(),
      last_refresh_error: e?.message || String(e),
    });
    return 'failed';
  }
}

export async function runDue({ store, env, fetchImpl = fetch, now = () => Date.now(), sleep, onlyId = null, ig: igOverride = null, waitMs, pollMs }) {
  const started = now();
  const dry = isDryRun(env);
  const summary = { at: new Date(started).toISOString(), dry_run: Boolean(dry), due: 0, published: 0, waiting: 0, retry: 0, failed: 0, auth: 0, skipped: null, token: null };

  const finish = async () => {
    summary.ms = now() - started;
    await store.logRun(summary);
    return summary;
  };

  const tok = await resolveToken(store, env);
  if (!dry && !igOverride && (!tok.token || !env.IG_USER_ID)) {
    summary.skipped = 'IG_ACCESS_TOKEN or IG_USER_ID not set';
    return finish();
  }
  const ig = igOverride || (dry ? dryRunClient() : igClient({ userId: env.IG_USER_ID, token: tok.token, fetchImpl }));

  const authErr = await store.getAuthError();
  if (authErr && authErr.fp !== tok.fp) await store.clearAuthError(); // a new token was pasted
  else if (authErr && !onlyId) {
    summary.skipped = 'access token rejected earlier; paste a new token or press "Try again" on the status page';
    return finish();
  }

  const nowMs = now();
  const ids = onlyId ? [onlyId] : await store.dueIds(nowMs);
  const posts = (await Promise.all(ids.map((id) => store.getPost(id)))).filter((p) => p
    && (p.status === 'queued' || p.status === 'publishing')
    && Date.parse(p.publish_at) <= nowMs
    && (onlyId || !p.next_attempt_at || Date.parse(p.next_attempt_at) <= nowMs));
  summary.due = posts.length;

  if (posts.length) {
    try {
      const q = await ig.publishingLimit();
      const d = q?.data?.[0];
      if (d) {
        const quota = { usage: Number(d.quota_usage) || 0, total: Number(d.config?.quota_total) || 50, at: new Date(nowMs).toISOString() };
        await store.setQuota(quota);
        if (quota.usage >= quota.total) {
          summary.skipped = 'Instagram daily publishing limit reached; will try next run';
          return finish();
        }
      }
    } catch (e) {
      if (e instanceof IgError && e.kind === 'auth') {
        await store.setAuthError({ at: new Date(nowMs).toISOString(), fp: tok.fp, message: e.message });
        summary.auth = 1;
        summary.skipped = 'access token rejected';
        return finish();
      }
      // otherwise carry on; publishing will surface any real problem
    }
  }

  const ctx = { ig, now, sleep, waitMs, pollMs, persist: (p) => store.savePost(p) };
  for (const candidate of posts) {
    if (now() - started > RUN_BUDGET_MS) break;
    if (!(await store.lock(candidate.id))) continue;
    try {
      const post = await store.getPost(candidate.id);
      if (!post || !(post.status === 'queued' || post.status === 'publishing')) continue;
      const out = await processPost(post, ctx);
      await store.savePost(post);
      summary[out] += 1;
      if (out === 'auth') {
        await store.setAuthError({ at: new Date(now()).toISOString(), fp: tok.fp, message: post.last_error });
        break;
      }
      if (out === 'published') await store.clearAuthError();
    } finally {
      await store.unlock(candidate.id);
    }
  }

  if (!dry || igOverride) summary.token = await maybeRefreshToken(store, env, ig, tok, now());
  return finish();
}
