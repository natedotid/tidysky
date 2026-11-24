import { describe, expect, it } from 'vitest';

import { SessionExpiredError } from '#lib/net/errors';
import type { Store } from '#lib/db/store';

import type { FeedItemLite } from './classify';
import { runScan, type ScanProgress } from './scan';
import type {
	AuthorFeedResult,
	DataSource,
	FollowRecord,
	FollowersSample,
	ListItemRecord,
	OwnCollection,
	OwnFeedItem,
	OwnRecord,
	ProfileLite,
	YouData
} from './source';
import type { FollowAccount, ManagedList, ScanMeta, Snapshot, UnfollowLogEntry } from './types';

const NOW = new Date('2026-11-02T12:00:00Z');
const now = () => NOW;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An in-memory Store, standing in for IndexedDB. */
function memoryStore(): Store {
	const accounts = new Map<string, FollowAccount>();
	let meta: ScanMeta | null = null;
	const snapshots: Snapshot[] = [];
	const log: UnfollowLogEntry[] = [];
	const keep = new Set<string>();
	const lists = new Map<string, ManagedList>();
	let you: YouData | null = null;
	let nextId = 1;
	return {
		getAllAccounts: async () => [...accounts.values()],
		putAccounts: async (rows) => {
			for (const row of rows) accounts.set(row.did, row);
		},
		deleteAccounts: async (dids) => {
			for (const did of dids) accounts.delete(did);
		},
		getMeta: async () => meta,
		putMeta: async (m) => {
			meta = m;
		},
		getYou: async () => you,
		putYou: async (y) => {
			you = y;
		},
		addSnapshot: async (s) => {
			const id = nextId++;
			snapshots.push({ ...s, id });
			return id;
		},
		listSnapshots: async () => [...snapshots].sort((a, b) => (b.id ?? 0) - (a.id ?? 0)),
		pruneSnapshots: async (n) => {
			while (snapshots.length > n) snapshots.shift();
		},
		addLog: async (e) => {
			const id = nextId++;
			log.push({ ...e, id });
			return id;
		},
		listLog: async () => [...log].sort((a, b) => (b.id ?? 0) - (a.id ?? 0)),
		markUndone: async (id, at) => {
			const entry = log.find((e) => e.id === id);
			if (entry) entry.undoneAt = at;
		},
		countUnfollowsSince: async (t) =>
			log.filter((e) => e.action === 'unfollow' && e.at > t && e.undoneAt === undefined).length,
		getKeep: async () => [...keep],
		setKeep: async (did, on) => {
			if (on) keep.add(did);
			else keep.delete(did);
		},
		getLists: async () => [...lists.values()],
		putList: async (l) => {
			lists.set(l.uri, l);
		},
		deleteList: async (uri) => {
			lists.delete(uri);
		}
	};
}

interface FakeSourceConfig {
	followPages: Array<{ records: FollowRecord[]; cursor: string | undefined }>;
	profiles?: Map<string, ProfileLite>;
	feeds?: Map<string, AuthorFeedResult>;
	/** Per-DID delay (ms) before a feed resolves; used to time an abort. */
	feedDelay?: Record<string, number>;
	/** Called synchronously when a feed call starts. */
	onFeedCall?: (did: string) => void;
	/** When set, every getProfiles call rejects with this error. */
	profileError?: Error;
	/** The user's own records per collection (one page each), newest first. */
	ownRecords?: Partial<Record<OwnCollection, OwnRecord[]>>;
	/** When set, listOwnRecords rejects with this error. */
	ownError?: Error;
}

function makeFakeSource(cfg: FakeSourceConfig): {
	src: DataSource;
	calls: { followPages: number; profileCalls: string[][]; feedCalls: string[] };
} {
	const calls = { followPages: 0, profileCalls: [] as string[][], feedCalls: [] as string[] };
	let page = 0; // resets when a new scan starts paging from no cursor
	const src: DataSource = {
		did: 'did:plc:me',
		async listFollowRecords(cursor) {
			if (cursor === undefined) page = 0;
			const next = cfg.followPages[page];
			page += 1;
			calls.followPages += 1;
			if (next === undefined) throw new Error('fake: no more follow pages');
			await sleep(0);
			return next;
		},
		async getProfiles(dids) {
			calls.profileCalls.push([...dids]);
			if (cfg.profileError) throw cfg.profileError;
			await sleep(0);
			return dids.map((d) => cfg.profiles?.get(d)).filter((p): p is ProfileLite => p !== undefined);
		},
		async getAuthorFeed(did, _limit, signal) {
			calls.feedCalls.push(did);
			cfg.onFeedCall?.(did);
			await sleep(cfg.feedDelay?.[did] ?? 0);
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			const res = cfg.feeds?.get(did);
			if (res === undefined) throw new Error('fake: no feed configured for ' + did);
			return res;
		},
		getOwnProfile: async () => profile('did:plc:me', 'me.bsky.social'),
		getOwnFeed: async (): Promise<OwnFeedItem[]> => [],
		getFollowersSample: async (): Promise<FollowersSample> => ({ profiles: [], complete: true }),
		listListItems: async (): Promise<{
			records: ListItemRecord[];
			cursor: string | undefined;
		}> => ({ records: [], cursor: undefined }),
		async listOwnRecords(collection) {
			if (cfg.ownError) throw cfg.ownError;
			await sleep(0);
			return { records: cfg.ownRecords?.[collection] ?? [], cursor: undefined };
		}
	};
	return { src, calls };
}

function account(did: string, overrides: Partial<FollowAccount> = {}): FollowAccount {
	return {
		did,
		handle: did.slice('did:plc:'.length) + '.bsky.social',
		displayName: null,
		avatar: null,
		description: null,
		followRkeys: [],
		followedAt: null,
		createdAt: null,
		followersCount: null,
		followsCount: null,
		postsCount: null,
		followsYou: null,
		viewer: null,
		labels: [],
		status: 'unknown',
		activity: null,
		profileScannedAt: null,
		activityScannedAt: null,
		interaction: null,
		...overrides
	};
}

function profile(did: string, handle: string): ProfileLite {
	return {
		did,
		handle,
		displayName: null,
		avatar: null,
		description: null,
		createdAt: null,
		followersCount: null,
		followsCount: null,
		postsCount: null,
		followsYou: false,
		viewer: null,
		labels: []
	};
}

function okFeed(items: FeedItemLite[] = []): AuthorFeedResult {
	return { ok: true, items, exhausted: true };
}

function feedItem(at: string = '2026-11-01T12:00:00.000Z'): FeedItemLite {
	return {
		uri: 'at://did:plc:x/app.bsky.feed.post/r1',
		kind: 'post',
		at,
		embed: 'text',
		lang: null,
		words: 5
	};
}

function oneFollow(did: string, rkey: string): FakeSourceConfig['followPages'] {
	return [{ records: [{ did, rkey, createdAt: null }], cursor: undefined }];
}

describe('runScan', () => {
	it('pages all follows and keeps every rkey per DID', async () => {
		const { src, calls } = makeFakeSource({
			followPages: [
				{
					records: [
						{ did: 'did:plc:a', rkey: 'ra1', createdAt: '2026-01-01T00:00:00.000Z' },
						{ did: 'did:plc:b', rkey: 'rb1', createdAt: '2026-01-02T00:00:00.000Z' }
					],
					cursor: 'p2'
				},
				{
					records: [
						{ did: 'did:plc:b', rkey: 'rb2', createdAt: '2025-12-31T00:00:00.000Z' },
						{ did: 'did:plc:c', rkey: 'rc1', createdAt: null }
					],
					cursor: 'p3'
				},
				{ records: [], cursor: undefined }
			],
			profiles: new Map([
				['did:plc:a', profile('did:plc:a', 'a.bsky.social')],
				['did:plc:b', profile('did:plc:b', 'b.bsky.social')],
				['did:plc:c', profile('did:plc:c', 'c.bsky.social')]
			]),
			feeds: new Map([
				['did:plc:a', okFeed()],
				['did:plc:b', okFeed()],
				['did:plc:c', okFeed()]
			])
		});
		const store = memoryStore();
		const result = await runScan(src, store, { onProgress: () => {}, now });

		expect(calls.followPages).toBe(3);
		expect(result.follows).toBe(3);
		const all = await store.getAllAccounts();
		const b = all.find((a) => a.did === 'did:plc:b');
		expect(b?.followRkeys.slice().sort()).toEqual(['rb1', 'rb2']);
		expect(b?.followedAt).toBe('2025-12-31T00:00:00.000Z');
	});

	it('deletes stored accounts that are no longer followed', async () => {
		const store = memoryStore();
		await store.putAccounts([
			account('did:plc:old', {
				status: 'active',
				profileScannedAt: '2026-11-02T11:00:00.000Z',
				activityScannedAt: '2026-11-02T11:00:00.000Z'
			})
		]);
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:new', 'rn1'),
			profiles: new Map([['did:plc:new', profile('did:plc:new', 'new.bsky.social')]]),
			feeds: new Map([['did:plc:new', okFeed()]])
		});
		await runScan(src, store, { onProgress: () => {}, now });
		expect((await store.getAllAccounts()).map((a) => a.did)).toEqual(['did:plc:new']);
	});

	it('marks a missing-profile DID deactivated when the feed says AccountDeactivated', async () => {
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:dead', 'rd1'),
			profiles: new Map(), // the DID is missing from getProfiles
			feeds: new Map([['did:plc:dead', { ok: false, status: 'deactivated' }]])
		});
		const store = memoryStore();
		await runScan(src, store, { onProgress: () => {}, now });
		const [row] = await store.getAllAccounts();
		expect(row.status).toBe('deactivated');
		expect(row.activity).toBeNull();
	});

	it('keeps an account active when the profile came back but the public feed says gone', async () => {
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:hidden', 'rh1'),
			profiles: new Map([['did:plc:hidden', profile('did:plc:hidden', 'hidden.bsky.social')]]),
			feeds: new Map([['did:plc:hidden', { ok: false, status: 'gone' }]])
		});
		const store = memoryStore();
		await runScan(src, store, { onProgress: () => {}, now });
		const [row] = await store.getAllAccounts();
		expect(row.status).toBe('active');
		expect(row.activity).toBeNull();
	});

	it('keeps an account active when the profile is missing but the feed has posts', async () => {
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:posty', 'rp2'),
			profiles: new Map(), // the DID is missing from getProfiles
			feeds: new Map([['did:plc:posty', okFeed([feedItem(), feedItem(), feedItem()])]])
		});
		const store = memoryStore();
		await runScan(src, store, { onProgress: () => {}, now });
		const [row] = await store.getAllAccounts();
		expect(row.status).toBe('active');
		expect(row.activity).not.toBeNull();
	});

	it('marks a missing-profile DID gone on an empty, exhausted feed', async () => {
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:ghost', 'rg1'),
			profiles: new Map(),
			feeds: new Map([['did:plc:ghost', okFeed()]])
		});
		const store = memoryStore();
		await runScan(src, store, { onProgress: () => {}, now });
		const [row] = await store.getAllAccounts();
		expect(row.status).toBe('gone');
	});

	it('trusts a fresh stored active profile over a gone feed error', async () => {
		const fresh = '2026-11-02T11:00:00.000Z'; // an hour ago: profile fresh, activity stale
		const store = memoryStore();
		await store.putAccounts([
			account('did:plc:hidden2', {
				status: 'active',
				profileScannedAt: fresh,
				activityScannedAt: null
			})
		]);
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:hidden2', 'rh2'),
			profiles: new Map([['did:plc:hidden2', profile('did:plc:hidden2', 'h2.bsky.social')]]),
			feeds: new Map([['did:plc:hidden2', { ok: false, status: 'gone' }]])
		});
		await runScan(src, store, { onProgress: () => {}, now });
		const [row] = await store.getAllAccounts();
		expect(row.status).toBe('active');
		expect(row.activity).toBeNull();
	});

	it('does not refetch fresh rows unless force', async () => {
		const fresh = '2026-11-02T11:00:00.000Z'; // an hour ago
		const { src, calls } = makeFakeSource({
			followPages: oneFollow('did:plc:a', 'ra1'),
			profiles: new Map([['did:plc:a', profile('did:plc:a', 'a.bsky.social')]]),
			feeds: new Map([['did:plc:a', okFeed()]])
		});
		const store = memoryStore();
		await store.putAccounts([
			account('did:plc:a', {
				status: 'active',
				profileScannedAt: fresh,
				activityScannedAt: fresh
			})
		]);

		await runScan(src, store, { onProgress: () => {}, now });
		expect(calls.profileCalls).toEqual([]);
		expect(calls.feedCalls).toEqual([]);

		await runScan(src, store, { onProgress: () => {}, now, force: true });
		expect(calls.profileCalls).toEqual([['did:plc:a']]);
		expect(calls.feedCalls).toEqual(['did:plc:a']);
	});

	it('reports the progress phases in order', async () => {
		const phases: ScanProgress['phase'][] = [];
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:a', 'ra1'),
			profiles: new Map([['did:plc:a', profile('did:plc:a', 'a.bsky.social')]]),
			feeds: new Map([['did:plc:a', okFeed()]])
		});
		await runScan(src, memoryStore(), {
			onProgress: (p) => {
				phases.push(p.phase);
			},
			now
		});
		const expected = ['follows', 'profiles', 'activity', 'done'];
		let i = 0;
		for (const phase of phases) if (phase === expected[i]) i += 1;
		expect(i).toBe(expected.length);
	});

	it('survives a failed profile chunk without marking the accounts gone', async () => {
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:p', 'rp1'),
			profileError: new Error('the PDS exploded'),
			feeds: new Map([['did:plc:p', okFeed()]])
		});
		const store = memoryStore();
		const result = await runScan(src, store, { onProgress: () => {}, now });
		expect(result.errors).toBe(1);
		const [row] = await store.getAllAccounts();
		// The profile is unknown, not missing: the status stays what it was.
		expect(row.status).toBe('unknown');
		expect(row.activity).not.toBeNull();
	});

	it('aborts mid-scan: reports cancelled and saves what was processed', async () => {
		const controller = new AbortController();
		const { src } = makeFakeSource({
			followPages: [
				{
					records: [
						{ did: 'did:plc:a', rkey: 'ra1', createdAt: null },
						{ did: 'did:plc:b', rkey: 'rb1', createdAt: null },
						{ did: 'did:plc:c', rkey: 'rc1', createdAt: null }
					],
					cursor: undefined
				}
			],
			profiles: new Map([
				['did:plc:a', profile('did:plc:a', 'a.bsky.social')],
				['did:plc:b', profile('did:plc:b', 'b.bsky.social')],
				['did:plc:c', profile('did:plc:c', 'c.bsky.social')]
			]),
			feeds: new Map([
				['did:plc:a', okFeed([feedItem()])],
				['did:plc:b', okFeed()],
				['did:plc:c', okFeed()]
			]),
			// A resolves first, the abort lands before B and C finish.
			feedDelay: { 'did:plc:a': 0, 'did:plc:b': 5, 'did:plc:c': 10 },
			onFeedCall: (did) => {
				if (did === 'did:plc:a') setTimeout(() => controller.abort(), 2);
			}
		});
		const store = memoryStore();
		const phases: ScanProgress['phase'][] = [];
		const result = await runScan(src, store, {
			onProgress: (p) => {
				phases.push(p.phase);
			},
			signal: controller.signal,
			now
		});
		expect(phases[phases.length - 1]).toBe('cancelled');
		expect(result.errors).toBe(0);
		const all = await store.getAllAccounts();
		const a = all.find((x) => x.did === 'did:plc:a');
		expect(a?.activityScannedAt).toBe('2026-11-02T12:00:00.000Z');
		const b = all.find((x) => x.did === 'did:plc:b');
		expect(b?.activityScannedAt).toBeNull();
	});

	it('checks interactions on a forced scan and stores a summary per row', async () => {
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:a', 'ra1'),
			profiles: new Map([['did:plc:a', profile('did:plc:a', 'a.bsky.social')]]),
			feeds: new Map([['did:plc:a', okFeed()]]),
			ownRecords: {
				'app.bsky.feed.like': [
					{
						uri: 'u1',
						value: {
							$type: 'app.bsky.feed.like',
							subject: { uri: 'at://did:plc:a/app.bsky.feed.post/p', cid: 'b' },
							createdAt: '2026-10-20T00:00:00.000Z'
						}
					}
				]
			}
		});
		const store = memoryStore();
		const phases: ScanProgress['phase'][] = [];
		await runScan(src, store, { onProgress: (p) => phases.push(p.phase), force: true, now });
		const [row] = await store.getAllAccounts();
		expect(row.interaction?.lastAt).toBe('2026-10-20T00:00:00.000Z');
		expect(row.interaction?.lastKind).toBe('like');
		const meta = await store.getMeta();
		expect(meta?.interactionsScannedAt).toBe('2026-11-02T12:00:00.000Z');
		// No cap hit: the read covers the whole 12-month window.
		expect(meta?.interactionsCoveredSince).toBe('2025-11-02T12:00:00.000Z');
		const i = phases.indexOf('interactions');
		expect(i).toBeGreaterThan(-1);
		expect(phases.indexOf('done')).toBeGreaterThan(i);
	});

	it('gives every checked row a "none found" summary, not null', async () => {
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:a', 'ra1'),
			profiles: new Map([['did:plc:a', profile('did:plc:a', 'a.bsky.social')]]),
			feeds: new Map([['did:plc:a', okFeed()]])
		});
		const store = memoryStore();
		await runScan(src, store, { onProgress: () => {}, now });
		const [row] = await store.getAllAccounts();
		expect(row.interaction).toEqual({
			lastAt: null,
			lastKind: null,
			lastByKind: { like: null, repost: null, reply: null, quote: null, mention: null },
			countsByKind: { like: 0, repost: 0, reply: 0, quote: 0, mention: 0 }
		});
	});

	it('skips the interaction phase when the last check is fresh', async () => {
		const fresh = '2026-11-02T11:00:00.000Z'; // an hour ago
		const store = memoryStore();
		await store.putAccounts([
			account('did:plc:a', {
				status: 'active',
				profileScannedAt: fresh,
				activityScannedAt: fresh,
				interaction: {
					lastAt: '2026-10-01T00:00:00.000Z',
					lastKind: 'reply',
					lastByKind: {
						like: null,
						repost: null,
						reply: '2026-10-01T00:00:00.000Z',
						quote: null,
						mention: null
					},
					countsByKind: { like: 0, repost: 0, reply: 1, quote: 0, mention: 0 }
				}
			})
		]);
		await store.putMeta({
			lastScanStartedAt: fresh,
			lastScanFinishedAt: fresh,
			followCount: 1,
			interactionsScannedAt: fresh,
			interactionsCoveredSince: '2025-11-02T12:00:00.000Z'
		});
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:a', 'ra1'),
			profiles: new Map([['did:plc:a', profile('did:plc:a', 'a.bsky.social')]]),
			feeds: new Map([['did:plc:a', okFeed()]])
		});
		const phases: ScanProgress['phase'][] = [];
		await runScan(src, store, { onProgress: (p) => phases.push(p.phase), now });
		expect(phases).not.toContain('interactions');
		const [row] = await store.getAllAccounts();
		expect(row.interaction?.lastKind).toBe('reply'); // untouched
		expect((await store.getMeta())?.interactionsScannedAt).toBe(fresh);
	});

	it('runs the interaction phase when the last check is stale', async () => {
		const fresh = '2026-11-02T11:00:00.000Z';
		const store = memoryStore();
		await store.putAccounts([
			account('did:plc:a', { status: 'active', profileScannedAt: fresh, activityScannedAt: fresh })
		]);
		await store.putMeta({
			lastScanStartedAt: '2026-10-20T00:00:00.000Z',
			lastScanFinishedAt: '2026-10-20T00:00:00.000Z',
			followCount: 1,
			interactionsScannedAt: '2026-10-20T00:00:00.000Z', // 13 days ago
			interactionsCoveredSince: '2025-10-20T00:00:00.000Z'
		});
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:a', 'ra1'),
			profiles: new Map([['did:plc:a', profile('did:plc:a', 'a.bsky.social')]]),
			feeds: new Map([['did:plc:a', okFeed()]])
		});
		const phases: ScanProgress['phase'][] = [];
		await runScan(src, store, { onProgress: (p) => phases.push(p.phase), now });
		expect(phases).toContain('interactions');
		expect((await store.getMeta())?.interactionsScannedAt).toBe('2026-11-02T12:00:00.000Z');
	});

	it('keeps the previous interaction data when the check fails, and still finishes', async () => {
		const fresh = '2026-11-02T11:00:00.000Z';
		const store = memoryStore();
		await store.putAccounts([
			account('did:plc:a', {
				status: 'active',
				profileScannedAt: fresh,
				activityScannedAt: fresh,
				interaction: {
					lastAt: '2026-10-01T00:00:00.000Z',
					lastKind: 'reply',
					lastByKind: {
						like: null,
						repost: null,
						reply: '2026-10-01T00:00:00.000Z',
						quote: null,
						mention: null
					},
					countsByKind: { like: 0, repost: 0, reply: 1, quote: 0, mention: 0 }
				}
			})
		]);
		await store.putMeta({
			lastScanStartedAt: fresh,
			lastScanFinishedAt: fresh,
			followCount: 1,
			interactionsScannedAt: fresh,
			interactionsCoveredSince: '2025-11-02T12:00:00.000Z'
		});
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:a', 'ra1'),
			profiles: new Map([['did:plc:a', profile('did:plc:a', 'a.bsky.social')]]),
			feeds: new Map([['did:plc:a', okFeed()]]),
			ownError: new Error('rate limited')
		});
		const result = await runScan(src, store, { onProgress: () => {}, force: true, now });
		expect(result.errors).toBe(1);
		const [row] = await store.getAllAccounts();
		expect(row.interaction?.lastKind).toBe('reply'); // the previous data is kept
		const meta = await store.getMeta();
		expect(meta?.interactionsScannedAt).toBe(fresh); // not updated
		expect(meta?.lastScanFinishedAt).toBe('2026-11-02T12:00:00.000Z'); // the scan finished
	});

	it('ends the scan when the interaction check hits a dead session', async () => {
		const { src } = makeFakeSource({
			followPages: oneFollow('did:plc:a', 'ra1'),
			profiles: new Map([['did:plc:a', profile('did:plc:a', 'a.bsky.social')]]),
			feeds: new Map([['did:plc:a', okFeed()]]),
			ownError: new SessionExpiredError()
		});
		const store = memoryStore();
		await expect(runScan(src, store, { onProgress: () => {}, force: true, now })).rejects.toThrow(
			'Your Bluesky sign-in expired. Sign in again to finish the scan.'
		);
	});
});
