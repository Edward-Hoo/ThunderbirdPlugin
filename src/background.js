// Background script.
//
// What it does:
//   * opens the dashboard (toolbar button, Tools menu, message-list right-click)
//   * R-BLK-2: when NEW mail arrives in an inbox and the user's own Block rule matches
//     its sender, moves that message to Trash (logged and undoable). This is the only
//     place the add-on touches mail without a click, and it is switched off by the
//     "Apply Block rules to new mail" setting.
//
// What it deliberately does NOT do (README §1): no alarms or timers, no work on
// install/startup, no onConfirmed/onDeleted listeners, no scanning of existing mail.

import { loadConfig } from './lib/store.js';
import { resolveAddress } from './lib/config.js';
import { keyLabel, parseAuthor } from './lib/grouping.js';
import { loadAccounts, indexAccounts, slim } from './lib/mail.js';
import { trashItems } from './lib/actions.js';

const api = globalThis.messenger || globalThis.browser;
const DASHBOARD = 'dashboard/dashboard.html';

// ---- dashboard ---------------------------------------------------------------

let dashboardTabId = null;

async function rememberTab(id) {
  dashboardTabId = id;
  try { await api.storage.session?.set({ dashboardTabId: id }); } catch { /* not available */ }
}
async function knownTab() {
  if (dashboardTabId != null) return dashboardTabId;
  try { return (await api.storage.session?.get('dashboardTabId'))?.dashboardTabId ?? null; } catch { return null; }
}

export async function openDashboard(params = {}) {
  const id = await knownTab();
  if (id != null) {
    try {
      const tab = await api.tabs.get(id);
      await api.tabs.update(id, { active: true });
      if (tab.windowId != null && api.windows) await api.windows.update(tab.windowId, { focused: true });
      if (params.person) await api.runtime.sendMessage({ type: 'prefill-person', person: params.person });
      return;
    } catch { /* tab was closed */ }
  }
  const q = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const tab = await api.tabs.create({ url: api.runtime.getURL(DASHBOARD) + (q ? `?${q}` : '') });
  await rememberTab(tab.id);
}

api.tabs.onRemoved.addListener(id => { if (id === dashboardTabId) rememberTab(null); });

// ---- menus (these only open the page; they never act on mail) ------------------

async function setupMenus() {
  await api.menus.removeAll();
  api.menus.create({ id: 'open-dashboard-tools', title: "Ed's Mail Helper Dashboard", contexts: ['tools_menu'] });
  api.menus.create({ id: 'open-dashboard-list', title: 'Open dashboard', contexts: ['message_list'] });
  api.menus.create({ id: 'file-person', title: 'File all mail with this person…', contexts: ['message_list'] });
}
setupMenus().catch(e => console.error('menus', e));

api.menus.onClicked.addListener((info) => {
  if (info.menuItemId === 'file-person') {
    const first = info.selectedMessages?.messages?.[0];
    const person = first ? parseAuthor(first.author).addr : '';
    openDashboard(person ? { tab: 'person', person } : { tab: 'person' });
  } else if (String(info.menuItemId).startsWith('open-dashboard')) {
    openDashboard();
  }
});

api.action.onClicked.addListener(() => openDashboard());

// ---- R-BLK-2: the user's Block rules on new mail ----------------------------------

export async function handleNewMail(folder, messageList) {
  const config = await loadConfig(api.storage.local);
  if (!config.settings.blockNewMail || !Object.keys(config.rules).length && !Object.values(config.categories).some(c => c.action === 'block')) return null;

  const headers = [];
  let page = messageList;
  while (page) {
    headers.push(...(page.messages || []));
    page = page.id ? await api.messages.continueList(page.id) : null;
  }
  const hits = [];
  for (const h of headers) {
    const item = slim(h);
    const r = resolveAddress(config, item.addr, item.name);
    if (r.action === 'block') hits.push({ item, r });
  }
  if (!hits.length) return null;

  const index = indexAccounts(await loadAccounts(api));
  // One log batch per rule, so the Activity tab says which rule moved what.
  const byRule = new Map();
  for (const { item, r } of hits) {
    const why = r.via === 'category' ? `category "${r.category}" (Block) on ${keyLabel(r.key)}` : `rule block: ${keyLabel(r.key)}`;
    if (!byRule.has(why)) byRule.set(why, []);
    byRule.get(why).push(item);
  }
  const results = [];
  for (const [why, items] of byRule) {
    results.push(await trashItems(api, api.storage.local, index, items, { reason: `new mail: ${why}`, source: 'new-mail' }));
  }
  return results;
}

api.messages.onNewMailReceived.addListener((folder, messageList) => {
  handleNewMail(folder, messageList).catch(e => console.error('new mail rule', e));
});
