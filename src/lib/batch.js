// Batched move engine (README §7). Pure: the caller injects the operations.
//
//   moveFn(ids)   -> Promise; moves those message ids to the destination, throws on failure
//   locate(item)  -> Promise<'moved'|'present'|'gone'>; where the message is now
//                    ('moved' = already in the destination, 'gone' = no longer exists)
//   onConfirmed(items)-> Promise; called only for items verified in the destination (R-UND-2)
//
// Outcome: { moved: [items], gone: [items], failed: [{item, error}] }

export const BATCH_SIZE = 50;

export function notFoundIds(error) {
  const text = String(error && (error.message || error) || '');
  const ids = new Set();
  for (const m of text.matchAll(/Message not found:?\s*(\d+)/gi)) ids.add(Number(m[1]));
  return ids;
}

const defaultSleep = ms => new Promise(r => setTimeout(r, ms));

export async function runBatches(items, { moveFn, locate, onConfirmed = async () => {}, onProgress = () => {},
  batchSize = BATCH_SIZE, pauseMs = 1500, verifyTries = 3, verifyDelayMs = 400, sleep = defaultSleep } = {}) {
  const out = { moved: [], gone: [], failed: [] };
  const total = items.length;
  const report = () => onProgress({ done: out.moved.length + out.gone.length + out.failed.length, total, ...counts(out) });

  const confirm = async list => {
    if (!list.length) return;
    out.moved.push(...list);
    await onConfirmed(list);
  };

  // After a failed attempt: drop the ids the error names as missing, then ask where each
  // remaining message is now (a failed IMAP batch may still have moved part of it).
  // Thunderbird resolves every id before it moves anything, so after a
  // success or an "Aborted" copy, all of them existed when the move started. One that can't be
  // found afterwards was moved: its old id is void and the destination folder just
  // hasn't synced yet. It must be logged, or it could not be restored.
  const settle = async (list, error) => {
    const missing = notFoundIds(error);
    const existed = !error || (!missing.size && /Aborted/.test(String(error.message || error)));
    const remaining = [];
    const movedNow = [];
    for (const item of list) {
      if (missing.has(Number(item.id))) { out.gone.push(item); continue; }
      let where = 'present';
      try { where = await locate(item); } catch { where = 'present'; }
      if (where === 'gone' && !existed) out.gone.push(item);
      else if (where === 'moved' || where === 'gone') movedNow.push(item);
      else remaining.push(item);
    }
    await confirm(movedNow);
    return remaining;
  };

  const attempt = async list => {
    try { await moveFn(list.map(i => i.id)); return null; } catch (e) { return e || new Error('move failed'); }
  };

  // Thunderbird can report a move as done without moving anything, so a reported
  // success is checked message by message; only what is really in the destination
  // counts as moved (R-UND-2). Late moves get a few short waits.
  const verify = async list => {
    let remaining = await settle(list, null);
    for (let k = 0; remaining.length && k < verifyTries; k++) {
      await sleep(verifyDelayMs);
      remaining = await settle(remaining, null);
    }
    return remaining;
  };
  const SILENT = new Error('Thunderbird reported the move as done, but the message is still in its folder');

  for (let i = 0; i < items.length; i += batchSize) {
    let chunk = items.slice(i, i + batchSize);
    // First try, then once more after a pause (R-REL-2).
    for (let round = 0; round < 2 && chunk.length; round++) {
      if (round > 0) await sleep(pauseMs);
      const err = await attempt(chunk);
      chunk = err ? await settle(chunk, err) : await verify(chunk);
    }
    // Then one message at a time.
    for (const item of chunk) {
      const err = await attempt([item]);
      const rest = err ? await settle([item], err) : await verify([item]);
      if (rest.length) out.failed.push({ item, error: String((err || SILENT).message || err) });
    }
    report();
  }
  return out;
}

export function counts(out) {
  return { moved: out.moved.length, gone: out.gone.length, failed: out.failed.length };
}

// R-REL-4
export function summarize(out, verb = 'moved') {
  const { moved, gone, failed } = counts(out);
  let s = `${moved} ${verb}`;
  if (gone) s += `, ${gone} already gone`;
  if (failed) s += `, ${failed} could not be ${verb}; try again for the rest`;
  return s + '.';
}
