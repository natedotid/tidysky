import type { ProfileLite } from '#lib/scan/source';

/** One row of the unfollowed-elsewhere sheet. */
export interface DroppedRow {
	did: string;
	/** Null when the source returned no profile: "No longer available". */
	profile: ProfileLite | null;
}

/** One row per DID, in order; a DID with no profile becomes the null row. */
export function droppedRows(dids: string[], profiles: ProfileLite[]): DroppedRow[] {
	const byDid = new Map(profiles.map((p) => [p.did, p]));
	return dids.map((did) => ({ did, profile: byDid.get(did) ?? null }));
}
