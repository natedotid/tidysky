import type { UnfollowLogEntry } from '#lib/scan/types';

/**
 * What undoing a log entry does on Bluesky. A moved account is refollowed
 * the same way an unfollowed one is; they stay on the list.
 */
export function undoKind(action: UnfollowLogEntry['action']): 'refollow' | 'unmute' {
	return action === 'mute' ? 'unmute' : 'refollow';
}

/**
 * The entry unfollowed the account on Bluesky, so it counts toward the
 * daily limit and keeps the account out of "dropped elsewhere". A
 * move-to-list entry does too: it unfollows after adding to the list.
 */
export function isUnfollowAction(action: UnfollowLogEntry['action']): boolean {
	return action === 'unfollow' || action === 'move-to-list';
}
