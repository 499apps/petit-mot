import { describe, it, expect } from 'vitest';
import { checkUrl, checkDocument, checkPage } from '@/src/engine/sensitive';

describe('sensitive pages', () => {
  it.each([
    'https://mail.google.com/mail/u/0/', 'https://accounts.google.com/signin', 'https://www.paypal.com/myaccount',
    'https://secure.chase.com/', 'https://shop.example.com/checkout', 'https://example.com/cart', 'https://example.com/login',
    'https://example.com/account/settings', 'https://mybank.example.com/', 'https://docs.google.com/document/d/1',
    'https://example.com/sign-in?next=/', 'https://example.com/billing',
  ])('stays off %s', (url) => expect(checkUrl(url).ok).toBe(false));

  it.each(['chrome://extensions', 'about:blank', 'https://chromewebstore.google.com/detail/x', 'not a url'])('cannot run on %s', (url) => {
    expect(checkUrl(url)).toEqual({ ok: false, reason: 'unsupported' });
  });

  it.each(['https://en.wikipedia.org/wiki/Dog', 'https://www.bbc.co.uk/news', 'https://kids.nationalgeographic.com/animals'])('runs on %s', (url) => {
    expect(checkUrl(url).ok).toBe(true);
  });

  it('stays off pages with a password or card field', () => {
    document.body.innerHTML = '<form><input type="password"></form>';
    expect(checkDocument(document)).toEqual({ ok: false, reason: 'sensitive' });
    document.body.innerHTML = '<input autocomplete="cc-number">';
    expect(checkDocument(document).ok).toBe(false);
  });

  it('only runs on English pages (or pages without a lang)', () => {
    document.body.innerHTML = '<p>hello</p>';
    document.documentElement.setAttribute('lang', 'fr');
    expect(checkDocument(document)).toEqual({ ok: false, reason: 'language' });
    document.documentElement.setAttribute('lang', 'en-GB');
    expect(checkPage('https://example.com/', document).ok).toBe(true);
    document.documentElement.removeAttribute('lang');
    expect(checkDocument(document).ok).toBe(true);
  });
});
