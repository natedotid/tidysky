<script lang="ts">
	import { describeClause, type FilterClause } from '#lib/filters/filters';
	import { kindFor } from '#lib/filters/options';

	interface Props {
		clauses: FilterClause[];
		onRemove: (i: number) => void;
		/** Open the chip's edit sheet. */
		onEdit: (i: number) => void;
	}

	let { clauses, onRemove, onEdit }: Props = $props();
</script>

{#if clauses.length > 0}
	<ul class="chips" aria-label="Active filters">
		{#each clauses as c, i (i + c.kind)}
			<li class="chip">
				{#if kindFor(c) !== null}
					<button
						type="button"
						class="text"
						aria-haspopup="dialog"
						aria-label={`Edit filter: ${describeClause(c)}`}
						onclick={() => onEdit(i)}
					>
						{describeClause(c)}
					</button>
				{:else}
					<!-- inSet and text chips have no value to pick: not editable. -->
					<span class="text">{describeClause(c)}</span>
				{/if}
				<button
					type="button"
					class="x"
					aria-label={`Remove filter: ${describeClause(c)}`}
					onclick={() => onRemove(i)}
				>
					×
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
		margin: 0;
		padding: 0;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		background: var(--color-surface-2);
		border-radius: var(--radius-pill);
		padding: 0 2px 0 4px;
	}
	.text {
		border: none;
		background: transparent;
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		padding: 6px 4px;
		cursor: pointer;
	}
	span.text {
		cursor: default;
	}
	.x {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--color-text-muted);
		font-size: var(--text-lg);
		line-height: 1;
		cursor: pointer;
	}
	.x:hover {
		background: var(--color-border);
		color: var(--color-text);
	}
</style>
