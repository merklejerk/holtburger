import type { DynamicEntityEvent } from "../game/runtime/dynamic-entity-feed";
import type { ExplorerFixedTickEnvelope } from "../../explorer/explorer-fixed-tick";
import type { PossessionEventOutcome } from "../../explorer/explorer-entity-possession";
import type { HostPhysicalFlyFailure } from "../../explorer/physical-fly-session";
import type { HostPhysicalFlyPath } from "../game/motion/host-physical-fly-path";

/** Complete command inventory exposed by the app-local host boundary. */
export const HOST_COMMAND_NAMES = [
	"host_status",
	"load_active_region_data",
	"load_landblock_source_batch",
	"load_landblock_profile",
	"load_sky_source",
	"load_texture_pixels",
	"load_animation",
	"load_dynamic_entity_visual",
	"load_physics_script",
	"load_particle_emitter",
	"load_audio",
	"load_sound_table",
	"load_particle_meshes",
	"load_motion_table_closure",
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

/** One command accepted by the app-local host boundary. */
export type HostCommandName = (typeof HOST_COMMAND_NAMES)[number];

/** Complete event inventory emitted by the app-local host boundary. */
export const HOST_EVENT_NAMES = [
	"explorer-dynamic-entity",
	"explorer-fixed-tick",
	"explorer-possession-event-outcomes",
	"host://physical-fly-motion",
	"host://physical-fly-failure",
] as const;

/** One event emitted by the app-local host boundary. */
export type HostEventName = (typeof HOST_EVENT_NAMES)[number];

/** Payload map kept at the shell boundary so listeners cannot silently accept arbitrary events. */
export interface HostEventPayloadMap {
	"explorer-dynamic-entity": DynamicEntityEvent;
	"explorer-fixed-tick": ExplorerFixedTickEnvelope;
	"explorer-possession-event-outcomes": readonly PossessionEventOutcome[];
	"host://physical-fly-motion": HostPhysicalFlyPath;
	"host://physical-fly-failure": HostPhysicalFlyFailure;
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
