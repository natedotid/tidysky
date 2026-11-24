import type { DataSource, ProfileLite } from '#lib/scan/source';
import type { FollowAccount } from '#lib/scan/types';
import { describe, expect, it } from 'vitest';

import { preflight } from './preflight';

function acc(did: string, status: FollowAccount['status']): FollowAccount {
	return {
		did,
		handle: did.slice('did:plc:'.length) + '.bsky.social',
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
		status,
		activity: null,
		profileScannedAt: null,
		activityScannedAt: null,
		interaction: null
	};
}

function profile(did: string, handle?: string): ProfileLite {
	return {
		did,
		handle: handle ?? did.slice('did:plc:'.length) + '.bsky.social',
		displayName: null,
		avatar: null,
		description: null,
		createdAt: null,
		followersCount: null,
		followsCount: null,
		postsCount: null,
		followsYou: null,
		labels: []
	};
}

interface FakeConfig {
	profiles?: Map<string, ProfileLite>;
	/** When set, every getProfiles call rejects with this error. */
	profileError?: Error;
}

function makeFake(cfg: FakeConfig): { src: DataSource; calls: string[][] } {
	const calls: string[][] = [];
	const src = {
		async getProfiles(dids: string[]) {
			calls.push([...dids]);
			if (cfg.profileError) throw cfg.profileError;
			return dids.map((d) => cfg.profiles?.get(d)).filter((p): p is ProfileLite => p !== undefined);
		}
	} as unknown as DataSource;
	return { src, calls };
}

describe('preflight', () => {
	it('moves a gone account whose profile comes back to stillThere', async () => {
		const { src, calls } = makeFake({
			profiles: new Map([[acc('did:plc:back', 'gone').did, profile('did:plc:back')]])
		});
		const targets = [acc('did:plc:back', 'gone'), acc('did:plc:still-gone', 'gone')];
		const res = await preflight(src, targets);
		expect(res.stillThere.map((a) => a.did)).toEqual(['did:plc:back']);
		expect(res.run.map((a) => a.did)).toEqual(['did:plc:still-gone']);
		expect(res.unchecked).toBe(0);
		expect(calls).toEqual([['did:plc:back', 'did:plc:still-gone']]);
	});

	it('never re-checks active accounts', async () => {
		const { src, calls } = makeFake({ profiles: new Map() });
		const targets = [acc('did:plc:a', 'active'), acc('did:plc:g', 'gone')];
		const res = await preflight(src, targets);
		expect(calls).toEqual([['did:plc:g']]);
		// No profiles came back: everything stays in the run, order intact.
		expect(res.run.map((a) => a.did)).toEqual(['did:plc:a', 'did:plc:g']);
		expect(res.stillThere).toEqual([]);
	});

	it('keeps accounts in the run when the re-check itself fails', async () => {
		const { src } = makeFake({ profileError: new Error('network down') });
		const targets = [acc('did:plc:a', 'gone'), acc('did:plc:b', 'deactivated')];
		const res = await preflight(src, targets);
		expect(res.run.map((a) => a.did)).toEqual(['did:plc:a', 'did:plc:b']);
		expect(res.stillThere).toEqual([]);
		expect(res.unchecked).toBe(2);
	});

	it('treats a handle.invalid profile as not alive', async () => {
		const { src } = makeFake({
			profiles: new Map([
				[acc('did:plc:dead', 'deactivated').did, profile('did:plc:dead', 'handle.invalid')]
			])
		});
		const res = await preflight(src, [acc('did:plc:dead', 'deactivated')]);
		expect(res.run.map((a) => a.did)).toEqual(['did:plc:dead']);
		expect(res.stillThere).toEqual([]);
	});

	it('skips the call entirely when nothing is gone-type', async () => {
		const { src, calls } = makeFake({});
		const targets = [acc('did:plc:a', 'active'), acc('did:plc:b', 'unknown')];
		const res = await preflight(src, targets);
		expect(calls).toEqual([]);
		expect(res.run).toEqual(targets);
		expect(res.stillThere).toEqual([]);
	});
});
