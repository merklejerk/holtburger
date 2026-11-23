<script lang="ts">
	import { onMount, untrack } from "svelte";
	import type { MinimapFrame } from "../../app/minimap/frame";
	import { UI_SCALE_CHANGE_EVENT } from "../../app/theme/ui-scale";
	import PopupMenu, { type PopupMenuItem } from "../../app/ui/PopupMenu.svelte";
	import EyeIcon from "../../assets/icons/hud-eye.svg?component";
	import ResetIcon from "../../assets/icons/hud-reset.svg?component";
	import WorldMapPlayerIcon from "../../assets/icons/world-map-player.svg?component";
	import { SHARED_FRONTEND_TUNING } from "../../lib/frontend-tuning";
	import type { LandblockOwnerId } from "../../lib/game/game-types";
	import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../../lib/game/landblocks";
	import {
		formatWorldMapCoordinates,
		sceneMapPoint,
	} from "../../lib/game/map/map-coordinates";
	import type { SceneInterestTarget } from "../../lib/game/runtime/scene-target";
	import {
		WorldMapOwner,
		type WorldMapState,
	} from "../../lib/game/world-map/owner";
	import { trackWorldMapGesture } from "../../lib/game/world-map/pointer-gesture";
	import { WorldMapSettlementOverlay } from "../../lib/game/world-map/settlement-overlay";
	import type { WorldMapSource } from "../../lib/game/world-map/types";
	import {
		projectWorldMapPoint,
		worldMapPosition,
	} from "../../lib/game/world-map/view";
	import { WORLD_MAP_SETTLEMENTS } from "../../lib/game/world-map/world-map-settlements";
	import { useAppInputPolicy } from "../../lib/input/app-input-policy-context";

	interface Props {
		readonly source: WorldMapSource;
		readonly visible: boolean;
		readonly runtimeReady: boolean;
		readonly readFrame: () => MinimapFrame;
		readonly onJumpToTarget: (
			target: SceneInterestTarget,
			label: string,
		) => void;
	}

	const { source, visible, runtimeReady, readFrame, onJumpToTarget }: Props =
		$props();
	const { keyboard } = useAppInputPolicy();

	let canvas: HTMLCanvasElement;
	let settlementRoot: SVGGElement;
	let playerMarker: SVGGElement;
	let resetButton: HTMLButtonElement;
	let positionTooltip: HTMLDivElement;

	let owner: WorldMapOwner | null = null;
	let settlementOverlay: WorldMapSettlementOverlay | null = null;
	let cancelPan: (() => void) | null = null;
	let hover: { readonly x: number; readonly y: number } | null = null;

	let mapState = $state.raw<WorldMapState>({ kind: "idle" });
	let showAllLabels = $state(false);
	let menu = $state<
		| {
				readonly kind: "visibility";
				readonly anchor: HTMLButtonElement;
		  }
		| {
				readonly kind: "context";
				readonly anchor: { readonly x: number; readonly y: number };
				readonly target: SceneInterestTarget;
				readonly label: string;
		  }
		| null
	>(null);

	const visibilityItems = $derived<readonly PopupMenuItem<"names">[]>([
		{
			action: "names",
			label: "Town names",
			disabled: false,
			selection: { kind: "checkbox", checked: showAllLabels },
		},
	]);

	const contextItems = $derived<readonly PopupMenuItem<"teleport">[]>([
		{
			action: "teleport",
			label: "Teleport",
			disabled: !runtimeReady,
		},
	]);

	function positionToOutdoorTarget(position: {
		readonly x: number;
		readonly z: number;
	}): { readonly target: SceneInterestTarget; readonly label: string } {
		const blockX = Math.max(
			0,
			Math.min(254, Math.floor(position.x / OUTDOOR_LANDBLOCK_WORLD_SIZE)),
		);
		const blockY = Math.max(
			0,
			Math.min(254, Math.floor(-position.z / OUTDOOR_LANDBLOCK_WORLD_SIZE)),
		);
		const landblockId: LandblockOwnerId = `0x${((blockX << 8) | blockY).toString(16).padStart(4, "0")}ffff`;
		const coords = formatWorldMapCoordinates(
			sceneMapPoint(position.x, position.z),
		);
		return {
			target: { kind: "outdoor", landblockId },
			label: `${coords} (${landblockId})`,
		};
	}

	function drawPositionMarkers(): void {
		if (!visible || !owner || !canvas || !playerMarker) return;
		const view = owner.readView();
		if (view === null) {
			playerMarker.style.display = "none";
			return;
		}
		const frame = readFrame();
		if (frame.surfaceMapEligible && frame.subject !== null) {
			const [px, py] = projectWorldMapPoint(
				{
					x: frame.subject.anchor.worldX,
					z: frame.subject.anchor.worldZ,
				},
				view,
				canvas.clientWidth,
				canvas.clientHeight,
			);
			const headingDegrees =
				(frame.subject.anchor.headingRadians * 180) / Math.PI;
			playerMarker.style.display = "";
			playerMarker.setAttribute(
				"transform",
				`translate(${px} ${py}) rotate(${headingDegrees})`,
			);
		} else {
			playerMarker.style.display = "none";
		}
	}

	function drawOverlays(): void {
		drawPositionMarkers();
		if (!owner || !canvas) return;
		const view = owner.readView();
		if (view !== null) {
			settlementOverlay?.draw(view, canvas.clientWidth, canvas.clientHeight);
		} else {
			settlementOverlay?.clear();
		}
		if (resetButton) {
			resetButton.hidden = view === null || owner.isResetView();
		}
		drawTooltip();
	}

	function clearHover(): void {
		hover = null;
		if (positionTooltip) positionTooltip.hidden = true;
	}

	function moveHover(event: PointerEvent): void {
		hover = { x: event.clientX, y: event.clientY };
		drawTooltip();
	}

	function drawTooltip(): void {
		if (!positionTooltip || !canvas) return;
		const state = owner?.read();
		const view = owner?.readView();
		if (
			hover === null ||
			view === null ||
			view === undefined ||
			!state ||
			(state.kind !== "ready" && state.kind !== "streaming")
		) {
			positionTooltip.hidden = true;
			return;
		}
		const rect = canvas.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			positionTooltip.hidden = true;
			return;
		}
		const x = ((hover.x - rect.left) * canvas.clientWidth) / rect.width;
		const y = ((hover.y - rect.top) * canvas.clientHeight) / rect.height;
		const position = worldMapPosition(
			x,
			y,
			view,
			state.manifest.bounds,
			canvas.clientWidth,
			canvas.clientHeight,
		);
		positionTooltip.hidden = position === null;
		if (position === null) return;
		const settlement = settlementOverlay?.hit(x, y) ?? null;
		const text =
			settlement === null
				? formatWorldMapCoordinates(position)
				: `${settlement.name} · ${formatWorldMapCoordinates({ x: settlement.position[0], z: settlement.position[2] })}`;
		if (positionTooltip.textContent !== text) {
			positionTooltip.textContent = text;
		}
		const left =
			x + 12 + positionTooltip.offsetWidth <= canvas.clientWidth
				? x + 12
				: x - 12 - positionTooltip.offsetWidth;
		const top =
			y + 12 + positionTooltip.offsetHeight <= canvas.clientHeight
				? y + 12
				: y - 12 - positionTooltip.offsetHeight;
		positionTooltip.style.left = `${Math.max(0, left)}px`;
		positionTooltip.style.top = `${Math.max(0, top)}px`;
	}

	function pan(event: PointerEvent): void {
		const view = owner?.readView();
		if (!view || event.button !== 0 || !owner) return;
		event.preventDefault();
		event.stopPropagation();
		menu = null;
		const mounted = owner;
		const pointerId = event.pointerId;
		const scale =
			view.spanMeters / Math.max(1, canvas.getBoundingClientRect().width);
		let dragged = false;
		cancelPan?.();
		const stopGesture = trackWorldMapGesture(
			window,
			event,
			SHARED_FRONTEND_TUNING.worldMap.panThresholdPixels,
			(deltaX, deltaY) => {
				dragged = true;
				mounted.setView({
					...view,
					centerX: view.centerX - deltaX * scale,
					centerZ: view.centerZ - deltaY * scale,
				});
			},
		);
		const cleanup = () => {
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onCancel);
			stopGesture();
		};
		const onUp = (upEvent: PointerEvent) => {
			if (upEvent.pointerId !== pointerId) return;
			cleanup();
			cancelPan = null;
			if (dragged || !runtimeReady || !visible) return;
			const state = mounted.read();
			const currentView = mounted.readView();
			if (
				currentView === null ||
				(state.kind !== "streaming" && state.kind !== "ready")
			)
				return;
			const rect = canvas.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			const position = worldMapPosition(
				((upEvent.clientX - rect.left) * canvas.clientWidth) / rect.width,
				((upEvent.clientY - rect.top) * canvas.clientHeight) / rect.height,
				currentView,
				state.manifest.bounds,
				canvas.clientWidth,
				canvas.clientHeight,
			);
			if (position === null) return;
			const resolved = positionToOutdoorTarget(position);
			onJumpToTarget(resolved.target, resolved.label);
		};
		const onCancel = (cancelEvent: PointerEvent) => {
			if (cancelEvent.pointerId !== pointerId) return;
			cleanup();
			cancelPan = null;
		};
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onCancel);
		cancelPan = cleanup;
	}

	/** Capture jump target before PopupMenu dismisses and clears reactive menu state. */
	function jumpFromMenu(
		target: SceneInterestTarget,
		label: string,
	): () => void {
		return () => {
			if (!visible || !runtimeReady) return;
			onJumpToTarget(target, label);
		};
	}

	function openContextMenu(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		cancelPan?.();
		cancelPan = null;
		menu = null;
		clearHover();
		if (!visible || !owner) return;
		const state = owner.read();
		const view = owner.readView();
		if (!view || (state.kind !== "streaming" && state.kind !== "ready")) return;
		const rect = canvas.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		const position = worldMapPosition(
			((event.clientX - rect.left) * canvas.clientWidth) / rect.width,
			((event.clientY - rect.top) * canvas.clientHeight) / rect.height,
			view,
			state.manifest.bounds,
			canvas.clientWidth,
			canvas.clientHeight,
		);
		if (position === null) return;
		const resolved = positionToOutdoorTarget(position);
		menu = {
			kind: "context",
			anchor: { x: event.clientX, y: event.clientY },
			target: resolved.target,
			label: resolved.label,
		};
	}

	function zoom(event: WheelEvent): void {
		menu = null;
		event.preventDefault();
		event.stopPropagation();
		cancelPan?.();
		cancelPan = null;
		if (!owner) return;
		const pixels =
			event.deltaY *
			(event.deltaMode === 1
				? 16
				: event.deltaMode === 2
					? canvas.clientHeight
					: 1);
		const rect = canvas.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		owner.zoomAt(
			((event.clientX - rect.left) * canvas.clientWidth) / rect.width,
			((event.clientY - rect.top) * canvas.clientHeight) / rect.height,
			Math.exp(pixels * SHARED_FRONTEND_TUNING.worldMap.wheelZoomRate),
		);
	}

	onMount(() => {
		const settlements = new WorldMapSettlementOverlay(
			settlementRoot,
			WORLD_MAP_SETTLEMENTS,
		);
		settlementOverlay = settlements;
		const mounted = new WorldMapOwner(source, canvas);
		owner = mounted;
		mounted.setVisible(visible);
		const unsubscribeDraw = mounted.subscribeDraw(() => {
			drawOverlays();
		});
		const unsubscribe = mounted.subscribe((next) => {
			mapState = next;
			if (next.kind === "load-failed" || next.kind === "unavailable") {
				drawOverlays();
			}
		});
		const resize = new ResizeObserver(() => {
			mounted.resize();
		});
		resize.observe(canvas);
		const handleScale = () => {
			cancelPan?.();
			cancelPan = null;
			menu = null;
			clearHover();
			mounted.resize();
		};
		window.addEventListener(UI_SCALE_CHANGE_EVENT, handleScale);
		void mounted.load();
		return () => {
			window.removeEventListener(UI_SCALE_CHANGE_EVENT, handleScale);
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
		owner?.setVisible(visible);
		if (!visible) {
			cancelPan?.();
			cancelPan = null;
			menu = null;
			clearHover();
			return;
		}
		const update = () => {
			drawPositionMarkers();
			drawTooltip();
		};
		untrack(update);
		const timer = window.setInterval(update, 1000 / 30);
		return () => window.clearInterval(timer);
	});
</script>

<div
	class="world-map-page"
	use:keyboard.scope={{ nativeControls: true, keydown: () => {} }}
>
	<div class="world-map-surface">
		<canvas
			bind:this={canvas}
			aria-label="World terrain map"
			onpointermove={moveHover}
			onpointerleave={clearHover}
			onpointerdown={pan}
			oncontextmenu={openContextMenu}
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
			class="ui-hud-button ui-icon-button world-map-visibility"
			type="button"
			aria-label="Map visibility"
			aria-haspopup="menu"
			aria-expanded={menu?.kind === "visibility"}
			title="Map visibility"
			onclick={(event) => {
				menu =
					menu?.kind === "visibility"
						? null
						: { kind: "visibility", anchor: event.currentTarget };
			}}
		>
			<EyeIcon />
		</button>
		<button
			bind:this={resetButton}
			hidden
			class="ui-hud-button ui-icon-button world-map-reset"
			type="button"
			aria-label="Reset view"
			title="Reset view — show the whole world"
			disabled={mapState.kind !== "ready" && mapState.kind !== "streaming"}
			onclick={() => {
				cancelPan?.();
				cancelPan = null;
				owner?.fit();
			}}
		>
			<ResetIcon />
		</button>
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

{#if menu?.kind === "visibility"}
	<PopupMenu
		anchor={menu.anchor}
		label="Map visibility"
		items={visibilityItems}
		onselect={() => {
			showAllLabels = !showAllLabels;
			settlementOverlay?.showLabels(showAllLabels);
			drawTooltip();
		}}
		onclose={() => {
			menu = null;
		}}
	/>
{:else if menu?.kind === "context"}
	{#key menu}
		<PopupMenu
			anchor={menu.anchor}
			label="Map actions"
			items={contextItems}
			onselect={jumpFromMenu(menu.target, menu.label)}
			onclose={() => {
				menu = null;
			}}
		/>
	{/key}
{/if}

<style>
	@layer components {
		.world-map-page {
			height: 100%;
			display: grid;
			min-height: 0;
			grid-template-rows: minmax(0, 1fr) auto;
		}
		.world-map-visibility,
		.world-map-reset {
			position: absolute;
			bottom: 8px;
			width: 30px;
			height: 30px;
			display: grid;
			place-items: center;
		}
		.world-map-visibility {
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
			white-space: pre-line;
			max-width: calc(100% - 16px);
			max-height: calc(100% - 16px);
			overflow: hidden;
			overflow-wrap: anywhere;
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
		canvas {
			cursor: grab;
		}
		canvas:active {
			cursor: grabbing;
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
