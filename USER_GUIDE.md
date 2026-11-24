# Ed's Mail Helper: user guide

Review your mail **by sender**, then trash it, keep it, or file it into folders. The add-on acts on mail only when you click a button that says what it will do. The one exception is the optional *Block rules on new mail* setting described below.

## Install

1. Build the package: `./build.sh` → `dist/eds-mail-helper.xpi`
2. In Thunderbird: **Add-ons and Themes → gear icon → Install Add-on From File…** and pick the `.xpi`.

For development, use **Tools → Developer Tools → Debug Add-ons → Load Temporary Add-on…** and pick `dist/eds-mail-helper.xpi`. Every build overwrites this file in place, so **Reload** picks up new builds. With the snap version of Thunderbird, the file picker shares only the one file you pick. So don't pick `src/manifest.json` (its folder isn't shared). A temporary add-on is removed when Thunderbird restarts.

Requires Thunderbird 128 or newer. The add-on ID is `eds-mail-helper@local`. This is a new ID, so nothing from the old version carries over.

## Open the dashboard

* The **Ed's Mail Helper** toolbar button
* **Tools → Ed's Mail Helper Dashboard**
* Right-click in the message list → **Open dashboard**, or **File all mail with this person…**. Both only open the page.

## Senders tab

1. **Folders to scan**: tick accounts or individual folders. **Inboxes only**, **All folders** and **None** set the whole selection at once. **Inboxes only** also ticks each account's Spam/Junk folder. Sent, Trash, Junk and Drafts are not ticked by default. Gmail's *All Mail*, *Important* and *Starred* are hidden so nothing is counted twice. Your selection is remembered on this computer.
2. **Scan** reads the chosen folders. Scanning never changes mail.
3. Each row is one sender. Company mail is grouped by domain (`e.shop.com` counts as **shop.com**). Gmail, Outlook.com and other personal addresses are listed one by one, and so are shared mail services like Mailchimp and SendGrid. Constant Contact mail is grouped by the organization behind it.
   * **Group by category** adds a top layer: senders are listed under their category, with totals, and senders without one come last under *No category*. Click a category to collapse or open it; its checkbox ticks all its listed senders for the bulk bar. **Trash all** on a category trashes the scanned mail of every sender listed in it (not senders hidden by a filter), as one batch you can restore from Activity. *No category* has no such button. A sender is placed by the category in its own row; categories set on single addresses inside a domain don't move the domain. Off by default and remembered on this computer.
   * **From / To** limits the tab to messages dated in that range (both days included; either can be left empty). Counts, totals and expanded rows show only those messages, and **Trash all**, **Block**, **Trash** and **Move** act on them alone. A Block rule still covers all new mail from that sender. **Clear dates** removes the limit. It filters what was scanned, without rescanning, and is not remembered when the dashboard is closed.
4. **Click a row** to see its messages. **Click a subject** to open the message. If a domain has several addresses, each address is listed first with its own buttons.
5. Actions:
   * **Trash all**: moves every scanned message from that sender to Trash. This is a one-time action and creates no rule.
   * **Tick messages → Move to: [folder] → Move**: files the ticked messages. Type an existing folder or a new name such as `Receipts/2026`; missing folders are created. A bare path uses each message's own account. Start with an account name (`me@gmail.com/Receipts`) to pick one account.
   * **Tick messages → Trash**: moves just those to Trash.
   * **Block**: creates a Block rule (see Rules) *and* moves that sender's scanned messages to Trash right away. Undo it with **Restore all** in Activity. **Unblock** removes the rule only; mail it already trashed stays in Trash until you restore it.
   * **Keep**: creates a Keep rule. Block rules and Block categories never trash that sender's mail.
   * **Split**: for a domain that mixes unrelated senders, lists its addresses one by one from now on. Use **Un-split** on the Rules tab to undo it.
   * **Split by name**: for one address shared by unrelated senders, such as forum digests (`Chef Talk` and `Overclock.net` both sending from `digest@vesta.threadloom.news`). Each display name gets its own row, with its own Block/Keep and category. A rule on a name beats a rule on the address. **Un-split names** (or the Rules tab) undoes it. Display names are chosen by the sender, so a name rule matches that exact name (ignoring case and spacing) and nothing else.
   * **File…**: opens File by person for that address.
   * Tick several rows to use the bulk bar: **Trash all**, **Block**, **Keep**, **Set category…**
6. Actions run immediately, with no confirmation, and show progress. Every move is listed in **Activity** and can be undone there.

## File by person

Type an address and click **Find**. This lists every message from or to it, in all accounts including Sent. You can also include earlier messages of the same conversations; these are matched only by Message-ID, References and In-Reply-To headers. A suggested folder name is shown as plain text and is never applied for you. Pick a folder and click **Move**.

## Categories

Categories are your own labels for grouping and filtering senders, such as `kitchen` or `fashion`. They never move mail to folders. A category can be set to **Keep** or **Block: trashes mail**. A Block category is labeled that way wherever you can pick it. A rule set directly on a sender overrides its category.

Click a category's sender count to list its senders. **Move to…** puts a sender in another category, and **remove** leaves it without one. Neither touches existing mail. Clicking a sender highlights its row. **Comment** is for your own note about the sender, such as who uses the domain; it saves when you press Enter or leave the box, and stays with the sender if you move or remove it. The Senders tab shows it in parentheses after the sender.

## Rules

* Rules come from **Block** and **Keep** on the Senders tab. Every rule is listed with its scope written out (*this address only*, *sender's subdomain*, *sent via Constant Contact*, *whole domain*). You can change its action, change its scope, or remove it. The most specific rule wins: address, then organization or subdomain, then domain.
* **Apply my Block rules to scanned mail now** moves scanned messages from blocked senders to Trash. It runs only when you click it.
* **Block rules on new mail** (Settings, on by default): when new mail arrives in an inbox from a sender you blocked, it is moved to Trash. This only follows rules you created. Senders with a Keep rule are never affected. Every message moved this way appears in Activity with the reason *new mail: rule block: …* and can be restored. Untick the setting to stop it.

## Activity (undo)

Lists everything the add-on moved, with the time, the reason and the folder each message came from.

* **Restore** puts back one message. **Restore all N** puts back one action's batch. **Restore all shown** puts back everything in the current view.
* Messages go back to the folder they came from, or to the Inbox if that folder no longer exists.
* Restore works only while the message is still in Trash (or in the folder it was filed to). If Thunderbird has emptied the Trash, the entry says it can't be restored.
* **Clear log** asks for confirmation first.

## Settings

* **Sync between computers.** Pick a computer name, a passphrase (8 characters or more) and your own address. **Publish now** emails your rules, categories, sender comments and split groups to yourself, encrypted with the passphrase (AES-GCM, key from PBKDF2). **Load latest now** finds the newest sync email that decrypts with your passphrase and loads it; one click undoes the load. Nothing is sent or loaded automatically, and sync emails are never deleted or filed. The passphrase is stored only in this Thunderbird profile; keeping it safe is your responsibility.
* **Export / Import** saves the configuration to a JSON file and loads it back, either merged into the current one or replacing it. Folder selections, the passphrase and the activity log are not included. Keep exported files private.

## Privacy and permissions

No network requests and no telemetry. Everything stays in this Thunderbird profile, except the sync email you choose to send yourself.

Permissions: `accountsRead`, `accountsFolders` (to create folders for Move), `messagesRead`, `messagesMove`, `storage`, `menus`, and `compose` / `compose.send` (for **Publish now** only). The add-on does not request `messagesDelete` or `alarms`: "trash" is always a move to the account's Trash folder, never a permanent delete.

## For developers

* `./test.sh` runs every check in README §11:
  * `tests/static-check.py` lists each mail-changing call site and what triggers it (written to `CALL_SITES.md`), and fails on alarms, onMoved, network APIs, `messages.delete` or `innerHTML`.
  * `gjs -m tests/unit.test.js` covers grouping, rules, batching and retries, logging, restore, and the background script against a recording fake.
  * `tests/run-browser.sh` loads the real dashboard in headless Chrome against the fake. It checks for no mail calls on load (with URL parameters), and checks the click flows and the crypto round trip.
  * `tests/e2e/run.py` starts a **separate, headless Thunderbird** with a throwaway profile (`~/snap/thunderbird/common/eds-e2e-profile`) and a Local Folders mailbox of test messages. It loads `dist/eds-mail-helper.xpi` as a temporary add-on and drives the dashboard through scan, Split by name, Block, Restore all, Move to a new folder, and Trash all, checking the real folder contents after each step. Your own profile is never touched.
* `./build.sh` packages `src/` into `dist/eds-mail-helper.xpi`.
