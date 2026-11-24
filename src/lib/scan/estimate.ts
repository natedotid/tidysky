/**
 * Turn a recent sample of classified feed items into an `ActivitySummary`.
 * Pure, and heavily tested: Insights and Clean up both depend on it.
 *
 * The estimate is honest about being an estimate: with `exhausted: true` we
 * saw everything the account ever did, so the span runs from account
 * creation; otherwise the span runs from the oldest item in the sample,
 * which only *under*estimates how long they have been posting.
 */

import type { ActivitySummary } from '#lib/scan/types';
import type { FeedItemLite } from './classify';

const DAY_MS = 86_400_000;
const MIN_SPAN_DAYS = 1 / 24; // one hour; stops a burst of posts from dividing by ~0

function isParseableDate(s: string): boolean {
	return !Number.isNaN(Date.parse(s));
}

/** Newest `at` over all items (or only non-reposts), or null if none match. */
function maxAt(items: FeedItemLite[], includeReposts: boolean): string | null {
	let best: string | null = null;
	let bestMs = -Infinity;
	for (const item of items) {
		if (!includeReposts && item.kind === 'repost') continue;
		const ms = Date.parse(item.at);
		if (ms > bestMs) {
			bestMs = ms;
			best = item.at;
		}
	}
	return best;
}

export function summarizeActivity(
	items: FeedItemLite[],
	ctx: { now: Date; exhausted: boolean; accountCreatedAt: string | null }
): ActivitySummary {
	const n = items.length;
	const nonReposts = items.filter((i) => i.kind !== 'repost');

	// Times are ISO/UTC, so compare as numbers: mixed millisecond precision
	// would compare wrong as strings.
	const lastActiveAt = maxAt(items, true);
	const lastPostAt = maxAt(items, false);

	// spanStart: if we saw everything they ever did, run the clock from
	// account creation; else from the oldest item in the sample.
	const oldestMs = items.reduce((min, i) => Math.min(min, Date.parse(i.at)), Infinity);
	const accountCreatedMs =
		ctx.accountCreatedAt !== null && isParseableDate(ctx.accountCreatedAt)
			? Date.parse(ctx.accountCreatedAt)
			: null;
	const spanStartMs =
		ctx.exhausted && accountCreatedMs !== null
			? accountCreatedMs
			: n === 0
				? ctx.now.getTime()
				: oldestMs;
	const spanDays = Math.max((ctx.now.getTime() - spanStartMs) / DAY_MS, MIN_SPAN_DAYS);
	const itemsPerDay = n === 0 ? 0 : n / spanDays;

	const kindCounts = { post: 0, reply: 0, quote: 0, repost: 0 };
	for (const item of items) kindCounts[item.kind] += 1;
	const share = {
		post: n === 0 ? 0 : kindCounts.post / n,
		reply: n === 0 ? 0 : kindCounts.reply / n,
		quote: n === 0 ? 0 : kindCounts.quote / n,
		repost: n === 0 ? 0 : kindCounts.repost / n
	};

	const media = { text: 0, image: 0, video: 0, link: 0, quote: 0 };
	for (const item of nonReposts) media[item.embed] += 1;

	// Device local time on purpose: "when are they posting *for you*".
	const weekdayHour: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
	for (const item of items) {
		const d = new Date(item.at);
		weekdayHour[d.getDay()][d.getHours()] += 1;
	}

	// Ties broken alphabetically (code-unit order, locale-independent).
	const langCounts = new Map<string, number>();
	for (const item of nonReposts) {
		if (item.lang !== null) langCounts.set(item.lang, (langCounts.get(item.lang) ?? 0) + 1);
	}
	const topLangs: Array<[string, number]> = [...langCounts.entries()]
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
		.slice(0, 3)
		.map(([lang, count]) => [lang, count] as [string, number]);

	const words = nonReposts.map((i) => i.words).sort((a, b) => a - b);
	const medianWords =
		words.length === 0
			? 0
			: words.length % 2 === 1
				? words[(words.length - 1) / 2]
				: (words[words.length / 2 - 1] + words[words.length / 2]) / 2;

	return {
		sampleSize: n,
		exhausted: ctx.exhausted,
		lastActiveAt,
		lastPostAt,
		itemsPerDay,
		share,
		media,
		weekdayHour,
		topLangs,
		medianWords
	};
}

/**
 * Days since an ISO time, or Infinity for null (and for a time that fails to
 * parse: treat "unknown" the same as "a long time ago"). Clamped at 0 for
 * future timestamps from clock skew.
 */
export function daysSince(iso: string | null, now: Date): number {
	if (iso === null) return Infinity;
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) return Infinity;
	return Math.max(0, (now.getTime() - ms) / DAY_MS);
}
