/**
 * The only place in the app that writes to the user's Bluesky account.
 * Every call goes through the auth request queue so rate limits back off
 * consistently, and the Writer interface is the seam demo mode and the
 * unit tests stand in behind.
 */

import type { Agent } from '@atproto/api';

import { session } from '#lib/atproto/session.svelte';
import { errorInfo } from '#lib/net/errors';
import { authQueue } from '#lib/net/queue';

import { DemoWriter } from '#lib/scan/demo';

export type WriteOp =
	| { $type: 'com.atproto.repo.applyWrites#delete'; collection: string; rkey: string }
	| {
			$type: 'com.atproto.repo.applyWrites#create';
			collection: string;
			value: Record<string, unknown>;
	  };

export interface Writer {
	applyWrites(ops: WriteOp[], signal?: AbortSignal): Promise<void>;
	/** RecordNotFound counts as success: the record is already gone. */
	deleteRecord(collection: string, rkey: string, signal?: AbortSignal): Promise<void>;
	createRecord(
		collection: string,
		value: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<{ uri: string }>;
	muteActor(did: string, signal?: AbortSignal): Promise<void>;
	unmuteActor(did: string, signal?: AbortSignal): Promise<void>;
}

/** A Writer over a signed-in agent; every call is paced by one auth queue. */
export function liveWriter(agent: Agent, repoDid: string): Writer {
	const queue = authQueue();
	// The run's signal goes to the queue as well as the call: a Stop must not
	// sit out a backoff or a queue-wide 429 pause.
	return {
		applyWrites: async (ops, signal) => {
			// A create op may have landed before a dropped connection, so the
			// batch is retried only on a 429 when it contains any.
			await queue.run(
				() => agent.com.atproto.repo.applyWrites({ repo: repoDid, writes: ops }, { signal }),
				signal,
				{ idempotent: !ops.some((o) => o.$type === 'com.atproto.repo.applyWrites#create') }
			);
		},
		deleteRecord: async (collection, rkey, signal) => {
			try {
				await queue.run(
					() =>
						agent.com.atproto.repo.deleteRecord(
							{ repo: repoDid, collection, rkey },
							{
								signal
							}
						),
					signal
				);
			} catch (e) {
				// The record was already gone: treat as success.
				if (!errorInfo(e).code?.includes('RecordNotFound')) throw e;
			}
		},
		createRecord: async (collection, value, signal) => {
			const res = await queue.run(
				() =>
					agent.com.atproto.repo.createRecord(
						{ repo: repoDid, collection, record: value },
						{ signal }
					),
				signal,
				// A retry after a dropped connection could create a duplicate.
				{ idempotent: false }
			);
			return { uri: res.data.uri };
		},
		muteActor: async (did, signal) => {
			await queue.run(() => agent.app.bsky.graph.muteActor({ actor: did }, { signal }), signal);
		},
		unmuteActor: async (did, signal) => {
			await queue.run(() => agent.app.bsky.graph.unmuteActor({ actor: did }, { signal }), signal);
		}
	};
}

/**
 * The writer for the current session: the demo fake in demo mode, the live
 * agent otherwise. Null only when signed out with no agent (nothing to write).
 */
export function currentWriter(): Writer | null {
	if (session.demo) return new DemoWriter();
	const agent = session.agent;
	if (agent === null || session.did === null) return null;
	return liveWriter(agent, session.did);
}
