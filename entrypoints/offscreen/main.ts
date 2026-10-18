// Hidden page that plays the built-in clips for words clicked on web pages (in-page card, Word
// Hunt). A content script can't play extension audio reliably (page CSP, autoplay rules), so the
// background asks here. Only chrome.runtime is available in an offscreen document.
import { pagePlayer, type PlayOutcome } from '@/src/audio';

const player = pagePlayer();
browser.runtime.onMessage.addListener((msg: { type?: string; path?: unknown }, _sender, sendResponse) => {
  if (msg?.type === 'pm:offscreen-stop') { player.stop(); return undefined; }
  if (msg?.type !== 'pm:offscreen-play' || typeof msg.path !== 'string' || !/^audio\/[a-z0-9/.-]+\.ogg$/.test(msg.path)) return undefined;
  player.play(msg.path).then((o: PlayOutcome) => sendResponse(o), () => sendResponse('error'));
  return true;
});
