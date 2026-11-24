import { describe, expect, it } from 'vitest';

import { HttpError, type ErrorInfo } from './errors';
import { RequestQueue } from './queue';

/**
 * A queue with an instant fake sleep that records the delays it was asked for,
 * and a fixed random (0.5 → jitter factor of exactly 1.0, so backoff is
 * deterministic: 800, 1600, 3200, …). The fake sleep advances a fake clock
 * that the fake `now` reads, so 429 pauses end exactly when expected.
 */
function makeQueue(
	opts: {
		concurrency?: number;
		maxRetries?: number;
		onError?: (info: ErrorInfo) => void;
	} = {}
) {
	const delays: number[] = [];
	let clock = 0;
	const queue = new RequestQueue({
		concurrency: opts.concurrency ?? 3,
		maxRetries: opts.maxRetries ?? 4,
		baseDelayMs: 800,
		maxDelayMs: 30_000,
		sleep: async (ms) => {
			clock += ms;
			delays.push(ms);
		},
		now: () => clock,
		random: () => 0.5,
		onError: opts.onError
	});
	return { queue, delays, now: () => clock };
}

describe('RequestQueue', () => {
	it('never runs more than `concurrency` tasks at once', async () => {
		const { queue } = makeQueue({ concurrency: 3 });
		let active = 0;
		let max = 0;
		const tasks = Array.from({ length: 20 }, () =>
			queue.run(async () => {
				active++;
				max = Math.max(max, active);
				await new Promise((r) => setTimeout(r, 1));
				active--;
			})
		);
		await Promise.all(tasks);
		expect(max).toBeLessThanOrEqual(3);
	});

	it('retries 429s and succeeds, with growing delays', async () => {
		const { queue, delays } = makeQueue();
		let calls = 0;
		const result = await queue.run(async () => {
			calls++;
			if (calls < 3) throw new HttpError(429, 'RateLimitExceeded', 'slow down');
			return 'ok';
		});
		expect(result).toBe('ok');
		expect(calls).toBe(3);
		expect(delays).toHaveLength(2);
		expect(delays[1]).toBeGreaterThan(delays[0]);
	});

	it('waits exactly the Retry-After a 429 asks for', async () => {
		const { queue, delays } = makeQueue();
		let calls = 0;
		const result = await queue.run(async () => {
			calls++;
			if (calls === 1) throw new HttpError(429, null, 'rate limited', 5_000);
			return 'ok';
		});
		expect(result).toBe('ok');
		expect(delays).toEqual([5_000]);
	});

	it('does not retry non-retryable errors', async () => {
		const { queue, delays } = makeQueue();
		let calls = 0;
		await expect(
			queue.run(async () => {
				calls++;
				throw new HttpError(400, 'AccountDeactivated', 'nope');
			})
		).rejects.toThrow('nope');
		expect(calls).toBe(1);
		expect(delays).toHaveLength(0);
	});

	it('rethrows the error after maxRetries', async () => {
		const { queue, delays } = makeQueue({ maxRetries: 2 });
		let calls = 0;
		await expect(
			queue.run(async () => {
				calls++;
				throw new HttpError(503, null, 'unavailable');
			})
		).rejects.toThrow('unavailable');
		// attempts 0, 1 and 2
		expect(calls).toBe(3);
		expect(delays).toHaveLength(2);
	});

	it('a 429 pauses the whole queue, not just the task that hit it', async () => {
		let saw429: (() => void) | undefined;
		const got429 = new Promise<void>((resolve) => (saw429 = resolve));
		const { queue, now } = makeQueue({
			concurrency: 2,
			onError: (info) => {
				if (info.status === 429) saw429?.();
			}
		});
		let aCalls = 0;
		const a = queue.run(async () => {
			aCalls++;
			if (aCalls === 1) throw new HttpError(429, 'RateLimitExceeded', 'slow down', 5_000);
			return 'a';
		});
		// A's 429 has landed, so the queue is paused until fake time 5000.
		await got429;
		// B starts after A's failure: its first call must wait out the pause.
		let bFirstCallAt: number | null = null;
		const b = queue.run(async () => {
			bFirstCallAt = now();
			return 'b';
		});
		const [ra, rb] = await Promise.all([a, b]);
		expect(ra).toBe('a');
		expect(rb).toBe('b');
		expect(bFirstCallAt).toBeGreaterThanOrEqual(5_000);
	});

	it('does not retry a non-idempotent task on a 503 or network error', async () => {
		const { queue } = makeQueue();
		let calls = 0;
		await expect(
			queue.run(
				async () => {
					calls++;
					throw new HttpError(503, null, 'unavailable');
				},
				undefined,
				{ idempotent: false }
			)
		).rejects.toThrow('unavailable');
		expect(calls).toBe(1);
	});

	it('retries a non-idempotent task on a 429', async () => {
		const { queue } = makeQueue();
		let calls = 0;
		const result = await queue.run(
			async () => {
				calls++;
				if (calls === 1) throw new HttpError(429, 'RateLimitExceeded', 'slow down');
				return 'ok';
			},
			undefined,
			{ idempotent: false }
		);
		expect(result).toBe('ok');
		expect(calls).toBe(2);
	});

	it('rejects waiting tasks when the signal aborts', async () => {
		const { queue } = makeQueue({ concurrency: 1 });
		const controller = new AbortController();
		const blocker = queue.run(() => new Promise((r) => setTimeout(r, 50)));
		await new Promise((r) => setTimeout(r, 5));
		const waiting = queue.run(async () => 'never', controller.signal);
		controller.abort();
		await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
		await blocker;
	});

	it('reports every failed attempt to onError, even the final one', async () => {
		const seen: Array<number | null> = [];
		let clock = 0;
		const queue = new RequestQueue({
			concurrency: 1,
			maxRetries: 2,
			baseDelayMs: 100,
			maxDelayMs: 1_000,
			sleep: async (ms) => {
				clock += ms;
			},
			now: () => clock,
			random: () => 0.5,
			onError: (info) => {
				seen.push(info.status);
			}
		});
		let calls = 0;
		await queue
			.run(async () => {
				calls++;
				throw new HttpError(429, null, 'limited');
			})
			.catch(() => {});
		expect(calls).toBe(3);
		expect(seen).toEqual([429, 429, 429]);
	});
});
