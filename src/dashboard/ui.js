// Small DOM helpers shared by the dashboard tabs. Text is always set with
// textContent, never innerHTML, because subjects and names come from email.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'indeterminate' || k === 'value') el[k] = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

export function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleDateString() : '';
}
export function fmtDateTime(ms) {
  return ms ? new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}
export function fmtSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function plural(n, one, many = one + 's') {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

// ---- status banner and progress ---------------------------------------------

let statusEl;
let progressEl;
export function initStatus(status, progress) { statusEl = status; progressEl = progress; }

// kind: 'info' | 'ok' | 'warn' | 'error'; buttons: [{ label, onclick, class }]
export function setStatus(text, kind = 'info', buttons = []) {
  if (!statusEl) return;
  clear(statusEl);
  if (!text) { statusEl.hidden = true; return; }
  statusEl.hidden = false;
  statusEl.className = `status status-${kind}`;
  statusEl.append(h('span', { text: `${new Date().toLocaleTimeString()}: ${text}` }));
  for (const b of buttons) statusEl.append(' ', h('button', { class: b.class || '', onclick: b.onclick, text: b.label }));
  statusEl.append(h('button', { class: 'link close', title: 'Dismiss', onclick: () => setStatus(''), text: '×' }));
}

export function setProgress(text) {
  if (!progressEl) return;
  progressEl.hidden = !text;
  progressEl.textContent = text || '';
}

// ---- one mail action at a time ----------------------------------------------

let busy = false;
export function isBusy() { return busy; }

// Runs a mail action triggered by a click. Returns undefined if another one is running.
export async function runAction(fn) {
  if (busy) { setStatus('Another action is still running. Wait for it to finish.', 'warn'); return undefined; }
  busy = true;
  document.body.classList.add('busy');
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e && e.message || e}`, 'error');
    return undefined;
  } finally {
    busy = false;
    document.body.classList.remove('busy');
    setProgress('');
  }
}

// ---- confirmation (used only for "Clear log", R-UND-5) --------------------------

export function confirmDialog(message, okLabel = 'OK') {
  return new Promise(resolve => {
    const dlg = h('dialog', { class: 'confirm' },
      h('p', { text: message }),
      h('div', { class: 'row' },
        h('button', { class: 'danger', onclick: () => { dlg.close(); resolve(true); }, text: okLabel }),
        h('button', { onclick: () => { dlg.close(); resolve(false); }, text: 'Cancel' })));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(false); });
    document.body.append(dlg);
    dlg.showModal();
  });
}
