import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { clientMetadata } from './client-metadata';
import { isLoopback, loopbackClientId } from './oauth';
import { SCOPE } from './scopes';

/** The JSON file the OAuth server fetches at the client_id URL. */
function readClientMetadataFile(): Record<string, unknown> {
	const path = new URL('../../../static/client-metadata.json', import.meta.url);
	const raw = readFileSync(fileURLToPath(path), 'utf8');
	return JSON.parse(raw) as Record<string, unknown>;
}

describe('client metadata', () => {
	it('keeps static/client-metadata.json in sync with the burned-in object', () => {
		expect(readClientMetadataFile()).toEqual(clientMetadata);
	});

	it('always requests the base atproto scope', () => {
		expect(clientMetadata.scope).toContain('atproto');
	});

	it('requests no blanket rpc:* scope, but does request muteActor', () => {
		expect(SCOPE).not.toContain('rpc:*');
		expect(SCOPE).toContain('rpc:app.bsky.graph.muteActor?aud=did:web:api.bsky.app%23bsky_appview');
	});
});

describe('loopback client', () => {
	it('builds a client id with a localhost origin and an IP-based redirect', () => {
		expect(loopbackClientId('http://127.0.0.1:5173')).toMatch(
			/^http:\/\/localhost\?redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A5173%2F&scope=/
		);
	});

	it('recognises loopback hosts and not production ones', () => {
		expect(isLoopback('127.0.0.1')).toBe(true);
		expect(isLoopback('localhost')).toBe(true);
		expect(isLoopback('tidysky.io')).toBe(false);
	});
});
