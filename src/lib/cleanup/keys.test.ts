import { describe, expect, it } from 'vitest';

import { keyAction, type KeyEvent } from './keys';

function ev(over: Partial<KeyEvent> = {}): KeyEvent {
	return {
		key: 'j',
		shiftKey: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		inEditable: false,
		sheetOpen: false,
		onRow: false,
		currentIndex: null,
		count: 5,
		...over
	};
}

/** A row with focus: the preview button of row i of 5. */
function onRow(i: number): Pick<KeyEvent, 'onRow' | 'currentIndex'> {
	return { onRow: true, currentIndex: i };
}

describe('keyAction', () => {
	describe('movement', () => {
		it('the first j focuses the first row', () => {
			expect(keyAction(ev({ key: 'j' }))).toEqual({ kind: 'focusRow', index: 0 });
		});
		it('the first ArrowDown focuses the first row', () => {
			expect(keyAction(ev({ key: 'ArrowDown' }))).toEqual({ kind: 'focusRow', index: 0 });
		});
		it('j and ArrowDown move to the next row while a row is focused', () => {
			expect(keyAction(ev({ key: 'j', ...onRow(1) }))).toEqual({ kind: 'focusRow', index: 2 });
			expect(keyAction(ev({ key: 'ArrowDown', ...onRow(1) }))).toEqual({
				kind: 'focusRow',
				index: 2
			});
		});
		it('k and ArrowUp move to the previous row while a row is focused', () => {
			expect(keyAction(ev({ key: 'k', ...onRow(2) }))).toEqual({ kind: 'focusRow', index: 1 });
			expect(keyAction(ev({ key: 'ArrowUp', ...onRow(2) }))).toEqual({
				kind: 'focusRow',
				index: 1
			});
		});
		it('k and ArrowUp do nothing when no row is focused', () => {
			expect(keyAction(ev({ key: 'k' }))).toEqual({ kind: 'ignore' });
			expect(keyAction(ev({ key: 'ArrowUp' }))).toEqual({ kind: 'ignore' });
		});
		it('moving past the end does nothing', () => {
			expect(keyAction(ev({ key: 'j', ...onRow(4) }))).toEqual({ kind: 'ignore' });
			expect(keyAction(ev({ key: 'ArrowDown', ...onRow(4) }))).toEqual({ kind: 'ignore' });
		});
		it('moving past the start does nothing', () => {
			expect(keyAction(ev({ key: 'k', ...onRow(0) }))).toEqual({ kind: 'ignore' });
			expect(keyAction(ev({ key: 'ArrowUp', ...onRow(0) }))).toEqual({ kind: 'ignore' });
		});
		it('j does nothing on an empty list', () => {
			expect(keyAction(ev({ key: 'j', count: 0 }))).toEqual({ kind: 'ignore' });
		});
	});

	describe('row actions', () => {
		it('x and Space select or deselect the current row', () => {
			expect(keyAction(ev({ key: 'x', ...onRow(2) }))).toEqual({ kind: 'toggleSelect' });
			expect(keyAction(ev({ key: ' ', ...onRow(2) }))).toEqual({ kind: 'toggleSelect' });
		});
		it('p keeps or unkeeps the current row', () => {
			expect(keyAction(ev({ key: 'p', ...onRow(2) }))).toEqual({ kind: 'toggleKeep' });
		});
		it("o opens the current row's preview", () => {
			expect(keyAction(ev({ key: 'o', ...onRow(2) }))).toEqual({ kind: 'openPreview' });
		});
		it('the row actions do nothing when no row is focused', () => {
			for (const key of ['x', ' ', 'p', 'o']) {
				expect(keyAction(ev({ key })), key).toEqual({ kind: 'ignore' });
			}
		});
		it('Enter is left to the browser: the preview button clicks natively', () => {
			expect(keyAction(ev({ key: 'Enter', ...onRow(2) }))).toEqual({ kind: 'ignore' });
			expect(keyAction(ev({ key: 'Enter' }))).toEqual({ kind: 'ignore' });
		});
	});

	describe('Escape and ?', () => {
		it('Escape leaves the row when it is focused', () => {
			expect(keyAction(ev({ key: 'Escape', ...onRow(1) }))).toEqual({ kind: 'leaveRow' });
		});
		it('Escape does nothing when no row is focused (no sheet either)', () => {
			expect(keyAction(ev({ key: 'Escape' }))).toEqual({ kind: 'ignore' });
		});
		it('? opens the shortcuts sheet, with or without a focused row', () => {
			// ? is Shift+/: Shift is the one allowed modifier.
			expect(keyAction(ev({ key: '?', shiftKey: true }))).toEqual({ kind: 'showShortcuts' });
			expect(keyAction(ev({ key: '?', shiftKey: true, ...onRow(1) }))).toEqual({
				kind: 'showShortcuts'
			});
			// Some keyboard simulators report the unshifted "/" with the shift
			// flag; it is the same keypress.
			expect(keyAction(ev({ key: '/', shiftKey: true }))).toEqual({ kind: 'showShortcuts' });
			// Bare / (the browser's find) is not a shortcut.
			expect(keyAction(ev({ key: '/' }))).toEqual({ kind: 'ignore' });
		});
	});

	describe('leave-alone cases', () => {
		it('a sheet open: every key, Escape included, is left alone', () => {
			for (const key of ['j', 'k', 'x', ' ', 'p', 'o', 'Enter', 'Escape', '?']) {
				expect(keyAction(ev({ key, sheetOpen: true, ...onRow(1) })), key).toEqual({
					kind: 'ignore'
				});
			}
		});
		it('focus in an editable: every key is left alone', () => {
			for (const key of ['j', 'k', 'x', ' ', 'p', 'o', 'Enter', 'Escape', '?']) {
				expect(keyAction(ev({ key, inEditable: true })), key).toEqual({ kind: 'ignore' });
			}
		});
		it('a modifier other than Shift is held: every key is left alone', () => {
			for (const mod of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
				for (const key of ['j', 'k', 'x', ' ', 'p', 'o', 'Escape', '?']) {
					expect(keyAction(ev({ key, ...mod })), `${key}+${JSON.stringify(mod)}`).toEqual({
						kind: 'ignore'
					});
				}
			}
		});
		it('Shift with a letter is not a shortcut (only for ?)', () => {
			for (const key of ['J', 'K', 'X', 'P', 'O']) {
				expect(keyAction(ev({ key, shiftKey: true })), key).toEqual({ kind: 'ignore' });
			}
		});
		it('unlisted keys do nothing', () => {
			for (const key of ['a', 's', 'd', 'f', 'l', 'h', 'n', 'm', '/', '0', 'Backspace', 'Tab']) {
				expect(keyAction(ev({ key, ...onRow(1) })), key).toEqual({ kind: 'ignore' });
			}
		});
	});
});
