/**
 * Pure classification of a Bluesky feed item into a small summary row. The
 * post record is the identical object the feed APIs return. No I/O: schema
 * drift shows up as a test failure, not silently wrong stats. Everything
 * arrives as `unknown` and is narrowed with small type guards; never cast
 * to a deep type.
 */

export type EmbedKind = 'text' | 'image' | 'video' | 'link' | 'quote';
export type ItemKind = 'post' | 'reply' | 'quote' | 'repost';

export interface FeedItemLite {
	uri: string;
	kind: ItemKind;
	/** ISO time of the activity: the repost time for reposts, else the post time. */
	at: string;
	/** 'text' when no embed. */
	embed: EmbedKind;
	/** First of record.langs, if it is a non-empty string. */
	lang: string | null;
	/** record.text split on whitespace; 0 for reposts. */
	words: number;
}

// Raw record forms; view forms get their "#view" suffix stripped first.
const EMBED_MAP: Record<string, EmbedKind> = {
	'app.bsky.embed.images': 'image',
	'app.bsky.embed.video': 'video',
	'app.bsky.embed.external': 'link',
	'app.bsky.embed.record': 'quote',
	'app.bsky.embed.records': 'quote',
	'app.bsky.embed.recordWithMedia': 'quote'
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === 'string' && v.length > 0;
}

/** True when the string parses to a real date. Never throws (month 13 → false). */
function isParseableDate(s: string): boolean {
	return !Number.isNaN(Date.parse(s));
}

/**
 * Map an embed (raw record form or `#view` form) to an EmbedKind. Unknown or
 * missing embeds are 'text'.
 */
export function embedKind(embed: unknown): EmbedKind {
	if (!isRecord(embed)) return 'text';
	return EMBED_MAP[mediaType(embed)] ?? 'text';
}

/**
 * The first media alt text of an embed, or null: `images[0].alt` for an
 * image embed, the video's `alt`, or the same one level down inside
 * `recordWithMedia.media`. Works for raw record forms and `#view` forms,
 * both keep `alt` in the same place. Trimmed; null when empty or absent.
 */
export function firstMediaAlt(embed: unknown): string | null {
	let media = embed;
	if (isRecord(media) && mediaType(media) === 'app.bsky.embed.recordWithMedia')
		media = media['media'];
	if (!isRecord(media)) return null;
	const type = mediaType(media);
	if (type === 'app.bsky.embed.video') {
		const alt = media['alt'];
		return typeof alt === 'string' && alt.trim().length > 0 ? alt.trim() : null;
	}
	if (type === 'app.bsky.embed.images') {
		const images = media['images'];
		if (Array.isArray(images) && images.length > 0 && isRecord(images[0])) {
			const alt = images[0]['alt'];
			return typeof alt === 'string' && alt.trim().length > 0 ? alt.trim() : null;
		}
	}
	return null;
}

/** The embed's $type with any `#view` suffix stripped; '' when absent. */
function mediaType(embed: Record<string, unknown>): string {
	const raw = embed['$type'];
	let type = isNonEmptyString(raw) ? raw : '';
	if (type.endsWith('#view')) type = type.slice(0, -'#view'.length);
	return type;
}

/**
 * The post time: record.createdAt (the source of truth), else the view's
 * indexedAt, else null. Feed responses carry no top-level post.createdAt.
 * Returns the original string so sub-second precision is preserved.
 */
export function postTime(post: unknown): string | null {
	if (!isRecord(post)) return null;
	const record = isRecord(post['record']) ? post['record'] : {};
	const createdAt = record['createdAt'];
	if (isNonEmptyString(createdAt) && isParseableDate(createdAt)) return createdAt;
	const indexedAt = post['indexedAt'];
	if (isNonEmptyString(indexedAt) && isParseableDate(indexedAt)) return indexedAt;
	return null;
}

/** First of record.langs if it is a non-empty string, else null. */
function firstLang(record: Record<string, unknown>): string | null {
	const langs = record['langs'];
	if (!Array.isArray(langs)) return null;
	const first = langs[0];
	return isNonEmptyString(first) ? first : null;
}

/**
 * A getAuthorFeed / getTimeline feedViewPost → a FeedItemLite, or null when
 * the shape is unusable (no usable post, or no determinable time). Pinned
 * items are ignored (null).
 */
export function classifyFeedItem(item: unknown): FeedItemLite | null {
	if (!isRecord(item)) return null;
	const post = item['post'];
	if (!isRecord(post) || !isNonEmptyString(post['uri'])) return null;

	const record = isRecord(post['record']) ? post['record'] : {};
	const reason = isRecord(item['reason']) ? item['reason'] : null;
	const reasonRaw = reason !== null ? reason['$type'] : null;
	const reasonType = isNonEmptyString(reasonRaw) ? reasonRaw : '';

	// Pinned items never count as activity.
	if (reasonType.endsWith('reasonPin')) return null;

	const embed = embedKind(record['embed'] ?? post['embed']);
	const lang = firstLang(record);
	const textRaw = record['text'];
	const text = isNonEmptyString(textRaw) ? textRaw : '';

	let kind: ItemKind;
	let at: string | null;
	let words: number;

	if (reasonType === 'app.bsky.feed.defs#reasonRepost') {
		kind = 'repost';
		// The activity is the repost: time it from reason, and it carries no text of its own.
		const repostAt = reason !== null ? reason['indexedAt'] : null;
		at = isNonEmptyString(repostAt) && isParseableDate(repostAt) ? repostAt : postTime(post);
		words = 0;
	} else {
		if (isRecord(record['reply'])) kind = 'reply';
		else if (embed === 'quote') kind = 'quote';
		else kind = 'post';
		at = postTime(post);
		words = text.split(/\s+/).filter(Boolean).length;
	}

	if (at === null) return null;
	return { uri: post['uri'], kind, at, embed, lang, words };
}
