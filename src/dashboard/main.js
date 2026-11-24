// Dashboard entry point. Loading the page only reads accounts, folders and the
// add-on's own storage; no message is listed, searched or moved until a click.

import { initStatus, setStatus } from './ui.js';
import { api, loadState } from './state.js';
import { refreshFolderSuggestions } from './common.js';
import { initSenders } from './senders.js';
import { initPerson, prefill } from './person.js';
import { initCategories } from './categories.js';
import { initRules } from './rules.js';
import { initActivity } from './activity.js';
import { initSettings } from './settings.js';

const TABS = ['senders', 'person', 'categories', 'rules', 'activity', 'settings'];

export function showTab(name) {
  if (!TABS.includes(name)) name = 'senders';
  for (const t of TABS) {
    document.getElementById(`tab-${t}`).hidden = t !== name;
    document.querySelector(`#tabs [data-tab="${t}"]`).classList.toggle('active', t === name);
  }
}

function openPerson(address) {
  showTab('person');
  prefill(address);
}

async function init() {
  initStatus(document.getElementById('status'), document.getElementById('progress'));
  try { document.getElementById('version').textContent = 'v' + api.runtime.getManifest().version; } catch { /* not available in tests */ }
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  await loadState();
  refreshFolderSuggestions();
  await initSenders(document.getElementById('tab-senders'), { openPerson });
  initPerson(document.getElementById('tab-person'));
  initCategories(document.getElementById('tab-categories'));
  initRules(document.getElementById('tab-rules'));
  initActivity(document.getElementById('tab-activity'));
  await initSettings(document.getElementById('tab-settings'));

  // URL parameters only choose a tab and prefill a field (R-PER-4).
  const params = new URLSearchParams(location.search);
  if (params.get('person')) openPerson(params.get('person'));
  else showTab(params.get('tab') || 'senders');

  // From the right-click menu while the dashboard is already open.
  api.runtime.onMessage.addListener(msg => {
    if (msg && msg.type === 'prefill-person') openPerson(String(msg.person || ''));
  });
}

init().catch(e => {
  console.error(e);
  setStatus(`The dashboard could not start: ${e.message || e}`, 'error');
});
