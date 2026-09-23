<script lang="ts">
	/** Layout operation represented by this decorative icon; the button owns its label. */
	let { action }: { action: "move" | "resize" | "shape" | "rotate" } = $props();
</script>

<svg viewBox="0 0 12 12" aria-hidden="true">
	{#if action === "move"}
		<path
			d="M 6 1 V 11 M 1 6 H 11 M 6 1 L 4.5 2.5 M 6 1 L 7.5 2.5 M 6 11 L 4.5 9.5 M 6 11 L 7.5 9.5 M 1 6 L 2.5 4.5 M 1 6 L 2.5 7.5 M 11 6 L 9.5 4.5 M 11 6 L 9.5 7.5"
		/>
	{:else if action === "shape"}
		<path d="M 1 1 H 11 V 11 H 1 Z M 1 6 H 11 M 6 1 V 11" />
	{:else if action === "rotate"}
		<path d="M 10 5 A 4 4 0 1 0 10 8 M 10 2 V 5 H 7" />
	{:else}
		<path d="M 10 10 L 2 2 M 10 10 V 7 M 10 10 H 7 M 2 2 H 5 M 2 2 V 5" />
	{/if}
</svg>

<style>
	@layer components {
		svg {
			display: block;
			width: 12px;
			height: 12px;
			fill: none;
			stroke: currentcolor;
			stroke-linecap: round;
			stroke-linejoin: round;
			stroke-width: 1.35;
			pointer-events: none;
		}
	}
</style>
