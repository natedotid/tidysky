<script lang="ts">
	import Avatar from '#lib/ui/Avatar.svelte';

	/**
	 * An ordered list of rows: avatar, name and a pre-formatted value
	 * ("42/day"). Each row links to the profile on bsky.app.
	 */
	interface Row {
		did: string;
		name: string;
		handle: string;
		avatar: string | null;
		/** Pre-formatted value, e.g. "42/day". */
		value: string;
		/** Screen-reader label for the row, e.g. "Jane Doe, 42 interactions". */
		ariaLabel?: string;
	}
	interface Props {
		rows: Row[];
		/** The main finding in words, for screen readers. */
		ariaLabel?: string;
	}

	let { rows, ariaLabel = 'Ranked list of accounts' }: Props = $props();

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
</script>

<figure class="rank-list" bind:this={figEl}>
	<figcaption class="visually-hidden">{ariaLabel}</figcaption>
	{#if inView}
		<ol role="list">
			{#each rows as r (r.did)}
				<li>
					<a
						class="row"
						href={`https://bsky.app/profile/${r.handle || r.did}`}
						target="_blank"
						rel="external noopener noreferrer"
						aria-label={r.ariaLabel}
					>
						<Avatar src={r.avatar} name={r.name || r.handle || r.did} size={28} />
						<span class="name">{r.name}</span>
						<span class="val num">{r.value}</span>
					</a>
				</li>
			{/each}
		</ol>
	{/if}
</figure>

<style>
	.rank-list {
		margin: 0;
		animation: fade 150ms ease;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.rank-list {
			animation: none;
		}
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		min-height: var(--tap);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		text-decoration: none;
	}
	.row:hover {
		background: var(--color-surface-2);
	}
	.name {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.val {
		flex: none;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
</style>
