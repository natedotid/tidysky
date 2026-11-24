import { describe, expect, it } from 'vitest';

import type { FollowAccount } from '#lib/scan/types';

import { reviewTargets } from './targets';

function acc(did: string): FollowAccount {
	return {
		did,
		handle: did,
		displayName: null,
		avatar: null,
		description: null,
		followRkeys: [],
		followedAt: null,
		createdAt: null,
		followersCount: null,
		followsCount: null,
		postsCount: null,
		followsYou: null,
		labels: [],
		status: 'active',
		activity: null,
		profileScannedAt: null,
		activityScannedAt: null,
		interaction: null
	};
}

describe('reviewTargets', () => {
	it('excludes a selected account that is not in the results', () => {
		const results = [acc('did:plc:a')];
		const selected = new Set(['did:plc:a', 'did:plc:gone']);
		expect(reviewTargets(results, selected, new Set()).map((a) => a.did)).toEqual(['did:plc:a']);
	});

	it('excludes a selected kept account', () => {
		const results = [acc('did:plc:a'), acc('did:plc:b')];
		const selected = new Set(['did:plc:a', 'did:plc:b']);
		expect(reviewTargets(results, selected, new Set(['did:plc:b'])).map((a) => a.did)).toEqual([
			'did:plc:a'
		]);
	});

	it('follows the results order, not the selection order', () => {
		const results = [acc('did:plc:c'), acc('did:plc:a'), acc('did:plc:b')];
		const selected = new Set(['did:plc:b', 'did:plc:a', 'did:plc:c']);
		expect(reviewTargets(results, selected, new Set()).map((a) => a.did)).toEqual([
			'did:plc:c',
			'did:plc:a',
			'did:plc:b'
		]);
	});

	it('is empty when nothing is selected', () => {
		expect(reviewTargets([acc('did:plc:a')], new Set(), new Set())).toEqual([]);
	});
});
