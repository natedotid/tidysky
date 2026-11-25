<script lang="ts">
	import { deleteList, diffMembers, listUrl, syncMembers } from '#lib/actions/lists';
	import { describeError, type RunControl } from '#lib/actions/unfollow';
	import { currentWriter } from '#lib/actions/writer';
	import { session } from '#lib/atproto/session.svelte';
	import { CONFIG } from '#lib/config';
	import { openStore } from '#lib/db/store';
	import { matches, type FilterSpec } from '#lib/filters/filters';
	import { isAuthFailure } from '#lib/net/errors';
	import { scanState } from '#lib/scan/scan-state.svelte';
	import type { DataSource } from '#lib/scan/source';
	import type { ManagedList } from '#lib/scan/types';
	import { relativeTime } from '#lib/time';

	interface Props {
		list: ManagedList;
		/** The account that owns the list (for the Open-in-Bluesky link). */
		did: string | null;
		/** Membership changed in Bluesky: the page reloads its rows. */
		onChanged: () => void;
		/** The list was deleted from Bluesky and the store. */
		onDeleted: () => void;
	}

	let { list, did, onChanged, onDeleted }: Props = $props();

	type Mode = 'none' | 'refresh' | 'delete';
	let mode = $state<Mode>('none');
	let dialog = $state<HTMLDialogElement | null>(null);

	// Refresh: the diff is read-only; nothing is written before the tap.
	let reading = $state(false);
	let readError = $state<string | null>(null);
	let diff = $state<{ add: string[]; remove: Array<{ did: string; rkey: string }> } | null>(null);
	/** The membership as read from Bluesky, when the diff was computed. */
	let currentDids = $state<string[]>([]);
	let applying = $state(false);
	let applyDone = $state(0);
	let applyTotal = $state(0);
	let applyError = $state<string | null>(null);

	// Delete.
	let deleting = $state(false);
	let deleteDone = $state(0);
	let deleteTotal = $state(0);
	let deleteError = $state<string | null>(null);

	/** The session expired mid-run: show the sign-in message, not an error. */
	let sessionExpired = $state(false);

	/** The expired-session result line, in this row's own terms. */
	const expiredText = $derived.by((): string | null => {
		if (!sessionExpired) return null;
		const done = mode === 'delete' ? deleteDone : applyDone;
		const head =
			done === 0
				? 'Nothing was changed.'
				: `${done} ${done === 1 ? 'was' : 'were'} changed before that; nothing after was touched.`;
		return `Your Bluesky sign-in expired, so TidySky stopped. ${head}`;
	});

	let ac: AbortController | null = null;

	const count = $derived(list.memberDids.length);
	const busy = $derived(mode !== 'none' || applying || deleting);

	$effect(() => {
		if (mode !== 'none' && dialog !== null && !dialog.open) dialog.showModal();
	});

	function nameOf(didStr: string): string {
		const a = scanState.accounts.find((x) => x.did === didStr);
		return a?.displayName ?? a?.handle ?? didStr;
	}

	/** Every listitem of this list, from the source: the truth of membership. */
	async function allListItems(src: DataSource): Promise<Array<{ did: string; rkey: string }>> {
		const out: Array<{ did: string; rkey: string }> = [];
		let cursor: string | undefined;
		do {
			const page = await src.listListItems(cursor);
			for (const r of page.records)
				if (r.list === list.uri) out.push({ did: r.subject, rkey: r.rkey });
			cursor = page.cursor;
		} while (cursor !== undefined);
		return out;
	}

	function reset(): void {
		reading = false;
		readError = null;
		diff = null;
		currentDids = [];
		applying = false;
		applyDone = 0;
		applyTotal = 0;
		applyError = null;
		deleting = false;
		deleteDone = 0;
		deleteTotal = 0;
		deleteError = null;
		sessionExpired = false;
	}

	function openDelete(): void {
		if (busy) return;
		reset();
		mode = 'delete';
	}

	async function openRefresh(): Promise<void> {
		if (busy) return;
		reset();
		mode = 'refresh';
		reading = true;
		const src = scanState.source;
		if (src === null) {
			readError = "The list's members can't be read right now.";
			reading = false;
			return;
		}
		const spec = list.filterSpec as FilterSpec;
		if (spec === null || spec === undefined) {
			readError = "This list has no saved filter, so it can't be refreshed.";
			reading = false;
			return;
		}
		try {
			const items = await allListItems(src);
			currentDids = items.map((i) => i.did);
			const current = new Map(items.map((i) => [i.did, i.rkey]));
			const desired = scanState.accounts
				.filter((a) => matches(a, spec, new Date()))
				.map((a) => a.did);
			diff = diffMembers(desired, current);
		} catch (e) {
			if (isAuthFailure(e)) sessionExpired = true;
			else readError = describeError(e);
		} finally {
			reading = false;
		}
	}

	function stopRun(): void {
		ac?.abort();
	}

	/**
	 * Write the diff to Bluesky, then save the membership the list actually
	 * has: what was read, minus what removed, plus what added. A stop saves
	 * the partial result the same way, so the row stays honest.
	 */
	async function applyChanges(): Promise<void> {
		if (applying || diff === null) return;
		const writer = currentWriter();
		if (writer === null) {
			applyError = 'You are signed out, so nothing was changed.';
			return;
		}
		const acx = new AbortController();
		const ctl: RunControl = { paused: false, signal: acx.signal };
		ac = acx;
		applying = true;
		applyDone = 0;
		applyTotal = diff.add.length + diff.remove.length;
		applyError = null;
		try {
			const res = await syncMembers(writer, list.uri, diff.add, diff.remove, {
				batchSize: CONFIG.writeBatchSize,
				pauseMs: CONFIG.writeBatchPauseMs,
				control: ctl,
				onProgress: (d) => {
					applyDone = d;
				}
			});
			const failedSet = new Set(res.failed.map((f) => f.did));
			// Failed removes stay in the list; successful ones leave.
			const removed = new Set(diff.remove.map((r) => r.did));
			const stays = new Set(diff.remove.filter((r) => failedSet.has(r.did)).map((r) => r.did));
			const next = currentDids.filter((d) => stays.has(d) || !removed.has(d));
			for (const d of res.added) if (!next.includes(d)) next.push(d);
			const key = scanState.boundKey;
			if (key !== null && next.length > 0) {
				const store = await openStore(key);
				await store.putList({ ...list, memberDids: next, updatedAt: new Date().toISOString() });
			}
			onChanged();
		} catch (e) {
			if (!acx.signal.aborted) {
				if (isAuthFailure(e)) sessionExpired = true;
				else applyError = describeError(e);
			}
		} finally {
			applying = false;
		}
		// The diff is spent: close whether it applied, stopped, or errored,
		// except an expired session, whose message and Sign in again button
		// need the sheet open.
		if (!sessionExpired) close();
	}

	/**
	 * Remove every member, then the list record. A failed member leaves the
	 * list in place (deleteList says so) so a retry is safe.
	 */
	async function doDelete(): Promise<void> {
		if (deleting) return;
		const writer = currentWriter();
		if (writer === null) {
			deleteError = 'You are signed out, so nothing was changed.';
			return;
		}
		const src = scanState.source;
		if (src === null) {
			deleteError = "The list's members can't be read right now, so it can't be deleted.";
			return;
		}
		const acx = new AbortController();
		const ctl: RunControl = { paused: false, signal: acx.signal };
		ac = acx;
		deleting = true;
		deleteDone = 0;
		deleteTotal = 0;
		deleteError = null;
		try {
			const items = await allListItems(src);
			deleteTotal = items.length + 1;
			await deleteList(
				writer,
				list.rkey,
				items.map((i) => i.rkey),
				{
					batchSize: CONFIG.writeBatchSize,
					pauseMs: CONFIG.writeBatchPauseMs,
					control: ctl,
					onProgress: (d, t) => {
						deleteDone = d;
						deleteTotal = t;
					}
				}
			);
			const key = scanState.boundKey;
			if (key !== null) {
				const store = await openStore(key);
				await store.deleteList(list.uri);
			}
			onDeleted();
			close();
		} catch (e) {
			if (acx.signal.aborted) {
				deleteError = 'Stopped. The list may be partly deleted. Try again.';
			} else if (isAuthFailure(e)) {
				sessionExpired = true;
			} else {
				// deleteList throws its own message for the "member failed"
				// case; describeError would flatten a plain Error to
				// "Network error".
				deleteError = e instanceof Error && e.message !== '' ? e.message : describeError(e);
			}
			deleting = false;
		}
	}

	function close(): void {
		// Fires onclose, which resets the mode.
		dialog?.close();
	}
</script>

<div class="card">
	<div class="info">
		<h3 class="name">{list.name}</h3>
		<p class="sub">
			{count}
			{count === 1 ? 'person' : 'people'} · Updated {relativeTime(list.updatedAt)}
		</p>
	</div>
	<div class="actions">
		{#if did !== null}
			<a
				class="btn"
				href={listUrl(did, list.rkey)}
				target="_blank"
				rel="external noopener noreferrer"
			>
				Open in Bluesky
			</a>
		{/if}
		<button
			type="button"
			class="btn"
			disabled={busy || scanState.running}
			onclick={() => void openRefresh()}
		>
			Refresh
		</button>
		<button type="button" class="btn danger" disabled={busy} onclick={openDelete}>Delete</button>
	</div>
</div>

<dialog
	class="sheet"
	bind:this={dialog}
	onclose={() => {
		mode = 'none';
	}}
>
	{#if mode === 'refresh'}
		<h2>Refresh "{list.name}"</h2>
		{#if reading}
			<p class="status" role="status">Reading the list…</p>
		{:else if sessionExpired}
			<p class="error" role="alert">{expiredText}</p>
			<div class="buttons">
				<button type="button" class="confirm primary" onclick={() => session.expire()}>
					Sign in again
				</button>
				<button type="button" class="cancel" onclick={close}>Close</button>
			</div>
		{:else if readError !== null}
			<p class="error" role="alert">{readError}</p>
			<button type="button" class="cancel" onclick={close}>Close</button>
		{:else if diff !== null}
			{#if diff.add.length === 0 && diff.remove.length === 0}
				<p class="uptodate">Up to date. Nothing to change.</p>
				<button type="button" class="cancel" onclick={close}>Close</button>
			{:else}
				<p class="summary">
					{#if diff.add.length > 0}<span class="add">+{diff.add.length} to add</span>{/if}
					{#if diff.add.length > 0 && diff.remove.length > 0}<span> · </span>{/if}
					{#if diff.remove.length > 0}<span class="remove">
							−{diff.remove.length} to remove
						</span>{/if}
				</p>
				{#if diff.add.length > 0}
					<h3>Add</h3>
					<ul class="names">
						{#each diff.add as d (d)}
							<li>{nameOf(d)}</li>
						{/each}
					</ul>
				{/if}
				{#if diff.remove.length > 0}
					<h3>Remove</h3>
					<ul class="names">
						{#each diff.remove as r (r.rkey)}
							<li>{nameOf(r.did)}</li>
						{/each}
					</ul>
				{/if}
				{#if sessionExpired}
					<p class="error" role="alert">{expiredText}</p>
					<button type="button" class="confirm primary" onclick={() => session.expire()}>
						Sign in again
					</button>
				{:else if applyError !== null}
					<p class="error" role="alert">{applyError}</p>
				{/if}
				{#if applying}
					<div
						class="bar"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={applyTotal}
						aria-valuenow={applyDone}
					>
						<div
							class="fill"
							style={`width: ${applyTotal === 0 ? 0 : Math.round((applyDone / applyTotal) * 100)}%`}
						></div>
					</div>
					<p class="status" role="status">Updating {applyDone} of {applyTotal}</p>
					<button type="button" class="btn stop" onclick={stopRun}>Stop</button>
				{:else}
					<div class="buttons">
						<button
							type="button"
							class="confirm primary"
							disabled={applyError !== null || sessionExpired || scanState.running}
							onclick={() => void applyChanges()}
						>
							Apply changes
						</button>
						<button type="button" class="cancel" onclick={close}>Cancel</button>
					</div>
				{/if}
			{/if}
		{/if}
	{:else if mode === 'delete'}
		<h2>Delete "{list.name}"</h2>
		{#if deleting}
			<p class="confirm-text">Removing {count} {count === 1 ? 'person' : 'people'}…</p>
			<div
				class="bar"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={deleteTotal}
				aria-valuenow={deleteDone}
			>
				<div
					class="fill"
					style={`width: ${deleteTotal === 0 ? 0 : Math.round((deleteDone / deleteTotal) * 100)}%`}
				></div>
			</div>
			<p class="status" role="status">Deleting {deleteDone} of {deleteTotal}</p>
			<button type="button" class="btn stop" onclick={stopRun}>Stop</button>
		{:else if sessionExpired}
			<p class="error" role="alert">{expiredText}</p>
			<div class="buttons">
				<button type="button" class="confirm primary" onclick={() => session.expire()}>
					Sign in again
				</button>
				<button type="button" class="cancel" onclick={close}>Close</button>
			</div>
		{:else if deleteError !== null}
			<p class="error" role="alert">{deleteError}</p>
			<button type="button" class="cancel" onclick={close}>Close</button>
		{:else}
			<p class="confirm-text">
				Delete "{list.name}" from Bluesky? This removes the list for everyone who uses it.
			</p>
			<div class="buttons">
				<button type="button" class="confirm danger" onclick={() => void doDelete()}>
					Delete list
				</button>
				<button type="button" class="cancel" onclick={close}>Cancel</button>
			</div>
		{/if}
	{/if}
</dialog>

<style>
	.card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		padding: var(--space-sm) var(--space-md);
	}
	.info {
		min-width: 0;
	}
	.name {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		margin: 2px 0 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
	.actions {
		display: flex;
		gap: var(--space-xs);
		flex-shrink: 0;
	}

	.btn {
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
		text-decoration: none;
		text-align: center;
		white-space: nowrap;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.danger {
		color: var(--color-danger);
		border-color: var(--color-danger);
	}
	.btn.stop {
		color: var(--color-danger);
		border-color: var(--color-danger);
		margin-top: var(--space-sm);
	}

	.sheet {
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
		.sheet {
			position: static;
			width: min(480px, calc(100vw - 32px));
			height: auto;
			max-height: 85dvh;
			overflow-y: auto;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
		}
	}
	.sheet::backdrop {
		background: rgba(10, 14, 22, 0.5);
	}

	h2 {
		margin: 0 0 var(--space-md);
		font-size: var(--text-lg);
	}
	h3 {
		margin: var(--space-md) 0 var(--space-xs);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.status,
	.uptodate {
		margin: 0 0 var(--space-sm);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.summary {
		margin: 0 0 var(--space-sm);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.summary .add {
		color: var(--color-accent-text);
	}
	.summary .remove {
		color: var(--color-danger);
	}
	.names {
		list-style: none;
		margin: 0 0 var(--space-sm);
		padding: 0;
		display: grid;
		/* A long account name must ellipsize, not widen the pill past the
			viewport (an auto column would grow to the nowrap text's width). */
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-xs);
	}
	.names li {
		font-size: var(--text-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-xs) var(--space-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.error {
		margin: 0 0 var(--space-sm);
		font-size: var(--text-sm);
		color: var(--color-danger);
	}
	.confirm-text {
		margin: 0 0 var(--space-md);
		font-size: var(--text-sm);
	}

	.bar {
		height: 10px;
		border-radius: var(--radius-pill);
		background: var(--color-surface-2);
		overflow: hidden;
		margin-bottom: var(--space-xs);
	}
	.fill {
		height: 100%;
		border-radius: var(--radius-pill);
		background: var(--color-accent);
		transition: width 200ms ease;
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
	.confirm.danger {
		border: 1px solid var(--color-danger);
		background: var(--color-danger);
		color: var(--color-on-primary);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		border-radius: var(--radius-md);
		padding: 8px 12px;
		min-height: var(--tap);
		cursor: pointer;
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
</style>
