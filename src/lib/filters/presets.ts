import type { FilterSpec } from './filters';

export interface Preset {
	id: string;
	name: string;
	blurb: string;
	spec: FilterSpec;
}

/**
 * The presets shown directly on the Clean up row; the rest live in the
 * "More presets" sheet only. A sheet-picked preset not in this list gets its
 * own selected pill in the row. Later groups (like "Yours") add entries here
 * without a layout change.
 */
export const CLEANUP_ROW_PRESETS: string[] = ['gone', 'quiet90', 'notBack', 'oneWay'];

export const CLEANUP_PRESETS: Preset[] = [
	{
		id: 'gone',
		name: 'Gone',
		blurb: 'Deactivated, deleted or suspended accounts.',
		spec: { clauses: [{ kind: 'gone' }] }
	},
	{
		id: 'never',
		name: 'Never posted',
		blurb: 'Accounts with no posts at all.',
		spec: { clauses: [{ kind: 'neverPosted' }] }
	},
	{
		id: 'quiet90',
		name: 'Quiet',
		blurb: 'No posts or reposts in 90 days.',
		spec: { clauses: [{ kind: 'quiet', days: 90 }] }
	},
	{
		id: 'notBack',
		name: "Doesn't follow back",
		blurb: "Accounts that don't follow you.",
		spec: { clauses: [{ kind: 'followsYou', negate: true }] }
	},
	{
		// Sheet only: these need the signed-in read, so they stay out of the
		// row's always-visible preset pills.
		id: 'hiddenByList',
		name: 'Hidden by a list',
		blurb:
			'Muted or blocked by a moderation list you subscribe to. To see them again, unsubscribe from the list on Bluesky.',
		spec: { clauses: [{ kind: 'hiddenByList' }] }
	},
	{
		id: 'blocksYou',
		name: 'Blocks you',
		blurb: "They've blocked you, so nothing of theirs reaches you.",
		spec: { clauses: [{ kind: 'blocksYou' }] }
	},
	{
		id: 'oneWay',
		name: 'Active, but no interaction',
		blurb:
			"Posted in the last 30 days, but you haven't liked, reposted, replied to, quoted or mentioned them in 12 months.",
		spec: {
			clauses: [
				{ kind: 'quiet', days: 30, negate: true },
				{ kind: 'noInteraction', days: 365 }
			]
		}
	},
	{
		id: 'farm',
		name: 'Follow-farm look',
		blurb: 'Follow over 5,000 and 10× more than follow them.',
		spec: {
			clauses: [
				{ kind: 'followsMoreThan', n: 5000 },
				{ kind: 'ratioAbove', n: 10 }
			]
		}
	},
	{
		id: 'firehose',
		name: 'Firehose',
		blurb: 'More than 25 posts a day.',
		spec: { clauses: [{ kind: 'postsPerDayAbove', n: 25 }] }
	}
];

export const LIST_PRESETS: Preset[] = [
	{
		id: 'regulars',
		name: 'Your regulars',
		blurb: "People you've interacted with 5 or more times in the last 12 months.",
		spec: { clauses: [{ kind: 'interactionsAtLeast', n: 5 }] }
	},
	{
		id: 'quietVoices',
		name: 'Quiet voices',
		blurb: 'Active this month, but under 1 post a day. Easy to miss.',
		spec: {
			clauses: [
				{ kind: 'quiet', days: 30, negate: true },
				{ kind: 'postsPerDayBelow', n: 1 }
			]
		}
	},
	{
		id: 'mutuals',
		name: 'Mutuals',
		blurb: 'People who follow you back.',
		spec: { clauses: [{ kind: 'followsYou' }] }
	},
	{
		id: 'images',
		name: 'Mostly images',
		blurb: 'Artists and photographers.',
		spec: { clauses: [{ kind: 'mostlyMedia', media: 'image' }] }
	},
	{
		id: 'longReads',
		name: 'Long reads',
		blurb: 'Longer posts and links.',
		spec: { clauses: [{ kind: 'medianWordsAbove', n: 35 }] }
	},
	{
		id: 'recent',
		name: 'Recent follows',
		blurb: 'Followed in the last 30 days.',
		spec: { clauses: [{ kind: 'followedDaysAgo', days: 30, negate: true }] }
	}
];

export function presetById(id: string): Preset | undefined {
	return [...CLEANUP_PRESETS, ...LIST_PRESETS].find((p) => p.id === id);
}
