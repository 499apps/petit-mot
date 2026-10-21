# Third-party notices

Petit Mot's own code is released under the [MIT License](LICENSE), Copyright (c) 2026 499Apps.

The extension also ships third-party code, and data derived from third-party sources. Those parts keep their own licenses, listed below. **The word data and the voice clips are not MIT-licensed:** they are under Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0), so if you reuse or adapt them you must give credit and share your changes under the same license. See also [NOTICE](NOTICE).

## Summary

| Part | Files | License |
|---|---|---|
| Petit Mot code | `src/` (except `src/data/`), `entrypoints/`, `scripts/*.mjs`, `tests/` | MIT |
| French word pack | `src/data/words.json` | CC BY-SA 4.0 |
| Curated word lists | `scripts/data/*` | CC BY-SA 4.0 |
| Built-in voice clips | `public/audio/`, `src/data/audio.json` | CC BY-SA 4.0 (voice trained on CC BY 4.0 data) |
| ts-fsrs (bundled library) | compiled into the extension | MIT |
| WXT runtime helpers (bundled) | compiled into the extension | MIT |

## Bundled code

### ts-fsrs 5.4.2
- Spaced-repetition scheduler (FSRS) used for word reviews.
- Copyright (c) 2026 Open Spaced Repetition. MIT License.
- https://github.com/open-spaced-repetition/ts-fsrs

### WXT 0.21.4 and @wxt-dev/browser 0.2.9
- The build framework adds small runtime helpers (the `browser` API shim and entrypoint wrappers) to the built extension.
- Copyright (c) 2023 Aaron Klinker. MIT License.
- https://github.com/wxt-dev/wxt

## Word data (CC BY-SA 4.0)

`src/data/words.json` (1,500 words) is a derivative work built by `scripts/build-wordlist.mjs`. It is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The hand-curated lists in `scripts/data/` (core vocabulary, overrides, emoji hints, h aspiré list and the kid-safety blocklist) are by 499Apps and released under CC BY-SA 4.0 with the pack. Changes from the sources: entries were selected, filtered, merged, corrected and re-glossed by hand.

Sources:

- **Lexique 3.83**, by Boris New, Christophe Pallier et al., http://www.lexique.org
  - License: CC BY-SA 4.0.
  - Used for lemmas, grammatical gender, plurals and word frequency.
  - Citation: New, B., Pallier, C., Brysbaert, M., Ferrand, L. (2004). Lexique 2: A New French Lexical Database. *Behavior Research Methods*, 36(3), 516–524.
- **Wiktionary**, by Wiktionary contributors, https://en.wiktionary.org
  - Extracted with [Wiktextract](https://github.com/tatuylonen/wiktextract) by Tatu Ylonen and distributed by [kaikki.org](https://kaikki.org/dictionary/French/).
  - License: Wiktionary text is dual-licensed under CC BY-SA 4.0 and the GNU FDL, and kaikki.org makes its data available under the same licenses. Petit Mot uses it under CC BY-SA 4.0. See https://en.wiktionary.org/wiki/Wiktionary:Copyrights.
  - Used for English meanings, IPA and example sentences.
  - Citation: Ylonen, T. (2022). Wiktextract: Wiktionary as Machine-Readable Structured Data. *LREC 2022*.
- **FrequencyWords (English, 2018)**, by Hermit Dave, https://github.com/hermitdave/FrequencyWords
  - License: CC BY-SA 4.0 for content (MIT for code). The lists are derived from OpenSubtitles.
  - Used only at build time to drop rare English meanings. No list content is shipped.
- **unicode-emoji-json 0.9.0**, by Mu-An Chiou, https://github.com/muan/unicode-emoji-json
  - License: MIT.
  - Used at build time to match emoji names to words.

## Built-in voice clips (CC BY-SA 4.0)

`public/audio/` holds about 1,800 Ogg Opus clips that read the word pack aloud. Because they are an adaptation of the CC BY-SA word pack, the clips are licensed under CC BY-SA 4.0. They were synthesized offline by `scripts/build-audio.mjs` with:

- **Piper voice `fr_FR-siwis-medium`**, from https://huggingface.co/rhasspy/piper-voices (revision c10ece1a).
  - [Model card](https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD): the voice was fine-tuned from the Piper U.S. English *lessac* voice on the dataset below.
  - Dataset license: CC BY 4.0.
  - The `license` field in `src/data/audio.json` gives this voice and dataset license.
- **The SIWIS French Speech Synthesis Database**, by Junichi Yamagishi, Pierre-Edouard Honnet, Philip N. Garner and Alexandros Lazaridis (2017). University of Edinburgh, The Centre for Speech Technology Research. https://doi.org/10.7488/ds/1705
  - License: CC BY 4.0. Its README says the data is "usable for any purpose, under the Creative Commons Attribution 4.0 International (CC BY 4.0) licence".
- **Piper text-to-speech** (release 2023.11.14-2), Copyright (c) 2022 Michael Hansen, https://github.com/rhasspy/piper
  - License: MIT.
  - Build tool only, not shipped. Its bundled espeak-ng phonemizer is GPL-3.0 and is also used only at build time, not shipped.

## Development-only tools (not shipped)

TypeScript, ESLint, typescript-eslint, Vitest, jsdom, @resvg/resvg-js (MPL-2.0) and WXT's build tooling are used to build and test the extension. None of them is included in the published extension apart from the WXT runtime helpers listed above. Their licenses are recorded in `package-lock.json`.
