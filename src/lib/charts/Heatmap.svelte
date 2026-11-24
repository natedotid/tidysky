<script lang="ts">
	import { busiestCell } from './busiest';

	/**
	 * A 7 × 24 weekday × hour grid. Rows are weekdays Monday-first (the
	 * stored grid is Sunday-first), columns are hours with ticks at 0, 6,
	 * 12 and 18. Cell color is --chart-1 at an opacity set by the value;
	 * empty cells are --color-surface-2.
	 */
	interface Props {
		/** 7 × 24, stored Sunday-first (row 0 = Sunday). */
		grid: number[][];
		/** The main finding in words, for screen readers. */
		ariaLabel: string;
	}

	let { grid, ariaLabel }: Props = $props();

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

	const LABEL_W = 34;
	const ROW_H = 22; // 20 px cell + 2 px gap
	const CELL = 20;
	const TICK_H = 18;
	const H = 7 * ROW_H - 2 + TICK_H;

	const shortFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
	const longFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
	const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
	// 2024-01-01 was a Monday, so 1 + i walks Monday → Sunday.
	const DISPLAY = [1, 2, 3, 4, 5, 6, 0].map((stored, i) => ({
		stored,
		short: shortFmt.format(new Date(2024, 0, 1 + i)),
		long: longFmt.format(new Date(2024, 0, 1 + i))
	}));
	const TICKS = [0, 6, 12, 18].map((h) => ({
		h,
		label: hourFmt.format(new Date(2024, 0, 1, h))
	}));

	const cellW = $derived((w - LABEL_W) / 24);
	const max = $derived(Math.max(0, ...grid.flat()));
	const busiest = $derived(busiestCell(grid));
	const busiestText = $derived.by((): string | null => {
		if (busiest === null) return null;
		const d = DISPLAY.find((x) => x.stored === busiest.stored);
		if (d === undefined) return null;
		return `Busiest: ${d.long}s around ${hourFmt.format(new Date(2024, 0, 1, busiest.hour))}.`;
	});
</script>

<figure class="heatmap" bind:this={figEl}>
	<figcaption class="visually-hidden">{ariaLabel}</figcaption>
	{#if inView}
		<div class="wrap" bind:clientWidth={w}>
			<!-- width="100%" + viewBox: the svg scales to whatever width the
				container gives it and contributes nothing to min-content, so it
				can never push the card wider. (A fixed width={w} re-measured the
				widened box and locked the column wide.) -->
			<svg
				width="100%"
				viewBox={w === 0 ? undefined : `0 0 ${w} ${H}`}
				role="img"
				aria-label={ariaLabel}
			>
				{#each DISPLAY as d, i (d.short)}
					<text class="day" x="0" y={i * ROW_H + CELL / 2 + 4}>{d.short}</text>
					{#each grid[d.stored] as v, h (h)}
						<rect
							x={LABEL_W + h * cellW + 1}
							y={i * ROW_H}
							width={cellW - 2}
							height={CELL}
							rx="3"
							fill={v > 0 ? 'var(--chart-1)' : 'var(--color-surface-2)'}
							opacity={v > 0 && max > 0 ? 0.08 + 0.92 * (v / max) : 1}
						/>
					{/each}
				{/each}
				{#each TICKS as t (t.h)}
					<text
						class="tick"
						x={LABEL_W + t.h * cellW + cellW / 2}
						y={7 * ROW_H - 2 + 14}
						text-anchor="middle"
					>
						{t.label}
					</text>
				{/each}
			</svg>
		</div>
		{#if busiestText !== null}
			<p class="busiest">{busiestText}</p>
		{/if}
		<div class="visually-hidden">
			<table>
				<caption>{ariaLabel}</caption>
				<thead>
					<tr>
						<th scope="col"></th>
						{#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] as h (h)}
							<th scope="col">{hourFmt.format(new Date(2024, 0, 1, h))}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each DISPLAY as d (d.short)}
						<tr>
							<th scope="row">{d.long}</th>
							{#each grid[d.stored] as v, h (h)}
								<!-- The Following tab's grid is rate-weighted, so cells
									can be fractional; show whole numbers. -->
								<td>{Math.round(v)}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</figure>

<style>
	.heatmap {
		margin: 0;
		animation: fade 150ms ease;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.heatmap {
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
	.day,
	.tick {
		font-size: var(--text-xs);
		fill: var(--color-text-muted);
	}

	.busiest {
		margin: var(--space-sm) 0 0;
		font-size: var(--text-sm);
		color: var(--color-text);
	}
</style>
