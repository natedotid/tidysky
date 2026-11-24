<script lang="ts">
	/**
	 * One full-width 100% bar (28 px) plus a legend of buttons: swatch,
	 * label, count and percent. Segments under 0.5% are too thin to sit on
	 * the bar, so they only appear in the legend.
	 */
	interface Segment {
		key: string;
		label: string;
		value: number;
		/** A CSS custom property value, e.g. "var(--ramp-1)". */
		color: string;
	}
	interface Props {
		segments: Segment[];
		/** The main finding in words, for screen readers. */
		ariaLabel: string;
		/** When present, legend rows are buttons that report their key. */
		onselect?: (key: string) => void;
		/**
		 * With onselect, only these keys are buttons; the rest stay plain
		 * rows. Omit to make every segment tappable.
		 */
		tappableKeys?: string[];
	}

	let { segments, ariaLabel, onselect, tappableKeys }: Props = $props();

	function tappable(key: string): boolean {
		return onselect !== undefined && (tappableKeys === undefined || tappableKeys.includes(key));
	}

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

	const total = $derived(segments.reduce((s, x) => s + x.value, 0));
	const barSegments = $derived(segments.filter((s) => total > 0 && s.value / total >= 0.005));

	const rects = $derived.by(() => {
		const out: Array<{ key: string; x: number; width: number; color: string }> = [];
		let acc = 0;
		for (const s of barSegments) {
			const width = total === 0 ? 0 : (s.value / total) * w;
			out.push({ key: s.key, x: acc, width, color: s.color });
			acc += width;
		}
		return out;
	});

	function pct(v: number): number {
		return total === 0 ? 0 : Math.round((v / total) * 100);
	}
</script>

<figure class="stacked" bind:this={figEl}>
	<figcaption class="visually-hidden">{ariaLabel}</figcaption>
	{#if inView}
		<div class="wrap" bind:clientWidth={w}>
			<svg class="bar" width={w} height="28" role="img" aria-label={ariaLabel}>
				{#each rects as r (r.key)}
					<rect x={r.x} y="0" width={r.width} height="28" fill={r.color} />
				{/each}
			</svg>
		</div>
		<ul class="legend" role="list">
			{#each segments as s (s.key)}
				<li>
					{#if tappable(s.key)}
						<button type="button" class="seg" onclick={() => onselect?.(s.key)}>
							<span class="swatch" style={`background: ${s.color}`}></span>
							<span class="l">{s.label}</span>
							<span class="c num">{s.value}</span>
							<span class="p num">{pct(s.value)}%</span>
						</button>
					{:else}
						<span class="seg">
							<span class="swatch" style={`background: ${s.color}`}></span>
							<span class="l">{s.label}</span>
							<span class="c num">{s.value}</span>
							<span class="p num">{pct(s.value)}%</span>
						</span>
					{/if}
				</li>
			{/each}
		</ul>
		<div class="visually-hidden">
			<table>
				<caption>{ariaLabel}</caption>
				<thead>
					<tr>
						<th scope="col">Segment</th>
						<th scope="col">Count</th>
						<th scope="col">Share</th>
					</tr>
				</thead>
				<tbody>
					{#each segments as s (s.key)}
						<tr>
							<th scope="row">{s.label}</th>
							<td>{s.value}</td>
							<td>{pct(s.value)}%</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</figure>

<style>
	.stacked {
		margin: 0;
		animation: fade 150ms ease;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.stacked {
			animation: none;
		}
	}

	.wrap {
		border-radius: var(--radius-pill);
		overflow: hidden;
	}
	.bar {
		display: block;
	}

	.legend {
		list-style: none;
		margin: var(--space-sm) 0 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.seg {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		width: 100%;
		min-height: var(--tap);
		padding: 0 var(--space-xs);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
	}
	button.seg:hover {
		background: var(--color-surface-2);
	}
	.swatch {
		flex: none;
		width: 12px;
		height: 12px;
		border-radius: 3px;
	}
	.l {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.c,
	.p {
		flex: none;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
	.p {
		min-width: 4ch;
		text-align: right;
	}
</style>
