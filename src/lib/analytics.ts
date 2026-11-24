/**
 * Fathom Analytics: page views and a few anonymous events, on
 * https://tidysky.io only. Never in dev, preview or tests, and never with
 * sign-in data: the script is injected only after the OAuth callback has
 * been cleaned out of the URL (see the layout's onMount).
 */
const SITE_ID = 'FRPVRYEB';
const SCRIPT_SRC = 'https://cdn.usefathom.com/script.js';
export const ANALYTICS_HOST = 'tidysky.io';

/** The only event names TidySky sends (fix 15). Never put handles, DIDs, counts or filter text in an event. */
export type AnalyticsEvent =
	| 'Sign in'
	| 'Demo started'
	| 'Scan finished'
	| 'Unfollow run'
	| 'Move to list run'
	| 'Mute run'
	| 'List created'
	| 'Undo'
	| 'CSV export'
	| 'Data deleted';

interface FathomApi {
	trackEvent(name: string, opts?: { _value?: number }): void;
}

declare global {
	interface Window {
		fathom?: FathomApi;
	}
}

/** Pure, for tests: load only on the production host, never on dev tools. */
export function shouldLoadAnalytics(hostname: string, pathname: string): boolean {
	return hostname === ANALYTICS_HOST && !pathname.startsWith('/dev/');
}

let state: 'idle' | 'loading' | 'ready' | 'off' = 'idle';
const pending: AnalyticsEvent[] = [];

/** Inject Fathom once. Call only after the OAuth callback has been processed. */
export function loadAnalytics(): void {
	if (state !== 'idle') return;
	if (!shouldLoadAnalytics(location.hostname, location.pathname)) {
		state = 'off';
		pending.length = 0;
		return;
	}
	state = 'loading';
	const s = document.createElement('script');
	s.src = SCRIPT_SRC;
	s.defer = true;
	s.dataset.site = SITE_ID;
	s.dataset.spa = 'history'; // route changes via the History API; never the URL hash
	s.dataset.honorDnt = 'true'; // → data-honor-dnt="true"
	s.addEventListener('load', () => {
		state = 'ready';
		for (const e of pending.splice(0)) send(e);
	});
	s.addEventListener('error', () => {
		state = 'off'; // blocked by an ad blocker or offline: fine, stay silent
		pending.length = 0;
	});
	document.head.append(s);
}

/** Record an anonymous event. Safe to call any time; never throws. */
export function track(event: AnalyticsEvent): void {
	if (state === 'off') return;
	if (state !== 'ready') {
		if (pending.length < 20) pending.push(event);
		return;
	}
	send(event);
}

function send(event: AnalyticsEvent): void {
	try {
		window.fathom?.trackEvent(event);
	} catch {
		// Analytics must never break the app.
	}
}
