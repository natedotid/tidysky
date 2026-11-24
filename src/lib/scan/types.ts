/** The data model for one signed-in account. Everything persists in IndexedDB. */

export type AccountStatus =
	| 'active'
	| 'deactivated' // AccountDeactivated, or handle.invalid with no posts reachable
	| 'takendown' // AccountTakedown
	| 'gone' // missing from getProfiles and the feed says not found
	| 'blocked' // a block in either direction stops us seeing them
	| 'unknown'; // a scan error; we don't know

export interface ActivitySummary {
	sampleSize: number; // items read (≤ CONFIG.activitySample)
	exhausted: boolean; // true when the account has no more items than we read
	lastActiveAt: string | null; // newest item of any kind, reposts included
	lastPostAt: string | null; // newest non-repost item
	itemsPerDay: number; // estimated, reposts included (that's what fills a feed)
	share: { post: number; reply: number; quote: number; repost: number }; // 0–1 shares of the sample
	media: { text: number; image: number; video: number; link: number; quote: number }; // counts, non-reposts
	weekdayHour: number[][]; // [7][24] counts in the device's local time, Sunday = 0
	topLangs: Array<[string, number]>; // up to 3
	medianWords: number; // non-reposts; 0 if none
}

/**
 * What the signed-in profile read says about how this account relates to
 * the user's moderation lists and blocks. A list mute or list block hides
 * the account whatever the follows say; while any block applies the
 * follow-back fields are absent, so follow-back is unknown. `null` = not
 * read (the public path, or a row from an older scan).
 */
export interface ProfileViewer {
	/** Muted by a moderation list the user subscribes to. */
	mutedByList: { uri: string; name: string } | null;
	/** Blocked by a moderation list the user subscribes to. */
	blockingByList: { uri: string; name: string } | null;
	/** They block the user. */
	blockedBy: boolean;
	/** The user blocks them personally (a list block is blockingByList). */
	blockingPersonally: boolean;
	/** How many of the user's follows they also follow; null = unknown. */
	knownFollowers: number | null;
}

/** How the user last interacted with an account, from their own records. */
export type InteractionKind = 'like' | 'repost' | 'reply' | 'quote' | 'mention';

export interface InteractionSummary {
	lastAt: string | null; // newest of the five, or null if none in the window
	lastKind: InteractionKind | null;
	lastByKind: Record<InteractionKind, string | null>;
	countsByKind: Record<InteractionKind, number>; // within the window
}

export interface FollowAccount {
	did: string;
	handle: string;
	displayName: string | null;
	avatar: string | null;
	description: string | null;
	followRkeys: string[]; // usually one; duplicates happen, so unfollow deletes all
	followedAt: string | null; // createdAt of the oldest follow record
	createdAt: string | null; // account creation
	followersCount: number | null;
	followsCount: number | null;
	postsCount: number | null;
	followsYou: boolean | null; // null = unknown
	viewer: ProfileViewer | null; // list mutes/blocks, blockedBy, mutuals; null = not read
	labels: string[]; // label values, e.g. "spam"
	status: AccountStatus;
	activity: ActivitySummary | null;
	profileScannedAt: string | null;
	activityScannedAt: string | null;
	interaction: InteractionSummary | null; // null = not checked yet
}

export interface ScanMeta {
	lastScanStartedAt: string | null;
	lastScanFinishedAt: string | null;
	followCount: number;
	/** The user's daily-unfollow suggestion (Settings). Absent on old rows: use the CONFIG default. */
	dailyUnfollowLimit?: number | null;
	/** When the interaction check last ran; null = never. Absent on pre-1.1 rows. */
	interactionsScannedAt: string | null;
	/** Oldest date the interaction read fully covered: the window start, or later if the cap was hit. */
	interactionsCoveredSince: string | null;
}

export interface UnfollowLogEntry {
	id?: number; // auto-increment
	did: string;
	handle: string;
	at: string; // when we unfollowed
	reason: string; // the filter summary, e.g. "No posts in 90 days"
	action: 'unfollow' | 'move-to-list' | 'mute';
	listUri?: string;
	undoneAt?: string;
}

export interface ManagedList {
	uri: string; // at://did/app.bsky.graph.list/rkey
	rkey: string;
	name: string;
	description: string;
	presetId: string | null; // which preset built it, if any
	filterSpec: unknown; // the FilterSpec used, stored as plain JSON
	memberDids: string[];
	updatedAt: string;
}

export interface Snapshot {
	id?: number;
	at: string;
	statuses: Record<string, { status: AccountStatus; quiet90: boolean; followsYou: boolean | null }>;
	totals: { follows: number; active30: number; quiet90: number; gone: number; followsYou: number };
}
