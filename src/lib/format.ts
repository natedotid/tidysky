const DAY = 86_400_000;

/** "today", "yesterday", "12d ago", "5mo ago", "2y ago"; unknown shows a dash. */
export function relativeDays(iso: string | null, now: Date = new Date()): string {
	if (iso === null) return '—';
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) return '—';
	const days = Math.floor((now.getTime() - ms) / DAY);
	if (days <= 0) return 'today'; // includes future skew
	if (days === 1) return 'yesterday';
	if (days < 30) return `${days}d ago`;
	if (days < 365) return `${Math.floor(days / 30)}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}

/** "0.2/day", "3/day", "40+/day" for 40 and up; null shows a dash. */
export function rate(n: number | null): string {
	if (n === null) return '—';
	if (n >= 40) return '40+/day';
	if (n >= 1) return `${Math.round(n)}/day`;
	const s = n.toFixed(1);
	return s === '0.0' ? '0/day' : `${s}/day`;
}

/** "1 like" / "54 likes": the singular word when n is 1. */
export function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** "999", "1.2k", "12k", "1.1M". */
export function compact(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) {
		const k = n / 1000;
		return `${k < 10 ? Math.round(k * 10) / 10 : Math.round(k)}k`;
	}
	const m = n / 1_000_000;
	return `${m < 10 ? Math.round(m * 10) / 10 : Math.round(m)}M`;
}
