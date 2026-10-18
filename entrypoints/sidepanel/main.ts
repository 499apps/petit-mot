import { BY_ID, PACK, WORDS, GENDER_LABEL, POS_LABEL, withArticle, indefinite } from '@/src/words';
import {
  getProfiles, saveProfiles, setActive, newProfile, removeProfile, getSettings, saveSettings, getDeck, getDecks, getXp, addXp,
  rate, getChallenges, saveChallenge, resetAll, type LocalChallenge,
} from '@/src/store';
import { familyStreak, leaderboard, AVATARS, XP } from '@/src/family';
import { dueIds, isLearned, State, type Deck } from '@/src/srs';
import { buildQuiz, encode, decode, CodeError, newChallengeId, type Question, type Challenge } from '@/src/challenge';
import { speak, listFrenchVoices, voiceLabel, friendlyError, matches, INSTALL_HINT } from '@/src/speech';
import { getSyncStatus, describeStatus, clearSync, type SyncStatus } from '@/src/sync/engine';
import { collectBackupData, makeBackup, parseBackup, applyBackup, type Backup, type BackupPreview } from '@/src/backup';
import { h } from '@/src/ui/dom';
import type { Profile, Settings, Word } from '@/src/types';

type Tab = 'card' | 'review' | 'family' | 'defi' | 'settings';
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'card', icon: '🃏', label: 'Word' },
  { id: 'review', icon: '🔁', label: 'Review' },
  { id: 'family', icon: '🏡', label: 'Family' },
  { id: 'defi', icon: '⚔️', label: 'Défi' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];
const LEVELS: { v: Profile['level']; label: string }[] = [
  { v: 1, label: 'Just starting' }, { v: 2, label: 'Know some words' }, { v: 3, label: 'Getting good' }, { v: 4, label: 'Confident' },
];

const topEl = document.getElementById('top')!;
const viewEl = document.getElementById('view')!;
const tabsEl = document.getElementById('tabs')!;

let tab: Tab = 'card';
let profiles: Profile[] = [];
let active: Profile | null = null;
let settings: Settings;
let deck: Deck = {};
let focus: { id: string; orig: string | null } | null = null;
let editing: Profile | 'new' | null = null;
const openedXp = new Set<string>();
let restore: { backup: Backup; preview: BackupPreview } | null = null;
let restoreMsg: { ok: boolean; text: string } | null = null;
let syncLine: HTMLElement | null = null;

interface ReviewSession { queue: string[]; i: number; revealed: boolean; xp: number; fresh: boolean }
let reviewS: ReviewSession | null = null;
interface QuizSession { title: string; questions: Question[]; i: number; picked: number | null; score: number; onDone: (score: number) => void }
let quiz: QuizSession | null = null;
let defiResult: HTMLElement | null = null;

const now = () => new Date();

async function load() {
  [{ profiles, active }, settings] = await Promise.all([getProfiles(), getSettings()]);
  deck = active ? await getDeck(active.id) : {};
}

// ---------- shell ----------
function renderTop() {
  const learners = h('div', { class: 'learners', role: 'group', 'aria-label': "Who's learning?" },
    ...profiles.map((p) => h('button', { class: 'learner', 'aria-pressed': String(p.id === active?.id), title: `Switch to ${p.name}`,
      onclick: async () => { await setActive(p.id); reviewS = null; quiz = null; await refresh(); } },
      h('span', { class: 'av', 'aria-hidden': 'true', text: p.avatar }), h('span', { text: p.name }))),
    h('button', { class: 'learner add', title: 'Add a learner', onclick: () => { editing = 'new'; go('family'); } },
      h('span', { class: 'av', 'aria-hidden': 'true', text: '＋' }), h('span', { text: 'Add' })));
  topEl.replaceChildren(
    h('div', { class: 'row' }, h('div', { class: 'brand' }, h('img', { src: '/icon/48.png', alt: '' }), 'Petit Mot'), h('span', { class: 'spacer' }),
      active ? h('span', { class: 'chip', text: `Learning: ${active.avatar} ${active.name}` }) : null),
    learners);
}

async function renderTabs() {
  const waiting = active ? (await getChallenges()).filter((c) => c.toId === active!.id && !c.scores.some((s) => s.profileId === active!.id)).length : 0;
  const due = dueIds(deck, now()).length;
  tabsEl.replaceChildren(...TABS.map((t) => h('button', { 'aria-current': t.id === tab ? 'page' : false, onclick: () => go(t.id) },
    h('span', { class: 'ic', 'aria-hidden': 'true', text: t.icon }), t.label,
    t.id === 'review' && due ? h('span', { class: 'badge', 'aria-label': `${due} due`, text: String(due) }) : null,
    t.id === 'defi' && waiting ? h('span', { class: 'badge', 'aria-label': `${waiting} waiting`, text: String(waiting) }) : null)));
}

function go(t: Tab) {
  tab = t;
  void refresh();
  viewEl.focus({ preventScroll: true });
}

async function refresh() {
  await load();
  renderTop();
  await renderTabs();
  const views: Record<Tab, () => Promise<Node[]> | Node[]> = { card: viewCard, review: viewReview, family: viewFamily, defi: viewDefi, settings: viewSettings };
  if (!profiles.length && tab !== 'settings') { tab = 'family'; editing = editing ?? 'new'; }
  viewEl.replaceChildren(...(await views[tab]()));
}

// ---------- word card ----------
function genderTag(w: Word) {
  if (!w.g) return null;
  const shape = w.g === 'f' ? '◆' : w.g === 'm' ? '●' : '◐';
  return h('span', { class: `gtag ${w.g === 'f' ? 'g-f' : 'g-m'}`, text: `${shape} ${w.art === "l'" ? (w.g === 'f' ? 'la → l\u2019' : 'le → l\u2019') : w.art} · ${GENDER_LABEL[w.g]}` });
}

function wordCard(w: Word, opts: { orig?: string | null; onAnswer?: (a: 'good' | 'again') => void; hideMeaning?: boolean; reveal?: () => void } = {}) {
  const cls = w.g === 'f' ? 'g-f' : w.g === 'm' ? 'g-m' : '';
  const card = deck[w.id];
  const xpmsg = h('div', { class: 'xpmsg', role: 'status', 'aria-live': 'polite' });
  const say = (t: string) => async () => { const r = await speak(t, settings.voiceURI); if (!r.ok) xpmsg.textContent = friendlyError(r, true); };
  const meaning = opts.hideMeaning
    ? h('button', { class: 'pri', onclick: () => opts.reveal?.(), text: 'Show me what it means' })
    : h('div', { class: 'stack' },
      h('p', { class: 'means' }, 'means ', h('strong', { text: `“${opts.orig && w.keys.includes(opts.orig.toLowerCase()) ? opts.orig.toLowerCase() : w.en}”` }),
        w.alt.length ? h('span', { class: 'muted', text: ` · also ${w.alt.join(', ')}` }) : null),
      h('div', { class: 'facts' },
        h('span', { class: 'chip', text: POS_LABEL[w.pos] }),
        genderTag(w),
        w.pos === 'n' && w.pl && w.pl !== w.fr ? h('span', { class: 'chip', lang: 'fr', text: `plural: les ${w.pl}` }) : null,
        indefinite(w) ? h('span', { class: 'chip', lang: 'fr', text: indefinite(w)! }) : null),
      w.ex ? h('div', { class: 'example' },
        h('div', { class: 'row' }, h('span', { class: 'frx', lang: 'fr', text: w.ex.fr }), h('span', { class: 'spacer' }),
          h('button', { class: 'ghost', 'aria-label': 'Listen to the example', onclick: say(w.ex.fr), text: '🔊' })),
        h('span', { class: 'muted small', text: w.ex.en })) : null);
  return h('section', { class: 'card wc pop', 'aria-label': `Word card for ${w.fr}` },
    h('div', { class: 'hero' },
      settings.showEmoji && w.emoji && !opts.hideMeaning ? h('span', { class: 'emoji', 'aria-hidden': 'true', text: w.emoji }) : null,
      h('div', { class: 'stack', style: 'gap:2px;flex:1' },
        h('div', { class: 'fr', lang: 'fr' }, w.art ? h('span', { class: 'art', text: w.art === "l'" ? "l'" : `${w.art} ` }) : null, h('span', { class: cls, text: w.fr })),
        w.ipa ? h('span', { class: 'ipa', text: w.ipa }) : null),
      h('button', { class: 'speak', 'aria-label': `Listen: ${withArticle(w)}`, title: 'Listen', onclick: say(withArticle(w)), text: '🔊' })),
    meaning,
    opts.onAnswer && !opts.hideMeaning ? h('div', { class: 'answer' },
      h('button', { onclick: () => opts.onAnswer!('again'), text: '🔁 Again' }),
      h('button', { class: 'good', onclick: () => opts.onAnswer!('good'), text: '✅ Got it!' })) : null,
    card && !opts.hideMeaning ? h('p', { class: 'muted small', text: isLearned(card) ? '⭐ Learned! Petit Mot will check back now and then.' : card.state === State.New ? 'New word' : 'Learning this one' }) : null,
    xpmsg);
}

async function viewCard(): Promise<Node[]> {
  const w = focus ? BY_ID.get(focus.id) : null;
  if (!w) {
    return [h('section', { class: 'card empty' },
      h('div', { class: 'big', 'aria-hidden': 'true', text: '🃏' }),
      h('h2', { text: 'Click a French word on any page' }),
      h('p', { class: 'muted', text: 'Use ✨ Sprinkle French from the toolbar button, then click a highlighted word. Its card shows up here.' }),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'pri', onclick: () => go('review'), text: '🔁 Practise my words' }))),
    ];
  }
  if (active && !openedXp.has(w.id)) { openedXp.add(w.id); await addXp(active.id, XP.openCard); }
  const box = wordCard(w, {
    orig: focus?.orig,
    onAnswer: async (a) => {
      if (!active) return;
      const xp = await rate(active.id, w.id, a);
      deck = await getDeck(active.id);
      const msg = box.querySelector('.xpmsg')!;
      msg.textContent = a === 'good' ? `Super ! +${xp} XP for ${active.name}` : `No problem, it will come back soon. +${xp} XP`;
      box.querySelectorAll('.answer button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
    },
  });
  return [box, active ? null : h('p', { class: 'notice', text: 'Add a learner (＋ above) to save progress and earn XP.' })].filter(Boolean) as Node[];
}

// ---------- review ----------
function newWordsFor(level: number, n: number): string[] {
  return WORDS.filter((w) => !deck[w.id] && w.level <= Math.max(level, 1)).slice(0, n).map((w) => w.id);
}

async function viewReview(): Promise<Node[]> {
  if (!active) return [h('p', { class: 'notice', text: 'Add a learner first (＋ above).' })];
  const due = dueIds(deck, now());
  const learned = Object.values(deck).filter(isLearned).length;
  const learning = Object.keys(deck).length - learned;
  const stats = h('div', { class: 'row' },
    h('span', { class: 'chip', text: `⭐ ${learned} learned` }), h('span', { class: 'chip', text: `🌱 ${learning} growing` }),
    h('span', { class: 'chip sun', text: `🔁 ${due.length} to review` }));

  if (!reviewS || reviewS.i >= reviewS.queue.length) {
    const done = reviewS && reviewS.i >= reviewS.queue.length;
    const xp = reviewS?.xp ?? 0;
    reviewS = null;
    return [stats, h('section', { class: 'card empty pop' },
      h('div', { class: 'big', 'aria-hidden': 'true', text: done ? '🎉' : due.length ? '🔁' : '🌟' }),
      h('h2', { text: done ? `Bravo ${active.name} ! +${xp} XP` : due.length ? `${due.length} words are ready for a quick check` : 'All caught up!' }),
      h('p', { class: 'muted', text: due.length ? 'A few minutes a day is all it takes.' : 'Words come back here right before you might forget them.' }),
      h('div', { class: 'row', style: 'justify-content:center' },
        due.length ? h('button', { class: 'pri', onclick: () => { reviewS = { queue: due.slice(0, 15), i: 0, revealed: false, xp: 0, fresh: false }; void refresh(); }, text: `Start review (${Math.min(15, due.length)})` }) : null,
        h('button', { class: due.length ? '' : 'pri', onclick: () => {
          const q = newWordsFor(active!.level, 5);
          if (!q.length) return;
          reviewS = { queue: q, i: 0, revealed: true, xp: 0, fresh: true }; void refresh();
        }, text: '📚 Learn 5 new words' })))];
  }
  const s = reviewS;
  const w = BY_ID.get(s.queue[s.i])!;
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': s.queue.length, 'aria-valuenow': s.i }, h('span', { style: `width:${(s.i / s.queue.length) * 100}%` }));
  const card = wordCard(w, {
    hideMeaning: !s.revealed,
    reveal: () => { s.revealed = true; void refresh(); },
    onAnswer: async (a) => {
      s.xp += await rate(active!.id, w.id, a);
      s.i++;
      s.revealed = s.fresh;
      await refresh();
    },
  });
  return [stats, h('div', { class: 'row small muted' }, h('span', { text: s.fresh ? 'New words' : 'Review' }), h('span', { class: 'spacer' }), h('span', { text: `${s.i + 1} / ${s.queue.length}` })), bar, card];
}

// ---------- family ----------
async function viewFamily(): Promise<Node[]> {
  const log = await getXp();
  const streak = familyStreak(log, now(), settings.graceDays, profiles.map((p) => p.id));
  const decks = await getDecks(profiles.map((p) => p.id));
  const board = leaderboard(profiles, log, decks, now());
  const top = Math.max(1, ...board.map((b) => b.weekXp));
  const medal = ['🥇', '🥈', '🥉'];
  const out: Node[] = [];
  const sync = await getSyncStatus();
  if (settings.syncEnabled && sync?.state === 'full') {
    out.push(h('p', { class: 'notice small', role: 'status' }, '☁️ Chrome sync is full: new word progress stays on this computer. ',
      h('button', { class: 'linkish', onclick: () => { tab = 'settings'; void refresh(); }, text: 'See Settings' })));
  }
  if (profiles.length) {
    out.push(h('section', { class: 'card streak pop', 'aria-label': 'Family streak' },
      h('span', { class: 'flame', 'aria-hidden': 'true', text: streak.days ? '🔥' : '🌱' }),
      h('div', { class: 'stack', style: 'gap:4px' },
        h('div', {}, h('span', { class: 'n', text: String(streak.days) }), h('strong', { text: streak.days === 1 ? ' day family streak' : ' day family streak' })),
        h('p', { class: 'small', text: streak.playedToday ? (streak.teamDays && profiles.length > 1 ? `Everyone played on ${streak.teamDays} of those days ⭐` : 'Today counts! Nice work, team.') : streak.days ? 'Play a little today to grow it.' : 'Learn one word today to start a streak.' }),
        h('p', { class: 'muted small', text: settings.graceDays ? `Busy day? You can miss up to ${settings.graceDays} day${settings.graceDays > 1 ? 's' : ''} in a row and the streak keeps going.` : '' }))));
    out.push(h('section', { class: 'card stack' }, h('h3', { text: '🏆 This week' }),
      h('ol', { class: 'board' }, ...board.map((b, i) => h('li', {},
        h('span', { class: 'place', 'aria-label': `Place ${i + 1}`, text: b.weekXp ? medal[i] ?? String(i + 1) : '·' }),
        h('span', { class: 'av', 'aria-hidden': 'true', text: b.profile.avatar }),
        h('div', {}, h('strong', { text: b.profile.name }), h('div', { class: 'muted small', text: `${b.learned} words learned · ${b.totalXp} XP all time` }),
          h('div', { class: 'bar' }, h('span', { style: `width:${(b.weekXp / top) * 100}%` }))),
        h('span', { class: 'xp', text: `${b.weekXp} XP` })))),
      h('p', { class: 'muted small', text: 'XP: card opened +1 · Got it +5 · Again +2 · Word Hunt find +10 · Défi answer +5' })));
  }
  out.push(learnersCard());
  return out;
}

function learnersCard(): HTMLElement {
  if (editing) {
    const p = editing === 'new' ? null : editing;
    let avatar = p?.avatar ?? AVATARS.find((a) => !profiles.some((x) => x.avatar === a)) ?? AVATARS[0];
    const name = h('input', { type: 'text', id: 'pname', maxlength: 24, value: p?.name ?? '', placeholder: 'e.g. Léo or Dad', autocomplete: 'off' });
    const level = h('select', { id: 'plevel' }, ...LEVELS.map((l) => h('option', { value: l.v, selected: (p?.level ?? 1) === l.v, text: l.label })));
    const err = h('p', { class: 'small', style: 'color:var(--acc)', role: 'alert' });
    const save = async () => {
      if (!name.value.trim()) { err.textContent = 'Please type a name.'; name.focus(); return; }
      if (profiles.length >= 8 && !p) { err.textContent = 'Up to 8 learners.'; return; }
      const lv = Number(level.value) as Profile['level'];
      if (p) await saveProfiles(profiles.map((x) => (x.id === p.id ? { ...x, name: name.value.trim().slice(0, 24), avatar, level: lv } : x)));
      else { const np = newProfile(name.value, avatar, lv); await saveProfiles([...profiles, np], np.id); }
      editing = null;
      await refresh();
    };
    const form = h('section', { class: 'card stack pop', 'aria-label': p ? 'Edit learner' : 'Add a learner' },
      h('h2', { text: p ? `Edit ${p.name}` : profiles.length ? 'Add a learner' : "Bonjour ! Who's learning French?" }),
      profiles.length ? null : h('p', { class: 'muted', text: 'Add everyone who wants to play: a grown-up and a kid, two siblings... Only a first name or nickname is needed, and it stays on this computer.' }),
      h('label', { for: 'pname' }, h('strong', { text: 'Name or nickname' })), name,
      h('strong', { text: 'Pick an avatar' }),
      h('div', { class: 'avatars', role: 'radiogroup', 'aria-label': 'Avatar' }, ...AVATARS.map((a) => h('label', {},
        h('input', { type: 'radio', name: 'av', value: a, checked: a === avatar, onchange: () => { avatar = a; } }), h('span', { text: a })))),
      h('label', { for: 'plevel' }, h('strong', { text: 'French level' })), level,
      err,
      h('div', { class: 'row' },
        profiles.length ? h('button', { onclick: () => { editing = null; void refresh(); }, text: 'Cancel' }) : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'pri', onclick: save, text: p ? 'Save' : 'Add learner' })));
    setTimeout(() => name.focus(), 0);
    return form;
  }
  return h('section', { class: 'card stack' },
    h('div', { class: 'row' }, h('h3', { text: '👪 Learners' }), h('span', { class: 'spacer' }), h('button', { onclick: () => { editing = 'new'; void refresh(); }, text: '＋ Add' })),
    h('div', { class: 'plist' }, ...profiles.map((p) => h('div', { class: 'p' },
      h('span', { class: 'av', 'aria-hidden': 'true', text: p.avatar }),
      h('div', { style: 'flex:1' }, h('strong', { text: p.name }), h('div', { class: 'muted small', text: LEVELS.find((l) => l.v === p.level)!.label })),
      h('button', { class: 'ghost', 'aria-label': `Edit ${p.name}`, onclick: () => { editing = p; void refresh(); }, text: '✏️' }),
      h('button', { class: 'ghost danger', 'aria-label': `Remove ${p.name}`, onclick: async () => {
        if (!confirm(`Remove ${p.name} and all of ${p.name}'s progress? This can't be undone.`)) return;
        await removeProfile(p.id);
        await refresh();
      }, text: '🗑️' })))),
    h('p', { class: 'muted small', text: 'Learning on two computers? Each one keeps its own learners. Use ⚔️ Défi codes to challenge each other.' }));
}

// ---------- défi (challenges) ----------
function pickChallengeWords(n = 6): string[] {
  const studied = Object.entries(deck).sort((a, b) => (b[1].last_review ?? '').localeCompare(a[1].last_review ?? '')).map(([id]) => id).filter((id) => BY_ID.has(id));
  const ids = [...new Set([...studied.slice(0, n), ...WORDS.filter((w) => w.level <= (active?.level ?? 1)).map((w) => w.id)])];
  // shuffle the fill-ins a little so challenges differ
  const fill = ids.slice(studied.slice(0, n).length);
  for (let i = fill.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [fill[i], fill[j]] = [fill[j], fill[i]]; }
  return [...studied.slice(0, n), ...fill].slice(0, n);
}

function quizView(): Node[] {
  const q = quiz!;
  const cur = q.questions[q.i];
  const w = cur.word;
  const feedback = h('div', { class: 'xpmsg', role: 'status', 'aria-live': 'polite' });
  const opts = h('div', { class: 'opts' }, ...cur.options.map((o, i) => h('button', {
    class: q.picked === null ? '' : i === cur.answer ? 'right' : i === q.picked ? 'wrong' : '',
    disabled: q.picked !== null,
    onclick: () => {
      q.picked = i;
      if (i === cur.answer) q.score++;
      void refresh();
    },
    text: o,
  })));
  if (q.picked !== null) feedback.textContent = q.picked === cur.answer ? 'Correct ! 🎉' : `It means “${w.en}”.`;
  return [
    h('div', { class: 'row small muted' }, h('strong', { text: q.title }), h('span', { class: 'spacer' }), h('span', { text: `${q.i + 1} / ${q.questions.length}` })),
    h('div', { class: 'progress' }, h('span', { style: `width:${(q.i / q.questions.length) * 100}%` })),
    h('section', { class: 'card q pop' },
      h('p', { class: 'muted', text: 'What does this mean?' }),
      h('div', { class: 'row' }, h('div', { class: 'wc' }, h('div', { class: 'fr', lang: 'fr', text: withArticle(w) })), h('span', { class: 'spacer' }),
        h('button', { class: 'speak', 'aria-label': `Listen: ${withArticle(w)}`, onclick: async () => { const r = await speak(withArticle(w), settings.voiceURI); if (!r.ok) feedback.textContent = friendlyError(r, true); }, text: '🔊' })),
      opts, feedback,
      q.picked !== null ? h('button', { class: 'pri', onclick: () => {
        if (q.i + 1 >= q.questions.length) { const s = q.score; quiz = null; q.onDone(s); return; }
        q.i++; q.picked = null; void refresh();
      }, text: q.i + 1 >= q.questions.length ? 'See my score' : 'Next' }) : null),
  ];
}

function vsCard(a: { name: string; avatar: string; score: number | null }, b: { name: string; avatar: string; score: number | null }, total: number): HTMLElement {
  const win = a.score !== null && b.score !== null ? (a.score > b.score ? a : b.score > a.score ? b : null) : null;
  const side = (p: typeof a) => h('div', { class: 'side' }, h('span', { class: 'av', 'aria-hidden': 'true', text: p.avatar }), h('strong', { text: p.name }),
    h('span', { class: 'sc', text: p.score === null ? '…' : `${p.score}/${total}` }));
  return h('section', { class: 'card stack pop' },
    h('div', { class: 'vs' }, side(a), h('strong', { class: 'muted', text: 'vs' }), side(b)),
    h('p', { class: 'center', style: 'text-align:center;font-weight:800', text: a.score === null || b.score === null ? 'Waiting for the other player…' : win ? `${win.name} wins! 🏆` : "It's a tie! 🤝" }));
}

function copyBox(code: string, label: string): HTMLElement {
  const ta = h('textarea', { class: 'code', readonly: true, rows: 4, 'aria-label': label });
  ta.value = code;
  const msg = h('span', { class: 'small muted', role: 'status' });
  return h('div', { class: 'stack' }, ta, h('div', { class: 'row' },
    h('button', { class: 'pri', onclick: async () => {
      try { await navigator.clipboard.writeText(code); msg.textContent = 'Copied! Paste it in a message to the other computer.'; } catch { ta.select(); msg.textContent = 'Press Ctrl+C to copy.'; }
    }, text: '📋 Copy code' }), msg));
}

async function finishCreate(words: string[], seed: number, toId: string | null, score: number) {
  const me = active!;
  const id = newChallengeId(seed);
  const c: LocalChallenge = { id, createdAt: new Date().toISOString(), words, seed, fromId: me.id, fromName: me.name, fromAvatar: me.avatar, toId, total: words.length,
    scores: [{ name: me.name, avatar: me.avatar, score, profileId: me.id }] };
  await saveChallenge(c);
  await addXp(me.id, score * XP.challengeCorrect);
  const to = toId ? profiles.find((p) => p.id === toId) : null;
  defiResult = h('section', { class: 'card stack pop' },
    h('h2', { text: `You scored ${score}/${words.length}! +${score * XP.challengeCorrect} XP` }),
    to ? h('p', { text: `${to.avatar} ${to.name} will see your Défi next time they pick their avatar here.` })
      : h('div', { class: 'stack' }, h('p', { text: 'Send this code to the other computer. They open ⚔️ Défi → “I got a code” and paste it.' }),
        copyBox(encode({ kind: 'challenge', id, from: { name: me.name, avatar: me.avatar, score }, words, seed }), 'Challenge code')),
    h('button', { onclick: () => { defiResult = null; void refresh(); }, text: 'Done' }));
  await refresh();
}

async function playLocal(c: LocalChallenge) {
  const me = active!;
  quiz = { title: `${c.fromAvatar} ${c.fromName}'s Défi`, questions: buildQuiz(c.words, c.seed), i: 0, picked: null, score: 0, onDone: async (score) => {
    c.scores.push({ name: me.name, avatar: me.avatar, score, profileId: me.id });
    await saveChallenge(c);
    const first = c.scores[0];
    const xp = score * XP.challengeCorrect + (score > first.score ? XP.challengeWin : 0);
    await addXp(me.id, xp);
    defiResult = h('div', { class: 'stack' }, vsCard(first, { name: me.name, avatar: me.avatar, score }, c.total),
      h('p', { class: 'xpmsg', text: `+${xp} XP` }), h('button', { onclick: () => { defiResult = null; void refresh(); }, text: 'Done' }));
    await refresh();
  } };
  await refresh();
}

async function openCode(text: string, err: HTMLElement) {
  let c: Challenge;
  try { c = decode(text); } catch (e) { err.textContent = e instanceof CodeError ? e.message : 'This code could not be read.'; return; }
  const me = active!;
  if (c.kind === 'reply') {
    const mine = (await getChallenges()).find((x) => x.id === c.id);
    const total = c.words.length;
    if (mine && !mine.scores.some((s) => s.name === c.from.name && s.score === c.from.score)) {
      mine.scores.push({ name: c.from.name, avatar: c.from.avatar, score: c.from.score ?? 0 });
      await saveChallenge(mine);
    }
    const orig = c.replyTo ?? { name: me.name, avatar: me.avatar, score: mine?.scores[0]?.score ?? null };
    defiResult = h('div', { class: 'stack' }, h('h2', { text: `${c.from.avatar} ${c.from.name} answered your Défi!` }), vsCard(orig, c.from, total),
      h('button', { onclick: () => { defiResult = null; void refresh(); }, text: 'Done' }));
    await refresh();
    return;
  }
  quiz = { title: `${c.from.avatar} ${c.from.name}'s Défi`, questions: buildQuiz(c.words, c.seed), i: 0, picked: null, score: 0, onDone: async (score) => {
    const xp = score * XP.challengeCorrect + (c.from.score !== null && score > c.from.score ? XP.challengeWin : 0);
    await addXp(me.id, xp);
    await saveChallenge({ id: c.id, createdAt: new Date().toISOString(), words: c.words, seed: c.seed, fromId: null, fromName: c.from.name, fromAvatar: c.from.avatar, toId: me.id, total: c.words.length,
      scores: [{ name: c.from.name, avatar: c.from.avatar, score: c.from.score ?? 0 }, { name: me.name, avatar: me.avatar, score, profileId: me.id }] });
    const reply = encode({ kind: 'reply', id: c.id, from: { name: me.name, avatar: me.avatar, score }, words: c.words, seed: c.seed, replyTo: c.from });
    defiResult = h('div', { class: 'stack' }, vsCard(c.from, { name: me.name, avatar: me.avatar, score }, c.words.length), h('p', { class: 'xpmsg', text: `+${xp} XP` }),
      h('section', { class: 'card stack' }, h('h3', { text: 'Send your score back' }), h('p', { class: 'small muted', text: `Give this reply code to ${c.from.name} so they can see who won.` }), copyBox(reply, 'Reply code')),
      h('button', { onclick: () => { defiResult = null; void refresh(); }, text: 'Done' }));
    await refresh();
  } };
  await refresh();
}

async function viewDefi(): Promise<Node[]> {
  if (!active) return [h('p', { class: 'notice', text: 'Add a learner first (＋ above).' })];
  if (quiz) return quizView();
  if (defiResult) return [defiResult];
  const all = await getChallenges();
  const waiting = all.filter((c) => c.toId === active!.id && !c.scores.some((s) => s.profileId === active!.id));
  const others = profiles.filter((p) => p.id !== active!.id);
  const to = h('select', { 'aria-label': 'Who do you want to challenge?' },
    ...others.map((p) => h('option', { value: p.id, text: `${p.avatar} ${p.name} (on this computer)` })),
    h('option', { value: '', text: '💻 Someone on another computer (code)' }));
  const codeIn = h('textarea', { rows: 3, placeholder: 'Paste a PM1-… code here', 'aria-label': 'Challenge or reply code' });
  const err = h('p', { class: 'small', style: 'color:var(--acc)', role: 'alert' });
  return [
    waiting.length ? h('section', { class: 'card stack pop' }, h('h3', { text: '📬 Waiting for you' }),
      ...waiting.map((c) => h('div', { class: 'item row' }, h('span', { class: 'av', 'aria-hidden': 'true', text: c.fromAvatar }),
        h('div', { style: 'flex:1' }, h('strong', { text: `${c.fromName} challenged you!` }), h('div', { class: 'muted small', text: `${c.total} words · they scored ${c.scores[0].score}` })),
        h('button', { class: 'pri', onclick: () => void playLocal(c), text: 'Play' })))) : null,
    h('section', { class: 'card stack' }, h('h2', { text: '⚔️ Challenge someone' }),
      h('p', { class: 'muted small', text: 'You answer 6 quick questions on words you have been learning. Then they try to beat your score!' }),
      to,
      h('button', { class: 'pri', onclick: () => {
        const words = pickChallengeWords(6);
        const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
        const toId = to.value || null;
        quiz = { title: 'Your Défi', questions: buildQuiz(words, seed), i: 0, picked: null, score: 0, onDone: (s) => void finishCreate(words, seed, toId, s) };
        void refresh();
      }, text: 'Start my Défi' })),
    h('section', { class: 'card stack' }, h('h3', { text: '📥 I got a code' }), codeIn, err,
      h('button', { onclick: () => void openCode(codeIn.value, err), text: 'Open code' })),
    all.length ? h('details', { class: 'card' }, h('summary', { text: 'Past Défis' }),
      h('div', { class: 'list', style: 'margin-top:8px' }, ...all.slice(0, 8).map((c) => h('div', { class: 'item small' },
        h('span', { text: c.scores.map((s) => `${s.avatar} ${s.name} ${s.score}/${c.total}`).join('  vs  ') }))))) : null,
  ].filter(Boolean) as Node[];
}

// ---------- settings ----------
function seg<T extends string | number>(label: string, options: { v: T; t: string }[], value: T, set: (v: T) => void): HTMLElement {
  return h('div', { class: 'set' }, h('strong', { text: label }),
    h('div', { class: 'seg', role: 'group', 'aria-label': label }, ...options.map((o) => h('button', { 'aria-pressed': String(o.v === value), onclick: () => set(o.v), text: o.t }))));
}

async function viewSettings(): Promise<Node[]> {
  const save = async (p: Partial<Settings>) => { settings = await saveSettings(p); await refresh(); };
  const voices = await listFrenchVoices();
  const savedVoice = settings.voiceURI ? voices.find((v) => matches(v, settings.voiceURI!)) : undefined;
  const local = voices.filter((v) => !v.online), online = voices.filter((v) => v.online);
  const voiceSel = h('select', { id: 'voice', 'aria-describedby': 'voice-status', onchange: (e: Event) => void save({ voiceURI: (e.target as HTMLSelectElement).value || null }) },
    h('option', { value: '', text: 'Best French voice on this computer (private)' }),
    local.length ? h('optgroup', { label: 'On this computer' }, ...local.map((v) => h('option', { value: v.name, selected: v === savedVoice, text: voiceLabel(v) }))) : null,
    online.length ? h('optgroup', { label: 'Online voices (the word is sent to the provider)' }, ...online.map((v) => h('option', { value: v.name, selected: v === savedVoice, text: voiceLabel(v) }))) : null,
    settings.voiceURI && !savedVoice ? h('option', { value: settings.voiceURI, selected: true, text: `${settings.voiceURI} (not available right now)` }) : null);
  const voiceStatus = h('p', { id: 'voice-status', class: 'small', role: 'status', 'aria-live': 'polite' });
  const testVoice = async () => {
    voiceStatus.className = 'small muted';
    voiceStatus.textContent = 'Testing…';
    const r = await speak('Bonjour ! Je m’appelle Petit Mot.', settings.voiceURI);
    voiceStatus.className = r.ok ? 'notice ok small' : 'notice small';
    voiceStatus.textContent = r.ok ? `✓ Speaking with ${voiceLabel(r.voice!)}.` : friendlyError(r);
  };
  const dens = h('strong', { text: String(settings.density) });
  return [
    h('section', { class: 'card stack' }, h('h2', { text: '⚙️ Settings' }),
      h('div', { class: 'set' }, h('div', { class: 'row' }, h('label', { for: 'sd' }, h('strong', { text: 'French words per page' })), dens),
        h('input', { id: 'sd', type: 'range', min: 3, max: 10, value: settings.density, oninput: (e: Event) => { dens.textContent = (e.target as HTMLInputElement).value; }, onchange: (e: Event) => void save({ density: Number((e.target as HTMLInputElement).value) }) })),
      seg('Word Hunt: words to find', [3, 4, 5, 6, 8].map((v) => ({ v, t: String(v) })), settings.huntWords, (v) => void save({ huntWords: v })),
      seg('Word Hunt: timer', [{ v: 0, t: 'Relaxed' }, { v: 60, t: '1 min' }, { v: 120, t: '2 min' }], settings.huntTimer, (v) => void save({ huntTimer: v as Settings['huntTimer'] })),
      seg('Streak grace days', [0, 1, 2, 3].map((v) => ({ v, t: String(v) })), settings.graceDays, (v) => void save({ graceDays: v })),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: settings.showEmoji, onchange: (e: Event) => void save({ showEmoji: (e.target as HTMLInputElement).checked }) }), 'Show picture hints (emoji)'),
      h('div', { class: 'set' }, h('label', { for: 'voice' }, h('strong', { text: 'Voice' })), voiceSel,
        local.length ? null : h('p', { class: 'notice small', text: `No French voice is installed on this computer, so Petit Mot can't speak privately. ${INSTALL_HINT} Then restart Chrome.` }),
        savedVoice?.online ? h('p', { class: 'small muted', text: 'You picked an online voice: Chrome sends each word it says to Google to make the sound. Petit Mot itself still makes no network calls.' }) : null,
        h('button', { onclick: () => void testVoice(), text: '🔊 Test voice' }), voiceStatus)),
    await syncSection(save),
    h('section', { class: 'card stack' }, h('h3', { text: '🌐 Always-on sites' }),
      settings.autoSites.length ? h('div', { class: 'list' }, ...settings.autoSites.map((o) => h('div', { class: 'item' }, h('span', { style: 'flex:1', text: new URL(o).host }),
        h('button', { class: 'ghost danger', 'aria-label': `Stop on ${new URL(o).host}`, onclick: async () => {
          await browser.permissions.remove({ origins: [`${o}/*`] }).catch(() => false);
          await save({ autoSites: settings.autoSites.filter((x) => x !== o) });
        }, text: 'Remove' })))) : h('p', { class: 'muted small', text: 'None. To add one, open the Petit Mot button on a site you love and turn on “Always sprinkle”.' })),
    h('section', { class: 'card stack' }, h('h3', { text: '🔒 Privacy' }),
      h('p', { class: 'small', text: 'Petit Mot has no accounts, no ads and no tracking, and it never connects to the internet itself. Learners, progress and settings are kept in this browser; with sync on, Chrome copies them to your other computers through your own Google account, like your bookmarks. It only reads a page when you click the button, or on sites you turned on. Voices on this computer are private; if you pick an online voice, Chrome sends the words it speaks to Google.' })),
    h('details', { class: 'card' }, h('summary', { text: 'Credits & licenses' }),
      h('ul', { class: 'credits small', style: 'padding-left:18px' },
        h('li', { text: `Word pack v${PACK.version} (${PACK.count} words) is ${PACK.license}, built from:` }),
        ...PACK.sources.map((s) => h('li', {}, h('a', { href: s.url, target: '_blank', rel: 'noreferrer', text: s.name }), ` · ${s.authors} · ${s.license}`)),
        h('li', { text: 'Spaced repetition: ts-fsrs (MIT). App code: MIT. Made with ❤️ by 499Apps.' }))),
    h('section', { class: 'card stack' }, h('h3', { text: 'Start over' }),
      h('button', { class: 'danger', onclick: async () => {
        const synced = settings.syncEnabled;
        if (!confirm(synced ? 'Delete all learners, progress and settings on this computer and in Chrome sync?' : 'Delete all learners, progress and settings on this computer?')) return;
        if (!confirm('Really? This cannot be undone. Tip: “Back up to file” first.')) return;
        await resetAll();
        if (synced) await clearSync().catch(() => undefined);
        editing = 'new'; tab = 'family'; await refresh();
      }, text: 'Delete everything' })),
  ];
}

// ---------- sync & backup ----------
async function syncSection(save: (p: Partial<Settings>) => Promise<void>): Promise<HTMLElement> {
  const status = await getSyncStatus();
  syncLine = h('p', { class: lineClass(status), role: 'status', 'aria-live': 'polite', text: describeStatus(status, settings.syncEnabled) });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: 'restore-file', tabindex: -1, 'aria-hidden': 'true', onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const r = await parseBackup(await f.text());
    restore = r.ok ? { backup: r.backup, preview: r.preview } : null;
    restoreMsg = r.ok ? null : { ok: false, text: r.error };
    await refresh();
  } }) as HTMLInputElement;
  const backup = async () => {
    const { text, filename } = await makeBackup(await collectBackupData(), browser.runtime.getManifest().version);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: filename }) as HTMLAnchorElement;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    restoreMsg = { ok: true, text: `Saved ${filename} to your Downloads. Keep it somewhere safe.` };
    await refresh();
  };
  const apply = async (mode: 'merge' | 'replace') => {
    if (!restore) return;
    if (mode === 'replace' && !confirm('Replace this computer’s learners and progress with the backup? Learners not in the backup will be removed.')) return;
    await applyBackup(restore.backup.data, mode);
    restoreMsg = { ok: true, text: mode === 'merge' ? 'Backup merged ✓ Nothing was lost: for each word, the most recent practice was kept.' : 'Backup restored ✓' };
    restore = null;
    await refresh();
  };
  const preview = restore ? h('div', { class: 'notice stack', style: 'gap:8px' },
    h('strong', { text: `Backup from ${new Date(restore.preview.createdAt).toLocaleString()}` }),
    h('ul', { class: 'small', style: 'margin:0;padding-left:18px' }, ...restore.preview.learners.map((l) => h('li', { text: `${l.avatar} ${l.name}: ${l.cards} ${l.cards === 1 ? 'word' : 'words'}, ${l.xp} XP` }))),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      h('button', { class: 'pri', onclick: () => void apply('merge'), text: 'Merge with this computer' }),
      h('button', { class: 'danger', onclick: () => void apply('replace'), text: 'Replace' }),
      h('button', { class: 'ghost', onclick: () => { restore = null; void refresh(); }, text: 'Cancel' }))) : null;
  return h('section', { class: 'card stack' }, h('h3', { text: '☁️ Sync & backup' }),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: settings.syncEnabled, onchange: (e: Event) => void save({ syncEnabled: (e.target as HTMLInputElement).checked }) }), 'Sync progress with Chrome'),
    syncLine,
    h('p', { class: 'small muted', text: 'Uses your own Chrome sync (you need to be signed in to Chrome with sync on for Extensions), so learners, words, XP, streak and settings follow you to your other computers. Petit Mot never connects to the internet itself: Chrome does the syncing.' }),
    settings.syncEnabled ? h('button', { class: 'ghost', onclick: async () => { if (syncLine) syncLine.textContent = 'Syncing…'; await browser.runtime.sendMessage({ type: 'pm:sync-now' }).catch(() => null); }, text: '🔄 Sync now' }) : null,
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      h('button', { onclick: () => void backup(), text: '⬇️ Back up to file' }),
      h('button', { onclick: () => fileInput.click(), text: '⬆️ Restore from file' }),
      fileInput),
    restoreMsg ? h('p', { class: restoreMsg.ok ? 'notice ok small' : 'notice small', role: 'status', text: restoreMsg.text }) : null,
    preview);
}
function lineClass(s: SyncStatus | null): string {
  return s && (s.state === 'full' || s.state === 'error' || s.state === 'busy') ? 'notice small' : 'small';
}

// ---------- wiring ----------
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.syncStatus && syncLine?.isConnected) {
    const st = changes.syncStatus.newValue as SyncStatus | undefined;
    syncLine.className = lineClass(st ?? null);
    syncLine.textContent = describeStatus(st ?? null, settings.syncEnabled);
  }
  if (area === 'session' && changes.focus?.newValue) {
    const f = changes.focus.newValue as { id: string; orig: string | null };
    focus = { id: f.id, orig: f.orig };
    tab = 'card';
    void refresh();
  } else if (area === 'session' && changes.route?.newValue) {
    tab = (changes.route.newValue as { name: Tab }).name;
    void refresh();
  } else if (area === 'local' && (changes.profiles || changes.active || changes.settings || changes.challenges) && !quiz && !reviewS && !editing && !restore) {
    void refresh();
  } else if (area === 'local' && tab === 'family' && changes.xp && !editing) {
    void refresh();
  }
});

(async () => {
  const s = await browser.storage.session.get(['focus', 'route']);
  const f = s.focus as { id: string; orig: string | null; at: number } | undefined;
  const r = s.route as { name: Tab; at: number } | undefined;
  if (f) focus = { id: f.id, orig: f.orig };
  if (r && Date.now() - r.at < 10_000) tab = r.name;
  await refresh();
})();
