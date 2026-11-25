<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Page not found' : 'Something went wrong'} · TidySky</title>
</svelte:head>

<div class="page error-page">
	{#if page.status === 404}
		<h1>Page not found</h1>
		<p>That page doesn't exist.</p>
		<p class="back">
			<a href={resolve('/')}>Back to TidySky</a>
		</p>
	{:else}
		<h1>Something went wrong</h1>
		<p class="back">
			<a href={resolve('/')}>Back to TidySky</a>
		</p>
		<p class="status">{page.status}</p>
	{/if}
</div>

<style>
	/* Centered like the landing page's brand block, not top-aligned like the
	   content pages: an error page has no content to scroll. */
	.error-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		min-height: 100dvh;
		padding: var(--space-md);
	}

	.error-page h1 {
		margin: 0 0 var(--space-sm);
	}

	.error-page p {
		margin: 0 0 var(--space-md);
		color: var(--color-text-muted);
	}

	.status {
		margin-bottom: 0;
		font-size: var(--text-sm);
	}

	.back {
		margin-bottom: 0;
	}

	.back a {
		color: var(--color-primary);
		font-size: var(--text-sm);
		font-weight: 600;
	}
</style>
