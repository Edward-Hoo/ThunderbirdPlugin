// Settings tab: Block rules on new mail (R-BLK-2), sync (R-SYN-1), export/import (R-EXP-1).

import { h, clear, setStatus, setProgress, runAction } from './ui.js';
import { api, store, state, onChange, updateConfig } from './state.js';
import { sanitizeConfig, mergeConfig, CONFIG_VERSION } from '../lib/config.js';
import { loadLocal, saveLocal } from '../lib/store.js';
import { publish, loadLatest } from '../lib/sync.js';

let root;
let els = {};

export async function initSettings(container) {
  root = container;
  const local = await loadLocal(store, 'syncLocal', {});
  build(local || {});
  onChange(what => { if (what === 'config') els.newMail.checked = state.config.settings.blockNewMail; });
}

function saveSyncLocal() {
  return saveLocal(store, 'syncLocal', { computerName: els.computer.value.trim(), passphrase: els.pass.value, identityId: els.identity.value });
}

// Before replacing the configuration from a file or a sync email, keep the previous
// one so the user can go back with one click.
async function replaceConfigWithUndo(next, label) {
  const previous = state.config;
  await saveLocal(store, 'configBeforeLoad', { t: Date.now(), config: previous, label });
  await updateConfig(() => next);
  setStatus(`${label} Rules: ${Object.keys(next.rules).length}, categories: ${Object.keys(next.categories).length}, split groups: ${next.splits.length}.`, 'ok', [
    { label: 'Undo: put my previous configuration back', onclick: async () => {
      await updateConfig(() => previous);
      setStatus('Previous configuration restored.', 'ok');
    } }]);
}

function build(local) {
  clear(root);

  // ---- R-BLK-2 ----
  els.newMail = h('input', { type: 'checkbox', checked: state.config.settings.blockNewMail, onchange: e => {
    updateConfig(c => ({ ...c, settings: { ...c.settings, blockNewMail: e.target.checked } }));
    setStatus(e.target.checked ? 'Block rules now apply to new mail as it arrives.' : 'Block rules no longer apply to new mail. They act only when you click “Apply my Block rules…”.', 'ok');
  } });
  root.append(h('fieldset', {}, h('legend', { text: 'New mail' }),
    h('label', {}, els.newMail, ' Apply my Block rules to new mail: move new inbox mail from blocked senders to Trash as it arrives'),
    h('p', { class: 'muted', text: 'This is the only thing the add-on does without a click, and it only follows rules you created. Every message it moves is listed in Activity and can be restored. Senders with a Keep rule are never affected.' })));

  // ---- R-SYN-1 ----
  els.computer = h('input', { type: 'text', placeholder: 'e.g. Linux desktop', value: local.computerName || '', onchange: saveSyncLocal });
  els.pass = h('input', { type: 'password', value: local.passphrase || '', autocomplete: 'new-password', onchange: saveSyncLocal });
  const show = h('button', { onclick: () => { els.pass.type = els.pass.type === 'password' ? 'text' : 'password'; show.textContent = els.pass.type === 'password' ? 'Show' : 'Hide'; }, text: 'Show' });
  els.identity = h('select', { onchange: saveSyncLocal }, h('option', { value: '', text: 'Choose an address…' }),
    state.accounts.flatMap(a => a.identities.map(i => h('option', { value: i.id, text: `${i.email} (${a.name})`, selected: i.id === local.identityId }))));
  const identity = () => state.accounts.flatMap(a => a.identities).find(i => i.id === els.identity.value);
  const doPublish = () => runAction(async () => {
    if ((els.pass.value || '').length < 8) { setStatus('Choose a passphrase of at least 8 characters.', 'warn'); return; }
    await saveSyncLocal();
    setProgress('Encrypting and sending your configuration…');
    const r = await publish(api, { identity: identity(), passphrase: els.pass.value, computerName: els.computer.value.trim(), config: state.config });
    setStatus(`Published your configuration by email at ${new Date(r.t).toLocaleString()}. Load it on your other computers with “Load latest now”.`, 'ok');
  });
  const doLoad = () => runAction(async () => {
    if (!els.pass.value) { setStatus('Type your sync passphrase first.', 'warn'); return; }
    await saveSyncLocal();
    setProgress('Looking for sync emails…');
    const r = await loadLatest(api, els.pass.value);
    if (!r) { setStatus('No sync email could be decrypted with this passphrase. Nothing changed.', 'warn'); return; }
    await replaceConfigWithUndo(r.config, `Loaded the configuration published ${new Date(r.t).toLocaleString()}${r.computer ? ` from ${r.computer}` : ''}.`);
  });
  root.append(h('fieldset', {}, h('legend', { text: 'Sync between computers' }),
    h('p', { class: 'muted', text: 'Your rules, categories, sender comments and split groups are encrypted with a passphrase and emailed to yourself; your other computers load the newest one. '
      + 'Use the same passphrase everywhere. It is stored only in this Thunderbird profile and never sent. Keeping it safe is your responsibility: anyone with it and the email can read your settings. '
      + 'Nothing happens automatically: only the two buttons below send or read sync emails, and they are never deleted or filed.' }),
    h('div', { class: 'form' },
      h('label', {}, 'This computer’s name ', els.computer),
      h('label', {}, 'Passphrase ', els.pass, ' ', show),
      h('label', {}, 'Send to / from ', els.identity)),
    h('div', { class: 'row' }, h('button', { onclick: doPublish, text: 'Publish now' }), h('button', { onclick: doLoad, text: 'Load latest now' }))));

  // ---- R-EXP-1 ----
  const out = h('textarea', { rows: 6, readonly: true, hidden: true, class: 'export' });
  const doExport = () => {
    const data = JSON.stringify({ app: 'eds-mail-helper', version: CONFIG_VERSION, exported: new Date().toISOString(), config: state.config }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = h('a', { href: url, download: `eds-mail-helper-config-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    out.hidden = false; out.value = data;
    setStatus('Configuration exported. If no download appeared, copy the text shown below the Export button into a .json file.', 'ok');
  };
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  const mode = h('select', {}, h('option', { value: 'merge', text: 'Merge with current (keeps existing, imported wins on conflicts)' }), h('option', { value: 'replace', text: 'Replace current configuration' }));
  const doImport = async () => {
    const f = file.files && file.files[0];
    if (!f) { setStatus('Choose a file first.', 'warn'); return; }
    let parsed;
    try { parsed = JSON.parse(await f.text()); } catch { setStatus('That file is not valid JSON. Nothing changed.', 'error'); return; }
    const incoming = sanitizeConfig(parsed && parsed.config ? parsed.config : parsed);
    const next = mode.value === 'replace' ? incoming : mergeConfig(state.config, incoming);
    await replaceConfigWithUndo(next, `Imported ${f.name} (${mode.value}).`);
  };
  root.append(h('fieldset', {}, h('legend', { text: 'Backup & transfer' }),
    h('p', { class: 'muted', text: 'Export your rules, categories, sender comments, split groups and settings to a file, as a backup or to import on another computer. Folder selections, the sync passphrase and the activity log are not included. Keep exported files private.' }),
    h('div', { class: 'row' }, h('button', { onclick: doExport, text: 'Export configuration…' })), out,
    h('div', { class: 'row' }, file, mode, h('button', { onclick: doImport, text: 'Import' }))));

  root.append(h('fieldset', {}, h('legend', { text: 'Privacy' }),
    h('p', { class: 'muted', text: 'Ed\'s Mail Helper makes no network requests and sends no telemetry. Everything stays in this Thunderbird profile, except the sync email you send yourself with “Publish now”.' })));
}
