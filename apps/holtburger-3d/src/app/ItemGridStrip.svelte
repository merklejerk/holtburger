<script lang="ts">
	import { onMount, type Snippet } from "svelte";

	interface Props {
		/** Rows supplied by the consuming UI; scrolling advances by one row. */
		readonly children: Snippet;
		/** Axis belongs to the consuming panel; inventory stays vertical. */
		readonly orientation?: "vertical" | "horizontal";
	}
	const { children, orientation = "vertical" }: Props = $props();
	let viewport = $state<HTMLDivElement | null>(null);
	let cells = $state<HTMLDivElement | null>(null);
	let canScrollBack = $state(false);
	let canScrollForward = $state(false);

	function updateEdges(): void {
		if (viewport === null) return;
		const offset =
			orientation === "horizontal" ? viewport.scrollLeft : viewport.scrollTop;
		const size =
			orientation === "horizontal"
				? viewport.clientWidth
				: viewport.clientHeight;
		const extent =
			orientation === "horizontal"
				? viewport.scrollWidth
				: viewport.scrollHeight;
		canScrollBack = offset > 0;
		canScrollForward = offset + size < extent - 1;
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
				orientation === "horizontal"
					? direction === "up"
						? rect.left - bounds.left
						: rect.right - bounds.right
					: direction === "up"
						? rect.top - bounds.top
						: rect.bottom - bounds.bottom;
			if (direction === "up" ? distance < -1 : distance > 1) {
				if (orientation === "horizontal") viewport.scrollLeft += distance;
				else viewport.scrollTop += distance;
				updateEdges();
				return;
			}
		}
	}
</script>

<div class="item-grid-strip" class:horizontal={orientation === "horizontal"}>
	<div
		class="item-grid-strip-viewport"
		bind:this={viewport}
		onscroll={updateEdges}
	>
		<div class="item-grid-strip-cells" bind:this={cells}>
			{@render children()}
		</div>
	</div>
	{#if canScrollBack}
		<button
			class="strip-arrow strip-arrow-up ui-item-strip-arrow ui-hud-button"
			type="button"
			aria-label={orientation === "horizontal"
				? "Scroll items left"
				: "Scroll items up"}
			onclick={() => scrollCell("up")}
			><span class="strip-arrow-glyph strip-arrow-glyph-up" aria-hidden="true"
			></span></button
		>
	{/if}
	{#if canScrollForward}
		<button
			class="strip-arrow strip-arrow-down ui-item-strip-arrow ui-hud-button"
			type="button"
			aria-label={orientation === "horizontal"
				? "Scroll items right"
				: "Scroll items down"}
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
			box-sizing: border-box;
			/* Share the grid cell basis; the owning panel adds its own divider. */
			width: var(
				--ui-item-strip-width,
				calc(var(--ui-item-cell-min-size) + 2 * var(--ui-item-strip-inset))
			);
			height: 100%;
			min-height: 0;
			/* Outside the scroll viewport so the end spacing survives scrolling. */
			padding-block: var(--ui-item-strip-block-inset);
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
			top: var(--ui-item-strip-block-inset);
		}
		.strip-arrow-down {
			bottom: var(--ui-item-strip-block-inset);
		}
		.horizontal {
			width: 100%;
			height: auto;
			padding: var(--ui-item-strip-inset);
		}
		.horizontal .item-grid-strip-viewport {
			overflow-x: auto;
			overflow-y: hidden;
			padding: 0;
		}
		.horizontal .item-grid-strip-cells {
			grid-auto-flow: column;
			grid-auto-columns: var(--ui-item-cell-min-size);
			grid-template-columns: none;
			width: max-content;
			min-width: 100%;
		}
		.horizontal .strip-arrow {
			top: var(--ui-item-strip-inset);
			bottom: var(--ui-item-strip-inset);
			height: auto;
			width: var(--ui-item-strip-arrow-height);
		}
		.horizontal .strip-arrow-up {
			left: var(--ui-item-strip-inset);
			right: auto;
		}
		.horizontal .strip-arrow-down {
			right: var(--ui-item-strip-inset);
			left: auto;
		}
		.horizontal .strip-arrow-glyph {
			display: inline-block;
			transform: rotate(-90deg);
		}
	}
</style>
