import type { DataSource } from '#lib/scan/source';
import type { FollowAccount } from '#lib/scan/types';

/** app.bsky.actor.getProfiles takes up to 25 DIDs per call. */
const PREFLIGHT_BATCH = 25;

function isAbortError(e: unknown): boolean {
	return e instanceof Error && e.name === 'AbortError';
}

/** The scan statuses a double-check re-verifies before an unfollow or move. */
export function isGoneType(a: FollowAccount): boolean {
	return a.status === 'deactivated' || a.status === 'takendown' || a.status === 'gone';
}

/**
 * Re-check accounts the scan marked deactivated/takendown/gone with a fresh
 * getProfiles before unfollowing or moving them: a profile that comes back
 * means the account is alive (a public feed read can 404 for accounts hidden
 * from logged-out readers). A re-check failure never blocks the run; those
 * accounts stay in it and the caller notes how many went unchecked.
 */
export async function preflight(
	src: DataSource,
	targets: FollowAccount[],
	signal?: AbortSignal
): Promise<{ run: FollowAccount[]; stillThere: FollowAccount[]; unchecked: number }> {
	const toCheck = targets.filter(isGoneType);
	if (toCheck.length === 0) return { run: targets, stillThere: [], unchecked: 0 };
	const alive = new Set<string>();
	let unchecked = 0;
	for (let i = 0; i < toCheck.length; i += PREFLIGHT_BATCH) {
		const chunk = toCheck.slice(i, i + PREFLIGHT_BATCH);
		try {
			const profiles = await src.getProfiles(
				chunk.map((a) => a.did),
				signal
			);
			for (const p of profiles) {
				// 'handle.invalid' is what the API returns for deactivated accounts.
				if (p.handle !== 'handle.invalid') alive.add(p.did);
			}
		} catch (e) {
			if (isAbortError(e) || signal?.aborted) throw e;
			// Keep the chunk in the run and count it for the caller's note.
			unchecked += chunk.length;
		}
	}
	return {
		run: targets.filter((a) => !alive.has(a.did)),
		stillThere: targets.filter((a) => alive.has(a.did)),
		unchecked
	};
}
