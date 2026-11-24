import { TokenRefreshError } from '@atproto/oauth-client';
import { describe, expect, it } from 'vitest';

import { HttpError, SessionExpiredError } from '#lib/net/errors';

import {
	CURATELIST,
	LIST_DESCRIPTION_MAX,
	LIST_NAME_MAX,
	createList,
	deleteList,
	diffMembers,
	listUrl,
	syncMembers,
	validateList,
	writePoints,
	type DeleteListOptions,
	type SyncOptions
} from './lists';
import type { WriteOp, Writer } from './writer';

const LIST_URI = 'at://did:plc:me/app.bsky.graph.list/abc123';

/** Records every call and can be told to fail, per the item spec. */
class FakeWriter implements Writer {
	applyWritesCalls: WriteOp[][] = [];
	createCalls: Array<{ collection: string; value: Record<string, unknown> }> = [];
	deleteCalls: Array<{ collection: string; rkey: string }> = [];
	/** When set, applyWrites throws this for every call. */
	applyWritesError: Error | null = null;
	/** createRecord throws this for the listed subjects. */
	failingSubjects = new Map<string, Error>();
	/** deleteRecord throws this for the listed rkeys. */
	failingDeleteRkeys = new Map<string, Error>();
	onApplyWrites: ((ops: WriteOp[]) => void) | null = null;
	private counter = 0;

	async applyWrites(ops: WriteOp[], signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		this.applyWritesCalls.push(ops);
		this.onApplyWrites?.(ops);
		if (this.applyWritesError !== null) throw this.applyWritesError;
	}
	async deleteRecord(collection: string, rkey: string, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		this.deleteCalls.push({ collection, rkey });
		const e = this.failingDeleteRkeys.get(rkey);
		if (e !== undefined) throw e;
	}
	async createRecord(
		collection: string,
		value: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<{ uri: string }> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		this.createCalls.push({ collection, value });
		const subject: string = typeof value['subject'] === 'string' ? value['subject'] : '';
		const e = this.failingSubjects.get(subject);
		if (e !== undefined) throw e;
		this.counter += 1;
		return { uri: `at://did:plc:me/${collection}/${this.counter.toString(36)}` };
	}
	async muteActor(): Promise<void> {}
	async unmuteActor(): Promise<void> {}
}

const noSleep = async (): Promise<void> => {};

function syncOpts(over: Partial<SyncOptions> = {}): SyncOptions {
	return {
		batchSize: 100,
		pauseMs: 0,
		control: { paused: false, signal: new AbortController().signal },
		onProgress: () => {},
		sleep: noSleep,
		...over
	};
}

function deleteOpts(over: Partial<DeleteListOptions> = {}): DeleteListOptions {
	return {
		batchSize: 100,
		pauseMs: 0,
		control: { paused: false, signal: new AbortController().signal },
		sleep: noSleep,
		...over
	};
}

describe('validateList', () => {
	it('accepts a valid name and a description at the 300-character limit', () => {
		expect(validateList('Quiet voices', 'x'.repeat(LIST_DESCRIPTION_MAX))).toBeNull();
		expect(validateList('a'.repeat(LIST_NAME_MAX), '')).toBeNull();
	});

	it('rejects an empty or blank name', () => {
		expect(validateList('', '')).toBe('The list needs a name.');
		expect(validateList('   ', '')).toBe('The list needs a name.');
	});

	it('rejects a name over 64 characters', () => {
		expect(validateList('a'.repeat(LIST_NAME_MAX + 1), '')).not.toBeNull();
	});

	it('rejects a description over 300 characters', () => {
		expect(validateList('ok', 'x'.repeat(LIST_DESCRIPTION_MAX + 1))).not.toBeNull();
	});
});

describe('createList', () => {
	it('creates a curatelist record and returns the uri and rkey', async () => {
		const writer = new FakeWriter();
		const res = await createList(
			writer,
			'did:plc:me',
			'  Quiet voices  ',
			'  People who post little.  '
		);
		expect(res.uri).toBe('at://did:plc:me/app.bsky.graph.list/1');
		expect(res.rkey).toBe('1');
		expect(writer.createCalls).toHaveLength(1);
		expect(writer.createCalls[0].collection).toBe('app.bsky.graph.list');
		const value = writer.createCalls[0].value;
		expect(value).toMatchObject({
			$type: 'app.bsky.graph.list',
			purpose: CURATELIST,
			name: 'Quiet voices',
			description: 'People who post little.'
		});
		expect(typeof value['createdAt']).toBe('string');
	});

	it('omits the description when it is blank', async () => {
		const writer = new FakeWriter();
		await createList(writer, 'did:plc:me', 'Quiet voices', '   ');
		expect('description' in writer.createCalls[0].value).toBe(false);
	});

	it('throws before writing when the fields are invalid', async () => {
		const writer = new FakeWriter();
		await expect(createList(writer, 'did:plc:me', '', '')).rejects.toThrow(
			'The list needs a name.'
		);
		expect(writer.createCalls).toHaveLength(0);
	});
});

describe('diffMembers', () => {
	it('adds every DID that is not a current member', () => {
		const { add, remove } = diffMembers(['a', 'b', 'c'], new Map());
		expect(add).toEqual(['a', 'b', 'c']);
		expect(remove).toEqual([]);
	});

	it('removes current members that are not desired', () => {
		const current = new Map([
			['a', 'r1'],
			['b', 'r2']
		]);
		const { add, remove } = diffMembers([], current);
		expect(add).toEqual([]);
		expect(remove).toEqual([
			{ did: 'a', rkey: 'r1' },
			{ did: 'b', rkey: 'r2' }
		]);
	});

	it('no-ops when the sets match', () => {
		const current = new Map([
			['a', 'r1'],
			['b', 'r2']
		]);
		const { add, remove } = diffMembers(['a', 'b'], current);
		expect(add).toEqual([]);
		expect(remove).toEqual([]);
	});

	it('handles adds and removes at once, and counts duplicates once', () => {
		const current = new Map([
			['a', 'r1'],
			['b', 'r2'],
			['c', 'r3']
		]);
		const { add, remove } = diffMembers(['b', 'c', 'd', 'd'], current);
		expect(add).toEqual(['d']);
		expect(remove).toEqual([{ did: 'a', rkey: 'r1' }]);
	});
});

describe('writePoints', () => {
	it('costs 3 per add and 1 per remove', () => {
		expect(writePoints(300, 10)).toBe(910);
		expect(writePoints(0, 0)).toBe(0);
		expect(writePoints(1, 2)).toBe(5);
	});
});

describe('listUrl', () => {
	it('points at the profile lists page', () => {
		expect(listUrl('did:plc:abc', 'rkey123')).toBe(
			'https://bsky.app/profile/did:plc:abc/lists/rkey123'
		);
	});
});

describe('syncMembers', () => {
	it('adds then removes in batches of the given size, with progress', async () => {
		const writer = new FakeWriter();
		const progress: Array<[number, number]> = [];
		const res = await syncMembers(
			writer,
			LIST_URI,
			['a', 'b', 'c'],
			[
				{ did: 'x', rkey: 'rx' },
				{ did: 'y', rkey: 'ry' }
			],
			syncOpts({
				batchSize: 2,
				onProgress: (d, t) => progress.push([d, t])
			})
		);
		// Adds first, then removes: [a,b] [c,x] [y].
		expect(writer.applyWritesCalls.map((c) => c.length)).toEqual([2, 2, 1]);
		expect(writer.applyWritesCalls[0][0]).toEqual({
			$type: 'com.atproto.repo.applyWrites#create',
			collection: 'app.bsky.graph.listitem',
			value: {
				$type: 'app.bsky.graph.listitem',
				subject: 'a',
				list: LIST_URI,
				createdAt: expect.any(String)
			}
		});
		expect(writer.applyWritesCalls[1][1]).toEqual({
			$type: 'com.atproto.repo.applyWrites#delete',
			collection: 'app.bsky.graph.listitem',
			rkey: 'rx'
		});
		expect(progress).toEqual([
			[2, 5],
			[4, 5],
			[5, 5]
		]);
		expect(res.added).toEqual(['a', 'b', 'c']);
		expect(res.removed).toEqual(['x', 'y']);
		expect(res.failed).toEqual([]);
	});

	it('does nothing when there is no diff', async () => {
		const writer = new FakeWriter();
		const res = await syncMembers(writer, LIST_URI, [], [], syncOpts());
		expect(res).toEqual({ added: [], removed: [], failed: [] });
		expect(writer.applyWritesCalls).toHaveLength(0);
	});

	it('a failing batch falls back per member; one bad add fails alone', async () => {
		const writer = new FakeWriter();
		writer.applyWritesError = new HttpError(400, null, 'bad batch');
		writer.failingSubjects.set('b', new HttpError(400, null, 'nope'));
		const res = await syncMembers(writer, LIST_URI, ['a', 'b', 'c'], [], syncOpts());
		expect(res.added).toEqual(['a', 'c']);
		expect(res.failed).toEqual([{ did: 'b', error: 'HTTP 400' }]);
		// One createRecord per member, for the whole failed batch.
		expect(writer.createCalls.map((c) => c.value['subject'])).toEqual(['a', 'b', 'c']);
	});

	it('a failing batch falls back per member for removes too', async () => {
		const writer = new FakeWriter();
		writer.applyWritesError = new HttpError(400, null, 'bad batch');
		writer.failingDeleteRkeys.set('ry', new HttpError(400, null, 'nope'));
		const res = await syncMembers(
			writer,
			LIST_URI,
			[],
			[
				{ did: 'x', rkey: 'rx' },
				{ did: 'y', rkey: 'ry' }
			],
			syncOpts()
		);
		expect(res.removed).toEqual(['x']);
		expect(res.failed).toEqual([{ did: 'y', error: 'HTTP 400' }]);
		expect(writer.deleteCalls).toEqual([
			{ collection: 'app.bsky.graph.listitem', rkey: 'rx' },
			{ collection: 'app.bsky.graph.listitem', rkey: 'ry' }
		]);
	});

	it('rejects with SessionExpiredError on an auth failure, with no per-member fallback', async () => {
		const writer = new FakeWriter();
		writer.applyWritesError = new HttpError(401, null, 'unauthorized');
		const p = syncMembers(writer, LIST_URI, ['a', 'b'], [], syncOpts());
		await expect(p).rejects.toBeInstanceOf(SessionExpiredError);
		// One applyWrites call, no createRecord / deleteRecord fallback.
		expect(writer.applyWritesCalls).toHaveLength(1);
		expect(writer.createCalls).toEqual([]);
		expect(writer.deleteCalls).toEqual([]);
	});

	it('stops the per-member fallback at an auth error', async () => {
		const writer = new FakeWriter();
		writer.applyWritesError = new HttpError(400, null, 'bad batch');
		writer.failingSubjects.set('b', new TokenRefreshError('did:plc:b', 'refresh failed'));
		const p = syncMembers(writer, LIST_URI, ['a', 'b', 'c'], [], syncOpts());
		await expect(p).rejects.toBeInstanceOf(SessionExpiredError);
		// a created in the fallback; b hit the dead session; c never ran.
		expect(writer.createCalls.map((c) => c.value['subject'])).toEqual(['a', 'b']);
	});

	it('holds the next batch while paused, then continues', async () => {
		const writer = new FakeWriter();
		const ctl = { paused: true, signal: new AbortController().signal };
		let polls = 0;
		let pausedAtCall = true;
		writer.onApplyWrites = () => {
			pausedAtCall = ctl.paused;
		};
		const res = await syncMembers(
			writer,
			LIST_URI,
			['a', 'b'],
			[],
			syncOpts({
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
		expect(writer.applyWritesCalls).toHaveLength(2);
		expect(res.added).toEqual(['a', 'b']);
	});

	it('returns the partial result when stopped between batches', async () => {
		const writer = new FakeWriter();
		const ac = new AbortController();
		writer.onApplyWrites = () => {
			if (writer.applyWritesCalls.length === 1) ac.abort();
		};
		const res = await syncMembers(
			writer,
			LIST_URI,
			['a', 'b'],
			[],
			syncOpts({ batchSize: 1, control: { paused: false, signal: ac.signal } })
		);
		expect(res.added).toEqual(['a']);
		expect(writer.applyWritesCalls).toHaveLength(1);
	});

	it('sleeps pauseMs between batches but not after the last', async () => {
		const writer = new FakeWriter();
		const sleeps: number[] = [];
		await syncMembers(
			writer,
			LIST_URI,
			['a', 'b'],
			[],
			syncOpts({
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

describe('deleteList', () => {
	it('deletes the items first, then the list record, with progress', async () => {
		const writer = new FakeWriter();
		const progress: Array<[number, number]> = [];
		await deleteList(
			writer,
			'list-rkey',
			['r0', 'r1', 'r2'],
			deleteOpts({ batchSize: 2, onProgress: (d, t) => progress.push([d, t]) })
		);
		expect(writer.applyWritesCalls.map((c) => c.length)).toEqual([2, 1]);
		expect(writer.applyWritesCalls[0][0]).toEqual({
			$type: 'com.atproto.repo.applyWrites#delete',
			collection: 'app.bsky.graph.listitem',
			rkey: 'r0'
		});
		// The list record is deleted, and only via deleteRecord.
		expect(writer.deleteCalls).toEqual([{ collection: 'app.bsky.graph.list', rkey: 'list-rkey' }]);
		expect(progress).toEqual([
			[2, 4],
			[3, 4],
			[4, 4]
		]);
	});

	it('leaves the list in place and throws when a member delete fails', async () => {
		const writer = new FakeWriter();
		writer.applyWritesError = new HttpError(400, null, 'bad batch');
		writer.failingDeleteRkeys.set('r1', new HttpError(400, null, 'nope'));
		await expect(deleteList(writer, 'list-rkey', ['r0', 'r1', 'r2'], deleteOpts())).rejects.toThrow(
			/could not be removed/
		);
		// The fallback ran for every item; the list record was never touched.
		expect(writer.deleteCalls.map((c) => c.rkey)).toEqual(['r0', 'r1', 'r2']);
		expect(writer.deleteCalls.every((c) => c.collection === 'app.bsky.graph.listitem')).toBe(true);
	});

	it('rejects with SessionExpiredError when the batch fails with an auth error', async () => {
		const writer = new FakeWriter();
		writer.applyWritesError = new HttpError(401, null, 'unauthorized');
		await expect(
			deleteList(writer, 'list-rkey', ['r0', 'r1'], deleteOpts())
		).rejects.toBeInstanceOf(SessionExpiredError);
		// No per-item fallback; the list record was never touched.
		expect(writer.applyWritesCalls).toHaveLength(1);
		expect(writer.deleteCalls).toEqual([]);
	});

	it('aborts between batches, throws, and leaves the list in place', async () => {
		const writer = new FakeWriter();
		const ac = new AbortController();
		writer.onApplyWrites = () => {
			if (writer.applyWritesCalls.length === 1) ac.abort();
		};
		await expect(
			deleteList(
				writer,
				'list-rkey',
				['r0', 'r1'],
				deleteOpts({ batchSize: 1, control: { paused: false, signal: ac.signal } })
			)
		).rejects.toThrow();
		expect(writer.deleteCalls).toEqual([]);
	});
});
