// The /dev pages are tools for this repository, not part of the product.
// On the built app the client router still knows their routes and the host
// serves 200.html for any path, so without this guard a typed URL would
// render the page live; 404 it everywhere but the dev server, where `dev`
// is true and the tools are meant to be reachable.
import { dev } from '$app/env';
import { error } from '@sveltejs/kit';

export function load() {
	if (!dev) throw error(404, 'Not found');
}
