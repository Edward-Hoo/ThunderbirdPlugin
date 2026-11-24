// Rules tab (R-BLK-1, R-BLK-3, R-GRP-7).

import { h, clear, fmtDate, plural, setStatus } from './ui.js';
import { state, onChange, updateConfig } from './state.js';
import { removeRule, changeRuleScope, setRule, toggleSplit, resolveAddress } from '../lib/config.js';
import { keyLabel, scopeText } from '../lib/grouping.js';
import { trashNow } from './common.js';

let root;

export function initRules(container) {
  root = container;
  render();
  onChange(what => { if (what === 'config' || what === 'scan') render(); });
}

function blockedInScan() {
  return [...state.scan.values()].filter(m => resolveAddress(state.config, m.addr, m.name).action === 'block');
}

function render() {
  clear(root);
  const rules = Object.entries(state.config.rules).sort(([a], [b]) => keyLabel(a).localeCompare(keyLabel(b)));
  const newMail = state.config.settings.blockNewMail;
  root.append(h('p', { class: 'muted' },
    'Rules are created only by your clicks (Block / Keep on the Senders tab). Most specific wins: display name (for addresses split by name), then address, then organization or subdomain, then domain. ',
    newMail ? 'Block rules also move new mail from these senders to Trash as it arrives (logged in Activity, restorable). Switch that off in Settings.'
      : 'Block rules on new mail are switched off in Settings; rules act only when you click the button below.'));

  // R-BLK-3
  const hits = blockedInScan();
  root.append(h('fieldset', {}, h('legend', { text: 'Apply my Block rules to existing mail' }),
    h('p', { class: 'muted', text: state.scanned
      ? `${plural(hits.length, 'scanned message')} come from blocked senders. The button moves exactly those to Trash.`
      : 'Scan folders on the Senders tab first; the button then moves scanned messages from blocked senders to Trash.' }),
    h('button', { class: 'danger', disabled: !hits.length, onclick: () => trashNow(blockedInScan(), 'mail from blocked senders'),
      text: `Apply my Block rules to scanned mail now${hits.length ? ` (${hits.length})` : ''}` })));

  const t = h('table', { class: 'rules' }, h('thead', {}, h('tr', {},
    h('th', { text: 'Sender' }), h('th', { text: 'Scope' }), h('th', { text: 'Action' }), h('th', { text: 'Created' }), h('th'))));
  const tb = h('tbody');
  for (const [key, r] of rules) {
    const scopes = [...new Set([...r.alts, key])];
    const scopeSel = h('select', { disabled: scopes.length < 2, onchange: e => updateConfig(c => changeRuleScope(c, key, e.target.value)) },
      scopes.map(k => h('option', { value: k, text: `${keyLabel(k)} — ${scopeText(k)}`, selected: k === key })));
    const actSel = h('select', { onchange: e => updateConfig(c => setRule(c, key, e.target.value, r.alts)) },
      h('option', { value: 'block', text: 'Block (trashes new mail)', selected: r.action === 'block' }),
      h('option', { value: 'keep', text: 'Keep', selected: r.action === 'keep' }));
    tb.append(h('tr', {},
      h('td', {}, h('strong', { text: keyLabel(key) })),
      h('td', {}, scopeSel, ' ', h('span', { class: 'muted', text: scopeText(key) })),
      h('td', {}, actSel),
      h('td', { text: fmtDate(r.created) }),
      h('td', {}, h('button', { onclick: () => { updateConfig(c => removeRule(c, key)); setStatus(`Removed the rule for ${keyLabel(key)}.`, 'ok'); }, text: 'Remove' }))));
  }
  if (!rules.length) tb.append(h('tr', {}, h('td', { colspan: 5, class: 'muted', text: 'No rules yet.' })));
  t.append(tb);
  root.append(h('h3', { text: `Rules (${rules.length})` }), t);

  // R-GRP-7
  const splits = [...state.config.splits].sort();
  root.append(h('h3', { text: 'Split groups' }),
    h('p', { class: 'muted', text: 'Domains or organizations you marked as shared are listed per address on the Senders tab; addresses you split by name are listed per display name.' }),
    splits.length ? h('ul', {}, splits.map(k => h('li', {}, `${keyLabel(k)} `, k.startsWith('a:') ? h('span', { class: 'muted', text: '(split by display name) ' }) : '',
      h('button', { onclick: () => { updateConfig(c => toggleSplit(c, k, false)); setStatus(`${keyLabel(k)} is grouped again.`, 'ok'); }, text: 'Un-split' }))))
      : h('p', { class: 'muted', text: 'None.' }));
}
