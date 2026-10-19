import { defineConfig } from 'wxt';

// Permissions are deliberately minimal; see README "Permissions & privacy".
export default defineConfig({
  // No module-preload polyfill: it is the only thing that would ever call fetch() (for our own files).
  vite: () => ({ build: { modulePreload: { polyfill: false } } }),
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: {
      default_title: '__MSG_actionTitle__',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    },
    // activeTab + scripting: Petit Mot only touches a page when you click it.
    // sidePanel: the learning coach. storage: profiles and progress, kept on this computer.
    // offscreen: plays the built-in pronunciation clips for words clicked on web pages.
    // tts: optional system voices.
    permissions: ['activeTab', 'scripting', 'storage', 'sidePanel', 'tts', 'offscreen'],
    // Only requested, per site, when a parent turns on "Always sprinkle on this site".
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+F', mac: 'Alt+Shift+F' },
        description: '__MSG_cmdOpen__',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; connect-src 'none'; img-src 'self' data:; media-src 'self'",
    },
  },
});
