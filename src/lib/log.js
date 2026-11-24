// Activity log and undo (README §6). Each action is stored as its own record under
// "logb:<batchId>", so the dashboard and the background script never overwrite each
// other's writes.

export const LOG_PREFIX = 'logb:';

export function newBatchId(now = Date.now()) {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Start a batch record. Entries are added only after the server confirmed the move
// (R-UND-2), via add().
//   meta: { action: 'trash'|'move', reason, source: 'dashboard'|'new-mail', destName }
export function startBatch(store, meta, now = Date.now) {
  const id = newBatchId(now());
  const record = { id, t: now(), action: meta.action, reason: meta.reason || '', source: meta.source || 'dashboard', entries: [] };
  let chain = Promise.resolve();
  return {
    id,
    record,
    // items: scan records; ctx: { destId, destName, folderName(id), accountName(id) }
    add(items, ctx) {
      const t = now();
      for (const it of items) {
        record.entries.push({
          t,
          from: it.author || it.addr || '',
          addr: it.addr || '',
          subject: it.subject || '',
          accountId: it.accountId,
          accountName: ctx.accountName ? ctx.accountName(it.accountId) : '',
          folderId: it.folderId,           // original folder: where Restore puts it back
          folderName: ctx.folderName ? ctx.folderName(it.folderId) : it.folderId,
          destId: ctx.destId,
          destName: ctx.destName || '',
          hid: it.hid || '',
        });
      }
      chain = chain.then(() => store.set({ [LOG_PREFIX + id]: record }));
      return chain;
    },
    done() { return chain; },
  };
}

export async function loadLog(store) {
  const all = await store.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(LOG_PREFIX))
    .map(([, v]) => v)
    .filter(r => r && Array.isArray(r.entries) && r.entries.length)
    .sort((a, b) => b.t - a.t);
}

export async function clearLog(store) {
  const all = await store.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(LOG_PREFIX));
  if (keys.length) await store.remove(keys);
  return keys.length;
}

export async function saveBatch(store, record) {
  await store.set({ [LOG_PREFIX + record.id]: record });
}

// Restore entries (R-UND-3, R-UND-5). Pure orchestration; mail access is injected:
//   find(hid, folderId) -> Promise<[scanRecord]>   messages with that Message-ID in that folder
//   move(items, destFor, onConfirmed) -> Promise<{moved, gone, failed}>
//   folderExists(id) -> bool ; inboxOf(accountId) -> folderId|null
// targets: [{ batch, index }] referencing records loaded by loadLog().
// Returns { restored, notThere, failed, records: Set of changed records }
export async function restoreEntries(targets, { find, move, folderExists, inboxOf }) {
  const result = { restored: 0, notThere: 0, failed: 0, already: 0, changed: new Set() };
  // De-duplicate: the same message (Message-ID + where it went) is restored once,
  // and every log entry for it is marked.
  const groups = new Map();
  for (const t of targets) {
    const e = t.batch.entries[t.index];
    if (!e || e.restored) { result.already++; continue; }
    const k = `${e.hid}\u0000${e.destId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const items = [];
  for (const [, list] of groups) {
    const e = list[0].batch.entries[list[0].index];
    let found = [];
    try { found = e.hid ? await find(e.hid, e.destId) : []; } catch { found = []; }
    if (!found.length) {
      result.notThere += list.length;
      for (const t of list) { t.batch.entries[t.index].restoreNote = 'not in ' + (e.destName || 'Trash') + ' any more'; result.changed.add(t.batch); }
      continue;
    }
    const target = folderExists(e.folderId) ? e.folderId : inboxOf(e.accountId);
    items.push({ ...found[0], _restoreTo: target, _targets: list });
  }
  if (items.length) {
    const r = await move(items, it => it._restoreTo, async moved => {
      const t = Date.now();
      for (const it of moved) for (const x of it._targets) {
        const entry = x.batch.entries[x.index];
        entry.restored = t;
        entry.restoredTo = it._restoreTo;
        delete entry.restoreNote;
        result.changed.add(x.batch);
      }
    });
    for (const it of r.moved) result.restored += it._targets.length;
    for (const it of r.gone) { result.notThere += it._targets.length; }
    for (const f of r.failed) result.failed += f.item._targets.length;
  }
  return result;
}
