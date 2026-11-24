import { self } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';

// The cache is scoped to the app version: a new deployment installs a fresh
// `tidysky-*` cache, and activate deletes the old ones.
const CACHE = `tidysky-${version}`;

// $app/manifest paths are relative to the base path. This app uses the
// default base ('/', no config.paths), so the absolute pathname is '/' +
// path. ($app/paths' resolve/asset are typed for routes and static files
// only, which is not what these lists are.) If a base path is ever
// configured, this join needs to prefix it.
const abs = (path: string): string => (path.startsWith('/') ? path : `/${path}`);

const CLIENT_METADATA = abs('client-metadata.json');
// The SPA fallback: a generic shell with no server-rendered route, so when
// it loads the app boots and routes to whatever the current URL is. That is
// what makes offline navigation to any route work.
const FALLBACK = abs('200.html');

// The precache: the Vite build output, everything in static/ except
// client-metadata.json (never cached), and the SPA fallback.
const PRECACHE = [
	...immutable.map((file) => abs(file.path)),
	...assets.map((file) => abs(file.path)).filter((path) => path !== CLIENT_METADATA),
	FALLBACK
];

self.addEventListener('install', (event) => {
	// Add each URL on its own: with addAll a single 404 would reject the
	// whole install and the registration would be discarded. A missing
	// entry is recoverable: the fetch handler falls back to the network
	// for a cache miss.
	event.waitUntil(
		caches.open(CACHE).then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
	);
});

self.addEventListener('activate', (event) => {
	// Delete old TidySky caches, but leave other apps' caches alone.
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key.startsWith('tidysky-') && key !== CACHE)
						.map((key) => caches.delete(key))
				)
			)
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;

	// Same-origin GETs only: everything else (OAuth redirects, the Bluesky
	// API on bsky.social / *.bsky.app / plc.directory, …) goes to the network
	// untouched.
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	// client-metadata.json passes through and is never cached.
	if (url.pathname === CLIENT_METADATA) return;

	// Precached files (including the fallback): cache first.
	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
		return;
	}

	// Navigations: network first, falling back to the cached SPA shell when
	// offline. The shell boots the app, which routes to the requested page.
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(() =>
				caches.match(FALLBACK).then((cached) => cached ?? Response.error())
			)
		);
	}
	// Anything else same-origin is left to the network and never cached.
});
