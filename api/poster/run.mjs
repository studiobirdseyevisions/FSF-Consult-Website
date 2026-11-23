// Timer endpoint, called every ~5 minutes by GitHub Actions.
// POST with "Authorization: Bearer <CRON_SECRET>". The reply holds counts only,
// because GitHub Actions logs of this public repo are public.
import { storeFromEnv } from '../_lib/poster/store.mjs';
import { runDue } from '../_lib/poster/runner.mjs';
import { checkBearer, json } from '../_lib/poster/http.mjs';

export async function POST(request) {
  const env = process.env;
  if (!checkBearer(request, env.CRON_SECRET)) return json({ ok: false }, 401);
  try {
    const store = storeFromEnv(env);
    const s = await runDue({ store, env });
    return json({ ok: true, due: s.due, published: s.published, waiting: s.waiting, retry: s.retry, failed: s.failed, held: Boolean(s.skipped), dry_run: s.dry_run });
  } catch (e) {
    console.error('poster run failed:', e?.message || e);
    return json({ ok: false, error: 'run failed; see the Vercel function log' }, 500);
  }
}

export function GET() {
  return json({ ok: false, error: 'use POST' }, 405);
}
