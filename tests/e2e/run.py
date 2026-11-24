#!/usr/bin/env python3
"""End-to-end test in a REAL Thunderbird (README §11, run against the real app).

Starts a separate, headless Thunderbird with a throwaway profile under
~/snap/thunderbird/common/eds-e2e-profile (your own profile is never touched),
creates a Local Folders mailbox with test messages, loads dist/eds-mail-helper.xpi
as a temporary add-on (as Debug Add-ons does), and drives the dashboard.

Usage: python3 tests/e2e/run.py
"""
import os, shutil, subprocess, sys, time, email.utils
sys.path.insert(0, os.path.dirname(__file__))
from marionette import Marionette
from dash import PRE

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PROF = os.path.expanduser('~/snap/thunderbird/common/eds-e2e-profile')
XPI = os.path.join(ROOT, 'dist', 'eds-mail-helper.xpi')
PORT = 2829
LOG = os.path.join(PROF + '-log.txt')

USER_JS = f'''
user_pref("marionette.port", {PORT});
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.webextensions.remote", false);
user_pref("mail.provider.suppress_dialog_on_startup", true);
user_pref("mail.shell.checkDefaultClient", false);
user_pref("app.update.disabledForTesting", true);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("mailnews.start_page.enabled", false);
user_pref("mail.rights.version", 1);
'''

SENDERS = [
    ('Chef Talk <digest@vesta.threadloom.news>', 4, 'Chef thread'),
    ('"Overclock.net" <digest@vesta.threadloom.news>', 3, 'GPU thread'),
    ('Shop Deals <deals@e.shop.com>', 5, 'Big sale'),
    ('Mom <mom@gmail.com>', 1, 'Dinner Sunday'),
]
TOTAL = sum(c for _, c, _ in SENDERS)

results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name, detail))
    print(f"  {'ok  ' if cond else 'FAIL'} {name}" + ('' if cond else f'   -> {detail}'), flush=True)


def stop_test_instance():
    subprocess.run(['pkill', '-f', '--', f'--profile {PROF}'], check=False)
    for _ in range(40):
        if subprocess.run(['pgrep', '-f', '--', f'--profile {PROF}'], capture_output=True).returncode != 0:
            return
        time.sleep(0.25)


def start():
    env = dict(os.environ, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS='1')
    log = open(LOG, 'a')
    subprocess.Popen(['thunderbird', '--headless', '--marionette', '--no-remote', '--profile', PROF],
                     env=env, stdout=log, stderr=log, start_new_session=True)
    m = Marionette(PORT, timeout=90)
    m.send('WebDriver:NewSession', {})
    m.chrome()
    return m


def quit(m):
    try:
        m.send('Marionette:Quit', {'flags': ['eForceQuit']})
    except Exception:
        pass
    stop_test_instance()


def mbox():
    out, n = [], 0
    for frm, count, subj in SENDERS:
        for i in range(count):
            n += 1
            date = email.utils.formatdate(time.mktime((2026, 11, n, 12, 0, 0, 0, 0, 0)))
            out.append(f'From - Sun Nov {n:2d} 12:00:00 2026\nFrom: {frm}\nTo: me@example.com\nSubject: {subj} {i + 1}\n'
                       f'Date: {date}\nMessage-ID: <e2e-{n}@test.local>\nContent-Type: text/plain\n\nBody {n}\n\n')
    return ''.join(out)


def js(m, body, timeout_ms=180000):
    return m.run(PRE + body, timeout_ms=timeout_ms)


def main():
    if not os.path.exists(XPI):
        sys.exit('Build first: ./build.sh')
    stop_test_instance()
    shutil.rmtree(PROF, ignore_errors=True)
    os.makedirs(PROF)
    open(os.path.join(PROF, 'user.js'), 'w').write(USER_JS)
    open(LOG, 'w').close()

    print('Setting up a throwaway profile with a Local Folders account…', flush=True)
    m = start()
    local_dir = m.run('''
      const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
      let s; try { s = MailServices.accounts.localFoldersServer; } catch { s = null; }
      if (!s) { MailServices.accounts.createLocalMailAccount(); s = MailServices.accounts.localFoldersServer; }
      const root = s.rootFolder;
      if (!root.containsChildNamed('Inbox')) root.createSubfolder('Inbox', null);
      Services.prefs.savePrefFile(null);
      return root.filePath.path;
    ''')
    quit(m)

    with open(os.path.join(local_dir, 'Inbox'), 'w') as f:
        f.write(mbox())
    for name in ('Inbox.msf',):
        p = os.path.join(local_dir, name)
        if os.path.exists(p):
            os.remove(p)

    print('Starting Thunderbird with the test mailbox and loading the add-on…', flush=True)
    m = start()
    parsed = m.run(f'''
      const {{ MailServices }} = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
      const win = Services.wm.getMostRecentWindow('mail:3pane');
      const inbox = MailServices.accounts.localFoldersServer.rootFolder.getChildNamed('Inbox');
      inbox.setFlag(Ci.nsMsgFolderFlags.Inbox);
      for (let i = 0; i < 60 && inbox.getTotalMessages(false) < {TOTAL}; i++) {{
        try {{ inbox.updateFolder(null); }} catch {{}}
        await new Promise(r => win.setTimeout(r, 500));
      }}
      return inbox.getTotalMessages(false);
    ''')
    check(parsed == TOTAL, f'Thunderbird parsed the test Inbox ({TOTAL} messages)', parsed)

    info = m.run(f'''
      const {{ AddonManager }} = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const addon = await AddonManager.installTemporaryAddon(new FileUtils.File({XPI!r}));
      const url = WebExtensionPolicy.getByID(addon.id).getURL('dashboard/dashboard.html');
      const win = Services.wm.getMostRecentWindow('mail:3pane');
      const tab = win.document.getElementById('tabmail').openTab('contentTab', {{ url }});
      for (let i = 0; i < 40 && !(tab.browser.contentDocument && tab.browser.contentDocument.querySelector('#tab-senders .scope')); i++)
        await new Promise(r => win.setTimeout(r, 250));
      const doc = tab.browser.contentDocument;
      return {{ id: addon.id, version: addon.version, active: addon.isActive, header: doc.getElementById('version').textContent, status: doc.getElementById('status').textContent }};
    ''')
    check(info['active'] and info['header'] == 'v1.0.0' and not info['status'], 'add-on loads as a temporary add-on; dashboard starts without errors', info)

    r = js(m, r'''
      const scanBtn = $$('#tab-senders button').find(b => b.textContent.startsWith('Scan'));
      scanBtn.click();
      await until(() => rows().length > 0);
      await sleep(300);
      return { rows: rowText(), inbox: count('Inbox') };
    ''')
    check(len(r['rows']) == 3 and r['inbox'] == TOTAL, 'Scan lists 3 senders and changes nothing', r)
    digest = next((x for x in r['rows'] if 'digest@vesta' in x), '')
    check('Split by name' in digest, 'digest@vesta.threadloom.news row offers Split by name', digest)

    r = js(m, r'''
      rows().find(r => r.textContent.includes('digest@vesta')).querySelector('td.who').click();
      await sleep(300);
      const notice = $('.name-split');
      const text = notice ? notice.textContent : '';
      btn(notice, 'Split by name').click();
      await sleep(500);
      return { text, rows: rowText() };
    ''')
    check('Chef Talk (4)' in r['text'] and 'Overclock.net (3)' in r['text'], 'expanded row lists the display names with counts', r['text'])
    check(any(x.startswith('▸ Chef Talk <') for x in r['rows']) and any(x.startswith('▸ Overclock.net <') for x in r['rows']),
          'Split by name gives a row per display name', r['rows'])

    r = js(m, r'''
      btn(rows().find(r => r.textContent.includes('Chef Talk <')), 'Block').click();
      await until(() => !doc.body.classList.contains('busy') && /Blocked/.test($('#status').textContent), 60000);
      await sleep(1500);
      const trash = [...lf.getChildNamed('Trash').messages].map(h => h.author);
      return { status: $('#status').textContent, inbox: count('Inbox'), trash: count('Trash'), trashAuthors: trash, rows: rowText() };
    ''')
    check(r['inbox'] == TOTAL - 4 and r['trash'] == 4 and all('Chef Talk' in a for a in r['trashAuthors']),
          'Block on Chef Talk really moves its 4 messages to Trash (Overclock.net untouched)', r)
    check('4 moved to Trash' in r['status'], 'status reports 4 moved to Trash', r['status'])

    r = js(m, r'''
      btn($('#tabs'), 'Activity').click();
      await until(() => $$('table.activity tr.batch').length > 0);
      const ra = $$('table.activity button').find(b => /^Restore all/.test(b.textContent));
      const label = ra && ra.textContent;
      ra.click();
      await until(() => !doc.body.classList.contains('busy') && /restored/.test($('#status').textContent), 60000);
      await sleep(1500);
      return { label, status: $('#status').textContent, inbox: count('Inbox'), trash: count('Trash') };
    ''')
    check(r['label'] == 'Restore all 4', 'Activity lists the batch with Restore all 4', r)
    check(r['inbox'] == TOTAL and r['trash'] == 0, 'Restore all puts the 4 messages back in the Inbox', r)

    r = js(m, r'''
      btn($('#tabs'), 'Senders').click();
      $$('#tab-senders button').find(b => b.textContent.startsWith('Scan')).click();
      await until(() => rows().some(r => r.textContent.includes('mom@gmail.com')));
      await sleep(300);
      const mom = rows().find(r => r.textContent.includes('mom@gmail.com'));
      mom.querySelector('td.who').click();
      await sleep(300);
      $$('table.messages input[type=checkbox]')[0].click();
      $('.msg-tools .folder-input').value = 'Receipts/2026';
      btn($('.msg-tools'), 'Move').click();
      await until(() => !doc.body.classList.contains('busy') && /Move/.test($('#status').textContent), 60000);
      await sleep(1500);
      let inNew = -1;
      try { inNew = lf.getChildNamed('Receipts').getChildNamed('2026').getTotalMessages(false); } catch (e) { inNew = String(e); }
      return { status: $('#status').textContent, inNew, inbox: count('Inbox') };
    ''')
    check(r['inNew'] == 1 and r['inbox'] == TOTAL - 1, 'Move creates Receipts/2026 and files the message there', r)

    r = js(m, r'''
      const shop = rows().find(r => r.textContent.includes('shop.com'));
      btn(shop, 'Trash all').click();
      await until(() => !doc.body.classList.contains('busy') && /Trash/.test($('#status').textContent), 60000);
      await sleep(1500);
      return { status: $('#status').textContent, inbox: count('Inbox'), trash: count('Trash'), rows: rowText() };
    ''')
    check(r['trash'] == 5 and r['inbox'] == TOTAL - 1 - 5 and not any('shop.com' in x for x in r['rows']),
          'Trash all moves the 5 shop.com messages to Trash and drops the row', r)

    quit(m)
    failed = [x for x in results if not x[0]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed (real Thunderbird)")
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    try:
        main()
    finally:
        stop_test_instance()
