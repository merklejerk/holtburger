use anyhow::Result;
use clap::Parser;
use holtburger_content::{ContentDecodeCache, ContentRepository, EnvCellAssetAssembler};

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "dats/assets.hba")]
    dats: String,
    #[arg(long, default_value = "da55010b")]
    env_cell: String,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let env_cell_id = u32::from_str_radix(args.env_cell.trim_start_matches("0x"), 16)?;
    let content = ContentRepository::from_hba_path(args.dats)?;
    let cache = ContentDecodeCache::new();
    let asset = EnvCellAssetAssembler::new().try_assemble_env_cell_with_cache(
        &content,
        &cache,
        env_cell_id,
    )?;

    println!("envCell=0x{:08x}", asset.env_cell.env_cell_id);
    println!(
        "environment=0x{:08x} cellStructure=0x{:08x}",
        asset.prepared_cell.environment_id, asset.prepared_cell.cell_structure_id
    );
    println!(
        "rawStatics={} preparedStaticMeshes={} renderTriangles={} surfaces={} portals={} apertures={}",
        asset.env_cell.static_objects.len(),
        asset.static_meshes.len(),
        asset.prepared_cell.render_geometry.triangles.len(),
        asset.prepared_cell.surface_ids.len(),
        asset.prepared_cell.portals.len(),
        asset.prepared_cell.portal_apertures.len()
    );
    println!("raw static objects:");
    for static_object in &asset.env_cell.static_objects {
        println!(
            "  index={} did=0x{:08x} asset={} origin=({:.3},{:.3},{:.3})",
            static_object.source_index,
            static_object.source_did,
            static_object.source_asset_id,
            static_object.local_placement.origin.x,
            static_object.local_placement.origin.y,
            static_object.local_placement.origin.z,
        );
    }
    println!("prepared static meshes:");
    for mesh in &asset.static_meshes {
        println!(
            "  index={} part={} did=0x{:08x} gfx=0x{:08x} asset={} partPlacements={} bounds={} origin=({:.3},{:.3},{:.3})",
            mesh.source_index,
            mesh.part_index,
            mesh.source_did,
            mesh.gfx_obj_id,
            mesh.source_asset_id,
            mesh.part_placements.len(),
            mesh.instance_bounds.is_some(),
            mesh.local_placement.origin.x,
            mesh.local_placement.origin.y,
            mesh.local_placement.origin.z,
        );
    }
    println!("portals:");
    for portal in &asset.prepared_cell.portals {
        println!(
            "  id={} index={} flags=0x{:04x} polygon={} otherCell=0x{:04x} otherPortal=0x{:04x} target={} outsideTransition={}",
            portal.portal_id,
            portal.source_index,
            portal.flags,
            portal.polygon_id,
            portal.other_cell_id,
            portal.other_portal_id,
            portal
                .target_env_cell_id
                .map(|id| format!("0x{id:08x}"))
                .unwrap_or_else(|| "none".to_string()),
            portal.is_outside_transition,
        );
    }
    println!("portal apertures:");
    for aperture in &asset.prepared_cell.portal_apertures {
        println!(
            "  portal={} index={} polygon={} points={} plane={}",
            aperture.portal_id,
            aperture.source_index,
            aperture.polygon_id,
            aperture.points.len(),
            aperture
                .plane
                .map(|plane| {
                    format!(
                        "n=({:.6},{:.6},{:.6}) c={:.6} source={:?}",
                        plane.normal.x, plane.normal.y, plane.normal.z, plane.constant, plane.source
                    )
                })
                .unwrap_or_else(|| "none".to_string()),
        );
        for (point_index, point) in aperture.points.iter().enumerate() {
            println!(
                "    p{}=({:.6},{:.6},{:.6})",
                point_index, point.x, point.y, point.z
            );
        }
    }
    if !asset.diagnostics.errors.is_empty() {
        println!("errors:");
        for error in &asset.diagnostics.errors {
            println!(
                "  {} 0x{:08x} {} {} {}",
                error.namespace, error.file_id, error.role, error.error_code, error.detail
            );
        }
    }
    Ok(())
}
