/**
 * Snapshot math for "Since your last scan". A snapshot is a
 * per-DID { status, quiet90, followsYou } map taken after every completed
 * scan; the diff between the two newest snapshots is what changed.
 */

import { daysSince } from '#lib/scan/estimate';
import type { AccountStatus, FollowAccount, Snapshot } from '#lib/scan/types';

/** The `quiet` filter clause, at 90 days. */
export const QUIET_DAYS = 90;

const GONE: ReadonlySet<string> = new Set(['deactivated', 'takendown', 'gone']);

/** The `quiet` clause with 90 days, as a plain boolean (unknown data is false). */
export function isQuiet90(a: FollowAccount, now: Date): boolean {
	if (a.status !== 'active') return false;
	if (a.activity === null) return false;
	// daysSince(null) is Infinity: a never-posted active account is quiet.
	return daysSince(a.activity.lastActiveAt, now) > QUIET_DAYS;
}

/** One account's state, for the diff. */
export interface SnapshotRow {
	status: AccountStatus;
	quiet90: boolean;
	followsYou: boolean | null;
}

/**
 * The per-DID state of every account, plus the headline totals. `active30`
 * counts active accounts with activity within 30 days.
 */
export function makeSnapshot(accounts: FollowAccount[], now: Date): Snapshot {
	const statuses: Record<string, SnapshotRow> = {};
	let active30 = 0;
	let quiet90 = 0;
	let gone = 0;
	let followsYou = 0;
	for (const a of accounts) {
		const q = isQuiet90(a, now);
		statuses[a.did] = { status: a.status, quiet90: q, followsYou: a.followsYou };
		if (
			a.status === 'active' &&
			a.activity !== null &&
			daysSince(a.activity.lastActiveAt, now) <= 30
		)
			active30 += 1;
		if (q) quiet90 += 1;
		if (GONE.has(a.status)) gone += 1;
		if (a.followsYou === true) followsYou += 1;
	}
	return {
		at: now.toISOString(),
		statuses,
		totals: { follows: accounts.length, active30, quiet90, gone, followsYou }
	};
}

export interface SnapshotDiff {
	/** quiet90 false → true (still followed). */
	wentQuiet: string[];
	/** quiet90 true → false. */
	cameBack: string[];
	/** not a gone status → a gone status. */
	wentGone: string[];
	/** followsYou true → false. */
	stoppedFollowingYou: string[];
	/** followsYou false → true. */
	startedFollowingYou: string[];
	/** in curr, not in prev. */
	newFollows: string[];
	/** in prev, not in curr, and not unfollowed through TidySky since prev. */
	droppedElsewhere: string[];
}

export const SINCE_KEYS = [
	'wentQuiet',
	'wentGone',
	'stoppedFollowingYou',
	'cameBack',
	'startedFollowingYou',
	'newFollows',
	'droppedElsewhere'
] as const;
export type SinceKey = (typeof SINCE_KEYS)[number];

/**
 * The Clean up chip label for each category (the `inSet` clause's label).
 * `droppedElsewhere` has none: those accounts are no longer followed, so
 * Clean up has no rows to filter. Its chip opens a sheet instead, and an
 * old `?since=droppedElsewhere` link is a no-op.
 */
export const SINCE_CLAUSE_LABELS: Partial<Record<SinceKey, string>> = {
	wentQuiet: 'Went quiet since last scan',
	wentGone: 'Went gone since last scan',
	stoppedFollowingYou: 'Stopped following you back since last scan',
	cameBack: 'Came back since last scan',
	startedFollowingYou: 'Started following you back since last scan',
	newFollows: 'New follows since last scan'
};

export type SinceChipKind = 'link' | 'sheet';

export interface SinceChip {
	key: SinceKey;
	/** Opens Clean up filtered to the accounts, or the sheet (droppedElsewhere). */
	kind: SinceChipKind;
	text: string;
	ariaLabel: string;
}

function chipText(key: SinceKey, n: number): string {
	switch (key) {
		case 'wentQuiet':
			return `${n} went quiet`;
		case 'wentGone':
			return n === 1 ? '1 is gone' : `${n} are gone`;
		case 'stoppedFollowingYou':
			return `${n} stopped following you back`;
		case 'cameBack':
			return `${n} came back`;
		case 'startedFollowingYou':
			return `${n} started following you back`;
		case 'newFollows':
			return `${n} new follow${n === 1 ? '' : 's'}`;
		case 'droppedElsewhere':
			return `${n} unfollowed elsewhere`;
	}
}

/** The non-empty categories, in display order, as chips. */
export function sinceChips(diff: SnapshotDiff): SinceChip[] {
	const out: SinceChip[] = [];
	for (const key of SINCE_KEYS) {
		const n = diff[key].length;
		if (n === 0) continue;
		const kind: SinceChipKind = key === 'droppedElsewhere' ? 'sheet' : 'link';
		out.push({
			key,
			kind,
			text: chipText(key, n),
			ariaLabel:
				kind === 'sheet'
					? `Show the ${n} ${n === 1 ? 'account' : 'accounts'} you no longer follow`
					: `Show the ${chipText(key, n).toLowerCase()} in Clean up`
		});
	}
	return out;
}

/**
 * What changed between two snapshots. `unfollowedDids` are the DIDs the user
 * unfollowed through TidySky after `prev` (from the log): they left the
 * follows list on purpose, so they are not "dropped elsewhere".
 */
export function diffSnapshots(
	prev: Snapshot,
	curr: Snapshot,
	unfollowedDids: Iterable<string> = []
): SnapshotDiff {
	const unfollowed = new Set(unfollowedDids);
	const diff: SnapshotDiff = {
		wentQuiet: [],
		wentGone: [],
		stoppedFollowingYou: [],
		cameBack: [],
		startedFollowingYou: [],
		newFollows: [],
		droppedElsewhere: []
	};
	for (const did of Object.keys(curr.statuses)) {
		const c = curr.statuses[did];
		const p = prev.statuses[did];
		if (p === undefined) {
			diff.newFollows.push(did);
			continue;
		}
		if (!p.quiet90 && c.quiet90) diff.wentQuiet.push(did);
		if (p.quiet90 && !c.quiet90) diff.cameBack.push(did);
		if (!GONE.has(p.status) && GONE.has(c.status)) diff.wentGone.push(did);
		if (p.followsYou === true && c.followsYou === false) diff.stoppedFollowingYou.push(did);
		if (p.followsYou === false && c.followsYou === true) diff.startedFollowingYou.push(did);
	}
	for (const did of Object.keys(prev.statuses)) {
		if (curr.statuses[did] !== undefined) continue;
		if (unfollowed.has(did)) continue;
		diff.droppedElsewhere.push(did);
	}
	return diff;
}
