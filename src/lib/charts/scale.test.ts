import { describe, expect, it } from 'vitest';

import { bucketIndex, bucketShortLabel, linear, logBuckets, niceMax } from './scale';

describe('linear', () => {
	it('maps the domain onto the range', () => {
		const f = linear(0, 100, 0, 300);
		expect(f(0)).toBe(0);
		expect(f(50)).toBe(150);
		expect(f(100)).toBe(300);
	});

	it('maps decreasing ranges', () => {
		const f = linear(0, 10, 100, 0);
		expect(f(0)).toBe(100);
		expect(f(10)).toBe(0);
	});

	it('is flat when the domain is a point', () => {
		const f = linear(5, 5, 0, 10);
		expect(f(5)).toBe(5);
	});
});

describe('niceMax', () => {
	it('rounds up to 1, 2 or 5 × 10ⁿ', () => {
		expect(niceMax(73)).toBe(100);
		expect(niceMax(0.3)).toBe(0.5);
		expect(niceMax(0)).toBe(1);
	});

	it('keeps exact 1/2/5 maxima', () => {
		expect(niceMax(1)).toBe(1);
		expect(niceMax(2)).toBe(2);
		expect(niceMax(5)).toBe(5);
		expect(niceMax(200)).toBe(200);
	});
});

describe('logBuckets', () => {
	it('counts land in the right buckets with the expected labels', () => {
		const b = logBuckets([0, 3, 12, 12000]);
		expect(b.map((x) => x.label)).toEqual([
			'0',
			'1–9',
			'10–99',
			'100–999',
			'1k–9.9k',
			'10k–99k',
			'100k+'
		]);
		expect(b.map((x) => x.count)).toEqual([1, 1, 1, 0, 0, 1, 0]);
	});

	it('the last bucket is open-ended', () => {
		const b = logBuckets([999_999, 1_000_000]);
		expect(b[6].to).toBeNull();
		expect(b[6].count).toBe(2);
	});
});

describe('bucketShortLabel', () => {
	it('is the lower bound of each default bucket', () => {
		expect(logBuckets([]).map((b) => bucketShortLabel(b.from))).toEqual([
			'0',
			'1+',
			'10+',
			'100+',
			'1k+',
			'10k+',
			'100k+'
		]);
	});
});

describe('bucketIndex', () => {
	it('is the last bucket at and beyond the top edge', () => {
		expect(bucketIndex(1_000_000)).toBe(6);
		expect(bucketIndex(4_200_000)).toBe(6);
	});

	it('sits on the edge values', () => {
		expect(bucketIndex(0)).toBe(0);
		expect(bucketIndex(1)).toBe(1);
		expect(bucketIndex(999)).toBe(3);
		expect(bucketIndex(1000)).toBe(4);
	});
});
