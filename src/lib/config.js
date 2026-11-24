// Configuration model: rules, categories, split groups, settings (README §4, §8).
// Pure functions. Nothing here touches mail; callers persist the result.

import { classify, keyKind, scopeText, keyLabel } from './grouping.js';

export const CONFIG_VERSION = 1;

export function emptyConfig() {
  return {
    version: CONFIG_VERSION,
    rules: {},        // key -> { action: 'block'|'keep', created: ms, alts: [key, ...] }
    categories: {},   // name -> { action: 'label'|'keep'|'block' }
    catOf: {},        // key -> category name
    notes: {},        // key -> the user's comment about that sender
    splits: [],       // row keys shown per address (R-GRP-7)
    settings: { blockNewMail: true },
  };
}

const KEY_RE = /^(?:(?:a|s|cc|d):[^\s]{1,320}|n:[^\s|]{1,320}\|[^\u0000-\u001f]{1,200})$/;
const ACTIONS = new Set(['block', 'keep']);
const CAT_ACTIONS = new Set(['label', 'keep', 'block']);
const CAT_NAME_RE = /^[^\u0000-\u001f]{1,60}$/;

// Validate anything that came from storage, a file or a sync email. Unknown or malformed
// entries are dropped, never guessed at.
export function sanitizeConfig(raw) {
  const out = emptyConfig();
  if (!raw || typeof raw !== 'object') return out;
  if (raw.rules && typeof raw.rules === 'object') {
    for (const [key, r] of Object.entries(raw.rules)) {
      if (!KEY_RE.test(key) || !r || !ACTIONS.has(r.action)) continue;
      const alts = Array.isArray(r.alts) ? r.alts.filter(k => typeof k === 'string' && KEY_RE.test(k)) : [];
      out.rules[key] = { action: r.action, created: Number(r.created) || 0, alts: alts.length ? alts : [key] };
    }
  }
  if (raw.categories && typeof raw.categories === 'object') {
    for (const [name, c] of Object.entries(raw.categories)) {
      const n = cleanCategoryName(name);
      if (!n) continue;
      out.categories[n] = { action: c && CAT_ACTIONS.has(c.action) ? c.action : 'label' };
    }
  }
  if (raw.catOf && typeof raw.catOf === 'object') {
    for (const [key, name] of Object.entries(raw.catOf)) {
      if (KEY_RE.test(key) && typeof name === 'string' && out.categories[name]) out.catOf[key] = name;
    }
  }
  if (raw.notes && typeof raw.notes === 'object') {
    for (const [key, text] of Object.entries(raw.notes)) {
      const n = KEY_RE.test(key) && typeof text === 'string' ? cleanNote(text) : '';
      if (n) out.notes[key] = n;
    }
  }
  if (Array.isArray(raw.splits)) out.splits = [...new Set(raw.splits.filter(k => typeof k === 'string' && KEY_RE.test(k) && keyKind(k) !== 'n' && (keyKind(k) !== 'a' || k.includes('@'))))];
  if (raw.settings && typeof raw.settings === 'object') {
    if (typeof raw.settings.blockNewMail === 'boolean') out.settings.blockNewMail = raw.settings.blockNewMail;
  }
  return out;
}

export const NOTE_MAX = 200;
export function cleanNote(text) {
  return String(text ?? '').replace(/[\u0000-\u001f\s]+/g, ' ').trim().slice(0, NOTE_MAX);
}

export function cleanCategoryName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  return CAT_NAME_RE.test(n) ? n : '';
}

// R-EXP-1: merge keeps existing entries, imported wins on conflicts.
export function mergeConfig(current, imported) {
  const a = sanitizeConfig(current);
  const b = sanitizeConfig(imported);
  return sanitizeConfig({
    version: CONFIG_VERSION,
    rules: { ...a.rules, ...b.rules },
    categories: { ...a.categories, ...b.categories },
    catOf: { ...a.catOf, ...b.catOf },
    notes: { ...a.notes, ...b.notes },
    splits: [...a.splits, ...b.splits],
    settings: { ...a.settings, ...b.settings },
  });
}

// ---- rules ---------------------------------------------------------------

// The scopes a rule for this address may use, most specific first.
export function scopesFor(address, splits, name = '') {
  return classify(address, new Set(splits), name).keys;
}

export function setRule(config, key, action, alts) {
  const c = sanitizeConfig(config);
  c.rules[key] = { action, created: Date.now(), alts: alts && alts.length ? alts : [key] };
  return c;
}

export function removeRule(config, key) {
  const c = sanitizeConfig(config);
  delete c.rules[key];
  return c;
}

export function changeRuleScope(config, oldKey, newKey) {
  const c = sanitizeConfig(config);
  const r = c.rules[oldKey];
  if (!r || oldKey === newKey) return c;
  delete c.rules[oldKey];
  c.rules[newKey] = { ...r, alts: r.alts.includes(newKey) ? r.alts : [...r.alts, newKey] };
  return c;
}

// What the user's rules say about one address. Most specific wins (R-BLK-1):
// a rule on the display name at that address (if split by name), then the address,
// then organization/subdomain, then domain; only when no
// rule matches does a category with a Keep/Block action apply, again most specific first.
// Returns { action: 'block'|'keep'|null, key, via: 'rule'|'category', category? }
export function resolveAddress(config, address, name = '') {
  const info = classify(address, new Set(config.splits || []), name);
  for (const key of info.keys) {
    const r = config.rules[key];
    if (r) return { action: r.action, key, via: 'rule' };
  }
  for (const key of info.keys) {
    const name = config.catOf[key];
    const cat = name && config.categories[name];
    if (cat && cat.action !== 'label') return { action: cat.action, key, via: 'category', category: name };
  }
  return { action: null, key: null, via: null };
}

// Status of a row key itself (used for the row's buttons and the "Hide Keep" filter).
export function resolveKey(config, key) {
  const r = config.rules[key];
  if (r) return { action: r.action, via: 'rule' };
  const name = config.catOf[key];
  const cat = name && config.categories[name];
  if (cat && cat.action !== 'label') return { action: cat.action, via: 'category', category: name };
  return { action: null, via: null };
}

export function describeRule(key) {
  return { label: keyLabel(key), scope: scopeText(key) };
}

// ---- categories ----------------------------------------------------------

export function categoryOptionLabel(name, cat) {
  if (!cat) return name;
  if (cat.action === 'block') return `${name} (Block: trashes mail)`;
  if (cat.action === 'keep') return `${name} (Keep)`;
  return name;
}

export function addCategory(config, name) {
  const c = sanitizeConfig(config);
  const n = cleanCategoryName(name);
  if (n && !c.categories[n]) c.categories[n] = { action: 'label' };
  return c;
}

export function renameCategory(config, oldName, newName) {
  const c = sanitizeConfig(config);
  const n = cleanCategoryName(newName);
  if (!n || !c.categories[oldName] || c.categories[n]) return c;
  c.categories[n] = c.categories[oldName];
  delete c.categories[oldName];
  for (const [k, v] of Object.entries(c.catOf)) if (v === oldName) c.catOf[k] = n;
  return c;
}

export function deleteCategory(config, name) {
  const c = sanitizeConfig(config);
  delete c.categories[name];
  for (const [k, v] of Object.entries(c.catOf)) if (v === name) delete c.catOf[k];
  return c;
}

export function setCategoryAction(config, name, action) {
  const c = sanitizeConfig(config);
  if (c.categories[name] && CAT_ACTIONS.has(action)) c.categories[name].action = action;
  return c;
}

export function assignCategory(config, key, name) {
  const c = sanitizeConfig(config);
  if (!name) delete c.catOf[key];
  else if (c.categories[name]) c.catOf[key] = name;
  return c;
}

// An empty comment removes it.
export function setNote(config, key, text) {
  const c = sanitizeConfig(config);
  const n = cleanNote(text);
  if (n) c.notes[key] = n; else delete c.notes[key];
  return c;
}

export function toggleSplit(config, key, on) {
  const c = sanitizeConfig(config);
  const s = new Set(c.splits);
  if (on) s.add(key); else s.delete(key);
  c.splits = [...s];
  return c;
}
