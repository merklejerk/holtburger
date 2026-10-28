pub mod active_region;
pub mod character_gen;
pub mod character_titles;
pub mod collision_pose;
pub mod contracts;
pub mod decode_cache;
pub mod generated_scenery;
pub mod interior;
pub mod landblock;
pub mod material_capabilities;
pub mod material_graph;
pub mod motion_sequence;
pub mod navigation_bundle;
pub mod navigation_scene;
pub mod navigation_source;
pub mod object_collision;
pub mod render_surface_pixels;
pub mod repository;
mod resource_error;
pub mod scene_source;
pub mod selection_envelope;
pub mod setup_dimensions;
pub mod soul_emote;
mod source_reader;
pub mod spells;
pub mod terrain_collision;
pub mod terrain_topology;
#[cfg(test)]
mod test_support;
pub mod texture_pixels;
pub mod ui_assets;

pub use active_region::ActiveRegionData;
pub use character_gen::CharacterGenCatalog;
pub use character_titles::{CharacterTitleCatalog, CharacterTitleCatalogError};
pub use contracts::{
    ContractCatalog, ContractCatalogError, ContractProgressFormat, ContractReference,
};
pub use decode_cache::ContentDecodeCache;
pub use generated_scenery::{
    GeneratedSceneryAsset, GeneratedSceneryAssetAssembler, GeneratedSceneryIdentity,
    GeneratedSceneryObject,
};
pub use interior::{
    LandblockBuildingPortalRef, LandblockCellStructureRef, LandblockEnvCell,
    LandblockEnvCellPortalRef, LandblockIndoorObject, LandblockInteriorSystemAssembler,
    LandblockInteriorSystemAsset, LandblockPortal, LandblockPortalEndpoint,
    LandblockPortalTopology,
};
pub use landblock::{
    LandblockAsset, LandblockAssetAssembler, LandblockBuilding, LandblockBuildingPortal,
    LandblockEnvCellRef, LandblockObject, LandblockObjectSourceFamily, LandblockPlacement,
    LandblockRestriction, LandblockSceneClass, LandblockTerrain, normalize_landblock_id,
};
pub use material_capabilities::{
    MaterialArchiveCapabilityReport, MaterialRecordAvailability, MaterialRecordCounts,
    MaterialReferenceCoverage, MaterialReferenceParseFailure, RepositoryResourceIndexEntry,
    VisualSourceRecordCoverage,
};
pub use material_graph::{
    MaterialAppearanceInput, ResolvedAnimationPartChange, ResolvedMaterialRecipe,
    ResolvedMaterialSlot, ResolvedMaterialSource, ResolvedPaletteComposite, ResolvedPaletteRange,
    ResolvedRegionDetailRole, ResolvedRegionDetailRoleKind, ResolvedRegionRenderProfile,
    ResolvedSetupAppearance, ResolvedSetupAppearancePart, ResolvedSurfaceTexture,
    ResolvedTerrainAlphaMap, ResolvedTerrainMaterialTable, ResolvedTerrainMaterialType,
    ResolvedTerrainRoadAlphaMap, ResolvedTextureChange, ResolvedTextureMaterial,
};
pub use motion_sequence::{
    MotionAnimation, MotionClip, MotionContractError, MotionHook, MotionHookDirection,
    MotionHookEffect, MotionHookTrack, MotionSequence, MotionSequenceCatalog, MotionSequenceTable,
    RootMotionTrack,
};
pub use navigation_scene::NavigationSceneSource;
pub use navigation_source::{PreparedNavigationSource, SetupContentSource};
pub use object_collision::{
    BspSolid, CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale,
    CollisionBall, CollisionBox, CollisionCylinder, CollisionPolygon, CollisionShape,
    LandblockColliderAssembler, LandblockColliders, LandblockCollisionAsset,
    LandblockRoomShellAssembler, OutdoorBuildingTransit, PlacedCollider, PlacedCollisionShape,
    StaticColliderPlacement, resolve_gfx_obj_collision_shape,
    resolve_setup_volume_collision_shapes,
};
pub use repository::{ContentRepository, ContentSelectionError, ResolvedContent};
pub use resource_error::{ContentResourceError, ContentResourceErrorKind};
pub use scene_source::SceneContentSource;
pub use selection_envelope::{
    SelectionEnvelopeProfile, compute_selection_envelope_radius, resolve_selection_envelope_profile,
};
pub use setup_dimensions::{SetupDimensionCatalog, SetupDimensions};
pub use soul_emote::{SoulEmoteCatalog, SoulEmotePose, SoulEmoteResolution, SoulEmoteToken};
pub use terrain_collision::{
    TERRAIN_WATER_COLLISION_DEPTH, TerrainCollisionCell, TerrainCollisionSurface,
    TerrainCollisionTriangle,
};
pub use terrain_topology::{TERRAIN_GRID_CELLS, TerrainCellDiagonals};
pub use texture_pixels::{ResolvedSurfaceTexturePixels, TexturePixelFormat};

pub mod weenie_catalog;
pub use weenie_catalog::{
    WeenieCatalogCapability, WeenieCatalogContent, WeenieCatalogUnavailableKind, WeenieTypeIndex,
};
