use serde::Serialize;

pub mod animation_source;
pub mod audio_source;
pub mod behavior_hook_source;
pub mod binary_source_record;
pub mod cell_struct_projection;
pub mod character_creation;
pub mod client_allegiance;
pub mod client_friends;
pub mod client_gameplay;
pub mod client_host;
pub mod client_party;
mod client_performance;
pub mod client_projection;
pub mod client_runtime;
pub mod client_squelch;
pub mod client_vendor;
pub mod content_failure;
pub mod content_responses;
pub mod content_selection;
pub mod env_cell_source;
pub mod explorer_entity_delivery;
pub mod explorer_entity_driver;
pub mod explorer_entity_runtime;
pub mod explorer_entity_simulation;
pub mod explorer_entity_wire;
pub mod explorer_host;
pub mod explorer_possession_control;
pub mod explorer_weenie_catalog;
pub mod gfx_obj_geometry;
pub mod host_event_sink;
pub mod host_fixed_tick_runtime;
pub mod host_kinematic_boom_runtime;
pub mod host_mode;
pub mod host_physical_fly_runtime;
pub mod host_simulation_runtime;
pub mod interior_seam;
pub mod landblock_profile;
pub mod landblock_source_batch;
pub mod map_geometry;
pub mod object_resource_closure;
pub mod object_texture;
pub mod outdoor_static_source;
pub mod particle_emitter_source;
pub mod particle_mesh_source;
pub mod physics_script_source;
pub mod physics_script_table_source;
pub mod placed_motion_presentation;
pub mod polygon_geometry;
pub mod portal_geometry;
pub mod portal_visibility;
pub mod process_qos;
pub mod protocol;
mod reporting_content_source;
pub mod runtime;
pub mod setup_visual_source;
pub mod shared_host_content;
pub mod sky_source;
pub mod sound_table_source;
pub mod source_projection;
pub mod spell_references;
pub mod stat_icons;
mod terrain_color;
pub mod ui_icons;
pub mod weenie_appearance;
pub mod world_map;

pub use content_responses::*;
pub use explorer_entity_wire::*;
pub use landblock_source_batch::LandblockSourceLayer;
pub use shared_host_content::SharedHostContent;
pub use sky_source::load_sky_source_bytes;

/// Host identity and readiness state returned by the status command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    /// Stable label used by the frontend to identify the active host shell.
    pub app_name: &'static str,
    /// Human-readable lifecycle state for diagnostics.
    pub status: &'static str,
}
