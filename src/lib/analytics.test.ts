import { describe, expect, it } from 'vitest';

import { ANALYTICS_HOST, shouldLoadAnalytics } from './analytics';

describe('shouldLoadAnalytics', () => {
	it('loads on the production host', () => {
		expect(shouldLoadAnalytics('tidysky.io', '/insights')).toBe(true);
		expect(ANALYTICS_HOST).toBe('tidysky.io');
	});

	it('never loads off the production host', () => {
		expect(shouldLoadAnalytics('www.tidysky.io', '/')).toBe(false);
		expect(shouldLoadAnalytics('127.0.0.1', '/')).toBe(false);
		expect(shouldLoadAnalytics('localhost', '/')).toBe(false);
	});

	it('never loads on the dev tools', () => {
		expect(shouldLoadAnalytics('tidysky.io', '/dev/charts')).toBe(false);
	});
});
