import { describe, expect, it } from 'vitest';

import { isScanStale } from './stale';

const NOW = new Date('2026-11-09T12:00:00.000Z');

describe('isScanStale', () => {
	it('is stale when the scan never finished', () => {
		expect(isScanStale(null, NOW, 24)).toBe(true);
	});

	it('is fresh just inside the limit and stale just past it', () => {
		expect(isScanStale('2026-11-08T13:00:00.000Z', NOW, 24)).toBe(false); // 23 h
		expect(isScanStale('2026-11-07T11:00:00.000Z', NOW, 24)).toBe(true); // 25 h
	});

	it('is stale for an unparseable timestamp', () => {
		expect(isScanStale('not a date', NOW, 24)).toBe(true);
	});
});
