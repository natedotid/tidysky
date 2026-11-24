/**
 * Plain-English relative time: "just now", "5 minutes ago", "3 hours ago",
 * "yesterday", "12 days ago", or a plain date for anything older.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return 'never';
	const min = Math.round((now.getTime() - then) / 60_000);
	if (min < 1) return 'just now';
	if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
	const day = Math.round(hr / 24);
	if (day < 7) return day === 1 ? 'yesterday' : `${day} days ago`;
	return new Date(then).toLocaleDateString();
}
