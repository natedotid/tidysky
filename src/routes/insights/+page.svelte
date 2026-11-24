<script lang="ts">
	import { scanState } from '#lib/scan/scan-state.svelte';
	import { youState } from '#lib/insights/you-state.svelte';
	import { plural } from '#lib/format';
	import FollowingCards from '#lib/insights/FollowingCards.svelte';
	import YouCards from '#lib/insights/YouCards.svelte';
	import LogoMark from '#lib/ui/LogoMark.svelte';
	import ScanProgress from '#lib/ui/ScanProgress.svelte';
	import SinceLastScan from '#lib/ui/SinceLastScan.svelte';

	let tab = $state<'following' | 'you'>('following');

	function rescan(): void {
		void scanState.startScan({ force: true });
		youState.refresh();
	}

	// Every card footnote carries this while a scan is incomplete.
	const partialNote = $derived(
		scanState.running
			? `Based on ${scanState.scannedSoFar} of ${plural(scanState.accounts.length, 'account', 'accounts')}`
			: null
	);

	// Fetch the "you" read as soon as the account is bound: the Following
	// tab's "how big" marker wants it too. ensure() is a no-op once cached.
	$effect(() => {
		if (scanState.boundKey !== null) void youState.ensure();
	});
</script>

<svelte:head>
	<title>Insights · TidySky</title>
</svelte:head>

<div class="page">
	<header class="app-header">
		<LogoMark size={28} />
		<span class="wordmark">TidySky</span>
	</header>
	<h1>Insights</h1>

	<ScanProgress
		progress={scanState.progress}
		running={scanState.running}
		etaMs={scanState.etaMs}
		followTotal={scanState.followTotal}
		lastFinishedAt={scanState.lastFinishedAt}
		stoppedPhase={scanState.stoppedPhase}
		onStop={() => scanState.cancelScan()}
		onRescan={rescan}
	/>

	{#if scanState.storageError !== null}
		<p class="error" role="alert">{scanState.storageError}</p>
	{:else if scanState.ready}
		<SinceLastScan
			snapshots={scanState.snapshots}
			storeKey={scanState.boundKey}
			source={scanState.source}
		/>
		<div class="tabs">
			<button
				type="button"
				class:sel={tab === 'following'}
				aria-pressed={tab === 'following'}
				onclick={() => (tab = 'following')}
			>
				Following
			</button>
			<button
				type="button"
				class:sel={tab === 'you'}
				aria-pressed={tab === 'you'}
				onclick={() => (tab = 'you')}
			>
				You
			</button>
		</div>
		{#if tab === 'following'}
			<!-- myCreatedAt: the you read is already fetched for this tab's
				"how big" marker, so this costs no extra request. -->
			<FollowingCards
				accounts={scanState.accounts}
				partial={partialNote}
				youValue={youState.data?.profile.followersCount ?? null}
				interactionsScannedAt={scanState.interactionsScannedAt}
				interactionsCoveredSince={scanState.interactionsCoveredSince}
				myCreatedAt={youState.data?.profile.createdAt ?? null}
			/>
		{:else}
			{#if youState.error !== null}
				<p class="error" role="alert">{youState.error}</p>
			{:else if youState.data !== null}
				<YouCards you={youState.data} accounts={scanState.accounts} partial={partialNote} />
			{:else}
				<p class="loading">Loading your own numbers…</p>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.tabs {
		display: flex;
		gap: var(--space-xs);
		margin-top: var(--space-lg);
	}
	.tabs button {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		border-radius: var(--radius-pill);
		padding: 6px 14px;
		min-height: var(--tap);
		cursor: pointer;
	}
	.tabs button.sel {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-on-primary);
	}

	.loading {
		margin-top: var(--space-lg);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.error {
		margin-top: var(--space-lg);
		color: var(--color-danger);
	}
</style>
