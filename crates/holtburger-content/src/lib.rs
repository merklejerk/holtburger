pub mod active_region;
pub mod character_gen;
pub mod decode_cache;
pub mod generated_scenery;
pub mod interior;
pub mod landblock;
pub mod material_capabilities;
pub mod material_graph;
pub mod repository;
pub mod soul_emote;
mod source_reader;
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
    ResolvedMaterialSlot, ResolvedMaterialSource, ResolvedRegionDetailRole,
    ResolvedRegionDetailRoleKind, ResolvedRegionRenderProfile, ResolvedSetupAppearance,
    ResolvedSetupAppearancePart, ResolvedSurfaceTexture, ResolvedTerrainAlphaMap,
    ResolvedTerrainMaterialTable, ResolvedTerrainMaterialType, ResolvedTerrainRoadAlphaMap,
    ResolvedTextureChange, ResolvedTextureMaterial,
};
pub use repository::ContentRepository;
pub use soul_emote::{SoulEmoteCatalog, SoulEmotePose, SoulEmoteResolution, SoulEmoteToken};
pub use texture_pixels::{ResolvedSurfaceTexturePixels, TexturePixelFormat};
