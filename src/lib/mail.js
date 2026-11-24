// Thunderbird adapter. Every function takes the WebExtension API object (`api`,
// normally `messenger`) explicitly so tests can pass a recording fake.
//
// MAIL-CHANGING CALLS live only in this file and in sync.js:
//   api.messages.move   -> moveItems()        (callers: dashboard click handlers, background new-mail rule)
//   api.folders.create  -> ensureFolderPath() (caller: dashboard "Move" click handlers)
// Nothing here runs by itself; every function is called by someone else.

import { runBatches, BATCH_SIZE } from './batch.js';
import { parseAuthor } from './grouping.js';

const EXCLUDED_BY_DEFAULT = new Set(['sent', 'trash', 'junk', 'drafts', 'templates', 'outbox']);
// Spam folders Thunderbird has not marked as Junk, by their usual names.
const SPAM_NAME = /^(spam|junk|junk e-?mail|bulk mail)$/i;
const GMAIL_VIRTUAL = /^\[(gmail|google mail)\]\/(all mail|important|starred|alle nachrichten|wichtig|markiert)$/i;

function specialUse(folder) {
  if (Array.isArray(folder.specialUse)) return folder.specialUse;
  return folder.type ? [folder.type] : [];
}

// R-SCP-3: Gmail's virtual folders (and saved searches) double count.
export function isVirtualFolder(folder, namePath) {
  if (folder.isVirtual || folder.isUnified || folder.isTag) return true;
  return GMAIL_VIRTUAL.test(namePath);
}

// Flatten an account's folder tree. Returns
// [{ id, accountId, name, namePath, depth, use: [...], parentId, defaultOn }]
export function flattenFolders(account) {
  const roots = account.rootFolder ? (account.rootFolder.subFolders || []) : (account.folders || []);
  const out = [];
  const walk = (list, prefix, depth, parentId) => {
    for (const f of list || []) {
      const namePath = prefix ? `${prefix}/${f.name}` : f.name;
      const id = f.id || `${account.id}:/${f.path}`;
      if (isVirtualFolder(f, namePath)) { continue; }
      const use = specialUse(f);
      out.push({ id, accountId: account.id, name: f.name, namePath, depth, use, parentId,
        defaultOn: !use.some(u => EXCLUDED_BY_DEFAULT.has(u)), isInbox: use.includes('inbox'), isTrash: use.includes('trash'),
        isSpam: use.includes('junk') || (!use.length && SPAM_NAME.test(f.name)) });
      walk(f.subFolders, namePath, depth + 1, id);
    }
  };
  walk(roots, '', 0, null);
  return out;
}

export async function loadAccounts(api) {
  const accounts = await api.accounts.list(true);
  return accounts.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    rootId: a.rootFolder ? a.rootFolder.id : a.id,
    identities: (a.identities || []).map(i => ({ id: i.id, email: i.email, name: i.name })),
    folders: flattenFolders(a),
  }));
}

export function indexAccounts(accounts) {
  const folders = new Map();
  const byAccount = new Map();
  for (const a of accounts) {
    byAccount.set(a.id, a);
    for (const f of a.folders) folders.set(f.id, f);
  }
  return {
    accounts,
    folders,
    account: id => byAccount.get(id),
    trashOf: accountId => byAccount.get(accountId)?.folders.find(f => f.isTrash) || null,
    inboxOf: accountId => byAccount.get(accountId)?.folders.find(f => f.isInbox) || null,
    folderName: id => folders.get(id)?.namePath || String(id),
    findPath: (accountId, namePath) => byAccount.get(accountId)?.folders.find(f => f.namePath.toLowerCase() === namePath.toLowerCase()) || null,
  };
}

// Keep only what the actions need (R-REL-5).
export function slim(h) {
  const { name, addr } = parseAuthor(h.author);
  return {
    id: h.id,
    hid: h.headerMessageId || '',
    date: h.date ? new Date(h.date).getTime() : 0,
    subject: h.subject || '',
    author: h.author || '',
    name,
    addr,
    read: !!h.read,
    size: h.size || 0,
    folderId: h.folder ? (h.folder.id || `${h.folder.accountId}:/${h.folder.path}`) : '',
    accountId: h.folder ? h.folder.accountId : '',
  };
}

async function* pages(api, first) {
  let page = await first;
  while (true) {
    yield page.messages || [];
    if (!page.id) break;
    page = await api.messages.continueList(page.id);
  }
}

// R-SCP-5: read-only scan of the chosen folders, paging through messages.list.
export async function scanFolders(api, folderIds, { onProgress = () => {}, shouldStop = () => false } = {}) {
  const out = [];
  let i = 0;
  for (const folderId of folderIds) {
    i++;
    for await (const msgs of pages(api, api.messages.list(folderId))) {
      for (const h of msgs) out.push(slim(h));
      onProgress({ folderIndex: i, folderCount: folderIds.length, messages: out.length });
      if (shouldStop()) return { messages: out, stopped: true };
      await new Promise(r => setTimeout(r, 0)); // stay responsive
    }
  }
  return { messages: out, stopped: false };
}

// Move items with batching and retries (README §7). Items are scan records.
//   destFor(item) -> destination folder id, or null when there is none (item fails)
//   onConfirmed(items, destId) -> called after the server confirmed those items moved
export async function moveItems(api, items, destFor, { onConfirmed = async () => {}, onProgress = () => {}, pauseMs } = {}) {
  const groups = new Map();
  const result = { moved: [], gone: [], failed: [], already: [] };
  for (const item of items) {
    const dest = destFor(item);
    if (!dest) { result.failed.push({ item, error: 'No destination folder (no Trash folder found for this account?)' }); continue; }
    if (dest === item.folderId) { result.already.push(item); continue; } // already there; nothing to do or log
    if (!groups.has(dest)) groups.set(dest, []);
    groups.get(dest).push(item);
  }
  const total = items.length;
  let doneBefore = result.already.length + result.failed.length;
  for (const [dest, list] of groups) {
    const r = await runBatches(list, {
      moveFn: ids => api.messages.move(ids, dest),
      // Thunderbird 160 invalidates a message's id once it has moved, so when the id no
      // longer resolves, look for the message in the destination by its Message-ID.
      locate: async item => {
        try {
          const h = await api.messages.get(item.id);
          if (h) {
            const fid = h.folder ? (h.folder.id || `${h.folder.accountId}:/${h.folder.path}`) : '';
            return fid === dest ? 'moved' : 'present';
          }
        } catch { /* id no longer valid */ }
        if (item.hid) {
          try { if ((await findInFolder(api, item.hid, dest)).length) return 'moved'; } catch { /* fall through */ }
        }
        return 'gone';
      },
      onConfirmed: moved => onConfirmed(moved, dest),
      onProgress: p => onProgress({ done: doneBefore + p.done, total }),
      batchSize: BATCH_SIZE,
      ...(pauseMs != null ? { pauseMs } : {}),
    });
    result.moved.push(...r.moved);
    result.gone.push(...r.gone);
    result.failed.push(...r.failed);
    doneBefore += list.length;
  }
  return result;
}

// Find or create "A/B/C" inside an account. Creates missing folders (R-ACT-2).
// Returns the folder id. Caller must refresh its account index afterwards.
export async function ensureFolderPath(api, index, accountId, namePath) {
  const parts = String(namePath).split('/').map(s => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Empty folder name');
  const account = index.account(accountId);
  if (!account) throw new Error('Unknown account');
  let parentId = account.rootId;
  let path = '';
  for (const part of parts) {
    path = path ? `${path}/${part}` : part;
    const existing = index.findPath(accountId, path);
    if (existing) { parentId = existing.id; continue; }
    const created = await api.folders.create(parentId, part);
    const id = created.id || `${created.accountId}:/${created.path}`;
    account.folders.push({ id, accountId, name: part, namePath: path, depth: path.split('/').length - 1,
      use: [], parentId, defaultOn: true, isInbox: false, isTrash: false, isSpam: false });
    index.folders.set(id, account.folders[account.folders.length - 1]);
    parentId = id;
  }
  return parentId;
}

// Messages with this Message-ID that are currently in folderId.
export async function findInFolder(api, hid, folderId) {
  if (!hid) return [];
  const found = [];
  for await (const msgs of pages(api, api.messages.query({ headerMessageId: hid }))) {
    for (const h of msgs) {
      const fid = h.folder ? (h.folder.id || `${h.folder.accountId}:/${h.folder.path}`) : '';
      if (fid === folderId) found.push(slim(h));
    }
  }
  return found;
}

// R-PER-1: every message from or to an address, in all accounts.
export async function findPersonMessages(api, address, { onProgress = () => {} } = {}) {
  const addr = address.trim().toLowerCase();
  const byId = new Map();
  const matches = h => {
    const all = [h.author, ...(h.recipients || []), ...(h.ccList || [])];
    return all.some(x => parseAuthor(x).addr === addr);
  };
  for (const q of [{ author: addr }, { recipients: addr }]) {
    for await (const msgs of pages(api, api.messages.query(q))) {
      for (const h of msgs) if (!byId.has(h.id) && matches(h)) byId.set(h.id, { ...slim(h), to: (h.recipients || []).join(', ') });
      onProgress(byId.size);
    }
  }
  return [...byId.values()];
}

// R-PER-2: add earlier messages of each conversation, matched only by Message-ID /
// References / In-Reply-To headers.
export async function addConversation(api, messages, { onProgress = () => {}, limit = 400 } = {}) {
  const byId = new Map(messages.map(m => [m.id, m]));
  const known = new Set(messages.map(m => m.hid).filter(Boolean));
  const wanted = new Set();
  for (const m of messages) {
    let full;
    try { full = await api.messages.getFull(m.id); } catch { continue; }
    const hdr = full && full.headers || {};
    const refs = [...(hdr.references || []), ...(hdr['in-reply-to'] || [])].join(' ');
    for (const r of refs.match(/<[^<>\s]+>/g) || []) {
      const id = r.slice(1, -1);
      if (!known.has(id)) wanted.add(id);
    }
  }
  let n = 0;
  for (const hid of wanted) {
    if (++n > limit) break;
    for await (const msgs of pages(api, api.messages.query({ headerMessageId: hid }))) {
      for (const h of msgs) if (!byId.has(h.id)) byId.set(h.id, { ...slim(h), to: (h.recipients || []).join(', '), conversation: true });
    }
    onProgress(byId.size);
  }
  return [...byId.values()];
}

export async function openMessage(api, id) {
  return api.messageDisplay.open({ messageId: id, location: 'tab' });
}
