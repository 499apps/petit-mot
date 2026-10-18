import { describe, it, expect, beforeEach } from 'vitest';
import { swapPage, revert, existing, findCandidates } from '@/src/engine/swap';
import { contextOk } from '@/src/engine/context';
import { BY_ID, buildIndex, englishPlural } from '@/src/words';

const page = (html: string) => { document.documentElement.setAttribute('lang', 'en'); document.body.innerHTML = html; return document; };
const swapped = () => existing(document, 'swap').map((s) => s.textContent);

describe('swap engine: what it changes', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('swaps a known noun after a determiner and keeps the original for revert', () => {
    page('<p>We saw the dog in the garden.</p>');
    swapPage(document, 'swap', { density: 1, priority: (w) => (w.id === 'chien.n' ? 10 : 0) });
    const s = existing(document, 'swap');
    expect(s).toHaveLength(1);
    expect(s[0].textContent).toBe('chien');
    expect(s[0].dataset.pmOrig).toBe('dog');
    expect(s[0].lang).toBe('fr');
    expect(s[0].getAttribute('role')).toBe('button');
  });

  it('uses the French plural for English plurals', () => {
    page('<p>Two dogs.</p><p>Three cats.</p>');
    swapPage(document, 'swap', { density: 2 });
    expect(swapped().sort()).toEqual(['chats', 'chiens']);
  });

  it('keeps sentence-start capitals but skips mid-sentence capitals (names, brands)', () => {
    page('<p>Dogs are great.</p><p>I met Rose and Apple people.</p>');
    swapPage(document, 'swap', { density: 5 });
    expect(swapped()).toContain('Chiens');
    expect(swapped()).not.toContain('Pomme');
  });

  it('respects density and puts at most one word per paragraph', () => {
    page('<p>the dog, the cat, the horse, the bird</p><p>a house</p><p>a car</p><p>the sun</p><p>the moon</p>');
    const added = swapPage(document, 'swap', { density: 3 });
    expect(added).toHaveLength(3);
    const blocks = new Set(added.map((s) => s.closest('p')));
    expect(blocks.size).toBe(3);
  });

  it('is idempotent: running again does not add or double-wrap', () => {
    page('<p>the dog</p><p>the cat</p><p>the horse</p><p>the bird</p>');
    swapPage(document, 'swap', { density: 3 });
    const html = document.body.innerHTML;
    expect(swapPage(document, 'swap', { density: 3 })).toHaveLength(0);
    expect(document.body.innerHTML).toBe(html);
    expect(document.querySelectorAll('span.pm-w span.pm-w')).toHaveLength(0);
  });

  it('tops up to the density when the page grows', () => {
    page('<p>the dog</p>');
    swapPage(document, 'swap', { density: 3 });
    expect(swapped()).toHaveLength(1);
    document.body.insertAdjacentHTML('beforeend', '<p>the cat</p><p>the horse</p><p>the bird</p>');
    swapPage(document, 'swap', { density: 3 });
    expect(swapped()).toHaveLength(3);
  });

  it('revert restores the exact original text', () => {
    page('<p>My dog and my cat like the garden.</p><p>The sun is hot.</p>');
    const before = document.body.textContent;
    swapPage(document, 'swap', { density: 5 });
    expect(document.body.textContent).not.toBe(before);
    revert(document, 'swap');
    expect(document.body.textContent).toBe(before);
    expect(document.querySelectorAll('.pm-w')).toHaveLength(0);
    expect(document.querySelector('p')!.childNodes).toHaveLength(1); // text nodes merged back
  });

  it('handles several swaps inside one text node', async () => {
    page('<div>the dog</div>');
    const { apply, findCandidates: fc } = await import('@/src/engine/swap');
    document.body.innerHTML = '<span>the dog and the cat</span>';
    const c = fc(document);
    apply(c, 'swap');
    expect(document.body.textContent).toBe('the chien and the chat');
  });

  it('hunt and swap modes are independent', () => {
    page('<p>the dog</p><p>the cat</p><p>the horse</p>');
    swapPage(document, 'swap', { density: 1 });
    swapPage(document, 'hunt', { density: 2 });
    expect(existing(document, 'swap')).toHaveLength(1);
    expect(existing(document, 'hunt')).toHaveLength(2);
    revert(document, 'hunt');
    expect(existing(document, 'swap')).toHaveLength(1);
  });
});

describe('swap engine: never touches', () => {
  const cases: [string, string][] = [
    ['inputs', '<input value="the dog">'],
    ['textareas', '<textarea>the dog</textarea>'],
    ['contenteditable', '<div contenteditable="true"><p>the dog</p></div>'],
    ['contenteditable=plaintext-only', '<div contenteditable="plaintext-only">the dog</div>'],
    ['role=textbox', '<div role="textbox">the dog</div>'],
    ['code and pre', '<pre>the dog</pre><code>the dog</code>'],
    ['links and buttons', '<a href="#">the dog</a><button>the dog</button>'],
    ['scripts and styles', '<script>var x="the dog"</script><style>.the-dog{}</style>'],
    ['nav and footer', '<nav>the dog</nav><footer>the dog</footer>'],
    ['hidden and aria-hidden', '<p hidden>the dog</p><p aria-hidden="true">the dog</p>'],
    ['translate=no / notranslate', '<p translate="no">the dog</p><p class="notranslate">the dog</p>'],
    ['forms', '<form><p>the dog</p></form>'],
    ['our own UI', '<div data-pm-ui><p>the dog</p></div>'],
  ];
  for (const [name, html] of cases) {
    it(name, () => {
      page(html);
      expect(findCandidates(document)).toHaveLength(0);
    });
  }

  it('skips hyphenated, numeric and ALL-CAPS tokens', () => {
    page('<p>a dog-friendly cafe, dog2 and the DOG.</p>');
    expect(findCandidates(document)).toHaveLength(0);
  });

  it('skips words that are spelled the same in French ("table", "animal")', () => {
    page('<p>the table</p><p>an animal</p>');
    expect(findCandidates(document)).toHaveLength(0);
  });

  it('swaps possessives without breaking them', () => {
    page("<p>the dog's ball</p>");
    swapPage(document, 'swap', { density: 1, priority: (w) => (w.id === 'chien.n' ? 9 : 0) });
    expect(document.body.textContent).toBe("the chien's ball");
  });
});

describe('context rules', () => {
  it('verbs need a lead-in ("to play", "I play")', () => {
    const jouer = BY_ID.get('jouer.v')!;
    expect(contextOk(jouer, 'base', 'to')).toBe(true);
    expect(contextOk(jouer, 'base', 'I')).toBe(true);
    expect(contextOk(jouer, 'base', 'the')).toBe(false);
    expect(contextOk(jouer, 'base', null)).toBe(false);
  });

  it('homograph nouns need a determiner ("the watch" but not "watch out")', () => {
    page('<p>Watch out.</p><p>I like the game.</p><p>We play games.</p>');
    const ids = findCandidates(document).map((c) => `${c.original}->${c.match.word.id}`);
    expect(ids).toContain('game->jeu.n');
    expect(ids.some((x) => x.startsWith('Watch'))).toBe(false);
  });

  it('a plain noun is fine anywhere', () => {
    expect(contextOk(BY_ID.get('chien.n')!, 'base', null)).toBe(true);
  });
});

describe('word index', () => {
  it('builds English plurals', () => {
    expect(englishPlural('dog')).toBe('dogs');
    expect(englishPlural('box')).toBe('boxes');
    expect(englishPlural('city')).toBe('cities');
    expect(englishPlural('child')).toBe('children');
    expect(englishPlural('day')).toBe('days');
  });
  it('maps every key and noun plural', () => {
    const idx = buildIndex();
    expect(idx.get('dog')?.word.id).toBe('chien.n');
    expect(idx.get('dogs')?.form).toBe('plural');
    expect(idx.get('home')?.word.id).toBe('maison.n');
  });
});
