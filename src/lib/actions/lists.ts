/**
 * The list engine: create, fill, refresh and delete Bluesky curated lists.
 * It reads nothing (the caller passes the current members in and gets the
 * outcome out) and writes only through the Writer, so demo mode and the
 * unit tests stand in behind it. Batching, pauses and the per-record
 * fallback follow runUnfollows, so a list sync behaves like an unfollow run.
 */

import { isAuthFailure, SessionExpiredError } from '#lib/net/errors';

import { describeError, type RunControl } from './unfollow';
import type { WriteOp, Writer } from './writer';

/** app.bsky.graph.list name limits, from the lexicon: 1 to 64 characters. */
export const LIST_NAME_MAX = 64;
/** The description is limited to 300 graphemes (the raw string cap is 3000). */
export const LIST_DESCRIPTION_MAX = 300;

/** The purpose of a list a user can pin as a feed. */
export const CURATELIST = 'app.bsky.graph.defs#curatelist';
const LIST_COLLECTION = 'app.bsky.graph.list';
const LISTITEM_COLLECTION = 'app.bsky.graph.listitem';
const PAUSE_POLL_MS = 250;

/**
 * A plain-English problem with the list's fields, or null when they are
 * valid. The name is trimmed; the description is checked in code points:
 * a grapheme holds at least one code point, so that can only reject strings
 * the server would accept, never the other way round.
 */
export function validateList(name: string, description: string): string | null {
	const trimmed = name.trim();
	if (trimmed.length === 0) return 'The list needs a name.';
	if (trimmed.length > LIST_NAME_MAX)
		return `The name is too long. Use ${LIST_NAME_MAX} characters or fewer.`;
	if (Array.from(description).length > LIST_DESCRIPTION_MAX)
		return `The description is too long. Use ${LIST_DESCRIPTION_MAX} characters or fewer.`;
	return null;
}

/**
 * Create the list record and return its URI and rkey (the last segment of
 * the URI). The Writer already writes to the right repo, so `did` is part of
 * the contract only: the caller pairs it with the rkey for listUrl.
 */
export async function createList(
	writer: Writer,
	_did: string,
	name: string,
	description: string
): Promise<{ uri: string; rkey: string }> {
	const problem = validateList(name, description);
	if (problem !== null) throw new Error(problem);
	const { uri } = await writer.createRecord(LIST_COLLECTION, {
		$type: 'app.bsky.graph.list',
		purpose: CURATELIST,
		name: name.trim(),
		...(description.trim() ? { description: description.trim() } : {}),
		createdAt: new Date().toISOString()
	});
	return { uri, rkey: uri.split('/').pop() ?? '' };
}

/**
 * What a sync must do: the DIDs to add, and the current members not in the
 * desired set (each with the listitem rkey to delete). Duplicate DIDs in
 * `desired` count once, in first-seen order.
 */
export function diffMembers(
	desired: string[],
	current: Map<string, string>
): { add: string[]; remove: Array<{ did: string; rkey: string }> } {
	const add: string[] = [];
	const seen = new Set<string>();
	for (const did of desired) {
		if (seen.has(did) || current.has(did)) continue;
		seen.add(did);
		add.push(did);
	}
	const remove: Array<{ did: string; rkey: string }> = [];
	const want = new Set(desired);
	for (const [did, rkey] of current) {
		if (!want.has(did)) remove.push({ did, rkey });
	}
	return { add, remove };
}

/**
 * The cost of a sync in Bluesky write points: adding a member creates a
 * listitem record (3 points), removing one deletes it (1 point). The
 * allowance is 5,000 an hour.
 */
export function writePoints(add: number, remove: number): number {
	return add * 3 + remove;
}

/** Where the list lives in the Bluesky app. */
export function listUrl(did: string, rkey: string): string {
	return `https://bsky.app/profile/${did}/lists/${rkey}`;
}

export interface SyncOptions {
	/** Total listitem records per applyWrites call. */
	batchSize: number;
	/** Pause between batches, not after the last. */
	pauseMs: number;
	control: RunControl;
	/** done counts the members already added or removed; total is the whole sync. */
	onProgress: (done: number, total: number) => void;
	/** Injectable for tests; defaults to a real setTimeout. */
	sleep?: (ms: number) => Promise<void>;
}

export interface SyncResult {
	added: string[];
	removed: string[];
	failed: Array<{ did: string; error: string }>;
}

type WorkItem = { did: string; kind: 'add' } | { did: string; kind: 'remove'; rkey: string };

/**
 * Apply a member diff to a list: adds first, then removes, in batches of at
 * most `batchSize` records with a pause between. A batch that fails with a
 * final error (the queue already retried 429s and 5xx) falls back to one
 * createRecord / deleteRecord per member, so a single bad member can't sink
 * the batch. A stop ends the run with whatever already succeeded.
 */
export async function syncMembers(
	writer: Writer,
	listUri: string,
	add: string[],
	remove: Array<{ did: string; rkey: string }>,
	opts: SyncOptions
): Promise<SyncResult> {
	const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const size = Math.max(1, opts.batchSize);
	const createdAt = new Date().toISOString();
	const items: WorkItem[] = [
		...add.map((did): WorkItem => ({ did, kind: 'add' })),
		...remove.map((r): WorkItem => ({ did: r.did, kind: 'remove', rkey: r.rkey }))
	];
	const batches: WorkItem[][] = [];
	for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));

	const added: string[] = [];
	const removed: string[] = [];
	const failed: Array<{ did: string; error: string }> = [];

	for (let i = 0; i < batches.length; i += 1) {
		// Hold while paused; a stop while paused is picked up here.
		while (opts.control.paused) {
			if (opts.control.signal.aborted) return { added, removed, failed };
			await sleep(PAUSE_POLL_MS);
		}
		if (opts.control.signal.aborted) return { added, removed, failed };

		let result: [WorkItem[], Array<{ did: string; error: string }>];
		try {
			result = await runSyncBatch(writer, listUri, createdAt, batches[i], opts);
		} catch (e) {
			// A stop mid-batch aborts the in-flight call and rethrows here.
			if (opts.control.signal.aborted) return { added, removed, failed };
			throw e;
		}
		for (const item of result[0]) {
			if (item.kind === 'add') added.push(item.did);
			else removed.push(item.did);
		}
		failed.push(...result[1]);
		opts.onProgress(added.length + removed.length, items.length);

		// Chunks of 250 ms so a Stop lands quickly instead of after a full
		// pause; no sleep after the last batch.
		for (let wait = i < batches.length - 1 ? opts.pauseMs : 0; wait > 0;) {
			const step = Math.min(wait, PAUSE_POLL_MS);
			await sleep(step);
			if (opts.control.signal.aborted) return { added, removed, failed };
			wait -= step;
		}
	}

	return { added, removed, failed };
}

/**
 * One batch: one applyWrites with a create op per added member and a delete
 * op per removed one. If it fails with a final error, fall back to one
 * createRecord / deleteRecord per member so a single bad record can't sink
 * the batch.
 */
async function runSyncBatch(
	writer: Writer,
	listUri: string,
	createdAt: string,
	batch: WorkItem[],
	opts: SyncOptions
): Promise<[WorkItem[], Array<{ did: string; error: string }>]> {
	const ops: WriteOp[] = batch.map((item) =>
		item.kind === 'add'
			? {
					$type: 'com.atproto.repo.applyWrites#create' as const,
					collection: LISTITEM_COLLECTION,
					value: listItemValue(item.did, listUri, createdAt)
				}
			: {
					$type: 'com.atproto.repo.applyWrites#delete' as const,
					collection: LISTITEM_COLLECTION,
					rkey: item.rkey
				}
	);
	try {
		await writer.applyWrites(ops, opts.control.signal);
		return [batch, []];
	} catch (e) {
		// A stop: let it propagate so the run returns the partial result.
		if (opts.control.signal.aborted) throw e;
		// The sign-in is dead: no fallback, no next batch.
		if (isAuthFailure(e)) throw new SessionExpiredError();
		const ok: WorkItem[] = [];
		const failed: Array<{ did: string; error: string }> = [];
		for (const item of batch) {
			try {
				if (item.kind === 'add') {
					await writer.createRecord(
						LISTITEM_COLLECTION,
						listItemValue(item.did, listUri, createdAt),
						opts.control.signal
					);
				} else {
					await writer.deleteRecord(LISTITEM_COLLECTION, item.rkey, opts.control.signal);
				}
				ok.push(item);
			} catch (e2) {
				if (opts.control.signal.aborted) throw e2;
				if (isAuthFailure(e2)) throw new SessionExpiredError();
				failed.push({ did: item.did, error: describeError(e2) });
			}
		}
		return [ok, failed];
	}
}

/** The app.bsky.graph.listitem record that puts `did` on `listUri`. */
function listItemValue(did: string, listUri: string, createdAt: string): Record<string, unknown> {
	return { $type: 'app.bsky.graph.listitem', subject: did, list: listUri, createdAt };
}

export interface DeleteListOptions {
	/** Total listitem records per applyWrites call. */
	batchSize: number;
	/** Pause between batches, not after the last. */
	pauseMs: number;
	control: RunControl;
	/** Optional: done counts the item deletes plus the list record itself. */
	onProgress?: (done: number, total: number) => void;
	/** Injectable for tests; defaults to a real setTimeout. */
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Delete a list: its listitem records first, then the list record itself.
 * If any member can't be removed (the per-record fallback already ran), the
 * list record is left in place and an error is thrown; rerunning is safe,
 * since deleting an already-gone record counts as success. A stop aborts
 * the run and throws.
 */
export async function deleteList(
	writer: Writer,
	listRkey: string,
	itemRkeys: string[],
	opts: DeleteListOptions
): Promise<void> {
	const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const size = Math.max(1, opts.batchSize);
	const total = itemRkeys.length + 1;
	const batches: string[][] = [];
	for (let i = 0; i < itemRkeys.length; i += size) batches.push(itemRkeys.slice(i, i + size));

	let done = 0;
	let failedItems = 0;
	for (let i = 0; i < batches.length; i += 1) {
		while (opts.control.paused) {
			if (opts.control.signal.aborted) throw abortError();
			await sleep(PAUSE_POLL_MS);
		}
		if (opts.control.signal.aborted) throw abortError();

		let failed = 0;
		try {
			const ops: WriteOp[] = batches[i].map((rkey) => ({
				$type: 'com.atproto.repo.applyWrites#delete' as const,
				collection: LISTITEM_COLLECTION,
				rkey
			}));
			await writer.applyWrites(ops, opts.control.signal);
		} catch (e) {
			// A stop: let it propagate as the abort.
			if (opts.control.signal.aborted) throw e;
			// The sign-in is dead: no fallback, no next batch.
			if (isAuthFailure(e)) throw new SessionExpiredError();
			// One deleteRecord per item so one bad item can't sink the batch.
			for (const rkey of batches[i]) {
				try {
					await writer.deleteRecord(LISTITEM_COLLECTION, rkey, opts.control.signal);
				} catch (e2) {
					if (opts.control.signal.aborted) throw e2;
					if (isAuthFailure(e2)) throw new SessionExpiredError();
					failed += 1;
				}
			}
		}
		failedItems += failed;
		done += batches[i].length - failed;
		opts.onProgress?.(done, total);

		for (let wait = i < batches.length - 1 ? opts.pauseMs : 0; wait > 0;) {
			const step = Math.min(wait, PAUSE_POLL_MS);
			await sleep(step);
			if (opts.control.signal.aborted) throw abortError();
			wait -= step;
		}
	}

	if (failedItems > 0) {
		throw new Error(
			failedItems === 1
				? 'One list member could not be removed; the list was left in place.'
				: `${failedItems} list members could not be removed; the list was left in place.`
		);
	}
	try {
		await writer.deleteRecord(LIST_COLLECTION, listRkey, opts.control.signal);
	} catch (e) {
		if (opts.control.signal.aborted) throw e;
		if (isAuthFailure(e)) throw new SessionExpiredError();
		throw e;
	}
	opts.onProgress?.(total, total);
}

function abortError(): DOMException {
	return new DOMException('Aborted', 'AbortError');
}
