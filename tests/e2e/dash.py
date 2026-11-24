# Helpers: run JS against the dashboard document inside the test Thunderbird.
from marionette import Marionette
PRE = r'''
const win = Services.wm.getMostRecentWindow('mail:3pane');
const tabmail = win.document.getElementById('tabmail');
const tab = tabmail.tabInfo.find(t => t.browser && String(t.browser.currentURI.spec).includes('/dashboard/dashboard.html'));
const doc = tab.browser.contentDocument;
const sleep = ms => new Promise(r => win.setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(100); } return false; };
const $ = s => doc.querySelector(s), $$ = s => [...doc.querySelectorAll(s)];
const btn = (root, label) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === label);
const rows = () => $$('table.senders tbody tr.sender');
const rowText = () => rows().map(r => r.querySelector('td.who').textContent.replace(/\s+/g, ' ').trim() + ' | ' + [...r.querySelectorAll('td.actions button')].map(b => b.textContent).join(','));
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const lf = MailServices.accounts.localFoldersServer.rootFolder;
const count = name => lf.getChildNamed(name).getTotalMessages(false);
'''
def connect():
    m = Marionette(2829); m.send('WebDriver:NewSession', {}); m.chrome(); return m
def js(m, body):
    return m.run(PRE + body)
