import { buildIndex, frenchForm, type Match } from '../words';
import type { Word } from '../types';
import { makeSkipper } from './skip';
import { contextOk } from './context';

export type Mode = 'swap' | 'hunt';

export interface Candidate {
  node: Text;
  start: number;
  end: number;
  match: Match;
  original: string;
  block: Element;
}

export interface PlanOptions {
  density: number;
  /** Higher = more wanted. Return -Infinity to never pick a word. */
  priority?: (w: Word) => number;
  exclude?: ReadonlySet<string>;
  index?: Map<string, Match>;
}

const BLOCK_SEL = 'p,li,h1,h2,h3,h4,h5,h6,td,th,dd,dt,blockquote,figcaption,article,section,div,body';
const TOKEN = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
const MIN_TEXT = 3;
let defaultIndex: Map<string, Match> | null = null;
const getIndex = () => (defaultIndex ??= buildIndex());

function prevWordIn(text: string): string | null {
  const m = /([A-Za-z]+(?:'[A-Za-z]+)?)[^A-Za-z.!?;:]*$/.exec(text);
  return m ? m[1] : null;
}

function isSentenceStart(before: string, node: Text, block: Element): boolean {
  const t = before.trimEnd();
  if (t === '') {
    const blockText = (block.textContent ?? '').trimStart();
    return blockText.startsWith((node.data ?? '').trimStart().slice(0, 40));
  }
  return /[.!?:"“(\u2014]$/.test(t);
}

/** Every swappable occurrence in document order. */
export function findCandidates(root: ParentNode, index: Map<string, Match> = getIndex()): Candidate[] {
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const start = (root as Document).body ?? (root as Element);
  if (!start) return [];
  const skip = makeSkipper();
  const out: Candidate[] = [];
  const walker = doc.createTreeWalker(start, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const t = n as Text;
      if (!t.data || t.data.trim().length < MIN_TEXT) return NodeFilter.FILTER_REJECT;
      return skip(t.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const text = n.data;
    const block = n.parentElement?.closest(BLOCK_SEL) ?? n.parentElement!;
    TOKEN.lastIndex = 0;
    for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
      let tok = m[0];
      const s = m.index;
      if (/'s$/i.test(tok)) tok = tok.slice(0, -2); // dog's -> dog
      const e = s + tok.length;
      const before = text[s - 1] ?? '';
      const after = text[e] ?? '';
      if (/[-\d_@/\\]/.test(before) || (after === '-' || /[\d_@]/.test(after))) continue; // dog-friendly, abc123
      const lower = tok.toLowerCase();
      const match = index.get(lower);
      if (!match) continue;
      if (tok.length > 1 && tok === tok.toUpperCase()) continue; // ACRONYMS / shouting
      const capital = tok[0] !== lower[0];
      const prefix = text.slice(0, s);
      if (capital && !isSentenceStart(prefix, n, block)) continue; // likely a name ("Apple", "Rose")
      if (frenchForm(match).toLowerCase() === lower) continue; // "table" = table: nothing to learn
      if (!contextOk(match.word, match.form, prevWordIn(prefix))) continue;
      out.push({ node: n, start: s, end: e, match, original: tok, block });
    }
  }
  return out;
}

/** Pick up to `density` distinct words, at most one per block, best priority first. */
export function choose(cands: Candidate[], opts: PlanOptions, alreadyIds: ReadonlySet<string> = new Set(), usedBlocks: Set<Element> = new Set()): Candidate[] {
  const prio = opts.priority ?? (() => 0);
  const firstByWord = new Map<string, Candidate[]>();
  for (const c of cands) {
    const id = c.match.word.id;
    if (alreadyIds.has(id) || opts.exclude?.has(id)) continue;
    let list = firstByWord.get(id);
    if (!list) firstByWord.set(id, (list = []));
    list.push(c);
  }
  const ranked = [...firstByWord.entries()]
    .map(([, list]) => ({ list, p: prio(list[0].match.word), rank: list[0].match.word.rank }))
    .filter((x) => x.p !== -Infinity)
    .sort((a, b) => b.p - a.p || a.rank - b.rank);
  const picked: Candidate[] = [];
  for (const { list } of ranked) {
    if (picked.length >= opts.density) break;
    const c = list.find((x) => !usedBlocks.has(x.block));
    if (!c) continue;
    usedBlocks.add(c.block);
    picked.push(c);
  }
  return picked;
}

function capitalize(fr: string, like: string): string {
  return like[0] !== like[0].toLowerCase() ? fr[0].toUpperCase() + fr.slice(1) : fr;
}

/** Replace the chosen occurrences with <span> elements. Safe for several hits in one text node. */
export function apply(chosen: Candidate[], mode: Mode, opts: { decoys?: ReadonlySet<string>; showEmoji?: boolean } = {}): HTMLElement[] {
  const byNode = new Map<Text, Candidate[]>();
  for (const c of chosen) {
    const l = byNode.get(c.node) ?? [];
    l.push(c);
    byNode.set(c.node, l);
  }
  const spans: HTMLElement[] = [];
  for (const [node, list] of byNode) {
    list.sort((a, b) => b.start - a.start);
    for (const c of list) {
      if (!node.parentNode) continue;
      const doc = node.ownerDocument;
      node.splitText(c.end);
      const mid = node.splitText(c.start);
      const span = doc.createElement('span');
      const w = c.match.word;
      const fr = capitalize(frenchForm(c.match), c.original);
      span.className = mode === 'hunt' ? 'pm-w pm-hunt' : 'pm-w';
      span.textContent = fr;
      span.lang = 'fr';
      span.dataset.pmId = w.id;
      span.dataset.pmOrig = c.original;
      span.dataset.pmMode = mode;
      if (opts.decoys?.has(w.id)) span.dataset.pmDecoy = '1';
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      if (mode === 'swap') {
        span.dataset.pmPeek = `${c.original}${opts.showEmoji !== false && w.emoji ? ' ' + w.emoji : ''}`;
        span.setAttribute('aria-label', `French word ${fr}, means ${c.original}. Press Enter to open the word card.`);
      } else {
        span.setAttribute('aria-label', `French word ${fr}. Is this one of your hunt words?`);
      }
      mid.replaceWith(span);
      spans.push(span);
    }
  }
  return spans.reverse();
}

export function existing(root: ParentNode, mode?: Mode): HTMLElement[] {
  const sel = mode ? `span.pm-w[data-pm-mode="${mode}"]` : 'span.pm-w[data-pm-id]';
  return [...root.querySelectorAll<HTMLElement>(sel)];
}

/**
 * Idempotent: tops the page up to `density` swaps of this mode; never swaps twice.
 * Returns the newly added spans.
 */
export function swapPage(root: ParentNode, mode: Mode, opts: PlanOptions & { decoys?: ReadonlySet<string>; showEmoji?: boolean }): HTMLElement[] {
  const have = existing(root, mode);
  const need = opts.density - have.length;
  if (need <= 0) return [];
  const ids = new Set(have.map((s) => s.dataset.pmId!));
  const blocks = new Set<Element>(have.map((s) => s.parentElement?.closest(BLOCK_SEL)).filter((b): b is Element => !!b));
  const picked = choose(findCandidates(root, opts.index), { ...opts, density: need }, ids, blocks);
  return apply(picked, mode, opts);
}

/** Put the original English back. Returns how many were reverted. */
export function revert(root: ParentNode, mode?: Mode): number {
  const spans = existing(root, mode);
  const parents = new Set<Node>();
  for (const s of spans) {
    const p = s.parentNode;
    if (!p) continue;
    s.replaceWith(s.ownerDocument.createTextNode(s.dataset.pmOrig ?? s.textContent ?? ''));
    parents.add(p);
  }
  parents.forEach((p) => p.normalize());
  return spans.length;
}
