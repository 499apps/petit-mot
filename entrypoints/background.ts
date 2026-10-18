import { getSettings, saveSettings } from '@/src/store';

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
