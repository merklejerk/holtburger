import type {
	ClientGameplayOption,
	ClientGameplayPreferences,
} from "./client-gameplay-options-contract";
import { characterManagementPending } from "./client-character-selection";
import {
	abortError,
	isAbortError,
	awaitWithAbort,
} from "../lib/async-lifetime";
import { ClientCameraRegistrations } from "./client-camera-registrations";
import { ClientAppraisalRequests } from "./client-appraisal-requests";
import {
	salvagePreviewRequestSchema,
	salvagePreviewResultSchema,
	salvageSubmitRequestSchema,
	salvageSubmitResultSchema,
	type SalvagePreviewRequest,
	type SalvagePreviewResult,
	type SalvageSubmitRequest,
	type SalvageSubmitResult,
} from "./client-salvage-contract";
import {
	playerVisualCaptureSchema,
	type PlayerVisualCapture,
} from "./client-object-preview-contract";
import {
	characterManagementSchema,
	type CharacterManagementState,
} from "./client-host-contract";
import {
	characterCreationDraftSchema,
	type CharacterCreationDraft,
} from "./client-character-creation-contract";
import {
	deathLocationResultSchema,
	type DeathLocationResult,
	type DeathLocationQuery,
	type CorpseConsentAction,
} from "./client-death-contract";
import {
	ClientPartyUpdates,
	type PartyUpdateConsumer,
} from "./client-party-updates";
import {
	decodeClientCombatOutcome,
	clientChatRequestSchema,
	type ClientChatRequest,
	type ClientCombatOutcome,
} from "./client-host-contract";
import { ClientContractsState } from "./client-contracts-state";
import { equipmentSlotLabel, type LoadoutBinding } from "./client-loadout";
import {
	contractsUpdatedSchema,
	contractMembershipChangeSchema,
	type ContractMembershipChange,
} from "./client-contracts-contract";
import { ClientAllegianceState } from "./client-allegiance-state";
import { allegianceUpdatedSchema } from "./client-allegiance-contract";
import { ClientSquelchState } from "./client-squelch-state";
import { squelchUpdatedSchema } from "./client-squelch-contract";
import { ClientFriendsState } from "./client-friends-state";
import { friendsUpdatedSchema } from "./client-friends-contract";
import { z } from "zod";
import {
	partySnapshotSchema,
	partyActionSchema,
	type PartySnapshot,
	type PartyPreferences,
	type PartyAction,
} from "./client-party-contract";
import {
	emptyHousing,
	housingManagementRequestSchema,
	housingManagementResultSchema,
	type HousingManagementRequest,
	type HousingManagementResult,
	housingSearchRequestSchema,
	housingSnapshotSchema,
	housingCrystalSchema,
	type HousingSnapshot,
	type HousingCrystal,
	housingPreviewRequestSchema,
	housingPreviewResultSchema,
	type HousingPreviewRequest,
	type HousingPreviewResult,
	housingPaymentRequestSchema,
	housingPaymentResultSchema,
	type HousingPaymentRequest,
	type HousingPaymentResult,
} from "./client-housing-contract";
import {
	tradeRequestSchema,
	tradeSnapshotSchema,
	type TradeSnapshot,
	type TradeRequest,
} from "./client-trade-contract";
import {
	barberSnapshotSchema,
	barberPreviewSchema,
	barberRequestSchema,
	type BarberSnapshot,
	type BarberPreview,
	type BarberRequest,
} from "./client-barber-contract";
import {
	vendorRequestSchema,
	vendorSnapshotSchema,
	vendorApproachedSchema,
	vendorPreviewSchema,
	vendorResultSchema,
	vendorPhaseSchema,
	type VendorRequest,
	type VendorSnapshot,
	type VendorPreview,
	type VendorResult,
	type VendorPhase,
} from "./client-vendor-contract";
import {
	decodeResolvedEnchantments,
	type ResolvedEnchantments,
} from "./client-enchantments-contract";
import {
	characterSheetSchema,
	progressionEvaluatedSchema,
	progressionFeedbackSchema,
	progressionIntentSchema,
	progressionQuoteSchema,
	type ProgressionIntent,
	type ProgressionQuote,
} from "./client-character-sheet-contract";
import { ClientCharacterSheetState } from "./client-character-sheet-state";
import {
	spellInspectionQuerySchema,
	spellInspectionContextSchema,
	spellInspectionResultSchema,
	type SpellInspectionQuery,
	type SpellInspectionContext,
	type SpellInspectionResult,
} from "./client-spell-inspection-contract";
import {
	itemUseTargetQuerySchema,
	itemUseTargetResultSchema,
	type ClientItemUseTargetQuery,
	type ClientItemUseTargetResult,
	itemUseRequestSchema,
	itemUseResultSchema,
	itemUseFinishedSchema,
	lockedTargetSchema,
	type ClientItemUseRequest,
	type ClientItemUseResult,
	type ClientItemUseFinished,
	type ClientLockedTarget,
} from "./client-item-use-contract";
import {
	inventoryIntentSchema,
	type ClientInventoryIntent,
	inventoryPreviewRequestSchema,
	inventoryPreviewResultSchema,
	type ClientInventoryPreviewRequest,
	type ClientInventoryPreviewResult,
} from "./client-inventory-contract";
import {
	decodeObjectInspectionResult,
	objectInspectionTargetSchema,
	type ObjectInspectionResult,
} from "./client-object-inspection-contract";
import {
	clientBookSchema,
	clientBookOpenedSchema,
	clientBookPageRequestSchema,
	type ClientBook,
	type ClientBookOpened,
	type ClientBookPageRequest,
} from "./client-book-contract";
import {
	decodeObjectPreviewResult,
	type ObjectPreviewResult,
} from "./client-object-preview-contract";
import {
	ClientEntityMirror,
	clientEntityDeltaSchema,
} from "./client-entity-mirror";
import {
	recallDestinationSchema,
	recallDestinationsSchema,
	type RecallDestination,
	decodeClientCurrentState,
	clientMapPositionSchema,
	type ClientMapPosition,
	mapTeleportCapabilitySchema,
	connectionSampleSchema,
	type ClientConnectionSample,
	decodeClientCombatMode,
	type ClientCombatMode,
	decodeClientCombatStatus,
	spellCastTargetSchema,
	type ClientCombatStatus,
	clientAttackProfileSchema,
	type ClientAttackProfile,
	decodeClientSpells,
	decodeClientCharacterPreferences,
	type ClientAppearanceOption,
	type ClientAppearanceOptions,
	decodeClientEntityCollisionDisabled,
	decodeClientDynamicScriptCue,
	decodeClientDynamicSoundCue,
	type ClientDynamicSoundCue,
	decodeClientLocalPlayerEstablished,
	decodeClientCameraStartReceipt,
	decodeClientCameraTick,
	decodeClientPresentationTick,
	decodeClientDriveRequest,
	decodeClientCharacterMotionEventRequest,
	decodeClientCharacterMotionCapabilities,
	decodeClientCharacterMotionFeedback,
	decodeClientPreciseJumpAimRequest,
	decodeClientPreciseJumpCommitRequest,
	decodeClientPreciseJumpCancelRequest,
	decodeClientPreciseJumpEvaluation,
	decodeClientPreciseJumpTransactionFeedback,
	decodeClientEntitySelectionQueryRequest,
	decodeClientEntitySelectionQueryResult,
	decodeClientExitRequested,
	decodeClientLifecycle,
	decodeClientPresentationDiscontinuity,
	decodeClientServerTime,
	decodeClientWorldName,
	decodeClientPlayerEntered,
	decodeClientVitals,
	decodeClientEntityHealth,
	type ClientEntityHealth,
	decodeClientChatMessage,
	decodeClientActionFeedback,
	decodeClientServerText,
	decodeClientConfirmationUpdated,
	type ClientConfirmation,
	type ClientActionFeedback,
	type ClientCurrentState,
	type ClientDynamicScriptCue,
	type ClientCameraIdentity,
	type ClientCameraClearanceRequest,
	type ClientCameraIntentRequest,
	type ClientCameraStartReceipt,
	type ClientCameraStartRequest,
	type ClientCameraTick,
	type ClientPresentationTick,
	type ClientDriveRequest,
	type ClientCharacterMotionEventRequest,
	type ClientCharacterMotionCapabilities,
	type ClientCharacterMotionFeedback,
	type ClientPreciseJumpAimRequest,
	type ClientPreciseJumpCommitRequest,
	type ClientPreciseJumpCancelRequest,
	type ClientPreciseJumpProgress,
	type ClientPreciseJumpTransactionFeedback,
	type ClientEntitySelectionQueryRequest,
	type ClientEntitySelectionQueryResult,
	type ClientExitRequested,
	type ClientLifecycle,
	type ClientLocalPlayerEstablished,
	type ClientPresentationDiscontinuity,
	type ClientVital,
	type ClientChatMessage,
	type ClientPlayerEntered,
} from "./client-host-contract";
import {
	DynamicEntityMirror,
	type DynamicEntityEvent,
} from "../lib/game/runtime/dynamic-entity-feed";
import { DynamicEntitySession } from "../lib/game/runtime/dynamic-entity-session";
import {
	type HostCommandArguments,
	type HostCommandName,
	type HostEventName,
	type HostTransport,
} from "../lib/host/host-transport";
import type { ClientSpellCastAim } from "./client-spell-casting";

type ClientCommandName = Extract<
	HostCommandName,
	| "examine_client_entity"
	| "read_client_book_page"
	| "request_client_current_state"
	| "refresh_client_housing"
	| "query_client_housing_access"
	| "search_client_housing"
	| "preview_client_housing_payment"
	| "submit_client_housing_payment"
	| "submit_client_housing_management"
	| "select_client_character"
	| "create_client_character"
	| "delete_client_character"
	| "restore_client_character"
	| "replace_client_drive"
	| "queue_client_character_motion_event"
	| "submit_client_friends"
	| "submit_client_contracts"
	| "submit_client_squelch"
	| "submit_client_allegiance"
	| "submit_client_party"
	| "set_client_party_updates"
	| "query_client_death_locations"
	| "manage_client_corpse_consent"
	| "set_client_corpse_permission"
	| "set_client_corpse_consent"
	| "kill_client_character"
	| "send_client_chat"
	| "teleport_client_to_map_position"
	| "recall_client"
	| "toggle_client_combat_mode"
	| "set_client_appearance_option"
	| "set_client_gameplay_option"
	| "cast_client_spell"
	| "begin_client_combat_engagement"
	| "update_client_combat_profile"
	| "stop_client_combat_engagement"
	| "query_client_entity_health"
	| "preview_client_inventory"
	| "preview_client_vendor"
	| "submit_client_vendor"
	| "submit_client_trade"
	| "request_client_barber"
	| "submit_client_inventory"
	| "close_client_container"
	| "equip_client_item"
	| "apply_client_equipment_set"
	| "query_client_item_use_target"
	| "query_client_spell_inspection"
	| "evaluate_client_progression"
	| "submit_client_progression"
	| "set_client_character_title"
	| "preview_client_salvage"
	| "submit_client_salvage"
	| "submit_client_item_use"
	| "respond_to_client_confirmation"
	| "start_client_camera"
	| "set_client_camera_intent"
	| "set_client_camera_clearance"
	| "set_client_entity_collision_disabled"
	| "set_client_precise_jump_aim"
	| "query_client_entity_selection_candidates"
	| "commit_client_precise_jump"
	| "cancel_client_precise_jump"
	| "acknowledge_client_world_reveal"
	| "stop_client_camera"
	| "logout_client"
	| "disconnect_client"
>;
type ClientEventName = Extract<
	HostEventName,
	| "client-object-inspection-result"
	| "client-book-opened"
	| "client-book-updated"
	| "client-object-preview-result"
	| "client-current-state"
	| "client-connection-updated"
	| "client-inventory-preview"
	| "client-vendor-snapshot"
	| "client-vendor-approached"
	| "client-housing-updated"
	| "client-housing-payment-preview"
	| "client-housing-payment-finished"
	| "client-housing-management-finished"
	| "client-housing-crystal-received"
	| "client-trade-snapshot"
	| "client-barber-updated"
	| "client-barber-preview"
	| "client-vendor-preview"
	| "client-vendor-result"
	| "client-vendor-phase"
	| "client-death-locations"
	| "client-item-use-target-result"
	| "client-spell-inspection-context"
	| "client-spell-inspection-result"
	| "client-salvage-preview"
	| "client-salvage-result"
	| "client-item-use-result"
	| "client-item-use-finished"
	| "client-locked-target"
	| "client-state-resyncing"
	| "client-entity-facts-changed"
	| "client-entity-collision-disabled"
	| "client-map-teleport-capability-changed"
	| "client-recall-destinations-changed"
	| "client-lifecycle-changed"
	| "client-character-management-changed"
	| "client-player-visual-capture-changed"
	| "client-character-motion-capabilities-updated"
	| "client-character-motion-feedback"
	| "client-server-controlled-motion"
	| "client-precise-jump-evaluation"
	| "client-precise-jump-transaction-feedback"
	| "client-entity-selection-query-result"
	| "client-local-player-established"
	| "client-server-time-updated"
	| "client-world-name-updated"
	| "client-player-entered"
	| "client-player-vitals-updated"
	| "client-character-sheet-updated"
	| "client-progression-evaluated"
	| "client-progression-feedback"
	| "client-player-spells-updated"
	| "client-player-enchantments-updated"
	| "client-character-preferences-updated"
	| "client-friends-updated"
	| "client-contracts-updated"
	| "client-contract-membership-changed"
	| "client-squelch-updated"
	| "client-allegiance-updated"
	| "client-party-updated"
	| "client-combat-mode-updated"
	| "client-combat-status-updated"
	| "client-spell-cast-target-updated"
	| "client-entity-health-updated"
	| "client-chat-message"
	| "client-combat-outcome"
	| "client-transient-string"
	| "client-popup-string"
	| "client-confirmation-updated"
	| "client-action-feedback"
	| "client-dynamic-entity"
	| "client-dynamic-script-cue"
	| "client-dynamic-sound-cue"
	| "client-camera-started"
	| "client-camera"
	| "client-presentation-tick"
	| "client-presentation-discontinuity"
	| "client-exit-requested"
>;

/** Narrow injected seam used by the client lifecycle owner and its browser tests. */
export interface ClientLifecycleTransport {
	invoke(
		command: ClientCommandName,
		args?: HostCommandArguments,
	): Promise<unknown>;
	listen(
		event: ClientEventName,
		handler: (payload: unknown) => void,
	): Promise<() => void>;
}

/** Renderer-visible lifecycle values held independently of Svelte and presentation resources. */
export interface ClientTimedEnchantments {
	readonly resolved: ResolvedEnchantments;
	/** Browser clock at snapshot receipt, used only for local countdown display. */
	readonly receivedAtMs: number;
}

/** A core observation anchored to the browser clock for activity expiry. */
export interface ClientConnectionObservation {
	/** Shared transport rates, sample age, and health classification. */
	readonly sample: ClientConnectionSample;
	/** Browser monotonic time when this observation arrived. */
	readonly receivedAtMs: number;
}

export interface ClientLifecycleSessionState {
	/** Recoverable character operation, independent of world presentation. */
	readonly characterManagement: CharacterManagementState;
	/** Latest complete cold capture, forwarded directly to persistence. */
	readonly playerVisualCapture: PlayerVisualCapture | null;
	readonly lifecycle: ClientLifecycle | null;
	readonly playerGuid: number | null;
	readonly worldGeneration: number;
	readonly worldName: string | null;
	readonly playerName: string | null;
	/** Null until a complete description is available. */
	readonly knownSpells: readonly number[] | null;
	/** Shared enchantment facts sampled into this browser's clock on receipt. */
	readonly enchantments: ClientTimedEnchantments | null;
	/** Server-backed appearance preferences, null until PlayerDescription is available. */
	readonly appearanceOptions: ClientAppearanceOptions | null;
	/** Mirrored server-saved Gameplay choices for the active character. */
	readonly gameplayPreferences: ClientGameplayPreferences | null;
	/** Latest server stance, consumed by the combat shortcut. */
	readonly combatMode: ClientCombatMode;
	readonly combat: ClientCombatStatus;
	/** Core-resolved non-self recipient, retained only while the cast operation is pending. */
	readonly spellCastTarget: number | null;
	readonly vitals: readonly ClientVital[];
	readonly characterMotion: ClientCharacterMotionCapabilities | null;
	/** Current server question, retained independently of presentation mounts. */
	readonly activeConfirmation: ClientConfirmation | null;
	readonly exit: ClientExitRequested | null;
}

/** One accepted authority update delivered to app-local lifecycle consumers. */
export type ClientLifecycleSessionEvent =
	/** Retained character facts changed; feature owners read the authoritative sheet. */
	| { readonly type: "character-sheet" }
	| { readonly type: "salvage-preview"; readonly result: SalvagePreviewResult }
	| { readonly type: "salvage-result"; readonly result: SalvageSubmitResult }
	| { readonly type: "death-locations"; readonly result: DeathLocationResult }
	| {
			readonly type: "contract-membership-change";
			readonly change: ContractMembershipChange;
	  }
	| { readonly type: "book-opened"; readonly receipt: ClientBookOpened }
	| { readonly type: "book-updated"; readonly book: ClientBook }
	| { readonly type: "housing-updated"; readonly housing: HousingSnapshot }
	| {
			readonly type: "housing-management-finished";
			readonly result: HousingManagementResult;
	  }
	| {
			readonly type: "housing-payment-finished";
			readonly result: HousingPaymentResult;
	  }
	| {
			readonly type: "housing-payment-preview";
			readonly result: HousingPreviewResult;
	  }
	| {
			readonly type: "housing-crystal-received";
			readonly crystal: HousingCrystal;
	  }
	| { readonly type: "vendor-snapshot"; readonly vendor: VendorSnapshot }
	| {
			readonly type: "vendor-approached";
			readonly vendor: NonNullable<VendorSnapshot>;
	  }
	| { readonly type: "trade-snapshot"; readonly trade: TradeSnapshot }
	| { readonly type: "barber-updated"; readonly barber: BarberSnapshot }
	| { readonly type: "barber-preview"; readonly result: BarberPreview }
	| { readonly type: "vendor-preview"; readonly result: VendorPreview }
	| { readonly type: "vendor-result"; readonly result: VendorResult }
	| { readonly type: "vendor-phase"; readonly phase: VendorPhase }
	| {
			readonly type: "object-inspection-result";
			readonly result: ObjectInspectionResult;
	  }
	| {
			readonly type: "object-preview-result";
			readonly result: ObjectPreviewResult;
	  }
	| { readonly type: "combat-mode"; readonly mode: ClientCombatMode }
	| { readonly type: "combat"; readonly status: ClientCombatStatus }
	| {
			readonly type: "appearance-options";
			readonly options: ClientAppearanceOptions;
	  }
	| {
			readonly type: "gameplay-preferences";
			readonly preferences: ClientGameplayPreferences;
	  }
	| { readonly type: "spells"; readonly spellIds: readonly number[] }
	| {
			readonly type: "enchantments";
			readonly enchantments: ClientTimedEnchantments;
	  }
	| {
			readonly type: "spell-inspection-context";
			readonly context: SpellInspectionContext;
	  }
	| {
			readonly type: "spell-inspection-result";
			readonly result: SpellInspectionResult;
	  }
	| {
			readonly type: "item-use-target-result";
			readonly result: ClientItemUseTargetResult;
	  }
	| { readonly type: "item-use-result"; readonly result: ClientItemUseResult }
	| {
			readonly type: "item-use-finished";
			readonly result: ClientItemUseFinished;
	  }
	| { readonly type: "locked-target"; readonly target: ClientLockedTarget }
	| {
			readonly type: "inventory-preview";
			readonly result: ClientInventoryPreviewResult;
	  }
	| { readonly type: "entity-collision-disabled"; readonly disabled: boolean }
	| { readonly type: "map-teleport-capability"; readonly allowed: boolean }
	| {
			readonly type: "recall-destinations";
			readonly destinations: readonly RecallDestination[];
	  }
	| { readonly type: "dynamic-sound-cue"; readonly cue: ClientDynamicSoundCue }
	| {
			readonly type: "confirmation";
			readonly confirmation: ClientConfirmation | null;
	  }
	| {
			readonly type: "party-presence";
			/** A solo fellowship is still a valid chat destination. */
			readonly inParty: boolean;
			/** HUD roster appears only when another member is present. */
			readonly hudPresent: boolean;
	  }
	| { readonly type: "party-updates-failed"; readonly message: string }
	| { readonly type: "entities" }
	| { readonly type: "resyncing" }
	| { readonly type: "current-state"; readonly state: ClientCurrentState }
	| {
			readonly type: "player-visual-capture";
			readonly capture: PlayerVisualCapture | null;
	  }
	| { readonly type: "lifecycle"; readonly lifecycle: ClientLifecycle }
	| {
			readonly type: "character-management";
			readonly state: CharacterManagementState;
	  }
	| {
			readonly type: "character-motion-capabilities";
			readonly capabilities: ClientCharacterMotionCapabilities | null;
	  }
	| {
			readonly type: "character-motion-feedback";
			readonly feedback: ClientCharacterMotionFeedback;
	  }
	| { readonly type: "server-controlled-motion" }
	| {
			readonly type: "precise-jump-evaluation";
			readonly evaluation: ClientPreciseJumpProgress;
	  }
	| {
			readonly type: "precise-jump-transaction-feedback";
			readonly feedback: ClientPreciseJumpTransactionFeedback;
	  }
	| {
			readonly type: "entity-selection-query-result";
			readonly result: ClientEntitySelectionQueryResult;
	  }
	| {
			readonly type: "local-player-established";
			readonly identity: ClientLocalPlayerEstablished;
	  }
	| { readonly type: "server-time"; readonly time: number }
	| { readonly type: "world-name"; readonly name: string }
	| { readonly type: "player-entered"; readonly player: ClientPlayerEntered }
	| { readonly type: "vitals"; readonly vitals: readonly ClientVital[] }
	| { readonly type: "entity-health"; readonly health: ClientEntityHealth }
	| { readonly type: "chat"; readonly message: ClientChatMessage }
	| {
			readonly type: "combat-outcome";
			readonly outcome: ClientCombatOutcome;
			readonly receivedAtMs: number;
	  }
	| {
			/** Server notice or popup; presentation owns dismissal and expiry. */
			readonly type: "transient-string" | "popup-string";
			readonly message: string;
	  }
	| {
			readonly type: "action-feedback";
			readonly feedback: ClientActionFeedback;
	  }
	| { readonly type: "dynamic"; readonly event: DynamicEntityEvent }
	| {
			readonly type: "dynamic-script-cue";
			readonly cue: ClientDynamicScriptCue;
	  }
	| {
			readonly type: "camera-started";
			readonly receipt: ClientCameraStartReceipt;
	  }
	| { readonly type: "camera-error"; readonly message: string }
	| { readonly type: "camera"; readonly tick: ClientCameraTick }
	| {
			readonly type: "presentation-tick";
			readonly tick: ClientPresentationTick;
			readonly receivedAtMs: number;
	  }
	| {
			readonly type: "presentation-discontinuity";
			readonly discontinuity: ClientPresentationDiscontinuity;
	  }
	| { readonly type: "exit-requested"; readonly exit: ClientExitRequested };

/**
 * Owns the first-cut client lifecycle projection and focused dynamic mirror.
 *
 * The host listener set is installed before the first current-state request. Dynamic deltas are
 * ignored by the injected mirror while a replacement snapshot is pending, so receiver loss cannot
 * leave a plausible but incomplete client scene.
 */
/** Startup withdrawal and live authority observation have distinct retirement points. */
interface SessionAttachment {
	readonly events: AbortController;
	readonly startup: AbortController;
	readonly completion: Promise<void>;
	readonly unlisteners: (() => void)[];
}

export class ClientLifecycleSession {
	/** Latest submitted snapshot names outlive shortcut removal, without retaining past activations. */
	#equipmentNames = new Map<number, string>();
	/** Imperative progression owner retained across character-panel mounts. */
	readonly characterSheet: ClientCharacterSheetState;
	/** Shared appraisal work routes results to requesting consumers without opening UI. */
	readonly appraisals: ClientAppraisalRequests;
	/** Dedicated Friends owner; the session only routes transport and lifecycle. */
	readonly friends: ClientFriendsState;
	/** Character-owned journal read model and local controls. */
	readonly contracts: ClientContractsState;
	/** Dedicated Ignores projection; the session routes rather than duplicates state. */
	readonly squelch: ClientSquelchState;
	/** Allegiance owner keeps interaction policy outside session routing. */
	readonly allegiance: ClientAllegianceState;
	readonly mirror: DynamicEntityMirror;
	readonly #transport: ClientLifecycleTransport;
	/** Native camera registration and command admission belong to the session, not a driver. */
	readonly #cameras: ClientCameraRegistrations;
	readonly #listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	/** Shared semantic source for inventory, selection, and selected display. */
	readonly entities = new ClientEntityMirror();
	readonly #dynamicSession: DynamicEntitySession;
	#attachment: SessionAttachment | null = null;
	readonly #partyUpdates: ClientPartyUpdates;
	/** Cold membership/HUD publication excludes roster and vital updates. */
	#partyPresence = { inParty: false, hudPresent: false };
	#party: PartySnapshot | null = null;
	#partyPreferences: PartyPreferences | null = null;
	#state: ClientLifecycleSessionState = emptyState();
	/** Transport samples stay imperative; only the mounted badge polls them. */
	#connection: ClientConnectionObservation | null = null;
	/** Receipt-owned clock survives delayed presentation mounts, but never session stop. */
	#serverClock: {
		readonly serverTime: number;
		readonly receivedAtMs: number;
	} | null = null;
	#vendor: VendorSnapshot = null;
	#housing: HousingSnapshot = emptyHousing();
	#trade: TradeSnapshot = { trade: null, pending_items: [] };
	/** Cold barber lifetime; candidate visual resources stay with the presentation owner. */
	#barber: BarberSnapshot = {
		interaction: null,
		result: null,
		particles: null,
	};
	#entryRequestGuid: number | null = null;

	constructor(
		transport: ClientLifecycleTransport,
		mirror = new DynamicEntityMirror(),
	) {
		this.#transport = transport;
		this.#cameras = new ClientCameraRegistrations({
			start: async (request) => {
				await transport.invoke("start_client_camera", { request });
			},
			stop: async (request) => {
				await transport.invoke("stop_client_camera", { request });
			},
			report: (error) =>
				this.#emit({
					type: "camera-error",
					message: error instanceof Error ? error.message : String(error),
				}),
		});
		this.appraisals = new ClientAppraisalRequests(async (guid) => {
			await transport.invoke(
				"examine_client_entity",
				objectInspectionTargetSchema.parse({ guid }),
			);
		});
		this.#partyUpdates = new ClientPartyUpdates(
			async (enabled) => {
				await transport.invoke("set_client_party_updates", { enabled });
			},
			(error) =>
				this.#emit({ type: "party-updates-failed", message: String(error) }),
		);
		this.allegiance = new ClientAllegianceState(async (action) => {
			await this.#transport.invoke("submit_client_allegiance", { action });
		});
		this.squelch = new ClientSquelchState(async (action) => {
			await this.#transport.invoke("submit_client_squelch", { action });
		});
		this.friends = new ClientFriendsState(async (action) => {
			await this.#transport.invoke("submit_client_friends", { action });
		});
		this.contracts = new ClientContractsState(
			async (action) => {
				await this.#transport.invoke("submit_client_contracts", { action });
			},
			() => performance.now(),
		);
		this.characterSheet = new ClientCharacterSheetState(
			(requestId, intents) => this.evaluateProgression(requestId, intents),
			(quote) => this.submitProgression(quote),
			async (character, titleId) => {
				await this.#transport.invoke("set_client_character_title", {
					character,
					titleId,
				});
			},
			(message) =>
				this.#emit({
					type: "action-feedback",
					feedback: { message, tone: "warning" },
				}),
		);
		this.mirror = mirror;
		this.#dynamicSession = new DynamicEntitySession(
			{
				subscribe: (handler) =>
					this.#transport.listen("client-dynamic-entity", handler),
				requestCurrentState: async () => {
					await this.#transport.invoke("request_client_current_state");
				},
			},
			mirror,
		);
		this.#dynamicSession.subscribe((event) => {
			this.#emit({ type: "dynamic", event });
		});
	}

	/** Install every listener before optional authority startup, then request an atomic snapshot.
	 * Omit startup when attaching to an already-running authority (for example diagnostic harnesses).
	 */
	start(options?: {
		readonly startAuthority: () => Promise<void>;
	}): Promise<void> {
		if (this.#attachment !== null) return this.#attachment.completion;
		this.#cameras.open();
		this.#serverClock = null;
		this.#state = emptyState();
		this.#resetCharacterLists();
		this.#connection = null;
		this.characterSheet.reset(null, null);
		this.#vendor = null;
		this.#housing = emptyHousing();
		this.#trade = { trade: null, pending_items: [] };
		this.#barber = { interaction: null, result: null, particles: null };
		const attachment: SessionAttachment = {
			events: new AbortController(),
			startup: new AbortController(),
			unlisteners: [],
			completion: Promise.resolve().then(() =>
				this.#attach(attachment, options),
			),
		};
		this.#attachment = attachment;
		return attachment.completion;
	}
	async #attach(
		attachment: SessionAttachment,
		options: { readonly startAuthority: () => Promise<void> } | undefined,
	): Promise<void> {
		const signal = AbortSignal.any([
			attachment.startup.signal,
			attachment.events.signal,
		]);
		try {
			signal.throwIfAborted();
			await this.#dynamicSession.start({
				signal,
				beforeRequest: async () => {
					await this.#listenToSiblingEvents(
						signal,
						attachment.events.signal,
						attachment.unlisteners,
					);
					signal.throwIfAborted();
					if (options !== undefined)
						await awaitWithAbort(options.startAuthority(), signal);
				},
			});
		} catch (error) {
			if (this.#attachment === attachment) this.#dynamicSession.stop();
			// An issued native launch can still publish its terminal outcome while presentation retires.
			if (!isAbortError(error) || attachment.events.signal.aborted) {
				if (this.#attachment === attachment) this.#serverClock = null;
				attachment.events.abort(abortError("Client attachment retired."));
				for (const unlisten of attachment.unlisteners.splice(0)) unlisten();
				if (this.#attachment === attachment) this.#attachment = null;
			}
			throw error;
		}
	}
	/** Withdraw unissued startup stages without losing live authority observation needed for cleanup. */
	cancelStartup(): void {
		this.#attachment?.startup.abort(abortError("Client startup withdrawn."));
	}

	/** Stop all listeners and require replacement state if this owner starts again. */
	stop(): void {
		this.#cameras.close();
		this.#equipmentNames = new Map();
		this.#partyUpdates.stop();
		this.#serverClock = null;
		this.#resetCharacterLists();
		const attachment = this.#attachment;
		this.#attachment = null;
		if (attachment !== null) {
			attachment.startup.abort(abortError("Client session retired."));
			attachment.events.abort(abortError("Client session retired."));
			for (const unlisten of attachment.unlisteners.splice(0)) unlisten();
		}
		this.#dynamicSession.stop();
		this.entities.awaitSnapshot();
		this.#entryRequestGuid = null;
		this.#state = {
			...this.#state,
			knownSpells: null,
			enchantments: null,
			appearanceOptions: null,
			gameplayPreferences: null,
		};
		this.characterSheet.reset(null, null);
		this.#connection = null;
		this.#housing = emptyHousing();
		this.#emit({ type: "resyncing" });
	}

	/** Read the retained transport observation without subscribing the UI to network events. */
	connectionSample(): ClientConnectionObservation | null {
		return this.#connection;
	}

	/** Submit a validated user build; completion arrives through retained management state. */
	async createCharacter(draft: CharacterCreationDraft): Promise<void> {
		const lifecycle = this.#state.lifecycle;
		if (lifecycle?.kind !== "character-selection")
			throw new Error("Character creation requires character selection.");
		const management = this.#state.characterManagement;
		if (characterManagementPending(management))
			throw new Error("A character-management operation is still pending.");
		if (lifecycle.characters.length >= lifecycle.maxSlots)
			throw new Error("The server's character slots are full.");
		await this.#transport.invoke("create_client_character", {
			draft: characterCreationDraftSchema.parse(draft),
		});
	}

	/** Resolve the current roster slot from identity immediately before deletion. */
	async deleteCharacter(guid: number): Promise<void> {
		const character = this.#editableCharacter(guid);
		if (character.deleteTime !== 0)
			throw new Error("Character is already pending deletion.");
		await this.#transport.invoke("delete_client_character", {
			slot: character.slot,
		});
	}

	/** Server authority decides whether the recovery window is still open. */
	async restoreCharacter(guid: number): Promise<void> {
		const character = this.#editableCharacter(guid);
		if (character.deleteTime === 0)
			throw new Error("Character is not pending deletion.");
		await this.#transport.invoke("restore_client_character", { guid });
	}

	/** Reject stale dialog targets and operations outside character selection. */
	#editableCharacter(guid: number) {
		const lifecycle = this.#state.lifecycle;
		if (lifecycle?.kind !== "character-selection")
			throw new Error("Character management requires character selection.");
		if (characterManagementPending(this.#state.characterManagement))
			throw new Error("A character-management operation is still pending.");
		const character = lifecycle.characters.find(
			(character) => character.guid === guid,
		);
		if (character === undefined)
			throw new Error("Character is no longer in the server roster.");
		return character;
	}

	/** Read the latest lifecycle facts without exposing the host transport or protocol types. */
	state(): ClientLifecycleSessionState {
		return this.#state;
	}

	/** Extrapolate the synchronized observation with browser monotonic time only. */
	readServerTime(timeMs: number): number | null {
		const anchor = this.#serverClock;
		return anchor === null
			? null
			: anchor.serverTime + (timeMs - anchor.receivedAtMs) / 1000;
	}

	/** Observe accepted lifecycle, time, dynamic, correction, and terminal updates. */
	subscribe(
		listener: (event: ClientLifecycleSessionEvent) => void,
	): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Request replacement state after a declared receiver loss; deltas are suppressed first. */
	async requestCurrentState(): Promise<void> {
		this.#dynamicSession.invalidate();
		await this.#transport.invoke("request_client_current_state");
	}

	/** Submit one exact authority-provided character identity for the explicit enter action. */
	async enterWorld(guid: number): Promise<void> {
		if (this.#entryRequestGuid === guid) return;
		this.#entryRequestGuid = guid;
		try {
			await this.#transport.invoke("select_client_character", { guid });
		} catch (error) {
			this.#entryRequestGuid = null;
			throw error;
		}
	}

	/** Queue an option update only while current character gameplay is available. */
	async setGameplayOption(
		option: ClientGameplayOption,
		enabled: boolean,
	): Promise<void> {
		if (
			this.#state.lifecycle?.kind !== "in-world" ||
			this.#state.gameplayPreferences === null
		) {
			throw new Error("Gameplay settings require an active character.");
		}
		await this.#transport.invoke("set_client_gameplay_option", {
			option,
			enabled,
		});
	}

	/** Change one appearance preference persisted by the active-character authority. */
	async setAppearanceOption(
		option: ClientAppearanceOption,
		enabled: boolean,
	): Promise<void> {
		await this.#transport.invoke("set_client_appearance_option", {
			option,
			enabled,
		});
	}

	/** Submit held drive or relative facing; core owns cadence, sequence numbers, and movement limits. */
	async replaceDrive(request: ClientDriveRequest): Promise<void> {
		const validated = decodeClientDriveRequest(request);
		// Authority already retires held movement on these boundaries; late local release needs no IPC.
		if (this.#state.lifecycle?.kind !== "in-world") return;
		await this.#transport.invoke("replace_client_drive", {
			request: validated,
		});
	}

	/** Submit one ordered, non-coalescible jump lifecycle edge. */
	async queueCharacterMotionEvent(
		request: ClientCharacterMotionEventRequest,
	): Promise<void> {
		const validated = decodeClientCharacterMotionEventRequest(request);
		if (this.#state.lifecycle?.kind !== "in-world") return;
		await this.#transport.invoke("queue_client_character_motion_event", {
			request: validated,
		});
	}

	/** Replace the server health subscription; null means explicit deselection. */
	async queryEntityHealth(guid: number | null): Promise<void> {
		await this.#transport.invoke("query_client_entity_health", {
			guid: guid ?? 0,
		});
	}

	/** Queue the exact displayed response; the confirmation update acknowledges core submission. */
	async respondToConfirmation(
		requestId: string,
		accepted: boolean,
	): Promise<void> {
		await this.#transport.invoke("respond_to_client_confirmation", {
			request_id: requestId,
			accepted,
		});
	}

	/** Shared offers and acknowledgment waits survive HUD window mounts. */
	tradeSnapshot(): TradeSnapshot {
		return this.#trade;
	}

	async submitTrade(request: TradeRequest): Promise<void> {
		await this.#transport.invoke("submit_client_trade", {
			request: tradeRequestSchema.parse(request),
		});
	}

	/** Recoverable interaction level, independent of HUD mount lifetime. */
	barberSnapshot(): BarberSnapshot {
		return this.#barber;
	}

	async requestBarber(request: BarberRequest): Promise<void> {
		await this.#transport.invoke("request_client_barber", {
			request: barberRequestSchema.parse(request),
		});
	}

	/** Retained housing facts survive panel mounts; opening intent is an independent event. */
	housingSnapshot(): HousingSnapshot {
		return this.#housing;
	}

	async refreshHousing(): Promise<void> {
		await this.#transport.invoke("refresh_client_housing");
	}

	/** Explicit management reads wait for effective-home initialization in core. */
	async queryHousingAccess(): Promise<void> {
		await this.#transport.invoke("query_client_housing_access");
	}

	/** Available results describe areas, including textual apartment results. */
	async searchHousing(houseType: number): Promise<void> {
		await this.#transport.invoke(
			"search_client_housing",
			housingSearchRequestSchema.parse({ houseType }),
		);
	}

	/** Preview edits and auto-fill return candidates only; no payment or item transfer is sent. */
	async previewHousingPayment(request: HousingPreviewRequest): Promise<void> {
		await this.#transport.invoke("preview_client_housing_payment", {
			request: housingPreviewRequestSchema.parse(request),
		});
	}

	/** Payment dispatch carries the profile and consumption accepted in confirmation. */
	async submitHousingPayment(request: HousingPaymentRequest): Promise<void> {
		await this.#transport.invoke("submit_client_housing_payment", {
			request: housingPaymentRequestSchema.parse(request),
		});
	}

	/** Submit only the explicitly reviewed character/home administrative intent. */
	async submitHousingManagement(
		request: HousingManagementRequest,
	): Promise<void> {
		await this.#transport.invoke("submit_client_housing_management", {
			request: housingManagementRequestSchema.parse(request),
		});
	}

	vendorSnapshot(): VendorSnapshot {
		return this.#vendor;
	}

	async previewVendor(request: VendorRequest): Promise<void> {
		await this.#transport.invoke("preview_client_vendor", {
			request: vendorRequestSchema.parse(request),
		});
	}

	async submitVendor(request: VendorRequest): Promise<void> {
		await this.#transport.invoke("submit_client_vendor", {
			request: vendorRequestSchema.parse(request),
		});
	}

	/** Request shared drop semantics; results carry the caller's gesture sequence. */
	async previewInventory(
		request: ClientInventoryPreviewRequest,
	): Promise<void> {
		await this.#transport.invoke("preview_client_inventory", {
			request: inventoryPreviewRequestSchema.parse(request),
		});
	}

	/** Submission is re-evaluated by core; an earlier preview is not an authorization token. */
	async submitInventory(intent: ClientInventoryIntent): Promise<void> {
		this.#equipmentNames.delete(intent.item);
		await this.#transport.invoke("submit_client_inventory", {
			intent: inventoryIntentSchema.parse(intent),
		});
	}

	/** Identity-specific close; late window disposal cannot close a replacement root. */
	async closeContainer(guid: number): Promise<void> {
		await this.#transport.invoke("close_client_container", { guid });
	}

	/** Request character-bound spell facts independently of panel visibility. */
	async querySpellInspection(query: SpellInspectionQuery): Promise<void> {
		await this.#transport.invoke("query_client_spell_inspection", {
			query: spellInspectionQuerySchema.parse(query),
		});
	}

	/** Price visible character actions in one current core scope. */
	async evaluateProgression(
		requestId: number,
		intents: readonly ProgressionIntent[],
	): Promise<void> {
		await this.#transport.invoke("evaluate_client_progression", {
			requestId,
			intents: intents.map((intent) => progressionIntentSchema.parse(intent)),
		});
	}

	/** The quote is revalidated and guarded in core before any wire action. */
	async submitProgression(quote: ProgressionQuote): Promise<void> {
		await this.#transport.invoke("submit_client_progression", {
			quote: progressionQuoteSchema.parse(quote),
		});
	}

	/** Request text for one listed page of the active character's book. */
	async readBookPage(request: ClientBookPageRequest): Promise<void> {
		await this.#transport.invoke(
			"read_client_book_page",
			clientBookPageRequestSchema.parse(request),
		);
	}

	/** Evaluate a considered target without executing use. */
	async queryItemUseTarget(query: ClientItemUseTargetQuery): Promise<void> {
		await this.#transport.invoke("query_client_item_use_target", {
			query: itemUseTargetQuerySchema.parse(query),
		});
	}

	/** Request read-only tool discovery and evaluation of the proposed salvage batch. */
	async previewSalvage(request: SalvagePreviewRequest): Promise<void> {
		await this.#transport.invoke("preview_client_salvage", {
			request: salvagePreviewRequestSchema.parse(request),
		});
	}
	/** Dispatch only if the world-produced review still matches current source facts. */
	async submitSalvage(request: SalvageSubmitRequest): Promise<void> {
		await this.#transport.invoke("submit_client_salvage", {
			request: salvageSubmitRequestSchema.parse(request),
		});
	}

	/** Submit a use with a semantic execution precondition. */
	async submitItemUse(request: ClientItemUseRequest): Promise<void> {
		await this.#transport.invoke("submit_client_item_use", {
			request: itemUseRequestSchema.parse(request),
		});
	}

	/** Equip one owned item through core’s equipment replacement policy with a side preference. */
	async equipItem(guid: number, alternate: boolean): Promise<void> {
		this.#equipmentNames.delete(guid);
		await this.#transport.invoke("equip_client_item", {
			guid,
			alternate,
		});
	}

	/** Submit equipment primitives while retaining app-only names for attributed warnings. */
	async applyEquipmentSet(bindings: readonly LoadoutBinding[]): Promise<void> {
		this.#equipmentNames = new Map(
			bindings.flatMap((binding) =>
				binding.item === null ? [] : [[binding.item, binding.name] as const],
			),
		);
		await this.#transport.invoke("apply_client_equipment_set", {
			bindings: bindings.map((binding) => ({
				item: binding.item,
				target: binding.slot,
			})),
		});
	}

	#receiveActionFeedback(payload: unknown): void {
		const feedback = decodeClientActionFeedback(payload);
		if (feedback.equipment === undefined) {
			this.#emit({ type: "action-feedback", feedback });
			return;
		}
		for (const binding of feedback.equipment) {
			const name =
				binding.item === null ? null : this.#equipmentNames.get(binding.item);
			const itemLabel = name === undefined ? `item ${binding.item}` : name;
			this.#emit({
				type: "action-feedback",
				feedback: {
					tone: "warning",
					message:
						binding.item === null
							? `Could not clear ${equipmentSlotLabel(binding.target)}: ${feedback.message}`
							: `Could not equip ${itemLabel} to ${equipmentSlotLabel(binding.target)}: ${feedback.message}`,
				},
			});
		}
	}

	/** Cast using complete caller-owned recipient intent; core resolves normal spell routes. */
	async castSpell(spellId: number, aim: ClientSpellCastAim): Promise<void> {
		if (this.#attachment === null || this.#attachment.unlisteners.length === 0)
			throw new Error("Spell session is unavailable.");
		if (
			this.#state.lifecycle?.kind !== "in-world" ||
			this.#state.combatMode !== "magic"
		)
			throw new Error("Enter magic stance before casting.");
		await this.#transport.invoke("cast_client_spell", {
			spellId,
			aim,
		});
	}

	/** Request the equipment-derived stance toggle; server events confirm the outcome. */
	async toggleCombatMode(): Promise<void> {
		if (this.#state.lifecycle?.kind !== "in-world") return;
		await this.#transport.invoke("toggle_client_combat_mode");
	}

	async beginCombatEngagement(
		target: number,
		profile: ClientAttackProfile,
		intentSequence: number,
	): Promise<void> {
		if (this.#state.lifecycle?.kind !== "in-world") return;
		await this.#transport.invoke("begin_client_combat_engagement", {
			intentSequence,
			target,
			profile: clientAttackProfileSchema.parse(profile),
		});
	}

	async updateCombatProfile(profile: ClientAttackProfile): Promise<void> {
		await this.#transport.invoke("update_client_combat_profile", {
			profile: clientAttackProfileSchema.parse(profile),
		});
	}

	async stopCombatEngagement(intentSequence: number): Promise<void> {
		await this.#transport.invoke("stop_client_combat_engagement", {
			intentSequence,
		});
	}

	/** Retained fellowship facts stay imperative, independent of panel lifetime. */
	partySnapshot(): PartySnapshot | null {
		return this.#party;
	}
	partyPreferences(): PartyPreferences | null {
		return this.#partyPreferences;
	}
	async submitParty(action: PartyAction): Promise<void> {
		await this.#transport.invoke("submit_client_party", {
			action: partyActionSchema.parse(action),
		});
	}
	/** Surface demand is combined before any server request is sent. */
	setPartyUpdateDemand(consumer: PartyUpdateConsumer, enabled: boolean): void {
		this.#partyUpdates.setDemand(consumer, enabled);
	}
	/** Presence is computed by the session that owns player and roster identity. */
	partyHudPresent(): boolean {
		return this.#partyPresence.hudPresent;
	}
	/** On-demand data query; the app owns command grammar and presentation. */
	async queryDeathLocations(query: DeathLocationQuery): Promise<void> {
		await this.#transport.invoke("query_client_death_locations", { query });
	}
	async manageCorpseConsent(action: CorpseConsentAction): Promise<void> {
		await this.#transport.invoke("manage_client_corpse_consent", { action });
	}
	async setCorpsePermission(
		playerName: string,
		granted: boolean,
	): Promise<void> {
		await this.#transport.invoke("set_client_corpse_permission", {
			playerName,
			granted,
		});
	}
	async setCorpseConsent(enabled: boolean): Promise<void> {
		await this.#transport.invoke("set_client_corpse_consent", { enabled });
	}
	/** Caller owns user confirmation; no dialog policy crosses the host boundary. */
	async killCharacter(): Promise<void> {
		await this.#transport.invoke("kill_client_character", {});
	}

	/** Enqueue explicit chat intent after app-local command handling. */
	async sendChat(request: ClientChatRequest): Promise<void> {
		await this.#transport.invoke("send_client_chat", {
			request: clientChatRequestSchema.parse(request),
		});
	}

	/** Attempt a standard recall without predicting server acceptance. */
	async recall(destination: RecallDestination): Promise<void> {
		await this.#transport.invoke("recall_client", {
			destination: recallDestinationSchema.parse(destination),
		});
	}

	/** Submit one map point; server updates establish the actual teleport outcome. */
	async teleportToMapPosition(position: ClientMapPosition): Promise<void> {
		await this.#transport.invoke("teleport_client_to_map_position", {
			position: clientMapPositionSchema.parse(position),
		});
	}

	/** Register a client camera generation; its authority receipt arrives on the sibling event. */
	registerCamera(
		request: ClientCameraStartRequest,
		signal: AbortSignal,
	): Promise<ClientCameraIdentity> {
		return this.#cameras.register(request, signal);
	}

	async setCameraIntent(request: ClientCameraIntentRequest): Promise<void> {
		await this.#cameras.command(async () => {
			await this.#transport.invoke("set_client_camera_intent", { request });
		});
	}

	/** Requests a player-only override; the accepted setting arrives through the host event. */
	async setEntityCollisionDisabled(disabled: boolean): Promise<void> {
		await this.#transport.invoke("set_client_entity_collision_disabled", {
			disabled,
		});
	}

	async setCameraClearance(
		request: ClientCameraClearanceRequest,
	): Promise<void> {
		await this.#cameras.command(async () => {
			await this.#transport.invoke("set_client_camera_clearance", { request });
		});
	}

	/** Replace the queued precise-jump aim sample for the active camera generation. */
	async setPreciseJumpAim(request: ClientPreciseJumpAimRequest): Promise<void> {
		await this.#transport.invoke("set_client_precise_jump_aim", {
			request: decodeClientPreciseJumpAimRequest(request),
		});
	}

	/** Submit one viewport selection action; its correlated result arrives asynchronously. */
	async queryEntitySelectionCandidates(
		request: ClientEntitySelectionQueryRequest,
	): Promise<void> {
		await this.#transport.invoke("query_client_entity_selection_candidates", {
			request: decodeClientEntitySelectionQueryRequest(request),
		});
	}

	/** Submit one ordered commit edge carrying only core's opaque evaluation identity. */
	async commitPreciseJump(
		request: ClientPreciseJumpCommitRequest,
	): Promise<void> {
		await this.#transport.invoke("commit_client_precise_jump", {
			request: decodeClientPreciseJumpCommitRequest(request),
		});
	}

	/** Explicitly cancel precise-jump mode without launching. */
	async cancelPreciseJump(
		request: ClientPreciseJumpCancelRequest,
	): Promise<void> {
		await this.#transport.invoke("cancel_client_precise_jump", {
			request: decodeClientPreciseJumpCancelRequest(request),
		});
	}

	/** Acknowledge one installed, first-pure-destination frame for the current activation. */
	async acknowledgeWorldReveal(worldGeneration: number): Promise<void> {
		await this.#transport.invoke("acknowledge_client_world_reveal", {
			worldGeneration,
		});
	}

	async stopCamera(request: ClientCameraIdentity): Promise<void> {
		await this.#cameras.stop(request);
	}

	/** Gracefully leave the active character without ending the login session. */
	async logout(): Promise<void> {
		await this.#transport.invoke("logout_client");
	}

	/** Withdraw camera IPC before the Electron close owner takes over native shutdown. */
	prepareAuthorityShutdown(): void {
		this.#cameras.close();
	}

	/** Ask the authority to disconnect this one client attempt. */
	async disconnect(): Promise<void> {
		this.prepareAuthorityShutdown();
		await this.#transport.invoke("disconnect_client");
	}

	async #listenToSiblingEvents(
		installSignal: AbortSignal,
		eventsSignal: AbortSignal,
		unlisteners: (() => void)[],
	): Promise<(() => void)[]> {
		const listen = async (
			event: ClientEventName,
			handler: (payload: unknown) => void,
		): Promise<() => void> => {
			installSignal.throwIfAborted();
			const unlisten = await this.#transport.listen(event, (payload) => {
				if (!eventsSignal.aborted) handler(payload);
			});
			if (installSignal.aborted) {
				unlisten();
				throw installSignal.reason;
			}
			return unlisten;
		};
		try {
			unlisteners.push(
				await listen("client-book-opened", (payload) =>
					this.#emit({
						type: "book-opened",
						receipt: clientBookOpenedSchema.parse(payload),
					}),
				),
			);
			unlisteners.push(
				await listen("client-book-updated", (payload) =>
					this.#emit({
						type: "book-updated",
						book: clientBookSchema.parse(payload),
					}),
				),
			);
			unlisteners.push(
				await listen("client-object-inspection-result", (payload) =>
					this.#emit({
						type: "object-inspection-result",
						result: decodeObjectInspectionResult(payload),
					}),
				),
			);
			unlisteners.push(
				await listen("client-object-preview-result", (payload) =>
					this.#emit({
						type: "object-preview-result",
						result: decodeObjectPreviewResult(payload),
					}),
				),
			);
			unlisteners.push(
				await listen("client-entity-collision-disabled", (payload) =>
					this.#emit({
						type: "entity-collision-disabled",
						disabled: decodeClientEntityCollisionDisabled(payload),
					}),
				),
			);
			unlisteners.push(
				await listen("client-state-resyncing", (payload) => {
					if (payload !== null)
						throw new Error("Invalid client resync notification.");
					this.#state = {
						...this.#state,
						knownSpells: null,
						enchantments: null,
						appearanceOptions: null,
						gameplayPreferences: null,
					};
					this.entities.awaitSnapshot();
					this.mirror.awaitSnapshot();
					this.characterSheet.reset(null, null);
					this.#connection = null;
					this.#emit({ type: "resyncing" });
				}),
			);
			unlisteners.push(
				await listen("client-entity-facts-changed", (payload) => {
					const prepared = this.entities.prepareDelta(
						clientEntityDeltaSchema.parse(payload),
					);
					if (prepared === null) return;
					this.entities.commit(prepared);
					this.#emit({ type: "entities" });
				}),
			);
			unlisteners.push(
				await listen("client-player-spells-updated", (payload) => {
					const spellIds = decodeClientSpells(payload);
					this.#state = { ...this.#state, knownSpells: spellIds };
					this.#emit({ type: "spells", spellIds });
				}),
			);
			unlisteners.push(
				await listen("client-player-enchantments-updated", (payload) => {
					const enchantments = {
						resolved: decodeResolvedEnchantments(payload),
						receivedAtMs: performance.now(),
					};
					this.#state = { ...this.#state, enchantments };
					this.#emit({ type: "enchantments", enchantments });
				}),
			);
			unlisteners.push(
				await listen("client-allegiance-updated", (payload) => {
					this.allegiance.update(
						allegianceUpdatedSchema.parse(payload).allegiance,
					);
				}),
			);
			unlisteners.push(
				await listen("client-squelch-updated", (payload) => {
					this.squelch.update(squelchUpdatedSchema.parse(payload).squelch);
				}),
			);
			unlisteners.push(
				await listen("client-contracts-updated", (payload) => {
					this.contracts.update(
						contractsUpdatedSchema.parse(payload).contracts,
					);
				}),
			);
			unlisteners.push(
				await listen("client-contract-membership-changed", (payload) => {
					this.#emit({
						type: "contract-membership-change",
						change: contractMembershipChangeSchema.parse(payload),
					});
				}),
			);
			unlisteners.push(
				await listen("client-friends-updated", (payload) => {
					this.friends.update(friendsUpdatedSchema.parse(payload).friends);
				}),
			);
			unlisteners.push(
				await listen("client-party-updated", (payload) => {
					this.#party = z
						.object({ party: partySnapshotSchema.nullable() })
						.strict()
						.parse(payload).party;
					this.#updatePartyPresence();
				}),
			);
			unlisteners.push(
				await listen("client-character-preferences-updated", (payload) => {
					const preferences = decodeClientCharacterPreferences(payload);
					const options = preferences.appearance;
					this.#partyPreferences = preferences.party;
					this.friends.updatePreferences(preferences.friends);
					this.allegiance.updatePreferences(preferences.allegiance);
					this.#state = {
						...this.#state,
						appearanceOptions: options,
						gameplayPreferences: preferences.gameplay,
					};
					this.#emit({
						type: "gameplay-preferences",
						preferences: preferences.gameplay,
					});
					this.#emit({ type: "appearance-options", options });
				}),
			);
			unlisteners.push(
				await listen("client-combat-mode-updated", (payload) => {
					const { mode } = decodeClientCombatMode(payload);
					this.#state = { ...this.#state, combatMode: mode };
					this.#emit({ type: "combat-mode", mode });
				}),
			);
			unlisteners.push(
				await listen("client-spell-cast-target-updated", (payload) => {
					const { target } = spellCastTargetSchema.parse(payload);
					this.#state = { ...this.#state, spellCastTarget: target };
				}),
			);
			unlisteners.push(
				await listen("client-combat-status-updated", (payload) => {
					const status = decodeClientCombatStatus(payload);
					this.#state = { ...this.#state, combat: status };
					this.#emit({ type: "combat", status });
				}),
			);
			unlisteners.push(
				await listen("client-connection-updated", (payload) => {
					this.#connection = {
						sample: connectionSampleSchema.parse(payload),
						receivedAtMs: performance.now(),
					};
				}),
				await listen("client-current-state", (payload) =>
					this.#receiveCurrentState(payload),
				),
				await listen("client-recall-destinations-changed", (payload) => {
					this.#emit({
						type: "recall-destinations",
						destinations: recallDestinationsSchema.parse(payload),
					});
				}),
				await listen("client-map-teleport-capability-changed", (payload) =>
					this.#emit({
						type: "map-teleport-capability",
						allowed: mapTeleportCapabilitySchema.parse(payload),
					}),
				),
			);
			unlisteners.push(
				await listen("client-character-sheet-updated", (payload) => {
					const sheet = characterSheetSchema.nullable().parse(payload);
					// Character-entry status always republishes the complete sheet. Ignore
					// delayed updates from a retired entry while no character is active.
					if (
						this.#state.lifecycle?.kind !== "in-world" ||
						(sheet !== null && sheet.character !== this.#state.playerGuid)
					)
						return;
					this.characterSheet.replace(sheet);
					this.#emit({ type: "character-sheet" });
				}),
				await listen("client-progression-evaluated", (payload) => {
					const result = progressionEvaluatedSchema.parse(payload);
					this.characterSheet.acceptEvaluations(
						result.requestId,
						result.evaluations,
					);
				}),
				await listen("client-progression-feedback", (payload) =>
					this.characterSheet.acceptFeedback(
						progressionFeedbackSchema.parse(payload),
					),
				),
			);
			unlisteners.push(
				await listen("client-lifecycle-changed", (payload) =>
					this.#receiveLifecycle(payload),
				),
				await listen("client-character-management-changed", (payload) => {
					const state = characterManagementSchema.parse(payload);
					this.#state = { ...this.#state, characterManagement: state };
					this.#emit({ type: "character-management", state });
				}),
			);
			unlisteners.push(
				await listen("client-player-visual-capture-changed", (payload) => {
					const capture = playerVisualCaptureSchema.nullable().parse(payload);
					this.#state = { ...this.#state, playerVisualCapture: capture };
					this.#emit({ type: "player-visual-capture", capture });
				}),
			);
			unlisteners.push(
				await listen(
					"client-character-motion-capabilities-updated",
					(payload) => this.#receiveCharacterMotionCapabilities(payload),
				),
			);
			unlisteners.push(
				await listen("client-character-motion-feedback", (payload) =>
					this.#receiveCharacterMotionFeedback(payload),
				),
			);
			unlisteners.push(
				await listen("client-server-controlled-motion", (payload) => {
					if (payload !== null)
						throw new Error("Invalid server-controlled motion notification.");
					this.#emit({ type: "server-controlled-motion" });
				}),
			);
			unlisteners.push(
				await listen("client-precise-jump-evaluation", (payload) =>
					this.#receivePreciseJumpEvaluation(payload),
				),
			);
			unlisteners.push(
				await listen("client-precise-jump-transaction-feedback", (payload) =>
					this.#receivePreciseJumpTransactionFeedback(payload),
				),
			);
			unlisteners.push(
				await listen("client-death-locations", (payload) => {
					this.#emit({
						type: "death-locations",
						result: deathLocationResultSchema.parse(payload),
					});
				}),
			);
			unlisteners.push(
				await listen("client-item-use-target-result", (payload) => {
					this.#emit({
						type: "item-use-target-result",
						result: itemUseTargetResultSchema.parse(payload),
					});
				}),
				await listen("client-spell-inspection-context", (payload) => {
					this.#emit({
						type: "spell-inspection-context",
						context: spellInspectionContextSchema.parse(payload),
					});
				}),
				await listen("client-spell-inspection-result", (payload) => {
					this.#emit({
						type: "spell-inspection-result",
						result: spellInspectionResultSchema.parse(payload),
					});
				}),
				await listen("client-salvage-preview", (payload) => {
					this.#emit({
						type: "salvage-preview",
						result: salvagePreviewResultSchema.parse(payload),
					});
				}),
			);
			unlisteners.push(
				await listen("client-salvage-result", (payload) => {
					this.#emit({
						type: "salvage-result",
						result: salvageSubmitResultSchema.parse(payload),
					});
				}),
			);
			unlisteners.push(
				await listen("client-item-use-finished", (payload) => {
					this.#emit({
						type: "item-use-finished",
						result: itemUseFinishedSchema.parse(payload),
					});
				}),
				await listen("client-locked-target", (payload) => {
					this.#emit({
						type: "locked-target",
						target: lockedTargetSchema.parse(payload),
					});
				}),
				await listen("client-item-use-result", (payload) => {
					this.#emit({
						type: "item-use-result",
						result: itemUseResultSchema.parse(payload),
					});
				}),
				await listen("client-trade-snapshot", (payload) => {
					this.#trade = tradeSnapshotSchema.parse(payload);
					this.#emit({ type: "trade-snapshot", trade: this.#trade });
				}),
				await listen("client-barber-updated", (payload) => {
					this.#barber = barberSnapshotSchema.parse(payload);
					this.#emit({ type: "barber-updated", barber: this.#barber });
				}),
				await listen("client-barber-preview", (payload) => {
					this.#emit({
						type: "barber-preview",
						result: barberPreviewSchema.parse(payload),
					});
				}),
				await listen("client-housing-management-finished", (payload) => {
					this.#emit({
						type: "housing-management-finished",
						result: housingManagementResultSchema.parse(payload),
					});
				}),
				await listen("client-housing-updated", (payload) => {
					this.#housing = housingSnapshotSchema.parse(payload);
					this.#emit({ type: "housing-updated", housing: this.#housing });
				}),
				await listen("client-housing-payment-finished", (payload) => {
					this.#emit({
						type: "housing-payment-finished",
						result: housingPaymentResultSchema.parse(payload),
					});
				}),
				await listen("client-housing-crystal-received", (payload) => {
					const crystal = housingCrystalSchema.parse(payload);
					this.#housing = { ...this.#housing, crystal };
					this.#emit({ type: "housing-crystal-received", crystal });
				}),
				await listen("client-vendor-approached", (payload) => {
					const vendor = vendorApproachedSchema.parse(payload);
					this.#vendor = vendor;
					this.#emit({ type: "vendor-approached", vendor });
				}),
				await listen("client-vendor-snapshot", (payload) => {
					this.#vendor = vendorSnapshotSchema.parse(payload);
					this.#emit({ type: "vendor-snapshot", vendor: this.#vendor });
				}),
				await listen("client-vendor-preview", (payload) => {
					this.#emit({
						type: "vendor-preview",
						result: vendorPreviewSchema.parse(payload),
					});
				}),
				await listen("client-vendor-result", (payload) => {
					this.#emit({
						type: "vendor-result",
						result: vendorResultSchema.parse(payload),
					});
				}),
				await listen("client-vendor-phase", (payload) => {
					this.#emit({
						type: "vendor-phase",
						phase: vendorPhaseSchema.parse(payload),
					});
				}),
				await listen("client-inventory-preview", (payload) => {
					this.#emit({
						type: "inventory-preview",
						result: inventoryPreviewResultSchema.parse(payload),
					});
				}),
			);
			unlisteners.push(
				await listen("client-housing-payment-preview", (payload) => {
					this.#emit({
						type: "housing-payment-preview",
						result: housingPreviewResultSchema.parse(payload),
					});
				}),
			);
			unlisteners.push(
				await listen("client-entity-selection-query-result", (payload) =>
					this.#receiveEntitySelectionQueryResult(payload),
				),
			);
			unlisteners.push(
				await listen("client-local-player-established", (payload) =>
					this.#receiveLocalPlayerEstablished(payload),
				),
			);
			unlisteners.push(
				await listen("client-server-time-updated", (payload) =>
					this.#receiveServerTime(payload),
				),
			);
			unlisteners.push(
				await listen("client-world-name-updated", (payload) =>
					this.#receiveWorldName(payload),
				),
			);
			unlisteners.push(
				await listen("client-player-entered", (payload) =>
					this.#receivePlayerEntered(payload),
				),
			);
			unlisteners.push(
				await listen("client-player-vitals-updated", (payload) =>
					this.#receiveVitals(payload),
				),
			);
			unlisteners.push(
				await listen("client-entity-health-updated", (payload) =>
					this.#emit({
						type: "entity-health",
						health: decodeClientEntityHealth(payload),
					}),
				),
			);
			unlisteners.push(
				await listen("client-action-feedback", (payload) =>
					this.#receiveActionFeedback(payload),
				),
			);
			unlisteners.push(
				await listen("client-confirmation-updated", (payload) => {
					const { confirmation } = decodeClientConfirmationUpdated(payload);
					this.#state = { ...this.#state, activeConfirmation: confirmation };
					this.#emit({ type: "confirmation", confirmation });
				}),
			);
			for (const type of ["transient-string", "popup-string"] as const) {
				unlisteners.push(
					await listen(`client-${type}`, (payload) =>
						this.#emit({
							type,
							message: decodeClientServerText(payload).message,
						}),
					),
				);
			}
			unlisteners.push(
				await listen("client-combat-outcome", (payload) => {
					const outcome = decodeClientCombatOutcome(payload);
					const receivedAtMs = performance.now();
					if (
						this.mirror.isAwaitingSnapshot() ||
						outcome.worldGeneration !== this.#state.worldGeneration
					) {
						return;
					}
					this.#emit({
						type: "combat-outcome",
						outcome,
						receivedAtMs,
					});
				}),
			);
			unlisteners.push(
				await listen("client-chat-message", (payload) =>
					this.#receiveChat(payload),
				),
			);
			unlisteners.push(
				await listen("client-dynamic-sound-cue", (payload) =>
					this.#emit({
						type: "dynamic-sound-cue",
						cue: decodeClientDynamicSoundCue(payload),
					}),
				),
			);
			unlisteners.push(
				await listen("client-dynamic-script-cue", (payload) =>
					this.#emit({
						type: "dynamic-script-cue",
						cue: decodeClientDynamicScriptCue(payload),
					}),
				),
			);
			unlisteners.push(
				await listen("client-presentation-discontinuity", (payload) =>
					this.#receivePresentationDiscontinuity(payload),
				),
			);
			unlisteners.push(
				await listen("client-camera-started", (payload) =>
					this.#receiveCameraStarted(payload),
				),
			);

			unlisteners.push(
				await listen("client-presentation-tick", (payload) => {
					const receivedAtMs = performance.now();
					const tick = decodeClientPresentationTick(payload);
					if (this.mirror.isAwaitingSnapshot()) return;
					if (
						tick.dynamic !== null &&
						!this.mirror.apply({ kind: "ticked", batch: tick.dynamic })
					)
						return;
					this.#emit({ type: "presentation-tick", tick, receivedAtMs });
				}),
			);
			unlisteners.push(
				await listen("client-camera", (payload) =>
					this.#receiveCamera(payload),
				),
			);
			unlisteners.push(
				await listen("client-exit-requested", (payload) =>
					this.#receiveExit(payload),
				),
			);
			return unlisteners;
		} catch (error) {
			for (const unlisten of unlisteners.splice(0)) unlisten();
			throw error;
		}
	}

	#receiveCurrentState(payload: unknown): void {
		const state = decodeClientCurrentState(payload);
		this.#serverClock =
			state.serverTime === null
				? null
				: { serverTime: state.serverTime, receivedAtMs: performance.now() };
		this.allegiance.recover(
			state.allegiance,
			state.allegiancePreferences,
			state.localPlayerGuid,
			state.lifecycle.kind === "in-world",
		);
		this.squelch.recover(
			state.squelch,
			state.localPlayerGuid,
			state.lifecycle.kind === "in-world",
		);
		this.contracts.recover(
			state.contracts,
			state.localPlayerGuid,
			state.lifecycle.kind === "in-world",
		);
		this.friends.recover(
			state.friends,
			state.friendsPreferences,
			state.localPlayerGuid,
			state.lifecycle.kind === "in-world",
		);
		this.#party = state.party;
		this.#partyPreferences = state.partyPreferences;
		this.characterSheet.reset(state.characterSheet, state.lifecycle.kind);
		this.#housing = state.housing;
		this.#trade = state.trade;
		this.#barber = state.barber;
		const semantic = this.entities.prepareSnapshot(
			state.entities,
			state.localPlayerGuid,
		);
		const commitDynamic = this.mirror.prepareSnapshot(state.dynamic);
		if (state.lifecycle.kind !== "entering-world") {
			this.#entryRequestGuid = null;
		}
		this.#state = {
			...this.#state,
			lifecycle: state.lifecycle,
			characterManagement: state.characterManagement,
			playerVisualCapture: state.playerVisualCapture,
			playerGuid: state.localPlayerGuid,
			worldGeneration: state.worldGeneration,
			worldName: state.worldName,
			playerName: state.playerName,
			knownSpells: state.knownSpells,
			enchantments:
				state.enchantments === null
					? null
					: {
							resolved: state.enchantments,
							receivedAtMs: performance.now(),
						},
			appearanceOptions: state.appearanceOptions,
			gameplayPreferences: state.gameplayPreferences,
			combatMode: state.combatMode,
			combat: state.combat,
			spellCastTarget: state.spellCastTarget,
			vitals: state.vitals,
			characterMotion: state.characterMotion,
			activeConfirmation: state.activeConfirmation,
			exit: null,
		};
		const dynamic: DynamicEntityEvent = {
			kind: "snapshot",
			snapshot: state.dynamic,
		};
		this.#connection =
			state.connection === null
				? null
				: { sample: state.connection, receivedAtMs: performance.now() };
		this.entities.commit(semantic);
		commitDynamic();
		this.#emit({ type: "current-state", state });
		this.#emit({ type: "dynamic", event: dynamic });
	}

	#receiveLifecycle(payload: unknown): void {
		const lifecycle = decodeClientLifecycle(payload);
		if (
			lifecycle.kind === "portal-space" &&
			lifecycle.worldGeneration < this.#state.worldGeneration
		)
			return;
		if (lifecycle.kind !== "in-world") this.#equipmentNames = new Map();
		if (lifecycle.kind !== "entering-world") {
			this.#entryRequestGuid = null;
		}
		const retiresCharacterDescription =
			lifecycle.kind === "connecting" ||
			lifecycle.kind === "authenticating" ||
			lifecycle.kind === "character-selection" ||
			lifecycle.kind === "entering-world" ||
			lifecycle.kind === "exiting" ||
			(lifecycle.kind === "portal-space" &&
				lifecycle.cause === "initial-entry" &&
				lifecycle.worldGeneration !== this.#state.worldGeneration);
		this.#state = {
			...this.#state,
			lifecycle,
			knownSpells: retiresCharacterDescription ? null : this.#state.knownSpells,
			enchantments: retiresCharacterDescription
				? null
				: this.#state.enchantments,
			gameplayPreferences: retiresCharacterDescription
				? null
				: this.#state.gameplayPreferences,
			appearanceOptions: retiresCharacterDescription
				? null
				: this.#state.appearanceOptions,
			activeConfirmation:
				lifecycle.kind === "exiting" ? null : this.#state.activeConfirmation,
			worldGeneration:
				lifecycle.kind === "portal-space"
					? lifecycle.worldGeneration
					: this.#state.worldGeneration,
		};
		if (retiresCharacterDescription) this.characterSheet.reset(null, null);
		// Social packets can hydrate before PlayerCreate; portal revelation must retain them.
		if (lifecycle.kind !== "in-world" && lifecycle.kind !== "portal-space") {
			this.#resetCharacterLists();
		}
		// Initial activation may arrive as portal-space without a separate entering-world event.
		// Its completion supplies the new character baseline; teleports retain the current one.
		if (
			lifecycle.kind === "entering-world" ||
			(lifecycle.kind === "portal-space" && lifecycle.cause === "initial-entry")
		)
			this.entities.awaitSnapshot();
		this.#emit({ type: "lifecycle", lifecycle });
	}

	#receiveCharacterMotionCapabilities(payload: unknown): void {
		const capabilities = decodeClientCharacterMotionCapabilities(payload);
		this.#state = { ...this.#state, characterMotion: capabilities };
		this.#emit({ type: "character-motion-capabilities", capabilities });
	}

	#receiveCharacterMotionFeedback(payload: unknown): void {
		this.#emit({
			type: "character-motion-feedback",
			feedback: decodeClientCharacterMotionFeedback(payload),
		});
	}

	#receivePreciseJumpEvaluation(payload: unknown): void {
		this.#emit({
			type: "precise-jump-evaluation",
			evaluation: decodeClientPreciseJumpEvaluation(payload),
		});
	}

	#receivePreciseJumpTransactionFeedback(payload: unknown): void {
		this.#emit({
			type: "precise-jump-transaction-feedback",
			feedback: decodeClientPreciseJumpTransactionFeedback(payload),
		});
	}

	#receiveEntitySelectionQueryResult(payload: unknown): void {
		this.#emit({
			type: "entity-selection-query-result",
			result: decodeClientEntitySelectionQueryResult(payload),
		});
	}

	#receiveLocalPlayerEstablished(payload: unknown): void {
		const identity = decodeClientLocalPlayerEstablished(payload);
		this.#state = { ...this.#state, playerGuid: identity.playerGuid };
		this.#emit({ type: "local-player-established", identity });
	}

	#receiveServerTime(payload: unknown): void {
		const { time } = decodeClientServerTime(payload);
		this.#serverClock = { serverTime: time, receivedAtMs: performance.now() };
		this.#emit({ type: "server-time", time });
	}

	#receiveWorldName(payload: unknown): void {
		const { name } = decodeClientWorldName(payload);
		this.#state = { ...this.#state, worldName: name };
		this.#emit({ type: "world-name", name });
	}

	#receivePlayerEntered(payload: unknown): void {
		const player = decodeClientPlayerEntered(payload);
		if (player.playerGuid === this.#state.playerGuid) {
			this.#state = { ...this.#state, playerName: player.name };
		}
		this.#emit({ type: "player-entered", player });
	}

	#receiveVitals(payload: unknown): void {
		const updates = decodeClientVitals(payload).vitals;
		const byKind = new Map(
			this.#state.vitals.map((vital) => [vital.kind, vital]),
		);
		for (const vital of updates) byKind.set(vital.kind, vital);
		const vitals = ["health", "stamina", "mana"]
			.map((kind) => byKind.get(kind as ClientVital["kind"]))
			.filter((vital): vital is ClientVital => vital !== undefined);
		this.#state = { ...this.#state, vitals };
		this.#emit({ type: "vitals", vitals });
	}

	#receiveChat(payload: unknown): void {
		this.#emit({ type: "chat", message: decodeClientChatMessage(payload) });
	}

	#receivePresentationDiscontinuity(payload: unknown): void {
		const discontinuity = decodeClientPresentationDiscontinuity(payload);
		if (discontinuity.worldGeneration < this.#state.worldGeneration) return;
		this.#state = {
			...this.#state,
			worldGeneration: discontinuity.worldGeneration,
		};
		this.#emit({ type: "presentation-discontinuity", discontinuity });
	}

	#receiveCameraStarted(payload: unknown): void {
		const receipt = decodeClientCameraStartReceipt(payload);
		this.#cameras.receive(receipt);
		this.#emit({ type: "camera-started", receipt });
	}

	#receiveCamera(payload: unknown): void {
		this.#emit({ type: "camera", tick: decodeClientCameraTick(payload) });
	}

	#receiveExit(payload: unknown): void {
		const exit = decodeClientExitRequested(payload);
		this.#cameras.close();
		const lifecycle: ClientLifecycle = { kind: "exiting", cause: exit.cause };
		this.#state = { ...this.#state, lifecycle, exit, activeConfirmation: null };
		this.#emit({ type: "lifecycle", lifecycle });
		this.#emit({ type: "exit-requested", exit });
	}

	/** Retire character-owned journal and social facts together; portals retain them. */
	#resetCharacterLists(): void {
		this.friends.reset();
		this.contracts.reset();
		this.squelch.reset();
		this.allegiance.reset();
		this.#party = null;
		this.#partyPreferences = null;
		this.#updatePartyPresence();
	}

	#updatePartyPresence(): void {
		const player = this.#state.playerGuid;
		const inParty = player !== null && this.#party !== null;
		const hudPresent =
			player !== null &&
			this.#party !== null &&
			this.#party.members.some((member) => member.guid !== player);
		if (
			inParty === this.#partyPresence.inParty &&
			hudPresent === this.#partyPresence.hudPresent
		)
			return;
		this.#partyPresence = { inParty, hudPresent };
		this.#emit({ type: "party-presence", inParty, hudPresent });
	}

	#emit(event: ClientLifecycleSessionEvent): void {
		const phase =
			event.type === "lifecycle"
				? event.lifecycle.kind
				: event.type === "current-state"
					? event.state.lifecycle.kind
					: null;
		if (phase === "exiting") this.#cameras.close();
		else if (phase === "logging-out" || phase === "character-selection")
			this.#cameras.reset();
		this.appraisals.receive(event);
		if (event.type === "resyncing") {
			this.#partyUpdates.setActive(false, true);
			this.characterSheet.setContext(null);
			this.friends.setContext(this.#state.playerGuid, false);
			this.contracts.setContext(this.#state.playerGuid, false);
			this.squelch.setContext(this.#state.playerGuid, false);
			this.allegiance.setContext(this.#state.playerGuid, false);
		}
		if (
			event.type === "lifecycle" ||
			event.type === "current-state" ||
			event.type === "local-player-established"
		) {
			this.characterSheet.setContext(this.#state.lifecycle?.kind ?? null);
			this.#updatePartyPresence();
			this.#partyUpdates.setActive(
				this.#state.playerGuid !== null &&
					this.#state.lifecycle?.kind === "in-world",
				event.type === "current-state",
			);
			this.allegiance.setContext(
				this.#state.playerGuid,
				this.#state.lifecycle?.kind === "in-world",
			);
			this.squelch.setContext(
				this.#state.playerGuid,
				this.#state.lifecycle?.kind === "in-world",
			);
			this.contracts.setContext(
				this.#state.playerGuid,
				this.#state.lifecycle?.kind === "in-world",
			);
			this.friends.setContext(
				this.#state.playerGuid,
				this.#state.lifecycle?.kind === "in-world",
			);
		}
		for (const listener of this.#listeners) listener(event);
	}
}

function emptyState(): ClientLifecycleSessionState {
	return {
		characterManagement: { kind: "idle" },
		playerVisualCapture: null,
		lifecycle: null,
		playerGuid: null,
		worldGeneration: 0,
		worldName: null,
		playerName: null,
		knownSpells: null,
		enchantments: null,
		appearanceOptions: null,
		gameplayPreferences: null,
		combatMode: "unknown",
		combat: {
			desired: null,
			state: "idle",
			processedIntentSequence: 0,
			refill: null,
		},
		spellCastTarget: null,
		vitals: [],
		characterMotion: null,
		activeConfirmation: null,
		exit: null,
	};
}

export function hostClientLifecycleTransport(
	host: HostTransport,
): ClientLifecycleTransport {
	return {
		invoke: (command, args) => host.invoke(command, args),
		listen: (event, handler) => host.listen(event, handler),
	};
}
