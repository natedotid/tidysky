/**
 * The mute executor: one muteActor call per account through the auth queue.
 * Muting isn't a repo write, so there are no batches, just a short pause
 * between calls so the run doesn't look like a burst. Muted accounts stay
 * followed; the caller only logs them.
 */

import { isAuthFailure, SessionExpiredError } from '#lib/net/errors';
import type { FollowAccount } from '#lib/scan/types';

import { describeError, type RunControl } from './unfollow';
import type { Writer } from './writer';

export interface MuteOptions {
	/** Pause between calls, not after the last. */
	pauseMs: number;
	control: RunControl;
	/** The caller logs each account (error is null when the mute succeeded). */
	onAccountDone: (account: FollowAccount, error: string | null) => Promise<void>;
	onProgress: (done: number, failed: number, total: number) => void;
	/** Injectable for tests; defaults to a real setTimeout. */
	sleep?: (ms: number) => Promise<void>;
}

export interface MuteResult {
	done: number;
	failed: number;
	cancelled: boolean;
}

const PAUSE_POLL_MS = 250;

export async function runMutes(
	writer: Writer,
	targets: FollowAccount[],
	opts: MuteOptions
): Promise<MuteResult> {
	const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	let done = 0;
	let failed = 0;

	for (let i = 0; i < targets.length; i += 1) {
		// Hold while paused; a stop while paused is picked up here.
		while (opts.control.paused) {
			if (opts.control.signal.aborted) return { done, failed, cancelled: true };
			await sleep(PAUSE_POLL_MS);
		}
		if (opts.control.signal.aborted) return { done, failed, cancelled: true };

		const account = targets[i];
		try {
			await writer.muteActor(account.did, opts.control.signal);
			await opts.onAccountDone(account, null);
			done += 1;
		} catch (e) {
			// A stop: end the run without logging the in-flight account.
			if (opts.control.signal.aborted) return { done, failed, cancelled: true };
			// The sign-in is dead: the accounts already muted were logged as
			// they went, so there is nothing left to report, just stop.
			if (isAuthFailure(e)) throw new SessionExpiredError();
			await opts.onAccountDone(account, describeError(e));
			failed += 1;
		}
		opts.onProgress(done, failed, targets.length);

		// Chunks of 250 ms so a Stop lands quickly; no sleep after the last.
		for (let wait = i < targets.length - 1 ? opts.pauseMs : 0; wait > 0;) {
			const step = Math.min(wait, PAUSE_POLL_MS);
			await sleep(step);
			if (opts.control.signal.aborted) return { done, failed, cancelled: true };
			wait -= step;
		}
	}

	return { done, failed, cancelled: false };
}
