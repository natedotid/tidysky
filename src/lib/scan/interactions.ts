/**
 * The "last interaction" reader. Pages the user's own likes, reposts
 * and posts from the last year and summarizes, per account, when the user
 * last interacted with them. Pure over a DataSource, so it is testable
 * offline. It never throws for a bad record: malformed records are skipped.
 */

import { CONFIG } from '#lib/config';

import type { DataSource, OwnCollection, OwnRecord } from './source';
import type { InteractionKind, InteractionSummary } from './types';

const DAY = 86_400_000;

/** On an exact timestamp tie, the earlier kind in this order wins. */
const KIND_PRIORITY: InteractionKind[] = ['reply', 'quote', 'mention', 'repost', 'like'];

export interface InteractionTarget {
	did: string;
	kind: InteractionKind;
	at: string; // the record's createdAt
}

export interface InteractionResult {
	/** One summary per DID with at least one interaction in the window. */
	map: Map<string, InteractionSummary>;
	/**
	 * Oldest date the read fully covered: the window start, or, when a
	 * collection hit the record cap, the latest of those collections' reach.
	 */
	coveredSince: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseAt(v: unknown): number | null {
	return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null;
}

const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';

/**
 * When a record was written to its repo, in milliseconds, from its rkey. An
 * rkey is a TID: 13 characters of base32-sortable encoding a 64-bit number
 * whose top bit is 0 and whose next 53 bits are microseconds since the Unix
 * epoch (the last 10 bits are a clock id). The server sets the TID, so
 * unlike createdAt it cannot be backdated. Null for anything that is not a
 * valid TID.
 */
export function tidToMs(rkey: string): number | null {
	if (rkey.length !== 13) return null;
	let value = 0n;
	for (const ch of rkey) {
		const idx = TID_ALPHABET.indexOf(ch);
		if (idx === -1) return null;
		value = (value << 5n) + BigInt(idx);
	}
	// 13 characters hold 65 bits; the number is 64 bits with its top bit 0.
	if (value >= 1n << 63n) return null;
	const micros = value >> 10n; // the low 10 bits are the clock id
	return Number(micros / 1000n);
}

/** The rkey: the last path segment of the record's URI. */
function rkeyOf(record: OwnRecord): string | null {
	const uri = record.uri;
	if (typeof uri !== 'string') return null;
	const i = uri.lastIndexOf('/');
	return i === -1 || i === uri.length - 1 ? null : uri.slice(i + 1);
}

/**
 * When the record was written to the repo: the TID time of its rkey, falling
 * back to its createdAt when the rkey is not a valid TID.
 */
function writtenAt(record: OwnRecord): number | null {
	const rkey = rkeyOf(record);
	if (rkey !== null) {
		const t = tidToMs(rkey);
		if (t !== null) return t;
	}
	return parseAt(record.value['createdAt']);
}

/**
 * The DID authority of an at:// URI, or null. The authority may be a handle
 * (someone.bsky.social) instead of a DID; those are skipped, this reader
 * only deals with DIDs.
 */
export function didFromAtUri(uri: string): string | null {
	if (!uri.startsWith('at://')) return null;
	const rest = uri.slice('at://'.length);
	const slash = rest.indexOf('/');
	const authority = slash === -1 ? rest : rest.slice(0, slash);
	return authority.startsWith('did:') ? authority : null;
}

/**
 * Who a record interacts with. A like or repost points at one post; a post
 * may reply, quote and mention at the same time, so one post can yield
 * several targets. A plain post yields nothing. The user's own DID is
 * skipped (replies in own threads, self-quotes), and so are records without
 * a parseable createdAt or targets without a DID.
 */
export function extractTargets(
	collection: OwnCollection,
	record: OwnRecord,
	myDid: string
): InteractionTarget[] {
	const out: InteractionTarget[] = [];
	const value = record.value;
	const createdAt = value['createdAt'];
	if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return out;
	const push = (did: string, kind: InteractionKind): void => {
		if (did !== myDid) out.push({ did, kind, at: createdAt });
	};
	const didOf = (uri: unknown): string | null =>
		typeof uri === 'string' ? didFromAtUri(uri) : null;

	if (collection === 'app.bsky.feed.like' || collection === 'app.bsky.feed.repost') {
		const subject = value['subject'];
		if (isRecord(subject)) {
			const did = didOf(subject['uri']);
			if (did !== null) push(did, collection === 'app.bsky.feed.like' ? 'like' : 'repost');
		}
		return out;
	}

	// app.bsky.feed.post
	const reply = value['reply'];
	if (isRecord(reply) && isRecord(reply['parent'])) {
		const did = didOf(reply['parent']['uri']);
		if (did !== null) push(did, 'reply');
	}
	const embed = value['embed'];
	if (isRecord(embed)) {
		// A quote is a record embed; with media the record sits one level down.
		const inner =
			embed['$type'] === 'app.bsky.embed.record'
				? embed['record']
				: embed['$type'] === 'app.bsky.embed.recordWithMedia'
					? isRecord(embed['record'])
						? embed['record']['record']
						: undefined
					: undefined;
		if (isRecord(inner)) {
			const did = didOf(inner['uri']);
			if (did !== null) push(did, 'quote');
		}
	}
	const facets = value['facets'];
	if (Array.isArray(facets)) {
		for (const facet of facets) {
			if (!isRecord(facet) || !Array.isArray(facet['features'])) continue;
			for (const f of facet['features']) {
				if (!isRecord(f) || f['$type'] !== 'app.bsky.richtext.facet#mention') continue;
				const did = f['did'];
				if (typeof did === 'string' && did.startsWith('did:')) push(did, 'mention');
			}
		}
	}
	return out;
}

interface Acc {
	lastByKind: Record<InteractionKind, string | null>;
	countsByKind: Record<InteractionKind, number>;
}

function emptyAcc(): Acc {
	return {
		lastByKind: { like: null, repost: null, reply: null, quote: null, mention: null },
		countsByKind: { like: 0, repost: 0, reply: 0, quote: 0, mention: 0 }
	};
}

function note(per: Map<string, Acc>, target: InteractionTarget): void {
	let a = per.get(target.did);
	if (a === undefined) {
		a = emptyAcc();
		per.set(target.did, a);
	}
	a.countsByKind[target.kind] += 1;
	const prev = a.lastByKind[target.kind];
	if (prev === null || Date.parse(target.at) > Date.parse(prev))
		a.lastByKind[target.kind] = target.at;
}

/**
 * True when a first page clearly came back oldest first: the first record
 * was written to the repo before the last one was. Ordering by write time
 * (the rkey TID), not createdAt, because imported records carry old
 * createdAt values but repo-new TIDs. A tie or a missing time leaves the
 * default (newest first) assumption in place.
 */
function isOldestFirst(records: OwnRecord[]): boolean {
	if (records.length < 2) return false;
	const first = writtenAt(records[0]);
	const last = writtenAt(records[records.length - 1]);
	return first !== null && last !== null && first < last;
}

/**
 * Read the user's own likes, reposts and posts, newest first, until each
 * collection is fully covered by the last `interactionWindowDays` or its
 * record cap is hit. `onRead` gets the running total of records read across
 * all three collections, after every page.
 */
export async function collectInteractions(
	src: DataSource,
	myDid: string,
	now: Date,
	signal: AbortSignal | undefined,
	onRead: (totalRecordsRead: number) => void,
	opts?: { maxRecordsPerCollection?: number }
): Promise<InteractionResult> {
	const cap = opts?.maxRecordsPerCollection ?? CONFIG.interactionMaxRecordsPerCollection;
	const windowStartMs = now.getTime() - CONFIG.interactionWindowDays * DAY;
	const per = new Map<string, Acc>();
	const cappedReach: number[] = []; // oldest write time read, per capped collection
	let totalRead = 0;

	const collections: OwnCollection[] = [
		'app.bsky.feed.like',
		'app.bsky.feed.repost',
		'app.bsky.feed.post'
	];
	for (const collection of collections) {
		let cursor: string | undefined;
		let reverse = false;
		let read = 0;
		let oldest: number | null = null;
		for (;;) {
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			const page = await src.listOwnRecords(collection, cursor, signal, reverse);
			const records = page.records;
			// Order check on the first page: if it came back oldest first,
			// discard it and restart the collection in the other direction.
			if (cursor === undefined && !reverse && isOldestFirst(records)) {
				reverse = true;
				continue;
			}
			if (records.length === 0) break; // nothing older: the collection is done
			// Newest first only: a whole page written to the repo before the
			// window means every older page is older still. The write time
			// (rkey TID) is the order the server pages in, so it is the right
			// thing to stop on: imported records are written recently even
			// though their createdAt is old, and must not end the read. One
			// out-of-order record must not stop us: the whole page has to
			// be old.
			const written = records.map((r) => writtenAt(r));
			if (!reverse && written.every((t) => t !== null && t < windowStartMs)) break;
			const times = records.map((r) => parseAt(r.value['createdAt']));
			read += records.length;
			totalRead += records.length;
			onRead(totalRead);
			for (let i = 0; i < records.length; i += 1) {
				const w = written[i];
				if (w !== null && (oldest === null || w < oldest)) oldest = w;
				const t = times[i];
				if (t === null || t < windowStartMs) continue; // unknown time or out of window
				for (const target of extractTargets(collection, records[i], myDid)) note(per, target);
			}
			if (read >= cap) {
				if (oldest !== null) cappedReach.push(oldest);
				break;
			}
			cursor = page.cursor;
			if (cursor === undefined) break;
		}
	}

	// Never earlier than the window start: the reach is only how far the
	// capped read got, and it can never cover more than the window.
	const coveredSinceMs =
		cappedReach.length > 0 ? Math.max(windowStartMs, ...cappedReach) : windowStartMs;
	const map = new Map<string, InteractionSummary>();
	for (const [did, a] of per) {
		let lastAt: string | null = null;
		let lastKind: InteractionKind | null = null;
		// Iterate in tie-priority order and replace only on a strictly newer
		// time, so an exact tie keeps the higher-priority kind.
		for (const kind of KIND_PRIORITY) {
			const at = a.lastByKind[kind];
			if (at === null || (lastAt !== null && Date.parse(at) <= Date.parse(lastAt))) continue;
			lastAt = at;
			lastKind = kind;
		}
		map.set(did, { lastAt, lastKind, lastByKind: a.lastByKind, countsByKind: a.countsByKind });
	}
	return { map, coveredSince: new Date(coveredSinceMs).toISOString() };
}
