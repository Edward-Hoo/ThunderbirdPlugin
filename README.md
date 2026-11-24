# Ed's Mail Helper: Requirements

A Thunderbird add-on for reviewing email **by sender** and cleaning it up quickly: see who fills the mailbox, look at a sender's messages, then trash them, keep them, or file the ones worth keeping into folders.

This document is the specification for a fresh implementation. The previous implementation was deleted because it acted on mail without the user's consent: it auto-blocked senders, and trashed legitimate mail with a keyword filter with disastrous effects.

Requirement levels:

- **MUST**: required.
- **SHOULD**: expected unless there is a good reason not to.
- **MAY**: optional, build only when asked.

Requirement IDs (e.g. `R-SND-3`) are for reference in reviews and tests.

---

## 1. Ground rules (non-negotiable)

| ID | Rule |
|---|---|
| R-GR-1 | The add-on **MUST NOT move, delete, copy, flag or send any email unless the user clicked a control whose label states that action**, at the moment of the click. |
| R-GR-2 | The add-on **MUST NOT make decisions of its own**. That rules out content classification, spam or political scoring, "learning", suggestions that act by themselves, and heuristics that pick messages to act on. |
| R-GR-3 | The add-on **MUST NOT create, change or delete rules, categories or settings by itself**. Only the user does, through visible controls. |
| R-GR-4 | No background behavior that touches mail: no timers or alarms, no startup or install jobs, no reactions to the user's own moves or deletions. |
| R-GR-5 | The only permitted exception is R-BLK-2 (applying the user's own rules to new mail). |
| R-GR-6 | Deleting means **moving to Trash**. Permanent deletion MUST NOT be implemented. |
| R-GR-7 | Every move and trash action MUST be recorded in an activity log and MUST be undoable (see §6). |
| R-GR-8 | No network requests. All data stays in Thunderbird's local storage on the computer, except the user-initiated sync email (§8), if built. |
| R-GR-9 | Each feature that moves mail MUST have an automated test proving it only does so from its click handler (see §11). |

---

## 2. Environment

- **Thunderbird 160** (snap) on Linux, and Thunderbird on Windows. Target **Manifest V3**, minimum Thunderbird 128.
- **Accounts:** Gmail (IMAP), and Microsoft 365 through Thunderbird's native Exchange/Graph support. Everything MUST work across all accounts in the profile.
- **Plain JavaScript (ES modules)**, no build step beyond zipping into an `.xpi`. Thunderbird doesn't require signing.
- Node is not installed. Tests may use `gjs -m` (pure modules) and headless Chrome (WebCrypto and DOM).

---

## 3. Dashboard (the core feature)

The dashboard is a page in its own Thunderbird tab. It is the user's main way of working and the part they actually used.

### 3.1 Opening it

| ID | Requirement |
|---|---|
| R-OPN-1 | MUST open from **Tools menu → Ed's Mail Helper Dashboard** and from a **toolbar button**. |
| R-OPN-2 | SHOULD also open from the message-list right-click menu (*Open dashboard*). That menu entry only opens the page; it never acts on mail. |

### 3.2 Choosing what to scan

| ID | Requirement |
|---|---|
| R-SCP-1 | A panel at the top lists **every account** with a checkbox. Each account expands (▸) to its **folder tree** with a checkbox per folder. |
| R-SCP-2 | Quick buttons: **Inboxes only** (each account's Inbox and Spam/Junk folder), **All folders**, **None**. Ticking an account selects its mail folders. Sent, Trash, Junk and Drafts are not selected by default, but can be ticked individually. |
| R-SCP-3 | Gmail's virtual folders (`[Gmail]/All Mail`, `Important`, `Starred`) are left out to avoid double counting. |
| R-SCP-4 | The selection is remembered between visits, on this computer only. |
| R-SCP-5 | Scanning happens only when the user clicks **Scan**, and shows progress. Scanning only reads; it never changes mail. |

### 3.3 Sender list

| ID | Requirement |
|---|---|
| R-SND-1 | One row per sender (see grouping, §4) showing: name or address, the most common display names, message count, unread count, newest date, oldest date, total size. |
| R-SND-2 | Sort by count, size, newest, oldest or name. Filter by text. |
| R-SND-3 | **Clicking a row expands it** to list that sender's messages (newest first): date, subject, exact address, folder, and unread in bold. **Clicking a subject opens the message** in Thunderbird. |
| R-SND-4 | When a grouped row (a domain or organization) contains several addresses, the expanded view first lists **each address** with its message count and display names, so the user can see whether a domain mixes unrelated senders. |
| R-SND-5 | The list updates immediately after any action and after configuration changes made elsewhere in the add-on, without rescanning. |
| R-SND-6 | **Group by category** (optional, off by default): senders are listed under collapsible category headers with totals; uncategorized senders come last. Grouping itself changes the display only. **Trash all** on a category header trashes the scanned mail of the senders listed under it, as one logged batch; *No category* has no such button. |
| R-SND-7 | **From / To date filter** (inclusive, local time, not remembered): rows, totals and all actions on the tab cover only messages in the range. |

### 3.4 Actions (all click-only, instant)

| ID | Requirement |
|---|---|
| R-ACT-1 | **Trash all** on a row: moves every scanned message of that sender to Trash. It is one-time and creates no rule. |
| R-ACT-2 | **Per-message actions:** in the expanded view, each message has a checkbox, plus *select all*, **Move to: [folder] → Move**, and **Trash**. The folder box suggests existing folders, accepts new and nested names (`Receipts/2026`), and creates missing folders. Example use: keep message #97 of 100 from a store by moving it, then trash the rest. |
| R-ACT-3 | The same actions for a single address inside a grouped row (R-SND-4). |
| R-ACT-4 | **Bulk bar:** tick several rows, then **Trash all** for all of them. |
| R-ACT-5 | **Actions run instantly, with no confirmation dialog.** The user explicitly prefers speed; safety comes from undo (§6). |
| R-ACT-6 | Long operations show progress, for example *"Moving shop.com to Trash: 100 of 215…"*. |
| R-ACT-7 | After an action, only messages that **actually moved** disappear from the list. Failed ones stay listed for retry (see §7). |

---

## 4. Sender grouping

| ID | Sender | Grouped as | Example |
|---|---|---|---|
| R-GRP-1 | Company domain | The brand domain, so subdomains count together (handle `co.uk`-style suffixes) | `deals@e.shop.com` → **shop.com** |
| R-GRP-2 | Personal mail providers (Gmail, Outlook.com, Hotmail, Yahoo, AOL, iCloud, Proton, GMX, Comcast, …) | The individual address | `mom@gmail.com` |
| R-GRP-3 | Bulk-mail services shared by unrelated senders (Mailchimp `mcsv.net`/`list-manage.com`, SendGrid, Amazon SES, Mailgun, HubSpot, Klaviyo, Campaign Monitor `cmail*.com`, Substack, beehiiv, Google Groups, …) | The individual address | `news@mcsv.net` |
| R-GRP-4 | Constant Contact, organization's own subdomain | That subdomain | `franklyspeakingnj@gopnewjersey.ccsend.com` → **gopnewjersey.ccsend.com** |
| R-GRP-5 | Constant Contact pooled hosts (`shared1.ccsend.com`, …) whose local part encodes the real sender as `mailbox-domain` or `mailbox=domain` | The decoded organization, labeled *via Constant Contact* | `frank-steelcurtaincapital.com@shared1.ccsend.com` → **steelcurtaincapital.com** |
| R-GRP-6 | Pooled host whose address can't be decoded, or decodes to a personal provider | The individual address | `info@shared1.ccsend.com`, `jane-gmail.com@shared1…` |
| R-GRP-7 | A domain the user marks as shared | Click **Split** on its row → its addresses are grouped individually from then on. Split domains are listed with **Un-split** buttons. | |

Known ambiguity: in R-GRP-5 a hyphen in the original mailbox name (`john-doe-example.com@…`) is split at the first `-`. That's acceptable as long as it never matches other senders.

---

## 5. Filing by person (SHOULD)

| ID | Requirement |
|---|---|
| R-PER-1 | Given an address, find every message **from or to** it (To/Cc), across accounts, including the user's own mail in Sent. |
| R-PER-2 | Option to include the rest of each conversation, matched only by `Message-ID`, `References` and `In-Reply-To` headers, never by subject alone. |
| R-PER-3 | Show the full list and where it currently lives. MAY show a suggested folder as plain text, never pre-applied. The user picks the folder and clicks **Move**. |
| R-PER-4 | Reachable from the sender row (*File…*) and from right-click *File all mail with this person…*, which only opens the dashboard prefilled. |

**Moving a whole conversation** MAY be offered only as an **explicit action** on a message ("Move conversation to…"). It MUST NOT be triggered by the user moving a single message (see R-GR-4).

---

## 6. Undo and activity log

| ID | Requirement |
|---|---|
| R-UND-1 | Each moved or trashed message is logged with time, action, reason, sender, subject, account, **original folder**, and `Message-ID`. |
| R-UND-2 | A message is logged **only after the server confirmed the move**, so the log never lists messages that didn't move. |
| R-UND-3 | Every action gets a batch id. **Restore** puts back one message and **Restore all N** puts back a whole batch, **to the folder each message came from** (falling back to the Inbox if that folder is gone). |
| R-UND-4 | Activity tab filters: everything, or trashed only. **Restore all shown** puts back everything in the current view. |
| R-UND-5 | Clearing the log asks for confirmation. Restore works only while a message is still in Trash; the UI MUST say so when it isn't. |

---

## 7. Reliability with Gmail and large mailboxes

Learned from the previous version:

| ID | Requirement |
|---|---|
| R-REL-1 | Move and delete in **batches of about 50**. One large IMAP move made Thunderbird appear frozen, then Gmail aborted it (`Aborted with status: 2153054241`). |
| R-REL-2 | If a batch fails: retry once after a short pause, then retry its messages **one at a time**. |
| R-REL-3 | Thunderbird rejects a whole batch if one message no longer exists (`Message not found: <id>`, usually because the scan is stale). Messages that are already gone MUST be skipped silently and dropped from the list, not reported as failures. |
| R-REL-4 | Report precisely: *"N moved, M already gone, K could not be moved; try again for the rest."* |
| R-REL-5 | Large scans page through `messages.list`/`continueList` and stay responsive. Keep only the data the actions need per message. |

---

## 8. Optional features (MAY, build only on request)

Each one must follow §1.

| ID | Feature | Constraints |
|---|---|---|
| R-BLK-1 | **Block / Keep rules** per address, organization or subdomain, or domain. Most specific wins: address, then organization/subdomain, then domain. | Rules are created only by the user's click. Listed on a **Rules** tab with remove and change controls, and the scope written out ("whole domain", "sender's subdomain", "sent via Constant Contact"). |
| R-BLK-2 | Apply Block rules to **new mail** (move it to Trash). | The single exception in R-GR-5. Logged and undoable like everything else. The user hasn't yet decided whether they want this. |
| R-BLK-3 | **Apply my Block rules to existing mail now** | Button only. |
| R-CAT-1 | **Categories:** labels for grouping and filtering senders inside the add-on (e.g. `family`, `big-box-retailer`, `fashion`). Rename, delete, list members, move a member to another category, comment on a member. | **Categories never move mail.** If a category can ever Block, it MUST be labeled "(Block: trashes mail)" wherever it can be picked. |
| R-EXP-1 | **Export / import** the configuration as JSON (merge or replace). | User-initiated only. Folder selections and the log stay per computer. |
| R-SYN-1 | **Sync between computers:** the user's idea, done by emailing the configuration to oneself. Encrypt with a user-chosen passphrase (AES-GCM, PBKDF2), not a secret hard-coded in the add-on (the code is readable). Ignore emails that don't decrypt. | **Publish now** and **Load latest now** buttons only. Never auto-publish, auto-load, auto-file or delete sync emails. |

---

## 9. Out of scope (explicitly rejected)

- **Any automated filtering or content classification.** It trashed legitimate mail.
- **Auto-learning or auto-blocking senders.**
- **Confirmation dialogs on Trash and Block** by default (the user found them slow).

---

## 10. Non-functional

| ID | Requirement |
|---|---|
| R-NF-1 | **Privacy:** no network calls, no telemetry. The configuration lives only in Thunderbird's storage. Exports and the sync passphrase are the user's responsibility; say so in the UI. |
| R-NF-2 | **Permissions:** request only what's used: `accountsRead`, `accountsFolders` (folder creation for Move), `messagesRead`, `messagesMove`, `messagesDelete`, `storage`, `menus`. Add `compose` and `compose.send` only if R-SYN-1 is built. No `alarms`. |
| R-NF-3 | **Add-on ID:** keep `sender-sorter@local` if data from the old version should carry over; a new ID starts clean. Decide before the first install. |
| R-NF-4 | **Light and dark theme**, readable tables, sticky headers. |
| R-NF-5 | **README** for end users (installation, features) once there is something to install. Install via *Add-ons and Themes → gear → Install Add-on From File…*; for development, *Debug Add-ons → Load Temporary Add-on* (a temporary add-on disappears on restart). |

---

## 11. Acceptance checks

1. **Static check (R-GR-1/9):** every call to `messages.move`, `messages.delete`, `messages.copy`, `messages.update`, `folders.create` and `compose.sendMessage` is reachable only from a click handler, or from R-BLK-2 if built. List the call sites and their triggers in the pull request.
2. **Background test:** load the background script with a fake `messenger` that records every call. Fire install, startup, storage changes, alarms (there should be none), `onMoved` (there should be no listener) and new mail from various senders. **No mail calls** are allowed, except Block-rule trashes if R-BLK-2 is built.
3. **Dashboard load test:** open the dashboard page, including with any URL parameters it accepts, against the recording fake. **No mail calls** until a button is clicked.
4. **Batching test:** a simulated server that aborts one batch and has stale IDs gives exactly the outcome in R-REL-2 to R-REL-4, and the log matches only what moved.
5. **Restore test:** messages come back to their original folder, duplicates are restored once, and messages no longer in Trash are reported.
6. **Grouping tests** for every row in §4.

---

## 12. Open questions for the user

1. Should Block rules apply to **new** mail (R-BLK-2), or only clean up existing mail when clicked (R-BLK-3)?
2. Keep the old add-on ID (carry over storage) or start clean (R-NF-3)?
3. Which optional features (§8) should come in the first version, if any?
4. Is per-account scoping of actions or rules needed (e.g. block a sender on Gmail only)?

---

## History

The local folders and git repository of the previous implementation (versions 0.1–0.2.6)  has been explicitly deleted by the user to limit compromised code from affecting the new implemenation.
