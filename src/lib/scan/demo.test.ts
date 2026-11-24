import { describe, expect, it } from 'vitest';

import { feedShare } from '#lib/insights/following';
import { diffSnapshots, makeSnapshot } from '#lib/insights/snapshots';
import type { FollowAccount } from '#lib/scan/types';

import { DemoSource, demoPreviousSnapshot, generateDemoData, type DemoData } from './demo';
import { summarizeActivity } from './estimate';
import { collectInteractions } from './interactions';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const DAY_MS = 86_400_000;
const COUNT = 850;

/** The scanned accounts the insights run on, with real activity summaries. */
function accountsWithActivity(): FollowAccount[] {
	const data = generateDemoData(42, COUNT, NOW);
	const now = new Date(NOW);
	const out: FollowAccount[] = [];
	for (const p of data.profiles) {
		const feed = data.feeds.get(p.did);
		if (feed === undefined || !feed.ok) continue;
		const activity = summarizeActivity(feed.items, {
			now,
			exhausted: feed.exhausted,
			accountCreatedAt: p.createdAt
		});
		out.push({
			...p,
			followRkeys: [],
			followedAt: null,
			status: 'active',
			activity,
			profileScannedAt: null,
			activityScannedAt: null,
			interaction: null
		});
	}
	return out;
}

type DemoStatus = 'deactivated' | 'gone' | 'takendown' | 'never' | 'quiet' | 'active';

function statusOf(data: DemoData, did: string): DemoStatus {
	const feed = data.feeds.get(did);
	if (feed === undefined) return 'gone';
	if (!feed.ok) {
		switch (feed.status) {
			case 'deactivated':
			case 'takendown':
			case 'gone':
				return feed.status;
			default:
				// Unreachable: the demo only produces the three dead statuses.
				return 'gone';
		}
	}
	if (feed.items.length === 0) return 'never';
	let last = -Infinity;
	for (const item of feed.items) last = Math.max(last, Date.parse(item.at));
	return NOW - last > 90 * DAY_MS ? 'quiet' : 'active';
}

describe('generateDemoData', () => {
	it('the same seed gives identical output', () => {
		expect(generateDemoData(7, 100, NOW)).toEqual(generateDemoData(7, 100, NOW));
	});

	it('a different seed gives different output', () => {
		expect(generateDemoData(7, 100, NOW)).not.toEqual(generateDemoData(8, 100, NOW));
	});

	it('status shares land within three points of the targets', () => {
		const data = generateDemoData(42, COUNT, NOW);
		const unique = new Set(data.follows.map((f) => f.did));
		expect(unique.size).toBe(COUNT);

		const share = (s: DemoStatus): number => {
			let n = 0;
			for (const did of unique) if (statusOf(data, did) === s) n += 1;
			return n / unique.size;
		};
		const closeTo = (actual: number, target: number): void => {
			expect(Math.abs(actual - target)).toBeLessThanOrEqual(0.03);
		};
		closeTo(share('deactivated'), 0.04);
		closeTo(share('gone'), 0.02);
		closeTo(share('takendown'), 0.01);
		closeTo(share('never'), 0.08);
		closeTo(share('quiet'), 0.15);
		closeTo(share('active'), 1 - 0.04 - 0.02 - 0.01 - 0.08 - 0.15);

		const profileByDid = new Map(data.profiles.map((p) => [p.did, p]));
		const alive = [...unique].filter(
			(d) => !['deactivated', 'gone', 'takendown'].includes(statusOf(data, d))
		);
		closeTo(
			alive.filter((d) => profileByDid.get(d)?.followsYou === true).length / alive.length,
			0.35
		);
		closeTo(data.profiles.filter((p) => p.labels.includes('spam')).length / COUNT, 0.01);
		closeTo(
			data.profiles.filter((p) => (p.followsCount ?? 0) >= 5000 && (p.followersCount ?? 0) < 500)
				.length / COUNT,
			0.03
		);

		// Never-posted accounts have no posts, period.
		for (const did of unique) {
			if (statusOf(data, did) === 'never') expect(profileByDid.get(did)?.postsCount).toBe(0);
		}
	});

	it('every followed DID has a profile or a non-ok feed result', () => {
		const data = generateDemoData(42, COUNT, NOW);
		const profileDids = new Set(data.profiles.map((p) => p.did));
		for (const f of data.follows) {
			const feed = data.feeds.get(f.did);
			expect(profileDids.has(f.did) || (feed !== undefined && feed.ok === false)).toBe(true);
		}
	});

	it('keeps display names free of handle domains', () => {
		const data = generateDemoData(42, COUNT, NOW);
		for (const p of [...data.profiles, ...data.meFollowers, data.me]) {
			expect(p.displayName).not.toMatch(/\.bsky\.social/i);
			// No ".something" token: the old bug printed "Creek Dew.bsky.social".
			expect(p.displayName).not.toMatch(/\.[a-z]/i);
		}
	});

	it('steps the posting rates down: at least five active-7 accounts in each of 5-10, 10-20 and 20-40 a day', () => {
		const data = generateDemoData(42, COUNT, NOW);
		const activeIn7 = (did: string): boolean => {
			const feed = data.feeds.get(did);
			if (feed === undefined || !feed.ok || feed.items.length === 0) return false;
			let last = -Infinity;
			for (const item of feed.items) last = Math.max(last, Date.parse(item.at));
			return NOW - last <= 7 * DAY_MS;
		};
		// The generated rate, not the sample estimate: the estimate spans
		// from "now" and under-reads any account whose newest post is days old.
		let low = 0; // 5 to 10
		let mid = 0; // 10 to 20
		let high = 0; // 20 to 40
		for (const did of new Set(data.follows.map((f) => f.did))) {
			if (!activeIn7(did)) continue;
			const r = data.rateByDid.get(did) ?? 0;
			if (r >= 5 && r < 10) low += 1;
			else if (r >= 10 && r < 20) mid += 1;
			else if (r >= 20 && r < 40) high += 1;
		}
		expect(low).toBeGreaterThanOrEqual(5);
		expect(mid).toBeGreaterThanOrEqual(5);
		expect(high).toBeGreaterThanOrEqual(5);
	});

	it('the posting rate is a long tail: a top firehose, ~25 accounts write half', () => {
		const accounts = accountsWithActivity();
		const share = feedShare(accounts);
		expect(share.top[0].share).toBeGreaterThan(0.08);
		expect(share.top[0].share).toBeLessThan(0.15);
		expect(share.halfCount).toBeGreaterThanOrEqual(10);
		// The middle band (6 to 20 a day) adds mid-tier mass, so a bit more
		// than the old ~20 accounts are needed to reach half.
		expect(share.halfCount).toBeLessThanOrEqual(30);
		const rates = accounts.map((a) => a.activity?.itemsPerDay ?? 0).sort((a, b) => b - a);
		expect(rates[0]).toBeGreaterThanOrEqual(3 * rates[9]);
	});

	it('fills every activity bucket with the expected shares', () => {
		const data = generateDemoData(42, COUNT, NOW);
		const unique = new Set(data.follows.map((f) => f.did));
		const counts = { active7: 0, active30: 0, active90: 0, quiet: 0, never: 0, gone: 0 };
		for (const did of unique) {
			const feed = data.feeds.get(did);
			if (feed === undefined || !feed.ok) {
				counts.gone += 1;
				continue;
			}
			if (feed.items.length === 0) {
				counts.never += 1;
				continue;
			}
			let last = -Infinity;
			for (const item of feed.items) last = Math.max(last, Date.parse(item.at));
			const age = (NOW - last) / DAY_MS;
			if (age <= 7) counts.active7 += 1;
			else if (age <= 30) counts.active30 += 1;
			else if (age <= 90) counts.active90 += 1;
			else counts.quiet += 1;
		}
		const share = (n: number): number => n / unique.size;
		expect(share(counts.active7)).toBeGreaterThanOrEqual(0.55);
		expect(share(counts.active7)).toBeLessThan(0.65);
		expect(share(counts.active30)).toBeGreaterThanOrEqual(0.079);
		expect(share(counts.active30)).toBeLessThan(0.15);
		expect(share(counts.active90)).toBeGreaterThanOrEqual(0.05);
		expect(share(counts.active90)).toBeLessThan(0.1);
		expect(share(counts.quiet)).toBeGreaterThanOrEqual(0.15);
		expect(share(counts.quiet)).toBeLessThan(0.2);
		expect(share(counts.never)).toBeGreaterThanOrEqual(0.079);
		expect(share(counts.never)).toBeLessThan(0.1);
		expect(share(counts.gone)).toBeCloseTo(0.07, 1);
	});

	it('includes edge-case names, and the busiest account is one of them', () => {
		const data = generateDemoData(42, COUNT, NOW);
		const names = data.profiles.map((p) => p.displayName ?? '');
		expect(names.filter((n) => n.length >= 40).length).toBeGreaterThanOrEqual(4);
		expect(names.some((n) => /[\u{1F300}-\u{1FAFF}]/u.test(n))).toBe(true);
		expect(names.some((n) => /[Ͱ-Ͽ]/.test(n))).toBe(true); // Greek
		expect(names.some((n) => /[぀-ヿ一-鿿]/.test(n))).toBe(true); // Japanese
		expect(names.some((n) => /[؀-ۿ]/.test(n))).toBe(true); // Arabic
		expect(data.profiles.some((p) => (p.handle ?? '').length >= 45)).toBe(true);
		// The busiest account carries a 40+ char name, so the top charts
		// exercise long names in demo mode.
		const top = feedShare(accountsWithActivity()).top[0];
		expect((top.account.displayName ?? '').length).toBeGreaterThanOrEqual(40);
	});
});

describe('interaction mix', () => {
	async function collected() {
		const src = new DemoSource(42, COUNT, NOW);
		const { map } = await collectInteractions(src, src.did, new Date(NOW), undefined, () => {});
		return map;
	}

	it('lands within five points of the target mix, for the default seed', async () => {
		const data = generateDemoData(42, COUNT, NOW);
		const map = await collected();
		const unique = new Set(data.follows.map((f) => f.did));
		let in30 = 0;
		let in31 = 0;
		let in91 = 0;
		let none = 0;
		for (const did of unique) {
			const s = map.get(did);
			if (s === undefined || s.lastAt === null) {
				none += 1;
				continue;
			}
			const age = (NOW - Date.parse(s.lastAt)) / DAY_MS;
			if (age <= 30) in30 += 1;
			else if (age <= 90) in31 += 1;
			else in91 += 1;
		}
		const closeTo = (n: number, target: number): void =>
			expect(Math.abs(n / unique.size - target)).toBeLessThanOrEqual(0.05);
		closeTo(in30, 0.25);
		closeTo(in31, 0.15);
		closeTo(in91, 0.15);
		closeTo(none, 0.45);
	});

	it('gives a long tail of interaction counts', async () => {
		const map = await collected();
		let atLeast5 = 0;
		let atLeast10 = 0;
		for (const s of map.values()) {
			const n =
				s.countsByKind['like'] +
				s.countsByKind['repost'] +
				s.countsByKind['reply'] +
				s.countsByKind['quote'] +
				s.countsByKind['mention'];
			if (n >= 5) atLeast5 += 1;
			if (n >= 10) atLeast10 += 1;
		}
		expect(atLeast10).toBeGreaterThanOrEqual(10);
		expect(atLeast5).toBeGreaterThanOrEqual(30);
	});

	it('includes a reply, a quote, a quote with media and a two-mention post', async () => {
		const map = await collected();
		const kinds = { reply: false, quote: false, mention: false };
		for (const s of map.values()) {
			if (s.lastByKind['reply'] !== null) kinds.reply = true;
			if (s.lastByKind['quote'] !== null) kinds.quote = true;
			if (s.lastByKind['mention'] !== null) kinds.mention = true;
		}
		expect(kinds).toEqual({ reply: true, quote: true, mention: true });

		// The raw record shapes, straight from the source.
		const src = new DemoSource(42, COUNT, NOW);
		let quoteMedia = 0;
		let twoMentions = 0;
		let cursor: string | undefined;
		for (;;) {
			const page = await src.listOwnRecords('app.bsky.feed.post', cursor);
			for (const rec of page.records) {
				const embed = rec.value['embed'];
				if (
					typeof embed === 'object' &&
					embed !== null &&
					(embed as Record<string, unknown>)['$type'] === 'app.bsky.embed.recordWithMedia'
				)
					quoteMedia += 1;
				const facets = rec.value['facets'];
				if (Array.isArray(facets)) {
					const mentions = facets.filter(
						(f) =>
							typeof f === 'object' &&
							f !== null &&
							Array.isArray((f as Record<string, unknown>)['features']) &&
							((f as Record<string, unknown>)['features'] as unknown[]).some(
								(x) =>
									typeof x === 'object' &&
									x !== null &&
									(x as Record<string, unknown>)['$type'] === 'app.bsky.richtext.facet#mention'
							)
					).length;
					if (mentions >= 2) twoMentions += 1;
				}
			}
			cursor = page.cursor;
			if (cursor === undefined) break;
		}
		expect(quoteMedia).toBeGreaterThan(0);
		expect(twoMentions).toBeGreaterThan(0);
	});

	it('leaves heavy, active posters without interaction, so the oneWay preset has results', async () => {
		const map = await collected();
		const heavyActive = accountsWithActivity().filter(
			(a) =>
				(a.activity?.itemsPerDay ?? 0) >= 5 &&
				a.activity !== null &&
				a.activity.lastActiveAt !== null &&
				NOW - Date.parse(a.activity.lastActiveAt) <= 30 * DAY_MS
		);
		const noneHeavy = heavyActive.filter((a) => map.get(a.did) === undefined);
		expect(noneHeavy.length).toBeGreaterThanOrEqual(3);
	});
});

describe('unfollowed-elsewhere seed', () => {
	it('adds five dropped DIDs: four with profiles, one without, none followed', () => {
		const data = generateDemoData(42, COUNT, NOW);
		expect(data.droppedElsewhere).toHaveLength(5);
		const inProfiles = new Set(data.profiles.map((p) => p.did));
		const inFollows = new Set(data.follows.map((f) => f.did));
		for (const did of data.droppedElsewhere) expect(inFollows.has(did)).toBe(false);
		expect(data.droppedElsewhere.filter((d) => inProfiles.has(d)).length).toBe(4);
	});

	it('the seeded previous snapshot differs only by two new follows, one quiet, five dropped', () => {
		const data = generateDemoData(42, COUNT, NOW);
		const accounts = accountsWithActivity();
		const now = new Date(NOW);
		const prev = demoPreviousSnapshot(accounts, data.droppedElsewhere, now);
		const curr = makeSnapshot(accounts, now);
		expect(prev.at).toBe(new Date(NOW - DAY_MS).toISOString());
		const d = diffSnapshots(prev, curr);
		expect(d.newFollows).toHaveLength(2);
		expect(d.wentQuiet).toHaveLength(1);
		expect(d.droppedElsewhere).toEqual(data.droppedElsewhere);
		expect(d.cameBack).toEqual([]);
		expect(d.wentGone).toEqual([]);
		expect(d.stoppedFollowingYou).toEqual([]);
		expect(d.startedFollowingYou).toEqual([]);
	});
});
