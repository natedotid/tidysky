<script lang="ts">
	import { resolve } from '$app/paths';

	import { track } from '#lib/analytics';
	import { session } from '#lib/atproto/session.svelte';
	import { CONFIG } from '#lib/config';
	import { cleanupState } from '#lib/cleanup/cleanup-state.svelte';
	import { deleteDatabase, openStore } from '#lib/db/store';
	import { youState } from '#lib/insights/you-state.svelte';
	import { scanState } from '#lib/scan/scan-state.svelte';
	import { relativeTime } from '#lib/time';

	import Avatar from '#lib/ui/Avatar.svelte';
	import LogoMark from '#lib/ui/LogoMark.svelte';
	import ThemeToggle from '#lib/ui/ThemeToggle.svelte';

	const LIMIT_MIN = 50;
	const LIMIT_MAX = 2000;

	const boundKey = $derived(scanState.boundKey);
	const profile = $derived(youState.data?.profile ?? null);
	const name = $derived(profile?.displayName ?? session.handle ?? 'You');
	const handle = $derived(profile?.handle ?? session.handle ?? null);

	// Safety: the daily-unfollow suggestion, saved in the scan meta so the
	// review sheet can read it; the kept accounts the clean-up skips.
	let limit = $state<number>(CONFIG.softDailyUnfollowLimit);
	/** The typed value (input values are strings); committed on change. */
	let limitText = $state(String(CONFIG.softDailyUnfollowLimit));
	let keepDids = $state<string[]>([]);

	const keptAccounts = $derived(
		keepDids.map((did) => {
			const a = scanState.accounts.find((x) => x.did === did);
			return { did, name: a !== undefined ? (a.displayName ?? a.handle) : did };
		})
	);

	// Your data.
	let busy = $state(false);
	/** Set when another tab blocked the delete; stays until the next attempt. */
	let blockedNote = $state<string | null>(null);

	$effect(() => {
		if (session.status === 'signed-in' || session.demo) void youState.ensure();
	});

	$effect(() => {
		const key = boundKey;
		if (key === null) {
			limit = CONFIG.softDailyUnfollowLimit;
			limitText = String(limit);
			keepDids = [];
			return;
		}
		void (async () => {
			const store = await openStore(key).catch(() => null);
			if (store === null) return;
			limit =
				(await store.getMeta().catch(() => null))?.dailyUnfollowLimit ??
				CONFIG.softDailyUnfollowLimit;
			limitText = String(limit);
			keepDids = await store.getKeep().catch(() => []);
		})();
	});

	/** Clamp to the allowed range and save the suggestion in the meta row. */
	function saveLimit(): void {
		const key = boundKey;
		if (key === null) return;
		const parsed = Math.round(Number(limitText));
		const v = Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Number.isFinite(parsed) ? parsed : limit));
		limit = v;
		limitText = String(v);
		void (async () => {
			const store = await openStore(key).catch(() => null);
			if (store === null) return;
			const meta = await store.getMeta().catch(() => null);
			// No meta row yet (never scanned): create one with the rest empty:
			// a scan in progress is exactly what that says.
			try {
				await store.putMeta({
					lastScanStartedAt: meta?.lastScanStartedAt ?? null,
					lastScanFinishedAt: meta?.lastScanFinishedAt ?? null,
					followCount: meta?.followCount ?? 0,
					dailyUnfollowLimit: v,
					interactionsScannedAt: meta?.interactionsScannedAt ?? null,
					interactionsCoveredSince: meta?.interactionsCoveredSince ?? null
				});
			} catch {
				// A storage hiccup must not lose the typed value on screen.
			}
		})();
	}

	async function removeKeep(did: string): Promise<void> {
		const key = boundKey;
		if (key === null) return;
		keepDids = keepDids.filter((d) => d !== did);
		try {
			const store = await openStore(key);
			await store.setKeep(did, false);
		} catch {
			// Storage hiccup: the local list is already updated.
		}
	}

	/** Download accounts, log, lists and snapshots as one JSON file. */
	function exportData(): void {
		const key = boundKey;
		if (key === null) return;
		void (async () => {
			const store = await openStore(key).catch(() => null);
			if (store === null) return;
			const [accounts, log, lists, snapshots] = await Promise.all([
				store.getAllAccounts(),
				store.listLog(),
				store.getLists(),
				store.listSnapshots()
			]);
			const blob = new Blob(
				[
					JSON.stringify(
						{
							app: 'tidysky',
							version: __APP_VERSION__,
							exportedAt: new Date().toISOString(),
							accounts,
							log,
							lists,
							snapshots
						},
						null,
						2
					)
				],
				{ type: 'application/json' }
			);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			const slug = (handle ?? 'data').replace(/[^a-z0-9.-]+/gi, '');
			a.download = `tidysky-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
			document.body.append(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		})();
	}

	/** Delete everything on this device, then leave the account. */
	async function deleteAll(): Promise<void> {
		if (busy) return;
		busy = true;
		blockedNote = null;
		try {
			const key = boundKey;
			if (key !== null) {
				// Unbind first: a running scan or the open connection would
				// otherwise block (or outlive) the delete.
				scanState.unbind();
				cleanupState.unbind();
				try {
					const { blocked } = await deleteDatabase(key);
					if (blocked) {
						// The data is still here; stay put so the note is seen.
						blockedNote = 'Close TidySky in your other tabs to finish deleting.';
						return;
					}
				} catch {
					// Already gone.
				}
			}
			// The layout redirects signed-out users (and demo exit) home.
			if (session.demo) session.exitDemo();
			else await session.signOut();
			track('Data deleted');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Settings · TidySky</title>
</svelte:head>

<div class="page">
	<header class="app-header">
		<LogoMark size={28} />
		<span class="wordmark">TidySky</span>
	</header>
	<h1>Settings</h1>

	<section class="card">
		<h2>Account</h2>
		<div class="account-row">
			<Avatar src={profile?.avatar ?? null} {name} size={48} />
			<div class="account-id">
				<p class="account-name">{name}</p>
				{#if handle}
					<p class="account-handle">@{handle}</p>
				{/if}
				<p class="note">
					{session.demo ? 'Demo mode: sample data only.' : 'Signed in with Bluesky'}
				</p>
			</div>
		</div>
		{#if !session.demo}
			<p class="note">Bluesky asks you to sign in again every two weeks.</p>
			<p class="note">
				To remove TidySky's access completely, revoke it on
				<a href="https://bsky.social/account" target="_blank" rel="external noopener noreferrer">
					your Bluesky account page
				</a>. It can take up to an hour to stop working, so sign out here too.
			</p>
			<button type="button" class="btn btn-danger" onclick={() => void session.signOut()}>
				Sign out
			</button>
		{/if}
	</section>

	<section class="card">
		<h2>Scan</h2>
		<p>
			{#if scanState.lastFinishedAt !== null}
				Last scanned {relativeTime(scanState.lastFinishedAt)}
			{:else}
				Never scanned
			{/if}
		</p>
		{#if scanState.running}
			<p class="note">A scan is running. You can keep using the app while it finishes.</p>
		{/if}
		<div class="row">
			<button
				type="button"
				class="btn"
				disabled={scanState.running || boundKey === null}
				onclick={() => void scanState.startScan({ force: false })}
			>
				Rescan now
			</button>
			<button
				type="button"
				class="btn"
				disabled={scanState.running || boundKey === null}
				onclick={() => void scanState.startScan({ force: true })}
			>
				Full rescan
			</button>
		</div>
		<p class="note">
			Rescan now refreshes the accounts that may have changed since the last scan; a full rescan
			re-checks every account you follow from the top.
		</p>
	</section>

	<section class="card">
		<h2>Appearance</h2>
		<ThemeToggle />
	</section>

	<section class="card">
		<h2>Safety</h2>
		<label class="field">
			<span>Daily unfollow suggestion</span>
			<input
				type="number"
				min={LIMIT_MIN}
				max={LIMIT_MAX}
				bind:value={limitText}
				onchange={saveLimit}
			/>
		</label>
		<p class="note">
			TidySky warns you when you're about to unfollow more than this in a day. It's only a
			suggestion, and you can always go over it.
		</p>

		<h3>Kept accounts</h3>
		{#if keptAccounts.length === 0}
			<p class="note">
				No kept accounts. On the Clean up page you can keep an account so it's never suggested.
			</p>
		{:else}
			<ul class="keep">
				{#each keptAccounts as k (k.did)}
					<li>
						<span class="keep-name">{k.name}</span>
						<button type="button" class="keep-remove" onclick={() => void removeKeep(k.did)}>
							Remove
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="card">
		<h2>Your data</h2>
		<p>Everything TidySky knows is stored on this device.</p>
		{#if blockedNote !== null}
			<p class="blocked" role="alert">{blockedNote}</p>
		{/if}
		<div class="row">
			<button type="button" class="btn" disabled={boundKey === null || busy} onclick={exportData}>
				Export my TidySky data
			</button>
			<button
				type="button"
				class="btn btn-danger"
				disabled={boundKey === null || busy}
				onclick={() => {
					const ok = confirm(
						'Delete all TidySky data on this device? Your scan, lists, snapshots and history are removed. Your Bluesky account is untouched.'
					);
					if (ok) void deleteAll();
				}}
			>
				Delete all TidySky data on this device
			</button>
		</div>
	</section>

	<section class="card">
		<h2>About</h2>
		<p>TidySky {__APP_VERSION__}</p>
		<p>
			<a href={resolve('/methodology')}>Methodology</a>
			<span class="sep" aria-hidden="true">·</span>
			<a href={resolve('/privacy')}>Privacy</a>
			<span class="sep" aria-hidden="true">·</span>
			<a
				href="https://github.com/natedotid/tidysky"
				target="_blank"
				rel="external noopener noreferrer"
			>
				Source code
			</a>
		</p>
		<p>
			Ideas or bugs?
			<a
				href="https://bsky.app/intent/compose?text=%40tidysky.io%20"
				target="_blank"
				rel="external noopener noreferrer"
			>
				Post to @tidysky.io
			</a>
			or
			<a
				href="https://github.com/natedotid/tidysky/issues"
				target="_blank"
				rel="external noopener noreferrer"
			>
				open an issue on GitHub
			</a>.
		</p>
	</section>
</div>

<style>
	.card {
		display: grid;
		/* A long display name must not widen the card past the viewport. */
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-sm);
	}

	.card h2 {
		margin: 0;
		font-size: var(--text-lg);
	}

	.card h3 {
		margin: var(--space-md) 0 0;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.card p {
		margin: 0;
		font-size: var(--text-sm);
	}

	.note {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}

	.blocked {
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
		padding: var(--space-sm);
		color: var(--color-text);
		font-size: var(--text-sm);
	}

	.account-row {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
	}

	.account-id {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 2px;
		min-width: 0;
	}

	.account-name {
		font-size: var(--text-sm);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.account-handle {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
	}

	.field {
		display: grid;
		gap: 4px;
	}

	.field span {
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.field input {
		width: 120px;
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

	.keep {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-xs);
	}

	.keep li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
	}

	.keep-name {
		font-size: var(--text-sm);
	}

	.keep-remove {
		border: none;
		background: none;
		padding: 4px 8px;
		min-height: var(--tap);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--color-danger);
		cursor: pointer;
	}

	.sep {
		margin: 0 var(--space-xs);
		color: var(--color-text-muted);
	}
</style>
