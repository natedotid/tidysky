import { describe, expect, it } from 'vitest';

import { compact, plural, rate, relativeDays } from './format';

const NOW = new Date('2026-11-02T12:00:00Z');
const DAY = 86_400_000;
const iso = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

describe('relativeDays', () => {
	it('covers the unit ladder', () => {
		expect(relativeDays(iso(0), NOW)).toBe('today');
		expect(relativeDays(iso(1), NOW)).toBe('yesterday');
		expect(relativeDays(iso(12), NOW)).toBe('12d ago');
		expect(relativeDays(iso(29), NOW)).toBe('29d ago');
		expect(relativeDays(iso(150), NOW)).toBe('5mo ago');
		expect(relativeDays(iso(730), NOW)).toBe('2y ago');
	});

	it('unit boundaries', () => {
		expect(relativeDays(iso(30), NOW)).toBe('1mo ago');
		expect(relativeDays(iso(364), NOW)).toBe('12mo ago');
		expect(relativeDays(iso(365), NOW)).toBe('1y ago');
	});

	it('is "—" for null and future skew is today', () => {
		expect(relativeDays(null, NOW)).toBe('—');
		expect(relativeDays(iso(-2), NOW)).toBe('today');
	});
});

describe('rate', () => {
	it('shows a dash for null', () => {
		expect(rate(null)).toBe('—');
	});

	it('keeps zero plain and shows a positive rate below 0.05 as under 0.1', () => {
		expect(rate(0)).toBe('0/day');
		expect(rate(0.01)).toBe('<0.1/day');
		expect(rate(0.049)).toBe('<0.1/day');
		expect(rate(0.05)).toBe('0.1/day');
	});

	it('formats the expected values', () => {
		expect(rate(0.2)).toBe('0.2/day');
		expect(rate(0.5)).toBe('0.5/day');
		expect(rate(1)).toBe('1/day');
		expect(rate(3)).toBe('3/day');
		expect(rate(39.6)).toBe('40/day');
		expect(rate(40)).toBe('40+/day');
		expect(rate(45.3)).toBe('40+/day');
	});
});

describe('compact', () => {
	it('keeps small numbers plain', () => {
		expect(compact(0)).toBe('0');
		expect(compact(999)).toBe('999');
	});

	it('covers the expected values', () => {
		expect(compact(1200)).toBe('1.2k');
		expect(compact(12000)).toBe('12k');
		expect(compact(1100000)).toBe('1.1M');
	});

	it('whole values above ten drop the decimal', () => {
		expect(compact(150000)).toBe('150k');
		expect(compact(2000000)).toBe('2M');
	});
});

describe('plural', () => {
	it('uses the singular word only for one', () => {
		expect(plural(1, 'like', 'likes')).toBe('1 like');
		expect(plural(2, 'like', 'likes')).toBe('2 likes');
		expect(plural(54, 'like', 'likes')).toBe('54 likes');
	});

	it('keeps the plural word for zero', () => {
		expect(plural(0, 'day', 'days')).toBe('0 days');
	});
});
