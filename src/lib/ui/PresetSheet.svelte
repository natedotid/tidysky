<script lang="ts">
	import type { Preset } from '#lib/filters/presets';

	import Sheet from './Sheet.svelte';

	interface Props {
		open: boolean;
		/** Every preset, in display order. */
		presets: Preset[];
		/** The preset currently applied, if any. */
		applied: string | null;
		onApply: (id: string) => void;
		onClose: () => void;
	}

	let { open, presets, applied, onApply, onClose }: Props = $props();

	function pick(id: string): void {
		onApply(id);
		// Flips the parent's open to false; Sheet closes the dialog.
		onClose();
	}
</script>

<Sheet {open} title="Presets" {onClose}>
	<div class="list" role="list">
		{#each presets as p (p.id)}
			<button
				type="button"
				class="row"
				class:active={applied === p.id}
				aria-pressed={applied === p.id}
				onclick={() => pick(p.id)}
			>
				<span class="name">{p.name}</span>
				<span class="blurb">{p.blurb}</span>
			</button>
		{/each}
	</div>
</Sheet>

<style>
	.list {
		display: grid;
		gap: var(--space-xs);
	}
	.row {
		display: grid;
		/* Fill the button and pin the content to its left edge. Safari centers
			a grid button's content block, so without a 1fr column and
			justify-items: start the name and blurb sit centered, each with a
			different left edge per row. */
		grid-template-columns: minmax(0, 1fr);
		justify-items: start;
		width: 100%;
		gap: 2px;
		text-align: left;
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		color: var(--color-text);
		font: inherit;
		border-radius: var(--radius-md);
		padding: var(--space-sm) var(--space-md);
		min-height: var(--tap);
		cursor: pointer;
	}
	.row:active {
		background: var(--color-border);
	}
	.row.active {
		border-color: var(--color-accent);
	}
	.name {
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.blurb {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
</style>
