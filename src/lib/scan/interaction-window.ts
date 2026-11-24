/**
 * Where the 12-month interaction window effectively starts, in words.
 *
 * The read looks back a full year, but two things can move the start:
 * - the read hit its cap: it reaches back to `interactionsCoveredSince`,
 *   not the full year;
 * - your own account is younger than a year: you cannot have interacted
 *   before it existed, so the window starts when you joined.
 * The later of the two wins (when both apply). Every place that says
 * "in the last 12 months" about interactions must use this, so the
 * headline, the bar's last bucket and the row's "You:" line agree.
 */

import { CONFIG } from '#lib/config';

const DAY = 86_400_000;

/** Which bound sets the start of the window. */
export type InteractionWindow =
	{ kind: 'full' } | { kind: 'joined'; at: string } | { kind: 'capped'; at: string };

/**
 * The effective start: the latest of the window start, your account's
 * creation (when known) and the covered-since cap (when the read hit one).
 * A tie between the cap and your creation keeps the "joined" wording: at
 * that date the read covers everything since you joined, so it is the more
 * complete statement.
 */
export function interactionWindow(
	scannedAt: string | null,
	coveredSince: string | null,
	myCreatedAt: string | null
): InteractionWindow {
	if (scannedAt === null) return { kind: 'full' };
	const start = Date.parse(scannedAt) - CONFIG.interactionWindowDays * DAY;
	const cappedAt = coveredSince !== null && Date.parse(coveredSince) > start ? coveredSince : null;
	const joinedAt = myCreatedAt !== null && Date.parse(myCreatedAt) > start ? myCreatedAt : null;
	if (joinedAt !== null && (cappedAt === null || Date.parse(joinedAt) >= Date.parse(cappedAt))) {
		return { kind: 'joined', at: joinedAt };
	}
	if (cappedAt !== null) return { kind: 'capped', at: cappedAt };
	return { kind: 'full' };
}

/**
 * The "How often you interact" card's time buckets, adjusted for a young
 * account. A bucket that lies entirely before the account existed can never
 * count anything, so the card hides it instead of showing a 0; the oldest
 * bucket that still overlaps the account's life is relabeled open-ended
 * when the account was created inside it. "In the last 30 days" is never
 * hidden or relabeled, and the "none" bucket's wording already comes from
 * interactionWindowLabels ("None since you joined"), so only the two middle
 * buckets are planned here.
 */
export interface InteractionBucketPlan {
	/** True when the account was created after the whole bucket. */
	hidden: boolean;
	/** Open-ended label when the account was created inside the bucket, else null. */
	openLabel: string | null;
}

export interface InteractionBucketPlans {
	/** The "31 to 90 days" bucket. */
	in31To90: InteractionBucketPlan;
	/** The "91 days to 12 months" bucket. */
	in91To365: InteractionBucketPlan;
}

export function interactionBucketPlan(
	scannedAt: string | null,
	myCreatedAt: string | null
): InteractionBucketPlans {
	let ageDays: number | null = null;
	if (scannedAt !== null && myCreatedAt !== null) {
		ageDays = (Date.parse(scannedAt) - Date.parse(myCreatedAt)) / DAY;
	}
	// newestEdge/oldestEdge are the bucket's edges in days before the scan:
	// hidden when the account is younger than the newest edge (the whole
	// bucket is before the account existed), open-ended when the creation
	// falls inside the bucket, usual otherwise.
	const plan = (
		newestEdge: number,
		oldestEdge: number,
		openLabel: string
	): InteractionBucketPlan => {
		if (ageDays === null || ageDays >= oldestEdge) return { hidden: false, openLabel: null };
		if (ageDays < newestEdge) return { hidden: true, openLabel: null };
		return { hidden: false, openLabel };
	};
	return {
		in31To90: plan(31, 90, '31 days ago or more'),
		in91To365: plan(91, 365, '91 days ago or more')
	};
}

const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });

/**
 * The two phrasings of the window start: the headline's
 * "in the last 12 months" / "since you joined in {Mon YYYY}" /
 * "since {Mon YYYY}", and the "none" bucket's "None in 12 months" /
 * "None since you joined" / "None since {Mon YYYY}".
 */
export function interactionWindowLabels(w: InteractionWindow): { since: string; none: string } {
	if (w.kind === 'joined') {
		return {
			since: `since you joined in ${monthYearFmt.format(new Date(w.at))}`,
			none: 'None since you joined'
		};
	}
	if (w.kind === 'capped') {
		const m = monthYearFmt.format(new Date(w.at));
		return { since: `since ${m}`, none: `None since ${m}` };
	}
	return { since: 'in the last 12 months', none: 'None in 12 months' };
}
