import { describe, expect, it } from 'vitest';

import { resolveTheme } from './theme';

describe('resolveTheme', () => {
	it('follows the system preference when the saved choice is system', () => {
		expect(resolveTheme('system', true)).toBe('dark');
		expect(resolveTheme('system', false)).toBe('light');
	});

	it('keeps an explicit choice over the system preference', () => {
		expect(resolveTheme('light', true)).toBe('light');
		expect(resolveTheme('dark', false)).toBe('dark');
	});
});
