<script lang="ts">
	import { createList, syncMembers, validateList } from '#lib/actions/lists';
	import { runMutes } from '#lib/actions/mute';
	import { isGoneType, preflight } from '#lib/actions/preflight';
	import { describeError, runUnfollows, type RunControl } from '#lib/actions/unfollow';
	import { currentWriter } from '#lib/actions/writer';
	import { track } from '#lib/analytics';
	import { session } from '#lib/atproto/session.svelte';
	import { CONFIG } from '#lib/config';
	import { downloadCsv } from '#lib/cleanup/csv';
	import { cleanupState } from '#lib/cleanup/cleanup-state.svelte';
	import { openStore } from '#lib/db/store';
	import { describe } from '#lib/filters/filters';
	import { plural } from '#lib/format';
	import { isAuthFailure } from '#lib/net/errors';
	import { scanState } from '#lib/scan/scan-state.svelte';
	import type { FollowAccount, ManagedList } from '#lib/scan/types';

	import Avatar from './Avatar.svelte';
	import RunProgress from './RunProgress.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		/** Called once when a run ends (finished, stopped, or errored). */
		onFinished?: () => void;
	}

	let { open, onClose, onFinished }: Props = $props();

	/** The controls a Tab trap should cycle through, in DOM order. */
	const FOCUSABLE_SELECTOR =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	type Phase = 'review' | 'running' | 'finished';

	let dialog = $state<HTMLDialogElement | null>(null);
	let action = $state<'unfollow' | 'moveToList' | 'addToList' | 'mute'>('unfollow');
	/** Unfollows logged in the last 24 h; null while unknown. */
	let already = $state<number | null>(null);
	let understand = $state(false);

	// The list picker for "Add to a list" / "Move to a list, then unfollow".
	let managed = $state<ManagedList[]>([]);
	/** The picked list's uri, or 'new'. */
	let listPick = $state('new');
	let newListName = $state('');

	let phase = $state<Phase>('review');
	let runDone = $state(0);
	let runFailed = $state(0);
	let runTotal = $state(0);
	let runPaused = $state(false);
	let runCancelled = $state(false);
	let runError = $state<string | null>(null);
	let failures = $state<Array<{ name: string; error: string }>>([]);
	let runAc: AbortController | null = null;
	let runCtl: RunControl | null = null;
	/** What the live run is doing right now (a move has two stages). */
	let runVerb = $state<'unfollow' | 'mute' | 'list'>('unfollow');

	// The double-check that re-verifies gone-type accounts before an
	// unfollow or a move, so a live account is never unfollowed.
	let checking = $state(false);
	let checkTotal = $state(0);
	let preflightNote = $state<string | null>(null);
	/** The Bluesky session died mid-run: stop and show the sign-in message. */
	let sessionExpired = $state(false);

	// Selected AND visible under the current filter AND not kept, in
	// on-screen order: "Do N now" takes the first N the user can see.
	const targets = $derived(cleanupState.targets);
	const n = $derived(targets.length);
	const why = $derived(describe(cleanupState.spec));
	const shown = $derived(targets.slice(0, 50));
	// Mute needs the rpc: scope. Demo mode simulates everything and has no
	// granted scope to check.
	const muteAvailable = $derived(session.demo || session.hasScope('rpc:app.bsky.graph.muteActor'));

	const title = $derived.by((): string => {
		if (runVerb === 'mute') return phase === 'running' ? 'Muting' : 'Mute finished';
		if (runVerb === 'list') return phase === 'running' ? 'Adding to the list' : 'Add finished';
		return phase === 'running' ? 'Unfollowing' : 'Unfollow finished';
	});

	// The user's daily-unfollow suggestion, saved in the scan meta (Settings);
	// the CONFIG value is the default for accounts that never changed it.
	let limit = $state<number>(CONFIG.softDailyUnfollowLimit);
	// A move unfollows too, so the daily limit applies to it.
	const warn = $derived(
		(action === 'unfollow' || action === 'moveToList') && already !== null && already + n > limit
	);
	const remaining = $derived(Math.max(0, limit - (already ?? 0)));

	const listAction = $derived(action === 'moveToList' || action === 'addToList');
	const pickedList = $derived(managed.find((l) => l.uri === listPick) ?? null);
	const listName = $derived(listPick === 'new' ? newListName.trim() : (pickedList?.name ?? ''));
	const listNameInvalid = $derived(
		listPick === 'new' && (newListName.trim() === '' || validateList(newListName, '') !== null)
	);

	$effect(() => {
		if (open && dialog !== null && !dialog.open) dialog.showModal();
	});

	// Reset per open. The daily-limit check only applies to unfollows.
	$effect(() => {
		if (!open) {
			action = 'unfollow';
			already = null;
			limit = CONFIG.softDailyUnfollowLimit;
			understand = false;
			phase = 'review';
			runDone = 0;
			runFailed = 0;
			runTotal = 0;
			runPaused = false;
			runCancelled = false;
			runError = null;
			failures = [];
			runAc = null;
			runCtl = null;
			runVerb = 'unfollow';
			checking = false;
			checkTotal = 0;
			preflightNote = null;
			sessionExpired = false;
			managed = [];
			listPick = 'new';
			newListName = '';
			return;
		}
		// A move unfollows, so it needs the daily-limit count too.
		if (action !== 'unfollow' && action !== 'moveToList') {
			already = null;
			return;
		}
		already = null;
		const key = scanState.boundKey;
		if (key === null) return;
		void (async () => {
			const store = await openStore(key).catch(() => null);
			if (store === null) {
				already = null;
				return;
			}
			try {
				already = await store.countUnfollowsSince(new Date(Date.now() - 86_400_000).toISOString());
			} catch {
				already = null;
			}
			limit =
				(await store.getMeta().catch(() => null))?.dailyUnfollowLimit ??
				CONFIG.softDailyUnfollowLimit;
			managed = await store.getLists().catch(() => []);
		})();
	});

	function close(): void {
		// Fires onclose, which calls onSheetClose() in the markup.
		dialog?.close();
	}

	/**
	 * The native <dialog> modal already traps focus, but guard the wrap
	 * explicitly so Tab/Shift+Tab always cycle the sheet's controls and focus
	 * can never sit on the page behind it.
	 */
	function trapFocus(e: KeyboardEvent): void {
		if (e.key !== 'Tab') return;
		const root = e.currentTarget as HTMLDialogElement;
		const focusables = [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
			(el) => el.getClientRects().length > 0
		);
		if (focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		const active = document.activeElement;
		const outside = !root.contains(active);
		if (e.shiftKey) {
			if (active === first || outside) {
				e.preventDefault();
				last.focus();
			}
		} else if (active === last || outside) {
			e.preventDefault();
			first.focus();
		}
	}

	function onSheetClose(): void {
		// Closing mid-run (backdrop, Esc) stops the run rather than letting it
		// keep unfollowing invisibly.
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
	 * Before an unfollow or a move, re-check the accounts the scan marked
	 * deactivated/takendown/gone: a profile that comes back means the
	 * account is alive, and it is left out of the run. Never runs in the
	 * demo, whose fake profiles would "find" every account. Aborts
	 * propagate; a failed re-check keeps the accounts in the run and notes
	 * how many went unchecked.
	 */
	async function doubleCheck(list: FollowAccount[], signal: AbortSignal): Promise<FollowAccount[]> {
		if (session.demo) return list;
		const src = scanState.source;
		if (src === null) return list;
		const toCheck = list.filter(isGoneType).length;
		if (toCheck === 0) return list;
		checkTotal = toCheck;
		checking = true;
		preflightNote = null;
		try {
			const res = await preflight(src, list, signal);
			if (res.stillThere.length > 0) {
				const n = res.stillThere.length;
				preflightNote =
					n === 1
						? '1 of these accounts is still active on Bluesky, so it was left out.'
						: `${n} of these accounts are still active on Bluesky, so they were left out.`;
			} else if (res.unchecked > 0) {
				preflightNote = `Couldn't double-check ${plural(res.unchecked, 'account', 'accounts')}.`;
			}
			return res.run;
		} finally {
			checking = false;
		}
	}

	/** 'remaining' is the "Do N now" button under the daily-limit warning. */
	async function confirm(kind: 'all' | 'remaining'): Promise<void> {
		if (phase !== 'review') return;
		const list = kind === 'remaining' ? targets.slice(0, remaining) : targets;
		if (list.length === 0) return;
		if (listAction) {
			void confirmList(list);
			return;
		}
		const writer = currentWriter();
		if (writer === null) {
			runTotal = list.length;
			runError = 'You are signed out, so nothing was changed.';
			phase = 'finished';
			return;
		}
		const ac = new AbortController();
		const ctl: RunControl = { paused: false, signal: ac.signal };
		runAc = ac;
		runCtl = ctl;
		runDone = 0;
		runFailed = 0;
		runTotal = list.length;
		runPaused = false;
		runCancelled = false;
		runError = null;
		failures = [];
		runVerb = action === 'mute' ? 'mute' : 'unfollow';
		phase = 'running';

		const reason = describe(cleanupState.spec);
		const key = scanState.boundKey;
		const muting = action === 'mute';
		try {
			// Mutes don't unfollow, so they skip the double-check.
			let toRun = list;
			if (!muting) toRun = await doubleCheck(toRun, ac.signal);
			if (ac.signal.aborted || toRun.length === 0) {
				// Stopped while checking, or every account turned out to be
				// still active: nothing ran, and the note above explains.
				runCancelled = ac.signal.aborted;
				phase = 'finished';
				return;
			}
			runTotal = toRun.length;
			// A Stop makes the executor return (not throw) with
			// cancelled: true, the UI has to read that or it would
			// report "Done" for a run the user stopped.
			const res = muting
				? await runMutes(writer, toRun, {
						// Muting isn't a repo write, so no batches, a short
						// pause between calls is the pacing.
						pauseMs: CONFIG.writeBatchPauseMs / 10,
						control: ctl,
						onAccountDone: async (account, error) => {
							if (error !== null) {
								failures = [...failures, { name: account.displayName ?? account.handle, error }];
								return;
							}
							if (key === null) return;
							try {
								// Muted accounts stay followed and in the
								// store; only the log grows.
								const store = await openStore(key);
								await store.addLog({
									did: account.did,
									handle: account.handle,
									at: new Date().toISOString(),
									reason,
									action: 'mute'
								});
							} catch {
								// A storage hiccup must not stop the run.
							}
						},
						onProgress: (done, failed) => {
							runDone = done;
							runFailed = failed;
						}
					})
				: await runUnfollows(writer, toRun, {
						batchSize: CONFIG.writeBatchSize,
						pauseMs: CONFIG.writeBatchPauseMs,
						control: ctl,
						reason,
						onBatchDone: async (done, failed) => {
							if (failed.length > 0) {
								failures = [
									...failures,
									...failed.map((f) => ({
										name: f.account.displayName ?? f.account.handle,
										error: f.error
									}))
								];
							}
							// Record the changes locally, even when the batch
							// was partial.
							if (key === null || done.length === 0) return;
							try {
								const store = await openStore(key);
								await store.deleteAccounts(done.map((a) => a.did));
								for (const a of done) {
									await store.addLog({
										did: a.did,
										handle: a.handle,
										at: new Date().toISOString(),
										reason,
										action: 'unfollow'
									});
								}
							} catch {
								// A storage hiccup must not stop the run; the log
								// may be short, but the unfollows themselves are
								// real.
							}
						},
						onProgress: (done, failed) => {
							runDone = done;
							runFailed = failed;
						}
					});
			// The result is the source of truth: an abort returns before the
			// final onProgress tick, and cancelled is never set on the happy
			// path otherwise.
			runDone = res.done;
			runFailed = res.failed;
			runCancelled = res.cancelled;
		} catch (e) {
			runCancelled = ac.signal.aborted;
			if (!ac.signal.aborted) {
				if (isAuthFailure(e)) sessionExpired = true;
				else runError = describeError(e);
			}
		}
		phase = 'finished';
		if (!runCancelled && !sessionExpired && runDone > 0) {
			track(runVerb === 'mute' ? 'Mute run' : 'Unfollow run');
		}
		await scanState.reloadAccounts();
		cleanupState.clearSelection();
		onFinished?.();
	}

	/**
	 * "Add to a list" and "Move to a list, then unfollow". Stage A adds the
	 * people to the list (creating it first when it's a new one); the move's
	 * stage B then unfollows only the people actually added. A Stop during
	 * stage A skips stage B: the user asked to halt, not to unfollow.
	 */
	async function confirmList(list: FollowAccount[]): Promise<void> {
		const writer = currentWriter();
		const did = scanState.source?.did ?? null;
		if (writer === null || did === null) {
			runTotal = list.length;
			runError = 'You are signed out, so nothing was changed.';
			phase = 'finished';
			return;
		}
		const ac = new AbortController();
		const ctl: RunControl = { paused: false, signal: ac.signal };
		runAc = ac;
		runCtl = ctl;
		runDone = 0;
		runFailed = 0;
		runTotal = list.length;
		runPaused = false;
		runCancelled = false;
		runError = null;
		failures = [];
		runVerb = 'list';
		phase = 'running';

		const key = scanState.boundKey;
		const moving = action === 'moveToList';
		let toAdd = list;
		if (moving) {
			try {
				toAdd = await doubleCheck(list, ac.signal);
			} catch {
				// Only aborts reach here: stopped while checking.
				runCancelled = true;
				phase = 'finished';
				return;
			}
			if (ac.signal.aborted || toAdd.length === 0) {
				runCancelled = ac.signal.aborted;
				phase = 'finished';
				return;
			}
			runTotal = toAdd.length;
		}

		// Stage A: resolve the list, then add everyone.
		let listUri = '';
		let listNameStr = '';
		let newCreated: { uri: string; rkey: string } | null = null;
		let res: Awaited<ReturnType<typeof syncMembers>> | null = null;
		try {
			if (pickedList !== null) {
				listUri = pickedList.uri;
				listNameStr = pickedList.name;
			} else {
				// The confirm button is disabled while the name is invalid.
				const created = await createList(writer, did, newListName, '');
				listUri = created.uri;
				listNameStr = newListName.trim();
				newCreated = created;
				track('List created');
			}
			res = await syncMembers(
				writer,
				listUri,
				toAdd.map((a) => a.did),
				[],
				{
					batchSize: CONFIG.writeBatchSize,
					pauseMs: CONFIG.writeBatchPauseMs,
					control: ctl,
					onProgress: (d) => {
						runDone = d;
					}
				}
			);
		} catch (e) {
			if (!ac.signal.aborted) {
				if (isAuthFailure(e)) sessionExpired = true;
				else runError = describeError(e);
			}
		}

		if (res !== null) {
			for (const f of res.failed) {
				const a = list.find((x) => x.did === f.did);
				failures = [...failures, { name: a?.displayName ?? a?.handle ?? f.did, error: f.error }];
			}

			if (moving && !ac.signal.aborted && res.added.length > 0) {
				// Stage B: unfollow only the people actually added.
				runVerb = 'unfollow';
				runDone = 0;
				runFailed = 0;
				const addedSet = new Set(res.added);
				const toUnfollow = list.filter((a) => addedSet.has(a.did));
				runTotal = toUnfollow.length;
				const reason = describe(cleanupState.spec);
				try {
					const res2 = await runUnfollows(writer, toUnfollow, {
						batchSize: CONFIG.writeBatchSize,
						pauseMs: CONFIG.writeBatchPauseMs,
						control: ctl,
						reason,
						onBatchDone: async (done, failed) => {
							if (failed.length > 0) {
								failures = [
									...failures,
									...failed.map((f) => ({
										name: f.account.displayName ?? f.account.handle,
										error: f.error
									}))
								];
							}
							// The log entry carries the list, so an undo can
							// explain where the person went.
							if (key === null || done.length === 0) return;
							try {
								const store = await openStore(key);
								await store.deleteAccounts(done.map((a) => a.did));
								for (const a of done) {
									await store.addLog({
										did: a.did,
										handle: a.handle,
										at: new Date().toISOString(),
										reason,
										action: 'move-to-list',
										listUri
									});
								}
							} catch {
								// A storage hiccup must not stop the run; the
								// log may be short, but the unfollows are real.
							}
						},
						onProgress: (done, failed) => {
							runDone = done;
							runFailed = failed;
						}
					});
					runDone = res2.done;
					runFailed = res2.failed;
					runCancelled = res2.cancelled;
				} catch (e) {
					runCancelled = ac.signal.aborted;
					if (!ac.signal.aborted) {
						if (isAuthFailure(e)) sessionExpired = true;
						else runError = describeError(e);
					}
				}
			} else {
				// Stage A only: a stop or an empty add means the run ends here.
				runCancelled = ac.signal.aborted;
			}
		} else {
			runCancelled = ac.signal.aborted;
		}

		// A new "Add to a list" list is saved so it appears on the Lists page
		// and can be refreshed: its members stay followed, so re-running the
		// spec finds them again. A moved list is not: its members leave the
		// follows, and a refresh would wrongly remove them.
		if (!moving && newCreated !== null && key !== null && res !== null && res.added.length > 0) {
			try {
				const store = await openStore(key);
				await store.putList({
					uri: newCreated.uri,
					rkey: newCreated.rkey,
					name: listNameStr,
					description: '',
					presetId: cleanupState.appliedPreset,
					filterSpec: cleanupState.spec,
					memberDids: res.added,
					updatedAt: new Date().toISOString()
				});
			} catch {
				// The list exists in Bluesky either way; the row just won't
				// appear on the Lists page.
			}
		}

		phase = 'finished';
		if (moving && !runCancelled && !sessionExpired && runDone > 0) {
			track('Move to list run');
		}
		await scanState.reloadAccounts();
		if (moving) cleanupState.clearSelection();
		onFinished?.();
	}
</script>

<dialog class="review" bind:this={dialog} onclose={onSheetClose} onkeydown={trapFocus}>
	{#if checking}
		<h2>Checking {checkTotal} account{checkTotal === 1 ? '' : 's'}…</h2>
		<p class="check-note">
			Re-checking the ones that look gone, so we never unfollow an active account.
		</p>
		<button type="button" class="cancel" onclick={stopRun}>Stop</button>
	{:else if phase === 'review'}
		<h2>Review: {n} account{n === 1 ? '' : 's'}</h2>

		<fieldset class="action-group">
			<legend>Action</legend>
			<label class="opt">
				<input
					type="radio"
					name="review-action"
					value="unfollow"
					checked={action === 'unfollow'}
					onchange={() => (action = 'unfollow')}
				/>
				<span>Unfollow</span>
			</label>
			<label class="opt">
				<input
					type="radio"
					name="review-action"
					value="moveToList"
					checked={action === 'moveToList'}
					onchange={() => (action = 'moveToList')}
				/>
				<span>Move to a list, then unfollow</span>
			</label>
			<label class="opt">
				<input
					type="radio"
					name="review-action"
					value="addToList"
					checked={action === 'addToList'}
					onchange={() => (action = 'addToList')}
				/>
				<span>Add to a list</span>
			</label>
			<label class="opt" class:off={!muteAvailable}>
				<input
					type="radio"
					name="review-action"
					value="mute"
					disabled={!muteAvailable}
					checked={action === 'mute'}
					onchange={() => (action = 'mute')}
				/>
				<span>Mute</span>
				{#if !muteAvailable}
					<span class="soon">Not available with the permissions you granted.</span>
				{/if}
			</label>
		</fieldset>

		{#if listAction}
			<div class="list-pick">
				<label class="field">
					<span>List</span>
					<select bind:value={listPick}>
						<option value="new">New list…</option>
						{#each managed as l (l.uri)}
							<option value={l.uri}>{l.name}</option>
						{/each}
					</select>
				</label>
				{#if listPick === 'new'}
					<label class="field">
						<span>Name</span>
						<input bind:value={newListName} placeholder="e.g. Quiet voices" autocomplete="off" />
					</label>
					{#if newListName.trim() !== '' && validateList(newListName, '') !== null}
						<p class="problem" role="alert">{validateList(newListName, '')}</p>
					{/if}
				{/if}
				<p class="note">
					Lists on Bluesky are public. Anyone can find this list and see who's on it.
				</p>
			</div>
		{/if}

		<p class="why"><strong>Why these:</strong> {why}</p>

		<h3>Who</h3>
		<ul class="who">
			{#each shown as a (a.did)}
				<li>
					<Avatar src={a.avatar} name={a.displayName ?? a.handle ?? a.did} size={28} />
					<span class="who-name">{a.displayName ?? a.handle ?? a.did}</span>
					{#if a.handle !== ''}<span class="who-handle">@{a.handle}</span>{/if}
				</li>
			{/each}
		</ul>
		{#if n > 50}
			<p class="more">and {n - 50} more</p>
		{/if}

		<button
			type="button"
			class="csv"
			onclick={() => {
				downloadCsv(targets, cleanupState.spec, new Date());
				track('CSV export');
			}}
		>
			Download as CSV
		</button>

		{#if warn}
			<div class="warn" role="alert">
				<p>
					You've unfollowed {already} accounts in the last 24 hours. Bluesky may treat lots of unfollows
					in one day as spammy, so TidySky suggests no more than {limit} a day. You can do {remaining}
					now and the rest tomorrow.
				</p>
				<label class="understand">
					<input
						type="checkbox"
						checked={understand}
						onchange={(e) => (understand = e.currentTarget.checked)}
					/>
					I understand
				</label>
			</div>
		{/if}

		<div class="buttons">
			{#if warn}
				<button
					type="button"
					class="confirm danger"
					disabled={n === 0 || remaining === 0 || (listAction && listNameInvalid)}
					onclick={() => void confirm('remaining')}
				>
					Do {remaining} now
				</button>
				<button
					type="button"
					class="confirm"
					disabled={n === 0 || !understand || (listAction && listNameInvalid)}
					onclick={() => void confirm('all')}
				>
					Do all {n} anyway
				</button>
			{:else if action === 'addToList'}
				<button
					type="button"
					class="confirm primary"
					disabled={n === 0 || listNameInvalid}
					onclick={() => void confirm('all')}
				>
					Add {n}
					{n === 1 ? 'person' : 'people'} to "{listName}"
				</button>
			{:else if action === 'moveToList'}
				<button
					type="button"
					class="confirm danger"
					disabled={n === 0 || listNameInvalid}
					onclick={() => void confirm('all')}
				>
					Add {n}
					{n === 1 ? 'person' : 'people'} to "{listName}", then unfollow them
				</button>
			{:else if action === 'mute'}
				<button
					type="button"
					class="confirm primary"
					disabled={n === 0}
					onclick={() => void confirm('all')}
				>
					Mute {n} account{n === 1 ? '' : 's'}
				</button>
			{:else}
				<button
					type="button"
					class="confirm danger"
					disabled={n === 0}
					onclick={() => void confirm('all')}
				>
					Unfollow {n} account{n === 1 ? '' : 's'}
				</button>
			{/if}
			<button type="button" class="cancel" onclick={close}>Cancel</button>
		</div>
	{:else}
		<h2>{title}</h2>
		{#if preflightNote !== null}
			<p class="check-note" role="status">{preflightNote}</p>
		{/if}
		{#if sessionExpired}
			<p class="expired" role="alert">
				Your Bluesky sign-in expired, so TidySky stopped. {runDone}
				{runDone === 1 ? 'was' : 'were'} changed before that; nothing after was touched.
			</p>
			<button type="button" class="confirm primary" onclick={() => session.expire()}>
				Sign in again
			</button>
		{/if}
		<RunProgress
			running={phase === 'running'}
			verb={runVerb}
			done={runDone}
			failed={runFailed}
			total={runTotal}
			cancelled={runCancelled}
			paused={runPaused}
			error={sessionExpired ? null : runError}
			{failures}
			onTogglePause={togglePause}
			onStop={stopRun}
			onClose={close}
		/>
	{/if}
</dialog>

<style>
	.review {
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
		.review {
			position: static;
			width: min(520px, calc(100vw - 32px));
			height: auto;
			max-height: 85dvh;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
		}
	}
	.review::backdrop {
		background: rgba(10, 14, 22, 0.5);
	}

	h2 {
		margin: 0 0 var(--space-md);
		font-size: var(--text-lg);
	}
	h3 {
		margin: 0 0 var(--space-xs);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.action-group {
		border: none;
		margin: 0 0 var(--space-md);
		padding: 0;
	}
	.action-group legend {
		margin-bottom: var(--space-xs);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.opt {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		padding: 5px 0;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.opt input {
		margin: 0;
		accent-color: var(--color-primary);
	}
	.opt.off {
		color: var(--color-text-muted);
		cursor: default;
	}
	.soon {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.list-pick {
		margin: 0 0 var(--space-md);
	}
	.list-pick .field {
		display: block;
		margin-bottom: var(--space-sm);
	}
	.list-pick .field span {
		display: block;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 4px;
	}
	.list-pick select,
	.list-pick input {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		padding: 8px 10px;
		min-height: var(--tap);
	}
	.list-pick .note {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
	.list-pick .problem {
		margin: 4px 0 0;
		font-size: var(--text-xs);
		color: var(--color-danger);
	}

	.why {
		margin: 0 0 var(--space-md);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.who {
		list-style: none;
		margin: 0 0 var(--space-sm);
		padding: 0;
		display: grid;
		gap: var(--space-xs);
	}
	.who li {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		min-width: 0;
	}
	/* min-width: 0 so long names ellipsize inside the flex row instead of
		pushing it past the viewport (flex items default to min-width: auto). */
	.who-name {
		font-size: var(--text-sm);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.who-handle {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.more {
		margin: 0 0 var(--space-sm);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.check-note {
		margin: 0 0 var(--space-md);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.expired {
		margin: 0 0 var(--space-xs);
		font-size: var(--text-sm);
		color: var(--color-danger);
	}
	.expired + .confirm {
		margin-bottom: var(--space-md);
	}

	.csv {
		width: 100%;
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		border-radius: var(--radius-md);
		padding: 8px 12px;
		min-height: var(--tap);
		cursor: pointer;
		margin-bottom: var(--space-md);
	}

	.warn {
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
		padding: var(--space-sm);
		margin: 0 0 var(--space-md);
	}
	.warn p {
		margin: 0 0 var(--space-xs);
		font-size: var(--text-sm);
	}
	.understand {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.understand input {
		margin: 0;
		accent-color: var(--color-primary);
	}

	.buttons {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		margin-top: var(--space-md);
	}
	.confirm {
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
	}
	.confirm.danger {
		background: var(--color-danger);
		border-color: var(--color-danger);
		color: var(--color-on-primary);
	}
	.confirm.primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-on-primary);
	}
	.confirm:disabled {
		opacity: 0.5;
		cursor: default;
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
