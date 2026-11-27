/**
 * Pure insight calculations over the scanned follows: the eight "people you
 * follow" cards. Every function that depends on the clock takes an
 * explicit `now` so tests control the date.
 */
import { CONFIG } from '#lib/config';
import { plural } from '#lib/format';
import type { FollowAccount } from '#lib/scan/types';

const DAY = 86_400_000;

export interface FeedShare {
	/** Sum of itemsPerDay over the active accounts. */
	total: number;
	/** Top 10 by share, largest first. */
	top: Array<{ account: FollowAccount; share: number }>;
	/** Smallest k whose combined share of the top k is at least 50%. */
	halfCount: number;
}

/** Who fills the feed: shares of the combined items-per-day, top 10. */
export function feedShare(accounts: FollowAccount[]): FeedShare {
	const active = accounts
		.map((a) => ({ account: a, ipd: a.activity?.itemsPerDay ?? 0 }))
		.filter((x) => x.ipd > 0);
	const total = active.reduce((s, x) => s + x.ipd, 0);
	const sorted = [...active].sort(
		(a, b) => b.ipd - a.ipd || a.account.did.localeCompare(b.account.did)
	);
	let halfCount = 0;
	let cum = 0;
	for (const x of sorted) {
		if (total === 0) break;
		cum += x.ipd / total;
		halfCount += 1;
		if (cum >= 0.5) break;
	}
	return {
		total,
		top: sorted.slice(0, 10).map((x) => ({ account: x.account, share: x.ipd / total })),
		halfCount
	};
}

export interface ActivityBuckets {
	active7: number;
	active30: number;
	active90: number;
	quiet: number;
	never: number;
	gone: number;
	unknown: number;
}

/**
 * Every account lands in exactly one bucket: gone statuses first, then
 * accounts with no usable activity (none yet, blocked, unknown), then the
 * age of the newest item. No items in the sample but the profile says they
 * have posted → quiet; no items and no posts → never.
 */
export function activityBuckets(accounts: FollowAccount[], now: Date): ActivityBuckets {
	const b: ActivityBuckets = {
		active7: 0,
		active30: 0,
		active90: 0,
		quiet: 0,
		never: 0,
		gone: 0,
		unknown: 0
	};
	for (const a of accounts) {
		if (a.status === 'deactivated' || a.status === 'takendown' || a.status === 'gone') {
			b.gone += 1;
			continue;
		}
		if (a.activity === null || a.status === 'blocked' || a.status === 'unknown') {
			b.unknown += 1;
			continue;
		}
		const last = a.activity.lastActiveAt;
		if (last !== null) {
			const ageDays = (now.getTime() - new Date(last).getTime()) / DAY;
			if (ageDays <= 7) b.active7 += 1;
			else if (ageDays <= 30) b.active30 += 1;
			else if (ageDays <= 90) b.active90 += 1;
			else b.quiet += 1;
			continue;
		}
		if ((a.postsCount ?? 0) > 0) b.quiet += 1;
		else b.never += 1;
	}
	return b;
}

export interface InteractionBuckets {
	/** Checked, interacted in the last 30 days. */
	in30: number;
	/** Checked, 31 to 90 days. */
	in31To90: number;
	/** Checked, 91 days to 12 months. */
	in91To365: number;
	/** Checked, no interaction in the window. */
	none: number;
	/** Active accounts not checked yet. */
	unchecked: number;
	/** Checked active accounts, the headline's N. */
	checked: number;
}

/**
 * How often the user interacted with each active account, by age of the
 * newest one. Non-active accounts are ignored entirely: you can't interact
 * with a deleted account, so counting it as "none" would inflate the
 * headline.
 */
export function interactionBuckets(accounts: FollowAccount[], now: Date): InteractionBuckets {
	const b: InteractionBuckets = {
		in30: 0,
		in31To90: 0,
		in91To365: 0,
		none: 0,
		unchecked: 0,
		checked: 0
	};
	for (const a of accounts) {
		if (a.status !== 'active') continue;
		const ix = a.interaction;
		if (ix === null) {
			b.unchecked += 1;
			continue;
		}
		b.checked += 1;
		if (ix.lastAt === null) {
			b.none += 1;
			continue;
		}
		const ageDays = (now.getTime() - Date.parse(ix.lastAt)) / DAY;
		if (ageDays <= 30) b.in30 += 1;
		else if (ageDays <= 90) b.in31To90 += 1;
		else b.in91To365 += 1;
	}
	return b;
}

/** Active accounts (itemsPerDay > 0), busiest first, top n. */
export function mostActive(accounts: FollowAccount[], n: number): FollowAccount[] {
	return accounts
		.filter((a) => a.activity !== null && a.activity.itemsPerDay > 0)
		.sort(
			(a, b) =>
				(b.activity?.itemsPerDay ?? 0) - (a.activity?.itemsPerDay ?? 0) ||
				a.did.localeCompare(b.did)
		)
		.slice(0, n);
}

/**
 * An account's interaction count: the plain total of likes, reposts, replies,
 * quotes and mentions in the 12-month window, with no weighting. Null when
 * the account hasn't been checked.
 */
export function interactionCount(a: FollowAccount): number | null {
	const ix = a.interaction;
	if (ix === null) return null;
	return (
		ix.countsByKind['like'] +
		ix.countsByKind['repost'] +
		ix.countsByKind['reply'] +
		ix.countsByKind['quote'] +
		ix.countsByKind['mention']
	);
}

/** The n quietest of the still-active accounts, ascending. */
export function leastActive(accounts: FollowAccount[], n: number): FollowAccount[] {
	return [...mostActive(accounts, accounts.length)].reverse().slice(0, n);
}

/**
 * The n active accounts you interacted with most, most interactions first,
 * ties by the more recent last interaction, then DID. Only checked accounts
 * with at least one interaction qualify; unchecked ones are not "least".
 */
export function mostInteracted(accounts: FollowAccount[], n: number): FollowAccount[] {
	const rows = accounts
		.map((a) => ({ a, c: interactionCount(a) }))
		.filter(
			(x): x is { a: FollowAccount; c: number } =>
				x.a.status === 'active' && x.c !== null && x.c >= 1
		);
	rows.sort(
		(x, y) =>
			y.c - x.c ||
			// c >= 1 implies a lastAt exists; the fallback is unreachable.
			Date.parse(y.a.interaction?.lastAt ?? '1970-01-01T00:00:00Z') -
				Date.parse(x.a.interaction?.lastAt ?? '1970-01-01T00:00:00Z') ||
			x.a.did.localeCompare(y.a.did)
	);
	return rows.slice(0, n).map((x) => x.a);
}

/**
 * The n least-interacted active (posting) accounts you follow, fewest
 * interactions first, ties by the busier account, then DID. Only checked
 * accounts qualify.
 */
export function leastInteracted(accounts: FollowAccount[], n: number): FollowAccount[] {
	const rows = accounts
		.map((a) => ({ a, c: interactionCount(a) }))
		.filter(
			(x): x is { a: FollowAccount; c: number } =>
				x.a.status === 'active' && x.a.interaction !== null && (x.a.activity?.itemsPerDay ?? 0) > 0
		);
	rows.sort(
		(x, y) =>
			x.c - y.c ||
			(y.a.activity?.itemsPerDay ?? 0) - (x.a.activity?.itemsPerDay ?? 0) ||
			x.a.did.localeCompare(y.a.did)
	);
	return rows.slice(0, n).map((x) => x.a);
}

/**
 * Estimated posts per hour of the day (24 values, index = local hour), from
 * the accounts whose recent posts are enough to read a daily pattern.
 *
 * An account's 30-item sample covers `sampleSize / itemsPerDay` days. If
 * that span is under two days the sample is too short to show when during
 * the day the account posts, so the account is left out and counted as
 * `excluded`. An account whose sample is its whole history (exhausted) is
 * included at its actual rate even with a short span: its recent posts are
 * everything it posted. Each included account adds its hour mix, weighted
 * by its items-per-day, so the columns sum to an estimate of how many posts
 * the people you follow make in each hour of the day.
 */
export interface WhenTheyPostHours {
	/** 24 values, estimated posts per hour of day, device time zone. */
	hours: number[];
	/** Active accounts whose recent posts cover two or more days (or whose
	    sample is their whole history). */
	included: number;
	/** Active accounts whose recent posts cover under two days and whose
	    sample is not their whole history. */
	excluded: number;
	/** included >= CONFIG.whenTheyPostMinAccounts. */
	enough: boolean;
}

export function whenTheyPostHours(accounts: FollowAccount[]): WhenTheyPostHours {
	const hours = new Array<number>(24).fill(0);
	let included = 0;
	let excluded = 0;
	for (const a of accounts) {
		if (a.status !== 'active') continue;
		const act = a.activity;
		if (act === null) continue;
		let n = 0;
		for (const row of act.weekdayHour) for (const v of row) n += v;
		const r = act.itemsPerDay;
		if (n === 0 || r === 0) continue;
		if (n / r < 2 && !act.exhausted) {
			excluded += 1;
			continue;
		}
		included += 1;
		for (let h = 0; h < 24; h += 1) {
			let c = 0;
			for (const row of act.weekdayHour) c += row[h] ?? 0;
			hours[h] += (c / n) * r;
		}
	}
	return { hours, included, excluded, enough: included >= CONFIG.whenTheyPostMinAccounts };
}

/**
 * "In your time zone. Estimated from 12 accounts; 3 accounts post too often
 * to tell from their recent posts." The second sentence is omitted when no
 * account is left out for being too busy.
 */
export function whenTheyPostFootnote(included: number, excluded: number): string {
	let s = `In your time zone. Estimated from ${plural(included, 'account', 'accounts')}`;
	if (excluded > 0) {
		s += `; ${plural(excluded, 'account posts', 'accounts post')} too often to tell from their recent posts`;
	}
	return `${s}.`;
}

export interface WhatTheyPost {
	/** Share × sample size per kind, summed over the sample. */
	kinds: { post: number; reply: number; quote: number; repost: number };
	/** Counts (non-reposts), summed. */
	media: { text: number; image: number; video: number; link: number; quote: number };
	/** Merged language counts, largest first. */
	langs: Array<[string, number]>;
}

export function whatTheyPost(accounts: FollowAccount[]): WhatTheyPost {
	const kinds: WhatTheyPost['kinds'] = { post: 0, reply: 0, quote: 0, repost: 0 };
	const media: WhatTheyPost['media'] = { text: 0, image: 0, video: 0, link: 0, quote: 0 };
	const langTotals = new Map<string, number>();
	for (const a of accounts) {
		const act = a.activity;
		if (act === null) continue;
		// Shares are 0–1 of the sample; back to counts with the sample size.
		kinds.post += act.share.post * act.sampleSize;
		kinds.reply += act.share.reply * act.sampleSize;
		kinds.quote += act.share.quote * act.sampleSize;
		kinds.repost += act.share.repost * act.sampleSize;
		media.text += act.media.text;
		media.image += act.media.image;
		media.video += act.media.video;
		media.link += act.media.link;
		media.quote += act.media.quote;
		for (const [lang, count] of act.topLangs)
			langTotals.set(lang, (langTotals.get(lang) ?? 0) + count);
	}
	const langs = [...langTotals.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
	return { kinds, media, langs };
}

/** The non-null follower counts, for the log histogram. */
export function sizeDistribution(accounts: FollowAccount[]): number[] {
	return accounts.map((a) => a.followersCount).filter((n): n is number => n !== null);
}

/**
 * Follows per calendar month (device-local), oldest first, ending at the
 * month of `now`; months with no follows are 0.
 */
export function followedByMonth(
	accounts: FollowAccount[],
	now: Date,
	months = 24
): Array<{ month: string; count: number }> {
	const keyOf = (d: Date): string =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	const counts = new Map<string, number>();
	for (const a of accounts) {
		if (a.followedAt === null) continue;
		const key = keyOf(new Date(a.followedAt));
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const out: Array<{ month: string; count: number }> = [];
	for (let i = months - 1; i >= 0; i -= 1) {
		const key = keyOf(new Date(now.getFullYear(), now.getMonth() - i, 1));
		out.push({ month: key, count: counts.get(key) ?? 0 });
	}
	return out;
}

export function followBack(accounts: FollowAccount[]): {
	yes: number;
	no: number;
	unknown: number;
} {
	let yes = 0;
	let no = 0;
	let unknown = 0;
	for (const a of accounts) {
		if (a.followsYou === true) yes += 1;
		else if (a.followsYou === false) no += 1;
		else unknown += 1;
	}
	return { yes, no, unknown };
}

/**
 * The "Do they follow back" takeaway. The percentage always counts only the
 * accounts whose follow-back status is known, so when some are unknown, say
 * that.
 */
export function followBackTakeaway(back: {
	yes: number;
	no: number;
	unknown: number;
}): string | null {
	const known = back.yes + back.no;
	if (known === 0) return null;
	const pct = Math.round((back.yes / known) * 100);
	return back.unknown > 0
		? `${pct}% of the accounts TidySky could check follow you back.`
		: `${pct}% follow you back.`;
}

/** How many follows are younger than `days`, for the "When you followed them" takeaway. */
export function followedInLastDays(accounts: FollowAccount[], now: Date, days: number): number {
	const cutoff = now.getTime() - days * DAY;
	let n = 0;
	for (const a of accounts) {
		if (a.followedAt !== null && new Date(a.followedAt).getTime() >= cutoff) n += 1;
	}
	return n;
}

/** One hiding list and how many of the active follows it hides. */
export interface HiddenListRow {
	uri: string; // the list's URI (at://owner/app.bsky.graph.list/rkey)
	name: string;
	kind: 'mute' | 'block';
	count: number;
}

/** The "Hidden from you" card's numbers, over the active follows only. */
export interface HiddenSummary {
	/**
	 * Every active follow has a viewer reading. False for a stored scan
	 * written before the viewer field existed (or one whose profile read is
	 * incomplete): the card asks for a rescan instead of showing numbers.
	 */
	read: boolean;
	/** Active follows hidden by at least one list you subscribe to. */
	hidden: number;
	/** One row per hiding list, by count, largest first. */
	lists: HiddenListRow[];
	/** Active follows that block you. */
	blocksYou: number;
}

export function hiddenFromYou(accounts: FollowAccount[]): HiddenSummary {
	const active = accounts.filter((a) => a.status === 'active');
	let read = active.length > 0;
	const byList = new Map<string, HiddenListRow>();
	const hiddenDids = new Set<string>();
	let blocks = 0;
	for (const a of active) {
		const v = a.viewer;
		if (v === null) {
			read = false;
			continue;
		}
		if (v.blockedBy) blocks += 1;
		const hiding: Array<{
			list: { uri: string; name: string };
			kind: 'mute' | 'block';
		}> = [];
		if (v.mutedByList !== null) hiding.push({ list: v.mutedByList, kind: 'mute' });
		if (v.blockingByList !== null) hiding.push({ list: v.blockingByList, kind: 'block' });
		for (const h of hiding) {
			hiddenDids.add(a.did);
			const key = `${h.list.uri}:${h.kind}`;
			const row = byList.get(key);
			if (row === undefined)
				byList.set(key, { uri: h.list.uri, name: h.list.name, kind: h.kind, count: 1 });
			else row.count += 1;
		}
	}
	const lists = [...byList.values()].sort((x, y) => y.count - x.count);
	return { read, hidden: hiddenDids.size, lists, blocksYou: blocks };
}

/**
 * The bsky.app page for a list URI (`at://owner/app.bsky.graph.list/rkey`):
 * the owner DID and the rkey both come from the URI. Null when the URI is
 * not a list record.
 */
export function listHref(uri: string): string | null {
	const parts = uri.replace(/^at:\/\//, '').split('/');
	if (parts.length !== 3 || parts[1] !== 'app.bsky.graph.list') return null;
	return `https://bsky.app/profile/${parts[0]}/lists/${parts[2]}`;
}
