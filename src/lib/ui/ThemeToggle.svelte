<script lang="ts">
	import { loadTheme, resolveTheme, saveTheme, type Theme } from '#lib/theme';

	const OPTIONS: Array<{ value: Theme; label: string }> = [
		{ value: 'system', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];

	let theme = $state<Theme>(loadTheme());

	/** Apply a resolved theme to <html> and keep the theme-color meta in step. */
	function apply(theme: Theme): void {
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const resolved = resolveTheme(theme, prefersDark);
		document.documentElement.dataset.theme = resolved;
		const meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0E1420' : '#FAF8F4');
	}

	function change(next: Theme): void {
		theme = next;
		saveTheme(next);
		apply(next);
	}
</script>

<fieldset class="theme-toggle">
	<legend>Theme</legend>
	{#each OPTIONS as option (option.value)}
		<label class="option">
			<input
				type="radio"
				name="theme"
				value={option.value}
				bind:group={theme}
				onchange={() => change(theme)}
			/>
			{option.label}
		</label>
	{/each}
</fieldset>

<style>
	.theme-toggle {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-sm);
		margin: 0;
		padding: 0;
		border: 0;
	}

	.theme-toggle legend {
		font-weight: 600;
		margin-bottom: var(--space-sm);
		padding: 0;
	}

	.option {
		display: inline-flex;
		align-items: center;
		gap: var(--space-sm);
		min-height: var(--tap);
		padding: 0 var(--space-sm);
		cursor: pointer;
	}

	.option input {
		width: 20px;
		height: 20px;
		margin: 0;
		accent-color: var(--color-primary);
	}
</style>
