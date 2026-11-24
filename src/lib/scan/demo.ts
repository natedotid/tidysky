/**
 * Deterministic sample data for demo mode: a made-up account following
 * `count` others, with a believable mix of active, quiet, never-posted and
 * dead accounts. A seeded PRNG only: the same seed (and reference time)
 * always gives the same demo, so tests can compare outputs exactly.
 */

import type { WriteOp, Writer } from '#lib/actions/writer';
import { CONFIG } from '#lib/config';
import { isQuiet90, makeSnapshot } from '#lib/insights/snapshots';

import type { FeedItemLite } from './classify';
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
import type { FollowAccount, ProfileViewer, Snapshot } from './types';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const ME_DID = 'did:plc:demo';
const PAGE = 100;

/** mulberry32: tiny, fast, good-enough for sample data. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS_A = [
	'river',
	'ash',
	'oak',
	'birch',
	'cedar',
	'maple',
	'aspen',
	'alder',
	'hazel',
	'elm',
	'laurel',
	'holly',
	'ivy',
	'moss',
	'fern',
	'thorn',
	'heather',
	'clover',
	'daisy',
	'poppy',
	'rose',
	'thistle',
	'marigold',
	'peony',
	'orchid',
	'lotus',
	'meadow',
	'brook',
	'creek',
	'ford',
	'hollow',
	'ridge',
	'bluff',
	'glen',
	'dale',
	'vale',
	'field',
	'moor',
	'marsh',
	'coppice'
];

const WORDS_B = [
	'sky',
	'cloud',
	'mist',
	'dawn',
	'dusk',
	'night',
	'star',
	'moon',
	'storm',
	'rain',
	'snow',
	'wind',
	'breeze',
	'gale',
	'frost',
	'hail',
	'sleet',
	'shine',
	'glow',
	'ember',
	'spark',
	'smoke',
	'steam',
	'fog',
	'haze',
	'dew',
	'tide',
	'wave',
	'surf',
	'shore',
	'coast',
	'bay',
	'cove',
	'harbor',
	'beacon',
	'compass',
	'anchor',
	'keel',
	'lighthouse',
	'harbor-light'
];

const NAME_FIRST = [
	'Avery',
	'Riley',
	'Quinn',
	'Rowan',
	'Sasha',
	'Emerson',
	'Harper',
	'Jordyn',
	'Kai',
	'Lennox',
	'Marlowe',
	'Noor',
	'Oakley',
	'Piper',
	'Reese',
	'Sage',
	'Tatum',
	'Wren',
	'Ellis',
	'Finley',
	'Greta',
	'Hana',
	'Imre',
	'Joan',
	'Kenta',
	'Lena',
	'Mira',
	'Nils',
	'Omar',
	'Pia',
	'Ravi',
	'Sofia',
	'Tomas',
	'Uma',
	'Vera',
	'Wes',
	'Ximena',
	'Yusuf',
	'Zara',
	'Ada'
];

const NAME_LAST = [
	'Bennett',
	'Calloway',
	'Delacroix',
	'Ellison',
	'Fitzgerald',
	'Grantham',
	'Halloway',
	'Ibarra',
	'Jennings',
	'Kaminski',
	'Lindqvist',
	'Moreau',
	'Nakamura',
	'Okafor',
	'Petrov',
	'Quintana',
	'Rosenthal',
	'Sorensen',
	'Tanaka',
	'Ueda',
	'Vasquez',
	'Whitfield',
	'Yamada',
	'Zhang',
	'Ashford',
	'Blackwood',
	'Crenshaw',
	'Drummond',
	'Everly',
	'Fairweather'
];

const DID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const OTHER_LANGS = ['es', 'de', 'fr', 'pt', 'ja'];

/**
 * A handful of made-up accounts with edge-case names: very long (40+ char)
 * display names, emoji, non-Latin scripts, and a 45-char handle. The first
 * one is also the busiest poster, so the top charts show them. The demo
 * exercises the layout edge cases real accounts would hit.
 */
const SPECIALS: Array<{ name: string; handle?: string; rate: number }> = [
	{
		name: 'Absolutelylegendaryskywatcher2026andbeyond',
		handle: 'absolutelylegendaryskywatcher2026.bsky.social',
		rate: 120
	},
	{ name: 'VeryLongHandleWithoutAnySpacesAtAllIndeed', rate: 24 },
	{ name: 'River Cloud Meadow Keeper of the Northern Sky', rate: 18 },
	{ name: 'Harbor Light Lighthouse Keeper & Foghorn Warden', rate: 12 },
	{ name: 'Star Gazer ✨🌙🔭 Night Sky Photographer 📸', rate: 6 },
	{ name: 'Αστρονόμος του Βόρειου Ουρανού (Γραμμάτεας)', rate: 2.5 },
	{ name: '北の空の番人・星と霧と灯台の記録係', rate: 1.2 },
	{ name: 'حارسُ السماءِ الشماليِّ وكاتمُ أسرارِ الغيوم', rate: 0.4 }
];

export interface DemoData {
	me: ProfileLite;
	follows: FollowRecord[];
	profiles: ProfileLite[];
	feeds: Map<string, AuthorFeedResult>;
	/** The own account's recent feed with engagement. */
	meFeed: OwnFeedItem[];
	/** The own account's most recent followers. */
	meFollowers: ProfileLite[];
	/**
	 * The own account's likes, reposts and posts from the last year, newest
	 * first per collection.
	 */
	ownRecords: Record<OwnCollection, OwnRecord[]>;
	/**
	 * The DIDs the seeded previous snapshot followed but the demo scan does
	 * not: unfollowed outside TidySky. Four of them have profiles, so the
	 * "unfollowed elsewhere" sheet can show who they are; the fifth has none.
	 */
	droppedElsewhere: string[];
	/**
	 * Each followed DID's generated posting rate (items a day, before the
	 * sample), so tests can check the rate mix the demo intends.
	 */
	rateByDid: Map<string, number>;
}

export function generateDemoData(seed = 42, count = 850, nowMs = Date.now()): DemoData {
	const rand = mulberry32(seed);
	const between = (min: number, max: number): number => min + rand() * (max - min);
	const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
	const didPart = (): string => {
		let s = '';
		for (let i = 0; i < 27; i += 1) s += DID_ALPHABET[Math.floor(rand() * DID_ALPHABET.length)];
		return s;
	};

	const usedHandles = new Set<string>();
	const makeHandle = (): string => {
		for (;;) {
			const handle = `${pick(WORDS_A)}-${pick(WORDS_B)}.bsky.social`;
			if (!usedHandles.has(handle)) {
				usedHandles.add(handle);
				return handle;
			}
		}
	};
	const makeName = (handle: string): string => {
		if (rand() < 0.7)
			return rand() < 0.5 ? pick(NAME_FIRST) : `${pick(NAME_FIRST)} ${pick(NAME_LAST)}`;
		// Drop the domain first: "creek-dew.bsky.social" is "Creek Dew",
		// not "Creek Dew.bsky.social".
		const bare = handle.replace(/\.bsky\.social$/, '');
		const [a, b] = bare.split('-');
		return `${a[0].toUpperCase()}${a.slice(1)} ${b ? b[0].toUpperCase() + b.slice(1) : ''}`.trim();
	};
	const rkey = (i: number): string =>
		`3${(i * 7919 + Math.floor(rand() * 1e6)).toString(36)}${didPart().slice(0, 5)}`;

	// The viewer readings (list mutes, blocks, mutuals) come from a separate
	// stream, so this mix never moves the ratios the main stream pins.
	const viewerRand = mulberry32(seed * 48109 + 37);
	const vPart = (n: number): string => {
		let s = '';
		for (let i = 0; i < n; i += 1)
			s += DID_ALPHABET[Math.floor(viewerRand() * DID_ALPHABET.length)];
		return s;
	};
	const sportsSpoilers = {
		uri: `at://did:plc:${vPart(27)}/app.bsky.graph.list/${vPart(24)}`,
		name: 'Sports spoilers'
	};
	const replyGuys = {
		uri: `at://did:plc:${vPart(27)}/app.bsky.graph.list/${vPart(24)}`,
		name: 'Reply guys'
	};
	// A few of the follows are hidden by lists or block you; the rest are
	// plain. The first surviving follows take these, in this order.
	let mutedLeft = 5;
	let listBlockedLeft = 2;
	let blocksYouLeft = 3;

	const feeds = new Map<string, AuthorFeedResult>();
	const profiles: ProfileLite[] = [];
	const follows: FollowRecord[] = [];
	/** Per-account posting rate, for the interaction mix. */
	const meta: Array<{ did: string; rate: number }> = [];

	// The activity mix as exact counts of `count`: ~55% posted in the last 7
	// days, ~8% in 30, ~7% in 90, ~15% quiet (90+ days), ~8% never posted,
	// ~7% gone. active90 takes the remainder so the counts always sum to
	// `count`, at any size.
	const stateCounts = {
		deactivated: Math.round(0.04 * count),
		gone: Math.round(0.02 * count),
		takendown: Math.round(0.01 * count),
		never: Math.round(0.08 * count),
		quiet: Math.round(0.15 * count),
		active7: Math.round(0.55 * count),
		active30: Math.round(0.08 * count),
		active90: 0
	};
	stateCounts.active90 = Math.max(
		0,
		count -
			stateCounts.deactivated -
			stateCounts.gone -
			stateCounts.takendown -
			stateCounts.never -
			stateCounts.quiet -
			stateCounts.active7 -
			stateCounts.active30
	);
	type State = keyof typeof stateCounts;
	const states: State[] = [];
	for (const state of Object.keys(stateCounts) as State[])
		for (let i = 0; i < stateCounts[state]; i += 1) states.push(state);
	while (states.length < count) states.push('active7');
	// Shuffle so the mix is not correlated with follow order.
	for (let i = states.length - 1; i > 0; i -= 1) {
		const j = Math.floor(rand() * (i + 1));
		[states[i], states[j]] = [states[j], states[i]];
	}

	// Posting rates: a handful of firehoses (60–200 items a day, ~0.5%), a
	// busy middle (8–30), a middle band (6–20) so the "Most active" list
	// steps down gradually, then a long skewed tail where most post a few
	// times a week. Firehoses, the busy middle and the middle band only go
	// to accounts that posted in the last 7 days, so their high rates
	// survive the sample estimate.
	const baseRate = (): number => 0.05 + 6 * rand() ** 4;
	const active7Pool: number[] = [
		...Array.from({ length: Math.max(5, Math.round(0.005 * count)) }, () => 40 + rand() * 60),
		...Array.from({ length: Math.max(8, Math.round(0.02 * count)) }, () => 20 + rand() * 30),
		...Array.from({ length: Math.max(6, Math.round(0.03 * count)) }, () => 6 + rand() * 14)
	];
	while (active7Pool.length < stateCounts.active7) active7Pool.push(baseRate());
	for (let i = active7Pool.length - 1; i > 0; i -= 1) {
		const j = Math.floor(rand() * (i + 1));
		[active7Pool[i], active7Pool[j]] = [active7Pool[j], active7Pool[i]];
	}
	const activeOtherPool: number[] = Array.from(
		{ length: stateCounts.active30 + stateCounts.active90 },
		baseRate
	);
	let a7 = 0;
	let aOther = 0;
	let specialIdx = 0;

	for (let i = 0; i < count; i += 1) {
		const state = states[i];
		const did = `did:plc:${didPart()}`;

		// The first active7 accounts get the edge-case names (SPECIALS).
		let special: (typeof SPECIALS)[number] | undefined;
		if (state === 'active7' && specialIdx < SPECIALS.length) {
			special = SPECIALS[specialIdx];
			specialIdx += 1;
		}
		const handle = special?.handle ?? makeHandle();
		if (special?.handle !== undefined) usedHandles.add(special.handle);

		// Follow date: within the last 3 years. The account predates it.
		const followedMs = nowMs - between(1, 3 * 365) * DAY_MS;
		let createdMs = followedMs - between(10, 1800) * DAY_MS;

		follows.push({ did, rkey: rkey(i), createdAt: new Date(followedMs).toISOString() });
		// A rare duplicate follow record, like real repos sometimes have.
		if (rand() < 0.01) {
			follows.push({
				did,
				rkey: rkey(i),
				createdAt: new Date(followedMs + 2 * DAY_MS).toISOString()
			});
		}

		// Dead accounts have no profile at all; the feed result carries the status.
		if (state === 'deactivated' || state === 'gone' || state === 'takendown') {
			meta.push({ did, rate: 0 });
			feeds.set(did, { ok: false, status: state });
			continue;
		}

		const farm = rand() < 0.03;
		const spam = rand() < 0.01;
		let followsYou: boolean | null = rand() < 0.35;

		let items: FeedItemLite[];
		let exhausted = true;
		let postsCount = 0;
		let rate = 0;
		let lastMs: number;
		if (state === 'never') {
			items = [];
		} else {
			switch (state) {
				case 'quiet':
					rate = between(0.01, 0.3);
					lastMs = nowMs - between(91, 600) * DAY_MS;
					// A quiet account must be old enough to have gone quiet.
					createdMs = Math.min(createdMs, lastMs - 30 * DAY_MS);
					break;
				case 'active30':
					rate = activeOtherPool[aOther++];
					lastMs = nowMs - between(8, 29) * DAY_MS;
					break;
				case 'active90':
					rate = activeOtherPool[aOther++];
					lastMs = nowMs - between(31, 89) * DAY_MS;
					break;
				default: // active7
					rate = special !== undefined ? special.rate : active7Pool[a7++];
					// A firehose's 30-item sample only resolves its rate when
					// the newest post is hours old, not days.
					lastMs = rate >= 50 ? nowMs - between(0, 6) * HOUR_MS : nowMs - between(0.5, 7) * DAY_MS;
					break;
			}
			({ items, exhausted } = makeFeed(rand, did, createdMs, lastMs, rate));
			const ageAtLastMs = state === 'quiet' ? lastMs - createdMs : nowMs - createdMs;
			postsCount = Math.max(1, Math.round((rate * ageAtLastMs) / DAY_MS));
		}
		feeds.set(did, { ok: true, items, exhausted });
		meta.push({ did, rate });

		// The signed-in read's view of the follow: most are plain, a few are
		// hidden by a moderation list or block you. While a block applies,
		// follow-back is unknown, like in the live read.
		const viewer: ProfileViewer = {
			mutedByList: null,
			blockingByList: null,
			blockedBy: false,
			blockingPersonally: false,
			knownFollowers: Math.round(viewerRand() * 40)
		};
		if (mutedLeft > 0) {
			viewer.mutedByList = sportsSpoilers;
			mutedLeft -= 1;
		} else if (listBlockedLeft > 0) {
			viewer.blockingByList = replyGuys;
			listBlockedLeft -= 1;
		} else if (blocksYouLeft > 0) {
			viewer.blockedBy = true;
			followsYou = null;
			blocksYouLeft -= 1;
		}
		// About 10% of the follows are followed by no one you follow.
		if (viewerRand() < 0.1) viewer.knownFollowers = 0;

		profiles.push({
			did,
			handle,
			displayName: special?.name ?? makeName(handle),
			avatar: null,
			description: null,
			createdAt: new Date(createdMs).toISOString(),
			followersCount: farm ? Math.round(between(10, 499)) : Math.round(between(10, 5000) * rand()),
			followsCount: farm ? Math.round(between(5000, 9000)) : Math.round(between(50, 2000)),
			postsCount,
			followsYou,
			viewer,
			labels: spam ? ['spam'] : []
		});
	}

	// The "unfollowed elsewhere" seed: five accounts the
	// seeded previous snapshot followed but this scan does not. Four still
	// have profiles, so the sheet can show their names; the fifth has none,
	// so its row reads "No longer available".
	const droppedElsewhere: string[] = [];
	for (let i = 0; i < 4; i += 1) {
		const did = `did:plc:${didPart()}`;
		droppedElsewhere.push(did);
		const handle = makeHandle();
		const createdMs = nowMs - between(100, 1500) * DAY_MS;
		profiles.push({
			did,
			handle,
			displayName: makeName(handle),
			avatar: null,
			description: null,
			createdAt: new Date(createdMs).toISOString(),
			followersCount: Math.round(between(10, 5000) * rand()),
			followsCount: Math.round(between(50, 2000)),
			postsCount: Math.round(between(1, 900)),
			followsYou: rand() < 0.5,
			viewer: null,
			labels: []
		});
	}
	// The fifth is gone: no profile at all.
	droppedElsewhere.push(`did:plc:${didPart()}`);

	const me: ProfileLite = {
		did: ME_DID,
		handle: 'demo.bsky.social',
		displayName: 'Demo Person',
		avatar: null,
		description: 'A made-up account for trying TidySky.',
		createdAt: new Date(nowMs - 4 * 365 * DAY_MS).toISOString(),
		followersCount: 1200,
		followsCount: count,
		postsCount: 2400,
		followsYou: null,
		viewer: null,
		labels: []
	};

	// The own feed and follower sample. Separate PRNG streams, so the
	// main stream above, and the ratios the tests pin, never moves.
	const meRand = mulberry32(seed * 7919 + 13);
	const meFeed: OwnFeedItem[] = [];
	const meRate = 3; // items/day over a ~110-day window
	{
		let atMs = nowMs - HOUR_MS * (0.5 + meRand());
		while (meFeed.length < CONFIG.youFeedSample) {
			atMs -= (DAY_MS / meRate) * (0.4 + meRand() * 1.2);
			if (atMs < nowMs - 110 * DAY_MS) break;
			meFeed.push(makeOwnItem(meRand, atMs));
		}
		// One long original post, so the "your top posts" card shows the
		// ellipsis cut on a real-looking post (deterministic: the first text
		// post). The like count is above the skewed sample max, so it is the
		// top post.
		const long = meFeed.find((i) => i.kind === 'post' && i.embed === 'text');
		if (long !== undefined) {
			long.text =
				'A long demo post so the top-post list shows the ellipsis cut: the whole sentence keeps going and going until it is well past the one hundred twenty character limit used by the insights card.';
			long.likeCount = 400;
		}
	}

	const fr = mulberry32(seed * 104729 + 7);
	const meFollowers: ProfileLite[] = [];
	{
		const usedHandles = new Set<string>();
		for (let i = 0; i < CONFIG.youFollowersSample; i += 1) {
			let handle: string;
			for (;;) {
				const h = `${WORDS_A[Math.floor(fr() * WORDS_A.length)]}-${
					WORDS_B[Math.floor(fr() * WORDS_B.length)]
				}.bsky.social`;
				if (!usedHandles.has(h)) {
					usedHandles.add(h);
					handle = h;
					break;
				}
			}
			const bare = handle.replace(/\.bsky\.social$/, '');
			const [a, b] = bare.split('-');
			let didPart = '';
			for (let k = 0; k < 27; k += 1)
				didPart += DID_ALPHABET[Math.floor(fr() * DID_ALPHABET.length)];
			const roll = fr();
			let postsCount: number;
			let followsCount: number;
			let followersCount: number;
			let labels: string[];
			if (roll < 0.12) {
				postsCount = 0;
				followsCount = Math.round(50 + fr() * 500);
				followersCount = Math.round(fr() * 200);
				labels = [];
			} else if (roll < 0.2) {
				// Follow-farm look: over 5,000 follows, at most ~400 followers.
				postsCount = Math.round(50 + fr() * 2000);
				followsCount = Math.round(5000 + fr() * 4000);
				followersCount = Math.round(fr() * 400);
				labels = [];
			} else if (roll < 0.25) {
				postsCount = Math.round(10 + fr() * 3000);
				followsCount = Math.round(50 + fr() * 1500);
				followersCount = Math.round(fr() * 3000);
				labels = [fr() < 0.5 ? 'spam' : 'impersonation'];
			} else {
				postsCount = Math.round(1 + fr() * 5000);
				followsCount = Math.round(50 + fr() * 1900);
				followersCount = Math.round(fr() * 4000);
				labels = [];
			}
			meFollowers.push({
				did: `did:plc:${didPart}`,
				handle,
				displayName: `${a[0].toUpperCase()}${a.slice(1)} ${b[0].toUpperCase()}${b.slice(1)}`,
				avatar: null,
				description: null,
				createdAt: new Date(nowMs - (1 + fr() * 3000) * DAY_MS).toISOString(),
				followersCount,
				followsCount,
				postsCount,
				followsYou: true,
				viewer: null,
				labels
			});
		}
	}

	// The demo's own likes, reposts and posts, so "last interaction" has
	// real data. Separate PRNG stream, so the ratios above never move. Target
	// mix of the `count` accounts: ~25% interacted in the last 30 days, ~15%
	// in 31 to 90 days, ~15% in 91 days to 12 months, ~45% none. Weighted
	// toward accounts that post more, but the five heaviest posters are
	// reserved as "none", so the "Active, but no interaction" preset has
	// results.
	const ownRecords: Record<OwnCollection, OwnRecord[]> = {
		'app.bsky.feed.like': [],
		'app.bsky.feed.repost': [],
		'app.bsky.feed.post': []
	};
	{
		const r = mulberry32(seed * 6151 + 29);
		const reserve = new Set(
			[...meta]
				.sort((a, b) => b.rate - a.rate)
				.slice(0, 5)
				.map((m) => m.did)
		);
		// Exponential (Gumbel) top-k: weighted sampling without replacement.
		const cands = meta
			.filter((m) => !reserve.has(m.did))
			.map((m) => ({ did: m.did, key: -Math.log(1 - r()) / (0.02 + m.rate) }));
		cands.sort((a, b) => a.key - b.key);
		const n30 = Math.round(0.25 * count);
		const n31 = Math.round(0.15 * count);
		const n91 = Math.round(0.15 * count);
		const s30 = cands.slice(0, n30).map((c) => c.did);
		const s31 = cands.slice(n30, n30 + n31).map((c) => c.did);
		const s91 = cands.slice(n30 + n31, n30 + n31 + n91).map((c) => c.did);

		let n = 0;
		const at = (daysAgo: number): string => new Date(nowMs - daysAgo * DAY_MS).toISOString();
		const postUri = (did: string): string => `at://${did}/app.bsky.feed.post/r${(n += 1)}`;
		const ownUri = (collection: OwnCollection): string =>
			`at://${ME_DID}/${collection}/r${(n += 1)}`;
		const likeRec = (did: string, daysAgo: number): void => {
			ownRecords['app.bsky.feed.like'].push({
				uri: ownUri('app.bsky.feed.like'),
				value: {
					$type: 'app.bsky.feed.like',
					subject: { uri: postUri(did), cid: 'c' },
					createdAt: at(daysAgo)
				}
			});
		};
		const repostRec = (did: string, daysAgo: number): void => {
			ownRecords['app.bsky.feed.repost'].push({
				uri: ownUri('app.bsky.feed.repost'),
				value: {
					$type: 'app.bsky.feed.repost',
					subject: { uri: postUri(did), cid: 'c' },
					createdAt: at(daysAgo)
				}
			});
		};
		const replyRec = (did: string, daysAgo: number): void => {
			ownRecords['app.bsky.feed.post'].push({
				uri: ownUri('app.bsky.feed.post'),
				value: {
					$type: 'app.bsky.feed.post',
					text: 'thanks for this',
					reply: {
						root: { uri: postUri(did), cid: 'c' },
						parent: { uri: postUri(did), cid: 'c' }
					},
					createdAt: at(daysAgo)
				}
			});
		};
		const quoteRec = (did: string, daysAgo: number, withMedia: boolean): void => {
			ownRecords['app.bsky.feed.post'].push({
				uri: ownUri('app.bsky.feed.post'),
				value: {
					$type: 'app.bsky.feed.post',
					text: 'worth a look',
					embed: withMedia
						? {
								$type: 'app.bsky.embed.recordWithMedia',
								record: {
									$type: 'app.bsky.embed.record',
									record: { uri: postUri(did), cid: 'c' }
								},
								images: [{ $type: 'app.bsky.embed.images#image', alt: '' }]
							}
						: {
								$type: 'app.bsky.embed.record',
								record: { uri: postUri(did), cid: 'c' }
							},
					createdAt: at(daysAgo)
				}
			});
		};
		/** One post that mentions every did in the list, in order. */
		const mentionRec = (dids: string[], daysAgo: number): void => {
			let index = 0;
			const facets = dids.map((did) => {
				const len = did.length;
				const facet = {
					index,
					length: len,
					features: [{ $type: 'app.bsky.richtext.facet#mention', did }]
				};
				index += len + 1;
				return facet;
			});
			ownRecords['app.bsky.feed.post'].push({
				uri: ownUri('app.bsky.feed.post'),
				value: {
					$type: 'app.bsky.feed.post',
					text: dids.join(' '),
					facets,
					createdAt: at(daysAgo)
				}
			});
		};
		const emit = (did: string, daysAgo: number): void => {
			const roll = r();
			if (roll < 0.6) likeRec(did, daysAgo);
			else if (roll < 0.8) repostRec(did, daysAgo);
			else if (roll < 0.86) replyRec(did, daysAgo);
			else if (roll < 0.92) quoteRec(did, daysAgo, false);
			else if (roll < 0.95) quoteRec(did, daysAgo, true);
			else mentionRec([did], daysAgo);
		};
		/** The same mix, heavier toward likes, for the extra records. */
		const emitExtra = (did: string, daysAgo: number): void => {
			const roll = r();
			if (roll < 0.7) likeRec(did, daysAgo);
			else if (roll < 0.8) repostRec(did, daysAgo);
			else if (roll < 0.86) replyRec(did, daysAgo);
			else if (roll < 0.91) quoteRec(did, daysAgo, false);
			else if (roll < 0.94) quoteRec(did, daysAgo, true);
			else mentionRec([did], daysAgo);
		};

		// One forced record of each required shape, on the first s30 accounts:
		// a reply, a quote, a quote with media, and one post with two mentions.
		// firstDays keeps each account's newest record, so the extra records
		// below can only be older.
		const firstDays = new Map<string, number>();
		s30.forEach((did, i) => {
			const daysAgo = 0.5 + r() * 29.4; // 0.5 to 29.9 days
			firstDays.set(did, daysAgo);
			if (i === 0) replyRec(did, daysAgo);
			else if (i === 1) quoteRec(did, daysAgo, false);
			else if (i === 2) quoteRec(did, daysAgo, true);
			else if (i === 3) mentionRec([did, s30[4]], daysAgo);
			else emit(did, daysAgo);
		});
		s31.forEach((did) => {
			const daysAgo = 30.1 + r() * 59.8; // 30.1 to 89.9 days
			firstDays.set(did, daysAgo);
			emit(did, daysAgo);
		});
		s91.forEach((did) => {
			const daysAgo = 90.1 + r() * 274.8; // 90.1 to 364.9 days
			firstDays.set(did, daysAgo);
			emit(did, daysAgo);
		});

		// A long tail of interaction counts: one record per account made every
		// count 1. The list is still in Gumbel order (heaviest posters first),
		// so the head gets the heavy counts: a handful 30 to 80, a smaller
		// group 5 to 20, most 1 to 3. The extra records are strictly older
		// than the account's newest one and stay in the window, so the
		// "how often you interact" mix is unchanged.
		const interacted = [...s30, ...s31, ...s91];
		interacted.forEach((did, i) => {
			const target =
				i < 5
					? 30 + Math.floor(r() * 51)
					: i < 50
						? 5 + Math.floor(r() * 16)
						: 1 + Math.floor(r() * 3);
			const first = firstDays.get(did) ?? 364;
			for (let k = 1; k < target; k += 1) emitExtra(did, first + r() * (364.9 - first));
		});
	}
	// The reader pages newest first, like the real API does.
	for (const recs of Object.values(ownRecords)) {
		recs.sort(
			(a, b) =>
				Date.parse(b.value['createdAt'] as string) - Date.parse(a.value['createdAt'] as string)
		);
	}

	return {
		me,
		follows,
		profiles,
		feeds,
		meFeed,
		meFollowers,
		ownRecords,
		droppedElsewhere,
		rateByDid: new Map(meta.map((m) => [m.did, m.rate]))
	};
}

/**
 * The seeded "previous scan" for the demo: the same
 * accounts as the scan just finished, one day earlier, with three believable
 * differences. The first two active accounts were not followed yet (new
 * follows), the first quiet account still posted a month ago (went quiet),
 * and the `dropped` DIDs were followed but are not anymore (unfollowed
 * outside TidySky). Everything else matches the current snapshot exactly,
 * so the diff shows only those changes.
 */
export function demoPreviousSnapshot(
	accounts: FollowAccount[],
	dropped: string[],
	now: Date
): Snapshot {
	const prevNow = new Date(now.getTime() - DAY_MS);
	let newFollows = 0;
	let wentQuiet = false;
	const adjusted: FollowAccount[] = [];
	for (const a of accounts) {
		if (a.status === 'active' && newFollows < 2) {
			newFollows += 1;
			continue; // not followed yet, a day earlier
		}
		if (
			!wentQuiet &&
			isQuiet90(a, now) &&
			a.activity !== null &&
			a.activity.lastActiveAt !== null
		) {
			wentQuiet = true;
			// Still posted a month ago: not quiet yet, a day later it is.
			const last = new Date(now.getTime() - 30 * DAY_MS).toISOString();
			adjusted.push({ ...a, activity: { ...a.activity, lastActiveAt: last, lastPostAt: last } });
			continue;
		}
		adjusted.push(a);
	}
	const snap = makeSnapshot(adjusted, prevNow);
	for (const did of dropped) {
		snap.statuses[did] = { status: 'active', quiet90: false, followsYou: false };
	}
	snap.totals.follows += dropped.length;
	snap.totals.active30 += dropped.length;
	return snap;
}

/** Walk backwards from the newest item, one gap at a time, until `max` items. */
function makeFeed(
	rand: () => number,
	did: string,
	createdMs: number,
	lastMs: number,
	ratePerDay: number
): { items: FeedItemLite[]; exhausted: boolean } {
	const floor = createdMs + HOUR_MS;
	const items: FeedItemLite[] = [];
	let atMs = lastMs;
	let exhausted = false;
	while (items.length < CONFIG.activitySample) {
		if (atMs < floor) {
			// Walked all the way back to the account's first post.
			exhausted = true;
			break;
		}
		items.push(makeItem(rand, did, atMs));
		atMs -= (DAY_MS / ratePerDay) * (0.4 + rand() * 1.2);
	}
	return { items, exhausted };
}

const POST_WORDS = [...WORDS_A, ...WORDS_B];

/** Scene phrases for the demo's image and video alt text. */
const ALT_PHRASES = [
	'the harbor at dusk',
	'the forest trail after rain',
	'our town square in spring',
	'the coastline from the cliffs',
	'the garden in October',
	'market street on a Saturday',
	'the mountain path at sunrise',
	'the lake at dawn',
	'the old lighthouse',
	'the city skyline at night'
];

/** One item of the demo account's own feed, with engagement counts. */
function makeOwnItem(r: () => number, atMs: number): OwnFeedItem {
	const kr = r();
	const kind: OwnFeedItem['kind'] =
		kr < 0.5 ? 'post' : kr < 0.8 ? 'reply' : kr < 0.88 ? 'quote' : 'repost';
	const er = r();
	const embed: OwnFeedItem['embed'] =
		er < 0.5 ? 'text' : er < 0.75 ? 'image' : er < 0.85 ? 'video' : 'link';
	const words: string[] = [];
	for (let i = 0; i < 4 + Math.floor(r() * 12); i += 1)
		words.push(POST_WORDS[Math.floor(r() * POST_WORDS.length)]);
	// Most image and video posts have alt text on the first item, some don't:
	// both the alt line and the "Image post"-style label show in the demo.
	let alt: string | undefined;
	if ((embed === 'image' || embed === 'video') && r() < 0.75)
		alt = `${embed === 'image' ? 'A photo of' : 'A video of'} ${
			ALT_PHRASES[Math.floor(r() * ALT_PHRASES.length)]
		}.`;
	// Skewed: most posts get few likes, a few get a few hundred.
	const likes = Math.floor(Math.pow(r(), 3) * 400);
	return {
		uri: `at://${ME_DID}/app.bsky.feed.post/${Math.floor(r() * 2 ** 53).toString(36)}`,
		author: ME_DID,
		kind,
		at: new Date(atMs).toISOString(),
		embed,
		text: words.join(' '),
		alt,
		likeCount: likes,
		repostCount: Math.floor(likes * 0.08 * r()),
		replyCount: Math.floor(likes * 0.15 * r()) + (kind === 'repost' ? 0 : Math.floor(r() * 5)),
		quoteCount: Math.floor(likes * 0.02 * r())
	};
}

function makeItem(rand: () => number, did: string, atMs: number): FeedItemLite {
	const kr = rand();
	const kind: FeedItemLite['kind'] =
		kr < 0.45 ? 'post' : kr < 0.75 ? 'reply' : kr < 0.85 ? 'quote' : 'repost';
	const er = rand();
	const embed: FeedItemLite['embed'] =
		er < (kind === 'repost' ? 0.55 : 0.5)
			? 'text'
			: er < (kind === 'repost' ? 0.8 : 0.8)
				? 'image'
				: er < (kind === 'repost' ? 0.9 : 0.88)
					? 'video'
					: 'link';
	const lr = rand();
	const lang =
		lr < 0.75 ? 'en' : lr < 0.85 ? null : OTHER_LANGS[Math.floor(rand() * OTHER_LANGS.length)];
	const words = kind === 'repost' ? 0 : 4 + Math.floor(rand() * 100);
	const uri = `at://${did}/app.bsky.feed.post/${Math.floor(rand() * 2 ** 53).toString(36)}`;
	return { uri, kind, at: new Date(atMs).toISOString(), embed, lang, words };
}

/**
 * Serves generated data through the DataSource interface, with a small fake
 * delay and the same concurrency cap as the public queue, so the scan
 * progress UI is visible instead of flashing by.
 */
export class DemoSource implements DataSource {
	readonly did = ME_DID;
	private data: DemoData;
	private running = 0;
	private waiters: Array<() => void> = [];

	constructor(seed = 42, count = 850, nowMs = Date.now()) {
		this.data = generateDemoData(seed, count, nowMs);
	}

	/** The DIDs unfollowed elsewhere, for the seeded previous snapshot. */
	get droppedElsewhere(): string[] {
		return this.data.droppedElsewhere;
	}

	private slot(): Promise<void> {
		if (this.running < CONFIG.publicConcurrency) {
			this.running += 1;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) =>
			this.waiters.push(() => {
				this.running += 1;
				resolve();
			})
		);
	}

	private release(): void {
		this.running -= 1;
		const next = this.waiters.shift();
		if (next) next();
	}

	private async call<T>(signal: AbortSignal | undefined, task: () => T): Promise<T> {
		await this.slot();
		try {
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 10));
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			return task();
		} finally {
			this.release();
		}
	}

	async listFollowRecords(
		cursor: string | undefined,
		signal?: AbortSignal
	): Promise<{ records: FollowRecord[]; cursor: string | undefined }> {
		return this.call(signal, () => {
			const start = cursor === undefined ? 0 : Number(cursor);
			const records = this.data.follows.slice(start, start + PAGE);
			const next = start + PAGE < this.data.follows.length ? String(start + PAGE) : undefined;
			return { records, cursor: next };
		});
	}

	async getProfiles(dids: string[], signal?: AbortSignal): Promise<ProfileLite[]> {
		return this.call(signal, () => {
			const wanted = new Set(dids);
			return this.data.profiles.filter((p) => wanted.has(p.did));
		});
	}

	async getAuthorFeed(
		did: string,
		_limit: number,
		signal?: AbortSignal
	): Promise<AuthorFeedResult> {
		return this.call(signal, () => {
			const result = this.data.feeds.get(did);
			return result ?? { ok: false, status: 'gone' };
		});
	}

	// The demo's lists live in the module-level demoListItems, written by
	// the DemoWriter: the demo has no repo, so the "server" is that map.
	async listListItems(
		cursor: string | undefined,
		signal?: AbortSignal
	): Promise<{ records: ListItemRecord[]; cursor: string | undefined }> {
		return this.call(signal, () => {
			const start = cursor === undefined ? 0 : Number(cursor);
			const records = [...demoListItems.values()].slice(start, start + PAGE);
			const next = start + PAGE < demoListItems.size ? String(start + PAGE) : undefined;
			return { records, cursor: next };
		});
	}

	async listOwnRecords(
		collection: OwnCollection,
		cursor: string | undefined,
		signal?: AbortSignal,
		reverse = false
	): Promise<{ records: OwnRecord[]; cursor: string | undefined }> {
		return this.call(signal, () => {
			const all = this.data.ownRecords[collection];
			const ordered = reverse ? [...all].reverse() : all;
			const start = cursor === undefined ? 0 : Number(cursor);
			const records = ordered.slice(start, start + PAGE);
			const next = start + PAGE < ordered.length ? String(start + PAGE) : undefined;
			return { records, cursor: next };
		});
	}

	async getOwnProfile(signal?: AbortSignal): Promise<ProfileLite> {
		return this.call(signal, () => this.data.me);
	}

	async getOwnFeed(maxItems: number, signal?: AbortSignal): Promise<OwnFeedItem[]> {
		return this.call(signal, () => this.data.meFeed.slice(0, maxItems));
	}

	async getFollowersSample(max: number, signal?: AbortSignal): Promise<FollowersSample> {
		// The demo "server" has exactly its seeded followers: the sample is
		// complete whenever it holds them all, even though the demo profile's
		// follower count is higher, like a real account with hidden ones.
		return this.call(signal, () => ({
			profiles: this.data.meFollowers.slice(0, max),
			complete: this.data.meFollowers.length <= max
		}));
	}
}

/**
 * The demo's stand-in for the account's repo: the listitem records the
 * DemoWriter has written, so DemoSource.listListItems can report what the
 * demo's lists actually contain. Module-level, because DemoWriter instances
 * are short-lived (currentWriter makes a new one per call) while the demo
 * "server" outlives any single call.
 */
const demoListItems = new Map<string, ListItemRecord>();

function demoListUri(listRkey: string): string {
	return `at://${ME_DID}/app.bsky.graph.list/${listRkey}`;
}

/** Drop every item that belongs to the deleted list. */
function dropDemoList(listRkey: string): void {
	const uri = demoListUri(listRkey);
	for (const [rkey, item] of demoListItems) {
		if (item.list === uri) demoListItems.delete(rkey);
	}
}

/**
 * The demo stand-in for the live Writer: the same shape, a small delay, and
 * it never touches a real account. List and listitem writes update
 * demoListItems, so the demo behaves like a real repo for lists.
 */
export class DemoWriter implements Writer {
	private counter = 0;

	private async wait(signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 10));
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	}

	async applyWrites(ops: WriteOp[], signal?: AbortSignal): Promise<void> {
		await this.wait(signal);
		for (const op of ops) {
			if (op.$type === 'com.atproto.repo.applyWrites#create') {
				if (op.collection !== 'app.bsky.graph.listitem') continue;
				const subject = op.value['subject'];
				const list = op.value['list'];
				if (typeof subject === 'string' && typeof list === 'string') {
					this.counter += 1;
					const rkey = `i${this.counter.toString(36)}`;
					demoListItems.set(rkey, { rkey, subject, list });
				}
			} else if (op.collection === 'app.bsky.graph.listitem') {
				demoListItems.delete(op.rkey);
			} else if (op.collection === 'app.bsky.graph.list') {
				dropDemoList(op.rkey);
			}
		}
	}
	async deleteRecord(collection: string, rkey: string, signal?: AbortSignal): Promise<void> {
		await this.wait(signal);
		if (collection === 'app.bsky.graph.listitem') demoListItems.delete(rkey);
		else if (collection === 'app.bsky.graph.list') dropDemoList(rkey);
	}
	async createRecord(
		collection: string,
		value: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<{ uri: string }> {
		await this.wait(signal);
		this.counter += 1;
		const rkey = `${this.counter.toString(36)}demo`;
		if (collection === 'app.bsky.graph.listitem') {
			const subject = value['subject'];
			const list = value['list'];
			if (typeof subject === 'string' && typeof list === 'string') {
				demoListItems.set(rkey, { rkey, subject, list });
			}
		}
		return { uri: `at://${ME_DID}/${collection}/${rkey}` };
	}
	async muteActor(_did: string, signal?: AbortSignal): Promise<void> {
		await this.wait(signal);
	}
	async unmuteActor(_did: string, signal?: AbortSignal): Promise<void> {
		await this.wait(signal);
	}
}
