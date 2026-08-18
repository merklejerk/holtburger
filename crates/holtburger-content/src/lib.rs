pub mod active_region;
pub mod character_gen;
pub mod decode_cache;
pub mod generated_scenery;
pub mod interior;
pub mod landblock;
pub mod material_capabilities;
pub mod material_graph;
pub mod object_collision;
pub mod repository;
pub mod soul_emote;
mod source_reader;
pub mod terrain_collision;
pub mod terrain_topology;
#[cfg(test)]
mod test_support;
pub mod texture_pixels;

pub use active_region::ActiveRegionData;
pub use character_gen::CharacterGenCatalog;
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
    LandblockRestriction, LandblockTerrain, normalize_landblock_id,
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
pub use object_collision::{
    BspSolid, CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale,
    CollisionBall, CollisionBox, CollisionCylinder, CollisionPolygon, CollisionShape,
    LandblockColliderAssembler, LandblockColliders, LandblockCollisionAsset,
    OutdoorBuildingTransit, PlacedCollider, PlacedCollisionShape, StaticColliderPlacement,
    resolve_gfx_obj_collision_shape, resolve_setup_volume_collision_shapes,
};
pub use repository::ContentRepository;
pub use soul_emote::{SoulEmoteCatalog, SoulEmotePose, SoulEmoteResolution, SoulEmoteToken};
pub use terrain_collision::{
    TERRAIN_WATER_COLLISION_DEPTH, TerrainCollisionCell, TerrainCollisionSurface,
    TerrainCollisionTriangle,
};
pub use terrain_topology::{TERRAIN_GRID_CELLS, TerrainCellDiagonals};
pub use texture_pixels::{ResolvedSurfaceTexturePixels, TexturePixelFormat};
