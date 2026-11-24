import { describe, expect, it } from 'vitest';

import type { FeedItemLite } from './classify';
import { daysSince, summarizeActivity } from './estimate';

const now = new Date('2026-11-02T12:00:00Z');
const DAY_MS = 86_400_000;

let seq = 0;
function item(overrides: Partial<FeedItemLite> = {}): FeedItemLite {
	seq += 1;
	return {
		uri: `at://did:plc:t/app.bsky.feed.post/${seq}`,
		kind: 'post',
		at: '2026-11-01T12:00:00.000Z',
		embed: 'text',
		lang: null,
		words: 10,
		...overrides
	};
}

describe('summarizeActivity', () => {
	it('empty items: zero rate, null times, all shares zero', () => {
		const s = summarizeActivity([], { now, exhausted: false, accountCreatedAt: null });
		expect(s.sampleSize).toBe(0);
		expect(s.itemsPerDay).toBe(0);
		expect(s.lastActiveAt).toBeNull();
		expect(s.lastPostAt).toBeNull();
		expect(s.share).toEqual({ post: 0, reply: 0, quote: 0, repost: 0 });
		expect(s.media).toEqual({ text: 0, image: 0, video: 0, link: 0, quote: 0 });
		expect(s.topLangs).toEqual([]);
		expect(s.medianWords).toBe(0);
	});

	it('30 items over 10 days, not exhausted: about 3 per day', () => {
		// Oldest item exactly 10 days before `now`, newest at `now`.
		const items = Array.from({ length: 30 }, (_, i) =>
			item({ at: new Date(now.getTime() - (10 * DAY_MS * i) / 29).toISOString() })
		);
		const s = summarizeActivity(items, { now, exhausted: false, accountCreatedAt: null });
		expect(s.itemsPerDay).toBeCloseTo(3, 1);
		expect(s.sampleSize).toBe(30);
		expect(s.lastActiveAt).toBe(items[0].at);
	});

	it('exhausted with a valid accountCreatedAt runs the span from creation', () => {
		const items = Array.from({ length: 5 }, (_, i) =>
			item({ at: new Date(now.getTime() - i * DAY_MS).toISOString() })
		);
		const createdAt = new Date(now.getTime() - 100 * DAY_MS).toISOString();
		const s = summarizeActivity(items, { now, exhausted: true, accountCreatedAt: createdAt });
		expect(s.exhausted).toBe(true);
		expect(s.itemsPerDay).toBeCloseTo(0.05, 2);
	});

	it('exhausted with an invalid accountCreatedAt falls back to the oldest item', () => {
		const items = [item({ at: new Date(now.getTime() - 10 * DAY_MS).toISOString() })];
		const s = summarizeActivity(items, {
			now,
			exhausted: true,
			accountCreatedAt: 'not a date'
		});
		expect(s.itemsPerDay).toBeCloseTo(0.1, 2);
	});

	it('a burst within the last 10 minutes is floored at a one-hour span', () => {
		const items = Array.from({ length: 30 }, (_, i) =>
			item({ at: new Date(now.getTime() - (600_000 - i * 1000)).toISOString() })
		);
		const s = summarizeActivity(items, { now, exhausted: false, accountCreatedAt: null });
		expect(s.itemsPerDay).toBe(30 / (1 / 24)); // 720
	});

	it('reposts count toward the rate and lastActiveAt, but not posts, media or words', () => {
		const postA = item({ at: '2026-11-01T00:00:00.000Z', words: 10 });
		const postB = item({ at: '2026-11-02T00:00:00.000Z', words: 20, embed: 'image' });
		const repost = item({
			at: '2026-11-02T11:00:00.000Z',
			kind: 'repost',
			embed: 'video',
			words: 0
		});
		const s = summarizeActivity([postA, postB, repost], {
			now,
			exhausted: false,
			accountCreatedAt: null
		});
		expect(s.lastActiveAt).toBe(repost.at);
		expect(s.lastPostAt).toBe(postB.at);
		// Span is 36 hours, 3 items: 2 per day.
		expect(s.itemsPerDay).toBeCloseTo(2, 1);
		expect(s.share.repost).toBeCloseTo(1 / 3, 5);
		expect(s.media.image).toBe(1);
		expect(s.media.video).toBe(0); // the repost's embed does not count
		expect(s.medianWords).toBe(15); // repost's words (0) are ignored
	});

	it('counts weekdayHour in device local time', () => {
		const at = '2026-11-02T12:00:00Z';
		const s = summarizeActivity([item({ at })], { now, exhausted: false, accountCreatedAt: null });
		const d = new Date(at);
		expect(s.weekdayHour[d.getDay()][d.getHours()]).toBe(1);
		const total = s.weekdayHour.flat().reduce((a, b) => a + b, 0);
		expect(total).toBe(1);
	});

	it('topLangs takes the top 3 over non-reposts, ties alphabetically', () => {
		const items = [
			item({ lang: 'en' }),
			item({ lang: 'en' }),
			item({ lang: 'fr' }),
			item({ lang: 'de' }),
			item({ lang: 'ja' }),
			item({ kind: 'repost', lang: 'en' }) // reposts do not count
		];
		const s = summarizeActivity(items, { now, exhausted: false, accountCreatedAt: null });
		expect(s.topLangs).toEqual([
			['en', 2],
			['de', 1],
			['fr', 1]
		]);
	});
});

describe('daysSince', () => {
	it('null is Infinity', () => {
		expect(daysSince(null, now)).toBe(Infinity);
	});

	it('days since a known time', () => {
		expect(daysSince('2026-11-01T12:00:00.000Z', now)).toBe(1);
		expect(daysSince('2026-10-03T12:00:00.000Z', now)).toBe(30);
	});

	it('future timestamps clamp at 0', () => {
		expect(daysSince('2026-11-03T12:00:00.000Z', now)).toBe(0);
	});
});
