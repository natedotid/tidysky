<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/** True when the current URL is this tab or anything nested under it. */
	function current(href: string): boolean {
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}
</script>

<!-- Icons are decorative; the text label next to each one carries the meaning. -->
<nav class="tabbar" aria-label="Main">
	<a
		href={resolve('/insights')}
		class="tab"
		class:active={current('/insights')}
		aria-current={current('/insights') ? 'page' : undefined}
	>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<path d="M5 20v-6M12 20V8M19 20v-9M3 20h18" />
		</svg>
		<span>Insights</span>
	</a>

	<a
		href={resolve('/cleanup')}
		class="tab"
		class:active={current('/cleanup')}
		aria-current={current('/cleanup') ? 'page' : undefined}
	>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="9" cy="8" r="4" />
			<path d="M2 21c0-3.9 3.1-7 7-7" />
			<path d="M15 17h7" />
		</svg>
		<span>Clean up</span>
	</a>

	<a
		href={resolve('/lists')}
		class="tab"
		class:active={current('/lists')}
		aria-current={current('/lists') ? 'page' : undefined}
	>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<path d="M9 6h12M9 12h12M9 18h12" />
			<circle cx="4.5" cy="6" r="1.5" fill="currentColor" stroke="none" />
			<circle cx="4.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
			<circle cx="4.5" cy="18" r="1.5" fill="currentColor" stroke="none" />
		</svg>
		<span>Lists</span>
	</a>

	<a
		href={resolve('/settings')}
		class="tab"
		class:active={current('/settings')}
		aria-current={current('/settings') ? 'page' : undefined}
	>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<path d="M21 4h-7M8 4H3M21 12h-4M10 12H3M21 20h-5M12 20H3" />
			<path d="M14 2v4M10 10v4M16 18v4" />
		</svg>
		<span>Settings</span>
	</a>
</nav>

<style>
	.tabbar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		height: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
		padding-bottom: env(safe-area-inset-bottom);
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		background: var(--color-surface);
		border-top: 1px solid var(--color-border);
		/* Above the selection bar (z-index: 10); modal sheets stay on top (top layer). */
		z-index: 20;
	}

	.tab {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		min-height: var(--tap);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		text-decoration: none;
	}

	.tab svg {
		width: 24px;
		height: 24px;
	}

	.tab.active {
		color: var(--color-text);
	}

	.tab.active::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: var(--color-accent);
	}
</style>
