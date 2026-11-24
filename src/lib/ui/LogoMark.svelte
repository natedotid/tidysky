<script lang="ts">
	interface Props {
		/** Icon edge length in px. */
		size?: number;
	}

	let { size = 32 }: Props = $props();

	// The happy face only reads at 28px and up; below that the eyes and smile
	// blur into speckles, so small marks stay plain (like the favicon).
	const withFace = $derived(size >= 28);
</script>

<!--
	The brand mark. Its colors are part of the artwork (navy tile, white cloud,
	apricot strand), not UI theming, so they stay fixed in both themes.
-->
<svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="TidySky">
	<rect width="100" height="100" rx="26" fill="#14213D" />
	<g fill="#FFFFFF">
		<circle cx="40" cy="44" r="10" />
		<circle cx="57" cy="40" r="15" />
		<circle cx="72" cy="47" r="8" />
		<rect x="36" y="42" width="38" height="16" />
	</g>
	{#if withFace}
		<g fill="none" stroke="#14213D" stroke-width="2.6" stroke-linecap="round">
			<path d="M47 45 Q50 42 53 45" />
			<path d="M60 45 Q63 42 66 45" />
			<path d="M54 49.5 Q56.5 52 59 49.5" />
		</g>
		<g fill="#FFB86B" fill-opacity="0.85">
			<circle cx="45" cy="50" r="2.2" />
			<circle cx="68" cy="50" r="2.2" />
		</g>
	{/if}
	<g fill="none" stroke-width="6" stroke-linecap="round">
		<path d="M28 58 H80" stroke="#FFFFFF" />
		<path d="M22 68 H72" stroke="#FFFFFF" />
		<path d="M32 78 H66" stroke="#FFB86B" />
	</g>
</svg>
