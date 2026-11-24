import { describe, expect, it } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';

import type { FollowAccount, InteractionSummary } from '#lib/scan/types';

import { cleanupState, sortRows } from './cleanup-state.svelte';

function acc(over: Partial<FollowAccount> = {}): FollowAccount {
	return {
		did: 'did:plc:test',
		handle: 'test.bsky.social',
		displayName: 'Test',
		avatar: null,
		description: null,
		followRkeys: [],
		followedAt: null,
		createdAt: null,
		followersCount: null,
		followsCount: null,
		postsCount: null,
		followsYou: null,
		labels: [],
		status: 'active',
		activity: null,
		profileScannedAt: null,
		activityScannedAt: null,
		interaction: null,
		...over
	};
}

function ix(
	lastAt: string | null,
	counts: Partial<InteractionSummary['countsByKind']> = {}
): InteractionSummary {
	return {
		lastAt,
		lastKind: lastAt === null ? null : 'like',
		lastByKind: { like: lastAt, repost: null, reply: null, quote: null, mention: null },
		countsByKind: { like: 0, repost: 0, reply: 0, quote: 0, mention: 0, ...counts }
	};
}

function reset(): void {
	cleanupState.spec = { clauses: [] };
	cleanupState.appliedPreset = null;
	cleanupState.clearSelection();
}

describe('editing a filter clause', () => {
	it('setClause replaces only that clause, in place', () => {
		reset();
		cleanupState.addClause({ kind: 'quiet', days: 90 });
		cleanupState.addClause({ kind: 'noBio' });
		cleanupState.setClause(0, { kind: 'quiet', days: 30 });
		expect(cleanupState.spec.clauses).toEqual([{ kind: 'quiet', days: 30 }, { kind: 'noBio' }]);
	});

	it('a flipped negate lands on the clause, and un-flips back to the plain form', () => {
		reset();
		cleanupState.addClause({ kind: 'noInteraction', days: 365 });
		cleanupState.setClause(0, { kind: 'noInteraction', days: 365, negate: true });
		expect(cleanupState.spec.clauses[0]?.negate).toBe(true);
		cleanupState.setClause(0, { kind: 'noInteraction', days: 365 });
		expect(cleanupState.spec.clauses[0]?.negate).toBeUndefined();
	});

	it('editing a preset-applied spec clears the applied preset', () => {
		reset();
		cleanupState.applyPreset('farm');
		expect(cleanupState.appliedPreset).toBe('farm');
		cleanupState.setClause(0, { kind: 'followsMoreThan', n: 2000 });
		expect(cleanupState.appliedPreset).toBeNull();
		// The other preset clause survived the edit.
		expect(cleanupState.spec.clauses).toEqual([
			{ kind: 'followsMoreThan', n: 2000 },
			{ kind: 'ratioAbove', n: 10 }
		]);
	});

	it('editing clears the selection like any other filter change', () => {
		reset();
		cleanupState.addClause({ kind: 'noBio' });
		cleanupState.selected = new SvelteSet(['did:plc:x']);
		cleanupState.setClause(0, { kind: 'noBio', negate: true });
		expect(cleanupState.selected.size).toBe(0);
	});
});

describe('Most interactions sort', () => {
	it('orders by count descending, ties by the more recent last interaction, unchecked last', () => {
		const rows = [
			acc({ did: 'unchecked' }),
			acc({ did: 'ten-old', interaction: ix('2026-01-01T00:00:00Z', { like: 10 }) }),
			acc({ did: 'five', interaction: ix('2026-05-01T00:00:00Z', { like: 4, reply: 1 }) }),
			acc({ did: 'ten-new', interaction: ix('2026-09-01T00:00:00Z', { repost: 10 }) }),
			acc({ did: 'zero', interaction: ix(null) })
		];
		sortRows(rows, 'interactionDesc');
		expect(rows.map((a) => a.did)).toEqual(['ten-new', 'ten-old', 'five', 'zero', 'unchecked']);
	});
});
