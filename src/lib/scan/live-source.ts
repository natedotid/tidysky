/**
 * The real DataSource. The signed-in agent reads the user's own follow
 * records; the public AppView reads activity and follow-back, so the user's
 * PDS never sees the scan. Every call goes through a request queue, so the
 * whole scan stays inside the polite concurrency and rate budget.
 */

import type { Agent } from '@atproto/api';

import { publicGet } from '#lib/atproto/public';
import { CONFIG } from '#lib/config';
import { HttpError } from '#lib/net/errors';
import { authQueue, publicQueue, type RequestQueue } from '#lib/net/queue';

import { classifyFeedItem, firstMediaAlt, type FeedItemLite } from './classify';
import { blockApplies, viewerFromProfile } from './viewer';
import type {
	AuthorFeedResult,
	DataSource,
	FollowRecord,
	FollowersSample,
	ListItemRecord,
	OwnCollection,
	OwnFeedItem,
	OwnRecord,
	ProfileLite
} from './source';
import type { AccountStatus } from './types';

/** app.bsky.graph.getRelationships takes up to 30 DIDs per call. */
const RELATIONSHIP_BATCH = 30;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A cancellation must propagate to the scan, not be mapped to a status. */
function isAbortError(e: unknown): boolean {
	return e instanceof Error && e.name === 'AbortError';
}

/**
 * One relationship row from getRelationships that tells us about follow-back.
 * The response is a union with a `{ $type: string }` catch-all member, so
 * narrow with a guard instead of casting. The `notFoundActor` union member is
 * the one with `notFound: true`; other members don't carry `$type` in a way
 * we can rely on, so we don't require it.
 */
function isRelationship(rel: unknown): rel is { did: string; followedBy?: string } {
	return isRecord(rel) && typeof rel['did'] === 'string' && rel['notFound'] !== true;
}

/** Map a feed failure (retries already spent by the queue) to a status. */
function feedStatus(e: unknown): AccountStatus {
	if (e instanceof HttpError) {
		if (e.code === 'AccountDeactivated') return 'deactivated';
		if (e.code === 'AccountTakedown') return 'takendown';
		if (e.code === 'BlockedActor' || e.code === 'BlockedByActor') return 'blocked';
		if (
			e.status === 404 ||
			(e.code === 'InvalidRequest' && e.message.includes('Profile not found'))
		)
			return 'gone';
	}
	return 'unknown';
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/** app.bsky.actor.getProfiles and agent.getProfile both return this shape. */
type DetailedProfile = {
	did: string;
	handle: string;
	displayName?: string;
	avatar?: string;
	description?: string;
	createdAt?: string;
	followersCount?: number;
	followsCount?: number;
	postsCount?: number;
	labels?: Array<{ val: string }>;
	/** Only on the signed-in read; the public AppView returns no viewer. */
	viewer?: unknown;
};

function toProfileLite(p: DetailedProfile, followsYou: boolean | null): ProfileLite {
	return {
		did: p.did,
		handle: p.handle,
		displayName: p.displayName ?? null,
		avatar: p.avatar ?? null,
		description: p.description ?? null,
		createdAt: p.createdAt ?? null,
		followersCount: p.followersCount ?? null,
		followsCount: p.followsCount ?? null,
		postsCount: p.postsCount ?? null,
		followsYou,
		viewer: viewerFromProfile(p),
		labels: (p.labels ?? []).map((l) => l.val)
	};
}

export class LiveSource implements DataSource {
	readonly did: string;
	private agent: Agent;
	/** Signed-in calls to the user's PDS, gentler: it is their server. */
	private auth: RequestQueue;
	/** Unauthenticated reads against the public AppView. */
	private pub: RequestQueue;

	constructor(did: string, agent: Agent) {
		this.did = did;
		this.agent = agent;
		this.auth = authQueue();
		this.pub = publicQueue();
	}

	async listFollowRecords(
		cursor: string | undefined,
		signal?: AbortSignal
	): Promise<{ records: FollowRecord[]; cursor: string | undefined }> {
		const res = await this.auth.run(
			() =>
				this.agent.com.atproto.repo.listRecords(
					{
						repo: this.did,
						collection: 'app.bsky.graph.follow',
						limit: CONFIG.pageSize,
						cursor
					},
					{ signal }
				),
			signal
		);
		const records: FollowRecord[] = [];
		for (const rec of res.data.records) {
			const subject = rec.value['subject'];
			// A follow record points at a DID; skip anything malformed.
			if (typeof subject !== 'string' || !subject.startsWith('did:')) continue;
			const createdAt = rec.value['createdAt'];
			records.push({
				did: subject,
				rkey: rec.uri.split('/').pop() ?? '',
				createdAt: typeof createdAt === 'string' ? createdAt : null
			});
		}
		return { records, cursor: res.data.cursor };
	}

	async listListItems(
		cursor: string | undefined,
		signal?: AbortSignal
	): Promise<{ records: ListItemRecord[]; cursor: string | undefined }> {
		const res = await this.auth.run(
			() =>
				this.agent.com.atproto.repo.listRecords(
					{
						repo: this.did,
						collection: 'app.bsky.graph.listitem',
						limit: CONFIG.pageSize,
						cursor
					},
					{ signal }
				),
			signal
		);
		const records: ListItemRecord[] = [];
		for (const rec of res.data.records) {
			const subject = rec.value['subject'];
			const list = rec.value['list'];
			// Skip anything malformed: the subject must be a DID, the list a URI.
			if (typeof subject !== 'string' || !subject.startsWith('did:')) continue;
			if (typeof list !== 'string' || !list.startsWith('at://')) continue;
			records.push({
				rkey: rec.uri.split('/').pop() ?? '',
				subject,
				list
			});
		}
		return { records, cursor: res.data.cursor };
	}

	/**
	 * The user's own records (likes, reposts, posts) for the interaction
	 * check: the same signed-in read as the follow records, kept raw so the
	 * reader (interactions.ts) can parse each type.
	 */
	async listOwnRecords(
		collection: OwnCollection,
		cursor: string | undefined,
		signal?: AbortSignal,
		reverse?: boolean
	): Promise<{ records: OwnRecord[]; cursor: string | undefined }> {
		const res = await this.auth.run(
			() =>
				this.agent.com.atproto.repo.listRecords(
					{ repo: this.did, collection, limit: CONFIG.pageSize, cursor, reverse },
					{ signal }
				),
			signal
		);
		return {
			records: res.data.records.map((rec) => ({ uri: rec.uri, value: rec.value })),
			cursor: res.data.cursor
		};
	}

	async getProfiles(dids: string[], signal?: AbortSignal): Promise<ProfileLite[]> {
		if (dids.length === 0) return [];
		const relChunks = chunk(dids, RELATIONSHIP_BATCH);

		// Profiles come from the user's PDS. Follow-back comes from the public
		// getRelationships: getProfiles doesn't return followedBy for every
		// account, while getRelationships answers reliably.
		const [base, relResults] = await Promise.all([
			this.profilesOnly(dids, signal),
			Promise.all(
				relChunks.map((c) =>
					this.pub
						.run(
							() =>
								publicGet<{ relationships: unknown[] }>(
									'app.bsky.graph.getRelationships',
									{ actor: this.did, others: c },
									signal
								),
							signal
						)
						.catch((e: unknown) => {
							// Follow-back is a bonus: when it fails, return the
							// profiles with followsYou unknown instead of failing.
							if (isAbortError(e)) throw e;
							return null;
						})
				)
			)
		]);

		const followsYouByDid = new Map<string, boolean>();
		relChunks.forEach((_c, i) => {
			const data = relResults[i];
			if (data === null) return; // failed chunk: followsYou stays null
			for (const rel of data.relationships) {
				if (isRelationship(rel)) followsYouByDid.set(rel.did, typeof rel.followedBy === 'string');
			}
		});

		for (const p of base) {
			// A DID missing from a successful response is unknown, not
			// "doesn't follow you": a false default would make it an unfollow
			// candidate.
			p.followsYou = followsYouByDid.get(p.did) ?? null;
			// While a block applies, the relationship read can't be trusted:
			// keep follow-back unknown so the account can't land in
			// "Doesn't follow back".
			if (blockApplies(p.viewer)) p.followsYou = null;
		}
		return base;
	}

	/** Profiles only (no follow-back): getProfiles batches of 25. */
	private async profilesOnly(dids: string[], signal?: AbortSignal): Promise<ProfileLite[]> {
		const out: ProfileLite[] = [];
		for (const c of chunk(dids, CONFIG.profilesPerCall)) {
			const res = await this.auth.run(
				() => this.agent.app.bsky.actor.getProfiles({ actors: c }, { signal }),
				signal
			);
			for (const p of res.data.profiles) out.push(toProfileLite(p, null));
		}
		return out;
	}

	async getAuthorFeed(did: string, limit: number, signal?: AbortSignal): Promise<AuthorFeedResult> {
		try {
			const data = await this.pub.run(
				() =>
					publicGet<{ cursor?: string; feed?: unknown[] }>(
						'app.bsky.feed.getAuthorFeed',
						{ actor: did, limit, filter: 'posts_with_replies' },
						signal
					),
				signal
			);
			const items: FeedItemLite[] = [];
			for (const item of data.feed ?? []) {
				const lite = classifyFeedItem(item);
				if (lite !== null) items.push(lite);
			}
			// No cursor means there is nothing older than what we got.
			return { ok: true, items, exhausted: data.cursor === undefined };
		} catch (e) {
			if (isAbortError(e)) throw e;
			return { ok: false, status: feedStatus(e) };
		}
	}

	async getOwnProfile(signal?: AbortSignal): Promise<ProfileLite> {
		const res = await this.auth.run(
			() => this.agent.getProfile({ actor: this.did }, { signal }),
			signal
		);
		return toProfileLite(res.data, null);
	}

	async getOwnFeed(maxItems: number, signal?: AbortSignal): Promise<OwnFeedItem[]> {
		const out: OwnFeedItem[] = [];
		let cursor: string | undefined;
		while (out.length < maxItems) {
			const data = await this.pub.run(
				() =>
					publicGet<{ cursor?: string; feed?: unknown[] }>(
						'app.bsky.feed.getAuthorFeed',
						{
							actor: this.did,
							limit: CONFIG.pageSize,
							filter: 'posts_with_replies',
							cursor
						},
						signal
					),
				signal
			);
			for (const raw of data.feed ?? []) {
				const lite = classifyFeedItem(raw);
				if (lite === null) continue; // pinned or unusable
				const post = isRecord(raw) && isRecord(raw['post']) ? raw['post'] : null;
				if (post === null || typeof post['uri'] !== 'string') continue;
				const author = isRecord(post['author']) ? post['author'] : null;
				const record = isRecord(post['record']) ? post['record'] : {};
				out.push({
					uri: lite.uri,
					author: author !== null && typeof author['did'] === 'string' ? author['did'] : '',
					kind: lite.kind,
					at: lite.at,
					embed: lite.embed,
					text: typeof record['text'] === 'string' ? record['text'] : '',
					alt: firstMediaAlt(record['embed'] ?? post['embed']) ?? undefined,
					likeCount: typeof post['likeCount'] === 'number' ? post['likeCount'] : 0,
					repostCount: typeof post['repostCount'] === 'number' ? post['repostCount'] : 0,
					replyCount: typeof post['replyCount'] === 'number' ? post['replyCount'] : 0,
					quoteCount: typeof post['quoteCount'] === 'number' ? post['quoteCount'] : 0
				});
				if (out.length >= maxItems) break;
			}
			// No cursor means there is nothing older than what we got.
			cursor = data.cursor;
			if (cursor === undefined) break;
		}
		return out;
	}

	async getFollowersSample(max: number, signal?: AbortSignal): Promise<FollowersSample> {
		const dids: string[] = [];
		let cursor: string | undefined;
		// The sample is capped at 3 pages of 100, most recent first.
		for (let page = 0; page < Math.ceil(max / CONFIG.pageSize) && dids.length < max; page += 1) {
			const res = await this.auth.run(
				() =>
					this.agent.app.bsky.graph.getFollowers(
						{ actor: this.did, limit: CONFIG.pageSize, cursor },
						{ signal }
					),
				signal
			);
			for (const f of res.data.followers) dids.push(f.did);
			// No cursor means there are no older followers.
			cursor = res.data.cursor;
			if (cursor === undefined) break;
		}
		// The loop stops on the cap or when getFollowers runs out of
		// followers; only the second is a complete sample.
		const complete = cursor === undefined;
		if (dids.length === 0) return { profiles: [], complete };
		// getFollowers returns bare ProfileViews: the counts need getProfiles.
		// They are followers, so followsYou is true by definition.
		const base = await this.profilesOnly(dids.slice(0, max), signal);
		for (const p of base) p.followsYou = true;
		return { profiles: base, complete };
	}
}
