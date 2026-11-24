// High-level actions shared by the dashboard and the background script.
// Each one is invoked by a click handler, except trashItems() which background.js
// also calls for R-BLK-2 (Block rules on new mail).

import { moveItems, ensureFolderPath, findInFolder } from './mail.js';
import { startBatch, restoreEntries, saveBatch } from './log.js';
import { summarize } from './batch.js';

function logCtx(index, destId) {
  return {
    destId,
    destName: index.folderName(destId),
    folderName: id => index.folderName(id),
    accountName: id => index.account(id)?.name || '',
  };
}

// Move to each message's own account Trash (R-GR-6: never a permanent delete).
export async function trashItems(api, store, index, items, { reason, source = 'dashboard', onProgress } = {}) {
  const batch = startBatch(store, { action: 'trash', reason, source });
  const r = await moveItems(api, items, it => index.trashOf(it.accountId)?.id || null, {
    onProgress,
    onConfirmed: (moved, destId) => batch.add(moved, logCtx(index, destId)),
  });
  await batch.done();
  return { ...r, batchId: batch.id, summary: summarize(r, 'moved to Trash').replace('could not be moved to Trash', 'could not be moved') };
}

// Parse what the user typed in a "Move to" box. "Account name/Path" targets that
// account for every message; a bare "Path" means that path in each message's own account.
export function parseTarget(index, text) {
  const t = String(text || '').trim().replace(/^\/+|\/+$/g, '');
  if (!t) return null;
  for (const a of index.accounts) {
    const prefix = a.name + '/';
    if (t.toLowerCase().startsWith(prefix.toLowerCase())) return { accountId: a.id, path: t.slice(prefix.length) };
  }
  return { accountId: null, path: t };
}

// R-ACT-2: move to a named folder, creating it when missing.
export async function moveToFolder(api, store, index, items, text, { reason, onProgress } = {}) {
  const target = parseTarget(index, text);
  if (!target || !target.path) throw new Error('Type a folder name, e.g. Receipts/2026');
  const accountIds = target.accountId ? [target.accountId] : [...new Set(items.map(i => i.accountId))];
  const destByAccount = new Map();
  for (const acc of accountIds) destByAccount.set(acc, await ensureFolderPath(api, index, acc, target.path));
  const batch = startBatch(store, { action: 'move', reason: reason || `moved to ${target.path}`, source: 'dashboard' });
  const r = await moveItems(api, items, it => destByAccount.get(target.accountId || it.accountId) || null, {
    onProgress,
    onConfirmed: (moved, destId) => batch.add(moved, logCtx(index, destId)),
  });
  await batch.done();
  return { ...r, batchId: batch.id, summary: summarize(r, 'moved') };
}

// R-UND-3: put messages back where they came from.
export async function restore(api, store, index, targets, { onProgress } = {}) {
  const r = await restoreEntries(targets, {
    find: (hid, folderId) => findInFolder(api, hid, folderId),
    move: (items, destFor, onConfirmed) => moveItems(api, items, destFor, { onConfirmed, onProgress }),
    folderExists: id => index.folders.has(id),
    inboxOf: accountId => index.inboxOf(accountId)?.id || null,
  });
  for (const rec of r.changed) await saveBatch(store, rec);
  let s = `${r.restored} restored`;
  if (r.notThere) s += `, ${r.notThere} no longer in Trash (or the folder they were moved to), so they can't be restored from here`;
  if (r.failed) s += `, ${r.failed} could not be moved; try again for the rest`;
  if (r.already) s += `, ${r.already} were already restored`;
  return { ...r, summary: s + '.' };
}
