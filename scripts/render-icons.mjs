// Renders the TidySky icon SVGs into the PNGs the web app and phones need.
// Run with: npm run icons
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const staticDir = join(root, 'static');
const outDir = join(staticDir, 'icons');

// The og card has text; resvg renders it with the machine's default sans
// font (resvg-js 2.6.2's rusttype can't load the repo's woff2: there is no
// Inter TTF in the repo to point `fontFiles` at). That's fine: the PNGs are
// committed artifacts, so the site always serves the same card; regenerating
// on another machine may shift the letterforms slightly.
//
// Note: resvg-js 2.6.2 has no `fontBuffers` option (it's not in the .d.ts).
// Passing one silently discards the entire options object, including fitTo.
//
// [source svg, output file, width in px]. The icon SVGs are 100×100 (width
// == height); og.svg is 1200×630.
const jobs = [
	['icon.svg', 'icon-192.png', 192],
	['icon.svg', 'icon-512.png', 512],
	['icon-maskable.svg', 'maskable-512.png', 512],
	// iOS rounds the corners itself, so the maskable (full-bleed) drawing is used.
	['icon-maskable.svg', 'apple-touch-icon.png', 180],
	// The favicon stays faceless on purpose: at tab size the face is speckles.
	['favicon.svg', 'favicon-32.png', 32],
	['og.svg', 'og.png', 1200]
];

mkdirSync(outDir, { recursive: true });

for (const [source, output, width] of jobs) {
	const svg = readFileSync(join(staticDir, source), 'utf8');
	const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
	writeFileSync(join(outDir, output), png);
	console.log(`rendered icons/${output} (${width}px)`);
}
