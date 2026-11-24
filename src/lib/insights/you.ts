/**
 * Pure insight calculations about the signed-in account: the five "you"
 * cards. Everything that depends on the clock takes an explicit
 * `now` so tests control the date, matching `following.ts`.
 */
import type { EmbedKind } from '#lib/scan/classify';
import type { OwnFeedItem, ProfileLite } from '#lib/scan/source';
import type { FollowAccount } from '#lib/scan/types';
import { CONFIG } from '#lib/config';

const DAY = 86_400_000;

export interface YouSnapshot {
	followers: number;
	follows: number;
	posts: number;
	/** Whole days since account creation; 0 when the creation time is unknown. */
	accountAgeDays: number;
	/** followers ÷ follows; 0 when following nobody. */
	ratio: number;
	/** Share of the scanned follows (known only) that follow back, 0–1. Null when nothing is known. */
	followBackShare: number | null;
	/** How many scanned follows have an unknown follow-back status. */
	followBackUnknown: number;
}

export function snapshot(profile: ProfileLite, accounts: FollowAccount[], now: Date): YouSnapshot {
	const follows = profile.followsCount ?? 0;
	const followers = profile.followersCount ?? 0;
	const createdMs = profile.createdAt !== null ? Date.parse(profile.createdAt) : NaN;
	const accountAgeDays = Number.isNaN(createdMs)
		? 0
		: Math.max(0, Math.floor((now.getTime() - createdMs) / DAY));
	let known = 0;
	let back = 0;
	let unknown = 0;
	for (const a of accounts) {
		if (a.followsYou === null) {
			unknown += 1;
			continue;
		}
		known += 1;
		if (a.followsYou) back += 1;
	}
	return {
		followers,
		follows,
		posts: profile.postsCount ?? 0,
		accountAgeDays,
		ratio: follows === 0 ? 0 : followers / follows,
		followBackShare: known === 0 ? null : back / known,
		followBackUnknown: unknown
	};
}

/**
 * The "at a glance" follow-back line. The share counts only the follows
 * whose status is known, so when some are unknown, say that.
 */
export function followBackLine(share: number | null, unknown: number): string | null {
	if (share === null) return null;
	const pct = Math.round(share * 100);
	return unknown > 0
		? `${pct}% of the people TidySky could check follow you back.`
		: `${pct}% of the people you follow follow you back.`;
}

/**
 * Weekday × hour grid of one's own activity, [7][24] in the device's local
 * time, Sunday = 0: the same counting as `summarizeActivity`'s grid.
 */
export function myPostingGrid(items: OwnFeedItem[]): number[][] {
	const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
	for (const item of items) {
		const d = new Date(item.at);
		grid[d.getDay()][d.getHours()] += 1;
	}
	return grid;
}

export interface YouMix {
	/** 0–1 shares of the sample, all items. */
	share: { post: number; reply: number; quote: number; repost: number };
	/** Counts, non-reposts only. */
	media: { text: number; image: number; video: number; link: number; quote: number };
}

/** Kind shares and media counts of one's own feed, like `summarizeActivity`. */
export function myMix(items: OwnFeedItem[]): YouMix {
	const n = items.length;
	const counts = { post: 0, reply: 0, quote: 0, repost: 0 };
	for (const item of items) counts[item.kind] += 1;
	const media = { text: 0, image: 0, video: 0, link: 0, quote: 0 };
	for (const item of items) if (item.kind !== 'repost') media[item.embed] += 1;
	return {
		share: {
			post: n === 0 ? 0 : counts.post / n,
			reply: n === 0 ? 0 : counts.reply / n,
			quote: n === 0 ? 0 : counts.quote / n,
			repost: n === 0 ? 0 : counts.repost / n
		},
		media
	};
}

export interface TopPost {
	uri: string;
	/** First 120 chars of the post text; cut at a word boundary with an ellipsis when longer. */
	text: string;
	/** First 120 chars of the first media alt text, when the post has one; cut the same way. */
	alt: string | null;
	embed: EmbedKind;
	likes: number;
	reposts: number;
	replies: number;
	/** bsky.app link to the post. */
	url: string;
}

export interface YouEngagement {
	medianLikes: number;
	medianReposts: number;
	medianReplies: number;
	/** How many own originals the medians are over. */
	sample: number;
	/** Top 3 by likes, then reposts, then URI. */
	top3: TopPost[];
}

/**
 * Cut `text` to `limit` chars for display. Text that fits is unchanged;
 * longer text is cut at the last whole word within the limit (a hard cut
 * when the limit holds no space) and gets an ellipsis, so it is visibly
 * shortened.
 */
export function shorten(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const cut = text.slice(0, limit);
	const space = cut.lastIndexOf(' ');
	return (space > 0 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

function median(xs: number[]): number {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * How one's posts land. Over own originals only: reposts are excluded, as
 * are items whose author is not `ownDid` (the author feed should not return
 * them, but the guard costs nothing).
 */
export function engagement(items: OwnFeedItem[], ownDid: string): YouEngagement {
	const originals = items.filter((i) => i.kind !== 'repost' && i.author === ownDid);
	const top3: TopPost[] = [...originals]
		.sort(
			(a, b) =>
				b.likeCount - a.likeCount || b.repostCount - a.repostCount || a.uri.localeCompare(b.uri)
		)
		.slice(0, 3)
		.map((i) => ({
			uri: i.uri,
			text: shorten(i.text, 120),
			alt: i.alt !== undefined ? shorten(i.alt, 120) : null,
			embed: i.embed,
			likes: i.likeCount,
			reposts: i.repostCount,
			replies: i.replyCount,
			url: `https://bsky.app/profile/${ownDid}/post/${i.uri.split('/').pop() ?? ''}`
		}));
	return {
		medianLikes: median(originals.map((i) => i.likeCount)),
		medianReposts: median(originals.map((i) => i.repostCount)),
		medianReplies: median(originals.map((i) => i.replyCount)),
		sample: originals.length,
		top3
	};
}

/**
 * The row's first line for a post with no text: the first media alt text, or,
 * when the post has none, a label naming the embed kind.
 */
export function topPostLine(alt: string | null, embed: EmbedKind): string {
	if (alt !== null && alt.length > 0) return alt;
	switch (embed) {
		case 'image':
			return 'Image post';
		case 'video':
			return 'Video post';
		case 'link':
			return 'Link post';
		case 'quote':
			return 'Quote post';
		default:
			return 'Post';
	}
}

export interface YouFollowerMix {
	total: number;
	noPosts: number;
	farmLook: number;
	labeled: number;
}

/**
 * The follower sample in four exclusive buckets, counted in this priority:
 * no posts yet, then follow-farm look (over 5,000 follows and more than 10×
 * the followers), then a moderation label; everything else is "everyone
 * else" = total − these three. A null posts count is unknown, not zero.
 */
export function followerMix(profiles: ProfileLite[]): YouFollowerMix {
	let noPosts = 0;
	let farmLook = 0;
	let labeled = 0;
	for (const p of profiles) {
		if (p.postsCount === 0) {
			noPosts += 1;
			continue;
		}
		const follows = p.followsCount ?? 0;
		const followers = p.followersCount ?? 0;
		if (follows > 5000 && (followers === 0 ? follows > 0 : follows / followers > 10)) {
			farmLook += 1;
			continue;
		}
		if (p.labels.length > 0) labeled += 1;
	}
	return { total: profiles.length, noPosts, farmLook, labeled };
}

export interface FollowerCardCopy {
	title: string;
	footnote: string;
	/** The aria label's lead-in, before the mix counts. */
	aria: string;
}

/**
 * The title, footnote and aria lead-in of the "who follows you" card. The
 * completeness comes from the fetch: `complete` is true when getFollowers
 * ran out of followers before the sample cap, and the follower count can be
 * higher still, because it includes accounts Bluesky can't show, like
 * suspended or deactivated ones. Cached data without the flag falls back to
 * the count rule (all when the count is within the sample size); otherwise
 * only the newest were checked. The title carries no number in either case:
 * Bluesky leaves some of the checked followers out, so the bars count fewer
 * than the sample and a "(newest 300)" title reads as a mistake.
 */
export function followerCardCopy(
	followers: number,
	checked: number,
	complete?: boolean
): FollowerCardCopy {
	if (complete === true || followers <= CONFIG.youFollowersSample) {
		return {
			title: 'Who follows you',
			footnote: `All ${checked} of your followers. Your follower count can be higher because it includes accounts Bluesky can't show, like suspended or deactivated ones.`,
			aria: `All ${checked} of your followers`
		};
	}
	const checkedLine =
		checked === CONFIG.youFollowersSample
			? `TidySky checks your ${CONFIG.youFollowersSample} newest followers.`
			: `TidySky checks your ${CONFIG.youFollowersSample} newest followers. Bluesky leaves out accounts it can't show, like suspended or deactivated ones, so ${checked} are counted here.`;
	return {
		title: 'Who follows you',
		footnote: checkedLine,
		aria:
			checked === CONFIG.youFollowersSample
				? `TidySky checked your ${CONFIG.youFollowersSample} newest followers`
				: `TidySky checked your ${CONFIG.youFollowersSample} newest followers; ${checked} were counted`
	};
}
