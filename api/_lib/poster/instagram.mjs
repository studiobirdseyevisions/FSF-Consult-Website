// Instagram Graph API (Instagram Login route, graph.instagram.com). Plain fetch.
// The access token is sent in the request but never put in error messages or logs.
import { GRAPH_HOST, GRAPH_VERSION } from './config.mjs';

const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);
const AUTH_CODES = new Set([102, 190]);
const PERMISSION_CODES = new Set([10, 200, 3]);

export class IgError extends Error {
  constructor({ message, kind, code = null, subcode = null, httpStatus = null, ambiguous = false }) {
    super(message);
    this.kind = kind; // 'transient' | 'permanent' | 'auth'
    this.code = code;
    this.subcode = subcode;
    this.httpStatus = httpStatus;
    this.ambiguous = ambiguous; // we don't know whether the request took effect
  }
}

export function classify(err, httpStatus) {
  const code = Number(err?.code) || null;
  const subcode = Number(err?.error_subcode) || null;
  const detail = err?.error_user_msg || err?.message || `HTTP ${httpStatus}`;
  const message = `${detail}${code ? ` (code ${code}${subcode ? `/${subcode}` : ''})` : ''}`;
  let kind = 'permanent';
  if (AUTH_CODES.has(code) || err?.type === 'OAuthException' && code === 190) kind = 'auth';
  else if (PERMISSION_CODES.has(code)) kind = 'permanent';
  else if (err?.is_transient || TRANSIENT_CODES.has(code) || httpStatus >= 500 || httpStatus === 429) kind = 'transient';
  else if (code === 9 || subcode === 2207042) kind = 'transient'; // publishing limit reached
  return new IgError({ message, kind, code, subcode, httpStatus });
}

export function igClient({ userId, token, fetchImpl = fetch, host = GRAPH_HOST, version = GRAPH_VERSION, timeoutMs = 25000 }) {
  async function call(method, path, params = {}, { versioned = true } = {}) {
    const url = new URL(`${host}/${versioned ? version + '/' : ''}${path}`);
    const all = { ...params, access_token: token };
    const init = { method, signal: AbortSignal.timeout(timeoutMs) };
    if (method === 'GET') {
      for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    } else {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== null) body.set(k, String(v));
      init.body = body;
    }
    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      throw new IgError({
        message: timedOut ? 'Instagram did not answer in time' : 'Network error reaching Instagram',
        kind: 'transient',
        ambiguous: method !== 'GET',
      });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw classify(json.error, res.status);
    return json;
  }

  return {
    createContainer: (params) => call('POST', `${userId}/media`, params),
    containerStatus: (id) => call('GET', id, { fields: 'status_code,status' }),
    publish: (creationId) => call('POST', `${userId}/media_publish`, { creation_id: creationId }),
    mediaInfo: (mediaId) => call('GET', mediaId, { fields: 'permalink,media_product_type' }),
    publishingLimit: () => call('GET', `${userId}/content_publishing_limit`, { fields: 'quota_usage,config' }),
    refreshToken: () => call('GET', 'refresh_access_token', { grant_type: 'ig_refresh_token' }, { versioned: false }),
  };
}

// Used on preview deployments and with POSTER_DRY_RUN=1: does everything except talk to Instagram.
export function dryRunClient() {
  let n = 0;
  return {
    createContainer: async () => ({ id: `dry-container-${++n}` }),
    containerStatus: async () => ({ status_code: 'FINISHED' }),
    publish: async () => ({ id: `dry-media-${++n}` }),
    mediaInfo: async () => ({ permalink: null }),
    publishingLimit: async () => ({ data: [{ quota_usage: 0, config: { quota_total: 50, quota_duration: 86400 } }] }),
    refreshToken: async () => { throw new IgError({ message: 'dry run: token not refreshed', kind: 'transient' }); },
  };
}
