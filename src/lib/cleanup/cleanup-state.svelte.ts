/**
 * The Clean up screen's state: the active filter spec, sort, and selection.
 * Results are derived live from the scan state's accounts, so the list keeps
 * growing while a scan runs and a kept account disappears at once.
 */

import type { ReadonlyURLSearchParams } from '$app/state';
import { SvelteSet } from 'svelte/reactivity';

import { openStore, type Store } from '#lib/db/store';
import { matches } from '#lib/filters/filters';
import type { Clause, FilterClause, FilterSpec } from '#lib/filters/filters';
import { presetById } from '#lib/filters/presets';
import { interactionCount } from '#lib/insights/following';
import { diffSnapshots, SINCE_CLAUSE_LABELS, type SinceKey } from '#lib/insights/snapshots';
import { scanState } from '#lib/scan/scan-state.svelte';
import type { FollowAccount } from '#lib/scan/types';

import { reviewTargets } from './targets';

export type Sort =
	'lastActiveAsc' | 'followedAsc' | 'rateDesc' | 'name' | 'interactionAsc' | 'interactionDesc';

class CleanupState {
	spec: FilterSpec = $state({ clauses: [] });
	sort: Sort = $state('lastActiveAsc');
	/** Replace the set to trigger updates; never mutate it in place. */
	selected: SvelteSet<string> = $state(new SvelteSet());
	/** Show kept accounts in the results too. */
	showKept = $state(false);
	/** The preset id the spec came from, or null once it was edited. */
	appliedPreset: string | null = $state(null);
	/** DIDs marked "Keep" for the current account. */
	kept: string[] = $state([]);

	private store: Store | null = null;
	private boundKey: string | null = null;
	private urlApplied = false;
	private sinceApplied: string | null = null;

	/** The rows the screen shows: un-kept (unless showKept), filtered, sorted. */
	results = $derived.by((): FollowAccount[] => {
		const kept = new Set(this.kept);
		const now = new Date();
		const rows = scanState.accounts.filter((a) => {
			if (!this.showKept && kept.has(a.did)) return false;
			return matches(a, this.spec, now);
		});
		sortRows(rows, this.sort);
		return rows;
	});

	/**
	 * What Review actually acts on: selected AND in the current results AND
	 * not kept, in on-screen order. Kept and filtered-out accounts never
	 * count, so the bar and the sheet always show the same number.
	 */
	targets = $derived.by((): FollowAccount[] =>
		reviewTargets(this.results, this.selected, new Set(this.kept))
	);

	applyPreset(id: string): void {
		const p = presetById(id);
		if (p === undefined) return;
		this.spec = { clauses: p.spec.clauses.map((c) => ({ ...c })) };
		this.appliedPreset = p.id;
		this.clearSelection();
	}

	addClause(c: Clause): void {
		this.spec = { clauses: [...this.spec.clauses, c] };
		this.appliedPreset = null;
		this.clearSelection();
	}

	removeClause(i: number): void {
		const clauses = this.spec.clauses.filter((_, j) => j !== i);
		this.spec = { clauses };
		this.appliedPreset = null;
		this.clearSelection();
	}

	/**
	 * Replace the clause at i in place (the chip's edit sheet: a new value or
	 * a flipped negate). Editing is no longer a preset, so it clears the
	 * applied one; the selection is cleared like any other filter change.
	 */
	setClause(i: number, c: FilterClause): void {
		const clauses = this.spec.clauses.map((x, j) => (j === i ? c : x));
		this.spec = { clauses };
		this.appliedPreset = null;
		this.clearSelection();
	}

	setSort(sort: Sort): void {
		this.sort = sort;
	}

	toggle(did: string): void {
		const next = new SvelteSet(this.selected);
		if (next.has(did)) next.delete(did);
		else next.add(did);
		this.selected = next;
	}

	/** Select every row currently in the results. */
	selectAll(): void {
		this.selected = new SvelteSet(this.results.map((a) => a.did));
	}

	clearSelection(): void {
		this.selected = new SvelteSet();
	}

	toggleShowKept(): void {
		this.showKept = !this.showKept;
	}

	isKept(did: string): boolean {
		return this.kept.includes(did);
	}

	toggleKeep(did: string): void {
		const on = !this.isKept(did);
		this.kept = on ? [...this.kept, did] : this.kept.filter((d) => d !== did);
		if (on && this.selected.has(did)) {
			// A kept account can no longer be a Review target.
			const next = new SvelteSet(this.selected);
			next.delete(did);
			this.selected = next;
		}
		if (this.store !== null) void this.store.setKeep(did, on);
	}

	/** Forget the account (sign-out, delete all): no store, no keep, no selection. */
	unbind(): void {
		this.boundKey = null;
		this.store = null;
		this.kept = [];
		this.selected = new SvelteSet();
		this.showKept = false;
	}

	/** Open the keep store for the account; resets the selection on change. */
	async bind(key: string | null): Promise<void> {
		if (key === null || key === this.boundKey) return;
		this.boundKey = key;
		this.selected = new SvelteSet();
		this.kept = [];
		this.showKept = false;
		try {
			this.store = await openStore(key);
			this.kept = await this.store.getKeep();
		} catch {
			this.store = null;
		}
	}

	/** Apply ?preset= from the URL once. */
	applyUrlParams(params: ReadonlyURLSearchParams): void {
		if (this.urlApplied) return;
		this.urlApplied = true;
		const preset = params.get('preset');
		if (preset !== null) this.applyPreset(preset);
	}

	/**
	 * ?since=<key> from "Since your last scan": filter the results to exactly
	 * the accounts that category names. Applied once per key; a no-op when
	 * there are fewer than two snapshots, and for `droppedElsewhere`, whose
	 * accounts are no longer followed and so have no Clean up rows.
	 */
	async applySince(key: string): Promise<void> {
		if (this.sinceApplied === key) return;
		const snaps = scanState.snapshots;
		const label = SINCE_CLAUSE_LABELS[key as SinceKey];
		if (snaps.length < 2 || label === undefined) return;
		const unfollowed = await scanState.unfollowedSince(snaps[1].at);
		const diff = diffSnapshots(snaps[1], snaps[0], unfollowed);
		const dids = diff[key as SinceKey];
		if (dids.length === 0) return;
		this.sinceApplied = key;
		this.addClause({ kind: 'inSet', dids: [...dids], label });
	}
}

/** Oldest last-activity first (the quietest on top); unknowns last. */
function lastActiveKey(a: FollowAccount): number {
	if (a.activity === null) return Number.POSITIVE_INFINITY;
	// Known to have never posted: the quietest possible.
	if (a.activity.lastActiveAt === null) return Number.NEGATIVE_INFINITY;
	return Date.parse(a.activity.lastActiveAt);
}

/**
 * "Checked, none in the window" first, then oldest interaction first;
 * not-checked-yet (null) last.
 */
function interactionKey(a: FollowAccount): number {
	if (a.interaction === null) return Number.POSITIVE_INFINITY;
	if (a.interaction.lastAt === null) return Number.NEGATIVE_INFINITY;
	return Date.parse(a.interaction.lastAt);
}

export function sortRows(rows: FollowAccount[], sort: Sort): void {
	switch (sort) {
		case 'lastActiveAsc':
			rows.sort((a, b) => lastActiveKey(a) - lastActiveKey(b));
			break;
		case 'followedAsc':
			rows.sort((a, b) => tsKey(a.followedAt) - tsKey(b.followedAt));
			break;
		case 'interactionAsc':
			rows.sort((a, b) => interactionKey(a) - interactionKey(b));
			break;
		case 'interactionDesc':
			rows.sort((a, b) => {
				const ca = interactionCount(a);
				const cb = interactionCount(b);
				// Not checked (null) sorts last, whatever the other's count.
				if (ca === null && cb === null) return 0;
				if (ca === null) return 1;
				if (cb === null) return -1;
				// Count descending; ties by the more recent last interaction
				// (a checked account with none has lastAt null = oldest).
				if (ca !== cb) return cb - ca;
				const la = a.interaction === null ? null : a.interaction.lastAt;
				const lb = b.interaction === null ? null : b.interaction.lastAt;
				const ta = la === null ? -Infinity : Date.parse(la);
				const tb = lb === null ? -Infinity : Date.parse(lb);
				return tb - ta;
			});
			break;
		case 'rateDesc':
			rows.sort((a, b) => rateKey(b) - rateKey(a));
			break;
		case 'name':
			rows.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }));
			break;
	}
}

function tsKey(iso: string | null): number {
	return iso === null ? Number.POSITIVE_INFINITY : Date.parse(iso);
}

function rateKey(a: FollowAccount): number {
	return a.activity === null ? Number.NEGATIVE_INFINITY : a.activity.itemsPerDay;
}

function nameOf(a: FollowAccount): string {
	return (a.displayName ?? a.handle ?? a.did).toLowerCase();
}

export const cleanupState = new CleanupState();
