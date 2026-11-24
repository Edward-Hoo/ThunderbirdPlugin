// Sender grouping (README §4). Pure functions, no Thunderbird APIs.
//
// Every address maps to a set of "keys", most specific first:
//   a:<address>          one address
//   s:<host>             the sender's subdomain (or a Constant Contact organization subdomain)
//   cc:<domain>          an organization decoded from a Constant Contact pooled host
//   d:<domain>           the whole brand domain
//   n:<address>|<name>   one display name at one address, after the user clicked
//                        "Split by name" on that address (shared senders such as forum digests)
// The row an address is listed under (its "row key") is one of those keys.

// Multi-label public suffixes we care about. Not the full Public Suffix List, but it
// covers the common "co.uk"-style cases; for any other two-letter country code a
// generic second level (com, co, net, org, ...) is treated as part of the suffix.
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'ac.uk', 'gov.uk', 'net.uk', 'sch.uk', 'nhs.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'org.nz', 'net.nz', 'govt.nz', 'ac.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'com.cn', 'net.cn', 'org.cn', 'com.hk', 'com.tw', 'com.sg', 'com.my',
  'co.in', 'net.in', 'org.in', 'gov.in', 'co.za', 'org.za', 'co.il', 'org.il',
  'com.br', 'net.br', 'org.br', 'gov.br', 'com.mx', 'org.mx', 'gob.mx', 'com.ar', 'com.co',
  'com.tr', 'com.ua', 'com.pl', 'com.ph', 'com.vn', 'com.pe', 'com.ve', 'com.ec',
  'co.th', 'in.th', 'co.id', 'or.id', 'com.eg', 'com.sa', 'com.pk', 'com.ng', 'co.ke',
  'gc.ca', 'qc.ca', 'on.ca', 'bc.ca', 'ab.ca',
]);
const GENERIC_SECOND_LEVEL = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'mil']);

// R-GRP-2: personal mail providers. Matched on the registrable domain, plus brand
// names that exist under many country suffixes (yahoo.co.uk, hotmail.fr, gmx.de, ...).
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'passport.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com', 'aol.com', 'aim.com', 'verizon.net',
  'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
  'gmx.com', 'gmx.net', 'gmx.us', 'mail.com', 'email.com', 'comcast.net', 'xfinity.com',
  'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net', 'spectrum.net',
  'earthlink.net', 'optonline.net', 'frontier.com', 'frontiernet.net', 'windstream.net',
  'centurylink.net', 'q.com', 'juno.com', 'netzero.net', 'roadrunner.com', 'rr.com',
  'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru', 'fastmail.com', 'fastmail.fm',
  'tutanota.com', 'tuta.io', 'hey.com', 'web.de', 't-online.de', 'freenet.de', 'qq.com',
  '163.com', '126.com', 'mail.ru', 'inbox.ru', 'bk.ru', 'list.ru', 'rambler.ru',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr', 'libero.it', 'virgilio.it',
  'btinternet.com', 'sky.com', 'talktalk.net', 'virginmedia.com', 'ntlworld.com',
  'shaw.ca', 'rogers.com', 'sympatico.ca', 'videotron.ca', 'bigpond.com', 'optusnet.com.au',
  'mail.de', 'posteo.de', 'posteo.net', 'mailbox.org', 'hushmail.com', 'runbox.com',
]);
const PERSONAL_BRANDS = new Set(['yahoo', 'hotmail', 'live', 'outlook', 'gmx', 'yandex', 'aol', 'gmail']);

// R-GRP-3: bulk-mail services shared by unrelated senders.
const BULK_DOMAINS = new Set([
  'mcsv.net', 'list-manage.com', 'mailchimpapp.net', 'mailchimp.com', 'mcdlv.net', 'rsgsv.net',
  'mandrillapp.com', 'sendgrid.net', 'sendgrid.com', 'amazonses.com', 'mailgun.org', 'mailgun.net',
  'mailgun.info', 'hubspotemail.net', 'hubspot.com', 'hs-email.com', 'hubspotstarter.net',
  'klaviyomail.com', 'klaviyo.com', 'klaviyodelivery.com', 'createsend.com', 'createsend1.com',
  'substack.com', 'beehiiv.com', 'googlegroups.com', 'groups.io', 'sparkpostmail.com',
  'mailjet.com', 'sendinblue.com', 'brevo.com', 'convertkit.com', 'ck.page', 'mailerlite.com',
  'mlsend.com', 'aweber.com', 'getresponse.com', 'icontact.com', 'exacttarget.com',
  'activecampaign.com', 'acems1.com', 'emsend1.com', 'sailthru.com', 'postmarkapp.com',
  'mailerlite.email', 'moosend.com', 'flodesk.com', 'buttondown.email', 'ghost.io',
  'squarespace.info', 'wixemails.com', 'shopifyemail.com', 'campaign-archive.com', 'threadloom.news',
  'myemma.com', 'e2ma.net', 'benchmarkemail.com', 'verticalresponse.com', 'emailoctopus.com',
]);
const BULK_PATTERNS = [/^cmail\d*\.com$/, /^createsend\d*\.com$/, /^acems\d*\.com$/, /^emsend\d*\.com$/];

const CC_DOMAIN = 'ccsend.com';
const CC_POOLED_LABEL = /^(shared\d*|ccsend|mail\d*|em\d*|r\d+)$/;

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeAddress(addr) {
  return String(addr || '').trim().replace(/^mailto:/i, '').toLowerCase();
}

// "Name" <addr>  |  Name <addr>  |  addr
export function parseAuthor(author) {
  const s = String(author || '').trim();
  const m = s.match(/^(.*?)\s*<([^<>]+)>\s*$/);
  if (m) {
    let name = m[1].trim();
    if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
    name = name.replace(/\\"/g, '"').trim();
    const addr = normalizeAddress(m[2]);
    return { name: name && normalizeAddress(name) !== addr ? name : '', addr };
  }
  if (s.includes('@')) return { name: '', addr: normalizeAddress(s.replace(/^"|"$/g, '')) };
  return { name: s, addr: '' };
}

export function registrableDomain(host) {
  const labels = String(host || '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const last2 = labels.slice(-2).join('.');
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  if (MULTI_SUFFIXES.has(last2) || (tld.length === 2 && GENERIC_SECOND_LEVEL.has(sld))) {
    return labels.slice(-3).join('.');
  }
  return last2;
}

export function isPersonalDomain(domain) {
  const d = registrableDomain(domain);
  if (PERSONAL_DOMAINS.has(d)) return true;
  return PERSONAL_BRANDS.has(d.split('.')[0]);
}

export function isBulkDomain(domain) {
  const d = registrableDomain(domain);
  return BULK_DOMAINS.has(d) || BULK_PATTERNS.some(re => re.test(d));
}

// Constant Contact pooled hosts encode the sender as mailbox-domain or mailbox=domain.
// Returns the decoded domain (lowercase) or '' when it can't be decoded.
export function decodeConstantContactLocal(local) {
  const l = String(local || '').toLowerCase();
  const eq = l.indexOf('=');
  const idx = eq >= 0 ? eq : l.indexOf('-');
  if (idx <= 0) return '';
  const domain = l.slice(idx + 1);
  return DOMAIN_RE.test(domain) ? domain : '';
}

const SCOPE_TEXT = {
  n: 'this name at this address',
  a: 'this address only',
  s: "sender's subdomain",
  cc: 'sent via Constant Contact',
  d: 'whole domain',
};

export function keyKind(key) {
  return String(key).slice(0, String(key).indexOf(':'));
}
export function keyValue(key) {
  return String(key).slice(String(key).indexOf(':') + 1);
}
export function scopeText(key) {
  return SCOPE_TEXT[keyKind(key)] || '';
}
export function keyLabel(key) {
  const kind = keyKind(key);
  const v = keyValue(key);
  if (kind === 'n') { const i = v.indexOf('|'); return `“${v.slice(i + 1)}” <${v.slice(0, i)}>`; }
  return kind === 'cc' ? `${v} (via Constant Contact)` : v;
}

// Display names compared case- and spacing-insensitively.
export function normalizeName(name) {
  return String(name || '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
}
export function nameKey(address, name) {
  const n = normalizeName(name);
  return n ? `n:${normalizeAddress(address)}|${n}` : '';
}

// Classify one address.
//   splits: Set of row keys the user has split (R-GRP-7). An "a:" key in it means
//           that address is split by display name.
//   name:   the display name of this message's sender (only used for name splits)
// Returns { addr, host, keys: [most specific first], rowKey, kind, via }
//   kind: 'domain' | 'personal' | 'bulk' | 'cc-org' | 'cc-sub' | 'cc-undecoded' | 'invalid'
export function classify(address, splits = new Set(), name = '') {
  return withNameSplit(classifyAddress(address, splits), splits, name);
}

function classifyAddress(address, splits) {
  const addr = normalizeAddress(address);
  const at = addr.lastIndexOf('@');
  if (at <= 0 || at === addr.length - 1) {
    const key = 'a:' + addr;
    return { addr, host: '', keys: [key], rowKey: key, kind: 'invalid', via: '' };
  }
  const local = addr.slice(0, at);
  const host = addr.slice(at + 1);
  const domain = registrableDomain(host);
  const aKey = 'a:' + addr;
  const single = kind => ({ addr, host, keys: [aKey], rowKey: aKey, kind, via: '' });

  if (domain === CC_DOMAIN) {
    const sub = host === CC_DOMAIN ? '' : host.slice(0, -(CC_DOMAIN.length + 1)).split('.').pop();
    if (sub && !CC_POOLED_LABEL.test(sub)) {
      // R-GRP-4: the organization's own subdomain.
      const sKey = `s:${sub}.${CC_DOMAIN}`;
      return withSplit({ addr, host, keys: [aKey, sKey], rowKey: sKey, kind: 'cc-sub', via: 'Constant Contact' }, splits);
    }
    // R-GRP-5 / R-GRP-6: pooled host.
    const decoded = decodeConstantContactLocal(local);
    if (!decoded || isPersonalDomain(decoded) || registrableDomain(decoded) === CC_DOMAIN) return single('cc-undecoded');
    const ccKey = 'cc:' + registrableDomain(decoded);
    return withSplit({ addr, host, keys: [aKey, ccKey], rowKey: ccKey, kind: 'cc-org', via: 'Constant Contact' }, splits);
  }
  if (isPersonalDomain(domain)) return single('personal');
  if (isBulkDomain(domain)) return single('bulk');

  // R-GRP-1: company domain.
  const dKey = 'd:' + domain;
  const keys = host === domain ? [aKey, dKey] : [aKey, 's:' + host, dKey];
  return withSplit({ addr, host, keys, rowKey: dKey, kind: 'domain', via: '' }, splits);
}

function withNameSplit(info, splits, name) {
  const aKey = info.keys[0];
  if (!splits || !splits.has(aKey)) return info;
  const nKey = nameKey(info.addr, name);
  if (!nKey) return info;
  // The name gets its own row even when the address would otherwise sit inside a domain group.
  return { ...info, keys: [nKey, ...info.keys], rowKey: nKey, nameSplit: true };
}

function withSplit(info, splits) {
  if (splits && splits.has(info.rowKey)) {
    return { ...info, rowKey: info.keys[0], split: true };
  }
  return info;
}
