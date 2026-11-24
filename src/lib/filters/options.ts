/**
 * The one options table for filters: the values each kind offers, the Add
 * filter sheet section it lives in, and whether its chip can match the
 * opposite. Both the Add filter sheet and the chip's edit sheet read from it,
 * so a value added here shows up in both.
 *
 * Kinds not in the table are not editable: "Since your last scan" (inSet)
 * and the free-text query have no value to pick, so their chips don't open
 * the edit sheet.
 */

import type { Clause, FilterClause } from './filters';

export interface FilterValue {
	/** Stable key that matches a stored clause back to its option. */
	key: string;
	/** Button text in the Add filter sheet. */
	label: string;
	/** The clause the button adds. */
	clause: FilterClause;
}

export interface FilterKind {
	kind: Clause['kind'];
	/** The Add filter sheet section this kind's buttons sit under. */
	section: string;
	/** The chip's edit sheet offers "Match the opposite". */
	negatable: boolean;
	/** The offered values, one per Add filter sheet button. */
	values: FilterValue[];
	/** The key of a stored clause's value, or null if it has none. */
	keyOf: (c: FilterClause) => string | null;
}

export const FILTER_KINDS: FilterKind[] = [
	{
		kind: 'quiet',
		section: 'Posting',
		negatable: true,
		values: [30, 60, 90, 180, 365].map((d) => ({
			key: String(d),
			label: `No posts in ${d} days`,
			clause: { kind: 'quiet', days: d }
		})),
		keyOf: (c) => (c.kind === 'quiet' ? String(c.days) : null)
	},
	{
		kind: 'neverPosted',
		section: 'Posting',
		negatable: true,
		values: [{ key: 'none', label: 'Never posted', clause: { kind: 'neverPosted' } }],
		keyOf: (c) => (c.kind === 'neverPosted' ? 'none' : null)
	},
	{
		kind: 'gone',
		section: 'Accounts',
		negatable: true,
		values: [{ key: 'gone', label: 'Deactivated or gone', clause: { kind: 'gone' } }],
		keyOf: (c) => (c.kind === 'gone' ? 'gone' : null)
	},
	{
		kind: 'labeled',
		section: 'Accounts',
		negatable: false,
		values: [{ key: 'labeled', label: 'Has a moderation label', clause: { kind: 'labeled' } }],
		keyOf: (c) => (c.kind === 'labeled' ? 'labeled' : null)
	},
	{
		kind: 'followsYou',
		section: 'Following',
		negatable: true,
		// Its two add buttons are the negation pair: the values carry the
		// negate flag, so the edit sheet skips its "Match the opposite" switch.
		values: [
			{ key: 'yes', label: 'Follows you back', clause: { kind: 'followsYou' } },
			{
				key: 'no',
				label: "Doesn't follow you back",
				clause: { kind: 'followsYou', negate: true }
			}
		],
		keyOf: (c) => (c.kind === 'followsYou' ? (c.negate === true ? 'no' : 'yes') : null)
	},
	{
		kind: 'hiddenByList',
		section: 'Following',
		negatable: true,
		values: [{ key: 'list', label: 'Hidden by a list', clause: { kind: 'hiddenByList' } }],
		keyOf: (c) => (c.kind === 'hiddenByList' ? 'list' : null)
	},
	{
		kind: 'blocksYou',
		section: 'Following',
		negatable: true,
		values: [{ key: 'you', label: 'Blocks you', clause: { kind: 'blocksYou' } }],
		keyOf: (c) => (c.kind === 'blocksYou' ? 'you' : null)
	},
	{
		kind: 'noKnownFollowers',
		section: 'Following',
		negatable: true,
		values: [
			{
				key: 'none',
				label: 'Followed by no one you follow',
				clause: { kind: 'noKnownFollowers' }
			}
		],
		keyOf: (c) => (c.kind === 'noKnownFollowers' ? 'none' : null)
	},
	{
		kind: 'followsMoreThan',
		section: 'Following',
		negatable: true,
		values: [1000, 2000, 5000].map((n) => ({
			key: String(n),
			label: `Follows more than ${n.toLocaleString('en-US')}`,
			clause: { kind: 'followsMoreThan', n }
		})),
		keyOf: (c) => (c.kind === 'followsMoreThan' ? String(c.n) : null)
	},
	{
		kind: 'ratioAbove',
		section: 'Following',
		negatable: false,
		values: [5, 10, 20].map((n) => ({
			key: String(n),
			label: `Follows ${n}× more than follow them`,
			clause: { kind: 'ratioAbove', n }
		})),
		keyOf: (c) => (c.kind === 'ratioAbove' ? String(c.n) : null)
	},
	{
		kind: 'postsPerDayAbove',
		section: 'Activity',
		negatable: false,
		values: [5, 10, 25].map((n) => ({
			key: String(n),
			label: `Posts more than ${n} a day`,
			clause: { kind: 'postsPerDayAbove', n }
		})),
		keyOf: (c) => (c.kind === 'postsPerDayAbove' ? String(c.n) : null)
	},
	{
		kind: 'postsPerDayBelow',
		section: 'Activity',
		negatable: false,
		values: [0.5, 1].map((n) => ({
			key: String(n),
			label: `Posts less than ${n} a day`,
			clause: { kind: 'postsPerDayBelow', n }
		})),
		keyOf: (c) => (c.kind === 'postsPerDayBelow' ? String(c.n) : null)
	},
	{
		kind: 'repostShareAbove',
		section: 'Activity',
		negatable: false,
		values: [
			{
				key: '0.5',
				label: 'Mostly reposts (over 50%)',
				clause: { kind: 'repostShareAbove', share: 0.5 }
			}
		],
		keyOf: (c) => (c.kind === 'repostShareAbove' ? String(c.share) : null)
	},
	{
		kind: 'mostlyMedia',
		section: 'Activity',
		negatable: false,
		values: [
			{ key: 'image', label: 'Mostly images', clause: { kind: 'mostlyMedia', media: 'image' } },
			{ key: 'video', label: 'Mostly videos', clause: { kind: 'mostlyMedia', media: 'video' } },
			{ key: 'link', label: 'Mostly links', clause: { kind: 'mostlyMedia', media: 'link' } }
		],
		keyOf: (c) => (c.kind === 'mostlyMedia' ? c.media : null)
	},
	{
		kind: 'medianWordsAbove',
		section: 'Activity',
		negatable: false,
		values: [
			{
				key: '35',
				label: 'Posts longer than 35 words',
				clause: { kind: 'medianWordsAbove', n: 35 }
			}
		],
		keyOf: (c) => (c.kind === 'medianWordsAbove' ? String(c.n) : null)
	},
	{
		kind: 'lang',
		section: 'Activity',
		negatable: false,
		values: ['en', 'es', 'de', 'fr', 'ja'].map((l) => ({
			key: l,
			label: `Posts in ${l}`,
			clause: { kind: 'lang', lang: l }
		})),
		keyOf: (c) => (c.kind === 'lang' ? c.lang : null)
	},
	{
		kind: 'noInteraction',
		section: 'Interactions',
		negatable: true,
		values: [
			{
				key: '30',
				label: 'No interaction in 30 days',
				clause: { kind: 'noInteraction', days: 30 }
			},
			{
				key: '90',
				label: 'No interaction in 3 months',
				clause: { kind: 'noInteraction', days: 90 }
			},
			{
				key: '180',
				label: 'No interaction in 6 months',
				clause: { kind: 'noInteraction', days: 180 }
			},
			{
				key: '365',
				label: 'No interaction in 12 months',
				clause: { kind: 'noInteraction', days: 365 }
			}
		],
		keyOf: (c) => (c.kind === 'noInteraction' ? String(c.days) : null)
	},
	{
		kind: 'interactionsAtLeast',
		section: 'Interactions',
		negatable: true,
		values: [3, 5, 10, 25].map((n) => ({
			key: String(n),
			label: `Interacted ${n}+ times in 12 months`,
			clause: { kind: 'interactionsAtLeast', n }
		})),
		keyOf: (c) => (c.kind === 'interactionsAtLeast' ? String(c.n) : null)
	},
	{
		kind: 'followedDaysAgo',
		section: 'Profile',
		negatable: true,
		values: [30, 90, 180, 365].map((d) => ({
			key: String(d),
			label: `Followed over ${d} days ago`,
			clause: { kind: 'followedDaysAgo', days: d }
		})),
		keyOf: (c) => (c.kind === 'followedDaysAgo' ? String(c.days) : null)
	},
	{
		kind: 'noAvatar',
		section: 'Profile',
		negatable: false,
		values: [{ key: 'none', label: 'No avatar', clause: { kind: 'noAvatar' } }],
		keyOf: (c) => (c.kind === 'noAvatar' ? 'none' : null)
	},
	{
		kind: 'noBio',
		section: 'Profile',
		negatable: false,
		values: [{ key: 'none', label: 'No bio', clause: { kind: 'noBio' } }],
		keyOf: (c) => (c.kind === 'noBio' ? 'none' : null)
	}
];

const byKind = new Map<string, FilterKind>(FILTER_KINDS.map((k) => [k.kind, k]));

/** The table entry for a chip's clause; null when the chip is not editable. */
export function kindFor(c: Clause): FilterKind | null {
	return byKind.get(c.kind) ?? null;
}

/** The index of the value a stored clause was made from; -1 when it matches none. */
export function valueIndex(k: FilterKind, c: FilterClause): number {
	const key = k.keyOf(c);
	return key === null ? -1 : k.values.findIndex((v) => v.key === key);
}

/**
 * The Add filter sheet's sections in order, each with its kinds' values
 * flattened. The Contains section (free text) is not a table kind; the sheet
 * keeps its own form for it.
 */
export const ADD_SECTIONS: Array<{ section: string; values: FilterValue[] }> = (() => {
	const out: Array<{ section: string; values: FilterValue[] }> = [];
	for (const k of FILTER_KINDS) {
		const last = out[out.length - 1];
		if (last !== undefined && last.section === k.section) last.values.push(...k.values);
		else out.push({ section: k.section, values: [...k.values] });
	}
	return out;
})();
