// Renders icons/icon.svg to the PNG sizes phones want (run once after changing the icon):
//   node pantry/tools/icons.mjs
// apple-touch-icon (180, opaque: iOS rounds the corners itself and ignores manifest icons), 192 and 512 for Android,
// and a maskable 512 with the symbol inside the central 80% safe zone on a solid background.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const square = svg.replace('rx="112"', 'rx="0"');
const b = await chromium.launch();
const p = await b.newPage();
for (const [name, size, pad, src, transparent] of [
  ['apple-touch-icon.png', 180, 0, square, false],
  ['icon-192.png', 192, 0, svg, true],
  ['icon-512.png', 512, 0, svg, true],
  ['icon-maskable-512.png', 512, 0.12, square, false],
]) {
  await p.setViewportSize({ width: size, height: size });
  const inner = size * (1 - 2 * pad);
  await p.setContent(`<style>html,body{margin:0;background:${transparent ? 'transparent' : '#3a6390'}}svg{display:block;width:${inner}px;height:${inner}px;margin:${size * pad}px}</style>${src}`);
  await p.screenshot({ path: join(dir, name), omitBackground: transparent });
}
await b.close();
