<script lang="ts">
	import { onMount, type Snippet } from "svelte";

	interface Props {
		/** Square grid cells supplied by the consuming UI. */
		readonly children: Snippet;
	}
	const { children }: Props = $props();
	let viewport = $state<HTMLDivElement | null>(null);
	let cells = $state<HTMLDivElement | null>(null);
	let canScrollUp = $state(false);
	let canScrollDown = $state(false);

	function updateEdges(): void {
		if (viewport === null) return;
		canScrollUp = viewport.scrollTop > 0;
		canScrollDown =
			viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;
	}

	onMount(() => {
		if (viewport === null || cells === null)
			throw new Error("Item strip did not mount its scroll elements.");
		// Both resizing the viewport and changing the number of cells can change overflow.
		const observer = new ResizeObserver(updateEdges);
		observer.observe(viewport);
		observer.observe(cells);
		updateEdges();
		return () => observer.disconnect();
	});

	function scrollCell(direction: "up" | "down"): void {
		if (viewport === null || cells === null) return;
		const bounds = viewport.getBoundingClientRect();
		const candidates = Array.from(cells.children);
		if (direction === "up") candidates.reverse();
		// Choose the nearest cell extending beyond the requested edge, including a clipped cell.
		for (const cell of candidates) {
			const rect = cell.getBoundingClientRect();
			const distance =
				direction === "up"
					? rect.top - bounds.top
					: rect.bottom - bounds.bottom;
			if (direction === "up" ? distance < -1 : distance > 1) {
				viewport.scrollTop += distance;
				updateEdges();
				return;
			}
		}
	}
</script>

<div class="item-grid-strip">
	<div
		class="item-grid-strip-viewport"
		bind:this={viewport}
		onscroll={updateEdges}
	>
		<div class="item-grid-strip-cells" bind:this={cells}>
			{@render children()}
		</div>
	</div>
	{#if canScrollUp}
		<button
			class="strip-arrow strip-arrow-up ui-item-strip-arrow ui-hud-button"
			type="button"
			aria-label="Scroll items up"
			onclick={() => scrollCell("up")}
			><span class="strip-arrow-glyph strip-arrow-glyph-up" aria-hidden="true"
			></span></button
		>
	{/if}
	{#if canScrollDown}
		<button
			class="strip-arrow strip-arrow-down ui-item-strip-arrow ui-hud-button"
			type="button"
			aria-label="Scroll items down"
			onclick={() => scrollCell("down")}
			><span class="strip-arrow-glyph strip-arrow-glyph-down" aria-hidden="true"
			></span></button
		>
	{/if}
</div>

<style>
	@layer components {
		.item-grid-strip {
			position: relative;
			/* Share the grid cell basis; the owning panel adds its own divider. */
			width: calc(
				var(--ui-item-cell-min-size) + 2 * var(--ui-item-strip-inset)
			);
			height: 100%;
			min-height: 0;
		}
		.item-grid-strip-viewport {
			height: 100%;
			overflow-y: auto;
			overflow-x: hidden;
			scrollbar-width: none;
			padding: 0 var(--ui-item-strip-inset);
		}
		.item-grid-strip-viewport::-webkit-scrollbar {
			display: none;
		}
		.item-grid-strip-cells {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
			gap: var(--ui-item-grid-gap);
		}
		.strip-arrow {
			position: absolute;
			z-index: 1;
			left: var(--ui-item-strip-inset);
			right: var(--ui-item-strip-inset);
			height: var(--ui-item-strip-arrow-height);
			padding: 0;
			line-height: 1;
		}
		.strip-arrow-glyph-up::before {
			content: var(--ui-item-strip-up-glyph);
		}
		.strip-arrow-glyph-down::before {
			content: var(--ui-item-strip-down-glyph);
		}
		.strip-arrow-up {
			top: 0;
		}
		.strip-arrow-down {
			bottom: 0;
		}
	}
</style>
