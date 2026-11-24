// Categories tab (R-CAT-1). Categories are labels; they never move mail by
// themselves. A category set to Block makes its senders count as blocked, and is
// labeled "(Block: trashes mail)" wherever it can be picked.

import { h, clear, plural, setStatus } from './ui.js';
import { state, onChange, updateConfig } from './state.js';
import { addCategory, renameCategory, deleteCategory, setCategoryAction, assignCategory, categoryOptionLabel, setNote, NOTE_MAX } from '../lib/config.js';
import { keyLabel, scopeText } from '../lib/grouping.js';

let root;
const open = new Set();
let selected = '';   // sender key highlighted by the last click
let shown = '';      // what the rendered page was built from

export function initCategories(container) {
  root = container;
  render();
  onChange(what => { if (what === 'config') refresh(); });
}

const signature = () => JSON.stringify([state.config.categories, state.config.catOf]);

// Saving a comment must not rebuild the page: that would lose the focus, or the click
// on another control that ended the edit. Only the comment boxes are brought up to date.
function refresh() {
  if (signature() !== shown) { render(); return; }
  for (const el of root.querySelectorAll('input.note')) {
    if (el !== document.activeElement) el.value = state.config.notes[el.dataset.key] || '';
  }
}

function select(key) {
  selected = key;
  for (const li of root.querySelectorAll('ul.members li')) li.classList.toggle('selected', li.dataset.key === key);
}

function noteInput(key) {
  return h('input', { type: 'text', class: 'note', dataset: { key }, maxlength: NOTE_MAX, value: state.config.notes[key] || '', placeholder: 'Comment',
    title: 'Your comment about this sender, e.g. who uses this domain',
    onchange: e => updateConfig(c => setNote(c, key, e.target.value)) });
}

// Put a sender in another category. Only the label changes; no mail is touched.
async function moveSender(key, from, to) {
  await updateConfig(c => assignCategory(c, key, to));
  const block = state.config.categories[to]?.action === 'block';
  setStatus(`Moved ${keyLabel(key)} from ${from} to ${to}. ${block
    ? `${to} is a Block category: its new mail goes to Trash (if Block rules on new mail is on in Settings), unless a rule on the sender says otherwise. Existing mail is not touched.`
    : 'No mail was touched.'}`, block ? 'warn' : 'ok');
}

function moveSelect(key, from) {
  const others = Object.entries(state.config.categories).filter(([n]) => n !== from).sort(([a], [b]) => a.localeCompare(b));
  if (!others.length) return '';
  return h('select', { class: 'cat-select', title: 'Move this sender to another category', onchange: e => { if (e.target.value) moveSender(key, from, e.target.value); } },
    h('option', { value: '', text: 'Move to…', selected: true }),
    others.map(([n, c]) => h('option', { value: n, text: categoryOptionLabel(n, c) })));
}

function render() {
  shown = signature();
  clear(root);
  const name = h('input', { type: 'text', placeholder: 'new-category-name' });
  const add = async () => {
    if (!name.value.trim()) return;
    if (state.config.categories[name.value.trim()]) { setStatus('That category already exists.', 'warn'); return; }
    await updateConfig(c => addCategory(c, name.value));
    name.value = '';
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  root.append(
    h('p', { class: 'muted', text: 'Categories are labels inside Ed\'s Mail Helper for grouping and filtering senders (domains, organizations or individual addresses). '
      + 'They never move mail to folders. A category can also Keep or Block its senders; a rule set directly on a sender overrides its category.' }),
    h('div', { class: 'row' }, name, h('button', { onclick: add, text: 'Add category' })));

  const members = new Map();
  for (const [key, cat] of Object.entries(state.config.catOf)) {
    if (!members.has(cat)) members.set(cat, []);
    members.get(cat).push(key);
  }
  const t = h('table', { class: 'cats' }, h('thead', {}, h('tr', {}, h('th', { text: 'Category' }), h('th', { text: 'Action' }), h('th', { class: 'num', text: 'Senders' }), h('th'))));
  const tb = h('tbody');
  for (const [cname, cat] of Object.entries(state.config.categories).sort(([a], [b]) => a.localeCompare(b))) {
    const keys = (members.get(cname) || []).sort();
    const rename = h('input', { type: 'text', value: cname, class: 'cat-name' });
    rename.addEventListener('change', () => {
      const v = rename.value.trim();
      if (v && v !== cname) {
        if (state.config.categories[v]) { setStatus(`A category named ${v} already exists.`, 'warn'); rename.value = cname; return; }
        updateConfig(c => renameCategory(c, cname, v));
      }
    });
    const action = h('select', { onchange: e => {
      updateConfig(c => setCategoryAction(c, cname, e.target.value));
      if (e.target.value === 'block') setStatus(`Category ${cname} now blocks its senders: their new mail goes to Trash (if Block rules on new mail is on in Settings). Existing mail is not touched.`, 'warn');
    } },
    h('option', { value: 'label', text: 'Label only', selected: cat.action === 'label' }),
    h('option', { value: 'keep', text: 'Keep', selected: cat.action === 'keep' }),
    h('option', { value: 'block', text: 'Block: trashes mail', selected: cat.action === 'block' }));
    const isOpen = open.has(cname);
    const memberList = isOpen ? h('ul', { class: 'members' }, keys.map(k => h('li', { class: k === selected ? 'selected' : '', dataset: { key: k }, onclick: () => select(k), onfocusin: () => select(k) },
      h('span', { class: 'member-name', text: keyLabel(k) }), noteInput(k), h('span', { class: 'muted', text: `(${scopeText(k)})` }),
      moveSelect(k, cname),
      h('button', { class: 'link', onclick: () => updateConfig(c => assignCategory(c, k, '')), text: 'remove' })))) : '';
    tb.append(h('tr', {},
      h('td', {}, rename, keys.length
        ? h('div', {}, h('button', { class: 'link', onclick: () => { isOpen ? open.delete(cname) : open.add(cname); render(); }, text: `${isOpen ? '▾' : '▸'} ${plural(keys.length, 'sender')}` }), memberList)
        : h('span', { class: 'muted', text: ' no senders' })),
      h('td', {}, action),
      h('td', { class: 'num', text: String(keys.length) }),
      h('td', {}, h('button', { onclick: () => {
        updateConfig(c => deleteCategory(c, cname));
        setStatus(`Deleted category ${cname}. Its senders are uncategorized; no mail was touched.`, 'ok');
      }, text: 'Delete' }))));
  }
  t.append(tb);
  root.append(t);
}
