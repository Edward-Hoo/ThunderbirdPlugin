// Pieces shared by several dashboard tabs.

import { h, setStatus, setProgress, runAction, plural } from './ui.js';
import { api, store, state, dropFromScan, updateConfig, refreshAccounts, emit } from './state.js';
import { trashItems, moveToFolder } from '../lib/actions.js';
import { categoryOptionLabel, assignCategory, setRule, removeRule } from '../lib/config.js';
import { keyLabel } from '../lib/grouping.js';

// <datalist> of existing folders for every "Move to" box (R-ACT-2).
export function refreshFolderSuggestions() {
  let dl = document.getElementById('folder-suggestions');
  if (!dl) { dl = h('datalist', { id: 'folder-suggestions' }); document.body.append(dl); }
  dl.replaceChildren();
  const paths = new Set();
  for (const a of state.accounts) for (const f of a.folders) {
    if (f.isTrash) continue;
    paths.add(f.namePath);
    if (state.accounts.length > 1) paths.add(`${a.name}/${f.namePath}`);
  }
  for (const p of [...paths].sort((x, y) => x.localeCompare(y))) dl.append(h('option', { value: p }));
}

export function folderInput(placeholder = 'Folder/Subfolder') {
  return h('input', { type: 'text', class: 'folder-input', list: 'folder-suggestions', placeholder,
    title: 'An existing folder, or a new name such as Receipts/2026 (missing folders are created). '
      + 'A bare path uses each message\'s own account; start with an account name to pick one account.' });
}

// Category picker. Block categories say so wherever they can be picked (R-CAT-1).
export function categorySelect(key, { onchange } = {}) {
  const cur = state.config.catOf[key] || '';
  const sel = h('select', { class: 'cat-select', title: 'Category (a label inside this add-on)' },
    h('option', { value: '', text: '—', selected: cur === '' }),
    Object.entries(state.config.categories).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, c]) => h('option', { value: name, text: categoryOptionLabel(name, c), selected: cur === name })));
  sel.addEventListener('change', () => {
    updateConfig(c => assignCategory(c, key, sel.value));
    if (onchange) onchange(sel.value);
  });
  return sel;
}

function report(r, what) {
  dropFromScan([...r.moved, ...r.gone]);
  const kind = r.failed.length ? 'warn' : 'ok';
  setStatus(`${what}: ${r.summary}`, kind);
  emit('log');
  return r;
}

// "Trash all" / "Trash" buttons. items: scan records.
export function trashNow(items, label, { reason, what, note = '' } = {}) {
  if (!items.length) { setStatus('Nothing selected.', 'warn'); return Promise.resolve(); }
  return runAction(async () => {
    setProgress(`Moving ${label} to Trash: 0 of ${items.length}…`);
    const r = await trashItems(api, store, state.index, items, {
      reason: reason || `Trash: ${label}`,
      onProgress: p => setProgress(`Moving ${label} to Trash: ${p.done} of ${p.total}…`),
    });
    report(r, what || `Trash ${label}`);
    if (note) setStatus(`${what || `Trash ${label}`}: ${r.summary} ${note}`, r.failed.length ? 'warn' : 'ok');
    return r;
  });
}

// "Move" buttons.
export function moveNow(items, folderText, label) {
  if (!items.length) { setStatus('Nothing selected.', 'warn'); return Promise.resolve(); }
  if (!folderText.trim()) { setStatus('Type or pick a folder to move to.', 'warn'); return Promise.resolve(); }
  return runAction(async () => {
    setProgress(`Moving ${label} to ${folderText}: 0 of ${items.length}…`);
    const r = await moveToFolder(api, store, state.index, items, folderText, {
      reason: `Move: ${label} → ${folderText}`,
      onProgress: p => setProgress(`Moving ${label} to ${folderText}: ${p.done} of ${p.total}…`),
    });
    await refreshAccounts();       // pick up folders that were just created
    refreshFolderSuggestions();
    return report(r, `Move ${label} to ${folderText}`);
  });
}

function newMailNote() {
  return state.config.settings.blockNewMail
    ? 'New mail from it will go to Trash as it arrives.'
    : 'Block rules on new mail are switched off in Settings, so future mail is not touched automatically.';
}

// "Block" creates the Block rule AND moves the sender's scanned messages to
// Trash (logged, restorable). "Keep" only creates a rule. Clicking an active
// Unblock / Unkeep removes the rule and moves nothing.
export async function toggleRule(key, action, alts, scanned) {
  const existing = state.config.rules[key];
  if (existing && existing.action === action) {
    await updateConfig(c => removeRule(c, key));
    setStatus(`Removed the ${action === 'block' ? 'Block' : 'Keep'} rule for ${keyLabel(key)}.${action === 'block' ? ' Messages it already trashed stay in Trash; restore them from the Activity tab.' : ''}`, 'ok');
    return;
  }
  await updateConfig(c => setRule(c, key, action, alts));
  if (action === 'keep') {
    setStatus(`Keep rule added for ${keyLabel(key)}: Block rules and Block categories won't trash its mail.`, 'ok');
    return;
  }
  if (!scanned || !scanned.length) {
    setStatus(`Blocked ${keyLabel(key)}. ${newMailNote()} No scanned messages to trash; scan first to clean up existing mail.`, 'ok');
    return;
  }
  await trashNow(scanned, keyLabel(key), { reason: `Block: ${keyLabel(key)}`, what: `Blocked ${keyLabel(key)}`, note: newMailNote() });
}

// Bulk bar "Block".
export async function blockAndTrashMany(rows, items, label) {
  for (const { key, alts } of rows) await updateConfig(c => setRule(c, key, 'block', alts));
  if (!items.length) { setStatus(`Blocked ${label}. ${newMailNote()}`, 'ok'); return; }
  await trashNow(items, label, { reason: `Block: ${label}`, what: `Blocked ${label}`, note: newMailNote() });
}
