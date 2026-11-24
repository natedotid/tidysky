import { CONFIG } from '#lib/config';
import { errorInfo, isRetryable, type ErrorInfo } from './errors';

export interface QueueOptions {
	concurrency: number;
	maxRetries: number;
	baseDelayMs: number;
	maxDelayMs: number;
	/** Injectable for tests; defaults to a real setTimeout. */
	sleep?: (ms: number) => Promise<void>;
	/**
	 * Injectable for tests; defaults to Date.now. Drives the queue-wide 429
	 * pause: a fake `sleep` in tests should advance a fake clock that this
	 * reads.
	 */
	now?: () => number;
	/** Injectable for tests; defaults to Math.random. Drives backoff jitter. */
	random?: () => number;
	/** Called with the info of every failed attempt, including ones that are retried. */
	onError?: (info: ErrorInfo) => void;
}

export interface RunOptions {
	/**
	 * Default true. A non-idempotent write (a createRecord, an applyWrites
	 * with creates) may have landed on the server before a dropped
	 * connection, so it is retried only on a 429: the server refused, so
	 * nothing was written.
	 */
	idempotent?: boolean;
}

interface Waiter {
	resolve: () => void;
	reject: (e: unknown) => void;
}

/**
 * Runs a bounded number of requests at once and retries rate limits and
 * server errors politely: exponential backoff with jitter, the server's
 * Retry-After honoured exactly, and a 429 pauses the whole queue, not just
 * the task that hit it. Every call to Bluesky in the app goes through one of
 * the two queues created at the bottom of this file.
 */
export class RequestQueue {
	private active = 0;
	private waiters: Waiter[] = [];
	private pausedUntil = 0;

	constructor(private opts: QueueOptions) {}

	/** Real time, or the test's fake clock. */
	private now(): number {
		return this.opts.now ? this.opts.now() : Date.now();
	}

	/** Runs `task` when a slot is free; retries 429 / 5xx / network errors with backoff. */
	async run<T>(task: () => Promise<T>, signal?: AbortSignal, opts?: RunOptions): Promise<T> {
		await this.acquire(signal);
		try {
			return await this.withRetry(task, signal, opts?.idempotent ?? true);
		} finally {
			this.release();
		}
	}

	private acquire(signal?: AbortSignal): Promise<void> {
		if (this.active < this.opts.concurrency) {
			this.active++;
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			let onAbort: (() => void) | undefined;
			const detach = () => {
				if (onAbort) signal?.removeEventListener('abort', onAbort);
			};
			const waiter: Waiter = {
				resolve: () => {
					detach();
					resolve();
				},
				reject: (e) => {
					detach();
					reject(e);
				}
			};
			this.waiters.push(waiter);
			if (signal) {
				onAbort = () => {
					const i = this.waiters.indexOf(waiter);
					if (i !== -1) {
						this.waiters.splice(i, 1);
						waiter.reject(new DOMException('Aborted', 'AbortError'));
					}
				};
				if (signal.aborted) onAbort();
				else signal.addEventListener('abort', onAbort, { once: true });
			}
		});
	}

	private release(): void {
		this.active--;
		const next = this.waiters.shift();
		if (next) {
			this.active++;
			next.resolve();
		}
	}

	private async withRetry<T>(
		task: () => Promise<T>,
		signal?: AbortSignal,
		idempotent = true
	): Promise<T> {
		const random = this.opts.random ?? Math.random;
		for (let attempt = 0; ; attempt++) {
			throwIfAborted(signal);
			await this.waitWhilePaused(signal);
			try {
				return await task();
			} catch (e) {
				// A cancellation is never a retryable failure.
				throwIfAborted(signal);
				const info = errorInfo(e);
				this.opts.onError?.(info);
				// A non-idempotent write may already be on the server; only a
				// 429 (refused, nothing written) is safe to retry.
				const retryable = idempotent ? isRetryable(info.status) : info.status === 429;
				if (!retryable || attempt === this.opts.maxRetries) throw e;
				const backoff = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * 2 ** attempt);
				// Honour Retry-After exactly; otherwise jittered exponential backoff.
				const delay = info.retryAfterMs ?? backoff * (0.5 + random() * 0.5);
				if (info.status === 429) this.pausedUntil = this.now() + delay;
				await this.sleep(delay);
			}
		}
	}

	/** Waits out a queue-wide pause (set by another task's 429). */
	private async waitWhilePaused(signal?: AbortSignal): Promise<void> {
		for (;;) {
			throwIfAborted(signal);
			const remaining = this.pausedUntil - this.now();
			if (remaining <= 0) return;
			await this.sleep(remaining);
		}
	}

	private sleep(ms: number): Promise<void> {
		return this.opts.sleep
			? this.opts.sleep(ms)
			: new Promise((resolve) => setTimeout(resolve, ms));
	}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function makeOptions(concurrency: number): QueueOptions {
	return {
		concurrency,
		maxRetries: CONFIG.maxRetries,
		baseDelayMs: CONFIG.baseDelayMs,
		maxDelayMs: CONFIG.maxDelayMs
	};
}

/** For unauthenticated reads against the public AppView. */
export function publicQueue(): RequestQueue {
	return new RequestQueue(makeOptions(CONFIG.publicConcurrency));
}

/** For signed-in calls to the user's PDS, gentler: it is their server. */
export function authQueue(): RequestQueue {
	return new RequestQueue(makeOptions(CONFIG.authConcurrency));
}
