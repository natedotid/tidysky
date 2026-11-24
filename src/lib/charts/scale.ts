/**
 * Scale helpers for the chart components: a linear mapping, "nice" maxima
 * for axes, and log-spaced count buckets with human labels.
 */

export interface LogBucket {
	label: string;
	from: number;
	/** Null for the open-ended last bucket. */
	to: number | null;
	count: number;
}

/** The default log edges: one per order of magnitude, up to a million. */
export const LOG_EDGES = [0, 1, 10, 100, 1_000, 10_000, 100_000, 1_000_000] as const;

/** A linear mapping from the domain [d0, d1] onto the range [r0, r1]. */
export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
	if (d1 === d0) return () => (r0 + r1) / 2;
	const k = (r1 - r0) / (d1 - d0);
	return (v: number) => r0 + (v - d0) * k;
}

/** Round up to 1, 2 or 5 × 10ⁿ so an axis maximum reads clean. */
export function niceMax(v: number): number {
	if (v <= 0) return 1;
	const base = 10 ** Math.floor(Math.log10(v));
	const f = v / base;
	if (f <= 1) return base;
	if (f <= 2) return 2 * base;
	if (f <= 5) return 5 * base;
	return 10 * base;
}

/**
 * "1234" → "1.2k", "9999" → "9.9k", "99999" → "99k", "1200000" → "1.2m".
 * Truncates rather than rounds so a bucket's upper bound (9999) can never
 * spill into the next bucket's label (10k).
 */
function shortCount(n: number): string {
	if (n >= 1_000_000) {
		const m = n / 1_000_000;
		return `${m >= 10 ? Math.floor(m) : Math.floor(m * 10) / 10}m`;
	}
	if (n >= 1_000) {
		const k = n / 1_000;
		return `${k >= 10 ? Math.floor(k) : Math.floor(k * 10) / 10}k`;
	}
	return `${n}`;
}

/** "0", "1–9", "10–99", "100–999", "1k–9.9k", "10k–99k", "100k+". */
function bucketLabel(from: number, to: number | null): string {
	if (from === 0) return '0';
	if (to === null) return `${shortCount(from)}+`;
	return to - 1 < 1_000 ? `${from}–${to - 1}` : `${shortCount(from)}–${shortCount(to - 1)}`;
}

/**
 * The short bar label: the bucket's lower bound, "0", "1+", "10+", "100+",
 * "1k+", "10k+", "100k+". Short enough to fit under every bar on a phone;
 * the full range (bucketLabel) stays in the accessible table.
 */
export function bucketShortLabel(from: number): string {
	return from === 0 ? '0' : `${shortCount(from)}+`;
}

/** The index of the bucket a value falls in; the last bucket is open-ended. */
export function bucketIndex(value: number, edges: readonly number[] = LOG_EDGES): number {
	for (let i = edges.length - 2; i >= 0; i -= 1) {
		if (value >= edges[i]) return i;
	}
	return 0;
}

/** Count the values into log-spaced buckets, first edge to last. */
export function logBuckets(values: number[], edges: readonly number[] = LOG_EDGES): LogBucket[] {
	const openAt = edges.length - 2;
	const buckets: LogBucket[] = edges.slice(0, -1).map((from, i) => ({
		label: bucketLabel(from, i < openAt ? edges[i + 1] : null),
		from,
		to: i < openAt ? edges[i + 1] : null,
		count: 0
	}));
	for (const v of values) buckets[bucketIndex(v, edges)].count += 1;
	return buckets;
}
