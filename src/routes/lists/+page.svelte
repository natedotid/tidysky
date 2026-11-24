<script lang="ts">
	import { page } from '$app/state';

	import { matches, type FilterSpec } from '#lib/filters/filters';
	import { LIST_PRESETS, type Preset } from '#lib/filters/presets';
	import { openStore } from '#lib/db/store';
	import { scanState } from '#lib/scan/scan-state.svelte';
	import type { FollowAccount, ManagedList } from '#lib/scan/types';

	import AddFilterSheet from '#lib/ui/AddFilterSheet.svelte';
	import EditFilterSheet from '#lib/ui/EditFilterSheet.svelte';
	import FilterChips from '#lib/ui/FilterChips.svelte';
	import ListBuilder from '#lib/ui/ListBuilder.svelte';
	import LogoMark from '#lib/ui/LogoMark.svelte';
	import ManagedListRow from '#lib/ui/ManagedListRow.svelte';

	let lists = $state<ManagedList[]>([]);
	let builderOpen = $state(false);
	let builderPreset = $state<Preset | null>(null);
	let builderSpec = $state<FilterSpec | null>(null);
	/** A snapshot of the matching accounts, taken when the builder opened. */
	let builderMembers = $state<FollowAccount[]>([]);

	// The "build from a filter" spec. Page-local: the Clean up tab has its
	// own, and a list stores whatever it was built with.
	let customSpec: FilterSpec = $state({ clauses: [] });
	let addFilterOpen = $state(false);
	/** The chip the edit sheet is open on, or null when it is closed. */
	let customEditIndex = $state<number | null>(null);
	let customEditOpen = $state(false);
	const customEditClause = $derived(
		customEditIndex === null ? null : (customSpec.clauses[customEditIndex] ?? null)
	);

	// ?preset=<id> (from the Insights card) opens the builder once, after
	// the account has bound and its accounts are loaded.
	let presetApplied = $state(false);

	const did = $derived(scanState.source?.did ?? null);
	const ready = $derived(scanState.boundKey !== null && scanState.ready);

	const presetCounts = $derived(
		LIST_PRESETS.map((p) => ({
			p,
			n: scanState.accounts.filter((a) => matches(a, p.spec, new Date())).length
		}))
	);
	/**
	 * The presets that need interaction data can't count before the first
	 * interaction check: they say so, instead of a misleading "0 people".
	 */
	const usesInteractions = (spec: FilterSpec): boolean =>
		spec.clauses.some((c) => c.kind === 'noInteraction' || c.kind === 'interactionsAtLeast');
	const interactionsKnown = $derived(scanState.interactionsScannedAt !== null);
	const customMatches = $derived(
		scanState.accounts.filter((a) => matches(a, customSpec, new Date()))
	);

	async function loadLists(): Promise<void> {
		const key = scanState.boundKey;
		if (key === null) {
			lists = [];
			return;
		}
		try {
			const store = await openStore(key);
			lists = await store.getLists();
		} catch {
			lists = [];
		}
	}

	$effect(() => {
		if (scanState.boundKey !== null) void loadLists();
	});

	$effect(() => {
		if (presetApplied || !ready) return;
		const id = page.url.searchParams.get('preset');
		if (id === null) return;
		const p = LIST_PRESETS.find((x) => x.id === id);
		if (p !== undefined) {
			presetApplied = true;
			openFor(p, p.spec);
		}
	});

	function openFor(preset: Preset | null, spec: FilterSpec): void {
		builderPreset = preset;
		builderSpec = spec;
		builderMembers = scanState.accounts.filter((a) => matches(a, spec, new Date()));
		builderOpen = true;
	}
</script>

<svelte:head>
	<title>Lists · TidySky</title>
</svelte:head>

<div class="page">
	<header class="app-header">
		<LogoMark size={28} />
		<span class="wordmark">TidySky</span>
	</header>

	<h1>Lists</h1>
	<p class="intro">
		Turn the people you follow into lists you can pin in Bluesky and read like a feed.
	</p>

	<section class="section">
		<h2>Start from a preset</h2>
		<div class="presets">
			{#each presetCounts as { p, n } (p.id)}
				<div class="preset">
					<h3 class="name">{p.name}</h3>
					<p class="blurb">{p.blurb}</p>
					{#if usesInteractions(p.spec) && !interactionsKnown}
						<p class="count">Shows up after your next scan</p>
					{:else}
						<p class="count">{n} {n === 1 ? 'person' : 'people'} right now</p>
					{/if}
					<button
						type="button"
						class="build"
						disabled={!ready || scanState.running}
						onclick={() => openFor(p, p.spec)}
					>
						Build
					</button>
				</div>
			{/each}
		</div>
	</section>

	<section class="section">
		<h2>Build from a filter</h2>
		<FilterChips
			clauses={customSpec.clauses}
			onRemove={(i) => (customSpec = { clauses: customSpec.clauses.filter((_, j) => j !== i) })}
			onEdit={(i) => {
				customEditIndex = i;
				customEditOpen = true;
			}}
		/>
		<button type="button" class="add-filter" onclick={() => (addFilterOpen = true)}>
			+ Add filter
		</button>
		<button
			type="button"
			class="build primary"
			disabled={!ready || customSpec.clauses.length === 0 || scanState.running}
			onclick={() => openFor(null, customSpec)}
		>
			Build from a filter{customSpec.clauses.length > 0 ? ` (${customMatches.length})` : ''}
		</button>
	</section>

	<section class="section">
		<h2>Your TidySky lists</h2>
		{#if lists.length === 0}
			<p class="empty">Lists you build appear here.</p>
		{:else}
			<div class="rows">
				{#each lists as l (l.uri)}
					<ManagedListRow
						list={l}
						{did}
						onChanged={() => void loadLists()}
						onDeleted={() => void loadLists()}
					/>
				{/each}
			</div>
		{/if}
	</section>
</div>

<AddFilterSheet
	open={addFilterOpen}
	onAdd={(c) => (customSpec = { clauses: [...customSpec.clauses, c] })}
	onClose={() => (addFilterOpen = false)}
/>

<EditFilterSheet
	open={customEditOpen}
	clause={customEditClause}
	onEdit={(c) => {
		const i = customEditIndex;
		if (i === null) return;
		customSpec = { clauses: customSpec.clauses.map((x, j) => (j === i ? c : x)) };
	}}
	onRemove={() => {
		const i = customEditIndex;
		if (i !== null) customSpec = { clauses: customSpec.clauses.filter((_, j) => j !== i) };
		customEditOpen = false;
		customEditIndex = null;
	}}
	onClose={() => {
		customEditOpen = false;
		customEditIndex = null;
	}}
/>
<ListBuilder
	open={builderOpen}
	preset={builderPreset}
	filterSpec={builderSpec}
	members={builderMembers}
	{did}
	onClose={() => (builderOpen = false)}
	onDone={() => void loadLists()}
/>

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: 0 var(--space-md) 96px;
	}
	.app-header {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-md) 0;
	}
	.wordmark {
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	h1 {
		margin: var(--space-md) 0 var(--space-xs);
		font-size: var(--text-xl);
	}
	.intro {
		margin: 0 0 var(--space-lg);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.section {
		margin-top: var(--space-lg);
	}
	.section h2 {
		margin: 0 0 var(--space-sm);
		font-size: var(--text-md);
	}

	.presets {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: var(--space-sm);
	}
	.preset {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: var(--space-sm) var(--space-md);
		display: grid;
		gap: 4px;
		align-content: start;
	}
	.preset .name {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
	}
	.preset .blurb {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.preset .count {
		margin: var(--space-xs) 0 0;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--color-accent-text);
	}

	.build {
		justify-self: start;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		border-radius: var(--radius-md);
		padding: 8px 12px;
		min-height: var(--tap);
		cursor: pointer;
		margin-top: var(--space-xs);
	}
	.build:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.build.primary {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-on-primary);
	}

	.add-filter {
		border: 1px dashed var(--color-border);
		background: none;
		color: var(--color-text-muted);
		font: inherit;
		font-size: var(--text-sm);
		border-radius: var(--radius-pill);
		padding: 6px 12px;
		min-height: var(--tap);
		cursor: pointer;
		margin: var(--space-xs) 0;
	}

	.empty {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.rows {
		display: grid;
		gap: var(--space-sm);
	}
</style>
