// Renders public/icon/{16,32,48,128}.png from the SVG masters with resvg.
// Each size renders at its native size (never upscaled); 16px uses its own hinted SVG.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SIZES = { 16: 'icon-16.svg', 32: 'icon-128.svg', 48: 'icon-128.svg', 128: 'icon-128.svg' };
const outDir = process.argv[2] ?? 'public/icon';
const srcDir = process.argv[3] ?? 'assets/icon';
mkdirSync(outDir, { recursive: true });
for (const [size, file] of Object.entries(SIZES)) {
  const svg = readFileSync(`${srcDir}/${file}`, 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: Number(size) }, shapeRendering: 2 }).render().asPng();
  writeFileSync(`${outDir}/${size}.png`, png);
  console.log(`${outDir}/${size}.png`);
}
