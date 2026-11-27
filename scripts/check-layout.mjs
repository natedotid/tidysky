// Layout regression check: at 360 and 390 px wide, no page may scroll
// horizontally. Catches the "card grows wider than the screen" class of bug
// (long names, charts) that the unit tests cannot see.
//
// Builds, serves the build with `vite preview`, then walks every page at both
// widths: scroll to the bottom in one-viewport steps (so lazy charts render),
// wait, scroll back to the top, and check documentElement.scrollWidth <=
// window.innerWidth.
//
// It also checks the spacing between stacked cards on every page that has
// two or more (the .cards grids and the pages that stack section.card
// directly in .page): each gap must be at least the Insights gap.
//
// It also checks that the "Since your last scan" chips (Insights) all match
// in height, font size and font weight: the unfollowed-elsewhere button chip
// must look exactly like the link chips.
//
// It also checks that cards with both a footnote and an action link wrap
// without squeezing: the footnote keeps at least 60% of the card's inner
// width or sits on a line of its own above the action.
//
// It also checks that the You tab's top-post lines are at most 121 chars
// (120 cut + the ellipsis), and that a 121-char line ends in the ellipsis:
// long post and alt text must be visibly shortened, never hard-cut
// silently.
//
// It also checks that the You tab's "Who follows you" card takes the
// complete-sample wording: the demo's follower sample is complete, so the
// card must say "all" even though the demo profile's follower count is
// far above the sample size (the old count rule would have said "newest").
//
// It also checks the Clean up rows (with interactions present, preset and
// plain): every row renders its name, stats and "You:" lines without an
// element extending past the row's bottom edge, rows do not overlap, and at
// least one row shows the "You:" line (so the three-line case is covered).
//
// And at 390 px it checks the rows give names and stats room: the text
// column keeps at least 60% of the row's width, the demo row whose stats
// say "0.2/day" shows the rate in full, not cut off mid-number; and the
// name keeps priority over the handle -- when the name ellipsizes, the
// handle is down to zero width -- with the secondary lines smaller than
// the name.
//
// It also opens the profile preview from Clean up's first row (demo mode,
// one-way preset), phone-like (touch, like the close-behavior checks): no
// horizontal overflow, focus lands on the sheet's title, and closing returns
// focus to the row's name button; the Mix row sits on its own full-width
// line under its label, wrapping only between items. Run in light and dark,
// at the phone widths (360 and 390) and the desktop width (1280), in both
// browsers.
//
// It also opens the bottom sheets and checks them:
// - presets and unfollowed-elsewhere, open, at 360 and 390 px: no horizontal
//   overflow, every row fits the sheet and is fully visible or reachable by
//   scrolling inside it, the Close button is visible, no CSP violations;
//   in the presets sheet every row's name and blurb start at the row's left
//   content edge (within 1 px) -- Safari centers a grid button's content,
//   which this catches;
// - every sheet, right after it opens: focus is on the sheet's title (h2),
//   not on Close -- showModal would focus the first focusable element, and
//   Safari draws a focus ring on it;
// - add-filter, presets and unfollowed-elsewhere at 390 px with touch
//   (hasTouch + isMobile): each closes on its Close button (focus back on the
//   opener), on a tap on the backdrop above the sheet, and stays open on a
//   tap inside the sheet away from any button.
//
// It also drives Clean up's keyboard shortcuts on a fine-pointer (desktop)
// context at 1280 px: j focuses the first row's preview button, x selects it
// and the selection bar appears, Enter opens the preview and Escape closes
// it with focus back on that row, and ? opens the shortcuts sheet; on a
// touch (coarse-pointer) context the "Keyboard shortcuts" button next to the
// Sort control is hidden at 390 px.
//
// It also checks the You tab's "When you post" card with the demo's own feed
// shortened to 30 items (?demoFeed=30): under the 50-item minimum the card
// must draw the 24-column hour chart, not the weekday grid, with a "Busiest
// around" takeaway and a "From your last 30 posts and reposts" footnote.
// Chromium only.
//
// It also checks every hour chart's tick labels at 360, 390 and 1280 px, in
// both browsers: each label's box must sit inside the chart's box, so the
// first label (and a last-column one, if there were one) is never clipped.
// One demo scan per browser; the viewport is resized in place afterwards.
//
// The sheet, row and keyboard checks run in both Chromium and WebKit (the
// WebKit run is the one that models Safari); WebKit also gets the
// close-behavior suite.
// Chromium-only launch flags fix its background-timer throttling and are not
// passed to WebKit.
//
// On failure it prints the page, width and the offending elements, and exits
// non-zero.
//
// Not part of the per-commit gate (it is slow); run it before a release.

import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4173;
const BASE = `http://${HOST}:${PORT}`;
const HEIGHT = 844;
const WIDTHS = [360, 390];
const DEMO_TIMEOUT = 180_000;
// All three sheets live in the DOM at once (closed); select the open one.
const DIALOG = 'dialog.sheet[open]';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = `${__dirname}..`;

// Each entry: the URL, whether it runs the demo scan (?demo=1), and an
// optional predicate on the body text that says the demo scan has finished.
const PAGES = [
	{ url: '/' },
	{
		url: '/insights?demo=1',
		demo: true,
		done: /Last scanned/,
		// Check the You tab too; it has its own cards and charts.
		youTab: true
	},
	{ url: '/cleanup?demo=1', demo: true, done: /scanned (just now|\d+ minute)/ },
	{ url: '/cleanup?demo=1&preset=oneWay', demo: true, done: /scanned (just now|\d+ minute)/ },
	{ url: '/lists?demo=1', demo: true },
	{ url: '/settings?demo=1', demo: true, done: /Last scanned/ },
	{ url: '/methodology' },
	{ url: '/privacy' },
	// The not-found page: an unknown URL, rendered client-side by the SPA
	// fallback. Checked in both browsers (see runSheetRowsWidth too).
	{ url: '/this-page-does-not-exist' }
];

// The pages the two layout-checked sheets live on.
const CLEANUP = { url: '/cleanup?demo=1', demo: true, done: /scanned (just now|\d+ minute)/ };
// The preview check needs a page with rows: the one-way preset.
const PREVIEW = {
	url: '/cleanup?demo=1&preset=oneWay',
	demo: true,
	done: /scanned (just now|\d+ minute)/
};
const INSIGHTS = { url: '/insights?demo=1', demo: true, done: /Last scanned/ };
// The under-50 "when you post" hour chart: the demo's own feed shortened
// with ?demoFeed=30 (the default demo feed has ~300 items, the grid path).
const SHORT_FEED = { url: '/insights?demo=1&demoFeed=30', demo: true, done: /Last scanned/ };
// The only pages with follow rows: the WebKit run walks just these.
const CLEANUP_PAGES = PAGES.filter((e) => e.url.startsWith('/cleanup'));

// CSP violations arrive as console messages, not page errors.
const cspViolations = [];
function watchConsole(page) {
	page.on('console', (msg) => {
		if (/content security policy/i.test(msg.text())) cspViolations.push(msg.text());
	});
}

function log(...args) {
	console.log('[check:layout]', ...args);
}

/** Log one check; false fails the run. */
function report(check, ok, detail = '') {
	if (ok) log(`ok   ${check}`);
	else {
		log(`FAIL ${check}`);
		if (detail !== '') log(`   ${detail}`);
	}
	return ok;
}

async function startPreview() {
	// Spawn vite directly (not via npx) so there is exactly one child process
	// to kill.
	const child = spawn(
		process.execPath,
		[
			'node_modules/vite/bin/vite.js',
			'preview',
			'--host',
			HOST,
			'--port',
			String(PORT),
			'--strictPort'
		],
		{ cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
	);
	let output = '';
	let exitCode = null;
	child.stdout.on('data', (d) => (output += d));
	child.stderr.on('data', (d) => (output += d));
	child.on('exit', (code) => (exitCode = code));
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		// The child dying early means the port is taken (a stray preview):
		// fail now instead of checking against the stale server.
		if (exitCode !== null) {
			throw new Error(`vite preview exited early (code ${exitCode}):\n${output}`);
		}
		try {
			const res = await fetch(`${BASE}/`);
			if (res.status < 500) return child;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	child.kill('SIGTERM');
	throw new Error(`vite preview did not start in 30 s:\n${output}`);
}

/** Load a page and wait for the first demo scan to finish. */
async function settle(page, entry) {
	await page.goto(`${BASE}${entry.url}`, { waitUntil: 'load' });
	if (entry.demo) {
		if (entry.done !== undefined) {
			await page.waitForFunction(
				(re) => new RegExp(re).test(document.body.innerText),
				entry.done.source,
				{ timeout: DEMO_TIMEOUT }
			);
		} else {
			// No completion text on this page. The first demo page in a context
			// runs the whole scan; by the time we get here it is stored, so a
			// short settle is enough.
			await page.waitForTimeout(750);
		}
	}
}

async function scrollThrough(page) {
	// One-viewport steps so every IntersectionObserver-gated chart mounts.
	await page.evaluate(async () => {
		const step = window.innerHeight;
		for (let y = 0; y <= document.body.scrollHeight; y += step) {
			window.scrollTo(0, y);
			await new Promise((r) => setTimeout(r, 120));
		}
		window.scrollTo(0, document.body.scrollHeight);
		await new Promise((r) => setTimeout(r, 500));
	});
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.waitForTimeout(200);
}

async function measure(page) {
	return page.evaluate(() => {
		const inner = window.innerWidth;
		const out = [];
		for (const el of document.querySelectorAll('body *')) {
			const r = el.getBoundingClientRect();
			if (r.right > inner + 1) {
				const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
				out.push(
					`<${el.tagName.toLowerCase()}${cls ? ` .${cls}` : ''}> right=${Math.round(r.right)} "${(el.textContent ?? '').trim().slice(0, 50)}"`
				);
				if (out.length >= 5) break;
			}
		}
		return { inner, scrollWidth: document.documentElement.scrollWidth, out };
	});
}

async function checkTab(page, label, entry) {
	await settle(page, entry);
	await scrollThrough(page);
	const m = await measure(page);
	if (m.scrollWidth > m.inner) {
		log(`FAIL ${label} @ ${m.inner}px: scrollWidth=${m.scrollWidth}`);
		for (const line of m.out) log(`   ${line}`);
		return false;
	}
	log(`ok   ${label} @ ${m.inner}px`);
	return true;
}

// The gap Insights uses between stacked cards (.cards grid); the first page
// with a .cards grid sets it, and every page's card gaps must match it.
let cardGapRef = null;

/**
 * Cards that share a parent (the .cards grids, and the pages that stack
 * section.card directly in .page) must be spaced at least the Insights gap.
 * The page must be scrolled through first, so lazy charts are mounted.
 */
async function checkCardGaps(page, width, label) {
	const m = await page.evaluate(() => {
		const byParent = new Map();
		for (const card of document.querySelectorAll('.card')) {
			const p = card.parentElement;
			if (!byParent.has(p)) byParent.set(p, []);
			byParent.get(p).push(card);
		}
		const gaps = [];
		for (const cards of byParent.values()) {
			if (cards.length < 2) continue;
			for (let i = 1; i < cards.length; i++) {
				const a = cards[i - 1].getBoundingClientRect();
				const b = cards[i].getBoundingClientRect();
				gaps.push(Math.round((b.top - a.bottom) * 100) / 100);
			}
		}
		const grid = document.querySelector('.cards');
		const g = grid !== null ? parseFloat(getComputedStyle(grid).rowGap) : NaN;
		return { count: gaps.length, gaps, gridGap: Number.isFinite(g) ? g : null };
	});
	if (m.count === 0) return true; // no stacked cards on this page
	if (cardGapRef === null) cardGapRef = m.gridGap ?? Math.min(...m.gaps);
	const bad = m.gaps.map((g, i) => ({ g, i })).filter(({ g }) => g < cardGapRef - 0.5);
	return report(
		`${label} @ ${width}px: ${m.count} card gaps >= ${Math.round(cardGapRef)}px (Insights)`,
		bad.length === 0,
		bad.map(({ g, i }) => `gap after card ${i} is ${g}px`).join('; ')
	);
}

/**
 * The "Since your last scan" chips: the button chip (unfollowed elsewhere)
 * must look exactly like the link chips, so every chip in the row has the
 * same height (within 1 px), font size and font weight.
 */
async function checkChipConsistency(page, width, label) {
	const m = await page.evaluate(() => {
		const out = [...document.querySelectorAll('.since .chips .chip')].map((c) => {
			const cs = getComputedStyle(c);
			return { h: c.getBoundingClientRect().height, fs: cs.fontSize, fw: cs.fontWeight };
		});
		return { count: out.length, out };
	});
	if (m.count < 2) return true; // no chip row on this page
	const hs = m.out.map((c) => c.h);
	const fs = [...new Set(m.out.map((c) => c.fs))];
	const fw = [...new Set(m.out.map((c) => c.fw))];
	const ok = Math.max(...hs) - Math.min(...hs) <= 1 && fs.length === 1 && fw.length === 1;
	return report(
		`${label} @ ${width}px: ${m.count} chips match (${Math.round(Math.max(...hs))}px, ${fs[0]}/${fw[0]})`,
		ok,
		`heights ${m.out.map((c) => Math.round(c.h)).join('/')}px, font sizes ${fs.join('/')}, weights ${fw.join('/')}`
	);
}

/**
 * Cards with both a footnote and an action link: the footnote must not be
 * squeezed by the link, so it keeps at least 60% of the card's inner width
 * or sits on a line of its own above the action.
 */
async function checkCardFootnotes(page, width, label) {
	const m = await page.evaluate(() =>
		[...document.querySelectorAll('.card .bottom')].flatMap((bottom) => {
			const footnote = bottom.querySelector('.footnote');
			const action = bottom.querySelector('.card-action');
			if (footnote === null || action === null) return [];
			const f = footnote.getBoundingClientRect();
			const a = action.getBoundingClientRect();
			return [{ width: f.width, inner: bottom.clientWidth, ownLine: a.top >= f.bottom - 1 }];
		})
	);
	if (m.length === 0) return true; // no footnote+action card on this page
	const bad = m.filter((c) => c.width < c.inner * 0.6 && !c.ownLine);
	return report(
		`${label} @ ${width}px: ${m.length} footnote+action cards wrap without squeezing`,
		bad.length === 0,
		bad
			.map((c) => `footnote ${Math.round(c.width)}px of ${Math.round(c.inner)}px, shared line`)
			.join('; ')
	);
}

async function checkTopPosts(page, width, label) {
	const m = await page.evaluate(() =>
		[...document.querySelectorAll('.toppost .txt')].map((t) => ({
			len: t.textContent?.length ?? 0,
			tail: t.textContent?.slice(-1) ?? ''
		}))
	);
	if (m.length === 0) return true; // no top posts on this page
	const bad = m.filter((t) => t.len > 121 || (t.len === 121 && t.tail !== '…'));
	return report(
		`${label} @ ${width}px: ${m.length} top-post lines cut at 120 chars`,
		bad.length === 0,
		bad.map((t) => `line of ${t.len} chars ends in ${JSON.stringify(t.tail)}`).join('; ')
	);
}

async function checkFollowerCard(page, width, label) {
	const m = await page.evaluate(() => {
		const card = [...document.querySelectorAll('.card')].find((c) =>
			(c.querySelector('h2')?.textContent ?? '').startsWith('Who follows you')
		);
		if (card === undefined) return null;
		return {
			title: card.querySelector('h2')?.textContent ?? '',
			footnote: card.querySelector('.footnote')?.textContent ?? ''
		};
	});
	if (m === null) return true; // no follower card on this page
	// Complete sample: the title must not carry the "(newest N)" suffix and
	// the footnote must take the "all of your followers" wording.
	const ok = !m.title.includes('newest') && /^All \d+ of your followers\./.test(m.footnote);
	return report(
		`${label} @ ${width}px: follower card uses the complete-sample wording`,
		ok,
		`title "${m.title}", footnote "${m.footnote.slice(0, 50)}"`
	);
}

/**
 * "Who you interact with": both tabs show rows (Most: bare counts,
 * Least: posts/day), the page doesn't overflow, and a name longer than its
 * line ellipsizes instead of pushing the row wider. The page must be settled
 * and on the Following tab.
 */
async function checkInteractionCard(page, width, label) {
	const card = page.locator('.card').filter({
		has: page.locator('h2', { hasText: 'Who you interact with' })
	});
	if ((await card.count()) !== 1) {
		return report(
			`${label} @ ${width}px: "Who you interact with" card present`,
			false,
			`found ${await card.count()}`
		);
	}
	let okAll = true;
	for (const tab of ['Most', 'Least']) {
		const btn = card.locator('.tabs button', { hasText: tab, exact: true });
		await btn.scrollIntoViewIfNeeded();
		await btn.click();
		const m = await card.evaluate(async (c) => {
			// RankList mounts its rows when it enters the viewport
			// (IntersectionObserver); give it a moment after the tab switch.
			const t0 = Date.now();
			while (c.querySelectorAll('.rank-list a.row').length === 0 && Date.now() - t0 < 3000) {
				await new Promise((r) => setTimeout(r, 100));
			}
			const vals = [...c.querySelectorAll('.rank-list .val')].map((v) => v.textContent ?? '');
			const names = [...c.querySelectorAll('.rank-list .name')].map((n) => {
				const cs = getComputedStyle(n);
				return n.scrollWidth > n.clientWidth
					? cs.textOverflow === 'ellipsis' && cs.overflowX === 'hidden'
					: true;
			});
			return {
				rows: c.querySelectorAll('.rank-list a.row').length,
				vals,
				badNames: names.filter((ok) => !ok).length
			};
		});
		const shapeOk =
			tab === 'Least'
				? m.vals.length > 0 && m.vals.every((v) => v.endsWith('/day'))
				: m.vals.length > 0 && m.vals.every((v) => !v.endsWith('/day'));
		const pressed = (await btn.getAttribute('aria-pressed')) === 'true';
		const m2 = await page.evaluate(() => ({
			sw: document.documentElement.scrollWidth,
			inner: window.innerWidth
		}));
		const ok = m.rows > 0 && shapeOk && pressed && m.badNames === 0 && m2.sw <= m2.inner;
		if (
			!report(
				`${label} @ ${width}px: "Who you interact with" ${tab} tab: ${m.rows} rows, no overflow, long names ellipsize`,
				ok,
				`rows=${m.rows}; value shape ${shapeOk}; aria-pressed ${pressed}; bad names ${m.badNames}; scrollWidth ${m2.sw} of ${m2.inner}`
			)
		)
			okAll = false;
	}
	return okAll;
}

async function checkRowsFit(page, width, label) {
	const m = await page.evaluate(() => {
		// FollowRow rows are the only .rows with both a check label and a
		// keep button; sheets and charts also use .row. Zero-height rows
		// (closed sheets) are skipped.
		const rows = [...document.querySelectorAll('.row')]
			.filter(
				(r) =>
					r.querySelector('label.check') !== null &&
					r.querySelector('button.keep') !== null &&
					r.getBoundingClientRect().height > 0
			)
			.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
		if (rows.length === 0) return null;
		let youLines = 0;
		const problems = [];
		for (let i = 0; i < rows.length; i += 1) {
			const r = rows[i];
			const rr = r.getBoundingClientRect();
			if (r.querySelector('.you') !== null) youLines += 1;
			for (const el of r.querySelectorAll('*')) {
				const e = el.getBoundingClientRect();
				if (e.height === 0) continue;
				const past = e.bottom - rr.bottom;
				if (past > 0.5) {
					problems.push(
						`row ${i}: <${el.tagName.toLowerCase()}${
							typeof el.className === 'string' && el.className !== ''
								? `.${el.className.split(' ')[0]}`
								: ''
						}> extends ${Math.round(past)}px past the row bottom`
					);
				}
			}
			if (i > 0) {
				const prev = rows[i - 1].getBoundingClientRect();
				const overlap = prev.bottom - rr.top;
				if (overlap > 0.5)
					problems.push(`row ${i} overlaps row ${i - 1} by ${Math.round(overlap)}px`);
			}
		}
		return { count: rows.length, youLines, problems };
	});
	if (m === null) return true; // no follow rows on this page
	const ok = m.youLines > 0 && m.problems.length === 0;
	return report(
		`${label} @ ${width}px: ${m.count} rows fit their content (${m.youLines} with a You line)`,
		ok,
		m.youLines === 0
			? 'no row shows a You line; interactions missing from the demo?'
			: m.problems.slice(0, 3).join('; ')
	);
}

async function checkRowsRoom(page, width, label) {
	const m = await page.evaluate(() => {
		const rows = [...document.querySelectorAll('.row')].filter(
			(r) =>
				r.querySelector('label.check') !== null &&
				r.querySelector('button.keep') !== null &&
				r.getBoundingClientRect().height > 0
		);
		if (rows.length === 0) return null;
		let minRatio = Infinity;
		let rateRow = null;
		for (const r of rows) {
			const rw = r.getBoundingClientRect().width;
			const tw = r.querySelector('.text').getBoundingClientRect().width;
			minRatio = Math.min(minRatio, tw / rw);
			// The demo has exactly one row whose stats say "0.2/day"; the
			// rate is fully visible when the line up to and including it
			// fits the element's content width.
			const meta = r.querySelector('.meta');
			const text = meta.textContent ?? '';
			const i = text.indexOf('0.2/day');
			if (i >= 0 && rateRow === null) {
				const range = document.createRange();
				range.setStart(meta.firstChild, 0);
				range.setEnd(meta.firstChild, i + '0.2/day'.length);
				const w = range.getBoundingClientRect().width;
				rateRow = { w, cw: meta.clientWidth };
			}
		}
		return { count: rows.length, minRatio, rateRow };
	});
	if (m === null) return true; // no follow rows on this page
	const ok = m.minRatio >= 0.6 && m.rateRow !== null && m.rateRow.w <= m.rateRow.cw + 0.5;
	const detail = [
		`text column ${Math.round(m.minRatio * 100)}% of row width (min)`,
		m.rateRow === null
			? 'no row shows 0.2/day'
			: m.rateRow.w <= m.rateRow.cw + 0.5
				? '0.2/day fully visible'
				: `0.2/day clipped (${Math.round(m.rateRow.w)}px of ${Math.round(m.rateRow.cw)}px)`
	].join('; ');
	return report(`${label} @ ${width}px: rows give names and stats room`, ok, detail);
}

/**
 * Name priority in the Clean up rows: the name is inflexible, so when it
 * ellipsizes it has taken the whole line and the handle must be down to
 * zero width; the secondary lines must be smaller than the name.
 */
async function checkRowNamePriority(page, width, label) {
	const m = await page.evaluate(() => {
		const rows = [...document.querySelectorAll('.row')].filter(
			(r) =>
				r.querySelector('label.check') !== null &&
				r.querySelector('button.keep') !== null &&
				r.getBoundingClientRect().height > 0
		);
		if (rows.length === 0) return null;
		let fontOk = true;
		let truncated = 0;
		const problems = [];
		for (const r of rows) {
			const name = r.querySelector('.name');
			const handle = r.querySelector('.handle');
			const meta = r.querySelector('.meta');
			const nameFs = parseFloat(getComputedStyle(name).fontSize);
			const metaFs = parseFloat(getComputedStyle(meta).fontSize);
			if (!(metaFs < nameFs)) fontOk = false;
			if (name.scrollWidth > name.clientWidth) {
				truncated += 1;
				if (handle !== null && handle.getBoundingClientRect().width > 0.5) {
					problems.push(
						`"${(name.textContent ?? '').slice(0, 20)}": name truncated but handle is ${Math.round(
							handle.getBoundingClientRect().width
						)}px wide`
					);
				}
			}
		}
		return { count: rows.length, truncated, fontOk, problems };
	});
	if (m === null) return true; // no follow rows on this page
	return report(
		`${label} @ ${width}px: ${m.count} rows keep name priority (${m.truncated} truncated name${
			m.truncated === 1 ? '' : 's'
		}; meta smaller than name: ${m.fontOk})`,
		m.fontOk && m.problems.length === 0,
		m.problems.slice(0, 3).join('; ')
	);
}

async function sheetWaitOpen(page) {
	try {
		await page.waitForFunction(
			(sel) => {
				const d = document.querySelector(sel);
				return d !== null && d.open;
			},
			DIALOG,
			{ timeout: 10_000 }
		);
	} catch {
		return false;
	}
	// Let the 180 ms entrance animation settle before measuring.
	await page.waitForTimeout(250);
	return true;
}

async function sheetWaitClosed(page) {
	try {
		await page.waitForFunction(
			(sel) => {
				const d = document.querySelector(sel);
				return d === null || !d.open;
			},
			DIALOG,
			{ timeout: 10_000 }
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * The open sheet's title holds focus: showModal() would focus the first
 * focusable element (Close, which Safari draws a focus ring on), but the
 * h2 carries tabindex -1 + autofocus, so document.activeElement must be it.
 */
async function sheetFocusOnTitle(page) {
	return page.evaluate((sel) => {
		const d = document.querySelector(sel);
		const ae = document.activeElement;
		return ae instanceof HTMLElement && ae.tagName === 'H2' && d !== null && d.contains(ae);
	}, DIALOG);
}

/**
 * Open one sheet on its page and check it at this width: no horizontal
 * overflow, every row fits the sheet and is visible or reachable by scrolling
 * inside the sheet, the Close button is visible, no CSP violations. With
 * checkAlign, every row's .name and .blurb must start at the row's left
 * content edge (within 1 px): Safari centers a grid button's content block,
 * and this is the check that catches it.
 */
async function checkSheetOpen(
	page,
	width,
	entry,
	label,
	openOpener,
	rowSel,
	waitRows,
	checkAlign = false
) {
	await settle(page, entry);
	await openOpener();
	await sheetWaitOpen(page);
	if (waitRows) await page.waitForSelector(`${DIALOG} ${waitRows}`, { timeout: 10_000 });

	const m = await page.evaluate(
		({ sel, align }) => {
			const dialog = document.querySelector('dialog.sheet[open]');
			const d = dialog.getBoundingClientRect();
			const docOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
			const rows = [...document.querySelectorAll(`dialog.sheet[open] ${sel}`)];
			const issues = [];
			const misaligned = [];
			for (const row of rows) {
				let r = row.getBoundingClientRect();
				if (r.left < d.left - 1 || r.right > d.right + 1) {
					issues.push(
						`row outside sheet (${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(d.left)}..${Math.round(d.right)})`
					);
					continue;
				}
				// Reachable by scrolling inside the sheet: scroll the dialog until
				// the row sits in its box, then it must be fully visible.
				if (r.top < d.top) dialog.scrollTop -= d.top - r.top + 4;
				if (r.bottom > d.bottom) dialog.scrollTop += r.bottom - d.bottom + 4;
				r = row.getBoundingClientRect();
				if (r.top < d.top - 1 || r.bottom > d.bottom + 1) issues.push('row not reachable');
			}
			if (align) {
				for (const row of rows) {
					const rr = row.getBoundingClientRect();
					const contentLeft = rr.left + parseFloat(getComputedStyle(row).paddingLeft);
					for (const cls of ['.name', '.blurb']) {
						const el = row.querySelector(cls);
						if (el === null) continue;
						const left = el.getBoundingClientRect().left;
						if (Math.abs(left - contentLeft) > 1) {
							misaligned.push(
								`${cls} at ${left.toFixed(1)}px, content box at ${contentLeft.toFixed(1)}px`
							);
						}
					}
				}
			}
			return { docOverflow, rowCount: rows.length, issues, misaligned };
		},
		{ sel: rowSel, align: checkAlign }
	);

	// Right after open, before anything else is clicked.
	const titleFocused = await sheetFocusOnTitle(page);

	const closeBox = await page.getByRole('button', { name: 'Close' }).boundingBox();
	const closeVisible =
		closeBox !== null &&
		closeBox.x >= -1 &&
		closeBox.y >= -1 &&
		closeBox.x + closeBox.width <= width + 1 &&
		closeBox.y + closeBox.height <= HEIGHT + 1;

	const cspBefore = cspViolations.length;
	await page.getByRole('button', { name: 'Close' }).click();
	const closed = await sheetWaitClosed(page);
	const cspNew = cspViolations.length - cspBefore;

	let pass = report(`${label} open: no horizontal overflow @ ${width}px`, !m.docOverflow);
	pass =
		report(
			`${label} open: ${m.rowCount} rows fit and are reachable @ ${width}px`,
			m.rowCount > 0 && m.issues.length === 0,
			m.rowCount === 0 ? 'no rows found' : m.issues.join('; ')
		) && pass;
	pass = report(`${label} open: Close button visible @ ${width}px`, closeVisible) && pass;
	pass =
		report(`${label} open: focus is on the title, not Close @ ${width}px`, titleFocused) && pass;
	pass = report(`${label} open: no CSP violations @ ${width}px`, cspNew === 0) && pass;
	pass = report(`${label} open: closes on Close @ ${width}px`, closed) && pass;
	if (checkAlign) {
		pass =
			report(
				`${label} open: every row's name and blurb start at the row's left edge @ ${width}px`,
				m.misaligned.length === 0,
				m.misaligned.slice(0, 3).join('; ')
			) && pass;
	}
	return pass;
}

/**
 * The chip edit sheet, on Clean up: add "No interaction in 12
 * months", open its edit sheet, pick 3 months, and both the chip's wording
 * and the result count update in place. Same overflow and Close checks as
 * the other sheets.
 */
async function checkEditSheet(page, width) {
	const label = 'filter edit sheet';
	await settle(page, CLEANUP);

	// Add the 12-month no-interaction filter.
	await page.getByRole('button', { name: '+ Add filter' }).click();
	await sheetWaitOpen(page);
	await page.getByRole('button', { name: 'No interaction in 12 months', exact: true }).click();
	await sheetWaitClosed(page);

	const countOf = () =>
		page
			.locator('.result')
			.innerText()
			.then((t) => Number(t.match(/\d+/)?.[0] ?? -1));
	const before = await countOf();
	if (before < 0) {
		return report(`${label} @ ${width}px: no-interaction filter added`, false, 'no result count');
	}

	// Open the chip's edit sheet via its aria label.
	await page.getByRole('button', { name: 'Edit filter: No interaction in 12 months' }).click();
	await sheetWaitOpen(page);

	const title = await page.locator(`${DIALOG} h2`).innerText();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth + 1
	);
	const closeBox = await page.getByRole('button', { name: 'Close' }).boundingBox();
	const closeVisible =
		closeBox !== null &&
		closeBox.x >= -1 &&
		closeBox.y >= -1 &&
		closeBox.x + closeBox.width <= width + 1 &&
		closeBox.y + closeBox.height <= HEIGHT + 1;

	let pass = report(
		`${label} open: title is the chip's wording @ ${width}px`,
		title === 'No interaction in 12 months',
		`title was "${title}"`
	);
	pass = report(`${label} open: no horizontal overflow @ ${width}px`, !overflow) && pass;
	pass = report(`${label} open: Close button visible @ ${width}px`, closeVisible) && pass;

	// Pick 3 months: chip wording and result count both change in place.
	await page.getByRole('button', { name: 'No interaction in 3 months', exact: true }).click();
	await page.waitForTimeout(150);
	const titleNow = await page.locator(`${DIALOG} h2`).innerText();
	const chipNow = await page
		.getByRole('button', { name: 'Edit filter: No interaction in 3 months' })
		.count();
	const after = await countOf();
	pass =
		report(
			`${label}: picking 3 months updates the chip @ ${width}px`,
			chipNow === 1 && titleNow === 'No interaction in 3 months',
			`chip count ${chipNow}, title "${titleNow}"`
		) && pass;
	pass =
		report(
			`${label}: picking 3 months changes the result count @ ${width}px`,
			after > before,
			`${before} -> ${after}`
		) && pass;

	await page.getByRole('button', { name: 'Close' }).click();
	pass = report(`${label}: closes on Close @ ${width}px`, await sheetWaitClosed(page)) && pass;
	return pass;
}

/**
 * The profile preview, from Clean up's first row: the row's name button
 * opens the sheet, no horizontal overflow, focus is on the sheet's title,
 * and closing returns focus to the opener.
 */
async function checkPreview(page, width, label) {
	await settle(page, PREVIEW);
	const opener = page.getByRole('button', { name: /^Preview / }).first();
	await opener.scrollIntoViewIfNeeded();
	// Mark the opener so the focus-restore check can find it by attribute
	// (its text content is the whole row, not a stable string). A headless
	// WebKit tap neither focuses the tapped button nor restores focus on
	// close (a real phone does), so focus the opener first; the sheet's
	// remembered-opener restore then models the phone on both engines.
	await opener.evaluate((el) => {
		el.setAttribute('data-preview-opener', '');
		el.focus();
	});
	await opener.tap();
	await sheetWaitOpen(page);

	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth + 1
	);
	const titleFocused = await sheetFocusOnTitle(page);
	// The mix row (oneWay rows always carry a sample): on its own line under
	// the label, full width, wrapping only between items.
	const mix = await page.evaluate(() => {
		const fact = document.querySelector('dialog.sheet[open] .fact.mix');
		if (fact === null) return null;
		const dt = fact.querySelector('dt');
		const dd = fact.querySelector('dd');
		const parts = Array.from(dd.querySelectorAll('.mix-part'));
		const ddBox = dd.getBoundingClientRect();
		const listBox = fact.closest('.facts').getBoundingClientRect();
		return {
			ownLine: ddBox.top >= dt.getBoundingClientRect().bottom - 1,
			fullWidth: Math.abs(ddBox.width - listBox.width) < 2,
			itemsIntact:
				parts.length > 0 &&
				parts.every(
					(p) => p.scrollWidth <= p.clientWidth + 1 && p.scrollHeight <= p.clientHeight + 1
				),
			noHOverflow: dd.scrollWidth <= dd.clientWidth + 1
		};
	});
	const cspBefore = cspViolations.length;
	await page.getByRole('button', { name: 'Close' }).tap();
	const closed = await sheetWaitClosed(page);
	const cspNew = cspViolations.length - cspBefore;
	const focusBack = await page.evaluate(() => {
		const el = document.activeElement;
		return el instanceof HTMLElement && el.hasAttribute('data-preview-opener');
	});

	let pass = report(`${label} open: no horizontal overflow @ ${width}px`, !overflow);
	pass =
		report(`${label} open: focus is on the title, not Close @ ${width}px`, titleFocused) && pass;
	pass =
		report(
			`${label} open: mix on its own full-width line, wrapping between items @ ${width}px`,
			mix !== null && mix.ownLine && mix.fullWidth && mix.itemsIntact && mix.noHOverflow,
			mix === null ? 'no mix row' : JSON.stringify(mix)
		) && pass;
	pass =
		report(
			`${label}: closes on Close, focus back on the opener @ ${width}px`,
			closed && focusBack,
			`closed=${closed}, focusBack=${focusBack}`
		) && pass;
	pass = report(`${label} open: no CSP violations @ ${width}px`, cspNew === 0) && pass;
	return pass;
}

/**
 * The preview sheet in one color scheme, phone-like (touch + mobile, like
 * the close-behavior checks): one context, the viewport resized across the
 * two phone widths and the desktop width; the demo scan runs once per
 * context.
 */
async function runPreview(browser, colorScheme) {
	const context = await browser.newContext({
		viewport: { width: 360, height: HEIGHT },
		hasTouch: true,
		isMobile: true,
		colorScheme
	});
	const page = await context.newPage();
	watchConsole(page);
	let ok = true;
	for (const width of [360, 390, 1280]) {
		await page.setViewportSize({ width, height: HEIGHT });
		if (!(await checkPreview(page, width, `preview sheet (${colorScheme})`))) ok = false;
	}
	await context.close();
	return ok;
}

/**
 * Keyboard shortcuts in Clean up, on a fine-pointer (desktop) context at
 * 1280 px: j focuses the first row's preview button, x selects it and the
 * selection bar appears, Enter opens the preview and Escape closes it with
 * focus back on that row, and ? opens the shortcuts sheet. Then, on a touch
 * (coarse-pointer) context, the "Keyboard shortcuts" button is hidden at
 * 390 px (the media query is about pointer type, not width).
 */
async function runKeyboard(browser) {
	const context = await browser.newContext({ viewport: { width: 1280, height: HEIGHT } });
	const page = await context.newPage();
	watchConsole(page);
	let ok = true;
	const at = ' @ 1280px';
	const firstSel = '[data-did] .open';

	await settle(page, PREVIEW);

	// The button next to the Sort control: shown on a fine-pointer device.
	ok =
		report(
			`keyboard: "Keyboard shortcuts" button visible${at} (fine pointer)`,
			(await page.getByRole('button', { name: 'Keyboard shortcuts' }).count()) > 0
		) && ok;

	// j focuses the first row's preview button.
	await page.keyboard.press('j');
	const jFocused = await page.evaluate((sel) => {
		const ae = document.activeElement;
		return ae instanceof HTMLElement && ae === document.querySelector(sel);
	}, firstSel);
	ok = report(`keyboard: j focuses the first row's preview button${at}`, jFocused) && ok;

	// x selects the row and the selection bar appears.
	await page.keyboard.press('x');
	const xState = await page.evaluate(() => {
		const first = document.querySelector('[data-did]');
		const checked = first?.querySelector('input[type="checkbox"]')?.checked ?? false;
		const bar = document.querySelector('[aria-label="Selection actions"]');
		return { checked, bar: bar !== null };
	});
	ok =
		report(
			`keyboard: x selects the row and the selection bar appears${at}`,
			xState.checked && xState.bar,
			JSON.stringify(xState)
		) && ok;

	// Enter opens the preview (the button's native activation).
	await page.keyboard.press('Enter');
	ok = report(`keyboard: Enter opens the preview${at}`, await sheetWaitOpen(page)) && ok;
	// Escape closes it with focus back on that row.
	await page.keyboard.press('Escape');
	const escClosed = await sheetWaitClosed(page);
	const focusBack = await page.evaluate((sel) => {
		const ae = document.activeElement;
		return ae instanceof HTMLElement && ae === document.querySelector(sel);
	}, firstSel);
	ok =
		report(
			`keyboard: Escape closes the preview, focus back on the row${at}`,
			escClosed && focusBack,
			`closed=${escClosed}, focusBack=${focusBack}`
		) && ok;

	// ? opens the shortcuts sheet (Shift+/ produces key "?").
	await page.keyboard.press('Shift+/');
	const qOpened = await sheetWaitOpen(page);
	const qTitle = await page.evaluate(
		() => document.querySelector('dialog.sheet[open] h2')?.textContent ?? ''
	);
	ok =
		report(
			`keyboard: ? opens the shortcuts sheet${at}`,
			qOpened && qTitle === 'Keyboard shortcuts',
			`title="${qTitle}"`
		) && ok;
	await page.keyboard.press('Escape');
	await sheetWaitClosed(page);
	await context.close();

	// Touch (coarse pointer): the button is hidden at 390 px.
	const touch = await browser.newContext({
		viewport: { width: 390, height: HEIGHT },
		hasTouch: true,
		isMobile: true
	});
	const tpage = await touch.newPage();
	watchConsole(tpage);
	await settle(tpage, PREVIEW);
	const btn = tpage.getByRole('button', { name: 'Keyboard shortcuts' });
	const btnHidden =
		(await btn.count()) === 0 || ((await btn.count()) > 0 && !(await btn.first().isVisible()));
	ok = report('keyboard: "Keyboard shortcuts" button hidden @ 390px (touch)', btnHidden) && ok;
	await touch.close();

	return ok;
}

/** The two bottom sheets, open, at this width. */
async function checkSheetsOpen(page, width) {
	let pass = true;
	// More presets, on Clean up.
	pass =
		(await checkSheetOpen(
			page,
			width,
			CLEANUP,
			'presets sheet',
			async () => page.getByRole('button', { name: 'More presets' }).click(),
			'.list .row',
			null,
			true
		)) && pass;
	// Unfollowed elsewhere, on Insights: the first demo scan in this context
	// leaves the seeded previous snapshot, so the chip is here by now.
	pass =
		(await checkSheetOpen(
			page,
			width,
			INSIGHTS,
			'unfollowed-elsewhere sheet',
			async () => page.getByRole('button', { name: /no longer follow/ }).click(),
			'.rows li',
			'.rows'
		)) && pass;
	return pass;
}

/**
 * The four sheets' close behavior, phone-like: 390 px, hasTouch and
 * isMobile. Each sheet: Close button closes it and returns focus to the
 * opener; a tap on the backdrop above the sheet closes it; a tap inside the
 * sheet away from any button keeps it open.
 */
const SHEET_CLOSE_TESTS = [
	{
		entry: CLEANUP,
		label: 'add-filter sheet',
		opener: { name: '+ Add filter' },
		focusText: '+ Add filter'
	},
	{
		entry: CLEANUP,
		label: 'presets sheet',
		opener: { name: 'More presets' },
		focusText: 'More presets'
	},
	{
		entry: INSIGHTS,
		label: 'unfollowed-elsewhere sheet',
		// The chip's aria label, not its text ("5 unfollowed elsewhere").
		opener: { name: /no longer follow/ },
		focusText: '5 unfollowed elsewhere'
	},
	{
		entry: CLEANUP,
		label: 'filter edit sheet',
		// The chip's aria label, not its text ("No interaction in 12 months").
		opener: { name: 'Edit filter: No interaction in 12 months' },
		focusText: 'No interaction in 12 months',
		setup: async (pg) => {
			await pg.getByRole('button', { name: '+ Add filter' }).click();
			await sheetWaitOpen(pg);
			await pg.getByRole('button', { name: 'No interaction in 12 months', exact: true }).click();
			await sheetWaitClosed(pg);
		}
	}
];

async function checkSheetsClose(page) {
	let pass = true;
	for (const t of SHEET_CLOSE_TESTS) {
		await settle(page, t.entry);
		if (t.setup) await t.setup(page);
		pass = (await checkSheetClose(page, t)) && pass;
	}
	return pass;
}

async function checkSheetClose(page, t) {
	const opener = page.getByRole('button', t.opener);
	const at = ' @ 390px (touch)';

	// 1. Tap Close: it closes, and focus is back on the opener.
	// Headless WebKit does not move focus on a touch tap (a real phone does),
	// so focus the opener first; the sheet's close-restore check then models
	// the phone on both engines.
	await opener.evaluate((el) => el.focus());
	await opener.tap();
	await sheetWaitOpen(page);
	const okTitle = report(
		`${t.label}: focus is on the title, not Close${at}`,
		await sheetFocusOnTitle(page)
	);
	await page.getByRole('button', { name: 'Close' }).tap();
	await sheetWaitClosed(page);
	const focused = await page.evaluate(() => {
		const el = document.activeElement;
		return el instanceof HTMLElement ? (el.textContent ?? '').trim() : '';
	});
	const ok1 = report(
		`${t.label}: Close closes it, focus back on the opener${at}`,
		focused === t.focusText,
		`focus was on "${focused}"`
	);

	// 2. Tap the backdrop above the sheet: it closes.
	await opener.tap();
	await sheetWaitOpen(page);
	const box = await page.locator(DIALOG).boundingBox();
	await page.touchscreen.tap(box.x + box.width / 2, Math.max(10, box.y - 20));
	const ok2 = report(
		`${t.label}: backdrop tap above the sheet closes it${at}`,
		await sheetWaitClosed(page)
	);

	// 3. Tap inside the sheet away from any button: it stays open.
	await opener.tap();
	await sheetWaitOpen(page);
	const box2 = await page.locator(DIALOG).boundingBox();
	// The sheet's top-left corner sits in the inner wrapper's padding, before
	// the title text: a tap there targets the sheet, not the backdrop.
	await page.touchscreen.tap(box2.x + 8, box2.y + 10);
	await page.waitForTimeout(200);
	const stillOpen = await page.evaluate(
		(sel) => document.querySelector(sel)?.open === true,
		DIALOG
	);
	const ok3 = report(`${t.label}: tap inside keeps it open${at}`, stillOpen);

	// Leave it closed for the next test.
	await page.getByRole('button', { name: 'Close' }).tap();
	await sheetWaitClosed(page);
	return okTitle && ok1 && ok2 && ok3;
}

/**
 * Recent changes must stay inside the page gutter: its left and right
 * edges line up with the page heading's at phone widths. The demo seeds one
 * log entry, so the section is expected to be present with at least one row.
 */
async function checkRecentChangesAlignment(page, width, url) {
	let found = true;
	try {
		await page.waitForSelector('section.recent', { timeout: 10_000 });
	} catch {
		found = false;
	}
	if (!found) {
		return report(
			`${url} @ ${width}px: Recent changes inside the page gutter`,
			false,
			'no section.recent rendered (demo entry missing?)'
		);
	}
	const m = await page.evaluate(() => {
		const h1 = document.querySelector('.page h1');
		const recent = document.querySelector('.page section.recent');
		if (h1 === null || recent === null) return null;
		const a = h1.getBoundingClientRect();
		const b = recent.getBoundingClientRect();
		return {
			entries: recent.querySelectorAll('li').length,
			left: Math.abs(a.left - b.left),
			right: Math.abs(a.right - b.right)
		};
	});
	if (m === null) {
		return report(
			`${url} @ ${width}px: Recent changes inside the page gutter`,
			false,
			'page heading or section not found'
		);
	}
	const ok = m.entries >= 1 && m.left <= 1 && m.right <= 1;
	return report(
		`${url} @ ${width}px: Recent changes inside the page gutter`,
		ok,
		`entries=${m.entries} leftDelta=${m.left.toFixed(1)} rightDelta=${m.right.toFixed(1)}`
	);
}

/**
 * The under-50 "When you post" hour chart. Fresh context: you-data is
 * cached in the demo database, so a context that already ran the full demo
 * would serve the ~300-item feed from the cache and the card would show
 * the grid. The hour chart has 24 track columns plus one value bar per
 * non-empty hour (the grid would have 168 cells).
 */
/**
 * Every hour chart's tick labels must sit inside the chart's box: a centered
 * label on the first (or last) column would extend past the edge and be
 * clipped. Fails when no hour chart is mounted at all, so it cannot pass
 * vacuously.
 */
async function checkHourTicks(page, width, label) {
	const m = await page.evaluate(() => {
		const charts = [...document.querySelectorAll('.hourchart svg')];
		const bad = [];
		for (const svg of charts) {
			const box = svg.getBoundingClientRect();
			for (const t of svg.querySelectorAll('text.tick')) {
				const r = t.getBoundingClientRect();
				if (r.left < box.left - 1 || r.right > box.right + 1) {
					bad.push(
						`"${t.textContent.trim()}" [${Math.round(r.left)}, ${Math.round(
							r.right
						)}] outside chart [${Math.round(box.left)}, ${Math.round(box.right)}]`
					);
				}
			}
		}
		return { charts: charts.length, bad };
	});
	const ok = m.charts >= 1 && m.bad.length === 0;
	const pass = report(
		`${label} @ ${width}px: hour chart tick labels inside the chart`,
		ok,
		m.charts === 0 ? 'no hour chart mounted' : m.bad.join(' ')
	);
	return pass;
}

/**
 * The hour chart's tick labels at every width, in this browser. One context:
 * the demo scan runs once on the first settle, then the viewport is resized
 * and the already-mounted chart re-measured (the data is cached in the demo
 * database, so no rescan).
 */
async function runHourTicks(browser) {
	const context = await browser.newContext({ viewport: { width: 360, height: HEIGHT } });
	const page = await context.newPage();
	watchConsole(page);
	await settle(page, INSIGHTS);
	// One-viewport steps so the IntersectionObserver-gated chart mounts.
	await scrollThrough(page);
	let ok = true;
	for (const width of [360, 390, 1280]) {
		await page.setViewportSize({ width, height: HEIGHT });
		await page.waitForTimeout(250);
		if (!(await checkHourTicks(page, width, 'hour ticks'))) ok = false;
	}
	await context.close();
	return ok;
}

async function runYouHourChart(browser, width) {
	const context = await browser.newContext({ viewport: { width, height: HEIGHT } });
	const page = await context.newPage();
	watchConsole(page);
	await settle(page, SHORT_FEED);
	await page.getByRole('button', { name: 'You', exact: true }).click();
	await page.waitForTimeout(300);
	const m = await page.evaluate(async () => {
		const card = [...document.querySelectorAll('.card')].find((c) =>
			(c.querySelector('h2')?.textContent ?? '').startsWith('When you post')
		);
		if (card === undefined) return null;
		card.scrollIntoView();
		// The svg lazy-mounts when the figure nears the viewport.
		const t0 = Date.now();
		while (card.querySelector('svg') === null && Date.now() - t0 < 5000) {
			await new Promise((r) => setTimeout(r, 100));
		}
		const svg = card.querySelector('svg');
		return {
			takeaway: card.querySelector('.takeaway')?.textContent ?? '',
			footnote: card.querySelector('.footnote')?.textContent ?? '',
			rects: svg ? svg.querySelectorAll('rect').length : 0
		};
	});
	const ok =
		m !== null &&
		m.rects >= 24 &&
		m.rects <= 48 &&
		/^Busiest around /.test(m.takeaway) &&
		m.footnote.includes('From your last 30 posts and reposts.');
	const pass = report(
		`you hour chart @ ${width}px: short demo feed draws the hour chart`,
		ok,
		m === null ? 'no "When you post" card' : JSON.stringify(m)
	);
	// The under-50 card's chart is the same component: its ticks must sit
	// inside the chart here too (it is the only hour chart on this page).
	const ticksPass = await checkHourTicks(page, width, 'you hour chart ticks');
	await context.close();
	return pass && ticksPass;
}

/** Every check at this width (Chromium): all pages, all suites, sheets open. */
async function runFullWidth(browser, width) {
	const context = await browser.newContext({ viewport: { width, height: HEIGHT } });
	const page = await context.newPage();
	watchConsole(page);
	let ok = true;
	for (const entry of PAGES) {
		if (!(await checkTab(page, entry.url, entry))) ok = false;
		if (!(await checkCardGaps(page, width, entry.url))) ok = false;
		if (!(await checkChipConsistency(page, width, entry.url))) ok = false;
		if (!(await checkCardFootnotes(page, width, entry.url))) ok = false;
		if (entry.url.startsWith('/cleanup')) {
			if (!(await checkRowsFit(page, width, entry.url))) ok = false;
			if (width === 390 && !(await checkRowsRoom(page, width, entry.url))) ok = false;
			if (width === 390 && !(await checkRowNamePriority(page, width, entry.url))) ok = false;
			if (!(await checkRecentChangesAlignment(page, width, entry.url))) ok = false;
		}
		// Before the You tab switch below: the card lives on the Following tab.
		if (entry.url.startsWith('/insights')) {
			if (!(await checkInteractionCard(page, width, entry.url))) ok = false;
		}
		if (entry.youTab) {
			await page.getByRole('button', { name: 'You', exact: true }).click();
			await page.waitForTimeout(300);
			await scrollThrough(page);
			const m = await measure(page);
			if (m.scrollWidth > m.inner) {
				log(`FAIL ${entry.url} (You tab) @ ${m.inner}px: scrollWidth=${m.scrollWidth}`);
				for (const line of m.out) log(`   ${line}`);
				ok = false;
			} else {
				log(`ok   ${entry.url} (You tab) @ ${m.inner}px`);
			}
			if (!(await checkCardGaps(page, width, `${entry.url} (You tab)`))) ok = false;
			if (!(await checkCardFootnotes(page, width, `${entry.url} (You tab)`))) ok = false;
			if (!(await checkTopPosts(page, width, `${entry.url} (You tab)`))) ok = false;
			if (!(await checkFollowerCard(page, width, `${entry.url} (You tab)`))) ok = false;
		}
	}
	// The bottom sheets, open, at this width.
	if (!(await checkSheetsOpen(page, width))) ok = false;
	if (!(await checkEditSheet(page, width))) ok = false;
	await context.close();
	return ok;
}

/**
 * The sheet and row checks at this width (WebKit, which models Safari):
 * the two cleanup pages' rows, then the two sheets open.
 */
async function runSheetRowsWidth(browser, width) {
	const context = await browser.newContext({ viewport: { width, height: HEIGHT } });
	const page = await context.newPage();
	watchConsole(page);
	let ok = true;
	for (const entry of CLEANUP_PAGES) {
		await settle(page, entry);
		if (!(await checkRowsFit(page, width, entry.url))) ok = false;
		if (width === 390 && !(await checkRowsRoom(page, width, entry.url))) ok = false;
		if (width === 390 && !(await checkRowNamePriority(page, width, entry.url))) ok = false;
		if (!(await checkRecentChangesAlignment(page, width, entry.url))) ok = false;
	}
	// The "Who you interact with" card in WebKit too (both tabs, overflow,
	// name ellipsis). The demo scan already ran on the cleanup pages above.
	await settle(page, INSIGHTS);
	if (!(await checkInteractionCard(page, width, INSIGHTS.url))) ok = false;
	// The not-found page in WebKit too: it is in PAGES (Chromium) and the
	// spec asks for both browsers, but PAGES is only walked in the full run.
	const notFound = PAGES.find((e) => e.url === '/this-page-does-not-exist');
	if (!(await checkTab(page, notFound.url, notFound))) ok = false;
	if (!(await checkSheetsOpen(page, width))) ok = false;
	if (!(await checkEditSheet(page, width))) ok = false;
	await context.close();
	return ok;
}

/** Close behavior, phone-like: 390 px with touch, all three sheets. */
async function runMobile(browser) {
	const mobile = await browser.newContext({
		viewport: { width: 390, height: HEIGHT },
		hasTouch: true,
		isMobile: true
	});
	const mpage = await mobile.newPage();
	watchConsole(mpage);
	const ok = await checkSheetsClose(mpage);
	await mobile.close();
	return ok;
}

// Headless Chromium throttles timers of backgrounded pages, so the demo scan
// takes minutes without the flags; the flags are
// Chromium-only and are not passed to WebKit, which has no such throttling.
const BROWSERS = [
	{
		name: 'chromium',
		full: true,
		launch: () =>
			chromium.launch({
				args: [
					'--disable-background-timer-throttling',
					'--disable-renderer-backgrounding',
					'--disable-backgrounding-occluded-windows'
				]
			})
	},
	{ name: 'webkit', full: false, launch: () => webkit.launch() }
];

async function main() {
	log('building...');
	execSync('npm run build', { cwd: root, stdio: 'inherit' });

	const preview = await startPreview();
	let ok = true;
	try {
		for (const b of BROWSERS) {
			log(`--- ${b.name} ---`);
			const browser = await b.launch();
			try {
				for (const width of WIDTHS) {
					if (b.full) {
						if (!(await runFullWidth(browser, width))) ok = false;
					} else if (!(await runSheetRowsWidth(browser, width))) ok = false;
				}
				// Chromium only: a second full demo scan in WebKit would add
				// minutes without extra coverage (the card logic is
				// browser-independent).
				if (b.full && !(await runYouHourChart(browser, 390))) ok = false;
				// The hour chart's tick labels at 360, 390 and 1280 px, in
				// both browsers (one demo scan per browser; the viewport is
				// resized in place afterwards, the data is cached).
				if (!(await runHourTicks(browser))) ok = false;
				if (!(await runMobile(browser))) ok = false;
				// The profile preview sheet, in light and dark, at the phone
				// widths and a desktop width (one demo scan per context).
				for (const scheme of ['light', 'dark']) {
					if (!(await runPreview(browser, scheme))) ok = false;
				}
				// Keyboard shortcuts in Clean up, desktop-like at 1280 px,
				// and the shortcuts button hidden on touch at 390 px.
				if (!(await runKeyboard(browser))) ok = false;
			} finally {
				await browser.close();
			}
		}
	} finally {
		preview.kill('SIGTERM');
	}
	if (cspViolations.length > 0) {
		log('FAIL CSP violations:');
		for (const line of cspViolations) log(`   ${line}`);
		ok = false;
	}
	if (!ok) {
		log('layout check FAILED');
		process.exitCode = 1;
	} else {
		log('layout check passed');
	}
}

await main();
