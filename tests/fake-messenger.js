// A recording fake of the Thunderbird WebExtension API, with a small in-memory
// mailbox. Every API call is appended to fake.calls as { path, args }.
// Used by the gjs tests and by the headless-Chrome dashboard test.

export const MUTATING = ['messages.move', 'messages.delete', 'messages.copy', 'messages.update', 'messages.archive',
  'messages.import', 'folders.create', 'folders.delete', 'folders.move', 'folders.rename', 'compose.sendMessage', 'compose.beginNew'];

export function isMailCall(path) {
  return path.startsWith('messages.') || path.startsWith('folders.') || path.startsWith('compose.') || path.startsWith('messageDisplay.');
}
export function isMutating(path) { return MUTATING.includes(path); }

function evt(name, fake) {
  const listeners = [];
  return {
    addListener(fn, ...extra) { listeners.push(fn); fake.listeners[name] = listeners; void extra; },
    removeListener(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    hasListener(fn) { return listeners.includes(fn); },
    async fire(...args) { return Promise.all(listeners.map(l => l(...args))); },
    get count() { return listeners.length; },
  };
}

// accounts: [{ id, name, folders: [{ path, name, specialUse, subFolders }] , identities }]
export function makeFake({ accounts = defaultAccounts(), messages = [], pageSize = 100 } = {}) {
  const fake = { calls: [], listeners: {}, store: {}, session: {}, hooks: {} };
  const rec = (path, args) => fake.calls.push({ path, args: JSON.parse(JSON.stringify(args ?? null)) });
  let nextId = 1;
  const mail = new Map(); // id -> { header fields, folderId }
  const folderIndex = new Map();
  const renamed = new Map(); // old id -> new id after a move (test helper only)

  const toFolder = (acc, f) => ({ id: `${acc.id}:/${f.path}`, accountId: acc.id, path: '/' + f.path, name: f.name, specialUse: f.specialUse || [],
    subFolders: (f.subFolders || []).map(s => toFolder(acc, s)) });
  const reindex = () => {
    folderIndex.clear();
    const walk = list => list.forEach(f => { folderIndex.set(f.id, f); walk(f.subFolders); });
    for (const acc of accounts) walk(acc.folders.map(f => toFolder(acc, f)));
  };
  reindex();

  fake.addMessage = (m) => {
    const id = nextId++;
    mail.set(id, { id, date: m.date || new Date(2026, 10, 1 + (id % 20)).toISOString(), author: m.author, subject: m.subject || `msg ${id}`,
      read: !!m.read, size: m.size || 1000, headerMessageId: m.hid || `m${id}@test`, recipients: m.recipients || ['me@example.com'],
      ccList: m.ccList || [], folderId: m.folderId, headers: m.headers || {} });
    return id;
  };
  for (const m of messages) fake.addMessage(m);
  fake.mail = mail;

  const header = m => {
    const f = folderIndex.get(m.folderId);
    return { id: m.id, date: m.date, author: m.author, subject: m.subject, read: m.read, size: m.size, headerMessageId: m.headerMessageId,
      recipients: m.recipients, ccList: m.ccList, folder: { id: m.folderId, accountId: f ? f.accountId : m.folderId.split(':/')[0], path: f ? f.path : '', name: f ? f.name : '' } };
  };
  const lists = new Map();
  let nextList = 1;
  const paged = arr => {
    const first = arr.slice(0, pageSize);
    if (arr.length <= pageSize) return { id: null, messages: first };
    const id = `list${nextList++}`;
    lists.set(id, arr.slice(pageSize));
    return { id, messages: first };
  };

  const api = {
    accounts: {
      async list(includeSub) {
        rec('accounts.list', [includeSub]);
        return accounts.map(acc => ({ id: acc.id, name: acc.name, type: acc.type || 'imap', identities: acc.identities || [],
          rootFolder: { id: `${acc.id}:/`, accountId: acc.id, path: '/', name: 'Root', isRoot: true, subFolders: acc.folders.map(f => toFolder(acc, f)) } }));
      },
    },
    folders: {
      async create(parent, name) {
        rec('folders.create', [parent, name]);
        const parentId = typeof parent === 'string' ? parent : parent.id;
        const accId = parentId.split(':/')[0];
        const acc = accounts.find(a => a.id === accId);
        const parentPath = parentId.split(':/')[1] || '';
        const path = parentPath ? `${parentPath}/${name}` : name;
        const node = { path, name, specialUse: [], subFolders: [] };
        if (!parentPath) acc.folders.push(node);
        else {
          const find = (list) => { for (const f of list) { if (f.path === parentPath) return f; const r = find(f.subFolders || []); if (r) return r; } return null; };
          const p = find(acc.folders); (p.subFolders = p.subFolders || []).push(node);
        }
        reindex();
        return { id: `${accId}:/${path}`, accountId: accId, path: '/' + path, name };
      },
    },
    messages: {
      async list(folderId) {
        rec('messages.list', [folderId]);
        return paged([...mail.values()].filter(m => m.folderId === folderId).map(header));
      },
      async continueList(id) {
        rec('messages.continueList', [id]);
        const rest = lists.get(id) || [];
        lists.delete(id);
        return paged(rest);
      },
      async get(id) {
        rec('messages.get', [id]);
        const m = mail.get(id);
        if (!m) throw new Error(`Message not found: ${id}.`);
        return header(m);
      },
      async getFull(id) {
        rec('messages.getFull', [id]);
        const m = mail.get(id);
        if (!m) throw new Error(`Message not found: ${id}.`);
        return { contentType: 'text/plain', body: m.body || '', headers: m.headers, parts: [] };
      },
      async query(q) {
        rec('messages.query', [q]);
        let arr = [...mail.values()];
        if (q.headerMessageId) arr = arr.filter(m => m.headerMessageId === q.headerMessageId);
        if (q.author) arr = arr.filter(m => m.author.toLowerCase().includes(q.author.toLowerCase()));
        if (q.recipients) arr = arr.filter(m => [...m.recipients, ...m.ccList].join(',').toLowerCase().includes(q.recipients.toLowerCase()));
        if (q.subject) arr = arr.filter(m => m.subject.includes(q.subject));
        return paged(arr.map(header));
      },
      async move(ids, dest) {
        rec('messages.move', [ids, dest]);
        // Like Thunderbird: every id is resolved before anything moves.
        for (const id of ids) if (!mail.has(id)) throw new Error(`Message not found: ${id}.`);
        if (fake.hooks.beforeMove) await fake.hooks.beforeMove(ids, dest);
        if (!folderIndex.has(dest)) throw new Error(`Folder not found: ${dest}`);
        // Like Thunderbird 160: a moved message gets a new id; the old id stops resolving.
        for (const id of ids) {
          const m = mail.get(id);
          mail.delete(id);
          const nid = nextId++;
          mail.set(nid, { ...m, id: nid, folderId: dest });
          renamed.set(id, nid);
        }
      },
      async delete(ids, opt) { rec('messages.delete', [ids, opt]); throw new Error('the add-on must never call messages.delete'); },
      async copy(ids, dest) { rec('messages.copy', [ids, dest]); },
      async update(id, p) { rec('messages.update', [id, p]); },
      onNewMailReceived: evt('messages.onNewMailReceived', fake),
      onMoved: evt('messages.onMoved', fake),
      onDeleted: evt('messages.onDeleted', fake),
    },
    messageDisplay: { async open(o) { rec('messageDisplay.open', [o]); } },
    compose: {
      async beginNew(d) { rec('compose.beginNew', [d]); fake.lastCompose = d; return { id: 99 }; },
      async sendMessage(tabId, o) { rec('compose.sendMessage', [tabId, o]); return { mode: 'sendNow' }; },
    },
    storage: {
      local: {
        async get(keys) {
          rec('storage.local.get', [keys]);
          if (keys == null) return JSON.parse(JSON.stringify(fake.store));
          const ks = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          const out = {};
          for (const k of ks) if (k in fake.store) out[k] = JSON.parse(JSON.stringify(fake.store[k]));
          return out;
        },
        async set(obj) {
          rec('storage.local.set', [Object.keys(obj)]);
          const changes = {};
          for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: fake.store[k], newValue: JSON.parse(JSON.stringify(v)) }; fake.store[k] = JSON.parse(JSON.stringify(v)); }
          await api.storage.onChanged.fire(changes, 'local');
        },
        async remove(keys) {
          rec('storage.local.remove', [keys]);
          const changes = {};
          for (const k of [].concat(keys)) { changes[k] = { oldValue: fake.store[k] }; delete fake.store[k]; }
          await api.storage.onChanged.fire(changes, 'local');
        },
      },
      session: {
        async get(k) { return k in fake.session ? { [k]: fake.session[k] } : {}; },
        async set(o) { Object.assign(fake.session, o); },
      },
      onChanged: evt('storage.onChanged', fake),
    },
    menus: {
      async removeAll() { rec('menus.removeAll', []); },
      create(o) { rec('menus.create', [o]); return o.id; },
      onClicked: evt('menus.onClicked', fake),
    },
    action: { onClicked: evt('action.onClicked', fake) },
    tabs: {
      async create(o) { rec('tabs.create', [o]); return { id: 7, windowId: 1 }; },
      async get(id) { rec('tabs.get', [id]); if (id !== 7) throw new Error('no tab'); return { id, windowId: 1 }; },
      async update(id, o) { rec('tabs.update', [id, o]); },
      onRemoved: evt('tabs.onRemoved', fake),
    },
    windows: { async update(id, o) { rec('windows.update', [id, o]); } },
    runtime: {
      getURL: p => `moz-extension://test/${p}`,
      getManifest: () => ({ version: "test" }),
      async sendMessage(m) { rec('runtime.sendMessage', [m]); },
      onMessage: evt('runtime.onMessage', fake),
      onInstalled: evt('runtime.onInstalled', fake),
      onStartup: evt('runtime.onStartup', fake),
    },
  };
  fake.api = api;
  fake.mailCalls = () => fake.calls.filter(c => isMailCall(c.path));
  fake.mutations = () => fake.calls.filter(c => isMutating(c.path));
  const current = id => { while (renamed.has(id)) id = renamed.get(id); return id; };
  fake.folderOf = id => mail.get(current(id))?.folderId;
  fake.current = current;
  return fake;
}

export function defaultAccounts() {
  return [
    { id: 'gm', name: 'me@gmail.com', identities: [{ id: 'id1', email: 'me@gmail.com', name: 'Me' }], folders: [
      { path: 'INBOX', name: 'Inbox', specialUse: ['inbox'] },
      { path: 'Receipts', name: 'Receipts', subFolders: [{ path: 'Receipts/2025', name: '2025' }] },
      { path: '[Gmail]', name: '[Gmail]', subFolders: [
        { path: '[Gmail]/All Mail', name: 'All Mail', specialUse: ['archives'] },
        { path: '[Gmail]/Sent Mail', name: 'Sent Mail', specialUse: ['sent'] },
        { path: '[Gmail]/Trash', name: 'Trash', specialUse: ['trash'] },
        { path: '[Gmail]/Starred', name: 'Starred' },
        { path: '[Gmail]/Important', name: 'Important' },
      ] },
    ] },
    { id: 'ex', name: 'me@work.com', identities: [{ id: 'id2', email: 'me@work.com', name: 'Me' }], folders: [
      { path: 'Inbox', name: 'Inbox', specialUse: ['inbox'] },
      { path: 'Deleted Items', name: 'Deleted Items', specialUse: ['trash'] },
      { path: 'Junk', name: 'Junk', specialUse: ['junk'] },
    ] },
  ];
}
