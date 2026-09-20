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
	type ClientItemUseRequest,
	type ClientItemUseResult,
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
	decodeObjectPreviewResult,
	type ObjectPreviewResult,
} from "./client-object-preview-contract";
import {
	ClientEntityMirror,
	clientEntityDeltaSchema,
} from "./client-entity-mirror";
import {
	decodeClientCurrentState,
	decodeClientCombatMode,
	type ClientCombatMode,
	decodeClientCombatStatus,
	type ClientCombatStatus,
	clientAttackProfileSchema,
	type ClientAttackProfile,
	decodeClientSpells,
	decodeClientAppearanceOptions,
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
	type ClientPreciseJumpEvaluation,
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
	| "request_client_current_state"
	| "select_client_character"
	| "replace_client_drive"
	| "queue_client_character_motion_event"
	| "send_client_chat"
	| "toggle_client_combat_mode"
	| "set_client_appearance_option"
	| "cast_client_spell"
	| "begin_client_combat_engagement"
	| "update_client_combat_profile"
	| "stop_client_combat_engagement"
	| "query_client_entity_health"
	| "preview_client_inventory"
	| "submit_client_inventory"
	| "close_client_container"
	| "equip_client_item"
	| "query_client_item_use_target"
	| "query_client_spell_inspection"
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
	| "disconnect_client"
>;
type ClientEventName = Extract<
	HostEventName,
	| "client-object-inspection-result"
	| "client-object-preview-result"
	| "client-current-state"
	| "client-inventory-preview"
	| "client-item-use-target-result"
	| "client-spell-inspection-context"
	| "client-spell-inspection-result"
	| "client-item-use-result"
	| "client-state-resyncing"
	| "client-entity-facts-changed"
	| "client-entity-collision-disabled"
	| "client-lifecycle-changed"
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
	| "client-player-spells-updated"
	| "client-appearance-options-updated"
	| "client-combat-mode-updated"
	| "client-combat-status-updated"
	| "client-entity-health-updated"
	| "client-chat-message"
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
export interface ClientLifecycleSessionState {
	readonly lifecycle: ClientLifecycle | null;
	readonly playerGuid: number | null;
	readonly serverTime: number | null;
	readonly worldGeneration: number;
	readonly worldName: string | null;
	readonly playerName: string | null;
	/** Null until a complete description is available. */
	readonly knownSpells: readonly number[] | null;
	/** Server-backed appearance preferences, null until PlayerDescription is available. */
	readonly appearanceOptions: ClientAppearanceOptions | null;
	/** Latest server stance, consumed by the combat shortcut. */
	readonly combatMode: ClientCombatMode;
	readonly combat: ClientCombatStatus;
	readonly vitals: readonly ClientVital[];
	readonly characterMotion: ClientCharacterMotionCapabilities | null;
	/** Current server question, retained independently of presentation mounts. */
	readonly activeConfirmation: ClientConfirmation | null;
	readonly exit: ClientExitRequested | null;
}

/** One accepted authority update delivered to app-local lifecycle consumers. */
export type ClientLifecycleSessionEvent =
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
	| { readonly type: "spells"; readonly spellIds: readonly number[] }
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
			readonly type: "inventory-preview";
			readonly result: ClientInventoryPreviewResult;
	  }
	| { readonly type: "entity-collision-disabled"; readonly disabled: boolean }
	| { readonly type: "dynamic-sound-cue"; readonly cue: ClientDynamicSoundCue }
	| {
			readonly type: "confirmation";
			readonly confirmation: ClientConfirmation | null;
	  }
	| { readonly type: "entities" }
	| { readonly type: "resyncing" }
	| { readonly type: "current-state"; readonly state: ClientCurrentState }
	| { readonly type: "lifecycle"; readonly lifecycle: ClientLifecycle }
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
			readonly evaluation: ClientPreciseJumpEvaluation;
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
export class ClientLifecycleSession {
	readonly mirror: DynamicEntityMirror;
	readonly #transport: ClientLifecycleTransport;
	readonly #listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	/** Shared semantic source for inventory, selection, and selected display. */
	readonly entities = new ClientEntityMirror();
	readonly #dynamicSession: DynamicEntitySession;
	#unlisten: readonly (() => void)[] | null = null;
	#state: ClientLifecycleSessionState = emptyState();
	#entryRequestGuid: number | null = null;

	constructor(
		transport: ClientLifecycleTransport,
		mirror = new DynamicEntityMirror(),
	) {
		this.#transport = transport;
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

	/** Install every authority listener, then request one atomic replacement snapshot. */
	async start(): Promise<void> {
		if (this.#unlisten !== null) return;
		this.#state = emptyState();
		let siblingUnlisteners: readonly (() => void)[] = [];
		try {
			await this.#dynamicSession.start({
				beforeRequest: async () => {
					siblingUnlisteners = await this.#listenToSiblingEvents();
					this.#unlisten = siblingUnlisteners;
				},
			});
		} catch (error) {
			for (const unlisten of siblingUnlisteners) unlisten();
			this.#unlisten = null;
			this.#dynamicSession.stop();
			throw error;
		}
	}

	/** Stop all listeners and require replacement state if this owner starts again. */
	stop(): void {
		for (const unlisten of this.#unlisten ?? []) unlisten();
		this.#unlisten = null;
		this.#dynamicSession.stop();
		this.entities.awaitSnapshot();
		this.#entryRequestGuid = null;
		this.#state = {
			...this.#state,
			knownSpells: null,
			appearanceOptions: null,
		};
		this.#emit({ type: "resyncing" });
	}

	/** Read the latest lifecycle facts without exposing the host transport or protocol types. */
	state(): ClientLifecycleSessionState {
		return this.#state;
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

	/** Replace the held local drive; core owns cadence, sequence numbers, and movement limits. */
	async replaceDrive(request: ClientDriveRequest): Promise<void> {
		const validated = decodeClientDriveRequest(request);
		await this.#transport.invoke("replace_client_drive", {
			request: validated,
		});
	}

	/** Submit one ordered, non-coalescible jump lifecycle edge. */
	async queueCharacterMotionEvent(
		request: ClientCharacterMotionEventRequest,
	): Promise<void> {
		const validated = decodeClientCharacterMotionEventRequest(request);
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

	/** Request authoritative facts for one captured entity identity. */
	async examineEntity(guid: number): Promise<void> {
		await this.#transport.invoke(
			"examine_client_entity",
			objectInspectionTargetSchema.parse({ guid }),
		);
	}

	/** Evaluate a considered target without executing use. */
	async queryItemUseTarget(query: ClientItemUseTargetQuery): Promise<void> {
		await this.#transport.invoke("query_client_item_use_target", {
			query: itemUseTargetQuerySchema.parse(query),
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
		await this.#transport.invoke("equip_client_item", {
			guid,
			alternate,
		});
	}

	/** Cast using complete caller-owned recipient intent; core resolves normal spell routes. */
	async castSpell(spellId: number, aim: ClientSpellCastAim): Promise<void> {
		if (this.#unlisten === null)
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
	): Promise<void> {
		if (this.#state.lifecycle?.kind !== "in-world") return;
		await this.#transport.invoke("begin_client_combat_engagement", {
			target,
			profile: clientAttackProfileSchema.parse(profile),
		});
	}

	async updateCombatProfile(profile: ClientAttackProfile): Promise<void> {
		await this.#transport.invoke("update_client_combat_profile", {
			profile: clientAttackProfileSchema.parse(profile),
		});
	}

	async stopCombatEngagement(): Promise<void> {
		await this.#transport.invoke("stop_client_combat_engagement");
	}

	/** Send one ordinary local-speech message. */
	async sendChat(message: string): Promise<void> {
		if (message.trim().length === 0) {
			throw new Error("Chat message must contain visible text.");
		}
		await this.#transport.invoke("send_client_chat", { message });
	}

	/** Register a client camera generation; its authority receipt arrives on the sibling event. */
	async startCamera(request: ClientCameraStartRequest): Promise<void> {
		await this.#transport.invoke("start_client_camera", { request });
	}

	async setCameraIntent(request: ClientCameraIntentRequest): Promise<void> {
		await this.#transport.invoke("set_client_camera_intent", { request });
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
		await this.#transport.invoke("set_client_camera_clearance", { request });
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
		await this.#transport.invoke("stop_client_camera", { request });
	}

	/** Ask the authority to disconnect this one client attempt. */
	async disconnect(): Promise<void> {
		await this.#transport.invoke("disconnect_client");
	}

	async #listenToSiblingEvents(): Promise<(() => void)[]> {
		const unlisteners: (() => void)[] = [];
		try {
			unlisteners.push(
				await this.#transport.listen(
					"client-object-inspection-result",
					(payload) =>
						this.#emit({
							type: "object-inspection-result",
							result: decodeObjectInspectionResult(payload),
						}),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-object-preview-result",
					(payload) =>
						this.#emit({
							type: "object-preview-result",
							result: decodeObjectPreviewResult(payload),
						}),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-entity-collision-disabled",
					(payload) =>
						this.#emit({
							type: "entity-collision-disabled",
							disabled: decodeClientEntityCollisionDisabled(payload),
						}),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-state-resyncing", (payload) => {
					if (payload !== null)
						throw new Error("Invalid client resync notification.");
					this.#state = {
						...this.#state,
						knownSpells: null,
						appearanceOptions: null,
					};
					this.entities.awaitSnapshot();
					this.mirror.awaitSnapshot();
					this.#emit({ type: "resyncing" });
				}),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-entity-facts-changed",
					(payload) => {
						const prepared = this.entities.prepareDelta(
							clientEntityDeltaSchema.parse(payload),
						);
						if (prepared === null) return;
						this.entities.commit(prepared);
						this.#emit({ type: "entities" });
					},
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-player-spells-updated",
					(payload) => {
						const spellIds = decodeClientSpells(payload);
						this.#state = { ...this.#state, knownSpells: spellIds };
						this.#emit({ type: "spells", spellIds });
					},
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-appearance-options-updated",
					(payload) => {
						const options = decodeClientAppearanceOptions(payload);
						this.#state = { ...this.#state, appearanceOptions: options };
						this.#emit({ type: "appearance-options", options });
					},
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-combat-mode-updated",
					(payload) => {
						const { mode } = decodeClientCombatMode(payload);
						this.#state = { ...this.#state, combatMode: mode };
						this.#emit({ type: "combat-mode", mode });
					},
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-combat-status-updated",
					(payload) => {
						const status = decodeClientCombatStatus(payload);
						this.#state = { ...this.#state, combat: status };
						this.#emit({ type: "combat", status });
					},
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-current-state", (payload) =>
					this.#receiveCurrentState(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-lifecycle-changed", (payload) =>
					this.#receiveLifecycle(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-character-motion-capabilities-updated",
					(payload) => this.#receiveCharacterMotionCapabilities(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-character-motion-feedback",
					(payload) => this.#receiveCharacterMotionFeedback(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-server-controlled-motion",
					(payload) => {
						if (payload !== null)
							throw new Error("Invalid server-controlled motion notification.");
						this.#emit({ type: "server-controlled-motion" });
					},
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-precise-jump-evaluation",
					(payload) => this.#receivePreciseJumpEvaluation(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-precise-jump-transaction-feedback",
					(payload) => this.#receivePreciseJumpTransactionFeedback(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-item-use-target-result",
					(payload) => {
						this.#emit({
							type: "item-use-target-result",
							result: itemUseTargetResultSchema.parse(payload),
						});
					},
				),
				await this.#transport.listen(
					"client-spell-inspection-context",
					(payload) => {
						this.#emit({
							type: "spell-inspection-context",
							context: spellInspectionContextSchema.parse(payload),
						});
					},
				),
				await this.#transport.listen(
					"client-spell-inspection-result",
					(payload) => {
						this.#emit({
							type: "spell-inspection-result",
							result: spellInspectionResultSchema.parse(payload),
						});
					},
				),
				await this.#transport.listen("client-item-use-result", (payload) => {
					this.#emit({
						type: "item-use-result",
						result: itemUseResultSchema.parse(payload),
					});
				}),
				await this.#transport.listen("client-inventory-preview", (payload) => {
					this.#emit({
						type: "inventory-preview",
						result: inventoryPreviewResultSchema.parse(payload),
					});
				}),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-entity-selection-query-result",
					(payload) => this.#receiveEntitySelectionQueryResult(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-local-player-established",
					(payload) => this.#receiveLocalPlayerEstablished(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-server-time-updated", (payload) =>
					this.#receiveServerTime(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-world-name-updated", (payload) =>
					this.#receiveWorldName(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-player-entered", (payload) =>
					this.#receivePlayerEntered(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-player-vitals-updated",
					(payload) => this.#receiveVitals(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-entity-health-updated",
					(payload) =>
						this.#emit({
							type: "entity-health",
							health: decodeClientEntityHealth(payload),
						}),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-action-feedback", (payload) =>
					this.#emit({
						type: "action-feedback",
						feedback: decodeClientActionFeedback(payload),
					}),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-confirmation-updated",
					(payload) => {
						const { confirmation } = decodeClientConfirmationUpdated(payload);
						this.#state = { ...this.#state, activeConfirmation: confirmation };
						this.#emit({ type: "confirmation", confirmation });
					},
				),
			);
			for (const type of ["transient-string", "popup-string"] as const) {
				unlisteners.push(
					await this.#transport.listen(`client-${type}`, (payload) =>
						this.#emit({
							type,
							message: decodeClientServerText(payload).message,
						}),
					),
				);
			}
			unlisteners.push(
				await this.#transport.listen("client-chat-message", (payload) =>
					this.#receiveChat(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-dynamic-sound-cue", (payload) =>
					this.#emit({
						type: "dynamic-sound-cue",
						cue: decodeClientDynamicSoundCue(payload),
					}),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-dynamic-script-cue", (payload) =>
					this.#emit({
						type: "dynamic-script-cue",
						cue: decodeClientDynamicScriptCue(payload),
					}),
				),
			);
			unlisteners.push(
				await this.#transport.listen(
					"client-presentation-discontinuity",
					(payload) => this.#receivePresentationDiscontinuity(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-camera-started", (payload) =>
					this.#receiveCameraStarted(payload),
				),
			);

			unlisteners.push(
				await this.#transport.listen("client-presentation-tick", (payload) => {
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
				await this.#transport.listen("client-camera", (payload) =>
					this.#receiveCamera(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-exit-requested", (payload) =>
					this.#receiveExit(payload),
				),
			);
			return unlisteners;
		} catch (error) {
			for (const unlisten of unlisteners) unlisten();
			throw error;
		}
	}

	#receiveCurrentState(payload: unknown): void {
		const state = decodeClientCurrentState(payload);
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
			playerGuid: state.localPlayerGuid,
			serverTime: state.serverTime,
			worldGeneration: state.worldGeneration,
			worldName: state.worldName,
			playerName: state.playerName,
			knownSpells: state.knownSpells,
			appearanceOptions: state.appearanceOptions,
			combatMode: state.combatMode,
			combat: state.combat,
			vitals: state.vitals,
			characterMotion: state.characterMotion,
			activeConfirmation: state.activeConfirmation,
			exit: null,
		};
		const dynamic: DynamicEntityEvent = {
			kind: "snapshot",
			snapshot: state.dynamic,
		};
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
		this.#state = { ...this.#state, serverTime: time };
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
		this.#emit({
			type: "camera-started",
			receipt: decodeClientCameraStartReceipt(payload),
		});
	}

	#receiveCamera(payload: unknown): void {
		this.#emit({ type: "camera", tick: decodeClientCameraTick(payload) });
	}

	#receiveExit(payload: unknown): void {
		const exit = decodeClientExitRequested(payload);
		const lifecycle: ClientLifecycle = { kind: "exiting", cause: exit.cause };
		this.#state = { ...this.#state, lifecycle, exit, activeConfirmation: null };
		this.#emit({ type: "lifecycle", lifecycle });
		this.#emit({ type: "exit-requested", exit });
	}

	#emit(event: ClientLifecycleSessionEvent): void {
		for (const listener of this.#listeners) listener(event);
	}
}

function emptyState(): ClientLifecycleSessionState {
	return {
		lifecycle: null,
		playerGuid: null,
		serverTime: null,
		worldGeneration: 0,
		worldName: null,
		playerName: null,
		knownSpells: null,
		appearanceOptions: null,
		combatMode: "unknown",
		combat: { desired: null, state: "idle", refill: null },
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
