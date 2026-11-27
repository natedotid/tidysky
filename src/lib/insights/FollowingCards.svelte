<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import type { FollowAccount } from '#lib/scan/types';
	import { CONFIG } from '#lib/config';
	import {
		interactionBucketPlan,
		interactionWindow,
		interactionWindowLabels
	} from '#lib/scan/interaction-window';
	import { plural } from '#lib/format';
	import { busiestHour } from '#lib/charts/busiest';
	import { logBuckets } from '#lib/charts/scale';
	import BarChart from '#lib/charts/BarChart.svelte';
	import HourChart from '#lib/charts/HourChart.svelte';
	import LogHistogram from '#lib/charts/LogHistogram.svelte';
	import RankList from '#lib/charts/RankList.svelte';
	import StackedBar from '#lib/charts/StackedBar.svelte';
	import Card from '#lib/ui/Card.svelte';
	import {
		activityBuckets,
		feedShare,
		followBack,
		followBackTakeaway,
		followedByMonth,
		followedInLastDays,
		hiddenFromYou,
		interactionBuckets,
		interactionCount,
		leastActive,
		leastInteracted,
		listHref,
		mostActive,
		mostInteracted,
		sizeDistribution,
		whatTheyPost,
		whenTheyPostFootnote,
		whenTheyPostHours
	} from './following';

	const DAY = 86_400_000;

	interface Props {
		accounts: FollowAccount[];
		/** "Based on 412 of 850 accounts" while a scan is incomplete. */
		partial: string | null;
		/** Your own follower count, drawn on the "how big" histogram. */
		youValue: number | null;
		/** When the interaction check last ran, or null. */
		interactionsScannedAt: string | null;
		/** Oldest date the interaction read fully covered, or null. */
		interactionsCoveredSince: string | null;
		/** Your own account's createdAt, if known. */
		myCreatedAt: string | null;
	}

	let {
		accounts,
		partial,
		youValue,
		interactionsScannedAt,
		interactionsCoveredSince,
		myCreatedAt
	}: Props = $props();

	const now = new Date();
	let rankTab = $state<'most' | 'quiet'>('most');

	const share = $derived(feedShare(accounts));
	const buckets = $derived(activityBuckets(accounts, now));
	const most = $derived(mostActive(accounts, 10));
	const quietest = $derived(leastActive(accounts, 10));
	// --- when they post: hours of the day only, from the accounts with
	// enough recent history to read a daily pattern.
	const post = $derived(whenTheyPostHours(accounts));
	const postHourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
	const postBusiest = $derived(post.enough ? busiestHour(post.hours) : null);
	const postTakeaway = $derived.by((): string | null => {
		if (postBusiest === null) return null;
		return `Busiest around ${postHourFmt.format(new Date(2024, 0, 1, postBusiest))}.`;
	});
	const postAria = $derived.by((): string => {
		const base = `Estimated posts per hour of the day from the ${plural(
			post.included,
			'account',
			'accounts'
		)} you follow with enough recent posts`;
		if (postBusiest === null) return `${base}.`;
		return `${base}; busiest around ${postHourFmt.format(new Date(2024, 0, 1, postBusiest))}.`;
	});
	const what = $derived(whatTheyPost(accounts));
	const sizes = $derived(sizeDistribution(accounts));
	const months = $derived(followedByMonth(accounts, now, 12));
	const back = $derived(followBack(accounts));
	const recentFollows = $derived(followedInLastDays(accounts, now, 30));

	// --- who fills your feed
	const feedRows = $derived(
		share.top.map((t, i) => ({
			label: t.account.displayName ?? t.account.handle,
			value: t.share * 100,
			valueLabel: `${Math.round(t.share * 100)}%`,
			highlight: i === 0
		}))
	);
	const feedTakeaway = $derived(
		share.total === 0
			? null
			: share.halfCount === 1
				? '1 account writes half of what you could see.'
				: `${share.halfCount} accounts write half of what you could see.`
	);

	// --- how active are they
	const BUCKET_PRESETS: Record<string, string> = { quiet: 'quiet90', never: 'never', gone: 'gone' };
	function tapBucket(key: string): void {
		const preset = BUCKET_PRESETS[key];
		if (preset !== undefined) void goto(resolve(`cleanup?preset=${preset}`));
	}
	const bucketSegments = $derived([
		{ key: 'active7', label: 'Active in 7 days', value: buckets.active7, color: 'var(--ramp-1)' },
		{
			key: 'active30',
			label: 'Active in 30 days',
			value: buckets.active30,
			color: 'var(--ramp-2)'
		},
		{
			key: 'active90',
			label: 'Active in 90 days',
			value: buckets.active90,
			color: 'var(--ramp-3)'
		},
		{ key: 'quiet', label: 'Quiet (90+ days)', value: buckets.quiet, color: 'var(--ramp-4)' },
		{ key: 'never', label: 'Never posted', value: buckets.never, color: 'var(--color-gone)' },
		{ key: 'gone', label: 'Gone', value: buckets.gone, color: 'var(--color-gone)' },
		{ key: 'unknown', label: 'Unknown', value: buckets.unknown, color: 'var(--color-surface-2)' }
	]);
	const quietTakeaway = $derived.by((): string => {
		const n = buckets.quiet + buckets.never + buckets.gone;
		return `${n} of ${accounts.length} ${n === 1 ? "hasn't" : "haven't"} posted in 90 days or ${
			n === 1 ? 'is' : 'are'
		} gone.`;
	});

	// --- how often you interact
	const ix = $derived(interactionBuckets(accounts, now));
	// The read hit its cap: it reaches back to coveredSince, not the full year.
	const interactionCapped = $derived.by((): boolean => {
		if (interactionsScannedAt === null || interactionsCoveredSince === null) return false;
		const windowStart = Date.parse(interactionsScannedAt) - CONFIG.interactionWindowDays * DAY;
		return Date.parse(interactionsCoveredSince) > windowStart;
	});
	const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
	function monthYear(iso: string): string {
		return monthYearFmt.format(new Date(iso));
	}
	// Where the window starts, in words: the full year, the read's cap, or
	// your own account's creation, whichever is latest.
	const windowLabels = $derived(
		interactionWindowLabels(
			interactionWindow(interactionsScannedAt, interactionsCoveredSince, myCreatedAt)
		)
	);
	const interactionTakeaway = $derived(
		`You haven't interacted with ${ix.none} of the ${ix.checked} active accounts you follow ${windowLabels.since}.`
	);
	const in91Label = $derived(
		interactionCapped
			? `91 days to ${monthYear(interactionsCoveredSince ?? '')}`
			: '91 days to 12 months'
	);
	// A young account: hide time buckets that lie entirely before the
	// account existed (they always count 0) and relabel the oldest bucket
	// that still overlaps the account's life.
	const bucketPlan = $derived(interactionBucketPlan(interactionsScannedAt, myCreatedAt));
	const in31To90Label = $derived(bucketPlan.in31To90.openLabel ?? '31 to 90 days');
	const in91FullLabel = $derived(bucketPlan.in91To365.openLabel ?? in91Label);
	const interactionSegments = $derived([
		{ key: 'in30', label: 'In the last 30 days', value: ix.in30, color: 'var(--ramp-1)' },
		...(bucketPlan.in31To90.hidden
			? []
			: [{ key: 'in31To90', label: in31To90Label, value: ix.in31To90, color: 'var(--ramp-2)' }]),
		...(bucketPlan.in91To365.hidden
			? []
			: [{ key: 'in91To365', label: in91FullLabel, value: ix.in91To365, color: 'var(--ramp-3)' }]),
		{ key: 'none', label: windowLabels.none, value: ix.none, color: 'var(--ramp-4)' },
		...(ix.unchecked > 0
			? [
					{
						key: 'unchecked',
						label: 'Not checked yet',
						value: ix.unchecked,
						color: 'var(--color-surface-2)'
					}
				]
			: [])
	]);
	const interactionAria = $derived.by((): string => {
		const parts = [`${ix.in30} in the last 30 days`];
		if (!bucketPlan.in31To90.hidden) parts.push(`${ix.in31To90} in ${in31To90Label}`);
		if (!bucketPlan.in91To365.hidden) parts.push(`${ix.in91To365} in ${in91FullLabel}`);
		parts.push(`${ix.none} with none ${windowLabels.since}`);
		if (ix.unchecked > 0) parts.push(`${ix.unchecked} not checked yet`);
		return `Your interactions with the ${ix.checked} active accounts you follow: ${parts.join(
			', '
		)}.`;
	});
	function tapInteraction(key: string): void {
		if (key === 'none') void goto(resolve('cleanup?preset=oneWay'));
	}

	// --- who you interact with
	let ixTab = $state<'most' | 'least'>('most');
	const mostIx = $derived(mostInteracted(accounts, 10));
	const leastIx = $derived(leastInteracted(accounts, 10));
	function countLabel(a: FollowAccount): string {
		const c = interactionCount(a) ?? 0;
		return `${c.toLocaleString('en-US')} ${c === 1 ? 'interaction' : 'interactions'}`;
	}
	/** The row value, e.g. "54/day" (the "Most active" cards' format). */
	function perDay(a: FollowAccount): string {
		const v = a.activity?.itemsPerDay ?? 0;
		if (v >= 1) return `${Math.round(v)}/day`;
		// A positive rate that rounds to 0.0 reads like "never posts".
		if (v > 0 && v.toFixed(1) === '0.0') return '<0.1/day';
		return `${v.toFixed(1)}/day`;
	}
	/** The row value in words, for the row's screen-reader label. */
	function perDayWords(a: FollowAccount): string {
		const v = a.activity?.itemsPerDay ?? 0;
		if (v >= 1) return `${Math.round(v)} posts a day`;
		if (v > 0 && v.toFixed(1) === '0.0') return 'under 0.1 posts a day';
		return `${v.toFixed(1)} posts a day`;
	}
	const mostIxRows = $derived(
		mostIx.map((a) => ({
			did: a.did,
			name: a.displayName ?? a.handle,
			handle: a.handle,
			avatar: a.avatar,
			value: (interactionCount(a) ?? 0).toLocaleString('en-US'),
			ariaLabel: `${a.displayName ?? a.handle}, ${countLabel(a)}`
		}))
	);
	const leastIxRows = $derived(
		leastIx.map((a) => ({
			did: a.did,
			name: a.displayName ?? a.handle,
			handle: a.handle,
			avatar: a.avatar,
			value: perDay(a),
			ariaLabel: `${a.displayName ?? a.handle}, ${countLabel(a)}, ${perDayWords(a)}`
		}))
	);
	const ixTabTakeaway = $derived.by((): string | undefined => {
		if (ixTab === 'least') return 'Active accounts you interact with least, busiest first.';
		if (mostIx.length === 0) return undefined;
		return `Your ${mostIx.length} most interacted-with account${
			mostIx.length === 1 ? '' : 's'
		} ${windowLabels.since}.`;
	});

	// --- most active / quietest
	const rankRows = $derived(
		(rankTab === 'most' ? most : quietest).map((a) => ({
			did: a.did,
			name: a.displayName ?? a.handle,
			handle: a.handle,
			avatar: a.avatar,
			value: perDay(a)
		}))
	);

	// --- what they post
	const langNames = new Intl.DisplayNames(undefined, { type: 'language' });
	function langName(code: string): string {
		let name: string;
		try {
			name = langNames.of(code) ?? code;
		} catch {
			return code;
		}
		return name.charAt(0).toUpperCase() + name.slice(1);
	}
	const langLine = $derived.by((): string | null => {
		const top = what.langs.slice(0, 3);
		if (top.length === 0) return null;
		const names = top.map(([code]) => langName(code));
		if (names.length === 1) return `Mostly ${names[0]}.`;
		if (names.length === 2) return `Mostly ${names[0]}, then ${names[1]}.`;
		return `Mostly ${names[0]}, then ${names[1]} and ${names[2]}.`;
	});
	const mediaTotal = $derived(
		what.media.text + what.media.image + what.media.video + what.media.link + what.media.quote
	);
	const mediaRows = $derived(
		(
			[
				['Text', 'text'],
				['Images', 'image'],
				['Video', 'video'],
				['Links', 'link'],
				['Quotes', 'quote']
			] as Array<[string, keyof typeof what.media]>
		).map(([label, k]) => ({
			label,
			value: what.media[k],
			valueLabel: `${mediaTotal === 0 ? 0 : Math.round((what.media[k] / mediaTotal) * 100)}%`
		}))
	);
	const repostTakeaway = $derived.by((): string | null => {
		const total = what.kinds.post + what.kinds.reply + what.kinds.quote + what.kinds.repost;
		if (total === 0) return null;
		return `${Math.round((what.kinds.repost / total) * 100)}% of what they share is reposts.`;
	});

	// --- how big are they
	const sizeTakeaway = $derived.by((): string | null => {
		if (sizes.length === 0) return null;
		let best = logBuckets(sizes)[0];
		for (const b of logBuckets(sizes)) if (b.count > best.count) best = b;
		if (best.count === 0) return null;
		if (best.label === '0') return 'Most people you follow have no followers.';
		if (best.label.endsWith('+')) return `Most people you follow have ${best.label} followers.`;
		return `Most people you follow have between ${best.label} followers.`;
	});

	// --- do they follow back
	const backSegments = $derived([
		{ key: 'yes', label: 'Follow back', value: back.yes, color: 'var(--chart-3)' },
		{ key: 'no', label: 'Do not', value: back.no, color: 'var(--chart-4)' },
		{ key: 'unknown', label: 'Unknown', value: back.unknown, color: 'var(--color-surface-2)' }
	]);
	function tapBack(key: string): void {
		if (key === 'no') void goto(resolve('cleanup?preset=notBack'));
	}
	const backTakeaway = $derived(followBackTakeaway(back));

	// --- hidden from you
	const hid = $derived(hiddenFromYou(accounts));
	const hiddenTakeaway = $derived.by((): string | null => {
		// An older scan has no viewer readings: the card body asks for a
		// rescan, so there is no takeaway.
		if (!hid.read) return null;
		if (hid.hidden === 0) return 'None of the people you follow are hidden by a list';
		return `${plural(hid.hidden, 'person you follow is', 'people you follow are')} hidden by a list you subscribe to`;
	});

	// --- when you followed them
	const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' });
	function monthLabel(key: string): string {
		const [y, m] = key.split('-').map(Number);
		return monthFmt.format(new Date(y, m - 1, 1));
	}
	const monthRows = $derived(months.map((m) => ({ label: monthLabel(m.month), value: m.count })));
	const monthTakeaway = $derived(
		`You followed ${recentFollows} account${recentFollows === 1 ? '' : 's'} in the last 30 days.`
	);

	/** A card footnote, with the partial-scan note appended while it applies. */
	function note(base: string | null): string | undefined {
		if (base === null) return partial ?? undefined;
		return partial !== null ? `${base} ${partial}` : base;
	}
</script>

<div class="cards">
	<Card
		title="Who fills your feed"
		takeaway={feedTakeaway ?? undefined}
		footnote={note('Estimated from up to 30 recent posts and reposts per account.')}
		action={{ label: 'Build a Quiet voices list →', href: 'lists?preset=quietVoices' }}
	>
		<div class="chart-slot" style="min-height: 320px">
			{#if share.total > 0}
				<BarChart
					rows={feedRows}
					ariaLabel={`Share of your feed among the top ${plural(feedRows.length, 'account', 'accounts')}; ${feedRows[0]?.label ?? ''} leads at ${feedRows[0]?.valueLabel ?? ''}.`}
				/>
			{:else}
				<p class="empty">No activity in the sample yet.</p>
			{/if}
		</div>
	</Card>

	<Card title="How active are they" takeaway={quietTakeaway} footnote={note(null)}>
		<StackedBar
			segments={bucketSegments}
			ariaLabel={`Activity of the ${plural(accounts.length, 'account', 'accounts')} you follow: ${buckets.active7} active in 7 days, ${buckets.active30} in 30, ${buckets.active90} in 90, ${buckets.quiet} quiet, ${buckets.never} never posted, ${buckets.gone} gone, ${buckets.unknown} unknown.`}
			onselect={tapBucket}
			tappableKeys={['quiet', 'never', 'gone']}
		/>
	</Card>

	{#if interactionsScannedAt !== null}
		<Card
			title="How often you interact"
			takeaway={interactionTakeaway}
			footnote={note('Counts likes, reposts, replies, quotes and mentions from your own account.')}
			action={{
				label: "See active accounts you don't interact with →",
				href: 'cleanup?preset=oneWay'
			}}
		>
			<StackedBar
				segments={interactionSegments}
				ariaLabel={interactionAria}
				onselect={tapInteraction}
				tappableKeys={['none']}
			/>
		</Card>

		<Card
			title="Who you interact with"
			takeaway={ixTabTakeaway}
			footnote={note(
				`Interactions are your likes, reposts, replies, quotes and mentions ${windowLabels.since}.`
			)}
			action={ixTab === 'most'
				? { label: 'Build a list of your regulars →', href: 'lists?preset=regulars' }
				: { label: 'See them in Clean up →', href: 'cleanup?preset=oneWay' }}
		>
			<div class="tabs">
				<button
					type="button"
					class:sel={ixTab === 'most'}
					aria-pressed={ixTab === 'most'}
					onclick={() => (ixTab = 'most')}
				>
					Most
				</button>
				<button
					type="button"
					class:sel={ixTab === 'least'}
					aria-pressed={ixTab === 'least'}
					onclick={() => (ixTab = 'least')}
				>
					Least
				</button>
			</div>
			<div class="chart-slot" style="min-height: 440px">
				{#if ixTab === 'most'}
					{#if mostIxRows.length > 0}
						<RankList
							rows={mostIxRows}
							ariaLabel={`The ${mostIx.length} account${mostIx.length === 1 ? '' : 's'} you interact with most, by interaction count.`}
						/>
					{:else}
						<p class="empty">No interactions found {windowLabels.since}.</p>
					{/if}
				{:else}
					{#if leastIxRows.length > 0}
						<RankList
							rows={leastIxRows}
							ariaLabel="The active accounts you interact with least, busiest first, by estimated posts per day."
						/>
					{:else}
						<p class="empty">No active accounts in the sample.</p>
					{/if}
				{/if}
			</div>
		</Card>
	{/if}

	<Card title="Most active and quietest" footnote={note(null)}>
		<div class="tabs">
			<button
				type="button"
				class:sel={rankTab === 'most'}
				aria-pressed={rankTab === 'most'}
				onclick={() => (rankTab = 'most')}
			>
				Most active
			</button>
			<button
				type="button"
				class:sel={rankTab === 'quiet'}
				aria-pressed={rankTab === 'quiet'}
				onclick={() => (rankTab = 'quiet')}
			>
				Quietest
			</button>
		</div>
		<div class="chart-slot" style="min-height: 440px">
			{#if rankRows.length > 0}
				<RankList
					rows={rankRows}
					ariaLabel={`The ${rankTab === 'most' ? 'most' : 'least'} active accounts you follow, by estimated posts per day.`}
				/>
			{:else}
				<p class="empty">No active accounts in the sample.</p>
			{/if}
		</div>
	</Card>

	<Card
		title="When they post"
		takeaway={postTakeaway ?? undefined}
		footnote={note(whenTheyPostFootnote(post.included, post.excluded))}
	>
		<div class="chart-slot" style="min-height: 138px">
			{#if post.enough}
				<HourChart hours={post.hours} ariaLabel={postAria} />
			{:else}
				<p class="empty">Not enough history yet to tell when they post.</p>
			{/if}
		</div>
	</Card>

	<Card title="What they post" takeaway={repostTakeaway ?? undefined} footnote={note(null)}>
		<div class="chart-slot" style="min-height: 160px">
			{#if mediaTotal > 0}
				<BarChart
					rows={mediaRows}
					ariaLabel={`Media mix of what the accounts you follow share: text ${what.media.text}, images ${what.media.image}, video ${what.media.video}, links ${what.media.link}, quotes ${what.media.quote}.`}
				/>
			{:else}
				<p class="empty">No posts in the sample yet.</p>
			{/if}
		</div>
		{#if langLine !== null}
			<p class="lang-line">{langLine}</p>
		{/if}
	</Card>

	<Card title="How big are they" takeaway={sizeTakeaway ?? undefined} footnote={note(null)}>
		<div class="chart-slot" style="min-height: 200px">
			{#if sizes.length > 0}
				<LogHistogram
					values={sizes}
					{youValue}
					ariaLabel={`Distribution of follower counts among the ${plural(sizes.length, 'account', 'accounts')} you follow with a known count.`}
				/>
			{:else}
				<p class="empty">No follower counts yet.</p>
			{/if}
		</div>
	</Card>

	<Card title="Do they follow back" takeaway={backTakeaway ?? undefined} footnote={note(null)}>
		<StackedBar
			segments={backSegments}
			ariaLabel={`Follow back among the accounts you follow: ${back.yes} ${back.yes === 1 ? 'does' : 'do'}, ${back.no} ${back.no === 1 ? 'does' : 'do'} not, ${back.unknown} unknown.`}
			onselect={tapBack}
			tappableKeys={['no']}
		/>
	</Card>

	<Card
		title="Hidden from you"
		takeaway={hiddenTakeaway ?? undefined}
		footnote={note(
			'Lists you subscribe to win over follows. To see someone again, unsubscribe from the list on Bluesky.'
		)}
		action={hid.read && hid.hidden > 0
			? { label: 'See them in Clean up →', href: 'cleanup?preset=hiddenByList' }
			: undefined}
	>
		{#if hid.read}
			<!-- One grid child: the card's 16 px gap would otherwise sit
				 between the list and the blocks line, doubling the gap. -->
			<div class="hidden-body">
				{#if hid.lists.length > 0}
					<ul class="hidden-list" aria-label="The lists hiding people you follow">
						{#each hid.lists as l (l.uri + l.kind)}
							<li>
								{#if listHref(l.uri) !== null}
									<a href={listHref(l.uri)} target="_blank" rel="external noopener noreferrer">
										{l.name}
									</a>
								{:else}
									{l.name}
								{/if}
								<span class="hides">
									{l.kind === 'mute' ? 'mutes' : 'blocks'}
									{l.count}
									{l.count === 1 ? 'follow' : 'follows'}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
				{#if hid.blocksYou > 0}
					<a class="blocks-line" href={resolve('cleanup?preset=blocksYou')}>
						{plural(hid.blocksYou, 'person', 'people')}
						block you
					</a>
				{:else}
					<p class="blocks-line plain">No one you follow blocks you.</p>
				{/if}
			</div>
		{:else}
			<p class="empty">Scan again to check for follows hidden by a list or blocking you.</p>
		{/if}
	</Card>

	<Card title="When you followed them" takeaway={monthTakeaway} footnote={note(null)}>
		<BarChart
			rows={monthRows}
			ariaLabel="How many accounts you followed per month, last 12 months."
		/>
	</Card>
</div>

<style>
	.cards {
		display: grid;
		/* minmax(0, 1fr): a card's min-content (a long name, a chart) must
			not be able to widen the shared column past the viewport. */
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-lg);
		margin-top: var(--space-lg);
	}

	.empty {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	/* Reserve each conditional chart's height so the card doesn't grow when the
		scan's first data turns a "no data yet" note into a chart (CLS). The
		loaded chart fills the reserved height exactly; the empty note centers. */
	.chart-slot {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: center;
	}

	.tabs {
		display: flex;
		gap: var(--space-xs);
		margin-bottom: var(--space-sm);
	}
	.tabs button {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		border-radius: var(--radius-pill);
		padding: 6px 14px;
		min-height: var(--tap);
		cursor: pointer;
	}
	.tabs button.sel {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-on-primary);
	}

	.lang-line {
		margin: var(--space-sm) 0 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	/* "Hidden from you": one row per hiding list. Sits in .hidden-body with
	   the blocks line, so the card's grid gap doesn't separate the two. */
	.hidden-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.hidden-list li {
		font-size: var(--text-sm);
		padding: 4px 0;
		border-bottom: 1px solid var(--color-border);
		min-width: 0;
	}
	.hidden-list li:last-child {
		border-bottom: none;
	}
	.hidden-list a {
		color: var(--color-link);
		text-decoration: none;
		font-weight: 600;
	}
	.hidden-list a:hover {
		text-decoration: underline;
		color: var(--color-link-hover);
	}
	.hidden-list .hides {
		color: var(--color-text-muted);
	}
	/* Flex, not an inline-block with a 44 px line-height: the line box the
	   inline-block sat on added extra space above it. Centered in its own
	   box, the space above is the rows' own padding, so it reads like
	   another row of the list above. */
	.blocks-line {
		display: flex;
		align-items: center;
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-link);
		text-decoration: none;
		font-weight: 600;
		min-height: var(--tap);
	}
	a.blocks-line:hover {
		text-decoration: underline;
		color: var(--color-link-hover);
	}
	.blocks-line.plain {
		color: var(--color-text-muted);
		font-weight: 400;
		line-height: inherit;
		min-height: 0;
	}
</style>
