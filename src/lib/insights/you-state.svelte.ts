/**
 * The "you" read: the signed-in account's own profile, a sample of its
 * recent feed and a sample of its most recent followers. Fetched lazily
 * when the Insights page shows the You tab, cached in the store's `you`
 * meta row, and refreshed on Rescan.
 */

import { session } from '#lib/atproto/session.svelte';
import { CONFIG } from '#lib/config';
import { openStore, type Store } from '#lib/db/store';

import { DemoSource } from '#lib/scan/demo';
import { LiveSource } from '#lib/scan/live-source';
import type { DataSource, YouData } from '#lib/scan/source';

class YouState {
	/** The cached or freshly fetched you-data, or null. */
	data: YouData | null = $state(null);
	loading = $state(false);
	/** A failed fetch, in plain words, or null. */
	error: string | null = $state(null);

	/** The account key the state is bound to, or null. */
	boundKey: string | null = $state(null);

	private store: Store | null = null;
	private controller: AbortController | null = null;
	private ensuring = false;

	private accountKey = $derived.by((): string | null => {
		if (session.demo) return 'demo';
		if (session.status === 'signed-in') return session.did;
		return null;
	});

	/**
	 * Make sure the current account has you-data: use the cache when it
	 * exists, otherwise fetch. A no-op for a different or missing account.
	 */
	async ensure(): Promise<void> {
		const key = this.accountKey;
		if (key === null || this.ensuring) return;
		this.ensuring = true;
		try {
			if (this.boundKey !== key) await this.rebind(key);
			if (this.store === null || this.data !== null || this.loading) return;
			const cached = await this.store.getYou().catch(() => null);
			if (cached !== null) {
				this.data = cached;
				return;
			}
			await this.fetch();
		} finally {
			this.ensuring = false;
		}
	}

	/** Force a fresh fetch. Called by Rescan. */
	refresh(): void {
		void this.fetch();
	}

	/**
	 * Your own createdAt from the local cache only, no fetch: the pages that
	 * show a row's "You:" line want the "since you joined" wording when it is
	 * already known, and must not trigger the "you" read (a network read)
	 * for it. Null when the account or its cache is unknown.
	 */
	async cachedOwnCreatedAt(key: string | null): Promise<string | null> {
		if (key === null) return null;
		try {
			const store = await openStore(key);
			const you = await store.getYou();
			return you?.profile.createdAt ?? null;
		} catch {
			return null;
		}
	}

	/** Abort an in-flight fetch (the account is changing). */
	private stopFetching(): void {
		this.controller?.abort();
		this.controller = null;
	}

	private async rebind(key: string): Promise<void> {
		this.stopFetching();
		this.boundKey = key;
		this.data = null;
		this.loading = false;
		this.error = null;
		try {
			this.store = await openStore(key);
		} catch {
			// The scan state owns the storage-error message; without a
			// store the You tab simply stays empty.
			this.store = null;
		}
	}

	private async fetch(): Promise<void> {
		const key = this.accountKey;
		const store = this.store;
		if (key === null || store === null || this.loading) return;

		let src: DataSource;
		if (key === 'demo') {
			src = new DemoSource();
		} else {
			const agent = session.agent;
			if (agent === null) return;
			src = new LiveSource(key, agent);
		}

		const controller = new AbortController();
		this.controller = controller;
		this.loading = true;
		this.error = null;
		try {
			// Three independent reads: run them together, one abort covers all.
			const [profile, feed, followers] = await Promise.all([
				src.getOwnProfile(controller.signal),
				src.getOwnFeed(CONFIG.youFeedSample, controller.signal),
				src.getFollowersSample(CONFIG.youFollowersSample, controller.signal)
			]);
			if (this.controller !== controller) return; // rebound to another account
			const you: YouData = {
				profile,
				feed,
				followers: followers.profiles,
				followersComplete: followers.complete,
				fetchedAt: new Date().toISOString()
			};
			this.data = you;
			await store.putYou(you);
		} catch (e) {
			if (this.controller !== controller) return;
			if (e instanceof Error && e.name === 'AbortError') return;
			this.error =
				'We could not read your own profile right now. Check your connection and press Rescan to try again.';
		} finally {
			if (this.controller === controller) {
				this.controller = null;
				this.loading = false;
			}
		}
	}
}

export const youState = new YouState();
