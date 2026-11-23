// Queue storage on Upstash Redis (REST API, plain fetch), plus an in-memory twin for tests.
import { keyPrefix } from './config.mjs';

export function redisCommander(env, fetchImpl = fetch) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Database not connected (KV_REST_API_URL / KV_REST_API_TOKEN missing)');
  return async (...args) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args.map(String)),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(`Database error (${args[0]}): ${json.error || res.status}`);
    return json.result;
  };
}

// Implements only the Redis commands this tool uses.
export function memoryCommander(clock = () => Date.now()) {
  const kv = new Map(); // key -> {v, exp}
  const z = new Map(); // key -> Map(member -> score)
  const lists = new Map();
  const live = (k) => {
    const e = kv.get(k);
    if (e && e.exp && e.exp <= clock()) kv.delete(k);
    return kv.get(k);
  };
  const cmd = async (name, ...a) => {
    switch (name.toUpperCase()) {
      case 'GET': return live(a[0])?.v ?? null;
      case 'MGET': return a.map((k) => live(k)?.v ?? null);
      case 'SET': {
        const [k, v, ...opts] = a;
        const up = opts.map((o) => String(o).toUpperCase());
        if (up.includes('NX') && live(k)) return null;
        const exI = up.indexOf('EX');
        kv.set(k, { v: String(v), exp: exI >= 0 ? clock() + Number(opts[exI + 1]) * 1000 : 0 });
        return 'OK';
      }
      case 'DEL': { let n = 0; for (const k of a) n += kv.delete(k) ? 1 : 0; return n; }
      case 'INCR': {
        const e = live(a[0]);
        const n = Number(e?.v || 0) + 1;
        kv.set(a[0], { v: String(n), exp: e?.exp || 0 });
        return n;
      }
      case 'EXPIRE': { const e = live(a[0]); if (e) e.exp = clock() + Number(a[1]) * 1000; return e ? 1 : 0; }
      case 'ZADD': {
        const m = z.get(a[0]) || new Map();
        m.set(String(a[2]), Number(a[1]));
        z.set(a[0], m);
        return 1;
      }
      case 'ZREM': return z.get(a[0])?.delete(String(a[1])) ? 1 : 0;
      case 'ZRANGE': {
        const m = z.get(a[0]) || new Map();
        return [...m.entries()].sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1)).map((e) => e[0]);
      }
      case 'ZRANGEBYSCORE': {
        const lo = a[1] === '-inf' ? -Infinity : Number(a[1]);
        const hi = a[2] === '+inf' ? Infinity : Number(a[2]);
        const m = z.get(a[0]) || new Map();
        return [...m.entries()].filter((e) => e[1] >= lo && e[1] <= hi).sort((x, y) => x[1] - y[1]).map((e) => e[0]);
      }
      case 'LPUSH': { const l = lists.get(a[0]) || []; l.unshift(String(a[1])); lists.set(a[0], l); return l.length; }
      case 'LTRIM': { const l = lists.get(a[0]) || []; lists.set(a[0], l.slice(Number(a[1]), Number(a[2]) + 1)); return 'OK'; }
      case 'LRANGE': { const l = lists.get(a[0]) || []; return l.slice(Number(a[1]), Number(a[2]) === -1 ? undefined : Number(a[2]) + 1); }
      default: throw new Error('memory store: unsupported ' + name);
    }
  };
  return cmd;
}

// Higher-level store used by the rest of the tool.
export function createStore(cmd, env = {}) {
  const p = keyPrefix(env);
  const k = {
    post: (id) => `${p}post:${id}`,
    byTime: `${p}posts:by_time`,
    lock: (id) => `${p}lock:${id}`,
    runs: `${p}runs`,
    lastRun: `${p}last_run`,
    token: `${p}ig:token`,
    authError: `${p}ig:auth_error`,
    quota: `${p}ig:quota`,
    loginFail: (ip) => `${p}login_fail:${ip}`,
  };
  const parse = (s) => (s ? JSON.parse(s) : null);

  return {
    cmd,
    async getPost(id) { return parse(await cmd('GET', k.post(id))); },
    async savePost(post) {
      post.updated_at = new Date().toISOString();
      await cmd('SET', k.post(post.id), JSON.stringify(post));
      await cmd('ZADD', k.byTime, Date.parse(post.publish_at), post.id);
      return post;
    },
    async allPosts() {
      const ids = await cmd('ZRANGE', k.byTime, 0, -1);
      if (!ids?.length) return [];
      const raw = await cmd('MGET', ...ids.map(k.post));
      return raw.map(parse).filter(Boolean);
    },
    async dueIds(nowMs) {
      return (await cmd('ZRANGEBYSCORE', k.byTime, '-inf', nowMs)) || [];
    },
    async lock(id) { return (await cmd('SET', k.lock(id), '1', 'NX', 'EX', 300)) === 'OK'; },
    async unlock(id) { await cmd('DEL', k.lock(id)); },
    async logRun(entry) {
      await cmd('LPUSH', k.runs, JSON.stringify(entry));
      await cmd('LTRIM', k.runs, 0, 199);
      await cmd('SET', k.lastRun, JSON.stringify(entry));
    },
    async lastRun() { return parse(await cmd('GET', k.lastRun)); },
    async recentRuns(n = 20) { return ((await cmd('LRANGE', k.runs, 0, n - 1)) || []).map(parse); },
    async getTokenRecord() { return parse(await cmd('GET', k.token)); },
    async setTokenRecord(r) { await cmd('SET', k.token, JSON.stringify(r)); },
    async getAuthError() { return parse(await cmd('GET', k.authError)); },
    async setAuthError(e) { await cmd('SET', k.authError, JSON.stringify(e)); },
    async clearAuthError() { await cmd('DEL', k.authError); },
    async getQuota() { return parse(await cmd('GET', k.quota)); },
    async setQuota(q) { await cmd('SET', k.quota, JSON.stringify(q)); },
    async loginFailures(ip) { return Number((await cmd('GET', k.loginFail(ip))) || 0); },
    async addLoginFailure(ip) {
      const n = await cmd('INCR', k.loginFail(ip));
      if (Number(n) === 1) await cmd('EXPIRE', k.loginFail(ip), 900);
      return Number(n);
    },
  };
}

export function storeFromEnv(env, fetchImpl = fetch) {
  return createStore(redisCommander(env, fetchImpl), env);
}
