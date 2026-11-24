import { describe, expect, it } from 'vitest';

import { busiestCell } from './busiest';

const grid = (set: Array<[number, number, number]>): number[][] => {
	const g: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
	for (const [d, h, v] of set) g[d][h] = v;
	return g;
};

describe('busiestCell', () => {
	it('returns the unique maximum', () => {
		const cell = busiestCell(
			grid([
				[2, 21, 9],
				[4, 3, 4]
			])
		);
		expect(cell).not.toBeNull();
		expect(cell?.stored).toBe(2);
		expect(cell?.hour).toBe(21);
	});

	it('ties go to Monday-first order, then the earlier hour', () => {
		// Sunday and Monday both at 5: Monday (displayed first) wins.
		expect(
			busiestCell(
				grid([
					[0, 5, 4],
					[1, 5, 4]
				])
			)?.stored
		).toBe(1);
		// Same day: the earlier hour wins.
		expect(
			busiestCell(
				grid([
					[1, 20, 4],
					[1, 8, 4]
				])
			)?.hour
		).toBe(8);
	});

	it('an empty grid has no busiest cell', () => {
		expect(busiestCell(grid([]))).toBeNull();
	});
});
