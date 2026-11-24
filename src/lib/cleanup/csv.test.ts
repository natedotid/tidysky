import { describe, expect, it } from 'vitest';

import type { FilterSpec } from '#lib/filters/filters';
import type { ActivitySummary, FollowAccount } from '#lib/scan/types';

import { CSV_HEADER, csvFilename, toCsv } from './csv';

const NOW = new Date('2026-11-02T12:00:00Z');
const EMPTY_SPEC: FilterSpec = { clauses: [] };

function activity(over: Partial<ActivitySummary> = {}): ActivitySummary {
	return {
		sampleSize: 10,
		exhausted: false,
		lastActiveAt: '2026-10-01T00:00:00Z',
		lastPostAt: '2026-09-25T00:00:00Z',
		itemsPerDay: 1,
		share: { post: 1, reply: 0, quote: 0, repost: 0 },
		media: { text: 10, image: 0, video: 0, link: 0, quote: 0 },
		weekdayHour: Array.from({ length: 7 }, () => Array<number>(24).fill(0)),
		topLangs: [['en', 1]],
		medianWords: 20,
		...over
	};
}

function account(over: Partial<FollowAccount> = {}): FollowAccount {
	return {
		did: 'did:plc:abc123',
		handle: 'test.bsky.social',
		displayName: 'Test',
		avatar: null,
		description: null,
		followRkeys: ['rkey1'],
		followedAt: '2025-01-01T00:00:00Z',
		createdAt: null,
		followersCount: 10,
		followsCount: 20,
		postsCount: 30,
		followsYou: null,
		labels: [],
		status: 'active',
		activity: null,
		profileScannedAt: null,
		activityScannedAt: null,
		interaction: null,
		...over
	};
}

describe('toCsv', () => {
	it('emits the exact header row', () => {
		expect(toCsv([], EMPTY_SPEC, NOW)).toBe(
			'did,handle,display_name,status,last_active,items_per_day,follows_you,followed_at,followers,follows,posts,last_interaction_at,last_interaction_kind,interaction_count,reasons'
		);
		expect(CSV_HEADER).toBe(toCsv([], EMPTY_SPEC, NOW));
	});

	it('maps a plain account to one row', () => {
		const [header, row] = toCsv([account()], EMPTY_SPEC, NOW).split('\n');
		expect(header).toBe(CSV_HEADER);
		// activity null → last_active, items_per_day empty; followsYou null → empty;
		// interaction null (unchecked) → both interaction cells and the count empty;
		// empty spec → reasons empty (trailing comma).
		expect(row).toBe(
			'did:plc:abc123,test.bsky.social,Test,active,,,,2025-01-01T00:00:00Z,10,20,30,,,,'
		);
	});

	it('fills the interaction cells when the account was checked', () => {
		const row = toCsv(
			[
				account({
					interaction: {
						lastAt: '2026-08-01T10:00:00Z',
						lastKind: 'reply',
						lastByKind: {
							like: null,
							repost: null,
							reply: '2026-08-01T10:00:00Z',
							quote: null,
							mention: null
						},
						countsByKind: { like: 0, repost: 0, reply: 1, quote: 0, mention: 0 }
					}
				})
			],
			EMPTY_SPEC,
			NOW
		)
			.split('\n')[1]
			.split(',');
		expect(row[11]).toBe('2026-08-01T10:00:00Z');
		expect(row[12]).toBe('reply');
		expect(row[13]).toBe('1');
	});

	it('leaves the interaction cells empty when checked but none was found', () => {
		const row = toCsv(
			[
				account({
					interaction: {
						lastAt: null,
						lastKind: null,
						lastByKind: { like: null, repost: null, reply: null, quote: null, mention: null },
						countsByKind: { like: 0, repost: 0, reply: 0, quote: 0, mention: 0 }
					}
				})
			],
			EMPTY_SPEC,
			NOW
		)
			.split('\n')[1]
			.split(',');
		expect(row[11]).toBe('');
		expect(row[12]).toBe('');
		// Checked with zero interactions: the count is 0, not empty (empty is
		// reserved for unchecked accounts).
		expect(row[13]).toBe('0');
	});

	it('leaves unknown cells empty', () => {
		const row = toCsv([account()], EMPTY_SPEC, NOW).split('\n')[1].split(',');
		// last_active, items_per_day, follows_you
		expect(row[4]).toBe('');
		expect(row[5]).toBe('');
		expect(row[6]).toBe('');
	});

	it('maps follows_you to yes/no', () => {
		expect(
			toCsv([account({ followsYou: true })], EMPTY_SPEC, NOW)
				.split('\n')[1]
				.split(',')[6]
		).toBe('yes');
		expect(
			toCsv([account({ followsYou: false })], EMPTY_SPEC, NOW)
				.split('\n')[1]
				.split(',')[6]
		).toBe('no');
	});

	it('rounds items_per_day to two decimals and fills activity cells', () => {
		const row = toCsv(
			[
				account({
					activity: activity({ itemsPerDay: 0.234, lastActiveAt: '2026-10-20T00:00:00Z' })
				})
			],
			EMPTY_SPEC,
			NOW
		)
			.split('\n')[1]
			.split(',');
		expect(row[4]).toBe('2026-10-20T00:00:00Z');
		expect(row[5]).toBe('0.23');
	});

	it('quotes values containing a comma', () => {
		// A quoted comma must survive a round trip through the column split,
		// so assert on the raw row rather than splitting it naively.
		const row = toCsv([account({ displayName: 'A, B' })], EMPTY_SPEC, NOW).split('\n')[1];
		expect(row).toBe(
			'did:plc:abc123,test.bsky.social,"A, B",active,,,,2025-01-01T00:00:00Z,10,20,30,,,,'
		);
	});

	it('doubles quotes inside quoted values', () => {
		const row = toCsv([account({ displayName: 'Says "hi"' })], EMPTY_SPEC, NOW)
			.split('\n')[1]
			.split(',');
		expect(row[2]).toBe('"Says ""hi"""');
	});

	it('keeps a newline inside one quoted cell', () => {
		const csv = toCsv([account({ displayName: 'Line1\nLine2' })], EMPTY_SPEC, NOW);
		// Two logical lines (header + one row), the row spans two physical lines.
		expect(csv.split('\n')).toHaveLength(3);
		expect(csv).toContain('"Line1\nLine2"');
	});

	it('prefixes formula-like values with an apostrophe', () => {
		for (const [name, cellText] of [
			['=SUM(A1:B2)', "'=SUM(A1:B2)"],
			['+cmd', "'+cmd"],
			['-note', "'-note"],
			['@evil', "'@evil"]
		] as const) {
			const row = toCsv([account({ displayName: name })], EMPTY_SPEC, NOW)
				.split('\n')[1]
				.split(',');
			expect(row[2], name).toBe(cellText);
		}
	});

	it('applies the prefix before quoting', () => {
		const row = toCsv([account({ displayName: '=HYPERLINK("x")' })], EMPTY_SPEC, NOW)
			.split('\n')[1]
			.split(',');
		expect(row[2]).toBe(`"'=HYPERLINK(""x"")"`);
	});

	it('lists the reasons the account matched', () => {
		const spec: FilterSpec = { clauses: [{ kind: 'neverPosted' }] };
		// "Never posted" now needs an empty activity sample, not just zero posts.
		const row = toCsv(
			[account({ postsCount: 0, activity: activity({ sampleSize: 0, exhausted: true }) })],
			spec,
			NOW
		)
			.split('\n')[1]
			.split(',');
		expect(row[14]).toBe('Never posted');
	});

	it('writes one line per account', () => {
		const csv = toCsv(
			[account(), account({ did: 'did:plc:x' }), account({ did: 'did:plc:y' })],
			EMPTY_SPEC,
			NOW
		);
		expect(csv.split('\n')).toHaveLength(4);
	});
});

describe('csvFilename', () => {
	// Built in local time so the expectation holds in any runner timezone.
	it('uses the local date', () => {
		expect(csvFilename(new Date(2026, 10, 2, 12, 0, 0))).toBe('tidysky-2026-11-02.csv');
		expect(csvFilename(new Date(2026, 0, 5, 12, 0, 0))).toBe('tidysky-2026-01-05.csv');
	});
});
