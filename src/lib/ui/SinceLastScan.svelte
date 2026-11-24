<script lang="ts">
	/**
	 * "Since your last scan": what changed between the two newest
	 * snapshots. Each non-empty category is a chip that opens Clean up
	 * filtered to exactly those accounts, except "unfollowed elsewhere",
	 * whose accounts are no longer followed: its chip opens a sheet listing
	 * who they were. Renders nothing with fewer than two snapshots.
	 */
	import { resolve } from '$app/paths';

	import { isUnfollowAction } from '#lib/actions/undo';
	import { diffSnapshots, sinceChips, type SinceChip } from '#lib/insights/snapshots';
	import { openStore } from '#lib/db/store';
	import type { DataSource } from '#lib/scan/source';
	import type { Snapshot } from '#lib/scan/types';
	import { relativeTime } from '#lib/time';
	import DroppedElsewhereSheet from './DroppedElsewhereSheet.svelte';

	interface Props {
		/** Newest first. */
		snapshots: Snapshot[];
		/** The store key to read the unfollow log from; null before the app is bound. */
		storeKey: string | null;
		/** The current source (live or demo), for the unfollowed-elsewhere sheet. */
		source: DataSource | null;
	}

	let { snapshots, storeKey, source }: Props = $props();

	// DIDs the user unfollowed through TidySky after the previous scan: they
	// are not "dropped elsewhere".
	let unfollowed = $state<string[]>([]);

	$effect(() => {
		const key = storeKey;
		const prev = snapshots.length >= 2 ? snapshots[1] : null;
		if (key === null || prev === null) {
			unfollowed = [];
			return;
		}
		let live = true;
		void (async () => {
			try {
				const store = await openStore(key);
				const log = await store.listLog();
				if (live)
					unfollowed = log
						.filter((e) => isUnfollowAction(e.action) && e.at > prev.at && e.undoneAt === undefined)
						.map((e) => e.did);
			} catch {
				if (live) unfollowed = [];
			}
		})();
		return () => {
			live = false;
		};
	});

	const diff = $derived.by(() =>
		snapshots.length >= 2 ? diffSnapshots(snapshots[1], snapshots[0], unfollowed) : null
	);
	const chips = $derived.by((): SinceChip[] => (diff === null ? [] : sinceChips(diff)));
	const droppedDids = $derived(diff === null ? [] : diff.droppedElsewhere);
	let sheetOpen = $state(false);
</script>

{#if snapshots.length >= 2}
	<section class="since" aria-label="Since your last scan">
		<h2 class="heading">Since your last scan ({relativeTime(snapshots[1].at)})</h2>
		{#if chips.length > 0}
			<ul class="chips" aria-label="Changes since your last scan">
				{#each chips as c (c.key)}
					<li class="chip-wrap">
						{#if c.kind === 'sheet'}
							<button
								type="button"
								class="chip"
								aria-haspopup="dialog"
								aria-label={c.ariaLabel}
								onclick={() => (sheetOpen = true)}
							>
								{c.text}
							</button>
						{:else}
							<a class="chip" href={resolve(`cleanup?since=${c.key}`)} aria-label={c.ariaLabel}
								>{c.text}</a
							>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="none">No changes since your last scan.</p>
		{/if}
		<p class="footnote">Snapshots are kept on this device only.</p>
		<DroppedElsewhereSheet
			open={sheetOpen}
			dids={droppedDids}
			{source}
			onClose={() => (sheetOpen = false)}
		/>
	</section>
{/if}

<style>
	.since {
		margin-top: var(--space-lg);
	}
	.heading {
		margin: 0 0 var(--space-xs);
		font-size: var(--text-lg);
	}

	.chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
		margin: 0;
		padding: 0;
	}
	.chip {
		display: inline-block;
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		color: var(--color-text);
		font-family: inherit;
		font-size: var(--text-sm);
		border-radius: var(--radius-pill);
		padding: 6px 12px;
		text-decoration: none;
	}
	.chip:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
	button.chip {
		/* The UA button font (weight and line-height included) would make this
		   chip bolder, larger and taller than the <a> chips: take the
		   parent's font exactly like they do, then the chip's own size. The
		   global button min-height would make it taller too. */
		appearance: none;
		margin: 0;
		min-height: 0;
		font: inherit;
		font-size: var(--text-sm);
		font-weight: inherit;
		line-height: inherit;
		cursor: pointer;
	}

	.none {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.footnote {
		margin: var(--space-xs) 0 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
</style>
