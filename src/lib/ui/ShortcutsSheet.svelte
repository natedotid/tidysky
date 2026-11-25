<script lang="ts">
	import Sheet from './Sheet.svelte';

	/**
	 * The "Keyboard shortcuts" sheet: what each Clean up key does. Opened by
	 * the "?" key or the button next to the Sort control (the button only
	 * shows on hover + fine-pointer devices, where the keys work). Like the
	 * other sheets it stays mounted at all times so its opener is remembered.
	 */
	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open, onClose }: Props = $props();
</script>

<Sheet {open} title="Keyboard shortcuts" {onClose}>
	<dl class="list">
		<div class="row">
			<dt><kbd>j</kbd> or <kbd>↓</kbd></dt>
			<dd>Next row</dd>
		</div>
		<div class="row">
			<dt><kbd>k</kbd> or <kbd>↑</kbd></dt>
			<dd>Previous row</dd>
		</div>
		<div class="row">
			<dt><kbd>x</kbd> or <kbd>Space</kbd></dt>
			<dd>Select or deselect the row</dd>
		</div>
		<div class="row">
			<dt><kbd>p</kbd></dt>
			<dd>Keep or unkeep the row</dd>
		</div>
		<div class="row">
			<dt><kbd>Enter</kbd> or <kbd>o</kbd></dt>
			<dd>Open the row's preview</dd>
		</div>
		<div class="row">
			<dt><kbd>Esc</kbd></dt>
			<dd>Close a sheet, or leave the rows</dd>
		</div>
		<div class="row">
			<dt><kbd>?</kbd></dt>
			<dd>Show this sheet</dd>
		</div>
	</dl>
</Sheet>

<style>
	.list {
		margin: 0;
		display: grid;
		gap: var(--space-xs);
	}
	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-sm);
		font-size: var(--text-sm);
	}
	.row dt {
		color: var(--color-text);
		flex: none;
	}
	.row dd {
		margin: 0;
		color: var(--color-text-muted);
		text-align: right;
	}
	kbd {
		display: inline-block;
		border: 1px solid var(--color-border);
		border-bottom-width: 2px;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		color: var(--color-text);
		font-family: inherit;
		font-size: var(--text-xs);
		line-height: 1.4;
		padding: 1px 6px;
		margin: 0 1px;
	}
</style>
