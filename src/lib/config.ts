/** Every tunable number lives here. Nothing else in the app hardcodes a rate, batch size or limit. */
export const CONFIG = {
	publicConcurrency: 6, // public AppView (activity scan)
	authConcurrency: 2, // the user's PDS (signed-in calls)
	maxRetries: 4,
	baseDelayMs: 800,
	maxDelayMs: 30_000,
	profilesPerCall: 25, // app.bsky.actor.getProfiles max
	pageSize: 100, // listRecords / getFollowers page size
	activitySample: 30, // getAuthorFeed items per account
	youFeedSample: 300, // own feed items for the "you" insights
	youFollowersSample: 300, // most recent followers checked for the "Who follows you" card
	staleAfterHours: 24, // rescan accounts older than this
	interactionWindowDays: 365, // how far back "last interaction" looks
	interactionMaxRecordsPerCollection: 10_000, // cap per own-record type per scan
	scanReloadMs: 5_000, // how often the app re-reads partial scan data while a scan runs
	writeBatchSize: 100, // applyWrites operations per call (200 worked in testing, capped at 100)
	writeBatchPauseMs: 2_000,
	softDailyUnfollowLimit: 300,
	maxFollowsSupported: 10_000,
	snapshotsKept: 10,
	publicAppView: 'https://public.api.bsky.app'
} as const;
