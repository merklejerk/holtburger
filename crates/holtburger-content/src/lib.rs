pub mod active_region;
pub mod character_gen;
pub mod decode_cache;
pub mod landblock_scene_assets;
pub mod material_capabilities;
pub mod material_graph;
pub mod material_variants;
pub mod repository;
pub mod soul_emote;
mod source_reader;
pub mod static_outdoor_scene;
pub mod texture_pixels;

pub use active_region::ActiveRegionData;
pub use character_gen::CharacterGenCatalog;
pub use decode_cache::ContentDecodeCache;
pub use landblock_scene_assets::{
    CanonicalTerrainMesh, CellLandblockFact, EnvCellAsset, EnvCellAssetAssembler, EnvCellFact,
    EnvCellPortalFact, EnvCellSystemAsset, EnvCellSystemAssetAssembler, EnvCellSystemBvhItem,
    EnvCellSystemBvhItemSource, EnvCellSystemCell, EnvironmentFact, IndoorStaticObjectFact,
    LandblockBuildingPortal, LandblockGeneratedSceneryFacts, LandblockInfoFact,
    LandblockOutdoorAsset, LandblockOutdoorBuildingFacts, LandblockOutdoorStaticMember,
    LandblockRestriction, LandblockSceneLodAsset, LandblockSceneLodAssetAssembler,
    LandblockSceneLodEnvCellSystemLayer, LandblockSceneLodLayer, LandblockSceneLodLevel,
    LandblockSceneLodOutdoorBuildingsLayer, LandblockSceneLodOutdoorStaticLayer,
    LandblockSceneLodRequest, LandblockSceneLodTerrainLayer, PreparedAabb,
    PreparedBuildingTransitionAperture, PreparedBuildingTransitionApertureRange,
    PreparedBuildingTransitionApertureRangeSource, PreparedBvh, PreparedBvhKindMask,
    PreparedBvhNode, PreparedBvhScope, PreparedContentSourceDiagnostics,
    PreparedEnvCellPortalApertureRange, PreparedEnvCellPortalApertureRangeSource,
    PreparedInteriorCell, PreparedPolygonSetInvalidPolygon, PreparedPolygonSetRenderGeometry,
    PreparedPolygonSetRenderTriangle, PreparedPortalAperture,
    PreparedPortalApertureCoordinateSpace, PreparedPortalAperturePlane,
    PreparedPortalAperturePlaneSource, PreparedPortalApertureRange, PreparedPortalApertureResource,
    PreparedPortalApertureSourceDomain, PreparedPortalConnectivityEdge,
    PreparedPortalConnectivityEdgeProvenance, PreparedPortalConnectivityGraph,
    PreparedPortalConnectivityNode, PreparedPortalConnectivityScene,
    PreparedPortalConnectivitySceneCrossing, PreparedPortalEndpoint, PreparedStaticInstance,
    PreparedStaticInstanceKind, PreparedStaticMesh, PreparedTerrainBvhItem, PreparedTerrainQuad,
    PreparedTerrainQuadDiagonal, PreparedTerrainTriangle, PreparedVec3, SourceLoadError,
    SourceOmissionDiagnostic, SourceRecordDiagnostic, SourceRecordStatus, TerrainGridSource,
    build_gfx_obj_render_geometry, format_static_object_source_asset_id, pad_bvh_bounds,
    road_code_from_cell_terrain, terrain_code_from_cell_terrain, terrain_pcode,
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
pub use material_variants::{
    LEGACY_SAMPLER_CLAMP_MATERIAL_VARIANT_SIGNATURE,
    LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE, legacy_sampler_material_variant_signature,
};
pub use repository::ContentRepository;
pub use soul_emote::{SoulEmoteCatalog, SoulEmotePose, SoulEmoteResolution, SoulEmoteToken};
pub use static_outdoor_scene::{
    GeneratedOutdoorSceneryDiagnostics, StaticOutdoorFrame, StaticOutdoorInstance,
    StaticOutdoorLayerDiagnostics, StaticOutdoorScene, StaticOutdoorSceneAssembler,
    StaticRenderableSourceFamily, StaticRenderableSourceRef, normalize_landblock_env_cell_id,
    normalize_landblock_id,
};
pub use texture_pixels::{ResolvedSurfaceTexturePixels, TexturePixelFormat};
