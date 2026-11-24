import { describe, expect, it } from 'vitest';

import type { ProfileViewer } from './types';
import { blockApplies, blocksYou, hiddenByList, viewerFromProfile } from './viewer';

const LIST = 'at://did:plc:owner/app.bsky.graph.list/rk1';

function withViewer(viewer: Record<string, unknown> | undefined) {
	return { did: 'did:plc:x', handle: 'x.bsky.social', viewer };
}

describe('viewerFromProfile', () => {
	it('is null when the read carries no viewer', () => {
		expect(viewerFromProfile(null)).toBeNull();
		expect(viewerFromProfile({ did: 'did:plc:x' })).toBeNull();
		expect(viewerFromProfile(withViewer(undefined))).toBeNull();
	});

	it('reads a personal mute: muted with no list', () => {
		const v = viewerFromProfile(withViewer({ muted: true }));
		expect(v).toEqual({
			mutedByList: null,
			blockingByList: null,
			blockedBy: false,
			blockingPersonally: false,
			knownFollowers: null
		});
	});

	it('reads a list mute: muted plus mutedByList', () => {
		const v = viewerFromProfile(
			withViewer({ muted: true, mutedByList: { uri: LIST, name: 'No sports' } })
		);
		expect(v?.mutedByList).toEqual({ uri: LIST, name: 'No sports' });
		expect(v?.blockingByList).toBeNull();
	});

	it('reads a list block: blocking holds the list URI plus blockingByList', () => {
		const v = viewerFromProfile(
			withViewer({ blocking: LIST, blockingByList: { uri: LIST, name: 'Reply guys' } })
		);
		expect(v?.blockingByList).toEqual({ uri: LIST, name: 'Reply guys' });
		// The list block is not a personal block.
		expect(v?.blockingPersonally).toBe(false);
	});

	it('reads a personal block: blocking set with no blockingByList', () => {
		const v = viewerFromProfile(
			withViewer({ blocking: 'at://did:plc:x/app.bsky.graph.block/rk9' })
		);
		expect(v?.blockingPersonally).toBe(true);
		expect(v?.blockingByList).toBeNull();
	});

	it('reads blockedBy', () => {
		const v = viewerFromProfile(withViewer({ blockedBy: true }));
		expect(v?.blockedBy).toBe(true);
	});

	it('reads knownFollowers when present, null when absent', () => {
		expect(viewerFromProfile(withViewer({ knownFollowers: { count: 12 } }))?.knownFollowers).toBe(
			12
		);
		expect(viewerFromProfile(withViewer({}))?.knownFollowers).toBeNull();
	});

	it('ignores a malformed list', () => {
		const v = viewerFromProfile(withViewer({ muted: true, mutedByList: { uri: LIST } }));
		expect(v?.mutedByList).toBeNull();
	});
});

describe('the helpers read a parsed viewer', () => {
	const listMuted: ProfileViewer = {
		mutedByList: { uri: LIST, name: 'No sports' },
		blockingByList: null,
		blockedBy: false,
		blockingPersonally: false,
		knownFollowers: null
	};
	const listBlocked: ProfileViewer = {
		mutedByList: null,
		blockingByList: { uri: LIST, name: 'Reply guys' },
		blockedBy: false,
		blockingPersonally: false,
		knownFollowers: null
	};
	const blocksYouRow: ProfileViewer = {
		mutedByList: null,
		blockingByList: null,
		blockedBy: true,
		blockingPersonally: false,
		knownFollowers: null
	};
	const personalBlock: ProfileViewer = {
		mutedByList: null,
		blockingByList: null,
		blockedBy: false,
		blockingPersonally: true,
		knownFollowers: null
	};
	const plain: ProfileViewer = {
		mutedByList: null,
		blockingByList: null,
		blockedBy: false,
		blockingPersonally: false,
		knownFollowers: 4
	};

	it('hiddenByList: a list mute or list block hides, personal mute does not', () => {
		expect(hiddenByList(listMuted)).toBe(true);
		expect(hiddenByList(listBlocked)).toBe(true);
		expect(hiddenByList(plain)).toBe(false);
		expect(hiddenByList(null)).toBe(false);
	});

	it('blocksYou: only they-block-you', () => {
		expect(blocksYou(blocksYouRow)).toBe(true);
		expect(blocksYou(personalBlock)).toBe(false);
		expect(blocksYou(null)).toBe(false);
	});

	it('blockApplies: a block in either direction or by list', () => {
		expect(blockApplies(blocksYouRow)).toBe(true);
		expect(blockApplies(listBlocked)).toBe(true);
		expect(blockApplies(personalBlock)).toBe(true);
		expect(blockApplies(listMuted)).toBe(false);
		expect(blockApplies(plain)).toBe(false);
		expect(blockApplies(null)).toBe(false);
	});
});
