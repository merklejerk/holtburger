<script lang="ts">
	import ClientEmoteWheel from "./ClientEmoteWheel.svelte";
	import type { MapWaypointTarget } from "../lib/game/map/map-waypoint";
	import ClientLoadoutBuilder from "./ClientLoadoutBuilder.svelte";
	import {
		captureLoadout,
		chooseLoadoutIcon,
		type LoadoutDraft,
	} from "./client-loadout";
	import ClientPartyHud from "./ClientPartyHud.svelte";
	import type { PartyHudDisplay } from "./client-party-hud";
	import ClientJournalPanel from "./ClientJournalPanel.svelte";
	import type { ClientContractsState } from "./client-contracts-state";
	import type { ClientAllegianceState } from "./client-allegiance-state";
	import type { ClientSquelchState } from "./client-squelch-state";
	import type { ClientHousingManagementState } from "./client-housing-management-state";
	import type { HousingSnapshot } from "./client-housing-contract";
	import type { ClientConnectionObservation } from "./client-lifecycle-session";
	import ClientTradeWindow from "./ClientTradeWindow.svelte";
	import type { ClientTradeState } from "./client-trade-state";
	import type { ClientHouseCrystalState } from "./client-house-crystal-state";
	import ClientHouseCrystalWindow from "./ClientHouseCrystalWindow.svelte";
	import ClientVendorWindow from "./ClientVendorWindow.svelte";
	import type { ClientVendorState } from "./client-vendor-state";
	import type { ItemDragSession } from "./client-item-drag";
	import ClientWorldContainerWindow from "./ClientWorldContainerWindow.svelte";
	import ClientInspectionWindow from "./ClientInspectionWindow.svelte";
	import ClientBookWindow from "./ClientBookWindow.svelte";
	import type { ClientBookReaderState } from "./client-book-reader";
	import type { ClientWorldContainerPanelState } from "./client-world-container-panel-state";
	import { ClientSpellDrag } from "./client-spell-drag";
	import type { ClientItemDrag } from "./client-item-drag";
	import { bindSpellCell, swapSpellCells } from "./client-spell-bar-state";
	import type { ClientSpellBarState } from "./client-spell-bar-state";
	import {
		CLIENT_PANEL_SHORTCUT_ACTIONS,
		type ClientKeyboardConfiguration,
		type InputDigitIndex,
	} from "../lib/input/input-contract";
	import { inputDisplayPlatform } from "../lib/input/input-presentation";
	import ClientSpellBar from "./ClientSpellBar.svelte";
	import ClientCombatBar from "./ClientCombatBar.svelte";
	import type { ClientViewportTargetPicker } from "./client-pointer-selection-controller";
	import type {
		ClientItemInteractions,
		ItemInteractionState,
	} from "./client-item-interactions";
	import {
		selectedPlayerTarget,
		type ClientSelectedEntity,
	} from "./client-selected-entity";
	import type { WeenieCatalogCapability } from "../lib/host/weenie-catalog-capability";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";

	import { useClientInput } from "./client-input-context";
	import { onMount, onDestroy, untrack } from "svelte";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import Minimap from "../app/Minimap.svelte";
	import ClientMinimapEnvironment from "./ClientMinimapEnvironment.svelte";
	import type {
		ClientClockFormat,
		ClientEnvironmentOverrides,
	} from "./client-environment-settings";
	import type {
		ClientEnvironmentReadout,
		ClientWeatherPreset,
	} from "./client-environment";
	import type { FrameRates } from "../app/frame-rate-sampler";
	import type {
		MinimapFrame,
		MinimapState,
		MinimapFooterExtent,
	} from "../app/minimap-frame";
	import ClientVitalWarningOverlay from "./ClientVitalWarningOverlay.svelte";
	import ClientCharacterHud from "./ClientCharacterHud.svelte";
	import ClientCharacterSheetPanel from "./ClientCharacterSheetPanel.svelte";
	import type { ClientCharacterSheetState } from "./client-character-sheet-state";
	import ClientStatusTray from "./ClientStatusTray.svelte";
	import ClientEnchantmentsPanel from "./ClientEnchantmentsPanel.svelte";
	import { presentEnchantmentTray } from "./client-enchantments-view";
	import ClientJumpPowerBar from "./ClientJumpPowerBar.svelte";
	import ClientChat from "./ClientChat.svelte";
	import type { ClientChatComposer } from "./client-chat-composer.svelte";
	import type { ChatComposeResolution } from "./client-chat-compose";
	import type { ClientChatLine } from "./client-chat-policy";
	import ClientActionBars from "./ClientActionBars.svelte";
	import type { ClientActionBar } from "./client-action-bar-state";
	import type { ClientFriendsState } from "./client-friends-state";
	import ClientSocialPanel from "./ClientSocialPanel.svelte";
	import type { ClientPartyState } from "./client-party-state";
	import ClientNearbyPanel from "./ClientNearbyPanel.svelte";
	import type { ClientNearby } from "./client-nearby";
	import type { ClientSpellServices } from "./client-spells";
	import ClientInventoryPanel from "./ClientInventoryPanel.svelte";
	import {
		isSplittableInventoryItem,
		type InventorySplitStart,
	} from "./client-inventory-split";
	import type { ClientInventoryState } from "./client-inventory-state";
	import ClientDebugPanel from "./ClientDebugPanel.svelte";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import ClientWorldPanel from "./ClientWorldPanel.svelte";
	import type { WorldMapSource } from "../lib/game/world-map/types";
	import ClientFpsCounter from "./ClientFpsCounter.svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import type { ClientSelectedEntityDisplay } from "./client-selected-entity-tracking";
	import ClientSelectedEntityHud from "./ClientSelectedEntityHud.svelte";
	import ClientShortcutDock, {
		createClientShortcuts,
		PANEL_SHORTCUTS,
		type ClientSystemPanel,
	} from "./ClientShortcutDock.svelte";
	import ClientToastOverlay from "./ClientToastOverlay.svelte";
	import ClientTargetIndicator from "./ClientTargetIndicator.svelte";
	import type { ClientTargetIndicatorFrame } from "./client-target-indicator";
	import type { ClientObjectInspectionState } from "./client-object-inspection";
	import type {
		RecallDestination,
		ClientAttackProfile,
		ClientMapPosition,
		ClientCombatMode,
		ClientCombatStatus,
		ClientAppearanceOption,
		ClientAppearanceOptions,
		ClientVital,
	} from "./client-host-contract";
	import type {
		ClientCharacterSettings,
		ClientAudioSettings,
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
		resolveClientMinimapPlacement,
		type ClientHudLayout,
		type ClientHudPlacement,
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
		/** Set the current local destination without submitting chat. */
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
		/** Session-lifetime party presentation owner. */
		readonly party: ClientPartyState | null;
		/** Session-owned cold visibility fact; vitals remain imperative. */
		readonly partyHudPresent: boolean;
		readonly readPartyHudDisplay: () => PartyHudDisplay | null;
		readonly onPartyHudDemand: (enabled: boolean) => void;
		readonly friends: ClientFriendsState | null;
		readonly contracts: ClientContractsState | null;
		readonly squelch: ClientSquelchState | null;
		readonly allegiance: ClientAllegianceState | null;
		/** User-scoped fixed HUD geometry, independent of open-panel state. */
		readonly hudLayout: ClientHudLayout;
		readonly onHudPlacementChange: (
			surface: keyof ClientHudLayout,
			placement: ClientHudPlacement,
		) => void;
		readonly onHudReset: (layout: ClientHudLayout) => void;
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
		/** User-scoped audio mix and mute preferences. */
		readonly audio: ClientAudioSettings;
		readonly onAudioChange: (audio: ClientAudioSettings) => void;
		/** User graphics snapshot and focused edit operation. */
		readonly graphics: ClientGraphicsSettings;
		readonly ui: ClientUiSettings;
		/** Cold environment controls; the readout pulls exclusively from the server source. */
		readonly clockFormat: ClientClockFormat;
		readonly environmentOverrides: ClientEnvironmentOverrides;
		readonly weatherPresets: readonly ClientWeatherPreset[];
		readonly environmentIssue: string | null;
		readonly readServerEnvironment: () => ClientEnvironmentReadout | null;
		readonly onClockFormatChange: (format: ClientClockFormat) => void;
		readonly onEnvironmentOverridesChange: (
			overrides: ClientEnvironmentOverrides,
		) => void;
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
		/** Lifecycle and reveal admission, independent of modal ownership. */
		readonly emotesEnabled: boolean;
		/** Same stance action used by the keyboard binding. */
		readonly onToggleCombat: () => void;
		/** Resolve world inventory destinations without changing selection. */
		onPickInventoryTarget: ClientViewportTargetPicker;
		/** Ordinary inventory refusal feedback. */
		onInventoryNotice: (message: string) => void;
		/** Session eligibility; target identity remains selection-owned. */
		readonly readCanSetCorpsePermission: () => boolean;
		/** Captured name and requested grant/revoke operation, with no optimistic status. */
		readonly onCorpsePermission: (playerName: string, granted: boolean) => void;
		/** Surface social dispatch failures even when the Social panel is closed. */
		readonly onSocialNotice: (message: string) => void;
		/** Shell-owned confirmation after the minimap clipboard write succeeds. */
		readonly onCoordinatesCopied: () => void;
		/** Startup catalog availability for switch classification diagnostics. */
		readonly entityMetadata: WeenieCatalogCapability | null;
		readonly cameraController: ClientViewportCameraController | null;
		readonly debugEnabled: boolean;
		readonly readMinimapFrame: () => MinimapFrame;
		/** Session-owned catalog; closed windows do not stop detection. */
		readonly nearby: ClientNearby | null;
		readonly onSelectNearbyEntity: (guid: number) => boolean;
		/** Clear session-owned navigation intent without changing selection. */
		readonly onClearWaypoint: () => void;
		/** Static host capability, owned by the mounted transport lifetime. */
		readonly worldMapSource: WorldMapSource | null;
		/** Cold identity for character-scoped map search selection. */
		readonly characterGuid: number | null;
		readonly housing: HousingSnapshot;
		readonly housingManagement: ClientHousingManagementState | null;
		readonly onRefreshHousing: () => Promise<void>;
		readonly onSearchHousing: (houseType: number) => Promise<void>;
		/** Shared core admission and app-owned request feedback. */
		readonly canTeleportFromMap: boolean;
		/** Core-filtered recall attempts, independent of privileged map teleport. */
		readonly recallDestinations: readonly RecallDestination[];
		/** Dispatch the selected standard recall through the app shell. */
		readonly onRecall: (destination: RecallDestination) => Promise<void>;
		readonly onTeleportToMapPosition: (
			position: ClientMapPosition,
		) => Promise<void>;
		readonly readDiagnostics: () => ClientPresentationDiagnostics | null;
		/** Client-owned selected facts with optional presentation details. */
		readonly readSelectedEntity: () => ClientSelectedEntity | null;
		readonly readFrameRates: () => FrameRates | null;
		/** Lazily retained spell artwork, independent of floating-panel mounts. */
		readonly spells: ClientSpellServices | null;
		/** Session-owned character facts and quotes, independent of this panel mount. */
		readonly characterSheet: ClientCharacterSheetState | null;
		/** World-resolved active effects with a browser-local countdown anchor. */
		readonly enchantments:
			import("./client-lifecycle-session").ClientTimedEnchantments | null;
		/** Session-owned inventory state, independent of floating-panel mounts. */
		readonly inventory: ClientInventoryState | null;
		/** Direct authority for cross-panel item gestures. */
		readonly itemSession: ItemDragSession | null;
		/** Session-owned vendor draft and catalog presentation. */
		readonly vendor: ClientVendorState | null;
		/** Session-local crystal interaction; effective-home knowledge is separate. */
		readonly houseCrystal: ClientHouseCrystalState | null;
		/** Session-owned P2P gestures and confirmed offer presentation. */
		readonly trade: ClientTradeState | null;
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
		readonly bookReader: ClientBookReaderState;
		readonly onCloseBook: () => void;
		readonly onRetryBook: () => void;
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
		/** Imperative transport display reader, independent of world presentation. */
		readonly readConnection: () => ClientConnectionObservation | null;
		readonly vitals: readonly ClientVital[];
		/** Lifecycle-owned permission to present critical-vital warnings. */
		readonly vitalWarningsEnabled: boolean;
		readonly appearanceOptions: ClientAppearanceOptions | null;
		readonly onAppearanceOptionChange: (
			option: ClientAppearanceOption,
			enabled: boolean,
		) => Promise<void>;
		readonly jumpChargeActive: boolean;
		readonly readJumpExtent: () => number;
		/** Configured power controls displayed as keycaps below POWER. */
		readonly jumpPowerKeys: readonly [string, string];
		readonly toast: ClientToast | null;
		readonly preciseJumpActive: boolean;
		readonly onPreciseJumpAim: (clientX: number, clientY: number) => void;
		readonly onPreciseJumpPowerAdjust: (steps: number) => void;
		/** Set an absolute normalized power from the HUD bar. */
		readonly onPreciseJumpPowerSet: (power: number) => void;
		readonly onPreciseJumpActivate: () => void;
		readonly onViewportSelect: (clientX: number, clientY: number) => void;
		readonly onViewportExamine: (clientX: number, clientY: number) => void;
		readonly onViewportHover: (clientX: number, clientY: number) => void;
		/** Clear world hover and invalidate in-flight acquisition on surface exit. */
		readonly onViewportHoverClear: () => void;
		readonly onMaintainEntitySelection: () => void;
		/** Party roster acquisition requires known local entity facts. */
		readonly onSelectPartyMember: (guid: number) => void;
		readonly onSelectEntity: (guid: number | null) => void;
		readonly chatMessages: readonly ClientChatLine[];
		readonly chatComposer: ClientChatComposer;
		/** App-session input recall entries, independent of received chat lines. */
		readonly sentChatHistory: readonly string[];
		readonly onSendChat: (
			message: string,
			resolution: ChatComposeResolution,
		) => Promise<void>;
		/** Report a chat submission failure through the retained chat history. */
		readonly onSendChatError: (message: string) => void;
		readonly onCanvas: (canvas: HTMLCanvasElement | null) => void;
	}

	let {
		onSetWaypoint,
		hudLayout,
		party,
		partyHudPresent,
		readPartyHudDisplay,
		onPartyHudDemand,
		friends,
		contracts,
		squelch,
		allegiance,
		onHudPlacementChange,
		onHudReset,
		spellBarShape,
		onSpellBarShapeChange,
		minimapViewDiameters,
		onMinimapViewDiametersChange,
		chatFilters,
		onChatFiltersChange,
		inspectionPreviewHeight,
		onInspectionPreviewHeightChange,
		audio,
		onAudioChange,
		graphics,
		ui,
		clockFormat,
		environmentOverrides,
		weatherPresets,
		environmentIssue,
		readServerEnvironment,
		onClockFormatChange,
		onEnvironmentOverridesChange,
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
		emotesEnabled,
		onToggleCombat,
		entityMetadata,
		cameraController,
		debugEnabled,
		readMinimapFrame,
		nearby,
		onSelectNearbyEntity,
		onClearWaypoint,
		worldMapSource,
		characterGuid,
		housing,
		housingManagement,
		onRefreshHousing,
		onSearchHousing,
		canTeleportFromMap,
		recallDestinations,
		onRecall,
		onTeleportToMapPosition,
		readDiagnostics,
		readSelectedEntity,
		readFrameRates,
		readSelectedEntityDisplay,
		spells,
		characterSheet,
		enchantments,
		inventory,
		itemSession,
		worldContainer,
		vendor,
		houseCrystal,
		trade,
		itemInteractions,
		onSelectContentsItem,
		onPickInventoryTarget,
		onInventoryNotice,
		readCanSetCorpsePermission,
		onCorpsePermission,
		onSocialNotice,
		onCoordinatesCopied,
		onInteractEntity,
		objectInspection,
		bookReader,
		onCloseBook,
		onRetryBook,
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
		vitalWarningsEnabled,
		readConnection,
		appearanceOptions,
		onAppearanceOptionChange,
		jumpChargeActive,
		readJumpExtent,
		jumpPowerKeys,
		toast,
		preciseJumpActive,
		onPreciseJumpAim,
		onPreciseJumpPowerAdjust,
		onPreciseJumpPowerSet,
		onPreciseJumpActivate,
		onViewportSelect,
		onViewportExamine,
		onViewportHover,
		onViewportHoverClear,
		onMaintainEntitySelection,
		onSelectEntity,
		onSelectPartyMember,
		chatMessages,
		chatComposer,
		sentChatHistory,
		onSendChat,
		onSendChatError,
		onCanvas,
	}: Props = $props();
	const { viewport: inputGate, keyboard } = useAppInputPolicy();
	const clientInput = useClientInput();
	const displayPlatform = inputDisplayPlatform(navigator.userAgent);
	/** The wheel owns a disposable physical-key lifetime while its activation key is held. */
	let emoteWheel = $state<{ readonly release: () => void } | null>(null);
	function closeEmotes(): void {
		const activation = emoteWheel;
		emoteWheel = null;
		activation?.release();
	}
	onDestroy(closeEmotes);
	$effect(() => {
		// Lifecycle/configuration edges retire the transient interaction; opening itself is untracked.
		chatComposer.generation;
		emotesEnabled;
		hudMode;
		untrack(() => {
			closeEmotes();
		});
	});
	function openEmotes(press: KeyboardEvent): void {
		if (!emotesEnabled || hudMode !== "runtime" || chatComposer.emotes === null)
			return;
		closeEmotes();
		emoteWheel = { release: keyboard.bindKeyRelease(press, closeEmotes) };
	}
	function executeEmote(token: string): void {
		void onSendChat(`*${token}*`, {
			kind: "send",
			label: "Emote · Local",
			buttonLabel: "Emote",
			buttonIcon: "speech",
			request: { kind: "soul-emote", token },
		}).catch((error) =>
			onSendChatError(error instanceof Error ? error.message : String(error)),
		);
	}
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
	let itemDrag = $state<ClientItemDrag | null>(null);
	/** Opening snapshots are cold drafts, independent of subsequent entity updates. */
	let loadoutCapture = $state<LoadoutDraft | null>(null);
	function openLoadoutBuilder() {
		if (itemSession === null || actionBars === null) return;
		const capture = captureLoadout(itemSession.entities.read());
		if (capture.kind === "unavailable") {
			onInventoryNotice(capture.reason);
			return;
		}
		loadoutCapture = { ...capture, icon: chooseLoadoutIcon(actionBars) };
	}
	$effect(() => {
		if (!combatEnabled || itemSession === null) loadoutCapture = null;
	});
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
	let nearbyOpen = $state(false);
	let activePanel = $state<ClientSystemPanel | null>(null);
	/** Dock and keyboard share the single-open-panel policy. */
	function toggleSystemPanel(panel: ClientSystemPanel): void {
		activePanel = activePanel === panel ? null : panel;
	}
	/** Called only after the app keyboard policy admits a gameplay press. */
	export function handleSystemPanelKeydown(event: KeyboardEvent): boolean {
		if (event.defaultPrevented || event.isComposing || hudMode !== "runtime")
			return false;
		const action = CLIENT_PANEL_SHORTCUT_ACTIONS.find((action) =>
			clientInput.shortcut(action, event),
		);
		if (action === undefined) return false;
		event.preventDefault();
		if (!event.repeat) toggleSystemPanel(PANEL_SHORTCUTS[action]);
		return true;
	}
	let enchantmentsOpen = $state(false);
	let enchantmentLaunch = $state<{
		kind: "beneficial" | "harmful";
		revision: number;
	} | null>(null);
	const enchantmentTray = $derived(
		presentEnchantmentTray(enchantments?.resolved ?? null),
	);
	function openEnchantments(kind: "beneficial" | "harmful"): void {
		enchantmentsOpen = true;
		enchantmentLaunch = {
			kind,
			revision: (enchantmentLaunch?.revision ?? 0) + 1,
		};
	}
	let settingsTab = $state<SettingsTab>("graphics");
	/** One selected-HUD request retained only until the inventory panel accepts it. */
	let requestedInventorySplit = $state<InventorySplitStart | null>(null);
	$effect(() => onPartyHudDemand(partyHudPresent));
	onDestroy(() => onPartyHudDemand(false));

	let worldElement = $state<HTMLElement | null>(null);
	let viewport = $state<ClientHudViewport>(initialViewport);
	// The launch capability is immutable; snapshotting it avoids resetting edited HUD layout.
	const shortcuts = untrack(() => createClientShortcuts(debugEnabled));
	let resetActionBars = $state<(() => boolean) | null>(null);
	function resetHudPlacements(): void {
		if (resetActionBars === null || !resetActionBars()) return;
		onHudReset(
			createClientHudLayout(CLIENT_UI_DEFAULTS, viewport, shortcuts.length),
		);
	}
	/** Cold measured geometry: updated on footer/font changes, never scene cadence. */
	let minimapFooterExtent = $state<MinimapFooterExtent>({
		width: 0,
		height: 0,
	});
	/** Intrinsic character text/bar height, published only when its CSS rows change size. */
	let characterMinimumHeight = $state(0);
	const minimapViewport = $derived({
		...viewport,
		height: Math.max(0, viewport.height - minimapFooterExtent.height),
	});
	const resolvedMapPlacement = $derived(
		resolveClientMinimapPlacement(
			hudLayout.minimap,
			minimapViewport,
			CLIENT_UI_DEFAULTS.minimap.minSize,
			minimapFooterExtent.width,
		),
	);
	const minimap = $derived<MinimapState>({
		left: resolvedMapPlacement.left,
		top: resolvedMapPlacement.top,
		size: resolvedMapPlacement.width,
		viewDiameters: minimapViewDiameters,
	});
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	// Click intent is captured with the gesture; dragging always belongs to camera orbit.
	let viewportGesture: {
		readonly motion: ClientViewportPointerGesture;
		readonly click: "select" | "jump";
	} | null = null;
	let pointerX = 0;
	let pointerY = 0;
	let hasPointerPosition = false;
	let pointerInsideCanvas = false;
	const HUD_PREVIEW_JUMP_EXTENT = 0.45;
	const HUD_PREVIEW_TOAST_MESSAGE = "Notification preview";

	/** App-owned target classification shared by selected-player shortcuts. */
	function selectedPlayer() {
		return selectedPlayerTarget(readSelectedEntity(), characterGuid);
	}
	function inviteTarget(): number | null {
		const target = selectedPlayer();
		return target !== null && party?.canInvite(target.guid)
			? target.guid
			: null;
	}
	function swearTarget(): number | null {
		const target = selectedPlayer();
		return target !== null && allegiance?.canSwear(target.guid)
			? target.guid
			: null;
	}
	function friendTarget() {
		const target = selectedPlayer();
		return target !== null && friends?.canAdd(target.guid, target.name)
			? target
			: null;
	}
	function ignoreTarget() {
		const target = selectedPlayer();
		return target !== null &&
			squelch?.canIgnoreAccount(target.guid, target.name)
			? target
			: null;
	}
	function addSelectedFriend(): void {
		const target = friendTarget();
		if (target !== null)
			void friends?.request({ kind: "add", name: target.name }, onSocialNotice);
	}
	function ignoreSelectedAccount(): void {
		const target = ignoreTarget();
		if (target !== null)
			void squelch?.request(
				{ kind: "add", name: target.name, scope: "account" },
				onSocialNotice,
			);
	}
	function canSplitSelectedEntity(): boolean {
		return (
			selectedEntityGuid !== null &&
			inventory !== null &&
			isSplittableInventoryItem(inventory.readItem(selectedEntityGuid))
		);
	}

	/** Shared entry for the selected-item menu and gameplay keyboard dispatch. */
	export function splitSelectedEntity(source: HTMLElement): void {
		if (!canSplitSelectedEntity() || selectedEntityGuid === null) return;
		requestedInventorySplit = { item: selectedEntityGuid, source };
		activePanel = "inventory";
	}

	$effect(() => {
		if (activePanel !== "inventory") requestedInventorySplit = null;
	});

	$effect(() => {
		const precise = preciseJumpActive;
		untrack(() => {
			cancelViewportGesture();
			if (precise && inputGate.allowed && hasPointerPosition)
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
			minimapViewport,
			{ width: preferredSize, height: preferredSize },
		);
		changeHudPlacement("minimap", minimapPlacement);
	}

	function changeHudPlacement<Surface extends keyof ClientHudLayout>(
		surface: Surface,
		placement: ClientHudLayout[Surface],
	): void {
		onHudPlacementChange(surface, placement);
	}

	function handlePointerDown(event: PointerEvent): void {
		if (!inputGate.allowed) return;
		if (clientInput.pointer("clientExamine", event)) {
			event.preventDefault();
			onViewportExamine(event.clientX, event.clientY);
			return;
		}
		const jump =
			preciseJumpActive && clientInput.pointer("preciseJumpActivate", event);
		if (jump && cameraController === null) {
			event.preventDefault();
			onPreciseJumpActivate();
			return;
		}
		if (
			cameraController === null ||
			(!jump && !clientInput.pointer("clientInteract", event)) ||
			viewportGesture !== null
		)
			return;
		event.preventDefault();
		viewportGesture = {
			motion: beginClientViewportPointerGesture(
				event.pointerId,
				event.clientX,
				event.clientY,
			),
			click: jump ? "jump" : "select",
		};
		pointerX = event.clientX;
		pointerY = event.clientY;
		canvasElement?.setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!inputGate.allowed) return;
		const gesture = viewportGesture;
		if (
			gesture?.motion.pointerId !== event.pointerId ||
			cameraController === null
		) {
			pointerX = event.clientX;
			pointerY = event.clientY;
			hasPointerPosition = true;
			if (preciseJumpActive) onPreciseJumpAim(event.clientX, event.clientY);
			return;
		}
		const advanced = advanceClientViewportPointerGesture(
			gesture.motion,
			event.clientX,
			event.clientY,
		);
		viewportGesture = { motion: advanced.gesture, click: gesture.click };
		pointerX = event.clientX;
		pointerY = event.clientY;
		hasPointerPosition = true;
		if (advanced.orbitDelta !== null)
			cameraController.orbit(
				advanced.orbitDelta.x,
				-advanced.orbitDelta.y,
				performance.now(),
			);
		// Keep the displayed choice stable during click jitter; orbit drags still refresh aim.
		if (preciseJumpActive && advanced.gesture.dragging)
			onPreciseJumpAim(event.clientX, event.clientY);
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
		if (gesture?.motion.pointerId !== event.pointerId) return;
		handlePointerMove(event);
		const wasClick = viewportGesture?.motion.dragging === false;
		viewportGesture = null;
		if (canvasElement?.hasPointerCapture(event.pointerId))
			canvasElement.releasePointerCapture(event.pointerId);
		if (wasClick) {
			if (gesture.click === "jump") onPreciseJumpActivate();
			else onViewportSelect(event.clientX, event.clientY);
		}
	}

	function cancelViewportGesture(): void {
		const gesture = viewportGesture;
		viewportGesture = null;
		if (gesture && canvasElement?.hasPointerCapture(gesture.motion.pointerId))
			canvasElement.releasePointerCapture(gesture.motion.pointerId);
	}

	function cancelViewportPointer(event: PointerEvent): void {
		if (viewportGesture?.motion.pointerId === event.pointerId)
			cancelViewportGesture();
	}

	function handleWheel(event: WheelEvent): void {
		if (!inputGate.allowed || cameraController === null) return;
		event.preventDefault();
		if (preciseJumpActive && event.shiftKey) {
			onPreciseJumpPowerAdjust(
				-Math.sign(event.deltaY === 0 ? event.deltaX : event.deltaY),
			);
			return;
		}
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
			".item-grid-cell[data-item-guid]:not(:disabled), .loadout-item-cell[data-item-guid], [data-action-cell][data-action-item]",
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
	{#key characterGuid}
		<ClientVitalWarningOverlay
			{vitals}
			enabled={vitalWarningsEnabled}
			thresholds={ui.vitalWarningThresholds}
		/>
	{/key}
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
		{onClearWaypoint}
		viewState={minimap}
		minSize={CLIENT_UI_DEFAULTS.minimap.minSize}
		resizable={CLIENT_UI_DEFAULTS.minimap.resizable}
		editable={hudMode === "layout"}
		onStateChange={updateMinimap}
		onFooterExtentChange={(extent) => {
			if (
				extent.width !== minimapFooterExtent.width ||
				extent.height !== minimapFooterExtent.height
			)
				minimapFooterExtent = extent;
		}}
		{onSelectEntity}
		{onCoordinatesCopied}
	>
		{#snippet actions()}
			<button
				class="ui-button ui-icon-button ui-minimap-button"
				type="button"
				aria-label="Nearby entities and alerts"
				title="Nearby entities and alerts"
				aria-pressed={nearbyOpen}
				disabled={nearby === null}
				onclick={() => (nearbyOpen = !nearbyOpen)}
				><ClientHudIcon name="nearby" /></button
			>
		{/snippet}
		{#snippet coordinateDetails()}<ClientMinimapEnvironment
				readEnvironment={readServerEnvironment}
				{clockFormat}
			/>{/snippet}
	</Minimap>
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
				{houseCrystal}
				{trade}
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
			<ClientLoadoutBuilder
				{inventory}
				capture={loadoutCapture}
				owner={itemDrag}
				{viewport}
				onClose={() => (loadoutCapture = null)}
			/>
		{/key}
	{/if}

	{#if actionBars !== null && spells !== null && (spellBarEnabled || (hudMode === "layout" && combatMode !== "melee" && combatMode !== "missile"))}
		<ClientSpellBar
			{input}
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
			{input}
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
		minHeight={Math.max(
			CLIENT_UI_DEFAULTS.character.minSize.height,
			characterMinimumHeight,
		)}
		resizable={CLIENT_UI_DEFAULTS.character.resizable}
		contentHitTesting="surface"
		{viewport}
		onPlacementChange={(placement) =>
			changeHudPlacement("character", placement)}
	>
		<ClientCharacterHud
			onMinimumHeightChange={(height) => (characterMinimumHeight = height)}
			{playerName}
			{worldName}
			{vitals}
			{readConnection}
			{characterSheet}
		/>
	</ClientHudPanel>
	{#if partyHudPresent || hudMode === "layout"}
		<ClientPartyHud
			{readPartyHudDisplay}
			onSelectEntity={onSelectPartyMember}
			preview={!partyHudPresent}
			placement={hudLayout.partyHud}
			editable={hudMode === "layout"}
			resizable={CLIENT_UI_DEFAULTS.partyHud.resizable}
			{viewport}
			onPlacementChange={(placement) =>
				changeHudPlacement("partyHud", placement)}
		/>
	{/if}

	<ClientStatusTray
		placement={hudLayout.statusTray}
		editable={hudMode === "layout"}
		{viewport}
		{inventory}
		enchantments={enchantmentTray}
		onOpenEnchantments={openEnchantments}
		onOpenInventory={() => (activePanel = "inventory")}
		onPlacementChange={(placement) =>
			changeHudPlacement("statusTray", placement)}
	/>

	{#if jumpChargeActive || preciseJumpActive || hudMode === "layout"}
		<ClientHudPanel
			label="Jump power"
			placement={hudLayout.jumpPower}
			editable={hudMode === "layout"}
			minWidth={CLIENT_UI_DEFAULTS.jumpPower.minSize.width}
			minHeight={CLIENT_UI_DEFAULTS.jumpPower.minSize.height}
			resizable={CLIENT_UI_DEFAULTS.jumpPower.resizable}
			contentHitTesting="descendants"
			{viewport}
			onPlacementChange={(placement) =>
				changeHudPlacement("jumpPower", placement)}
		>
			<ClientJumpPowerBar
				active={jumpChargeActive || preciseJumpActive}
				previewExtent={hudMode === "layout" ? HUD_PREVIEW_JUMP_EXTENT : null}
				precise={preciseJumpActive}
				readExtent={readJumpExtent}
				powerKeys={jumpPowerKeys}
				powerControl={hudMode === "runtime" && preciseJumpActive
					? { setPower: onPreciseJumpPowerSet }
					: null}
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
		{#key chatComposer.generation}
			<ClientChat
				composer={chatComposer}
				{onSetWaypoint}
				messages={chatMessages}
				{clockFormat}
				sentHistory={sentChatHistory}
				onSend={onSendChat}
				onSendError={onSendChatError}
				enabledTags={chatFilters}
				onEnabledTagsChange={onChatFiltersChange}
			/>
		{/key}
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
				{input}
				{displayPlatform}
				selectedGuid={selectedEntityGuid}
				readCanCorpsePermission={() =>
					readCanSetCorpsePermission() && selectedPlayer() !== null}
				onCorpsePermission={(granted) => {
					const target = selectedPlayer();
					if (target !== null && readCanSetCorpsePermission())
						onCorpsePermission(target.name, granted);
				}}
				readCanSplit={canSplitSelectedEntity}
				readCanAddFriend={() => friendTarget() !== null}
				readCanIgnoreAccount={() => ignoreTarget() !== null}
				onAddFriend={addSelectedFriend}
				onIgnoreAccount={ignoreSelectedAccount}
				readCanSwear={() => swearTarget() !== null}
				onSwear={() => {
					const guid = swearTarget();
					if (guid !== null) void allegiance?.request({ kind: "swear", guid });
				}}
				readCanInvite={() => inviteTarget() !== null}
				onInvite={() => {
					const target = inviteTarget();
					if (target !== null) party?.request({ kind: "invite", target });
				}}
				readSelectedDisplay={() => {
					const display = readSelectedEntityDisplay();
					return itemInteraction.kind === "acquiring" &&
						selectedEntityGuid !== null
						? { ...display, canInteract: true, interactionLabel: "Interact" }
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
	<div
		class="emote-activation"
		tabindex="-1"
		use:keyboard.scope={{
			transient: true,
			activation: (event) => {
				if (
					event.repeat ||
					!emotesEnabled ||
					hudMode !== "runtime" ||
					chatComposer.emotes === null ||
					!clientInput.shortcut("openEmotes", event)
				)
					return false;
				openEmotes(event);
				return true;
			},
			keydown: () => {},
		}}
	></div>
	{#if emoteWheel !== null && chatComposer.emotes !== null}
		<ClientEmoteWheel
			catalog={chatComposer.emotes}
			recent={chatComposer.recentEmotes}
			onClose={() => {
				closeEmotes();
			}}
			onExecute={executeEmote}
		/>
	{/if}

	<ClientShortcutDock
		placement={hudLayout.shortcuts}
		editable={hudMode === "layout"}
		{viewport}
		onPlacementChange={(placement) =>
			changeHudPlacement("shortcuts", placement)}
		{input}
		{displayPlatform}
		{combatMode}
		{combatEnabled}
		{onToggleCombat}
		{shortcuts}
		{activePanel}
		onToggle={toggleSystemPanel}
	/>
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
	{#if trade !== null}
		{#key trade}
			<ClientTradeWindow
				inputSettings={input}
				{displayPlatform}
				model={trade}
				selectedGuid={selectedEntityGuid}
				placement={hudLayout.trade}
				{viewport}
				onPlacementChange={(placement) =>
					changeHudPlacement("trade", placement)}
				onSelectItem={onSelectEntity}
				{onExamineItem}
			/>
		{/key}
	{/if}
	{#if vendor !== null}
		{#key vendor}
			<ClientVendorWindow
				inputSettings={input}
				{displayPlatform}
				model={vendor}
				placement={hudLayout.vendor}
				{viewport}
				onPlacementChange={(placement) =>
					changeHudPlacement("vendor", placement)}
				{onExamineItem}
			/>
		{/key}
	{/if}
	{#if houseCrystal !== null}
		{#key houseCrystal}
			<ClientHouseCrystalWindow
				model={houseCrystal}
				placement={hudLayout.houseCrystal}
				{viewport}
				onPlacementChange={(placement) =>
					changeHudPlacement("houseCrystal", placement)}
				{onExamineItem}
			/>
		{/key}
	{/if}
	{#if objectInspection.kind === "ready"}
		{#key objectInspection.guid}
			<ClientInspectionWindow
				{onSetWaypoint}
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
	{#if bookReader.kind !== "idle"}
		{#key bookReader.revision}
			<ClientBookWindow
				{onSetWaypoint}
				reader={bookReader}
				placement={hudLayout.book}
				{viewport}
				onClose={onCloseBook}
				onRetry={onRetryBook}
				onPlacementChange={(placement) => changeHudPlacement("book", placement)}
			/>
		{/key}
	{/if}

	{#if characterSheet !== null}
		{#key characterSheet}
			<ClientHudWindow
				icon="training"
				title="Character"
				visible={activePanel === "characterSheet"}
				placement={hudLayout.characterSheet}
				minWidth={CLIENT_UI_DEFAULTS.characterSheet.minSize.width}
				minHeight={CLIENT_UI_DEFAULTS.characterSheet.minSize.height}
				{viewport}
				onClose={() => (activePanel = null)}
				onPlacementChange={(placement) =>
					changeHudPlacement("characterSheet", placement)}
			>
				<ClientCharacterSheetPanel
					owner={characterSheet}
					visible={activePanel === "characterSheet"}
					{spells}
					{enchantments}
					castEnabled={combatEnabled && combatMode === "magic"}
					{onCastSpell}
				/>
			</ClientHudWindow>
		{/key}
	{/if}

	{#if worldMapSource !== null}
		{#key worldMapSource}
			<ClientHudWindow
				icon="world"
				title="World"
				visible={activePanel === "world"}
				placement={hudLayout.world}
				minWidth={CLIENT_UI_DEFAULTS.world.minSize.width}
				minHeight={CLIENT_UI_DEFAULTS.world.minSize.height}
				{viewport}
				onClose={() => (activePanel = null)}
				onPlacementChange={(placement) =>
					changeHudPlacement("world", placement)}
			>
				<ClientWorldPanel
					{contracts}
					source={worldMapSource}
					{characterGuid}
					{housing}
					{housingManagement}
					{onRefreshHousing}
					{onSearchHousing}
					{canTeleportFromMap}
					{onSetWaypoint}
					{recallDestinations}
					{onRecall}
					{onTeleportToMapPosition}
					visible={activePanel === "world"}
					readFrame={readMinimapFrame}
				/>
			</ClientHudWindow>
		{/key}
	{/if}

	{#if party !== null && friends !== null && squelch !== null && allegiance !== null}
		{#key party}
			<ClientHudWindow
				icon="party"
				title="Social"
				visible={activePanel === "social"}
				placement={hudLayout.social}
				minWidth={CLIENT_UI_DEFAULTS.social.minSize.width}
				minHeight={CLIENT_UI_DEFAULTS.social.minSize.height}
				{viewport}
				onClose={() => (activePanel = null)}
				onPlacementChange={(placement) =>
					changeHudPlacement("social", placement)}
			>
				<ClientSocialPanel
					owner={party}
					onSelectEntity={onSelectPartyMember}
					{friends}
					{squelch}
					{allegiance}
					visible={activePanel === "social"}
				/>
			</ClientHudWindow>
		{/key}
	{/if}

	{#if contracts !== null}
		{#key contracts}
			<ClientHudWindow
				icon="journal"
				title="Journal"
				visible={activePanel === "journal"}
				placement={hudLayout.journal}
				minWidth={CLIENT_UI_DEFAULTS.journal.minSize.width}
				minHeight={CLIENT_UI_DEFAULTS.journal.minSize.height}
				{viewport}
				onClose={() => (activePanel = null)}
				onPlacementChange={(placement) =>
					changeHudPlacement("journal", placement)}
			>
				<ClientJournalPanel
					{onSetWaypoint}
					owner={contracts}
					visible={activePanel === "journal"}
					onNotice={onSocialNotice}
				/>
			</ClientHudWindow>
		{/key}
	{/if}

	{#if nearby !== null}{#key nearby}{#key characterGuid}
				<ClientHudWindow
					icon="nearby"
					title="Nearby"
					visible={nearbyOpen}
					placement={hudLayout.nearby}
					minWidth={CLIENT_UI_DEFAULTS.nearby.minSize.width}
					minHeight={CLIENT_UI_DEFAULTS.nearby.minSize.height}
					{viewport}
					onClose={() => (nearbyOpen = false)}
					onPlacementChange={(placement) =>
						changeHudPlacement("nearby", placement)}
				>
					<ClientNearbyPanel
						owner={nearby}
						visible={nearbyOpen}
						selectedGuid={selectedEntityGuid}
						onSelectEntity={onSelectNearbyEntity}
						{onExamineEntity}
						{onSetWaypoint}
					/>
				</ClientHudWindow>
			{/key}{/key}{/if}

	{#if activePanel !== null && activePanel !== "world" && activePanel !== "social" && activePanel !== "journal" && activePanel !== "characterSheet"}
		{@const panel = activePanel}
		{#key panel}
			<ClientHudWindow
				icon={panel}
				title={panel === "inventory"
					? "Inventory"
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
				{#if panel === "inventory"}
					{#if inventory !== null && itemInteractions !== null}
						{#key inventory}
							<ClientInventoryPanel
								onSaveLoadout={openLoadoutBuilder}
								{input}
								{displayPlatform}
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
						{audio}
						{onAudioChange}
						{graphics}
						{ui}
						{input}
						{textureFilteringCapabilities}
						selectedTab={settingsTab}
						onSelectTab={(tab) => (settingsTab = tab)}
						{onGraphicsChange}
						{onUiChange}
						{clockFormat}
						{environmentOverrides}
						{weatherPresets}
						{environmentIssue}
						{onClockFormatChange}
						{onEnvironmentOverridesChange}
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
	{#if enchantmentsOpen}
		<ClientHudWindow
			icon="buffed"
			title="Enchantments"
			placement={hudLayout.enchantments}
			minWidth={CLIENT_UI_DEFAULTS.enchantments.minSize.width}
			minHeight={CLIENT_UI_DEFAULTS.enchantments.minSize.height}
			{viewport}
			focusRevision={enchantmentLaunch?.revision ?? 0}
			onClose={() => (enchantmentsOpen = false)}
			onPlacementChange={(placement) =>
				changeHudPlacement("enchantments", placement)}
		>
			<ClientEnchantmentsPanel
				{enchantments}
				{spells}
				launch={enchantmentLaunch}
			/>
		</ClientHudWindow>
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
		.client-canvas:global([data-precise-jump]) {
			cursor: crosshair;
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
