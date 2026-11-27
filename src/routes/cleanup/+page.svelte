<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';

	import { describeError } from '#lib/actions/unfollow';
	import { undoKind } from '#lib/actions/undo';
	import { track } from '#lib/analytics';
	import { currentWriter } from '#lib/actions/writer';
	import { session } from '#lib/atproto/session.svelte';
	import { cleanupState, type Sort } from '#lib/cleanup/cleanup-state.svelte';
	import { keyAction } from '#lib/cleanup/keys';
	import { openStore } from '#lib/db/store';
	import { plural } from '#lib/format';
	import { isAuthFailure } from '#lib/net/errors';
	import { CLEANUP_PRESETS, CLEANUP_ROW_PRESETS } from '#lib/filters/presets';
	import { youState } from '#lib/insights/you-state.svelte';
	import { scanState } from '#lib/scan/scan-state.svelte';
	import type { FollowAccount, UnfollowLogEntry } from '#lib/scan/types';
	import { relativeTime } from '#lib/time';
	import { ROW_HEIGHT } from '#lib/ui/row';

	import AddFilterSheet from '#lib/ui/AddFilterSheet.svelte';
	import EditFilterSheet from '#lib/ui/EditFilterSheet.svelte';
	import FilterChips from '#lib/ui/FilterChips.svelte';
	import FollowRow from '#lib/ui/FollowRow.svelte';
	import PresetSheet from '#lib/ui/PresetSheet.svelte';
	import PreviewSheet from '#lib/ui/PreviewSheet.svelte';
	import RecentChanges from '#lib/ui/RecentChanges.svelte';
	import ReviewSheet from '#lib/ui/ReviewSheet.svelte';
	import SelectionBar from '#lib/ui/SelectionBar.svelte';
	import ShortcutsSheet from '#lib/ui/ShortcutsSheet.svelte';
	import VirtualList from '#lib/ui/VirtualList.svelte';

	let sheetOpen = $state(false);
	let reviewOpen = $state(false);
	let presetSheetOpen = $state(false);
	/**
	 * The row the preview sheet opened with: the sheet keeps showing this
	 * stored row until it is closed, so a filter change or a finished scan
	 * that moves the row out of the list does not blank the sheet. It is
	 * dropped again on close, so the closed sheet holds no account and the
	 * "Select"/"Keep" state it would show is computed from nothing.
	 */
	let previewAccount = $state<FollowAccount | null>(null);
	let previewOpen = $state(false);
	/** The chip the edit sheet is open on, or null when it is closed. */
	let editIndex = $state<number | null>(null);
	let editOpen = $state(false);
	const editClause = $derived(
		editIndex === null ? null : (cleanupState.spec.clauses[editIndex] ?? null)
	);

	/** The row's presets, in CLEANUP_PRESETS order; the rest live in the sheet. */
	const rowPresets = $derived(CLEANUP_PRESETS.filter((p) => CLEANUP_ROW_PRESETS.includes(p.id)));
	/**
	 * The applied preset when it is not one of the row's: it gets its own
	 * selected pill just before "More presets", until another preset is
	 * chosen or the filters are cleared (both reset appliedPreset).
	 */
	const sheetPreset = $derived.by((): (typeof CLEANUP_PRESETS)[number] | null => {
		const id = cleanupState.appliedPreset;
		if (id === null || CLEANUP_ROW_PRESETS.includes(id)) return null;
		return CLEANUP_PRESETS.find((p) => p.id === id) ?? null;
	});

	/** Bumped after a run or an undo so Recent changes re-reads the log. */
	let logRefresh = $state(0);
	let undoEntries: UnfollowLogEntry[] | null = $state(null);
	let undoDialog = $state<HTMLDialogElement | null>(null);
	let undoBusy = $state(false);

	/** Visible result of the last undo attempt; clears itself. */
	let undoNote = $state<{ ok: boolean; text: string } | null>(null);
	/** The session expired mid-undo: a persistent note, not the 6 s one. */
	let undoExpired = $state(false);
	let undoUndone = $state(0);

	const undoExpiredText = $derived.by((): string | null => {
		if (!undoExpired) return null;
		const head =
			undoUndone === 0
				? 'Nothing was undone.'
				: `${undoUndone} ${undoUndone === 1 ? 'was' : 'were'} undone before that; the rest are still in Recent changes.`;
		return `Your Bluesky sign-in expired, so TidySky stopped. ${head}`;
	});

	$effect(() => {
		if (undoNote === null) return;
		const t = setTimeout(() => (undoNote = null), 6000);
		return () => clearTimeout(t);
	});

	// Bind to the account the scan is bound to (loads the keep list).
	$effect(() => {
		const key = scanState.boundKey;
		if (key !== null) void cleanupState.bind(key);
	});

	// A finished scan can add to the log (demo mode seeds one entry). The
	// finish time is set before the log is written, so the snapshot list -
	// written last, after the log seed - is the reliable "the scan is fully
	// done" signal: re-read Recent changes when it changes. The bump is
	// untracked: reading logRefresh in `+=` would make the effect depend on
	// itself and run forever.
	$effect(() => {
		void scanState.lastFinishedAt;
		void scanState.snapshots;
		untrack(() => {
			logRefresh += 1;
		});
	});

	// The "You:" line's "since you joined" wording: your own createdAt from
	// the local cache only. No fetch: this page must not trigger the "you"
	// read (a network read) for it; without a cache the wording falls back.
	let myCreatedAt = $state<string | null>(null);
	$effect(() => {
		const key = scanState.boundKey;
		myCreatedAt = null;
		if (key === null) return;
		void youState.cachedOwnCreatedAt(key).then((c) => {
			if (scanState.boundKey === key) myCreatedAt = c;
		});
	});

	// ?preset=<id> from the URL applies once. ?since=<key> waits
	// for the snapshots the filter is built from; the effect reruns when
	// they load and then applies it.
	$effect(() => {
		if (scanState.boundKey === null) return;
		const since = page.url.searchParams.get('since');
		if (since !== null) {
			if (scanState.snapshots.length >= 2) void cleanupState.applySince(since);
			return;
		}
		cleanupState.applyUrlParams(page.url.searchParams);
	});

	/** Open the preview sheet on the row's stored data (no new requests). */
	function openPreview(did: string): void {
		const a = scanState.accounts.find((x) => x.did === did);
		if (a === undefined) return;
		previewAccount = a;
		previewOpen = true;
	}

	/** The shortcuts sheet, opened by "?" or the button next to the Sort. */
	let shortcutsOpen = $state(false);
	/** The rows wrapper: its top is the virtual list's top, for scrolling. */
	let rowsEl = $state<HTMLElement | null>(null);

	/**
	 * The row keyboard shortcuts: j/k/arrows move the focus, x/Space select,
	 * p keeps, Enter and o open the preview, Escape leaves the rows, ? shows
	 * the shortcuts sheet. The key-to-action decision is pure and tested in
	 * #lib/cleanup/keys; this only reads the focus state and wires the
	 * result. The "current row" is derived from the focus on each press -
	 * the row whose preview button is focused - so there is no row state to
	 * keep in sync.
	 */
	function onKeyDown(e: KeyboardEvent): void {
		const ae = document.activeElement;
		// A dialog is open: it owns the keyboard (Escape closes it natively).
		// Read the DOM, not the Svelte state: the close event that updates
		// the state can land a task after the dialog's `open` attribute is
		// already gone, and a key pressed in that gap must not see a sheet
		// that no longer exists.
		const anyDialogOpen = document.querySelector('dialog[open]') !== null;
		let inEditable = false;
		let onRow = false;
		let did: string | null = null;
		let rowBtn: HTMLElement | null = null;
		if (ae instanceof HTMLElement) {
			inEditable =
				ae.tagName === 'INPUT' ||
				ae.tagName === 'TEXTAREA' ||
				ae.tagName === 'SELECT' ||
				ae.isContentEditable;
			const row = ae.closest('[data-did]');
			// The preview button is the row's focusable name: "open" plus a
			// row ancestor keeps it distinct from any other button.
			onRow = ae.classList.contains('open') && row !== null;
			did = onRow ? (row?.getAttribute('data-did') ?? null) : null;
			rowBtn = onRow ? ae : null;
		}
		const action = keyAction({
			key: e.key,
			shiftKey: e.shiftKey,
			ctrlKey: e.ctrlKey,
			altKey: e.altKey,
			metaKey: e.metaKey,
			inEditable,
			// Escape while a sheet is open closes it natively and returns
			// focus to the opener, so the shortcuts stay out of the way.
			sheetOpen: anyDialogOpen,
			onRow,
			currentIndex: onRow && did !== null ? results.findIndex((a) => a.did === did) : null,
			count: results.length
		});
		if (action.kind === 'ignore') return;
		e.preventDefault();
		switch (action.kind) {
			case 'focusRow':
				focusRow(action.index);
				break;
			case 'toggleSelect':
				if (did !== null) cleanupState.toggle(did);
				break;
			case 'toggleKeep':
				if (did !== null) cleanupState.toggleKeep(did);
				break;
			case 'openPreview':
				if (did !== null) openPreview(did);
				break;
			case 'leaveRow':
				rowBtn?.blur();
				break;
			case 'showShortcuts':
				shortcutsOpen = true;
				break;
		}
	}

	$effect(() => {
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	/**
	 * Make row `index` the current row: focus its preview button (the name +
	 * avatar), so screen readers announce it and Enter opens the preview
	 * natively. The list is virtualized, so a row outside the rendered
	 * window is not in the DOM yet: scroll it into view first, then focus
	 * it once the list has rendered it.
	 */
	function focusRow(index: number): void {
		const item = results[index];
		if (item === undefined) return;
		const findButton = (): HTMLButtonElement | null =>
			document.querySelector<HTMLButtonElement>(`[data-did="${item.did}"] .open`);
		const btn = findButton();
		if (btn !== null) {
			btn.focus();
			return;
		}
		if (rowsEl !== null) {
			const listTop = rowsEl.getBoundingClientRect().top + window.scrollY;
			// A few px of headroom so the focused row is not flush at the
			// top edge.
			window.scrollTo({ top: listTop + index * ROW_HEIGHT - 8 });
		}
		void (async () => {
			for (let i = 0; i < 60; i++) {
				const b = findButton();
				if (b !== null) {
					b.focus();
					return;
				}
				// The scroll event makes the virtual list render the row;
				// poll frames until it is in the DOM.
				await new Promise<void>((r) => requestAnimationFrame(() => r()));
			}
		})();
	}

	const scannedText = $derived.by((): string => {
		if (scanState.running) return 'scan in progress';
		if (scanState.lastFinishedAt === null) return 'scanned never';
		return `scanned ${relativeTime(scanState.lastFinishedAt)}`;
	});

	const results = $derived(cleanupState.results);
	const hasFilters = $derived(cleanupState.spec.clauses.length > 0);
	const noMatches = $derived(hasFilters && results.length === 0);

	const undoWarning = $derived.by((): string => {
		const n = undoEntries?.length ?? 0;
		const base =
			n === 1
				? `Refollowing sends ${undoEntries?.[0].handle} a notification and uses a little of your Bluesky write allowance. Refollow?`
				: `Refollowing sends ${n} people notifications and uses a little of your Bluesky write allowance. Refollow ${n} accounts?`;
		const moved = (undoEntries ?? []).some((e) => e.action === 'move-to-list');
		return moved ? `${base} They'll stay on the list too.` : base;
	});

	function askUndo(entries: UnfollowLogEntry[]): void {
		undoEntries = entries;
		// Unmuting sends no notification and costs almost nothing: no warning.
		if (entries.every((e) => e.action === 'mute')) {
			void doUndo();
			return;
		}
		undoDialog?.showModal();
	}

	async function doUndo(): Promise<void> {
		const entries = undoEntries;
		undoEntries = null;
		undoDialog?.close();
		if (entries === null || entries.length === 0) return;
		const writer = currentWriter();
		const key = scanState.boundKey;
		if (writer === null || key === null) return;
		undoBusy = true;
		undoExpired = false;
		let undone = 0;
		const failed: string[] = [];
		try {
			const store = await openStore(key);
			const toRestore: FollowAccount[] = [];
			for (const entry of entries) {
				try {
					if (undoKind(entry.action) === 'refollow') {
						const res = await writer.createRecord('app.bsky.graph.follow', {
							$type: 'app.bsky.graph.follow',
							subject: entry.did,
							createdAt: new Date().toISOString()
						});
						const rkey = res.uri.split('/').pop() ?? '';
						const existing = scanState.accounts.find((a) => a.did === entry.did);
						// Fresh row (status unknown, the new rkey) so the next
						// scan fills it in; reuse the stored row when present.
						const row: FollowAccount =
							existing !== undefined
								? { ...existing }
								: {
										did: entry.did,
										handle: entry.handle,
										displayName: null,
										avatar: null,
										description: null,
										followRkeys: [],
										followedAt: null,
										createdAt: null,
										followersCount: null,
										followsCount: null,
										postsCount: null,
										followsYou: null,
										viewer: null,
										labels: [],
										status: 'unknown',
										activity: null,
										profileScannedAt: null,
										activityScannedAt: null,
										interaction: null
									};
						row.followRkeys = [rkey];
						row.status = 'unknown';
						toRestore.push(row);
					}
					if (undoKind(entry.action) === 'unmute') {
						await writer.unmuteActor(entry.did);
					}
					if (entry.id !== undefined) {
						await store.markUndone(entry.id, new Date().toISOString());
					}
					undone += 1;
				} catch (e) {
					if (isAuthFailure(e)) {
						// The session is dead: the rest can't succeed, so
						// stop piling up failures.
						undoExpired = true;
						break;
					}
					// Leave this entry in the log; the user can retry the undo.
					failed.push(`${entry.handle} (${describeError(e)})`);
				}
			}
			undoUndone = undone;
			if (toRestore.length > 0) await store.putAccounts(toRestore);
		} finally {
			undoBusy = false;
		}
		if (undone > 0) track('Undo');
		// The persistent expired note (with its Sign in again button) carries
		// the message; the transient one would vanish after six seconds.
		if (!undoExpired && failed.length > 0) {
			undoNote = {
				ok: false,
				text: `Couldn't undo: ${failed.join('; ')}. They're still in Recent changes, so you can try again.`
			};
		} else if (!undoExpired) {
			const mutes = entries.filter((e) => e.action === 'mute');
			const follows = entries.filter((e) => e.action !== 'mute');
			// One entry: name the handle. Several: just the count.
			const part = (list: typeof entries, verb: string): string | null =>
				list.length === 0
					? null
					: `${verb} ${list.length === 1 ? list[0].handle : `${list.length} accounts`}`;
			const parts = [part(mutes, 'Unmuted'), part(follows, 'Refollowed')].filter(
				(p): p is string => p !== null
			);
			undoNote = { ok: true, text: `${parts.join(' and ')}.` };
		}
		await scanState.reloadAccounts();
		logRefresh += 1;
	}
</script>

<svelte:head>
	<title>Clean up · TidySky</title>
</svelte:head>

<div class="page">
	<h1>Clean up</h1>

	{#if scanState.storageError !== null}
		<p class="error" role="alert">{scanState.storageError}</p>
	{:else if !scanState.ready}
		<p class="muted" role="status">Loading your scan…</p>
	{:else}
		<p class="muted">
			Based on {plural(scanState.accounts.length, 'account', 'accounts')} · {scannedText}
		</p>

		<div class="presets" role="list" aria-label="Filter presets">
			{#each rowPresets as p (p.id)}
				<button
					type="button"
					class="preset"
					class:active={cleanupState.appliedPreset === p.id}
					aria-pressed={cleanupState.appliedPreset === p.id}
					onclick={() => cleanupState.applyPreset(p.id)}
				>
					{p.name}
				</button>
			{/each}
			{#if sheetPreset !== null}
				<button
					type="button"
					class="preset active"
					aria-pressed="true"
					onclick={() => cleanupState.applyPreset(sheetPreset.id)}
				>
					{sheetPreset.name}
				</button>
			{/if}
			<button
				type="button"
				class="preset more"
				aria-haspopup="dialog"
				onclick={() => (presetSheetOpen = true)}
			>
				More presets
			</button>
		</div>

		<div class="chips-row">
			<FilterChips
				clauses={cleanupState.spec.clauses}
				onRemove={(i) => cleanupState.removeClause(i)}
				onEdit={(i) => {
					editIndex = i;
					editOpen = true;
				}}
			/>
			<button type="button" class="add-filter" onclick={() => (sheetOpen = true)}>
				+ Add filter
			</button>
		</div>

		{#if hasFilters}
			<div class="results-row">
				<p class="result"><strong>{results.length}</strong> of {scanState.accounts.length} match</p>
				<div class="results-tools">
					<label class="sort">
						Sort
						<select
							value={cleanupState.sort}
							onchange={(e) => cleanupState.setSort(e.currentTarget.value as Sort)}
						>
							<option value="lastActiveAsc">Quietest first</option>
							<option value="interactionAsc">Least recent interaction</option>
							<option value="interactionDesc">Most interactions</option>
							<option value="followedAsc">Oldest follows first</option>
							<option value="rateDesc">Most active first</option>
							<option value="name">Name</option>
						</select>
					</label>
					<!-- Same sheet as "?"; the button only shows where the
						keys work (hover + fine pointer). -->
					<button
						type="button"
						class="shortcuts-btn"
						aria-haspopup="dialog"
						onclick={() => (shortcutsOpen = true)}
					>
						Keyboard shortcuts
					</button>
				</div>
			</div>

			{#if noMatches}
				{#if scanState.running}
					<p class="empty" role="status">Still scanning. More results will appear.</p>
				{:else}
					<p class="empty">Nothing matches. Nice and tidy.</p>
				{/if}
			{:else}
				<!-- The unstyled wrapper is the rows' top for the keyboard
					shortcuts' scroll-into-view. -->
				<div class="rows" bind:this={rowsEl}>
					<VirtualList items={results} rowHeight={ROW_HEIGHT} key={(a) => a.did}>
						{#snippet row(item)}
							<FollowRow
								account={item}
								checked={cleanupState.selected.has(item.did)}
								kept={cleanupState.isKept(item.did)}
								onToggle={(did) => cleanupState.toggle(did)}
								onKeepToggle={(did) => cleanupState.toggleKeep(did)}
								interactionsScannedAt={scanState.interactionsScannedAt}
								interactionsCoveredSince={scanState.interactionsCoveredSince}
								{myCreatedAt}
								onPreview={openPreview}
							/>
						{/snippet}
					</VirtualList>
				</div>

				{#if cleanupState.targets.length > 0}
					<SelectionBar
						count={cleanupState.targets.length}
						matchCount={results.length}
						reviewDisabled={scanState.running}
						onSelectAll={() => cleanupState.selectAll()}
						onClear={() => cleanupState.clearSelection()}
						onReview={() => (reviewOpen = true)}
					/>
				{/if}

				<label class="kept-toggle">
					<input
						type="checkbox"
						checked={cleanupState.showKept}
						onchange={() => cleanupState.toggleShowKept()}
					/>
					Show kept accounts{cleanupState.kept.length > 0 ? ` (${cleanupState.kept.length})` : ''}
				</label>
			{/if}
		{:else}
			<p class="empty">Pick a preset or add a filter to find accounts to tidy up.</p>
		{/if}

		{#if undoNote !== null}
			<p class="undo-note" class:ok={undoNote.ok} role={undoNote.ok ? 'status' : 'alert'}>
				{undoNote.text}
			</p>
		{/if}
		{#if undoExpiredText !== null}
			<p class="undo-note" role="alert">{undoExpiredText}</p>
			<button type="button" class="sign-in-again" onclick={() => session.expire()}>
				Sign in again
			</button>
		{/if}
		<RecentChanges storeKey={scanState.boundKey} refresh={logRefresh} onUndo={askUndo} />
	{/if}
</div>

<AddFilterSheet
	open={sheetOpen}
	onClose={() => (sheetOpen = false)}
	onAdd={(c) => cleanupState.addClause(c)}
/>

<EditFilterSheet
	open={editOpen}
	clause={editClause}
	onEdit={(c) => {
		if (editIndex !== null) cleanupState.setClause(editIndex, c);
	}}
	onRemove={() => {
		if (editIndex !== null) cleanupState.removeClause(editIndex);
		editOpen = false;
		editIndex = null;
	}}
	onClose={() => {
		editOpen = false;
		editIndex = null;
	}}
/>

<PresetSheet
	open={presetSheetOpen}
	presets={CLEANUP_PRESETS}
	applied={cleanupState.appliedPreset}
	onApply={(id) => cleanupState.applyPreset(id)}
	onClose={() => (presetSheetOpen = false)}
/>

<ShortcutsSheet open={shortcutsOpen} onClose={() => (shortcutsOpen = false)} />

<ReviewSheet
	open={reviewOpen}
	onClose={() => (reviewOpen = false)}
	onFinished={() => (logRefresh += 1)}
/>

<PreviewSheet
	open={previewOpen}
	account={previewAccount}
	checked={previewAccount !== null && cleanupState.selected.has(previewAccount.did)}
	kept={previewAccount !== null && cleanupState.isKept(previewAccount.did)}
	onToggle={(did) => cleanupState.toggle(did)}
	onKeepToggle={(did) => cleanupState.toggleKeep(did)}
	interactionsScannedAt={scanState.interactionsScannedAt}
	interactionsCoveredSince={scanState.interactionsCoveredSince}
	{myCreatedAt}
	onClose={() => {
		previewOpen = false;
		previewAccount = null;
	}}
/>

<dialog class="undo-confirm" bind:this={undoDialog}>
	<p>{undoWarning}</p>
	<div class="undo-buttons">
		<button type="button" class="refollow" disabled={undoBusy} onclick={() => void doUndo()}>
			{undoEntries === null || undoEntries.length <= 1
				? 'Refollow'
				: `Refollow ${undoEntries.length}`}
		</button>
		<button type="button" class="cancel" onclick={() => undoDialog?.close()}>Cancel</button>
	</div>
</dialog>

<style>
	h1 {
		margin: 0 0 var(--space-xs);
		font-size: var(--text-2xl);
	}
	.muted {
		margin: 0 0 var(--space-md);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.error {
		margin: 0;
		color: var(--color-danger);
	}
	.undo-note {
		margin: 0 0 var(--space-md);
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
		color: var(--color-text);
		font-size: var(--text-sm);
	}
	.undo-note:not(.ok) {
		color: var(--color-danger);
	}
	.sign-in-again {
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
		margin-bottom: var(--space-md);
	}

	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
		margin-bottom: var(--space-sm);
	}
	.preset {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		border-radius: var(--radius-pill);
		padding: 8px 14px;
		min-height: var(--tap);
		cursor: pointer;
	}
	.preset.active {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: var(--color-on-accent);
		font-weight: 600;
	}
	/* The sheet opener: quieter than the presets themselves. */
	.preset.more {
		border-style: dashed;
		background: transparent;
		color: var(--color-text-muted);
	}

	.chips-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-sm);
		flex-wrap: wrap;
		margin-bottom: var(--space-md);
	}
	.add-filter {
		border: 1px dashed var(--color-border);
		background: transparent;
		color: var(--color-primary);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		border-radius: var(--radius-pill);
		padding: 8px 14px;
		min-height: var(--tap);
		cursor: pointer;
	}

	.results-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-sm);
		margin-bottom: var(--space-sm);
	}
	.result {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.result strong {
		color: var(--color-text);
	}
	.results-tools {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
	}
	.sort {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.sort select {
		font: inherit;
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 4px;
	}
	/* The shortcuts button only shows where the keys work: a hoverable,
	   fine-pointer device. A phone (coarse pointer) never sees it. */
	.shortcuts-btn {
		display: none;
	}
	@media (hover: hover) and (pointer: fine) {
		.shortcuts-btn {
			display: inline-block;
			border: 1px solid var(--color-border);
			background: transparent;
			color: var(--color-text-muted);
			font: inherit;
			font-size: var(--text-sm);
			border-radius: var(--radius-pill);
			padding: 4px 10px;
			min-height: var(--tap);
			cursor: pointer;
		}
		.shortcuts-btn:hover {
			color: var(--color-text);
		}
	}

	.empty {
		margin: var(--space-lg) 0;
		color: var(--color-text-muted);
		text-align: center;
	}

	.kept-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		padding: var(--space-md) 0;
		cursor: pointer;
	}
	.kept-toggle input {
		accent-color: var(--color-primary);
	}

	.undo-confirm {
		position: fixed;
		inset: 0;
		margin: auto;
		width: min(420px, calc(100vw - 32px));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		color: var(--color-text);
		padding: var(--space-md);
	}
	.undo-confirm::backdrop {
		background: rgba(10, 14, 22, 0.5);
	}
	.undo-confirm p {
		margin: 0 0 var(--space-md);
		font-size: var(--text-sm);
	}
	.undo-buttons {
		display: flex;
		gap: var(--space-xs);
	}
	.refollow {
		flex: 1;
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
	.refollow:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.undo-buttons .cancel {
		flex: 1;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		border-radius: var(--radius-md);
		padding: 8px 12px;
		min-height: var(--tap);
		cursor: pointer;
	}
</style>
