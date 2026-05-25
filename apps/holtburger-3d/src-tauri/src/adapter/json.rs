use crate::adapter::binary::{BinaryAssetSectionWriter, serialize_landblock_terrain_binary};
use crate::adapter::service::asset_cache_error_code;
use holtburger_common::math::{Quaternion, Vector3};
use holtburger_content::*;
use holtburger_dat::file_type::setup_model::AnimationHookPayload;
use holtburger_dat::file_type::{Palette, RenderSurface, SetupModel};
use holtburger_dat::physics::BspNode;

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

pub fn serialize_material_recipe_payload(recipe: &ResolvedMaterialRecipe) -> serde_json::Value {
    let (source, dependencies) = match &recipe.source {
        ResolvedMaterialSource::SolidColor(color) => (
            serde_json::json!({
                "kind": "solid-color",
                "argb": color,
            }),
            serde_json::json!({
                "renderTextureAssetIds": [],
                "renderSurfaceAssetIds": [],
                "paletteAssetIds": [],
            }),
        ),
        ResolvedMaterialSource::Texture(texture) => (
            serde_json::json!({
                "kind": "texture",
                "renderTextureId": texture.render_texture_id,
                "renderSurfaceIds": texture.render_surface_ids,
                "paletteId": texture.palette_id,
                "renderSurfaceDefaultPaletteIds": texture.render_surface_default_palette_ids,
            }),
            serde_json::json!({
                "renderTextureAssetIds": [format_render_texture_asset_id(texture.render_texture_id)],
                "renderSurfaceAssetIds": texture.render_surface_ids.iter().map(|id| format_render_surface_asset_id(*id)).collect::<Vec<_>>(),
                "paletteAssetIds": recipe_palette_asset_ids(texture),
            }),
        ),
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

pub fn serialize_render_texture_payload(
    render_texture: &ResolvedRenderTexture,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "render-texture",
        "residencyKind": "unknown",
        "sourceAssetKind": "render-texture",
        "renderTextureId": render_texture.render_texture_id,
        "textureType": render_texture.texture_type,
        "unknown": render_texture.unknown,
        "renderSurfaceIds": render_texture.render_surface_ids,
        "dependencies": {
            "renderSurfaceAssetIds": render_texture.render_surface_ids.iter().map(|id| format_render_surface_asset_id(*id)).collect::<Vec<_>>(),
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "render-texture",
            "errorCode": null,
            "detail": null
        }
    })
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
            "renderTextureAssetIds": [],
            "renderSurfaceAssetIds": [],
            "paletteAssetIds": [],
        },
        "provenance": failed_provenance("terrain-material", error_code, &detail),
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
    let quads = terrain_asset
        .cell_landblock
        .as_ref()
        .map(|cell| build_landblock_terrain_quads(mesh, cell))
        .unwrap_or_default();
    let terrain_bvh_items = quads
        .iter()
        .map(|quad| {
            serde_json::json!({
                "row": quad.row,
                "col": quad.col,
                "quadIndex": quad.quad_index,
                "triangleIndices": quad.triangle_indices,
            })
        })
        .collect::<Vec<_>>();
    let terrain_bvh_nodes =
        build_flat_bvh_nodes_from_bounds(quads.iter().map(|quad| (quad.bounds, 1_u32)).collect());
    serde_json::json!({
        "gridSize": mesh.grid_size,
        "tileSize": mesh.tile_size,
        "vertices": mesh.vertices.iter().map(serialize_prepared_vec3).collect::<Vec<_>>(),
        "triangles": build_landblock_terrain_triangles(mesh).iter().map(serialize_landblock_terrain_triangle).collect::<Vec<_>>(),
        "quads": quads.iter().map(serialize_landblock_terrain_quad).collect::<Vec<_>>(),
        "terrainBvh": {
            "coordinateSpace": "landblock-outdoor-terrain-local",
            "nodes": terrain_bvh_nodes,
            "items": terrain_bvh_items,
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
pub struct SerializedTerrainQuad {
    pub terrain_quad_id: String,
    pub row: usize,
    pub col: usize,
    pub quad_index: usize,
    pub source_terrain_indices: [usize; 4],
    pub vertex_indices: [usize; 4],
    pub triangle_indices: [usize; 2],
    pub diagonal: &'static str,
    pub corner_terrain_codes: [u32; 4],
    pub pcode: u32,
    pub average_height: f32,
    pub bounds: PreparedAabb,
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

pub fn build_landblock_terrain_quads(
    mesh: &PreparedTerrainMesh,
    cell: &holtburger_content::CellLandblockFact,
) -> Vec<SerializedTerrainQuad> {
    if mesh.grid_size < 2 {
        return Vec::new();
    }
    let quad_width = mesh.grid_size - 1;
    let mut normalized_terrain = Vec::with_capacity(cell.terrain_types.len());
    for row in 0..mesh.grid_size {
        for col in 0..mesh.grid_size {
            let source_index = col * mesh.grid_size + row;
            normalized_terrain.push(*cell.terrain_types.get(source_index).unwrap_or(&0));
        }
    }
    let mut quads = Vec::with_capacity(quad_width * quad_width);
    for row in 0..quad_width {
        for col in 0..quad_width {
            let southwest = row * mesh.grid_size + col;
            let southeast = southwest + 1;
            let northwest = southwest + mesh.grid_size;
            let northeast = northwest + 1;
            let Some(bounds) =
                terrain_vertex_bounds_json(mesh, [southwest, southeast, northwest, northeast])
            else {
                continue;
            };
            let quad_index = row * quad_width + col;
            let triangle_indices = [quad_index * 2, quad_index * 2 + 1];
            let raw_corners = [
                normalized_terrain[southwest],
                normalized_terrain[southeast],
                normalized_terrain[northeast],
                normalized_terrain[northwest],
            ];
            let corner_terrain_codes = raw_corners.map(terrain_code_from_cell_terrain);
            let corner_road_codes = raw_corners.map(road_code_from_cell_terrain);
            let diagonal = if terrain_triangle_cut_is_southwest_to_northeast(mesh, triangle_indices)
            {
                "southwest-northeast"
            } else {
                "southeast-northwest"
            };
            quads.push(SerializedTerrainQuad {
                terrain_quad_id: format!(
                    "landblock/{:08x}/outdoor/terrain/quad/{row:02x}/{col:02x}",
                    mesh.landblock_id
                ),
                row,
                col,
                quad_index,
                source_terrain_indices: [southwest, southeast, northeast, northwest],
                vertex_indices: [southwest, southeast, northeast, northwest],
                triangle_indices,
                diagonal,
                corner_terrain_codes,
                pcode: terrain_pcode(corner_road_codes, corner_terrain_codes),
                average_height: (mesh.vertices[southwest].z
                    + mesh.vertices[southeast].z
                    + mesh.vertices[northeast].z
                    + mesh.vertices[northwest].z)
                    / 4.0,
                bounds,
            });
        }
    }
    quads
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

pub fn serialize_landblock_terrain_quad(quad: &SerializedTerrainQuad) -> serde_json::Value {
    serde_json::json!({
        "terrainQuadId": quad.terrain_quad_id,
        "row": quad.row,
        "col": quad.col,
        "quadIndex": quad.quad_index,
        "sourceTerrainIndices": quad.source_terrain_indices,
        "vertexIndices": quad.vertex_indices,
        "triangleIndices": quad.triangle_indices,
        "diagonal": quad.diagonal,
        "cornerTerrainCodes": quad.corner_terrain_codes,
        "pcode": quad.pcode,
        "averageHeight": quad.average_height,
        "bounds": serialize_prepared_aabb(&quad.bounds),
    })
}

pub fn terrain_code_from_cell_terrain(value: u16) -> u32 {
    u32::from((value >> 2) & 0x1f)
}

pub fn road_code_from_cell_terrain(value: u16) -> u32 {
    u32::from(value & 0x03)
}

pub fn terrain_pcode(road_codes: [u32; 4], terrain_codes: [u32; 4]) -> u32 {
    (1 << 28)
        | (road_codes[0] << 26)
        | (road_codes[1] << 24)
        | (road_codes[2] << 22)
        | (road_codes[3] << 20)
        | (terrain_codes[0] << 15)
        | (terrain_codes[1] << 10)
        | (terrain_codes[2] << 5)
        | terrain_codes[3]
}

pub fn terrain_triangle_cut_is_southwest_to_northeast(
    mesh: &PreparedTerrainMesh,
    triangle_indices: [usize; 2],
) -> bool {
    let Some(first) = mesh.triangles.get(triangle_indices[0]) else {
        return true;
    };
    let Some(second) = mesh.triangles.get(triangle_indices[1]) else {
        return true;
    };
    first.c == second.b
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
        "outdoorBvh": serialize_landblock_outdoor_bvh(outdoor),
        "dependencies": serialize_landblock_outdoor_dependencies(outdoor),
        "diagnostics": serialize_prepared_content_diagnostics(&outdoor.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-outdoor",
            "errorCode": outdoor.diagnostics.errors.first().map(|error| error.error_code),
            "detail": outdoor.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

pub fn serialize_landblock_outdoor_dependencies(
    outdoor: &LandblockOutdoorAsset,
) -> serde_json::Value {
    let mut renderable_source_asset_ids = outdoor
        .statics
        .iter()
        .map(|member| member.instance.source_asset_id.clone())
        .collect::<Vec<_>>();
    renderable_source_asset_ids.sort();
    renderable_source_asset_ids.dedup();

    serde_json::json!({
        "renderableSourceAssetIds": renderable_source_asset_ids,
        "materialAssetIds": Vec::<String>::new(),
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

pub fn landblock_outdoor_terrain_asset(
    outdoor: &LandblockOutdoorAsset,
) -> SerializedOutdoorTerrainSource {
    SerializedOutdoorTerrainSource {
        cell_landblock: outdoor.cell_landblock.clone(),
        terrain_mesh: outdoor.terrain_mesh.clone(),
    }
}

pub struct SerializedOutdoorTerrainSource {
    pub cell_landblock: Option<holtburger_content::CellLandblockFact>,
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
    serde_json::json!({
        "coordinateSpace": "landblock-render-local",
        "nodes": bvh.nodes.iter().map(serialize_prepared_bvh_node).collect::<Vec<_>>(),
        "items": outdoor.statics.iter().map(|member| serde_json::json!({
            "kind": serialize_landblock_outdoor_bvh_item_kind(member.instance.kind),
            "instanceId": member.instance.instance_id,
        })).collect::<Vec<_>>(),
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
                PreparedAabb {
                    min: point,
                    max: point,
                },
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

pub fn serialize_landblock_topology_portal_links(
    topology: &LandblockTopologyAsset,
) -> Vec<serde_json::Value> {
    topology
        .env_cells
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
                            "landblockId": topology.landblock_id,
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
        "environmentId": cell.environment_id,
        "cellStructureId": cell.cell_structure_id,
        "localPlacement": serialize_frame(&cell.local_placement),
        "surfaces": cell.surface_ids.iter().enumerate().map(|(index, surface_id)| {
            serde_json::json!({
                "slotId": index + 1,
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
        "dependencies": serialize_env_cell_dependencies(asset),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "env-cell",
            "errorCode": asset.diagnostics.errors.first().map(|error| error.error_code),
            "detail": asset.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

pub fn serialize_env_cell_dependencies(asset: &EnvCellAsset) -> serde_json::Value {
    let mut renderable_source_asset_ids = asset
        .env_cell
        .static_objects
        .iter()
        .map(|static_object| static_object.source_asset_id.clone())
        .collect::<Vec<_>>();
    renderable_source_asset_ids.sort();
    renderable_source_asset_ids.dedup();

    let mut material_asset_ids = asset
        .prepared_cell
        .surface_ids
        .iter()
        .map(|surface_id| format_material_asset_id(*surface_id))
        .collect::<Vec<_>>();
    material_asset_ids.sort();
    material_asset_ids.dedup();

    serde_json::json!({
        "renderableSourceAssetIds": renderable_source_asset_ids,
        "materialAssetIds": material_asset_ids,
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
            .map(|mesh| serde_json::json!({ "kind": "static", "instanceId": mesh.instance_id })),
    );
    items.extend(
        cell.portals
            .iter()
            .map(|portal| serde_json::json!({ "kind": "portal", "portalId": portal.portal_id })),
    );
    let mut node_inputs = Vec::new();
    if let Some(bounds) = cell.render_geometry.bounds {
        node_inputs.push((bounds, 1_u32));
    }
    node_inputs.extend(
        static_meshes
            .iter()
            .filter_map(|mesh| mesh.instance_bounds.map(|bounds| (bounds, 2_u32))),
    );
    node_inputs.extend(
        cell.portal_apertures
            .iter()
            .filter_map(|aperture| portal_aperture_bounds(aperture).map(|bounds| (bounds, 4_u32))),
    );
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
                "textureAssetId": format_render_texture_asset_id(terrain.texture_id),
                "textureDid": terrain.texture_id,
                "tiling": terrain.tiling,
                "detail": (terrain.detail_texture_id != 0).then(|| serde_json::json!({
                    "textureAssetId": format_render_texture_asset_id(terrain.detail_texture_id),
                    "textureDid": terrain.detail_texture_id,
                    "tiling": terrain.detail_tiling,
                    "fadeNear": 0.0,
                    "fadeFar": 0.0,
                })),
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
                "alphaTextureAssetId": format_render_texture_asset_id(map.texture_id),
                "alphaTextureDid": map.texture_id,
                "selector": map.selector,
            })
        }).collect::<Vec<_>>(),
        "roadAlphaMaps": table.road_alpha_maps.iter().map(|map| {
            serde_json::json!({
                "roadIndex": map.road_index,
                "roadTextureAssetId": format_render_texture_asset_id(map.road_texture_id),
                "roadTextureDid": map.road_texture_id,
                "alphaTextureAssetId": format_render_texture_asset_id(map.alpha_texture_id),
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
            "renderTextureAssetIds": table.render_texture_ids.iter().map(|id| format_render_texture_asset_id(*id)).collect::<Vec<_>>(),
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

pub fn serialize_prepared_bvh_node(node: &PreparedBvhNode) -> serde_json::Value {
    serde_json::json!({
        "bounds": serialize_prepared_aabb(&node.bounds),
        "left": node.left,
        "right": node.right,
        "itemIndices": node.item_indices,
        "kindMask": node.kind_mask,
    })
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

pub fn format_env_cell_asset_id(env_cell_id: u32) -> String {
    format!("env-cell/{env_cell_id:08x}")
}

pub fn format_material_asset_id(surface_id: u32) -> String {
    format!("material/{surface_id:08x}")
}

pub fn format_render_texture_asset_id(render_texture_id: u32) -> String {
    format!("render-texture/{render_texture_id:08x}")
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
