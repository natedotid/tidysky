import { describe, expect, it } from 'vitest';

import { DemoSource, generateDemoData } from '#lib/scan/demo';
import { summarizeActivity } from '#lib/scan/estimate';
import { collectInteractions } from '#lib/scan/interactions';
import type { ActivitySummary, FollowAccount, InteractionSummary } from '#lib/scan/types';

import {
	describe as describeSpec,
	describeClause,
	evalClause,
	matches,
	reasons,
	type Clause,
	type FilterClause,
	type FilterSpec
} from './filters';
import { CLEANUP_PRESETS, LIST_PRESETS, presetById } from './presets';

const NOW = new Date('2026-11-02T12:00:00Z');
const DAY = 86_400_000;
const iso = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

function activity(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
	return {
		sampleSize: 0,
		exhausted: true,
		lastActiveAt: null,
		lastPostAt: null,
		itemsPerDay: 0,
		share: { post: 0, reply: 0, quote: 0, repost: 0 },
		media: { text: 0, image: 0, video: 0, link: 0, quote: 0 },
		weekdayHour: Array.from({ length: 7 }, () => Array<number>(24).fill(0)),
		topLangs: [],
		medianWords: 0,
		...overrides
	};
}

function interaction(overrides: Partial<InteractionSummary> = {}): InteractionSummary {
	return {
		lastAt: null,
		lastKind: null,
		lastByKind: { like: null, repost: null, reply: null, quote: null, mention: null },
		countsByKind: { like: 0, repost: 0, reply: 0, quote: 0, mention: 0 },
		...overrides
	};
}

function acc(overrides: Partial<FollowAccount> = {}): FollowAccount {
	return {
		did: 'did:plc:test',
		handle: 'test.bsky.social',
		displayName: 'Test Person',
		avatar: 'https://bsky/img/avatar.png',
		description: 'A bio',
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
		...overrides
	};
}

describe('quiet', () => {
	const quiet90: Clause = { kind: 'quiet', days: 90 };

	it('matches an active account last seen 120 days ago', () => {
		const a = acc({ activity: activity({ lastActiveAt: iso(120) }) });
		expect(evalClause(a, quiet90, NOW)).toBe(true);
	});

	it('does not match an account seen 10 days ago', () => {
		const a = acc({ activity: activity({ lastActiveAt: iso(10) }) });
		expect(evalClause(a, quiet90, NOW)).toBe(false);
	});

	it('is unknown (null) without activity, and never matches', () => {
		const a = acc();
		expect(evalClause(a, quiet90, NOW)).toBeNull();
		expect(matches(a, { clauses: [quiet90] }, NOW)).toBe(false);
	});

	it('counts a never-posted active account (empty sample) as quiet', () => {
		const a = acc({ activity: activity(), postsCount: 0 });
		expect(evalClause(a, quiet90, NOW)).toBe(true);
	});

	it('is unknown (null) for a dead account, even with an old last activity', () => {
		const a = acc({ status: 'deactivated', activity: activity({ lastActiveAt: iso(400) }) });
		expect(evalClause(a, quiet90, NOW)).toBeNull();
	});

	it('never matches a dead account, negated or not', () => {
		const posted: FilterClause = { kind: 'quiet', days: 30, negate: true };
		for (const status of ['deactivated', 'takendown', 'gone'] as const) {
			const a = acc({ status, activity: activity({ lastActiveAt: iso(10) }) });
			expect(evalClause(a, quiet90, NOW), status).toBeNull();
			expect(matches(a, { clauses: [quiet90] }, NOW), status).toBe(false);
			expect(matches(a, { clauses: [posted] }, NOW), status).toBe(false);
		}
	});
});

describe('followsYou and negation', () => {
	const notBack: FilterClause = { kind: 'followsYou', negate: true };

	it('negated followsYou matches false, and not null (unknown)', () => {
		expect(matches(acc({ followsYou: false }), { clauses: [notBack] }, NOW)).toBe(true);
		expect(matches(acc({ followsYou: true }), { clauses: [notBack] }, NOW)).toBe(false);
		expect(matches(acc({ followsYou: null }), { clauses: [notBack] }, NOW)).toBe(false);
	});

	it('a negated unknown clause still makes the whole spec not match', () => {
		const spec: FilterSpec = {
			clauses: [
				{ kind: 'followsYou', negate: true },
				{ kind: 'noBio', negate: true }
			]
		};
		expect(matches(acc({ followsYou: null, description: 'here' }), spec, NOW)).toBe(false);
	});
});

describe('noInteraction', () => {
	const c: Clause = { kind: 'noInteraction', days: 365 };

	it('matches a checked account with no interaction in the window', () => {
		expect(evalClause(acc({ interaction: interaction() }), c, NOW)).toBe(true);
	});

	it('matches a checked account whose last interaction is older than the days', () => {
		const a = acc({
			interaction: interaction({ lastAt: iso(400), lastKind: 'like' })
		});
		expect(evalClause(a, c, NOW)).toBe(true);
	});

	it('does not match a recent interaction', () => {
		const a = acc({
			interaction: interaction({ lastAt: iso(10), lastKind: 'reply' })
		});
		expect(evalClause(a, c, NOW)).toBe(false);
	});

	it('is unknown for an unchecked account, and never matches, negated or not', () => {
		const negated: FilterClause = { kind: 'noInteraction', days: 365, negate: true };
		expect(evalClause(acc(), c, NOW)).toBeNull();
		expect(matches(acc(), { clauses: [c] }, NOW)).toBe(false);
		expect(matches(acc(), { clauses: [negated] }, NOW)).toBe(false);
	});

	it('negated matches only a checked account with a recent interaction', () => {
		const negated: FilterClause = { kind: 'noInteraction', days: 90, negate: true };
		const recent = acc({
			interaction: interaction({ lastAt: iso(30), lastKind: 'mention' })
		});
		const stale = acc({
			interaction: interaction({ lastAt: iso(200), lastKind: 'like' })
		});
		const none = acc({ interaction: interaction() });
		expect(matches(recent, { clauses: [negated] }, NOW)).toBe(true);
		expect(matches(stale, { clauses: [negated] }, NOW)).toBe(false);
		expect(matches(none, { clauses: [negated] }, NOW)).toBe(false);
	});
});

describe('interactionsAtLeast', () => {
	const c: Clause = { kind: 'interactionsAtLeast', n: 5 };
	const counts = (like: number, repost = 0, reply = 0, quote = 0, mention = 0) =>
		interaction({
			countsByKind: { like, repost, reply, quote, mention }
		});

	it('sums all five kinds and matches at the threshold', () => {
		expect(evalClause(acc({ interaction: counts(5) }), c, NOW)).toBe(true);
		expect(evalClause(acc({ interaction: counts(2, 1, 1, 1, 0) }), c, NOW)).toBe(true);
		expect(evalClause(acc({ interaction: counts(3, 0, 1) }), c, NOW)).toBe(false);
	});

	it('is unknown for an unchecked account, and never matches, negated or not', () => {
		const negated: FilterClause = { kind: 'interactionsAtLeast', n: 5, negate: true };
		expect(evalClause(acc(), c, NOW)).toBeNull();
		expect(matches(acc(), { clauses: [c] }, NOW)).toBe(false);
		expect(matches(acc(), { clauses: [negated] }, NOW)).toBe(false);
	});

	it('negated matches a checked account below the threshold, zero included', () => {
		const negated: FilterClause = { kind: 'interactionsAtLeast', n: 5, negate: true };
		const few = acc({
			interaction: interaction({
				lastAt: iso(10),
				lastKind: 'like',
				countsByKind: { like: 4, repost: 0, reply: 0, quote: 0, mention: 0 }
			})
		});
		const many = acc({
			interaction: interaction({
				lastAt: iso(10),
				lastKind: 'like',
				countsByKind: { like: 6, repost: 0, reply: 0, quote: 0, mention: 0 }
			})
		});
		const zero = acc({ interaction: interaction() });
		expect(matches(few, { clauses: [negated] }, NOW)).toBe(true);
		expect(matches(many, { clauses: [negated] }, NOW)).toBe(false);
		expect(matches(zero, { clauses: [negated] }, NOW)).toBe(true);
	});
});

describe('ratioAbove', () => {
	const c: Clause = { kind: 'ratioAbove', n: 10 };

	it('matches follows 6,000 / followers 300', () => {
		const a = acc({ followsCount: 6000, followersCount: 300 });
		expect(evalClause(a, c, NOW)).toBe(true);
	});

	it('uses 1 as the divisor when followers is 0', () => {
		const a = acc({ followsCount: 6000, followersCount: 0 });
		expect(evalClause(a, c, NOW)).toBe(true);
	});

	it('is unknown when either count is missing', () => {
		expect(evalClause(acc({ followsCount: 6000 }), c, NOW)).toBeNull();
		expect(evalClause(acc({ followersCount: 300 }), c, NOW)).toBeNull();
	});
});

describe('gone', () => {
	const c: Clause = { kind: 'gone' };

	it('matches the three dead statuses and not blocked', () => {
		for (const status of ['deactivated', 'takendown', 'gone'] as const) {
			expect(matches(acc({ status }), { clauses: [c] }, NOW)).toBe(true);
		}
		expect(matches(acc({ status: 'blocked' }), { clauses: [c] }, NOW)).toBe(false);
		expect(matches(acc({ status: 'active' }), { clauses: [c] }, NOW)).toBe(false);
	});
});

describe('matches', () => {
	it('an empty spec matches every account', () => {
		expect(matches(acc(), { clauses: [] }, NOW)).toBe(true);
		expect(matches(acc({ status: 'gone', activity: null }), { clauses: [] }, NOW)).toBe(true);
	});

	it('ANDs all clauses', () => {
		const spec: FilterSpec = {
			clauses: [
				{ kind: 'followsMoreThan', n: 5000 },
				{ kind: 'ratioAbove', n: 10 }
			]
		};
		expect(matches(acc({ followsCount: 6000, followersCount: 300 }), spec, NOW)).toBe(true);
		expect(matches(acc({ followsCount: 6000, followersCount: 900 }), spec, NOW)).toBe(false);
	});

	it("neverPosted needs an empty activity sample: repost-only accounts don't match", () => {
		const c: Clause = { kind: 'neverPosted' };
		// Posts > 0 settles it.
		expect(matches(acc({ postsCount: 12 }), { clauses: [c] }, NOW)).toBe(false);
		// Zero posts but a non-empty sample (reposts only) is not "never posted".
		expect(
			matches(
				acc({
					postsCount: 0,
					activity: activity({
						sampleSize: 5,
						lastActiveAt: '2026-11-01T00:00:00.000Z',
						share: { post: 0, reply: 0, quote: 0, repost: 1 }
					})
				}),
				{ clauses: [c] },
				NOW
			)
		).toBe(false);
		// Zero posts and an empty, exhausted sample is "never posted".
		expect(matches(acc({ postsCount: 0, activity: activity() }), { clauses: [c] }, NOW)).toBe(true);
		// Unknown posts and an empty, exhausted sample is "never posted" too.
		expect(
			matches(
				acc({ postsCount: null, activity: activity({ sampleSize: 0, exhausted: true }) }),
				{ clauses: [c] },
				NOW
			)
		).toBe(true);
		// No activity sample yet: no match.
		expect(matches(acc({ postsCount: 0 }), { clauses: [c] }, NOW)).toBe(false);
		expect(matches(acc({ postsCount: null }), { clauses: [c] }, NOW)).toBe(false);
	});

	it('mostlyMedia is over half of the non-reposts', () => {
		const c: Clause = { kind: 'mostlyMedia', media: 'image' };
		const imgs = acc({
			activity: activity({ media: { text: 4, image: 9, video: 0, link: 0, quote: 0 } })
		});
		expect(evalClause(imgs, c, NOW)).toBe(true);
		const half = acc({
			activity: activity({ media: { text: 5, image: 5, video: 0, link: 0, quote: 0 } })
		});
		expect(evalClause(half, c, NOW)).toBe(false);
		const allReposts = acc({
			activity: activity({ media: { text: 0, image: 0, video: 0, link: 0, quote: 0 } })
		});
		expect(evalClause(allReposts, c, NOW)).toBe(false);
	});

	it('text is case-insensitive across handle, name and bio', () => {
		const c: Clause = { kind: 'text', q: 'RIVER' };
		expect(matches(acc({ handle: 'river-sky.bsky.social' }), { clauses: [c] }, NOW)).toBe(true);
		expect(matches(acc({ displayName: 'Rivera' }), { clauses: [c] }, NOW)).toBe(true);
		expect(matches(acc({ description: 'by the river' }), { clauses: [c] }, NOW)).toBe(true);
		expect(matches(acc(), { clauses: [c] }, NOW)).toBe(false);
	});

	it('inSet matches by did', () => {
		const c: Clause = {
			kind: 'inSet',
			dids: ['did:plc:one', 'did:plc:test'],
			label: 'Since your last scan'
		};
		expect(matches(acc(), { clauses: [c] }, NOW)).toBe(true);
		expect(matches(acc({ did: 'did:plc:other' }), { clauses: [c] }, NOW)).toBe(false);
	});
});

describe('describe', () => {
	it('renders the farm preset exactly', () => {
		const farm = CLEANUP_PRESETS.find((p) => p.id === 'farm');
		expect(farm).toBeDefined();
		expect(describeSpec(farm!.spec)).toBe(
			'Follows more than 5,000 · Follows 10× more than follow them'
		);
	});

	it('renders negated forms', () => {
		const notBack = CLEANUP_PRESETS.find((p) => p.id === 'notBack');
		expect(describeSpec(notBack!.spec)).toBe("Doesn't follow you back");
		const recent = LIST_PRESETS.find((p) => p.id === 'recent');
		expect(describeSpec(recent!.spec)).toBe('Followed in the last 30 days');
	});

	it('renders the interaction forms, 365 days as 12 months', () => {
		const c: FilterClause = { kind: 'noInteraction', days: 30 };
		expect(describeClause(c)).toBe('No interaction in 30 days');
		expect(describeClause({ kind: 'noInteraction', days: 365 })).toBe(
			'No interaction in 12 months'
		);
		expect(describeClause({ kind: 'noInteraction', days: 30, negate: true })).toBe(
			'Interacted in the last 30 days'
		);
		expect(describeClause({ kind: 'noInteraction', days: 365, negate: true })).toBe(
			'Interacted in the last 12 months'
		);
	});

	it('renders every noInteraction option in months, negated and not', () => {
		const spans: Array<[number, string]> = [
			[30, '30 days'],
			[90, '3 months'],
			[180, '6 months'],
			[365, '12 months']
		];
		for (const [days, span] of spans) {
			expect(describeClause({ kind: 'noInteraction', days }), span).toBe(
				`No interaction in ${span}`
			);
			expect(describeClause({ kind: 'noInteraction', days, negate: true }), span).toBe(
				`Interacted in the last ${span}`
			);
		}
	});

	it('renders the how-often filter for every offered threshold, negated and not', () => {
		for (const n of [3, 5, 10, 25]) {
			expect(describeClause({ kind: 'interactionsAtLeast', n }), String(n)).toBe(
				`${n}+ interactions in 12 months`
			);
			expect(describeClause({ kind: 'interactionsAtLeast', n, negate: true }), String(n)).toBe(
				`Under ${n} interactions in 12 months`
			);
		}
	});

	it('uses the singular word for one day and one word', () => {
		expect(describeClause({ kind: 'quiet', days: 1 })).toBe('No posts in 1 day');
		expect(describeClause({ kind: 'quiet', days: 1, negate: true })).toBe(
			'Posted in the last 1 day'
		);
		expect(describeClause({ kind: 'followedDaysAgo', days: 1 })).toBe('Followed over 1 day ago');
		expect(describeClause({ kind: 'noInteraction', days: 1 })).toBe('No interaction in 1 day');
		expect(describeClause({ kind: 'medianWordsAbove', n: 1 })).toBe(
			'Longer posts (median over 1 word)'
		);
	});

	it('renders the oneWay preset exactly', () => {
		const oneWay = CLEANUP_PRESETS.find((p) => p.id === 'oneWay');
		expect(oneWay).toBeDefined();
		expect(describeSpec(oneWay!.spec)).toBe(
			'Posted in the last 30 days · No interaction in 12 months'
		);
	});
});

describe('reasons', () => {
	it('returns one string per matched clause, in order', () => {
		const farm = CLEANUP_PRESETS.find((p) => p.id === 'farm');
		const a = acc({ followsCount: 6000, followersCount: 300 });
		expect(reasons(a, farm!.spec, NOW)).toEqual([
			'Follows more than 5,000',
			'Follows 10× more than follow them'
		]);
	});

	it('only lists the clauses that actually matched', () => {
		const farm = CLEANUP_PRESETS.find((p) => p.id === 'farm');
		const a = acc({ followsCount: 6000, followersCount: 900 });
		expect(reasons(a, farm!.spec, NOW)).toEqual(['Follows more than 5,000']);
	});

	it('skips clauses whose data is unknown', () => {
		const spec: FilterSpec = {
			clauses: [{ kind: 'followsYou', negate: true }, { kind: 'noAvatar' }]
		};
		const a = acc({ followsYou: null, avatar: null });
		expect(matches(a, spec, NOW)).toBe(false);
		expect(reasons(a, spec, NOW)).toEqual(['No avatar']);
	});
});

describe('presets', () => {
	it('every preset id resolves through presetById', () => {
		for (const p of [...CLEANUP_PRESETS, ...LIST_PRESETS]) {
			expect(presetById(p.id)?.name).toBe(p.name);
		}
		expect(presetById('nope')).toBeUndefined();
	});
});

describe('oneWay on the default demo', () => {
	const spec = presetById('oneWay')?.spec as FilterSpec;

	it('matches only active accounts', async () => {
		const nowMs = NOW.getTime();
		const data = generateDemoData(42, 850, nowMs);
		const src = new DemoSource(42, 850, nowMs);
		const { map } = await collectInteractions(src, src.did, NOW, undefined, () => {});
		const profileByDid = new Map(data.profiles.map((p) => [p.did, p]));
		const seen = new Set<string>();
		let matched = 0;
		for (const f of data.follows) {
			if (seen.has(f.did)) continue;
			seen.add(f.did);
			const profile = profileByDid.get(f.did);
			const feed = data.feeds.get(f.did);
			const status = feed === undefined ? 'gone' : feed.ok ? 'active' : feed.status;
			const row = acc({
				did: f.did,
				status,
				createdAt: profile?.createdAt ?? null,
				activity:
					feed !== undefined && feed.ok
						? summarizeActivity(feed.items, {
								now: NOW,
								exhausted: feed.exhausted,
								accountCreatedAt: profile?.createdAt ?? null
							})
						: null,
				interaction: map.get(f.did) ?? interaction()
			});
			if (matches(row, spec, NOW)) {
				matched += 1;
				expect(row.status, row.did).toBe('active');
			}
		}
		expect(matched).toBeGreaterThan(0);
	});
});

describe('Your regulars preset on the default demo', () => {
	const spec = presetById('regulars')?.spec as FilterSpec;

	it('matches exactly the accounts with 5 or more interactions', async () => {
		const nowMs = NOW.getTime();
		const data = generateDemoData(42, 850, nowMs);
		const src = new DemoSource(42, 850, nowMs);
		const { map } = await collectInteractions(src, src.did, NOW, undefined, () => {});
		const seen = new Set<string>();
		let matched = 0;
		let atLeast5 = 0;
		for (const f of data.follows) {
			if (seen.has(f.did)) continue;
			seen.add(f.did);
			const row = acc({
				did: f.did,
				status: 'active',
				interaction: map.get(f.did) ?? interaction()
			});
			// Count straight from the stored summary, not through the clause.
			const s = map.get(f.did);
			const n =
				s === undefined
					? 0
					: s.countsByKind['like'] +
						s.countsByKind['repost'] +
						s.countsByKind['reply'] +
						s.countsByKind['quote'] +
						s.countsByKind['mention'];
			if (n >= 5) atLeast5 += 1;
			if (matches(row, spec, NOW)) matched += 1;
		}
		expect(matched).toBe(atLeast5);
		// The demo's long tail has plenty of regulars.
		expect(atLeast5).toBeGreaterThanOrEqual(30);
	});
});
