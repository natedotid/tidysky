/**
 * The profile preview's content, computed from the stored row alone: the
 * sheet shows everything TidySky already knows, so it makes no requests.
 * Every function takes its window and row as arguments, so tests control
 * the inputs; the component only renders what this returns.
 */

import { compact, plural, rate, relativeDays } from '#lib/format';
import { listHref } from '#lib/insights/following';
import { interactionWindowLabels, type InteractionWindow } from '#lib/scan/interaction-window';
import type { FollowAccount, InteractionKind } from '#lib/scan/types';

/** One line of "Why it's flagged"; href is set on the list lines. */
export interface PreviewWhyLine {
	text: string;
	href: string | null;
}

/** One label/value pair of the "Facts" and "Activity" sections. */
export interface PreviewFact {
	label: string;
	value: string;
}

export type PreviewActivity =
	| { kind: 'none' }
	| {
			kind: 'data';
			/** The newest post or repost, relative ("3d ago"), or "—". */
			lastActive: string;
			/** The estimated rate, e.g. "3/day". */
			perDay: string;
			/**
			 * The mix items, e.g. ["45% posts", "20% replies"]: whole percentages
			 * of the sample, 0% left out. Kept as parts so the sheet can break
			 * the line only between items, never mid-item.
			 */
			mix: string[] | null;
			/** "en, es", or null when no language was detected. */
			languages: string | null;
			/** The sample size, for the "estimated from N" footnote. */
			sampleSize: number;
	  };

export type PreviewInteraction =
	| { kind: 'unchecked' }
	| {
			kind: 'data';
			/** "Liked 3d ago", or null when nothing happened in the window. */
			last: string | null;
			/** "3 likes · 1 reply in the last 12 months", or null. */
			counts: string | null;
			/** "None in 12 months" (the shared window wording), or null. */
			none: string | null;
	  };

export interface Preview {
	/** The sheet title: display name or handle. */
	title: string;
	handle: string;
	bio: string | null;
	why: PreviewWhyLine[];
	facts: PreviewFact[];
	activity: PreviewActivity;
	interaction: PreviewInteraction;
	/** The bsky.app profile link. */
	profileHref: string;
}

const KIND_VERB: Record<InteractionKind, string> = {
	like: 'Liked',
	repost: 'Reposted',
	reply: 'Replied',
	quote: 'Quoted',
	mention: 'Mentioned them'
};

/** The window's kinds, in the order they read in a counts line. */
const KIND_ORDER: Array<{ kind: InteractionKind; one: string; many: string }> = [
	{ kind: 'like', one: 'like', many: 'likes' },
	{ kind: 'repost', one: 'repost', many: 'reposts' },
	{ kind: 'reply', one: 'reply', many: 'replies' },
	{ kind: 'quote', one: 'quote', many: 'quotes' },
	{ kind: 'mention', one: 'mention', many: 'mentions' }
];

const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });

function monthYear(iso: string): string {
	return monthYearFmt.format(new Date(iso));
}

export function buildPreview(a: FollowAccount, win: InteractionWindow): Preview {
	// `||`, not `??`: a dead account stores an empty handle, which would
	// leave the sheet title blank.
	const title = a.displayName || a.handle || a.did;

	// The flag lines, in the row's own order and wording.
	const why: PreviewWhyLine[] = [];
	if (a.status === 'deactivated') why.push({ text: 'Deactivated', href: null });
	if (a.status === 'takendown') why.push({ text: 'Suspended', href: null });
	if (a.status === 'gone') why.push({ text: 'Gone', href: null });
	const v = a.viewer;
	if (v !== null) {
		if (v.blockedBy) why.push({ text: 'Blocks you', href: null });
		if (v.mutedByList !== null)
			why.push({
				text: `Muted by list: ${v.mutedByList.name}`,
				href: listHref(v.mutedByList.uri)
			});
		if (v.blockingByList !== null)
			why.push({
				text: `Blocked by list: ${v.blockingByList.name}`,
				href: listHref(v.blockingByList.uri)
			});
	}
	for (const label of a.labels) why.push({ text: `Has a label: ${label}`, href: null });

	const facts: PreviewFact[] = [
		{ label: 'Followers', value: a.followersCount === null ? '—' : compact(a.followersCount) },
		{ label: 'Following', value: a.followsCount === null ? '—' : compact(a.followsCount) },
		{ label: 'Posts', value: a.postsCount === null ? '—' : compact(a.postsCount) },
		{
			label: 'Follows you',
			value: a.followsYou === null ? 'Unknown' : a.followsYou ? 'Yes' : 'No'
		}
	];
	if (a.viewer !== null) {
		const kf = a.viewer.knownFollowers;
		facts.push({
			label: 'Followed by people you follow',
			value: kf === null ? 'Unknown' : kf === 0 ? 'None' : compact(kf)
		});
	}
	facts.push({
		label: 'You followed them',
		value:
			a.followedAt === null ? '—' : `${relativeDays(a.followedAt)} (${monthYear(a.followedAt)})`
	});
	facts.push({
		label: 'Account created',
		value: a.createdAt === null ? '—' : monthYear(a.createdAt)
	});

	let activity: PreviewActivity;
	if (a.activity === null) {
		activity = { kind: 'none' };
	} else {
		const act = a.activity;
		const mixParts: string[] = [];
		for (const [label, share] of [
			['posts', act.share.post],
			['replies', act.share.reply],
			['quotes', act.share.quote],
			['reposts', act.share.repost]
		] as Array<[string, number]>) {
			const pct = Math.round(share * 100);
			if (pct > 0) mixParts.push(`${pct}% ${label}`);
		}
		activity = {
			kind: 'data',
			lastActive: act.lastActiveAt === null ? '—' : relativeDays(act.lastActiveAt),
			perDay: rate(act.itemsPerDay),
			mix: mixParts.length > 0 ? mixParts : null,
			languages: act.topLangs.length > 0 ? act.topLangs.map(([code]) => code).join(', ') : null,
			sampleSize: act.sampleSize
		};
	}

	let interaction: PreviewInteraction;
	if (a.interaction === null) {
		interaction = { kind: 'unchecked' };
	} else {
		const ix = a.interaction;
		const last =
			ix.lastAt === null || ix.lastKind === null
				? null
				: `${KIND_VERB[ix.lastKind]} ${relativeDays(ix.lastAt)}`;
		const labels = interactionWindowLabels(win);
		const countParts = KIND_ORDER.filter(({ kind }) => ix.countsByKind[kind] > 0).map(
			({ kind, one, many }) => plural(ix.countsByKind[kind], one, many)
		);
		const counts = countParts.length > 0 ? `${countParts.join(' · ')} ${labels.since}` : null;
		interaction = { kind: 'data', last, counts, none: counts === null ? labels.none : null };
	}

	return {
		title,
		handle: a.handle,
		bio: a.description,
		why,
		facts,
		activity,
		interaction,
		profileHref: `https://bsky.app/profile/${a.handle || a.did}`
	};
}
