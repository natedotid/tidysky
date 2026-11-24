import { describe, expect, it } from 'vitest';

import { relativeTime } from './time';

const NOW = new Date('2026-11-02T12:00:00Z');

describe('relativeTime', () => {
	it('rounds to the nearest minute and picks the right unit', () => {
		expect(relativeTime('2026-11-02T11:59:40Z', NOW)).toBe('just now');
		expect(relativeTime('2026-11-02T11:59:00Z', NOW)).toBe('1 minute ago');
		expect(relativeTime('2026-11-02T11:55:00Z', NOW)).toBe('5 minutes ago');
	});

	it('switches to hours and days as time grows', () => {
		expect(relativeTime('2026-11-02T10:00:00Z', NOW)).toBe('2 hours ago');
		expect(relativeTime('2026-11-01T13:00:00Z', NOW)).toBe('23 hours ago');
		expect(relativeTime('2026-11-01T12:00:00Z', NOW)).toBe('yesterday');
		expect(relativeTime('2026-10-30T12:00:00Z', NOW)).toBe('3 days ago');
	});

	it('falls back to a plain date beyond a week', () => {
		// Exact format is locale-dependent; assert it is no longer relative.
		expect(relativeTime('2026-08-01T12:00:00Z', NOW)).not.toMatch(/ago|just now|yesterday/);
	});

	it('treats unparseable input as never', () => {
		expect(relativeTime('not a date', NOW)).toBe('never');
	});
});
