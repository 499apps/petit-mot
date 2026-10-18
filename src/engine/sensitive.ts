/**
 * Pages where Petit Mot stays off: sign-in, payment, banking, email, documents and
 * pages that aren't in English. Kept conservative on purpose.
 */
const HOST_DENY = [
  /(^|\.)mail\.google\.com$/, /(^|\.)accounts\.google\.com$/, /(^|\.)docs\.google\.com$/, /(^|\.)drive\.google\.com$/,
  /(^|\.)outlook\.(live|office|office365)\.com$/, /(^|\.)mail\.yahoo\.com$/, /(^|\.)paypal\.com$/, /(^|\.)venmo\.com$/,
  /(^|\.)stripe\.com$/, /(^|\.)chase\.com$/, /(^|\.)wellsfargo\.com$/, /(^|\.)bankofamerica\.com$/, /(^|\.)capitalone\.com$/,
  /(^|\.)americanexpress\.com$/, /(^|\.)irs\.gov$/, /(^|\.)login\./, /(^|\.)signin\./, /(^|\.)auth\./, /(^|\.)sso\./,
  /bank/, /credit-?union/, /(^|\.)github\.dev$/, /(^|\.)vscode\.dev$/,
];
const PATH_DENY = /(^|[/._-])(log-?in|sign-?in|sign-?up|auth|oauth|sso|password|passwd|account|checkout|cart|basket|payment|pay|billing|wallet|bank|banking|invoice|tax|secure)([/._?-]|$)/i;

export interface Verdict { ok: boolean; reason?: 'unsupported' | 'sensitive' | 'language' }

export function checkUrl(url: string): Verdict {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, reason: 'unsupported' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'file:') return { ok: false, reason: 'unsupported' };
  if (/(^|\.)chromewebstore\.google\.com$|^chrome\.google\.com$/.test(u.hostname)) return { ok: false, reason: 'unsupported' };
  if (HOST_DENY.some((r) => r.test(u.hostname))) return { ok: false, reason: 'sensitive' };
  if (PATH_DENY.test(u.pathname)) return { ok: false, reason: 'sensitive' };
  return { ok: true };
}

export function checkDocument(doc: Document): Verdict {
  if (doc.querySelector('input[type="password"], input[autocomplete^="cc-"], input[autocomplete="one-time-code"], input[name*="card" i][name*="number" i]')) {
    return { ok: false, reason: 'sensitive' };
  }
  const lang = (doc.documentElement.getAttribute('lang') || '').trim().toLowerCase();
  if (lang && !lang.startsWith('en')) return { ok: false, reason: 'language' };
  return { ok: true };
}

export function checkPage(url: string, doc: Document): Verdict {
  const v = checkUrl(url);
  return v.ok ? checkDocument(doc) : v;
}

export const REASON_TEXT: Record<NonNullable<Verdict['reason']>, string> = {
  unsupported: "Petit Mot can't play on this kind of page. Try a news story, a blog or Wikipedia!",
  sensitive: 'Petit Mot takes a break here. It looks like a sign-in, payment or private page.',
  language: "This page isn't in English, so there are no English words to swap.",
};
