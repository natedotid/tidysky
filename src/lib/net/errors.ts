/**
 * One error shape for everything that talks to the network. Raw `fetch` calls
 * (the public AppView) throw `HttpError`; `@atproto/api` agent calls throw the
 * xrpc library's `XRPCError`. `errorInfo` normalises both into the same triple
 * so the request queue makes one retry decision for either.
 */

import { TokenInvalidError, TokenRefreshError, TokenRevokedError } from '@atproto/oauth-client';

export class HttpError extends Error {
	constructor(
		/** HTTP status, or 0 for a network-level failure (no response at all). */
		public status: number,
		/** XRPC "error" field, e.g. "AccountDeactivated". Null when absent. */
		public code: string | null,
		message: string,
		/** Parsed Retry-After, if the server sent one. */
		public retryAfterMs: number | null = null
	) {
		super(message);
		this.name = 'HttpError';
	}
}

/**
 * The sign-in is gone: never retry, stop the run, ask the user to sign in
 * again. Runs throw it when a write fails with an auth error; `errorInfo`
 * maps the OAuth token errors to a 401 so the queue never retries them
 * either.
 */
export class SessionExpiredError extends Error {
	constructor() {
		super('Your Bluesky sign-in expired.');
		this.name = 'SessionExpiredError';
	}
}

/**
 * True when the error means the OAuth session itself is dead (refresh failed,
 * token revoked or invalid, or the PDS says 401 / ExpiredToken / InvalidToken).
 * Such calls never succeed by retrying.
 */
export function isAuthFailure(e: unknown): boolean {
	if (e instanceof SessionExpiredError) return true;
	if (
		e instanceof TokenRefreshError ||
		e instanceof TokenRevokedError ||
		e instanceof TokenInvalidError
	)
		return true;
	const info = errorInfo(e);
	return info.status === 401 || info.code === 'ExpiredToken' || info.code === 'InvalidToken';
}

/** Narrow to our HttpError without trusting `instanceof` across copies. */
function isHttpError(e: unknown): e is HttpError {
	return e instanceof Error && 'code' in e && 'retryAfterMs' in e && 'status' in e;
}

/**
 * The xrpc error thrown by the agent. `status` is its ResponseType enum:
 * 1 = network failure, 2 = response failed validation, then real HTTP codes.
 * `headers` uses lowercase keys (from `Headers.entries()`).
 */
function isXrpcError(
	e: unknown
): e is Error & { status: number; error?: string; headers?: Record<string, string | undefined> } {
	return (
		e instanceof Error &&
		'success' in e &&
		'status' in e &&
		typeof (e as { status: unknown }).status === 'number'
	);
}

export interface ErrorInfo {
	/** HTTP status; null means network-level failure (treated as retryable). */
	status: number | null;
	/** XRPC error code for display/logging. */
	code: string | null;
	/** Server-suggested wait, if any. */
	retryAfterMs: number | null;
}

export function errorInfo(e: unknown): ErrorInfo {
	// The OAuth session is dead. Mapped to a 401 so the queue treats it as
	// final (never retryable) and callers can recognise it by code.
	if (
		e instanceof TokenRefreshError ||
		e instanceof TokenRevokedError ||
		e instanceof TokenInvalidError
	)
		return { status: 401, code: 'SessionExpired', retryAfterMs: null };
	if (isHttpError(e)) {
		return {
			status: e.status === 0 ? null : e.status,
			code: e.code,
			retryAfterMs: e.retryAfterMs
		};
	}
	if (isXrpcError(e)) {
		return {
			// 1 = "Unknown" in the xrpc enum: no response, i.e. a network error.
			status: e.status === 1 ? null : e.status,
			code: typeof e.error === 'string' && e.error ? e.error : null,
			retryAfterMs: e.headers ? parseRetryAfter(e.headers['retry-after'] ?? null) : null
		};
	}
	return { status: null, code: null, retryAfterMs: null };
}

/** Network failures, 429s and 5xx are worth retrying. Everything else is final. */
export function isRetryable(status: number | null): boolean {
	return status === null || status === 429 || (status >= 500 && status <= 599);
}

/** Retry-After is either seconds ("7") or an HTTP date. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
	const dateMs = Date.parse(value);
	if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - now);
	return null;
}
