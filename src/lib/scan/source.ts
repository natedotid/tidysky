/**
 * The data source the scan engine reads from. The live source (this folder)
 * and the demo source both implement it, so the engine is testable
 * offline and demoable without an account.
 */

import type { EmbedKind, FeedItemLite, ItemKind } from './classify';
import type { AccountStatus, ProfileViewer } from './types';

export interface FollowRecord {
	did: string;
	rkey: string;
	createdAt: string | null;
}

/** One of the signed-in account's own listitem records. */
export interface ListItemRecord {
	rkey: string;
	/** The DID of the person in the list. */
	subject: string;
	/** The URI of the list this item belongs to. */
	list: string;
}

export interface ProfileLite {
	did: string;
	handle: string;
	displayName: string | null;
	avatar: string | null;
	description: string | null;
	createdAt: string | null;
	followersCount: number | null;
	followsCount: number | null;
	postsCount: number | null;
	followsYou: boolean | null;
	/** The signed-in read's view of list mutes/blocks and mutuals; null = not read. */
	viewer: ProfileViewer | null;
	labels: string[];
}

export type AuthorFeedResult =
	{ ok: true; items: FeedItemLite[]; exhausted: boolean } | { ok: false; status: AccountStatus }; // mapped from the error code

/**
 * One item of the signed-in account's own feed, with the engagement counts
 * the "you" insights need: they live on the post view, not on the
 * classified `FeedItemLite`.
 */
export interface OwnFeedItem {
	uri: string;
	author: string;
	kind: ItemKind;
	/** ISO time of the activity: the repost time for reposts, else the post time. */
	at: string;
	embed: EmbedKind;
	/** The post's text (a repost carries the reposted post's text). */
	text: string;
	/** The first media alt text, trimmed, when the post has one. */
	alt?: string;
	likeCount: number;
	repostCount: number;
	replyCount: number;
	quoteCount: number;
}

/** The user's own repo collections the interaction check reads. */
export type OwnCollection = 'app.bsky.feed.like' | 'app.bsky.feed.repost' | 'app.bsky.feed.post';

/**
 * One of the user's own records, kept raw: the reader in interactions.ts
 * decides what each value means (a like points at a post, a post may reply,
 * quote and mention at the same time).
 */
export interface OwnRecord {
	uri: string;
	value: Record<string, unknown>;
}

export interface DataSource {
	readonly did: string;
	listFollowRecords(
		cursor: string | undefined,
		signal?: AbortSignal
	): Promise<{ records: FollowRecord[]; cursor: string | undefined }>;
	getProfiles(dids: string[], signal?: AbortSignal): Promise<ProfileLite[]>; // ≤ 25 per call; missing DIDs are simply absent
	getAuthorFeed(did: string, limit: number, signal?: AbortSignal): Promise<AuthorFeedResult>;
	/** The signed-in account's own profile, with counts and createdAt. */
	getOwnProfile(signal?: AbortSignal): Promise<ProfileLite>;
	/** Up to `maxItems` of the own author feed (posts with replies), newest first. */
	getOwnFeed(maxItems: number, signal?: AbortSignal): Promise<OwnFeedItem[]>;
	/**
	 * The `max` most recent followers, with profile counts (via
	 * getProfiles), and whether the fetch ran out of followers before the
	 * cap (then the sample covers every follower the server will show).
	 */
	getFollowersSample(max: number, signal?: AbortSignal): Promise<FollowersSample>;
	/** The signed-in account's own listitem records, in repo order. */
	listListItems(
		cursor: string | undefined,
		signal?: AbortSignal
	): Promise<{ records: ListItemRecord[]; cursor: string | undefined }>;
	/**
	 * The signed-in account's own records (likes, reposts, posts), via
	 * com.atproto.repo.listRecords, newest first by default. `reverse: true`
	 * reads oldest first; the interaction reader uses it to restart a
	 * collection whose first page came back oldest first.
	 */
	listOwnRecords(
		collection: OwnCollection,
		cursor: string | undefined,
		signal?: AbortSignal,
		reverse?: boolean
	): Promise<{ records: OwnRecord[]; cursor: string | undefined }>;
}

/** The follower sample and whether it covers every follower shown. */
export interface FollowersSample {
	profiles: ProfileLite[];
	/**
	 * True when getFollowers returned no further cursor before the sample
	 * cap: the sample covers every follower the server will show (the
	 * profile's follower count can still be higher, for accounts Bluesky
	 * hides, like suspended or deactivated ones).
	 */
	complete: boolean;
}

/** The cached "you" read (store meta key `you`), with the fetch time. */
export interface YouData {
	profile: ProfileLite;
	feed: OwnFeedItem[];
	followers: ProfileLite[];
	/**
	 * Whether the follower sample covers every follower shown. Optional:
	 * data cached before this field exists has no answer, and the copy
	 * falls back to comparing the follower count with the sample size.
	 */
	followersComplete?: boolean;
	fetchedAt: string;
}
