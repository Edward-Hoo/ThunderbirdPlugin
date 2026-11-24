// Run with:  gjs -m tests/unit.test.js
// Pure-module tests plus the background-script test (README §11, checks 2, 4, 5, 6).

import { makeFake } from './fake-messenger.js';
import { classify, registrableDomain, parseAuthor, decodeConstantContactLocal } from '../src/lib/grouping.js';
import * as cfg from '../src/lib/config.js';
import { runBatches, summarize } from '../src/lib/batch.js';
import { loadAccounts, indexAccounts, scanFolders, flattenFolders } from '../src/lib/mail.js';
import { trashItems, moveToFolder, restore } from '../src/lib/actions.js';
import { loadLog } from '../src/lib/log.js';
import { buildBody, extractBlob } from '../src/lib/sync.js';

let passed = 0, failed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; results.push(`  ok   ${name}`); }
  catch (e) { failed++; results.push(`  FAIL ${name}\n       ${e && e.message}\n       ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e}`); }
}
function eq(a, b, msg = '') {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg} expected ${B}, got ${A}`);
}
function ok(v, msg = 'expected truthy') { if (!v) throw new Error(msg); }

// ---------------------------------------------------------------- grouping (§4)
await test('R-GRP-1 company subdomains group under the brand domain', () => {
  eq(classify('deals@e.shop.com').rowKey, 'd:shop.com');
  eq(classify('a@shop.com').rowKey, 'd:shop.com');
  eq(classify('news@mail.example.co.uk').rowKey, 'd:example.co.uk');
  eq(registrableDomain('x.y.example.com.au'), 'example.com.au');
  eq(registrableDomain('mail.foo.co.jp'), 'foo.co.jp');
  eq(classify('deals@e.shop.com').keys, ['a:deals@e.shop.com', 's:e.shop.com', 'd:shop.com']);
});
await test('R-GRP-2 personal providers group by individual address', () => {
  for (const a of ['mom@gmail.com', 'x@outlook.com', 'y@hotmail.co.uk', 'z@yahoo.com', 'q@aol.com', 'w@icloud.com', 'p@proton.me', 'g@gmx.de', 'c@comcast.net']) {
    eq(classify(a).rowKey, 'a:' + a, a);
    eq(classify(a).kind, 'personal', a);
  }
});
await test('R-GRP-3 bulk-mail services group by individual address', () => {
  for (const a of ['news@mcsv.net', 'x@list-manage.com', 'b@sendgrid.net', 'c@amazonses.com', 'd@mailgun.org', 'e@hubspotemail.net',
    'f@klaviyomail.com', 'g@cmail19.com', 'h@cmail2.com', 'i@substack.com', 'j@mail.beehiiv.com', 'k@googlegroups.com']) {
    eq(classify(a).rowKey, 'a:' + a, a);
    eq(classify(a).kind, 'bulk', a);
  }
});
await test('R-GRP-4 Constant Contact organization subdomain', () => {
  const c = classify('franklyspeakingnj@gopnewjersey.ccsend.com');
  eq(c.rowKey, 's:gopnewjersey.ccsend.com');
  eq(c.via, 'Constant Contact');
});
await test('R-GRP-5 Constant Contact pooled host decodes the organization', () => {
  eq(classify('frank-steelcurtaincapital.com@shared1.ccsend.com').rowKey, 'cc:steelcurtaincapital.com');
  eq(classify('frank=steelcurtaincapital.com@shared1.ccsend.com').rowKey, 'cc:steelcurtaincapital.com');
  eq(classify('news-mail.bigorg.org@shared3.ccsend.com').rowKey, 'cc:bigorg.org');
  eq(classify('frank-steelcurtaincapital.com@shared1.ccsend.com').via, 'Constant Contact');
  // Never collides with direct mail from the same domain.
  ok(classify('frank@steelcurtaincapital.com').rowKey !== classify('frank-steelcurtaincapital.com@shared1.ccsend.com').rowKey);
  // Known ambiguity: split at the first "-".
  eq(decodeConstantContactLocal('john-doe-example.com'), 'doe-example.com');
});
await test('R-GRP-6 undecodable or personal pooled addresses stay individual', () => {
  eq(classify('info@shared1.ccsend.com').rowKey, 'a:info@shared1.ccsend.com');
  eq(classify('jane-gmail.com@shared1.ccsend.com').rowKey, 'a:jane-gmail.com@shared1.ccsend.com');
  eq(classify('x-notadomain@shared1.ccsend.com').rowKey, 'a:x-notadomain@shared1.ccsend.com');
});
await test('R-GRP-7 split groups list addresses individually', () => {
  const splits = new Set(['d:surlatable.com']);
  eq(classify('a@p.email-promo.surlatable.com', splits).rowKey, 'a:a@p.email-promo.surlatable.com');
  eq(classify('a@p.email-promo.surlatable.com').rowKey, 'd:surlatable.com');
  eq(classify('a@x.other.com', splits).rowKey, 'd:other.com');
});
await test('Split by name: one shared address, unrelated senders told apart by display name', () => {
  const addr = 'digest@vesta.threadloom.news';
  eq(classify(addr).rowKey, 'a:' + addr, 'threadloom is a shared platform -> per address');
  const splits = new Set(['a:' + addr]);
  const chef = classify(addr, splits, 'Chef Talk');
  const oc = classify(addr, splits, 'Overclock.net');
  eq(chef.rowKey, 'n:digest@vesta.threadloom.news|chef talk');
  eq(oc.rowKey, 'n:digest@vesta.threadloom.news|overclock.net');
  eq(classify(addr, splits, '  "CHEF   talk" ').rowKey, chef.rowKey, 'case/spacing/quotes ignored');
  eq(classify(addr, splits, '').rowKey, 'a:' + addr, 'no name -> address row');
  eq(chef.keys[0], chef.rowKey); eq(chef.keys[1], 'a:' + addr);
  // A domain-level name split also works after the domain itself is split.
  const s2 = new Set(['d:shop.com', 'a:news@shop.com']);
  eq(classify('news@shop.com', s2, 'Outlet').rowKey, 'n:news@shop.com|outlet');
  eq(classify('news@shop.com', new Set(['a:news@shop.com']), 'Outlet').rowKey, 'n:news@shop.com|outlet', 'name split pulls it out of the domain group');
  eq(classify('news@shop.com', new Set(['a:news@shop.com']), '').rowKey, 'd:shop.com', 'nameless mail stays in the group');
});
await test('Split by name: rules on a name beat the address; config keeps name keys', () => {
  const addr = 'digest@vesta.threadloom.news';
  let c = cfg.toggleSplit(cfg.emptyConfig(), 'a:' + addr, true);
  c = cfg.setRule(c, 'n:digest@vesta.threadloom.news|chef talk', 'block');
  c = cfg.sanitizeConfig(JSON.parse(JSON.stringify(c)));
  eq(Object.keys(c.rules), ['n:digest@vesta.threadloom.news|chef talk'], 'name key survives sanitize');
  eq(c.splits, ['a:' + addr], 'address split survives sanitize');
  eq(cfg.resolveAddress(c, addr, 'Chef Talk').action, 'block');
  eq(cfg.resolveAddress(c, addr, 'Overclock.net').action, null);
  c = cfg.setRule(c, 'a:' + addr, 'keep');
  eq(cfg.resolveAddress(c, addr, 'Chef Talk').action, 'block', 'name rule is more specific');
  eq(cfg.resolveAddress(c, addr, 'Overclock.net').action, 'keep');
  // Un-split: name rules stop matching (address rule applies again).
  c = cfg.toggleSplit(c, 'a:' + addr, false);
  eq(cfg.resolveAddress(c, addr, 'Chef Talk').action, 'keep');
});
await test('parseAuthor handles quoted names and bare addresses', () => {
  eq(parseAuthor('"Sur La Table" <Sur_La_Table@p.email-promo.surlatable.com>'), { name: 'Sur La Table', addr: 'sur_la_table@p.email-promo.surlatable.com' });
  eq(parseAuthor('bob@x.com'), { name: '', addr: 'bob@x.com' });
  eq(parseAuthor('NRA-ILA <NRA-ILA@ila.info.nra.org>').addr, 'nra-ila@ila.info.nra.org');
});

// ---------------------------------------------------------------- rules / categories
await test('R-BLK-1 most specific rule wins: address, then subdomain/org, then domain', () => {
  let c = cfg.emptyConfig();
  c = cfg.setRule(c, 'd:shop.com', 'block');
  eq(cfg.resolveAddress(c, 'deals@e.shop.com').action, 'block');
  c = cfg.setRule(c, 's:e.shop.com', 'keep');
  eq(cfg.resolveAddress(c, 'deals@e.shop.com').action, 'keep');
  eq(cfg.resolveAddress(c, 'other@shop.com').action, 'block');
  c = cfg.setRule(c, 'a:deals@e.shop.com', 'block');
  eq(cfg.resolveAddress(c, 'deals@e.shop.com'), { action: 'block', key: 'a:deals@e.shop.com', via: 'rule' });
  eq(cfg.resolveAddress(c, 'mom@gmail.com').action, null);
});
await test('R-CAT-1 categories label; Block/Keep categories yield to direct rules', () => {
  let c = cfg.addCategory(cfg.emptyConfig(), 'fashion');
  c = cfg.assignCategory(c, 'd:tommy.com', 'fashion');
  eq(cfg.resolveAddress(c, 'a@tommy.com').action, null, 'label only');
  c = cfg.setCategoryAction(c, 'fashion', 'block');
  eq(cfg.resolveAddress(c, 'a@tommy.com').action, 'block');
  eq(cfg.categoryOptionLabel('fashion', c.categories.fashion), 'fashion (Block: trashes mail)');
  c = cfg.setRule(c, 'a:a@tommy.com', 'keep');
  eq(cfg.resolveAddress(c, 'a@tommy.com').action, 'keep');
  c = cfg.renameCategory(c, 'fashion', 'clothes');
  eq(c.catOf['d:tommy.com'], 'clothes');
  c = cfg.deleteCategory(c, 'clothes');
  eq(c.catOf, {});
});
await test('R-EXP-1 merge keeps existing, imported wins; sanitize drops junk', () => {
  let a = cfg.setRule(cfg.emptyConfig(), 'd:a.com', 'block');
  a = cfg.setRule(a, 'd:b.com', 'block');
  const b = { rules: { 'd:b.com': { action: 'keep' }, 'bogus': { action: 'block' }, 'd:c.com': { action: 'delete' } }, splits: ['d:x.com', 'a:no'], settings: { blockNewMail: false } };
  const m = cfg.mergeConfig(a, b);
  eq(Object.keys(m.rules).sort(), ['d:a.com', 'd:b.com']);
  eq(m.rules['d:b.com'].action, 'keep');
  eq(m.splits, ['d:x.com']);
  eq(m.settings.blockNewMail, false);
});

await test('R-CAT-1 sender comments: cleaned, removable, merged, kept on category changes', () => {
  let c = cfg.setNote(cfg.emptyConfig(), 'd:a.com', '  Acme\n billing ');
  eq(c.notes, { 'd:a.com': 'Acme billing' });
  c = cfg.assignCategory(cfg.addCategory(c, 'x'), 'd:a.com', 'x');
  c = cfg.deleteCategory(c, 'x');
  eq(c.notes, { 'd:a.com': 'Acme billing' });
  eq(cfg.mergeConfig(c, { notes: { 'd:b.com': 'Bee', bogus: 'no', 'd:c.com': 5, 'd:d.com': 'x'.repeat(500) } }).notes,
    { 'd:a.com': 'Acme billing', 'd:b.com': 'Bee', 'd:d.com': 'x'.repeat(200) });
  eq(cfg.setNote(c, 'd:a.com', ' ').notes, {});
});

// ---------------------------------------------------------------- folders
await test('R-SCP-2 spam folders recognized by Junk flag or usual name', () => {
  const spam = flattenFolders({ id: 'x', folders: [['a', 'Anything', ['junk']], ['b', 'Spam', []], ['c', 'Junk E-mail', []], ['d', 'Spam receipts', []], ['e', 'Spam', ['trash']]]
    .map(([path, name, use]) => ({ path, name, specialUse: use })) }).filter(f => f.isSpam).map(f => f.id);
  eq(spam, ['x:/a', 'x:/b', 'x:/c']);
});
await test('R-SCP-2/3 Gmail virtual folders hidden; Sent/Trash/Junk not selected by default', async () => {
  const f = makeFake();
  const accs = await loadAccounts(f.api);
  const gm = accs.find(a => a.id === 'gm');
  const names = gm.folders.map(x => x.namePath);
  ok(!names.includes('[Gmail]/All Mail') && !names.includes('[Gmail]/Starred') && !names.includes('[Gmail]/Important'), names.join());
  eq(gm.folders.filter(x => !x.defaultOn).map(x => x.namePath), ['[Gmail]/Sent Mail', '[Gmail]/Trash']);
  void flattenFolders;
});
await test('R-REL-5 scanning pages through continueList and only reads', async () => {
  const f = makeFake({ pageSize: 30 });
  for (let i = 0; i < 95; i++) f.addMessage({ author: `Shop <s${i % 3}@e.shop.com>`, folderId: 'gm:/INBOX' });
  const r = await scanFolders(f.api, ['gm:/INBOX']);
  eq(r.messages.length, 95);
  eq(f.calls.filter(c => c.path === 'messages.continueList').length, 3);
  eq(f.mutations().length, 0);
});

// ---------------------------------------------------------------- batching (§11.4)
await test('R-REL-1..4 batches of 50; abort -> retry once -> one at a time; stale ids skipped', async () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));
  const stale = new Set([7, 77]);          // no longer exist (stale scan)
  const broken = new Set([60]);            // the server refuses this one every time
  const where = new Map();
  let abortedOnce = false;
  const calls = [];
  const moveFn = async ids => {
    calls.push(ids.length);
    for (const id of ids) if (stale.has(id)) throw new Error(`Message not found: ${id}.`);
    if (!abortedOnce && ids.includes(51)) { abortedOnce = true; throw new Error('Aborted with status: 2153054241'); }
    if (ids.length > 1 && ids.some(id => broken.has(id))) throw new Error('Aborted with status: 2153054241');
    if (ids.some(id => broken.has(id))) throw new Error('Server error');
    for (const id of ids) where.set(id, 'dest');
  };
  const locate = async ({ id }) => stale.has(id) ? 'gone' : where.get(id) === 'dest' ? 'moved' : 'present';
  const logged = [];
  const sleeps = [];
  const out = await runBatches(items, { moveFn, locate, onConfirmed: async l => logged.push(...l.map(i => i.id)), sleep: async ms => sleeps.push(ms) });
  eq(out.gone.map(i => i.id).sort((a, b) => a - b), [7, 77]);
  eq(out.failed.map(f => f.item.id), [60]);
  eq(out.moved.length, 117);
  eq(calls.slice(0, 1), [50], 'first batch is 50');
  ok(calls.every(n => n <= 50), 'no call above 50');
  eq(new Set(logged).size, 117, 'log holds exactly the moved messages');
  ok(!logged.includes(60) && !logged.includes(7) && !logged.includes(77), 'failed/gone never logged');
  ok(sleeps.length >= 1, 'pause before retry');
  eq(summarize(out), '117 moved, 2 already gone, 1 could not be moved; try again for the rest.');
});
await test('R-REL-2 partially moved batch is reconciled, not double-moved', async () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
  const where = new Map();
  let first = true;
  const moveFn = async ids => {
    if (first) { first = false; ids.slice(0, 4).forEach(id => where.set(id, 'dest')); throw new Error('Aborted'); }
    for (const id of ids) { if (where.get(id) === 'dest') throw new Error('double move'); where.set(id, 'dest'); }
  };
  const out = await runBatches(items, { moveFn, locate: async ({ id }) => where.get(id) === 'dest' ? 'moved' : 'present', sleep: async () => {} });
  eq(out.moved.length, 10); eq(out.failed.length, 0); eq(out.gone.length, 0);
});

await test('R-UND-2 a move Thunderbird reports as done but did not happen is not counted or logged', async () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const where = new Map();
  const moveFn = async ids => { for (const id of ids) if (id !== 2) where.set(id, 'dest'); }; // 2 silently stays
  const logged = [];
  const out = await runBatches(items, { moveFn, locate: async ({ id }) => where.get(id) === 'dest' ? 'moved' : 'present',
    onConfirmed: async l => logged.push(...l.map(i => i.id)), sleep: async () => {} });
  eq(out.moved.map(i => i.id).sort(), [1, 3]);
  eq(out.failed.map(f => f.item.id), [2]);
  ok(/still in its folder/.test(out.failed[0].error), out.failed[0].error);
  eq(logged.sort(), [1, 3]);
});

// ---------------------------------------------------------------- actions + log + restore (§11.5)
async function setup() {
  const f = makeFake();
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(f.addMessage({ author: `Shop <deals@e.shop.com>`, folderId: i < 3 ? 'gm:/INBOX' : 'gm:/Receipts', hid: `shop${i}@x` }));
  ids.push(f.addMessage({ author: 'Boss <boss@work.com>', folderId: 'ex:/Inbox', hid: 'boss@x' }));
  const index = indexAccounts(await loadAccounts(f.api));
  const scan = (await scanFolders(f.api, ['gm:/INBOX', 'gm:/Receipts', 'ex:/Inbox'])).messages;
  return { f, ids, index, scan };
}

await test('R-ACT-1 / R-GR-6 trash moves to each account\'s own Trash, never messages.delete; log after confirm', async () => {
  const { f, index, scan } = await setup();
  const r = await trashItems(f.api, f.api.storage.local, index, scan, { reason: 'test' });
  eq(r.moved.length, 6);
  ok(scan.every(m => f.folderOf(m.id) === (m.accountId === 'gm' ? 'gm:/[Gmail]/Trash' : 'ex:/Deleted Items')));
  eq(f.calls.filter(c => c.path === 'messages.delete').length, 0);
  const log = await loadLog(f.api.storage.local);
  eq(log.length, 1);
  eq(log[0].entries.length, 6);
  eq(log[0].entries.map(e => e.folderName).sort(), ['Inbox', 'Inbox', 'Inbox', 'Inbox', 'Receipts', 'Receipts']);
  ok(log[0].entries.every(e => e.hid && e.subject && e.from && e.accountId), 'R-UND-1 fields');
});

await test('R-UND-2 moved messages are logged even when the Trash has not synced yet', async () => {
  for (const abort of [false, true]) {
    const { f, index, scan } = await setup();
    const query = f.api.messages.query;
    f.api.messages.query = async () => ({ id: null, messages: [] });   // new copies not visible yet
    const move = f.api.messages.move;
    if (abort) f.api.messages.move = async (...a) => { await move(...a); throw new Error('Aborted'); };
    const r = await trashItems(f.api, f.api.storage.local, index, scan, { reason: 'test' });
    eq([r.moved.length, r.gone.length, r.failed.length], [6, 0, 0]);
    const log = await loadLog(f.api.storage.local);
    eq(log[0].entries.length, 6);
    f.api.messages.query = query; f.api.messages.move = move;          // synced: restorable
    const back = await restore(f.api, f.api.storage.local, index, log[0].entries.map((_, i) => ({ batch: log[0], index: i })));
    eq(back.restored, 6);
  }
});

await test('R-UND-2 messages that did not move are not logged', async () => {
  const { f, index, scan } = await setup();
  f.mail.delete(scan[0].id);                                   // stale
  f.hooks.beforeMove = async ids => { if (ids.length === 1 && ids[0] === scan[1].id) throw new Error('Server error'); if (ids.includes(scan[1].id)) throw new Error('Aborted'); };
  const r = await trashItems(f.api, f.api.storage.local, index, scan, { reason: 'test' });
  eq([r.moved.length, r.gone.length, r.failed.length], [4, 1, 1]);
  const log = await loadLog(f.api.storage.local);
  eq(log[0].entries.length, 4);
  ok(!log[0].entries.some(e => e.hid === scan[0].hid || e.hid === scan[1].hid));
  ok(/4 moved to Trash, 1 already gone, 1 could not be moved; try again for the rest\./.test(r.summary), r.summary);
});

await test('R-ACT-2 move creates nested folders per account', async () => {
  const { f, index, scan } = await setup();
  const r = await moveToFolder(f.api, f.api.storage.local, index, scan, 'Receipts/2026/Shop', { reason: 'file' });
  eq(r.moved.length, 6);
  const creates = f.calls.filter(c => c.path === 'folders.create').map(c => c.args);
  eq(creates, [['gm:/Receipts', '2026'], ['gm:/Receipts/2026', 'Shop'], ['ex:/', 'Receipts'], ['ex:/Receipts', '2026'], ['ex:/Receipts/2026', 'Shop']]);
  ok(scan.filter(m => m.accountId === 'gm').every(m => f.folderOf(m.id) === 'gm:/Receipts/2026/Shop'));
});

await test('R-UND-3/5 restore to original folder, duplicates once, missing reported, Inbox fallback', async () => {
  const { f, index, scan } = await setup();
  const store = f.api.storage.local;
  await trashItems(f.api, store, index, scan, { reason: 'test' });
  // A second log batch holding the same message again (duplicate).
  await trashItems(f.api, store, index, [{ ...scan[0], id: f.current(scan[0].id) }], { reason: 'dup' });
  // One message was emptied from Trash.
  f.mail.delete(f.current(scan[2].id));
  // One original folder no longer exists -> Inbox.
  index.folders.delete('gm:/Receipts');
  const log = await loadLog(store);
  const targets = log.flatMap(b => b.entries.map((e, index) => ({ batch: b, index })));
  const moveCallsBefore = f.calls.filter(c => c.path === 'messages.move').length;
  const cur0 = f.current(scan[0].id);
  eq(log.flatMap(b => b.entries).filter(e => e.hid === scan[0].hid).length, 2, 'duplicate logged twice');
  const r = await restore(f.api, store, index, targets);
  eq(f.folderOf(scan[0].id), 'gm:/INBOX');
  eq(f.folderOf(scan[1].id), 'gm:/INBOX');
  eq(f.folderOf(scan[3].id), 'gm:/INBOX', 'fallback to Inbox');
  eq(f.folderOf(scan[5].id), 'ex:/Inbox');
  eq(r.notThere, 1);
  const moved = f.calls.filter(c => c.path === 'messages.move').slice(moveCallsBefore).flatMap(c => c.args[0]);
  eq(moved.filter(id => id === cur0).length, 1, 'duplicate restored once');
  const after = await loadLog(store);
  ok(after.flatMap(b => b.entries).filter(e => e.hid === scan[0].hid).every(e => e.restored), 'both entries marked');
  ok(after.flatMap(b => b.entries).find(e => e.hid === scan[2].hid).restoreNote, 'missing one has a note');
});

// ---------------------------------------------------------------- background (§11.2)
const newMailMsgs = [
  { author: 'Shop <deals@e.shop.com>', folderId: 'gm:/INBOX' },
  { author: 'Mom <mom@gmail.com>', folderId: 'gm:/INBOX' },
  { author: 'Keep <vip@e.shop.com>', folderId: 'gm:/INBOX' },
  { author: 'Org <frank-steelcurtaincapital.com@shared1.ccsend.com>', folderId: 'ex:/Inbox' },
  { author: 'Fashion <hi@tommy.com>', folderId: 'ex:/Inbox' },
];
async function loadBackground(f) {
  globalThis.messenger = f.api;
  const mod = await import(`../src/background.js?v=${Math.random().toString(36).slice(2)}`);
  await new Promise(r => setTimeout(r, 10));
  return mod;
}
async function fireEverything(f) {
  await f.api.runtime.onInstalled.fire({ reason: 'install' });
  await f.api.runtime.onStartup.fire();
  await f.api.storage.onChanged.fire({ config: { newValue: f.store.config } }, 'local');
  await f.api.messages.onMoved.fire({ messages: [] }, { messages: [] });
  await f.api.messages.onDeleted.fire({ messages: [] });
}
function headerList(f, ids) {
  return { id: null, messages: ids.map(id => { const m = f.mail.get(id); return { id, author: m.author, subject: m.subject, headerMessageId: m.headerMessageId, date: m.date, read: false, size: 1, folder: { id: m.folderId, accountId: m.folderId.split(':/')[0], path: '' } }; }) };
}

await test('§11.2 background: no mail calls on install/startup/storage/moves; no onMoved, no alarms', async () => {
  const f = makeFake();
  f.store.config = cfg.setRule(cfg.emptyConfig(), 'd:shop.com', 'block');
  for (const m of newMailMsgs) f.addMessage(m);
  const mod = await loadBackground(f);
  await fireEverything(f);
  eq(f.mailCalls(), [], 'no mail calls');
  eq(f.listeners['messages.onMoved'], undefined, 'no onMoved listener');
  eq(f.listeners['messages.onDeleted'], undefined, 'no onDeleted listener');
  ok(!('alarms' in f.api), 'no alarms API used');
  ok(mod.handleNewMail, 'exports handler');
});

await test('§11.2 background: new mail with no rules -> no mail changes', async () => {
  const f = makeFake();
  const ids = newMailMsgs.map(m => f.addMessage(m));
  await loadBackground(f);
  await f.api.messages.onNewMailReceived.fire({ id: 'gm:/INBOX' }, headerList(f, ids));
  await new Promise(r => setTimeout(r, 20));
  eq(f.mutations(), []);
});

await test('R-BLK-2 new mail: only Block-rule senders are trashed (Keep and categories respected), and logged', async () => {
  const f = makeFake();
  let c = cfg.setRule(cfg.emptyConfig(), 'd:shop.com', 'block');
  c = cfg.setRule(c, 'a:vip@e.shop.com', 'keep');
  c = cfg.setRule(c, 'cc:steelcurtaincapital.com', 'block');
  c = cfg.addCategory(c, 'fashion');
  c = cfg.assignCategory(c, 'd:tommy.com', 'fashion');        // label only: must not trash
  f.store.config = c;
  const ids = newMailMsgs.map(m => f.addMessage(m));
  await loadBackground(f);
  await f.api.messages.onNewMailReceived.fire({ id: 'gm:/INBOX' }, headerList(f, ids));
  await new Promise(r => setTimeout(r, 20));
  const moved = f.mutations();
  ok(moved.every(m => m.path === 'messages.move'), 'only moves');
  eq(moved.flatMap(m => m.args[0]).sort(), [ids[0], ids[3]].sort());
  eq(f.folderOf(ids[0]), 'gm:/[Gmail]/Trash');
  eq(f.folderOf(ids[3]), 'ex:/Deleted Items');
  eq(f.folderOf(ids[1]), 'gm:/INBOX');
  eq(f.folderOf(ids[2]), 'gm:/INBOX');
  eq(f.folderOf(ids[4]), 'ex:/Inbox');
  const log = await loadLog(f.api.storage.local);
  eq(log.flatMap(b => b.entries).length, 2);
  ok(log.every(b => b.source === 'new-mail' && /^new mail: rule block/.test(b.reason)));
});

await test('R-BLK-2 new mail: a name-level Block trashes only that display name', async () => {
  const f = makeFake();
  let c = cfg.toggleSplit(cfg.emptyConfig(), 'a:digest@vesta.threadloom.news', true);
  c = cfg.setRule(c, 'n:digest@vesta.threadloom.news|chef talk', 'block');
  f.store.config = c;
  const ids = [f.addMessage({ author: 'Chef Talk <digest@vesta.threadloom.news>', folderId: 'gm:/INBOX' }),
    f.addMessage({ author: '"Overclock.net" <digest@vesta.threadloom.news>', folderId: 'gm:/INBOX' })];
  await loadBackground(f);
  await f.api.messages.onNewMailReceived.fire({ id: 'gm:/INBOX' }, headerList(f, ids));
  await new Promise(r => setTimeout(r, 20));
  eq(f.folderOf(ids[0]), 'gm:/[Gmail]/Trash');
  eq(f.folderOf(ids[1]), 'gm:/INBOX');
});
await test('R-BLK-2 switched off in Settings -> nothing moves', async () => {
  const f = makeFake();
  const c = cfg.setRule(cfg.emptyConfig(), 'd:shop.com', 'block');
  c.settings.blockNewMail = false;
  f.store.config = c;
  const ids = newMailMsgs.map(m => f.addMessage(m));
  await loadBackground(f);
  await f.api.messages.onNewMailReceived.fire({ id: 'gm:/INBOX' }, headerList(f, ids));
  await new Promise(r => setTimeout(r, 20));
  eq(f.mutations(), []);
});

await test('background menus/toolbar only open the dashboard', async () => {
  const f = makeFake();
  f.addMessage({ author: 'A <a@b.com>', folderId: 'gm:/INBOX' });
  await loadBackground(f);
  await f.api.action.onClicked.fire();
  await f.api.menus.onClicked.fire({ menuItemId: 'open-dashboard-tools' });
  await f.api.menus.onClicked.fire({ menuItemId: 'file-person', selectedMessages: { messages: [{ author: 'Jane <JANE@x.com>' }] } });
  await new Promise(r => setTimeout(r, 20));
  eq(f.mailCalls(), []);
  ok(f.calls.some(c => c.path === 'tabs.create'));
  ok(f.calls.some(c => c.path === 'runtime.sendMessage' && c.args[0].person === 'jane@x.com'));
});

// ---------------------------------------------------------------- sync body
await test('R-SYN-1 sync body round-trips the blob', () => {
  const blob = 'x'.repeat(300);
  eq(extractBlob(buildBody(blob, 'Linux', 0)), blob);
  eq(extractBlob('nothing here'), '');
});

print(results.join('\n'));
print(`\n${passed} passed, ${failed} failed`);
if (failed) imports.system.exit(1);
