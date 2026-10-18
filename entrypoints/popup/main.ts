import { getProfiles, getSettings, saveSettings, setActive, getXp } from '@/src/store';
import { familyStreak } from '@/src/family';
import { checkUrl, REASON_TEXT } from '@/src/engine/sensitive';
import { dayKey } from '@/src/dates';
import { h } from '@/src/ui/dom';
import type { PageMsg, PageStatus } from '../page';
import type { Profile, Settings } from '@/src/types';

const app = document.getElementById('app')!;
let tab: { id: number; url: string } | null = null;
let windowId: number | undefined;
let settings: Settings;
let profiles: Profile[] = [];
let active: Profile | null = null;
let notice: HTMLElement;

function setNotice(text: string, tone: '' | 'ok' = '') {
  notice.hidden = !text;
  notice.className = `notice ${tone}`;
  notice.textContent = text;
}

/** The side panel must be opened synchronously inside the click. */
function openPanel(route?: string) {
  if (windowId !== undefined) void browser.sidePanel.open({ windowId });
  if (route) void browser.storage.session.set({ route: { name: route, at: Date.now() } });
  setTimeout(() => window.close(), 150);
}

async function send(msg: PageMsg): Promise<PageStatus | null> {
  if (!tab) return null;
  const pre = checkUrl(tab.url);
  if (!pre.ok) { setNotice(REASON_TEXT[pre.reason!]); return null; }
  try {
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/page.js'] });
    const r = (await browser.tabs.sendMessage(tab.id, msg)) as PageStatus;
    if (!r.ok && r.reason) setNotice(r.reason);
    return r;
  } catch {
    setNotice(REASON_TEXT.unsupported);
    return null;
  }
}

async function render() {
  [{ profiles, active }, settings] = await Promise.all([getProfiles(), getSettings()]);
  const log = await getXp();
  const streak = familyStreak(log, new Date(), settings.graceDays, profiles.map((p) => p.id));
  const today = active ? log[dayKey(new Date())]?.[active.id] ?? 0 : 0;
  notice = h('div', { class: 'notice', role: 'status', hidden: true });

  const header = h('header', {},
    h('div', { class: 'brand' }, h('img', { src: '/icon/48.png', alt: '' }), 'Petit Mot'),
    h('span', { class: 'spacer' }),
    profiles.length
      ? h('label', { class: 'who' }, h('span', { class: 'sr', text: "Who's learning?" }),
        (() => {
          const sel = h('select', { 'aria-label': "Who's learning?", onchange: async (e: Event) => { await setActive((e.target as HTMLSelectElement).value); void render(); } },
            ...profiles.map((p) => h('option', { value: p.id, selected: p.id === active?.id, text: `${p.avatar} ${p.name}` })));
          return sel;
        })())
      : null);

  if (!profiles.length) {
    app.replaceChildren(header, h('section', { class: 'card welcome pop' },
      h('div', { class: 'wave', 'aria-hidden': 'true', text: '👋' }),
      h('h2', { text: 'Bonjour ! Who is learning French?' }),
      h('p', { class: 'muted', text: 'Add each person in your family. It takes 10 seconds and stays on this computer.' }),
      h('button', { class: 'pri', onclick: () => openPanel('family'), text: 'Add learners' })),
      foot());
    return;
  }

  const stats = h('div', { class: 'stats' },
    h('span', { class: 'chip sun', title: 'Family streak', text: `🔥 ${streak.days}-day family streak` }),
    h('span', { class: 'chip', text: `⭐ ${today} XP today` }));

  const others = profiles.filter((p) => p.id !== active?.id);
  const huntWith = h('select', { 'aria-label': 'Who is playing Word Hunt?' },
    h('option', { value: '', text: 'Solo' }),
    ...others.map((p) => h('option', { value: p.id, text: `+ ${p.avatar} ${p.name}` })),
    others.length > 1 ? h('option', { value: '*', text: 'Everyone' }) : null);
  if (others.length === 1) huntWith.value = others[0].id;

  const sprinkle = h('button', { class: 'big pri', onclick: async () => {
    const r = await send({ type: 'pm:swap' });
    if (r?.ok) setNotice(r.added ? `✨ ${r.added} French words are hiding in this page. Click one to learn it!` : r.swaps ? 'This page already has its French words. Click one!' : 'No good words to swap here. Try a story, a blog post or Wikipedia.', 'ok');
    if (r?.ok) undo.hidden = !r.swaps;
  } }, h('span', { class: 'em', 'aria-hidden': 'true', text: '✨' }), h('span', {}, 'Sprinkle French', h('span', { class: 'sub', text: `${settings.density} words on this page` })));

  const undo = h('button', { class: 'ghost small', hidden: true, onclick: async () => { await send({ type: 'pm:revert' }); undo.hidden = true; setNotice('Back to English.', 'ok'); }, text: '↩ Put the English back' });

  const huntBtn = h('button', { class: 'big', onclick: async () => {
    const v = huntWith.value;
    const players = [active!.id, ...(v === '*' ? others.map((p) => p.id) : v ? [v] : [])];
    const r = await send({ type: 'pm:hunt', players });
    if (r?.ok) window.close();
  } }, h('span', { class: 'em', 'aria-hidden': 'true', text: '🔎' }), h('span', {}, 'Word Hunt', h('span', { class: 'sub', text: 'Find the hidden French words' })));

  const coach = h('button', { class: 'big', onclick: () => openPanel() },
    h('span', { class: 'em', 'aria-hidden': 'true', text: '📖' }), h('span', {}, 'Open my coach', h('span', { class: 'sub', text: 'Word cards, review, family and challenges' })));

  const val = h('strong', { text: String(settings.density) });
  const density = h('div', { class: 'density' },
    h('div', { class: 'row' }, h('label', { for: 'dens', text: 'Words per page' }), val),
    h('input', { id: 'dens', type: 'range', min: 3, max: 10, step: 1, value: settings.density, oninput: (e: Event) => { val.textContent = (e.target as HTMLInputElement).value; },
      onchange: async (e: Event) => { settings = await saveSettings({ density: Number((e.target as HTMLInputElement).value) }); } }));

  let auto: HTMLElement | null = null;
  const origin = tab && checkUrl(tab.url).ok && /^https?:/.test(tab.url) ? new URL(tab.url).origin : null;
  if (origin) {
    const host = new URL(origin).host;
    const box = h('input', { type: 'checkbox', checked: settings.autoSites.includes(origin), onchange: async (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      if (on) {
        const ok = await browser.permissions.request({ origins: [`${origin}/*`] });
        if (!ok) { (e.target as HTMLInputElement).checked = false; return; }
        settings = await saveSettings({ autoSites: [...new Set([...settings.autoSites, origin])] });
        setNotice(`Petit Mot will sprinkle French on ${host} automatically.`, 'ok');
      } else {
        settings = await saveSettings({ autoSites: settings.autoSites.filter((x) => x !== origin) });
        await browser.permissions.remove({ origins: [`${origin}/*`] }).catch(() => false);
        setNotice(`Turned off for ${host}.`, 'ok');
      }
    } });
    auto = h('label', { class: 'switch small' }, box, h('span', {}, 'Always sprinkle on ', h('strong', { text: host })));
  }

  app.replaceChildren(header, stats,
    h('div', { class: 'actions' }, sprinkle, undo, h('div', { class: 'hunt' }, huntBtn, huntWith), coach),
    ...[notice, density, auto, foot()].filter((x): x is HTMLElement => !!x));

  if (tab && checkUrl(tab.url).ok) {
    try {
      const r = (await browser.tabs.sendMessage(tab.id, { type: 'pm:status' } satisfies PageMsg)) as PageStatus;
      undo.hidden = !r?.swaps;
      if (r && !r.ok && r.reason) setNotice(r.reason);
    } catch { /* not injected yet: that's fine */ }
  } else if (tab) {
    const v = checkUrl(tab.url);
    setNotice(REASON_TEXT[v.reason!]);
  }
}

function foot() {
  return h('div', { class: 'foot' }, h('span', { 'aria-hidden': 'true', text: '🔒' }), 'Everything stays on this computer.');
}

(async () => {
  const [t] = await browser.tabs.query({ active: true, currentWindow: true });
  if (t?.id !== undefined) tab = { id: t.id, url: t.url ?? '' };
  windowId = t?.windowId;
  await render();
})();
