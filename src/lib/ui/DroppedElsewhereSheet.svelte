<script lang="ts">
	/**
	 * The "unfollowed elsewhere" sheet: the accounts the
	 * previous scan saw that the current one doesn't, and the user did not
	 * unfollow through TidySky. Profiles are fetched with the current
	 * source's getProfiles (25 DIDs per call) while the sheet is open, and
	 * the fetch is cancelled when it closes. A DID with no profile is
	 * "No longer available". The sheet has no "Follow again" action.
	 */
	import { session } from '#lib/atproto/session.svelte';
	import { isAuthFailure } from '#lib/net/errors';
	import type { DataSource, ProfileLite } from '#lib/scan/source';

	import Avatar from './Avatar.svelte';
	import Sheet from './Sheet.svelte';
	import { droppedRows, type DroppedRow } from './dropped-rows';

	interface Props {
		open: boolean;
		/** The DIDs, in diff order. */
		dids: string[];
		/** The current source (live or demo), or null before the app is bound. */
		source: DataSource | null;
		onClose: () => void;
	}

	let { open, dids, source, onClose }: Props = $props();

	const title = $derived(
		`${dids.length} ${dids.length === 1 ? 'account' : 'accounts'} you no longer follow`
	);

	type LoadState = 'loading' | 'ready' | 'failed' | 'expired';
	let loadState: LoadState = $state('loading');
	let profiles: ProfileLite[] = $state([]);
	let controller: AbortController | null = null;

	/** getProfiles takes at most 25 DIDs per call, so fetch in batches. */
	async function load(): Promise<void> {
		const src = source;
		if (src === null) {
			loadState = 'failed';
			return;
		}
		controller?.abort();
		const ctl = new AbortController();
		controller = ctl;
		loadState = 'loading';
		const found: ProfileLite[] = [];
		try {
			for (let i = 0; i < dids.length; i += 25) {
				if (ctl.signal.aborted) return;
				found.push(...(await src.getProfiles(dids.slice(i, i + 25), ctl.signal)));
			}
			// One assignment when done: the rows show only when ready.
			profiles = found;
			loadState = 'ready';
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') return;
			loadState = isAuthFailure(e) ? 'expired' : 'failed';
		}
	}

	$effect(() => {
		if (open && dids.length > 0) void load();
	});

	// The dialog's onclose (Close button, backdrop, Escape or programmatic):
	// cancel a running fetch and tell the parent.
	function close(): void {
		controller?.abort();
		onClose();
	}

	const rows = $derived.by((): DroppedRow[] =>
		loadState === 'ready' ? droppedRows(dids, profiles) : []
	);
</script>

<Sheet {open} {title} onClose={close}>
	<p class="sub">
		Unfollowed outside TidySky since your last scan, for example in the Bluesky app.
	</p>

	{#if loadState === 'loading'}
		<p class="state" role="status">Loading…</p>
	{:else if loadState === 'expired'}
		<p class="state" role="alert">
			Your Bluesky sign-in expired. Sign in again to see these accounts.
		</p>
		<button type="button" class="action" onclick={() => session.expire()}>Sign in again</button>
	{:else if loadState === 'failed'}
		<p class="state" role="alert">Couldn't load these accounts. Try again.</p>
		<button type="button" class="action" onclick={() => void load()}>Try again</button>
	{:else}
		<ul class="rows" role="list">
			{#each rows as r (r.did)}
				<li>
					{#if r.profile !== null}
						<a
							class="row"
							href={`https://bsky.app/profile/${r.did}`}
							target="_blank"
							rel="noopener noreferrer"
						>
							<Avatar
								src={r.profile.avatar}
								name={r.profile.displayName ?? r.profile.handle}
								size={36}
							/>
							<span class="who">
								<span class="name">{r.profile.displayName ?? r.profile.handle}</span>
								<span class="handle">@{r.profile.handle}</span>
							</span>
						</a>
					{:else}
						<div class="row dead">
							<Avatar src={null} name="?" size={36} />
							<span class="who">
								<span class="name dead-name">No longer available</span>
							</span>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Sheet>

<style>
	.sub {
		margin: 0 0 var(--space-sm);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.state {
		margin: var(--space-sm) 0;
		font-size: var(--text-sm);
		color: var(--color-text);
	}
	.action {
		border: 1px solid var(--color-primary);
		background: var(--color-primary);
		color: var(--color-on-primary);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		border-radius: var(--radius-md);
		padding: 8px 12px;
		cursor: pointer;
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-xs);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		border-radius: var(--radius-md);
		padding: var(--space-sm) var(--space-md);
		min-width: 0;
		text-decoration: none;
		color: var(--color-text);
	}
	a.row:hover {
		border-color: var(--color-primary);
	}
	.who {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-size: var(--text-sm);
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.handle {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}
	.dead {
		border-style: dashed;
	}
	.dead-name {
		color: var(--color-text-muted);
		font-weight: 400;
	}
</style>
