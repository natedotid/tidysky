<script lang="ts">
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	import { openStore } from '#lib/db/store';
	import type { UnfollowLogEntry } from '#lib/scan/types';
	import { relativeTime } from '#lib/time';

	/**
	 * The account's change log, grouped by day, newest first. Each entry can
	 * be undone; entries can be checked for a multi-select "Undo selected".
	 * Reads its own log so it stays self-contained; the page bumps `refresh`
	 * after a run or an undo.
	 */
	interface Props {
		/** The store key to read the log from; null before the app is bound. */
		storeKey: string | null;
		refresh: number;
		onUndo: (entries: UnfollowLogEntry[]) => void;
	}

	let { storeKey, refresh, onUndo }: Props = $props();

	let entries = $state<UnfollowLogEntry[]>([]);
	let selected = new SvelteSet<number>();

	$effect(() => {
		const key = storeKey;
		void refresh; // re-read the log whenever the page bumps it
		if (key === null) {
			entries = [];
			return;
		}
		let live = true;
		void (async () => {
			try {
				const store = await openStore(key);
				// Undone entries leave the list; the log keeps them for the limit count.
				if (live) entries = (await store.listLog()).filter((e) => e.undoneAt === undefined);
			} catch {
				if (live) entries = [];
			}
		})();
		return () => {
			live = false;
		};
	});

	const groups = $derived.by((): Array<{ label: string; items: UnfollowLogEntry[] }> => {
		const byDay = new SvelteMap<string, UnfollowLogEntry[]>();
		for (const e of entries) {
			const label = dayLabel(e.at);
			const list = byDay.get(label);
			if (list === undefined) byDay.set(label, [e]);
			else list.push(e);
		}
		return [...byDay.entries()].map(([label, items]) => ({ label, items }));
	});

	const selectedEntries = $derived(entries.filter((e) => e.id !== undefined && selected.has(e.id)));

	function dayLabel(iso: string): string {
		const then = new Date(iso);
		const now = new Date();
		const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
		const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		return then.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
		});
	}

	function actionWord(e: UnfollowLogEntry): string {
		if (e.action === 'unfollow') return 'Unfollowed';
		if (e.action === 'mute') return 'Muted';
		return 'Moved to a list';
	}

	function toggleSelect(e: UnfollowLogEntry): void {
		if (e.id === undefined) return;
		// Mutate in place: SvelteSet tracks its own reactivity.
		if (selected.has(e.id)) selected.delete(e.id);
		else selected.add(e.id);
	}
</script>

{#if groups.length > 0}
	<section class="recent" aria-label="Recent changes">
		<h2>Recent changes</h2>
		<p class="note">
			Undo works in this browser only. Undoing an unfollow follows the account again, and Bluesky
			notifies them.
		</p>
		{#each groups as g (g.label)}
			<h3>{g.label}</h3>
			<ul>
				{#each g.items as e (e.id ?? `${e.did}:${e.at}`)}
					<li>
						<label class="pick">
							<input
								type="checkbox"
								aria-label={`Select ${e.handle} for undo`}
								checked={e.id !== undefined && selected.has(e.id)}
								onchange={() => toggleSelect(e)}
							/>
						</label>
						<span class="what">
							<strong>{actionWord(e)}</strong>
							{e.handle}
							<span class="reason">{e.reason}</span>
							<span class="when" title={e.at}>{relativeTime(e.at)}</span>
						</span>
						<button type="button" class="undo" onclick={() => onUndo([e])}>Undo</button>
					</li>
				{/each}
			</ul>
		{/each}
		{#if selectedEntries.length > 0}
			<button type="button" class="undo-many" onclick={() => onUndo(selectedEntries)}>
				Undo selected ({selectedEntries.length})
			</button>
		{/if}
	</section>
{/if}

<style>
	.recent {
		margin-top: var(--space-xl);
		padding-top: var(--space-md);
		border-top: 1px solid var(--color-border);
	}

	h2 {
		margin: 0 0 var(--space-sm);
		font-size: var(--text-lg);
	}
	.note {
		margin: 0 0 var(--space-sm);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
	h3 {
		margin: var(--space-sm) 0 var(--space-xs);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-xs) 0;
		border-bottom: 1px solid var(--color-border);
	}

	.pick {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		/* The label is the tap target, so it gets the full 44 px area; the
			checkbox itself stays its natural size, centered. */
		width: var(--tap);
		height: var(--tap);
	}
	.pick input {
		margin: 0;
		accent-color: var(--color-primary);
	}

	.what {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.reason {
		color: var(--color-text-muted);
	}
	.when {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		margin-left: var(--space-xs);
	}

	.undo {
		flex: none;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		border-radius: var(--radius-pill);
		padding: 6px 12px;
		min-height: var(--tap);
		cursor: pointer;
	}

	.undo-many {
		margin-top: var(--space-sm);
		border: 1px solid var(--color-primary);
		background: var(--color-primary);
		color: var(--color-on-primary);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		border-radius: var(--radius-md);
		padding: 8px 12px;
		min-height: var(--tap);
		cursor: pointer;
	}
</style>
