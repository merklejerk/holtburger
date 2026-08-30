import type { DynamicEntityEvent } from "../game/runtime/dynamic-entity-feed";
import type { ExplorerFixedTickEnvelope } from "../../explorer/explorer-fixed-tick";
import type { PossessionEventOutcome } from "../../explorer/explorer-entity-possession";
import type { HostPhysicalFlyFailure } from "../../explorer/physical-fly-session";
import type { HostPhysicalFlyPath } from "../game/motion/host-physical-fly-path";
import type {
	ClientCurrentState,
	ClientExitRequested,
	ClientLifecycle,
	ClientLocalPlayerEstablished,
	ClientPresentationDiscontinuity,
	ClientCameraStartReceipt,
	ClientCameraTick,
	ClientChatMessage,
	ClientPlayerEntered,
	ClientVital,
	ClientCharacterMotionCapabilities,
	ClientCharacterMotionFeedback,
} from "../../client/client-host-contract";

/** Content/status commands implemented by the shared host-content capability. */
const SHARED_HOST_COMMAND_NAMES = [
	"host_status",
	"load_active_region_data",
	"load_landblock_source_batch",
	"load_landblock_profile",
	"load_sky_source",
	"load_texture_pixels",
	"load_animation",
	"load_setup_visual",
	"load_physics_script",
	"load_particle_emitter",
	"load_audio",
	"load_sound_table",
	"load_particle_meshes",
	"load_motion_table_closure",
] as const;

/** Explorer-only commands; they are not accepted by a client-mode renderer. */
const EXPLORER_HOST_COMMAND_NAMES = [
	"start_physical_fly",
	"set_physical_fly_intent",
	"stop_physical_fly",
	"replace_simulation_interest",
	"start_simulation_interest_session",
	"explorer_catalog_capability",
	"search_explorer_weenies",
	"request_explorer_dynamic_entity_snapshot",
	"explorer_possession_motion_probe",
	"spawn_explorer_entity",
	"despawn_explorer_entity",
	"replace_explorer_entity_physics_state",
	"launch_explorer_entity",
	"relocate_explorer_entity",
	"possess_explorer_entity",
	"set_explorer_possession_intent",
	"queue_explorer_possession_event",
	"start_kinematic_boom",
	"set_kinematic_boom_intent",
	"set_kinematic_boom_clearance",
	"stop_kinematic_boom",
	"reset_explorer_entities",
] as const;

/** Client lifecycle and movement commands; startup remains private to Electron main. */
const CLIENT_HOST_COMMAND_NAMES = [
	"request_client_current_state",
	"select_client_character",
	"replace_client_drive",
	"queue_client_character_motion_event",
	"send_client_chat",
	"start_client_camera",
	"set_client_camera_intent",
	"set_client_camera_clearance",
	"acknowledge_client_world_reveal",
	"stop_client_camera",
	"disconnect_client",
] as const;

/** One command accepted by the app-local host boundary. */
export type HostCommandName =
	| (typeof SHARED_HOST_COMMAND_NAMES)[number]
	| (typeof EXPLORER_HOST_COMMAND_NAMES)[number]
	| (typeof CLIENT_HOST_COMMAND_NAMES)[number];

/** Host compositions supported by the Electron shell and protocol diagnostics. */
export const HOST_MODES = ["explorer", "client"] as const;

/** Composed command inventories used by the renderer allowlist and its contract tests. */
export const MODE_COMMAND_NAMES = {
	explorer: [...SHARED_HOST_COMMAND_NAMES, ...EXPLORER_HOST_COMMAND_NAMES],
	client: [...SHARED_HOST_COMMAND_NAMES, ...CLIENT_HOST_COMMAND_NAMES],
} as const satisfies Record<HostMode, readonly HostCommandName[]>;

/** Complete command inventory; privileged client startup intentionally remains absent. */
export const HOST_COMMAND_NAMES = [
	...SHARED_HOST_COMMAND_NAMES,
	...EXPLORER_HOST_COMMAND_NAMES,
	...CLIENT_HOST_COMMAND_NAMES,
] as const;

/** Shared host events. The first shared content slice is request/response only. */
const SHARED_HOST_EVENT_NAMES = [] as const;

/** Explorer-only events; they are not published by a client-mode host. */
const EXPLORER_HOST_EVENT_NAMES = [
	"explorer-dynamic-entity",
	"explorer-fixed-tick",
	"explorer-possession-event-outcomes",
	"explorer-physical-fly-motion",
	"explorer-physical-fly-failure",
] as const;

/** Client lifecycle, focused presentation, and terminal events. */
const CLIENT_HOST_EVENT_NAMES = [
	"client-current-state",
	"client-lifecycle-changed",
	"client-character-motion-capabilities-updated",
	"client-character-motion-feedback",
	"client-local-player-established",
	"client-server-time-updated",
	"client-world-name-updated",
	"client-player-entered",
	"client-player-vitals-updated",
	"client-chat-message",
	"client-dynamic-entity",
	"client-camera-started",
	"client-camera",
	"client-presentation-discontinuity",
	"client-exit-requested",
] as const;

/** One event emitted by the app-local host boundary. */
export type HostEventName =
	| (typeof SHARED_HOST_EVENT_NAMES)[number]
	| (typeof EXPLORER_HOST_EVENT_NAMES)[number]
	| (typeof CLIENT_HOST_EVENT_NAMES)[number];

/** Composed event inventories used by the Electron listener installation and diagnostics. */
export const MODE_EVENT_NAMES = {
	explorer: [...SHARED_HOST_EVENT_NAMES, ...EXPLORER_HOST_EVENT_NAMES],
	client: [...SHARED_HOST_EVENT_NAMES, ...CLIENT_HOST_EVENT_NAMES],
} as const satisfies Record<HostMode, readonly HostEventName[]>;

/** Complete event inventory emitted by either mode. */
export const HOST_EVENT_NAMES = [
	...SHARED_HOST_EVENT_NAMES,
	...EXPLORER_HOST_EVENT_NAMES,
	...CLIENT_HOST_EVENT_NAMES,
] as const;

/** Host composition selected before the renderer starts issuing requests. */
export type HostMode = "explorer" | "client";

/** Returns the command allowlist for one selected host mode. */
export function hostCommandNamesForMode(
	mode: HostMode,
): readonly HostCommandName[] {
	return MODE_COMMAND_NAMES[mode];
}

/** Returns the event allowlist for one selected host mode. */
export function hostEventNamesForMode(
	mode: HostMode,
): readonly HostEventName[] {
	return MODE_EVENT_NAMES[mode];
}

/** Payload map kept at the shell boundary so listeners cannot silently accept arbitrary events. */
export interface HostEventPayloadMap {
	"explorer-dynamic-entity": DynamicEntityEvent;
	"explorer-fixed-tick": ExplorerFixedTickEnvelope;
	"explorer-possession-event-outcomes": readonly PossessionEventOutcome[];
	"explorer-physical-fly-motion": HostPhysicalFlyPath;
	"explorer-physical-fly-failure": HostPhysicalFlyFailure;
	"client-current-state": ClientCurrentState;
	"client-lifecycle-changed": ClientLifecycle;
	"client-character-motion-capabilities-updated": ClientCharacterMotionCapabilities | null;
	"client-character-motion-feedback": ClientCharacterMotionFeedback;
	"client-local-player-established": ClientLocalPlayerEstablished;
	"client-server-time-updated": { time: number };
	"client-world-name-updated": { name: string };
	"client-player-entered": ClientPlayerEntered;
	"client-player-vitals-updated": {
		vitals: ClientVital[];
	};
	"client-chat-message": ClientChatMessage;
	"client-dynamic-entity": DynamicEntityEvent;
	"client-camera-started": ClientCameraStartReceipt;
	"client-camera": ClientCameraTick;
	"client-presentation-discontinuity": ClientPresentationDiscontinuity;
	"client-exit-requested": ClientExitRequested;
}

/** Request values are validated by the host command handlers and remain opaque to the shell. */
export type HostCommandArguments =
	Readonly<Record<string, unknown>> | undefined;

/** One narrow, shell-neutral request/event boundary shared by every frontend capability adapter. */
export interface HostTransport {
	invoke(
		command: HostCommandName,
		args?: HostCommandArguments,
	): Promise<unknown>;
	listen<K extends HostEventName>(
		event: K,
		handler: (payload: HostEventPayloadMap[K]) => void,
	): Promise<() => void>;
}
