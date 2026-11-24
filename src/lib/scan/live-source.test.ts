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

	it('keeps follow-back unknown while a block applies, even when the relationship read says followed', async () => {
		const listUri = 'at://did:plc:owner/app.bsky.graph.list/rk1';
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						relationships: [
							{ did: 'did:plc:m', followedBy: 'at://did:plc:me/app.bsky.graph.follow/r1' },
							{ did: 'did:plc:lb', followedBy: 'at://did:plc:me/app.bsky.graph.follow/r2' },
							{ did: 'did:plc:bb', followedBy: 'at://did:plc:me/app.bsky.graph.follow/r3' }
						]
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
		);
		vi.stubGlobal('fetch', fetchMock);

		const viewers: Record<string, Record<string, unknown>> = {
			// A list mute does not touch follow-back.
			'did:plc:m': { muted: true, mutedByList: { uri: listUri, name: 'No sports' } },
			// A list block hides the relationship fields: unknown, not false.
			'did:plc:lb': { blocking: listUri, blockingByList: { uri: listUri, name: 'Reply guys' } },
			// They block you: unknown too.
			'did:plc:bb': { blockedBy: true }
		};
		const agent = {
			app: {
				bsky: {
					actor: {
						getProfiles: async ({ actors }: { actors: string[] }) => ({
							data: {
								profiles: actors.map((did: string) => ({
									did,
									handle: `${did.slice(-1)}.bsky.social`,
									viewer: viewers[did]
								}))
							}
						})
					}
				}
			}
		} as unknown as Agent;

		const source = new LiveSource(ME, agent);
		const profiles = await source.getProfiles([
			'did:plc:m',
			'did:plc:lb',
			'did:plc:bb',
			'did:plc:plain'
		]);

		const byDid = new Map(profiles.map((p) => [p.did, p]));
		// The list-mute row keeps its follow-back reading.
		expect(byDid.get('did:plc:m')?.followsYou).toBe(true);
		expect(byDid.get('did:plc:m')?.viewer?.mutedByList).toEqual({
			uri: listUri,
			name: 'No sports'
		});
		// Block in either direction: followsYou unknown, whatever the
		// relationship read said.
		expect(byDid.get('did:plc:lb')?.followsYou).toBeNull();
		expect(byDid.get('did:plc:lb')?.viewer?.blockingByList?.name).toBe('Reply guys');
		expect(byDid.get('did:plc:bb')?.followsYou).toBeNull();
		expect(byDid.get('did:plc:bb')?.viewer?.blockedBy).toBe(true);
		// No viewer at all: the relationship read stands.
		expect(byDid.get('did:plc:plain')?.followsYou).toBeNull();
		expect(byDid.get('did:plc:plain')?.viewer).toBeNull();
	});
});
