import type { Agent } from '@atproto/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LiveSource } from './live-source';

const ME = 'did:plc:me';

describe('LiveSource.getProfiles', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('maps follow-back rows to true, false and null', async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						relationships: [
							{ did: 'did:plc:a', followedBy: 'at://did:plc:me/app.bsky.graph.follow/r1' },
							{ did: 'did:plc:b' } // no followedBy: they don't follow back
						]
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
		);
		vi.stubGlobal('fetch', fetchMock);

		const agent = {
			app: {
				bsky: {
					actor: {
						getProfiles: async ({ actors }: { actors: string[] }) => ({
							data: {
								profiles: actors.map((did: string) => ({
									did,
									handle: `${did.slice(-1)}.bsky.social`
								}))
							}
						})
					}
				}
			}
		} as unknown as Agent;

		const source = new LiveSource(ME, agent);
		const profiles = await source.getProfiles(['did:plc:a', 'did:plc:b', 'did:plc:c']);

		const byDid = new Map(profiles.map((p) => [p.did, p.followsYou]));
		expect(byDid.get('did:plc:a')).toBe(true);
		expect(byDid.get('did:plc:b')).toBe(false);
		// A DID missing from a successful response is unknown, not false.
		expect(byDid.get('did:plc:c')).toBeNull();
		// The DIDs went out as repeated params, not one comma-joined value.
		const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
		const url = calls[0][0] as string;
		expect(new URL(url).searchParams.getAll('others')).toEqual([
			'did:plc:a',
			'did:plc:b',
			'did:plc:c'
		]);
	});
});
