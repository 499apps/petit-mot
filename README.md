# Petit Mot 🇫🇷

**Learn French together while you browse.** A free, open-source Chrome extension from 499Apps, made for a parent and a kid learning side by side.

- ✨ **Sprinkle French**: one click turns a few English words on the page into French. Hover to peek, click for a word card.
- 🃏 **Word cards** in the side panel: le/la with a gender colour and shape, plural, picture hint, IPA, a real example and 🔊 pronunciation in the built-in **Petit Mot voice**: recorded clips for every word and example, offline, on any computer (no French system voice needed). Then "Got it" or "Again".
- 🔎 **Word Hunt**: French words hide in the page, with a couple of decoys, and you find them from English clues. Play solo or pass and play with up to 4 players, with hints, an optional timer and a podium at the end.
- 🔁 **Spaced review** per learner with [FSRS](https://github.com/open-spaced-repetition/ts-fsrs).
- 🏡 **Family**: a "Who's learning?" picker, emoji avatars, a shared family streak with grace days, team days and a weekly leaderboard.
- ⚔️ **Défi**: challenge someone on this computer, or across computers with copy-paste codes (`PM1-…`). There is no server.
- ☁️ **Sync & backup**: progress follows the family between computers through their own Chrome sync (on by default, can be turned off), and they can back up to or restore from a JSON file.
- 🔒 **Private by design**: no accounts, no ads, no analytics, and the extension makes no network calls. Data lives in the browser, and Chrome sync carries it between computers if sync is on. Pronunciation uses clips shipped inside the extension; system voices are optional, and online ones are clearly labelled.

## Permissions & privacy

| Permission | Why |
| --- | --- |
| `activeTab`, `scripting` | Runs only on the page where you click Petit Mot. |
| `storage` | Keeps learners, progress and settings in `chrome.storage.local`, plus a compact copy in `chrome.storage.sync` when sync is on. Chrome carries that copy through the user's own Google account. |
| `sidePanel` | The coach panel. |
| `offscreen` | Plays the built-in pronunciation clips for words clicked on web pages (a hidden extension page; reason `AUDIO_PLAYBACK`). |
| `tts` | Optional system voices (Settings → Voice), and the fallback for any text without a clip. |
| optional host permissions | Requested **per site**, only when you turn on "Always sprinkle on this site". |

- **No network.** Extension pages run with `connect-src 'none'`, ESLint bans `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon` in `src/` and `entrypoints/`, and the Vite module-preload polyfill is disabled so the build contains no `fetch(` call at all.
- **Voices.** The default is the built-in Petit Mot voice: audio files inside the extension, so nothing is sent anywhere. System voices are an option. Online voices, such as *Google français*, are labelled "online voice (sent to Google)" in Settings and are used only if you pick one. Then Chrome's own speech service, not Petit Mot, sends the spoken word to Google.
- **Never touches** inputs, textareas, contenteditable, code/pre, links, buttons, nav/footer, forms, `translate="no"` or hidden content. See `src/engine/skip.ts`.
- **Stays off** sign-in, checkout/cart/payment, banking, email and document pages, pages with password or card fields, and non-English pages. See `src/engine/sensitive.ts`.
- Full policy: [docs/PRIVACY.md](docs/PRIVACY.md).

## Develop

```bash
npm install
npm run dev        # WXT dev build with live reload
npm run check      # typecheck + lint + tests
npm run build      # .output/chrome-mv3
npm run zip        # store upload zip
```

To load it in Chrome, open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `.output/chrome-mv3`.

### Layout

```
entrypoints/
  background.ts      opens the side panel on word clicks; keeps opt-in sites registered
  page.ts            injected on click: swaps, word clicks, Word Hunt HUD (shadow DOM)
  popup/             Sprinkle, Word Hunt, learner switch, words per page, always-on toggle
  sidepanel/         Word card, Review, Family, Défi, Settings
src/
  engine/            swap engine (find, choose, apply, revert), skip rules, context rules, sensitive pages
  words.ts           word pack index, English plurals, French forms
  srs.ts             FSRS wrapper (Got it = Good, Again = Again), swap priority per learner
  family.ts          family streak with grace days, leaderboard, XP table, avatars
  hunt.ts            Word Hunt rules (pure, tested)
  challenge.ts       PM1 challenge codes (base64url JSON + CRC32), seeded quiz
  audio.ts           built-in voice: clip lookup, one-at-a-time ClipPlayer, pronounce() with system-voice fallback
  speech.ts          system voices: chrome.tts then Web Speech, with fallbacks; local fr-FR first, online voices only if chosen
  store.ts           chrome.storage.local layer
  sync/              Chrome sync: compact sharded encoding within sync quotas, merge, debounced engine
  backup.ts          backup files (version + SHA-256 checksum), validation, preview, merge or replace
  data/words.json    generated word pack (CC BY-SA 4.0)
  data/audio.json    word id -> clip file (generated by npm run audio)
scripts/
  build-wordlist.mjs word pack builder
  build-audio.mjs    built-in voice builder (Piper + ffmpeg/Opus), incremental
  data/              core.txt (curated beginner core), overrides.json (audited fixes), emoji.json, blocklist.json, h-aspire.json
```

## The word pack

`src/data/words.json` holds **1,500 kid-safe EN→FR words**: 313 of them are hand-curated beginner words (animals, food, family, school, colours…), ranked first, and the rest come from frequency. Each word has a lemma, POS, gender, article (with elision and h aspiré), plural, IPA, frequency, level 1–4, English meaning, an optional short example and an optional emoji. Words that are often another part of speech (`play`, `watch`) and all verbs are only swapped with grammatical context ("**to** play", "**the** watch").

Quality: every entry was hand-audited. Corrections live in `scripts/data/overrides.json`, which the build applies: fixed glosses and trigger words, genders, plurals, removed or vouched-for examples, and dropped entries, each with a reason. The build fails if an override points at an entry that no longer exists. It also checks that plurals follow a regular pattern (so feminine forms like *ourses* can't pass as plurals) and that an example's English line actually contains the word. `tests/glosses.test.ts` guards every known-bad case.

Kid-safety: whole lemmas are dropped if any Wiktionary sense is tagged vulgar, offensive, derogatory or a slur. Senses tagged slang, archaic, regional and so on are skipped. Words, glosses and examples are checked against `scripts/data/blocklist.json`, and a test re-checks the shipped pack against the blocklist.

### Rebuilding the word pack

```bash
mkdir -p data/raw && cd data/raw
curl -LO https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl   # ~580 MB
curl -LO https://lexique.org/databases/Lexique383/Lexique383.zip && unzip Lexique383.zip Lexique383.tsv
curl -L -o en_50k.txt https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
cd ../.. && npm run data      # writes src/data/words.json and data/build-report.txt
```

The build is deterministic. `data/raw/` is git-ignored.

## The built-in voice

`public/audio/` holds one Ogg Opus clip (24 kb/s mono) per word, said with its article for nouns (*le chien*), one per example sentence and the Settings test phrase: about 1,800 files, about 5.3 MB. They are made offline by `npm run audio` with [Piper](https://github.com/rhasspy/piper) (MIT) and the `fr_FR-siwis-medium` voice (trained on the SIWIS French Speech Synthesis Database, CC BY 4.0). The script downloads Piper and the voice once into `.cache/` at pinned versions with SHA-256 checks, needs `ffmpeg` with libopus, and only regenerates clips whose text or settings changed (`-- --all` redoes everything). Words that the voice mispronounces in isolation get a spelling hint in `scripts/data/audio-respell.json` (e.g. *dos*, *rythme*); the learner still sees the real spelling.

The clips are committed (no Git LFS: they are small, and a clone or CI build then needs no TTS tools). `tests/audio.test.ts` fails if any word or example lacks a clip, if a clip is stale against its word, or if the set grows past 10 MB. Piper's synthesis is slightly random, so a full rebuild sounds the same but is not byte-identical; `scripts/data/audio-lock.json` records the text and settings behind every clip.

Playback: the side panel plays clips with an `Audio` element; for the in-page card and Word Hunt the background plays them in an offscreen document, which page CSPs and autoplay rules can't block. Every click stops the previous clip and starts the new one, and if a clip can't play Petit Mot falls back to a system voice.

## Credits & licenses

- Code: [MIT](LICENSE).
- Word pack: **CC BY-SA 4.0**, derived from [Lexique 3.83](http://www.lexique.org) (CC BY-SA 4.0) and [Wiktionary](https://en.wiktionary.org) via [Wiktextract / kaikki.org](https://kaikki.org/dictionary/French/) (CC BY-SA 4.0 + GFDL). English frequency filter from [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (CC BY-SA 4.0). Emoji names from [unicode-emoji-json](https://github.com/muan/unicode-emoji-json) (MIT).
- Built-in voice: clips made with [Piper](https://github.com/rhasspy/piper) (MIT) and the *siwis* French voice, trained on the [SIWIS French Speech Synthesis Database](https://doi.org/10.7488/ds/1705) by Yamagishi, Honnet, Garner and Lazaridis (CC BY 4.0). The clips read the word pack, so they are CC BY-SA 4.0 too.
- See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [NOTICE](NOTICE) for full attribution.

## Contributing

Issues and pull requests are welcome. Please run `npm run check` (typecheck, lint and tests) before opening a PR, and keep the extension private by design: no network requests, no tracking. To report a security or privacy problem, see [SECURITY.md](SECURITY.md).

## License

The code is released under the [MIT License](LICENSE), Copyright (c) 2026 499Apps.

The French word pack (`src/data/words.json`), the curated lists in `scripts/data/` and the built-in voice clips (`public/audio/`) are **not** MIT. They are licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) because they derive from Lexique and Wiktionary. Reuse them with attribution and share any changes under the same license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
