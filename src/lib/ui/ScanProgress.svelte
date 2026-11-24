<script lang="ts">
	import { relativeTime } from '#lib/time';
	import type { ScanProgress } from '#lib/scan/scan';

	interface Props {
		progress: ScanProgress | null;
		running: boolean;
		etaMs: number | null;
		followTotal: number;
		lastFinishedAt: string | null;
		stoppedPhase: ScanProgress['phase'] | null;
		onStop: () => void;
		onRescan: () => void;
	}

	let {
		progress,
		running,
		etaMs,
		followTotal,
		lastFinishedAt,
		stoppedPhase,
		onStop,
		onRescan
	}: Props = $props();

	const STEPS = [
		'Finding who you follow',
		'Reading profiles',
		'Checking recent activity',
		'Checking your interactions'
	] as const;

	const PHASE_STEP: Record<ScanProgress['phase'], number> = {
		follows: 0,
		profiles: 1,
		activity: 2,
		interactions: 3,
		saving: 4,
		done: 4,
		cancelled: 4,
		error: 4
	};

	/** The step the scan is on, or stopped at: 0-3, or 4 when fully done. */
	const stepIndex = $derived.by((): number => {
		if (progress === null) return 0;
		if (progress.phase === 'done' || progress.phase === 'saving') return 4;
		if (progress.phase === 'cancelled' || progress.phase === 'error') {
			return stoppedPhase === null ? 4 : PHASE_STEP[stoppedPhase];
		}
		return PHASE_STEP[progress.phase];
	});

	function stepState(i: number): 'done' | 'current' | 'pending' {
		if (progress === null) return 'pending';
		if (i < stepIndex) return 'done';
		return i === stepIndex ? 'current' : 'pending';
	}

	// The bar only makes sense once a phase has a known total.
	const inBarPhase = $derived(
		running && progress !== null && (progress.phase === 'profiles' || progress.phase === 'activity')
	);
	const barTotal = $derived(inBarPhase && progress !== null ? progress.total : 0);
	const barDone = $derived(
		inBarPhase && progress !== null ? Math.min(progress.done, progress.total) : 0
	);
	const barPct = $derived(barTotal > 0 ? (barDone / barTotal) * 100 : 0);
	const barLabel = $derived(
		inBarPhase && progress !== null
			? `${STEPS[PHASE_STEP[progress.phase]]}: ${barDone} of ${barTotal}`
			: ''
	);

	// "About N minutes left", with the singular when N is 1.
	const minutes = (ms: number): string => {
		const n = Math.max(1, Math.round(ms / 60_000));
		return n === 1 ? '1 minute' : `${n} minutes`;
	};
	const etaText = $derived(etaMs === null ? null : `About ${minutes(etaMs)} left`);

	/** The one-time heads-up for very large follow counts, while profiles run. */
	const headsUp = $derived.by((): { count: number; minutes: string } | null => {
		if (!running || progress?.phase !== 'profiles' || followTotal <= 3000 || etaMs === null)
			return null;
		return { count: followTotal, minutes: minutes(etaMs) };
	});

	// "Last scanned" ages while the page stays open; refresh it every minute.
	let now = $state(new Date());
	$effect(() => {
		if (running || lastFinishedAt === null) return;
		const id = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(id);
	});
	const lastScannedText = $derived(
		lastFinishedAt !== null ? relativeTime(lastFinishedAt, now) : null
	);
</script>

<section class="scan" aria-label="Scan status">
	{#if progress === null}
		<p class="waiting" role="status">Starting your scan…</p>
	{:else}
		<ul class="steps">
			{#each STEPS as label, i (label)}
				{@const state = stepState(i)}
				<li class="step" class:done={state === 'done'} class:current={state === 'current'}>
					<span class="mark" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
					<span class="label">{label}</span>
					{#if state === 'current' && barTotal > 0}
						<span class="num count">{barDone} / {barTotal}</span>
					{:else if state === 'current' && progress !== null && progress.phase === 'interactions'}
						<span class="num count">{progress.done.toLocaleString()} read</span>
					{/if}
				</li>
			{/each}
		</ul>

		{#if barTotal > 0}
			<div
				class="bar"
				role="progressbar"
				aria-label={barLabel}
				aria-valuemin="0"
				aria-valuemax={barTotal}
				aria-valuenow={barDone}
			>
				<div class="fill" style={`width: ${barPct}%`}></div>
			</div>
			{#if etaText}
				<p class="eta">{etaText}</p>
			{/if}
		{/if}

		{#if headsUp}
			<p class="heads-up">
				You follow <span class="num">{headsUp.count.toLocaleString()}</span> accounts. Checking them
				all takes about <span class="num">{headsUp.minutes}</span> minutes. You can use the app while
				it runs.
			</p>
		{/if}

		{#if running}
			<div class="actions">
				<button type="button" class="btn-secondary" onclick={onStop}>Stop</button>
			</div>
		{:else if progress.phase === 'cancelled'}
			<p class="stopped">
				Stopped. You can use what's scanned so far, and Rescan picks up where it left off.
			</p>
			<div class="actions">
				<button type="button" class="btn-primary" onclick={onRescan}>Rescan</button>
			</div>
		{:else if progress.phase === 'error'}
			<p class="error" role="alert">{progress.message ?? 'The scan hit a problem.'}</p>
			<div class="actions">
				<button type="button" class="btn-primary" onclick={onRescan}>Try again</button>
			</div>
		{:else}
			{#if lastScannedText}
				<p class="last">Last scanned {lastScannedText}</p>
			{/if}
			<div class="actions">
				<button type="button" class="btn-secondary" onclick={onRescan}>Rescan</button>
			</div>
		{/if}
	{/if}
</section>

<style>
	.scan {
		display: grid;
		gap: var(--space-md);
		margin-bottom: var(--space-lg);
		/* The section starts as a one-line "Starting your scan…" and grows to
			the full step list + bar + "about N minutes left". Reserve the
			grown height (241 px at 375, four steps) so the compact state
			doesn't shift everything below it (CLS). */
		min-height: 245px;
	}

	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-sm);
	}

	.step {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		color: var(--color-text-muted);
	}

	.step.current {
		color: var(--color-text);
		font-weight: 600;
	}

	.mark {
		flex: none;
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.step.done .mark {
		background: var(--color-success);
		border-color: var(--color-success);
		color: var(--color-bg);
	}

	.count {
		margin-left: auto;
		font-size: var(--text-sm);
	}

	.bar {
		height: 8px;
		border-radius: var(--radius-pill);
		background: var(--color-surface-2);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--color-accent);
		transition: width 0.25s ease;
	}

	.waiting,
	.eta,
	.stopped,
	.last {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.heads-up {
		margin: 0;
		padding: var(--space-sm) var(--space-md);
		background: var(--color-surface-2);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}

	.error {
		margin: 0;
		color: var(--color-danger);
		font-size: var(--text-sm);
	}

	.actions {
		display: flex;
	}

	.actions button {
		width: 100%;
		max-width: 220px;
	}

	@media (prefers-reduced-motion: reduce) {
		.fill {
			transition: none;
		}
	}
</style>
