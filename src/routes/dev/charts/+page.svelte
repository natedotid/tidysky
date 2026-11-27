<script lang="ts">
	import BarChart from '#lib/charts/BarChart.svelte';
	import Heatmap from '#lib/charts/Heatmap.svelte';
	import LogHistogram from '#lib/charts/LogHistogram.svelte';
	import RankList from '#lib/charts/RankList.svelte';
	import StackedBar from '#lib/charts/StackedBar.svelte';
	import Card from '#lib/ui/Card.svelte';
	import ThemeToggle from '#lib/ui/ThemeToggle.svelte';

	const FEED = [
		{ label: 'Vera', value: 18, valueLabel: '18%', highlight: true },
		{ label: 'Tatum Blackwood', value: 14, valueLabel: '14%' },
		{ label: 'Wren', value: 11, valueLabel: '11%' },
		{ label: 'Piper', value: 9, valueLabel: '9%' },
		{ label: 'Rowan Ellison', value: 7, valueLabel: '7%' },
		{ label: 'Hollow Surf', value: 5, valueLabel: '5%' },
		{ label: 'Rose Cove', value: 4, valueLabel: '4%' },
		{ label: 'Kai', value: 3, valueLabel: '3%' },
		{ label: 'River Cove', value: 3, valueLabel: '3%' },
		{ label: 'Finley', value: 2, valueLabel: '2%' }
	];

	const BUCKETS = [
		{ key: 'active7', label: 'Active in 7 days', value: 120, color: 'var(--ramp-1)' },
		{ key: 'active30', label: 'Active in 30 days', value: 95, color: 'var(--ramp-2)' },
		{ key: 'active90', label: 'Active in 90 days', value: 60, color: 'var(--ramp-3)' },
		{ key: 'quiet', label: 'Quiet (90+ days)', value: 150, color: 'var(--ramp-4)' },
		{ key: 'never', label: 'Never posted', value: 88, color: 'var(--color-gone)' },
		{ key: 'gone', label: 'Gone', value: 63, color: 'var(--color-gone)' },
		{ key: 'unknown', label: 'Unknown', value: 74, color: 'var(--color-surface-2)' },
		// Under 0.5%: hidden from the bar, kept in the legend.
		{ key: 'edge', label: 'Edge case', value: 1, color: 'var(--chart-5)' }
	];

	// 7 × 24, stored Sunday-first. Weekday evenings run hot; Tuesday 9 pm is
	// the one uniquely hottest cell so the busiest callout has a clear answer.
	const HEAT = [0, 1, 2, 3, 4, 5, 6].map((day) =>
		Array.from({ length: 24 }, (_, h) => {
			if (day === 2 && h === 21) return 9;
			if (day >= 1 && day <= 5 && h >= 18 && h <= 22) return 5 + ((day + h) % 4);
			if (h >= 12 && h < 18) return 2 + (h % 2);
			if (h === 8 || h === 9) return 3;
			return h % 5 === 0 ? 1 : 0;
		})
	);

	const FOLLOWERS = [
		0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 20, 25, 33, 40, 55, 60, 75, 90, 120, 150, 200, 260, 300,
		400, 500, 700, 900, 1200, 1500, 2000, 2600, 3500, 4500, 6000, 8000, 10000, 14000, 18000, 25000,
		33000, 45000, 60000, 80000, 100000, 150000, 220000, 300000, 450000, 600000
	];

	const RANK = [
		{
			did: 'did:plc:aaaa1111',
			name: 'Firehose Feed',
			handle: 'firehose.bsky.social',
			avatar: null,
			value: '42/day'
		},
		{
			did: 'did:plc:bbbb2222',
			name: 'Pulse',
			handle: 'pulse.bsky.social',
			avatar: null,
			value: '18/day'
		},
		{
			did: 'did:plc:cccc3333',
			name: 'Night Shift',
			handle: 'nightshift.bsky.social',
			avatar: null,
			value: '9/day'
		},
		{
			did: 'did:plc:dddd4444',
			name: 'Slow News',
			handle: 'slownews.bsky.social',
			avatar: null,
			value: '2/day'
		},
		{
			did: 'did:plc:eeee5555',
			name: 'Quiet Corner',
			handle: 'quietcorner.bsky.social',
			avatar: null,
			value: '0/day'
		}
	];

	let selected = $state('');
</script>

<svelte:head>
	<title>Charts · TidySky dev</title>
</svelte:head>

<div class="page gallery">
	<h1>Charts</h1>
	<p class="muted">Dev gallery: sample data, both themes, 375 and 1024 px.</p>
	<ThemeToggle />
	{#if selected !== ''}
		<p class="picked" role="status">Selected segment: <strong>{selected}</strong></p>
	{/if}

	<Card
		title="Who fills your feed"
		takeaway="12 accounts write half of what you could see."
		footnote="Estimated from up to 30 recent posts and reposts per account."
		action={{ label: 'Build a Quiet voices list →', href: 'lists?preset=quietVoices' }}
	>
		<BarChart
			rows={FEED}
			ariaLabel="Top accounts by share of your feed: Vera 18 percent, Tatum Blackwood 14, Wren 11, Piper 9, Rowan Ellison 7, and smaller shares."
		/>
	</Card>

	<Card title="How active are they" takeaway="301 of 551 haven't posted in 90 days or are gone.">
		<StackedBar
			segments={BUCKETS}
			ariaLabel="Activity buckets of the accounts you follow: 120 active in 7 days, 95 in 30, 60 in 90, 150 quiet, 88 never posted, 63 gone, 74 unknown."
			onselect={(key) => (selected = key)}
		/>
	</Card>

	<Card title="Most active" takeaway="Firehose Feed posts 42 items a day.">
		<RankList
			rows={RANK}
			ariaLabel="Most active accounts you follow: Firehose Feed 42 a day, Pulse 18, Night Shift 9, Slow News 2, Quiet Corner 0."
		/>
	</Card>

	<Card title="When they post" footnote="In your time zone.">
		<Heatmap
			grid={HEAT}
			ariaLabel="Weekday and hour grid of when the accounts you follow post. Busiest: Tuesdays around 9 pm."
		/>
	</Card>

	<Card
		title="What they post"
		takeaway="31% of what they share is reposts."
		footnote="Based on 850 of 850 accounts"
	>
		<BarChart
			rows={[
				{ label: 'Text', value: 52, valueLabel: '52%' },
				{ label: 'Images', value: 21, valueLabel: '21%' },
				{ label: 'Video', value: 4, valueLabel: '4%' },
				{ label: 'Links', value: 12, valueLabel: '12%' },
				{ label: 'Quotes', value: 11, valueLabel: '11%' }
			]}
			ariaLabel="Media mix of what the accounts you follow share: text 52 percent, images 21, links 12, quotes 11, video 4."
		/>
	</Card>

	<Card title="How big are they" takeaway="Most people you follow have 100 to 999 followers.">
		<LogHistogram
			values={FOLLOWERS}
			youValue={1200}
			ariaLabel="Distribution of follower counts among the accounts you follow: most fall in the 100 to 999 followers bucket. You sit in the 1k to 9.9k bucket."
		/>
	</Card>

	<Card title="Do they follow back" takeaway="42% follow you back.">
		<StackedBar
			segments={[
				{ key: 'yes', label: 'Follow back', value: 232, color: 'var(--chart-3)' },
				{ key: 'no', label: 'Do not', value: 258, color: 'var(--chart-4)' },
				{ key: 'unknown', label: 'Unknown', value: 360, color: 'var(--color-surface-2)' }
			]}
			ariaLabel="Follow back among the accounts you follow: 232 do, 258 do not, 360 unknown."
		/>
	</Card>
</div>

<style>
	.gallery {
		display: grid;
		gap: var(--space-lg);
	}
	.gallery h1 {
		margin: 0;
		font-size: var(--text-2xl);
	}
	.muted {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.picked {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text);
	}
</style>
