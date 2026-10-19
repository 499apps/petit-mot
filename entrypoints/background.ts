import { getSettings, saveSettings } from '@/src/store';
import { speakWith, ttsEngine, stopSpeech } from '@/src/speech';
import { makePronouncer, type Player, type PlayOutcome } from '@/src/audio';
import { isSyncedKey, scheduleSync, syncNow } from '@/src/sync/engine';

const AUTO_ID = 'petit-mot-auto';
const CLIP_PATH = /^audio\/[a-z0-9/.-]+\.ogg$/;

let creating: Promise<void> | null = null;
/** The offscreen document closes itself after a while without audio; recreate it on demand. */
async function ensureOffscreen(): Promise<void> {
  const open = await browser.runtime.getContexts({ contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (open.length) return;
  creating ??= browser.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [browser.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Plays Petit Mot’s built-in pronunciation clips for words on web pages.',
  }).catch((e: unknown) => { if (!/single offscreen/i.test(String(e))) throw e; }).finally(() => { creating = null; });
  await creating;
}
const ask = (path: string) => browser.runtime.sendMessage({ type: 'pm:offscreen-play', path }) as Promise<PlayOutcome | undefined>;
const offscreenPlayer: Player = {
  async play(path) {
    try { await ensureOffscreen(); } catch { return 'error'; }
    // Right after creation the page may not be listening yet: one quick retry.
    const out = await ask(path).catch(async () => { await new Promise((r) => setTimeout(r, 150)); return ask(path).catch(() => undefined); });
    return out ?? 'error';
  },
  stop() { void browser.runtime.sendMessage({ type: 'pm:offscreen-stop' }).catch(() => undefined); },
};
const pronounce = makePronouncer({
  player: offscreenPlayer,
  speak: (text, voiceURI) => { const tts = ttsEngine(); return speakWith(tts ? [tts] : [], text, voiceURI); },
  stopSpeech,
});

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: { type?: string; id?: string; orig?: string }, sender) => {
    if (msg?.type !== 'pm:open-word' || !msg.id) return undefined;
    const tabId = sender.tab?.id;
    // open() must run first, synchronously inside the click's user gesture.
    const opening = tabId !== undefined ? browser.sidePanel.open({ tabId }) : Promise.reject(new Error('no tab'));
    void browser.storage.session.set({ focus: { id: msg.id, orig: msg.orig ?? null, at: Date.now() } });
    return opening.then(() => ({ opened: true }), () => ({ opened: false }));
  });

  // Words clicked on web pages (in-page card, Word Hunt): content scripts ask here. The built-in
  // clip plays in the offscreen document; a system voice (chrome.tts) is the fallback.
  // Answers with sendResponse (and returns true) so the reply always arrives, success or not.
  browser.runtime.onMessage.addListener((msg: { type?: string; text?: unknown; clip?: unknown }, _sender, sendResponse) => {
    if (msg?.type !== 'pm:say' || typeof msg.text !== 'string') return undefined;
    const text = msg.text.slice(0, 200);
    const path = typeof msg.clip === 'string' && CLIP_PATH.test(msg.clip) ? msg.clip : null;
    getSettings()
      .then((s) => pronounce({ path, text }, s))
      .then((r) => sendResponse(r), () => sendResponse({ ok: false, reason: 'failed', tried: [] }));
    return true;
  });

  // Chrome sync: push local changes (debounced) and pull changes from the family's other computers.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some(isSyncedKey)) scheduleSync(3000);
    else if (area === 'sync' && Object.keys(changes).some((k) => k.startsWith('pm.'))) scheduleSync(500);
  });
  browser.runtime.onMessage.addListener((msg: { type?: string }) => (msg?.type === 'pm:sync-now' ? syncNow() : undefined));
  // First run after installing or upgrading: merges this computer's existing data with sync (no loss).
  browser.runtime.onInstalled.addListener(() => scheduleSync(0));
  browser.runtime.onStartup.addListener(() => scheduleSync(0));

  browser.runtime.onStartup.addListener(() => void syncAuto());
  browser.runtime.onInstalled.addListener(() => void syncAuto());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) void syncAuto();
  });
  browser.permissions.onRemoved.addListener(async ({ origins }) => {
    if (!origins?.length) return;
    const s = await getSettings();
    const gone = new Set(origins.map((o) => o.replace(/\/\*$/, '')));
    const next = s.autoSites.filter((x) => !gone.has(x));
    if (next.length !== s.autoSites.length) await saveSettings({ autoSites: next });
  });
});

/** Keeps the opt-in "always sprinkle" sites registered, and only those we still have permission for. */
async function syncAuto() {
  const s = await getSettings();
  const allowed: string[] = [];
  for (const origin of s.autoSites) {
    if (await browser.permissions.contains({ origins: [`${origin}/*`] })) allowed.push(`${origin}/*`);
  }
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [AUTO_ID] });
  if (existing.length) await browser.scripting.unregisterContentScripts({ ids: [AUTO_ID] });
  if (!allowed.length) return;
  await browser.scripting.registerContentScripts([{ id: AUTO_ID, js: ['page.js'], matches: allowed, runAt: 'document_idle', persistAcrossSessions: true }]);
}
