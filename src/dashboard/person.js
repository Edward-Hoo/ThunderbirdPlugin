// File by person (README §5). Searching only reads; moving needs the Move click.

import { h, clear, fmtDateTime, plural, setStatus, setProgress, runAction } from './ui.js';
import { api, state } from './state.js';
import { findPersonMessages, addConversation, openMessage } from '../lib/mail.js';
import { parseAuthor, normalizeAddress } from '../lib/grouping.js';
import { folderInput, moveNow } from './common.js';

let root;
const view = { results: [], sel: new Set(), address: '' };
let els = {};

export function initPerson(container) {
  root = container;
  els.addr = h('input', { type: 'email', placeholder: 'name@example.com', size: 36 });
  els.convo = h('input', { type: 'checkbox' });
  els.find = h('button', { class: 'primary', onclick: find, text: 'Find' });
  els.out = h('div');
  els.addr.addEventListener('keydown', e => { if (e.key === 'Enter') find(); });
  root.append(
    h('p', { class: 'muted', text: 'Find every message from or to one address (To/Cc), in all accounts including Sent. Then pick a folder and click Move. Nothing moves until you do.' }),
    h('div', { class: 'row' }, h('label', {}, 'Address ', els.addr),
      h('label', { title: 'Also list earlier messages of the same conversations, matched only by Message-ID / References / In-Reply-To headers' }, els.convo, ' Include the rest of each conversation'),
      els.find),
    els.out);
}

// R-PER-4: prefill only; never searches or moves by itself.
export function prefill(address) {
  els.addr.value = address || '';
  view.results = [];
  view.sel.clear();
  clear(els.out);
  els.addr.focus();
}

async function find() {
  const addr = normalizeAddress(parseAuthor(els.addr.value).addr || els.addr.value);
  if (!addr.includes('@')) { setStatus('Type an email address.', 'warn'); return; }
  view.address = addr;
  await runAction(async () => {
    setProgress(`Searching for mail from or to ${addr}…`);
    let list = await findPersonMessages(api, addr, { onProgress: n => setProgress(`Searching for mail from or to ${addr}: ${n} found…`) });
    if (els.convo.checked) list = await addConversation(api, list, { onProgress: n => setProgress(`Adding the rest of each conversation: ${n} messages…`) });
    view.results = list.sort((a, b) => b.date - a.date);
    view.sel = new Set(view.results.map(m => m.id));
    render();
  });
}

function suggestion() {
  const named = view.results.find(m => m.addr === view.address && m.name);
  const name = named ? named.name : view.address.split('@')[0];
  return `People/${name}`;
}

function render() {
  clear(els.out);
  const list = view.results;
  if (!list.length) { els.out.append(h('p', { text: `No messages from or to ${view.address}.` })); return; }
  const where = new Map();
  for (const m of list) { const f = state.index.folderName(m.folderId); where.set(f, (where.get(f) || 0) + 1); }
  els.out.append(h('p', {}, `${plural(list.length, 'message')} with ${view.address}. Currently in: `,
    [...where.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} (${n})`).join(', ')));

  const input = folderInput(`e.g. ${suggestion()}`);
  const count = h('span', { class: 'muted' });
  const selected = () => list.filter(m => view.sel.has(m.id));
  const moveBtn = h('button', { class: 'primary', onclick: async () => {
    const items = selected();
    const r = await moveNow(items, input.value, `${items.length} with ${view.address}`);
    if (r) {
      const done = new Set([...r.moved, ...r.gone].map(m => m.id));
      view.results = view.results.filter(m => !done.has(m.id));
      for (const id of done) view.sel.delete(id);
      render();
    }
  }, text: 'Move' });
  const boxes = [];
  const selAll = h('input', { type: 'checkbox', onchange: e => {
    view.sel = e.target.checked ? new Set(list.map(m => m.id)) : new Set();
    boxes.forEach(b => { b.checked = view.sel.has(Number(b.dataset.id)); }); sync();
  } });
  const sync = () => {
    count.textContent = `${view.sel.size} selected`;
    moveBtn.disabled = !view.sel.size;
    selAll.checked = view.sel.size === list.length;
    selAll.indeterminate = view.sel.size > 0 && view.sel.size < list.length;
  };
  els.out.append(h('div', { class: 'row' }, selAll, count, h('span', { text: 'Move to:' }), input, moveBtn,
    h('span', { class: 'muted', text: `Suggestion (not applied): ${suggestion()}` })));

  const t = h('table', { class: 'messages' });
  t.append(h('thead', {}, h('tr', {}, h('th'), h('th', { text: 'Date' }), h('th', { text: 'Subject' }), h('th', { text: 'From' }), h('th', { text: 'To' }), h('th', { text: 'Folder' }))));
  const tb = h('tbody');
  for (const m of list) {
    const cb = h('input', { type: 'checkbox', checked: view.sel.has(m.id), dataset: { id: String(m.id) }, onchange: e => { e.target.checked ? view.sel.add(m.id) : view.sel.delete(m.id); sync(); } });
    boxes.push(cb);
    tb.append(h('tr', { class: m.read ? '' : 'unread' },
      h('td', {}, cb),
      h('td', { class: 'nowrap', text: fmtDateTime(m.date) }),
      h('td', {}, h('a', { href: '#', onclick: e => { e.preventDefault(); openMessage(api, m.id).catch(err => setStatus(`Could not open: ${err.message || err}`, 'warn')); }, text: m.subject || '(no subject)' }),
        m.conversation ? h('span', { class: 'badge', text: 'conversation' }) : ''),
      h('td', { class: 'muted', text: m.author }),
      h('td', { class: 'muted', text: m.to || '' }),
      h('td', { class: 'muted nowrap', text: state.index.folderName(m.folderId) })));
  }
  t.append(tb);
  els.out.append(t);
  sync();
}
