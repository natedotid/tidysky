/**
 * Per-account persistence. One IndexedDB database per signed-in account
 * ('tidysky:<did>'), opened with the idb wrapper. Everything is exposed as
 * the small `Store` object returned by `openStore`, so tests and demo
 * mode can substitute other implementations.
 */

import { deleteDB, openDB, type IDBPDatabase } from 'idb';

import { isUnfollowAction } from '#lib/actions/undo';
import type { YouData } from '#lib/scan/source';
import type {
	FollowAccount,
	ManagedList,
	ScanMeta,
	Snapshot,
	UnfollowLogEntry
} from '#lib/scan/types';

/**
 * The database shape, as a `type` (not `interface`) so idb's conditional
 * types see an implicit index signature and type every store name, key and
 * value. `meta` and `keep` use out-of-line keys; `snapshots` and `log`
 * auto-increment their id.
 */
type TidySkyDB = {
	accounts: { key: string; value: FollowAccount };
	meta: { key: string; value: ScanMeta | YouData };
	snapshots: { key: number; value: Snapshot };
	log: { key: number; value: UnfollowLogEntry; indexes: { 'by-did': string } };
	keep: { key: string; value: { did: string } };
	lists: { key: string; value: ManagedList };
};

export interface Store {
	getAllAccounts(): Promise<FollowAccount[]>;
	putAccounts(rows: FollowAccount[]): Promise<void>;
	deleteAccounts(dids: string[]): Promise<void>;

	getMeta(): Promise<ScanMeta | null>;
	putMeta(m: ScanMeta): Promise<void>;

	/** The cached "you" read (profile, own feed, follower sample), or null. */
	getYou(): Promise<YouData | null>;
	putYou(y: YouData): Promise<void>;

	addSnapshot(s: Omit<Snapshot, 'id'>): Promise<number>;
	listSnapshots(): Promise<Snapshot[]>;
	pruneSnapshots(keep: number): Promise<void>;

	addLog(e: Omit<UnfollowLogEntry, 'id'>): Promise<number>;
	listLog(): Promise<UnfollowLogEntry[]>;
	markUndone(id: number, at: string): Promise<void>;
	countUnfollowsSince(isoTime: string): Promise<number>;

	getKeep(): Promise<string[]>;
	setKeep(did: string, on: boolean): Promise<void>;

	getLists(): Promise<ManagedList[]>;
	putList(l: ManagedList): Promise<void>;
	deleteList(uri: string): Promise<void>;
}

const DB_PREFIX = 'tidysky:';
const META_KEY = 'scan';
const YOU_META_KEY = 'you';

function upgrade(db: IDBPDatabase<TidySkyDB>): void {
	if (!db.objectStoreNames.contains('accounts'))
		db.createObjectStore('accounts', { keyPath: 'did' });
	if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
	if (!db.objectStoreNames.contains('snapshots')) {
		db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
	}
	if (!db.objectStoreNames.contains('log')) {
		const log = db.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
		log.createIndex('by-did', 'did');
	}
	if (!db.objectStoreNames.contains('keep')) db.createObjectStore('keep', { keyPath: 'did' });
	if (!db.objectStoreNames.contains('lists')) db.createObjectStore('lists', { keyPath: 'uri' });
}

function newestFirst<T extends { id?: number }>(rows: T[]): T[] {
	return [...rows].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
}

function idsOf(rows: Array<{ id?: number }>): number[] {
	return rows.map((r) => r.id).filter((id): id is number => id !== undefined);
}

/**
 * One connection per database. IndexedDB allows many connections per database,
 * but `deleteDatabase` can only run once all of them are closed, so the app
 * shares a single cached connection per account, and closes it (via the
 * `blocking` callback) when a delete or another tab asks for it to.
 */
const connections = new Map<string, Promise<IDBPDatabase<TidySkyDB>>>();

function connect(name: string): Promise<IDBPDatabase<TidySkyDB>> {
	const existing = connections.get(name);
	if (existing) return existing;
	let opened: IDBPDatabase<TidySkyDB> | null = null;
	const p = openDB<TidySkyDB>(name, 1, {
		upgrade,
		// Another connection (a delete, or a newer version in another tab) needs us gone.
		blocking() {
			opened?.close();
			connections.delete(name);
		},
		terminated() {
			connections.delete(name);
		}
	}).then((db) => {
		opened = db;
		return db;
	});
	connections.set(name, p);
	p.catch(() => connections.delete(name));
	return p;
}

/**
 * Delete an account's database. Closes this tab's cached connection first,
 * then waits at most 3 seconds for other tabs to close theirs; if they
 * don't, it gives up and reports `blocked: true`.
 */
export async function deleteDatabase(did: string): Promise<{ blocked: boolean }> {
	const name = DB_PREFIX + did;
	const cached = connections.get(name);
	if (cached !== undefined) {
		connections.delete(name);
		try {
			(await cached).close();
		} catch {
			// Never opened: nothing to close.
		}
	}
	let blocked = false;
	try {
		await Promise.race([
			deleteDB(name, {
				blocked() {
					// Another tab still has the database open.
					blocked = true;
				}
			}),
			new Promise<void>((resolve) => setTimeout(resolve, 3_000))
		]);
	} catch {
		// Already gone or storage unavailable: nothing left to delete.
	}
	return { blocked };
}

/**
 * Open (or create) the store for one account. Throws `Error('storage-unavailable')`
 * when IndexedDB cannot be opened (some browsers' private mode); the UI turns
 * that into a plain-English message.
 */
export async function openStore(did: string): Promise<Store> {
	let db: IDBPDatabase<TidySkyDB>;
	try {
		db = await connect(DB_PREFIX + did);
	} catch {
		throw new Error('storage-unavailable');
	}

	return {
		// Rows written before 1.1 have no `interaction` property at all; read
		// them as "not checked yet". Rows written before the viewer field
		// exists are the same: read them as "not read".
		getAllAccounts: async () =>
			(await db.getAll('accounts')).map((r) => ({
				...r,
				interaction: r.interaction ?? null,
				viewer: r.viewer ?? null
			})),
		putAccounts: async (rows) => {
			const tx = db.transaction('accounts', 'readwrite');
			for (const row of rows) await tx.store.put(row);
			await tx.done;
		},
		deleteAccounts: async (dids) => {
			const tx = db.transaction('accounts', 'readwrite');
			for (const d of dids) await tx.store.delete(d);
			await tx.done;
		},

		getMeta: async () => {
			const v = await db.get('meta', META_KEY);
			if (v === undefined || !('lastScanFinishedAt' in v)) return null;
			// Pre-1.1 meta rows lack the interaction fields.
			return {
				...v,
				interactionsScannedAt: v.interactionsScannedAt ?? null,
				interactionsCoveredSince: v.interactionsCoveredSince ?? null
			};
		},
		putMeta: async (m) => {
			await db.put('meta', m, META_KEY);
		},

		getYou: async () => {
			const v = await db.get('meta', YOU_META_KEY);
			return v !== undefined && 'fetchedAt' in v ? v : null;
		},
		putYou: async (y) => {
			await db.put('meta', y, YOU_META_KEY);
		},

		addSnapshot: (s) => db.add('snapshots', s),
		listSnapshots: async () => newestFirst(await db.getAll('snapshots')),
		pruneSnapshots: async (keep) => {
			// getAll returns id order (oldest first), so the first `total - keep` go.
			const snaps = await db.getAll('snapshots');
			const excess = idsOf(snaps.slice(0, snaps.length - keep));
			if (excess.length === 0) return;
			const tx = db.transaction('snapshots', 'readwrite');
			for (const id of excess) await tx.store.delete(id);
			await tx.done;
		},

		addLog: (e) => db.add('log', e),
		listLog: async () => newestFirst(await db.getAll('log')),
		markUndone: async (id, at) => {
			const entry = await db.get('log', id);
			if (entry === undefined) return;
			entry.undoneAt = at;
			await db.put('log', entry);
		},
		countUnfollowsSince: async (isoTime) => {
			const entries = await db.getAll('log');
			return entries.filter(
				(e) => isUnfollowAction(e.action) && e.at > isoTime && e.undoneAt === undefined
			).length;
		},

		getKeep: async () => (await db.getAll('keep')).map((r) => r.did),
		setKeep: async (did, on) => {
			if (on) await db.put('keep', { did });
			else await db.delete('keep', did);
		},

		getLists: () => db.getAll('lists'),
		putList: async (l) => {
			// The spec (and possibly memberDids) may carry a Svelte $state
			// proxy, which IndexedDB cannot clone; a JSON round-trip makes it
			// plain data.
			const spec = l.filterSpec == null ? l.filterSpec : JSON.parse(JSON.stringify(l.filterSpec));
			await db.put('lists', { ...l, filterSpec: spec });
		},
		deleteList: (uri) => db.delete('lists', uri)
	};
}
