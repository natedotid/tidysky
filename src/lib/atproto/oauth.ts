import { BrowserOAuthClient } from '@atproto/oauth-client-browser';

import { clientMetadata } from './client-metadata';
import { HANDLE_RESOLVER, SCOPE } from './scopes';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export function isLoopback(hostname: string): boolean {
	return LOOPBACK_HOSTS.has(hostname);
}

/**
 * Dev client id. The atproto spec requires the loopback client_id URL to use the
 * origin `http://localhost` (regardless of the actual hostname, port or path),
 * while the `redirect_uri` carries the real IP-based URL the app is served from.
 */
export function loopbackClientId(origin: string, scope: string = SCOPE): string {
	const redirect = `${origin}/`;
	return `http://localhost?redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent(scope)}`;
}

let clientPromise: Promise<BrowserOAuthClient> | null = null;

/**
 * The single shared OAuth client. Loopback (local dev) builds its metadata from
 * the spec's hardcoded loopback client; production burns in `clientMetadata`.
 */
export function getOAuthClient(): Promise<BrowserOAuthClient> {
	if (!clientPromise) {
		clientPromise = isLoopback(location.hostname)
			? BrowserOAuthClient.load({
					clientId: loopbackClientId(location.origin),
					handleResolver: HANDLE_RESOLVER
				})
			: Promise.resolve(
					new BrowserOAuthClient({ clientMetadata, handleResolver: HANDLE_RESOLVER })
				);
	}
	return clientPromise;
}
