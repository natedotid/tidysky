import { describe, expect, it } from 'vitest';

import type { OwnCollection, OwnRecord } from './source';
import { collectInteractions, didFromAtUri, extractTargets, tidToMs } from './interactions';
import type { DataSource } from './source';
import type {
	FollowRecord,
	FollowersSample,
	ListItemRecord,
	OwnFeedItem,
	ProfileLite,
	AuthorFeedResult
} from './source';

const NOW = new Date('2026-11-02T12:00:00Z');
const DAY = 86_400_000;
const MY = 'did:plc:me';
const iso = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

// --- record builders

function like(did: string, at: string): OwnRecord {
	return {
		uri: `at://${MY}/app.bsky.feed.like/r${Math.abs(at.length)}`,
		value: {
			$type: 'app.bsky.feed.like',
			subject: { uri: `at://${did}/app.bsky.feed.post/p1`, cid: 'bafy' },
			createdAt: at
		}
	};
}

function repost(did: string, at: string): OwnRecord {
	return {
		uri: `at://${MY}/app.bsky.feed.repost/r${Math.abs(at.length)}`,
		value: {
			$type: 'app.bsky.feed.repost',
			subject: { uri: `at://${did}/app.bsky.feed.post/p1`, cid: 'bafy' },
			createdAt: at
		}
	};
}

function plainPost(at: string): OwnRecord {
	return {
		uri: `at://${MY}/app.bsky.feed.post/p${Math.abs(at.length)}`,
		value: { $type: 'app.bsky.feed.post', text: 'hello', createdAt: at }
	};
}

function replyPost(did: string, at: string): OwnRecord {
	return {
		uri: `at://${MY}/app.bsky.feed.post/p${Math.abs(at.length)}`,
		value: {
			$type: 'app.bsky.feed.post',
			text: 'a reply',
			reply: {
				root: { uri: `at://${did}/app.bsky.feed.post/p0`, cid: 'bafy' },
				parent: { uri: `at://${did}/app.bsky.feed.post/p1`, cid: 'bafy' }
			},
			createdAt: at
		}
	};
}

function quotePost(did: string, at: string): OwnRecord {
	return {
		uri: `at://${MY}/app.bsky.feed.post/p${Math.abs(at.length)}`,
		value: {
			$type: 'app.bsky.feed.post',
			text: 'a quote',
			embed: {
				$type: 'app.bsky.embed.record',
				record: { uri: `at://${did}/app.bsky.feed.post/p1`, cid: 'bafy' }
			},
			createdAt: at
		}
	};
}

function quotePostWithMedia(did: string, at: string): OwnRecord {
	return {
		uri: `at://${MY}/app.bsky.feed.post/p${Math.abs(at.length)}`,
		value: {
			$type: 'app.bsky.feed.post',
			text: 'a quote with a picture',
			embed: {
				$type: 'app.bsky.embed.recordWithMedia',
				record: { record: { uri: `at://${did}/app.bsky.feed.post/p1`, cid: 'bafy' } },
				images: []
			},
			createdAt: at
		}
	};
}

function mentionPost(dids: string[], at: string): OwnRecord {
	return {
		uri: `at://${MY}/app.bsky.feed.post/p${Math.abs(at.length)}`,
		value: {
			$type: 'app.bsky.feed.post',
			text: `hi ${dids.join(' ')}`,
			facets: [
				{
					index: { byteStart: 0, byteEnd: 8 },
					features: dids.map((d) => ({ $type: 'app.bsky.richtext.facet#mention', did: d }))
				}
			],
			createdAt: at
		}
	};
}

// --- TID helper for tests

const TID_ALPHA = '234567abcdefghijklmnopqrstuvwxyz';

/** A valid TID whose write time is `ms` (microsecond-precise). */
function tidFromMs(ms: number, clockid = 7): string {
	let n = ((BigInt(ms) * 1000n) << 10n) | BigInt(clockid);
	let s = '';
	for (let i = 0; i < 13; i += 1) {
		s = TID_ALPHA[Number(n & 31n)] + s;
		n >>= 5n;
	}
	return s;
}

/** Give a record a TID rkey with the given write time. */
function writtenAtMs(r: OwnRecord, ms: number): OwnRecord {
	const i = r.uri.lastIndexOf('/');
	return { ...r, uri: `${r.uri.slice(0, i + 1)}${tidFromMs(ms)}` };
}

// --- fake source

interface Call {
	collection: OwnCollection;
	cursor: string | undefined;
	reverse: boolean;
}

type Pages = Partial<Record<OwnCollection, OwnRecord[][]>>;

/** A DataSource that serves fixed pages (of at most 100 records) per collection. */
function ownSource(pages: Pages, calls: Call[]): DataSource {
	return {
		did: MY,
		async listFollowRecords(): Promise<{ records: FollowRecord[]; cursor: string | undefined }> {
			return { records: [], cursor: undefined };
		},
		async getProfiles(): Promise<ProfileLite[]> {
			return [];
		},
		async getAuthorFeed(): Promise<AuthorFeedResult> {
			return { ok: true, items: [], exhausted: true };
		},
		async getOwnProfile(): Promise<ProfileLite> {
			throw new Error('not used');
		},
		async getOwnFeed(): Promise<OwnFeedItem[]> {
			return [];
		},
		async getFollowersSample(): Promise<FollowersSample> {
			return { profiles: [], complete: true };
		},
		async listListItems(): Promise<{ records: ListItemRecord[]; cursor: string | undefined }> {
			return { records: [], cursor: undefined };
		},
		async listOwnRecords(collection, cursor, _signal, reverse) {
			calls.push({ collection, cursor, reverse: reverse === true });
			const ps = pages[collection] ?? [];
			const start = cursor === undefined ? 0 : Number(cursor);
			const page = ps[start];
			if (page === undefined) return { records: [], cursor: undefined };
			return { records: page, cursor: start + 1 < ps.length ? String(start + 1) : undefined };
		}
	};
}

const noSignal: AbortSignal | undefined = undefined;

describe('didFromAtUri', () => {
	it('takes the DID authority, not a handle', () => {
		expect(didFromAtUri('at://did:plc:abc/app.bsky.feed.post/r1')).toBe('did:plc:abc');
		expect(didFromAtUri('at://someone.bsky.social/app.bsky.feed.post/r1')).toBeNull();
		expect(didFromAtUri('https://bsky.app/x')).toBeNull();
	});
});

describe('tidToMs', () => {
	it('round-trips TIDs built from a timestamp', () => {
		for (const ms of [0, 1, 1_700_000_000_123, Date.parse('2026-11-02T12:00:00Z')]) {
			expect(tidToMs(tidFromMs(ms)), String(ms)).toBe(ms);
		}
	});

	it('returns null for anything that is not a valid TID', () => {
		const good = tidFromMs(Date.parse('2026-11-02T12:00:00Z'));
		expect(tidToMs(good.slice(0, 12))).toBeNull(); // 12 characters
		expect(tidToMs(good + '2')).toBeNull(); // 14 characters
		expect(tidToMs(`${good.slice(0, 6)}1${good.slice(7)}`)).toBeNull(); // '1' is not in the alphabet
		expect(tidToMs(good.toUpperCase())).toBeNull();
		expect(tidToMs('r20')).toBeNull(); // a short rkey
		// The top bit: first character 'c' (8) puts the value at 2^63 and up.
		expect(tidToMs('b' + '2'.repeat(12))).not.toBeNull();
		expect(tidToMs('c' + '2'.repeat(12))).toBeNull();
	});
});

describe('extractTargets', () => {
	it('reads each record type', () => {
		const a = 'did:plc:a';
		const likeTargets = extractTargets('app.bsky.feed.like', like(a, iso(1)), MY);
		expect(likeTargets).toEqual([{ did: a, kind: 'like', at: iso(1) }]);
		expect(extractTargets('app.bsky.feed.repost', repost(a, iso(1)), MY)).toEqual([
			{ did: a, kind: 'repost', at: iso(1) }
		]);
		expect(extractTargets('app.bsky.feed.post', replyPost(a, iso(1)), MY)).toEqual([
			{ did: a, kind: 'reply', at: iso(1) }
		]);
		expect(extractTargets('app.bsky.feed.post', quotePost(a, iso(1)), MY)).toEqual([
			{ did: a, kind: 'quote', at: iso(1) }
		]);
		expect(extractTargets('app.bsky.feed.post', quotePostWithMedia(a, iso(1)), MY)).toEqual([
			{ did: a, kind: 'quote', at: iso(1) }
		]);
	});

	it('one post can yield a reply, a quote and several mentions', () => {
		const post: OwnRecord = {
			uri: 'at://did:plc:me/app.bsky.feed.post/p',
			value: {
				$type: 'app.bsky.feed.post',
				text: 'x',
				reply: {
					root: { uri: 'at://did:plc:r/app.bsky.feed.post/0', cid: 'b' },
					parent: { uri: 'at://did:plc:r/app.bsky.feed.post/1', cid: 'b' }
				},
				embed: {
					$type: 'app.bsky.embed.recordWithMedia',
					record: { record: { uri: 'at://did:plc:q/app.bsky.feed.post/2', cid: 'b' } }
				},
				facets: [
					{
						index: { byteStart: 0, byteEnd: 1 },
						features: [
							{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:m1' },
							{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:m2' },
							{ $type: 'app.bsky.richtext.facet#tag', tag: 'x' }
						]
					}
				],
				createdAt: iso(2)
			}
		};
		const targets = extractTargets('app.bsky.feed.post', post, MY);
		expect(targets.map((t) => `${t.did}:${t.kind}`).sort()).toEqual(
			['did:plc:m1:mention', 'did:plc:m2:mention', 'did:plc:q:quote', 'did:plc:r:reply'].sort()
		);
	});

	it('a plain post yields nothing', () => {
		expect(extractTargets('app.bsky.feed.post', plainPost(iso(1)), MY)).toEqual([]);
	});

	it("skips the user's own DID", () => {
		const ownLike = like(MY, iso(1));
		expect(extractTargets('app.bsky.feed.like', ownLike, MY)).toEqual([]);
		expect(extractTargets('app.bsky.feed.post', replyPost(MY, iso(1)), MY)).toEqual([]);
		const selfMention: OwnRecord = {
			uri: 'at://did:plc:me/app.bsky.feed.post/p',
			value: {
				$type: 'app.bsky.feed.post',
				text: 'me',
				facets: [
					{
						index: { byteStart: 0, byteEnd: 1 },
						features: [{ $type: 'app.bsky.richtext.facet#mention', did: MY }]
					}
				],
				createdAt: iso(1)
			}
		};
		expect(extractTargets('app.bsky.feed.post', selfMention, MY)).toEqual([]);
	});

	it('skips malformed records', () => {
		const badLike = {
			uri: 'u',
			value: { $type: 'app.bsky.feed.like', subject: 'not a record', createdAt: iso(1) }
		};
		expect(extractTargets('app.bsky.feed.like', badLike, MY)).toEqual([]);
		// Handle authority instead of a DID.
		const handleLike: OwnRecord = {
			uri: 'u',
			value: {
				$type: 'app.bsky.feed.like',
				subject: { uri: 'at://someone.bsky.social/app.bsky.feed.post/p1', cid: 'b' },
				createdAt: iso(1)
			}
		};
		expect(extractTargets('app.bsky.feed.like', handleLike, MY)).toEqual([]);
		// Missing createdAt.
		const noDate: OwnRecord = {
			uri: 'u',
			value: {
				$type: 'app.bsky.feed.like',
				subject: { uri: 'at://did:plc:a/app.bsky.feed.post/p', cid: 'b' }
			}
		};
		expect(extractTargets('app.bsky.feed.like', noDate, MY)).toEqual([]);
		// A mention facet without a did.
		const noDidMention: OwnRecord = {
			uri: 'u',
			value: {
				$type: 'app.bsky.feed.post',
				text: 'x',
				facets: [
					{
						index: { byteStart: 0, byteEnd: 1 },
						features: [{ $type: 'app.bsky.richtext.facet#mention' }]
					}
				],
				createdAt: iso(1)
			}
		};
		expect(extractTargets('app.bsky.feed.post', noDidMention, MY)).toEqual([]);
	});
});

describe('collectInteractions', () => {
	it('summarizes the newest per kind and overall, with counts', async () => {
		const calls: Call[] = [];
		const src = ownSource(
			{
				'app.bsky.feed.like': [[like('did:plc:a', iso(1)), like('did:plc:a', iso(10))]],
				'app.bsky.feed.repost': [[repost('did:plc:a', iso(5))]],
				'app.bsky.feed.post': [
					[
						replyPost('did:plc:b', iso(2)),
						quotePostWithMedia('did:plc:c', iso(3)),
						mentionPost(['did:plc:d', 'did:plc:e'], iso(6)),
						plainPost(iso(7))
					]
				]
			},
			calls
		);
		const { map, coveredSince } = await collectInteractions(src, MY, NOW, noSignal, () => {});
		const a = map.get('did:plc:a');
		expect(a).not.toBeNull();
		expect(a?.lastAt).toBe(iso(1));
		expect(a?.lastKind).toBe('like');
		expect(a?.countsByKind).toEqual({ like: 2, repost: 1, reply: 0, quote: 0, mention: 0 });
		expect(a?.lastByKind).toEqual({
			like: iso(1),
			repost: iso(5),
			reply: null,
			quote: null,
			mention: null
		});
		expect(map.get('did:plc:b')?.lastKind).toBe('reply');
		expect(map.get('did:plc:c')?.lastKind).toBe('quote');
		expect(map.get('did:plc:d')?.lastKind).toBe('mention');
		expect(map.get('did:plc:e')?.lastKind).toBe('mention');
		// The plain post targets nobody: four DIDs in total.
		expect(map.size).toBe(5);
		// No cap hit: the read covers the whole window.
		expect(coveredSince).toBe(new Date(NOW.getTime() - 365 * DAY).toISOString());
		expect(calls.length).toBe(3);
	});

	it('keeps the higher-priority kind on an exact tie', async () => {
		const t = iso(1);
		const src = ownSource(
			{
				'app.bsky.feed.like': [[like('did:plc:a', t), like('did:plc:b', t)]],
				'app.bsky.feed.repost': [[repost('did:plc:a', t)]],
				'app.bsky.feed.post': [[mentionPost(['did:plc:b'], t)]]
			},
			[]
		);
		const { map } = await collectInteractions(src, MY, NOW, noSignal, () => {});
		// A and B are both liked and (a: reposted / b: mentioned) at the same instant.
		expect(map.get('did:plc:a')?.lastKind).toBe('repost');
		expect(map.get('did:plc:b')?.lastKind).toBe('mention');
	});

	it('does not stop paging on one out-of-order record near the window edge', async () => {
		// Newest first: page 1 is in the window; page 2 has 99 records from 400
		// days ago and one from 100 days ago (late, but in the window); page 3
		// is wholly old and ends the read.
		const oldPage = Array.from({ length: 99 }, (_, i) => like('did:plc:old', iso(400 + i)));
		oldPage.push(like('did:plc:late', iso(100)));
		const calls: Call[] = [];
		const src = ownSource(
			{
				'app.bsky.feed.like': [
					[like('did:plc:recent', iso(10))],
					oldPage,
					[like('did:plc:ancient', iso(500))]
				]
			},
			calls
		);
		const { map } = await collectInteractions(src, MY, NOW, noSignal, () => {});
		expect(map.get('did:plc:late')).not.toBeNull(); // page 2 was processed
		expect(map.has('did:plc:ancient')).toBe(false); // page 3 was not
		expect(map.has('did:plc:old')).toBe(false);
		const likeCalls = calls.filter((c) => c.collection === 'app.bsky.feed.like');
		expect(likeCalls).toHaveLength(3);
	});

	it('stops a collection once a whole page is older than the window', async () => {
		const calls: Call[] = [];
		const src = ownSource(
			{
				'app.bsky.feed.like': [
					[like('did:plc:a', iso(1))],
					[like('did:plc:b', iso(400)), like('did:plc:c', iso(500))]
				]
			},
			calls
		);
		const { map } = await collectInteractions(src, MY, NOW, noSignal, () => {});
		expect(map.has('did:plc:a')).toBe(true);
		expect(map.has('did:plc:b')).toBe(false);
		expect(calls.filter((c) => c.collection === 'app.bsky.feed.like')).toHaveLength(2);
	});

	it('reports progress as records are read', async () => {
		const reads: number[] = [];
		const src = ownSource(
			{
				'app.bsky.feed.like': [[like('did:plc:a', iso(1)), like('did:plc:b', iso(2))]],
				'app.bsky.feed.post': [[replyPost('did:plc:c', iso(3))]]
			},
			[]
		);
		await collectInteractions(src, MY, NOW, noSignal, (n) => reads.push(n));
		expect(reads).toEqual([2, 3]);
	});

	it('the record cap stops a collection and sets coveredSince to its reach', async () => {
		const calls: Call[] = [];
		// 400 likes, one per day, newest first, pages of 100.
		const likes = Array.from({ length: 400 }, (_, i) => like('did:plc:a', iso(i + 1)));
		const src = ownSource(
			{
				'app.bsky.feed.like': [
					likes.slice(0, 100),
					likes.slice(100, 200),
					likes.slice(200, 300),
					likes.slice(300)
				]
			},
			calls
		);
		const reads: number[] = [];
		const { coveredSince, map } = await collectInteractions(
			src,
			MY,
			NOW,
			noSignal,
			(n) => reads.push(n),
			{ maxRecordsPerCollection: 250 }
		);
		// Three pages (300 records) were read; the fourth was never requested.
		expect(reads).toEqual([100, 200, 300]);
		expect(calls.filter((c) => c.collection === 'app.bsky.feed.like')).toHaveLength(3);
		// The oldest record read was from 300 days ago: the reach.
		expect(coveredSince).toBe(iso(300));
		expect(map.get('did:plc:a')?.countsByKind.like).toBe(300);
	});

	it('reports a capped reach by write time, ignoring backdated imports', async () => {
		// Cap of 4: the read stops after the first page. The second record is
		// an import with a 2015 createdAt but a repo-new TID; the fourth
		// (the oldest read) was written 200 days ago.
		const page = [
			writtenAtMs(like('did:plc:a', iso(1)), NOW.getTime() - 1 * DAY),
			writtenAtMs(like('did:plc:import', '2015-01-01T00:00:00Z'), NOW.getTime() - 2 * DAY),
			writtenAtMs(like('did:plc:b', iso(50)), NOW.getTime() - 50 * DAY),
			writtenAtMs(like('did:plc:c', iso(200)), NOW.getTime() - 200 * DAY),
			writtenAtMs(like('did:plc:d', iso(300)), NOW.getTime() - 300 * DAY)
		];
		const calls: Call[] = [];
		const src = ownSource({ 'app.bsky.feed.like': [page.slice(0, 4), page.slice(4)] }, calls);
		const { coveredSince, map } = await collectInteractions(src, MY, NOW, noSignal, () => {}, {
			maxRecordsPerCollection: 4
		});
		// The reach is the oldest write time read (200 days ago): not the
		// import's 2015 createdAt, not the unread records.
		expect(coveredSince).toBe(new Date(NOW.getTime() - 200 * DAY).toISOString());
		expect(map.has('did:plc:import')).toBe(false);
		expect(calls.filter((c) => c.collection === 'app.bsky.feed.like')).toHaveLength(1);
	});

	it('retries an oldest-first first page with reverse: true, without double-counting', async () => {
		const calls: Call[] = [];
		const newestFirst = [like('did:plc:a', iso(1)), like('did:plc:a', iso(2))];
		const oldestFirst = [...newestFirst].reverse();
		const src: DataSource = {
			...ownSource({ 'app.bsky.feed.like': [newestFirst] }, calls),
			async listOwnRecords(collection, cursor, _signal, reverse) {
				calls.push({ collection, cursor, reverse: reverse === true });
				if (collection !== 'app.bsky.feed.like') return { records: [], cursor: undefined };
				if (cursor === undefined && reverse !== true) {
					// First page came back oldest first: the reader must restart.
					return { records: oldestFirst, cursor: undefined };
				}
				const start = cursor === undefined ? 0 : Number(cursor);
				const page = start === 0 ? newestFirst : undefined;
				if (page === undefined) return { records: [], cursor: undefined };
				return { records: page, cursor: undefined };
			}
		};
		const { map } = await collectInteractions(src, MY, NOW, noSignal, () => {});
		const likeCalls = calls.filter((c) => c.collection === 'app.bsky.feed.like');
		expect(likeCalls[0]).toEqual({
			collection: 'app.bsky.feed.like',
			cursor: undefined,
			reverse: false
		});
		expect(likeCalls[1]).toEqual({
			collection: 'app.bsky.feed.like',
			cursor: undefined,
			reverse: true
		});
		// The discarded oldest-first page is not counted again.
		expect(map.get('did:plc:a')?.countsByKind.like).toBe(2);
	});

	it('a backdated newest record does not trigger the reverse read', async () => {
		// The first page is newest first by write time (rkey TID), but its
		// newest record is an import with a 2015 createdAt. Ordering by
		// createdAt would look oldest first and wrongly restart.
		const importLike = writtenAtMs(
			like('did:plc:import', '2015-03-01T00:00:00Z'),
			NOW.getTime() - 1 * DAY
		);
		const normalLike = writtenAtMs(like('did:plc:a', iso(10)), NOW.getTime() - 10 * DAY);
		const calls: Call[] = [];
		const src = ownSource({ 'app.bsky.feed.like': [[importLike, normalLike]] }, calls);
		const { map } = await collectInteractions(src, MY, NOW, noSignal, () => {});
		const likeCalls = calls.filter((c) => c.collection === 'app.bsky.feed.like');
		expect(likeCalls).toHaveLength(1);
		expect(likeCalls[0].reverse).toBe(false);
		// The import's target is outside the window by createdAt: not counted.
		expect(map.has('did:plc:import')).toBe(false);
		expect(map.get('did:plc:a')).not.toBeNull();
	});

	it('a page of recent imports does not stop the read, and their targets are ignored', async () => {
		// Page 1: imported in the last week (recent rkeys) but dated 2015.
		// Page 2: a normal recent record. Page 3: written before the window.
		const imports = [
			writtenAtMs(like('did:plc:i1', '2015-01-01T00:00:00Z'), NOW.getTime() - 5 * DAY),
			writtenAtMs(like('did:plc:i2', '2015-02-01T00:00:00Z'), NOW.getTime() - 6 * DAY)
		];
		const recent = writtenAtMs(like('did:plc:real', iso(2)), NOW.getTime() - 2 * DAY);
		const old = writtenAtMs(like('did:plc:old', iso(400)), NOW.getTime() - 400 * DAY);
		const calls: Call[] = [];
		const src = ownSource({ 'app.bsky.feed.like': [[...imports], [recent], [old]] }, calls);
		const { map } = await collectInteractions(src, MY, NOW, noSignal, () => {});
		expect(map.get('did:plc:real')).not.toBeNull(); // page 2 was processed
		expect(map.has('did:plc:i1')).toBe(false); // imports: createdAt out of window
		expect(map.has('did:plc:i2')).toBe(false);
		expect(map.has('did:plc:old')).toBe(false); // page 3 not processed
		expect(calls.filter((c) => c.collection === 'app.bsky.feed.like')).toHaveLength(3);
	});

	it('stops when every record on a page was written before the window', async () => {
		const recent = writtenAtMs(like('did:plc:a', iso(1)), NOW.getTime() - 1 * DAY);
		const old1 = writtenAtMs(like('did:plc:o1', iso(400)), NOW.getTime() - 400 * DAY);
		const old2 = writtenAtMs(like('did:plc:o2', iso(500)), NOW.getTime() - 500 * DAY);
		const calls: Call[] = [];
		const src = ownSource(
			{
				'app.bsky.feed.like': [
					[recent],
					[old1, old2],
					[writtenAtMs(like('did:plc:never', iso(600)), NOW.getTime() - 600 * DAY)]
				]
			},
			calls
		);
		const { map } = await collectInteractions(src, MY, NOW, noSignal, () => {});
		expect(map.get('did:plc:a')).not.toBeNull();
		expect(map.has('did:plc:o1')).toBe(false); // the old page ends the read
		expect(map.has('did:plc:never')).toBe(false);
		expect(calls.filter((c) => c.collection === 'app.bsky.feed.like')).toHaveLength(2);
	});

	it('aborts before the first read with a pre-aborted signal', async () => {
		const calls: Call[] = [];
		const src = ownSource({ 'app.bsky.feed.like': [[like('did:plc:a', iso(1))]] }, calls);
		const controller = new AbortController();
		controller.abort();
		await expect(
			collectInteractions(src, MY, NOW, controller.signal, () => {})
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(calls).toHaveLength(0);
	});

	it('aborts between pages when the signal fires', async () => {
		const calls: Call[] = [];
		const controller = new AbortController();
		const src = ownSource(
			{
				'app.bsky.feed.like': [[like('did:plc:a', iso(1))], [like('did:plc:b', iso(2))]]
			},
			calls
		);
		const p = collectInteractions(src, MY, NOW, controller.signal, () => {
			// After the first page: abort.
			controller.abort();
		});
		await expect(p).rejects.toMatchObject({ name: 'AbortError' });
		expect(calls.filter((c) => c.collection === 'app.bsky.feed.like')).toHaveLength(1);
	});
});
