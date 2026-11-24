import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONFIG } from '#lib/config';
import { HttpError, parseRetryAfter } from '#lib/net/errors';

import { publicGet } from './public';

function jsonResponse(
	body: unknown,
	init: { status?: number; headers?: Record<string, string> } = {}
): Response {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { 'content-type': 'application/json', ...init.headers }
	});
}

describe('publicGet', () => {
	const fetchMock = vi.fn();

	afterEach(() => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	});

	it('builds the right URL and skips undefined params', async () => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(jsonResponse({ handle: 'bsky.app' }));

		const data = await publicGet('app.bsky.actor.getProfile', {
			actor: 'bsky.app',
			limit: 1,
			cursor: undefined
		});

		expect(data).toEqual({ handle: 'bsky.app' });
		expect(fetchMock).toHaveBeenCalledWith(
			`${CONFIG.publicAppView}/xrpc/app.bsky.actor.getProfile?actor=bsky.app&limit=1`,
			expect.objectContaining({ headers: { accept: 'application/json' } })
		);
	});

	it('sends array params as repeated keys, not comma-joined', async () => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(jsonResponse({ relationships: [] }));

		await publicGet('app.bsky.graph.getRelationships', {
			actor: 'did:plc:me',
			others: ['did:plc:a', 'did:plc:b']
		});

		const url = fetchMock.mock.calls[0][0] as string;
		const params = new URL(url).searchParams;
		expect(params.getAll('others')).toEqual(['did:plc:a', 'did:plc:b']);
		expect(params.get('actor')).toBe('did:plc:me');
	});

	it('throws an HttpError carrying the XRPC code on a 400', async () => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(
			jsonResponse(
				{ error: 'AccountDeactivated', message: 'This account is deactivated.' },
				{ status: 400 }
			)
		);

		const e = await publicGet('app.bsky.actor.getProfile', { actor: 'someone.bsky.social' }).catch(
			(x) => x
		);

		expect(e).toBeInstanceOf(HttpError);
		expect((e as HttpError).code).toBe('AccountDeactivated');
		expect((e as HttpError).status).toBe(400);
		expect((e as HttpError).message).toBe('This account is deactivated.');
	});

	it('turns a network failure (no response) into a retryable HttpError', async () => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		const e = await publicGet('app.bsky.feed.getAuthorFeed', { actor: 'bsky.app' }).catch((x) => x);

		expect(e).toBeInstanceOf(HttpError);
		expect((e as HttpError).status).toBe(0);
		expect((e as HttpError).code).toBe('NetworkError');
	});
});

describe('parseRetryAfter', () => {
	it('parses a seconds value', () => {
		expect(parseRetryAfter('7')).toBe(7_000);
	});

	it('parses an HTTP date', () => {
		expect(parseRetryAfter(new Date(1_000_000).toUTCString(), 0)).toBe(1_000_000);
	});

	it('returns null for nothing or garbage', () => {
		expect(parseRetryAfter(null)).toBeNull();
		expect(parseRetryAfter('soon')).toBeNull();
	});
});
