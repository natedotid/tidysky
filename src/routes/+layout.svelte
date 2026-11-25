<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/600.css';
	import '../styles/tokens.css';
	import '../styles/base.css';

	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { LayoutProps } from './$types';

	import { loadAnalytics } from '#lib/analytics';
	import { session } from '#lib/atproto/session.svelte';
	import { cleanupState } from '#lib/cleanup/cleanup-state.svelte';
	import { deleteDatabase } from '#lib/db/store';
	import { scanState } from '#lib/scan/scan-state.svelte';
	import TabBar from '#lib/ui/TabBar.svelte';

	let { children }: LayoutProps = $props();

	// `false` during SSR/pre-render: the banner is a browser-only concern.
	let offline = $state(false);

	/**
	 * Exit demo: throw away the demo database and go home. The demo data is
	 * disposable, so a storage failure is not an error worth showing.
	 */
	async function exitDemo(): Promise<void> {
		scanState.unbind();
		cleanupState.unbind();
		try {
			// 3-second cap inside, so this always finishes even if another
			// tab still has the demo database open.
			await deleteDatabase('demo');
		} catch {
			// Storage blocked or already gone: exiting works either way.
		}
		session.exitDemo();
		void goto(resolve('/'));
	}

	const APP_ROUTES = ['/insights', '/cleanup', '/lists', '/settings'] as const;
	function isAppRoute(path: string): boolean {
		return APP_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
	}

	const authed = $derived(session.status === 'signed-in' || session.demo);

	// Show the boot spinner only while the auth state is unresolved or the
	// path is about to be redirected away from. Public prerendered pages
	// (the landing page, Methodology, Privacy) never wait on the session:
	// that also means they prerender their real content instead of the
	// spinner (during SSR the session is always "loading"). A signed-in user
	// landing on "/" briefly sees the landing page before the redirect.
	const booting = $derived.by(() => {
		const path = page.url.pathname;
		if (path.startsWith('/dev/')) return false; // dev tools work signed out
		if (isAppRoute(path)) return session.status === 'loading' || !authed;
		return false;
	});

	onMount(() => {
		// Service worker, registered here instead of by SvelteKit (which would
		// also register it on the dev server, whose pages then 404 after the
		// first load because the worker's offline fallback is /200.html, which
		// dev does not serve). In production, register; in dev, unregister any
		// worker a preview or production session left behind.
		if (import.meta.env.PROD) {
			void navigator.serviceWorker.register('/service-worker.js');
		} else {
			void navigator.serviceWorker.getRegistrations().then((registrations) => {
				for (const registration of registrations) void registration.unregister();
			});
		}

		// The loopback OAuth flow requires an IP origin, never the `localhost`
		// hostname. Bounce to the IP form before touching the session.
		if (location.hostname === 'localhost') {
			location.replace(location.href.replace('localhost', '127.0.0.1'));
			return;
		}
		void session.initSession().finally(() => loadAnalytics());

		// The "You're offline" note (the worker serves the shell; this tells
		// the user their changes can't reach Bluesky).
		offline = !navigator.onLine;
		const goOffline = () => {
			offline = true;
		};
		const goOnline = () => {
			offline = false;
		};
		window.addEventListener('offline', goOffline);
		window.addEventListener('online', goOnline);
		return () => {
			window.removeEventListener('offline', goOffline);
			window.removeEventListener('online', goOnline);
		};
	});

	// ?demo=1 as an effect (not onMount) so it works on client-side
	// navigations too, the landing page's "Try it with sample data" link.
	// untrack: enterDemo reads this.demo, and without untrack the effect
	// would re-run the moment the demo exits (same URL still has ?demo=1)
	// and immediately re-enter it: "Exit demo" would do nothing.
	$effect(() => {
		if (page.url.searchParams.get('demo') === '1') untrack(() => session.enterDemo());
	});

	// Signed out, or the demo exited while signed out: forget the account
	// so nothing keeps a database connection open or a scan running.
	$effect(() => {
		const key = session.demo ? 'demo' : session.status === 'signed-in' ? session.did : null;
		if (key === null) {
			scanState.unbind();
			cleanupState.unbind();
		}
	});

	$effect(() => {
		const status = session.status;
		if (status === 'loading') return; // wait for the session to resolve
		const path = page.url.pathname;
		if (authed && path === '/') void goto(resolve('/insights'));
		else if (!authed && isAppRoute(path)) void goto(resolve('/'));
	});

	// Entering an app route: make sure the current account has a stored
	// scan or a running one. ensureStarted is a no-op when it already does.
	$effect(() => {
		const status = session.status;
		const path = page.url.pathname;
		if (status === 'loading' || !isAppRoute(path)) return;
		void scanState.ensureStarted();
	});
</script>

{#if booting}
	<div class="boot" role="status">
		<span class="spinner" aria-hidden="true"></span>
		<span>Loading…</span>
	</div>
{:else}
	{#if offline}
		<div class="offline-banner" role="note">
			<span>You're offline. TidySky can't reach Bluesky.</span>
		</div>
	{/if}
	{#if session.demo}
		<div class="demo-banner" role="note">
			<span>Demo mode: sample data only. Nothing touches a real account.</span>
			<button type="button" class="demo-exit" onclick={exitDemo}>Exit demo</button>
		</div>
	{/if}
	<!-- The tab bar stays on app routes even while an error renders there,
	     but a 404 lands on a public URL: the error page follows the layout's
	     public/app split and renders without the tab bar. -->
	{#if authed && (page.status === 200 || isAppRoute(page.url.pathname))}
		<TabBar />
	{/if}
	<main>
		{@render children()}
	</main>
{/if}

<style>
	.demo-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
		padding: var(--space-xs) var(--space-md);
		background: var(--color-surface-2);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.offline-banner {
		padding: var(--space-xs) var(--space-md);
		background: var(--color-surface-2);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.demo-exit {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: var(--color-primary);
		cursor: pointer;
	}

	.boot {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-md);
		color: var(--color-text-muted);
	}

	.spinner {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-accent);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 2s;
		}
	}
</style>
