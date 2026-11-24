import type { FollowAccount } from '#lib/scan/types';

/**
 * The accounts a Review acts on: selected AND in the current results AND not kept,
 * in the results' (on-screen) order.
 */
export function reviewTargets(
	results: FollowAccount[],
	selected: ReadonlySet<string>,
	kept: ReadonlySet<string>
): FollowAccount[] {
	return results.filter((a) => selected.has(a.did) && !kept.has(a.did));
}
