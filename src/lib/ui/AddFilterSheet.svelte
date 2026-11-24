<script lang="ts">
	import type { Clause, FilterClause } from '#lib/filters/filters';
	import { ADD_SECTIONS } from '#lib/filters/options';

	import Sheet from './Sheet.svelte';

	interface Props {
		open: boolean;
		onAdd: (c: Clause) => void;
		onClose: () => void;
	}

	let { open, onAdd, onClose }: Props = $props();

	let text = $state('');

	$effect(() => {
		if (!open) text = '';
	});

	function add(c: FilterClause): void {
		onAdd(c);
		// Flips the parent's open to false; Sheet closes the dialog.
		onClose();
	}

	function addText(): void {
		const q = text.trim();
		if (q === '') return;
		text = '';
		add({ kind: 'text', q });
	}
</script>

<Sheet {open} title="Add a filter" {onClose}>
	{#each ADD_SECTIONS as s, si (s.section)}
		<section>
			<h3>{s.section}</h3>
			<div class="opts">
				<!-- Index key: the list is static, and value keys alone
					 collide across kinds (two "0.5"s, two "none"s). -->
				{#each s.values as v, vi (si + '-' + vi)}
					<button type="button" onclick={() => add(v.clause)}>{v.label}</button>
				{/each}
			</div>
		</section>
	{/each}

	<section>
		<h3>Contains</h3>
		<form
			class="text-row"
			onsubmit={(e) => {
				e.preventDefault();
				addText();
			}}
		>
			<input
				type="search"
				bind:value={text}
				placeholder="Name, handle or bio contains…"
				aria-label="Text to match in name, handle or bio"
			/>
			<button type="submit" class="add" disabled={text.trim() === ''}>Add</button>
		</form>
	</section>
</Sheet>

<style>
	section {
		margin-bottom: var(--space-md);
	}
	h3 {
		margin: 0 0 var(--space-xs);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.opts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
	}
	.opts button {
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		border-radius: var(--radius-pill);
		padding: 8px 12px;
		min-height: var(--tap);
		cursor: pointer;
	}
	.opts button:active {
		background: var(--color-border);
	}

	.text-row {
		display: flex;
		gap: var(--space-sm);
	}
	.text-row input {
		flex: 1;
		min-width: 0;
		font: inherit;
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 8px 12px;
	}
	.add {
		border: none;
		background: var(--color-primary);
		color: var(--color-on-primary);
		font: inherit;
		font-weight: 600;
		border-radius: var(--radius-md);
		padding: 8px 16px;
		cursor: pointer;
	}
	.add:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
