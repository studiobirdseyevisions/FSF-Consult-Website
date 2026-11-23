// Private status page, served at /poster (rewrite in vercel.json). Password-protected.
import { storeFromEnv } from '../_lib/poster/store.mjs';
import { handleAdminGet, handleAdminPost } from '../_lib/poster/admin.mjs';
import { json } from '../_lib/poster/http.mjs';

export async function GET(request) {
  const env = process.env;
  try { return await handleAdminGet(request, { env, store: storeFromEnv(env) }); }
  catch (e) { console.error('poster admin GET:', e?.message); return json({ ok: false, error: 'server error (is the database connected?)' }, 500); }
}

export async function POST(request) {
  const env = process.env;
  try { return await handleAdminPost(request, { env, store: storeFromEnv(env) }); }
  catch (e) { console.error('poster admin POST:', e?.message); return json({ ok: false, error: 'server error' }, 500); }
}
