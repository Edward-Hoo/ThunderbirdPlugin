// Senders tab: choose folders, scan, review senders, act (README §3).

import { h, clear, fmtDate, fmtDateTime, fmtSize, plural, setStatus, setProgress, runAction, isBusy } from './ui.js';
import { api, store, state, onChange, updateConfig, emit } from './state.js';
import { classify, keyLabel, keyKind, normalizeName } from '../lib/grouping.js';
import { resolveKey, resolveAddress, toggleSplit, assignCategory } from '../lib/config.js';
import { scanFolders, openMessage } from '../lib/mail.js';
import { loadLocal, saveLocal } from '../lib/store.js';
import { categorySelect, folderInput, trashNow, moveNow, toggleRule, blockAndTrashMany } from './common.js';

const MSG_RENDER_LIMIT = 300;

const view = {
  selection: new Set(),     // folder ids to scan
  openAccounts: new Set(),
  scopeOpen: true,
  filter: '',
  sort: 'count',
  category: '',
  hideKeep: true,
  dateFrom: '',             // 'YYYY-MM-DD', inclusive; not remembered, so it never hides mail unnoticed
  dateTo: '',
  groupByCategory: false,
  closedCats: new Set(),    // category names collapsed ('' = no category)
  rowsSel: new Set(),       // row keys ticked for the bulk bar
  expanded: new Set(),      // row keys expanded
  msgSel: new Map(),        // row key -> Set of message ids
  showAll: new Set(),       // row keys showing more than MSG_RENDER_LIMIT
  scanning: false,
  stop: false,
};

let root;
let els = {};
let goToPerson = () => {};
let syncChecks = () => {};  // refreshes the select-all and category checkboxes

export async function initSenders(container, { openPerson }) {
  root = container;
  goToPerson = openPerson;
  const saved = await loadLocal(store, 'scanSel', null);
  const known = new Set(state.accounts.flatMap(a => a.folders.map(f => f.id)));
  if (Array.isArray(saved)) view.selection = new Set(saved.filter(id => known.has(id)));
  else view.selection = new Set(state.accounts.flatMap(a => a.folders.filter(f => f.isInbox).map(f => f.id)));
  const savedView = await loadLocal(store, 'sendersView', null);
  view.groupByCategory = !!savedView?.groupByCategory;
  view.closedCats = new Set(Array.isArray(savedView?.closedCats) ? savedView.closedCats : []);
  view.scopeOpen = !saved || !saved.length;
  build();
  onChange(what => { if (what === 'config' || what === 'scan') renderList(); });
}

function saveSelection() {
  saveLocal(store, 'scanSel', [...view.selection]);
}

function saveView() {
  saveLocal(store, 'sendersView', { groupByCategory: view.groupByCategory, closedCats: [...view.closedCats] });
}

// ---- layout ---------------------------------------------------------------

function build() {
  clear(root);
  els.scope = h('section', { class: 'panel scope' });
  els.scanBtn = h('button', { class: 'primary', onclick: startScan });
  els.stopBtn = h('button', { hidden: true, onclick: () => { view.stop = true; }, text: 'Stop' });
  els.scanInfo = h('span', { class: 'muted' });
  els.filter = h('input', { type: 'search', placeholder: 'Filter senders…', oninput: e => { view.filter = e.target.value.toLowerCase(); renderList(); } });
  els.sort = h('select', { onchange: e => { view.sort = e.target.value; renderList(); } },
    h('option', { value: 'count', text: 'Most messages' }),
    h('option', { value: 'size', text: 'Largest' }),
    h('option', { value: 'newest', text: 'Newest' }),
    h('option', { value: 'oldest', text: 'Oldest' }),
    h('option', { value: 'name', text: 'Name' }));
  els.catFilter = h('select', { onchange: e => { view.category = e.target.value; renderList(); } });
  els.hideKeep = h('input', { type: 'checkbox', checked: view.hideKeep, onchange: e => { view.hideKeep = e.target.checked; renderList(); } });
  els.groupByCat = h('input', { type: 'checkbox', checked: view.groupByCategory, onchange: e => { view.groupByCategory = e.target.checked; saveView(); renderList(); } });
  const dateInput = (field, title) => h('input', { type: 'date', title, onchange: e => { view[field] = e.target.value; renderList(); } });
  els.dateFrom = dateInput('dateFrom', 'Only messages from this day on');
  els.dateTo = dateInput('dateTo', 'Only messages up to and including this day');
  els.dateClear = h('button', { title: 'Show messages of any date', onclick: () => {
    view.dateFrom = view.dateTo = els.dateFrom.value = els.dateTo.value = '';
    renderList();
  }, text: 'Clear dates' });
  els.dateNote = h('span');
  els.bulk = h('div', { class: 'bulk row' });
  els.table = h('table', { class: 'senders' });
  root.append(
    els.scope,
    h('div', { class: 'row' }, els.scanBtn, els.stopBtn, els.scanInfo),
    h('div', { class: 'row' }, els.filter, els.sort, els.catFilter, h('label', {}, els.hideKeep, ' Hide “Keep” senders'), h('label', {}, els.groupByCat, ' Group by category')),
    h('div', { class: 'row dates' }, h('label', {}, 'From ', els.dateFrom), h('label', {}, 'To ', els.dateTo), els.dateClear, els.dateNote),
    els.bulk,
    els.table,
  );
  renderScope();
  renderList();
}

// ---- folder scope (R-SCP-1..4) --------------------------------------------------

function accountState(a) {
  const n = a.folders.filter(f => view.selection.has(f.id)).length;
  const mail = a.folders.filter(f => f.defaultOn);
  // "Checked" means every mail folder is ticked; Sent/Trash/Junk/Drafts don't count
  // because they are left out by default (R-SCP-2).
  const all = n > 0 && mail.every(f => view.selection.has(f.id));
  return { n, total: a.folders.length, all, some: n > 0 && !all };
}

// Folders below f in the account's tree (folders are listed depth-first).
function descendants(a, f) {
  const i = a.folders.indexOf(f);
  const out = [];
  for (let j = i + 1; j < a.folders.length && a.folders[j].depth > f.depth; j++) out.push(a.folders[j]);
  return out;
}

function renderScope() {
  clear(els.scope);
  const accs = state.accounts.filter(a => a.folders.length);
  const nAcc = accs.filter(a => accountState(a).n > 0).length;
  const toggle = h('button', { class: 'link', onclick: () => { view.scopeOpen = !view.scopeOpen; renderScope(); } },
    `${view.scopeOpen ? '▾' : '▸'} Folders to scan: `);
  els.scope.append(h('div', { class: 'row' }, toggle, h('span', { class: 'muted', text: `${plural(view.selection.size, 'folder')} in ${plural(nAcc, 'account')}` })));
  els.scanBtn.textContent = `Scan ${plural(view.selection.size, 'folder')}`;
  els.scanBtn.disabled = view.scanning || !view.selection.size;
  if (!view.scopeOpen) return;

  const quick = (label, pick, title) => h('button', { title, onclick: () => {
    view.selection = new Set(accs.flatMap(a => a.folders.filter(pick).map(f => f.id)));
    saveSelection(); renderScope();
  }, text: label });
  els.scope.append(h('div', { class: 'row' }, quick('Inboxes only', f => f.isInbox || f.isSpam, 'Every account\'s Inbox and Spam/Junk folder'), quick('All folders', f => f.defaultOn), quick('None', () => false)));

  const list = h('div', { class: 'accounts' });
  for (const a of accs) {
    const { n, total, all, some } = accountState(a);
    const open = view.openAccounts.has(a.id);
    // Click: when every mail folder is ticked, untick everything in the account;
    // otherwise tick every mail folder.
    const cb = h('input', { type: 'checkbox', checked: all, indeterminate: some, onchange: () => {
      for (const f of a.folders) {
        if (all) view.selection.delete(f.id); else if (f.defaultOn) view.selection.add(f.id);
      }
      saveSelection(); renderScope();
    } });
    const head = h('div', { class: 'account' },
      h('button', { class: 'link twisty', onclick: () => { open ? view.openAccounts.delete(a.id) : view.openAccounts.add(a.id); renderScope(); }, text: open ? '▾' : '▸' }),
      h('label', {}, cb, ' ', h('strong', { text: a.name }), ' ', h('span', { class: 'muted', text: `(${n} of ${total} folders)` })));
    const block = h('div', { class: 'account-block' }, head);
    if (open) {
      const tree = h('div', { class: 'folder-tree' });
      for (const f of a.folders) {
        tree.append(h('label', { class: 'folder', style: `padding-left:${1 + f.depth * 1.2}em` },
          h('input', { type: 'checkbox', checked: view.selection.has(f.id), onchange: e => {
            // A folder's subfolders follow it (Sent/Trash/Junk/Drafts only when unticking).
            const on = e.target.checked;
            on ? view.selection.add(f.id) : view.selection.delete(f.id);
            for (const d of descendants(a, f)) {
              if (!on) view.selection.delete(d.id); else if (d.defaultOn) view.selection.add(d.id);
            }
            saveSelection(); renderScope();
          } }), ' ', f.name, f.use.length ? h('span', { class: 'muted', text: ` (${f.use.join(', ')})` }) : ''));
      }
      block.append(tree);
    }
    list.append(block);
  }
  els.scope.append(list);
}

// ---- scan (R-SCP-5: only on click, read-only) --------------------------------------

async function startScan() {
  if (view.scanning || isBusy()) return;
  const ids = state.accounts.flatMap(a => a.folders.filter(f => view.selection.has(f.id)).map(f => f.id));
  if (!ids.length) return;
  view.scanning = true;
  view.stop = false;
  els.stopBtn.hidden = false;
  renderScope();
  try {
    const r = await scanFolders(api, ids, {
      onProgress: p => setProgress(`Scanning folder ${p.folderIndex} of ${p.folderCount} (${state.index.folderName(ids[p.folderIndex - 1])}): ${p.messages.toLocaleString()} messages…`),
      shouldStop: () => view.stop,
    });
    state.scan = new Map(r.messages.map(m => [m.id, m]));
    state.scanned = true;
    view.rowsSel.clear(); view.msgSel.clear(); view.expanded.clear();
    setStatus(r.stopped ? `Scan stopped early: ${plural(r.messages.length, 'message')} read so far.` : '', r.stopped ? 'warn' : 'info');
  } catch (e) {
    setStatus(`Scan failed: ${e.message || e}`, 'error');
  } finally {
    view.scanning = false;
    els.stopBtn.hidden = true;
    setProgress('');
    renderScope();
    emit('scan');
  }
}

// ---- grouping into rows (README §4) ----------------------------------------------

// R-SND-7: the From/To dates as [start, end) in local time, or null when not set.
function dateRange() {
  if (!view.dateFrom && !view.dateTo) return null;
  let end = Infinity;
  if (view.dateTo) {
    const d = new Date(`${view.dateTo}T00:00`);
    d.setDate(d.getDate() + 1);
    end = d.getTime();
  }
  return { start: view.dateFrom ? new Date(`${view.dateFrom}T00:00`).getTime() : -Infinity, end };
}

// Rows hold only messages inside the date range, so every total and every button on
// this tab covers just those.
export function buildRows() {
  const range = dateRange();
  const splits = new Set(state.config.splits);
  const cache = new Map();
  const rows = new Map();
  for (const m of state.scan.values()) {
    if (range && !(m.date && m.date >= range.start && m.date < range.end)) continue;
    const ck = `${m.addr}\u0000${m.name}`;
    let info = cache.get(ck);
    if (!info) { info = classify(m.addr, splits, m.name); cache.set(ck, info); }
    let row = rows.get(info.rowKey);
    if (!row) {
      row = { key: info.rowKey, info, repName: m.name, count: 0, unread: 0, newest: 0, oldest: Infinity, size: 0, names: new Map(), addrs: new Map(), msgs: [] };
      rows.set(info.rowKey, row);
    }
    row.count++;
    if (!m.read) row.unread++;
    if (m.date > row.newest) row.newest = m.date;
    if (m.date && m.date < row.oldest) row.oldest = m.date;
    row.size += m.size;
    if (m.name) row.names.set(m.name, (row.names.get(m.name) || 0) + 1);
    let a = row.addrs.get(m.addr);
    if (!a) { a = { addr: m.addr, info, count: 0, names: new Map(), msgs: [] }; row.addrs.set(m.addr, a); }
    a.count++;
    if (m.name) a.names.set(m.name, (a.names.get(m.name) || 0) + 1);
    a.msgs.push(m);
    row.msgs.push(m);
  }
  return [...rows.values()];
}

function topNames(map, n = 3) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name]) => name);
}

function rowStatus(row) {
  if (keyKind(row.key) === 'a' || keyKind(row.key) === 'n') return resolveAddress(state.config, row.info.addr, row.repName);
  return resolveKey(state.config, row.key);
}

function visibleRows() {
  const q = view.filter;
  let rows = buildRows();
  rows = rows.filter(r => {
    if (view.hideKeep && rowStatus(r).action === 'keep') return false;
    if (view.category === '__none' && state.config.catOf[r.key]) return false;
    if (view.category && view.category !== '__none' && state.config.catOf[r.key] !== view.category) return false;
    if (!q) return true;
    return r.key.includes(q) || [...r.names.keys()].some(n => n.toLowerCase().includes(q)) || [...r.addrs.keys()].some(a => a.includes(q));
  });
  const by = {
    count: (a, b) => b.count - a.count,
    size: (a, b) => b.size - a.size,
    newest: (a, b) => b.newest - a.newest,
    oldest: (a, b) => a.oldest - b.oldest,
    name: (a, b) => keyLabel(a.key).localeCompare(keyLabel(b.key)),
  }[view.sort];
  return rows.sort((a, b) => by(a, b) || b.count - a.count);
}

// ---- list (R-SND-1..5) ---------------------------------------------------------

function renderCategoryFilter() {
  const cur = view.category;
  clear(els.catFilter).append(
    h('option', { value: '', text: 'All categories', selected: cur === '' }),
    h('option', { value: '__none', text: 'No category', selected: cur === '__none' }),
    ...Object.keys(state.config.categories).sort().map(n => h('option', { value: n, text: n, selected: cur === n })));
}

// Optional top layer (R-SND-6): the visible rows under their category, categories by
// name and uncategorized senders last. Rows keep the chosen sort within each category.
function groupRows(rows) {
  const groups = new Map();
  for (const r of rows) {
    const name = state.config.catOf[r.key] || '';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(r);
  }
  return [...groups.entries()].sort(([a], [b]) => (!a) - (!b) || a.localeCompare(b));
}

function categoryRow(name, rows, cb) {
  const open = !view.closedCats.has(name);
  const sum = f => rows.reduce((n, r) => n + r[f], 0);
  const oldest = Math.min(...rows.map(r => r.oldest));
  const action = state.config.categories[name]?.action;
  const toggleOpen = () => { open ? view.closedCats.add(name) : view.closedCats.delete(name); saveView(); renderList(); };
  return h('tr', { class: `category${open ? ' open' : ''}` },
    h('td', {}, cb),
    h('td', { class: 'who', colspan: 2, onclick: toggleOpen },
      h('span', { class: 'twisty', text: open ? '▾ ' : '▸ ' }), h('strong', { text: name || 'No category' }),
      h('span', { class: 'muted', text: ` ${plural(rows.length, 'sender')}` }),
      action === 'block' || action === 'keep' ? h('span', { class: `badge badge-${action}`, text: action === 'block' ? 'Block category' : 'Keep category' }) : ''),
    h('td', { class: 'num', text: sum('count').toLocaleString() }),
    h('td', { class: 'num', text: sum('unread').toLocaleString() }),
    h('td', { text: fmtDate(Math.max(...rows.map(r => r.newest))) }),
    h('td', { text: fmtDate(oldest === Infinity ? 0 : oldest) }),
    h('td', { class: 'num', text: fmtSize(sum('size')) }),
    h('td', { class: 'actions' }, name ? h('button', { class: 'danger',
      title: `Move every scanned message from the ${plural(rows.length, 'sender')} listed in ${name} to Trash (one time; creates no rule). Senders hidden by a filter are not touched. Undo from Activity.`,
      onclick: () => trashNow(rows.flatMap(r => r.msgs), `category ${name} (${plural(rows.length, 'sender')})`), text: 'Trash all' }) : ''));
}

// A checkbox that ticks a set of rows for the bulk bar.
function rowsCheckbox(rows, title) {
  const cb = h('input', { type: 'checkbox', title, onchange: e => {
    for (const r of rows) e.target.checked ? view.rowsSel.add(r.key) : view.rowsSel.delete(r.key);
    renderList();
  } });
  const sync = () => {
    const n = rows.filter(r => view.rowsSel.has(r.key)).length;
    cb.checked = n > 0 && n === rows.length;
    cb.indeterminate = n > 0 && n < rows.length;
  };
  sync();
  return { cb, sync };
}

export function renderList() {
  if (!els.table) return;
  renderCategoryFilter();
  const rows = visibleRows();
  const all = buildRows();
  const range = dateRange();
  const inRange = all.reduce((n, r) => n + r.count, 0);
  const total = range ? `${inRange.toLocaleString()} of ${plural(state.scan.size, 'message')} in the date range` : plural(inRange, 'message');
  els.dateClear.disabled = !range;
  const backwards = range && range.start >= range.end;
  els.dateNote.className = backwards ? 'warn-text' : 'muted';
  els.dateNote.textContent = backwards ? 'From is after To, so nothing matches.'
    : range ? 'Trash, Block and Move here act only on messages in this range. Rules still cover all new mail.' : '';
  els.scanInfo.textContent = state.scanned ? `${total} from ${plural(all.length, 'sender')}${rows.length !== all.length ? ` (${rows.length.toLocaleString()} shown)` : ''}` : 'Not scanned yet. Choose folders and click Scan. Scanning only reads mail.';
  for (const k of [...view.rowsSel]) if (!all.some(r => r.key === k)) view.rowsSel.delete(k);
  renderBulk(all);

  const groups = view.groupByCategory ? groupRows(rows) : [['', rows]];
  const isOpen = name => !view.groupByCategory || !view.closedCats.has(name);
  // Senders inside a collapsed category aren't shown, so "Select all shown" skips them.
  const shownBox = rowsCheckbox(groups.flatMap(([name, rs]) => isOpen(name) ? rs : []), 'Select all shown');
  const syncs = [shownBox.sync];
  const thead = h('thead', {}, h('tr', {},
    h('th', {}, shownBox.cb), h('th', { text: 'Sender' }), h('th', { text: 'Category' }),
    h('th', { class: 'num', text: 'Msgs' }), h('th', { class: 'num', text: 'Unread' }),
    h('th', { text: 'Newest' }), h('th', { text: 'Oldest' }), h('th', { class: 'num', text: 'Size' }), h('th', { text: 'Actions' })));
  const tbody = h('tbody');
  for (const [name, rs] of groups) {
    if (view.groupByCategory) {
      const box = rowsCheckbox(rs, 'Select every sender listed in this category');
      syncs.push(box.sync);
      tbody.append(categoryRow(name, rs, box.cb));
    }
    if (!isOpen(name)) continue;
    for (const r of rs) {
      tbody.append(senderRow(r));
      if (view.expanded.has(r.key)) tbody.append(h('tr', { class: 'detail' }, h('td', { colspan: 9 }, detail(r))));
    }
  }
  syncChecks = () => syncs.forEach(f => f());
  els.table.classList.toggle('grouped', view.groupByCategory);
  clear(els.table).append(thead, tbody);
}

function statusBadge(st) {
  if (!st.action) return '';
  const text = st.action === 'block' ? 'Blocked' : 'Kept';
  const title = st.via === 'category' ? `by category “${st.category}”` : 'by your rule';
  return h('span', { class: `badge badge-${st.action}`, title, text: st.via === 'category' ? `${text} (category)` : text });
}

function ruleButtons(key, addrForAlts, scannedMsgs, nameForAlts = '') {
  const rule = state.config.rules[key];
  const alts = classify(addrForAlts, new Set(state.config.splits), nameForAlts).keys;
  const isBlock = rule && rule.action === 'block';
  const isKeep = rule && rule.action === 'keep';
  return [
    h('button', { class: 'danger', title: 'Move every scanned message from this sender to Trash (one time; creates no rule)',
      onclick: () => trashNow(scannedMsgs(), keyLabel(key)), text: 'Trash all' }),
    h('button', { class: isBlock ? 'danger on' : 'danger', title: isBlock ? 'Remove the Block rule (moves nothing; restore trashed mail from Activity)' : 'Create a Block rule (new mail from this sender goes to Trash) and move its scanned messages to Trash now. Undo from Activity.',
      onclick: () => toggleRule(key, 'block', alts, scannedMsgs()), text: isBlock ? 'Unblock' : 'Block' }),
    h('button', { class: isKeep ? 'on' : '', title: isKeep ? 'Remove the Keep rule' : 'Create a Keep rule: Block rules and Block categories never trash this sender',
      onclick: () => toggleRule(key, 'keep', alts), text: isKeep ? 'Unkeep' : 'Keep' }),
  ];
}

// The user's comment about a sender (Categories tab) goes after its name.
function withNote(key, text) {
  const note = state.config.notes[key];
  return note ? `${text} (${note})` : text;
}

function senderRow(r) {
  const multi = r.addrs.size > 1;
  const open = view.expanded.has(r.key);
  const names = topNames(r.names);
  const sub = [multi ? `${r.addrs.size} addresses` : '', names.join(', ')].filter(Boolean).join(' · ');
  const viaCc = r.info.via && keyKind(r.key) !== 'a' ? h('span', { class: 'muted', text: ` via ${r.info.via}` }) : '';
  const toggleOpen = () => { open ? view.expanded.delete(r.key) : view.expanded.add(r.key); renderList(); };
  const isName = keyKind(r.key) === 'n';
  const isAddr = keyKind(r.key) === 'a' || isName;
  const canSplit = !isAddr && multi;
  const splitBack = isAddr && r.info.split;
  // One address used by unrelated senders (e.g. forum digests): offer a split by display name.
  const distinctNames = new Set([...r.names.keys()].map(normalizeName));
  const canSplitByName = keyKind(r.key) === 'a' && distinctNames.size > 1;
  const title = isName ? `${topNames(r.names, 1)[0] || ''} <${r.info.addr}>` : isAddr ? r.info.addr : keyLabel(r.key).replace(' (via Constant Contact)', '');
  return h('tr', { class: `sender${open ? ' open' : ''}` },
    h('td', {}, h('input', { type: 'checkbox', checked: view.rowsSel.has(r.key), onchange: e => { e.target.checked ? view.rowsSel.add(r.key) : view.rowsSel.delete(r.key); renderBulk(buildRows()); syncChecks(); } })),
    h('td', { class: 'who', onclick: toggleOpen },
      h('div', {}, h('span', { class: 'twisty', text: open ? '▾ ' : '▸ ' }), h('strong', { text: withNote(r.key, title) }), viaCc, ' ', statusBadge(rowStatus(r))),
      h('div', { class: 'muted small', text: sub })),
    h('td', {}, categorySelect(r.key)),
    h('td', { class: 'num', text: r.count.toLocaleString() }),
    h('td', { class: 'num', text: r.unread.toLocaleString() }),
    h('td', { text: fmtDate(r.newest) }),
    h('td', { text: fmtDate(r.oldest === Infinity ? 0 : r.oldest) }),
    h('td', { class: 'num', text: fmtSize(r.size) }),
    h('td', { class: 'actions' },
      ruleButtons(r.key, r.info.addr, () => [...r.msgs], r.repName),
      canSplit ? h('button', { title: 'This domain mixes unrelated senders: list each address separately from now on', onclick: () => doSplit(r.key, true), text: 'Split' }) : '',
      canSplitByName ? h('button', { title: 'Different senders share this address: list each display name separately from now on', onclick: () => doSplit(r.key, true), text: 'Split by name' }) : '',
      isName ? h('button', { title: `List all display names of ${r.info.addr} together again`, onclick: () => doSplit('a:' + r.info.addr, false), text: 'Un-split names' }) : '',
      splitBack ? h('button', { title: `Group ${r.info.addr} with the rest of its domain again`, onclick: () => doSplit(splitKeyOf(r.info), false), text: 'Un-split' }) : '',
      isAddr ? h('button', { title: 'Find all mail from or to this address and file it', onclick: () => goToPerson(r.info.addr), text: 'File…' }) : ''));
}

function splitKeyOf(info) {
  return info.keys.find(k => keyKind(k) !== 'a' && keyKind(k) !== 'n' && state.config.splits.includes(k)) || info.keys[info.keys.length - 1];
}

async function doSplit(key, on) {
  await updateConfig(c => toggleSplit(c, key, on));
  const per = keyKind(key) === 'a' ? 'display name' : 'address';
  setStatus(on ? `${keyLabel(key)} is now listed per ${per}. Un-split it here or on the Rules tab.` : `${keyLabel(key)} is grouped again.`, 'ok');
}

// ---- expanded row (R-SND-3, R-SND-4, R-ACT-2, R-ACT-3) ---------------------------------

function detail(r) {
  const box = h('div', { class: 'detail-box' });
  // One address, several display names (e.g. forum digests): offer the split right here,
  // where it's visible even when the Actions column is off-screen.
  if (keyKind(r.key) === 'a') {
    const byName = new Map();
    for (const m of r.msgs) {
      const k = normalizeName(m.name);
      if (!k) continue;
      const e = byName.get(k) || { name: m.name, count: 0 };
      e.count++; byName.set(k, e);
    }
    if (byName.size > 1) {
      box.append(h('div', { class: 'row name-split' },
        h('span', { text: `${byName.size} different display names use ${r.info.addr}: ` + [...byName.values()].sort((x, y) => y.count - x.count).map(e => `${e.name} (${e.count})`).join(', ') }),
        h('button', { class: 'primary', title: 'List each display name as its own row, with its own Block / Keep / category', onclick: () => doSplit(r.key, true), text: 'Split by name' })));
    }
  }
  if (r.addrs.size > 1) {
    box.append(h('p', { class: 'muted', text: `${r.addrs.size} different addresses send from ${keyLabel(r.key)}. Act on one address without affecting the others:` }));
    const t = h('table', { class: 'addresses' });
    for (const a of [...r.addrs.values()].sort((x, y) => y.count - x.count)) {
      const aKey = 'a:' + a.addr;
      t.append(h('tr', {},
        h('td', {}, h('strong', { text: withNote(aKey, a.addr) }), ' ', statusBadge(resolveAddress(state.config, a.addr))),
        h('td', { class: 'muted', text: topNames(a.names, 4).join(', ') }),
        h('td', { class: 'num', text: plural(a.count, 'msg') }),
        h('td', {}, categorySelect(aKey)),
        h('td', { class: 'actions' }, ruleButtons(aKey, a.addr, () => [...a.msgs]),
          new Set([...a.names.keys()].map(normalizeName)).size > 1
            ? h('button', { title: 'Different senders share this address: list each display name as its own row from now on', onclick: () => doSplit(aKey, true), text: 'Split by name' }) : '',
          h('button', { title: 'Find all mail from or to this address and file it', onclick: () => goToPerson(a.addr), text: 'File…' }))));
    }
    box.append(t);
  }

  const msgs = [...r.msgs].sort((a, b) => b.date - a.date);
  let sel = view.msgSel.get(r.key);
  if (!sel) { sel = new Set(); view.msgSel.set(r.key, sel); }
  const listed = new Set(msgs.map(m => m.id)); // not trashed, moved or outside the date range
  for (const id of [...sel]) if (!listed.has(id)) sel.delete(id);
  const selected = () => msgs.filter(m => sel.has(m.id));
  const count = h('span', { class: 'muted', text: `${sel.size} selected` });
  const input = folderInput();
  const moveBtn = h('button', { class: 'primary', onclick: () => moveNow(selected(), input.value, `${sel.size} from ${keyLabel(r.key)}`), text: 'Move' });
  const trashBtn = h('button', { class: 'danger', onclick: () => trashNow(selected(), `${sel.size} from ${keyLabel(r.key)}`), text: 'Trash' });
  const sync = () => {
    count.textContent = `${sel.size} selected`;
    moveBtn.disabled = trashBtn.disabled = sel.size === 0;
    selAll.checked = sel.size > 0 && sel.size === msgs.length;
    selAll.indeterminate = sel.size > 0 && sel.size < msgs.length;
  };
  const boxes = [];
  const selAll = h('input', { type: 'checkbox', title: 'Select all', onchange: e => {
    if (e.target.checked) msgs.forEach(m => sel.add(m.id)); else sel.clear();
    boxes.forEach(b => { b.checked = sel.has(Number(b.dataset.id)); });
    sync();
  } });
  box.append(h('div', { class: 'row msg-tools' }, selAll, count, h('span', { text: 'Move to:' }), input, moveBtn, trashBtn));

  const t = h('table', { class: 'messages' });
  const limit = view.showAll.has(r.key) ? Infinity : MSG_RENDER_LIMIT;
  for (const m of msgs.slice(0, limit)) {
    const cb = h('input', { type: 'checkbox', checked: sel.has(m.id), dataset: { id: String(m.id) }, onchange: e => { e.target.checked ? sel.add(m.id) : sel.delete(m.id); sync(); } });
    boxes.push(cb);
    t.append(h('tr', { class: m.read ? '' : 'unread' },
      h('td', {}, cb),
      h('td', { class: 'nowrap', text: fmtDateTime(m.date) }),
      h('td', {}, h('a', { href: '#', title: 'Open this message in Thunderbird', onclick: e => { e.preventDefault(); openMessage(api, m.id).catch(err => setStatus(`Could not open the message (it may have moved since the scan): ${err.message || err}`, 'warn')); }, text: m.subject || '(no subject)' })),
      h('td', { class: 'muted', text: m.author }),
      h('td', { class: 'muted nowrap', text: state.index.folderName(m.folderId) })));
  }
  box.append(t);
  if (msgs.length > limit) box.append(h('button', { class: 'link', onclick: () => { view.showAll.add(r.key); renderList(); }, text: `Show all ${msgs.length.toLocaleString()} messages` }));
  sync();
  return box;
}

// ---- bulk bar (R-ACT-4) ------------------------------------------------------------

function renderBulk(allRows) {
  const chosen = allRows.filter(r => view.rowsSel.has(r.key));
  const n = chosen.length;
  const msgs = () => chosen.flatMap(r => r.msgs);
  const catSel = h('select', { disabled: !n, onchange: async e => {
    const name = e.target.value === '__none' ? '' : e.target.value;
    await updateConfig(c => chosen.reduce((acc, r) => assignCategory(acc, r.key, name), c));
    setStatus(`Category set for ${plural(n, 'sender')}.`, 'ok');
  } }, h('option', { value: '', text: 'Set category…', selected: true }), h('option', { value: '__none', text: '— (none)' }),
  ...Object.entries(state.config.categories).sort(([a], [b]) => a.localeCompare(b)).map(([name, c]) => h('option', { value: name, text: c.action === 'block' ? `${name} (Block: trashes mail)` : name })));
  const blockAll = () => blockAndTrashMany(
    chosen.map(r => ({ key: r.key, alts: classify(r.info.addr, new Set(state.config.splits), r.repName).keys })), msgs(), plural(n, 'sender'));
  const ruleAll = action => async () => {
    for (const r of chosen) {
      const alts = classify(r.info.addr, new Set(state.config.splits), r.repName).keys;
      await updateConfig(c => ({ ...c, rules: { ...c.rules, [r.key]: { action, created: Date.now(), alts } } }));
    }
    setStatus(`Keep rule added for ${plural(n, 'sender')}.`, 'ok');
  };
  clear(els.bulk).append(
    h('span', { class: 'muted', text: `${n} selected` }),
    h('button', { class: 'danger', disabled: !n, title: 'Move every scanned message from the selected senders to Trash', onclick: () => trashNow(msgs(), plural(n, 'sender')), text: 'Trash all' }),
    h('button', { class: 'danger', disabled: !n, title: 'Create Block rules for the selected senders and move their scanned messages to Trash now', onclick: blockAll, text: 'Block' }),
    h('button', { disabled: !n, title: 'Create Keep rules for the selected senders', onclick: ruleAll('keep'), text: 'Keep' }),
    catSel);
}

export function scannedMessagesMatching(pred) {
  return [...state.scan.values()].filter(pred);
}
