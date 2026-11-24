// Dashboard state shared by the tabs.

import { loadConfig, saveConfig } from '../lib/store.js';
import { loadAccounts, indexAccounts } from '../lib/mail.js';
import { sanitizeConfig } from '../lib/config.js';
import { LOG_PREFIX } from '../lib/log.js';

export const api = globalThis.messenger || globalThis.browser;
export const store = api.storage.local;

export const state = {
  config: null,
  accounts: [],
  index: null,
  scan: new Map(),    // message id -> scan record (only what actions need)
  scanned: false,
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
export function emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } }

export async function loadState() {
  state.config = await loadConfig(store);
  await refreshAccounts();
}

export async function refreshAccounts() {
  state.accounts = await loadAccounts(api);
  state.index = indexAccounts(state.accounts);
}

// Every config change goes through here, from a user's click or edit.
export async function updateConfig(mutate) {
  state.config = await saveConfig(store, mutate(state.config));
  emit('config');
}

// Drop messages that moved (or no longer exist) from the scan results (R-ACT-7).
export function dropFromScan(items) {
  for (const it of items) state.scan.delete(it.id);
  emit('scan');
}

// R-SND-5: react to changes made elsewhere (another add-on page, a sync load, or the
// background Block rule on new mail). This only updates what is shown.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.config) {
    state.config = sanitizeConfig(changes.config.newValue);
    emit('config');
  }
  let logChanged = false;
  for (const [k, ch] of Object.entries(changes)) {
    if (!k.startsWith(LOG_PREFIX)) continue;
    logChanged = true;
    const rec = ch.newValue;
    if (rec && rec.source === 'new-mail') {
      const gone = new Set(rec.entries.map(e => `${e.hid}\u0000${e.folderId}`));
      for (const [id, m] of state.scan) if (gone.has(`${m.hid}\u0000${m.folderId}`)) state.scan.delete(id);
      emit('scan');
    }
  }
  if (logChanged) emit('log');
});
