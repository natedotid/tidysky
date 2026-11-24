import { Agent } from '@atproto/api';
import {
	type OAuthSession,
	TokenInvalidError,
	TokenRefreshError,
	TokenRevokedError
} from '@atproto/oauth-client';

import { track } from '#lib/analytics';
import { getOAuthClient } from './oauth';
import { SCOPE } from './scopes';

type Status = 'loading' | 'signed-out' | 'signed-in' | 'error';

/**
 * The single signed-in account. Svelte 5 rune state so the UI reacts to
 * sign-in / sign-out. `agent` and `oauth` are deliberately non-reactive: they
 * are stable handles, and swapping them is what a sign-in / sign-out does.
 */
class Session {
	status = $state<Status>('loading');
	did = $state<string | null>(null);
	handle = $state<string | null>(null);
	grantedScope = $state('');
	error = $state<string | null>(null);
	// Demo mode sets this; the layout and store keys check it.
	demo = $state(false);

	/** The atproto agent for the signed-in account, or null when signed out. */
	agent: Agent | null = null;
	/** The underlying OAuth session, kept for sign-out. */
	oauth: OAuthSession | null = null;

	private initialised = false;

	/**
	 * Restore (or process a returning) OAuth session. Call once on app start.
	 * Safe to call more than once: only the first call does the work.
	 */
	async initSession(): Promise<void> {
		if (this.initialised) return;
		this.initialised = true;
		try {
			const client = await getOAuthClient();
			const result = await client.init();
			if (!result) {
				this.status = 'signed-out';
				return;
			}
			await this.adopt(result.session);
			// A sign-in callback result carries `state`; a restored session
			// does not (see the BrowserOAuthClient.init type).
			if ('state' in result) track('Sign in');
		} catch (e) {
			// A stored session that is expired, revoked or otherwise unusable
			// means "sign in again", not "something is broken".
			if (isSessionError(e)) this.status = 'signed-out';
			else {
				this.status = 'error';
				this.error = describeError(e);
			}
		}
	}

	/** Begin the OAuth sign-in for a handle. Navigates away on success. */
	async signIn(rawHandle: string): Promise<void> {
		const handle = rawHandle.trim().replace(/^@/, '');
		if (!handle) {
			this.error = 'Enter your Bluesky handle to sign in.';
			return;
		}
		this.error = null;
		try {
			const client = await getOAuthClient();
			// Navigates to the OAuth server; the promise rejects only if the user
			// cancels or navigates back.
			await client.signIn(handle, { scope: SCOPE });
		} catch (e) {
			this.error = describeSignInError(e);
		}
	}

	/** Enter demo mode: no account, generated sample data. */
	enterDemo(): void {
		const started = !this.demo;
		this.demo = true;
		this.error = null;
		if (started) track('Demo started');
	}

	/** Leave demo mode. The caller deletes the demo database if it wants to. */
	exitDemo(): void {
		this.demo = false;
	}

	/** Sign out: revoke on Bluesky, then clear local state. Data stays on device. */
	async signOut(): Promise<void> {
		const oauth = this.oauth;
		this.agent = null;
		this.oauth = null;
		this.did = null;
		this.handle = null;
		this.grantedScope = '';
		this.error = null;
		this.status = 'signed-out';
		if (oauth) {
			try {
				await oauth.signOut();
			} catch {
				// Best effort: local state is already cleared.
			}
		}
	}

	/**
	 * The sign-in expired out from under us (an OAuth token that no longer
	 * refreshes). Clear the session like sign-out but without calling the
	 * server (the session is already dead) and tell the user on the
	 * landing page. Data stays on device, as with sign-out.
	 */
	expire(): void {
		this.agent = null;
		this.oauth = null;
		this.did = null;
		this.handle = null;
		this.grantedScope = '';
		this.status = 'signed-out';
		this.error = 'Your Bluesky sign-in expired. Please sign in again.';
	}

	/**
	 * True if the granted scope covers `part`, or if we hold the coarse
	 * `transition:generic` fallback that implies broad access.
	 */
	hasScope(part: string): boolean {
		return this.grantedScope.includes(part) || this.grantedScope.includes('transition:generic');
	}

	private async adopt(oauth: OAuthSession): Promise<void> {
		this.oauth = oauth;
		const agent = new Agent(oauth);
		this.agent = agent;
		this.did = oauth.sub;
		try {
			const tokenInfo = await oauth.getTokenInfo();
			this.grantedScope = tokenInfo.scope;
		} catch {
			this.grantedScope = '';
		}
		try {
			const profile = await agent.getProfile({ actor: oauth.sub });
			this.handle = profile.data.handle;
		} catch {
			this.handle = null;
		}
		this.status = 'signed-in';
	}
}

export const session = new Session();

/** True for errors that mean the stored OAuth session is gone. */
function isSessionError(e: unknown): boolean {
	return (
		e instanceof TokenRefreshError ||
		e instanceof TokenRevokedError ||
		e instanceof TokenInvalidError
	);
}

/** Map an unexpected error to a plain, non-technical sentence. */
function describeError(e: unknown): string {
	if (e instanceof Error && e.message) return e.message;
	return 'Something went wrong while signing in. Please try again.';
}

/** Map a sign-in failure to a plain sentence the user can act on. */
function describeSignInError(e: unknown): string {
	const message = e instanceof Error ? e.message : '';
	if (/navigated back|cancel/i.test(message)) return 'Sign-in was cancelled.';
	if (/not found|unknown|resolve/i.test(message))
		return "We couldn't find that handle. Check it and try again.";
	return "We couldn't sign you in. Please try again.";
}
