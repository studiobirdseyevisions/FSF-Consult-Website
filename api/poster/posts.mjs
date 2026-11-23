// Agent endpoint. "Authorization: Bearer <AGENT_API_KEY>".
//   GET  /api/poster/posts[?status=queued]   list posts
//   POST /api/poster/posts                   add a post (it waits for the user's Approve)
// Agents cannot approve, delete or publish.
import { storeFromEnv } from '../_lib/poster/store.mjs';
import { handleGet, handlePost } from '../_lib/poster/agent.mjs';
import { json } from '../_lib/poster/http.mjs';

export async function GET(request) {
  const env = process.env;
  try { return await handleGet(request, { env, store: storeFromEnv(env) }); }
  catch (e) { console.error('poster posts GET:', e?.message); return json({ ok: false, error: 'server error' }, 500); }
}

export async function POST(request) {
  const env = process.env;
  try { return await handlePost(request, { env, store: storeFromEnv(env) }); }
  catch (e) { console.error('poster posts POST:', e?.message); return json({ ok: false, error: 'server error' }, 500); }
}
