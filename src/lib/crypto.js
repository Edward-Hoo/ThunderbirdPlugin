// Passphrase encryption for the sync email (R-SYN-1): PBKDF2-SHA256 -> AES-GCM-256.
// The passphrase is chosen by the user; nothing secret is hard-coded here.

export const PBKDF2_ITERATIONS = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt, iterations, subtle) {
  const base = await subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptJson(obj, passphrase, { cryptoImpl = globalThis.crypto, iterations = PBKDF2_ITERATIONS } = {}) {
  if (!passphrase || passphrase.length < 8) throw new Error('Choose a passphrase of at least 8 characters.');
  const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations, cryptoImpl.subtle);
  const ct = new Uint8Array(await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  return JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', it: iterations, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
}

// Returns the object, or null when the blob doesn't decrypt with this passphrase.
export async function decryptJson(blob, passphrase, { cryptoImpl = globalThis.crypto } = {}) {
  try {
    const o = JSON.parse(blob);
    if (o.v !== 1 || o.kdf !== 'PBKDF2-SHA256') return null;
    const it = Number(o.it);
    if (!(it >= 100000 && it <= 5000000)) return null;
    const key = await deriveKey(passphrase, unb64(o.salt), it, cryptoImpl.subtle);
    const pt = await cryptoImpl.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct));
    return JSON.parse(dec.decode(pt));
  } catch {
    return null;
  }
}
