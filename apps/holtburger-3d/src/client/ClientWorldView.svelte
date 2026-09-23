<script lang="ts">
	import ClientVendorWindow from "./ClientVendorWindow.svelte";
	import type { ClientVendorState } from "./client-vendor-state";
	import type { ItemDragSession } from "./client-item-drag";
	import ClientWorldContainerWindow from "./ClientWorldContainerWindow.svelte";
	import ClientInspectionWindow from "./ClientInspectionWindow.svelte";
	import type { ClientWorldContainerPanelState } from "./client-world-container-panel-state";
	import { ClientSpellDrag } from "./client-spell-drag";
	import type { ClientItemDrag } from "./client-item-drag";
	import { bindSpellCell, swapSpellCells } from "./client-spell-bar-state";
	import type { ClientSpellBarState } from "./client-spell-bar-state";
	import type {
		ClientKeyboardConfiguration,
		InputDigitIndex,
	} from "../lib/input/input-contract";
	import { inputDisplayPlatform } from "../lib/input/input-presentation";
	import ClientSpellBar from "./ClientSpellBar.svelte";
	import ClientCombatBar from "./ClientCombatBar.svelte";
	import type { ClientViewportTargetPicker } from "./client-pointer-selection-controller";
	import type {
		ClientItemInteractions,
		ItemInteractionState,
	} from "./client-item-interactions";
	import type { ClientSelectedEntity } from "./client-selected-entity";
	import type { WeenieCatalogCapability } from "../lib/host/weenie-catalog-capability";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";

	import { useClientInput } from "./client-input-context";
	import { onMount, untrack } from "svelte";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import Minimap from "../app/Minimap.svelte";
	import type { FrameRates } from "../app/frame-rate-sampler";
	import type { MinimapFrame, MinimapState } from "../app/minimap-frame";
	import ClientCharacterHud from "./ClientCharacterHud.svelte";
	import ClientJumpPowerBar from "./ClientJumpPowerBar.svelte";
	import ClientChat from "./ClientChat.svelte";
	import type { ClientChatLine } from "./client-chat-policy";
	import ClientActionBars from "./ClientActionBars.svelte";
	import type { ClientActionBar } from "./client-action-bar-state";
	import ClientSpellsPanel from "./ClientSpellsPanel.svelte";
	import type { ClientSpellServices } from "./client-spells";
	import ClientInventoryPanel from "./ClientInventoryPanel.svelte";
	import {
		isSplittableInventoryItem,
		type InventorySplitStart,
	} from "./client-inventory-split";
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
	import type { ClientObjectInspectionState } from "./client-object-inspection";
	import type {
		ClientAttackProfile,
		ClientCombatMode,
		ClientCombatStatus,
		ClientAppearanceOption,
		ClientAppearanceOptions,
		ClientVital,
	} from "./client-host-contract";
	import type {
		ClientCharacterSettings,
		ClientGraphicsSettings,
		ClientUiSettings,
	} from "./client-settings-contract";
	import ClientSettingsPanel, {
		type SettingsTab,
	} from "./ClientSettingsPanel.svelte";
	import type { TextureFilteringCapabilities } from "../lib/game/renderer/texture-filtering-policy";
	import type { ClientToast } from "./client-toast-center";
	import { CLIENT_TUNING } from "./client-tuning";
	import {
		anchorClientHudPlacement,
		createClientHudLayout,
		resolveClientHudSquarePlacement,
		type ClientHudLayout,
		type ClientHudViewport,
	} from "./client-hud-layout";
	import type { ClientChatFilterTag } from "./client-chat-policy";
	import type { ClientPresentationDiagnostics } from "./client-presentation-session";
	import type { ClientObjectPreviewService } from "./client-object-preview-service";
	import {
		advanceClientViewportPointerGesture,
		beginClientViewportPointerGesture,
		type ClientViewportCameraController,
		type ClientViewportPointerGesture,
	} from "./client-viewport-pointer-gesture";

	interface Props {
		/** User-scoped fixed HUD geometry, independent of open-panel state. */
		readonly hudLayout: ClientHudLayout;
		readonly onHudLayoutChange: (layout: ClientHudLayout) => void;
		readonly spellBarShape: "single" | "double";
		readonly onSpellBarShapeChange: (shape: "single" | "double") => void;
		readonly minimapViewDiameters: MinimapState["viewDiameters"];
		readonly onMinimapViewDiametersChange: (
			value: MinimapState["viewDiameters"],
		) => void;
		readonly chatFilters: readonly ClientChatFilterTag[];
		readonly onChatFiltersChange: (
			value: readonly ClientChatFilterTag[],
		) => void;
		/** User-scoped divider height inside creature inspections. */
		readonly inspectionPreviewHeight: number;
		/** User graphics snapshot and focused edit operation. */
		readonly graphics: ClientGraphicsSettings;
		readonly ui: ClientUiSettings;
		readonly input: ClientKeyboardConfiguration;
		readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
		readonly onGraphicsChange: (graphics: ClientGraphicsSettings) => void;
		readonly onUiChange: (ui: ClientUiSettings) => void;
		readonly onInputChange: (input: ClientKeyboardConfiguration) => void;
		readonly onInspectionPreviewHeightChange: (height: number) => void;
		/** App-owned layout mode also gates gameplay shortcuts. */
		readonly hudMode: "runtime" | "layout";
		readonly onHudModeChange: (mode: "runtime" | "layout") => void;
		/** Session-local bindings shared with game dispatch. */
		readonly spellBar: ClientSpellBarState;
		readonly onSpellBarChange: (value: ClientSpellBarState) => void;
		/** App-owned casting availability, independent of membership. */
		readonly spellBarEnabled: boolean;
		readonly onSelectSpellTab: (tab: InputDigitIndex) => void;
		readonly onActivateSpellCell: (slot: number) => void;
		readonly onActivateCasterSpell: () => void;
		/** Null while no authoritative character profile is ready. */
		readonly actionBars: readonly ClientActionBar[] | null;
		readonly onActionBarsChange: (bars: readonly ClientActionBar[]) => void;
		/** Server-confirmed stance for the dock, independent of open panels. */
		readonly combatMode: ClientCombatMode;
		readonly combatStatus: ClientCombatStatus;
		readonly combatControls: ClientCharacterSettings["combatControls"];
		/** Accepted setting interactions used to replay combat-HUD feedback. */
		readonly combatProfileSelectionRevision: number;
		readonly onCombatProfileSelect: (profile: ClientAttackProfile) => void;
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
		/** Direct authority for cross-panel item gestures. */
		readonly itemSession: ItemDragSession | null;
		/** Session-owned vendor draft and catalog presentation. */
		readonly vendor: ClientVendorState | null;
		/** Presentation owner for confirmed external storage, independent of system-panel selection. */
		readonly worldContainer: ClientWorldContainerPanelState | null;
		/** Shared use/combining owner for all mounted entry points. */
		readonly itemInteractions: ClientItemInteractions | null;
		readonly onSelectContentsItem: (
			guid: number,
			mode: "toggle" | "select",
		) => void;
		readonly readSelectedEntityDisplay: () => ClientSelectedEntityDisplay;
		/** Use the currently selected entity through the session-owned interaction controller. */
		readonly onInteractEntity: () => void;
		/** Latest captured examination request, independent of current selection. */
		readonly objectInspection: ClientObjectInspectionState;
		readonly objectPreviewService: ClientObjectPreviewService;
		readonly onExamineEntity: () => void;
		/** Select and examine an entity represented by an item-backed HUD cell. */
		readonly onExamineItem: (guid: number) => void;
		readonly onCloseInspection: () => void;
		readonly readTargetIndicatorFrame: () => ClientTargetIndicatorFrame | null;
		readonly selectedEntityGuid: number | null;
		readonly hoveredEntityGuid: number | null;
		/** Runtime-confirmed local player response override. */
		readonly entityCollisionDisabled: boolean;
		readonly onEntityCollisionDisabledChange: (disabled: boolean) => void;
		/** Explicit local override of authored useability for diagnostic requests. */
		readonly unrestrictedUse: boolean;
		readonly onUnrestrictedUseChange: (enabled: boolean) => void;
		readonly showRetailHiddenGeometry: boolean;
		readonly onShowRetailHiddenGeometryChange: (visible: boolean) => void;
		readonly playerName: string | null;
		readonly worldName: string | null;
		readonly vitals: readonly ClientVital[];
		readonly appearanceOptions: ClientAppearanceOptions | null;
		readonly onAppearanceOptionChange: (
			option: ClientAppearanceOption,
			enabled: boolean,
		) => Promise<void>;
		readonly jumpChargeActive: boolean;
		readonly readJumpExtent: () => number;
		readonly toast: ClientToast | null;
		readonly preciseJumpActive: boolean;
		readonly onPreciseJumpAim: (clientX: number, clientY: number) => void;
		readonly onPreciseJumpActivate: () => void;
		readonly onPreciseJumpEnter: () => void;
		readonly onViewportSelect: (clientX: number, clientY: number) => void;
		readonly onViewportExamine: (clientX: number, clientY: number) => void;
		readonly onViewportHover: (clientX: number, clientY: number) => void;
		/** Clear world hover and invalidate in-flight acquisition on surface exit. */
		readonly onViewportHoverClear: () => void;
		readonly onMaintainEntitySelection: () => void;
		readonly onSelectEntity: (guid: number | null) => void;
		readonly chatMessages: readonly ClientChatLine[];
		readonly onSendChat: (message: string) => Promise<void>;
		readonly onCanvas: (canvas: HTMLCanvasElement | null) => void;
	}

	let {
		hudLayout,
		onHudLayoutChange,
		spellBarShape,
		onSpellBarShapeChange,
		minimapViewDiameters,
		onMinimapViewDiametersChange,
		chatFilters,
		onChatFiltersChange,
		inspectionPreviewHeight,
		onInspectionPreviewHeightChange,
		graphics,
		ui,
		input,
		textureFilteringCapabilities,
		onGraphicsChange,
		onUiChange,
		onInputChange,
		hudMode,
		onHudModeChange,
		spellBar,
		onSpellBarChange,
		spellBarEnabled,
		onSelectSpellTab,
		onActivateSpellCell,
		onActivateCasterSpell,
		actionBars,
		onActionBarsChange,
		combatMode,
		combatStatus,
		combatControls,
		combatProfileSelectionRevision,
		onCombatProfileSelect,
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
		itemSession,
		worldContainer,
		vendor,
		itemInteractions,
		onSelectContentsItem,
		onPickInventoryTarget,
		onInventoryNotice,
		onInteractEntity,
		objectInspection,
		objectPreviewService,
		onExamineEntity,
		onExamineItem,
		onCloseInspection,
		readTargetIndicatorFrame,
		selectedEntityGuid,
		hoveredEntityGuid,
		entityCollisionDisabled,
		onEntityCollisionDisabledChange,
		unrestrictedUse,
		onUnrestrictedUseChange,
		showRetailHiddenGeometry,
		onShowRetailHiddenGeometryChange,
		playerName,
		worldName,
		vitals,
		appearanceOptions,
		onAppearanceOptionChange,
		jumpChargeActive,
		readJumpExtent,
		toast,
		preciseJumpActive,
		onPreciseJumpAim,
		onPreciseJumpActivate,
		onPreciseJumpEnter,
		onViewportSelect,
		onViewportExamine,
		onViewportHover,
		onViewportHoverClear,
		onMaintainEntitySelection,
		onSelectEntity,
		chatMessages,
		onSendChat,
		onCanvas,
	}: Props = $props();
	const { viewport: inputGate, keyboard } = useAppInputPolicy();
	const clientInput = useClientInput();
	const displayPlatform = inputDisplayPlatform(navigator.userAgent);
	/** Pointer surface changes are cold; world geometry still uses the existing hover picker. */
	let combineSurface = $state<number | "world" | null>(null);
	function considerPointer(event: PointerEvent): void {
		const element = event.target instanceof Element ? event.target : null;
		const cell = element?.closest<HTMLElement>(
			".item-grid-cell[data-item-guid]",
		);
		combineSurface = cell
			? Number(cell.dataset.itemGuid)
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
	let activePanel = $state<ClientSystemPanel | null>(null);
	let settingsTab = $state<SettingsTab>("graphics");
	/** One selected-HUD request retained only until the inventory panel accepts it. */
	let requestedInventorySplit = $state<InventorySplitStart | null>(null);
	let worldElement = $state<HTMLElement | null>(null);
	let viewport = $state<ClientHudViewport>(initialViewport);
	// The launch capability is immutable; snapshotting it avoids resetting edited HUD layout.
	const shortcuts = untrack(() => createClientShortcuts(debugEnabled));
	let resetActionBars = $state<(() => boolean) | null>(null);
	function resetHudPlacements(): void {
		if (resetActionBars === null || !resetActionBars()) return;
		onHudLayoutChange(
			createClientHudLayout(CLIENT_UI_DEFAULTS, viewport, shortcuts.length),
		);
	}
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
		viewDiameters: minimapViewDiameters,
	});
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let viewportGesture: ClientViewportPointerGesture | null = null;
	let pointerX = 0;
	let pointerY = 0;
	let hasPointerPosition = false;
	let pointerInsideCanvas = false;
	const HUD_PREVIEW_JUMP_EXTENT = 0.45;
	const HUD_PREVIEW_TOAST_MESSAGE = "Notification preview";

	function canSplitSelectedEntity(): boolean {
		return (
			selectedEntityGuid !== null &&
			inventory !== null &&
			isSplittableInventoryItem(inventory.readItem(selectedEntityGuid))
		);
	}

	function splitSelectedEntity(source: HTMLButtonElement): void {
		if (!canSplitSelectedEntity() || selectedEntityGuid === null) return;
		requestedInventorySplit = { item: selectedEntityGuid, source };
		activePanel = "inventory";
	}

	$effect(() => {
		if (activePanel !== "inventory") requestedInventorySplit = null;
	});

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
			if (!inputGate.allowed || !pointerInsideCanvas || !hasPointerPosition) {
				onViewportHoverClear();
				return;
			}
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
		onMinimapViewDiametersChange(next.viewDiameters);
		const sizeChanged = next.size !== resolvedMapPlacement.width;
		const preferredSize = sizeChanged
			? next.size
			: hudLayout.minimap.preferredWidth;
		const minimapPlacement = anchorClientHudPlacement(
			{ left: next.left, top: next.top, width: next.size, height: next.size },
			viewport,
			{ width: preferredSize, height: preferredSize },
		);
		changeHudPlacement("minimap", minimapPlacement);
	}

	function changeHudPlacement<Surface extends keyof ClientHudLayout>(
		surface: Surface,
		placement: ClientHudLayout[Surface],
	): void {
		onHudLayoutChange({ ...hudLayout, [surface]: placement });
	}

	function handlePointerDown(event: PointerEvent): void {
		if (!inputGate.allowed) return;
		if (clientInput.pointer("clientExamine", event)) {
			event.preventDefault();
			onViewportExamine(event.clientX, event.clientY);
			return;
		}
		if (
			preciseJumpActive &&
			clientInput.pointer("preciseJumpActivate", event)
		) {
			event.preventDefault();
			onPreciseJumpActivate();
			return;
		}
		if (
			cameraController === null ||
			!clientInput.pointer("clientInteract", event) ||
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
		onViewportHoverClear();
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

	/** Explorer-wide context-click policy for entity-bearing HUD cells and the viewport. */
	function handleContextMenu(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest(".client-canvas")) {
			event.preventDefault();
			return;
		}
		const cell = target?.closest<HTMLElement>(
			".item-grid-cell[data-item-guid]:not(:disabled), [data-action-cell][data-action-item]",
		);
		if (cell === undefined || cell === null || !worldElement?.contains(cell))
			return;
		const encodedGuid = cell.dataset.itemGuid ?? cell.dataset.actionItem;
		const guid = Number(encodedGuid);
		if (!Number.isSafeInteger(guid) || guid < 0)
			throw new Error(`Invalid item cell GUID ${encodedGuid ?? "missing"}`);
		event.preventDefault();
		onExamineItem(guid);
	}
</script>

<main
	bind:this={worldElement}
	class="client-world ui-theme"
	class:combining
	data-combine-eligibility={combineEligibility}
	onpointerover={considerPointer}
	onpointerleave={() => (combineSurface = null)}
	oncontextmenu={handleContextMenu}
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
	{#if actionBars !== null && inventory !== null && itemSession !== null && worldElement !== null && itemInteractions !== null}
		{#key inventory}
			<ClientActionBars
				{input}
				{displayPlatform}
				bars={actionBars}
				onBarsChange={onActionBarsChange}
				onResetOwner={(reset) => (resetActionBars = reset)}
				session={itemSession}
				{worldContainer}
				{vendor}
				onDragOwner={(owner) => (itemDrag = owner)}
				{onPickInventoryTarget}
				{onInventoryNotice}
				interactions={itemInteractions}
				onSelectDragItem={(guid) => onSelectContentsItem(guid, "select")}
				root={worldElement}
				{inventory}
				{viewport}
				editable={hudMode === "layout"}
			/>
		{/key}
	{/if}

	{#if actionBars !== null && spells !== null && (spellBarEnabled || (hudMode === "layout" && combatMode !== "melee" && combatMode !== "missile"))}
		<ClientSpellBar
			input={input.spellBar}
			{displayPlatform}
			{spells}
			{inventory}
			{itemInteractions}
			configuration={spellBar}
			enabled={spellBarEnabled}
			placement={hudLayout.spellBar}
			shape={spellBarShape}
			editable={hudMode === "layout"}
			{viewport}
			onPlacementChange={(placement) =>
				changeHudPlacement("spellBar", placement)}
			onShapeChange={onSpellBarShapeChange}
			onSelectTab={onSelectSpellTab}
			onActivateCell={onActivateSpellCell}
			onActivateCaster={onActivateCasterSpell}
		/>
	{/if}
	{#if combatMode === "melee" || combatMode === "missile"}
		<ClientCombatBar
			{inventory}
			input={input.combatBar}
			{displayPlatform}
			placement={hudLayout.combatBar}
			editable={hudMode === "layout"}
			{viewport}
			status={combatStatus}
			selectionRevision={combatProfileSelectionRevision}
			profile={combatMode === "melee"
				? { kind: "melee", ...combatControls.melee }
				: { kind: "missile", ...combatControls.missile }}
			enabled={combatEnabled && hudMode === "runtime"}
			onPlacementChange={(placement) =>
				changeHudPlacement("combatBar", placement)}
			onProfileSelect={onCombatProfileSelect}
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
		onPlacementChange={(placement) =>
			changeHudPlacement("character", placement)}
	>
		<ClientCharacterHud {playerName} {worldName} {vitals} />
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
			onPlacementChange={(placement) =>
				changeHudPlacement("jumpPower", placement)}
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
			onPlacementChange={(placement) => changeHudPlacement("toast", placement)}
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
		onPlacementChange={(placement) => changeHudPlacement("chat", placement)}
	>
		<ClientChat
			messages={chatMessages}
			onSend={onSendChat}
			enabledTags={chatFilters}
			onEnabledTagsChange={onChatFiltersChange}
		/>
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
		onPlacementChange={(placement) =>
			changeHudPlacement("frameRate", placement)}
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
			onPlacementChange={(placement) =>
				changeHudPlacement("selectedEntity", placement)}
		>
			<ClientSelectedEntityHud
				selectedGuid={selectedEntityGuid}
				readCanSplit={canSplitSelectedEntity}
				readSelectedDisplay={() => {
					const display = readSelectedEntityDisplay();
					return itemInteraction.kind === "acquiring" &&
						selectedEntityGuid !== null
						? { ...display, canInteract: true }
						: display;
				}}
				onInteract={onInteractEntity}
				onExamine={onExamineEntity}
				examinePending={objectInspection.kind === "pending" &&
					objectInspection.guid === selectedEntityGuid}
				onSplit={splitSelectedEntity}
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
		onPlacementChange={(placement) =>
			changeHudPlacement("shortcuts", placement)}
	>
		<ClientShortcutDock
			bindings={input.client.toggleCombat}
			{displayPlatform}
			{combatMode}
			{combatEnabled}
			{onToggleCombat}
			{shortcuts}
			{activePanel}
			onToggle={(panel) => (activePanel = activePanel === panel ? null : panel)}
		/>
	</ClientHudPanel>
	{#if worldContainer !== null && itemInteractions !== null}
		{#key worldContainer}
			<ClientWorldContainerWindow
				model={worldContainer}
				interactions={itemInteractions}
				selectedGuid={selectedEntityGuid}
				onSelectItem={(guid) => onSelectContentsItem(guid, "select")}
				placement={hudLayout.worldContainer}
				{viewport}
				onPlacementChange={(placement) =>
					changeHudPlacement("worldContainer", placement)}
			/>
		{/key}
	{/if}
	{#if vendor !== null}
		{#key vendor}
			<ClientVendorWindow
				model={vendor}
				placement={hudLayout.vendor}
				{viewport}
				onPlacementChange={(placement) =>
					changeHudPlacement("vendor", placement)}
				{onExamineItem}
			/>
		{/key}
	{/if}
	{#if objectInspection.kind === "ready"}
		{#key objectInspection.guid}
			<ClientInspectionWindow
				inspection={objectInspection.inspection}
				nameColor={objectInspection.nameColor}
				preview={objectInspection.preview}
				{objectPreviewService}
				{spells}
				icons={spells?.icons ?? inventory?.icons ?? null}
				placement={hudLayout.inspection}
				{viewport}
				previewHeight={inspectionPreviewHeight}
				onClose={onCloseInspection}
				onPlacementChange={(placement) =>
					changeHudPlacement("inspection", placement)}
				onPreviewHeightChange={onInspectionPreviewHeightChange}
			/>
		{/key}
	{/if}

	{#if activePanel !== null}
		{@const panel = activePanel}
		{#key panel}
			<ClientHudWindow
				icon={panel}
				title={panel === "inventory"
					? "Inventory"
					: panel === "spells"
						? "Spells"
						: panel === "settings"
							? "Settings"
							: "Client diagnostics"}
				placement={hudLayout[panel]}
				minWidth={CLIENT_UI_DEFAULTS[panel].minSize.width}
				minHeight={CLIENT_UI_DEFAULTS[panel].minSize.height}
				{viewport}
				onClose={() => (activePanel = null)}
				onPlacementChange={(placement) => changeHudPlacement(panel, placement)}
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
								onSelectItem={(guid) => onSelectContentsItem(guid, "toggle")}
								requestedSplit={requestedInventorySplit}
								{appearanceOptions}
								{onAppearanceOptionChange}
								onRequestedSplitConsumed={(request) => {
									if (requestedInventorySplit === request)
										requestedInventorySplit = null;
								}}
							/>
						{/key}
					{/if}
				{:else if panel === "settings"}
					<ClientSettingsPanel
						{displayPlatform}
						{graphics}
						{ui}
						{input}
						{textureFilteringCapabilities}
						selectedTab={settingsTab}
						onSelectTab={(tab) => (settingsTab = tab)}
						{onGraphicsChange}
						{onUiChange}
						{onInputChange}
						canResetHudPlacements={resetActionBars !== null}
						onResetHudPlacements={resetHudPlacements}
					/>
				{:else}
					<ClientDebugPanel
						{entityMetadata}
						{readDiagnostics}
						{readSelectedEntity}
						{entityCollisionDisabled}
						{onEntityCollisionDisabledChange}
						{unrestrictedUse}
						{onUnrestrictedUseChange}
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
		.client-world.combining :global(.item-grid-cell) {
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
			z-index: 500;
			width: 28px;
			height: 28px;
			min-height: 0;
			padding: 5px;
		}
	}
</style>
