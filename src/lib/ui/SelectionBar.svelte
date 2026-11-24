<script lang="ts">
	interface Props {
		count: number;
		matchCount: number;
		/** True while a scan runs: a run would fight the scan for the same rows. */
		reviewDisabled: boolean;
		onSelectAll: () => void;
		onClear: () => void;
		onReview: () => void;
	}

	let { count, matchCount, reviewDisabled, onSelectAll, onClear, onReview }: Props = $props();
</script>

<div class="bar" role="region" aria-label="Selection actions">
	<span class="count">{count} selected</span>
	<button type="button" onclick={onSelectAll}>Select all {matchCount}</button>
	<button type="button" onclick={onClear}>Clear</button>
	<button type="button" class="primary" disabled={reviewDisabled} onclick={onReview}>
		Review
	</button>
	{#if reviewDisabled}
		<p class="note" role="status">Wait for the scan to finish before making changes.</p>
	{/if}
</div>

<style>
	/* Sticky above the fixed tab bar while the list scrolls. */
	.bar {
		position: sticky;
		bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + var(--space-sm));
		z-index: 10;
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		flex-wrap: wrap;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px rgba(10, 14, 22, 0.12);
		padding: var(--space-sm) var(--space-md);
		margin: var(--space-md) 0;
	}
	.count {
		font-weight: 600;
		flex: 1;
		min-width: 90px;
	}
	button {
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
	.primary {
		border: none;
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 600;
	}
	.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.note {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
</style>
