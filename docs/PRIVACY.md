# Petit Mot privacy policy

_Last updated: October 18, 2026 (v0.1.2: Chrome sync and backup files)_

Petit Mot is a free browser extension from 499Apps that helps families learn French while browsing. It was designed for use by a parent and child together, so privacy is built into how it works, not added on top.

## What Petit Mot does not do

- It does **not** collect, transmit, sell or share any personal information.
- It has **no accounts**, **no ads**, **no analytics**, **no crash reporting** and **no tracking**.
- The extension itself **never connects to the internet**. Its own pages block network requests (`connect-src 'none'`), and it ships its whole French word pack inside the extension. The one exception is a choice you make: an online voice (see Pronunciation).

## What is stored, and where

Everything is kept in your browser's extension storage (`chrome.storage.local`) on your computer:

- learner nicknames and emoji avatars you type in,
- each learner's word progress (spaced-repetition schedule), XP and family streak,
- Word Hunt and Défi (challenge) results,
- your settings.

You can delete it at any time: **Settings → Delete everything**, or remove the extension.

### Chrome sync (on by default, you can turn it off)

With **Settings → Sync progress with Chrome** on, Petit Mot also keeps a compact copy of learner nicknames and avatars, word progress, XP and streak, and shared settings in `chrome.storage.sync`. If you're signed in to Chrome with sync turned on, **Chrome** copies this to your other computers through **your own Google account**, the same way it syncs your bookmarks and extensions. This uses Chrome's own sync and its privacy controls (including a sync passphrase if you set one). Petit Mot has no server, never sees your account, and still makes no network calls itself.

These stay on each computer and are not synced: the active learner, your voice choice, always-on sites, challenge history and Word Hunt history. Turn sync off at any time; data already in Chrome sync is removed by **Delete everything**.

### Backup files

**Back up to file** saves a JSON file to your Downloads, and you decide where it goes from there. **Restore from file** reads a file you pick, checks it, shows you what's inside, and only then merges it or replaces this computer's data. Nothing is uploaded.

## Web pages

Petit Mot only reads a web page when you click its button on that page (Chrome's `activeTab`), or on sites where you turned on **Always sprinkle**, which asks for permission for that one site. It looks for common English words, changes a few of them to French on your screen, and does nothing else with the page. It stays off on sign-in, payment, banking, email and document pages. Page text never leaves your computer.

## Challenge codes

Défi codes are text you copy and share yourself, for example by pasting them into a message. A code contains only a nickname, an emoji, a list of French words, a quiz number and a score. Petit Mot does not send codes anywhere.

## Pronunciation

By default Petit Mot speaks with a French voice installed on your computer, so nothing leaves your device.

In **Settings → Voice** you can choose an online voice instead. These are labelled "online voice (sent to Google)", for example *Google français*. If you do, Chrome sends the word or short phrase being spoken (never page text, names or progress) to Google to create the sound. That traffic comes from Chrome's built-in speech service, not from Petit Mot. Switch back to "Best French voice on this computer (private)" at any time.

Petit Mot never switches to an online voice by itself. If your computer has no French voice, it tells you how to install one: on Windows, **Settings → Time & language → Speech → Add voices → Français (France)**.

## Children

Petit Mot is meant to be set up by a parent and used together as a family. Because it collects no personal information, no information about children is gathered, stored on a server or shared.

## Contact

support@499apps.com
