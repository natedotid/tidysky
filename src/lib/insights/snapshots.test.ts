import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { deleteDatabase, openStore } from '#lib/db/store';
import type { AccountStatus, FollowAccount, Snapshot } from '#lib/scan/types';

import {
	diffSnapshots,
	isQuiet90,
	makeSnapshot,
	SINCE_CLAUSE_LABELS,
	SINCE_KEYS,
	sinceChips,
	type SnapshotDiff
} from './snapshots';

const NOW = new Date(2026, 10, 6); // 6 Nov 2026, local
const DAY = 86_400_000;

function account(did: string, over: Partial<FollowAccount> = {}): FollowAccount {
	return {
		did,
		handle: did.slice('did:plc:'.length) + '.bsky.social',
		displayName: null,
		avatar: null,
		description: null,
		followRkeys: ['r1'],
		followedAt: '2026-01-01T00:00:00.000Z',
		createdAt: null,
		followersCount: null,
		followsCount: null,
		postsCount: null,
		followsYou: null,
		viewer: null,
		labels: [],
		status: 'active',
		activity: null,
		profileScannedAt: null,
		activityScannedAt: null,
		interaction: null,
		...over
	};
}

/** Activity with the newest item `days` before NOW; null days = never posted. */
function activity(days: number | null, sampleSize = 5): FollowAccount['activity'] {
	return {
		sampleSize,
		exhausted: false,
		lastActiveAt: days === null ? null : new Date(NOW.getTime() - days * DAY).toISOString(),
		lastPostAt: days === null ? null : new Date(NOW.getTime() - days * DAY).toISOString(),
		itemsPerDay: 1,
		share: { post: 1, reply: 0, quote: 0, repost: 0 },
		media: { text: sampleSize, image: 0, video: 0, link: 0, quote: 0 },
		weekdayHour: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)),
		topLangs: [],
		medianWords: 10
	};
}

function snap(at: string, rows: Array<[string, Snapshot['statuses'][string]]>): Snapshot {
	const statuses: Snapshot['statuses'] = {};
	for (const [did, row] of rows) statuses[did] = row;
	return { at, statuses, totals: { follows: 0, active30: 0, quiet90: 0, gone: 0, followsYou: 0 } };
}

const row = (
	status: AccountStatus,
	quiet90: boolean,
	followsYou: boolean | null
): Snapshot['statuses'][string] => ({
	status,
	quiet90,
	followsYou
});

describe('isQuiet90', () => {
	it('matches the quiet clause at 90 days', () => {
		expect(isQuiet90(account('a', { activity: activity(91) }), NOW)).toBe(true);
		expect(isQuiet90(account('a', { activity: activity(89) }), NOW)).toBe(false);
		// Not active is never quiet; no activity data is unknown, not quiet.
		expect(isQuiet90(account('a', { status: 'gone', activity: activity(91) }), NOW)).toBe(false);
		expect(isQuiet90(account('a', { activity: null }), NOW)).toBe(false);
		// Never posted (lastActiveAt null) counts as quiet.
		expect(isQuiet90(account('a', { activity: activity(null) }), NOW)).toBe(true);
	});
});

describe('makeSnapshot', () => {
	it('records per-DID state and the headline totals', () => {
		const s = makeSnapshot(
			[
				account('a', { activity: activity(5), followsYou: true }),
				account('b', { activity: activity(120) }),
				account('c', { status: 'deactivated', activity: null, followsYou: false }),
				account('d', { activity: null, followsYou: null })
			],
			NOW
		);
		expect(s.statuses['a']).toEqual({ status: 'active', quiet90: false, followsYou: true });
		expect(s.statuses['b']).toEqual({ status: 'active', quiet90: true, followsYou: null });
		expect(s.statuses['c']).toEqual({ status: 'deactivated', quiet90: false, followsYou: false });
		expect(s.totals).toEqual({ follows: 4, active30: 1, quiet90: 1, gone: 1, followsYou: 1 });
	});
});

describe('diffSnapshots', () => {
	const prev = snap('2026-10-06T00:00:00.000Z', [
		['a', row('active', false, true)], // → quiet
		['b', row('active', true, null)], // → back
		['c', row('active', false, null)], // → gone
		['d', row('active', false, true)], // → stopped following back
		['e', row('active', false, false)], // → started following back
		['f', row('active', false, null)], // dropped elsewhere
		['g', row('active', false, null)] // unfollowed through TidySky
	]);
	const curr = snap('2026-11-06T00:00:00.000Z', [
		['a', row('active', true, true)],
		['b', row('active', false, null)],
		['c', row('deactivated', false, null)],
		['d', row('active', false, false)],
		['e', row('active', false, true)],
		['h', row('active', false, null)] // new follow
	]);

	it('lists each category of change', () => {
		const d = diffSnapshots(prev, curr, ['g']);
		expect(d.wentQuiet).toEqual(['a']);
		expect(d.cameBack).toEqual(['b']);
		expect(d.wentGone).toEqual(['c']);
		expect(d.stoppedFollowingYou).toEqual(['d']);
		expect(d.startedFollowingYou).toEqual(['e']);
		expect(d.newFollows).toEqual(['h']);
		expect(d.droppedElsewhere).toEqual(['f']);
	});

	it('excludes DIDs unfollowed through TidySky from droppedElsewhere', () => {
		const d = diffSnapshots(prev, curr, ['f', 'g']);
		expect(d.droppedElsewhere).toEqual([]);
	});

	it('null followsYou is unknown: no started/stopped change', () => {
		const p = snap('p', [['x', row('active', false, null)]]);
		const c = snap('c', [['x', row('active', false, false)]]);
		const d = diffSnapshots(p, c);
		expect(d.stoppedFollowingYou).toEqual([]);
		expect(d.startedFollowingYou).toEqual([]);
	});

	it('every SINCE_KEY is a diff category', () => {
		const d = diffSnapshots(prev, curr);
		for (const key of SINCE_KEYS) expect(Array.isArray(d[key])).toBe(true);
	});
});

describe('sinceChips', () => {
	function emptyDiff(): SnapshotDiff {
		return {
			wentQuiet: [],
			wentGone: [],
			stoppedFollowingYou: [],
			cameBack: [],
			startedFollowingYou: [],
			newFollows: [],
			droppedElsewhere: []
		};
	}

	it('makes a link chip for every category but droppedElsewhere', () => {
		const chips = sinceChips({
			...emptyDiff(),
			wentQuiet: ['a'],
			wentGone: ['b', 'c'],
			newFollows: ['h']
		});
		expect(chips.map((c) => [c.key, c.kind, c.text])).toEqual([
			['wentQuiet', 'link', '1 went quiet'],
			['wentGone', 'link', '2 are gone'],
			['newFollows', 'link', '1 new follow']
		]);
		for (const c of chips) expect(c.ariaLabel.endsWith(' in Clean up')).toBe(true);
	});

	it('makes a sheet chip for droppedElsewhere, singular and plural', () => {
		const one = sinceChips({ ...emptyDiff(), droppedElsewhere: ['x'] });
		expect(one).toEqual([
			{
				key: 'droppedElsewhere',
				kind: 'sheet',
				text: '1 unfollowed elsewhere',
				ariaLabel: 'Show the 1 account you no longer follow'
			}
		]);
		const many = sinceChips({ ...emptyDiff(), droppedElsewhere: ['x', 'y', 'z', 'w', 'v'] });
		expect(many).toHaveLength(1);
		expect(many[0].text).toBe('5 unfollowed elsewhere');
		expect(many[0].ariaLabel).toBe('Show the 5 accounts you no longer follow');
	});

	it('has no Clean up clause label for droppedElsewhere, so applySince is a no-op', () => {
		expect(SINCE_CLAUSE_LABELS['droppedElsewhere']).toBeUndefined();
		for (const key of SINCE_KEYS)
			if (key !== 'droppedElsewhere') expect(SINCE_CLAUSE_LABELS[key]).toBeDefined();
	});
});

describe('pruneSnapshots', () => {
	it('keeps the newest N', async () => {
		const did = `did:plc:prune-${Date.now()}`;
		const store = await openStore(did);
		for (let i = 1; i <= 12; i += 1) {
			await store.addSnapshot({
				at: new Date(2026, 9, i).toISOString(),
				statuses: {},
				totals: { follows: 0, active30: 0, quiet90: 0, gone: 0, followsYou: 0 }
			});
		}
		await store.pruneSnapshots(10);
		const snaps = await store.listSnapshots();
		expect(snaps).toHaveLength(10);
		// Newest first, and the two oldest (Oct 1, 2) are gone.
		expect(snaps[0].at).toBe(new Date(2026, 9, 12).toISOString());
		expect(snaps[9].at).toBe(new Date(2026, 9, 3).toISOString());
		await deleteDatabase(did);
	});
});
