<script lang="ts">
	import { onMount } from "svelte";
	import type { MinimapFrame } from "../app/minimap-frame";
	import { trackWorldMapGesture } from "../lib/game/world-map/pointer-gesture";
	import type { ClientMapPosition } from "./client-host-contract";
	import {
		WorldMapOwner,
		type WorldMapState,
	} from "../lib/game/world-map/owner";
	import type { WorldMapSource } from "../lib/game/world-map/types";
	import { worldMapPlayer, worldMapPosition } from "../lib/game/world-map/view";
	import { WORLD_MAP_SETTLEMENTS } from "../lib/game/world-map/world-map-settlements";
	import { WorldMapSettlementOverlay } from "../lib/game/world-map/settlement-overlay";
	import { SHARED_FRONTEND_TUNING } from "../lib/frontend-tuning";
	import { formatWorldMapCoordinates } from "../lib/game/map/map-coordinates";
	import WorldMapPlayerIcon from "../assets/icons/world-map-player.svg?component";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";

	interface Props {
		/** One mounted transport's static map capability. */
		readonly source: WorldMapSource;
		/** Core admission is rechecked at release and command dispatch. */
		readonly canTeleportFromMap: boolean;
		/** App shell owns visible request-error feedback. */
		readonly onTeleportToMapPosition: (
			position: ClientMapPosition,
		) => Promise<void>;
		/** Visibility never owns canvas or dataset lifetime. */
		readonly visible: boolean;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		/** Coherent player placement, pulled at bounded overlay cadence. */
		readonly readFrame: () => MinimapFrame;
		readonly onClose: () => void;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
	}
	const {
		source,
		canTeleportFromMap,
		onTeleportToMapPosition,
		visible,
		placement,
		viewport,
		readFrame,
		onClose,
		onPlacementChange,
	}: Props = $props();
	let canvas: HTMLCanvasElement;
	let playerMarker: SVGGElement;
	let settlementRoot: SVGGElement;
	let settlementOverlay: WorldMapSettlementOverlay | null = null;
	let resetButton: HTMLButtonElement;
	let positionTooltip: HTMLDivElement;
	/** Last canvas hover in viewport pixels, reprojected after every map draw. */
	let hover: { readonly x: number; readonly y: number } | null = null;
	const panelId = $props.id();
	const { keyboard } = useAppInputPolicy();
	/** Tab choice only controls presentation; the image and current view stay retained. */
	let activeTab = $state<"world" | "housing">("world");
	/** Cold toggle markup; defaults to names shown only in the tooltip. */
	let showAllLabels = $state(false);
	const tabs = [
		{ id: "world", label: "World" },
		{ id: "housing", label: "Housing" },
	] as const;
	function handleTabKey(event: KeyboardEvent): void {
		if (
			!(event.target instanceof HTMLElement) ||
			event.target.getAttribute("role") !== "tab"
		)
			return;
		if (event.key === "ArrowLeft" || event.key === "ArrowRight")
			activeTab = activeTab === "world" ? "housing" : "world";
		else if (event.key === "Home") activeTab = "world";
		else if (event.key === "End") activeTab = "housing";
		else return;
		event.preventDefault();
		document.getElementById(`${panelId}-${activeTab}-tab`)?.focus();
	}
	// Only status markup is reactive. Dataset arrays and input-rate view state stay imperative.
	let mapState = $state.raw<WorldMapState>({ kind: "idle" });
	let owner: WorldMapOwner | null = null;
	let cancelPan: (() => void) | null = null;

	/** Demand-read owner access for the focused browser lifecycle diagnostic. */
	export function readOwner(): WorldMapOwner | null {
		return owner;
	}

	onMount(() => {
		const settlements = new WorldMapSettlementOverlay(
			settlementRoot,
			WORLD_MAP_SETTLEMENTS,
		);
		settlementOverlay = settlements;
		const mounted = new WorldMapOwner(source, canvas);
		owner = mounted;
		mounted.setVisible(visible && activeTab === "world");
		const unsubscribeDraw = mounted.subscribeDraw(drawOverlays);
		const unsubscribe = mounted.subscribe((next) => {
			mapState = next;
			if (next.kind === "load-failed" || next.kind === "unavailable")
				drawOverlays();
		});
		const resize = new ResizeObserver(() => {
			mounted.resize();
		});
		resize.observe(canvas);
		void mounted.load();
		return () => {
			cancelPan?.();
			resize.disconnect();
			unsubscribe();
			unsubscribeDraw();
			mounted.destroy();
			settlements.destroy();
			settlementOverlay = null;
			owner = null;
		};
	});
	$effect(() => {
		owner?.setVisible(visible && activeTab === "world");
		if (!visible || activeTab !== "world") {
			cancelPan?.();
			cancelPan = null;
			clearHover();
			return;
		}
		// Player motion is sampled between draws; map gestures update the marker in the image RAF.
		const timer = setInterval(drawPlayer, 1000 / 30);
		return () => clearInterval(timer);
	});

	function drawOverlays(): void {
		drawPlayer();
		if (!owner) return;
		const view = owner.readView();
		if (view)
			settlementOverlay?.draw(view, canvas.clientWidth, canvas.clientHeight);
		else settlementOverlay?.clear();
		resetButton.hidden = !owner.readView() || owner.isResetView();
		drawTooltip();
	}
	function clearHover(): void {
		hover = null;
		positionTooltip.hidden = true;
	}
	function moveHover(event: PointerEvent): void {
		hover = { x: event.clientX, y: event.clientY };
		drawTooltip();
	}
	function drawTooltip(): void {
		const state = owner?.read();
		const view = owner?.readView();
		if (
			!hover ||
			!view ||
			!state ||
			(state.kind !== "ready" && state.kind !== "streaming")
		) {
			positionTooltip.hidden = true;
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const x = hover.x - rect.left,
			y = hover.y - rect.top;
		const position = worldMapPosition(
			x,
			y,
			view,
			state.manifest.bounds,
			rect.width,
			rect.height,
		);
		positionTooltip.hidden = position === null;
		const settlement =
			position && settlementOverlay ? settlementOverlay.hit(x, y) : null;
		if (!position) return;
		positionTooltip.textContent = settlement
			? `${settlement.name} · ${formatWorldMapCoordinates({ x: settlement.position[0], z: settlement.position[2] })}`
			: formatWorldMapCoordinates(position);
		// Flip away from the lower/right edges so the tooltip stays inside the surface.
		const left =
			x + 12 + positionTooltip.offsetWidth <= rect.width
				? x + 12
				: x - 12 - positionTooltip.offsetWidth;
		const top =
			y + 12 + positionTooltip.offsetHeight <= rect.height
				? y + 12
				: y - 12 - positionTooltip.offsetHeight;
		positionTooltip.style.left = `${Math.max(0, left)}px`;
		positionTooltip.style.top = `${Math.max(0, top)}px`;
	}

	function drawPlayer(): void {
		if (!visible || activeTab !== "world" || !owner) return;
		const view = owner.readView();
		if (!view) {
			playerMarker.style.display = "none";
			return;
		}
		const position = worldMapPlayer(
			readFrame().subject,
			view,
			canvas.clientWidth,
			canvas.clientHeight,
		);
		playerMarker.style.display = position ? "" : "none";
		if (position) {
			playerMarker.setAttribute(
				"transform",
				`translate(${position[0]} ${position[1]})`,
			);
		}
	}

	function pan(event: PointerEvent): void {
		const view = owner?.readView();
		if (!view || event.button !== 0 || !owner) return;
		event.preventDefault();
		event.stopPropagation();
		const mounted = owner;
		const scale = view.spanMeters / Math.max(1, canvas.clientWidth);
		cancelPan?.();
		cancelPan = trackWorldMapGesture(
			window,
			event,
			SHARED_FRONTEND_TUNING.worldMap.panThresholdPixels,
			(deltaX, deltaY) => {
				mounted.setView({
					...view,
					centerX: view.centerX - deltaX * scale,
					centerZ: view.centerZ - deltaY * scale,
				});
			},
			teleport,
		);
	}
	function teleport(event: PointerEvent): void {
		if (!visible || activeTab !== "world" || !canTeleportFromMap || !owner)
			return;
		const state = owner.read();
		const view = owner.readView();
		if (!view || (state.kind !== "streaming" && state.kind !== "ready")) return;
		const rect = canvas.getBoundingClientRect();
		const position = worldMapPosition(
			event.clientX - rect.left,
			event.clientY - rect.top,
			view,
			state.manifest.bounds,
			rect.width,
			rect.height,
		);
		// The visual outer edge is inclusive; authored landblock ownership is exclusive.
		if (
			!position ||
			position.x === state.manifest.bounds.maxX ||
			position.z === state.manifest.bounds.minZ
		)
			return;
		// RETAIL DIVERGENCE: acclient.c:208815 uses fixed local X/Y=10 for map clicks.
		// Preserve clicked X/Y instead; ACE resolves terrain/building height at that point.
		// Scope: the privileged map-click action only; no authored content placement changes.
		void onTeleportToMapPosition(position);
	}
	function zoom(event: WheelEvent): void {
		event.preventDefault();
		event.stopPropagation();
		cancelPan?.();
		cancelPan = null;
		const view = owner?.readView();
		if (!view || !owner) return;
		// Normalize browser wheel units before applying the app's zoom policy.
		const pixels =
			event.deltaY *
			(event.deltaMode === 1
				? 16
				: event.deltaMode === 2
					? canvas.clientHeight
					: 1);
		owner.setView({
			...view,
			spanMeters:
				view.spanMeters *
				Math.exp(pixels * SHARED_FRONTEND_TUNING.worldMap.wheelZoomRate),
		});
	}
</script>

<ClientHudWindow
	title="World"
	icon="world"
	{visible}
	{placement}
	{viewport}
	{onClose}
	{onPlacementChange}
	minWidth={CLIENT_UI_DEFAULTS.world.minSize.width}
	minHeight={CLIENT_UI_DEFAULTS.world.minSize.height}
>
	<div class="world-panel">
		<div
			class="world-tabs ui-tabs"
			role="tablist"
			aria-label="World tabs"
			use:keyboard.scope={{ nativeControls: true, keydown: handleTabKey }}
		>
			{#each tabs as tab}
				<button
					type="button"
					class="ui-tab"
					role="tab"
					id={`${panelId}-${tab.id}-tab`}
					aria-controls={`${panelId}-${tab.id}`}
					aria-selected={activeTab === tab.id}
					tabindex={activeTab === tab.id ? 0 : -1}
					onclick={() => (activeTab = tab.id)}>{tab.label}</button
				>
			{/each}
		</div>
		<div
			class="world-page world-map-page"
			role="tabpanel"
			id={`${panelId}-world`}
			aria-labelledby={`${panelId}-world-tab`}
			hidden={activeTab !== "world"}
			inert={activeTab !== "world"}
		>
			<div class="world-map-surface">
				<canvas
					bind:this={canvas}
					aria-label="World terrain map"
					onpointermove={moveHover}
					onpointerleave={clearHover}
					onpointerdown={pan}
					onwheel={zoom}
				></canvas>
				<svg class="world-map-overlay" aria-hidden="true">
					<g
						bind:this={settlementRoot}
						class="world-settlements ui-world-map-settlements"
					/>
					<g
						bind:this={playerMarker}
						class="world-player-target"
						style:display="none"
					>
						<WorldMapPlayerIcon />
					</g>
				</svg>
				<button
					class="ui-hud-button world-map-labels"
					type="button"
					aria-label="Show settlement labels"
					aria-pressed={showAllLabels}
					title="Show all settlement labels"
					onclick={() => {
						showAllLabels = !showAllLabels;
						settlementOverlay?.showLabels(showAllLabels);
					}}><ClientHudIcon name="eye" /></button
				>
				<button
					bind:this={resetButton}
					hidden
					class="ui-hud-button world-map-reset"
					type="button"
					aria-label="Reset view"
					title="Reset view — show the whole world"
					disabled={mapState.kind !== "ready" && mapState.kind !== "streaming"}
					onclick={() => {
						cancelPan?.();
						cancelPan = null;
						owner?.fit();
					}}><ClientHudIcon name="reset" /></button
				>
				<div
					bind:this={positionTooltip}
					class="world-map-tooltip ui-tooltip"
					role="tooltip"
					hidden
				></div>
				{#if mapState.kind === "idle" || mapState.kind === "opening"}
					<div class="world-map-status" role="status" aria-live="polite">
						<p>Preparing world map…</p>
						<progress aria-label="World map loading progress"></progress>
					</div>
				{:else if mapState.kind === "load-failed"}
					<div class="world-map-status" role="alert">
						<p>{mapState.diagnostic}</p>
						<button
							class="ui-button"
							type="button"
							onclick={() => void owner?.load()}>Retry</button
						>
					</div>
				{:else if mapState.kind === "unavailable"}
					<div class="world-map-status" role="alert">{mapState.diagnostic}</div>
				{/if}
			</div>
			{#if mapState.kind === "streaming"}
				<div class="world-map-progress" role="status" aria-live="polite">
					<span
						>{mapState.appliedTiles === mapState.manifest.tiles.length
							? "Saving world map…"
							: `World map: ${mapState.appliedTiles}/${mapState.manifest.tiles.length} tiles`}</span
					>
					<progress
						aria-label="World map loading progress"
						value={mapState.appliedTiles}
						max={mapState.manifest.tiles.length}
					></progress>
				</div>
			{/if}
		</div>
		<div
			class="world-page world-housing-page"
			role="tabpanel"
			id={`${panelId}-housing`}
			aria-labelledby={`${panelId}-housing-tab`}
			hidden={activeTab !== "housing"}
			inert={activeTab !== "housing"}
		>
			<p class="ui-muted">Housing is not available yet.</p>
		</div>
	</div>
</ClientHudWindow>

<style>
	@layer components {
		.world-panel {
			height: 100%;
			display: grid;
			grid-template-rows: auto minmax(0, 1fr);
		}
		.world-tabs.ui-tabs {
			margin: 12px;
			border-bottom: 0;
		}
		.world-tabs button {
			flex: 1;
		}
		.world-map-page {
			display: grid;
			min-height: 0;
			grid-template-rows: minmax(0, 1fr) auto;
		}
		.world-page[hidden] {
			display: none;
		}
		.world-housing-page {
			display: grid;
			place-content: center;
			padding: 20px;
		}
		.world-map-labels,
		.world-map-reset {
			position: absolute;
			bottom: 8px;
			width: 30px;
			height: 30px;
			display: grid;
			place-items: center;
		}
		.world-map-labels {
			left: 8px;
		}
		.world-map-reset {
			right: 8px;
		}
		.world-map-reset[hidden],
		.world-map-tooltip[hidden] {
			display: none;
		}
		.world-map-tooltip {
			position: absolute;
			pointer-events: none;
			white-space: nowrap;
		}
		.world-map-surface {
			position: relative;
			min-height: 0;
			overflow: hidden;
		}
		canvas,
		.world-map-overlay {
			position: absolute;
			width: 100%;
			height: 100%;
			touch-action: none;
		}
		.world-map-overlay {
			pointer-events: none;
		}
		.world-map-progress {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 6px;
		}
		.world-map-status {
			position: absolute;
			inset: 0;
			display: grid;
			place-content: center;
			padding: 20px;
			background: var(--ui-color-surface);
			overflow: auto;
		}
	}
</style>
