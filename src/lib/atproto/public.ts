import { CONFIG } from '#lib/config';
import { HttpError, parseRetryAfter } from '#lib/net/errors';

/**
 * Unauthenticated GET to the public AppView. Used for reads that need no
 * session (the activity scan) and for data the user's own PDS shouldn't see.
 * Every failure comes back as an `HttpError` so the request queue can treat
 * it like any other retryable error.
 */
/** XRPC array parameters are repeated keys (others=a&others=b), not comma-joined. */
export type QueryValue = string | number | readonly string[] | undefined;

export async function publicGet<T>(
	nsid: string,
	params: Record<string, QueryValue>,
	signal?: AbortSignal
): Promise<T> {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined) continue;
		if (typeof value === 'object') {
			for (const v of value) search.append(key, v);
		} else {
			search.set(key, String(value));
		}
	}
	const query = search.toString();
	const url = `${CONFIG.publicAppView}/xrpc/${nsid}${query ? `?${query}` : ''}`;

	let res: Response;
	try {
		res = await fetch(url, { signal, headers: { accept: 'application/json' } });
	} catch (e) {
		// A genuine abort is the caller's own cancellation, not a network error.
		if (e instanceof Error && e.name === 'AbortError') throw e;
		// A TypeError from fetch means the network or CORS blocked us: no response.
		throw new HttpError(0, 'NetworkError', 'Could not reach the Bluesky public API.', null);
	}

	if (!res.ok) {
		let code: string | null = null;
		let message = res.statusText;
		try {
			const body = (await res.json()) as { error?: unknown; message?: unknown };
			if (body && typeof body === 'object') {
				code = typeof body.error === 'string' ? body.error : null;
				if (typeof body.message === 'string') message = body.message;
			}
		} catch {
			// Non-JSON body: keep res.statusText.
		}
		throw new HttpError(res.status, code, message, parseRetryAfter(res.headers.get('retry-after')));
	}

	return (await res.json()) as T;
}
