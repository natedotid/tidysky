<script lang="ts">
	/**
	 * A single row of 24 columns, one per hour of the day, ticks at 0, 6, 12
	 * and 18. Column height is the value scaled to the largest column; the
	 * empty track behind each column is --color-surface-2.
	 */
	interface Props {
		/** 24 values, index = local hour of day. */
		hours: number[];
		/** The main finding in words, for screen readers. */
		ariaLabel: string;
	}

	let { hours, ariaLabel }: Props = $props();

	let w = $state(0);
	let figEl: HTMLElement | undefined = $state(undefined);
	let inView = $state(false);
	$effect(() => {
		const el = figEl;
		if (el === undefined) return;
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

	const BAR_H = 120;
	const TICK_H = 18;
	const H = BAR_H + TICK_H;

	const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
	const TICKS = [0, 6, 12, 18].map((h) => ({
		h,
		label: hourFmt.format(new Date(2024, 0, 1, h))
	}));

	const colW = $derived(w / 24);
	const max = $derived(Math.max(0, ...hours));
</script>

<figure class="hourchart" bind:this={figEl}>
	<figcaption class="visually-hidden">{ariaLabel}</figcaption>
	{#if inView}
		<div class="wrap" bind:clientWidth={w}>
			<!-- width="100%" + viewBox: the svg scales to whatever width the
				container gives it and contributes nothing to min-content, so it
				can never push the card wider. -->
			<svg
				width="100%"
				viewBox={w === 0 ? undefined : `0 0 ${w} ${H}`}
				role="img"
				aria-label={ariaLabel}
			>
				{#each hours as v, h (h)}
					<rect
						x={h * colW + 1}
						y="0"
						width={colW - 2}
						height={BAR_H}
						rx="3"
						fill="var(--color-surface-2)"
					/>
					{#if v > 0 && max > 0}
						<rect
							x={h * colW + 1}
							y={BAR_H - BAR_H * (v / max)}
							width={colW - 2}
							height={BAR_H * (v / max)}
							rx="3"
							fill="var(--chart-1)"
						/>
					{/if}
				{/each}
				{#each TICKS as t (t.h)}
					<!-- The first and last column sit on the chart's edges, so
						a centered label there would be clipped: align those
						inward instead. -->
					<text
						class="tick"
						x={t.h === 0 ? 0 : t.h === 23 ? 24 * colW : t.h * colW + colW / 2}
						y={BAR_H + 14}
						text-anchor={t.h === 0 ? 'start' : t.h === 23 ? 'end' : 'middle'}
					>
						{t.label}
					</text>
				{/each}
			</svg>
		</div>
		<div class="visually-hidden">
			<table>
				<caption>{ariaLabel}</caption>
				<thead>
					<tr>
						{#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] as h (h)}
							<th scope="col">{hourFmt.format(new Date(2024, 0, 1, h))}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					<tr>
						{#each hours as v, h (h)}
							<!-- Values are estimates and can be fractional; show
								whole numbers. -->
							<td>{Math.round(v)}</td>
						{/each}
					</tr>
				</tbody>
			</table>
		</div>
	{/if}
</figure>

<style>
	.hourchart {
		margin: 0;
		animation: fade 150ms ease;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hourchart {
			animation: none;
		}
	}

	.wrap {
		min-width: 0;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
	}
	.tick {
		font-size: var(--text-xs);
		fill: var(--color-text-muted);
	}
</style>
