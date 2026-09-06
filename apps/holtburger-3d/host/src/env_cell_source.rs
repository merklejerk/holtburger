use std::collections::{BTreeMap, HashMap};
use std::num::NonZeroU32;
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use holtburger_content::{
    LandblockBuildingPortalRef, LandblockEnvCell, LandblockEnvCellPortalRef,
    LandblockInteriorSystemAsset, LandblockPlacement, LandblockPortal, LandblockPortalEndpoint,
};
use holtburger_core::{ContentAsset, ContentAssetRequest, ContentAssetRuntime};
use holtburger_dat::file_type::GfxObj;
use serde::Serialize;
use serde_json::{Value, json};

use crate::binary_source_record::{BinarySectionManifest, BinarySectionWriter};
use crate::cell_struct_projection::{
    CellStructProjection, CellStructProjectionContext, project_cell_struct,
};
use crate::gfx_obj_geometry::build_gfx_obj_portal_apertures;
use crate::interior_seam::{
    IndoorSeamClassification, IndoorSeamEvidence, IndoorTopologyBoundaryReason,
    classify_indoor_seam,
};
use crate::landblock_source_batch::LoadedLandblockSourceBatch;
use crate::map_geometry::build_walkable_floor_geometry;
use crate::object_resource_closure::{
    ObjectResourceClosure, StaticGeometryBuffers, append_static_geometry,
};
use crate::polygon_geometry::RenderAabb;
use crate::portal_geometry::{
    AcceptedPlaneSide, PortalAperture, accepted_plane_side, transform_aperture,
    transform_render_bounds,
};
use crate::portal_visibility::{
    JunctionCandidate, VisibilityApertureIntersectionEvidence, intersect_visibility_apertures,
    resolve_junction_groups,
};
use crate::source_projection::{dat_id, render_aabb_json};

pub(crate) const ENV_CELL_RECORD_MAGIC: &[u8; 4] = b"HBEC";
const ENV_CELL_RECORD_VERSION: u16 = 5;
const ENV_CELL_RECORD_HEADER_LENGTH: usize = 16;

/// Placement-rotation tolerance for the map-floor up-axis invariant.
///
/// Map floors are walkability-filtered per structure in the structure-local frame, which is only
/// valid when every consuming cell placement maps local up to world up (yaw-only in practice).
const MAP_FLOOR_UP_EPSILON: f32 = 1.0e-3;

/// Build one independently decodable environment-cell record.
pub(crate) async fn serialize_env_cell_source_record(
    runtime: &ContentAssetRuntime,
    source_batch: &LoadedLandblockSourceBatch,
) -> Result<Vec<u8>> {
    let Some(interior) = source_batch.interior()? else {
        return serialize_absent_record(source_batch.landblock_id());
    };
    if interior.cells.is_empty() {
        return serialize_absent_record(source_batch.landblock_id());
    }
    let landblock = source_batch.landblock().with_context(|| {
        format!(
            "EnvCell source 0x{:08X} has no shallow landblock foundation",
            source_batch.landblock_id()
        )
    })?;
    ensure!(
        interior.landblock_id == source_batch.landblock_id(),
        "interior source landblock does not match batch"
    );

    let mut shell_buffers = StaticGeometryBuffers::default();
    let mut object_closure = ObjectResourceClosure::default();
    let mut structures = Vec::<Value>::new();
    let mut structure_indices = BTreeMap::<CellStructShellKey, (usize, usize)>::new();
    let mut prepared_cells = Vec::with_capacity(interior.cells.len());
    let mut containment_planes = Vec::<f32>::new();
    let mut map_floor_positions = Vec::<f32>::new();
    let mut map_floor_indices = Vec::<u32>::new();
    let mut excluded_shell_polygon_ids_by_cell =
        paired_exterior_portal_polygon_ids_by_cell(interior);

    for cell in &interior.cells {
        let excluded_shell_polygon_ids = excluded_shell_polygon_ids_by_cell
            .remove(&cell.env_cell_id)
            .unwrap_or_default();
        let environment = interior
            .environments
            .get(&cell.structure.environment_id)
            .with_context(|| {
                format!(
                    "EnvCell 0x{:08X} references missing Environment 0x{:08X}",
                    cell.env_cell_id, cell.structure.environment_id
                )
            })?;
        let cell_struct = environment
            .cells
            .get(&cell.structure.local_selector)
            .with_context(|| {
                format!(
                    "EnvCell 0x{:08X} references missing CellStruct 0x{:04X}",
                    cell.env_cell_id, cell.structure.local_selector
                )
            })?;
        let projection = project_cell_struct(
            CellStructProjectionContext {
                landblock_id: interior.landblock_id,
                env_cell_id: cell.env_cell_id,
                environment_id: cell.structure.environment_id,
                cell_structure_id: cell.structure.local_selector,
                surface_count: cell.surface_ids.len(),
                excluded_shell_polygon_ids: &excluded_shell_polygon_ids,
            },
            cell_struct,
        )?;
        let structure_key = CellStructShellKey {
            environment_id: cell.structure.environment_id,
            local_selector: cell.structure.local_selector,
            excluded_shell_polygon_ids,
        };
        let structure_index = if let Some((index, surface_slot_count)) =
            structure_indices.get(&structure_key)
        {
            ensure!(
                *surface_slot_count == cell.surface_ids.len(),
                "EnvCell 0x{:08X} surface count differs from reused CellStruct 0x{:08X}/0x{:04X}",
                cell.env_cell_id,
                cell.structure.environment_id,
                cell.structure.local_selector
            );
            *index
        } else {
            let index = structures.len();
            let shell_variant_suffix =
                shell_variant_suffix(&structure_key.excluded_shell_polygon_ids);
            let geometry_id = format!(
                "geometry:cell-struct/{:08x}/{:04x}{shell_variant_suffix}",
                structure_key.environment_id, structure_key.local_selector
            );
            let source_asset_id = format!(
                "cell-struct/{:08x}/{:04x}",
                structure_key.environment_id, structure_key.local_selector
            );
            let geometry = append_static_geometry(
                &mut shell_buffers,
                &projection.shell,
                &geometry_id,
                &source_asset_id,
            )?;
            let containment_plane_offset = containment_planes.len() / 4;
            for plane in &projection.containment_hull.planes {
                containment_planes.extend([
                    plane.normal.x,
                    plane.normal.y,
                    plane.normal.z,
                    plane.d,
                ]);
            }
            let map_floor = build_walkable_floor_geometry(
                &cell_struct.vertex_array,
                &cell_struct.physics_polygons,
            )
            .with_context(|| {
                format!(
                    "Could not derive map floor for CellStruct 0x{:08X}/0x{:04X}",
                    cell.structure.environment_id, cell.structure.local_selector
                )
            })?;
            let map_floor_json = json!({
                "positionOffset": map_floor_positions.len(),
                "vertexCount": map_floor.vertex_count(),
                "indexOffset": map_floor_indices.len(),
                "indexCount": map_floor.indices.len(),
            });
            map_floor_positions.extend_from_slice(&map_floor.positions);
            map_floor_indices.extend_from_slice(&map_floor.indices);
            structures.push(json!({
                "id": format!("cell-struct:{:08x}/{:04x}{shell_variant_suffix}", structure_key.environment_id, structure_key.local_selector),
                "environmentId": dat_id(structure_key.environment_id),
                "localSelector": structure_key.local_selector,
                "geometry": geometry,
                "surfaceSlotCount": cell.surface_ids.len(),
                "containmentPlaneOffset": containment_plane_offset,
                "containmentPlaneCount": projection.containment_hull.planes.len(),
                "mapFloor": map_floor_json,
                "portalPolygons": projection.apertures.iter().map(|aperture| json!({
                    "cellStructPortalIndex": aperture.cell_struct_portal_index,
                    "polygonId": aperture.polygon_id,
                })).collect::<Vec<_>>(),
            }));
            structure_indices.insert(structure_key, (index, cell.surface_ids.len()));
            index
        };
        let rotated_up = cell
            .placement
            .orientation
            .rotate_vector(holtburger_common::Vector3::new(0.0, 0.0, 1.0));
        ensure!(
            rotated_up.z >= 1.0 - MAP_FLOOR_UP_EPSILON,
            "EnvCell 0x{:08X} placement rotation does not preserve the up axis (rotated z {}), \
             so its structure-local map floor would misclassify walkability",
            cell.env_cell_id,
            rotated_up.z
        );
        object_closure
            .add_materials(runtime, &cell.surface_ids)
            .await
            .with_context(|| {
                format!(
                    "Could not close shell materials for EnvCell 0x{:08X}",
                    cell.env_cell_id
                )
            })?;
        prepared_cells.push(PreparedCell {
            source: cell.clone(),
            structure_index,
            projection,
        });
    }

    let mut writer = BinarySectionWriter::default();
    writer.append_u32(
        "cellIds",
        prepared_cells.iter().map(|cell| cell.source.env_cell_id),
    );
    writer.append_u32(
        "cellFlags",
        prepared_cells.iter().map(|cell| cell.source.flags),
    );
    writer.append_u32(
        "cellAuthoredIds",
        prepared_cells
            .iter()
            .map(|cell| cell.source.authored_cell_id),
    );
    writer.append_u32(
        "cellStructureIndices",
        prepared_cells
            .iter()
            .map(|cell| u32::try_from(cell.structure_index).map_err(anyhow::Error::from))
            .collect::<Result<Vec<_>>>()?,
    );
    writer.append_f32(
        "cellPlacements",
        prepared_cells
            .iter()
            .flat_map(|cell| placement_values(cell.source.placement)),
    )?;

    // Empty shells have no extent. Keep their cells and topology, and encode bounds only for
    // structures with render geometry, in cell order (the geometry contract supplies presence).
    let cell_bounds = prepared_cells
        .iter()
        .map(|cell| {
            cell.projection
                .shell
                .bounds
                .map(|bounds| transform_render_bounds(bounds, cell.source.placement))
        })
        .collect::<Vec<_>>();
    writer.append_f32(
        "cellBounds",
        cell_bounds
            .iter()
            .flatten()
            .flat_map(|bounds| bounds_values(*bounds)),
    )?;

    let mut surface_ids = Vec::new();
    let mut surface_ranges = Vec::with_capacity(prepared_cells.len() * 2);
    let mut visible_cell_ids = Vec::new();
    let mut visible_ranges = Vec::with_capacity(prepared_cells.len() * 2);
    let mut residents = Vec::<Value>::new();
    let mut resident_ranges = Vec::with_capacity(prepared_cells.len() * 2);
    for (cell_index, cell) in prepared_cells.iter().enumerate() {
        push_range(
            &mut surface_ranges,
            surface_ids.len(),
            cell.source.surface_ids.len(),
        )?;
        surface_ids.extend(cell.source.surface_ids.iter().copied());
        push_range(
            &mut visible_ranges,
            visible_cell_ids.len(),
            cell.source.visible_cell_ids.len(),
        )?;
        visible_cell_ids.extend(cell.source.visible_cell_ids.iter().copied());
        let resident_start = residents.len();
        for resident in &cell.source.static_objects {
            ensure!(
                matches!(resident.source_did >> 24, 0x01 | 0x02),
                "EnvCell 0x{:08X} resident {} has unsupported object DID 0x{:08X}",
                cell.source.env_cell_id,
                resident.source_index,
                resident.source_did
            );
            let definition_id = object_closure
                .add_resident(runtime, resident.source_did)
                .await
                .with_context(|| {
                    format!(
                        "Could not close EnvCell 0x{:08X} resident {} object 0x{:08X}",
                        cell.source.env_cell_id, resident.source_index, resident.source_did
                    )
                })?;
            residents.push(json!({
                "id": format!(
                    "env-cell-resident/{:08x}/{:04x}/{:08x}",
                    cell.source.env_cell_id,
                    resident.source_index,
                    resident.source_did,
                ),
                "cellIndex": cell_index,
                "sourceIndex": resident.source_index,
                "sourceDid": dat_id(resident.source_did),
                "definitionId": definition_id,
                "placement": placement_json(resident.placement),
            }));
        }
        push_range(
            &mut resident_ranges,
            resident_start,
            residents.len() - resident_start,
        )?;
    }
    writer.append_u32("cellSurfaceRanges", surface_ranges);
    writer.append_u32("surfaceIds", surface_ids);
    writer.append_u32("cellVisibleRanges", visible_ranges);
    writer.append_u32("visibleCellIds", visible_cell_ids);
    writer.append_u32("cellResidentRanges", resident_ranges);
    writer.append_f32("containmentPlanes", containment_planes)?;
    writer.append_f32("mapFloorPositions", map_floor_positions)?;
    writer.append_u32("mapFloorIndices", map_floor_indices);

    let mut apertures = SerializedApertures::default();
    let mut aperture_indices_by_cell_polygon = HashMap::<(u32, u16), usize>::new();
    for cell in &prepared_cells {
        for portal in &cell.projection.apertures {
            let transformed = transform_aperture(&portal.aperture, cell.source.placement)?;
            let aperture_index = apertures.append(
                format!(
                    "portal-aperture:env-cell/{:08x}/polygon/{:04x}",
                    cell.source.env_cell_id, portal.polygon_id
                ),
                "env-cell",
                vec![portal.polygon_id],
                &transformed,
            )?;
            ensure!(
                aperture_indices_by_cell_polygon
                    .insert((cell.source.env_cell_id, portal.polygon_id), aperture_index)
                    .is_none(),
                "EnvCell 0x{:08X} repeats aperture polygon {}",
                cell.source.env_cell_id,
                portal.polygon_id
            );
        }
    }

    let cell_indices = prepared_cells
        .iter()
        .enumerate()
        .map(|(index, cell)| (cell.source.env_cell_id, index))
        .collect::<HashMap<_, _>>();
    let portal_indices = interior
        .topology
        .portals
        .iter()
        .enumerate()
        .map(|(index, portal)| (portal.source, index))
        .collect::<HashMap<_, _>>();
    let mut building_gfx = BTreeMap::<u32, Arc<GfxObj>>::new();
    let mut building_apertures = BTreeMap::<(usize, usize), ResolvedBuildingAperture>::new();
    let mut crossings = Vec::<CrossingProjection>::new();
    let mut crossing_by_source_portal = HashMap::<LandblockEnvCellPortalRef, usize>::new();
    let mut unresolved_outside = Vec::<Value>::new();

    for portal in &interior.topology.portals {
        let source_cell_index = cell_indices[&portal.source.env_cell_id];
        let aperture_index =
            aperture_indices_by_cell_polygon[&(portal.source.env_cell_id, portal.polygon_id)];
        let mask_depth_policy = if prepared_cells[source_cell_index]
            .projection
            .apertures
            .iter()
            .find(|aperture| aperture.polygon_id == portal.polygon_id)
            .expect("topology portal must have a projected source aperture")
            .has_render_surface
        {
            MaskDepthPolicy::RejectEqualDepth
        } else {
            MaskDepthPolicy::AllowEqualDepth
        };
        let crossing_index = crossings.len();
        ensure!(
            crossing_by_source_portal
                .insert(portal.source, crossing_index)
                .is_none(),
            "duplicate directed EnvCell portal identity"
        );
        match &portal.endpoint {
            LandblockPortalEndpoint::Internal {
                target_env_cell_id,
                validated_target,
                ..
            } => {
                crossings.push(CrossingProjection {
                    source_cell_index: Some(source_cell_index),
                    target_cell_index: Some(cell_indices[target_env_cell_id]),
                    source_aperture_index: aperture_index,
                    visibility_aperture_index: aperture_index,
                    visibility_provenance: VisibilityApertureProvenance::AuthoredSource,
                    accepted_side: accepted_plane_side(portal.flags),
                    exact_match: (portal.flags & 0x01) != 0,
                    mask_depth_policy,
                    reciprocal_index: None,
                    junction_group: None,
                    source: json!({
                        "kind": "env-cell",
                        "envCellId": dat_id(portal.source.env_cell_id),
                        "portalIndex": portal.source.portal_index,
                        "polygonId": portal.polygon_id,
                        "flags": portal.flags,
                    }),
                    relationship: classify_internal_relationship(
                        portal,
                        *validated_target,
                        &InternalRelationshipContext {
                            interior,
                            portal_indices: &portal_indices,
                            cell_indices: &cell_indices,
                            aperture_indices_by_cell_polygon: &aperture_indices_by_cell_polygon,
                            apertures: &apertures.geometries,
                            cell_bounds: &cell_bounds,
                        },
                    )?,
                });
            }
            LandblockPortalEndpoint::Outside {
                building_portal, ..
            } => {
                crossings.push(CrossingProjection {
                    source_cell_index: Some(source_cell_index),
                    target_cell_index: None,
                    source_aperture_index: aperture_index,
                    visibility_aperture_index: aperture_index,
                    visibility_provenance: VisibilityApertureProvenance::AuthoredSource,
                    accepted_side: accepted_plane_side(portal.flags),
                    exact_match: (portal.flags & 0x01) != 0,
                    mask_depth_policy,
                    reciprocal_index: None,
                    junction_group: None,
                    source: json!({
                        "kind": "env-cell",
                        "envCellId": dat_id(portal.source.env_cell_id),
                        "portalIndex": portal.source.portal_index,
                        "polygonId": portal.polygon_id,
                        "flags": portal.flags,
                    }),
                    relationship: CrossingRelationship::ExteriorTransition {
                        exterior_landblock_id: interior.landblock_id,
                    },
                });
                if let Some(building_ref) = building_portal {
                    let reverse_aperture = resolve_building_aperture(
                        runtime,
                        source_batch,
                        *building_ref,
                        &mut building_gfx,
                        &mut building_apertures,
                        &mut apertures,
                    )
                    .await?;
                    let building = &landblock.buildings[building_ref.building_index];
                    let building_portal = &building.portals[building_ref.portal_index];
                    let reverse_index = crossings.len();
                    crossings[crossing_index].reciprocal_index = Some(reverse_index);
                    crossings.push(CrossingProjection {
                        source_cell_index: None,
                        target_cell_index: Some(source_cell_index),
                        source_aperture_index: reverse_aperture.aperture_index,
                        visibility_aperture_index: reverse_aperture.aperture_index,
                        visibility_provenance: VisibilityApertureProvenance::AuthoredSource,
                        accepted_side: accepted_plane_side(building_portal.flags),
                        exact_match: (building_portal.flags & 0x01) != 0,
                        mask_depth_policy: reverse_aperture.mask_depth_policy,
                        reciprocal_index: Some(crossing_index),
                        junction_group: None,
                        source: json!({
                            "kind": "building-transition",
                            "buildingIndex": building_ref.building_index,
                            "buildingSourceDid": dat_id(building_ref.building_source_did),
                            "portalIndex": building_ref.portal_index,
                            "flags": building_portal.flags,
                        }),
                        relationship: CrossingRelationship::ExteriorTransition {
                            exterior_landblock_id: interior.landblock_id,
                        },
                    });
                } else {
                    unresolved_outside.push(json!({
                        "envCellId": dat_id(portal.source.env_cell_id),
                        "portalIndex": portal.source.portal_index,
                        "polygonId": portal.polygon_id,
                    }));
                }
            }
        }
    }
    for portal in &interior.topology.portals {
        let LandblockPortalEndpoint::Internal {
            validated_target, ..
        } = portal.endpoint
        else {
            continue;
        };
        if let Some(target) = validated_target {
            let crossing_index = crossing_by_source_portal[&portal.source];
            crossings[crossing_index].reciprocal_index =
                crossing_by_source_portal.get(&target).copied();
        }
    }
    let visibility_diagnostics = resolve_visibility_apertures(&mut crossings, &mut apertures)?;

    let cell_island_ordinals = resolve_cell_island_ordinals(prepared_cells.len(), &crossings);
    writer.append_u32("cellIslandIndices", cell_island_ordinals.iter().copied());
    resolve_crossing_junction_groups(
        interior.landblock_id,
        &mut crossings,
        &apertures,
        &cell_island_ordinals,
    )?;

    let SerializedApertures {
        manifests: aperture_manifests,
        identities: _,
        geometries: _,
        positions: aperture_positions,
        indices: aperture_indices,
    } = apertures;
    writer.append_f32("aperturePositions", aperture_positions)?;
    writer.append_u32("apertureIndices", aperture_indices);
    shell_buffers.append_sections(&mut writer, "shell")?;
    object_closure
        .buffers
        .append_sections(&mut writer, "object")?;
    object_closure.validate()?;
    let (sections, section_bytes) = writer.finish();

    let manifest = EnvCellRecordManifest {
        transport: "holtburger-env-cell-record",
        version: ENV_CELL_RECORD_VERSION,
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        landblock_id: dat_id(interior.landblock_id),
        availability: "present",
        cell_count: prepared_cells.len(),
        structures,
        apertures: aperture_manifests,
        crossings: crossings
            .iter()
            .enumerate()
            .map(|(index, crossing)| crossing_json(index, crossing))
            .collect(),
        residents,
        object_definitions: object_closure.definitions,
        object_geometries: object_closure.geometries,
        materials: object_closure.materials.into_values().collect(),
        texture_dependencies: object_closure.texture_dependencies.into_values().collect(),
        diagnostics: json!({
            "unresolvedOutsideEndpoints": unresolved_outside,
            "unresolvedVisibilityReciprocals": visibility_diagnostics.unresolved_reciprocals,
            "visibilityApertureCounts": {
                "authoredSourceCrossings": visibility_diagnostics.authored_source_crossings,
                "reciprocalIntersectionCrossings": visibility_diagnostics.reciprocal_intersection_crossings,
                "synthesizedIntersectionGeometries": visibility_diagnostics.synthesized_intersection_geometries,
            },
        }),
        sections,
    };
    serialize_record(&manifest, section_bytes)
}

struct PreparedCell {
    source: LandblockEnvCell,
    structure_index: usize,
    projection: CellStructProjection,
}

/// Geometry cache identity for one CellStruct after topology-owned shell selection.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct CellStructShellKey {
    /// Environment resource owning the reusable CellStruct.
    environment_id: u32,
    /// Environment-local CellStruct selector.
    local_selector: u32,
    /// Exterior transition polygons omitted from ordinary shell rendering.
    excluded_shell_polygon_ids: Vec<u16>,
}

/// Index sorted CellStruct polygons belonging to proven two-sided exterior transitions by EnvCell.
pub fn paired_exterior_portal_polygon_ids_by_cell(
    interior: &LandblockInteriorSystemAsset,
) -> BTreeMap<u32, Vec<u16>> {
    // Retail's separate portal pass owns transition depth with an always-pass write
    // (acclient.c:433593-433607). The atlas compositor owns that same authored polygon as an
    // aperture, so retaining it in the shell would create two coplanar depth owners. Only paired
    // transitions are proven to have that separate owner; unpaired outside endpoints stay visible.
    let mut polygon_ids_by_cell = BTreeMap::<u32, Vec<u16>>::new();
    for portal in &interior.topology.portals {
        if matches!(
            portal.endpoint,
            LandblockPortalEndpoint::Outside {
                building_portal: Some(_),
                ..
            }
        ) {
            polygon_ids_by_cell
                .entry(portal.source.env_cell_id)
                .or_default()
                .push(portal.polygon_id);
        }
    }
    for polygon_ids in polygon_ids_by_cell.values_mut() {
        polygon_ids.sort_unstable();
        polygon_ids.dedup();
    }
    polygon_ids_by_cell
}

fn shell_variant_suffix(excluded_shell_polygon_ids: &[u16]) -> String {
    if excluded_shell_polygon_ids.is_empty() {
        return String::new();
    }
    format!(
        "/without-exterior-portals-{}",
        excluded_shell_polygon_ids
            .iter()
            .map(|polygon_id| format!("{polygon_id:04x}"))
            .collect::<Vec<_>>()
            .join("-")
    )
}

struct CrossingProjection {
    source_cell_index: Option<usize>,
    target_cell_index: Option<usize>,
    source_aperture_index: usize,
    visibility_aperture_index: usize,
    visibility_provenance: VisibilityApertureProvenance,
    accepted_side: AcceptedPlaneSide,
    exact_match: bool,
    mask_depth_policy: MaskDepthPolicy,
    reciprocal_index: Option<usize>,
    junction_group: Option<NonZeroU32>,
    source: Value,
    relationship: CrossingRelationship,
}

/// Host-classified seam semantics, kept typed so island and junction derivation can read them.
///
/// Serialized to manifest JSON only at assembly; producing `Value` here would force every later
/// consumer to string-match on `"kind"`.
#[derive(Debug, Clone, Copy, PartialEq)]
enum CrossingRelationship {
    IndoorDepthContinuous { reciprocal_aperture_index: usize },
    IndoorTopologyBoundary(IndoorTopologyBoundaryReason),
    ExteriorTransition { exterior_landblock_id: u32 },
}

fn relationship_json(relationship: CrossingRelationship) -> Value {
    match relationship {
        CrossingRelationship::IndoorDepthContinuous {
            reciprocal_aperture_index,
        } => json!({
            "kind": "indoor-depth-continuous",
            "reciprocalApertureIndex": reciprocal_aperture_index,
        }),
        CrossingRelationship::IndoorTopologyBoundary(reason) => json!({
            "kind": "indoor-topology-boundary",
            "reason": boundary_reason_name(reason),
        }),
        CrossingRelationship::ExteriorTransition {
            exterior_landblock_id,
        } => json!({
            "kind": "exterior-transition",
            "exteriorLandblockId": dat_id(exterior_landblock_id),
        }),
    }
}

/// Equal-depth ownership selected from the authored source portal's visible shell role.
#[derive(Debug, Clone, Copy)]
enum MaskDepthPolicy {
    AllowEqualDepth,
    RejectEqualDepth,
}

/// Cached projection facts owned by one authored building-transition aperture.
#[derive(Debug, Clone, Copy)]
struct ResolvedBuildingAperture {
    aperture_index: usize,
    mask_depth_policy: MaskDepthPolicy,
}

/// Static provenance explaining how one crossing selected its rendering aperture.
#[derive(Debug, Clone, Copy)]
enum VisibilityApertureProvenance {
    AuthoredSource,
    ReciprocalIntersection {
        reciprocal_aperture_index: usize,
        evidence: VisibilityApertureIntersectionEvidence,
    },
}

/// Record-local visibility preprocessing facts kept out of per-frame renderer telemetry.
#[derive(Debug, Default)]
struct VisibilityApertureDiagnostics {
    authored_source_crossings: usize,
    reciprocal_intersection_crossings: usize,
    synthesized_intersection_geometries: usize,
    unresolved_reciprocals: Vec<Value>,
}

/// Immutable lookup state needed to prove one directed indoor seam.
struct InternalRelationshipContext<'a> {
    interior: &'a LandblockInteriorSystemAsset,
    portal_indices: &'a HashMap<LandblockEnvCellPortalRef, usize>,
    cell_indices: &'a HashMap<u32, usize>,
    aperture_indices_by_cell_polygon: &'a HashMap<(u32, u16), usize>,
    apertures: &'a [PortalAperture],
    cell_bounds: &'a [Option<RenderAabb>],
}

fn classify_internal_relationship(
    portal: &LandblockPortal,
    validated_target: Option<LandblockEnvCellPortalRef>,
    context: &InternalRelationshipContext<'_>,
) -> Result<CrossingRelationship> {
    let Some(target_ref) = validated_target else {
        return Ok(CrossingRelationship::IndoorTopologyBoundary(
            IndoorTopologyBoundaryReason::MissingReciprocalIdentity,
        ));
    };
    let target_portal = &context.interior.topology.portals[context.portal_indices[&target_ref]];
    let target_cell_index = context.cell_indices[&target_ref.env_cell_id];
    let source_cell_index = context.cell_indices[&portal.source.env_cell_id];
    let source_aperture_index =
        context.aperture_indices_by_cell_polygon[&(portal.source.env_cell_id, portal.polygon_id)];
    let target_aperture_index = context.aperture_indices_by_cell_polygon
        [&(target_ref.env_cell_id, target_portal.polygon_id)];
    let classification = classify_indoor_seam(IndoorSeamEvidence {
        reciprocal_identity_proven: true,
        source_exact_match: (portal.flags & 0x01) != 0,
        target_exact_match: (target_portal.flags & 0x01) != 0,
        source_aperture: &context.apertures[source_aperture_index],
        target_aperture: &context.apertures[target_aperture_index],
        source_accepted_side: accepted_plane_side(portal.flags),
        target_accepted_side: accepted_plane_side(target_portal.flags),
        source_cell_bounds: context.cell_bounds[source_cell_index],
        target_cell_bounds: context.cell_bounds[target_cell_index],
    });
    Ok(match classification {
        IndoorSeamClassification::DepthContinuous => CrossingRelationship::IndoorDepthContinuous {
            reciprocal_aperture_index: target_aperture_index,
        },
        IndoorSeamClassification::TopologyBoundary(reason) => {
            CrossingRelationship::IndoorTopologyBoundary(reason)
        }
    })
}

async fn resolve_building_aperture(
    runtime: &ContentAssetRuntime,
    source_batch: &LoadedLandblockSourceBatch,
    reference: LandblockBuildingPortalRef,
    gfx_cache: &mut BTreeMap<u32, Arc<GfxObj>>,
    aperture_cache: &mut BTreeMap<(usize, usize), ResolvedBuildingAperture>,
    apertures: &mut SerializedApertures,
) -> Result<ResolvedBuildingAperture> {
    if let Some(aperture) = aperture_cache.get(&(reference.building_index, reference.portal_index))
    {
        return Ok(*aperture);
    }
    let landblock = source_batch
        .landblock()
        .context("building aperture requires a shallow landblock")?;
    let building = landblock
        .buildings
        .get(reference.building_index)
        .context("building aperture index is out of range")?;
    ensure!(
        building.source_did == reference.building_source_did,
        "building aperture source DID does not match topology claim"
    );
    let gfx_obj = if let Some(gfx_obj) = gfx_cache.get(&building.source_did) {
        Arc::clone(gfx_obj)
    } else {
        let asset = runtime
            .load(ContentAssetRequest::GfxObj(building.source_did))
            .await
            .with_context(|| {
                format!(
                    "Could not load building GfxObj 0x{:08X}",
                    building.source_did
                )
            })?;
        let ContentAsset::GfxObj(gfx_obj) = asset else {
            anyhow::bail!("building GfxObj request returned another asset");
        };
        gfx_cache.insert(building.source_did, Arc::clone(&gfx_obj));
        gfx_obj
    };
    let projected = build_gfx_obj_portal_apertures(&gfx_obj)?;
    let selected = projected
        .iter()
        .find(|aperture| aperture.portal_index == reference.portal_index)
        .with_context(|| {
            format!(
                "building GfxObj 0x{:08X} has no portal aperture {}",
                building.source_did, reference.portal_index
            )
        })?;
    let transformed = transform_aperture(&selected.aperture, building.placement)?;
    let aperture_index = apertures.append(
        format!(
            "portal-aperture:building/{:04x}/{:04x}",
            reference.building_index, reference.portal_index
        ),
        "building-transition",
        selected.polygon_ids.clone(),
        &transformed,
    )?;
    let resolved = ResolvedBuildingAperture {
        aperture_index,
        mask_depth_policy: if selected.has_drawing_bsp_node_polygon {
            MaskDepthPolicy::RejectEqualDepth
        } else {
            MaskDepthPolicy::AllowEqualDepth
        },
    };
    aperture_cache.insert((reference.building_index, reference.portal_index), resolved);
    Ok(resolved)
}

/// Group cells into depth-continuous visibility islands and return one compact ordinal per cell.
///
/// Islands are the render domains the compositor's per-pixel walk actually moves between, so the
/// junction exemption bound below must be counted per island, not per authored cell: an island's
/// exit set is the union of its member cells' exits. Ordinals are dense, assigned in first-seen
/// cell order, and are meaningful only within this record.
fn resolve_cell_island_ordinals(cell_count: usize, crossings: &[CrossingProjection]) -> Vec<u32> {
    let mut parents: Vec<usize> = (0..cell_count).collect();
    fn find(parents: &mut Vec<usize>, index: usize) -> usize {
        if parents[index] != index {
            let root = find(parents, parents[index]);
            parents[index] = root;
        }
        parents[index]
    }
    for crossing in crossings {
        if !matches!(
            crossing.relationship,
            CrossingRelationship::IndoorDepthContinuous { .. }
        ) {
            continue;
        }
        let (Some(source), Some(target)) = (crossing.source_cell_index, crossing.target_cell_index)
        else {
            continue;
        };
        let source_root = find(&mut parents, source);
        let target_root = find(&mut parents, target);
        if source_root != target_root {
            parents[source_root] = target_root;
        }
    }
    let mut ordinal_by_root = HashMap::new();
    (0..cell_count)
        .map(|cell| {
            let root = find(&mut parents, cell);
            let next = ordinal_by_root.len() as u32;
            *ordinal_by_root.entry(root).or_insert(next)
        })
        .collect()
}

/// Assign shared junction ids to coplanar-overlapping crossing groups, degrading loudly on shapes
/// outside the exemption's soundness bound.
fn resolve_crossing_junction_groups(
    landblock_id: u32,
    crossings: &mut [CrossingProjection],
    apertures: &SerializedApertures,
    cell_island_ordinals: &[u32],
) -> Result<()> {
    // Outdoor is domain zero; islands shift up by one.
    let candidates = crossings
        .iter()
        .map(|crossing| JunctionCandidate {
            aperture: &apertures.geometries[crossing.source_aperture_index],
            source_domain: match crossing.source_cell_index {
                None => 0,
                Some(cell) => cell_island_ordinals[cell] + 1,
            },
            reciprocal: crossing.reciprocal_index,
        })
        .collect::<Vec<_>>();
    let resolution = resolve_junction_groups(&candidates)?;
    for oversized in &resolution.oversized {
        log::warn!(
            "landblock 0x{landblock_id:08X} declines a portal junction: {} crossings share plane \
             (({:.4},{:.4},{:.4})|{:.4}) and one render domain contributes {}; members keep the \
             strict entry test: {}",
            oversized.members.len(),
            oversized.plane.normal.x,
            oversized.plane.normal.y,
            oversized.plane.normal.z,
            oversized.plane.d,
            oversized.largest_domain_member_count,
            oversized
                .members
                .iter()
                .map(|member| {
                    apertures.identities[crossings[*member].source_aperture_index].as_str()
                })
                .collect::<Vec<_>>()
                .join(", "),
        );
    }
    for (crossing, assignment) in crossings.iter_mut().zip(resolution.assignments) {
        crossing.junction_group = assignment;
    }
    Ok(())
}

/// Resolve each directed crossing's rendering aperture without changing authored query geometry.
fn resolve_visibility_apertures(
    crossings: &mut [CrossingProjection],
    apertures: &mut SerializedApertures,
) -> Result<VisibilityApertureDiagnostics> {
    let mut diagnostics = VisibilityApertureDiagnostics::default();
    let mut intersections =
        BTreeMap::<(usize, usize), (usize, VisibilityApertureIntersectionEvidence)>::new();
    for crossing_index in 0..crossings.len() {
        let source_aperture_index = crossings[crossing_index].source_aperture_index;
        let Some(reciprocal_index) = crossings[crossing_index].reciprocal_index else {
            diagnostics.authored_source_crossings += 1;
            diagnostics.unresolved_reciprocals.push(json!({
                "crossingIndex": crossing_index,
                "sourceApertureId": apertures.identities[source_aperture_index],
            }));
            continue;
        };
        ensure!(
            crossings
                .get(reciprocal_index)
                .and_then(|reciprocal| reciprocal.reciprocal_index)
                == Some(crossing_index),
            "portal crossing {crossing_index} names non-mutual reciprocal crossing {reciprocal_index}"
        );
        if crossings[crossing_index].exact_match {
            diagnostics.authored_source_crossings += 1;
            continue;
        }

        let reciprocal_aperture_index = crossings[reciprocal_index].source_aperture_index;
        let pair = if crossing_index < reciprocal_index {
            (crossing_index, reciprocal_index)
        } else {
            (reciprocal_index, crossing_index)
        };
        let (visibility_aperture_index, evidence) = if let Some(resolved) =
            intersections.get(&pair).copied()
        {
            resolved
        } else {
            let selected_source_crossing = if !crossings[pair.0].exact_match {
                pair.0
            } else {
                pair.1
            };
            let selected_target_crossing = if selected_source_crossing == pair.0 {
                pair.1
            } else {
                pair.0
            };
            let selected_source_aperture =
                crossings[selected_source_crossing].source_aperture_index;
            let selected_target_aperture =
                crossings[selected_target_crossing].source_aperture_index;
            let intersection = intersect_visibility_apertures(
                    &apertures.geometries[selected_source_aperture],
                    &apertures.geometries[selected_target_aperture],
                )
                .with_context(|| {
                    format!(
                        "Could not synthesize visibility aperture for reciprocal crossings {}/{} ({}/{})",
                        pair.0,
                        pair.1,
                        apertures.identities[selected_source_aperture],
                        apertures.identities[selected_target_aperture],
                    )
                })?;
            let visibility_aperture_index = apertures.append(
                format!(
                    "portal-aperture:visibility-intersection/crossings/{:04x}-{:04x}",
                    pair.0, pair.1
                ),
                "effective-visibility",
                Vec::new(),
                &intersection.aperture,
            )?;
            let resolved = (visibility_aperture_index, intersection.evidence);
            intersections.insert(pair, resolved);
            diagnostics.synthesized_intersection_geometries += 1;
            resolved
        };
        crossings[crossing_index].visibility_aperture_index = visibility_aperture_index;
        crossings[crossing_index].visibility_provenance =
            VisibilityApertureProvenance::ReciprocalIntersection {
                reciprocal_aperture_index,
                evidence,
            };
        diagnostics.reciprocal_intersection_crossings += 1;
    }
    Ok(diagnostics)
}

/// A portal aperture stays typed while its transport geometry and manifest are accumulated.
#[derive(Default)]
struct SerializedApertures {
    manifests: Vec<Value>,
    identities: Vec<String>,
    geometries: Vec<PortalAperture>,
    positions: Vec<f32>,
    indices: Vec<u32>,
}

impl SerializedApertures {
    fn append(
        &mut self,
        id: String,
        kind: &'static str,
        polygon_ids: Vec<u16>,
        aperture: &PortalAperture,
    ) -> Result<usize> {
        let index = self.manifests.len();
        self.identities.push(id.clone());
        let position_offset = self.positions.len() / 3;
        for position in &aperture.positions {
            self.positions.extend([position.x, position.y, position.z]);
        }
        let index_offset = self.indices.len();
        self.indices
            .extend(aperture.triangle_indices.iter().copied());
        self.manifests.push(json!({
            "id": id,
            "kind": kind,
            "polygonIds": polygon_ids,
            "positionOffset": position_offset,
            "positionCount": aperture.positions.len(),
            "indexOffset": index_offset,
            "indexCount": aperture.triangle_indices.len(),
            "plane": {
                "normal": [aperture.plane.normal.x, aperture.plane.normal.y, aperture.plane.normal.z],
                "d": aperture.plane.d,
            },
            "bounds": render_aabb_json(&aperture.bounds),
        }));
        self.geometries.push(aperture.clone());
        ensure!(
            self.geometries.len() == self.manifests.len()
                && self.identities.len() == self.manifests.len(),
            "aperture geometry, identity, and manifest collections diverged"
        );
        Ok(index)
    }
}

fn crossing_json(index: usize, crossing: &CrossingProjection) -> Value {
    json!({
        "id": format!("portal-crossing:{index}"),
        "sourceCellIndex": crossing.source_cell_index,
        "targetCellIndex": crossing.target_cell_index,
        "sourceApertureIndex": crossing.source_aperture_index,
        "visibilityApertureIndex": crossing.visibility_aperture_index,
        "visibilityProvenance": visibility_provenance_json(crossing.visibility_provenance),
        "acceptedSide": accepted_side_name(crossing.accepted_side),
        "exactMatch": crossing.exact_match,
        "maskDepthPolicy": match crossing.mask_depth_policy {
            MaskDepthPolicy::AllowEqualDepth => "allow-equal-depth",
            MaskDepthPolicy::RejectEqualDepth => "reject-equal-depth",
        },
        "reciprocalCrossingIndex": crossing.reciprocal_index,
        "sourcePortal": crossing.source,
        "spatialRelationship": relationship_json(crossing.relationship),
        "junctionGroupId": crossing.junction_group.map(NonZeroU32::get),
    })
}

fn visibility_provenance_json(provenance: VisibilityApertureProvenance) -> Value {
    match provenance {
        VisibilityApertureProvenance::AuthoredSource => json!({
            "kind": "authored-source",
        }),
        VisibilityApertureProvenance::ReciprocalIntersection {
            reciprocal_aperture_index,
            evidence,
        } => json!({
            "kind": "reciprocal-intersection",
            "reciprocalApertureIndex": reciprocal_aperture_index,
            "maximumPlaneDeviation": evidence.maximum_plane_deviation,
            "absoluteNormalDot": evidence.absolute_normal_dot,
            "componentCount": evidence.component_count,
        }),
    }
}

fn boundary_reason_name(reason: IndoorTopologyBoundaryReason) -> &'static str {
    match reason {
        IndoorTopologyBoundaryReason::MissingReciprocalIdentity => "missing-reciprocal-identity",
        IndoorTopologyBoundaryReason::SourceIsNotExactMatch => "source-not-exact-match",
        IndoorTopologyBoundaryReason::TargetIsNotExactMatch => "target-not-exact-match",
        IndoorTopologyBoundaryReason::AperturesDiffer => "apertures-differ",
        IndoorTopologyBoundaryReason::AcceptedSidesAreNotOpposed => "accepted-sides-not-opposed",
        IndoorTopologyBoundaryReason::MissingSourceCellBounds => "missing-source-cell-bounds",
        IndoorTopologyBoundaryReason::MissingTargetCellBounds => "missing-target-cell-bounds",
        IndoorTopologyBoundaryReason::SourceCellCrossesPortalPlane => {
            "source-cell-crosses-portal-plane"
        }
        IndoorTopologyBoundaryReason::TargetCellCrossesPortalPlane => {
            "target-cell-crosses-portal-plane"
        }
    }
}

fn accepted_side_name(side: AcceptedPlaneSide) -> &'static str {
    match side {
        AcceptedPlaneSide::Positive => "positive",
        AcceptedPlaneSide::Negative => "negative",
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvCellRecordManifest {
    transport: &'static str,
    version: u16,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    landblock_id: String,
    availability: &'static str,
    cell_count: usize,
    structures: Vec<Value>,
    apertures: Vec<Value>,
    crossings: Vec<Value>,
    residents: Vec<Value>,
    object_definitions: Vec<Value>,
    object_geometries: Vec<Value>,
    materials: Vec<Value>,
    texture_dependencies: Vec<Value>,
    diagnostics: Value,
    sections: Vec<BinarySectionManifest>,
}

fn serialize_absent_record(landblock_id: u32) -> Result<Vec<u8>> {
    serialize_record(
        &EnvCellRecordManifest {
            transport: "holtburger-env-cell-record",
            version: ENV_CELL_RECORD_VERSION,
            byte_order: "little-endian",
            section_byte_offset_base: "section-data",
            landblock_id: dat_id(landblock_id),
            availability: "absent",
            cell_count: 0,
            structures: Vec::new(),
            apertures: Vec::new(),
            crossings: Vec::new(),
            residents: Vec::new(),
            object_definitions: Vec::new(),
            object_geometries: Vec::new(),
            materials: Vec::new(),
            texture_dependencies: Vec::new(),
            diagnostics: json!({
                "unresolvedOutsideEndpoints": [],
                "unresolvedVisibilityReciprocals": [],
                "visibilityApertureCounts": {
                    "authoredSourceCrossings": 0,
                    "reciprocalIntersectionCrossings": 0,
                    "synthesizedIntersectionGeometries": 0,
                },
            }),
            sections: Vec::new(),
        },
        Vec::new(),
    )
}

fn serialize_record(manifest: &EnvCellRecordManifest, section_bytes: Vec<u8>) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(manifest)?;
    while !(ENV_CELL_RECORD_HEADER_LENGTH + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_length = ENV_CELL_RECORD_HEADER_LENGTH + manifest_bytes.len() + section_bytes.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(ENV_CELL_RECORD_MAGIC);
    bytes.extend(ENV_CELL_RECORD_VERSION.to_le_bytes());
    bytes.extend(0u16.to_le_bytes());
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    bytes.extend(section_bytes);
    Ok(bytes)
}

fn push_range(ranges: &mut Vec<u32>, offset: usize, count: usize) -> Result<()> {
    ranges.push(u32::try_from(offset)?);
    ranges.push(u32::try_from(count)?);
    Ok(())
}

fn placement_values(placement: LandblockPlacement) -> [f32; 7] {
    [
        placement.origin.x,
        placement.origin.y,
        placement.origin.z,
        placement.orientation.w,
        placement.orientation.x,
        placement.orientation.y,
        placement.orientation.z,
    ]
}

fn bounds_values(bounds: RenderAabb) -> [f32; 6] {
    [
        bounds.min.x,
        bounds.min.y,
        bounds.min.z,
        bounds.max.x,
        bounds.max.y,
        bounds.max.z,
    ]
}

fn placement_json(placement: LandblockPlacement) -> Value {
    json!({
        "origin": [placement.origin.x, placement.origin.y, placement.origin.z],
        "orientation": [
            placement.orientation.w,
            placement.orientation.x,
            placement.orientation.y,
            placement.orientation.z,
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::polygon_geometry::RenderVec3;
    use crate::portal_geometry::{RenderPlane, bounds_for_positions};

    #[test]
    fn absent_record_is_versioned_and_independently_decodable() {
        let bytes = serialize_absent_record(0x0001_ffff).expect("absent record should serialize");

        assert_eq!(&bytes[..4], ENV_CELL_RECORD_MAGIC);
        assert_eq!(
            u16::from_le_bytes(bytes[4..6].try_into().unwrap()),
            ENV_CELL_RECORD_VERSION
        );
        assert_eq!(u16::from_le_bytes(bytes[6..8].try_into().unwrap()), 0);
        let manifest_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        assert_eq!(
            u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize,
            bytes.len()
        );
        let manifest: Value = serde_json::from_slice(
            &bytes[ENV_CELL_RECORD_HEADER_LENGTH..ENV_CELL_RECORD_HEADER_LENGTH + manifest_length],
        )
        .expect("manifest should remain padded JSON");
        assert_eq!(manifest["availability"], "absent");
        assert_eq!(manifest["landblockId"], "0x0001ffff");
        assert_eq!(manifest["sections"], json!([]));
    }

    #[test]
    fn non_exact_reciprocals_share_one_visibility_intersection() {
        let mut apertures = SerializedApertures::default();
        let source = square_aperture(0.0, 0.0, 2.0, 2.0, 0.0);
        let target = square_aperture(1.0, 0.0, 3.0, 2.0, 0.000_9);
        let source_index = append_test_aperture(&mut apertures, "source", &source);
        let target_index = append_test_aperture(&mut apertures, "target", &target);
        let mut crossings = vec![
            test_crossing(source_index, false, Some(1)),
            test_crossing(target_index, false, Some(0)),
        ];

        let diagnostics = resolve_visibility_apertures(&mut crossings, &mut apertures).unwrap();

        assert_eq!(
            crossings[0].visibility_aperture_index,
            crossings[1].visibility_aperture_index
        );
        assert_ne!(
            crossings[0].visibility_aperture_index,
            crossings[0].source_aperture_index
        );
        assert_eq!(apertures.geometries[source_index], source);
        assert_eq!(apertures.geometries[target_index], target);
        assert_eq!(diagnostics.authored_source_crossings, 0);
        assert_eq!(diagnostics.reciprocal_intersection_crossings, 2);
        assert_eq!(diagnostics.synthesized_intersection_geometries, 1);
    }

    #[test]
    fn asymmetric_exact_flags_keep_directional_visibility_geometry() {
        let mut apertures = SerializedApertures::default();
        let source_index = append_test_aperture(
            &mut apertures,
            "exact",
            &square_aperture(0.0, 0.0, 2.0, 2.0, 0.0),
        );
        let target_index = append_test_aperture(
            &mut apertures,
            "non-exact",
            &square_aperture(1.0, 0.0, 3.0, 2.0, 0.0),
        );
        let mut crossings = vec![
            test_crossing(source_index, true, Some(1)),
            test_crossing(target_index, false, Some(0)),
        ];

        let diagnostics = resolve_visibility_apertures(&mut crossings, &mut apertures).unwrap();

        assert_eq!(crossings[0].visibility_aperture_index, source_index);
        assert_ne!(crossings[1].visibility_aperture_index, target_index);
        assert_eq!(diagnostics.authored_source_crossings, 1);
        assert_eq!(diagnostics.reciprocal_intersection_crossings, 1);
        assert_eq!(diagnostics.synthesized_intersection_geometries, 1);
    }

    #[test]
    fn malformed_reciprocal_intersection_fails_with_both_identities() {
        let mut apertures = SerializedApertures::default();
        let source_index = append_test_aperture(
            &mut apertures,
            "source",
            &square_aperture(0.0, 0.0, 1.0, 1.0, 0.0),
        );
        let target_index = append_test_aperture(
            &mut apertures,
            "target",
            &square_aperture(2.0, 0.0, 3.0, 1.0, 0.0),
        );
        let mut crossings = vec![
            test_crossing(source_index, false, Some(1)),
            test_crossing(target_index, false, Some(0)),
        ];

        let error = resolve_visibility_apertures(&mut crossings, &mut apertures).unwrap_err();

        let message = format!("{error:#}");
        assert!(message.contains("test/source"));
        assert!(message.contains("test/target"));
        assert!(message.contains("intersection is empty"));
    }

    fn append_test_aperture(
        apertures: &mut SerializedApertures,
        id: &str,
        aperture: &PortalAperture,
    ) -> usize {
        apertures
            .append(
                format!("portal-aperture:test/{id}"),
                "env-cell",
                vec![0],
                aperture,
            )
            .unwrap()
    }

    fn test_crossing(
        source_aperture_index: usize,
        exact_match: bool,
        reciprocal_index: Option<usize>,
    ) -> CrossingProjection {
        CrossingProjection {
            source_cell_index: Some(0),
            target_cell_index: Some(1),
            source_aperture_index,
            visibility_aperture_index: source_aperture_index,
            visibility_provenance: VisibilityApertureProvenance::AuthoredSource,
            accepted_side: AcceptedPlaneSide::Positive,
            exact_match,
            mask_depth_policy: MaskDepthPolicy::AllowEqualDepth,
            reciprocal_index,
            junction_group: None,
            source: json!({ "kind": "test" }),
            relationship: CrossingRelationship::IndoorTopologyBoundary(
                IndoorTopologyBoundaryReason::SourceIsNotExactMatch,
            ),
        }
    }

    #[test]
    fn depth_continuous_crossings_union_cells_into_islands() {
        let mut apertures = SerializedApertures::default();
        let seam = square_aperture(0.0, 0.0, 2.0, 2.0, 0.0);
        let seam_index = append_test_aperture(&mut apertures, "seam", &seam);
        let mut continuous = test_crossing(seam_index, true, Some(1));
        continuous.source_cell_index = Some(0);
        continuous.target_cell_index = Some(1);
        continuous.relationship = CrossingRelationship::IndoorDepthContinuous {
            reciprocal_aperture_index: seam_index,
        };
        let mut boundary = test_crossing(seam_index, false, None);
        boundary.source_cell_index = Some(1);
        boundary.target_cell_index = Some(2);

        let ordinals = resolve_cell_island_ordinals(3, &[continuous, boundary]);

        assert_eq!(ordinals, vec![0, 0, 1]);
    }

    #[test]
    fn coincident_junction_crossings_share_one_group_id() {
        let mut apertures = SerializedApertures::default();
        let footprint = square_aperture(0.0, 0.0, 2.0, 2.0, 0.0);
        let elsewhere = square_aperture(10.0, 0.0, 12.0, 2.0, 0.0);
        let footprint_index = append_test_aperture(&mut apertures, "footprint", &footprint);
        let elsewhere_index = append_test_aperture(&mut apertures, "elsewhere", &elsewhere);

        // Cells 0 and 1 in distinct islands, chained through a zero-thickness outdoor slab.
        let mut crossings = vec![
            exterior_crossing(footprint_index, Some(0), None, Some(1)),
            exterior_crossing(footprint_index, None, Some(0), Some(0)),
            exterior_crossing(footprint_index, Some(1), None, Some(3)),
            exterior_crossing(footprint_index, None, Some(1), Some(2)),
            exterior_crossing(elsewhere_index, Some(0), None, None),
        ];
        let ordinals = resolve_cell_island_ordinals(2, &crossings);

        resolve_crossing_junction_groups(0x0001_ffff, &mut crossings, &apertures, &ordinals)
            .unwrap();

        let group = crossings[0].junction_group.expect("junction id assigned");
        assert!(
            crossings[..4]
                .iter()
                .all(|crossing| crossing.junction_group == Some(group))
        );
        assert_eq!(crossings[4].junction_group, None);
    }

    fn exterior_crossing(
        source_aperture_index: usize,
        source_cell_index: Option<usize>,
        target_cell_index: Option<usize>,
        reciprocal_index: Option<usize>,
    ) -> CrossingProjection {
        let mut crossing = test_crossing(source_aperture_index, false, reciprocal_index);
        crossing.source_cell_index = source_cell_index;
        crossing.target_cell_index = target_cell_index;
        crossing.relationship = CrossingRelationship::ExteriorTransition {
            exterior_landblock_id: 0x0001_ffff,
        };
        crossing
    }

    fn square_aperture(
        minimum_x: f32,
        minimum_y: f32,
        maximum_x: f32,
        maximum_y: f32,
        z: f32,
    ) -> PortalAperture {
        let positions = vec![
            RenderVec3 {
                x: minimum_x,
                y: minimum_y,
                z,
            },
            RenderVec3 {
                x: maximum_x,
                y: minimum_y,
                z,
            },
            RenderVec3 {
                x: maximum_x,
                y: maximum_y,
                z,
            },
            RenderVec3 {
                x: minimum_x,
                y: maximum_y,
                z,
            },
        ];
        PortalAperture {
            bounds: bounds_for_positions(&positions).unwrap(),
            positions,
            triangle_indices: vec![0, 1, 2, 0, 2, 3],
            plane: RenderPlane {
                normal: RenderVec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                },
                d: -z,
            },
        }
    }
}
