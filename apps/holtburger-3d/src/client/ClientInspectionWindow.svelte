<script lang="ts">
	import { onDestroy } from "svelte";
	import type { UiIconRepository } from "../app/ui-icon-repository";
	import { trackPointerGesture } from "../app/pointer-gesture";
	import ClientCreatureInspection from "./ClientCreatureInspection.svelte";
	import ClientCreaturePreview from "./ClientCreaturePreview.svelte";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import ClientItemInspection from "./ClientItemInspection.svelte";
	import type { ClientSpellServices } from "./client-spells";
	import type { ObjectInspection } from "./client-object-inspection-contract";
	import type { ClientObjectPreviewState } from "./client-object-inspection";
	import type { ClientObjectPreviewService } from "./client-object-preview-service";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import { CLIENT_TUNING } from "./client-tuning";
	import {
		formatInspectionNumber,
		humanizeInspectionName,
	} from "./client-object-inspection-format";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";

	interface Props {
		readonly inspection: ObjectInspection;
		readonly preview: ClientObjectPreviewState | null;
		readonly objectPreviewService: ClientObjectPreviewService;
		readonly spells: ClientSpellServices | null;
		readonly icons: UiIconRepository | null;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly onClose: () => void;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
	}
	const {
		inspection,
		preview,
		objectPreviewService,
		spells,
		icons,
		placement,
		viewport,
		onClose,
		onPlacementChange,
	}: Props = $props();
	const previewHeightTuning = CLIENT_TUNING.objectPreview.height;
	let previewHeight: number = $state(previewHeightTuning.initial);
	let cancelPreviewResize: (() => void) | null = null;

	onDestroy(() => cancelPreviewResize?.());

	function setPreviewHeight(height: number): void {
		previewHeight = Math.max(
			previewHeightTuning.minimum,
			Math.min(previewHeightTuning.maximum, height),
		);
	}

	function beginPreviewResize(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const startY = event.clientY;
		const startHeight = previewHeight;
		cancelPreviewResize?.();
		cancelPreviewResize = trackPointerGesture(
			window,
			event.pointerId,
			(moved) => setPreviewHeight(startHeight + moved.clientY - startY),
		);
	}

	function resizePreviewWithKeyboard(event: KeyboardEvent): void {
		let height: number;
		if (event.key === "ArrowUp")
			height = previewHeight - previewHeightTuning.keyboardStep;
		else if (event.key === "ArrowDown")
			height = previewHeight + previewHeightTuning.keyboardStep;
		else if (event.key === "Home") height = previewHeightTuning.minimum;
		else if (event.key === "End") height = previewHeightTuning.maximum;
		else return;
		event.preventDefault();
		event.stopPropagation();
		setPreviewHeight(height);
	}
</script>

<ClientHudWindow
	icon="examine"
	title={inspection.name}
	{placement}
	{viewport}
	{onClose}
	{onPlacementChange}
	minWidth={CLIENT_UI_DEFAULTS.inspection.minSize.width}
	minHeight={CLIENT_UI_DEFAULTS.inspection.minSize.height}
>
	{#if inspection.details.kind === "item"}
		<div class="inspection-scroll">
			<ClientItemInspection
				{inspection}
				item={inspection.details.details}
				{spells}
				{icons}
			/>
		</div>
	{:else}
		<div
			class="inspection-creature-layout"
			style:grid-template-rows={`${previewHeight}px minmax(0, 1fr)`}
		>
			<div class="inspection-preview-pane">
				<header class="inspection-preview-identity">
					<h2>{inspection.name}</h2>
					{#if inspection.level !== null || inspection.details.details.creatureType !== null}
						<p>
							{inspection.level === null
								? ""
								: `Level ${formatInspectionNumber(inspection.level)}`}{inspection.level !==
								null && inspection.details.details.creatureType !== null
								? " · "
								: ""}{inspection.details.details.creatureType === null
								? ""
								: humanizeInspectionName(
										inspection.details.details.creatureType,
									)}
						</p>
					{/if}
				</header>
				{#if preview?.kind === "ready"}
					{#key preview.revision}
						<ClientCreaturePreview
							source={preview.source}
							service={objectPreviewService}
						/>
					{/key}
				{:else}
					<div class="inspection-preview-fallback" role="status">
						<span aria-hidden="true">◆</span>
						{preview?.kind === "pending"
							? "Preparing model…"
							: "Model preview unavailable"}
					</div>
				{/if}
				<div
					class="inspection-preview-resize"
					role="slider"
					tabindex="0"
					aria-label="Creature preview height"
					aria-orientation="vertical"
					aria-valuemin={previewHeightTuning.minimum}
					aria-valuemax={previewHeightTuning.maximum}
					aria-valuenow={previewHeight}
					onpointerdown={beginPreviewResize}
					onkeydown={resizePreviewWithKeyboard}
				></div>
			</div>
			<div class="inspection-scroll">
				<ClientCreatureInspection
					{inspection}
					creature={inspection.details.details}
				/>
			</div>
		</div>
	{/if}
</ClientHudWindow>

<style>
	@layer components {
		.inspection-scroll {
			height: 100%;
			overflow: auto;
			scrollbar-gutter: stable;
		}
		.inspection-creature-layout {
			display: grid;
			height: 100%;
			min-height: 0;
		}
		.inspection-preview-pane {
			position: relative;
			min-height: 0;
			padding: 8px 8px 4px;
		}
		.inspection-preview-resize {
			position: absolute;
			z-index: 3;
			left: 12px;
			right: 12px;
			bottom: -4px;
			height: 9px;
			padding: 0;
			border: 0;
			background: transparent;
			cursor: ns-resize;
			touch-action: none;
			outline: none;
		}
		.inspection-preview-resize::before {
			position: absolute;
			top: 4px;
			left: 0;
			right: 0;
			height: 1px;
			content: "";
			background: color-mix(in srgb, var(--ui-color-border) 70%, transparent);
		}
		.inspection-preview-resize::after {
			position: absolute;
			top: 4px;
			left: 50%;
			width: 28px;
			height: 6px;
			content: "";
			transform: translateX(-50%);
			background: var(--ui-color-border);
			clip-path: polygon(0 0, 100% 0, 50% 100%);
			filter: drop-shadow(0 1px 1px var(--ui-color-shadow));
		}
		.inspection-preview-resize:hover::before,
		.inspection-preview-resize:focus-visible::before {
			height: 2px;
			background: var(--ui-color-highlight);
		}
		.inspection-preview-resize:hover::after,
		.inspection-preview-resize:focus-visible::after {
			background: var(--ui-color-highlight);
		}
		.inspection-preview-identity {
			position: absolute;
			top: 16px;
			left: 16px;
			z-index: 1;
			max-width: calc(100% - 32px);
			pointer-events: none;
			text-shadow:
				0 1px 2px var(--ui-color-shadow),
				0 0 6px var(--ui-color-shadow);
		}
		.inspection-preview-identity h2,
		.inspection-preview-identity p {
			margin: 0;
		}
		.inspection-preview-identity h2 {
			font-size: 1.18rem;
			color: var(--ui-color-highlight);
			overflow-wrap: anywhere;
		}
		.inspection-preview-identity p {
			margin-top: 2px;
			color: var(--ui-color-muted);
			font-size: 0.78rem;
		}
		.inspection-preview-fallback {
			display: grid;
			place-content: center;
			justify-items: center;
			gap: 7px;
			height: 100%;
			border: 1px solid var(--ui-color-border);
			background: var(--ui-color-well);
			color: var(--ui-color-muted);
		}
		.inspection-preview-fallback > span {
			font-size: 1.5rem;
			color: var(--ui-color-danger);
		}
		.inspection-scroll :global(.inspection-body) {
			display: grid;
			gap: 14px;
			padding: 16px;
			line-height: 1.35;
		}
		.inspection-scroll :global(h2),
		.inspection-scroll :global(h3),
		.inspection-scroll :global(p),
		.inspection-scroll :global(dl),
		.inspection-scroll :global(dd),
		.inspection-scroll :global(ul),
		.inspection-scroll :global(blockquote) {
			margin: 0;
		}
		.inspection-scroll :global(h2) {
			font-size: 1.18rem;
			color: var(--ui-color-highlight);
		}
		.inspection-scroll :global(h3) {
			margin-bottom: 7px;
			padding-bottom: 3px;
			border-bottom: 1px solid
				color-mix(in srgb, var(--ui-color-border) 55%, transparent);
			font-size: 0.86rem;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--ui-color-accent);
		}
		.inspection-scroll :global(.inspection-hero) {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			align-items: center;
			gap: 14px;
		}
		.inspection-scroll :global(.inspection-kicker),
		.inspection-scroll :global(.inspection-diagnostic),
		.inspection-scroll :global(.inspection-scribe) {
			color: var(--ui-color-muted);
			font-size: 0.78rem;
		}
		.inspection-scroll :global(.inspection-description) {
			margin-top: 5px;
			white-space: pre-wrap;
		}
		.inspection-scroll :global(.inspection-artwork) {
			display: grid;
			justify-items: center;
			gap: 4px;
			width: 84px;
			text-align: center;
		}
		.inspection-scroll :global(.inspection-artwork-image) {
			display: grid;
			place-items: center;
			width: 64px;
			height: 64px;
			padding: 6px;
			border: 1px solid var(--ui-color-border);
			background: var(--ui-color-well);
			font-size: 1.5rem;
		}
		.inspection-scroll :global(.inspection-warning) {
			color: var(--ui-color-warning);
		}
		.inspection-scroll :global(.inspection-facts),
		.inspection-scroll :global(.inspection-attributes) {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 5px 16px;
		}
		.inspection-scroll :global(.inspection-facts > div),
		.inspection-scroll :global(.inspection-attributes > div) {
			display: flex;
			justify-content: space-between;
			gap: 8px;
			min-width: 0;
		}
		.inspection-scroll :global(.inspection-wide) {
			grid-column: 1 / -1;
		}
		.inspection-scroll :global(dt) {
			color: var(--ui-color-muted);
		}
		.inspection-scroll :global(dd) {
			text-align: right;
			overflow-wrap: anywhere;
		}
		.inspection-scroll :global(.inspection-enchantment-beneficial) {
			color: var(--ui-color-success);
		}
		.inspection-scroll :global(.inspection-enchantment-harmful) {
			color: var(--ui-color-danger);
		}
		.inspection-scroll :global(.inspection-unbuffed) {
			margin-left: 0.35em;
			color: var(--ui-color-muted);
			white-space: nowrap;
		}
		.inspection-scroll :global(ul) {
			padding-left: 20px;
		}
		.inspection-scroll :global(li + li) {
			margin-top: 3px;
		}
		.inspection-scroll :global(blockquote) {
			padding-left: 10px;
			border-left: 2px solid var(--ui-color-accent);
			white-space: pre-wrap;
		}
		.inspection-scroll :global(.inspection-scribe) {
			margin-top: 5px;
			text-align: right;
		}
		.inspection-scroll :global(.inspection-creature) {
			background: linear-gradient(
				145deg,
				color-mix(in srgb, var(--ui-color-danger) 8%, transparent),
				transparent 35%
			);
		}
		.inspection-scroll :global(.inspection-creature-description) {
			padding: 9px 11px;
			border-left: 2px solid var(--ui-color-danger);
			background: color-mix(in srgb, var(--ui-color-well) 75%, transparent);
		}
		.inspection-scroll :global(.inspection-vitals) {
			display: grid;
			gap: 8px;
		}
		.inspection-scroll :global(.inspection-vital > div) {
			display: flex;
			justify-content: space-between;
			margin-bottom: 3px;
		}
		.inspection-scroll :global(progress) {
			display: block;
			width: 100%;
			height: 10px;
			accent-color: var(--ui-color-health);
		}
		.inspection-scroll :global(.inspection-stamina progress) {
			accent-color: var(--ui-color-stamina);
		}
		.inspection-scroll :global(.inspection-mana progress) {
			accent-color: var(--ui-color-mana);
		}
		@media (max-width: 360px) {
			.inspection-scroll :global(.inspection-facts),
			.inspection-scroll :global(.inspection-attributes) {
				grid-template-columns: 1fr;
			}
		}
	}
</style>
