// Sync between computers by emailing the encrypted configuration to oneself (R-SYN-1).
// Only "Publish now" and "Load latest now" call into this file. It never deletes,
// moves or files sync emails, and nothing here runs automatically.
//
// MAIL-SENDING CALL: api.compose.sendMessage -> publish() (caller: Settings "Publish now" click)

import { encryptJson, decryptJson } from './crypto.js';
import { sanitizeConfig } from './config.js';

export const SYNC_SUBJECT = "Ed's Mail Helper sync";
const BEGIN = '-----BEGIN EDS MAIL HELPER CONFIG-----';
const END = '-----END EDS MAIL HELPER CONFIG-----';

export function buildBody(blob, computerName, when) {
  return [
    "This email was sent by Ed's Mail Helper when you clicked \"Publish now\".",
    `Computer: ${computerName || '(unnamed)'}  Time: ${new Date(when).toISOString()}`,
    'It holds your add-on settings, encrypted with your passphrase. Keep it if you sync between computers.',
    '',
    BEGIN,
    ...(blob.match(/.{1,76}/g) || []),
    END,
    '',
  ].join('\n');
}

export function extractBlob(text) {
  const s = String(text || '');
  const a = s.indexOf(BEGIN);
  const b = s.indexOf(END, a + 1);
  if (a < 0 || b < 0) return '';
  return s.slice(a + BEGIN.length, b).replace(/\s+/g, '');
}

function textParts(part, out = []) {
  if (!part) return out;
  if (typeof part.body === 'string' && /^text\//i.test(part.contentType || 'text/plain')) out.push(part.body);
  for (const p of part.parts || []) textParts(p, out);
  return out;
}

export async function publish(api, { identity, passphrase, computerName, config }) {
  if (!identity) throw new Error('Choose the address to send to and from.');
  const t = Date.now();
  const blob = await encryptJson({ app: 'eds-mail-helper', t, computer: computerName || '', config: sanitizeConfig(config) }, passphrase);
  const tab = await api.compose.beginNew({
    identityId: identity.id,
    to: [identity.email],
    subject: SYNC_SUBJECT,
    isPlainText: true,
    plainTextBody: buildBody(blob, computerName, t),
  });
  await api.compose.sendMessage(tab.id, { mode: 'sendNow' });
  return { t };
}

// Read-only: finds sync emails, ignores any that don't decrypt, returns the newest payload.
export async function loadLatest(api, passphrase, { max = 40 } = {}) {
  const headers = [];
  let page = await api.messages.query({ subject: SYNC_SUBJECT });
  while (true) {
    headers.push(...(page.messages || []));
    if (!page.id) break;
    page = await api.messages.continueList(page.id);
  }
  headers.sort((a, b) => new Date(b.date) - new Date(a.date));
  const seen = new Set();
  let best = null;
  let tried = 0;
  for (const h of headers) {
    if (h.subject !== SYNC_SUBJECT || seen.has(h.headerMessageId)) continue;
    seen.add(h.headerMessageId);
    if (++tried > max) break;
    let full;
    try { full = await api.messages.getFull(h.id); } catch { continue; }
    for (const text of textParts(full)) {
      const blob = extractBlob(text);
      if (!blob) continue;
      const payload = await decryptJson(blob, passphrase);
      if (payload && payload.app === 'eds-mail-helper' && (!best || payload.t > best.t)) best = payload;
    }
    if (best) break; // newest decryptable email wins; dates sorted newest first
  }
  if (!best) return null;
  return { t: best.t, computer: best.computer, config: sanitizeConfig(best.config) };
}
