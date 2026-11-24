import { describe, expect, it } from 'vitest';

import type { Clause } from './filters';
import { ADD_SECTIONS, FILTER_KINDS, kindFor, valueIndex } from './options';

const NEGATABLE_KINDS = [
	'quiet',
	'neverPosted',
	'gone',
	'followsYou',
	'followsMoreThan',
	'followedDaysAgo',
	'noInteraction',
	'interactionsAtLeast'
] as const;

describe('the filter options table', () => {
	it('covers every user-editable kind, and only those', () => {
		const kinds = FILTER_KINDS.map((k) => k.kind);
		const all = new Set<Clause['kind']>([...kinds, 'text', 'inSet']);
		// inSet and text are the only clause kinds outside the table.
		expect(all.size).toBe(kinds.length + 2);
		expect(new Set(kinds).size).toBe(kinds.length); // no duplicates
		expect(kindFor({ kind: 'text', q: 'x' })).toBeNull();
		expect(kindFor({ kind: 'inSet', dids: [], label: 'Since your last scan' })).toBeNull();
	});

	it('records the negatable kinds: the old set plus both interaction kinds', () => {
		const negatable = FILTER_KINDS.filter((k) => k.negatable).map((k) => k.kind);
		expect([...negatable].sort()).toEqual([...NEGATABLE_KINDS].sort());
	});

	it('round-trips every offered value back to its index', () => {
		for (const k of FILTER_KINDS) {
			expect(k.values.length, k.kind).toBeGreaterThan(0);
			for (let i = 0; i < k.values.length; i += 1) {
				expect(valueIndex(k, k.values[i].clause), `${k.kind} ${k.values[i].key}`).toBe(i);
			}
		}
	});

	it('reports -1 for a stored value the table no longer offers', () => {
		const quiet = FILTER_KINDS.find((k) => k.kind === 'quiet')!;
		expect(valueIndex(quiet, { kind: 'quiet', days: 45 })).toBe(-1);
	});

	it('gives the add sheet its sections in order, with the offered values', () => {
		expect(ADD_SECTIONS.map((s) => s.section)).toEqual([
			'Posting',
			'Accounts',
			'Following',
			'Activity',
			'Interactions',
			'Profile'
		]);
		const bySection = new Map(ADD_SECTIONS.map((s) => [s.section, s.values]));
		const labels = (s: string): string[] => bySection.get(s)!.map((v) => v.label);
		expect(labels('Posting')).toContain('No posts in 30 days');
		expect(labels('Posting')).toContain('Never posted');
		expect(labels('Following')).toEqual([
			'Follows you back',
			"Doesn't follow you back",
			'Follows more than 1,000',
			'Follows more than 2,000',
			'Follows more than 5,000',
			'Follows 5× more than follow them',
			'Follows 10× more than follow them',
			'Follows 20× more than follow them'
		]);
		expect(labels('Interactions')).toEqual([
			'No interaction in 30 days',
			'No interaction in 3 months',
			'No interaction in 6 months',
			'No interaction in 12 months',
			'Interacted 3+ times in 12 months',
			'Interacted 5+ times in 12 months',
			'Interacted 10+ times in 12 months',
			'Interacted 25+ times in 12 months'
		]);
	});
});
