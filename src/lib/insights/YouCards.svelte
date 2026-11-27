<script lang="ts">
	/**
	 * The five "you" cards: the signed-in account itself. Cards
	 * 1 uses the scan's account rows (for follow-back), the rest only the
	 * you-data sample.
	 */
	import { compact, plural } from '#lib/format';
	import type { YouData } from '#lib/scan/source';
	import type { FollowAccount } from '#lib/scan/types';
	import { busiestHour } from '#lib/charts/busiest';
	import BarChart from '#lib/charts/BarChart.svelte';
	import Heatmap from '#lib/charts/Heatmap.svelte';
	import HourChart from '#lib/charts/HourChart.svelte';
	import Card from '#lib/ui/Card.svelte';

	import {
		engagement,
		followBackLine,
		followerCardCopy,
		followerMix,
		myMix,
		myPosting,
		snapshot,
		topPostLine
	} from './you';

	interface Props {
		you: YouData;
		accounts: FollowAccount[];
		/** "Based on 412 of 850 accounts" while a scan is incomplete. */
		partial: string | null;
	}

	let { you, accounts, partial }: Props = $props();

	const now = new Date();

	// --- at a glance
	const snap = $derived(snapshot(you.profile, accounts, now));
	function ageLabel(days: number): string {
		if (days <= 0) return '—';
		const years = Math.floor(days / 365);
		if (years >= 1) return `${years} ${years === 1 ? 'year' : 'years'}`;
		const months = Math.max(1, Math.floor(days / 30));
		return `${months} ${months === 1 ? 'month' : 'months'}`;
	}
	const backLine = $derived(followBackLine(snap.followBackShare, snap.followBackUnknown));

	// --- when you post: under the configured minimum, an hour-of-day chart
	// (the weekday mix is too thin to read); at or above it, the grid.
	const post = $derived(myPosting(you.feed));
	const postHourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
	const postBusiest = $derived(post.kind === 'hours' ? busiestHour(post.hours) : null);
	const postTakeaway = $derived.by((): string | null => {
		if (postBusiest === null) return null;
		return `Busiest around ${postHourFmt.format(new Date(2024, 0, 1, postBusiest))}.`;
	});
	const postAria = $derived.by((): string => {
		const base = `Your posts and reposts by hour of the day, ${you.feed.length} items`;
		if (postBusiest === null) return `${base}.`;
		return `${base}; busiest around ${postHourFmt.format(new Date(2024, 0, 1, postBusiest))}.`;
	});

	// --- what you post
	const mix = $derived(myMix(you.feed));
	const kindRows = $derived([
		{
			label: 'Posts',
			value: mix.share.post * 100,
			valueLabel: `${Math.round(mix.share.post * 100)}%`
		},
		{
			label: 'Replies',
			value: mix.share.reply * 100,
			valueLabel: `${Math.round(mix.share.reply * 100)}%`
		},
		{
			label: 'Quotes',
			value: mix.share.quote * 100,
			valueLabel: `${Math.round(mix.share.quote * 100)}%`
		},
		{
			label: 'Reposts',
			value: mix.share.repost * 100,
			valueLabel: `${Math.round(mix.share.repost * 100)}%`
		}
	]);
	const mediaTotal = $derived(
		mix.media.text + mix.media.image + mix.media.video + mix.media.link + mix.media.quote
	);
	const mediaRows = $derived(
		(
			[
				['Text', mix.media.text],
				['Images', mix.media.image],
				['Video', mix.media.video],
				['Links', mix.media.link],
				['Quotes', mix.media.quote]
			] as Array<[string, number]>
		)
			.filter(([, n]) => n > 0)
			.map(([label, n]) => ({
				label,
				value: n,
				valueLabel: `${mediaTotal === 0 ? 0 : Math.round((n / mediaTotal) * 100)}%`
			}))
	);

	// --- how your posts land
	const eng = $derived(engagement(you.feed, you.profile.did));
	function num(n: number): string {
		return Number.isInteger(n) ? String(n) : n.toFixed(1);
	}

	// --- who follows you
	const fol = $derived(followerMix(you.followers));
	const folCopy = $derived(followerCardCopy(snap.followers, fol.total, you.followersComplete));
	const folRows = $derived([
		{ label: 'No posts yet', value: fol.noPosts, valueLabel: String(fol.noPosts) },
		{ label: 'Follow-farm look', value: fol.farmLook, valueLabel: String(fol.farmLook) },
		// Short: "Has a moderatio…" on a phone; the aria keeps the full wording.
		{ label: 'Has a label', value: fol.labeled, valueLabel: String(fol.labeled) },
		{
			label: 'Everyone else',
			value: Math.max(0, fol.total - fol.noPosts - fol.farmLook - fol.labeled),
			valueLabel: String(Math.max(0, fol.total - fol.noPosts - fol.farmLook - fol.labeled))
		}
	]);

	/** A card footnote, with the partial-scan note appended while it applies. */
	function note(base: string | null): string | undefined {
		if (base === null) return partial ?? undefined;
		return partial !== null ? `${base} ${partial}` : base;
	}
</script>

<div class="cards">
	<Card title="At a glance" footnote={note(null)}>
		<div class="stats">
			<div class="tile">
				<span class="num big">{compact(snap.followers)}</span>
				<span class="lbl">Followers</span>
			</div>
			<div class="tile">
				<span class="num big">{compact(snap.follows)}</span>
				<span class="lbl">Following</span>
			</div>
			<div class="tile">
				<span class="num big">{compact(snap.posts)}</span>
				<span class="lbl">Posts</span>
			</div>
			<div class="tile">
				<span class="num big">{ageLabel(snap.accountAgeDays)}</span>
				<span class="lbl">Account age</span>
			</div>
		</div>
		{#if backLine === null}
			<p class="line">We couldn't check who follows you back this time.</p>
		{:else}
			<p class="line">{backLine}</p>
		{/if}
	</Card>

	<Card
		title="When you post"
		takeaway={post.kind === 'hours' ? (postTakeaway ?? undefined) : undefined}
		footnote={note(
			`In your time zone. From your last ${plural(you.feed.length, 'post and repost', 'posts and reposts')}.`
		)}
	>
		{#if post.kind === 'hours' && you.feed.length === 0}
			<p class="empty">No posts in your recent feed.</p>
		{:else if post.kind === 'grid'}
			<Heatmap grid={post.grid} ariaLabel="Weekday and hour grid of when you post." />
		{:else}
			<div class="chart-slot" style="min-height: 138px">
				<HourChart hours={post.hours} ariaLabel={postAria} />
			</div>
		{/if}
	</Card>

	<Card
		title="What you post"
		footnote={note(
			you.feed.length === 1
				? 'Your last post or reply.'
				: `Your last ${you.feed.length} posts and replies.`
		)}
	>
		{#if you.feed.length > 0}
			<BarChart
				rows={kindRows}
				ariaLabel={`Share of your recent activity: posts ${kindRows[0].valueLabel}, replies ${kindRows[1].valueLabel}, quotes ${kindRows[2].valueLabel}, reposts ${kindRows[3].valueLabel}.`}
			/>
			{#if mediaTotal > 0}
				<p class="sub">In your posts and replies</p>
				<BarChart
					rows={mediaRows}
					ariaLabel={`Media mix of your posts and replies: ${mediaRows.map((r) => `${r.label.toLowerCase()} ${r.valueLabel}`).join(', ')}.`}
				/>
			{/if}
		{:else}
			<p class="empty">No posts in your recent feed.</p>
		{/if}
	</Card>

	<Card
		title="How your posts land"
		footnote={note(
			`Your last ${plural(eng.sample, 'original post', 'original posts')}. Counts as of today.`
		)}
	>
		{#if eng.sample > 0}
			<div class="stats three">
				<div class="tile">
					<span class="num big">{num(eng.medianLikes)}</span>
					<span class="lbl">Median likes</span>
				</div>
				<div class="tile">
					<span class="num big">{num(eng.medianReposts)}</span>
					<span class="lbl">Median reposts</span>
				</div>
				<div class="tile">
					<span class="num big">{num(eng.medianReplies)}</span>
					<span class="lbl">Median replies</span>
				</div>
			</div>
			{#if eng.top3.length > 0}
				<ul class="top" role="list">
					{#each eng.top3 as p (p.uri)}
						<li>
							<a
								class="toppost"
								href={`https://bsky.app/profile/${you.profile.did}/post/${p.uri.split('/').pop() ?? ''}`}
								target="_blank"
								rel="noopener noreferrer"
							>
								{#if p.text.length > 0}
									<span class="txt">{p.text}</span>
								{:else}
									<span class="txt fallback">{topPostLine(p.alt, p.embed)}</span>
								{/if}
								<span class="meta num">
									{plural(p.likes, 'like', 'likes')} · {plural(p.reposts, 'repost', 'reposts')} ·
									{plural(p.replies, 'reply', 'replies')}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<p class="empty">No original posts in your recent feed.</p>
		{/if}
	</Card>

	<Card title={folCopy.title} footnote={note(folCopy.footnote)}>
		{#if fol.total > 0}
			<BarChart
				rows={folRows}
				ariaLabel={`${folCopy.aria}: ${fol.noPosts} with no posts yet, ${fol.farmLook} with a follow-farm look, ${fol.labeled} with a moderation label, ${Math.max(0, fol.total - fol.noPosts - fol.farmLook - fol.labeled)} everyone else.`}
			/>
		{:else}
			<p class="empty">No followers to check yet.</p>
		{/if}
	</Card>
</div>

<style>
	.cards {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-lg);
		margin-top: var(--space-lg);
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-xs);
	}
	.stats.three {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.tile {
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		border-radius: var(--radius-md);
		padding: var(--space-sm);
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.big {
		font-size: var(--text-xl);
		line-height: 1.1;
		overflow-wrap: anywhere;
	}
	.lbl {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.line {
		margin: var(--space-sm) 0 0;
		font-size: var(--text-sm);
		color: var(--color-text);
	}

	.sub {
		margin: var(--space-md) 0 var(--space-xs);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.top {
		margin: var(--space-md) 0 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--space-xs);
	}
	.toppost {
		display: block;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		border-radius: var(--radius-md);
		padding: var(--space-sm);
		text-decoration: none;
		color: var(--color-text);
	}
	.toppost .txt {
		display: block;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	/* Posts with no text: the alt text or the post-type label, set apart. */
	.toppost .txt.fallback {
		color: var(--color-text-muted);
		font-style: italic;
	}
	.toppost .meta {
		display: block;
		margin-top: var(--space-xs);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.empty {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
