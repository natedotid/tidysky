import { describe, expect, it } from 'vitest';

import type { FollowAccount } from '#lib/scan/types';

import { buildPreview } from './preview';

const DAY = 86_400_000;
const NOW = Date.now();
const daysAgo = (d: number): string => new Date(NOW - d * DAY).toISOString();

function viewer(
	over: Partial<NonNullable<FollowAccount['viewer']>> = {}
): NonNullable<FollowAccount['viewer']> {
	return {
		mutedByList: null,
		blockingByList: null,
		blockedBy: false,
		blockingPersonally: false,
		knownFollowers: null,
		...over
	};
}

function acc(over: Partial<FollowAccount> = {}): FollowAccount {
	return {
		did: 'did:plc:test',
		handle: 'test.bsky.social',
		displayName: 'Test Person',
		avatar: null,
		description: null,
		followRkeys: [],
		followedAt: daysAgo(3 * 365),
		createdAt: '2021-05-10T00:00:00.000Z',
		followersCount: 12000,
		followsCount: 250,
		postsCount: 4800,
		followsYou: true,
		viewer: viewer(),
		labels: [],
		status: 'active',
		activity: null,
		profileScannedAt: null,
		activityScannedAt: null,
		interaction: null,
		...over
	};
}

const activity = {
	sampleSize: 30,
	exhausted: false,
	lastActiveAt: daysAgo(2),
	lastPostAt: daysAgo(2),
	itemsPerDay: 3,
	share: { post: 0.45, reply: 0.2, quote: 0, repost: 0.35 },
	media: { text: 20, image: 5, video: 2, link: 3, quote: 0 },
	weekdayHour: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)),
	topLangs: [
		['en', 24],
		['es', 6]
	] as Array<[string, number]>,
	medianWords: 40
};

describe('buildPreview', () => {
	it('shows everything a full account knows', () => {
		const p = buildPreview(
			acc({
				followersCount: 12345,
				description: 'Line one.\nLine two.',
				activity,
				interaction: {
					lastAt: daysAgo(3),
					lastKind: 'like',
					lastByKind: { like: daysAgo(3), repost: null, reply: null, quote: null, mention: null },
					countsByKind: { like: 3, repost: 0, reply: 1, quote: 0, mention: 0 }
				}
			}),
			{ kind: 'full' }
		);
		expect(p.title).toBe('Test Person');
		expect(p.handle).toBe('test.bsky.social');
		expect(p.bio).toBe('Line one.\nLine two.');
		expect(p.profileHref).toBe('https://bsky.app/profile/test.bsky.social');
		expect(p.why).toEqual([]);
		const fact = (label: string) => p.facts.find((f) => f.label === label);
		expect(fact('Followers')?.value).toBe('12k');
		expect(fact('Following')?.value).toBe('250');
		expect(fact('Posts')?.value).toBe('4.8k');
		expect(fact('Follows you')?.value).toBe('Yes');
		// The viewer was read but knows no mutuals.
		expect(fact('Followed by people you follow')?.value).toBe('Unknown');
		// Relative date plus month and year.
		expect(fact('You followed them')?.value).toMatch(/^3y ago \(/);
		expect(fact('Account created')?.value).toMatch(/2021$/);
		expect(p.activity).toMatchObject({
			kind: 'data',
			lastActive: '2d ago',
			perDay: '3/day',
			// 0% quotes are left out. Parts stay separate so the sheet can wrap
			// only between items.
			mix: ['45% posts', '20% replies', '35% reposts'],
			languages: 'en, es',
			sampleSize: 30
		});
		expect(p.interaction).toEqual({
			kind: 'data',
			last: 'Liked 3d ago',
			counts: '3 likes · 1 reply in the last 12 months',
			none: null
		});
	});

	it('says "None" for a viewer that read zero mutuals', () => {
		const p = buildPreview(acc({ viewer: viewer({ knownFollowers: 0 }) }), { kind: 'full' });
		expect(p.facts.find((f) => f.label === 'Followed by people you follow')?.value).toBe('None');
	});

	it('leaves out the mutuals fact when the viewer was never read', () => {
		const p = buildPreview(acc({ viewer: null }), { kind: 'full' });
		expect(p.facts.some((f) => f.label === 'Followed by people you follow')).toBe(false);
	});

	it('reports no activity when the sample was never read', () => {
		const p = buildPreview(acc({ activity: null }), { kind: 'full' });
		expect(p.activity).toEqual({ kind: 'none' });
	});

	it('omits the You-and-them section when the interaction check has not run', () => {
		const p = buildPreview(acc({ interaction: null }), { kind: 'full' });
		expect(p.interaction).toEqual({ kind: 'unchecked' });
	});

	it('flags a gone account with the row wording', () => {
		const p = buildPreview(acc({ status: 'gone' }), { kind: 'full' });
		expect(p.why).toEqual([{ text: 'Gone', href: null }]);
	});

	it('falls back to the DID for a dead account with an empty handle', () => {
		// Dead accounts store handle: '' and displayName: null; an empty
		// title would leave the sheet untitled and its aria-labels blank.
		const p = buildPreview(acc({ handle: '', displayName: null, status: 'gone' }), {
			kind: 'full'
		});
		expect(p.title).toBe('did:plc:test');
		expect(p.handle).toBe('');
		expect(p.profileHref).toBe('https://bsky.app/profile/did:plc:test');
	});

	it('flags a deactivated account as "Deactivated" and a takedown as "Suspended"', () => {
		expect(buildPreview(acc({ status: 'deactivated' }), { kind: 'full' }).why[0]?.text).toBe(
			'Deactivated'
		);
		expect(buildPreview(acc({ status: 'takendown' }), { kind: 'full' }).why[0]?.text).toBe(
			'Suspended'
		);
	});

	it('links a hidden-by-list account to the list on Bluesky', () => {
		const p = buildPreview(
			acc({
				viewer: viewer({
					mutedByList: {
						uri: 'at://did:plc:owner/app.bsky.graph.list/rkey1',
						name: 'Sports spoilers'
					},
					blockingByList: {
						uri: 'at://did:plc:owner/app.bsky.graph.list/rkey2',
						name: 'Reply guys'
					}
				})
			}),
			{ kind: 'full' }
		);
		expect(p.why).toEqual([
			{
				text: 'Muted by list: Sports spoilers',
				href: 'https://bsky.app/profile/did:plc:owner/lists/rkey1'
			},
			{
				text: 'Blocked by list: Reply guys',
				href: 'https://bsky.app/profile/did:plc:owner/lists/rkey2'
			}
		]);
	});

	it('flags an account that blocks you', () => {
		const p = buildPreview(acc({ viewer: viewer({ blockedBy: true }) }), { kind: 'full' });
		expect(p.why).toEqual([{ text: 'Blocks you', href: null }]);
	});

	it('flags every label value', () => {
		const p = buildPreview(acc({ labels: ['spam', 'impersonation'] }), { kind: 'full' });
		expect(p.why).toEqual([
			{ text: 'Has a label: spam', href: null },
			{ text: 'Has a label: impersonation', href: null }
		]);
	});

	it('uses the singular for counts of one', () => {
		const p = buildPreview(
			acc({
				interaction: {
					lastAt: daysAgo(10),
					lastKind: 'reply',
					lastByKind: { like: null, repost: null, reply: daysAgo(10), quote: null, mention: null },
					countsByKind: { like: 1, repost: 0, reply: 1, quote: 0, mention: 1 }
				}
			}),
			{ kind: 'full' }
		);
		expect(p.interaction).toMatchObject({
			last: 'Replied 10d ago',
			counts: '1 like · 1 reply · 1 mention in the last 12 months'
		});
	});

	it('uses the window wording when nothing happened in the window', () => {
		const none = {
			lastAt: null,
			lastKind: null,
			lastByKind: { like: null, repost: null, reply: null, quote: null, mention: null },
			countsByKind: { like: 0, repost: 0, reply: 0, quote: 0, mention: 0 }
		};
		expect(buildPreview(acc({ interaction: none }), { kind: 'full' }).interaction).toMatchObject({
			counts: null,
			none: 'None in 12 months'
		});
		expect(
			buildPreview(acc({ interaction: none }), { kind: 'joined', at: daysAgo(200) }).interaction
		).toMatchObject({ counts: null, none: 'None since you joined' });
	});

	it('names the window start in the counts line when the read was capped', () => {
		const p = buildPreview(
			acc({
				interaction: {
					lastAt: daysAgo(20),
					lastKind: 'repost',
					lastByKind: { like: null, repost: daysAgo(20), reply: null, quote: null, mention: null },
					countsByKind: { like: 0, repost: 2, reply: 0, quote: 0, mention: 0 }
				}
			}),
			// Local noon: a UTC-midnight date reads as the previous month in
			// timezones behind UTC.
			{ kind: 'capped', at: '2026-03-15T12:00:00' }
		);
		expect(p.interaction).toMatchObject({
			last: 'Reposted 20d ago',
			counts: '2 reposts since Mar 2026'
		});
	});
});
