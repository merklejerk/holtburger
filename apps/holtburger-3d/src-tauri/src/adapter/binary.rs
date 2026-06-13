use crate::adapter::json::SerializedOutdoorTerrainSource;
use crate::adapter::json::*;
use crate::adapter::prepared_texture::{
    PreparedTexturePayload, serialize_prepared_texture_payload,
};
use crate::adapter::service::{ASSET_BINARY_HEADER_LEN, ASSET_BINARY_MAGIC, ASSET_BINARY_VERSION};
use crate::contracts::*;
use holtburger_content::*;
use holtburger_core::{ContentAsset, ContentAssetRequest};
use holtburger_dat::file_type::{GfxObj, Palette};

pub struct BinaryAssetSection {
    role: String,
    path: String,
    scalar_type: &'static str,
    component_count: u32,
    element_count: u32,
    byte_offset: usize,
    byte_length: usize,
}

#[derive(Default)]
pub struct BinaryAssetSectionWriter {
    data: Vec<u8>,
    sections: Vec<BinaryAssetSection>,
}

impl BinaryAssetSectionWriter {
    pub fn push_f32_section(
        &mut self,
        role: impl Into<String>,
        path: impl Into<String>,
        component_count: u32,
        values: impl IntoIterator<Item = f32>,
    ) {
        let offset = self.data.len();
        let mut scalar_count = 0usize;
        for value in values {
            self.data.extend(value.to_le_bytes());
            scalar_count += 1;
        }
        self.push_section(role, path, "f32", component_count, offset, scalar_count);
    }

    pub fn push_i32_section(
        &mut self,
        role: impl Into<String>,
        path: impl Into<String>,
        component_count: u32,
        values: impl IntoIterator<Item = i32>,
    ) {
        let offset = self.data.len();
        let mut scalar_count = 0usize;
        for value in values {
            self.data.extend(value.to_le_bytes());
            scalar_count += 1;
        }
        self.push_section(role, path, "i32", component_count, offset, scalar_count);
    }

    pub fn push_u8_section(
        &mut self,
        role: impl Into<String>,
        path: impl Into<String>,
        component_count: u32,
        values: &[u8],
    ) {
        let offset = self.data.len();
        self.data.extend(values);
        self.push_section(role, path, "u8", component_count, offset, values.len());
    }

    pub fn push_u32_section(
        &mut self,
        role: impl Into<String>,
        path: impl Into<String>,
        component_count: u32,
        values: impl IntoIterator<Item = u32>,
    ) {
        let offset = self.data.len();
        let mut scalar_count = 0usize;
        for value in values {
            self.data.extend(value.to_le_bytes());
            scalar_count += 1;
        }
        self.push_section(role, path, "u32", component_count, offset, scalar_count);
    }

    pub fn push_section(
        &mut self,
        role: impl Into<String>,
        path: impl Into<String>,
        scalar_type: &'static str,
        component_count: u32,
        offset: usize,
        scalar_count: usize,
    ) {
        if scalar_count == 0 {
            return;
        }
        let component_count_usize =
            usize::try_from(component_count).expect("binary component count fits usize");
        assert!(
            scalar_count.is_multiple_of(component_count_usize),
            "binary section scalar count must divide evenly by component count"
        );
        self.sections.push(BinaryAssetSection {
            role: role.into(),
            path: path.into(),
            scalar_type,
            component_count,
            element_count: u32::try_from(scalar_count / component_count_usize)
                .expect("binary section element count fits u32"),
            byte_offset: offset,
            byte_length: self.data.len() - offset,
        });
    }

    pub fn serialize_sections(&self) -> Vec<serde_json::Value> {
        self.sections
            .iter()
            .map(|section| {
                serde_json::json!({
                    "role": section.role,
                    "path": section.path,
                    "scalarType": section.scalar_type,
                    "componentCount": section.component_count,
                    "elementCount": section.element_count,
                    "byteOffset": section.byte_offset,
                    "byteLength": section.byte_length,
                })
            })
            .collect()
    }
}
pub fn serialize_content_asset_binary_response(
    request: AssetLookupRequestDto,
    content_request: ContentAssetRequest,
    asset: anyhow::Result<ContentAsset>,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> anyhow::Result<AssetLookupResponseDto> {
    Ok(match content_request {
        ContentAssetRequest::LandblockOutdoor(landblock_id) => match asset {
            Ok(ContentAsset::LandblockOutdoor {
                outdoor,
                region_id,
                region_number,
            }) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_landblock_outdoor_binary_payload(
                    &outdoor,
                    region_id,
                    region_number,
                    path_prefix,
                    writer,
                ),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched landblock outdoor"),
            Err(error) => anyhow::bail!(
                "failed to load landblock outdoor 0x{:08X} for {}: {error:#}",
                normalize_landblock_id(landblock_id),
                request.asset_id
            ),
        },
        ContentAssetRequest::LandblockTopology(landblock_id) => match asset {
            Ok(ContentAsset::LandblockTopology(topology)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_landblock_topology_payload(&topology),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched landblock topology"),
            Err(error) => anyhow::bail!(
                "failed to load landblock topology 0x{:08X} for {}: {error:#}",
                normalize_landblock_id(landblock_id),
                request.asset_id
            ),
        },
        ContentAssetRequest::LandblockEnvCells(landblock_id) => match asset {
            Ok(ContentAsset::LandblockEnvCells {
                topology,
                cells,
                region_id,
                region_number,
            }) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_landblock_env_cells_binary_payload(
                    &topology,
                    &cells,
                    region_id,
                    region_number,
                    path_prefix,
                    writer,
                ),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched landblock env-cells"),
            Err(error) => anyhow::bail!(
                "failed to load landblock env-cells 0x{:08X} for {}: {error:#}",
                normalize_landblock_id(landblock_id),
                request.asset_id
            ),
        },
        ContentAssetRequest::EnvCell(env_cell_id) => match asset {
            Ok(ContentAsset::EnvCell {
                cell,
                region_id,
                region_number,
            }) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: {
                    if cell.prepared_cell.env_cell_id != env_cell_id {
                        anyhow::bail!(
                            "EnvCell assembler returned 0x{:08X} for request 0x{env_cell_id:08X}",
                            cell.prepared_cell.env_cell_id
                        );
                    }
                    serialize_env_cell_binary_payload(
                        &cell,
                        region_id,
                        region_number,
                        path_prefix,
                        writer,
                    )
                },
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched env-cell"),
            Err(error) => anyhow::bail!(
                "failed to load env-cell 0x{env_cell_id:08X} for {}: {error:#}",
                request.asset_id
            ),
        },
        ContentAssetRequest::GfxObj(gfx_obj_id) => match asset {
            Ok(ContentAsset::GfxObj(gfx_obj)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_gfx_obj_binary_payload(&gfx_obj, path_prefix, writer),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched gfx obj"),
            Err(error) => anyhow::bail!(
                "failed to load gfx-obj 0x{gfx_obj_id:08X} for {}: {error:#}",
                request.asset_id
            ),
        },
        ContentAssetRequest::RenderSurface(render_surface_id) => match asset {
            Ok(ContentAsset::RenderSurface(render_surface)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_render_surface_binary_payload(
                    &render_surface,
                    path_prefix,
                    writer,
                ),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched render surface"),
            Err(error) => anyhow::bail!(
                "failed to load render surface 0x{render_surface_id:08X} for {}: {error:#}",
                request.asset_id
            ),
        },
        ContentAssetRequest::Palette(palette_id) => match asset {
            Ok(ContentAsset::Palette(palette)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_palette_binary_payload(&palette, path_prefix, writer),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched palette"),
            Err(error) => anyhow::bail!(
                "failed to load palette 0x{palette_id:08X} for {}: {error:#}",
                request.asset_id
            ),
        },
        unsupported => anyhow::bail!(
            "binary asset lookup does not support {unsupported:?} for {}",
            request.asset_id
        ),
    })
}

pub fn serialize_prepared_texture_binary_response(
    request: AssetLookupRequestDto,
    prepared_texture: PreparedTexturePayload,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> anyhow::Result<AssetLookupResponseDto> {
    Ok(AssetLookupResponseDto {
        request_id: request.request_id,
        asset_id: request.asset_id,
        payload_kind: AssetPayloadKindDto::Json,
        payload: serialize_prepared_texture_payload(&prepared_texture, path_prefix, writer),
    })
}

pub fn serialize_palette_binary_payload(
    palette: &Palette,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    let mut payload = serialize_palette_payload(palette);
    payload["colorsArgb"] = serde_json::json!([]);
    writer.push_u32_section(
        "palette.colorsArgb",
        format!("{path_prefix}.colorsArgb"),
        1,
        palette.colors_argb.iter().copied(),
    );
    payload
}

pub fn serialize_asset_binary_batch_response(
    responses: Vec<AssetLookupResponseDto>,
    writer: BinaryAssetSectionWriter,
) -> anyhow::Result<Vec<u8>> {
    let manifest = serde_json::json!({
        "transport": "holtburger-asset-binary",
        "version": ASSET_BINARY_VERSION,
        "byteOrder": "little-endian",
        "sectionByteOffsetBase": "section-data",
        "responses": responses,
        "sections": writer.serialize_sections(),
    });
    let mut manifest_bytes = serde_json::to_vec(&manifest)?;
    while !(ASSET_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_len = ASSET_BINARY_HEADER_LEN + manifest_bytes.len() + writer.data.len();
    let mut bytes = Vec::with_capacity(total_len);
    bytes.extend(ASSET_BINARY_MAGIC);
    bytes.extend(ASSET_BINARY_VERSION.to_le_bytes());
    bytes.extend(
        u32::try_from(manifest_bytes.len())
            .expect("binary asset manifest length fits u32")
            .to_le_bytes(),
    );
    bytes.extend(
        u32::try_from(total_len)
            .expect("binary asset total length fits u32")
            .to_le_bytes(),
    );
    bytes.extend(manifest_bytes);
    bytes.extend(writer.data);
    Ok(bytes)
}

pub fn serialize_gfx_obj_binary_payload(
    gfx_obj: &GfxObj,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    let render_geometry = build_gfx_obj_render_geometry(gfx_obj);
    serde_json::json!({
        "kind": "gfx-obj",
        "residencyKind": "unknown",
        "sourceAssetKind": "gfx-obj",
        "gfxObjId": gfx_obj.id,
        "flags": gfx_obj.flags.bits(),
        "surfaceIds": gfx_obj.surfaces,
        "vertexArray": {
            "vertexType": gfx_obj.vertex_array.vertex_type,
            "vertexCount": gfx_obj.vertex_array.vertices.len(),
            "vertices": []
        },
        "drawingPolygons": [],
        "drawingBsp": null,
        "dependencies": {
            "materialAssetIds": gfx_obj.surfaces.iter().map(|surface_id| format_material_asset_id(*surface_id)).collect::<Vec<_>>(),
        },
        "physicsWitness": {
            "polygonCount": gfx_obj.physics_polygons.len(),
            "hasBsp": gfx_obj.physics_bsp.is_some()
        },
        "renderGeometry": serialize_prepared_polygon_set_render_geometry_binary(
            &render_geometry,
            format!("{path_prefix}.renderGeometry"),
            writer,
        ),
        "sortCenter": serialize_vector3(&gfx_obj.sort_center),
        "didDegrade": gfx_obj.did_degrade,
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "gfx-obj",
            "errorCode": null,
            "detail": null
        }
    })
}

pub fn serialize_prepared_polygon_set_render_geometry_binary(
    geometry: &PreparedPolygonSetRenderGeometry,
    path: String,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    writer.push_f32_section(
        format!("{path}.positions"),
        format!("{path}.positions"),
        3,
        geometry.positions.iter().copied(),
    );
    writer.push_f32_section(
        format!("{path}.normals"),
        format!("{path}.normals"),
        3,
        geometry.normals.iter().copied(),
    );
    writer.push_f32_section(
        format!("{path}.uvs"),
        format!("{path}.uvs"),
        2,
        geometry.uvs.iter().copied(),
    );
    writer.push_i32_section(
        format!("{path}.triangles"),
        format!("{path}.triangles"),
        4,
        geometry.triangles.iter().flat_map(|triangle| {
            [
                i32::from(triangle.polygon_id),
                triangle.surface_id.map(i32::from).unwrap_or(-1),
                encode_material_variant_signature(&triangle.material_variant_signature),
                i32::try_from(triangle.first_vertex).expect("first vertex fits i32"),
            ]
        }),
    );
    serde_json::json!({
        "sourceId": geometry.source_id,
        "vertexCount": geometry.vertex_count,
        "triangleCount": geometry.triangle_count,
        "positions": [],
        "normals": [],
        "uvs": [],
        "triangles": [],
        "surfaceIds": geometry.surface_ids,
        "invalidPolygons": geometry.invalid_polygons.iter().map(serialize_prepared_polygon_set_invalid_polygon).collect::<Vec<_>>(),
        "skippedPolygonCount": geometry.skipped_polygon_count,
        "bounds": geometry.bounds.as_ref().map(serialize_prepared_aabb),
    })
}

fn encode_material_variant_signature(signature: &str) -> i32 {
    const LEGACY_SAMPLER_CLAMP_MATERIAL_VARIANT_SIGNATURE: &str = "sampler=clamp";
    const LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE: &str = "sampler=repeat";

    match signature {
        LEGACY_SAMPLER_CLAMP_MATERIAL_VARIANT_SIGNATURE => 1,
        LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE => 2,
        _ => 0,
    }
}
pub fn serialize_landblock_terrain_binary(
    terrain_asset: &SerializedOutdoorTerrainSource,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    let Some(mesh) = terrain_asset.terrain_mesh.as_ref() else {
        return empty_landblock_terrain();
    };
    let mut terrain = serialize_landblock_terrain(terrain_asset);
    writer.push_f32_section(
        "landblockTerrain.vertices",
        format!("{path_prefix}.terrain.vertices"),
        3,
        mesh.vertices
            .iter()
            .flat_map(|vertex| [vertex.x, vertex.y, vertex.z]),
    );
    writer.push_f32_section(
        "landblockTerrain.triangles",
        format!("{path_prefix}.terrain.triangles"),
        13,
        build_landblock_terrain_triangles(mesh)
            .iter()
            .enumerate()
            .flat_map(|(triangle_index, triangle)| {
                [
                    triangle_index as f32,
                    triangle.quad_index as f32,
                    triangle.triangle_in_quad as f32,
                    triangle.vertex_indices[0] as f32,
                    triangle.vertex_indices[1] as f32,
                    triangle.vertex_indices[2] as f32,
                    triangle.average_height,
                    triangle.bounds.min.x,
                    triangle.bounds.min.y,
                    triangle.bounds.min.z,
                    triangle.bounds.max.x,
                    triangle.bounds.max.y,
                    triangle.bounds.max.z,
                ]
            }),
    );
    terrain["vertices"] = serde_json::json!([]);
    terrain["triangles"] = serde_json::json!([]);
    terrain
}
pub fn serialize_env_cell_binary_payload(
    asset: &EnvCellAsset,
    region_id: u32,
    region_number: u32,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    serialize_env_cell_payload_with_geometry(
        asset,
        region_id,
        region_number,
        serialize_prepared_polygon_set_render_geometry_binary(
            &asset.prepared_cell.render_geometry,
            format!("{path_prefix}.renderGeometry"),
            writer,
        ),
        |aperture_index, aperture| {
            serialize_prepared_portal_aperture_standalone_binary(
                aperture_index,
                aperture,
                path_prefix,
                writer,
            )
        },
    )
}

pub fn serialize_landblock_env_cells_binary_payload(
    topology: &LandblockTopologyAsset,
    cells: &[EnvCellAsset],
    region_id: u32,
    region_number: u32,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    serialize_landblock_env_cells_payload_with_cells(
        topology,
        cells,
        region_id,
        region_number,
        |cell_index, asset, _region_id, _region_number| {
            serialize_landblock_env_cell_bundle_cell(
                asset,
                serialize_prepared_polygon_set_render_geometry_binary(
                    &asset.prepared_cell.render_geometry,
                    format!("{path_prefix}.envCells.{cell_index}.renderGeometry"),
                    writer,
                ),
                |aperture_index, aperture| {
                    serialize_prepared_portal_aperture_standalone_binary(
                        aperture_index,
                        aperture,
                        &format!("{path_prefix}.envCells.{cell_index}"),
                        writer,
                    )
                },
            )
        },
    )
}
pub fn serialize_prepared_portal_aperture_standalone_binary(
    aperture_index: usize,
    aperture: &PreparedPortalAperture,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    writer.push_f32_section(
        "envCell.portalApertures.points",
        format!("{path_prefix}.portalApertures.{}.points", aperture_index),
        3,
        aperture
            .points
            .iter()
            .flat_map(|point| [point.x, point.y, point.z]),
    );
    serde_json::json!({
        "portalId": aperture.portal_id,
        "sourceIndex": aperture.source_index,
        "polygonId": aperture.polygon_id,
        "points": [],
        "plane": aperture.plane.as_ref().map(serialize_prepared_portal_aperture_plane),
    })
}
