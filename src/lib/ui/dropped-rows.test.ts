import { describe, expect, it } from 'vitest';

import type { ProfileLite } from '#lib/scan/source';

import { droppedRows } from './dropped-rows';

function profile(did: string): ProfileLite {
	return {
		did,
		handle: did.slice('did:plc:'.length) + '.bsky.social',
		displayName: null,
		avatar: null,
		description: null,
		createdAt: null,
		followersCount: null,
		followsCount: null,
		postsCount: null,
		followsYou: false,
		labels: []
	};
}

describe('droppedRows', () => {
	it('keeps the DID order and fills in the profiles that came back', () => {
		const rows = droppedRows(['a', 'b', 'c'], [profile('c'), profile('a')]);
		expect(rows).toEqual([
			{ did: 'a', profile: profile('a') },
			{ did: 'b', profile: null },
			{ did: 'c', profile: profile('c') }
		]);
	});

	it('a DID with no profile becomes the "No longer available" row', () => {
		const rows = droppedRows(['gone'], []);
		expect(rows).toEqual([{ did: 'gone', profile: null }]);
	});
});
