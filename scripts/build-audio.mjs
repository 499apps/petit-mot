#!/usr/bin/env node
/**
 * Builds the bundled "Petit Mot voice": one short Ogg Opus clip per word (with its article for
 * nouns, e.g. "le chien"), one per example sentence, and the Settings test phrase.
 *
 *   npm run audio            generate missing or changed clips (incremental)
 *   npm run audio -- --all   regenerate everything
 *
 * Offline text-to-speech with Piper (MIT, rhasspy/piper 2023.11.14-2) and the fr_FR "siwis"
 * medium voice (trained on the SIWIS French Speech Synthesis Database, CC BY 4.0). Both are
 * downloaded once into .cache/audio-tools at pinned versions and checked against SHA-256.
 * Needs ffmpeg with libopus on PATH. Linux x86_64 (the pinned Piper build).
 *
 * Outputs (committed, so building the extension never needs these tools):
 *   public/audio/w/<slug>.ogg, public/audio/e/<slug>.ogg, public/audio/test.ogg
 *   src/data/audio.json            id -> clip slug (+ whether an example clip exists); bundled
 *   scripts/data/audio-lock.json   the exact text and settings behind every clip; drives the
 *                                  incremental build and the staleness test
 * Piper's synthesis is slightly random, so a full rebuild sounds the same but isn't byte-identical.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache/audio-tools');
const OUT = path.join(ROOT, 'public/audio');
const MAP = path.join(ROOT, 'src/data/audio.json');
const LOCK = path.join(ROOT, 'scripts/data/audio-lock.json');
const ALL = process.argv.includes('--all');

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/fr/fr_FR/siwis/medium';
const TOOLS = {
  piper: { url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz', sha256: 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992', file: 'piper_linux_x86_64.tar.gz' },
  model: { url: `${HF}/fr_FR-siwis-medium.onnx`, sha256: '641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99', file: 'fr_FR-siwis-medium.onnx' },
  config: { url: `${HF}/fr_FR-siwis-medium.onnx.json`, sha256: '39479916c2db192b5ac9764daddd0c744d83e023ad890c6976c0633ae4df8959', file: 'fr_FR-siwis-medium.onnx.json' },
};
export const VOICE = { id: 'fr_FR-siwis-medium', engine: 'Piper 2023.11.14-2', license: 'CC BY 4.0', dataset: 'SIWIS French Speech Synthesis Database' };
// Slightly slower than Piper's default, for learners. Changing anything here regenerates every clip.
export const PARAMS = { word: { length_scale: 1.12 }, sentence: { length_scale: 1.05 }, noise_scale: 0.667, noise_w: 0.8, opus: '24k', rate: 24000, enc: 3 };
export const TEST_PHRASE = 'Bonjour ! Je m’appelle Petit Mot.';

/** Same rule as withArticle() in src/words.ts. */
export function withArticle(w) { return !w.art ? w.fr : w.art === "l'" ? `l'${w.fr}` : `${w.art} ${w.fr}`; }
/** What Piper reads. A full stop gives isolated words a natural, falling intonation. */
export const wordText = (w) => `${withArticle(w)}.`.replace(/’/g, "'");
export const sentenceText = (s) => s.replace(/’/g, "'");

export function slugs(ids) {
  const out = new Map(), used = new Set();
  for (const id of ids) {
    const base = id.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'w';
    let s = base;
    if (used.has(s)) s = `${base}-${createHash('sha1').update(id).digest('hex').slice(0, 6)}`;
    used.add(s); out.set(id, s);
  }
  return out;
}

const sha256 = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
async function fetchPinned({ url, sha256: want, file }) {
  const dest = path.join(CACHE, file);
  if (fs.existsSync(dest) && sha256(dest) === want) return dest;
  console.log(`downloading ${file}…`);
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', dest, url], { stdio: 'inherit' });
  const got = sha256(dest);
  if (got !== want) { fs.rmSync(dest); throw new Error(`${file}: SHA-256 ${got}, expected ${want}`); }
  return dest;
}
async function tools() {
  fs.mkdirSync(CACHE, { recursive: true });
  if (process.env.PIPER_BIN && process.env.PIPER_MODEL) return { bin: process.env.PIPER_BIN, model: process.env.PIPER_MODEL };
  const tar = await fetchPinned(TOOLS.piper);
  const model = await fetchPinned(TOOLS.model);
  await fetchPinned(TOOLS.config);
  const bin = path.join(CACHE, 'piper/piper');
  if (!fs.existsSync(bin)) execFileSync('tar', ['xzf', tar, '-C', CACHE]);
  return { bin, model };
}

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`))));
    if (input !== undefined) p.stdin.end(input); else p.stdin.end();
  });
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// Trim leading/trailing silence (gently, so soft endings like "-f" or "-s" survive), even out
// loudness, then Opus at 24 kb/s mono: clear for speech and about 3 KB per second.
const FILTER = 'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.08,areverse,loudnorm=I=-18:TP=-2:LRA=9,adelay=30|30';
const encode = (wav, ogg) => run('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-af', FILTER, '-ac', '1', '-ar', String(PARAMS.rate),
  '-c:a', 'libopus', '-b:a', PARAMS.opus, '-application', 'voip', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', ogg]);

async function main() {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/words.json'), 'utf8'));
  const slug = slugs(pack.words.map((w) => w.id));
  const respell = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/data/audio-respell.json'), 'utf8'));
  const spoken = (key, source) => respell[key] ?? source;
  const item = (key, file, source, kind) => ({ key, file, source, text: spoken(key, source), kind });
  const items = [item('test', 'test.ogg', sentenceText(TEST_PHRASE), 'sentence')];
  for (const w of pack.words) {
    items.push(item(`w:${w.id}`, `w/${slug.get(w.id)}.ogg`, wordText(w), 'word'));
    if (w.ex?.fr) items.push(item(`e:${w.id}`, `e/${slug.get(w.id)}.ogg`, sentenceText(w.ex.fr), 'sentence'));
  }
  for (const k of Object.keys(respell)) if (!k.startsWith('_') && !items.some((it) => it.key === k)) throw new Error(`audio-respell.json: unknown clip ${k}`);
  const old = fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : { clips: {} };
  const sig = (it) => createHash('sha256').update(JSON.stringify([VOICE.id, PARAMS, it.kind, it.text])).digest('hex').slice(0, 16);
  const todo = items.filter((it) => ALL || old.clips[it.key]?.sig !== sig(it) || !fs.existsSync(path.join(OUT, it.file)));
  console.log(`${items.length} clips, ${todo.length} to generate`);

  if (todo.length) {
    const { bin, model } = await tools();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-audio-'));
    fs.mkdirSync(path.join(OUT, 'w'), { recursive: true });
    fs.mkdirSync(path.join(OUT, 'e'), { recursive: true });
    for (const kind of ['word', 'sentence']) {
      const batch = todo.filter((it) => it.kind === kind);
      if (!batch.length) continue;
      const lines = batch.map((it, i) => JSON.stringify({ text: it.text, output_file: path.join(tmp, `${kind}-${i}.wav`) })).join('\n') + '\n';
      await run(bin, ['-m', model, '--json-input', '-q', '--length_scale', String(PARAMS[kind].length_scale),
        '--noise_scale', String(PARAMS.noise_scale), '--noise_w', String(PARAMS.noise_w)], lines);
      let n = 0;
      await pool(batch, os.cpus().length, async (it, i) => {
        await encode(path.join(tmp, `${kind}-${i}.wav`), path.join(OUT, it.file));
        if (++n % 250 === 0) console.log(`  ${kind}s: ${n}/${batch.length}`);
      });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Drop clips that no longer belong to any word.
  const keep = new Set(items.map((it) => it.file));
  for (const dir of ['w', 'e']) for (const f of fs.existsSync(path.join(OUT, dir)) ? fs.readdirSync(path.join(OUT, dir)) : []) if (!keep.has(`${dir}/${f}`)) fs.rmSync(path.join(OUT, dir, f));

  const clips = {};
  for (const it of items) clips[it.key] = { file: it.file, source: it.source, ...(it.text !== it.source ? { spoken: it.text } : {}), sig: sig(it), bytes: fs.statSync(path.join(OUT, it.file)).size };
  fs.writeFileSync(LOCK, JSON.stringify({ voice: VOICE, params: PARAMS, clips }, null, 1) + '\n');
  const map = {};
  for (const w of pack.words) map[w.id] = w.ex?.fr ? [slug.get(w.id), 1] : [slug.get(w.id)];
  fs.writeFileSync(MAP, JSON.stringify({ voice: VOICE.id, license: VOICE.license, clips: map }) + '\n');
  const total = Object.values(clips).reduce((a, c) => a + c.bytes, 0);
  console.log(`done: ${items.length} clips, ${(total / 1048576).toFixed(2)} MB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
