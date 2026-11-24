/**
 * The scan engine: fetches follows, profiles and activity through a
 * DataSource, reports progress, saves as it goes, rescans only stale
 * accounts, and survives a cancel or reload (a later scan picks up where
 * this one left off, because finished rows are no longer stale).
 *
 * It never throws for a single account's failure: those count in
 * `errors` and the scan continues.
 */

import { CONFIG } from '#lib/config';
import { isAuthFailure } from '#lib/net/errors';
import type { Store } from '#lib/db/store';

import { summarizeActivity } from './estimate';
import { collectInteractions } from './interactions';
import type { DataSource, FollowRecord, ProfileLite } from './source';
import type { FollowAccount, InteractionSummary, ScanMeta } from './types';

export interface ScanProgress {
	phase:
		| 'follows'
		| 'profiles'
		| 'activity'
		| 'interactions'
		| 'saving'
		| 'done'
		| 'cancelled'
		| 'error';
	done: number;
	total: number;
	message?: string;
}

export interface ScanResult {
	follows: number;
	scannedProfiles: number;
	scannedActivity: number;
	errors: number;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function isAbortError(e: unknown): boolean {
	return e instanceof Error && e.name === 'AbortError';
}

/**
 * The signed-in calls (follows, profiles) need a live OAuth session; when
 * that's gone, retrying won't help and the scan ends with this message.
 */
function authExpired(): Error {
	return new Error('Your Bluesky sign-in expired. Sign in again to finish the scan.');
}

/** "Checked, no interaction in the window"; distinct from null (not checked). */
function emptyInteraction(): InteractionSummary {
	return {
		lastAt: null,
		lastKind: null,
		lastByKind: { like: null, repost: null, reply: null, quote: null, mention: null },
		countsByKind: { like: 0, repost: 0, reply: 0, quote: 0, mention: 0 }
	};
}

/** The oldest createdAt of a group of follow records, or null. */
function oldestFollowedAt(recs: FollowRecord[]): string | null {
	const times = recs.map((r) => r.createdAt).filter((c): c is string => c !== null);
	if (times.length === 0) return null;
	return [...times].sort()[0];
}

export async function runScan(
	src: DataSource,
	store: Store,
	opts: {
		onProgress: (p: ScanProgress) => void;
		signal?: AbortSignal;
		force?: boolean;
		now?: () => Date;
	}
): Promise<ScanResult> {
	const onProgress = opts.onProgress;
	const signal = opts.signal;
	const force = opts.force === true;
	const clock = opts.now ?? (() => new Date());
	const nowIso = () => clock().toISOString();
	const result: ScanResult = { follows: 0, scannedProfiles: 0, scannedActivity: 0, errors: 0 };

	let pending: FollowAccount[] = [];
	const flush = async (): Promise<void> => {
		if (pending.length === 0) return;
		const rows = pending;
		pending = [];
		await store.putAccounts(rows);
	};

	const startedAt = nowIso();
	// The scan rewrites the whole meta row on start, finish and cancel; each
	// write re-reads the user's saved daily limit (Settings) and the previous
	// interaction fields so a limit saved mid-scan, or interaction data from
	// an earlier scan, isn't clobbered by stale values captured at scan start.
	// Pass the interaction fields explicitly only when the phase produced them.
	const writeMeta = async (
		m: Omit<ScanMeta, 'dailyUnfollowLimit' | 'interactionsScannedAt' | 'interactionsCoveredSince'> &
			Partial<Pick<ScanMeta, 'interactionsScannedAt' | 'interactionsCoveredSince'>>
	): Promise<void> => {
		const prev = await store.getMeta().catch(() => null);
		await store.putMeta({
			...m,
			dailyUnfollowLimit: prev?.dailyUnfollowLimit ?? null,
			interactionsScannedAt: m.interactionsScannedAt ?? prev?.interactionsScannedAt ?? null,
			interactionsCoveredSince: m.interactionsCoveredSince ?? prev?.interactionsCoveredSince ?? null
		});
	};
	try {
		// The meta row says "scan in progress" from the start, so a reload
		// mid-scan can tell the difference from "never scanned".
		await writeMeta({ lastScanStartedAt: startedAt, lastScanFinishedAt: null, followCount: 0 });

		// 1. Follows: page until the cursor runs out.
		onProgress({ phase: 'follows', done: 0, total: 0 });
		const byDid = new Map<string, FollowRecord[]>();
		let total = 0;
		let cursor: string | undefined;
		for (;;) {
			throwIfAborted(signal);
			let page: Awaited<ReturnType<DataSource['listFollowRecords']>>;
			try {
				page = await src.listFollowRecords(cursor, signal);
			} catch (e) {
				// A dead session ends the scan; anything else propagates.
				if (isAbortError(e) || signal?.aborted) throw e;
				if (isAuthFailure(e)) throw authExpired();
				throw e;
			}
			for (const rec of page.records) {
				const recs = byDid.get(rec.did);
				if (recs) recs.push(rec);
				else byDid.set(rec.did, [rec]);
			}
			total += page.records.length;
			onProgress({ phase: 'follows', done: total, total: 0 });
			if (total > CONFIG.maxFollowsSupported) {
				throw new Error(
					`This account follows ${total} accounts, which is more than TidySky can handle (${CONFIG.maxFollowsSupported}).`
				);
			}
			cursor = page.cursor;
			if (cursor === undefined) break;
		}

		// 2. Merge with what is stored.
		const stored = await store.getAllAccounts();
		const rows: FollowAccount[] = [];
		const rowByDid = new Map<string, FollowAccount>();
		const unfollowedElsewhere: string[] = [];
		for (const acc of stored) {
			const recs = byDid.get(acc.did);
			if (recs === undefined) {
				// Unfollowed somewhere else: drop the row.
				unfollowedElsewhere.push(acc.did);
				continue;
			}
			acc.followRkeys = recs.map((r) => r.rkey);
			acc.followedAt = oldestFollowedAt(recs);
			rows.push(acc);
			rowByDid.set(acc.did, acc);
		}
		if (unfollowedElsewhere.length > 0) await store.deleteAccounts(unfollowedElsewhere);
		for (const [did, recs] of byDid) {
			if (rowByDid.has(did)) continue;
			const row: FollowAccount = {
				did,
				// '' until the profile step fills in the real handle.
				handle: '',
				displayName: null,
				avatar: null,
				description: null,
				followRkeys: recs.map((r) => r.rkey),
				followedAt: oldestFollowedAt(recs),
				createdAt: null,
				followersCount: null,
				followsCount: null,
				postsCount: null,
				followsYou: null,
				viewer: null,
				labels: [],
				status: 'unknown',
				activity: null,
				profileScannedAt: null,
				activityScannedAt: null,
				interaction: null
			};
			rows.push(row);
			rowByDid.set(did, row);
		}
		result.follows = rows.length;
		// Save the merge now: followRkeys updates on fresh rows would
		// otherwise never reach the store, and unfollow needs them.
		await store.putAccounts(rows);

		// 3. Profiles: only the stale (or all, if force).
		const staleMs = CONFIG.staleAfterHours * 3_600_000;
		const nowMs = clock().getTime();
		const isStale = (iso: string | null): boolean =>
			iso === null || nowMs - Date.parse(iso) > staleMs;
		const needsProfile = rows.filter((r) => force || isStale(r.profileScannedAt));
		const profileRequested = new Set(needsProfile.map((r) => r.did));
		const profiled = new Set<string>();
		const profileFailed = new Set<string>();
		result.scannedProfiles = needsProfile.length;
		onProgress({ phase: 'profiles', done: 0, total: needsProfile.length });

		let profileDone = 0;
		for (let i = 0; i < needsProfile.length; i += CONFIG.profilesPerCall) {
			throwIfAborted(signal);
			const chunk = needsProfile.slice(i, i + CONFIG.profilesPerCall);
			let profiles: ProfileLite[];
			try {
				profiles = await src.getProfiles(
					chunk.map((r) => r.did),
					signal
				);
			} catch (e) {
				if (isAbortError(e) || signal?.aborted) throw e;
				if (isAuthFailure(e)) throw authExpired();
				// The chunk failed after retries: those rows keep their old
				// profile (profileScannedAt untouched) and retry next scan.
				for (const row of chunk) profileFailed.add(row.did);
				result.errors += 1;
				profileDone += chunk.length;
				onProgress({ phase: 'profiles', done: profileDone, total: needsProfile.length });
				continue;
			}
			const byProfile = new Map(profiles.map((p) => [p.did, p]));
			for (const row of chunk) {
				const p = byProfile.get(row.did);
				if (p === undefined) continue; // missing: the activity step settles the status
				profiled.add(row.did);
				row.handle = p.handle;
				row.displayName = p.displayName;
				row.avatar = p.avatar;
				row.description = p.description;
				row.createdAt = p.createdAt;
				row.followersCount = p.followersCount;
				row.followsCount = p.followsCount;
				row.postsCount = p.postsCount;
				row.followsYou = p.followsYou;
				// Each scan replaces the stored reading, so an unblocked or
				// un-muted account clears on the next profile fetch.
				row.viewer = p.viewer;
				row.labels = p.labels;
				row.status = 'active';
				row.profileScannedAt = nowIso();
				pending.push(row);
			}
			profileDone += chunk.length;
			if (pending.length >= CONFIG.writeBatchSize) await flush();
			onProgress({ phase: 'profiles', done: profileDone, total: needsProfile.length });
		}

		// 4. Activity: only the stale (or all, if force). All in flight at
		// once; the DataSource's queues keep the real calls polite.
		const needsActivity = rows.filter((r) => force || isStale(r.activityScannedAt));
		result.scannedActivity = needsActivity.length;
		onProgress({ phase: 'activity', done: 0, total: needsActivity.length });

		let activityDone = 0;
		const jobs = needsActivity.map((row) =>
			src
				.getAuthorFeed(row.did, CONFIG.activitySample, signal)
				.then(async (res) => {
					if (res.ok) {
						row.activity = summarizeActivity(res.items, {
							now: clock(),
							exhausted: res.exhausted,
							accountCreatedAt: row.createdAt
						});
						if (res.items.length > 0) {
							// Posting means alive, whatever the profile step said.
							row.status = 'active';
						} else {
							const missing =
								profileRequested.has(row.did) &&
								!profiled.has(row.did) &&
								!profileFailed.has(row.did);
							if (missing) row.status = row.handle === 'handle.invalid' ? 'deactivated' : 'gone';
							else if (!profileFailed.has(row.did)) row.status = 'active';
							// profileFailed: keep the previous status; the profile retries next scan.
						}
					} else {
						// A successful profile (this scan, or a fresh stored
						// 'active' one) beats a public-feed error: accounts
						// hidden from logged-out readers 404 in the public feed
						// but are alive.
						const profileOk =
							profiled.has(row.did) || (!profileRequested.has(row.did) && row.status === 'active');
						row.status =
							profileOk && (res.status === 'gone' || res.status === 'unknown')
								? 'active'
								: res.status;
						row.activity = null;
						result.errors += 1;
					}
					row.activityScannedAt = nowIso();
					pending.push(row);
					activityDone += 1;
					// Await the flush so Promise.all can't finish ahead of the save.
					if (pending.length >= 50) await flush();
					onProgress({ phase: 'activity', done: activityDone, total: needsActivity.length });
					return undefined;
				})
				.catch((e: unknown) => {
					// A cancellation must stop the whole scan, not count as a failure.
					if (isAbortError(e) || signal?.aborted) throw e;
					// A single account's feed failed after retries.
					row.status = 'unknown';
					row.activity = null;
					result.errors += 1;
					row.activityScannedAt = nowIso();
					pending.push(row);
					activityDone += 1;
					onProgress({ phase: 'activity', done: activityDone, total: needsActivity.length });
					return undefined;
				})
		);
		await Promise.all(jobs);

		// 4b. Interactions: the user's own likes, reposts and posts
		// from the last year. The whole window is re-read each time. A
		// failure (network, rate limit) keeps the previous data and never
		// fails the scan; a dead session still ends it.
		let interactionsFresh: { at: string; coveredSince: string } | null = null;
		const prevMeta = await store.getMeta().catch(() => null);
		if (force || isStale(prevMeta?.interactionsScannedAt ?? null)) {
			onProgress({ phase: 'interactions', done: 0, total: 0 });
			try {
				const { map, coveredSince } = await collectInteractions(
					src,
					src.did,
					clock(),
					signal,
					(n) => onProgress({ phase: 'interactions', done: n, total: 0 })
				);
				const at = nowIso();
				// Every current follow gets a summary: "checked, none found"
				// is not the same as "not checked" (null).
				for (const row of rows) {
					row.interaction = map.get(row.did) ?? emptyInteraction();
					pending.push(row);
				}
				interactionsFresh = { at, coveredSince };
			} catch (e) {
				if (isAbortError(e) || signal?.aborted) throw e;
				// A dead session won't recover on its own: end the scan, like
				// the other signed-in phases, instead of hiding it.
				if (isAuthFailure(e)) throw authExpired();
				// One warning is enough: the next scan retries the phase.
				console.warn('TidySky: the interaction check failed; keeping the previous data.', e);
				result.errors += 1;
			}
		}

		// 5. Finish.
		onProgress({ phase: 'saving', done: 0, total: 0 });
		await flush();
		await writeMeta({
			lastScanStartedAt: startedAt,
			lastScanFinishedAt: nowIso(),
			followCount: rows.length,
			...(interactionsFresh !== null
				? {
						interactionsScannedAt: interactionsFresh.at,
						interactionsCoveredSince: interactionsFresh.coveredSince
					}
				: {})
		});
		onProgress({ phase: 'done', done: 1, total: 1 });
		return result;
	} catch (e) {
		if (isAbortError(e) || signal?.aborted) {
			// Cancel: save what we have. finishedAt stays null (the scan
			// didn't finish) and the next scan resumes naturally.
			await flush();
			try {
				await writeMeta({
					lastScanStartedAt: startedAt,
					lastScanFinishedAt: null,
					followCount: result.follows
				});
			} catch {
				// The cancel report matters more than the meta row.
			}
			onProgress({ phase: 'cancelled', done: 0, total: 0 });
			return result;
		}
		onProgress({
			phase: 'error',
			done: 0,
			total: 0,
			message: e instanceof Error ? e.message : 'Something went wrong while scanning.'
		});
		throw e;
	}
}
