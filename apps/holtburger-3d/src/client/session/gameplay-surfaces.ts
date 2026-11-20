import type { FrameRates } from "../../app/performance/frame-rate-sampler";
import type { MinimapFrame, MinimapState } from "../../app/minimap/frame";
import type { PerformanceSession } from "../../app/performance/performance-session";
import type { UiThemeSettings } from "../../app/theme/ui-theme-selection";
import type { MapWaypointTarget } from "../../lib/game/map/map-waypoint";
import type { TextureFilteringCapabilities } from "../../lib/game/renderer/webgl2/texture-filtering-policy";
import type { WorldMapSource } from "../../lib/game/world-map/types";
import type {
	ClientInputConfiguration,
	InputDigitIndex,
} from "../../lib/input/input-contract";
import type { InputPlatform } from "../../lib/input/input-platform";
import type { ClientActionBar } from "../hud/action-bar-state";
import type { ClientAllegianceState } from "../social/allegiance-state";
import type { ClientBarberState } from "../character/barber-state";
import type { ClientBookReaderState } from "../inventory/book-reader";
import type { ClientCharacterSheetState } from "../character/character-sheet-state";
import type { ChatComposeResolution } from "../social/chat-compose";
import type { ClientChatComposer } from "../social/chat-composer.svelte";
import type {
	ClientChatFilterTag,
	ClientChatLine,
} from "../social/chat-policy";
import type { ClientContractsState } from "../world/contracts-state";
import type { ClientInspectionItemSelection } from "../world/entity-selection";
import type {
	ClientEnvironmentReadout,
	ClientWeatherPreset,
} from "../settings/environment";
import type {
	ClientClockFormat,
	ClientEnvironmentOverrides,
} from "../settings/environment-settings";
import type { ClientFriendsState } from "../social/friends-state";
import type {
	ClientGameplayOption,
	ClientGameplayPreferences,
} from "./host-contract";
import type { ClientGameplayPresentationDiagnostics } from "./gameplay-presentation";
import type {
	ClientAppearanceOption,
	ClientAppearanceOptions,
	ClientAttackProfile,
	ClientCombatMode,
	ClientCombatStatus,
	ClientMapPosition,
	ClientVital,
	RecallDestination,
} from "./host-contract";
import type { ClientHouseCrystalState } from "../housing/house-crystal-state";
import type { HousingSnapshot } from "../housing/housing-contract";
import type { ClientHousingManagementState } from "../housing/housing-management-state";
import type { ClientHudLayout, ClientHudPlacement } from "../hud/hud-layout";
import type { ClientInspectionState } from "../inventory/inspection";
import type { ClientInventoryState } from "../inventory/inventory-state";
import type { ItemDragSession } from "../inventory/item-drag";
import type { ClientItemInteractions } from "../inventory/item-interactions";
import type {
	ClientConnectionObservation,
	ClientTimedEnchantments,
} from "./lifecycle-session";
import type { ClientLockFeedbackFrame } from "../inventory/lock-feedback";
import type { ClientLocksState } from "../inventory/locks-state";
import type { ClientNearby } from "../world/nearby";
import type { ClientObjectPreviewService } from "../character/object-preview-service";
import type { PartyHudDisplay } from "../social/party-hud";
import type { ClientPartyState } from "../social/party-state";
import type { ClientViewportTargetPicker } from "../world/pointer-selection-controller";
import type { ClientSalvageState } from "../inventory/salvage-state";
import type { ClientSelectedEntity } from "../world/selected-entity";
import type { ClientSelectedEntityDisplay } from "../world/selected-entity-tracking";
import type {
	ClientAudioSettings,
	ClientCameraSettings,
	ClientCharacterSettings,
	ClientChatChannelFilters,
	ClientChatSuppressionSettings,
	ClientGraphicsSettings,
	ClientLockInteractionSettings,
	ClientNameplateSettings,
	ClientUiSettings,
} from "../settings/settings-contract";
import type { ClientSpellBarState } from "../magic/spell-bar-state";
import type { ClientSpellServices } from "../magic/spells";
import type { ClientSquelchState } from "../social/squelch-state";
import type { StatArtworkServices } from "../character/stat-artwork";
import type {
	ClientCombatTargetFrame,
	ClientTargetIndicatorFrame,
} from "../combat/target-indicator";
import type { ClientToast } from "../hud/toast-center";
import type { ClientTradeState } from "../inventory/trade-state";
import type { ClientVendorState } from "../inventory/vendor-state";
import type { ClientMouseMovementInput } from "./viewport-mouse-controller";
import type { ClientViewportCameraController } from "./viewport-pointer-gesture";
import type { ClientWorldContainerPanelState } from "../inventory/world-container-panel-state";

/** App-shell lifecycle, viewport DOM roots, layout editing mode, diagnostics, and debug overrides. */
export interface ClientGameplayShellSurface {
	/** Startup platform used by input reset policy and key labels. */
	readonly platform: InputPlatform;
	/** Persistent world surface borrowed from the app shell. */
	readonly canvasElement: HTMLCanvasElement;
	/** Common DOM boundary containing both the canvas and HUD for drag/drop hit testing. */
	readonly interactionRoot: HTMLElement;
	/** App-owned layout mode also gates gameplay shortcuts. */
	readonly hudMode: "runtime" | "layout";
	/** Reveal conditional HUD previews without editing chrome. */
	readonly uiShowcase?: boolean;
	readonly onHudModeChange: (mode: "runtime" | "layout") => void;
	readonly debugEnabled: boolean;
	/** Authority-admitted application session actions, independent of panel selection. */
	readonly canReturnToMenu: boolean;
	/** Full disconnect has independent admission during world entry and portals. */
	readonly canDisconnect: boolean;
	/** Graceful character logout returns to the roster. */
	readonly onReturnToMainMenu: () => void;
	/** Full server-session retirement. */
	readonly onDisconnect: () => void;
	/** Cold access to the mode-owned capture lifecycle. */
	readonly readPerformanceSession: () => PerformanceSession | null;
	readonly readDiagnostics: () => ClientGameplayPresentationDiagnostics | null;
	readonly readFrameRates: () => FrameRates | null;
	/** Runtime-confirmed local player response override. */
	readonly entityCollisionDisabled: boolean;
	readonly onEntityCollisionDisabledChange: (disabled: boolean) => void;
	/** Explicit local override of authored useability for diagnostic requests. */
	readonly unrestrictedUse: boolean;
	readonly onUnrestrictedUseChange: (enabled: boolean) => void;
	readonly showRetailHiddenGeometry: boolean;
	readonly onShowRetailHiddenGeometryChange: (visible: boolean) => void;
	/** Explicit local easter egg launch request. */
	readonly logopolisLaunchRevision: number;
	readonly toast: ClientToast | null;
}

/** Persisted user preferences, HUD geometry, audio/graphics/UI, input bindings, chat filters, and environment overrides. */
export interface ClientGameplaySettingsSurface {
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
	/** User-scoped audio mix and mute preferences. */
	readonly audio: ClientAudioSettings;
	readonly onAudioChange: (audio: ClientAudioSettings) => void;
	/** User graphics snapshot and focused edit operation. */
	readonly graphics: ClientGraphicsSettings;
	readonly onGraphicsChange: (graphics: ClientGraphicsSettings) => void;
	readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
	/** Shared selection owner and settings commit used by both appearance surfaces. */
	readonly theme: UiThemeSettings;
	readonly ui: ClientUiSettings;
	readonly onUiChange: (ui: ClientUiSettings) => void;
	readonly nameplates: ClientNameplateSettings;
	readonly onNameplatesChange: (nameplates: ClientNameplateSettings) => void;
	readonly input: ClientInputConfiguration;
	readonly onInputChange: (input: ClientInputConfiguration) => void;
	/** Local persisted policy for key automation and chooser presentation. */
	readonly lockInteractions: ClientLockInteractionSettings;
	/** Persist local lock policy through the settings owner. */
	readonly onLockInteractionsChange: (
		settings: ClientLockInteractionSettings,
	) => void;
	/** Local gameplay camera preferences. */
	readonly camera: ClientCameraSettings;
	readonly onCameraChange: (settings: ClientCameraSettings) => void;
	/** Local chat admission preferences, independent of server character options. */
	readonly chatSuppression: ClientChatSuppressionSettings;
	readonly onChatSuppressionChange: (
		settings: ClientChatSuppressionSettings,
	) => void;
	/** User-wide channel visibility and its settings edit operation. */
	readonly chatChannelFilters: ClientChatChannelFilters;
	readonly onChatChannelFiltersChange: (
		value: ClientChatChannelFilters,
	) => void;
	readonly chatFilters: readonly ClientChatFilterTag[];
	readonly onChatFiltersChange: (value: readonly ClientChatFilterTag[]) => void;
	/** User-wide chat timestamp visibility and its settings edit operation. */
	readonly chatTimestamps: boolean;
	readonly onChatTimestampsChange: (value: boolean) => void;
	/** Cold environment controls; the readout pulls exclusively from the server source. */
	readonly clockFormat: ClientClockFormat;
	readonly onClockFormatChange: (format: ClientClockFormat) => void;
	readonly environmentOverrides: ClientEnvironmentOverrides;
	readonly onEnvironmentOverridesChange: (
		overrides: ClientEnvironmentOverrides,
	) => void;
	readonly weatherPresets: readonly ClientWeatherPreset[];
	readonly environmentIssue: string | null;
	readonly readServerEnvironment: () => ClientEnvironmentReadout | null;
	/** User-scoped divider height inside creature inspections. */
	readonly inspectionPreviewHeight: number;
	readonly onInspectionPreviewHeightChange: (height: number) => void;
}

/** Active character identity, vitals, character sheet, enchantments, appearance, gameplay options, and jump charge/aim. */
export interface ClientGameplayCharacterSurface {
	/** Cold identity for character-scoped map search selection. */
	readonly characterGuid: number | null;
	readonly playerName: string | null;
	readonly worldName: string | null;
	/** Current session account shown when hovering the server label. */
	readonly accountName: string | null;
	/** Imperative transport display reader, independent of world presentation. */
	readonly readConnection: () => ClientConnectionObservation | null;
	readonly vitals: readonly ClientVital[];
	/** Lifecycle-owned permission to present critical-vital warnings. */
	readonly vitalWarningsEnabled: boolean;
	/** Session-owned character facts and quotes, independent of this panel mount. */
	readonly characterSheet: ClientCharacterSheetState | null;
	/** Mode-neutral stat artwork comes from the active static-content source. */
	readonly statArtwork: StatArtworkServices;
	/** World-resolved active effects with a browser-local countdown anchor. */
	readonly enchantments: ClientTimedEnchantments | null;
	readonly appearanceOptions: ClientAppearanceOptions | null;
	readonly onAppearanceOptionChange: (
		option: ClientAppearanceOption,
		enabled: boolean,
	) => Promise<void>;
	/** Current character Gameplay controls, independent of local preference storage. */
	readonly gameplayPreferences: ClientGameplayPreferences | null;
	readonly gameplayEnabled: boolean;
	readonly onGameplayOptionChange: (
		option: ClientGameplayOption,
		enabled: boolean,
	) => Promise<void>;
	readonly jumpChargeActive: boolean;
	readonly readJumpExtent: () => number;
	/** Configured power controls displayed as keycaps below POWER. */
	readonly jumpPowerKeys: readonly [string, string];
	readonly preciseJumpActive: boolean;
	readonly onPreciseJumpAim: (clientX: number, clientY: number) => void;
	readonly onPreciseJumpPowerAdjust: (steps: number) => void;
	/** Set an absolute normalized power from the HUD bar. */
	readonly onPreciseJumpPowerSet: (power: number) => void;
	readonly onPreciseJumpActivate: () => void;
}

/** Inventory, action bars, item drag/interactions, external containers, vendor, salvage, locks, barber, and P2P trade. */
export interface ClientGameplayInventorySurface {
	/** Session-owned inventory state, independent of floating-panel mounts. */
	readonly inventory: ClientInventoryState | null;
	/** Direct authority for cross-panel item gestures. */
	readonly itemSession: ItemDragSession | null;
	/** Shared use/combining owner for all mounted entry points. */
	readonly itemInteractions: ClientItemInteractions | null;
	/** Null while no authoritative character profile is ready. */
	readonly actionBars: readonly ClientActionBar[] | null;
	readonly onActionBarsChange: (bars: readonly ClientActionBar[]) => void;
	/** Presentation owner for confirmed external storage, independent of system-panel selection. */
	readonly worldContainer: ClientWorldContainerPanelState | null;
	/** Session-owned vendor draft and catalog presentation. */
	readonly vendor: ClientVendorState | null;
	/** Session-local crystal interaction; effective-home knowledge is separate. */
	readonly houseCrystal: ClientHouseCrystalState | null;
	/** Character-owned salvage draft and local confirmation policy. */
	readonly salvage: ClientSalvageState | null;
	readonly locks: ClientLocksState | null;
	/** Server-granted appearance editor; local drafts never enter world state. */
	readonly barber: ClientBarberState | null;
	/** Session-owned P2P gestures and confirmed offer presentation. */
	readonly trade: ClientTradeState | null;
	readonly onSelectContentsItem: (
		guid: number,
		mode: "toggle" | "select",
	) => void;
	/** Resolve world inventory destinations without changing selection. */
	readonly onPickInventoryTarget: ClientViewportTargetPicker;
	/** Ordinary inventory refusal feedback. */
	readonly onInventoryNotice: (message: string) => void;
}

/** Combat stance/profiles, spell services, spell bar bindings/activation, and combat/lock target feedback. */
export interface ClientGameplayCombatMagicSurface {
	/** Server-confirmed stance for the dock, independent of open panels. */
	readonly combatMode: ClientCombatMode;
	readonly combatStatus: ClientCombatStatus;
	readonly combatControls: ClientCharacterSettings["combatControls"];
	/** Accepted setting interactions used to replay combat-HUD feedback. */
	readonly combatProfileSelectionRevision: number;
	readonly onCombatProfileSelect: (profile: ClientAttackProfile) => void;
	/** Cancel attack intent without changing stance or selection. */
	readonly onStopCombat: () => void;
	/** Gameplay lifecycle admits stance commands. */
	readonly combatEnabled: boolean;
	/** Same stance action used by the keyboard binding. */
	readonly onToggleCombat: () => void;
	/** Lazily retained spell artwork, independent of floating-panel mounts. */
	readonly spells: ClientSpellServices | null;
	/** Session-local bindings shared with game dispatch. */
	readonly spellBar: ClientSpellBarState;
	readonly onSpellBarChange: (value: ClientSpellBarState) => void;
	/** Commit a complete tab swap and publish its app-owned confirmation. */
	readonly onSwapSpellTabs: (
		source: InputDigitIndex,
		target: InputDigitIndex,
	) => void;
	/** App-owned casting availability, independent of membership. */
	readonly spellBarEnabled: boolean;
	readonly onSelectSpellTab: (tab: InputDigitIndex) => void;
	readonly onActivateSpellCell: (slot: number) => void;
	readonly onActivateCasterSpell: () => void;
	/** Shared normal casting action used by the spell browser. */
	readonly onCastSpell: (spellId: number) => void;
	readonly spellCastTarget: number | null;
	readonly readCombatTargetFrame: () => ClientCombatTargetFrame | null;
	/** Pull transient target feedback independently of helper visibility. */
	readonly readLockFeedbackFrames: () => readonly ClientLockFeedbackFrame[];
	readonly hasActiveLockFeedback: () => boolean;
	readonly lockFeedbackWakeRevision: number;
}

/** Viewport camera/mouse, minimap, waypoints, nearby/selected entities, inspection, books, world map, housing, and recall. */
export interface ClientGameplayWorldSurface {
	readonly cameraController: ClientViewportCameraController | null;
	/** App-owned semantic mouse movement dispatch. */
	readonly mouseMovement: ClientMouseMovementInput;
	readonly readMinimapFrame: () => MinimapFrame;
	/** Shell-owned confirmation after the minimap clipboard write succeeds. */
	readonly onCoordinatesCopied: () => void;
	/** Set the current local destination without submitting chat. */
	readonly onSetWaypoint: (target: MapWaypointTarget) => void;
	/** Clear session-owned navigation intent without changing selection. */
	readonly onClearWaypoint: () => void;
	/** Session-owned catalog; closed windows do not stop detection. */
	readonly nearby: ClientNearby | null;
	readonly selectedEntityGuid: number | null;
	readonly hoveredEntityGuid: number | null;
	/** Client-owned selected facts with optional presentation details. */
	readonly readSelectedEntity: () => ClientSelectedEntity | null;
	readonly readSelectedEntityDisplay: () => ClientSelectedEntityDisplay;
	readonly readTargetIndicatorFrame: () => ClientTargetIndicatorFrame | null;
	/** Accepted selection click, with activation requested only on the second click. */
	readonly onViewportSelect: (
		clientX: number,
		clientY: number,
		interact: boolean,
	) => void;
	readonly onViewportExamine: (clientX: number, clientY: number) => void;
	readonly onViewportHover: (clientX: number, clientY: number) => void;
	/** Clear world hover and invalidate in-flight acquisition on surface exit. */
	readonly onViewportHoverClear: () => void;
	readonly onMaintainEntitySelection: () => void;
	readonly onSelectEntity: (guid: number | null) => void;
	/** Shared admission for explicit entity references from chat and the nearby catalog. */
	readonly onSelectKnownEntity: (guid: number) => boolean;
	/** Use the currently selected entity through the session-owned interaction controller. */
	readonly onInteractEntity: () => void;
	/** Latest captured examination request, independent of current selection. */
	readonly inspection: ClientInspectionState;
	/** Current item reference admission for the retained inspection window. */
	readonly inspectionItemSelection: ClientInspectionItemSelection | null;
	readonly objectPreviewService: ClientObjectPreviewService;
	readonly onExamineEntity: () => void;
	/** Inspect the explicit identity without changing gameplay selection. */
	readonly onExamineItem: (guid: number) => void;
	/** Open a local spell subject without submitting an appraisal. */
	readonly onExamineSpell: (spellId: number) => void;
	readonly onCloseInspection: () => void;
	readonly bookReader: ClientBookReaderState;
	readonly onCloseBook: () => void;
	readonly onRetryBook: () => void;
	/** Static host capability, owned by the mounted transport lifetime. */
	readonly worldMapSource: WorldMapSource | null;
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
}

/** Chat lines/composer/history, emotes, party, friends, contracts, squelch, allegiance, and corpse permissions. */
export interface ClientGameplaySocialSurface {
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
	/** Chat interaction failures use the app-owned toast system. */
	readonly onChatNotice: (message: string) => void;
	/** Lifecycle and reveal admission, independent of modal ownership. */
	readonly emotesEnabled: boolean;
	/** Session-lifetime party presentation owner. */
	readonly party: ClientPartyState | null;
	/** Session-owned cold visibility fact; vitals remain imperative. */
	readonly partyHudPresent: boolean;
	readonly readPartyHudDisplay: () => PartyHudDisplay | null;
	readonly onPartyHudDemand: (enabled: boolean) => void;
	/** Party roster acquisition requires known local entity facts. */
	readonly onSelectPartyMember: (guid: number) => void;
	readonly friends: ClientFriendsState | null;
	readonly contracts: ClientContractsState | null;
	readonly squelch: ClientSquelchState | null;
	readonly allegiance: ClientAllegianceState | null;
	/** Session eligibility; target identity remains selection-owned. */
	readonly readCanSetCorpsePermission: () => boolean;
	/** Captured name and requested grant/revoke operation, with no optimistic status. */
	readonly onCorpsePermission: (playerName: string, granted: boolean) => void;
	/** Surface social dispatch failures even when the Social panel is closed. */
	readonly onSocialNotice: (message: string) => void;
}
