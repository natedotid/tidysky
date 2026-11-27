/**
 * The single busiest cell of a 7 × 24 weekday × hour grid (stored
 * Sunday-first). Ties go to the earlier cell in the Monday-first display
 * order, then to the earlier hour: the same order the Heatmap draws rows
 * in, so the callout always matches what the eye sees first.
 */
export interface BusiestCell {
	/** Stored row: 0 = Sunday. */
	stored: number;
	hour: number;
	value: number;
}

/** Monday-first display order over the stored (Sunday-first) rows. */
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

export function busiestCell(grid: number[][]): BusiestCell | null {
	let best = -1;
	let stored = -1;
	let hour = -1;
	for (const s of MONDAY_FIRST) {
		const row = grid[s];
		for (let h = 0; h < 24; h += 1) {
			const v = row?.[h] ?? 0;
			if (v > best) {
				best = v;
				stored = s;
				hour = h;
			}
		}
	}
	return best > 0 ? { stored, hour, value: best } : null;
}

/**
 * The single busiest hour of a 24-value hour-of-day array. Ties go to the
 * earlier hour, so the named hour is always the leftmost of the tied
 * columns. Null when every hour is zero.
 */
export function busiestHour(hours: number[]): number | null {
	let best = -1;
	let hour = -1;
	for (let h = 0; h < 24; h += 1) {
		const v = hours[h] ?? 0;
		if (v > best) {
			best = v;
			hour = h;
		}
	}
	return best > 0 ? hour : null;
}
