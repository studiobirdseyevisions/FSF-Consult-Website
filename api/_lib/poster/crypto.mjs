import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const sha256 = (s) => createHash('sha256').update(String(s)).digest();

export function fingerprint(secret) {
  return sha256('fsfp-fp:' + secret).toString('hex').slice(0, 16);
}

// Constant-time string comparison. Empty or missing expected values never match.
export function safeEqual(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}

export function encrypt(plain, keyMaterial) {
  if (!keyMaterial) throw new Error('TOKEN_ENC_KEY is not set');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', sha256('fsfp-enc:' + keyMaterial), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(box, keyMaterial) {
  if (!keyMaterial) throw new Error('TOKEN_ENC_KEY is not set');
  const [iv, tag, data] = String(box).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', sha256('fsfp-enc:' + keyMaterial), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

export function hmac(data, keyMaterial) {
  return createHmac('sha256', sha256('fsfp-mac:' + keyMaterial)).update(String(data)).digest('base64url');
}

export function randomId(n = 6) {
  return randomBytes(n).toString('hex');
}
