/**
 * The Clean up page's row keyboard shortcuts, as a pure key-to-action
 * function: every key, every leave-alone case and both list ends are
 * unit-tested here, and the Svelte page only wires the result to the list.
 *
 * The "current row" is the row whose preview button has focus: moving
 * focuses that button, so screen readers announce the row and Enter works
 * natively on it.
 */

export type RowAction =
	| { kind: 'ignore' }
	| { kind: 'focusRow'; index: number }
	| { kind: 'toggleSelect' }
	| { kind: 'toggleKeep' }
	| { kind: 'openPreview' }
	| { kind: 'leaveRow' }
	| { kind: 'showShortcuts' };

export interface KeyEvent {
	/** The pressed key (KeyboardEvent.key): "j", "ArrowDown", " ", "?", … */
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	/** Focus sits in an input, select, textarea, or contenteditable. */
	inEditable: boolean;
	/** Any sheet or dialog is open; it owns the keyboard (Escape closes it
	 * natively), so every shortcut, Escape included, is left alone. */
	sheetOpen: boolean;
	/** Focus is on the current row's preview button. */
	onRow: boolean;
	/** The current row's index, or null when no row has focus. */
	currentIndex: number | null;
	/** The number of rows in the list. */
	count: number;
}

const ignore: RowAction = { kind: 'ignore' };

export function keyAction(e: KeyEvent): RowAction {
	// A sheet is open: the dialog owns the keyboard.
	if (e.sheetOpen) return ignore;
	// Never take over while the user is typing or editing.
	if (e.inEditable) return ignore;
	// Modifier combos other than Shift are the browser's (copy, reload, …);
	// Shift is ours for "?".
	if (e.ctrlKey || e.altKey || e.metaKey) return ignore;

	if (e.key === 'Escape') {
		// No sheet open: leave the row (blur the preview button). With a
		// sheet open the dialog closes natively and restores focus to the
		// opener, which is the row again.
		return e.onRow ? { kind: 'leaveRow' } : ignore;
	}
	// "?" is Shift+/. Browsers report the key as "?"; some keyboard
	// simulators report the unshifted "/" with the shift flag, so both
	// spellings mean the same keypress.
	if (e.key === '?' || (e.key === '/' && e.shiftKey)) return { kind: 'showShortcuts' };
	if (e.key === 'j' || e.key === 'ArrowDown') {
		// The first press focuses the first row; after that, the next row.
		// Moving past the end does nothing.
		if (e.count === 0) return ignore;
		if (e.currentIndex === null) return { kind: 'focusRow', index: 0 };
		if (e.currentIndex >= e.count - 1) return ignore;
		return { kind: 'focusRow', index: e.currentIndex + 1 };
	}
	if (e.key === 'k' || e.key === 'ArrowUp') {
		// No row focused, or the first row: nothing. Moving past the start
		// does nothing.
		if (e.currentIndex === null || e.currentIndex <= 0) return ignore;
		return { kind: 'focusRow', index: e.currentIndex - 1 };
	}
	// The row actions need a current row: the row whose preview button has
	// focus. Space on any other button or link is the browser's click, and
	// Enter on the preview button opens it natively (a button click) - both
	// left alone.
	if (!e.onRow || e.currentIndex === null) return ignore;
	if (e.key === 'x' || e.key === ' ') return { kind: 'toggleSelect' };
	if (e.key === 'p') return { kind: 'toggleKeep' };
	if (e.key === 'o') return { kind: 'openPreview' };
	return ignore;
}
