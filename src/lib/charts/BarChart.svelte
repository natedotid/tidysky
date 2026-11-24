<script lang="ts">
	/**
	 * Horizontal bars: label left, bar, value right, one 32 px row per item.
	 * The bars are HTML (not SVG) so labels and values are real text that
	 * can never overlap or clip at 375 px; the figure carries the a11y the
	 * SVG rules call for.
	 */
	interface Row {
		label: string;
		value: number;
		/** Shown instead of the raw value, e.g. "18%". */
		valueLabel?: string;
		highlight?: boolean;
	}
	interface Props {
		rows: Row[];
		/** The main finding in words, for screen readers. */
		ariaLabel: string;
	}

	let { rows, ariaLabel }: Props = $props();

	let figEl: HTMLElement | undefined = $state(undefined);
	let inView = $state(false);
	$effect(() => {
		const el = figEl;
		if (el === undefined) return;
		// Show immediately if at/above the fold (so top charts and the LCP
		// element aren't delayed a frame); otherwise mount when scrolled near.
		if (
			typeof IntersectionObserver === 'undefined' ||
			el.getBoundingClientRect().top < window.innerHeight + 400
		) {
			inView = true;
			return;
		}
		const obs = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					inView = true;
					obs.disconnect();
				}
			},
			{ rootMargin: '400px 0px' }
		);
		obs.observe(el);
		return () => obs.disconnect();
	});

	const max = $derived(Math.max(0, ...rows.map((r) => r.value)));
</script>

<figure class="bar-chart" bind:this={figEl}>
	<figcaption class="visually-hidden">{ariaLabel}</figcaption>
	{#if inView}
		<ul role="list">
			{#each rows as r (r.label)}
				<li class="row">
					<span class="label" title={r.label}>{r.label}</span>
					<span class="track"
						><span
							class="fill"
							class:hl={r.highlight === true}
							style={`width: ${max === 0 ? 0 : (r.value / max) * 100}%`}
						></span></span
					>
					<span class="value">{r.valueLabel ?? r.value}</span>
				</li>
			{/each}
		</ul>
	{/if}
</figure>

<style>
	.bar-chart {
		margin: 0;
		animation: fade 150ms ease;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bar-chart {
			animation: none;
		}
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 7fr) auto;
		align-items: center;
		gap: var(--space-sm);
		height: 32px;
	}
	.label {
		font-size: var(--text-sm);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.track {
		display: block;
		height: 12px;
		border-radius: var(--radius-pill);
		background: var(--color-surface-2);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: var(--radius-pill);
		background: var(--chart-1);
	}
	.fill.hl {
		background: var(--chart-2);
	}
	.value {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		text-align: right;
		min-width: 3ch;
	}
</style>
