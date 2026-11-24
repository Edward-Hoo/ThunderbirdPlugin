// Activity tab (README §6): everything the add-on moved, with Restore.

import { h, clear, fmtDateTime, plural, setStatus, setProgress, runAction, confirmDialog } from './ui.js';
import { api, store, state, onChange, updateConfig } from './state.js';
import { loadLog, clearLog } from '../lib/log.js';
import { restore } from '../lib/actions.js';
import { setRule } from '../lib/config.js';

const PAGE = 500;
let root;
let els = {};
const view = { filter: 'all', limit: PAGE, log: [] };

export function initActivity(container) {
  root = container;
  els.filter = h('select', { onchange: e => { view.filter = e.target.value; view.limit = PAGE; render(); } },
    h('option', { value: 'all', text: 'Everything' }),
    h('option', { value: 'trash', text: 'Trashed only' }),
    h('option', { value: 'move', text: 'Moved to folders only' }),
    h('option', { value: 'new-mail', text: 'Trashed by Block rules on new mail' }));
  els.restoreShown = h('button', { onclick: () => doRestore(shownTargets(), 'everything shown'), text: 'Restore all shown' });
  els.clear = h('button', { onclick: doClear, text: 'Clear log' });
  els.table = h('table', { class: 'activity' });
  els.more = h('div');
  root.append(
    h('div', { class: 'row' }, h('span', { class: 'muted', text: 'What Ed\'s Mail Helper did. Restore puts a message back in the folder it came from (or the Inbox if that folder is gone), while it is still in the Trash or folder it was moved to.' })),
    h('div', { class: 'row' }, els.filter, els.restoreShown, els.clear),
    els.table, els.more);
  onChange(what => { if (what === 'log') reload(); });
  reload();
}

export async function reload() {
  view.log = await loadLog(store);
  render();
}

function batchShown(b) {
  if (view.filter === 'all') return true;
  if (view.filter === 'new-mail') return b.source === 'new-mail';
  return b.action === view.filter;
}

function shownBatches() {
  return view.log.filter(batchShown);
}

function shownTargets() {
  const out = [];
  let n = 0;
  for (const b of shownBatches()) b.entries.forEach((e, index) => { if (n++ < view.limit && !e.restored) out.push({ batch: b, index }); });
  return out;
}

function doRestore(targets, label) {
  if (!targets.length) { setStatus('Nothing to restore here.', 'warn'); return; }
  return runAction(async () => {
    setProgress(`Restoring ${label}: 0 of ${targets.length}…`);
    const r = await restore(api, store, state.index, targets, { onProgress: p => setProgress(`Restoring ${label}: ${p.done} of ${p.total}…`) });
    setStatus(`Restore ${label}: ${r.summary} Rescan to see restored messages in the Senders list.`, r.failed || r.notThere ? 'warn' : 'ok');
    await reload();
  });
}

async function doClear() {
  const ok = await confirmDialog('Clear the activity log? You will no longer be able to restore the messages listed here from this add-on (they stay in Trash until Thunderbird empties it).', 'Clear log');
  if (!ok) return;
  const n = await clearLog(store);
  setStatus(`Cleared ${plural(n, 'log batch', 'log batches')}.`, 'ok');
  await reload();
}

function actionText(b, e) {
  if (e.restored) return `restored to ${state.index.folderName(e.restoredTo)}`;
  if (b.action === 'trash') return `trashed (from ${e.folderName})`;
  return `moved to ${e.destName} (from ${e.folderName})`;
}

function render() {
  const batches = shownBatches();
  const tb = h('tbody');
  let n = 0;
  let total = 0;
  for (const b of batches) total += b.entries.length;
  for (const b of batches) {
    if (n >= view.limit) break;
    const pending = b.entries.map((e, index) => ({ e, index })).filter(x => !x.e.restored);
    if (b.entries.length > 1) {
      tb.append(h('tr', { class: 'batch' }, h('td', { colspan: 5 },
        h('strong', { text: `${fmtDateTime(b.t)}: ${b.entries.length} messages ${b.action === 'trash' ? 'trashed' : 'moved'} together (${b.reason})` })),
      h('td', { class: 'actions' }, pending.length
        ? h('button', { class: 'primary', onclick: () => doRestore(pending.map(x => ({ batch: b, index: x.index })), b.reason), text: `Restore all ${pending.length}` })
        : h('span', { class: 'muted', text: 'all restored' }))));
    }
    b.entries.forEach((e, index) => {
      if (n++ >= view.limit) return;
      tb.append(h('tr', { class: e.restored ? 'restored' : '' },
        h('td', { class: 'nowrap', text: fmtDateTime(e.t) }),
        h('td', { text: actionText(b, e) }),
        h('td', { class: 'muted', text: e.from }),
        h('td', { text: e.subject }),
        h('td', { class: 'muted' }, b.reason, e.restoreNote ? h('div', { class: 'warn-text', text: `Can't restore: ${e.restoreNote}` }) : ''),
        h('td', { class: 'actions' },
          e.restored ? '' : h('button', { onclick: () => doRestore([{ batch: b, index }], e.subject || 'message'), text: 'Restore' }),
          e.addr && b.action === 'trash' ? h('button', { title: `Add a Keep rule for ${e.addr} so Block rules never trash it`, onclick: async () => {
            await updateConfig(c => setRule(c, 'a:' + e.addr, 'keep', ['a:' + e.addr]));
            setStatus(`Keep rule added for ${e.addr}.`, 'ok');
          }, text: 'Keep sender' }) : '')));
    });
  }
  if (!batches.length) tb.append(h('tr', {}, h('td', { colspan: 6, class: 'muted', text: 'Nothing here yet.' })));
  clear(els.table).append(h('thead', {}, h('tr', {}, h('th', { text: 'When' }), h('th', { text: 'Action' }), h('th', { text: 'From' }), h('th', { text: 'Subject' }), h('th', { text: 'Why' }), h('th'))), tb);
  clear(els.more);
  if (total > view.limit) els.more.append(h('button', { class: 'link', onclick: () => { view.limit += PAGE; render(); }, text: `Show more (${(total - view.limit).toLocaleString()} more)` }));
  els.restoreShown.disabled = !shownTargets().length;
}
