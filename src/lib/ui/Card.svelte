<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Path, PathnameWithSearchOrHash } from '$app/types';
	import type { Snippet } from 'svelte';

	/**
	 * One insight card: title, a bold takeaway under it, the chart in the
	 * default slot, and a bottom row with a muted footnote and an optional
	 * text link ("See them in Clean up →").
	 */
	interface Props {
		title: string;
		/** One bold sentence under the title. */
		takeaway?: string;
		/** Muted, small, at the bottom left. */
		footnote?: string;
		/**
		 * A text link at the bottom right, e.g. "See them in Clean up →".
		 * Pathname, no leading slash: `resolve()` is route-checked against it.
		 */
		action?: { label: string; href: PathnameWithSearchOrHash };
		children: Snippet;
	}

	let { title, takeaway, footnote, action, children }: Props = $props();
</script>

<article class="card">
	<h2 class="title">{title}</h2>
	{#if takeaway !== undefined}
		<p class="takeaway">{takeaway}</p>
	{/if}
	{@render children?.()}
	{#if footnote !== undefined || action !== undefined}
		<div class="bottom">
			{#if footnote !== undefined}
				<p class="footnote">{footnote}</p>
			{/if}
			{#if action !== undefined}
				<a class="card-action" href={resolve(action.href as Path)}>{action.label}</a>
			{/if}
		</div>
	{/if}
</article>

<style>
	.card {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-md);
		/* As a grid item of the page's card stack, a long name or chart must
			not be able to push the shared column past the viewport. */
		min-width: 0;
	}

	.title {
		margin: 0;
		font-size: var(--text-lg);
		overflow-wrap: anywhere;
	}
	.takeaway {
		margin: calc(-1 * var(--space-sm)) 0 0;
		font-size: var(--text-sm);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	/* The footnote and the action share the row when they fit; when they
	   don't, the footnote takes the full width and the action wraps onto its
	   own line (left, as the single item on the line). */
	.bottom {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
	}
	.footnote {
		flex: 1 1 16rem;
		min-width: 0;
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
	.card-action {
		flex: none;
		display: inline-flex;
		align-items: center;
		/* A 44 px tap target even though the link text is small. */
		min-height: var(--tap);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--color-primary);
		text-decoration: none;
	}
	.card-action:hover {
		text-decoration: underline;
	}
</style>
