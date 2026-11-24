import 'fake-indexeddb/auto';

import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';

import type { FollowAccount } from '#lib/scan/types';

import { deleteDatabase, openStore, type Store } from './store';

/**
 * fake-indexeddb keeps state for the whole process, so every test opens a
 * fresh database with a unique did instead of sharing one.
 */
let n = 0;
async function fresh(): Promise<{ store: Store; did: string }> {
	n += 1;
	const did = `did:plc:test-${n}`;
	return { store: await openStore(did), did };
}

/** Fails the test when a delete hangs on an open connection. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return await Promise.race([
		p,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error(label)), ms))
	]);
}

function account(did: string, overrides: Partial<FollowAccount> = {}): FollowAccount {
	return {
		did,
		handle: did.slice('did:plc:'.length) + '.bsky.social',
		displayName: null,
		avatar: null,
		description: null,
		followRkeys: ['rkey1'],
		followedAt: '2026-01-01T00:00:00.000Z',
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
		interaction: null,
		...overrides
	};
}

describe('accounts', () => {
	it('round-trips put and get', async () => {
		const { store } = await fresh();
		await store.putAccounts([account('did:plc:a'), account('did:plc:b', { status: 'gone' })]);
		const all = await store.getAllAccounts();
		expect(all).toHaveLength(2);
		expect(all.find((a) => a.did === 'did:plc:b')?.status).toBe('gone');
		expect(all.find((a) => a.did === 'did:plc:a')?.followRkeys).toEqual(['rkey1']);
	});

	it('reads a pre-1.1 row (no interaction property) as interaction: null', async () => {
		const { store, did } = await fresh();
		// Write a raw row without the 1.1 property, like a 1.0.x database.
		const raw = await openDB(`tidysky:${did}`);
		const row = account(did);
		delete (row as Partial<FollowAccount>).interaction;
		await raw.put('accounts', row);
		const all = await store.getAllAccounts();
		expect(all).toHaveLength(1);
		expect(all[0].did).toBe(did);
		expect(all[0].interaction).toBeNull();
	});

	it('deleteAccounts removes only the named DIDs', async () => {
		const { store } = await fresh();
		await store.putAccounts([account('did:plc:a'), account('did:plc:b'), account('did:plc:c')]);
		await store.deleteAccounts(['did:plc:b']);
		const all = await store.getAllAccounts();
		expect(all.map((a) => a.did).sort()).toEqual(['did:plc:a', 'did:plc:c']);
	});
});

describe('snapshots', () => {
	const totals = { follows: 10, active30: 5, quiet90: 3, gone: 1, followsYou: 2 };

	it('come back newest first and prune down to N', async () => {
		const { store } = await fresh();
		for (let i = 1; i <= 5; i += 1) {
			await store.addSnapshot({ at: `2026-01-0${i}T00:00:00.000Z`, statuses: {}, totals });
		}
		const all = await store.listSnapshots();
		expect(all).toHaveLength(5);
		expect(all.map((s) => s.at)).toEqual([
			'2026-01-05T00:00:00.000Z',
			'2026-01-04T00:00:00.000Z',
			'2026-01-03T00:00:00.000Z',
			'2026-01-02T00:00:00.000Z',
			'2026-01-01T00:00:00.000Z'
		]);

		await store.pruneSnapshots(2);
		const after = await store.listSnapshots();
		expect(after.map((s) => s.at)).toEqual([
			'2026-01-05T00:00:00.000Z',
			'2026-01-04T00:00:00.000Z'
		]);

		// Pruning when there is nothing to prune is a no-op.
		await store.pruneSnapshots(10);
		expect((await store.listSnapshots()).length).toBe(2);
	});
});

describe('log', () => {
	it('countUnfollowsSince counts unfollows and move-to-lists after the time, not mutes or undone ones', async () => {
		const { store } = await fresh();
		// Before the cutoff.
		await store.addLog({
			did: 'did:plc:a',
			handle: 'a.bsky.social',
			at: '2026-11-01T10:00:00.000Z',
			reason: 'quiet',
			action: 'unfollow'
		});
		// After the cutoff.
		const idB = await store.addLog({
			did: 'did:plc:b',
			handle: 'b.bsky.social',
			at: '2026-11-02T10:00:00.000Z',
			reason: 'quiet',
			action: 'unfollow'
		});
		// After the cutoff: a move-to-list unfollows too, so it counts.
		await store.addLog({
			did: 'did:plc:m',
			handle: 'm.bsky.social',
			at: '2026-11-02T10:30:00.000Z',
			reason: 'quiet',
			action: 'move-to-list'
		});
		// After the cutoff, but a mute, not an unfollow.
		await store.addLog({
			did: 'did:plc:c',
			handle: 'c.bsky.social',
			at: '2026-11-02T11:00:00.000Z',
			reason: 'spam label',
			action: 'mute'
		});

		const cutoff = '2026-11-01T12:00:00.000Z';
		expect(await store.countUnfollowsSince(cutoff)).toBe(2);

		await store.markUndone(idB, '2026-11-02T12:00:00.000Z');
		expect(await store.countUnfollowsSince(cutoff)).toBe(1);

		// The older, not-undone unfollow still counts for an earlier cutoff.
		expect(await store.countUnfollowsSince('2026-10-01T00:00:00.000Z')).toBe(2);
	});

	it('listLog returns entries newest first', async () => {
		const { store } = await fresh();
		await store.addLog({
			did: 'did:plc:a',
			handle: 'a.bsky.social',
			at: '2026-11-01T10:00:00.000Z',
			reason: 'quiet',
			action: 'unfollow'
		});
		await store.addLog({
			did: 'did:plc:b',
			handle: 'b.bsky.social',
			at: '2026-11-02T10:00:00.000Z',
			reason: 'quiet',
			action: 'mute'
		});
		const log = await store.listLog();
		expect(log.map((e) => e.did)).toEqual(['did:plc:b', 'did:plc:a']);
	});
});

describe('meta and keep', () => {
	it('meta round-trips as a single value', async () => {
		const { store } = await fresh();
		expect(await store.getMeta()).toBeNull();
		const meta = {
			lastScanStartedAt: null,
			lastScanFinishedAt: '2026-11-01T00:00:00.000Z',
			followCount: 7,
			interactionsScannedAt: null,
			interactionsCoveredSince: null
		};
		await store.putMeta(meta);
		expect(await store.getMeta()).toEqual(meta);
	});

	it('reads a pre-1.1 meta row with the interaction fields as null', async () => {
		const { store, did } = await fresh();
		const raw = await openDB(`tidysky:${did}`);
		// The meta store uses out-of-line keys: the key goes in the third arg.
		await raw.put(
			'meta',
			{
				lastScanStartedAt: null,
				lastScanFinishedAt: '2026-11-01T00:00:00.000Z',
				followCount: 3
			},
			'scan'
		);
		const meta = await store.getMeta();
		expect(meta).not.toBeNull();
		expect(meta?.followCount).toBe(3);
		expect(meta?.interactionsScannedAt).toBeNull();
		expect(meta?.interactionsCoveredSince).toBeNull();
	});

	it('keep is a set of DIDs that toggles on and off', async () => {
		const { store } = await fresh();
		await store.setKeep('did:plc:a', true);
		await store.setKeep('did:plc:b', true);
		expect((await store.getKeep()).sort()).toEqual(['did:plc:a', 'did:plc:b']);
		await store.setKeep('did:plc:a', false);
		expect(await store.getKeep()).toEqual(['did:plc:b']);
	});
});

describe('connection sharing', () => {
	it('two openStore calls share one connection', async () => {
		const n = 1; // fresh() is used elsewhere; pick an unused did here
		const did = `did:plc:shared-${n}`;
		const a = await openStore(did);
		const b = await openStore(did);
		await a.putAccounts([account('did:plc:shared')]);
		// A write through one is visible through the other: same database.
		const all = await b.getAllAccounts();
		expect(all).toHaveLength(1);
		expect(all[0].did).toBe('did:plc:shared');
	});
});

describe('deleteDatabase', () => {
	it('empties everything', async () => {
		const { store, did } = await fresh();
		await store.putAccounts([account('did:plc:a')]);
		await store.addSnapshot({
			at: '2026-01-01T00:00:00.000Z',
			statuses: {},
			totals: { follows: 1, active30: 0, quiet90: 0, gone: 0, followsYou: 0 }
		});
		await store.putMeta({
			lastScanStartedAt: null,
			lastScanFinishedAt: null,
			followCount: 1,
			interactionsScannedAt: null,
			interactionsCoveredSince: null
		});
		await store.setKeep(did, true);

		const res = await withTimeout(deleteDatabase(did), 2000, 'deleteDatabase hung');
		expect(res.blocked).toBe(false);

		const again = await openStore(did);
		expect(await again.getAllAccounts()).toEqual([]);
		expect(await again.getMeta()).toBeNull();
		expect(await again.listSnapshots()).toEqual([]);
		expect(await again.getKeep()).toEqual([]);
	});

	it('resolves with a fresh store empty after opening twice and writing a row', async () => {
		const did = 'did:plc:twice';
		const a = await openStore(did);
		const b = await openStore(did);
		await a.putAccounts([account('did:plc:row')]);
		void b;

		await withTimeout(deleteDatabase(did), 2000, 'deleteDatabase hung');
		const freshStore = await openStore(did);
		expect(await freshStore.getAllAccounts()).toEqual([]);
	});
});
