use crate::adapter::binary::{BinaryAssetSectionWriter, serialize_landblock_terrain_binary};
use crate::adapter::service::asset_cache_error_code;
use holtburger_common::math::{Quaternion, Vector3};
use holtburger_content::*;
use holtburger_dat::file_type::setup_model::AnimationHookPayload;
use holtburger_dat::file_type::{Animation, Palette, RenderSurface, SetupModel};
use holtburger_dat::physics::BspNode;

const RETAIL_HIGH_DETAIL_SURFACE_TEXTURE_SOURCE_LEVEL_INDEX: usize = 0;
const RETAIL_DETAIL_FADE_NEAR: f32 = 10.0;
const RETAIL_DETAIL_FADE_FAR: f32 = 50.0;

pub fn serialize_setup_model_payload(setup_model: &SetupModel) -> serde_json::Value {
    serde_json::json!({
        "kind": "setup-model",
        "residencyKind": "unknown",
        "sourceAssetKind": "setup-model",
        "setupModelId": setup_model.id,
        "flags": setup_model.flags,
        "parts": serialize_setup_model_parts(setup_model),
        "holdingLocations": serialize_location_map(&setup_model.holding_locations),
        "connectionPoints": serialize_location_map(&setup_model.connection_points),
        "placementSets": serialize_placement_sets(setup_model),
        "collisionWitness": {
            "cylSphereCount": setup_model.cyl_spheres.len(),
            "sphereCount": setup_model.spheres.len(),
        },
        "height": setup_model.height,
        "radius": setup_model.radius,
        "stepUp": setup_model.step_up,
        "stepDown": setup_model.step_down,
        "sortingSphere": serialize_sphere(&setup_model.sorting_sphere),
        "selectionSphere": serialize_sphere(&setup_model.selection_sphere),
        "lights": serialize_lights(&setup_model.lights),
        "defaultAnimation": setup_model.default_animation,
        "defaultScript": setup_model.default_script,
        "defaultMotionTable": setup_model.default_motion_table,
        "defaultSoundTable": setup_model.default_sound_table,
        "defaultScriptTable": setup_model.default_script_table,
        "dependencies": {
            "gfxObjAssetIds": setup_model.parts.iter().map(|gfx_obj_id| format_gfx_obj_asset_id(*gfx_obj_id)).collect::<Vec<_>>(),
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "setup-model",
            "errorCode": null,
            "detail": null
        }
    })
}

pub fn serialize_animation_payload(animation: &Animation) -> serde_json::Value {
    serde_json::json!({
        "kind": "animation",
        "residencyKind": "unknown",
        "sourceAssetKind": "animation",
        "animationId": animation.id,
        "animationAssetId": format_animation_asset_id(animation.id),
        "flags": animation.flags.bits(),
        "partCount": animation.num_parts,
        "frameCount": animation.num_frames,
        "objectPositionFrames": animation.pos_frames.iter().map(serialize_frame).collect::<Vec<_>>(),
        "partFrames": animation.part_frames.iter().enumerate().map(|(frame_index, frame)| {
            serde_json::json!({
                "frameIndex": frame_index,
                "localPlacements": frame.frames.iter().map(serialize_frame).collect::<Vec<_>>(),
                "hooks": frame.hooks.iter().map(serialize_animation_hook).collect::<Vec<_>>(),
            })
        }).collect::<Vec<_>>(),
        "dependencies": {},
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "animation",
            "errorCode": null,
            "detail": null
        }
    })
}

pub fn failed_animation_payload(animation_id: u32, error: anyhow::Error) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": "animation",
        "residencyKind": "unknown",
        "sourceAssetKind": "animation",
        "animationId": animation_id,
        "animationAssetId": format_animation_asset_id(animation_id),
        "flags": null,
        "partCount": 0,
        "frameCount": 0,
        "objectPositionFrames": [],
        "partFrames": [],
        "dependencies": {},
        "provenance": failed_provenance("animation", error_code, &detail),
    })
}

pub fn serialize_material_recipe_payload(
    recipe: &ResolvedMaterialRecipe,
    render_surface_available: impl Fn(u32) -> bool,
) -> serde_json::Value {
    let (source, dependencies) = match &recipe.source {
        ResolvedMaterialSource::SolidColor(color) => (
            serde_json::json!({
                "kind": "solid-color",
                "argb": color,
            }),
            serde_json::json!({
                "surfaceTextureAssetIds": [],
                "renderSurfaceAssetIds": [],
                "paletteAssetIds": [],
            }),
        ),
        ResolvedMaterialSource::Texture(texture) => {
            let selected_render_surface_id =
                dto_render_surface_id(&texture.render_surface_ids, &render_surface_available);
            let render_surface_asset_ids = selected_render_surface_id
                .map(format_render_surface_asset_id)
                .into_iter()
                .collect::<Vec<_>>();
            (
                serde_json::json!({
                    "kind": "texture",
                    "surfaceTextureId": texture.surface_texture_id,
                    "selectedRenderSurfaceId": selected_render_surface_id,
                    "paletteId": texture.palette_id,
                    "renderSurfaceDefaultPaletteIds": texture.render_surface_default_palette_ids,
                }),
                serde_json::json!({
                    "surfaceTextureAssetIds": [format_surface_texture_asset_id(texture.surface_texture_id)],
                    "renderSurfaceAssetIds": render_surface_asset_ids,
                    "paletteAssetIds": recipe_palette_asset_ids(texture),
                }),
            )
        }
    };

    serde_json::json!({
        "kind": "material-recipe",
        "residencyKind": "unknown",
        "sourceAssetKind": "material-recipe",
        "surfaceId": recipe.surface_id,
        "surfaceType": recipe.surface_type.bits(),
        "source": source,
        "translucency": recipe.translucency,
        "luminosity": recipe.luminosity,
        "diffuse": recipe.diffuse,
        "dependencies": dependencies,
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "material-recipe",
            "errorCode": null,
            "detail": null
        }
    })
}

pub fn serialize_setup_appearance_payload(
    appearance: &ResolvedSetupAppearance,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "setup-appearance",
        "residencyKind": "unknown",
        "sourceAssetKind": "setup-appearance",
        "setupModelId": appearance.setup_model_id,
        "appearanceKey": appearance.appearance_key,
        "parts": appearance.parts.iter().map(serialize_setup_appearance_part).collect::<Vec<_>>(),
        "textureChanges": appearance.texture_changes.iter().map(|change| {
            serde_json::json!({
                "partIndex": change.part_index,
                "oldTexture": change.old_texture,
                "newTexture": change.new_texture,
            })
        }).collect::<Vec<_>>(),
        "animPartChanges": appearance.anim_part_changes.iter().map(|change| {
            serde_json::json!({
                "partIndex": change.part_index,
                "partId": change.part_id,
            })
        }).collect::<Vec<_>>(),
        "paletteId": appearance.palette_id,
        "subPalettes": appearance.sub_palettes.iter().map(|sub| {
            serde_json::json!({
                "subId": sub.sub_id,
                "offset": sub.offset,
                "numColors": sub.num_colors,
            })
        }).collect::<Vec<_>>(),
        "dependencies": {
            "materialAssetIds": appearance.material_asset_ids.iter().map(|surface_id| format_material_asset_id(*surface_id)).collect::<Vec<_>>(),
            "paletteAssetIds": appearance.palette_dependencies.iter().map(|palette_id| format_palette_asset_id(*palette_id)).collect::<Vec<_>>(),
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "setup-appearance",
            "errorCode": null,
            "detail": null
        }
    })
}

pub fn serialize_setup_appearance_part(
    part: &holtburger_content::ResolvedSetupAppearancePart,
) -> serde_json::Value {
    serde_json::json!({
        "partIndex": part.part_index,
        "gfxObjId": part.gfx_obj_id,
        "gfxObjAssetId": format_gfx_obj_asset_id(part.gfx_obj_id),
        "materialSlots": part.material_slots.iter().map(serialize_material_slot).collect::<Vec<_>>(),
    })
}

pub fn serialize_material_slot(slot: &ResolvedMaterialSlot) -> serde_json::Value {
    serde_json::json!({
        "slotIndex": slot.slot_index,
        "surfaceId": slot.material.surface_id,
        "materialAssetId": format_material_asset_id(slot.material.surface_id),
    })
}

pub fn serialize_surface_texture_payload(
    surface_texture: &ResolvedSurfaceTexture,
    render_surface_available: impl Fn(u32) -> bool,
) -> serde_json::Value {
    let selected_render_surface_id = dto_render_surface_id(
        &surface_texture.render_surface_ids,
        &render_surface_available,
    );
    let render_surface_asset_ids = selected_render_surface_id
        .map(format_render_surface_asset_id)
        .into_iter()
        .collect::<Vec<_>>();
    serde_json::json!({
        "kind": "surface-texture",
        "residencyKind": "unknown",
        "sourceAssetKind": "surface-texture",
        "surfaceTextureId": surface_texture.surface_texture_id,
        "textureType": surface_texture.texture_type,
        "unknown": surface_texture.unknown,
        "selectedRenderSurfaceId": selected_render_surface_id,
        "renderSurfaceIds": surface_texture.render_surface_ids,
        "dependencies": {
            "renderSurfaceAssetIds": render_surface_asset_ids,
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "surface-texture",
            "errorCode": null,
            "detail": null
        }
    })
}

fn dto_render_surface_id(
    render_surface_ids: &[u32],
    render_surface_available: impl Fn(u32) -> bool,
) -> Option<u32> {
    if let Some(high_detail_render_surface_id) =
        render_surface_ids.get(RETAIL_HIGH_DETAIL_SURFACE_TEXTURE_SOURCE_LEVEL_INDEX)
        && render_surface_available(*high_detail_render_surface_id)
    {
        return Some(*high_detail_render_surface_id);
    }

    render_surface_ids
        .iter()
        .copied()
        .find(|render_surface_id| render_surface_available(*render_surface_id))
}

pub fn serialize_render_surface_payload(render_surface: &RenderSurface) -> serde_json::Value {
    serde_json::json!({
        "kind": "render-surface",
        "residencyKind": "unknown",
        "sourceAssetKind": "render-surface",
        "renderSurfaceId": render_surface.id,
        "unknown": render_surface.unknown,
        "width": render_surface.width,
        "height": render_surface.height,
        "formatRaw": render_surface.format_raw,
        "format": format!("{:?}", render_surface.format),
        "sourceByteLength": render_surface.source_data.len(),
        "defaultPaletteId": render_surface.default_palette_id,
        "dependencies": {
            "paletteAssetIds": render_surface.default_palette_id.into_iter().map(format_palette_asset_id).collect::<Vec<_>>(),
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "render-surface",
            "errorCode": null,
            "detail": null
        }
    })
}

pub fn serialize_render_surface_binary_payload(
    render_surface: &RenderSurface,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    let mut payload = serialize_render_surface_payload(render_surface);
    payload["sourceBytes"] = serde_json::json!([]);
    writer.push_u8_section(
        "renderSurface.sourceBytes",
        format!("{path_prefix}.sourceBytes"),
        1,
        &render_surface.source_data,
    );
    payload
}

pub fn serialize_palette_payload(palette: &Palette) -> serde_json::Value {
    serde_json::json!({
        "kind": "palette",
        "residencyKind": "unknown",
        "sourceAssetKind": "palette",
        "paletteId": palette.id,
        "colorCount": palette.colors_argb.len(),
        "colorsArgb": &palette.colors_argb,
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "palette",
            "errorCode": null,
            "detail": null
        }
    })
}

pub fn failed_dependency_payload(
    kind: &str,
    file_id: u32,
    error: anyhow::Error,
) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": kind,
        "residencyKind": "unknown",
        "sourceAssetKind": kind,
        "fileId": file_id,
        "dependencies": {},
        "provenance": {
            "source": "app-local-stub",
            "sourceAssetKind": kind,
            "errorCode": error_code,
            "detail": detail
        }
    })
}

pub fn failed_terrain_material_payload(
    region_number: u32,
    error: anyhow::Error,
) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": "terrain-material",
        "residencyKind": "unknown",
        "sourceAssetKind": "terrain-material",
        "regionNumber": region_number,
        "materialKind": "tex-merge-table",
        "terrainTypes": [],
        "terrainAlphaMaps": [],
        "roadAlphaMaps": [],
        "pcodeEncoding": {
            "terrainCodeBits": 5,
            "roadCodeBits": 2,
            "sizeBitMask": 1 << 28,
        },
        "dependencies": {
            "surfaceTextureAssetIds": [],
            "renderSurfaceAssetIds": [],
            "paletteAssetIds": [],
        },
        "provenance": failed_provenance("terrain-material", error_code, &detail),
    })
}

pub fn failed_region_render_profile_payload(
    region_number: u32,
    error: anyhow::Error,
) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": "region-render-profile",
        "residencyKind": "unknown",
        "sourceAssetKind": "region-render-profile",
        "regionNumber": region_number,
        "detailRoles": {
            "landscape": null,
            "building": null,
            "environment": null,
            "object": null,
        },
        "dependencies": {
            "surfaceTextureAssetIds": [],
            "renderSurfaceAssetIds": [],
            "paletteAssetIds": [],
        },
        "provenance": failed_provenance("region-render-profile", error_code, &detail),
    })
}

pub fn failed_provenance(kind: &str, error_code: &str, detail: &str) -> serde_json::Value {
    serde_json::json!({
        "source": "app-local-stub",
        "sourceAssetKind": kind,
        "errorCode": error_code,
        "detail": detail,
    })
}

pub fn log_material_graph_failure(kind: &str, file_id: u32, error: &anyhow::Error) {
    eprintln!(
        "[holtburger-3d][material-graph] failed to resolve {kind}/0x{file_id:08X}: {error:#}"
    );
}
pub fn serialize_landblock_terrain(
    terrain_asset: &SerializedOutdoorTerrainSource,
) -> serde_json::Value {
    let Some(mesh) = terrain_asset.terrain_mesh.as_ref() else {
        return empty_landblock_terrain();
    };
    serde_json::json!({
        "gridSize": mesh.grid_size,
        "tileSize": mesh.tile_size,
        "vertices": mesh.vertices.iter().map(serialize_prepared_vec3).collect::<Vec<_>>(),
        "triangles": build_landblock_terrain_triangles(mesh).iter().map(serialize_landblock_terrain_triangle).collect::<Vec<_>>(),
        "quads": mesh.quads.iter().map(serialize_landblock_terrain_quad).collect::<Vec<_>>(),
        "terrainBvh": {
            "coordinateSpace": "landblock-outdoor-terrain-local",
            "nodes": mesh.terrain_bvh.as_ref().map(|bvh| bvh.nodes.iter().map(serialize_prepared_bvh_node).collect::<Vec<_>>()).unwrap_or_default(),
            "items": mesh.terrain_bvh_items.iter().map(serialize_landblock_terrain_bvh_item).collect::<Vec<_>>(),
        },
        "minHeight": mesh.min_height,
        "maxHeight": mesh.max_height,
        "bounds": terrain_mesh_bounds(mesh).as_ref().map(serialize_prepared_aabb),
    })
}

pub fn empty_landblock_terrain() -> serde_json::Value {
    serde_json::json!({
        "gridSize": 9,
        "tileSize": 24.0,
        "vertices": [],
        "triangles": [],
        "quads": [],
        "terrainBvh": {
            "coordinateSpace": "landblock-outdoor-terrain-local",
            "nodes": [],
            "items": [],
        },
        "minHeight": 0.0,
        "maxHeight": 0.0,
        "bounds": null,
    })
}

#[derive(Clone, Debug)]
pub struct SerializedTerrainTriangle {
    pub terrain_triangle_id: String,
    pub quad_index: usize,
    pub triangle_in_quad: usize,
    pub vertex_indices: [usize; 3],
    pub average_height: f32,
    pub bounds: PreparedAabb,
}

pub fn build_landblock_terrain_triangles(
    mesh: &PreparedTerrainMesh,
) -> Vec<SerializedTerrainTriangle> {
    mesh.triangles
        .iter()
        .enumerate()
        .filter_map(|(triangle_index, triangle)| {
            let bounds = terrain_vertex_bounds_json(mesh, [triangle.a, triangle.b, triangle.c])?;
            Some(SerializedTerrainTriangle {
                terrain_triangle_id: format!(
                    "landblock/{:08x}/outdoor/terrain/triangle/{triangle_index:04x}",
                    mesh.landblock_id
                ),
                quad_index: triangle_index / 2,
                triangle_in_quad: triangle_index % 2,
                vertex_indices: [triangle.a, triangle.b, triangle.c],
                average_height: triangle.average_height,
                bounds,
            })
        })
        .collect()
}

pub fn serialize_landblock_terrain_triangle(
    triangle: &SerializedTerrainTriangle,
) -> serde_json::Value {
    serde_json::json!({
        "terrainTriangleId": triangle.terrain_triangle_id,
        "quadIndex": triangle.quad_index,
        "triangleInQuad": triangle.triangle_in_quad,
        "vertexIndices": triangle.vertex_indices,
        "averageHeight": triangle.average_height,
        "bounds": serialize_prepared_aabb(&triangle.bounds),
    })
}

pub fn serialize_landblock_terrain_quad(quad: &PreparedTerrainQuad) -> serde_json::Value {
    serde_json::json!({
        "terrainQuadId": quad.terrain_quad_id,
        "row": quad.row,
        "col": quad.col,
        "quadIndex": quad.quad_index,
        "sourceTerrainIndices": quad.source_terrain_indices,
        "vertexIndices": quad.vertex_indices,
        "triangleIndices": quad.triangle_indices,
        "diagonal": serialize_prepared_terrain_quad_diagonal(quad.diagonal),
        "cornerTerrainCodes": quad.corner_terrain_codes,
        "pcode": quad.pcode,
        "averageHeight": quad.average_height,
        "bounds": serialize_prepared_aabb(&quad.bounds),
    })
}

pub fn serialize_prepared_terrain_quad_diagonal(
    diagonal: PreparedTerrainQuadDiagonal,
) -> &'static str {
    match diagonal {
        PreparedTerrainQuadDiagonal::SouthwestNortheast => "southwest-northeast",
        PreparedTerrainQuadDiagonal::SoutheastNorthwest => "southeast-northwest",
    }
}

pub fn serialize_landblock_terrain_bvh_item(item: &PreparedTerrainBvhItem) -> serde_json::Value {
    serde_json::json!({
        "row": item.row,
        "col": item.col,
        "quadIndex": item.quad_index,
        "triangleIndices": item.triangle_indices,
    })
}

pub fn terrain_mesh_bounds(mesh: &PreparedTerrainMesh) -> Option<PreparedAabb> {
    let indices = (0..mesh.vertices.len()).collect::<Vec<_>>();
    terrain_vertex_bounds_slice(mesh, &indices)
}

pub fn terrain_vertex_bounds_json<const N: usize>(
    mesh: &PreparedTerrainMesh,
    vertex_indices: [usize; N],
) -> Option<PreparedAabb> {
    terrain_vertex_bounds_slice(mesh, &vertex_indices)
}

pub fn terrain_vertex_bounds_slice(
    mesh: &PreparedTerrainMesh,
    vertex_indices: &[usize],
) -> Option<PreparedAabb> {
    vertex_indices
        .iter()
        .filter_map(|index| mesh.vertices.get(*index))
        .copied()
        .fold(None, |bounds, point| Some(expand_bounds(bounds, point)))
}

pub fn expand_bounds(bounds: Option<PreparedAabb>, point: PreparedVec3) -> PreparedAabb {
    match bounds {
        Some(bounds) => PreparedAabb {
            min: PreparedVec3 {
                x: bounds.min.x.min(point.x),
                y: bounds.min.y.min(point.y),
                z: bounds.min.z.min(point.z),
            },
            max: PreparedVec3 {
                x: bounds.max.x.max(point.x),
                y: bounds.max.y.max(point.y),
                z: bounds.max.z.max(point.z),
            },
        },
        None => PreparedAabb {
            min: point,
            max: point,
        },
    }
}

pub fn union_prepared_bounds(left: PreparedAabb, right: PreparedAabb) -> PreparedAabb {
    PreparedAabb {
        min: PreparedVec3 {
            x: left.min.x.min(right.min.x),
            y: left.min.y.min(right.min.y),
            z: left.min.z.min(right.min.z),
        },
        max: PreparedVec3 {
            x: left.max.x.max(right.max.x),
            y: left.max.y.max(right.max.y),
            z: left.max.z.max(right.max.z),
        },
    }
}

pub fn build_flat_bvh_nodes_from_bounds(items: Vec<(PreparedAabb, u32)>) -> Vec<serde_json::Value> {
    if items.is_empty() {
        return Vec::new();
    }
    let bounds = items
        .iter()
        .map(|(bounds, _)| *bounds)
        .reduce(union_prepared_bounds)
        .expect("non-empty BVH item list should produce bounds");
    let kind_mask = items.iter().fold(0_u32, |mask, (_, kind)| mask | *kind);
    vec![serde_json::json!({
        "bounds": serialize_prepared_aabb(&bounds),
        "left": null,
        "right": null,
        "itemIndices": (0..items.len()).collect::<Vec<_>>(),
        "kindMask": kind_mask,
    })]
}

pub fn serialize_landblock_outdoor_binary_payload(
    outdoor: &LandblockOutdoorAsset,
    region_id: u32,
    region_number: u32,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    let terrain_asset = landblock_outdoor_terrain_asset(outdoor);
    serialize_landblock_outdoor_payload_with_terrain(
        outdoor,
        region_id,
        region_number,
        serialize_landblock_terrain_binary(&terrain_asset, path_prefix, writer),
    )
}

pub fn serialize_landblock_outdoor_payload_with_terrain(
    outdoor: &LandblockOutdoorAsset,
    region_id: u32,
    region_number: u32,
    terrain: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "landblock-outdoor",
        "residencyKind": "outdoor-landblock",
        "sourceAssetKind": "landblock-outdoor",
        "landblockId": outdoor.landblock_id,
        "regionId": region_id,
        "regionNumber": region_number,
        "classification": "outdoor",
        "terrain": terrain,
        "statics": outdoor.statics.iter().map(serialize_landblock_outdoor_static_member).collect::<Vec<_>>(),
        "buildingTransitionApertures": outdoor.building_transition_apertures.iter().map(serialize_prepared_building_transition_aperture).collect::<Vec<_>>(),
        "outdoorBvh": serialize_landblock_outdoor_bvh(outdoor),
        "diagnostics": serialize_prepared_content_diagnostics(&outdoor.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-outdoor",
            "errorCode": outdoor.diagnostics.errors.first().map(|error| error.error_code),
            "detail": outdoor.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

fn serialize_prepared_building_transition_aperture(
    aperture: &holtburger_content::PreparedBuildingTransitionAperture,
) -> serde_json::Value {
    serde_json::json!({
        "apertureId": aperture.aperture_id,
        "buildingInstanceId": aperture.building_instance_id,
        "sourceDid": aperture.source_did,
        "sourceAssetId": aperture.source_asset_id,
        "portalIndex": aperture.portal_index,
        "polyId": aperture.poly_id,
        "buildingPortalId": aperture.building_portal_id,
        "buildingPortalSourceIndex": aperture.building_portal_source_index,
        "flags": aperture.flags,
        "otherCellId": aperture.other_cell_id,
        "otherPortalId": aperture.other_portal_id,
        "linkedEnvCellIds": aperture.linked_env_cell_ids,
        "points": aperture.points.iter().map(serialize_prepared_vec3).collect::<Vec<_>>(),
    })
}

pub fn serialize_landblock_topology_payload(
    topology: &LandblockTopologyAsset,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "landblock-topology",
        "residencyKind": "landblock",
        "sourceAssetKind": "landblock-topology",
        "landblockId": topology.landblock_id,
        "landblockInfoId": topology.landblock_info_id,
        "classification": serialize_landblock_classification(topology.classification),
        "envCells": topology.env_cells.iter().map(serialize_landblock_scene_env_cell_member).collect::<Vec<_>>(),
        "portalLinks": serialize_landblock_topology_portal_links(topology),
        "envCellResidencyBvh": serialize_landblock_topology_env_cell_residency_bvh(topology),
        "diagnostics": serialize_prepared_content_diagnostics(&topology.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-topology",
            "errorCode": topology.diagnostics.errors.first().map(|error| error.error_code),
            "detail": topology.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

pub fn serialize_landblock_env_cells_payload_with_cells<F>(
    bundle: &LandblockEnvCellsAsset,
    region_id: u32,
    region_number: u32,
    mut serialize_cell: F,
) -> serde_json::Value
where
    F: FnMut(usize, &LandblockEnvCellBundleCell, u32, u32) -> serde_json::Value,
{
    serde_json::json!({
        "kind": "landblock-env-cells",
        "residencyKind": "landblock",
        "sourceAssetKind": "landblock-env-cells",
        "landblockId": bundle.landblock_id,
        "landblockInfoId": bundle.landblock_info_id,
        "regionId": region_id,
        "regionNumber": region_number,
        "envCells": bundle.env_cells.iter().enumerate().map(|(index, cell)| serialize_cell(index, cell, region_id, region_number)).collect::<Vec<_>>(),
        "portalLinks": serialize_landblock_env_cell_bundle_portal_links(bundle),
        "landblockEnvCellBvh": serialize_landblock_env_cell_bundle_bvh(bundle),
        "diagnostics": serialize_prepared_content_diagnostics(&bundle.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-env-cells",
            "errorCode": bundle.diagnostics.errors.first().map(|error| error.error_code),
            "detail": bundle.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

pub fn landblock_outdoor_terrain_asset(
    outdoor: &LandblockOutdoorAsset,
) -> SerializedOutdoorTerrainSource {
    SerializedOutdoorTerrainSource {
        terrain_mesh: outdoor.terrain_mesh.clone(),
    }
}

pub struct SerializedOutdoorTerrainSource {
    pub terrain_mesh: Option<PreparedTerrainMesh>,
}

pub fn serialize_landblock_outdoor_static_member(
    member: &LandblockOutdoorStaticMember,
) -> serde_json::Value {
    let instance = &member.instance;
    serde_json::json!({
        "kind": serialize_landblock_outdoor_static_kind(instance.kind),
        "instanceId": instance.instance_id,
        "sourceDid": instance.source_did,
        "sourceAssetId": instance.source_asset_id,
        "sourceIndex": instance.source_index,
        "localPlacement": serialize_frame(&instance.local_placement),
        "sourceScale": serialize_prepared_vec3(&instance.source_scale),
        "sourceBounds": member.source_bounds.map(serialize_bounds),
        "instanceBounds": member.instance_bounds.map(serialize_bounds),
        "building": member.building.as_ref().map(|building| serde_json::json!({
            "numLeaves": building.num_leaves,
            "portals": building.portals.iter().map(|portal| serde_json::json!({
                "portalId": portal.portal_id,
                "sourceIndex": portal.source_index,
                "flags": portal.flags,
                "otherCellId": portal.other_cell_id,
                "otherPortalId": portal.other_portal_id,
                "stabLocalCellIds": portal.stab_list,
                "linkedEnvCellIds": portal.linked_env_cell_ids,
            })).collect::<Vec<_>>(),
        })),
        "generated": member.generated.as_ref().map(|generated| serde_json::json!({
            "terrainIndex": generated.terrain_index,
            "sceneId": generated.scene_id,
            "sceneTemplateIndex": generated.scene_template_index,
        })),
    })
}

pub fn serialize_landblock_outdoor_static_kind(kind: PreparedStaticInstanceKind) -> &'static str {
    match kind {
        PreparedStaticInstanceKind::Building => "building",
        PreparedStaticInstanceKind::GeneratedScenery => "generated-scenery",
        _ => "explicit-object",
    }
}

pub fn serialize_landblock_outdoor_bvh(outdoor: &LandblockOutdoorAsset) -> serde_json::Value {
    let Some(bvh) = outdoor.outdoor_bvh.as_ref() else {
        return serde_json::Value::Null;
    };
    let mut sorted_statics = outdoor
        .statics
        .iter()
        .filter(|m| m.instance_bounds.is_some())
        .collect::<Vec<_>>();
    sorted_statics
        .sort_by(|left, right| left.instance.instance_id.cmp(&right.instance.instance_id));
    let items = sorted_statics
        .into_iter()
        .map(|member| {
            serde_json::json!({
                "kind": serialize_landblock_outdoor_bvh_item_kind(member.instance.kind),
                "instanceId": member.instance.instance_id,
            })
        })
        .collect::<Vec<_>>();

    serde_json::json!({
        "coordinateSpace": "landblock-render-local",
        "nodes": bvh.nodes.iter().map(serialize_prepared_bvh_node).collect::<Vec<_>>(),
        "items": items,
    })
}

pub fn serialize_landblock_outdoor_bvh_item_kind(kind: PreparedStaticInstanceKind) -> &'static str {
    match kind {
        PreparedStaticInstanceKind::Building => "building",
        _ => "static",
    }
}

pub fn serialize_landblock_topology_env_cell_residency_bvh(
    topology: &LandblockTopologyAsset,
) -> serde_json::Value {
    let items = topology
        .env_cells
        .iter()
        .map(|cell| {
            serde_json::json!({
                "envCellId": cell.env_cell_id,
                "memberId": format!("env-cell/{:08x}", cell.env_cell_id),
                "assetId": format_env_cell_asset_id(cell.env_cell_id),
                "source": "env-cell-placement",
            })
        })
        .collect::<Vec<_>>();
    let node_inputs = topology
        .env_cells
        .iter()
        .map(|cell| {
            let point = PreparedVec3 {
                x: cell.local_placement.origin.x,
                y: cell.local_placement.origin.z,
                z: if cell.local_placement.origin.y == 0.0 {
                    0.0
                } else {
                    -cell.local_placement.origin.y
                },
            };
            (
                holtburger_content::pad_bvh_bounds(PreparedAabb {
                    min: point,
                    max: point,
                }),
                1_u32,
            )
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "coordinateSpace": "landblock-topology-residency",
        "nodes": build_flat_bvh_nodes_from_bounds(node_inputs),
        "items": items,
    })
}

pub fn serialize_landblock_env_cell_bundle_bvh(
    bundle: &LandblockEnvCellsAsset,
) -> serde_json::Value {
    let nodes = bundle
        .landblock_bvh
        .as_ref()
        .map(|bvh| {
            bvh.nodes
                .iter()
                .map(serialize_prepared_bvh_node)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let items = bundle
        .landblock_bvh_items
        .iter()
        .map(|item| {
            serde_json::json!({
                "envCellId": item.env_cell_id,
                "memberId": item.member_id,
                "bounds": serialize_prepared_aabb(&item.bounds),
                "source": serialize_landblock_env_cell_bvh_item_source(item.source),
            })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "nodes": nodes,
        "items": items,
    })
}

pub fn serialize_landblock_env_cell_bvh_item_source(
    source: LandblockEnvCellBvhItemSource,
) -> &'static str {
    match source {
        LandblockEnvCellBvhItemSource::EnvCellRoot => "env-cell-root",
        LandblockEnvCellBvhItemSource::Derived => "derived",
    }
}

pub fn serialize_landblock_topology_portal_links(
    topology: &LandblockTopologyAsset,
) -> Vec<serde_json::Value> {
    serialize_landblock_portal_links(topology.landblock_id, &topology.env_cells)
}

pub fn serialize_landblock_env_cell_bundle_portal_links(
    bundle: &LandblockEnvCellsAsset,
) -> Vec<serde_json::Value> {
    let env_cells = bundle
        .env_cells
        .iter()
        .map(|cell| cell.env_cell.clone())
        .collect::<Vec<_>>();
    serialize_landblock_portal_links(bundle.landblock_id, &env_cells)
}

fn serialize_landblock_portal_links(
    landblock_id: u32,
    env_cells: &[EnvCellFact],
) -> Vec<serde_json::Value> {
    env_cells
        .iter()
        .flat_map(|cell| {
            cell.portals.iter().map(|portal| {
                serde_json::json!({
                    "linkId": portal.portal_id,
                    "source": {
                        "kind": "env-cell",
                        "envCellId": cell.env_cell_id,
                        "portalId": portal.portal_id,
                    },
                    "target": portal.target_env_cell_id.map(|target| {
                        serde_json::json!({
                            "kind": "env-cell",
                            "envCellId": target,
                            "portalId": format!("env-cell/{target:08x}/portal/{:04x}", portal.other_portal_id),
                        })
                    }).unwrap_or_else(|| {
                        serde_json::json!({
                            "kind": "outside",
                            "landblockId": landblock_id,
                        })
                    }),
                    "flags": portal.flags,
                    "otherCellId": portal.other_cell_id,
                    "otherPortalId": portal.other_portal_id,
                    "polygonId": portal.polygon_id,
                    "sourceIndex": portal.source_index,
                })
            })
        })
        .collect()
}

pub fn serialize_landblock_scene_env_cell_member(
    cell: &holtburger_content::EnvCellFact,
) -> serde_json::Value {
    serde_json::json!({
        "memberId": format!("env-cell/{:08x}", cell.env_cell_id),
        "envCellId": cell.env_cell_id,
        "assetId": format_env_cell_asset_id(cell.env_cell_id),
        "localPlacement": serialize_frame(&cell.local_placement),
        "visibleEnvCellIds": cell.visible_cell_ids,
        "restrictionObjectId": cell.restriction_object_id,
        "seenOutside": cell.seen_outside,
    })
}

pub fn serialize_env_cell_payload_with_geometry<F>(
    asset: &EnvCellAsset,
    region_id: u32,
    region_number: u32,
    render_geometry: serde_json::Value,
    mut serialize_aperture: F,
) -> serde_json::Value
where
    F: FnMut(usize, &PreparedPortalAperture) -> serde_json::Value,
{
    let cell = &asset.prepared_cell;
    let static_meshes = asset.static_meshes.iter().collect::<Vec<_>>();
    serde_json::json!({
        "kind": "env-cell",
        "residencyKind": "interior-cell",
        "sourceAssetKind": "env-cell",
        "envCellId": cell.env_cell_id,
        "regionId": region_id,
        "regionNumber": region_number,
        "environmentId": cell.environment_id,
        "cellStructureId": cell.cell_structure_id,
        "localPlacement": serialize_frame(&cell.local_placement),
        "surfaces": cell.surface_ids.iter().enumerate().map(|(index, surface_id)| {
            serde_json::json!({
                "slotId": index,
                "surfaceId": surface_id,
                "materialAssetId": format_material_asset_id(*surface_id),
            })
        }).collect::<Vec<_>>(),
        "portals": cell.portals.iter().map(|portal| {
            serde_json::json!({
                "portalId": portal.portal_id,
                "sourceIndex": portal.source_index,
                "flags": portal.flags,
                "polygonId": portal.polygon_id,
                "otherCellId": portal.other_cell_id,
                "otherPortalId": portal.other_portal_id,
                "targetEnvCellId": portal.target_env_cell_id,
                "isOutsideTransition": portal.is_outside_transition,
            })
        }).collect::<Vec<_>>(),
        "visibleEnvCellIds": asset.env_cell.visible_cell_ids,
        "portalApertures": cell.portal_apertures.iter().enumerate().map(|(index, aperture)| serialize_aperture(index, aperture)).collect::<Vec<_>>(),
        "statics": static_meshes.iter().map(|mesh| {
            serde_json::json!({
                "instanceId": mesh.instance_id,
                "sourceDid": mesh.source_did,
                "sourceAssetId": mesh.source_asset_id,
                "sourceIndex": mesh.source_index,
                "localPlacement": serialize_frame(&mesh.local_placement),
                "sourceScale": serialize_prepared_vec3(&mesh.source_scale),
                "sourceBounds": mesh.source_bounds.as_ref().map(serialize_prepared_aabb),
                "instanceBounds": mesh.instance_bounds.as_ref().map(serialize_prepared_aabb),
            })
        }).collect::<Vec<_>>(),
        "renderGeometry": render_geometry,
        "cellBsp": serialize_bsp_node(&cell.cell_bsp),
        "localBvh": serialize_env_cell_local_bvh(cell, &static_meshes),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "env-cell",
            "errorCode": asset.diagnostics.errors.first().map(|error| error.error_code),
            "detail": asset.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

pub fn serialize_landblock_env_cell_bundle_cell<F>(
    asset: &LandblockEnvCellBundleCell,
    render_geometry: serde_json::Value,
    mut serialize_aperture: F,
) -> serde_json::Value
where
    F: FnMut(usize, &PreparedPortalAperture) -> serde_json::Value,
{
    let cell = &asset.prepared_cell;
    let static_meshes = asset.static_meshes.iter().collect::<Vec<_>>();
    serde_json::json!({
        "envCellId": cell.env_cell_id,
        "memberId": format!("env-cell/{:08x}", cell.env_cell_id),
        "localPlacement": serialize_frame(&cell.local_placement),
        "environmentId": cell.environment_id,
        "cellStructureId": cell.cell_structure_id,
        "visibleEnvCellIds": asset.env_cell.visible_cell_ids,
        "restrictionObjectId": asset.env_cell.restriction_object_id,
        "seenOutside": asset.env_cell.seen_outside,
        "surfaces": cell.surface_ids.iter().enumerate().map(|(index, surface_id)| {
            serde_json::json!({
                "slotId": index,
                "surfaceId": surface_id,
                "materialAssetId": format_material_asset_id(*surface_id),
            })
        }).collect::<Vec<_>>(),
        "portals": cell.portals.iter().map(|portal| {
            serde_json::json!({
                "portalId": portal.portal_id,
                "sourceIndex": portal.source_index,
                "flags": portal.flags,
                "polygonId": portal.polygon_id,
                "otherCellId": portal.other_cell_id,
                "otherPortalId": portal.other_portal_id,
                "targetEnvCellId": portal.target_env_cell_id,
                "isOutsideTransition": portal.is_outside_transition,
            })
        }).collect::<Vec<_>>(),
        "portalApertures": cell.portal_apertures.iter().enumerate().map(|(index, aperture)| serialize_aperture(index, aperture)).collect::<Vec<_>>(),
        "statics": static_meshes.iter().map(|mesh| {
            serde_json::json!({
                "instanceId": mesh.instance_id,
                "sourceDid": mesh.source_did,
                "sourceAssetId": mesh.source_asset_id,
                "sourceIndex": mesh.source_index,
                "localPlacement": serialize_frame(&mesh.local_placement),
                "sourceScale": serialize_prepared_vec3(&mesh.source_scale),
            })
        }).collect::<Vec<_>>(),
        "renderGeometry": render_geometry,
        "cellBsp": serialize_bsp_node(&cell.cell_bsp),
        "diagnostics": serialize_prepared_content_diagnostics(&asset.diagnostics),
    })
}

pub fn serialize_env_cell_local_bvh(
    cell: &PreparedInteriorCell,
    static_meshes: &[&PreparedStaticMesh],
) -> serde_json::Value {
    let mut items = Vec::new();
    if cell.render_geometry.bounds.is_some() {
        items.push(serde_json::json!({
            "kind": "render-geometry",
            "polygonId": null,
            "triangleRange": [0, cell.render_geometry.triangle_count],
        }));
    }
    items.extend(
        static_meshes
            .iter()
            .filter(|mesh| mesh.instance_bounds.is_some())
            .map(|mesh| serde_json::json!({ "kind": "static", "instanceId": mesh.instance_id })),
    );
    items.extend(
        cell.portal_apertures
            .iter()
            .filter(|aperture| portal_aperture_bounds(aperture).is_some())
            .map(
                |aperture| serde_json::json!({ "kind": "portal", "portalId": aperture.portal_id }),
            ),
    );
    let mut node_inputs = Vec::new();
    if let Some(bounds) = cell.render_geometry.bounds {
        node_inputs.push((holtburger_content::pad_bvh_bounds(bounds), 1_u32));
    }
    node_inputs.extend(static_meshes.iter().filter_map(|mesh| {
        mesh.instance_bounds
            .map(|bounds| (holtburger_content::pad_bvh_bounds(bounds), 2_u32))
    }));
    node_inputs.extend(cell.portal_apertures.iter().filter_map(|aperture| {
        portal_aperture_bounds(aperture)
            .map(|bounds| (holtburger_content::pad_bvh_bounds(bounds), 4_u32))
    }));
    serde_json::json!({
        "coordinateSpace": "env-cell-local",
        "nodes": build_flat_bvh_nodes_from_bounds(node_inputs),
        "items": items,
    })
}

pub fn portal_aperture_bounds(aperture: &PreparedPortalAperture) -> Option<PreparedAabb> {
    aperture
        .points
        .iter()
        .copied()
        .fold(None, |bounds, point| Some(expand_bounds(bounds, point)))
}

pub fn serialize_terrain_material_payload(
    table: &ResolvedTerrainMaterialTable,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "terrain-material",
        "residencyKind": "unknown",
        "sourceAssetKind": "terrain-material",
        "regionNumber": table.region_number,
        "materialKind": "tex-merge-table",
        "terrainTypes": table.terrain_types.iter().map(|terrain| {
            serde_json::json!({
                "terrainType": terrain.terrain_type,
                "textureAssetId": format_surface_texture_asset_id(terrain.texture_id),
                "textureDid": terrain.texture_id,
                "tiling": terrain.tiling,
                "colorVariation": serde_json::json!({
                    "minVertBright": terrain.min_vert_bright,
                    "maxVertBright": terrain.max_vert_bright,
                    "minVertSaturate": terrain.min_vert_saturate,
                    "maxVertSaturate": terrain.max_vert_saturate,
                    "minVertHue": terrain.min_vert_hue,
                    "maxVertHue": terrain.max_vert_hue,
                    "activeRenderPath": false,
                }),
            })
        }).collect::<Vec<_>>(),
        "terrainAlphaMaps": table.terrain_alpha_maps.iter().map(|map| {
            serde_json::json!({
                "alphaIndex": map.alpha_index,
                "alphaTextureAssetId": format_surface_texture_asset_id(map.texture_id),
                "alphaTextureDid": map.texture_id,
                "selector": map.selector,
            })
        }).collect::<Vec<_>>(),
        "roadAlphaMaps": table.road_alpha_maps.iter().map(|map| {
            serde_json::json!({
                "roadIndex": map.road_index,
                "roadTextureAssetId": format_surface_texture_asset_id(map.road_texture_id),
                "roadTextureDid": map.road_texture_id,
                "alphaTextureAssetId": format_surface_texture_asset_id(map.alpha_texture_id),
                "alphaTextureDid": map.alpha_texture_id,
                "selector": map.selector,
            })
        }).collect::<Vec<_>>(),
        "pcodeEncoding": {
            "terrainCodeBits": 5,
            "roadCodeBits": 2,
            "sizeBitMask": 1 << 28,
        },
        "dependencies": {
            "surfaceTextureAssetIds": table.surface_texture_ids.iter().map(|id| format_surface_texture_asset_id(*id)).collect::<Vec<_>>(),
            "renderSurfaceAssetIds": [],
            "paletteAssetIds": [],
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "terrain-material",
            "errorCode": null,
            "detail": null
        }
    })
}

pub fn serialize_region_render_profile_payload(
    profile: &ResolvedRegionRenderProfile,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "region-render-profile",
        "residencyKind": "unknown",
        "sourceAssetKind": "region-render-profile",
        "regionId": profile.region_id,
        "regionNumber": profile.region_number,
        "detailRoles": {
            "landscape": serialize_detail_role(profile, ResolvedRegionDetailRoleKind::Landscape),
            "building": serialize_detail_role(profile, ResolvedRegionDetailRoleKind::Building),
            "environment": serialize_detail_role(profile, ResolvedRegionDetailRoleKind::Environment),
            "object": serialize_detail_role(profile, ResolvedRegionDetailRoleKind::Object),
        },
        "dependencies": {
            "surfaceTextureAssetIds": profile.surface_texture_ids.iter().map(|id| format_surface_texture_asset_id(*id)).collect::<Vec<_>>(),
            "renderSurfaceAssetIds": [],
            "paletteAssetIds": [],
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "region-render-profile",
            "errorCode": null,
            "detail": null
        }
    })
}

fn serialize_detail_role(
    profile: &ResolvedRegionRenderProfile,
    role: ResolvedRegionDetailRoleKind,
) -> serde_json::Value {
    profile
        .detail_roles
        .iter()
        .find(|entry| entry.role == role)
        .and_then(|entry| {
            (entry.detail_texture_id != 0).then(|| {
                serde_json::json!({
                    "role": region_detail_role_name(entry.role),
                    "sourceTerrainDescIndex": entry.source_terrain_desc_index,
                    "textureAssetId": format_surface_texture_asset_id(entry.detail_texture_id),
                    "textureDid": entry.detail_texture_id,
                    "tiling": entry.detail_tiling,
                    "fadeNear": RETAIL_DETAIL_FADE_NEAR,
                    "fadeFar": RETAIL_DETAIL_FADE_FAR,
                })
            })
        })
        .unwrap_or(serde_json::Value::Null)
}

fn region_detail_role_name(role: ResolvedRegionDetailRoleKind) -> &'static str {
    match role {
        ResolvedRegionDetailRoleKind::Landscape => "landscape",
        ResolvedRegionDetailRoleKind::Building => "building",
        ResolvedRegionDetailRoleKind::Environment => "environment",
        ResolvedRegionDetailRoleKind::Object => "object",
    }
}

pub fn serialize_prepared_bvh_node(node: &PreparedBvhNode) -> serde_json::Value {
    serde_json::json!({
        "bounds": serialize_prepared_aabb(&node.bounds),
        "left": node.left,
        "right": node.right,
        "itemIndices": node.item_indices,
        "kindMask": serialize_prepared_bvh_kind_mask(node.kind_mask),
    })
}

pub fn serialize_prepared_bvh_kind_mask(mask: PreparedBvhKindMask) -> serde_json::Value {
    match mask {
        PreparedBvhKindMask::OutdoorTerrain { terrain_quad } => serde_json::json!({
            "domain": "outdoor-terrain",
            "terrainQuad": terrain_quad,
        }),
        PreparedBvhKindMask::OutdoorStatic {
            static_object,
            building,
        } => serde_json::json!({
            "domain": "outdoor-static",
            "static": static_object,
            "building": building,
        }),
        PreparedBvhKindMask::LandblockEnvCells { env_cell_root } => serde_json::json!({
            "domain": "landblock-env-cells",
            "envCellRoot": env_cell_root,
        }),
        PreparedBvhKindMask::EnvCellLocal {
            cell_structure_geometry,
            static_object,
            portal,
        } => serde_json::json!({
            "domain": "env-cell-local",
            "cellStructureGeometry": cell_structure_geometry,
            "static": static_object,
            "portal": portal,
        }),
    }
}

pub fn serialize_prepared_portal_aperture_plane(
    plane: &PreparedPortalAperturePlane,
) -> serde_json::Value {
    serde_json::json!({
        "normal": serialize_prepared_vec3(&plane.normal),
        "constant": plane.constant,
        "source": serialize_prepared_portal_aperture_plane_source(plane.source),
    })
}

pub fn serialize_prepared_portal_aperture_plane_source(
    source: PreparedPortalAperturePlaneSource,
) -> &'static str {
    match source {
        PreparedPortalAperturePlaneSource::DrawingBspPortal => "drawing-bsp-portal",
        PreparedPortalAperturePlaneSource::DerivedFromRenderPoints => "derived-from-render-points",
    }
}

pub fn serialize_prepared_polygon_set_invalid_polygon(
    polygon: &PreparedPolygonSetInvalidPolygon,
) -> serde_json::Value {
    serde_json::json!({
        "polygonId": polygon.polygon_id,
        "reason": polygon.reason,
        "vertexIds": polygon.vertex_ids,
        "missingVertexIds": polygon.missing_vertex_ids,
    })
}

pub fn serialize_prepared_aabb(bounds: &PreparedAabb) -> serde_json::Value {
    serde_json::json!({
        "min": serialize_prepared_vec3(&bounds.min),
        "max": serialize_prepared_vec3(&bounds.max),
    })
}

pub fn serialize_bounds(bounds: PreparedAabb) -> serde_json::Value {
    serialize_prepared_aabb(&bounds)
}

pub fn serialize_prepared_vec3(vector: &PreparedVec3) -> serde_json::Value {
    serde_json::json!({
        "x": vector.x,
        "y": vector.y,
        "z": vector.z,
    })
}

pub fn serialize_landblock_classification(classification: LandblockClassification) -> &'static str {
    match classification {
        LandblockClassification::Outdoor => "outdoor",
        LandblockClassification::Dungeon => "dungeon",
    }
}

pub fn format_gfx_obj_asset_id(gfx_obj_id: u32) -> String {
    format!("gfx-obj/{gfx_obj_id:08x}")
}

pub fn format_animation_asset_id(animation_id: u32) -> String {
    format!("animation/{animation_id:08x}")
}

pub fn format_env_cell_asset_id(env_cell_id: u32) -> String {
    format!("env-cell/{env_cell_id:08x}")
}

pub fn format_material_asset_id(surface_id: u32) -> String {
    format!("material/{surface_id:08x}")
}

pub fn format_surface_texture_asset_id(surface_texture_id: u32) -> String {
    format!("surface-texture/{surface_texture_id:08x}")
}

pub fn format_render_surface_asset_id(render_surface_id: u32) -> String {
    format!("render-surface/{render_surface_id:08x}")
}

pub fn format_palette_asset_id(palette_id: u32) -> String {
    format!("palette/{palette_id:08x}")
}

pub fn recipe_palette_asset_ids(
    texture: &holtburger_content::ResolvedTextureMaterial,
) -> Vec<String> {
    let mut palette_ids = texture
        .palette_id
        .into_iter()
        .chain(texture.render_surface_default_palette_ids.iter().copied())
        .map(format_palette_asset_id)
        .collect::<Vec<_>>();
    palette_ids.sort();
    palette_ids.dedup();
    palette_ids
}

pub fn serialize_prepared_content_diagnostics(
    diagnostics: &PreparedContentSourceDiagnostics,
) -> serde_json::Value {
    serde_json::json!({
        "sourceRecords": diagnostics.source_records.iter().map(serialize_source_record_diagnostic).collect::<Vec<_>>(),
        "omissions": diagnostics.omissions.iter().map(serialize_source_omission_diagnostic).collect::<Vec<_>>(),
        "errors": diagnostics.errors.iter().map(serialize_source_load_error).collect::<Vec<_>>(),
    })
}

pub fn serialize_source_record_diagnostic(
    diagnostic: &SourceRecordDiagnostic,
) -> serde_json::Value {
    serde_json::json!({
        "namespace": diagnostic.namespace,
        "fileId": diagnostic.file_id,
        "role": diagnostic.role,
        "status": serialize_source_record_status(diagnostic.status),
    })
}

pub fn serialize_source_omission_diagnostic(
    diagnostic: &SourceOmissionDiagnostic,
) -> serde_json::Value {
    serde_json::json!({
        "namespace": diagnostic.namespace,
        "fileId": diagnostic.file_id,
        "role": diagnostic.role,
        "reason": diagnostic.reason,
        "detail": diagnostic.detail,
    })
}

pub fn serialize_source_record_status(status: SourceRecordStatus) -> &'static str {
    match status {
        SourceRecordStatus::Loaded => "loaded",
        SourceRecordStatus::Missing => "missing",
        SourceRecordStatus::DecodeFailed => "decode-failed",
    }
}

pub fn serialize_source_load_error(error: &SourceLoadError) -> serde_json::Value {
    serde_json::json!({
        "namespace": error.namespace,
        "fileId": error.file_id,
        "role": error.role,
        "errorCode": error.error_code,
        "detail": error.detail,
    })
}

pub fn serialize_vector3(vector: &Vector3) -> serde_json::Value {
    serde_json::json!({
        "x": vector.x,
        "y": vector.y,
        "z": vector.z,
    })
}

pub fn serialize_quaternion(quaternion: &Quaternion) -> serde_json::Value {
    serde_json::json!({
        "w": quaternion.w,
        "x": quaternion.x,
        "y": quaternion.y,
        "z": quaternion.z,
    })
}

pub fn serialize_frame(frame: &holtburger_dat::graphics::Frame) -> serde_json::Value {
    serde_json::json!({
        "origin": serialize_vector3(&frame.origin),
        "orientation": serialize_quaternion(&frame.orientation),
    })
}

pub fn serialize_sphere(sphere: &holtburger_common::Sphere) -> serde_json::Value {
    serde_json::json!({
        "center": serialize_vector3(&sphere.center),
        "radius": sphere.radius,
    })
}

pub fn serialize_setup_model_parts(setup_model: &SetupModel) -> Vec<serde_json::Value> {
    setup_model
        .parts
        .iter()
        .enumerate()
        .map(|(index, gfx_obj_id)| {
            serde_json::json!({
                "partIndex": index,
                "gfxObjId": gfx_obj_id,
                "gfxObjAssetId": format_gfx_obj_asset_id(*gfx_obj_id),
                "parentIndex": setup_model.parent_index.get(index).copied(),
                "scale": setup_model.default_scale.get(index).map(serialize_vector3),
            })
        })
        .collect()
}

pub fn serialize_location_map(
    locations: &std::collections::HashMap<
        i32,
        holtburger_dat::file_type::setup_model::LocationType,
    >,
) -> Vec<serde_json::Value> {
    let mut entries = locations.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(key, _)| **key);
    entries
        .into_iter()
        .map(|(key, location)| {
            serde_json::json!({
                "key": key,
                "partId": location.part_id,
                "localPlacement": serialize_frame(&location.frame),
            })
        })
        .collect()
}

pub fn serialize_placement_sets(setup_model: &SetupModel) -> Vec<serde_json::Value> {
    let mut entries = setup_model.placement_frames.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(key, _)| **key);
    entries
        .into_iter()
        .map(|(key, placement)| {
            serde_json::json!({
                "key": key,
                "localPlacements": placement
                    .anim_frame
                    .frames
                    .iter()
                    .map(serialize_frame)
                    .collect::<Vec<_>>(),
                "hookCount": placement.anim_frame.hooks.len(),
                "textureVelocities": serialize_texture_velocity_hooks(&placement.anim_frame.hooks),
            })
        })
        .collect()
}

fn serialize_texture_velocity_hooks(
    hooks: &[holtburger_dat::file_type::setup_model::AnimationHook],
) -> Vec<serde_json::Value> {
    hooks
        .iter()
        .filter_map(|hook| match hook.payload {
            AnimationHookPayload::TextureVelocity(payload) => Some(serde_json::json!({
                "kind": "all-parts",
                "uSpeed": payload.u_speed,
                "vSpeed": payload.v_speed,
            })),
            AnimationHookPayload::TextureVelocityPart(payload) => Some(serde_json::json!({
                "kind": "part",
                "partIndex": payload.part_index,
                "uSpeed": payload.u_speed,
                "vSpeed": payload.v_speed,
            })),
            _ => None,
        })
        .collect()
}

fn serialize_animation_hook(
    hook: &holtburger_dat::file_type::setup_model::AnimationHook,
) -> serde_json::Value {
    let (payload_kind, payload, raw_payload_bytes) = match &hook.payload {
        AnimationHookPayload::NoPayload => ("none", serde_json::Value::Null, None),
        AnimationHookPayload::Raw(bytes) => (
            "raw",
            serde_json::Value::Null,
            Some(bytes.iter().map(|byte| *byte as u32).collect::<Vec<_>>()),
        ),
        AnimationHookPayload::ReplaceObject(bytes) => (
            "replace-object",
            serde_json::Value::Null,
            Some(bytes.iter().map(|byte| *byte as u32).collect::<Vec<_>>()),
        ),
        AnimationHookPayload::TextureVelocity(payload) => (
            "texture-velocity",
            serde_json::json!({
                "uSpeed": payload.u_speed,
                "vSpeed": payload.v_speed,
            }),
            None,
        ),
        AnimationHookPayload::TextureVelocityPart(payload) => (
            "texture-velocity-part",
            serde_json::json!({
                "partIndex": payload.part_index,
                "uSpeed": payload.u_speed,
                "vSpeed": payload.v_speed,
            }),
            None,
        ),
    };

    serde_json::json!({
        "hookType": hook.hook_type,
        "hookName": animation_hook_name(hook.hook_type),
        "direction": hook.direction,
        "directionName": animation_hook_direction_name(hook.direction),
        "payloadKind": payload_kind,
        "payload": payload,
        "rawPayloadBytes": raw_payload_bytes,
    })
}

fn animation_hook_name(hook_type: u32) -> &'static str {
    match hook_type {
        0 => "NoOp",
        1 => "Sound",
        2 => "SoundTable",
        3 => "Attack",
        4 => "AnimationDone",
        5 => "ReplaceObject",
        6 => "Ethereal",
        7 => "TransparentPart",
        8 => "Luminous",
        9 => "LuminousPart",
        10 => "Diffuse",
        11 => "DiffusePart",
        12 => "Scale",
        13 => "CreateParticle",
        14 => "DestroyParticle",
        15 => "StopParticle",
        16 => "NoDraw",
        17 => "DefaultScript",
        18 => "DefaultScriptPart",
        19 => "CallPES",
        20 => "Transparent",
        21 => "SoundTweaked",
        22 => "SetOmega",
        23 => "TextureVelocity",
        24 => "TextureVelocityPart",
        25 => "SetLight",
        26 => "CreateBlockingParticle",
        _ => "Unknown",
    }
}

fn animation_hook_direction_name(direction: i32) -> &'static str {
    match direction {
        -1 => "Backward",
        0 => "Both",
        1 => "Forward",
        _ => "Unknown",
    }
}

pub fn serialize_lights(
    lights: &std::collections::HashMap<i32, holtburger_dat::file_type::setup_model::LightInfo>,
) -> Vec<serde_json::Value> {
    let mut entries = lights.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(key, _)| **key);
    entries
        .into_iter()
        .map(|(key, light)| {
            serde_json::json!({
                "key": key,
                "viewerSpaceLocation": serialize_frame(&light.viewer_space_location),
                "color": light.color,
                "intensity": light.intensity,
                "falloff": light.falloff,
                "coneAngle": light.cone_angle,
            })
        })
        .collect()
}

pub fn serialize_bsp_node(node: &BspNode) -> serde_json::Value {
    match node {
        BspNode::Port(portal) => serde_json::json!({
            "kind": "port",
            "plane": {
                "normal": serialize_vector3(&portal.plane.normal),
                "d": portal.plane.d,
            },
            "pos": serialize_bsp_node(&portal.pos),
            "neg": serialize_bsp_node(&portal.neg),
            "sphere": portal.sphere.as_ref().map(|sphere| {
                serde_json::json!({
                    "center": serialize_vector3(&sphere.center),
                    "radius": sphere.radius,
                })
            }),
            "polyIds": portal.poly_ids,
            "portalPolys": portal.portal_polys.iter().map(|portal_poly| {
                serde_json::json!({
                    "portalIndex": portal_poly.portal_index,
                    "polyId": portal_poly.poly_id,
                })
            }).collect::<Vec<_>>(),
        }),
        BspNode::Leaf(leaf) => serde_json::json!({
            "kind": "leaf",
            "index": leaf.index,
            "solid": leaf.solid,
            "sphere": leaf.sphere.as_ref().map(|sphere| {
                serde_json::json!({
                    "center": serialize_vector3(&sphere.center),
                    "radius": sphere.radius,
                })
            }),
            "polyIds": leaf.poly_ids,
        }),
        BspNode::Internal(internal) => serde_json::json!({
            "kind": "internal",
            "tag": std::str::from_utf8(&internal.tag).unwrap_or("????"),
            "plane": {
                "normal": serialize_vector3(&internal.plane.normal),
                "d": internal.plane.d,
            },
            "pos": internal.pos.as_ref().map(|pos| serialize_bsp_node(pos)),
            "neg": internal.neg.as_ref().map(|neg| serialize_bsp_node(neg)),
            "sphere": internal.sphere.as_ref().map(|sphere| {
                serde_json::json!({
                    "center": serialize_vector3(&sphere.center),
                    "radius": sphere.radius,
                })
            }),
            "polyIds": internal.poly_ids,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::{
        CellLandblockFact, LandblockOutdoorAsset, LandblockOutdoorStaticMember, PreparedAabb,
        PreparedBuildingTransitionAperture, PreparedBvh, PreparedBvhNode,
        PreparedContentSourceDiagnostics, PreparedStaticInstance, PreparedStaticInstanceKind,
        PreparedTerrainMesh, PreparedVec3,
    };

    #[test]
    fn terrain_pcode_packs_southwest_to_northwest_order_used_by_texmerge_pal_codes() {
        let pcode = terrain_pcode([1, 2, 3, 0], [4, 5, 6, 7]);

        assert_eq!((pcode >> 26) & 0x03, 1);
        assert_eq!((pcode >> 24) & 0x03, 2);
        assert_eq!((pcode >> 22) & 0x03, 3);
        assert_eq!((pcode >> 20) & 0x03, 0);
        assert_eq!((pcode >> 15) & 0x1f, 4);
        assert_eq!((pcode >> 10) & 0x1f, 5);
        assert_eq!((pcode >> 5) & 0x1f, 6);
        assert_eq!(pcode & 0x1f, 7);
    }

    fn dummy_static_instance(id: &str, kind: PreparedStaticInstanceKind) -> PreparedStaticInstance {
        PreparedStaticInstance {
            instance_id: id.to_string(),
            kind,
            owning_landblock_id: 1,
            owning_env_cell_id: None,
            source_asset_id: "".to_string(),
            source_did: 0,
            source_index: 0,
            local_placement: holtburger_dat::graphics::Frame {
                origin: holtburger_common::math::Vector3 {
                    x: 0.,
                    y: 0.,
                    z: 0.,
                },
                orientation: holtburger_common::math::Quaternion {
                    w: 1.,
                    x: 0.,
                    y: 0.,
                    z: 0.,
                },
            },
            source_scale: PreparedVec3 {
                x: 1.,
                y: 1.,
                z: 1.,
            },
        }
    }

    #[test]
    fn landblock_env_cell_bundle_frame_remains_ac_frame() {
        let frame = holtburger_dat::graphics::Frame {
            origin: holtburger_common::math::Vector3 {
                x: 1.,
                y: 2.,
                z: 3.,
            },
            orientation: holtburger_common::math::Quaternion {
                w: 1.,
                x: 0.,
                y: 0.,
                z: 0.,
            },
        };

        let payload = serialize_landblock_env_cell_bundle_cell(
            &LandblockEnvCellBundleCell {
                diagnostics: PreparedContentSourceDiagnostics::default(),
                env_cell: EnvCellFact {
                    cell_structure_id: Some(0x0d000001),
                    env_cell_id: 0xda550100,
                    environment_id: Some(0x0d000001),
                    local_placement: frame.clone(),
                    portals: Vec::new(),
                    restriction_object_id: None,
                    seen_outside: Some(false),
                    static_objects: Vec::new(),
                    surface_ids: Vec::new(),
                    visible_cell_ids: Vec::new(),
                },
                landblock_bounds: None,
                prepared_cell: PreparedInteriorCell {
                    cell_bsp: empty_bsp_leaf(),
                    cell_structure_id: 0x0d000001,
                    env_cell_id: 0xda550100,
                    environment_id: 0x0d000001,
                    local_placement: frame,
                    portal_apertures: Vec::new(),
                    render_geometry: PreparedPolygonSetRenderGeometry {
                        bounds: None,
                        invalid_polygons: Vec::new(),
                        normals: Vec::new(),
                        positions: Vec::new(),
                        skipped_polygon_count: 0,
                        source_id: 0x0d000001,
                        surface_ids: Vec::new(),
                        triangle_count: 0,
                        triangles: Vec::new(),
                        uvs: Vec::new(),
                        vertex_count: 0,
                    },
                    surface_ids: Vec::new(),
                    portals: Vec::new(),
                    static_object_count: 0,
                },
                static_meshes: Vec::new(),
            },
            serde_json::json!({ "positions": [], "normals": [], "uvs": [] }),
            |_index, _aperture| serde_json::json!({}),
        );

        assert_close(
            payload
                .pointer("/localPlacement/origin/x")
                .and_then(serde_json::Value::as_f64),
            1.,
        );
        assert_close(
            payload
                .pointer("/localPlacement/origin/y")
                .and_then(serde_json::Value::as_f64),
            2.,
        );
        assert_close(
            payload
                .pointer("/localPlacement/origin/z")
                .and_then(serde_json::Value::as_f64),
            3.,
        );
        assert_close(
            payload
                .pointer("/localPlacement/orientation/w")
                .and_then(serde_json::Value::as_f64),
            1.,
        );
        assert_close(
            payload
                .pointer("/localPlacement/orientation/x")
                .and_then(serde_json::Value::as_f64),
            0.,
        );
        assert_close(
            payload
                .pointer("/localPlacement/orientation/y")
                .and_then(serde_json::Value::as_f64),
            0.,
        );
        assert_close(
            payload
                .pointer("/localPlacement/orientation/z")
                .and_then(serde_json::Value::as_f64),
            0.,
        );
    }

    fn empty_bsp_leaf() -> BspNode {
        BspNode::Leaf(holtburger_dat::physics::BspLeaf {
            index: 0,
            poly_ids: Vec::new(),
            solid: 0,
            sphere: None,
        })
    }

    fn assert_close(actual: Option<f64>, expected: f64) {
        let actual = actual.expect("expected numeric JSON field");
        assert!(
            (actual - expected).abs() < 1e-6,
            "expected {actual} to be close to {expected}",
        );
    }

    #[test]
    fn test_serialize_landblock_outdoor_bvh_items_are_filtered_and_sorted() {
        let dummy_bounds = PreparedAabb {
            min: PreparedVec3 {
                x: 0.,
                y: 0.,
                z: 0.,
            },
            max: PreparedVec3 {
                x: 1.,
                y: 1.,
                z: 1.,
            },
        };
        let statics = vec![
            LandblockOutdoorStaticMember {
                instance: dummy_static_instance("c", PreparedStaticInstanceKind::Scenery),
                source_bounds: None,
                instance_bounds: Some(dummy_bounds),
                building: None,
                generated: None,
            },
            LandblockOutdoorStaticMember {
                instance: dummy_static_instance("a", PreparedStaticInstanceKind::Building),
                source_bounds: None,
                instance_bounds: None, // This one should be filtered out!
                building: None,
                generated: None,
            },
            LandblockOutdoorStaticMember {
                instance: dummy_static_instance("b", PreparedStaticInstanceKind::Scenery),
                source_bounds: None,
                instance_bounds: Some(dummy_bounds),
                building: None,
                generated: None,
            },
        ];

        let outdoor = LandblockOutdoorAsset {
            landblock_id: 1,
            cell_landblock: Some(CellLandblockFact {
                id: 1,
                has_objects: false,
                grid_size: 1,
                tile_size: 1.,
                terrain_types: vec![],
                heights: vec![],
                min_height: 0.,
                max_height: 0.,
                all_heights_zero: true,
            }),
            terrain_mesh: Some(PreparedTerrainMesh {
                landblock_id: 1,
                grid_size: 1,
                tile_size: 1.,
                vertices: vec![],
                triangles: vec![],
                quads: vec![],
                terrain_bvh_items: vec![],
                terrain_bvh: None,
                min_height: 0.,
                max_height: 0.,
            }),
            statics,
            building_transition_apertures: Vec::new(),
            outdoor_bvh: Some(PreparedBvh {
                coordinate_space: "test",
                landblock_id: 1,
                scope: PreparedBvhScope::OutdoorStatic,
                nodes: vec![],
            }),
            diagnostics: PreparedContentSourceDiagnostics::default(),
        };

        let result = serialize_landblock_outdoor_bvh(&outdoor);
        let items = result
            .get("items")
            .expect("has items")
            .as_array()
            .expect("items is array");

        // The array should be filtered (length 2) and sorted by instance_id (b then c).
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].get("instanceId").unwrap().as_str().unwrap(), "b");
        assert_eq!(items[1].get("instanceId").unwrap().as_str().unwrap(), "c");
    }

    #[test]
    fn serialize_landblock_outdoor_preserves_source_owned_overhanging_static_space() {
        let source_landblock_id = 0x0203ffff;
        let instance_bounds = PreparedAabb {
            min: PreparedVec3 {
                x: 199.,
                y: 1.,
                z: 3.,
            },
            max: PreparedVec3 {
                x: 201.,
                y: 3.,
                z: 7.,
            },
        };
        let mut instance = dummy_static_instance("overhang", PreparedStaticInstanceKind::Scenery);
        instance.owning_landblock_id = source_landblock_id;
        instance.local_placement.origin = holtburger_common::math::Vector3 {
            x: 200.,
            y: -5.,
            z: 2.,
        };

        let outdoor = LandblockOutdoorAsset {
            landblock_id: source_landblock_id,
            cell_landblock: None,
            terrain_mesh: None,
            statics: vec![LandblockOutdoorStaticMember {
                instance,
                source_bounds: None,
                instance_bounds: Some(instance_bounds),
                building: None,
                generated: None,
            }],
            building_transition_apertures: vec![PreparedBuildingTransitionAperture {
                aperture_id: "building-transition-aperture:overhang:0".to_string(),
                building_instance_id: "overhang".to_string(),
                source_did: 0x0200_1234,
                source_asset_id: "gfxobj/02001234".to_string(),
                portal_index: 0,
                poly_id: 42,
                building_portal_id: "building-portal-0".to_string(),
                building_portal_source_index: 0,
                flags: 0x0001,
                other_cell_id: 0x0100,
                other_portal_id: 0xffff,
                linked_env_cell_ids: vec![0x0102_0100],
                points: vec![
                    PreparedVec3 {
                        x: 0.,
                        y: 0.,
                        z: 0.,
                    },
                    PreparedVec3 {
                        x: 1.,
                        y: 0.,
                        z: 0.,
                    },
                    PreparedVec3 {
                        x: 0.,
                        y: 1.,
                        z: 0.,
                    },
                ],
            }],
            outdoor_bvh: Some(PreparedBvh {
                coordinate_space: "landblock-render-local",
                landblock_id: source_landblock_id,
                scope: PreparedBvhScope::OutdoorStatic,
                nodes: vec![PreparedBvhNode {
                    bounds: instance_bounds,
                    left: None,
                    right: None,
                    item_indices: vec![0],
                    kind_mask: PreparedBvhKindMask::OutdoorStatic {
                        static_object: true,
                        building: false,
                    },
                }],
            }),
            diagnostics: PreparedContentSourceDiagnostics::default(),
        };

        let payload = serialize_landblock_outdoor_payload_with_terrain(
            &outdoor,
            0,
            0,
            serde_json::Value::Null,
        );

        assert_eq!(
            payload
                .get("landblockId")
                .and_then(serde_json::Value::as_u64),
            Some(source_landblock_id as u64)
        );

        let aperture = payload
            .get("buildingTransitionApertures")
            .and_then(serde_json::Value::as_array)
            .and_then(|apertures| apertures.first())
            .expect("serialized payload should include building transition apertures");
        assert_eq!(
            aperture.pointer("/buildingInstanceId"),
            Some(&serde_json::Value::String("overhang".to_string()))
        );
        assert_eq!(
            aperture
                .pointer("/polyId")
                .and_then(serde_json::Value::as_u64),
            Some(42)
        );
        assert_eq!(
            aperture
                .pointer("/linkedEnvCellIds/0")
                .and_then(serde_json::Value::as_u64),
            Some(0x0102_0100)
        );
        assert_eq!(
            aperture
                .pointer("/points")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len),
            Some(3)
        );

        let static_member = payload
            .get("statics")
            .and_then(serde_json::Value::as_array)
            .and_then(|statics| statics.first())
            .expect("serialized payload should include the overhanging static");
        let local_origin = static_member
            .pointer("/localPlacement/origin")
            .expect("static member should include local placement origin");

        assert_eq!(
            local_origin.get("x").and_then(serde_json::Value::as_f64),
            Some(200.)
        );
        assert_eq!(
            local_origin.get("y").and_then(serde_json::Value::as_f64),
            Some(-5.)
        );
        assert_eq!(
            local_origin.get("z").and_then(serde_json::Value::as_f64),
            Some(2.)
        );
        assert_eq!(
            static_member
                .pointer("/instanceBounds/min/x")
                .and_then(serde_json::Value::as_f64),
            Some(199.)
        );
        assert_eq!(
            static_member
                .pointer("/instanceBounds/min/z")
                .and_then(serde_json::Value::as_f64),
            Some(3.)
        );

        let outdoor_bvh = payload
            .get("outdoorBvh")
            .expect("serialized payload should include outdoor BVH");
        assert_eq!(
            outdoor_bvh
                .get("coordinateSpace")
                .and_then(serde_json::Value::as_str),
            Some("landblock-render-local")
        );
        assert_eq!(
            outdoor_bvh
                .pointer("/items/0/instanceId")
                .and_then(serde_json::Value::as_str),
            Some("overhang")
        );
        assert_eq!(
            outdoor_bvh
                .pointer("/nodes/0/bounds/min/x")
                .and_then(serde_json::Value::as_f64),
            Some(199.)
        );
        assert_eq!(
            outdoor_bvh
                .pointer("/nodes/0/bounds/min/z")
                .and_then(serde_json::Value::as_f64),
            Some(3.)
        );
        assert_eq!(
            outdoor_bvh
                .pointer("/nodes/0/itemIndices/0")
                .and_then(serde_json::Value::as_u64),
            Some(0)
        );
    }
}
