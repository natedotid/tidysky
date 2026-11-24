/**
 * The unfollow executor: deletes follow records in paced batches so the run
 * doesn't look like spam, with a per-record fallback when a batch fails, and
 * pause/stop through a RunControl. It never touches the store or the UI;
 * the caller does that in the callbacks.
 */

import { errorInfo, isAuthFailure, SessionExpiredError } from '#lib/net/errors';
import type { FollowAccount } from '#lib/scan/types';

import type { WriteOp, Writer } from './writer';

export interface RunControl {
	/** Set by the UI to hold the run; polled between batches. */
	paused: boolean;
	signal: AbortSignal;
}

export interface RunOptions {
	/** Total follow records per applyWrites call. */
	batchSize: number;
	/** Pause between batches, not after the last. */
	pauseMs: number;
	control: RunControl;
	/** Carried on the caller's log entries. */
	reason: string;
	/** The caller deletes `done` accounts from the store and logs each. */
	onBatchDone: (
		done: FollowAccount[],
		failed: Array<{ account: FollowAccount; error: string }>
	) => Promise<void>;
	onProgress: (done: number, failed: number, total: number) => void;
	/** Injectable for tests; defaults to a real setTimeout. */
	sleep?: (ms: number) => Promise<void>;
}

export interface RunResult {
	done: number;
	failed: number;
	cancelled: boolean;
}

const FOLLOW = 'app.bsky.graph.follow';
const PAUSE_POLL_MS = 250;

/**
 * Split targets into batches whose total number of rkeys fits `batchSize`.
 * An account with 2 rkeys uses 2 slots, and an account is never split:
 * one that alone exceeds the size gets its own batch.
 */
export function splitBatches(targets: FollowAccount[], batchSize: number): FollowAccount[][] {
	const batches: FollowAccount[][] = [];
	let batch: FollowAccount[] = [];
	let used = 0;
	for (const account of targets) {
		const slots = Math.max(1, account.followRkeys.length);
		if (batch.length > 0 && used + slots > batchSize) {
			batches.push(batch);
			batch = [];
			used = 0;
		}
		batch.push(account);
		used += slots;
	}
	if (batch.length > 0) batches.push(batch);
	return batches;
}

/** A short, displayable description of an error for the failures list. */
export function describeError(e: unknown): string {
	const info = errorInfo(e);
	if (info.code !== null) return info.code;
	if (info.status !== null) return `HTTP ${info.status}`;
	return 'Network error';
}

export async function runUnfollows(
	writer: Writer,
	targets: FollowAccount[],
	opts: RunOptions
): Promise<RunResult> {
	const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const batches = splitBatches(targets, opts.batchSize);
	let done = 0;
	let failed = 0;

	for (let i = 0; i < batches.length; i += 1) {
		// Hold while paused; a stop while paused is picked up here.
		while (opts.control.paused) {
			if (opts.control.signal.aborted) return { done, failed, cancelled: true };
			await sleep(PAUSE_POLL_MS);
		}
		if (opts.control.signal.aborted) return { done, failed, cancelled: true };

		let batchResult: [FollowAccount[], Array<{ account: FollowAccount; error: string }>];
		try {
			batchResult = await runBatch(writer, batches[i], opts);
		} catch (e) {
			// A stop mid-batch aborts the in-flight call and rethrows here.
			if (opts.control.signal.aborted) return { done, failed, cancelled: true };
			throw e;
		}
		done += batchResult[0].length;
		failed += batchResult[1].length;
		await opts.onBatchDone(batchResult[0], batchResult[1]);
		opts.onProgress(done, failed, targets.length);

		// Chunks of 250 ms so a Stop lands quickly instead of after a full
		// pause; no sleep after the last batch.
		for (let wait = i < batches.length - 1 ? opts.pauseMs : 0; wait > 0;) {
			const step = Math.min(wait, PAUSE_POLL_MS);
			await sleep(step);
			if (opts.control.signal.aborted) return { done, failed, cancelled: true };
			wait -= step;
		}
	}

	return { done, failed, cancelled: false };
}

/**
 * One batch: one applyWrites with a delete op per rkey. If it fails with a
 * final error (the queue already retried 429s and 5xx), fall back to one
 * deleteRecord per rkey so a single bad record can't sink the batch. An auth
 * failure means the sign-in is dead: no fallback, no next batch; report
 * what already happened and throw SessionExpiredError.
 */
async function runBatch(
	writer: Writer,
	batch: FollowAccount[],
	opts: RunOptions
): Promise<[FollowAccount[], Array<{ account: FollowAccount; error: string }>]> {
	const ops: WriteOp[] = batch.flatMap((a) =>
		a.followRkeys.map((rkey) => ({
			$type: 'com.atproto.repo.applyWrites#delete' as const,
			collection: FOLLOW,
			rkey
		}))
	);
	try {
		await writer.applyWrites(ops, opts.control.signal);
		return [batch, []];
	} catch (e) {
		// A stop: let it propagate so the run returns cancelled.
		if (opts.control.signal.aborted) throw e;
		if (isAuthFailure(e)) throw new SessionExpiredError();
		const done: FollowAccount[] = [];
		const failed: Array<{ account: FollowAccount; error: string }> = [];
		for (const account of batch) {
			let error: string | null = null;
			for (const rkey of account.followRkeys) {
				try {
					await writer.deleteRecord(FOLLOW, rkey, opts.control.signal);
				} catch (e2) {
					if (opts.control.signal.aborted) throw e2;
					if (isAuthFailure(e2)) {
						// The sign-in died mid-fallback: log the accounts
						// already deleted, then stop the run.
						await opts.onBatchDone(done, failed);
						throw new SessionExpiredError();
					}
					error = describeError(e2);
				}
			}
			if (error !== null) failed.push({ account, error });
			else done.push(account);
		}
		return [done, failed];
	}
}
