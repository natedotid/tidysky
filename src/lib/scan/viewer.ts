/**
 * The viewer state a signed-in profile read carries for each account:
 * moderation-list mutes and blocks, a block in either direction, and the
 * mutual count. The public AppView returns no viewer at all, so rows from
 * that path (and from older scans) store `null`.
 */

import type { ProfileViewer } from './types';

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read the viewer state out of a raw profile view. `null` when the read
 * carries no viewer at all. The response is a union with a catch-all
 * member, so every field is checked instead of cast.
 */
export function viewerFromProfile(profile: unknown): ProfileViewer | null {
	if (!isRecord(profile)) return null;
	const v = profile['viewer'];
	if (!isRecord(v)) return null;
	const list = (x: unknown): { uri: string; name: string } | null =>
		isRecord(x) && typeof x['uri'] === 'string' && typeof x['name'] === 'string'
			? { uri: x['uri'], name: x['name'] }
			: null;
	const blockingByList = list(v['blockingByList']);
	const kf = v['knownFollowers'];
	return {
		mutedByList: list(v['mutedByList']),
		blockingByList,
		blockedBy: v['blockedBy'] === true,
		// A list block sets `blocking` to the list's URI, so a personal
		// block is `blocking` set with no `blockingByList`.
		blockingPersonally: typeof v['blocking'] === 'string' && blockingByList === null,
		knownFollowers: isRecord(kf) && typeof kf['count'] === 'number' ? kf['count'] : null
	};
}

/** A list mute or list block hides the account, whatever the follows say. */
export function hiddenByList(v: ProfileViewer | null): boolean {
	return v !== null && (v.mutedByList !== null || v.blockingByList !== null);
}

/** They block the user. */
export function blocksYou(v: ProfileViewer | null): boolean {
	return v !== null && v.blockedBy;
}

/** A block in either direction or by list: follow-back is unknowable. */
export function blockApplies(v: ProfileViewer | null): boolean {
	return v !== null && (v.blockedBy || v.blockingByList !== null || v.blockingPersonally);
}
