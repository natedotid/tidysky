import { describe, expect, it } from 'vitest';

import {
	interactionBucketPlan,
	interactionWindow,
	interactionWindowLabels
} from './interaction-window';

// Window: 1 Nov 2026 back 365 days -> 1 Nov 2025.
const SCANNED_AT = '2026-11-01T00:00:00Z';
const DAY = 86_400_000;
/** A creation date n days before the scan. */
const createdDaysAgo = (n: number): string =>
	new Date(Date.parse(SCANNED_AT) - n * DAY).toISOString();
/** The same month-year rendering the implementation uses (locale for locale). */
const monthYear = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
const my = (iso: string): string => monthYear.format(new Date(iso));

describe('interactionWindow', () => {
	it('is full with no cap and no known creation', () => {
		expect(interactionWindow(SCANNED_AT, null, null)).toEqual({ kind: 'full' });
	});

	it('stays full when the account is older than the window', () => {
		expect(interactionWindow(SCANNED_AT, null, '2024-06-01T00:00:00Z')).toEqual({ kind: 'full' });
	});

	it('is capped when the read stopped short of the window start', () => {
		expect(interactionWindow(SCANNED_AT, '2026-08-01T00:00:00Z', null)).toEqual({
			kind: 'capped',
			at: '2026-08-01T00:00:00Z'
		});
	});

	it('ignores a covered-since at or before the window start', () => {
		// Exactly the start is the uncapped boundary: the read covers the
		// whole year.
		expect(interactionWindow(SCANNED_AT, '2025-11-01T00:00:00Z', null)).toEqual({
			kind: 'full'
		});
		expect(interactionWindow(SCANNED_AT, '2024-01-01T00:00:00Z', null)).toEqual({ kind: 'full' });
	});

	it('is joined when the account is newer than the window', () => {
		expect(interactionWindow(SCANNED_AT, null, '2026-06-01T00:00:00Z')).toEqual({
			kind: 'joined',
			at: '2026-06-01T00:00:00Z'
		});
	});

	it('ignores a creation at or before the window start', () => {
		expect(interactionWindow(SCANNED_AT, null, '2025-11-01T00:00:00Z')).toEqual({ kind: 'full' });
		expect(interactionWindow(SCANNED_AT, null, '2020-01-01T00:00:00Z')).toEqual({ kind: 'full' });
	});

	it('capped and new together: the later bound wins', () => {
		// The read stopped 3 months back, the account is 5 months old: the
		// cap is the later bound.
		expect(interactionWindow(SCANNED_AT, '2026-08-01T00:00:00Z', '2026-06-01T00:00:00Z')).toEqual({
			kind: 'capped',
			at: '2026-08-01T00:00:00Z'
		});
		// The account is newer than the cap: "since you joined" wins.
		expect(interactionWindow(SCANNED_AT, '2026-03-01T00:00:00Z', '2026-06-01T00:00:00Z')).toEqual({
			kind: 'joined',
			at: '2026-06-01T00:00:00Z'
		});
		// Same date: the read covers everything since the account exists, so
		// the joined wording is the more complete statement.
		expect(interactionWindow(SCANNED_AT, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z')).toEqual({
			kind: 'joined',
			at: '2026-06-01T00:00:00Z'
		});
	});

	it('falls back to full when there is no scan, whatever else is known', () => {
		expect(interactionWindow(null, '2026-08-01T00:00:00Z', '2026-06-01T00:00:00Z')).toEqual({
			kind: 'full'
		});
	});
});

describe('interactionWindowLabels', () => {
	it('full: "in the last 12 months" and "None in 12 months"', () => {
		expect(interactionWindowLabels({ kind: 'full' })).toEqual({
			since: 'in the last 12 months',
			none: 'None in 12 months'
		});
	});

	it('joined: "since you joined in {Mon YYYY}", none drops the month', () => {
		expect(interactionWindowLabels({ kind: 'joined', at: '2026-06-01T00:00:00Z' })).toEqual({
			since: `since you joined in ${my('2026-06-01T00:00:00Z')}`,
			none: 'None since you joined'
		});
	});

	it('capped: "since {Mon YYYY}" in both phrasings', () => {
		expect(interactionWindowLabels({ kind: 'capped', at: '2026-08-01T00:00:00Z' })).toEqual({
			since: `since ${my('2026-08-01T00:00:00Z')}`,
			none: `None since ${my('2026-08-01T00:00:00Z')}`
		});
	});
});

describe('interactionBucketPlan', () => {
	it('account older than 12 months: every bucket, usual labels', () => {
		expect(interactionBucketPlan(SCANNED_AT, createdDaysAgo(700))).toEqual({
			in31To90: { hidden: false, openLabel: null },
			in91To365: { hidden: false, openLabel: null }
		});
	});

	it('creation date unknown: every bucket, usual labels', () => {
		expect(interactionBucketPlan(SCANNED_AT, null)).toEqual({
			in31To90: { hidden: false, openLabel: null },
			in91To365: { hidden: false, openLabel: null }
		});
	});

	it('no scan: every bucket, usual labels', () => {
		expect(interactionBucketPlan(null, createdDaysAgo(60))).toEqual({
			in31To90: { hidden: false, openLabel: null },
			in91To365: { hidden: false, openLabel: null }
		});
	});

	it('created 200 days ago: all buckets, the third relabeled', () => {
		expect(interactionBucketPlan(SCANNED_AT, createdDaysAgo(200))).toEqual({
			in31To90: { hidden: false, openLabel: null },
			in91To365: { hidden: false, openLabel: '91 days ago or more' }
		});
	});

	it('created 60 days ago: three buckets, the second relabeled', () => {
		expect(interactionBucketPlan(SCANNED_AT, createdDaysAgo(60))).toEqual({
			in31To90: { hidden: false, openLabel: '31 days ago or more' },
			in91To365: { hidden: true, openLabel: null }
		});
	});

	it('created 10 days ago: two buckets', () => {
		expect(interactionBucketPlan(SCANNED_AT, createdDaysAgo(10))).toEqual({
			in31To90: { hidden: true, openLabel: null },
			in91To365: { hidden: true, openLabel: null }
		});
	});
});
