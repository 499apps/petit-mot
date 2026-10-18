import { getSettings, saveSettings } from '@/src/store';
import { speakWith, ttsEngine } from '@/src/speech';
import { isSyncedKey, scheduleSync, syncNow } from '@/src/sync/engine';

const AUTO_ID = 'petit-mot-auto';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: { type?: string; id?: string; orig?: string }, sender) => {
    if (msg?.type !== 'pm:open-word' || !msg.id) return undefined;
    const tabId = sender.tab?.id;
    // open() must run first, synchronously inside the click's user gesture.
    const opening = tabId !== undefined ? browser.sidePanel.open({ tabId }) : Promise.reject(new Error('no tab'));
    void browser.storage.session.set({ focus: { id: msg.id, orig: msg.orig ?? null, at: Date.now() } });
    return opening.then(() => ({ opened: true }), () => ({ opened: false }));
  });

  // Content scripts can't use chrome.tts; they ask here. Text is a word or short phrase from our pack.
  browser.runtime.onMessage.addListener((msg: { type?: string; text?: unknown }) => {
    if (msg?.type !== 'pm:speak' || typeof msg.text !== 'string') return undefined;
    const text = msg.text.slice(0, 200);
    const tts = ttsEngine();
    return getSettings().then((s) => speakWith(tts ? [tts] : [], text, s.voiceURI));
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
