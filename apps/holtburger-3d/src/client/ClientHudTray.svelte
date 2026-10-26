<script lang="ts">
	import { untrack, type Snippet } from "svelte";
	import LayoutHandleIcon from "../app/LayoutHandleIcon.svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import { rotateHudTray, hudTrayOrientation } from "./client-hud-tray-layout";

	interface Props {
		/** Accessible name for the tray and its layout controls. */
		readonly label: string;
		/** Fixed dimensions and saved viewport anchor. */
		readonly placement: ClientHudPlacement;
		/** Additional long-axis gaps excluded from the placement's nominal dimensions. */
		readonly gapCount: number;
		readonly editable: boolean;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
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
	// Resolve CSS at the consumer so theme overrides and the saved anchor stay independent.
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
			const { width, height } = node.getBoundingClientRect();
			if (width <= 0 || height <= 0)
				throw new Error("Invalid HUD tray dimensions");
			// Hover artwork may paint beyond the tray; only fitted geometry should enable scrolling.
			const available = viewportNode.getBoundingClientRect();
			dimensions = {
				// Fractional display scales can round a measured length down on CSS reassignment.
				// Reserve whole CSS pixels outward so the panel always contains its natural tray.
				width: Math.ceil(width),
				height: Math.ceil(height),
				constrained: width > available.width || height > available.height,
			};
		};
		update();
		// Publishing the natural extent resizes our ancestor. Defer that feedback outside RO delivery.
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

<ClientHudPanel
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
			style:width={`calc((${placement.preferredWidth}px + ${orientation === "horizontal" ? gapCount : 0} * var(--ui-hud-icon-gap)) * var(--ui-icon-scale))`}
			style:height={`calc((${placement.preferredHeight}px + ${orientation === "vertical" ? gapCount : 0} * var(--ui-hud-icon-gap)) * var(--ui-icon-scale))`}
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
</ClientHudPanel>

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
			gap: calc(var(--ui-hud-icon-gap) * var(--ui-icon-scale));
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
