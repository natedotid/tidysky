<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';

	import {
		createList,
		listUrl,
		syncMembers,
		validateList,
		writePoints,
		LIST_NAME_MAX,
		LIST_DESCRIPTION_MAX
	} from '#lib/actions/lists';
	import { describeError, type RunControl } from '#lib/actions/unfollow';
	import { currentWriter } from '#lib/actions/writer';
	import { track } from '#lib/analytics';
	import { session } from '#lib/atproto/session.svelte';
	import { CONFIG } from '#lib/config';
	import { openStore } from '#lib/db/store';
	import { isAuthFailure } from '#lib/net/errors';
	import type { FilterSpec } from '#lib/filters/filters';
	import type { Preset } from '#lib/filters/presets';
	import { youState } from '#lib/insights/you-state.svelte';
	import { scanState } from '#lib/scan/scan-state.svelte';
	import type { FollowAccount } from '#lib/scan/types';

	import FollowRow from './FollowRow.svelte';
	import RunProgress from './RunProgress.svelte';
	import VirtualList from './VirtualList.svelte';
	import { ROW_HEIGHT } from './row';

	interface Props {
		open: boolean;
		/** The preset this build started from, or null for a custom filter. */
		preset: Preset | null;
		/** The filter the members come from, stored on the managed list. */
		filterSpec: FilterSpec | null;
		/** A snapshot of the matching accounts, taken when the sheet opened. */
		members: FollowAccount[];
		/** The account that owns the list (for the Open-in-Bluesky link). */
		did: string | null;
		onClose: () => void;
		/** A list was created (or a run stopped): the page reloads its rows. */
		onDone: () => void;
	}

	let { open, preset, filterSpec, members, did, onClose, onDone }: Props = $props();

	type Phase = 'build' | 'running' | 'done';

	let dialog = $state<HTMLDialogElement | null>(null);
	let name = $state('');
	let description = $state('');
	let checked: SvelteSet<string> = new SvelteSet();
	let phase = $state<Phase>('build');
	let done = $state(0);
	let total = $state(0);
	let runPaused = $state(false);
	let error = $state<string | null>(null);
	/** The session expired mid-run: show the sign-in message, not an error. */
	let sessionExpired = $state(false);
	let created: { uri: string; rkey: string } | null = $state(null);

	let runAc: AbortController | null = null;
	let runCtl: RunControl | null = null;
	/** The inner scroller around the member preview (not the dialog). */
	let previewScroll = $state<HTMLElement | null>(null);

	$effect(() => {
		if (open && dialog !== null && !dialog.open) dialog.showModal();
	});

	// The "You:" line's "since you joined" wording: your own createdAt from
	// the local cache only, no fetch (a sheet must not trigger the "you"
	// read for it).
	let myCreatedAt = $state<string | null>(null);
	$effect(() => {
		const key = scanState.boundKey;
		myCreatedAt = null;
		if (key === null) return;
		void youState.cachedOwnCreatedAt(key).then((c) => {
			if (scanState.boundKey === key) myCreatedAt = c;
		});
	});

	// Reset per open, from the preset (or blank for a custom filter).
	$effect(() => {
		if (!open) return;
		name = preset?.name ?? '';
		description = preset?.blurb ?? '';
		checked.clear();
		for (const a of members) checked.add(a.did);
		phase = 'build';
		done = 0;
		total = 0;
		runPaused = false;
		error = null;
		sessionExpired = false;
		created = null;
	});

	const problem = $derived(validateList(name, description));
	const points = $derived(writePoints(checked.size, 0));
	const canCreate = $derived(phase === 'build' && problem === null && checked.size > 0);

	function toggleChecked(did_: string): void {
		if (checked.has(did_)) checked.delete(did_);
		else checked.add(did_);
	}

	function selectAll(): void {
		checked.clear();
		for (const a of members) checked.add(a.did);
	}

	function clearAll(): void {
		checked.clear();
	}

	function close(): void {
		// Fires onclose, which calls onSheetClose() in the markup.
		dialog?.close();
	}

	function onSheetClose(): void {
		// Closing mid-run stops it; the partial list is saved by create().
		if (phase === 'running') stopRun();
		onClose();
	}

	function togglePause(): void {
		if (runCtl === null || phase !== 'running') return;
		runCtl.paused = !runCtl.paused;
		runPaused = runCtl.paused;
	}

	function stopRun(): void {
		if (phase !== 'running') return;
		runAc?.abort();
	}

	/**
	 * Create the list, then add every ticked person. A stop saves the list
	 * with whoever was added so far, so it can be refreshed from the page
	 * instead of being orphaned in Bluesky.
	 */
	async function create(): Promise<void> {
		if (phase !== 'build') return;
		if (problem !== null) {
			error = problem;
			return;
		}
		if (checked.size === 0) {
			error = 'Tick at least one person.';
			return;
		}
		const writer = currentWriter();
		if (writer === null || did === null) {
			error = 'You are signed out, so nothing was changed.';
			return;
		}
		const ac = new AbortController();
		const ctl: RunControl = { paused: false, signal: ac.signal };
		runAc = ac;
		runCtl = ctl;
		phase = 'running';
		done = 0;
		total = checked.size;
		runPaused = false;
		error = null;
		sessionExpired = false;

		const dids = [...checked];
		let createdNow: { uri: string; rkey: string } | null = null;
		let res: Awaited<ReturnType<typeof syncMembers>> | null = null;
		let fatal: string | null = null;
		try {
			createdNow = await createList(writer, did, name, description);
			track('List created');
			res = await syncMembers(writer, createdNow.uri, dids, [], {
				batchSize: CONFIG.writeBatchSize,
				pauseMs: CONFIG.writeBatchPauseMs,
				control: ctl,
				onProgress: (d) => {
					done = d;
				}
			});
		} catch (e) {
			// A stop makes syncMembers return, not throw, so a throw here is
			// either the rare mid-fallback abort or a real error.
			if (!ac.signal.aborted) {
				if (isAuthFailure(e)) sessionExpired = true;
				else fatal = describeError(e);
			}
		}

		if (fatal !== null || sessionExpired) {
			error = createdNow !== null ? `${fatal} The list record may exist in Bluesky.` : fatal;
			phase = 'build';
			onDone();
			return;
		}

		// Finished or stopped: save the list with the people actually added.
		const stopped = ac.signal.aborted;
		const addedDids = res !== null ? res.added : dids.slice(0, done);
		const key = scanState.boundKey;
		if (createdNow !== null && key !== null && addedDids.length > 0) {
			try {
				const store = await openStore(key);
				await store.putList({
					uri: createdNow.uri,
					rkey: createdNow.rkey,
					name: name.trim(),
					description: description.trim(),
					presetId: preset?.id ?? null,
					filterSpec,
					memberDids: addedDids,
					updatedAt: new Date().toISOString()
				});
			} catch {
				// The list exists in Bluesky either way; the row just won't
				// appear on the Lists page.
				error =
					"The list was created in Bluesky, but TidySky could not save it on this device, so it won't appear below.";
			}
		}
		if (stopped) {
			error =
				createdNow === null
					? 'Stopped.'
					: addedDids.length === 0
						? 'Stopped: the list was created in Bluesky, but no one was added yet. You can delete it from the Bluesky app.'
						: `Stopped: ${addedDids.length} ${addedDids.length === 1 ? 'person' : 'people'} were added so far. You can refresh the list below.`;
			phase = 'build';
		} else {
			created = createdNow;
			phase = 'done';
			const failed = res?.failed ?? [];
			if (failed.length > 0) {
				error = `${failed.length} ${
					failed.length === 1 ? 'person could not be' : 'people could not be'
				} added. The list has the other ${addedDids.length}.`;
			}
		}
		onDone();
	}
</script>

<dialog class="builder" bind:this={dialog} onclose={onSheetClose}>
	{#if phase === 'build'}
		<h2>Build a list</h2>

		<label class="field">
			<span class="label-row">
				Name
				<em class="count" class:over={name.trim().length > LIST_NAME_MAX}>
					{name.trim().length}/{LIST_NAME_MAX}
				</em>
			</span>
			<input bind:value={name} placeholder="e.g. Quiet voices" autocomplete="off" />
		</label>

		<label class="field">
			<span class="label-row">
				Description
				<em class="count" class:over={Array.from(description).length > LIST_DESCRIPTION_MAX}>
					{Array.from(description).length}/{LIST_DESCRIPTION_MAX}
				</em>
			</span>
			<textarea bind:value={description} rows={3} placeholder="Optional"></textarea>
		</label>

		{#if problem !== null && (name.trim().length > 0 || description.length > 0)}
			<p class="problem" role="alert">{problem}</p>
		{/if}

		<div class="note" role="note">
			Lists on Bluesky are public. Anyone can find this list and see who's on it. Pick a name you'd
			be happy for them to see.
		</div>

		{#if points > 1500}
			<p class="points">
				This uses about {points} of your 5,000-an-hour Bluesky write allowance.
			</p>
		{/if}
		{#if sessionExpired}
			<p class="problem" role="alert">
				Your Bluesky sign-in expired, so TidySky stopped. {done}
				{done === 1 ? 'was' : 'were'} changed before that; nothing after was touched.
			</p>
			<button type="button" class="confirm primary" onclick={() => session.expire()}>
				Sign in again
			</button>
		{:else if error !== null}
			<p class="problem" role="alert">{error}</p>
		{/if}

		<p class="member-count">
			<strong>{checked.size}</strong> of {members.length} people
		</p>
		<div class="preview" class:empty={members.length === 0}>
			{#if members.length > 0}
				<div class="preview-scroll" bind:this={previewScroll}>
					<VirtualList
						items={members}
						rowHeight={ROW_HEIGHT}
						key={(a) => a.did}
						scroller={previewScroll}
					>
						{#snippet row(item)}
							<FollowRow
								account={item}
								checked={checked.has(item.did)}
								kept={false}
								onToggle={toggleChecked}
								onKeepToggle={() => {}}
								interactionsScannedAt={scanState.interactionsScannedAt}
								interactionsCoveredSince={scanState.interactionsCoveredSince}
								{myCreatedAt}
							/>
						{/snippet}
					</VirtualList>
				</div>
			{:else}
				<p class="no-members">No one matches right now.</p>
			{/if}
		</div>
		{#if members.length > 0}
			<div class="select-all">
				<button type="button" onclick={selectAll}>Select all {members.length}</button>
				<button type="button" onclick={clearAll}>Clear</button>
			</div>
		{/if}

		<div class="buttons">
			<button
				type="button"
				class="confirm primary"
				disabled={!canCreate}
				onclick={() => void create()}
			>
				Create list ({checked.size}
				{checked.size === 1 ? 'person' : 'people'})
			</button>
			<button type="button" class="cancel" onclick={close}>Cancel</button>
		</div>
	{:else if phase === 'running'}
		<h2>Creating "{name.trim()}"</h2>
		<RunProgress
			running={true}
			verb="list"
			{done}
			failed={0}
			{total}
			cancelled={false}
			paused={runPaused}
			error={null}
			failures={[]}
			onTogglePause={togglePause}
			onStop={stopRun}
			onClose={close}
		/>
	{:else}
		<h2>List ready</h2>
		<p class="ready">
			Your list is ready. Open it in Bluesky, then tap <strong>Pin to home</strong> to read it as a feed.
		</p>
		{#if error !== null}
			<p class="problem" role="alert">{error}</p>
		{/if}
		{#if created !== null && did !== null}
			<a
				class="confirm primary open"
				href={listUrl(did, created.rkey)}
				target="_blank"
				rel="external noopener noreferrer"
			>
				Open in Bluesky
			</a>
		{/if}
		<button type="button" class="cancel" onclick={close}>Close</button>
	{/if}
</dialog>

<style>
	.builder {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		max-height: 100%;
		margin: 0;
		border: none;
		border-radius: 0;
		background: var(--color-surface);
		color: var(--color-text);
		padding: var(--space-md);
		overflow-y: auto;
	}
	@media (min-width: 640px) {
		.builder {
			position: static;
			width: min(560px, calc(100vw - 32px));
			height: auto;
			max-height: 85dvh;
			overflow-y: auto;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
		}
	}
	.builder::backdrop {
		background: rgba(10, 14, 22, 0.5);
	}

	h2 {
		margin: 0 0 var(--space-md);
		font-size: var(--text-lg);
	}

	.field {
		display: block;
		margin-bottom: var(--space-sm);
	}
	.label-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-size: var(--text-sm);
		font-weight: 600;
		margin-bottom: 4px;
	}
	.count {
		font-style: normal;
		font-weight: 400;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
	.count.over {
		color: var(--color-danger);
	}
	.field input,
	.field textarea {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		padding: 8px 10px;
	}
	.field textarea {
		resize: vertical;
	}

	.problem {
		margin: var(--space-xs) 0;
		font-size: var(--text-sm);
		color: var(--color-danger);
	}
	.problem + .confirm.primary {
		margin: var(--space-xs) 0 var(--space-sm);
	}

	.note {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
		padding: var(--space-sm);
		font-size: var(--text-sm);
		margin: var(--space-sm) 0;
	}
	.points {
		margin: 0 0 var(--space-sm);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.member-count {
		margin: var(--space-sm) 0 var(--space-xs);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.member-count strong {
		color: var(--color-text);
	}
	.preview {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin-bottom: var(--space-xs);
	}
	.preview.empty {
		padding: var(--space-md);
	}
	.preview-scroll {
		max-height: min(50vh, 420px);
		overflow-y: auto;
	}
	.no-members {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.select-all {
		display: flex;
		gap: var(--space-xs);
		margin-bottom: var(--space-sm);
	}
	.select-all button {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		border-radius: var(--radius-pill);
		padding: 6px 12px;
		min-height: var(--tap);
		cursor: pointer;
	}

	.buttons {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		margin-top: var(--space-md);
	}
	.confirm.primary {
		border: 1px solid var(--color-primary);
		background: var(--color-primary);
		color: var(--color-on-primary);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		border-radius: var(--radius-md);
		padding: 8px 12px;
		min-height: var(--tap);
		cursor: pointer;
	}
	.confirm.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.confirm.primary.open {
		display: block;
		text-align: center;
		text-decoration: none;
		margin-bottom: var(--space-xs);
	}
	.cancel {
		border: none;
		background: none;
		color: var(--color-text-muted);
		font: inherit;
		font-size: var(--text-sm);
		padding: 8px 12px;
		min-height: var(--tap);
		cursor: pointer;
	}

	.ready {
		margin: 0 0 var(--space-md);
		font-size: var(--text-sm);
	}
</style>
