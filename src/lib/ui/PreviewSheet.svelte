<script lang="ts">
	import { buildPreview } from '#lib/cleanup/preview';
	import { interactionWindow } from '#lib/scan/interaction-window';
	import type { FollowAccount } from '#lib/scan/types';

	import Avatar from './Avatar.svelte';
	import Sheet from './Sheet.svelte';

	/**
	 * The profile preview: everything TidySky already knows about the account,
	 * from its stored row only, so opening it makes no requests. The sheet
	 * keeps showing the account it opened with until it is closed, even when
	 * a filter change or a finished scan moves the row out of the list.
	 * "Select" and "Keep" act on the same state as the row's checkbox and pin.
	 */
	interface Props {
		open: boolean;
		/** The stored row the sheet opened with, or null when it never did. */
		account: FollowAccount | null;
		/** The row's selection state for the account. */
		checked: boolean;
		/** The row's keep state for the account. */
		kept: boolean;
		onToggle: (did: string) => void;
		onKeepToggle: (did: string) => void;
		onClose: () => void;
		/** The interaction check's window inputs, for the "You and them" wording. */
		interactionsScannedAt: string | null;
		interactionsCoveredSince: string | null;
		/** Your own account's createdAt, if known. */
		myCreatedAt: string | null;
	}

	let {
		open,
		account,
		checked,
		kept,
		onToggle,
		onKeepToggle,
		onClose,
		interactionsScannedAt,
		interactionsCoveredSince,
		myCreatedAt
	}: Props = $props();

	const preview = $derived.by(() => {
		if (account === null) return null;
		return buildPreview(
			account,
			interactionWindow(interactionsScannedAt, interactionsCoveredSince, myCreatedAt)
		);
	});
</script>

<!-- The sheet (and its dialog) stays mounted at all times, like the other
   sheets: its focus watcher only sees the opener's focus while the sheet is
   closed, and WebKit neither focuses the opener on the tap that opens the
   sheet nor restores focus on close, so the remembered opener is the only
   way focus gets back. The content needs the account; the dialog does not. -->
<Sheet open={open && account !== null} title={preview?.title ?? ''} {onClose}>
	{#if preview !== null && account !== null}
		<section class="who">
			<Avatar src={account.avatar} name={preview.title} size={64} />
			{#if account.handle !== ''}
				<span class="handle">@{account.handle}</span>
			{/if}
			{#if preview.bio !== null}
				<p class="bio">{preview.bio}</p>
			{/if}
		</section>

		{#if preview.why.length > 0}
			<section class="sec">
				<h3>Why it's flagged</h3>
				<ul class="why">
					{#each preview.why as w (w.text)}
						<li>
							{#if w.href !== null}
								<a href={w.href} target="_blank" rel="external noopener noreferrer">{w.text}</a>
							{:else}
								{w.text}
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="sec">
			<h3>Facts</h3>
			<dl class="facts">
				{#each preview.facts as f (f.label)}
					<div class="fact">
						<dt>{f.label}</dt>
						<dd>{f.value}</dd>
					</div>
				{/each}
			</dl>
		</section>

		<section class="sec">
			<h3>Activity</h3>
			{#if preview.activity.kind === 'none'}
				<p class="plain">Activity not checked yet.</p>
			{:else}
				<dl class="facts">
					<div class="fact">
						<dt>Last post or repost</dt>
						<dd>{preview.activity.lastActive}</dd>
					</div>
					<div class="fact">
						<dt>Estimated posts a day</dt>
						<dd>{preview.activity.perDay}</dd>
					</div>
					{#if preview.activity.mix !== null}
						<!-- The mix can hold several items, so it takes a line of
							its own under the label and wraps only between items,
							never mid-item, at a narrow width. -->
						<div class="fact mix">
							<dt>Mix</dt>
							<dd>
								{#each preview.activity.mix as part, i (part)}
									<span class="mix-part">
										{part}
										{#if i < preview.activity.mix.length - 1}
											<span class="mix-sep" aria-hidden="true">·</span>
										{/if}
									</span>
								{/each}
							</dd>
						</div>
					{/if}
					{#if preview.activity.languages !== null}
						<div class="fact">
							<dt>Top languages</dt>
							<dd>{preview.activity.languages}</dd>
						</div>
					{/if}
				</dl>
				{#if preview.activity.sampleSize > 0}
					<p class="footnote">
						Estimated from {preview.activity.sampleSize} recent posts and reposts.
					</p>
				{/if}
			{/if}
		</section>

		{#if preview.interaction.kind === 'data'}
			<section class="sec">
				<h3>You and them</h3>
				{#if preview.interaction.last !== null}
					<dl class="facts">
						<div class="fact">
							<dt>Last interaction</dt>
							<dd>{preview.interaction.last}</dd>
						</div>
					</dl>
				{/if}
				<p class="plain">{preview.interaction.counts ?? preview.interaction.none}</p>
			</section>
		{/if}

		<div class="actions">
			<a
				class="act primary"
				href={preview.profileHref}
				target="_blank"
				rel="external noopener noreferrer"
			>
				Open on Bluesky
			</a>
			<button
				type="button"
				class="act"
				aria-pressed={checked}
				onclick={() => onToggle(account.did)}
			>
				{checked ? 'Selected' : 'Select'}
			</button>
			<button
				type="button"
				class="act"
				aria-pressed={kept}
				onclick={() => onKeepToggle(account.did)}
			>
				{kept ? 'Kept' : 'Keep'}
			</button>
		</div>
	{/if}
</Sheet>

<style>
	/* The "Who" block: a larger avatar with the handle under it; the bio is
	   plain text with its line breaks kept, never linked or rendered as HTML. */
	.who {
		display: grid;
		justify-items: start;
		gap: var(--space-xs);
		margin-bottom: var(--space-md);
	}
	.handle {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.bio {
		margin: var(--space-xs) 0 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		white-space: pre-wrap;
		overflow-wrap: break-word;
	}

	.sec {
		margin-bottom: var(--space-md);
	}
	h3 {
		margin: 0 0 var(--space-xs);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.why {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
		font-size: var(--text-sm);
	}
	.why a {
		color: var(--color-link);
		text-decoration: none;
		font-weight: 600;
	}
	.why a:hover {
		color: var(--color-link-hover);
		text-decoration: underline;
	}

	/* Label left, value right: the label keeps its full width, the value
	   never wraps mid-number. */
	.facts {
		margin: 0;
		display: grid;
		gap: 4px;
	}
	.fact {
		display: flex;
		justify-content: space-between;
		gap: var(--space-sm);
		font-size: var(--text-sm);
	}
	.fact dt {
		color: var(--color-text-muted);
	}
	.fact dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	/* The Mix is the one fact with several values: the label sits on top,
	   the items take the full width below and wrap only between items. */
	.fact.mix {
		flex-direction: column;
		align-items: stretch;
		gap: 2px;
	}
	.fact.mix dd {
		display: flex;
		flex-wrap: wrap;
		text-align: left;
	}
	.mix-part {
		white-space: nowrap;
	}
	.mix-sep {
		margin: 0 var(--space-xs);
		color: var(--color-text-muted);
	}

	.plain {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.footnote {
		margin: var(--space-xs) 0 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	/* The actions sit at the bottom, one per line, each a 44 px target. */
	.actions {
		display: grid;
		gap: var(--space-xs);
		margin-top: var(--space-md);
	}
	.act {
		display: flex;
		align-items: center;
		justify-content: center;
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
	}
	.act.primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-on-primary);
	}
</style>
