<script lang="ts">
	import { onDestroy } from "svelte";
	import type { HexRgbaColor } from "../lib/frontend-color";
	import type { UiIconRepository } from "../app/ui-icon-repository";
	import { trackPointerGesture } from "../app/pointer-gesture";
	import ClientCreatureInspection from "./ClientCreatureInspection.svelte";
	import ClientCreaturePreview from "./ClientCreaturePreview.svelte";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import ClientItemInspection from "./ClientItemInspection.svelte";
	import ClientPlayerKillerStatusIcon from "./ClientPlayerKillerStatusIcon.svelte";
	import type { ClientSpellServices } from "./client-spells";
	import type { ObjectInspection } from "./client-object-inspection-contract";
	import type { ClientObjectPreviewState } from "./client-object-inspection";
	import type { ClientObjectPreviewService } from "./client-object-preview-service";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import { CLIENT_TUNING } from "./client-tuning";
	import { formatInspectionNumber } from "./client-object-inspection-format";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";

	interface Props {
		readonly inspection: ObjectInspection;
		readonly nameColor: HexRgbaColor | null;
		readonly preview: ClientObjectPreviewState | null;
		readonly objectPreviewService: ClientObjectPreviewService;
		readonly spells: ClientSpellServices | null;
		readonly icons: UiIconRepository | null;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly previewHeight: number;
		readonly zIndex?: number;
		readonly onFocus?: () => void;
		readonly onClose: () => void;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		readonly onPreviewHeightChange: (height: number) => void;
	}
	const {
		inspection,
		nameColor,
		preview,
		objectPreviewService,
		spells,
		icons,
		placement,
		viewport,
		previewHeight,
		zIndex,
		onFocus,
		onClose,
		onPlacementChange,
		onPreviewHeightChange,
	}: Props = $props();
	const previewHeightTuning = CLIENT_TUNING.objectPreview.height;
	let cancelPreviewResize: (() => void) | null = null;

	onDestroy(() => cancelPreviewResize?.());

	function setPreviewHeight(height: number): void {
		onPreviewHeightChange(
			Math.max(
				previewHeightTuning.minimum,
				Math.min(previewHeightTuning.maximum, height),
			),
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
	{zIndex}
	{onFocus}
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
				{nameColor}
			/>
		</div>
	{:else}
		{@const creatureIdentity = inspection.details.details.identity}
		<div
			class="inspection-creature-layout"
			style:grid-template-rows={`${previewHeight}px minmax(0, 1fr)`}
		>
			<div class="inspection-preview-pane">
				<header class="inspection-preview-identity">
					<h2 class="inspection-name" style:color={nameColor}>
						{inspection.name}
					</h2>
					{#if inspection.level !== null}<p class="inspection-preview-level">
							Level {formatInspectionNumber(inspection.level)}
						</p>{/if}
					{#if creatureIdentity.kind === "character" && creatureIdentity.role !== null}<p
							class="inspection-preview-title"
						>
							{creatureIdentity.role}
						</p>{/if}
					{#if creatureIdentity.lineage !== null || creatureIdentity.kind === "character"}
						<div class="inspection-preview-metadata">
							{#if creatureIdentity.lineage !== null}<p>
									{creatureIdentity.lineage}
								</p>{/if}
							{#if creatureIdentity.kind === "character"}
								<span class="inspection-preview-pk-status">
									<ClientPlayerKillerStatusIcon
										status={creatureIdentity.playerKillerStatus}
									/>
								</span>
							{/if}
						</div>
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
			container-type: inline-size;
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
			right: 16px;
			bottom: 14px;
			z-index: 1;
			display: flex;
			flex-direction: column;
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
			color: var(--ui-color-text);
			overflow-wrap: anywhere;
		}
		.inspection-preview-identity p {
			color: var(--ui-color-muted);
			font-size: 0.78rem;
		}
		.inspection-preview-identity .inspection-preview-level {
			margin-top: 2px;
		}
		.inspection-preview-title {
			font-style: italic;
		}
		.inspection-preview-metadata {
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			gap: 7px;
			width: 100%;
			min-width: 0;
			margin-top: auto;
		}
		.inspection-preview-metadata p {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.inspection-preview-pk-status {
			display: inline-flex;
			margin-left: auto;
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
		.inspection-scroll :global(.inspection-name) {
			color: var(--ui-color-text);
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
			align-self: start;
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
			overflow-wrap: normal;
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
		.inspection-scroll :global(.inspection-note) {
			margin: 7px 0 0;
			color: var(--ui-color-muted);
			font-size: 0.9em;
		}
		.inspection-scroll :global(.inspection-number) {
			white-space: nowrap;
		}
		.inspection-scroll :global(ul) {
			padding-left: 20px;
		}
		.inspection-scroll :global(li + li) {
			margin-top: 3px;
		}
		.inspection-scroll :global(.inspection-spells) {
			padding-left: 0;
			list-style: none;
		}
		.inspection-scroll :global(.inspection-spell > summary) {
			padding: 3px 0;
			cursor: pointer;
		}
		.inspection-scroll :global(.inspection-spell > summary::marker) {
			color: var(--ui-color-accent);
		}
		.inspection-scroll :global(.inspection-spell-description) {
			margin: 3px 0 7px 15px;
			padding: 7px 9px;
			border-left: 2px solid var(--ui-color-accent);
			background: color-mix(in srgb, var(--ui-color-well) 75%, transparent);
			overflow-wrap: anywhere;
			white-space: pre-wrap;
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
		@container (max-width: 360px) {
			.inspection-scroll :global(.inspection-facts),
			.inspection-scroll :global(.inspection-attributes) {
				grid-template-columns: 1fr;
			}
		}
	}
</style>
