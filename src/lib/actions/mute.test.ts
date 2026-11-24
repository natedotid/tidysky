import { TokenRefreshError } from '@atproto/oauth-client';
import { describe, expect, it } from 'vitest';

import { HttpError, SessionExpiredError } from '#lib/net/errors';
import type { FollowAccount } from '#lib/scan/types';

import { runMutes, type MuteOptions } from './mute';
import type { Writer } from './writer';

function account(did: string): FollowAccount {
	return {
		did,
		handle: `${did.slice(-6)}.bsky.social`,
		displayName: null,
		avatar: null,
		description: null,
		followRkeys: [`${did}-r`],
		followedAt: null,
		createdAt: null,
		followersCount: null,
		followsCount: null,
		postsCount: null,
		followsYou: null,
		viewer: null,
		labels: [],
		status: 'active',
		activity: null,
		profileScannedAt: null,
		activityScannedAt: null,
		interaction: null
	};
}

/** Records every mute and can be told to fail, per the item spec. */
class FakeWriter implements Writer {
	muteCalls: string[] = [];
	unmuteCalls: string[] = [];
	/** muteActor throws this for the listed dids. */
	failingDids = new Map<string, Error>();
	onMute: ((did: string) => void) | null = null;

	async applyWrites(): Promise<void> {}
	async deleteRecord(): Promise<void> {}
	async createRecord(): Promise<{ uri: string }> {
		return { uri: 'at://did:plc:test/app.bsky.graph.follow/r' };
	}
	async muteActor(did: string, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		this.muteCalls.push(did);
		this.onMute?.(did);
		const e = this.failingDids.get(did);
		if (e !== undefined) throw e;
	}
	async unmuteActor(did: string, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		this.unmuteCalls.push(did);
	}
}

const noSleep = async (): Promise<void> => {};

function baseOpts(writer: FakeWriter, over: Partial<MuteOptions> = {}): MuteOptions {
	return {
		pauseMs: 0,
		control: { paused: false, signal: new AbortController().signal },
		onAccountDone: async () => {},
		onProgress: () => {},
		sleep: noSleep,
		...over
	};
}

describe('runMutes', () => {
	it('mutes each target once, in order', async () => {
		const writer = new FakeWriter();
		const logged: Array<{ did: string; error: string | null }> = [];
		const res = await runMutes(
			writer,
			[account('a'), account('b'), account('c')],
			baseOpts(writer, {
				onAccountDone: async (a, error) => {
					logged.push({ did: a.did, error });
				}
			})
		);
		expect(writer.muteCalls).toEqual(['a', 'b', 'c']);
		expect(logged).toEqual([
			{ did: 'a', error: null },
			{ did: 'b', error: null },
			{ did: 'c', error: null }
		]);
		expect(res).toEqual({ done: 3, failed: 0, cancelled: false });
	});

	it('reports a failure per account and keeps going', async () => {
		const writer = new FakeWriter();
		writer.failingDids.set('b', new HttpError(400, null, 'nope'));
		const failed: Array<{ did: string; error: string }> = [];
		const res = await runMutes(
			writer,
			[account('a'), account('b'), account('c')],
			baseOpts(writer, {
				onAccountDone: async (a, error) => {
					if (error !== null) failed.push({ did: a.did, error });
				}
			})
		);
		expect(res).toEqual({ done: 2, failed: 1, cancelled: false });
		expect(failed).toEqual([{ did: 'b', error: 'HTTP 400' }]);
	});

	it('rejects with SessionExpiredError on an auth error, without muting the rest', async () => {
		const writer = new FakeWriter();
		writer.failingDids.set('b', new TokenRefreshError('did:plc:b', 'refresh failed'));
		const logged: string[] = [];
		const p = runMutes(
			writer,
			[account('a'), account('b'), account('c')],
			baseOpts(writer, {
				onAccountDone: async (a, error) => {
					if (error === null) logged.push(a.did);
				}
			})
		);
		await expect(p).rejects.toBeInstanceOf(SessionExpiredError);
		// a muted and logged; b failed dead; c never tried.
		expect(writer.muteCalls).toEqual(['a', 'b']);
		expect(logged).toEqual(['a']);
	});

	it('stops early when aborted, without calling the writer again', async () => {
		const writer = new FakeWriter();
		const ac = new AbortController();
		writer.onMute = () => {
			if (writer.muteCalls.length === 2) ac.abort();
		};
		const res = await runMutes(
			writer,
			[account('a'), account('b'), account('c')],
			baseOpts(writer, { control: { paused: false, signal: ac.signal } })
		);
		expect(res.cancelled).toBe(true);
		expect(res.done).toBe(2);
		expect(writer.muteCalls).toHaveLength(2);
	});

	it('holds the next call while paused, then continues', async () => {
		const writer = new FakeWriter();
		const ctl = { paused: true, signal: new AbortController().signal };
		let polls = 0;
		let pausedAtCall = true;
		writer.onMute = () => {
			pausedAtCall = ctl.paused;
		};
		const res = await runMutes(
			writer,
			[account('a')],
			baseOpts(writer, {
				control: ctl,
				sleep: async () => {
					polls += 1;
					if (polls === 3) ctl.paused = false;
				}
			})
		);
		expect(polls).toBe(3);
		expect(pausedAtCall).toBe(false);
		expect(writer.muteCalls).toHaveLength(1);
		expect(res).toEqual({ done: 1, failed: 0, cancelled: false });
	});

	it('sleeps pauseMs between calls but not after the last', async () => {
		const writer = new FakeWriter();
		const sleeps: number[] = [];
		await runMutes(
			writer,
			[account('a'), account('b')],
			baseOpts(writer, {
				pauseMs: 500,
				sleep: async (ms) => {
					sleeps.push(ms);
				}
			})
		);
		expect(sleeps.every((ms) => ms <= 250)).toBe(true);
		expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(500);
	});
});
