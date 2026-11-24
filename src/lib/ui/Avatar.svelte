<script lang="ts">
	interface Props {
		src: string | null;
		/** Display name or handle, for the initial-letter fallback. */
		name: string;
		size?: number;
	}

	let { src, name, size = 40 }: Props = $props();
	let failed = $state(false);

	const initial = $derived((name.trim()[0] ?? '?').toUpperCase());
	const showImg = $derived(src !== null && !failed);
	const dims = $derived(`width:${size}px;height:${size}px`);
</script>

{#if showImg}
	<img
		{src}
		width={size}
		height={size}
		loading="lazy"
		decoding="async"
		alt=""
		class="avatar"
		style={dims}
		onerror={() => (failed = true)}
	/>
{:else}
	<span class="avatar fallback" style={dims} aria-hidden="true">{initial}</span>
{/if}

<style>
	.avatar {
		border-radius: 50%;
		object-fit: cover;
		flex: none;
	}
	.fallback {
		display: grid;
		place-items: center;
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		font-weight: 600;
	}
</style>
