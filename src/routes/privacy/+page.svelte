<script lang="ts">
	import { resolve } from '$app/paths';

	import { HANDLE_RESOLVER, SCOPES } from '#lib/atproto/scopes';

	import LogoMark from '#lib/ui/LogoMark.svelte';

	/** Each requested scope, in plain words. The raw strings come from
	 * scopes.ts so this page can't drift from what the app actually asks for. */
	const scopeNotes: Array<{ scope: string; words: string }> = [
		{
			scope: SCOPES[0],
			words: 'Identify your account and read it: your profile, your follow list, your lists.'
		},
		{
			scope: SCOPES[1],
			words: 'Unfollow accounts, and follow them again if you undo. Nothing else about follows.'
		},
		{
			scope: SCOPES[2],
			words: 'Create and delete lists on your account.'
		},
		{
			scope: SCOPES[3],
			words: 'Add and remove members of your lists.'
		},
		{
			scope: SCOPES[4],
			words:
				"Read one profile at a time through Bluesky's app service, for the account being checked."
		},
		{
			scope: SCOPES[5],
			words:
				"Read profiles in batches through Bluesky's app service. This is how a scan checks many of your follows at once."
		},
		{
			scope: SCOPES[6],
			words: `Read your followers through Bluesky's app service, for the "Who follows you" card.`
		},
		{
			scope: SCOPES[7],
			words: 'Mute the accounts you choose.'
		},
		{
			scope: SCOPES[8],
			words: 'Unmute an account when you undo a mute.'
		}
	];
</script>

<svelte:head>
	<title>Privacy · TidySky</title>
	<meta
		name="description"
		content="TidySky has no server, and your data stays in your browser. See what it asks Bluesky for and how to delete everything."
	/>
</svelte:head>

<div class="page">
	<header class="app-header">
		<LogoMark size={28} />
		<span class="wordmark">TidySky</span>
	</header>

	<h1>Privacy</h1>
	<p class="intro">In short: TidySky has no server, and your data stays in your browser.</p>

	<section class="card">
		<h2>No TidySky server</h2>
		<p>
			Your scan, lists, snapshots and history are stored only in this browser. To work, your browser
			talks directly to Bluesky: your Bluesky server (for your follows, lists and sign-in),
			Bluesky's public API at public.api.bsky.app (which sees your account and the accounts being
			checked), Bluesky's image server for profile pictures, and bsky.social to look up your handle
			at sign-in. Those requests are covered by
			<a
				href="https://bsky.social/about/support/privacy-policy"
				target="_blank"
				rel="external noopener noreferrer">Bluesky's privacy policy</a
			>.
		</p>
		<p>
			To show your last interaction with each account, TidySky also reads your own likes, reposts
			and posts from your Bluesky server. This is public data, it needs no extra permission, and it
			stays in your browser.
		</p>
	</section>

	<section class="card">
		<h2>Analytics</h2>
		<p>
			TidySky uses
			<a href="https://usefathom.com" target="_blank" rel="external noopener noreferrer"
				>Fathom Analytics</a
			>
			to count page visits and a few anonymous actions, like "a scan finished" or "a list was created".
			Fathom doesn't use cookies and doesn't collect personal data. TidySky never sends it your handle,
			your follows, or anything from your Bluesky account. If your browser sends Do Not Track, nothing
			is counted.
		</p>
	</section>

	<section class="card">
		<h2>What TidySky asks permission to do</h2>
		<p>
			When you sign in, Bluesky asks you to approve these permissions. Each one is below in everyday
			words, followed by the technical name Bluesky sees.
		</p>
		<ul class="scopes">
			{#each scopeNotes as s (s.scope)}
				<li>
					<p>{s.words}</p>
					<code>{s.scope}</code>
				</li>
			{/each}
		</ul>
	</section>

	<section class="card">
		<h2>What it never does</h2>
		<ul>
			<li>Post, like, reply or quote for you.</li>
			<li>Follow anyone new.</li>
			<li>
				Read anything about accounts you don't follow, except the public profiles of
				<strong>your 300 most recent followers</strong> for the "Who follows you" card.
			</li>
			<li>Run when you aren't using it. There's no background process and no server.</li>
		</ul>
	</section>

	<section class="card">
		<h2>Good to know</h2>
		<ul>
			<li>
				Lists you create are public on Bluesky. Anyone can find them and see who's on them, the same
				as any list made in the Bluesky app.
			</li>
			<li>
				Looking a handle up at sign-in goes through {HANDLE_RESOLVER}. That's the standard Bluesky
				server, used only to find your account.
			</li>
			<li>
				Muting hides accounts from your timeline on Bluesky; TidySky can mute and unmute, and every
				mute is logged locally so you can undo it.
			</li>
			<li>
				Your sign-in is kept in this browser by Bluesky's sign-in library, and removed when you sign
				out.
			</li>
			<li>
				Signing out doesn't delete your scan. To remove everything from this device, use Settings →
				Delete all TidySky data. Do that on shared computers.
			</li>
			<li>
				Our host, Amazon CloudFront, receives your IP address and standard request details in order
				to deliver pages. TidySky doesn't turn on access logging.
			</li>
		</ul>
	</section>

	<section class="card">
		<h2>Deleting everything</h2>
		<p>
			In TidySky, go to Settings → Delete all TidySky data on this device. That removes the scan,
			lists, snapshots and history from your browser.
		</p>
		<p>
			To stop TidySky from acting on your account at all, revoke its access on your Bluesky server's
			account page. For accounts hosted by Bluesky, that's
			<a href="https://bsky.social/account" target="_blank" rel="external noopener noreferrer"
				>bsky.social/account</a
			>, where TidySky is listed under your approved apps with a Revoke access button. It can take
			up to an hour for TidySky to stop working after you revoke it. To stop it right away on this
			device, also sign out.
		</p>
	</section>

	<section class="card">
		<h2>Contact</h2>
		<p><a href="mailto:root@nate.id">root@nate.id</a></p>
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

	.scopes {
		list-style: none;
		padding: 0;
		display: grid;
		gap: var(--space-sm);
	}

	.scopes p {
		margin: 0 0 4px;
	}

	.scopes code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		word-break: break-all;
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
