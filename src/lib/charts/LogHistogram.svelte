<script lang="ts">
	import { bucketIndex, bucketShortLabel, logBuckets } from './scale';

	/**
	 * Vertical bars over the log-spaced count buckets, 160 px of bar height
	 * with the bucket labels under each bar. A small triangle and the word
	 * "You" sit above the bucket `youValue` falls in.
	 */
	interface Props {
		values: number[];
		/** Your own value; null draws no marker. */
		youValue: number | null;
		/** The main finding in words, for screen readers. */
		ariaLabel: string;
	}

	let { values, youValue, ariaLabel }: Props = $props();

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

	const MARKER_H = 24;
	const BARS_H = 160;
	const LABEL_H = 16;
	const H = MARKER_H + BARS_H + LABEL_H;

	const buckets = $derived(logBuckets(values));
	const max = $derived(Math.max(0, ...buckets.map((b) => b.count)));
	const youIdx = $derived(youValue === null ? null : bucketIndex(youValue));
	const cellW = $derived(buckets.length === 0 ? 0 : w / buckets.length);
</script>

<figure class="hist" bind:this={figEl}>
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
				{#each buckets as b, i (b.label)}
					{@const bw = Math.max(0, cellW - 4)}
					{@const bh = max === 0 ? 0 : (b.count / max) * BARS_H}
					<rect
						x={i * cellW + 2}
						y={MARKER_H + BARS_H - bh}
						width={bw}
						height={bh}
						rx="3"
						fill="var(--chart-1)"
					/>
					<text class="lbl" x={i * cellW + cellW / 2} y={H - 4} text-anchor="middle">
						{bucketShortLabel(b.from)}
					</text>
				{/each}
				{#if youIdx !== null}
					{@const cx = youIdx * cellW + cellW / 2}
					<polygon points={`${cx - 4},16 ${cx + 4},16 ${cx},22`} fill="var(--chart-2)" />
					<text class="you" x={cx} y={12} text-anchor="middle">You</text>
				{/if}
			</svg>
		</div>
		<div class="visually-hidden">
			<table>
				<caption>{ariaLabel}</caption>
				<thead>
					<tr>
						<th scope="col">Followers</th>
						<th scope="col">Accounts</th>
					</tr>
				</thead>
				<tbody>
					{#each buckets as b (b.label)}
						<tr>
							<th scope="row">{b.label}</th>
							<td>{b.count}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</figure>

<style>
	.hist {
		margin: 0;
		animation: fade 150ms ease;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hist {
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
	.lbl {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		fill: var(--color-text-muted);
	}
	.you {
		font-size: var(--text-xs);
		font-weight: 600;
		fill: var(--chart-2);
	}
</style>
