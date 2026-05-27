use std::collections::BTreeMap;
use std::io::Cursor;

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::{
    ContentDecodeCache, ContentRepository, EnvCellAssetAssembler, ResolvedMaterialSource,
    legacy_sampler_material_variant_signature,
};
use holtburger_dat::file_type::{EnvCell, Environment};
use holtburger_dat::graphics::{CVertexArray, Polygon};
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaReader};

const STIPPLING_REPEAT_POS: u8 = 0x01;
const STIPPLING_REPEAT_NEG: u8 = 0x02;
const STIPPLING_NO_POS: u8 = 0x04;
const STIPPLING_NO_NEG: u8 = 0x08;
const CULL_MODE_CLOCKWISE: i32 = 2;

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "dats/assets.hba")]
    dats: String,
    #[arg(long)]
    env_cell: String,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let env_cell_id = u32::from_str_radix(args.env_cell.trim_start_matches("0x"), 16)
        .with_context(|| format!("invalid env-cell id {}", args.env_cell))?;
    let archive = HbaReader::open(&args.dats)
        .with_context(|| format!("failed to open HBA archive {}", args.dats))?;
    let content = ContentRepository::from_hba_path(&args.dats)
        .with_context(|| format!("failed to open content repository {}", args.dats))?;
    let cache = ContentDecodeCache::new();
    let asset = EnvCellAssetAssembler::new()
        .try_assemble_env_cell_with_cache(&content, &cache, env_cell_id)
        .with_context(|| format!("failed to prepare env-cell 0x{env_cell_id:08X}"))?;
    let (raw_env_cell, environment) = load_env_cell_environment(&archive, env_cell_id)?;
    let cell_structure_id = u32::from(raw_env_cell.cell_structure);
    let cell_structure = environment.cells.get(&cell_structure_id).with_context(|| {
        format!(
            "environment 0x{:08X} missing cell structure 0x{cell_structure_id:08X}",
            asset.prepared_cell.environment_id
        )
    })?;
    let prepared_triangles_by_polygon =
        collect_prepared_triangles_by_polygon(&asset.prepared_cell.render_geometry.triangles);

    println!(
        "envCell\tpolygonId\tside\tstippling\trepeat\tsurfaceSlot\tmaterialId\trenderSurfaceIds\tvertexIds\tuvIndices\tuvValues\tacviewerHasWrappingUvs\tmaterialVariant\tpreparedFirstVertices"
    );
    for (polygon_id, polygon) in &cell_structure.polygons {
        for side in polygon_report_sides(polygon) {
            let material_id = side
                .surface_slot
                .and_then(|surface_slot| raw_env_cell.surfaces.get(surface_slot as usize))
                .map(|surface_id| 0x0800_0000 | u32::from(*surface_id));
            let render_surface_ids = material_id
                .map(
                    |surface_id| match content.resolve_material_recipe(surface_id) {
                        Ok(recipe) => match recipe.source {
                            ResolvedMaterialSource::Texture(texture) => texture.render_surface_ids,
                            ResolvedMaterialSource::SolidColor(_) => Vec::new(),
                        },
                        Err(_) => Vec::new(),
                    },
                )
                .unwrap_or_default();
            let uv_values = format_uv_values(
                &cell_structure.vertex_array,
                &polygon.vertex_ids,
                side.uv_indices,
            );
            let prepared_first_vertices = prepared_triangles_by_polygon
                .get(polygon_id)
                .map(|triangles| {
                    triangles
                        .iter()
                        .filter(|triangle| {
                            triangle.surface_id == side.surface_slot
                                && triangle.material_variant_signature == side.material_variant
                        })
                        .map(|triangle| triangle.first_vertex.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default();

            println!(
                "0x{env_cell_id:08X}\t{polygon_id}\t{}\t0x{:02X}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                side.label,
                polygon.stippling,
                side.repeats,
                side.surface_slot
                    .map(|surface_slot| surface_slot.to_string())
                    .unwrap_or_else(|| "none".to_string()),
                material_id
                    .map(|surface_id| format!("0x{surface_id:08X}"))
                    .unwrap_or_else(|| "none".to_string()),
                format_hex_list(&render_surface_ids),
                format_u16_list(&polygon.vertex_ids),
                format_u8_list(side.uv_indices),
                uv_values,
                has_wrapping_uvs(
                    &cell_structure.vertex_array,
                    &polygon.vertex_ids,
                    side.uv_indices
                ),
                side.material_variant,
                prepared_first_vertices
            );
        }
    }
    Ok(())
}

struct PolygonReportSide<'a> {
    label: &'static str,
    repeats: bool,
    surface_slot: Option<i16>,
    uv_indices: &'a [u8],
    material_variant: &'static str,
}

fn polygon_report_sides(polygon: &Polygon) -> Vec<PolygonReportSide<'_>> {
    let mut sides = Vec::with_capacity(2);
    if (polygon.stippling & STIPPLING_NO_POS) == 0
        && polygon.pos_uv_indices.len() == polygon.vertex_ids.len()
    {
        let repeats = (polygon.stippling & STIPPLING_REPEAT_POS) != 0;
        sides.push(PolygonReportSide {
            label: "positive",
            repeats,
            surface_slot: normalize_surface_slot(polygon.pos_surface),
            uv_indices: &polygon.pos_uv_indices,
            material_variant: legacy_sampler_variant(repeats),
        });
    }
    if polygon.sides_type == CULL_MODE_CLOCKWISE
        && (polygon.stippling & STIPPLING_NO_NEG) == 0
        && polygon.neg_uv_indices.len() == polygon.vertex_ids.len()
    {
        let repeats = (polygon.stippling & STIPPLING_REPEAT_NEG) != 0;
        sides.push(PolygonReportSide {
            label: "negative",
            repeats,
            surface_slot: normalize_surface_slot(polygon.neg_surface),
            uv_indices: &polygon.neg_uv_indices,
            material_variant: legacy_sampler_variant(repeats),
        });
    }
    sides
}

fn load_env_cell_environment(
    archive: &HbaReader,
    env_cell_id: u32,
) -> Result<(EnvCell, Environment)> {
    let env_cell_bytes = archive
        .get_file_in_namespace(EOR_CELL_NAMESPACE, env_cell_id)
        .with_context(|| format!("failed to read env-cell 0x{env_cell_id:08X}"))?;
    let env_cell = EnvCell::unpack(&mut Cursor::new(env_cell_bytes))
        .with_context(|| format!("failed to decode env-cell 0x{env_cell_id:08X}"))?;
    let environment_id = 0x0D00_0000 | u32::from(env_cell.environment_id);
    let environment_bytes = archive
        .get_file_in_namespace(EOR_PORTAL_NAMESPACE, environment_id)
        .with_context(|| format!("failed to read environment 0x{environment_id:08X}"))?;
    let environment = Environment::unpack(&mut Cursor::new(environment_bytes))
        .with_context(|| format!("failed to decode environment 0x{environment_id:08X}"))?;
    Ok((env_cell, environment))
}

fn collect_prepared_triangles_by_polygon(
    triangles: &[holtburger_content::PreparedPolygonSetRenderTriangle],
) -> BTreeMap<u16, Vec<&holtburger_content::PreparedPolygonSetRenderTriangle>> {
    let mut by_polygon: BTreeMap<u16, Vec<&holtburger_content::PreparedPolygonSetRenderTriangle>> =
        BTreeMap::new();
    for triangle in triangles {
        by_polygon
            .entry(triangle.polygon_id)
            .or_default()
            .push(triangle);
    }
    by_polygon
}

fn format_uv_values(vertex_array: &CVertexArray, vertex_ids: &[u16], uv_indices: &[u8]) -> String {
    vertex_ids
        .iter()
        .zip(uv_indices)
        .map(|(vertex_id, uv_index)| {
            vertex_array
                .vertices
                .get(vertex_id)
                .and_then(|vertex| vertex.uvs.get(usize::from(*uv_index)))
                .map(|uv| format!("{:.6},{:.6}", uv.u, uv.v))
                .unwrap_or_else(|| "missing".to_string())
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn has_wrapping_uvs(vertex_array: &CVertexArray, vertex_ids: &[u16], uv_indices: &[u8]) -> bool {
    vertex_ids
        .iter()
        .zip(uv_indices)
        .any(|(vertex_id, uv_index)| {
            vertex_array
                .vertices
                .get(vertex_id)
                .and_then(|vertex| vertex.uvs.get(usize::from(*uv_index)))
                .is_some_and(|uv| uv.u < 0.0 || uv.u > 1.0 || uv.v < 0.0 || uv.v > 1.0)
        })
}

fn normalize_surface_slot(surface_slot: i16) -> Option<i16> {
    (surface_slot >= 0).then_some(surface_slot)
}

fn legacy_sampler_variant(repeats: bool) -> &'static str {
    legacy_sampler_material_variant_signature(repeats)
}

fn format_hex_list(values: &[u32]) -> String {
    values
        .iter()
        .map(|value| format!("0x{value:08X}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_u16_list(values: &[u16]) -> String {
    values
        .iter()
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

fn format_u8_list(values: &[u8]) -> String {
    values
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(",")
}
