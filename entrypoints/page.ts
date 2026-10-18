import { swapPage, revert, existing, findCandidates, choose, apply } from '@/src/engine/swap';
import { checkPage, REASON_TEXT } from '@/src/engine/sensitive';
import { BY_ID, withArticle } from '@/src/words';
import { priorityFor } from '@/src/srs';
import { getDeck, getProfiles, getSettings, rate, addXp, addHunt } from '@/src/store';
import { createHunt, current, endTurn, find, hint, nextPlayer, results, startTurn, timeLeft, winner, type Hunt, type HuntPlayer } from '@/src/hunt';
import { XP } from '@/src/family';
import { speakWith, webEngine, friendlyError, type SpeakResult } from '@/src/speech';
import { PAGE_CSS } from '@/src/ui/page-style';
import { OVERLAY_CSS } from '@/src/ui/overlay-style';
import { h } from '@/src/ui/dom';
import type { Profile } from '@/src/types';

/**
 * Runs in a web page only after you click Petit Mot (activeTab), or on sites you opted in to.
 * It changes a handful of English words into French, and hosts the Word Hunt game.
 * It reads nothing else and sends nothing anywhere.
 */
export type PageMsg =
  | { type: 'pm:swap' }
  | { type: 'pm:revert' }
  | { type: 'pm:status' }
  | { type: 'pm:hunt'; players: string[] };
export interface PageStatus { ok: boolean; reason?: string; swaps: number; hunting: boolean; added?: number }

const G = globalThis as unknown as { __petitMot?: boolean };

export default defineUnlistedScript(() => {
  if (G.__petitMot) return;
  G.__petitMot = true;
  init();
});

let hunt: Hunt | null = null;
let hudHost: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let tick: number | undefined;
let observer: MutationObserver | null = null;

function init() {
  ensureStyle();
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  browser.runtime.onMessage.addListener((msg: PageMsg, _sender, send) => {
    handle(msg).then(send, (e) => send({ ok: false, reason: String(e), swaps: 0, hunting: false }));
    return true;
  });
  void autoStart();
}

function ensureStyle() {
  if (document.getElementById('petit-mot-style')) return;
  const s = document.createElement('style');
  s.id = 'petit-mot-style';
  s.textContent = PAGE_CSS;
  (document.head ?? document.documentElement).append(s);
}

function status(extra: Partial<PageStatus> = {}): PageStatus {
  return { ok: true, swaps: existing(document, 'swap').length, hunting: !!hunt && hunt.phase !== 'done', ...extra };
}

async function handle(msg: PageMsg): Promise<PageStatus> {
  const verdict = checkPage(location.href, document);
  if (msg.type === 'pm:status') return status(verdict.ok ? {} : { ok: false, reason: REASON_TEXT[verdict.reason!] });
  if (msg.type === 'pm:revert') { revert(document, 'swap'); observer?.disconnect(); return status(); }
  if (!verdict.ok) return status({ ok: false, reason: REASON_TEXT[verdict.reason!] });
  if (msg.type === 'pm:swap') return status({ added: await sprinkle() });
  if (msg.type === 'pm:hunt') { await startHunt(msg.players); return status(); }
  return status();
}

async function sprinkle(): Promise<number> {
  const [{ active }, settings] = await Promise.all([getProfiles(), getSettings()]);
  const deck = active ? await getDeck(active.id) : {};
  const added = swapPage(document, 'swap', { density: settings.density, priority: priorityFor(deck, active?.level ?? 1, new Date()), showEmoji: settings.showEmoji });
  return added.length;
}

async function autoStart() {
  const settings = await getSettings();
  if (!settings.autoSites.includes(location.origin)) return;
  if (!checkPage(location.href, document).ok) return;
  await sprinkle();
  // Pages that load content later (infinite scroll, single-page apps): top up gently.
  let timer: number | undefined;
  let topUps = 0;
  observer = new MutationObserver(() => {
    if (timer || topUps > 20) return;
    timer = window.setTimeout(async () => {
      timer = undefined;
      topUps++;
      if (existing(document, 'swap').length < settings.density) await sprinkle();
    }, 1500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ---------- clicks on our words ----------
function ourSpan(t: EventTarget | null): HTMLElement | null {
  const el = t instanceof Element ? t.closest<HTMLElement>('span.pm-w[data-pm-id]') : null;
  return el;
}
function onClick(e: MouseEvent) {
  const span = ourSpan(e.target);
  if (!span) return;
  e.preventDefault();
  e.stopPropagation();
  activate(span);
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const span = ourSpan(e.target);
  if (!span) return;
  e.preventDefault();
  activate(span);
}
function activate(span: HTMLElement) {
  if (span.dataset.pmMode === 'hunt') return onHuntClick(span);
  const id = span.dataset.pmId!;
  browser.runtime.sendMessage({ type: 'pm:open-word', id, orig: span.dataset.pmOrig }).then(
    (r: { opened?: boolean } | undefined) => { if (!r?.opened) void fallbackCard(span, id); },
    () => void fallbackCard(span, id),
  );
}

// ---------- shadow-DOM overlay (HUD + fallback card) ----------
function overlay(): ShadowRoot {
  if (shadow && hudHost?.isConnected) return shadow;
  hudHost = document.createElement('petit-mot-overlay');
  hudHost.setAttribute('data-pm-ui', '');
  shadow = hudHost.attachShadow({ mode: 'open' });
  const st = document.createElement('style');
  st.textContent = OVERLAY_CSS;
  shadow.append(st);
  document.documentElement.append(hudHost);
  return shadow;
}
function clearOverlay(sel: string) { shadow?.querySelectorAll(sel).forEach((n) => n.remove()); }

/** Speak via the background (chrome.tts, works with every Chrome voice); fall back to the page's Web Speech. */
async function say(text: string, saved: string | null): Promise<SpeakResult> {
  const bg = (await browser.runtime.sendMessage({ type: 'pm:speak', text }).catch(() => null)) as SpeakResult | null;
  if (bg?.ok) return bg;
  const web = webEngine();
  const local = web ? await speakWith([web], text, saved) : null;
  if (local?.ok) return local;
  const none = (!bg || bg.reason === 'no-french-voice') && (!local || local.reason === 'no-french-voice');
  return { ok: false, reason: none ? 'no-french-voice' : 'failed', tried: [...(bg?.tried ?? []), ...(local?.tried ?? [])] };
}

async function fallbackCard(span: HTMLElement, id: string) {
  const w = BY_ID.get(id);
  if (!w) return;
  const root = overlay();
  clearOverlay('.card');
  const r = span.getBoundingClientRect();
  const top = Math.min(window.innerHeight - 220, r.bottom + 8);
  const left = Math.min(window.innerWidth - 296, Math.max(8, r.left - 20));
  const { active } = await getProfiles();
  const settings = await getSettings();
  const msg = h('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });
  const answer = async (a: 'good' | 'again') => {
    if (!active) { msg.textContent = 'Add a learner in the Petit Mot panel to save progress.'; return; }
    const xp = await rate(active.id, id, a);
    msg.className = 'msg ok';
    msg.textContent = a === 'good' ? `Super ! +${xp} XP` : `No problem, we'll see it again soon. +${xp} XP`;
    setTimeout(() => clearOverlay('.card'), 1400);
  };
  const g = w.g === 'f' ? 'g-f' : w.g === 'm' ? 'g-m' : '';
  const card = h('div', { class: 'pm card pop', role: 'dialog', 'aria-label': `Word card: ${w.fr}`, style: `top:${top}px;left:${left}px` },
    h('div', { class: 'top' },
      h('div', { class: 'word' }, w.emoji ? h('span', { 'aria-hidden': 'true', text: w.emoji }) : null,
        w.art ? h('span', { class: 'art', text: w.art === "l'" ? "l'" : w.art }) : null, h('span', { class: g, lang: 'fr', text: w.fr })),
      h('button', { class: 'x', 'aria-label': 'Close', onclick: () => clearOverlay('.card'), text: '×' })),
    h('div', { class: 'mean', text: `means “${span.dataset.pmOrig ?? w.en}”` }),
    h('div', { class: 'row' },
      h('button', { class: 'speak', 'aria-label': `Say ${w.fr}`, title: 'Listen', onclick: async () => {
        const r = await say(withArticle(w), settings.voiceURI);
        if (!r.ok) { msg.className = 'msg oops'; msg.textContent = friendlyError(r, true); }
      }, text: '🔊' }),
      h('button', { class: 'b again', onclick: () => void answer('again'), text: 'Again' }),
      h('button', { class: 'b good', onclick: () => void answer('good'), text: 'Got it!' })),
    msg);
  root.append(card);
  (card.querySelector('button.good') as HTMLElement).focus();
}

// ---------- Word Hunt ----------
async function startHunt(playerIds: string[]) {
  const [{ profiles }, settings] = await Promise.all([getProfiles(), getSettings()]);
  const pick = playerIds.map((id) => profiles.find((p) => p.id === id)).filter((p): p is Profile => !!p);
  const players: HuntPlayer[] = pick.length ? pick.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })) : [{ id: 'guest', name: 'You', avatar: '🙂' }];
  revert(document, 'hunt');
  hunt = createHunt(players, settings.huntTimer);
  renderPass(true);
}

function usedInHunt(): Set<string> {
  return new Set(hunt?.turns.flatMap((t) => [...t.targets, ...t.decoys]) ?? []);
}

async function beginTurn() {
  if (!hunt) return;
  const player = nextPlayer(hunt)!;
  const settings = await getSettings();
  const { profiles } = await getProfiles();
  const prof = profiles.find((p) => p.id === player.id);
  const deck = prof ? await getDeck(prof.id) : {};
  revert(document, 'hunt');
  const cands = findCandidates(document);
  const prio = priorityFor(deck, prof?.level ?? 1, new Date());
  const already = new Set(existing(document, 'swap').map((s) => s.dataset.pmId!));
  let picked = choose(cands, { density: settings.huntWords + 2, priority: prio, exclude: usedInHunt() }, already);
  if (picked.length < 4) picked = choose(cands, { density: settings.huntWords + 2, priority: prio }, already);
  if (picked.length < 3) return renderError();
  const nTargets = Math.max(2, Math.min(settings.huntWords, picked.length - 1));
  // Targets are the most useful words; the rest become friendly decoys.
  const targets = picked.slice(0, nTargets).map((c) => c.match.word.id);
  const decoys = picked.slice(nTargets).map((c) => c.match.word.id);
  apply(picked, 'hunt', { decoys: new Set(decoys) });
  startTurn(hunt, targets, decoys, Date.now());
  renderPlaying();
  window.clearInterval(tick);
  if (hunt.timer) tick = window.setInterval(onTick, 500);
}

function onTick() {
  if (!hunt) return;
  const left = timeLeft(hunt, Date.now());
  const el = shadow?.querySelector('.timer');
  if (el && left !== null) { el.textContent = `⏱ ${left}s`; el.classList.toggle('low', left <= 10); }
  if (left === 0) { window.clearInterval(tick); finishTurn(); }
}

function onHuntClick(span: HTMLElement) {
  if (!hunt) return;
  const id = span.dataset.pmId!;
  const r = find(hunt, id, Date.now());
  const msg = shadow?.querySelector('.msg');
  const w = BY_ID.get(id)!;
  if (r.kind === 'found') {
    span.dataset.pmFound = '1';
    span.setAttribute('aria-label', `Found: ${w.fr} means ${w.en}`);
    if (msg) { msg.className = 'msg ok'; msg.textContent = `Bravo ! ${w.fr} = ${w.en}  +${r.points}`; }
    void getSettings().then((st) => say(w.fr, st.voiceURI));
    if (r.done) finishTurn(); else renderPlaying(msg?.textContent ?? '', 'ok');
  } else if (r.kind === 'decoy') {
    span.classList.remove('pm-shake'); void span.offsetWidth; span.classList.add('pm-shake');
    renderPlaying(`Presque ! That one is ${w.fr} = ${w.en}. Keep looking!`, 'oops');
  } else if (r.kind === 'over') finishTurn();
}

function finishTurn() {
  if (!hunt) return;
  window.clearInterval(tick);
  endTurn(hunt, Date.now());
  const t = current(hunt)!;
  for (const s of existing(document, 'hunt')) {
    if (t.targets.includes(s.dataset.pmId!) && !s.dataset.pmFound) s.dataset.pmReveal = '1';
  }
  if (hunt.phase === 'pass') renderPass(false);
  else void renderDone();
}

function frame(...children: (Node | null)[]) {
  const root = overlay();
  clearOverlay('.hud');
  const hud = h('section', { class: 'pm hud pop', role: 'dialog', 'aria-label': 'Word Hunt' },
    h('div', { class: 'top' }, h('div', { class: 'title', text: '🔎 Word Hunt' }),
      h('button', { class: 'x', 'aria-label': 'Close Word Hunt', onclick: closeHunt, text: '×' })),
    ...children);
  root.append(hud);
  return hud;
}

function renderError() {
  frame(h('div', { class: 'big', text: '🍃' }),
    h('p', { class: 'center', text: "Not enough words to hunt on this page. Try a longer story, a Wikipedia page or a news article!" }),
    h('div', { class: 'row' }, h('button', { class: 'b pri', onclick: closeHunt, text: 'OK' })));
  hunt = null;
}

function renderPass(first: boolean) {
  if (!hunt) return;
  const p = nextPlayer(hunt)!;
  const prev = first ? null : current(hunt);
  const hud = frame(
    prev ? h('p', { class: 'center', text: `${prev.player.avatar} ${prev.player.name} scored ${prev.score} points!` }) : null,
    h('div', { class: 'big', 'aria-hidden': 'true', text: p.avatar }),
    h('p', { class: 'center' }, h('strong', { text: hunt.players.length > 1 ? `${p.name}, your turn!` : 'Ready?' })),
    h('p', { class: 'help center', text: hunt.players.length > 1 && !first ? 'Pass the computer. No peeking! 🙈' : 'French words are hiding in this page. Find the ones on your list and click them.' }),
    h('div', { class: 'row' }, h('button', { class: 'b pri', onclick: () => void beginTurn(), text: hunt.timer ? `Start (${hunt.timer}s)` : 'Start hunting' })));
  (hud.querySelector('button.pri') as HTMLElement).focus();
}

function renderPlaying(message = '', tone: '' | 'ok' | 'oops' = '') {
  if (!hunt) return;
  const t = current(hunt)!;
  const left = timeLeft(hunt, Date.now());
  frame(
    h('div', { class: 'who' }, h('span', { class: 'av', 'aria-hidden': 'true', text: t.player.avatar }), h('span', { text: t.player.name }),
      left !== null ? h('span', { class: 'timer', text: `⏱ ${left}s` }) : null,
      h('span', { class: 'score', 'aria-label': `Score ${t.score}`, text: `⭐ ${t.score}` })),
    h('p', { class: 'help', text: `Find the French word for each of these (${t.found.length}/${t.targets.length}):` }),
    h('ul', { class: 'clues' }, ...t.targets.map((id) => {
      const w = BY_ID.get(id)!;
      const done = t.found.includes(id);
      return h('li', { class: done ? 'done' : '' }, h('span', { class: 'em', 'aria-hidden': 'true', text: w.emoji ?? '🔸' }),
        h('span', { class: 'en', text: w.en }), h('span', { class: 'fr', lang: 'fr', text: done ? `✓ ${w.fr}` : '' }));
    })),
    h('div', { class: `msg ${tone}`, role: 'status', 'aria-live': 'polite', text: message }),
    h('div', { class: 'row' },
      h('button', { class: 'b', onclick: onHint, text: '💡 Hint' }),
      h('button', { class: 'b', onclick: finishTurn, text: 'Finish' })));
}

function onHint() {
  if (!hunt) return;
  const id = hint(hunt);
  if (!id) return;
  const span = existing(document, 'hunt').find((s) => s.dataset.pmId === id);
  if (span) {
    span.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    span.classList.remove('pm-pulse'); void span.offsetWidth; span.classList.add('pm-pulse');
  }
  renderPlaying('Look where it glows! (Hinted words are worth 5.)', '');
}

async function renderDone() {
  if (!hunt) return;
  const rows = results(hunt);
  const win = winner(hunt);
  const real = rows.filter((r) => r.player.id !== 'guest');
  for (const r of real) await addXp(r.player.id, r.score + (r.found ? XP.huntRound : 0));
  if (real.length) await addHunt({ at: new Date().toISOString(), players: rows.map((r) => ({ id: r.player.id, score: r.score })), winner: win?.id ?? null });
  const medal = ['🥇', '🥈', '🥉', '🎖️'];
  const hud = frame(
    h('div', { class: 'big', 'aria-hidden': 'true', text: rows.length > 1 ? (win ? '🏆' : '🤝') : '🎉' }),
    h('p', { class: 'center' }, h('strong', { text: rows.length > 1 ? (win ? `${win.name} wins!` : "It's a tie! Everyone wins.") : `You found ${rows[0].found} of ${rows[0].total}!` })),
    h('ol', { class: 'pod' }, ...rows.map((r) => h('li', {}, h('span', { 'aria-hidden': 'true', text: rows.length > 1 ? medal[r.place - 1] : '⭐' }),
      h('span', { text: `${r.player.avatar} ${r.player.name}` }), h('span', { class: 'pts', text: `${r.score} pts · ${r.found}/${r.total}` })))),
    real.length ? h('p', { class: 'help center' }, h('span', { class: 'xp', text: 'XP added to the family streak 🔥' })) : null,
    h('div', { class: 'row' },
      h('button', { class: 'b', onclick: closeHunt, text: 'Done' }),
      h('button', { class: 'b pri', onclick: () => void startHunt(hunt!.players.map((p) => p.id)), text: 'Play again' })));
  (hud.querySelector('button.pri') as HTMLElement).focus();
}

function closeHunt() {
  window.clearInterval(tick);
  hunt = null;
  revert(document, 'hunt');
  clearOverlay('.hud');
}
