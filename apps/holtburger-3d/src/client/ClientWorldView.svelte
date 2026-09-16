<script lang="ts">
	import { ClientSpellDrag } from "./client-spell-drag";
	import type { ClientItemDrag } from "./client-item-drag";
	import { bindSpellCell, swapSpellCells } from "./client-spell-bar-state";
	import type { ClientSpellBarState } from "./client-spell-bar-state";
	import type { InputDigitIndex } from "../lib/input/input-contract";
	import ClientSpellBar from "./ClientSpellBar.svelte";
	import type { ClientViewportTargetPicker } from "./client-pointer-selection-controller";
	import type {
		ClientItemInteractions,
		ItemInteractionState,
	} from "./client-item-interactions";
	import type { ClientSelectedEntity } from "./client-selected-entity";
	import type { WeenieCatalogCapability } from "../lib/host/weenie-catalog-capability";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";

	import { APP_INPUT } from "../lib/input/app-input";
	import { onMount, untrack } from "svelte";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import Minimap from "../app/Minimap.svelte";
	import type { FrameRates } from "../app/frame-rate-sampler";
	import type { MinimapFrame, MinimapState } from "../app/minimap-frame";
	import { MAP_DEFAULT_VIEW_DIAMETERS } from "../lib/game/map/map-appearance";
	import ClientCharacterHud from "./ClientCharacterHud.svelte";
	import ClientJumpPowerBar from "./ClientJumpPowerBar.svelte";
	import ClientChat from "./ClientChat.svelte";
	import type { ClientChatLine } from "./client-chat-policy";
	import ClientActionBars from "./ClientActionBars.svelte";
	import ClientSpellsPanel from "./ClientSpellsPanel.svelte";
	import type { ClientSpellServices } from "./client-spells";
	import ClientInventoryPanel from "./ClientInventoryPanel.svelte";
	import type { ClientInventoryState } from "./client-inventory-state";
	import ClientDebugPanel from "./ClientDebugPanel.svelte";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import ClientFpsCounter from "./ClientFpsCounter.svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import type { ClientSelectedEntityDisplay } from "./client-selected-entity-tracking";
	import ClientSelectedEntityHud from "./ClientSelectedEntityHud.svelte";
	import ClientShortcutDock, {
		createClientShortcuts,
		type ClientSystemPanel,
	} from "./ClientShortcutDock.svelte";
	import ClientToastOverlay from "./ClientToastOverlay.svelte";
	import ClientTargetIndicator from "./ClientTargetIndicator.svelte";
	import type { ClientTargetIndicatorFrame } from "./client-target-indicator";
	import type { ClientCombatMode, ClientVital } from "./client-host-contract";
	import type { ClientToast } from "./client-toast-center";
	import { CLIENT_TUNING } from "./client-tuning";
	import {
		anchorClientHudPlacement,
		createClientHudLayout,
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
		/** App-owned layout mode also gates gameplay shortcuts. */
		readonly hudMode: "runtime" | "layout";
		readonly onHudModeChange: (mode: "runtime" | "layout") => void;
		/** Session-local bindings shared with game dispatch. */
		readonly spellBar: ClientSpellBarState;
		readonly onSpellBarChange: (value: ClientSpellBarState) => void;
		/** App-owned casting availability, independent of membership. */
		readonly spellBarEnabled: boolean;
		readonly onSelectSpellTab: (tab: InputDigitIndex) => void;
		readonly onActivateSpellCell: (slot: InputDigitIndex) => void;
		/** Server-confirmed stance for the dock, independent of open panels. */
		readonly combatMode: ClientCombatMode;
		/** Shared normal casting action used by the spell browser. */
		readonly onCastSpell: (spellId: number) => void;
		/** Gameplay lifecycle admits stance commands. */
		readonly combatEnabled: boolean;
		/** Same stance action used by the keyboard binding. */
		readonly onToggleCombat: () => void;
		/** Resolve world inventory destinations without changing selection. */
		onPickInventoryTarget: ClientViewportTargetPicker;
		/** Ordinary inventory refusal feedback. */
		onInventoryNotice: (message: string) => void;
		/** Startup catalog availability for switch classification diagnostics. */
		readonly entityMetadata: WeenieCatalogCapability | null;
		readonly cameraController: ClientViewportCameraController | null;
		readonly debugEnabled: boolean;
		readonly readMinimapFrame: () => MinimapFrame;
		readonly readDiagnostics: () => ClientPresentationDiagnostics | null;
		/** Client-owned selected facts with optional presentation details. */
		readonly readSelectedEntity: () => ClientSelectedEntity | null;
		readonly readFrameRates: () => FrameRates | null;
		/** Lazily retained spell artwork, independent of floating-panel mounts. */
		readonly spells: ClientSpellServices | null;
		/** Session-owned inventory state, independent of floating-panel mounts. */
		readonly inventory: ClientInventoryState | null;
		/** Shared use/combining owner for all mounted entry points. */
		readonly itemInteractions: ClientItemInteractions | null;
		readonly onSelectInventoryItem: (
			guid: number,
			mode: "toggle" | "select",
		) => void;
		readonly readSelectedEntityDisplay: () => ClientSelectedEntityDisplay;
		/** Use the currently selected entity through the session-owned interaction controller. */
		readonly onInteractEntity: () => void;
		readonly readTargetIndicatorFrame: () => ClientTargetIndicatorFrame | null;
		readonly selectedEntityGuid: number | null;
		readonly hoveredEntityGuid: number | null;
		/** Runtime-confirmed local player response override. */
		readonly entityCollisionDisabled: boolean;
		readonly onEntityCollisionDisabledChange: (disabled: boolean) => void;
		/** Explicit local override of authored useability for diagnostic requests. */
		readonly unrestrictedUse: boolean;
		readonly onUnrestrictedUseChange: (enabled: boolean) => void;
		/** Session-local spacing override for distance-triggered particles. */
		readonly particleDistanceSpacingMultiplier: number;
		readonly onParticleDistanceSpacingChange: (multiplier: number) => void;
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
		readonly onCanvas: (canvas: HTMLCanvasElement | null) => void;
	}

	let {
		hudMode,
		onHudModeChange,
		spellBar,
		onSpellBarChange,
		spellBarEnabled,
		onSelectSpellTab,
		onActivateSpellCell,
		combatMode,
		onCastSpell,
		combatEnabled,
		onToggleCombat,
		entityMetadata,
		cameraController,
		debugEnabled,
		readMinimapFrame,
		readDiagnostics,
		readSelectedEntity,
		readFrameRates,
		readSelectedEntityDisplay,
		spells,
		inventory,
		itemInteractions,
		onSelectInventoryItem,
		onPickInventoryTarget,
		onInventoryNotice,
		onInteractEntity,
		readTargetIndicatorFrame,
		selectedEntityGuid,
		hoveredEntityGuid,
		entityCollisionDisabled,
		onEntityCollisionDisabledChange,
		unrestrictedUse,
		onUnrestrictedUseChange,
		particleDistanceSpacingMultiplier,
		onParticleDistanceSpacingChange,
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
		onCanvas,
	}: Props = $props();
	const { viewport: inputGate, keyboard } = useAppInputPolicy();
	/** Pointer surface changes are cold; world geometry still uses the existing hover picker. */
	let combineSurface = $state<number | "world" | "self" | null>(null);
	function considerPointer(event: PointerEvent): void {
		const element = event.target instanceof Element ? event.target : null;
		const cell = element?.closest<HTMLElement>(
			".item-grid-cell[data-item-guid]",
		);
		combineSurface = cell
			? Number(cell.dataset.itemGuid)
			: element?.closest("[data-combine-self]")
				? "self"
				: element?.closest(".client-canvas")
					? "world"
					: null;
	}
	let itemInteraction = $state<ItemInteractionState>({ kind: "idle" });
	const combining = $derived(itemInteraction.kind === "acquiring");
	const combineEligibility = $derived(
		itemInteraction.kind === "acquiring"
			? (itemInteraction.considered?.eligibility ?? "neutral")
			: "neutral",
	);
	$effect(() => {
		if (combining)
			itemInteractions?.consider(
				combineSurface === "world" ? hoveredEntityGuid : combineSurface,
			);
	});

	$effect(() => {
		const owner = itemInteractions;
		itemInteraction = owner?.snapshot() ?? { kind: "idle" };
		return owner?.subscribe((state) => {
			itemInteraction = state;
		});
	});
	let itemDrag: ClientItemDrag | null = null;
	let spellDrag: ClientSpellDrag | null = null;
	onMount(() =>
		keyboard.bindEscapeCancellation(
			() =>
				spellDrag?.cancel() ||
				itemDrag?.cancel() ||
				itemInteractions?.cancel() ||
				false,
		),
	);
	$effect(() => {
		const root = worldElement;
		if (root === null) return;
		const owner = new ClientSpellDrag(root, {
			read: (cell) => spellBar.tabs[cell.tab][cell.slot],
			bind: (cell, spell) =>
				onSpellBarChange(bindSpellCell(spellBar, cell, spell)),
			transfer: (source, target) =>
				onSpellBarChange(
					target === null
						? bindSpellCell(spellBar, source, null)
						: swapSpellCells(spellBar, source, target),
				),
			begin: () => {
				itemDrag?.cancel();
				itemInteractions?.cancel();
			},
			available: () => spellBarEnabled || hudMode === "layout",
		});
		spellDrag = owner;
		return () => {
			owner.destroy();
			if (spellDrag === owner) spellDrag = null;
		};
	});
	$effect(() => {
		// Cold identity/visibility changes cancel before a hidden tab or retired source can commit.
		spellBar;
		spellBarEnabled;
		hudMode;
		spells;
		spellDrag?.cancel();
	});
	onMount(() => keyboard.mount(document));
	onMount(() => inputGate.attach(cancelViewportGesture));
	onMount(() =>
		inputGate.attach(() => {
			spellDrag?.cancel();
		}),
	);

	const initialViewport: ClientHudViewport = {
		width: window.innerWidth,
		height: window.innerHeight,
	};
	/** HUD shape is independent of selected spell tab and casting stance. */
	let spellBarShape = $state<"single" | "double">("single");
	let activePanel = $state<ClientSystemPanel | null>(null);
	let worldElement = $state<HTMLElement | null>(null);
	let viewport = $state<ClientHudViewport>(initialViewport);
	// The launch capability is immutable; snapshotting it avoids resetting edited HUD layout.
	const shortcuts = untrack(() => createClientShortcuts(debugEnabled));
	let hudLayout = $state(
		createClientHudLayout(
			CLIENT_UI_DEFAULTS,
			initialViewport,
			shortcuts.length,
		),
	);
	let mapViewDiameters = $state<MinimapState["viewDiameters"]>({
		...MAP_DEFAULT_VIEW_DIAMETERS,
	});
	const resolvedMapPlacement = $derived(
		resolveClientHudSquarePlacement(
			hudLayout.minimap,
			viewport,
			CLIENT_UI_DEFAULTS.minimap.minSize,
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
			if (inputGate.allowed && hasPointerPosition)
				onPreciseJumpAim(pointerX, pointerY);
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
			if (!inputGate.allowed || !pointerInsideCanvas || !hasPointerPosition)
				return;
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
		if (!inputGate.allowed) return;
		if (preciseJumpActive && APP_INPUT.pointer("preciseJumpActivate", event)) {
			event.preventDefault();
			onPreciseJumpActivate();
			return;
		}
		if (
			cameraController === null ||
			!APP_INPUT.pointer("clientInteract", event) ||
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
		canvasElement?.setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!inputGate.allowed) return;
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
		if (!inputGate.allowed || cameraController === null) return;
		event.preventDefault();
		cameraController.zoom(event.deltaY * 0.01);
	}
</script>

<main
	bind:this={worldElement}
	class="client-world ui-theme"
	class:combining
	data-combine-eligibility={combineEligibility}
	onpointerover={considerPointer}
	onpointerleave={() => (combineSurface = null)}
	onpointerdowncapture={(event) => {
		if (
			event.target instanceof Element &&
			event.target.closest(".layout-handle")
		)
			itemInteractions?.cancel();
	}}
	aria-label="Holtburger client world"
>
	<canvas
		bind:this={canvasElement}
		class="client-canvas"
		class:client-canvas-entity-hovered={hoveredEntityGuid !== null}
		aria-label="Game world"
		tabindex="-1"
		data-game-viewport
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
		class="client-ui-lock ui-hud-button"
		aria-label={hudMode === "runtime" ? "Unlock UI layout" : "Lock UI layout"}
		aria-pressed={hudMode === "layout"}
		title={hudMode === "runtime" ? "Unlock UI layout" : "Lock UI layout"}
		onclick={() =>
			onHudModeChange(hudMode === "runtime" ? "layout" : "runtime")}
	>
		<ClientHudIcon name={hudMode === "runtime" ? "locked" : "unlocked"} />
	</button>

	<Minimap
		readFrame={readMinimapFrame}
		viewState={minimap}
		minSize={CLIENT_UI_DEFAULTS.minimap.minSize}
		resizable={CLIENT_UI_DEFAULTS.minimap.resizable}
		editable={hudMode === "layout"}
		onStateChange={updateMinimap}
		{onSelectEntity}
	/>
	{#if inventory !== null && worldElement !== null && itemInteractions !== null}
		{#key inventory}
			<ClientActionBars
				onDragOwner={(owner) => (itemDrag = owner)}
				{onPickInventoryTarget}
				{onInventoryNotice}
				interactions={itemInteractions}
				onSelectDragItem={(guid) => onSelectInventoryItem(guid, "select")}
				root={worldElement}
				{inventory}
				{viewport}
				editable={hudMode === "layout"}
			/>
		{/key}
	{/if}

	{#if spells !== null && (spellBarEnabled || hudMode === "layout")}
		<ClientSpellBar
			{spells}
			configuration={spellBar}
			enabled={spellBarEnabled}
			placement={hudLayout.spellBar}
			shape={spellBarShape}
			editable={hudMode === "layout"}
			{viewport}
			onPlacementChange={(placement) =>
				(hudLayout = { ...hudLayout, spellBar: placement })}
			onShapeChange={(shape) => (spellBarShape = shape)}
			onSelectTab={onSelectSpellTab}
			onActivateCell={onActivateSpellCell}
		/>
	{/if}

	<ClientHudPanel
		label="Character HUD"
		placement={hudLayout.character}
		editable={hudMode === "layout"}
		minWidth={CLIENT_UI_DEFAULTS.character.minSize.width}
		minHeight={CLIENT_UI_DEFAULTS.character.minSize.height}
		resizable={CLIENT_UI_DEFAULTS.character.resizable}
		contentHitTesting="surface"
		{viewport}
		onPlacementChange={(character) => (hudLayout = { ...hudLayout, character })}
	>
		<ClientCharacterHud {playerName} {worldName} {vitals} />
		{#if itemInteraction.kind === "acquiring"}
			<button
				data-combine-self
				class="ui-button"
				onclick={() => itemInteractions?.targetSelf()}>Use on self</button
			>
		{/if}
	</ClientHudPanel>
	{#if jumpChargeActive || hudMode === "layout"}
		<ClientHudPanel
			label="Jump power"
			placement={hudLayout.jumpPower}
			editable={hudMode === "layout"}
			minWidth={CLIENT_UI_DEFAULTS.jumpPower.minSize.width}
			minHeight={CLIENT_UI_DEFAULTS.jumpPower.minSize.height}
			resizable={CLIENT_UI_DEFAULTS.jumpPower.resizable}
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
	{#if toast !== null || combining || hudMode === "layout"}
		<ClientHudPanel
			label="Notifications"
			placement={hudLayout.toast}
			editable={hudMode === "layout"}
			minWidth={CLIENT_UI_DEFAULTS.toast.minSize.width}
			minHeight={CLIENT_UI_DEFAULTS.toast.minSize.height}
			resizable={CLIENT_UI_DEFAULTS.toast.resizable}
			contentHitTesting="descendants"
			{viewport}
			onPlacementChange={(toastPlacement) =>
				(hudLayout = { ...hudLayout, toast: toastPlacement })}
		>
			<ClientToastOverlay
				{toast}
				persistentMessage={itemInteraction.kind === "acquiring"
					? {
							kind: "status",
							message: `Use ${itemInteraction.name} on… (Escape to cancel)`,
						}
					: hudMode === "layout"
						? { kind: "preview", message: HUD_PREVIEW_TOAST_MESSAGE }
						: null}
			/>
		</ClientHudPanel>
	{/if}
	<ClientHudPanel
		label="Chat"
		placement={hudLayout.chat}
		editable={hudMode === "layout"}
		minWidth={CLIENT_UI_DEFAULTS.chat.minSize.width}
		minHeight={CLIENT_UI_DEFAULTS.chat.minSize.height}
		resizable={CLIENT_UI_DEFAULTS.chat.resizable}
		contentHitTesting="descendants"
		{viewport}
		onPlacementChange={(chat) => (hudLayout = { ...hudLayout, chat })}
	>
		<ClientChat messages={chatMessages} onSend={onSendChat} />
	</ClientHudPanel>
	<ClientHudPanel
		label="Frame rate"
		placement={hudLayout.frameRate}
		editable={hudMode === "layout"}
		minWidth={CLIENT_UI_DEFAULTS.frameRate.minSize.width}
		minHeight={CLIENT_UI_DEFAULTS.frameRate.minSize.height}
		resizable={CLIENT_UI_DEFAULTS.frameRate.resizable}
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
			minWidth={CLIENT_UI_DEFAULTS.selectedEntity.minSize.width}
			minHeight={CLIENT_UI_DEFAULTS.selectedEntity.minSize.height}
			resizable={CLIENT_UI_DEFAULTS.selectedEntity.resizable}
			contentHitTesting="descendants"
			{viewport}
			onPlacementChange={(selectedEntity) =>
				(hudLayout = { ...hudLayout, selectedEntity })}
		>
			<ClientSelectedEntityHud
				selectedGuid={selectedEntityGuid}
				readSelectedDisplay={() => {
					const display = readSelectedEntityDisplay();
					return itemInteraction.kind === "acquiring" &&
						selectedEntityGuid !== null
						? { ...display, canInteract: true }
						: display;
				}}
				onInteract={onInteractEntity}
			/>
		</ClientHudPanel>
	{/if}
	<ClientHudPanel
		label="Game shortcuts"
		placement={hudLayout.shortcuts}
		editable={hudMode === "layout"}
		minWidth={CLIENT_UI_DEFAULTS.shortcuts.minSize.width}
		minHeight={CLIENT_UI_DEFAULTS.shortcuts.minSize.height}
		resizable={CLIENT_UI_DEFAULTS.shortcuts.resizable}
		contentHitTesting="surface"
		{viewport}
		onPlacementChange={(shortcuts) => (hudLayout = { ...hudLayout, shortcuts })}
	>
		<ClientShortcutDock
			{combatMode}
			{combatEnabled}
			{onToggleCombat}
			{shortcuts}
			{activePanel}
			onToggle={(panel) => (activePanel = activePanel === panel ? null : panel)}
		/>
	</ClientHudPanel>
	{#if activePanel !== null}
		{@const panel = activePanel}
		{#key panel}
			<ClientHudWindow
				icon={panel}
				title={panel === "inventory"
					? "Inventory"
					: panel === "spells"
						? "Spells"
						: "Client diagnostics"}
				placement={hudLayout[panel]}
				minWidth={CLIENT_UI_DEFAULTS[panel].minSize.width}
				minHeight={CLIENT_UI_DEFAULTS[panel].minSize.height}
				{viewport}
				onClose={() => (activePanel = null)}
				onPlacementChange={(placement) =>
					(hudLayout = { ...hudLayout, [panel]: placement })}
			>
				{#if panel === "spells"}
					{#if spells !== null}{#key spells}<ClientSpellsPanel
								{spells}
								castEnabled={combatEnabled && combatMode === "magic"}
								{onCastSpell}
							/>{/key}{/if}
				{:else if panel === "inventory"}
					{#if inventory !== null && itemInteractions !== null}
						{#key inventory}
							<ClientInventoryPanel
								interactions={itemInteractions}
								{inventory}
								selectedGuid={selectedEntityGuid}
								onSelectItem={(guid) => onSelectInventoryItem(guid, "toggle")}
							/>
						{/key}
					{/if}
				{:else}
					<ClientDebugPanel
						{entityMetadata}
						{readDiagnostics}
						{readSelectedEntity}
						{entityCollisionDisabled}
						{onEntityCollisionDisabledChange}
						{unrestrictedUse}
						{onUnrestrictedUseChange}
						{particleDistanceSpacingMultiplier}
						{onParticleDistanceSpacingChange}
						{showRetailHiddenGeometry}
						{onShowRetailHiddenGeometryChange}
					/>
				{/if}
			</ClientHudWindow>
		{/key}
	{/if}
</main>

<style>
	@layer components {
		.combining {
			--combine-cursor: url("./combine-cursor.svg") 12 12, crosshair;
		}
		.combining[data-combine-eligibility="eligible"] {
			--combine-cursor: url("./combine-cursor-eligible.svg") 12 12, crosshair;
		}
		.combining[data-combine-eligibility="ineligible"] {
			--combine-cursor: url("./combine-cursor-ineligible.svg") 12 12, crosshair;
		}
		.client-world.combining :global(.client-canvas),
		.client-world.combining :global(.item-grid-cell),
		.client-world.combining [data-combine-self] {
			cursor: var(--combine-cursor);
		}
	}
	@layer components {
		.client-world {
			position: fixed;
			inset: 0;
			overflow: hidden;
			background: var(--ui-color-well);
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
		}
	}
</style>
