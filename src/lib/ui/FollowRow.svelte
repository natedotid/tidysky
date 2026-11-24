<script lang="ts">
	import { relativeDays, rate } from '#lib/format';
	import { interactionWindow, interactionWindowLabels } from '#lib/scan/interaction-window';
	import type { FollowAccount } from '#lib/scan/types';

	import Avatar from './Avatar.svelte';
	import { ROW_HEIGHT } from './row';

	interface Props {
		account: FollowAccount;
		checked: boolean;
		kept: boolean;
		onToggle: (did: string) => void;
		onKeepToggle: (did: string) => void;
		/** When the interaction check last ran, or null. */
		interactionsScannedAt: string | null;
		/** Oldest date the interaction read fully covered, or null. */
		interactionsCoveredSince: string | null;
		/** Your own account's createdAt, if known. */
		myCreatedAt: string | null;
	}

	let {
		account,
		checked,
		kept,
		onToggle,
		onKeepToggle,
		interactionsScannedAt,
		interactionsCoveredSince,
		myCreatedAt
	}: Props = $props();

	const name = $derived(account.displayName ?? account.handle ?? account.did);
	const dead = $derived(
		account.status === 'deactivated' || account.status === 'takendown' || account.status === 'gone'
	);
	/** The "You:" line, or null when not checked yet. */
	const you = $derived.by((): string | null => {
		const ix = account.interaction;
		if (ix === null) return null;
		if (ix.lastAt !== null) return `You: ${relativeDays(ix.lastAt)} (${ix.lastKind})`;
		// Checked, none in the window. The shared helper says where the
		// window starts: the full year, the read's cap, or your own
		// account's creation, whichever is latest.
		const labels = interactionWindowLabels(
			interactionWindow(interactionsScannedAt, interactionsCoveredSince, myCreatedAt)
		);
		// The label is title case ("None in 12 months"); the line wants it
		// mid-sentence.
		return `You: ${labels.none.charAt(0).toLowerCase()}${labels.none.slice(1)}`;
	});
	const meta = $derived.by((): string => {
		if (account.status === 'deactivated') return 'Deactivated';
		if (account.status === 'takendown') return 'Suspended';
		if (account.status === 'gone') return 'Gone';
		// A list or block hides the account: say why, instead of the stats.
		const v = account.viewer;
		if (v !== null) {
			const why: string[] = [];
			if (v.blockedBy) why.push('Blocks you');
			if (v.mutedByList !== null) why.push(`Muted by list: ${v.mutedByList.name}`);
			if (v.blockingByList !== null) why.push(`Blocked by list: ${v.blockingByList.name}`);
			if (why.length > 0) return why.join(' · ');
		}
		const last = account.activity === null ? '—' : relativeDays(account.activity.lastActiveAt);
		const r = account.activity === null ? '—' : rate(account.activity.itemsPerDay);
		const back = account.followsYou === true ? ' · follows you' : '';
		return `Last post ${last} · ${r}${back}`;
	});
	const href = $derived(`https://bsky.app/profile/${account.handle || account.did}`);
</script>

<div class="row" style={`--row-h: ${ROW_HEIGHT}px`}>
	<label class="check">
		<input
			type="checkbox"
			{checked}
			aria-label={`Select ${name}`}
			onchange={() => onToggle(account.did)}
		/>
	</label>

	<Avatar src={account.avatar} {name} size={36} />

	<div class="text">
		<div class="line">
			<a class="name" {href} target="_blank" rel="external noopener noreferrer">{name}</a>
			{#if account.handle !== ''}<span class="handle">@{account.handle}</span>{/if}
		</div>
		<p class="meta" class:dead>{meta}</p>
		{#if you !== null}
			<p class="you">{you}</p>
		{/if}
	</div>

	<button
		type="button"
		class="keep"
		aria-pressed={kept}
		aria-label={`Keep ${name}: never suggest unfollowing`}
		class:kept
		onclick={() => onKeepToggle(account.did)}
	>
		<svg
			viewBox="0 0 24 24"
			width="18"
			height="18"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
		>
			<path d="M9 4h6l-1 7 3 3v2h-4v6l-1 1-1-1v-6H6v-2l3-3-1-7z" stroke-linejoin="round" />
		</svg>
	</button>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: auto auto 1fr auto;
		gap: var(--space-xs);
		align-items: center;
		/* Set inline from the shared ROW_HEIGHT constant (row.ts), so the
			virtual list's rowHeight and this height cannot drift apart. No
			horizontal padding: the page already provides the gutter, and
			every px goes to the text column. */
		height: var(--row-h);
		border-bottom: 1px solid var(--color-border);
	}

	/* 44px hit area around the checkbox. */
	.check {
		display: grid;
		place-items: center;
		width: var(--tap);
		height: var(--tap);
		margin: 0;
	}
	.check input {
		width: 20px;
		height: 20px;
		margin: 0;
		accent-color: var(--color-primary);
	}

	.text {
		min-width: 0;
	}
	.line {
		display: flex;
		align-items: baseline;
		gap: var(--space-xs);
	}
	/* The name never gives up width (flex: 0 0 auto): it keeps priority over
		the handle and ellipsizes at the full line width (max-width: 100%)
		instead of widening the row (flex items default to min-width: auto,
		the full nowrap text width). */
	.name {
		font-weight: 600;
		color: var(--color-text);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 0 0 auto;
		max-width: 100%;
	}
	.name:hover {
		text-decoration: underline;
	}
	/* The handle takes whatever space the name leaves: it shrinks first
		(the name is inflexible), all the way to zero, and only then does the
		name ellipsize. */
	.handle {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		flex: 0 1 auto;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	/* The secondary lines in the smaller size: at the inherited body size
	they made the rows feel heavy. */
	.meta {
		margin: 1px 0 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta.dead {
		color: var(--color-danger);
	}
	.you {
		margin: 1px 0 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.keep {
		display: grid;
		place-items: center;
		width: var(--tap);
		height: var(--tap);
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.keep:hover {
		background: var(--color-surface-2);
	}
	.keep.kept {
		color: var(--color-accent);
	}
</style>
