<script lang="ts">
	import { untrack } from "svelte";
	import MapPanel from "../app/MapPanel.svelte";
	import type { FrameRates } from "../app/frame-rate-sampler";
	import {
		MAP_PANEL_MINIMUM_SIZE,
		type MapPanelFrame,
		type MapPanelState,
	} from "../app/map-panel-frame";
	import { MAP_DEFAULT_VIEW_DIAMETERS } from "../lib/game/map/map-appearance";
	import ClientCharacterHud from "./ClientCharacterHud.svelte";
	import ClientJumpPowerBar from "./ClientJumpPowerBar.svelte";
	import ClientChat from "./ClientChat.svelte";
	import type { ClientChatLine } from "./client-chat-policy";
	import ClientDebugPanel from "./ClientDebugPanel.svelte";
	import ClientFloatingPanel from "./ClientFloatingPanel.svelte";
	import ClientFpsCounter from "./ClientFpsCounter.svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import ClientShortcutDock from "./ClientShortcutDock.svelte";
	import ClientToastOverlay from "./ClientToastOverlay.svelte";
	import type { ClientVital } from "./client-host-contract";
	import type { ClientToast } from "./client-toast-center";
	import {
		anchorClientHudPlacement,
		CLIENT_FPS_PANEL_WIDTH,
		createDefaultClientHudLayout,
		resolveClientHudSquarePlacement,
		type ClientHudPlacement,
		type ClientHudViewport,
	} from "./client-hud-layout";
	import type {
		ClientPresentationCameraController,
		ClientPresentationDiagnostics,
	} from "./client-presentation-session";

	interface Props {
		readonly cameraController: ClientPresentationCameraController | null;
		readonly debugEnabled: boolean;
		readonly readMapPanelFrame: () => MapPanelFrame;
		readonly readDiagnostics: () => ClientPresentationDiagnostics | null;
		readonly readFrameRates: () => FrameRates | null;
		readonly showRetailHiddenGeometry: boolean;
		readonly onShowRetailHiddenGeometryChange: (visible: boolean) => void;
		readonly playerName: string | null;
		readonly worldName: string | null;
		readonly vitals: readonly ClientVital[];
		readonly jumpChargeActive: boolean;
		readonly readJumpExtent: () => number;
		readonly toast: ClientToast | null;
		readonly preciseJumpActive: boolean;
		readonly onPreciseJumpAim: (clientX: number, clientY: number) => void;
		readonly onPreciseJumpActivate: () => void;
		readonly onPreciseJumpEnter: () => void;
		readonly chatMessages: readonly ClientChatLine[];
		readonly onSendChat: (message: string) => Promise<void>;
		readonly onChatFocusChange: (focused: boolean) => void;
		readonly onCanvas: (canvas: HTMLCanvasElement | null) => void;
	}

	let {
		cameraController,
		debugEnabled,
		readMapPanelFrame,
		readDiagnostics,
		readFrameRates,
		showRetailHiddenGeometry,
		onShowRetailHiddenGeometryChange,
		playerName,
		worldName,
		vitals,
		jumpChargeActive,
		readJumpExtent,
		toast,
		preciseJumpActive,
		onPreciseJumpAim,
		onPreciseJumpActivate,
		onPreciseJumpEnter,
		chatMessages,
		onSendChat,
		onChatFocusChange,
		onCanvas,
	}: Props = $props();
	const MAP_PANEL_SIZE = 220;
	const MAP_PANEL_MARGIN = 16;
	const initialViewport: ClientHudViewport = {
		width: window.innerWidth,
		height: window.innerHeight,
	};
	let uiLocked = $state(true);
	let debugOpen = $state(false);
	let worldElement = $state<HTMLElement | null>(null);
	let viewport = $state<ClientHudViewport>(initialViewport);
	// The launch capability is immutable; snapshotting it avoids resetting edited HUD layout.
	const initialShortcutCount = untrack(() => (debugEnabled ? 8 : 7));
	let hudLayout = $state(
		createDefaultClientHudLayout(
			initialViewport.width,
			initialViewport.height,
			initialShortcutCount,
		),
	);
	let debugPlacement = $state<ClientHudPlacement>({
		horizontal: { edge: "right", offset: 16 },
		vertical: { edge: "top", offset: 260 },
		preferredWidth: 330,
		preferredHeight: 310,
	});
	/** Client-local radar placement is right-anchored; its view choices remain map-owned state. */
	let mapPlacement = $state<ClientHudPlacement>({
		horizontal: { edge: "right", offset: MAP_PANEL_MARGIN + 32 },
		vertical: { edge: "top", offset: MAP_PANEL_MARGIN },
		preferredWidth: MAP_PANEL_SIZE,
		preferredHeight: MAP_PANEL_SIZE,
	});
	let mapViewDiameters = $state<MapPanelState["viewDiameters"]>({
		...MAP_DEFAULT_VIEW_DIAMETERS,
	});
	const resolvedMapPlacement = $derived(
		resolveClientHudSquarePlacement(
			mapPlacement,
			viewport,
			MAP_PANEL_MINIMUM_SIZE,
		),
	);
	const mapPanel = $derived<MapPanelState>({
		left: resolvedMapPlacement.left,
		top: resolvedMapPlacement.top,
		size: resolvedMapPlacement.width,
		viewDiameters: mapViewDiameters,
	});
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let pointerId: number | null = null;
	let pointerX = 0;
	let pointerY = 0;
	let hasPointerPosition = false;

	$effect(() => {
		if (!preciseJumpActive) return;
		untrack(() => {
			if (hasPointerPosition) onPreciseJumpAim(pointerX, pointerY);
		});
	});

	$effect(() => {
		onCanvas(canvasElement);
	});

	$effect(() => {
		if (worldElement === null) return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry === undefined) return;
			viewport = {
				width: entry.contentRect.width,
				height: entry.contentRect.height,
			};
		});
		observer.observe(worldElement);
		return () => observer.disconnect();
	});

	function updateMapPanel(next: MapPanelState): void {
		mapViewDiameters = next.viewDiameters;
		const sizeChanged = next.size !== resolvedMapPlacement.width;
		const preferredSize = sizeChanged ? next.size : mapPlacement.preferredWidth;
		mapPlacement = anchorClientHudPlacement(
			{ left: next.left, top: next.top, width: next.size, height: next.size },
			viewport,
			{ width: preferredSize, height: preferredSize },
		);
	}

	function handlePointerDown(event: PointerEvent): void {
		if (preciseJumpActive && event.button === 0) {
			event.preventDefault();
			canvasElement?.focus();
			onPreciseJumpActivate();
			return;
		}
		if (cameraController === null || event.button !== 0 || pointerId !== null)
			return;
		pointerId = event.pointerId;
		pointerX = event.clientX;
		pointerY = event.clientY;
		canvasElement?.focus();
		canvasElement?.setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (preciseJumpActive) {
			pointerX = event.clientX;
			pointerY = event.clientY;
			hasPointerPosition = true;
			onPreciseJumpAim(event.clientX, event.clientY);
			return;
		}
		if (pointerId !== event.pointerId || cameraController === null) {
			pointerX = event.clientX;
			pointerY = event.clientY;
			hasPointerPosition = true;
			return;
		}
		const deltaX = event.clientX - pointerX;
		const deltaY = event.clientY - pointerY;
		pointerX = event.clientX;
		pointerY = event.clientY;
		hasPointerPosition = true;
		if (deltaX === 0 && deltaY === 0) return;
		cameraController.orbit(deltaX, -deltaY, performance.now());
	}

	function releasePointer(event: PointerEvent): void {
		if (pointerId !== event.pointerId) return;
		pointerId = null;
		if (canvasElement?.hasPointerCapture(event.pointerId))
			canvasElement.releasePointerCapture(event.pointerId);
	}

	function handleWheel(event: WheelEvent): void {
		if (cameraController === null) return;
		event.preventDefault();
		cameraController.zoom(event.deltaY * 0.01);
	}
</script>

<main
	bind:this={worldElement}
	class="client-world"
	aria-label="Holtburger client world"
>
	<canvas
		bind:this={canvasElement}
		class="client-canvas"
		aria-label="Game world"
		tabindex="0"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={releasePointer}
		onpointercancel={releasePointer}
		onwheel={handleWheel}
	></canvas>
	<button
		type="button"
		class="client-ui-lock"
		class:client-ui-unlocked={!uiLocked}
		aria-label={uiLocked ? "Unlock UI layout" : "Lock UI layout"}
		aria-pressed={!uiLocked}
		title={uiLocked ? "Unlock UI layout" : "Lock UI layout"}
		onclick={() => (uiLocked = !uiLocked)}
	>
		<ClientHudIcon name={uiLocked ? "locked" : "unlocked"} />
	</button>
	<MapPanel
		readFrame={readMapPanelFrame}
		panel={mapPanel}
		editable={!uiLocked}
		onStateChange={updateMapPanel}
	/>
	<ClientHudPanel
		label="Character HUD"
		placement={hudLayout.character}
		editable={!uiLocked}
		minWidth={250}
		minHeight={116}
		resizable={true}
		contentHitTesting="surface"
		{viewport}
		onPlacementChange={(character) => (hudLayout = { ...hudLayout, character })}
	>
		<ClientCharacterHud {playerName} {worldName} {vitals} />
	</ClientHudPanel>
	<ClientJumpPowerBar
		active={jumpChargeActive}
		readExtent={readJumpExtent}
		onEnterPrecise={onPreciseJumpEnter}
	/>
	<ClientToastOverlay {toast} />
	<ClientHudPanel
		label="Chat"
		placement={hudLayout.chat}
		editable={!uiLocked}
		minWidth={280}
		minHeight={240}
		resizable={true}
		contentHitTesting="descendants"
		{viewport}
		onPlacementChange={(chat) => (hudLayout = { ...hudLayout, chat })}
	>
		<ClientChat
			gameCanvas={canvasElement}
			messages={chatMessages}
			onSend={onSendChat}
			onFocusChange={onChatFocusChange}
		/>
	</ClientHudPanel>
	<ClientHudPanel
		label="Frame rate"
		placement={hudLayout.fps}
		editable={!uiLocked}
		minWidth={CLIENT_FPS_PANEL_WIDTH}
		minHeight={24}
		resizable={false}
		contentHitTesting="descendants"
		{viewport}
		onPlacementChange={(fps) => (hudLayout = { ...hudLayout, fps })}
	>
		<ClientFpsCounter {readFrameRates} />
	</ClientHudPanel>
	<ClientHudPanel
		label="Game shortcuts"
		placement={hudLayout.shortcuts}
		editable={!uiLocked}
		minWidth={280}
		minHeight={36}
		resizable={true}
		contentHitTesting="surface"
		{viewport}
		onPlacementChange={(shortcuts) => (hudLayout = { ...hudLayout, shortcuts })}
	>
		<ClientShortcutDock
			{debugEnabled}
			{debugOpen}
			onDebug={() => (debugOpen = !debugOpen)}
		/>
	</ClientHudPanel>
	{#if debugEnabled && debugOpen}
		<ClientFloatingPanel
			title="Client diagnostics"
			placement={debugPlacement}
			minWidth={280}
			minHeight={220}
			{viewport}
			onClose={() => (debugOpen = false)}
			onPlacementChange={(placement) => (debugPlacement = placement)}
		>
			<ClientDebugPanel
				{readDiagnostics}
				{showRetailHiddenGeometry}
				{onShowRetailHiddenGeometryChange}
			/>
		</ClientFloatingPanel>
	{/if}
</main>

<style>
	.client-world {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: #080706;
	}

	.client-canvas {
		display: block;
		width: 100%;
		height: 100%;
		min-height: 320px;
		cursor: grab;
		outline: none;
		touch-action: none;
	}

	.client-canvas:active {
		cursor: grabbing;
	}

	.client-ui-lock {
		position: fixed;
		top: 8px;
		right: 8px;
		z-index: 5;
		width: 28px;
		height: 28px;
		min-height: 0;
		padding: 5px;
		border: 1px solid rgb(230 230 215 / 0.28);
		border-radius: 50%;
		background: rgb(20 22 21 / 0.36);
		color: rgb(235 232 219 / 0.72);
	}

	.client-ui-unlocked {
		border-color: rgb(239 208 111 / 0.82);
		color: #efd06f;
		background: rgb(45 38 22 / 0.72);
	}
</style>
