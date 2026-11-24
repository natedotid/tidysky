import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The text tokens must stay readable: WCAG AA needs 4.5:1 for normal text.
// The light theme is where the accent used to fail: #ffb86b on the cream
// background is about 1.8:1, which --color-accent-text fixes.
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

const TEXT_TOKENS = ['--color-text', '--color-text-muted', '--color-accent-text'];
const BG_TOKENS = ['--color-bg', '--color-surface'];

/** The custom properties of each :root theme block, keyed by selector. */
function themeBlocks(): Record<string, Record<string, string>> {
	const blocks: Record<string, Record<string, string>> = {};
	const re = /([^{}/]+)\{([^}]*)\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(css)) !== null) {
		const selector = m[1].trim();
		if (!selector.startsWith(':root')) continue;
		const props: Record<string, string> = {};
		for (const line of m[2].split('\n')) {
			const i = line.indexOf(':');
			if (i < 0) continue;
			const prop = line.slice(0, i).trim();
			const end = line.lastIndexOf(';');
			const value = line.slice(i + 1, end > i ? end : undefined).trim();
			if (prop.startsWith('--') && /^#[0-9a-f]{6}$/i.test(value)) {
				props[prop] = value.toLowerCase();
			}
		}
		blocks[selector] = props;
	}
	return blocks;
}

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
	const n = parseInt(hex.slice(1), 16);
	const chan = (c: number): number => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colors. */
function contrast(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('text token contrast (WCAG AA, 4.5:1)', () => {
	const blocks = themeBlocks();

	it('reads both theme blocks', () => {
		expect(Object.keys(blocks).sort()).toEqual([':root', ":root[data-theme='dark']"]);
	});

	for (const [selector, props] of Object.entries(blocks)) {
		it(`${selector}: every text token clears 4.5:1 on both backgrounds`, () => {
			const bad: string[] = [];
			for (const t of TEXT_TOKENS) {
				const fg = props[t];
				if (fg === undefined) {
					bad.push(`${t} is missing`);
					continue;
				}
				for (const bg of BG_TOKENS) {
					const bgc = props[bg];
					if (bgc === undefined) {
						bad.push(`${bg} is missing`);
						continue;
					}
					const c = contrast(fg, bgc);
					if (c < 4.5) bad.push(`${t} on ${bg} is ${c.toFixed(2)}:1`);
				}
			}
			expect(bad).toEqual([]);
		});
	}
});
