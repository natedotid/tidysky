<script lang="ts">
	import { describeClause, type FilterClause } from '#lib/filters/filters';
	import { kindFor, valueIndex, type FilterValue } from '#lib/filters/options';

	import Sheet from './Sheet.svelte';

	interface Props {
		open: boolean;
		/** The clause being edited; null when the sheet is closed. */
		clause: FilterClause | null;
		/** Apply a change to the clause, in place, right now. */
		onEdit: (c: FilterClause) => void;
		onRemove: () => void;
		onClose: () => void;
	}

	let { open, clause, onEdit, onRemove, onClose }: Props = $props();

	const kind = $derived(clause === null ? null : kindFor(clause));
	/**
	 * The "Match the opposite" switch, for negatable kinds whose values do not
	 * carry the negate flag themselves (follows-you-back is the pair).
	 */
	const switchShown = $derived(
		kind !== null && kind.negatable && !kind.values.some((v) => v.clause.negate === true)
	);
	const selected = $derived(clause === null || kind === null ? -1 : valueIndex(kind, clause));
	const flipped = $derived(
		clause === null
			? null
			: clause.negate === true
				? ({ ...clause, negate: undefined } as FilterClause)
				: { ...clause, negate: true }
	);

	function pick(v: FilterValue): void {
		if (clause === null) return;
		const next: FilterClause = { ...v.clause };
		// Keep the current negation when only the value changes.
		if (switchShown && clause.negate === true) next.negate = true;
		onEdit(next);
	}

	function flip(): void {
		if (flipped !== null) onEdit(flipped);
	}
</script>

<Sheet {open} title={clause === null ? 'Filter' : describeClause(clause)} {onClose}>
	{#if kind !== null && clause !== null}
		{#if kind.values.length > 1}
			<section>
				<h3>Match</h3>
				<div class="opts">
					{#each kind.values as v, j (v.key)}
						<button
							type="button"
							class:selected={j === selected}
							aria-pressed={j === selected}
							onclick={() => pick(v)}
						>
							{v.label}
						</button>
					{/each}
				</div>
			</section>
		{/if}

		{#if switchShown && flipped !== null}
			<section>
				<label class="opposite">
					<input type="checkbox" checked={clause.negate === true} onchange={() => flip()} />
					Match the opposite
				</label>
				<p class="opposite-wording">{describeClause(flipped)}</p>
			</section>
		{/if}

		<button type="button" class="remove" onclick={onRemove}>Remove filter</button>
	{/if}
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
	.opts button.selected {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 600;
	}

	.opposite {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		font-size: var(--text-sm);
		color: var(--color-text);
		cursor: pointer;
	}
	.opposite input {
		accent-color: var(--color-primary);
	}
	.opposite-wording {
		margin: var(--space-xs) 0 0;
		padding-left: calc(var(--tap) / 2 + var(--space-xs));
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.remove {
		border: 1px solid var(--color-danger);
		background: none;
		color: var(--color-danger);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		border-radius: var(--radius-md);
		padding: 8px 16px;
		min-height: var(--tap);
		cursor: pointer;
	}
</style>
