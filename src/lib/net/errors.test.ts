import { TokenInvalidError, TokenRefreshError, TokenRevokedError } from '@atproto/oauth-client';
import { describe, expect, it } from 'vitest';

import { errorInfo, isAuthFailure, isRetryable, SessionExpiredError, HttpError } from './errors';

/** An XRPC-shaped error, the way the xrpc library builds them. */
function xrpcError(status: number, code: string): Error {
	const e = new Error('xrpc failure') as Error & {
		success: boolean;
		status: number;
		error: string;
	};
	e.success = false;
	e.status = status;
	e.error = code;
	return e;
}

describe('errorInfo', () => {
	it('maps OAuth token errors to a 401 the queue will not retry', () => {
		for (const e of [
			new TokenRefreshError('did:plc:x', 'refresh failed'),
			new TokenRevokedError('did:plc:x'),
			new TokenInvalidError('did:plc:x')
		]) {
			const info = errorInfo(e);
			expect(info.status).toBe(401);
			expect(info.code).toBe('SessionExpired');
			expect(info.retryAfterMs).toBeNull();
			expect(isRetryable(info.status)).toBe(false);
		}
	});

	it('still normalises HttpError and XRPC errors', () => {
		expect(errorInfo(new HttpError(429, null, 'slow down')).status).toBe(429);
		expect(errorInfo(xrpcError(500, 'ServerNotFound')).status).toBe(500);
		expect(errorInfo(xrpcError(500, 'ServerNotFound')).code).toBe('ServerNotFound');
		expect(errorInfo(new Error('mystery')).status).toBeNull();
	});
});

describe('isAuthFailure', () => {
	it('is true for a dead session in every shape', () => {
		expect(isAuthFailure(new SessionExpiredError())).toBe(true);
		expect(isAuthFailure(new TokenRefreshError('did:plc:x', 'refresh failed'))).toBe(true);
		expect(isAuthFailure(new TokenRevokedError('did:plc:x'))).toBe(true);
		expect(isAuthFailure(new TokenInvalidError('did:plc:x'))).toBe(true);
	});

	it('is true for 401 and expired-token responses, false for other failures', () => {
		expect(isAuthFailure(new HttpError(401, null, 'unauthorized'))).toBe(true);
		expect(isAuthFailure(xrpcError(401, 'InvalidToken'))).toBe(true);
		expect(isAuthFailure(xrpcError(403, 'ExpiredToken'))).toBe(true);
		expect(isAuthFailure(new HttpError(500, null, 'boom'))).toBe(false);
		expect(isAuthFailure(new HttpError(429, 'RateLimitExceeded', 'slow'))).toBe(false);
		expect(isAuthFailure(new Error('mystery'))).toBe(false);
	});
});
