# Petit Mot 🇫🇷

**Learn French together while you browse.** A free, open-source Chrome extension from 499Apps, made for a parent and a kid learning side by side.

- ✨ **Sprinkle French**: one click turns a few English words on the page into French. Hover to peek, click for a word card.
- 🃏 **Word cards** in the side panel: le/la with a gender colour and shape, plural, picture hint, IPA, a real example and 🔊 pronunciation with the computer's own French voice. Then "Got it" or "Again".
- 🔎 **Word Hunt**: French words hide in the page, with a couple of decoys, and you find them from English clues. Play solo or pass and play with up to 4 players, with hints, an optional timer and a podium at the end.
- 🔁 **Spaced review** per learner with [FSRS](https://github.com/open-spaced-repetition/ts-fsrs).
- 🏡 **Family**: a "Who's learning?" picker, emoji avatars, a shared family streak with grace days, team days and a weekly leaderboard.
- ⚔️ **Défi**: challenge someone on this computer, or across computers with copy-paste codes (`PM1-…`). There is no server.
- 🔒 **Private by design**: no accounts, no ads, no analytics, and the extension makes no network calls. Everything is stored on this computer. Pronunciation uses on-device voices unless you pick an online voice, which is clearly labelled.

## Permissions & privacy

| Permission | Why |
| --- | --- |
| `activeTab`, `scripting` | Runs only on the page where you click Petit Mot. |
| `storage` | Keeps learners, progress and settings locally in `chrome.storage.local`. |
| `sidePanel` | The coach panel. |
| `tts` | Pronunciation through Chrome's speech engine (on-device voices by default). |
| optional host permissions | Requested **per site**, only when you turn on "Always sprinkle on this site". |

- **No network.** Extension pages run with `connect-src 'none'`, ESLint bans `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon` in `src/` and `entrypoints/`, and the Vite module-preload polyfill is disabled so the build contains no `fetch(` call at all.
- **Voices.** On-device French voices are the default. Online voices, such as *Google français*, are labelled "online voice (sent to Google)" in Settings and are used only if you pick one. Then Chrome's own speech service, not Petit Mot, sends the spoken word to Google.
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
  speech.ts          pronunciation: chrome.tts then Web Speech, with fallbacks; local fr-FR first, online voices only if chosen
  store.ts           chrome.storage.local layer
  data/words.json    generated word pack (CC BY-SA 4.0)
scripts/
  build-wordlist.mjs word pack builder
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

## Credits & licenses

- Code: [MIT](LICENSE).
- Word pack: **CC BY-SA 4.0**, derived from [Lexique 3.83](http://www.lexique.org) (CC BY-SA 4.0) and [Wiktionary](https://en.wiktionary.org) via [Wiktextract / kaikki.org](https://kaikki.org/dictionary/French/) (CC BY-SA 4.0 + GFDL). English frequency filter from [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (CC BY-SA 4.0). Emoji names from [unicode-emoji-json](https://github.com/muan/unicode-emoji-json) (MIT).
- See [NOTICE](NOTICE) for full attribution.
