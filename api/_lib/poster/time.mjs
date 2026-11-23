// Times are stored in UTC (ISO strings) and shown in East Africa Time (UTC+3, no DST).

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

// Accepts ISO strings that carry a zone ("...Z" or "+03:00"). Returns ISO UTC or null.
export function parseZoned(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// "2026-11-24T19:00" typed as EAT (the status page's datetime-local input) -> ISO UTC.
export function eatLocalToUtc(local) {
  if (typeof local !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const t = Date.parse(local + ':00Z');
  return Number.isFinite(t) ? new Date(t - EAT_OFFSET_MS).toISOString() : null;
}

// ISO UTC -> "2026-11-24T19:00" in EAT, for a datetime-local input.
export function utcToEatLocal(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t + EAT_OFFSET_MS).toISOString().slice(0, 16);
}

// ISO UTC -> "Tue 24 Nov, 19:00 EAT".
export function formatEat(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t + EAT_OFFSET_MS);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} EAT`;
}
