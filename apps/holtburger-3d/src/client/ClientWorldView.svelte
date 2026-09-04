<script lang="ts">
	import { untrack } from "svelte";
	import Minimap from "../app/Minimap.svelte";
	import type { FrameRates } from "../app/frame-rate-sampler";
	import {
		MINIMAP_MINIMUM_SIZE,
		type MinimapFrame,
		type MinimapState,
	} from "../app/minimap-frame";
	import { MAP_DEFAULT_VIEW_DIAMETERS } from "../lib/game/map/map-appearance";
	import ClientCharacterHud from "./ClientCharacterHud.svelte";
	import ClientJumpPowerBar from "./ClientJumpPowerBar.svelte";
	import ClientChat from "./ClientChat.svelte";
	import type { ClientChatLine } from "./client-chat-policy";
	import ClientDebugPanel from "./ClientDebugPanel.svelte";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import ClientFpsCounter from "./ClientFpsCounter.svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import ClientSelectedEntityHud from "./ClientSelectedEntityHud.svelte";
	import ClientShortcutDock from "./ClientShortcutDock.svelte";
	import ClientToastOverlay from "./ClientToastOverlay.svelte";
	import ClientTargetIndicator from "./ClientTargetIndicator.svelte";
	import type { ClientTargetIndicatorFrame } from "./client-target-indicator";
	import type { ClientVital } from "./client-host-contract";
	import type { ClientToast } from "./client-toast-center";
	import { CLIENT_TUNING } from "./client-tuning";
	import {
		anchorClientHudPlacement,
		CLIENT_FPS_PANEL_SIZE,
		CLIENT_JUMP_POWER_PANEL_SIZE,
		CLIENT_TOAST_PANEL_SIZE,
		createDefaultClientHudLayout,
		resolveClientHudSquarePlacement,
		type ClientHudViewport,
	} from "./client-hud-layout";
	import type { ClientPresentationDiagnostics } from "./client-presentation-session";
	import {
		advanceClientViewportPointerGesture,
		beginClientViewportPointerGesture,
		type ClientViewportCameraController,
		type ClientViewportPointerGesture,
	} from "./client-viewport-pointer-gesture";

	interface Props {
		readonly cameraController: ClientViewportCameraController | null;
		readonly debugEnabled: boolean;
		readonly readMinimapFrame: () => MinimapFrame;
		readonly readDiagnostics: () => ClientPresentationDiagnostics | null;
		readonly readFrameRates: () => FrameRates | null;
		readonly readSelectedEntityName: () => string | null;
		readonly readTargetIndicatorFrame: () => ClientTargetIndicatorFrame | null;
		readonly selectedEntityGuid: number | null;
		readonly hoveredEntityGuid: number | null;
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
		readonly onViewportSelect: (clientX: number, clientY: number) => void;
		readonly onViewportHover: (clientX: number, clientY: number) => void;
		readonly onMaintainEntitySelection: () => void;
		readonly onSelectEntity: (guid: number | null) => void;
		readonly chatMessages: readonly ClientChatLine[];
		readonly onSendChat: (message: string) => Promise<void>;
		readonly onChatFocusChange: (focused: boolean) => void;
		readonly onCanvas: (canvas: HTMLCanvasElement | null) => void;
	}

	let {
		cameraController,
		debugEnabled,
		readMinimapFrame,
		readDiagnostics,
		readFrameRates,
		readSelectedEntityName,
		readTargetIndicatorFrame,
		selectedEntityGuid,
		hoveredEntityGuid,
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
		onViewportSelect,
		onViewportHover,
		onMaintainEntitySelection,
		onSelectEntity,
		chatMessages,
		onSendChat,
		onChatFocusChange,
		onCanvas,
	}: Props = $props();
	const initialViewport: ClientHudViewport = {
		width: window.innerWidth,
		height: window.innerHeight,
	};
	/** Cold client presentation policy: runtime visibility or explicit HUD layout editing. */
	type ClientHudMode = "runtime" | "layout";
	let hudMode = $state<ClientHudMode>("runtime");
	let debugOpen = $state(false);
	let worldElement = $state<HTMLElement | null>(null);
	let viewport = $state<ClientHudViewport>(initialViewport);
	// The launch capability is immutable; snapshotting it avoids resetting edited HUD layout.
	const initialShortcutCount = untrack(() => (debugEnabled ? 8 : 7));
	let hudLayout = $state(
		createDefaultClientHudLayout(initialViewport, initialShortcutCount),
	);
	let mapViewDiameters = $state<MinimapState["viewDiameters"]>({
		...MAP_DEFAULT_VIEW_DIAMETERS,
	});
	const resolvedMapPlacement = $derived(
		resolveClientHudSquarePlacement(
			hudLayout.minimap,
			viewport,
			MINIMAP_MINIMUM_SIZE,
		),
	);
	const minimap = $derived<MinimapState>({
		left: resolvedMapPlacement.left,
		top: resolvedMapPlacement.top,
		size: resolvedMapPlacement.width,
		viewDiameters: mapViewDiameters,
	});
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let viewportGesture: ClientViewportPointerGesture | null = null;
	let pointerX = 0;
	let pointerY = 0;
	let hasPointerPosition = false;
	let pointerInsideCanvas = false;
	const HUD_PREVIEW_JUMP_EXTENT = 0.45;
	const HUD_PREVIEW_TOAST_MESSAGE = "Notification preview";

	$effect(() => {
		if (!preciseJumpActive) return;
		untrack(() => {
			cancelViewportGesture();
			if (hasPointerPosition) onPreciseJumpAim(pointerX, pointerY);
		});
	});

	$effect(() => {
		if (cameraController !== null) return;
		untrack(cancelViewportGesture);
	});

	$effect(() => {
		onCanvas(canvasElement);
	});

	$effect(() => {
		if (canvasElement === null) return;
		const handle = window.setInterval(() => {
			onMaintainEntitySelection();
			if (!pointerInsideCanvas || !hasPointerPosition) return;
			onViewportHover(pointerX, pointerY);
		}, CLIENT_TUNING.entitySelection.sampleIntervalMs);
		return () => window.clearInterval(handle);
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

	function updateMinimap(next: MinimapState): void {
		mapViewDiameters = next.viewDiameters;
		const sizeChanged = next.size !== resolvedMapPlacement.width;
		const preferredSize = sizeChanged
			? next.size
			: hudLayout.minimap.preferredWidth;
		const minimapPlacement = anchorClientHudPlacement(
			{ left: next.left, top: next.top, width: next.size, height: next.size },
			viewport,
			{ width: preferredSize, height: preferredSize },
		);
		hudLayout = { ...hudLayout, minimap: minimapPlacement };
	}

	function handlePointerDown(event: PointerEvent): void {
		if (preciseJumpActive && event.button === 0) {
			event.preventDefault();
			canvasElement?.focus();
			onPreciseJumpActivate();
			return;
		}
		if (
			cameraController === null ||
			event.button !== 0 ||
			viewportGesture !== null
		)
			return;
		viewportGesture = beginClientViewportPointerGesture(
			event.pointerId,
			event.clientX,
			event.clientY,
		);
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
		const gesture = viewportGesture;
		if (gesture?.pointerId !== event.pointerId || cameraController === null) {
			pointerX = event.clientX;
			pointerY = event.clientY;
			hasPointerPosition = true;
			return;
		}
		const advanced = advanceClientViewportPointerGesture(
			gesture,
			event.clientX,
			event.clientY,
		);
		viewportGesture = advanced.gesture;
		pointerX = event.clientX;
		pointerY = event.clientY;
		hasPointerPosition = true;
		if (advanced.orbitDelta === null) return;
		cameraController.orbit(
			advanced.orbitDelta.x,
			-advanced.orbitDelta.y,
			performance.now(),
		);
	}

	function handlePointerEnter(event: PointerEvent): void {
		pointerInsideCanvas = true;
		pointerX = event.clientX;
		pointerY = event.clientY;
		hasPointerPosition = true;
	}

	function handlePointerLeave(): void {
		pointerInsideCanvas = false;
	}

	function completeViewportGesture(event: PointerEvent): void {
		const gesture = viewportGesture;
		if (gesture?.pointerId !== event.pointerId) return;
		handlePointerMove(event);
		const wasClick = viewportGesture?.dragging === false;
		viewportGesture = null;
		if (canvasElement?.hasPointerCapture(event.pointerId))
			canvasElement.releasePointerCapture(event.pointerId);
		if (wasClick) onViewportSelect(event.clientX, event.clientY);
	}

	function cancelViewportGesture(): void {
		const gesture = viewportGesture;
		viewportGesture = null;
		if (gesture && canvasElement?.hasPointerCapture(gesture.pointerId))
			canvasElement.releasePointerCapture(gesture.pointerId);
	}

	function cancelViewportPointer(event: PointerEvent): void {
		if (viewportGesture?.pointerId === event.pointerId) cancelViewportGesture();
	}

	function handleWheel(event: WheelEvent): void {
		if (cameraController === null) return;
		event.preventDefault();
		cameraController.zoom(event.deltaY * 0.01);
	}
</script>

<svelte:window onblur={cancelViewportGesture} />

<main
	bind:this={worldElement}
	class="client-world"
	aria-label="Holtburger client world"
>
	<canvas
		bind:this={canvasElement}
		class="client-canvas"
		class:client-canvas-entity-hovered={hoveredEntityGuid !== null}
		aria-label="Game world"
		tabindex="0"
		onpointerdown={handlePointerDown}
		onpointerenter={handlePointerEnter}
		onpointerleave={handlePointerLeave}
		onpointermove={handlePointerMove}
		onpointerup={completeViewportGesture}
		onpointercancel={cancelViewportPointer}
		onlostpointercapture={cancelViewportPointer}
		onwheel={handleWheel}
	></canvas>
	<ClientTargetIndicator
		readFrame={readTargetIndicatorFrame}
		selectedGuid={selectedEntityGuid}
	/>
	<button
		type="button"
		class="client-ui-lock"
		class:client-ui-unlocked={hudMode === "layout"}
		aria-label={hudMode === "runtime" ? "Unlock UI layout" : "Lock UI layout"}
		aria-pressed={hudMode === "layout"}
		title={hudMode === "runtime" ? "Unlock UI layout" : "Lock UI layout"}
		onclick={() => (hudMode = hudMode === "runtime" ? "layout" : "runtime")}
	>
		<ClientHudIcon name={hudMode === "runtime" ? "locked" : "unlocked"} />
	</button>
	<Minimap
		readFrame={readMinimapFrame}
		viewState={minimap}
		editable={hudMode === "layout"}
		onStateChange={updateMinimap}
		{onSelectEntity}
	/>
	<ClientHudPanel
		label="Character HUD"
		placement={hudLayout.character}
		editable={hudMode === "layout"}
		minWidth={250}
		minHeight={116}
		resizable={true}
		contentHitTesting="surface"
		{viewport}
		onPlacementChange={(character) => (hudLayout = { ...hudLayout, character })}
	>
		<ClientCharacterHud {playerName} {worldName} {vitals} />
	</ClientHudPanel>
	{#if jumpChargeActive || hudMode === "layout"}
		<ClientHudPanel
			label="Jump power"
			placement={hudLayout.jumpPower}
			editable={hudMode === "layout"}
			minWidth={CLIENT_JUMP_POWER_PANEL_SIZE.width}
			minHeight={CLIENT_JUMP_POWER_PANEL_SIZE.height}
			resizable={false}
			contentHitTesting="surface"
			{viewport}
			onPlacementChange={(jumpPower) =>
				(hudLayout = { ...hudLayout, jumpPower })}
		>
			<ClientJumpPowerBar
				active={jumpChargeActive}
				previewExtent={hudMode === "layout" ? HUD_PREVIEW_JUMP_EXTENT : null}
				actionEnabled={hudMode === "runtime" && jumpChargeActive}
				readExtent={readJumpExtent}
				onEnterPrecise={onPreciseJumpEnter}
			/>
		</ClientHudPanel>
	{/if}
	{#if toast !== null || hudMode === "layout"}
		<ClientHudPanel
			label="Notifications"
			placement={hudLayout.toast}
			editable={hudMode === "layout"}
			minWidth={200}
			minHeight={CLIENT_TOAST_PANEL_SIZE.height}
			resizable={false}
			contentHitTesting="descendants"
			{viewport}
			onPlacementChange={(toastPlacement) =>
				(hudLayout = { ...hudLayout, toast: toastPlacement })}
		>
			<ClientToastOverlay
				{toast}
				previewMessage={hudMode === "layout" && toast === null
					? HUD_PREVIEW_TOAST_MESSAGE
					: null}
			/>
		</ClientHudPanel>
	{/if}
	<ClientHudPanel
		label="Chat"
		placement={hudLayout.chat}
		editable={hudMode === "layout"}
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
		placement={hudLayout.frameRate}
		editable={hudMode === "layout"}
		minWidth={CLIENT_FPS_PANEL_SIZE.width}
		minHeight={24}
		resizable={false}
		contentHitTesting="descendants"
		{viewport}
		onPlacementChange={(frameRate) => (hudLayout = { ...hudLayout, frameRate })}
	>
		<ClientFpsCounter {readFrameRates} />
	</ClientHudPanel>
	{#if selectedEntityGuid !== null || hudMode === "layout"}
		<ClientHudPanel
			label="Selected entity"
			placement={hudLayout.selectedEntity}
			editable={hudMode === "layout"}
			minWidth={240}
			minHeight={64}
			resizable={false}
			contentHitTesting="descendants"
			{viewport}
			onPlacementChange={(selectedEntity) =>
				(hudLayout = { ...hudLayout, selectedEntity })}
		>
			<ClientSelectedEntityHud
				selectedGuid={selectedEntityGuid}
				readSelectedName={readSelectedEntityName}
			/>
		</ClientHudPanel>
	{/if}
	<ClientHudPanel
		label="Game shortcuts"
		placement={hudLayout.shortcuts}
		editable={hudMode === "layout"}
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
		<ClientHudWindow
			title="Client diagnostics"
			placement={hudLayout.diagnostics}
			minWidth={280}
			minHeight={220}
			{viewport}
			onClose={() => (debugOpen = false)}
			onPlacementChange={(diagnostics) =>
				(hudLayout = { ...hudLayout, diagnostics })}
		>
			<ClientDebugPanel
				{readDiagnostics}
				{showRetailHiddenGeometry}
				{onShowRetailHiddenGeometryChange}
			/>
		</ClientHudWindow>
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

	.client-canvas.client-canvas-entity-hovered {
		cursor: pointer;
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
