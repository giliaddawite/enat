import type { Email } from './email.js';
import type { EmailCategory } from './summary.js';

/**
 * Cheap, deterministic categorization from sender and labels alone (TICKET-104). This is
 * the fallback path: emails that overflow the digest's input-token cap, and every email
 * when the LLM call fails twice, get their category from here at zero API cost. It never
 * reads the body — by the time an email lands here, its body was deliberately not fetched.
 */

/** Gmail's own tab categorization, free with `format=metadata`. */
const PROMOTIONAL_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']);
const UPDATES_LABEL = 'CATEGORY_UPDATES';

/**
 * Senders whose mail is about money or accounts. Domain suffixes, matched against the
 * registered domain of the From address — subdomains (alerts.chase.com) match too. The
 * list skews to institutions an Ethiopian-American household actually banks and pays
 * bills with; it is a heuristic floor, not a taxonomy — the LLM path handles nuance.
 */
const BILLS_DOMAINS: readonly string[] = [
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  'citi.com',
  'capitalone.com',
  'usbank.com',
  'pnc.com',
  'discover.com',
  'americanexpress.com',
  'paypal.com',
  'venmo.com',
  'zellepay.com',
  'westernunion.com',
  'remitly.com',
  'xoom.com',
  'coned.com',
  'nationalgridus.com',
  'pge.com',
  'xfinity.com',
  'comcast.com',
  'spectrum.com',
  'verizon.com',
  'att.com',
  't-mobile.com',
  'geico.com',
  'statefarm.com',
  'progressive.com',
  'healthcare.gov',
  'ssa.gov',
  'irs.gov',
];

/** Localparts that mark billing machinery regardless of domain (billing@, invoice@ …). */
const BILLS_LOCALPART_KEYWORDS: readonly string[] = [
  'billing',
  'invoice',
  'statement',
  'payment',
  'payments',
];

/** Consumer mail providers: a person, not an organization, wrote this. */
const FREEMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
]);

/**
 * Extracts the address from an RFC 5322 From header ("Name <a@b.c>" or a bare address).
 * Empty string when there is no parseable address — the caller treats that as unknown.
 */
export function senderAddress(from: string): string {
  const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(from);
  if (angled?.[1] !== undefined) {
    return angled[1].toLowerCase();
  }
  const bare = /([^\s<>,"]+@[^\s<>,"]+)/.exec(from);
  return bare?.[1]?.toLowerCase() ?? '';
}

function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1);
}

function localpartOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(0, at);
}

function matchesDomain(domain: string, suffix: string): boolean {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

/**
 * Buckets an email by sender and labels alone. Precedence, most to least specific:
 * bills machinery, government senders, Gmail's promotional/social/updates tabs, personal
 * mail providers. Anything unrecognized defaults to `important` on purpose: for this
 * user, surfacing an unknown sender too prominently is a much cheaper mistake than
 * burying a real letter under Promotions.
 */
export function categorizeByHeuristics(email: Email): EmailCategory {
  const address = senderAddress(email.from);
  const domain = domainOf(address);
  const localpart = localpartOf(address);

  if (
    BILLS_DOMAINS.some((suffix) => matchesDomain(domain, suffix)) ||
    BILLS_LOCALPART_KEYWORDS.some((keyword) => localpart.includes(keyword))
  ) {
    return 'bills_accounts';
  }
  if (domain.endsWith('.gov')) {
    return 'important';
  }
  if (email.labels.some((label) => PROMOTIONAL_LABELS.has(label))) {
    return 'promotions_other';
  }
  // Updates checked after bills: a bank alert Gmail files under Updates is still a bill.
  if (email.labels.includes(UPDATES_LABEL)) {
    return 'promotions_other';
  }
  if (FREEMAIL_DOMAINS.has(domain)) {
    return 'family_personal';
  }
  return 'important';
}
