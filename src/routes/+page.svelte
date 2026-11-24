<script lang="ts">
	import { resolve } from '$app/paths';

	import { session } from '#lib/atproto/session.svelte';
	import LogoMark from '#lib/ui/LogoMark.svelte';

	let handle = $state('');
	let busy = $state(false);

	async function submit(e: Event): Promise<void> {
		e.preventDefault();
		if (busy) return;
		busy = true;
		await session.signIn(handle);
		// Only reached if sign-in did not navigate away (the user cancelled).
		busy = false;
	}
</script>

<svelte:head>
	<title>TidySky: Tidy up who you follow on Bluesky</title>
	<meta
		name="description"
		content="Free, private tools to understand and tidy the accounts you follow on Bluesky. Insights, bulk clean-up with undo, and lists you can pin as feeds."
	/>
	<link rel="canonical" href="https://tidysky.io/" />
	<meta property="og:title" content="TidySky: Tidy up who you follow on Bluesky" />
	<meta
		property="og:description"
		content="Free, private tools to understand and tidy the accounts you follow on Bluesky. Insights, bulk clean-up with undo, and lists you can pin as feeds."
	/>
	<meta property="og:url" content="https://tidysky.io/" />
	<meta property="og:image" content="https://tidysky.io/icons/og.png?v=2" />
	<meta property="og:type" content="website" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="page landing">
	<div class="brand">
		<LogoMark size={64} />
		<h1>TidySky</h1>
		<p class="tagline">Tidy up who you follow on Bluesky.</p>
	</div>

	<form class="signin card" onsubmit={submit}>
		<label for="handle">Your Bluesky handle</label>
		<input
			id="handle"
			name="handle"
			type="text"
			bind:value={handle}
			placeholder="you.bsky.social"
			autocomplete="username"
			autocapitalize="none"
			spellcheck="false"
			disabled={busy}
		/>
		<button type="submit" class="btn-primary" disabled={busy}>Sign in with Bluesky</button>

		{#if session.error}
			<p class="error" role="alert">{session.error}</p>
		{/if}
	</form>

	<p class="reassure">
		You'll approve TidySky on Bluesky's own sign-in page. We never see your password. Everything
		stays on this device.
	</p>

	<a class="btn btn-secondary demo-try" href={resolve('/insights?demo=1')}
		>Try it with sample data</a
	>

	<div class="features">
		<div class="feature">
			<!-- The brand mark: the feed you're looking at. -->
			<svg class="illus" viewBox="0 0 100 100" role="img" aria-hidden="true">
				<rect width="100" height="100" rx="22" fill="#14213D" />
				<g fill="#FFFFFF">
					<circle cx="40" cy="40" r="10" />
					<circle cx="57" cy="36" r="15" />
					<circle cx="72" cy="43" r="8" />
					<rect x="36" y="38" width="38" height="13" />
				</g>
				<g fill="none" stroke-width="6" stroke-linecap="round">
					<path d="M28 58 H80" stroke="#FFFFFF" />
					<path d="M22 68 H72" stroke="#FFFFFF" />
					<path d="M32 78 H66" stroke="#FFB86B" />
				</g>
			</svg>
			<h2>See who fills your feed.</h2>
			<p>
				Find the few accounts that write most of your timeline, and the quiet ones you might be
				missing.
			</p>
		</div>

		<div class="feature">
			<!-- The mark with a strand already let go. -->
			<svg class="illus" viewBox="0 0 100 100" role="img" aria-hidden="true">
				<rect width="100" height="100" rx="22" fill="#14213D" />
				<g fill="#FFFFFF">
					<circle cx="40" cy="40" r="10" />
					<circle cx="57" cy="36" r="15" />
					<circle cx="72" cy="43" r="8" />
					<rect x="36" y="38" width="38" height="13" />
				</g>
				<g fill="none" stroke-width="6" stroke-linecap="round">
					<path d="M28 58 H80" stroke="#FFFFFF" />
					<path d="M22 68 H72" stroke="#FFFFFF" />
					<path d="M32 78 H66" stroke="#FFFFFF" opacity="0.35" />
				</g>
			</svg>
			<h2>Clean up in minutes.</h2>
			<p>
				Filter out dead, dormant and follow-farm accounts. Review, then unfollow in one go. Undo
				anytime.
			</p>
		</div>

		<!-- The strands become a list, one marked to keep. -->
		<div class="feature">
			<svg class="illus" viewBox="0 0 100 100" role="img" aria-hidden="true">
				<rect width="100" height="100" rx="22" fill="#14213D" />
				<g fill="none" stroke-width="6" stroke-linecap="round">
					<path d="M34 36 H80" stroke="#FFFFFF" />
					<path d="M34 55 H80" stroke="#FFFFFF" />
					<path d="M34 74 H80" stroke="#FFFFFF" />
				</g>
				<circle cx="22" cy="36" r="5" fill="#FFFFFF" />
				<circle cx="22" cy="55" r="5" fill="#FFFFFF" />
				<circle cx="22" cy="74" r="5" fill="#FFB86B" />
			</svg>
			<h2>Group people into lists and pin them as feeds.</h2>
			<p>Not ready to unfollow someone? Move them to a list and read it whenever you like.</p>
		</div>
	</div>

	<p class="trust">
		Free · No sign-up · Your data stays on your device · You approve every change.
	</p>

	<footer class="footer">
		<a href={resolve('/methodology')}>Methodology</a>
		<span class="sep" aria-hidden="true">·</span>
		<a href={resolve('/privacy')}>Privacy</a>
		<span class="sep" aria-hidden="true">·</span>
		<a
			href="https://github.com/natedotid/tidysky"
			target="_blank"
			rel="external noopener noreferrer">Source code</a
		>
		<span class="sep" aria-hidden="true">·</span>
		<a href="https://bsky.app/profile/nate.id" target="_blank" rel="external noopener noreferrer"
			>Built by Nate</a
		>
	</footer>
</div>

<style>
	.landing {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding-top: var(--space-lg);
	}

	.brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-sm);
		margin-bottom: var(--space-lg);
	}

	.brand h1 {
		font-size: var(--text-2xl);
		margin: 0;
	}

	.tagline {
		margin: 0;
		max-width: 34ch;
		color: var(--color-text-muted);
	}

	.signin {
		width: 100%;
		max-width: 360px;
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
		text-align: left;
	}

	.signin label {
		font-weight: 600;
	}

	.signin input {
		min-height: var(--tap);
		padding: 0 var(--space-md);
		font: inherit;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		width: 100%;
	}

	.signin input::placeholder {
		color: var(--color-text-muted);
	}

	.signin button {
		width: 100%;
	}

	.error {
		margin: 0;
		color: var(--color-danger);
		font-size: var(--text-sm);
	}

	.reassure {
		margin: var(--space-md) 0 0;
		max-width: 40ch;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.demo-try {
		width: 100%;
		max-width: 360px;
		margin-top: var(--space-md);
		text-decoration: none;
	}

	.features {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-md);
		width: 100%;
		max-width: 640px;
		margin-top: var(--space-xl);
	}

	@media (max-width: 560px) {
		.features {
			grid-template-columns: 1fr;
			max-width: 360px;
		}
	}

	.feature {
		display: grid;
		justify-items: center;
		gap: var(--space-xs);
		padding: var(--space-md);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.illus {
		width: 64px;
		height: 64px;
		margin-top: var(--space-xs);
	}

	.feature h2 {
		margin: var(--space-xs) 0 0;
		font-size: var(--text-base);
	}

	.feature p {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.trust {
		margin: var(--space-xl) 0 0;
		max-width: 46ch;
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.footer {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		margin: var(--space-md) 0 var(--space-lg);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.footer a {
		display: inline-flex;
		align-items: center;
		/* 44 × 44 tap target on the small footer links. */
		min-width: var(--tap);
		min-height: var(--tap);
		color: var(--color-text-muted);
		font-weight: 600;
		text-decoration: none;
	}

	.footer a:hover {
		text-decoration: underline;
	}

	.sep {
		margin: 0 var(--space-xs);
	}
</style>
