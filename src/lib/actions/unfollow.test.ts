import { TokenRefreshError } from '@atproto/oauth-client';
import { describe, expect, it } from 'vitest';

import { HttpError, SessionExpiredError } from '#lib/net/errors';
import type { FollowAccount } from '#lib/scan/types';

import { describeError, runUnfollows, splitBatches, type RunOptions } from './unfollow';
import type { WriteOp, Writer } from './writer';

function account(did: string, rkeys: string[]): FollowAccount {
	return {
		did,
		handle: `${did.slice(-6)}.bsky.social`,
		displayName: null,
		avatar: null,
		description: null,
		followRkeys: rkeys,
		followedAt: null,
		createdAt: null,
		followersCount: null,
		followsCount: null,
		postsCount: null,
		followsYou: null,
		labels: [],
		status: 'active',
		activity: null,
		profileScannedAt: null,
		activityScannedAt: null,
		interaction: null
	};
}

/** Records every call and can be told to fail, per the item spec. */
class FakeWriter implements Writer {
	applyWritesCalls: WriteOp[][] = [];
	deleteCalls: Array<{ collection: string; rkey: string }> = [];
	/** When set, applyWrites throws this for every call. */
	applyWritesError: Error | null = null;
	/** deleteRecord throws this for the listed rkeys. */
	failingRkeys = new Map<string, Error>();
	/** These rkeys are already gone; the live writer translates that to success. */
	recordNotFoundRkeys = new Set<string>();
	seenRecordNotFound = new Set<string>();
	onApplyWrites: ((ops: WriteOp[]) => void) | null = null;

	async applyWrites(ops: WriteOp[], signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		this.applyWritesCalls.push(ops);
		this.onApplyWrites?.(ops);
		if (this.applyWritesError !== null) throw this.applyWritesError;
	}
	async deleteRecord(collection: string, rkey: string, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		this.deleteCalls.push({ collection, rkey });
		if (this.recordNotFoundRkeys.has(rkey)) {
			this.seenRecordNotFound.add(rkey);
			return;
		}
		const e = this.failingRkeys.get(rkey);
		if (e !== undefined) throw e;
	}
	async createRecord(collection: string): Promise<{ uri: string }> {
		return { uri: `at://did:plc:test/${collection}/test` };
	}
	async muteActor(): Promise<void> {}
	async unmuteActor(): Promise<void> {}
}

const noSleep = async (): Promise<void> => {};

function baseOpts(writer: FakeWriter, over: Partial<RunOptions> = {}): RunOptions {
	return {
		batchSize: 100,
		pauseMs: 0,
		control: { paused: false, signal: new AbortController().signal },
		reason: 'test',
		onBatchDone: async () => {},
		onProgress: () => {},
		sleep: noSleep,
		...over
	};
}

describe('splitBatches', () => {
	it('keeps an account with 2 rkeys in one batch', () => {
		const two = (did: string) => account(did, [`${did}-a`, `${did}-b`]);
		const batches = splitBatches([two('a'), two('b'), two('c'), account('d', ['d-1'])], 5);
		// a+b = 4 slots, c would make 6 → new batch; c+d = 3 slots.
		expect(batches.map((b) => b.map((a) => a.did))).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
	});

	it('gives an account that alone exceeds the size its own batch', () => {
		const batches = splitBatches([account('big', ['r1', 'r2', 'r3']), account('s', ['s1'])], 2);
		expect(batches.map((b) => b.map((a) => a.did))).toEqual([['big'], ['s']]);
	});
});

describe('runUnfollows', () => {
	it('splits 60 single-rkey accounts at batch size 25 into 25/25/10', async () => {
		const writer = new FakeWriter();
		const targets = Array.from({ length: 60 }, (_, i) => account(`did:plc:a${i}`, [`r${i}`]));
		const progress: Array<[number, number, number]> = [];
		const res = await runUnfollows(
			writer,
			targets,
			baseOpts(writer, {
				batchSize: 25,
				onProgress: (d, f, t) => progress.push([d, f, t])
			})
		);
		expect(writer.applyWritesCalls.map((c) => c.length)).toEqual([25, 25, 10]);
		expect(writer.applyWritesCalls[0][0]).toEqual({
			$type: 'com.atproto.repo.applyWrites#delete',
			collection: 'app.bsky.graph.follow',
			rkey: 'r0'
		});
		expect(progress).toEqual([
			[25, 0, 60],
			[50, 0, 60],
			[60, 0, 60]
		]);
		expect(res).toEqual({ done: 60, failed: 0, cancelled: false });
	});

	it('falls back to per-record deletes when the batch fails; one bad rkey fails only its account', async () => {
		const writer = new FakeWriter();
		writer.applyWritesError = new HttpError(400, null, 'bad batch');
		writer.failingRkeys.set('r1', new HttpError(400, null, 'nope'));
		const targets = [account('a', ['r0']), account('b', ['r1']), account('c', ['r2'])];
		let batchDone: string[] = [];
		let batchFailed: Array<{ did: string; error: string }> = [];
		const res = await runUnfollows(
			writer,
			targets,
			baseOpts(writer, {
				onBatchDone: async (done, failed) => {
					batchDone = done.map((a) => a.did);
					batchFailed = failed.map((f) => ({ did: f.account.did, error: f.error }));
				}
			})
		);
		expect(res).toEqual({ done: 2, failed: 1, cancelled: false });
		expect(batchDone).toEqual(['a', 'c']);
		expect(batchFailed).toEqual([{ did: 'b', error: 'HTTP 400' }]);
		// One deleteRecord per rkey, for every account in the failed batch.
		expect(writer.deleteCalls).toEqual([
			{ collection: 'app.bsky.graph.follow', rkey: 'r0' },
			{ collection: 'app.bsky.graph.follow', rkey: 'r1' },
			{ collection: 'app.bsky.graph.follow', rkey: 'r2' }
		]);
	});

	it('counts a deleteRecord whose record is already gone as success', async () => {
		const writer = new FakeWriter();
		writer.applyWritesError = new HttpError(400, null, 'bad batch');
		writer.recordNotFoundRkeys.add('r0');
		const res = await runUnfollows(writer, [account('a', ['r0'])], baseOpts(writer));
		expect(writer.seenRecordNotFound.has('r0')).toBe(true);
		expect(res).toEqual({ done: 1, failed: 0, cancelled: false });
	});

	it('rejects with SessionExpiredError on an auth failure, with no fallback calls', async () => {
		const writer = new FakeWriter();
		writer.applyWritesError = new HttpError(401, null, 'unauthorized');
		const targets = [account('a', ['r0']), account('b', ['r1'])];
		const p = runUnfollows(writer, targets, baseOpts(writer));
		await expect(p).rejects.toBeInstanceOf(SessionExpiredError);
		// One applyWrites call, no per-record deleteRecord fallback, no
		// second batch.
		expect(writer.applyWritesCalls).toHaveLength(1);
		expect(writer.deleteCalls).toEqual([]);
	});

	it('stops the fallback at an auth error, reporting what already ran', async () => {
		const writer = new FakeWriter();
		writer.applyWritesError = new HttpError(400, null, 'bad batch');
		writer.failingRkeys.set('r1', new TokenRefreshError('did:plc:b', 'refresh failed'));
		let loggedDone: string[] = [];
		const targets = [account('a', ['r0']), account('b', ['r1']), account('c', ['r2'])];
		const p = runUnfollows(
			writer,
			targets,
			baseOpts(writer, {
				onBatchDone: async (done) => {
					loggedDone = done.map((a) => a.did);
				}
			})
		);
		await expect(p).rejects.toBeInstanceOf(SessionExpiredError);
		// a deleted fine in the fallback; b hit the dead session; c never ran.
		expect(writer.deleteCalls.map((c) => c.rkey)).toEqual(['r0', 'r1']);
		expect(loggedDone).toEqual(['a']);
	});

	it('holds the next batch while paused, then continues', async () => {
		const writer = new FakeWriter();
		const ctl = { paused: true, signal: new AbortController().signal };
		let polls = 0;
		let pausedAtCall = true;
		writer.onApplyWrites = () => {
			pausedAtCall = ctl.paused;
		};
		const res = await runUnfollows(
			writer,
			[account('a', ['r0'])],
			baseOpts(writer, {
				batchSize: 1,
				control: ctl,
				sleep: async () => {
					polls += 1;
					if (polls === 3) ctl.paused = false;
				}
			})
		);
		expect(polls).toBe(3);
		expect(pausedAtCall).toBe(false);
		expect(writer.applyWritesCalls).toHaveLength(1);
		expect(res).toEqual({ done: 1, failed: 0, cancelled: false });
	});

	it('returns cancelled when aborted between batches, without calling the writer again', async () => {
		const writer = new FakeWriter();
		const ac = new AbortController();
		writer.onApplyWrites = () => {
			if (writer.applyWritesCalls.length === 1) ac.abort();
		};
		const targets = [account('a', ['r0']), account('b', ['r1'])];
		const res = await runUnfollows(
			writer,
			targets,
			baseOpts(writer, { batchSize: 1, control: { paused: false, signal: ac.signal } })
		);
		expect(res.cancelled).toBe(true);
		expect(res.done).toBe(1);
		expect(writer.applyWritesCalls).toHaveLength(1);
	});

	it('sleeps pauseMs between batches but not after the last', async () => {
		const writer = new FakeWriter();
		const sleeps: number[] = [];
		const targets = [account('a', ['r0']), account('b', ['r1'])];
		await runUnfollows(
			writer,
			targets,
			baseOpts(writer, {
				batchSize: 1,
				pauseMs: 1000,
				sleep: async (ms) => {
					sleeps.push(ms);
				}
			})
		);
		// The 1000 ms pause is slept in chunks between the two batches;
		// nothing is slept after the last.
		expect(sleeps.every((ms) => ms <= 250)).toBe(true);
		expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(1000);
	});
});

describe('describeError', () => {
	it('prefers the xrpc code, then the status, then a generic message', () => {
		expect(describeError(new HttpError(400, 'RateLimitExceeded', 'x'))).toBe('RateLimitExceeded');
		expect(describeError(new HttpError(400, null, 'x'))).toBe('HTTP 400');
		expect(describeError(new HttpError(0, null, 'x'))).toBe('Network error');
		expect(describeError(new Error('mystery'))).toBe('Network error');
	});
});
