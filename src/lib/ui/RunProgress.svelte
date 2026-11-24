<script lang="ts">
	/**
	 * The live view of an unfollow run: a progress bar, the count,
	 * Pause/Resume and Stop, and a growing list of failures.
	 * Presentational: the ReviewSheet owns the run and passes everything in.
	 */
	interface Props {
		running: boolean;
		/** What the run does; only the copy differs. */
		verb: 'unfollow' | 'mute' | 'list';
		done: number;
		failed: number;
		total: number;
		cancelled: boolean;
		paused: boolean;
		/** Set when the run stopped for something other than a Stop. */
		error: string | null;
		failures: Array<{ name: string; error: string }>;
		onTogglePause: () => void;
		onStop: () => void;
		onClose: () => void;
	}

	let {
		running,
		verb,
		done,
		failed,
		total,
		cancelled,
		paused,
		error,
		failures,
		onTogglePause,
		onStop,
		onClose
	}: Props = $props();

	const percent = $derived(
		total === 0 ? 0 : Math.min(100, Math.round(((done + failed) / total) * 100))
	);

	const summary = $derived.by((): string => {
		if (error !== null) return `Stopped with an error: ${error}`;
		const past = verb === 'mute' ? 'Muted' : verb === 'list' ? 'Added' : 'Unfollowed';
		const head = running
			? `${past} ${done} of ${total}`
			: `${cancelled ? 'Stopped' : 'Done'}. ${past} ${done}.`;
		const tail = failed > 0 ? ` ${failed} failed (see below).` : '';
		// Built here, not in the markup: Svelte trims the whitespace an
		// inline {#if} would need around "· Paused".
		return running && paused ? `${head}${tail} · Paused` : `${head}${tail}`;
	});
</script>

<div class="run">
	<div
		class="bar"
		role="progressbar"
		aria-valuemin={0}
		aria-valuemax={total}
		aria-valuenow={done + failed}
	>
		<div class="fill" style={`width: ${percent}%`}></div>
	</div>
	<p class="status" role="status">{summary}</p>

	<div class="controls">
		{#if running}
			<button type="button" onclick={onTogglePause}>{paused ? 'Resume' : 'Pause'}</button>
			<button type="button" class="stop" onclick={onStop}>Stop</button>
		{:else}
			<button type="button" class="primary" onclick={onClose}>Close</button>
		{/if}
	</div>

	{#if failures.length > 0}
		<h3>Failed</h3>
		<ul class="fails">
			{#each failures as f (f.name + '‖' + f.error)}
				<li>
					<span class="name">{f.name}</span>
					<span class="err">{f.error}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.run {
		display: grid;
		gap: var(--space-md);
	}

	.bar {
		height: 10px;
		border-radius: var(--radius-pill);
		background: var(--color-surface-2);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: var(--radius-pill);
		background: var(--color-accent);
		transition: width 200ms ease;
	}

	.status {
		margin: 0;
		font-size: var(--text-sm);
	}

	.controls {
		display: flex;
		gap: var(--space-xs);
	}
	.controls button {
		flex: 1;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		border-radius: var(--radius-md);
		padding: 8px 12px;
		min-height: var(--tap);
		cursor: pointer;
	}
	.controls button.stop {
		color: var(--color-danger);
		border-color: var(--color-danger);
	}
	.controls button.primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-on-primary);
	}

	h3 {
		margin: 0 0 var(--space-xs);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.fails {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-xs);
	}
	.fails li {
		display: flex;
		align-items: baseline;
		gap: var(--space-sm);
		font-size: var(--text-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-xs) var(--space-sm);
	}
	.fails .name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.fails .err {
		color: var(--color-danger);
		font-size: var(--text-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
