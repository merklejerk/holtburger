<script lang="ts">
	import { untrack, type Snippet } from "svelte";
	import { uiLocalSize } from "../theme/ui-scale";
	import LayoutHandleIcon from "../ui/LayoutHandleIcon.svelte";
	import type { HudPlacement, HudViewport } from "./hud-geometry";
	import { hudTrayOrientation, rotateHudTray } from "./hud-tray-layout";
	import HudPanel from "./HudPanel.svelte";

	interface Props {
		/** Accessible name for the tray and its layout controls. */
		readonly label: string;
		/** Fixed dimensions and saved viewport anchor. */
		readonly placement: HudPlacement;
		/** Additional long-axis gaps excluded from the placement's nominal dimensions. */
		readonly gapCount: number;
		readonly editable: boolean;
		readonly viewport: HudViewport;
		readonly onPlacementChange: (placement: HudPlacement) => void;
		readonly children: Snippet;
	}
	const {
		label,
		placement,
		gapCount,
		editable,
		viewport,
		onPlacementChange,
		children,
	}: Props = $props();
	const orientation = $derived(hudTrayOrientation(placement));
	let dimensions = $state(
		untrack(() => ({
			width: placement.preferredWidth,
			height: placement.preferredHeight,
			constrained: false,
		})),
	);
	const scaledPlacement = $derived({
		...placement,
		preferredWidth: dimensions.width,
		preferredHeight: dimensions.height,
	});
	function measureDimensions(node: HTMLElement) {
		const viewportNode = node.parentElement;
		if (viewportNode === null) throw new Error("Missing HUD tray viewport");
		const update = () => {
			const { width, height } = uiLocalSize(node);
			if (width <= 0 || height <= 0)
				throw new Error("Invalid HUD tray dimensions");
			const available = uiLocalSize(viewportNode);
			dimensions = {
				width: Math.ceil(width),
				height: Math.ceil(height),
				constrained: width > available.width || height > available.height,
			};
		};
		update();
		let frame: number | null = null;
		const observer = new ResizeObserver(() => {
			if (frame !== null) return;
			frame = requestAnimationFrame(() => {
				frame = null;
				update();
			});
		});
		observer.observe(node);
		observer.observe(viewportNode);
		return {
			destroy: () => {
				observer.disconnect();
				if (frame !== null) cancelAnimationFrame(frame);
			},
		};
	}
</script>

<HudPanel
	{label}
	placement={scaledPlacement}
	{editable}
	{viewport}
	minWidth={dimensions.width}
	minHeight={dimensions.height}
	resizable={false}
	contentHitTesting="descendants"
	onPlacementChange={(next) =>
		onPlacementChange({
			...next,
			preferredWidth: placement.preferredWidth,
			preferredHeight: placement.preferredHeight,
		})}
>
	<div class="tray-scroll" class:constrained={dimensions.constrained}>
		<div
			class="hud-tray"
			style:width={`calc(${placement.preferredWidth}px + ${orientation === "horizontal" ? gapCount : 0} * var(--ui-hud-icon-gap))`}
			style:height={`calc(${placement.preferredHeight}px + ${orientation === "vertical" ? gapCount : 0} * var(--ui-hud-icon-gap))`}
			use:measureDimensions
			class:vertical={orientation === "vertical"}
		>
			{@render children()}
		</div>
	</div>
	{#if editable}
		<button
			type="button"
			class="rotate-button ui-button ui-icon-button"
			class:vertical={orientation === "vertical"}
			aria-label={`Rotate ${label.toLowerCase()}`}
			title={`Rotate ${label.toLowerCase()}`}
			onclick={(event) => {
				event.stopPropagation();
				onPlacementChange(rotateHudTray(placement));
			}}><LayoutHandleIcon action="rotate" /></button
		>
	{/if}
</HudPanel>

<style>
	@layer components {
		.tray-scroll {
			width: 100%;
			height: 100%;
		}
		.tray-scroll.constrained {
			overflow: auto;
			pointer-events: auto;
		}
		.hud-tray {
			box-sizing: border-box;
			display: flex;
			align-items: center;
			gap: var(--ui-hud-icon-gap);
			position: relative;
			width: 100%;
			height: 100%;
		}
		.hud-tray.vertical {
			flex-direction: column;
		}
		.rotate-button {
			position: absolute;
			z-index: 2;
			right: 2px;
			top: 5px;
			width: 22px;
			height: 22px;
			pointer-events: auto;
		}
		.rotate-button.vertical {
			right: 5px;
			top: auto;
			bottom: 2px;
		}
	}
</style>
