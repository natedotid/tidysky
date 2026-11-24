<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';

	// The consumer passes the row as a named snippet:
	//   <VirtualList …>{#snippet row(item, index)}…{/snippet}</VirtualList>
	let {
		items,
		rowHeight,
		overscan = 8,
		/** Rendered for each visible row with (item, index). */
		row,
		key,
		/** The element that scrolls, when not the window (e.g. a sheet). */
		scroller = null
	}: {
		items: T[];
		rowHeight: number;
		overscan?: number;
		row: Snippet<[T, number]>;
		key: (item: T) => string;
		scroller?: HTMLElement | null;
	} = $props();

	let container = $state<HTMLElement | null>(null);
	let range = $state({ start: 0, end: 0 });

	function updateRange(): void {
		if (container === null) return;
		// The list scrolls inside `scroller` (or the window when null):
		// measure against that element, not the page.
		const top =
			container.getBoundingClientRect().top - (scroller?.getBoundingClientRect().top ?? 0);
		const viewport = scroller !== null ? scroller.clientHeight : window.innerHeight;
		const start = Math.max(0, Math.floor(-top / rowHeight) - overscan);
		const end = Math.min(items.length, start + Math.ceil(viewport / rowHeight) + 2 * overscan);
		if (start !== range.start || end !== range.end) range = { start, end };
	}

	// Bound for the component's life; rebinds when the scroller changes.
	$effect(() => {
		const target: EventTarget = scroller ?? window;
		target.addEventListener('scroll', updateRange, { passive: true });
		window.addEventListener('resize', updateRange, { passive: true });
		return () => {
			target.removeEventListener('scroll', updateRange);
			window.removeEventListener('resize', updateRange);
		};
	});

	// Recompute the visible window when the data or sizes change.
	$effect(() => {
		updateRange();
	});
</script>

<div class="virtual" bind:this={container} style={`height: ${items.length * rowHeight}px`}>
	<div class="window" style={`transform: translateY(${range.start * rowHeight}px)`}>
		{#each items.slice(range.start, range.end) as item, i (key(item))}
			{@const index = range.start + i}
			{@render row(item, index)}
		{/each}
	</div>
</div>

<style>
	.virtual {
		position: relative;
	}
	.window {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
	}
</style>
