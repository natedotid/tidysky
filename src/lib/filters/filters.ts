/**
 * The pure filter engine: describes "which accounts" as a list of clauses,
 * shared by Clean up, Insights links and Lists.
 *
 * A clause evaluates to true, false, or null when the data it needs isn't
 * known. A spec is the AND of its clauses, and an account with missing data
 * never matches: missing data must never put an account into a cleanup
 * selection.
 */

import { daysSince } from '#lib/scan/estimate';
import { plural } from '#lib/format';
import { interactionCount } from '#lib/insights/following';
import type { FollowAccount } from '#lib/scan/types';

export type Clause =
	| { kind: 'quiet'; days: number } // active status, newest activity older than N days (or none in the sample)
	| { kind: 'neverPosted' } // no posts, and the activity sample shows no activity at all (reposts don't count)
	| { kind: 'gone' } // status deactivated | takendown | gone
	| { kind: 'followsYou' } // followsYou === true (negate for "doesn't follow you back")
	| { kind: 'followsMoreThan'; n: number }
	| { kind: 'ratioAbove'; n: number } // followsCount / max(followersCount, 1) > n
	| { kind: 'postsPerDayAbove'; n: number }
	| { kind: 'postsPerDayBelow'; n: number }
	| { kind: 'repostShareAbove'; share: number } // 0–1
	| { kind: 'mostlyMedia'; media: 'image' | 'video' | 'link' } // that media is > 50% of non-reposts
	| { kind: 'medianWordsAbove'; n: number }
	| { kind: 'lang'; lang: string } // in topLangs
	| { kind: 'labeled' } // any label in SPAM_LABELS
	| { kind: 'followedDaysAgo'; days: number } // followedAt older than N days
	| { kind: 'noInteraction'; days: number } // checked, and no interaction (or none within N days)
	| { kind: 'interactionsAtLeast'; n: number } // checked, and the interaction count is at least n
	| { kind: 'noAvatar' }
	| { kind: 'noBio' }
	| { kind: 'text'; q: string } // case-insensitive in handle, displayName, description
	| { kind: 'inSet'; dids: string[]; label: string }; // internal (from "Since your last scan"); not user-editable

export type FilterClause = Clause & { negate?: boolean };
export interface FilterSpec {
	clauses: FilterClause[];
} // all clauses must match (AND)

export const SPAM_LABELS = ['spam', 'impersonation', 'scam', 'inauthentic', 'engagement-farming'];

/** true / false, or null when the data needed isn't known (e.g. no activity yet). */
export function evalClause(a: FollowAccount, c: Clause, now: Date): boolean | null {
	switch (c.kind) {
		case 'quiet': {
			// Only active accounts can be "quiet" or "not quiet". The dead
			// ones are unknown to this clause (and are 'gone'), so a
			// negated "posted in the last N days" can't match them either.
			if (a.status !== 'active') return null;
			if (a.activity === null) return null;
			// No activity in the sample (never posted) counts as quiet.
			return daysSince(a.activity.lastActiveAt, now) > c.days;
		}
		case 'neverPosted': {
			// Posts > 0 settles it.
			if (a.postsCount !== null && a.postsCount > 0) return false;
			// Otherwise we need the activity sample to rule out reposts: a
			// repost-only account has postsCount 0 but real activity.
			if (a.activity === null) return null;
			return a.activity.exhausted && a.activity.sampleSize === 0;
		}
		case 'gone':
			return a.status === 'deactivated' || a.status === 'takendown' || a.status === 'gone';
		case 'followsYou':
			return a.followsYou;
		case 'followsMoreThan':
			return a.followsCount === null ? null : a.followsCount > c.n;
		case 'ratioAbove': {
			if (a.followsCount === null || a.followersCount === null) return null;
			return a.followsCount / Math.max(a.followersCount, 1) > c.n;
		}
		case 'postsPerDayAbove':
			return a.activity === null ? null : a.activity.itemsPerDay > c.n;
		case 'postsPerDayBelow':
			return a.activity === null ? null : a.activity.itemsPerDay < c.n;
		case 'repostShareAbove':
			return a.activity === null ? null : a.activity.share.repost > c.share;
		case 'mostlyMedia': {
			if (a.activity === null) return null;
			const m = a.activity.media;
			// Every non-repost has exactly one embed kind, so the counts sum
			// to the number of non-reposts in the sample.
			const nonReposts = m.text + m.image + m.video + m.link + m.quote;
			if (nonReposts === 0) return false;
			return m[c.media] / nonReposts > 0.5;
		}
		case 'medianWordsAbove':
			return a.activity === null ? null : a.activity.medianWords > c.n;
		case 'lang': {
			if (a.activity === null) return null;
			const want = c.lang.toLowerCase();
			return a.activity.topLangs.some(([l]) => l.toLowerCase() === want);
		}
		case 'labeled':
			return a.labels.some((l) => SPAM_LABELS.includes(l));
		case 'followedDaysAgo':
			return a.followedAt === null ? null : daysSince(a.followedAt, now) > c.days;
		case 'noInteraction': {
			// Unchecked (interaction === null) is unknown: the clause never
			// matches those rows, negated or not.
			if (a.interaction === null) return null;
			return a.interaction.lastAt === null || daysSince(a.interaction.lastAt, now) > c.days;
		}
		case 'interactionsAtLeast': {
			// Same rule as noInteraction: unchecked is unknown, so the clause
			// never matches those rows, negated or not.
			if (a.interaction === null) return null;
			const n = interactionCount(a);
			return n !== null && n >= c.n;
		}
		case 'noAvatar':
			return a.avatar === null;
		case 'noBio':
			return a.description === null;
		case 'text': {
			const q = c.q.trim().toLowerCase();
			if (q === '') return false;
			return [a.handle, a.displayName, a.description].some(
				(s) => s !== null && s.toLowerCase().includes(q)
			);
		}
		case 'inSet':
			return c.dids.includes(a.did);
	}
}

/**
 * AND of all clauses. A clause that evaluates to null makes the whole spec
 * NOT match, negated or not. Missing data must never put an account into a
 * cleanup selection.
 */
export function matches(a: FollowAccount, spec: FilterSpec, now: Date): boolean {
	for (const c of spec.clauses) {
		const r = evalClause(a, c, now);
		if (r === null) return false;
		if (c.negate ? r : !r) return false;
	}
	return true;
}

const fmt = (n: number): string => n.toLocaleString('en-US');

export function describeClause(c: FilterClause): string {
	switch (c.kind) {
		case 'quiet':
			return c.negate
				? `Posted in the last ${plural(c.days, 'day', 'days')}`
				: `No posts in ${plural(c.days, 'day', 'days')}`;
		case 'neverPosted':
			return c.negate ? 'Has posted' : 'Never posted';
		case 'gone':
			return c.negate ? 'Account exists' : 'Deactivated or gone';
		case 'followsYou':
			return c.negate ? "Doesn't follow you back" : 'Follows you back';
		case 'followsMoreThan':
			return c.negate ? `Follows ${fmt(c.n)} or fewer` : `Follows more than ${fmt(c.n)}`;
		case 'ratioAbove':
			return `Follows ${fmt(c.n)}× more than follow them`;
		case 'postsPerDayAbove':
			return `Posts more than ${fmt(c.n)} a day`;
		case 'postsPerDayBelow':
			return `Posts less than ${fmt(c.n)} a day`;
		case 'repostShareAbove':
			return `Mostly reposts (over ${Math.round(c.share * 100)}%)`;
		case 'mostlyMedia':
			return c.media === 'image'
				? 'Mostly images'
				: c.media === 'video'
					? 'Mostly videos'
					: 'Mostly links';
		case 'medianWordsAbove':
			return `Longer posts (median over ${fmt(c.n)} ${c.n === 1 ? 'word' : 'words'})`;
		case 'lang':
			return `Posts in ${c.lang}`;
		case 'labeled':
			return 'Has a moderation label';
		case 'followedDaysAgo':
			return c.negate
				? `Followed in the last ${plural(c.days, 'day', 'days')}`
				: `Followed over ${plural(c.days, 'day', 'days')} ago`;
		case 'noInteraction': {
			// The offered values read as months; anything else (older data)
			// stays in days.
			const span =
				c.days === 30
					? '30 days'
					: c.days === 90
						? '3 months'
						: c.days === 180
							? '6 months'
							: c.days === 365
								? '12 months'
								: plural(c.days, 'day', 'days');
			return c.negate ? `Interacted in the last ${span}` : `No interaction in ${span}`;
		}
		case 'interactionsAtLeast':
			return c.negate
				? `Under ${fmt(c.n)} interactions in 12 months`
				: `${fmt(c.n)}+ interactions in 12 months`;
		case 'noAvatar':
			return 'No avatar';
		case 'noBio':
			return 'No bio';
		case 'text':
			return `Matches "${c.q}"`;
		case 'inSet':
			return c.label;
	}
}

/** Plain-English summary, e.g. "No posts in 90 days · Doesn't follow you back". */
export function describe(spec: FilterSpec): string {
	return spec.clauses.map(describeClause).join(' · ');
}

/** Chips shown on a row: the clauses this account matched, described. */
export function reasons(a: FollowAccount, spec: FilterSpec, now: Date): string[] {
	const out: string[] = [];
	for (const c of spec.clauses) {
		const r = evalClause(a, c, now);
		if (r === null) continue;
		if (c.negate ? !r : r) out.push(describeClause(c));
	}
	return out;
}
