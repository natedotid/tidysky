<script lang="ts">
	import { resolve } from '$app/paths';

	import { CONFIG } from '#lib/config';

	import LogoMark from '#lib/ui/LogoMark.svelte';
</script>

<svelte:head>
	<title>How it works · TidySky</title>
	<meta
		name="description"
		content="Where TidySky's data comes from, what active, quiet and gone mean, and how the estimates are made."
	/>
</svelte:head>

<div class="page">
	<header class="app-header">
		<LogoMark size={28} />
		<span class="wordmark">TidySky</span>
	</header>

	<h1>How TidySky works</h1>
	<p class="intro">
		How TidySky gets its numbers. The figures on this page come from the app's own settings, so
		they're always current.
	</p>

	<section class="card">
		<h2>Where the data comes from</h2>
		<p>
			TidySky reads two things from Bluesky, right in your browser: the list of people you follow,
			and the public details of each of those accounts (profile, follower and follow counts, and a
			sample of recent posts). TidySky has no server, so all the math happens on your device.
		</p>
	</section>

	<section class="card">
		<h2>Active, quiet and gone</h2>
		<ul>
			<li>
				<strong>Active:</strong> the account exists and its profile can be read.
			</li>
			<li>
				<strong>Quiet:</strong> an active account whose newest post or repost is older than the number
				of days you pick (30, 60, 90, 180 or 365). An account with no posts in the sample counts as quiet.
			</li>
			<li>
				<strong>Gone:</strong> the account was deactivated, deleted or taken down, so its profile can't
				be read anymore.
			</li>
		</ul>
	</section>

	<section class="card">
		<h2>How posts per day is estimated</h2>
		<p>
			Reading an account's whole history would be slow, and you don't need it to tell whether an
			account is active. TidySky reads the {CONFIG.activitySample} newest posts and reposts and estimates
			a rate from them, so the number is always shown as an estimate:
		</p>
		<ul>
			<li>
				When those {CONFIG.activitySample} posts are all the account has ever posted, the span is measured
				from when the account was created.
			</li>
			<li>
				Otherwise the span is measured from the oldest post in the sample. The account may have
				posted more before that, so this is a lower bound.
			</li>
			<li>
				The span is never shorter than one hour, so a quick burst of posts can't produce a wild
				rate.
			</li>
		</ul>
		<p>Reposts count too, because they show up in your timeline like posts do.</p>
	</section>

	<section class="card">
		<h2>How "follows you back" works</h2>
		<p>
			For each account you follow, TidySky asks Bluesky whether that account follows you. The answer
			comes straight from Bluesky, not from guessing at follower counts. If Bluesky doesn't answer,
			the account is marked unknown, not "doesn't follow back".
		</p>
	</section>

	<section class="card">
		<h2>Why some accounts show as unknown</h2>
		<p>
			Now and then a single read fails: a momentary network error, or an account Bluesky doesn't
			answer about. TidySky marks those accounts as unknown. Unknown accounts can never be put into
			a clean-up selection, and the next scan tries them again.
		</p>
	</section>

	<section class="card">
		<h2>Last interaction</h2>
		<p>
			"Last interaction" is when you last interacted with an account: a like, a repost, a reply, a
			quote, or a mention of them in one of your posts. TidySky works out which accounts those touch
			from your own likes, reposts and posts from the last {CONFIG.interactionWindowDays}
			days, read from your account at each scan.
		</p>
		<ul>
			<li>
				TidySky only sees what you did, not what they did to you. A like they gave you, or a reply
				they wrote, doesn't count.
			</li>
			<li>
				The interaction count is a plain total: likes plus reposts plus replies plus quotes plus
				mentions in the window. No kind is weighted more than another.
			</li>
			<li>
				Each type is capped at the {CONFIG.interactionMaxRecordsPerCollection.toLocaleString(
					'en-US'
				)}
				most recent records. If you have more than that, the check reaches back only as far as those records
				go, and the app says so, for example "none since Mar 2026", instead of claiming the whole window.
			</li>
			<li>
				If your own account is younger than the window, it starts when you joined, not a year ago,
				and the app says so, for example "since you joined in Mar 2026".
			</li>
			<li>
				An account only gets an answer once the scan has checked it; until then it shows nothing,
				and no filter that depends on it can match it.
			</li>
		</ul>
	</section>

	<section class="card">
		<h2>Who you interact with</h2>
		<p>
			The "Who you interact with" card ranks the accounts you follow by interaction count in the
			last {CONFIG.interactionWindowDays} days:
		</p>
		<ul>
			<li>
				<strong>Most:</strong> the up to 10 accounts you interacted with most, by count. A tie goes to
				the account whose last interaction is more recent.
			</li>
			<li>
				<strong>Least:</strong> the up to 10 active, posting accounts you interacted with least, fewest
				first. A tie goes to the busier account, the one that posts more.
			</li>
		</ul>
		<p>
			The "Your regulars" list preset is the same idea saved as a list: the accounts you've
			interacted with 5 or more times in the last {CONFIG.interactionWindowDays} days.
		</p>
	</section>

	<section class="card">
		<h2>Known limits</h2>
		<ul>
			<li>
				Activity is a sample of the {CONFIG.activitySample} newest posts, not the full history.
			</li>
			<li>The "your followers" views use your newest {CONFIG.youFollowersSample} followers.</li>
			<li>Scan snapshots are kept per device: the newest {CONFIG.snapshotsKept}.</li>
			<li>Scan results are treated as stale after {CONFIG.staleAfterHours} hours.</li>
			<li>
				The daily unfollow suggestion defaults to {CONFIG.softDailyUnfollowLimit}; you can change it
				in Settings.
			</li>
			<li>
				Undo uses the history saved in this browser, so changes made on another device or browser
				can't be undone here.
			</li>
		</ul>
	</section>

	<p class="back">
		<a href={resolve('/')}>Back to TidySky</a>
	</p>
</div>

<style>
	.intro {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		margin-bottom: var(--space-md);
	}

	.card h2 {
		margin: 0 0 var(--space-sm);
		font-size: var(--text-lg);
	}

	.card p {
		margin: 0 0 var(--space-sm);
		font-size: var(--text-sm);
	}

	.card p:last-child {
		margin-bottom: 0;
	}

	.card ul {
		margin: 0;
		padding-left: 1.2em;
		display: grid;
		gap: var(--space-xs);
		font-size: var(--text-sm);
	}

	.back {
		margin-top: var(--space-lg);
	}

	.back a {
		color: var(--color-primary);
		font-size: var(--text-sm);
		font-weight: 600;
	}
</style>
