import { describe, expect, it } from 'vitest';

import type { OwnFeedItem, ProfileLite } from '#lib/scan/source';
import type { FollowAccount } from '#lib/scan/types';

import {
	engagement,
	followBackLine,
	followerCardCopy,
	followerMix,
	myMix,
	myPostingGrid,
	shorten,
	snapshot,
	topPostLine
} from './you';

const NOW = new Date(2026, 10, 6); // 6 Nov 2026, local
const ME = 'did:plc:me';
const DAY = 86_400_000;

function item(over: Partial<OwnFeedItem> = {}): OwnFeedItem {
	return {
		uri: `at://${ME}/app.bsky.feed.post/r1`,
		author: ME,
		kind: 'post',
		at: new Date(2026, 9, 1, 12).toISOString(),
		embed: 'text',
		text: 'hello',
		likeCount: 0,
		repostCount: 0,
		replyCount: 0,
		quoteCount: 0,
		...over
	};
}

function profile(over: Partial<ProfileLite> = {}): ProfileLite {
	return {
		did: ME,
		handle: 'me.bsky.social',
		displayName: null,
		avatar: null,
		description: null,
		createdAt: new Date(2022, 10, 6).toISOString(),
		followersCount: null,
		followsCount: null,
		postsCount: null,
		followsYou: null,
		labels: [],
		...over
	};
}

function acct(over: Partial<FollowAccount> = {}): FollowAccount {
	return {
		did: 'did:plc:a',
		handle: 'a.bsky.social',
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

describe('snapshot', () => {
	it('computes counts, ratio, age and the known-only follow-back share', () => {
		const s = snapshot(
			profile({
				createdAt: new Date(NOW.getTime() - 730 * DAY).toISOString(),
				followersCount: 1200,
				followsCount: 800,
				postsCount: 2400
			}),
			[
				acct({ followsYou: true }),
				acct({ followsYou: true }),
				acct({ followsYou: false }),
				acct({ followsYou: null })
			],
			NOW
		);
		expect(s.followers).toBe(1200);
		expect(s.follows).toBe(800);
		expect(s.posts).toBe(2400);
		expect(s.accountAgeDays).toBe(730);
		expect(s.ratio).toBeCloseTo(1.5);
		expect(s.followBackShare).toBeCloseTo(2 / 3);
		expect(s.followBackUnknown).toBe(1);
	});

	it('is safe with null counts and no known follow-backs', () => {
		const s = snapshot(profile(), [acct({ followsYou: null }), acct()], NOW);
		expect(s.followers).toBe(0);
		expect(s.ratio).toBe(0);
		expect(s.followBackShare).toBeNull();
		expect(s.followBackUnknown).toBe(2);
	});

	it('is null when nothing is known and a share when anything is', () => {
		const s = snapshot(profile(), [acct(), acct({ followsYou: null })], NOW);
		expect(s.followBackShare).toBeNull();
		const s2 = snapshot(
			profile(),
			[
				acct({ followsYou: true }),
				acct({ followsYou: true }),
				acct({ followsYou: false }),
				acct({ followsYou: false })
			],
			NOW
		);
		expect(s2.followBackShare).toBeCloseTo(0.5);
		expect(s2.followBackUnknown).toBe(0);
	});
});

describe('followBackLine', () => {
	it('counts everything when no status is unknown', () => {
		expect(followBackLine(0.7, 0)).toBe('70% of the people you follow follow you back.');
	});

	it('says what the percentage counts when some statuses are unknown', () => {
		expect(followBackLine(0.7, 40)).toBe('70% of the people TidySky could check follow you back.');
	});

	it('is null when nothing is known', () => {
		expect(followBackLine(null, 10)).toBeNull();
	});
});

describe('myPostingGrid', () => {
	it('counts items in their local weekday and hour', () => {
		// 2 Nov 2026 is a Monday; local times are timezone-stable.
		const grid = myPostingGrid([
			item({ at: new Date(2026, 10, 2, 21).toISOString() }),
			item({ at: new Date(2026, 10, 2, 21).toISOString(), kind: 'repost' }),
			item({ at: new Date(2026, 10, 3, 8).toISOString() })
		]);
		expect(grid.flat().reduce((s, v) => s + v, 0)).toBe(3);
		expect(grid[1][21]).toBe(2); // Monday 9pm, reposts included
		expect(grid[2][8]).toBe(1); // Tuesday 8am
		expect(grid[0][12]).toBe(0);
	});
});

describe('myMix', () => {
	it('shares are over all items, media counts over non-reposts', () => {
		const mix = myMix([
			item(),
			item({ kind: 'reply' }),
			item({ kind: 'quote', embed: 'quote' }),
			item({ kind: 'repost', embed: 'image' })
		]);
		expect(mix.share).toEqual({ post: 0.25, reply: 0.25, quote: 0.25, repost: 0.25 });
		expect(mix.media).toEqual({ text: 2, image: 0, video: 0, link: 0, quote: 1 });
	});

	it('is zero on an empty sample', () => {
		expect(myMix([]).share).toEqual({ post: 0, reply: 0, quote: 0, repost: 0 });
	});
});

describe('engagement', () => {
	it('medians with odd counts', () => {
		const e = engagement(
			[1, 2, 3, 4, 10].map((likes, i) =>
				item({ uri: `at://${ME}/app.bsky.feed.post/r${i}`, likeCount: likes })
			),
			ME
		);
		expect(e.medianLikes).toBe(3);
		expect(e.sample).toBe(5);
	});

	it('medians with even counts average the middle two', () => {
		const e = engagement(
			[1, 2, 3, 10].map((likes, i) =>
				item({ uri: `at://${ME}/app.bsky.feed.post/r${i}`, likeCount: likes })
			),
			ME
		);
		expect(e.medianLikes).toBe(2.5);
	});

	it('excludes reposts and items not authored by you', () => {
		const e = engagement(
			[
				item({ likeCount: 100 }),
				item({ kind: 'repost', likeCount: 5000 }),
				item({
					uri: 'at://did:plc:other/app.bsky.feed.post/x',
					author: 'did:plc:other',
					likeCount: 5000
				})
			],
			ME
		);
		expect(e.sample).toBe(1);
		expect(e.medianLikes).toBe(100);
		expect(e.top3).toHaveLength(1);
	});

	it('top 3 sorts by likes, then reposts, then URI; long text is cut at a word with an ellipsis', () => {
		const longText = 'w'.repeat(200);
		const e = engagement(
			[
				item({ uri: 'at://did:plc:me/app.bsky.feed.post/b', likeCount: 5 }),
				item({
					uri: 'at://did:plc:me/app.bsky.feed.post/a',
					likeCount: 5,
					repostCount: 2,
					text: 'short'
				}),
				item({ uri: 'at://did:plc:me/app.bsky.feed.post/c', likeCount: 9, text: longText }),
				item({ uri: 'at://did:plc:me/app.bsky.feed.post/d', likeCount: 1 }),
				item({ uri: 'at://did:plc:me/app.bsky.feed.post/e', likeCount: 5, repostCount: 0 })
			],
			ME
		);
		expect(e.top3.map((p) => p.uri.split('/').pop())).toEqual(['c', 'a', 'b']);
		// One long word with no spaces: a hard cut at 120, then the ellipsis.
		expect(e.top3[0].text).toBe('w'.repeat(120) + '…');
		expect(e.top3[1].url).toBe('https://bsky.app/profile/did:plc:me/post/a');
	});

	it('carries the first media alt, cut the same way', () => {
		const e = engagement(
			[
				item({ uri: `at://${ME}/app.bsky.feed.post/a`, embed: 'image', alt: ' '.repeat(200) }),
				item({ uri: `at://${ME}/app.bsky.feed.post/b`, embed: 'text', text: '' })
			],
			ME
		);
		// Nothing but spaces: the cut word is empty, so only the ellipsis.
		expect(e.top3[0].alt).toBe('…');
		expect(e.top3[1].alt).toBeNull();
		expect(e.top3[1].embed).toBe('text');
	});
});

describe('shorten', () => {
	it('leaves text at the limit unchanged', () => {
		expect(shorten('w'.repeat(120), 120)).toBe('w'.repeat(120));
		expect(shorten('a shorter post', 120)).toBe('a shorter post');
	});

	it('cuts longer text at the last whole word within the limit and adds an ellipsis', () => {
		const text = 'the quick brown fox jumps over the lazy dog and keeps going for a while';
		const s = shorten(text, 20);
		expect(s).toBe('the quick brown fox…');
		expect(s.endsWith('…')).toBe(true);
		// The cut is at a word boundary of the original, never mid-word.
		expect(text.startsWith(s.slice(0, -1).trimEnd())).toBe(true);
	});

	it('hard-cuts one long word with no spaces', () => {
		expect(shorten('x'.repeat(130), 120)).toBe('x'.repeat(120) + '…');
	});
});

describe('topPostLine', () => {
	it('shows the alt text when the post has one', () => {
		expect(topPostLine('a dog in a field', 'image')).toBe('a dog in a field');
	});

	it('labels the embed kind when there is no alt', () => {
		expect(topPostLine(null, 'image')).toBe('Image post');
		expect(topPostLine(null, 'video')).toBe('Video post');
		expect(topPostLine(null, 'link')).toBe('Link post');
		expect(topPostLine(null, 'quote')).toBe('Quote post');
		// A text post with no text at all: a plain label.
		expect(topPostLine(null, 'text')).toBe('Post');
	});

	it('treats an empty alt as no alt', () => {
		expect(topPostLine('', 'image')).toBe('Image post');
	});
});

describe('followerMix', () => {
	it('buckets are exclusive and in priority order', () => {
		const m = followerMix([
			// no posts beats farm and label
			profile({ postsCount: 0, followsCount: 9000, followersCount: 1, labels: ['spam'] }),
			// farm beats label
			profile({ postsCount: 10, followsCount: 6000, followersCount: 100, labels: ['spam'] }),
			profile({ postsCount: 10, followsCount: 6000, followersCount: 500 }),
			profile({ postsCount: 10, followsCount: 100, followersCount: 10, labels: ['impersonation'] }),
			profile({ postsCount: 10, followsCount: 100, followersCount: 10 }),
			// null posts count is unknown, not no-posts: 7000/0 is a farm
			profile({ postsCount: null, followsCount: 7000, followersCount: 0 })
		]);
		expect(m.total).toBe(6);
		expect(m.noPosts).toBe(1);
		expect(m.farmLook).toBe(3);
		expect(m.labeled).toBe(1);
	});

	it('the farm ratio must be strictly above 10 and follows strictly above 5000', () => {
		expect(
			followerMix([profile({ postsCount: 1, followsCount: 5000, followersCount: 100 })])
		).toEqual({
			total: 1,
			noPosts: 0,
			farmLook: 0,
			labeled: 0
		});
		// Ratio exactly 10 is not a farm: the rule is strictly above.
		expect(
			followerMix([profile({ postsCount: 1, followsCount: 5100, followersCount: 510 })])
		).toEqual({
			total: 1,
			noPosts: 0,
			farmLook: 0,
			labeled: 0
		});
		expect(
			followerMix([profile({ postsCount: 1, followsCount: 5001, followersCount: 499 })]).farmLook
		).toBe(1);
	});
});

describe('followerCardCopy', () => {
	it('says all when the fetch ran out of followers, even far above the sample size', () => {
		const c = followerCardCopy(1200, 300, true);
		expect(c.title).toBe('Who follows you');
		expect(c.footnote).toBe(
			"All 300 of your followers. Your follower count can be higher because it includes accounts Bluesky can't show, like suspended or deactivated ones."
		);
		expect(c.aria).toBe('All 300 of your followers');
	});

	it('names the checked sample and the counted bars when followers were left out', () => {
		const c = followerCardCopy(1234, 216, false);
		expect(c.title).toBe('Who follows you');
		expect(c.footnote).toBe(
			"TidySky checks your 300 newest followers. Bluesky leaves out accounts it can't show, like suspended or deactivated ones, so 216 are counted here."
		);
		expect(c.aria).toBe('TidySky checked your 300 newest followers; 216 were counted');
	});

	it('says only the checked sample when none were left out', () => {
		const c = followerCardCopy(1234, 300, false);
		expect(c.title).toBe('Who follows you');
		expect(c.footnote).toBe('TidySky checks your 300 newest followers.');
		expect(c.aria).toBe('TidySky checked your 300 newest followers');
	});

	it('falls back to the count rule for data without the flag', () => {
		const all = followerCardCopy(218, 218);
		expect(all.title).toBe('Who follows you');
		expect(all.footnote).toBe(
			"All 218 of your followers. Your follower count can be higher because it includes accounts Bluesky can't show, like suspended or deactivated ones."
		);
		expect(all.aria).toBe('All 218 of your followers');
		// A few under the count: still all, the count rule only compares sizes.
		expect(followerCardCopy(300, 297).footnote).toContain('All 297 of your followers');
		// Over the count: the sample wording, no number in the title.
		expect(followerCardCopy(1234, 300).title).toBe('Who follows you');
	});
});
