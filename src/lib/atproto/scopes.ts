/** The Bluesky AppView service, for proxied app.bsky.* calls. '#' is written %23 inside scope strings. */
export const APPVIEW_AUD = 'did:web:api.bsky.app%23bsky_appview';

/** AppView methods called through the user's PDS. Keep in sync with the code. */
export const RPC_METHODS = [
	'app.bsky.actor.getProfile',
	'app.bsky.actor.getProfiles',
	'app.bsky.graph.getFollowers',
	'app.bsky.graph.muteActor',
	'app.bsky.graph.unmuteActor'
] as const;

export const SCOPES = [
	'atproto',
	'repo:app.bsky.graph.follow?action=create&action=delete',
	'repo:app.bsky.graph.list',
	'repo:app.bsky.graph.listitem',
	...RPC_METHODS.map((m) => `rpc:${m}?aud=${APPVIEW_AUD}`)
] as const;

/** Space-separated scope string sent to the OAuth authorization server. */
export const SCOPE = SCOPES.join(' ');

/** Fallback scope if the granular scopes are refused: coarse but widely supported. */
export const FALLBACK_SCOPE = 'atproto transition:generic';

export const HANDLE_RESOLVER = 'https://bsky.social';
