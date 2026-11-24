// Storage keys (all in storage.local, i.e. this computer's Thunderbird profile).
//   config        rules, categories, comments, split groups, settings  (exported / synced)
//   scanSel       folder ids ticked for scanning               (this computer only)
//   sendersView   Senders tab: group by category, collapsed categories (this computer only)
//   syncLocal     { computerName, passphrase, identityId }     (this computer only, never exported)
//   logb:<id>     activity log batches                         (this computer only)

import { sanitizeConfig } from './config.js';

export async function loadConfig(store) {
  const { config } = await store.get('config');
  return sanitizeConfig(config);
}

export async function saveConfig(store, config) {
  const c = sanitizeConfig(config);
  await store.set({ config: c });
  return c;
}

export async function loadLocal(store, key, fallback) {
  const r = await store.get(key);
  return r[key] === undefined ? fallback : r[key];
}

export async function saveLocal(store, key, value) {
  await store.set({ [key]: value });
}
