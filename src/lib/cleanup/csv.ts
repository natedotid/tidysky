/**
 * CSV export of the reviewed accounts. `toCsv` is a pure string builder;
 * `downloadCsv` adds the Blob + temporary anchor for the browser.
 */
import { reasons, type FilterSpec } from '#lib/filters/filters';
import { interactionCount } from '#lib/insights/following';
import type { FollowAccount } from '#lib/scan/types';

export const CSV_HEADER =
	'did,handle,display_name,status,last_active,items_per_day,follows_you,followed_at,followers,follows,posts,last_interaction_at,last_interaction_kind,interaction_count,reasons';

/** One cell: RFC 4180 quoting, plus a `'` prefix against formula injection. */
function cell(value: string | number | null): string {
	if (value === null) return '';
	let s = String(value);
	// A leading =, +, - or @ would be read as a formula by spreadsheet apps.
	if (/^[=+\-@]/.test(s)) s = "'" + s;
	if (/[",\n\r]/.test(s)) s = '"' + s.replaceAll('"', '""') + '"';
	return s;
}

export function toCsv(accounts: FollowAccount[], spec: FilterSpec, now: Date): string {
	const rows = accounts.map((a) =>
		[
			a.did,
			a.handle,
			a.displayName,
			a.status,
			a.activity?.lastActiveAt ?? '',
			a.activity === null ? '' : Math.round(a.activity.itemsPerDay * 100) / 100,
			a.followsYou === null ? '' : a.followsYou ? 'yes' : 'no',
			a.followedAt,
			a.followersCount,
			a.followsCount,
			a.postsCount,
			a.interaction?.lastAt ?? '',
			a.interaction?.lastKind ?? '',
			interactionCount(a),
			reasons(a, spec, now).join(' · ')
		]
			.map(cell)
			.join(',')
	);
	return [CSV_HEADER, ...rows].join('\n');
}

/** tidysky-<YYYY-MM-DD>.csv, from the local date. */
export function csvFilename(now: Date): string {
	const p = (x: number) => String(x).padStart(2, '0');
	return `tidysky-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.csv`;
}

export function downloadCsv(accounts: FollowAccount[], spec: FilterSpec, now: Date): void {
	const blob = new Blob([toCsv(accounts, spec, now)], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = csvFilename(now);
	document.body.append(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
