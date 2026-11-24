import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
	.version as string;

// `vite preview` serves .svelte-kit/output, but adapter-static writes the SPA
// fallback (200.html) into build/ only, so preview 404s /200.html while
// production (S3 serving build/) has it as a real file. Serve it in preview
// too, so the preview matches production and the service worker can precache
// the fallback there as well.
const previewServesFallback: Plugin = {
	name: 'tidysky-preview-fallback',
	configurePreviewServer(server) {
		server.middlewares.use((req, res, next) => {
			if (req.url?.split('?')[0] !== '/200.html') return next();
			const file = fileURLToPath(new URL('./build/200.html', import.meta.url));
			if (!existsSync(file)) return next();
			res.statusCode = 200;
			res.setHeader('content-type', 'text/html');
			createReadStream(file).pipe(res);
		});
	}
};

export default defineConfig({
	// Bind the dev and preview servers to 127.0.0.1, not `localhost`: the
	// loopback OAuth flow only works against an IP origin, and on some machines
	// `localhost` resolves to IPv6 only, so sign-in would fail.
	// Setting it in config (not just the npm scripts) keeps `vite preview` the
	// same for check:layout and anyone running it directly.
	server: { host: '127.0.0.1' },
	preview: { host: '127.0.0.1' },

	// The About section of Settings shows the app version; injecting it keeps
	// package.json the single source of truth.
	define: {
		__APP_VERSION__: JSON.stringify(version)
	},
	plugins: [
		previewServesFallback,
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// TidySky is a static SPA (no backend): 200.html is the fallback for
			// every route that is not prerendered.
			adapter: adapter({ fallback: '200.html' }),

			// Auto-registration is off: it would register the worker on the dev
			// server too (SvelteKit injects the register script on the SSR of the
			// first page load), and the worker's offline fallback (/200.html) is
			// not served by dev, so it 404s pages after the first load. The root
			// layout registers it in production only, and unregisters any worker
			// left over in dev.
			serviceWorker: { register: false },

			// Blocks injected scripts (second line of defense for the OAuth
			// tokens stored in this origin). Hash mode: prerendered pages can't
			// use nonces. `connect-src` is wide because the user's Bluesky
			// server can be any https host. `frame-ancestors` can't be set via
			// the <meta> tag SvelteKit emits for prerendered pages: CloudFront
			// sends it instead.
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'script-src': ['self', 'https://cdn.usefathom.com'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': [
						'self',
						'data:',
						'blob:',
						'https://cdn.bsky.app',
						'https://cdn.usefathom.com'
					],
					'font-src': ['self'],
					'connect-src': ['self', 'https:'],
					'worker-src': ['self'],
					'manifest-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self']
				}
			},

			// Feeds $app/env's `version` (the service worker scopes its cache
			// to it); same package.json value as __APP_VERSION__.
			version: { name: version }
		})
	],
	test: {
		expect: { requireAssertions: true },
		passWithNoTests: true,
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
