/**
 * Whether a finished scan is old enough that acting on its data is risky:
 * the follow records and statuses it holds may no longer be true. Null
 * (never finished) and unparseable timestamps count as stale.
 */
export function isScanStale(finishedAt: string | null, now: Date, hours: number): boolean {
	if (finishedAt === null) return true;
	const t = Date.parse(finishedAt);
	if (Number.isNaN(t)) return true;
	return now.getTime() - t > hours * 3_600_000;
}
