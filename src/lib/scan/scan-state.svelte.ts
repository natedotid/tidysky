/**
 * The app-wide scan state: what the scan is doing right now, and the
 * account data the rest of the app shows. A scan started on one tab keeps
 * running and stays visible on every tab, and the app works with partial
 * data while it runs.
 */

import { track } from '#lib/analytics';
import { isUnfollowAction } from '#lib/actions/undo';
import { session } from '#lib/atproto/session.svelte';
import { CONFIG } from '#lib/config';
import { openStore, type Store } from '#lib/db/store';
import { makeSnapshot } from '#lib/insights/snapshots';

import { DemoSource, demoPreviousSnapshot } from './demo';
import { LiveSource } from './live-source';
import { runScan, type ScanProgress } from './scan';
import type { DataSource } from './source';
import { isScanStale } from './stale';
import type { FollowAccount, ScanMeta, Snapshot } from './types';

class ScanState {
	/** Latest progress from the running scan, or the last scan's final phase. */
	progress: ScanProgress | null = $state(null);
	running = $state(false);
	/** When the last scan finished, or null. */
	lastFinishedAt: string | null = $state(null);
	/** The phase a cancelled or failed scan was in, so the steps freeze there. */
	stoppedPhase: ScanProgress['phase'] | null = $state(null);
	/** Accounts loaded from the store for the current account. */
	accounts: FollowAccount[] = $state([]);
	/** True once the store is open and accounts have loaded at least once. */
	ready = $state(false);
	/** Number of follows found in the current or last scan. */
	followTotal = $state(0);
	/** Estimated time left in the scan in ms, or null until it is knowable. */
	etaMs: number | null = $state(null);
	/** Storage failure message, or null. */
	storageError: string | null = $state(null);

	/** Snapshots of finished scans, newest first. */
	snapshots: Snapshot[] = $state([]);

	/** When the interaction check last ran, or null. */
	interactionsScannedAt: string | null = $state(null);
	/** Oldest date the interaction read fully covered, or null. */
	interactionsCoveredSince: string | null = $state(null);

	/** The account key the store is bound to, or null. */
	boundKey: string | null = $state(null);
	/**
	 * The data source for the bound account, or null. Set when the account
	 * binds, before any scan, so the list engine can read list
	 * items between scans, and by a rescan.
	 */
	source: DataSource | null = $state(null);

	private store: Store | null = null;
	private controller: AbortController | null = null;
	private ensuring = false;
	private scanStartedAtMs = 0;
	private lastAccountsReloadMs = 0;

	private accountKey = $derived.by((): string | null => {
		if (session.demo) return 'demo';
		if (session.status === 'signed-in') return session.did;
		return null;
	});

	/** Accounts with a finished activity check, for the partial-data note. */
	get scannedSoFar(): number {
		let n = 0;
		for (const a of this.accounts) if (a.activity !== null) n += 1;
		return n;
	}

	/**
	 * Called when an app route is entered: make sure the current account
	 * has either a stored scan or a running one. A no-op when it already does.
	 */
	async ensureStarted(): Promise<void> {
		const key = this.accountKey;
		if (key === null || this.ensuring) return;
		this.ensuring = true;
		try {
			if (this.boundKey !== key) await this.rebind(key);
			if (this.store === null || this.running) return;
			let meta: ScanMeta | null = null;
			try {
				meta = await this.store.getMeta();
			} catch {
				meta = null;
			}
			if (meta !== null && meta.lastScanFinishedAt !== null) {
				this.lastFinishedAt = meta.lastScanFinishedAt;
				// Show the completed state: all steps checked, "Last scanned",
				// and the Rescan button.
				this.progress = { phase: 'done', done: 1, total: 1 };
				if (meta.followCount > 0) this.followTotal = meta.followCount;
				// Load the stored rows first so the screen fills at once; a
				// stale scan then refreshes them in the background.
				await this.loadAccounts();
				this.snapshots = await this.store.listSnapshots().catch(() => []);
				if (isScanStale(meta.lastScanFinishedAt, new Date(), CONFIG.staleAfterHours)) {
					// The stored follow keys and statuses may be old: a normal
					// (non-forced) scan refetches the stale rows. Rescan, when
					// the user taps it, still forces a full one.
					void this.startScan({ force: false });
				}
			} else {
				// Never finished a scan, or crashed mid-scan: start now. A
				// finished scan is no longer stale, so a scan that was
				// interrupted picks up where it left off.
				void this.startScan({ force: false });
			}
		} finally {
			this.ensuring = false;
		}
	}

	/**
	 * Run a scan. `force` rescans every account, not just stale ones.
	 * Resolves when the scan finishes, is cancelled, or errors.
	 */
	async startScan(opts: { force?: boolean } = {}): Promise<void> {
		const key = this.accountKey;
		const store = this.store;
		const src = this.source;
		if (
			key === null ||
			store === null ||
			src === null ||
			this.running ||
			this.storageError !== null
		)
			return;

		const controller = new AbortController();
		this.controller = controller;
		this.running = true;
		// The rest of the app works on partial data while the scan runs.
		this.ready = true;
		this.progress = { phase: 'follows', done: 0, total: 0 };
		this.stoppedPhase = null;
		this.scanStartedAtMs = Date.now();
		this.lastAccountsReloadMs = 0;

		try {
			await runScan(src, store, {
				signal: controller.signal,
				force: opts.force === true,
				onProgress: (p) => {
					if (this.controller !== controller) return; // rebound to another account
					if (p.phase === 'cancelled' || p.phase === 'error') {
						this.stoppedPhase = this.progress?.phase ?? null;
					}
					this.progress = p;
					if (p.phase === 'follows') this.followTotal = p.done;
					this.updateEta(p);
					// Refresh the partial data a few times a minute, so the
					// app below the progress screen keeps working without
					// re-reading thousands of rows every second.
					const now = Date.now();
					if (p.phase !== 'saving' && now - this.lastAccountsReloadMs > CONFIG.scanReloadMs) {
						this.lastAccountsReloadMs = now;
						void this.loadAccounts();
					}
				}
			});
		} catch {
			// runScan reports an 'error' phase with the message before
			// rethrowing, so the user sees it; the route must not crash.
		} finally {
			if (this.controller === controller) {
				this.running = false;
				this.controller = null;
				this.etaMs = null;
				await this.loadAccounts();
				if (this.progress?.phase === 'done') {
					this.lastFinishedAt = new Date().toISOString();
					await this.recordSnapshot();
					track('Scan finished');
				}
			}
		}
	}

	/** Stop a running scan. Finished rows stay saved; Rescan picks up. */
	cancelScan(): void {
		this.controller?.abort();
	}

	/**
	 * Detach from the account: stop any running scan and forget the store,
	 * so nothing keeps writing (or holding the database open) after sign-out
	 * or a "delete all". ensureStarted rebinds and reloads on the next entry.
	 */
	unbind(): void {
		this.stopRunning();
		this.store = null;
		this.source = null;
		this.boundKey = null;
		this.progress = null;
		this.running = false;
		this.accounts = [];
		this.snapshots = [];
		this.interactionsScannedAt = null;
		this.interactionsCoveredSince = null;
		this.ready = false;
		this.followTotal = 0;
		this.lastFinishedAt = null;
		this.stoppedPhase = null;
		this.etaMs = null;
		this.storageError = null;
	}

	/** Re-read the stored accounts, after an unfollow run or an undo. */
	async reloadAccounts(): Promise<void> {
		await this.loadAccounts();
	}

	/**
	 * The DIDs the user unfollowed through TidySky after `isoTime` (still
	 * undone = actually unfollowed): they left the follows list on purpose,
	 * so "since your last scan" does not count them as dropped elsewhere.
	 * A move-to-list entry unfollows too, so it counts.
	 */
	async unfollowedSince(isoTime: string): Promise<string[]> {
		const store = this.store;
		if (store === null) return [];
		try {
			const log = await store.listLog();
			return log
				.filter((e) => isUnfollowAction(e.action) && e.at > isoTime && e.undoneAt === undefined)
				.map((e) => e.did);
		} catch {
			return [];
		}
	}

	/** After a completed scan: store the snapshot and prune the old ones. */
	private async recordSnapshot(): Promise<void> {
		const store = this.store;
		if (store === null) return;
		try {
			const now = new Date();
			// Demo only: the first completed demo scan seeds one previous
			// snapshot, a day earlier, so "Since your last scan" has something
			// believable to show. Live scans are untouched.
			if (this.boundKey === 'demo' && this.source instanceof DemoSource) {
				const existing = await store.listSnapshots();
				if (existing.length === 0) {
					await store.addSnapshot(
						demoPreviousSnapshot(this.accounts, this.source.droppedElsewhere, now)
					);
				}
			}
			await store.addSnapshot(makeSnapshot(this.accounts, now));
			await store.pruneSnapshots(CONFIG.snapshotsKept);
			this.snapshots = await store.listSnapshots();
		} catch {
			// The snapshot is a bonus: a failed write must not fail the scan.
		}
	}

	/** Abort a running scan and detach from it (the account is changing). */
	private stopRunning(): void {
		this.controller?.abort();
		this.controller = null;
	}

	private async rebind(key: string): Promise<void> {
		this.stopRunning();
		this.boundKey = key;
		this.progress = null;
		this.running = false;
		this.lastFinishedAt = null;
		this.stoppedPhase = null;
		this.accounts = [];
		this.ready = false;
		this.followTotal = 0;
		this.etaMs = null;
		this.storageError = null;
		this.snapshots = [];
		this.interactionsScannedAt = null;
		this.interactionsCoveredSince = null;
		this.source = null;
		try {
			this.store = await openStore(key);
		} catch {
			this.store = null;
			this.storageError =
				"This browser is blocking storage, so TidySky can't save your scan. Try a normal (not private) window.";
			return;
		}
		// The source is available as soon as the account is bound, not only
		// while a scan runs: the list engine reads it between scans.
		if (key === 'demo') this.source = new DemoSource();
		else if (session.agent !== null) this.source = new LiveSource(key, session.agent);
	}

	/**
	 * Estimate the time left from elapsed time per item, across the rest of
	 * the current phase and the phases after it. Null until 20 items of the
	 * current phase are done, too early to trust a rate.
	 */
	private updateEta(p: ScanProgress): void {
		let remaining: number;
		if (p.phase === 'profiles') remaining = p.total - p.done + this.followTotal;
		else if (p.phase === 'activity') remaining = p.total - p.done;
		else {
			this.etaMs = null;
			return;
		}
		if (p.done < 20) {
			this.etaMs = null;
			return;
		}
		const done = this.followTotal + p.done;
		if (done <= 0) return;
		this.etaMs = (remaining * (Date.now() - this.scanStartedAtMs)) / done;
	}

	private async loadAccounts(): Promise<void> {
		if (this.store === null) return;
		try {
			this.accounts = await this.store.getAllAccounts();
			const meta = await this.store.getMeta();
			this.interactionsScannedAt = meta?.interactionsScannedAt ?? null;
			this.interactionsCoveredSince = meta?.interactionsCoveredSince ?? null;
			this.ready = true;
		} catch {
			// A transient read failure: the next refresh retries.
		}
	}
}

export const scanState = new ScanState();
