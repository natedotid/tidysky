import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { classifyFeedItem, embedKind, firstMediaAlt, postTime } from './classify';

/** A hand-made getAuthorFeed response: fake accounts, one of each item and embed shape. */
function readFeedFixture(): unknown[] {
	const path = new URL('../../../tests/fixtures/public_getAuthorFeed.json', import.meta.url);
	const raw = readFileSync(fileURLToPath(path), 'utf8');
	const data = JSON.parse(raw) as { feed: unknown[] };
	return data.feed;
}

describe('fixture: public_getAuthorFeed.json', () => {
	it('classifies every item with a valid ISO time', () => {
		const feed = readFeedFixture();
		expect(feed.length).toBeGreaterThan(0);
		for (const item of feed) {
			const lite = classifyFeedItem(item);
			expect(lite).not.toBeNull();
			if (lite !== null) expect(Date.parse(lite.at)).not.toBeNaN();
		}
	});

	it('classifies the video repost from its reason', () => {
		const [item] = readFeedFixture();
		expect(classifyFeedItem(item)).toEqual({
			uri: 'at://did:plc:0000000000000000000000000000000000000001/app.bsky.feed.post/post00000001',
			kind: 'repost',
			at: '2026-01-10T01:25:45.258Z',
			embed: 'video',
			lang: 'en',
			words: 0
		});
	});

	it('classifies the reply, quote, link and text items', () => {
		const feed = readFeedFixture();
		expect(classifyFeedItem(feed[1])).toMatchObject({
			kind: 'reply',
			embed: 'image',
			lang: 'en',
			words: 7,
			at: '2026-01-09T09:30:00.000Z'
		});
		expect(classifyFeedItem(feed[2])).toMatchObject({
			kind: 'quote',
			embed: 'quote',
			lang: 'en',
			words: 6
		});
		expect(classifyFeedItem(feed[3])).toMatchObject({
			kind: 'post',
			embed: 'link',
			lang: 'fr',
			words: 9
		});
		expect(classifyFeedItem(feed[4])).toMatchObject({
			kind: 'post',
			embed: 'text',
			lang: 'en',
			words: 7
		});
	});
});

describe('hand-written items', () => {
	const post = {
		uri: 'at://did:plc:abc/app.bsky.feed.post/rkey1',
		record: {
			$type: 'app.bsky.feed.post',
			createdAt: '2026-01-02T03:04:05.678Z',
			text: 'hello world'
		},
		indexedAt: '2026-01-02T03:04:06.000Z'
	};

	it('times a repost from reason.indexedAt, with no words of its own', () => {
		const item = {
			post,
			reason: { $type: 'app.bsky.feed.defs#reasonRepost', indexedAt: '2026-02-03T04:05:06.789Z' }
		};
		expect(classifyFeedItem(item)).toMatchObject({
			kind: 'repost',
			at: '2026-02-03T04:05:06.789Z',
			words: 0
		});
	});

	it('treats a #view video embed as video', () => {
		const item = {
			post: {
				...post,
				embed: { $type: 'app.bsky.embed.video#view' }
			}
		};
		expect(classifyFeedItem(item)).toMatchObject({ kind: 'post', embed: 'video' });
	});

	it('treats recordWithMedia as a quote', () => {
		const item = {
			post: {
				...post,
				record: { ...post.record, embed: { $type: 'app.bsky.embed.recordWithMedia' } }
			}
		};
		expect(classifyFeedItem(item)).toMatchObject({ kind: 'quote', embed: 'quote' });
	});

	it('falls back to indexedAt when createdAt is garbage', () => {
		const item = {
			post: {
				...post,
				record: { ...post.record, createdAt: '2026-13-45' }
			}
		};
		expect(classifyFeedItem(item)?.at).toBe('2026-01-02T03:04:06.000Z');
	});

	it('classifies a reply by record.reply', () => {
		const item = {
			post: {
				...post,
				record: {
					...post.record,
					reply: { root: { uri: 'at://did:plc:x/app.bsky.feed.post/a' } }
				}
			}
		};
		expect(classifyFeedItem(item)).toMatchObject({ kind: 'reply' });
	});

	it('counts words and takes the first lang', () => {
		const item = {
			post: {
				...post,
				record: { ...post.record, text: 'one two  three', langs: ['en', 'fr'] }
			}
		};
		expect(classifyFeedItem(item)).toMatchObject({ words: 3, lang: 'en' });
	});

	it('ignores pinned items', () => {
		const item = { post, reason: { $type: 'app.bsky.feed.defs#reasonPin' } };
		expect(classifyFeedItem(item)).toBeNull();
	});

	it('returns null when no time can be determined', () => {
		const item = {
			post: {
				uri: post.uri,
				record: { $type: 'app.bsky.feed.post', text: 'hi' }
			}
		};
		expect(classifyFeedItem(item)).toBeNull();
	});

	it('returns null for an item with no usable post', () => {
		expect(classifyFeedItem({})).toBeNull();
		expect(classifyFeedItem({ post: null })).toBeNull();
		expect(classifyFeedItem({ post: { uri: 42 } })).toBeNull();
		expect(classifyFeedItem('nope')).toBeNull();
	});
});

describe('embedKind', () => {
	it('maps raw and view embed types', () => {
		expect(embedKind({ $type: 'app.bsky.embed.images' })).toBe('image');
		expect(embedKind({ $type: 'app.bsky.embed.external#view' })).toBe('link');
		expect(embedKind({ $type: 'app.bsky.embed.record#view' })).toBe('quote');
		expect(embedKind({ $type: 'app.bsky.embed.records' })).toBe('quote');
	});

	it('maps anything else to text', () => {
		expect(embedKind({ $type: 'app.bsky.embed.unknown' })).toBe('text');
		expect(embedKind({})).toBe('text');
		expect(embedKind(null)).toBe('text');
		expect(embedKind(undefined)).toBe('text');
	});
});

describe('firstMediaAlt', () => {
	it('takes images[0].alt, raw and view form', () => {
		expect(
			firstMediaAlt({
				$type: 'app.bsky.embed.images',
				images: [
					{ image: { blob: 'b1' }, alt: '  a dog in a field  ' },
					{ image: { blob: 'b2' }, alt: 'second' }
				]
			})
		).toBe('a dog in a field');
		expect(
			firstMediaAlt({
				$type: 'app.bsky.embed.images#view',
				images: [{ fullsize: 'https://x/i', alt: 'the view form' }]
			})
		).toBe('the view form');
	});

	it('takes the video alt, raw and view form', () => {
		expect(
			firstMediaAlt({ $type: 'app.bsky.embed.video', src: 'https://x/v.mp4', alt: 'a wave' })
		).toBe('a wave');
		expect(
			firstMediaAlt({ $type: 'app.bsky.embed.video#view', encoding: { src: 's' }, alt: 'a wave' })
		).toBe('a wave');
	});

	it('takes the alt one level down inside recordWithMedia.media', () => {
		expect(
			firstMediaAlt({
				$type: 'app.bsky.embed.recordWithMedia',
				record: { uri: 'at://x' },
				media: { $type: 'app.bsky.embed.images', images: [{ alt: 'quoted with a pic' }] }
			})
		).toBe('quoted with a pic');
	});

	it('is null with no media, no alt, or an empty alt', () => {
		expect(firstMediaAlt({ $type: 'app.bsky.embed.external', uri: 'https://x' })).toBeNull();
		expect(firstMediaAlt({ $type: 'app.bsky.embed.images', images: [{ image: {} }] })).toBeNull();
		expect(firstMediaAlt({ $type: 'app.bsky.embed.images', images: [{ alt: '   ' }] })).toBeNull();
		expect(firstMediaAlt({ $type: 'app.bsky.embed.images', images: [] })).toBeNull();
		expect(
			firstMediaAlt({
				$type: 'app.bsky.embed.recordWithMedia',
				record: { uri: 'at://x' },
				media: null // media that failed to load
			})
		).toBeNull();
		expect(firstMediaAlt(null)).toBeNull();
		expect(firstMediaAlt(undefined)).toBeNull();
	});
});

describe('postTime', () => {
	it('prefers record.createdAt', () => {
		expect(
			postTime({
				record: { createdAt: '2026-01-02T03:04:05.678Z' },
				indexedAt: '2026-01-02T03:04:06.000Z'
			})
		).toBe('2026-01-02T03:04:05.678Z');
	});

	it('returns null when neither time is usable', () => {
		expect(
			postTime({ record: { createdAt: '2026-13-45' }, indexedAt: 'also not a date' })
		).toBeNull();
		expect(postTime({})).toBeNull();
		expect(postTime(null)).toBeNull();
	});
});
