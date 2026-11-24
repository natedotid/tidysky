<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The shared bottom sheet (Add filter, More presets, unfollowed elsewhere):
	 * a fixed <dialog> docked to the bottom, 85dvh max, scrolling inside.
	 * On open, focus goes to the title (tabindex -1, focused in code right
	 * after showModal), not to the first focusable element: showModal would
	 * focus Close, and Safari draws a focus ring on it; the title also tells
	 * a screen reader which sheet opened. Closes by its header's Close
	 * button, a tap on the backdrop, or Escape (native); onclose always
	 * returns focus to the opener and calls onClose.
	 */
	interface Props {
		open: boolean;
		/** The title in the header row (an h2). */
		title: string;
		/** Called every time the dialog closes. */
		onClose: () => void;
		children: Snippet;
	}

	let { open, title, onClose, children }: Props = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	/** The header's h2: the sheet focuses it right after showModal. */
	let titleEl = $state<HTMLElement | null>(null);
	/**
	 * Where focus goes when the sheet closes: the element focused when the
	 * sheet opened (its opener). A modal dialog is supposed to return focus
	 * there on close, but WebKit does not (Chromium does), so the sheet
	 * restores it itself: closing the sheet on a phone must leave focus
	 * where the user was, not on <body>.
	 */
	let opener: HTMLElement | null = null;
	/**
	 * The last element focused while the sheet was closed. A touch tap on
	 * the opener blurs it without focusing anything (WebKit), so at open
	 * time activeElement is <body> and this is how the opener is still
	 * found.
	 */
	let lastFocused: HTMLElement | null = null;

	function rememberFocus(e: FocusEvent): void {
		if (!open && e.target instanceof HTMLElement) lastFocused = e.target;
	}

	$effect(() => {
		document.addEventListener('focusin', rememberFocus, true);
		return () => document.removeEventListener('focusin', rememberFocus, true);
	});

	$effect(() => {
		if (open && dialog !== null && !dialog.open) {
			const ae = document.activeElement;
			opener =
				ae instanceof HTMLElement && ae !== document.body && ae !== document.documentElement
					? ae
					: lastFocused;
			dialog.showModal();
			// showModal focuses the first focusable element (Close); move it
			// to the title instead.
			titleEl?.focus();
		}
		// The parent may close us straight (open flips false while the dialog
		// is open); keep the two in sync.
		if (!open && dialog !== null && dialog.open) dialog.close();
	});

	function onDialogClick(e: MouseEvent): void {
		// A click whose target is the dialog itself is a tap on the backdrop.
		// All padding sits on .inner, so a tap anywhere in the sheet, padding
		// included, targets the sheet and never closes it.
		if (e.target === dialog) dialog?.close();
	}

	function onSheetClosed(): void {
		opener?.focus();
		onClose();
	}
</script>

<dialog class="sheet" bind:this={dialog} onclose={onSheetClosed} onclick={onDialogClick}>
	<div class="inner">
		<header class="head">
			<h2 bind:this={titleEl} tabindex="-1">{title}</h2>
			<button type="button" class="close" aria-label="Close" onclick={() => dialog?.close()}>
				Close
			</button>
		</header>
		{@render children()}
	</div>
</dialog>

<style>
	.sheet {
		position: fixed;
		/* The UA stylesheet gives a modal dialog inset: 0; with a max-height
		   the over-constrained box would anchor top: 0 and the sheet would
		   dock to the top. top: auto keeps bottom: 0 as the anchor. */
		top: auto;
		bottom: 0;
		left: 0;
		right: 0;
		margin: 0 auto;
		max-width: var(--page-max);
		max-height: 85dvh;
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-bottom: none;
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		background: var(--color-surface);
		color: var(--color-text);
		width: 100%;
		/* Zero the UA default dialog padding: the dialog must have none, so
		   only a backdrop tap (target = dialog) can close the sheet. */
		padding: 0;
	}
	.inner {
		/* Padding on the wrapper, not the dialog: a tap on the sheet's own
		   padding must not count as a backdrop tap. */
		padding: var(--space-md) var(--space-md) calc(var(--space-lg) + env(safe-area-inset-bottom));
	}
	.sheet::backdrop {
		background: rgba(10, 14, 22, 0.5);
	}
	.sheet[open] {
		animation: rise 0.18s ease-out;
	}
	@keyframes rise {
		from {
			transform: translateY(24px);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sheet[open] {
			animation: none;
		}
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
		margin-bottom: var(--space-sm);
	}
	.head h2 {
		margin: 0;
		font-size: var(--text-lg);
		/* The sheet focuses the title on open, not Close; the title must
			not draw a focus ring for it. Keyboard users reach Close with Tab,
			and it keeps the global :focus-visible outline. */
		outline: none;
	}
	/* A quiet text button, in the style of ReviewSheet's Cancel. */
	.close {
		flex: none;
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
