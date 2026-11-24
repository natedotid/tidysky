import { describe, expect, it } from 'vitest';

import { busiestCell } from '#lib/charts/busiest';
import type {
	ActivitySummary,
	FollowAccount,
	InteractionKind,
	InteractionSummary
} from '#lib/scan/types';
import {
	activityBuckets,
	feedShare,
	followBack,
	followBackTakeaway,
	followedByMonth,
	followedInLastDays,
	interactionBuckets,
	interactionCount,
	leastActive,
	leastInteracted,
	mostActive,
	mostInteracted,
	sizeDistribution,
	whatTheyPost,
	whenTheyPost,
	weekdayCoverage
} from './following';

const NOW = new Date(2026, 10, 6); // 6 Nov 2026, local

const DAY = 86_400_000;
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * DAY).toISOString();

function act(over: Partial<ActivitySummary> = {}): ActivitySummary {
	return {
		sampleSize: 0,
		exhausted: false,
		lastActiveAt: null,
		lastPostAt: null,
		itemsPerDay: 0,
		share: { post: 0, reply: 0, quote: 0, repost: 0 },
		media: { text: 0, image: 0, video: 0, link: 0, quote: 0 },
		weekdayHour: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)),
		topLangs: [],
		medianWords: 0,
		...over
	};
}

function ix(lastAt: string | null, lastKind: InteractionKind = 'like'): InteractionSummary {
	return {
		lastAt,
		lastKind: lastAt === null ? null : lastKind,
		lastByKind: {
			like: null,
			repost: null,
			reply: null,
			quote: null,
			mention: null,
			...(lastAt !== null && lastKind !== null ? { [lastKind]: lastAt } : {})
		},
		countsByKind: {
			like: 0,
			repost: 0,
			reply: 0,
			quote: 0,
			mention: 0,
			...(lastAt !== null && lastKind !== null ? { [lastKind]: 1 } : {})
		}
	};
}

/** Like ix, but with arbitrary per-kind counts (lastByKind stays null). */
function ixCounts(
	lastAt: string | null,
	counts: Partial<Record<InteractionKind, number>> = {}
): InteractionSummary {
	const c = { like: 0, repost: 0, reply: 0, quote: 0, mention: 0, ...counts };
	const lastKind =
		(['like', 'repost', 'reply', 'quote', 'mention'] as const).find((k) => c[k] > 0) ?? null;
	return {
		lastAt,
		lastKind,
		lastByKind: { like: null, repost: null, reply: null, quote: null, mention: null },
		countsByKind: c
	};
}

function acct(over: Partial<FollowAccount> = {}): FollowAccount {
	return {
		did: 'did:plc:test',
		handle: 'test.bsky.social',
		displayName: null,
		avatar: null,
		description: null,
		followRkeys: [],
		followedAt: null,
		createdAt: null,
		followersCount: null,
		followsCount: null,
		postsCount: null,
		followsYou: null,
		labels: [],
		status: 'active',
		activity: null,
		profileScannedAt: null,
		activityScannedAt: null,
		interaction: null,
		...over
	};
}

describe('feedShare', () => {
	it('halfCount is 1 for shares of 50/30/20', () => {
		const accounts = [
			acct({ did: 'did:plc:a', activity: act({ itemsPerDay: 5 }) }),
			acct({ did: 'did:plc:b', activity: act({ itemsPerDay: 3 }) }),
			acct({ did: 'did:plc:c', activity: act({ itemsPerDay: 2 }) })
		];
		const r = feedShare(accounts);
		expect(r.total).toBe(10);
		expect(r.halfCount).toBe(1);
		expect(r.top.map((t) => t.account.did)).toEqual(['did:plc:a', 'did:plc:b', 'did:plc:c']);
		expect(r.top[0].share).toBeCloseTo(0.5);
	});

	it('adds accounts until the combined share reaches 50%', () => {
		const accounts = Array.from({ length: 4 }, (_, i) =>
			acct({ did: `did:plc:${i}`, activity: act({ itemsPerDay: 1 }) })
		);
		expect(feedShare(accounts).halfCount).toBe(2);
	});

	it('excludes accounts without activity and caps top at 10', () => {
		const accounts = [
			...Array.from({ length: 12 }, (_, i) =>
				acct({ did: `did:plc:${i}`, activity: act({ itemsPerDay: 1 }) })
			),
			acct({ did: 'did:plc:none' })
		];
		const r = feedShare(accounts);
		expect(r.top).toHaveLength(10);
		expect(r.top.every((t) => t.account.did !== 'did:plc:none')).toBe(true);
	});
});

describe('activityBuckets', () => {
	it('puts each account in exactly one bucket', () => {
		const accounts = [
			acct({ did: 'a7', activity: act({ lastActiveAt: daysAgo(3), itemsPerDay: 1 }) }),
			acct({ did: 'a30', activity: act({ lastActiveAt: daysAgo(20), itemsPerDay: 1 }) }),
			acct({ did: 'a90', activity: act({ lastActiveAt: daysAgo(50), itemsPerDay: 1 }) }),
			acct({ did: 'quiet-old', activity: act({ lastActiveAt: daysAgo(200) }) }),
			// No items in the sample, but the profile says they have posted.
			acct({ did: 'quiet-nosample', activity: act(), postsCount: 10 }),
			acct({ did: 'never', activity: act(), postsCount: 0 }),
			acct({
				did: 'gone',
				status: 'gone',
				activity: act({ lastActiveAt: daysAgo(1), itemsPerDay: 5 })
			}),
			acct({ did: 'unknown-noact' }),
			acct({
				did: 'blocked',
				status: 'blocked',
				activity: act({ lastActiveAt: daysAgo(1), itemsPerDay: 5 })
			})
		];
		const b = activityBuckets(accounts, NOW);
		expect(b).toEqual({
			active7: 1,
			active30: 1,
			active90: 1,
			quiet: 2,
			never: 1,
			gone: 1,
			unknown: 2
		});
		const sum = b.active7 + b.active30 + b.active90 + b.quiet + b.never + b.gone + b.unknown;
		expect(sum).toBe(accounts.length);
	});

	it('bucket edges are inclusive: 7 and 30 days old stay in the younger bucket', () => {
		const b = activityBuckets(
			[
				acct({ did: 'e7', activity: act({ lastActiveAt: daysAgo(7) }) }),
				acct({ did: 'e30', activity: act({ lastActiveAt: daysAgo(30) }) }),
				acct({ did: 'e31', activity: act({ lastActiveAt: daysAgo(31) }) })
			],
			NOW
		);
		expect(b.active7).toBe(1);
		expect(b.active30).toBe(1);
		expect(b.active90).toBe(1);
	});
});

describe('interactionBuckets', () => {
	it('puts each active account in exactly one bucket', () => {
		const accounts = [
			acct({ did: 'a30', interaction: ix(daysAgo(10)) }),
			acct({ did: 'a90', interaction: ix(daysAgo(50), 'reply') }),
			acct({ did: 'old', interaction: ix(daysAgo(200), 'repost') }),
			acct({ did: 'none', interaction: ix(null) }),
			acct({ did: 'unchecked' }),
			// Non-active accounts can't be interacted with: ignored entirely.
			acct({ did: 'gone', status: 'gone', interaction: ix(null) }),
			acct({ did: 'dead', status: 'deactivated', interaction: ix(daysAgo(10)) })
		];
		const b = interactionBuckets(accounts, NOW);
		expect(b).toEqual({ in30: 1, in31To90: 1, in91To365: 1, none: 1, unchecked: 1, checked: 4 });
		expect(b.in30 + b.in31To90 + b.in91To365 + b.none + b.unchecked).toBe(5);
	});

	it('ignores non-active accounts, checked or not', () => {
		const b = interactionBuckets(
			[
				acct({ did: 'gone', status: 'gone', interaction: ix(null) }),
				acct({ did: 'dead', status: 'deactivated', interaction: ix(daysAgo(1)) }),
				acct({ did: 'down', status: 'takendown' })
			],
			NOW
		);
		expect(b).toEqual({ in30: 0, in31To90: 0, in91To365: 0, none: 0, unchecked: 0, checked: 0 });
	});

	it('bucket edges are inclusive: 30 and 90 days old stay in the younger bucket', () => {
		const b = interactionBuckets(
			[
				acct({ did: 'e30', interaction: ix(daysAgo(30)) }),
				acct({ did: 'e31', interaction: ix(daysAgo(31)) }),
				acct({ did: 'e90', interaction: ix(daysAgo(90)) }),
				acct({ did: 'e91', interaction: ix(daysAgo(91)) })
			],
			NOW
		);
		expect(b.in30).toBe(1);
		expect(b.in31To90).toBe(2);
		expect(b.in91To365).toBe(1);
		expect(b.checked).toBe(4);
	});

	it('counts only checked accounts in checked', () => {
		const b = interactionBuckets([acct({ did: 'u' }), acct({ did: 'u2' })], NOW);
		expect(b.checked).toBe(0);
		expect(b.unchecked).toBe(2);
	});
});

describe('interactionCount', () => {
	it('sums the five kinds, plain total, no weighting', () => {
		const a = acct({
			interaction: {
				lastAt: daysAgo(1),
				lastKind: 'like',
				lastByKind: { like: daysAgo(1), repost: null, reply: null, quote: null, mention: null },
				countsByKind: { like: 3, repost: 1, reply: 2, quote: 1, mention: 3 }
			}
		});
		expect(interactionCount(a)).toBe(10);
	});

	it('is zero for a checked account with no interactions', () => {
		expect(interactionCount(acct({ interaction: ix(null) }))).toBe(0);
	});

	it('is null for an unchecked account', () => {
		expect(interactionCount(acct())).toBeNull();
	});
});

describe('mostActive and leastActive', () => {
	const xs = [
		acct({ did: 'slow', activity: act({ itemsPerDay: 1 }) }),
		acct({ did: 'fast', activity: act({ itemsPerDay: 9 }) }),
		acct({ did: 'mid', activity: act({ itemsPerDay: 5 }) }),
		acct({ did: 'inactive' })
	];

	it('mostActive is descending, top n, active only', () => {
		expect(mostActive(xs, 2).map((a) => a.did)).toEqual(['fast', 'mid']);
	});

	it('leastActive is the quietest of the active, ascending', () => {
		expect(leastActive(xs, 2).map((a) => a.did)).toEqual(['slow', 'mid']);
	});
});

describe('mostInteracted and leastInteracted', () => {
	it('mostInteracted: count descending, ties by the more recent last interaction then DID', () => {
		const accounts = [
			acct({ did: 'a-ten-old', interaction: ixCounts(daysAgo(100), { like: 10 }) }),
			acct({ did: 'b-ten-new', interaction: ixCounts(daysAgo(10), { repost: 10 }) }),
			acct({ did: 'c-five', interaction: ixCounts(daysAgo(1), { like: 4, reply: 1 }) }),
			acct({ did: 'g-one', interaction: ixCounts(daysAgo(50), { mention: 1 }) })
		];
		expect(mostInteracted(accounts, 10).map((a) => a.did)).toEqual([
			'b-ten-new',
			'a-ten-old',
			'c-five',
			'g-one'
		]);
	});

	it('mostInteracted excludes zero counts, unchecked and non-active accounts, and caps at n', () => {
		const accounts = [
			acct({ did: 'zero', interaction: ix(null) }),
			acct({ did: 'unchecked' }),
			acct({ did: 'gone', status: 'gone', interaction: ixCounts(daysAgo(1), { like: 99 }) }),
			acct({ did: 'one', interaction: ixCounts(daysAgo(1), { like: 1 }) }),
			acct({ did: 'two', interaction: ixCounts(daysAgo(1), { like: 2 }) }),
			acct({ did: 'three', interaction: ixCounts(daysAgo(1), { like: 3 }) })
		];
		expect(mostInteracted(accounts, 10).map((a) => a.did)).toEqual(['three', 'two', 'one']);
		expect(mostInteracted(accounts, 1).map((a) => a.did)).toEqual(['three']);
	});

	it('leastInteracted: count ascending, ties by the busier account then DID', () => {
		const accounts = [
			acct({ did: 'a-zero-slow', interaction: ix(null), activity: act({ itemsPerDay: 1 }) }),
			acct({ did: 'b-zero-fast', interaction: ix(null), activity: act({ itemsPerDay: 9 }) }),
			acct({
				did: 'c-two',
				interaction: ixCounts(daysAgo(1), { like: 2 }),
				activity: act({ itemsPerDay: 5 })
			})
		];
		expect(leastInteracted(accounts, 10).map((a) => a.did)).toEqual([
			'b-zero-fast',
			'a-zero-slow',
			'c-two'
		]);
	});

	it('leastInteracted needs a posting, checked, active account, and caps at n', () => {
		const accounts = [
			acct({ did: 'inactive', interaction: ix(null) }),
			acct({ did: 'unchecked', activity: act({ itemsPerDay: 3 }) }),
			acct({
				did: 'gone',
				status: 'gone',
				interaction: ix(null),
				activity: act({ itemsPerDay: 9 })
			}),
			acct({ did: 'one', interaction: ix(null), activity: act({ itemsPerDay: 2 }) })
		];
		expect(leastInteracted(accounts, 10).map((a) => a.did)).toEqual(['one']);
		expect(leastInteracted(accounts, 0).map((a) => a.did)).toEqual([]);
	});
});

describe('whenTheyPost', () => {
	const zeroGrid = (): number[][] => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
	const sum = (g: number[][]): number => g.flat().reduce((s, v) => s + v, 0);
	// Local midnight Mon 6 Jul 2026: late June / early July has no DST change
	// in any time zone, so "N days back" keeps its local time here.
	const MID = new Date(2026, 6, 6);

	it('rescales a sample that spans more than a week to one week of the rate', () => {
		const g = zeroGrid();
		g[4][20] = 14; // 14 items, all Thursday 8pm, 1 a day
		const grid = whenTheyPost(
			[acct({ did: 'a', activity: act({ weekdayHour: g, itemsPerDay: 1 }) })],
			MID
		);
		// Span = 14 days ending exactly at local midnight: every weekday is
		// covered twice, so the Thursday cell is 14 / 2.
		expect(grid[4][20]).toBe(7);
		expect(sum(grid)).toBe(7);
	});

	it('a short sample spreads its hour mix over all seven weekdays', () => {
		const g = zeroGrid();
		g[1][12] = 30; // all 30 sampled items on one Monday, 6 a day
		const grid = whenTheyPost(
			[acct({ did: 'a', activity: act({ weekdayHour: g, itemsPerDay: 6 }) })],
			NOW
		);
		// Span = 5 days: 6 items a day, every weekday, at 12.
		for (let d = 0; d < 7; d += 1) expect(grid[d][12]).toBe(6);
		expect(sum(grid)).toBe(42);
	});

	it('the busiest day comes from a full-week pattern, not a recent-day burst', () => {
		// Heavy poster: 30 items all on one recent Monday, 6 a day (span 5 days).
		const heavy = zeroGrid();
		heavy[1][12] = 30;
		// Light poster: 14 items over two weeks, all Thursday 8pm, 1 a day.
		const light = zeroGrid();
		light[4][20] = 14;
		const grid = whenTheyPost(
			[
				acct({ did: 'heavy', activity: act({ weekdayHour: heavy, itemsPerDay: 6 }) }),
				acct({ did: 'light', activity: act({ weekdayHour: light, itemsPerDay: 1 }) })
			],
			MID
		);
		// The heavy poster's hour sits on all seven days at 6; the light
		// poster's Thursday cell (7) is the busiest, not the Monday burst.
		for (let d = 0; d < 7; d += 1) expect(grid[d][12]).toBe(6);
		expect(grid[4][20]).toBe(7);
		expect(busiestCell(grid)).toEqual({ stored: 4, hour: 20, value: 7 });
	});

	it('a sample spanning exactly a week is used as is', () => {
		const g = zeroGrid();
		for (let d = 0; d < 7; d += 1) g[d][8] = 3; // 21 items, 3 a day, span 7
		const grid = whenTheyPost(
			[acct({ did: 'a', activity: act({ weekdayHour: g, itemsPerDay: 3 }) })],
			MID
		);
		// Span = 7 days ending at local midnight: every weekday covered once.
		expect(grid).toEqual(g);
	});

	it('skips accounts with no items or no rate', () => {
		const g = zeroGrid();
		g[3][12] = 5;
		const grid = whenTheyPost(
			[
				acct({ did: 'no-items', activity: act({ itemsPerDay: 4 }) }),
				acct({ did: 'no-rate', activity: act({ weekdayHour: g }) }),
				acct({ did: 'none' })
			],
			NOW
		);
		expect(sum(grid)).toBe(0);
	});

	it('a uniform 14-day span has no recency bias on any weekday', () => {
		// The account posts 1 item a day at 9am. A 14-day span covers every
		// weekday exactly twice, and the one post the span misses (9am on the
		// first day, before its noon start) is on the same weekday as the one
		// extra post it includes (9am today), so the sample is perfectly
		// uniform. (A 10-day span can't do this: its two half-days are
		// different weekdays, so one weekday always keeps 2 posts over 1.5
		// days of coverage.)
		// Local noon on three different weekdays (Mon, Thu, Sun).
		const days = [new Date(2026, 6, 6, 12), new Date(2026, 6, 2, 12), new Date(2026, 5, 28, 12)];
		let first: ReturnType<typeof busiestCell> | undefined;
		for (const now of days) {
			const g = zeroGrid();
			for (let d = 0; d < 7; d += 1) g[d][9] = 2; // 14 items, 9am, 2 per weekday
			const grid = whenTheyPost(
				[acct({ did: 'a', activity: act({ weekdayHour: g, itemsPerDay: 1 }) })],
				now
			);
			for (let d = 0; d < 7; d += 1) expect(Math.abs(grid[d][9] - 1)).toBeLessThan(1e-9);
			const busiest = busiestCell(grid);
			if (first === undefined) first = busiest;
			else expect(busiest).toEqual(first);
		}
		// All 9am cells tie; busiestCell breaks to Monday-first display order.
		expect(first).toEqual({ stored: 1, hour: 9, value: 1 });
	});

	it('never divides by zero for spans of 7 days or more', () => {
		// A 7+ day span covers every weekday, so occ[d] is never 0; the guard
		// exists anyway. Check a spread of spans, including just above 7.
		const spans: Array<[number, number]> = [
			[7, 1],
			[141, 20], // 7.05
			[83, 10], // 8.3
			[14, 1]
		];
		for (const [n, r] of spans) {
			const g = zeroGrid();
			g[0][0] = n; // all items Sunday midnight
			const grid = whenTheyPost(
				[acct({ did: 'a', activity: act({ weekdayHour: g, itemsPerDay: r }) })],
				NOW
			);
			for (const row of grid) for (const v of row) expect(Number.isFinite(v)).toBe(true);
		}
	});

	it('whenTheyPost on 1000 accounts with 1500-day spans finishes in under 20 ms', () => {
		// A quiet account's span can be years (the demo's longest is 1829
		// days); 1000 of them must not make the card's derived value slow.
		const g = zeroGrid();
		g[0][0] = 1500; // 1500 items, 1 a day: a 1500-day span
		const accounts = Array.from({ length: 1000 }, (_, i) =>
			acct({ did: `did:plc:${i}`, activity: act({ weekdayHour: g, itemsPerDay: 1 }) })
		);
		const t0 = performance.now();
		const grid = whenTheyPost(accounts, MID);
		const ms = performance.now() - t0;
		expect(ms).toBeLessThan(20);
		// And the result is still about one week of the rate per account.
		const perAccount = sum(grid) / accounts.length;
		expect(perAccount).toBeGreaterThan(6.9);
		expect(perAccount).toBeLessThan(7.1);
		for (const row of grid) for (const v of row) expect(Number.isFinite(v)).toBe(true);
	});
});

describe('weekdayCoverage', () => {
	/**
	 * The original day-by-day walk (each step ends at the next local midnight
	 * or at `end`), kept as a test-only reference: the fast version must
	 * match it to within 1e-9.
	 */
	function weekdayCoverageWalk(start: Date, end: Date): number[] {
		const occ = new Array<number>(7).fill(0);
		if (end.getTime() <= start.getTime()) return occ;
		const boundaries: number[] = [start.getTime()];
		const d0 = new Date(start);
		let next = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1);
		while (next.getTime() < end.getTime()) {
			boundaries.push(next.getTime());
			next = new Date(next.getFullYear(), next.getMonth(), next.getDate() + 1);
		}
		boundaries.push(end.getTime());
		for (let i = 0; i < boundaries.length - 1; i += 1) {
			const a = new Date(boundaries[i]);
			const b = boundaries[i + 1];
			const dayStart = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
			const dayEnd = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1).getTime();
			occ[a.getDay()] += (b - a.getTime()) / (dayEnd - dayStart);
		}
		return occ;
	}

	it('exactly 7 days gives 1 for every weekday', () => {
		// Sat Oct 31 00:00 -> Sat Nov 7 00:00 local: 7 full calendar days.
		const occ = weekdayCoverage(new Date(2026, 9, 31), new Date(2026, 10, 7));
		expect(occ).toEqual([1, 1, 1, 1, 1, 1, 1]);
	});

	it('10 days ending at local noon gives the ones, twos and half-day ends', () => {
		// Fri 10 Jul 2026 12:00 back 10 days: Tue 30 Jun 12:00 -> Fri 10 Jul
		// 12:00. July has no DST change in any time zone. Tuesday (start day)
		// and Friday (today) each get a half day plus a full one; Wednesday
		// and Thursday are fully covered twice.
		const end = new Date(2026, 6, 10, 12);
		const start = new Date(end.getTime() - 10 * 86_400_000);
		const occ = weekdayCoverage(start, end);
		expect(occ).toEqual([1, 1, 1.5, 2, 2, 1.5, 1]); // Sunday-first
		expect(occ.reduce((s, v) => s + v, 0)).toBeCloseTo(10, 12);
	});

	it('a span crossing a DST change still sums to the span length within 1/24', () => {
		// Monday Mar 9 2026 12:00 local, 10 days back. In US time zones the
		// span crosses the spring-forward on Mar 8 (a 23h day), which shifts
		// where the half-days land; the fractions must still sum to ~10.
		const end = new Date(2026, 2, 9, 12);
		const start = new Date(end.getTime() - 10 * 86_400_000);
		const occ = weekdayCoverage(start, end);
		expect(Math.abs(occ.reduce((s, v) => s + v, 0) - 10)).toBeLessThanOrEqual(1 / 24 + 1e-9);
	});

	it('matches the day-by-day walk for long spans ending at several times of day', () => {
		// Spans from a week to the demo's longest (1829 days), ending at
		// several times of day. The start dates make the long spans cross
		// both US DST changes, and the DST-day and late-October starts
		// straddle or sit on the changes even at the short lengths; in a
		// time zone without DST there is nothing to straddle, but the two
		// versions must still agree.
		const starts = [
			new Date(2024, 5, 15), // midsummer: the 400 and 1829 day spans cross DST
			new Date(2026, 2, 8), // the US spring-forward day itself (23h)
			new Date(2026, 10, 1), // the US fall-back day itself (25h)
			new Date(2026, 9, 28), // the short spans straddle the US fall-back
			new Date(2026, 10, 2) // just after it: a no-straddle control
		];
		const spans = [7, 10, 30, 400, 1829];
		const times: Array<[number, number]> = [
			[0, 0],
			[9, 0],
			[12, 0],
			[15, 30],
			[23, 59]
		];
		for (const s of starts) {
			for (const span of spans) {
				for (const [h, m] of times) {
					const end = new Date(s.getFullYear(), s.getMonth(), s.getDate() + span, h, m);
					const ref = weekdayCoverageWalk(s, end);
					const got = weekdayCoverage(s, end);
					for (let d = 0; d < 7; d += 1) expect(Math.abs(got[d] - ref[d])).toBeLessThan(1e-9);
				}
			}
		}
	});
});

describe('whatTheyPost', () => {
	it('multiplies shares by sample size and sums media and languages', () => {
		const r = whatTheyPost([
			acct({
				did: 'a',
				activity: act({
					sampleSize: 10,
					share: { post: 0.5, reply: 0.25, quote: 0.25, repost: 0 },
					media: { text: 4, image: 1, video: 0, link: 0, quote: 0 },
					topLangs: [
						['en', 8],
						['ja', 2]
					]
				})
			}),
			acct({
				did: 'b',
				activity: act({
					sampleSize: 20,
					share: { post: 0, reply: 0, quote: 0, repost: 1 },
					media: { text: 6, image: 0, video: 0, link: 0, quote: 0 },
					topLangs: [
						['en', 10],
						['de', 5]
					]
				})
			})
		]);
		expect(r.kinds).toEqual({ post: 5, reply: 2.5, quote: 2.5, repost: 20 });
		expect(r.media.text).toBe(10);
		expect(r.media.image).toBe(1);
		expect(r.langs).toEqual([
			['en', 18],
			['de', 5],
			['ja', 2]
		]);
	});
});

describe('sizeDistribution', () => {
	it('keeps only the non-null follower counts', () => {
		expect(
			sizeDistribution([
				acct({ did: 'a', followersCount: 5 }),
				acct({ did: 'b' }),
				acct({ did: 'c', followersCount: 10 })
			])
		).toEqual([5, 10]);
	});
});

describe('followedByMonth', () => {
	it('includes empty months, oldest first, and ignores follows outside the window', () => {
		// Local midday dates: a UTC-midnight string would shift calendar day
		// in timezones behind UTC.
		const accounts = [
			acct({ did: 'a', followedAt: new Date(2026, 8, 15, 12).toISOString() }),
			acct({ did: 'b', followedAt: new Date(2026, 8, 20, 12).toISOString() }),
			acct({ did: 'c', followedAt: new Date(2026, 10, 1, 12).toISOString() }),
			acct({ did: 'old', followedAt: new Date(2025, 8, 15, 12).toISOString() }),
			acct({ did: 'none' })
		];
		expect(followedByMonth(accounts, NOW, 3)).toEqual([
			{ month: '2026-09', count: 2 },
			{ month: '2026-10', count: 0 },
			{ month: '2026-11', count: 1 }
		]);
	});
});

describe('followBack', () => {
	it('counts yes, no and unknown', () => {
		expect(
			followBack([
				acct({ did: 'a', followsYou: true }),
				acct({ did: 'b', followsYou: false }),
				acct({ did: 'c' }),
				acct({ did: 'd', followsYou: true })
			])
		).toEqual({ yes: 2, no: 1, unknown: 1 });
	});
});

describe('followBackTakeaway', () => {
	it('counts everything when no status is unknown', () => {
		expect(followBackTakeaway({ yes: 7, no: 3, unknown: 0 })).toBe('70% follow you back.');
	});

	it('says what the percentage counts when some statuses are unknown', () => {
		expect(followBackTakeaway({ yes: 7, no: 3, unknown: 50 })).toBe(
			'70% of the accounts TidySky could check follow you back.'
		);
	});

	it('is null when nothing is known', () => {
		expect(followBackTakeaway({ yes: 0, no: 0, unknown: 10 })).toBeNull();
	});
});

describe('followedInLastDays', () => {
	it('counts follows younger than the window', () => {
		const accounts = [
			acct({ did: 'a', followedAt: daysAgo(10) }),
			acct({ did: 'b', followedAt: daysAgo(40) }),
			acct({ did: 'c' })
		];
		expect(followedInLastDays(accounts, NOW, 30)).toBe(1);
	});
});
