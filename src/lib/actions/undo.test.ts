import { describe, expect, it } from 'vitest';

import { undoKind } from './undo';

describe('undoKind', () => {
	it('refollows unfollows and move-to-list entries', () => {
		expect(undoKind('unfollow')).toBe('refollow');
		expect(undoKind('move-to-list')).toBe('refollow');
	});

	it('unmutes mutes', () => {
		expect(undoKind('mute')).toBe('unmute');
	});
});
