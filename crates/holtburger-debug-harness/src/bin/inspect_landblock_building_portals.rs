use anyhow::Result;
use clap::Parser;
use holtburger_content::{
    normalize_landblock_id, ContentDecodeCache, ContentRepository, LandblockEnvCellsAssetAssembler,
    LandblockOutdoorAssetAssembler, PreparedVec3,
};
use holtburger_dat::graphics::Frame;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "dats/assets.hba")]
    dats: String,
    #[arg(long, default_value = "f418ffff")]
    landblock: String,
    #[arg(long)]
    portal_duplicates: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let landblock_id = normalize_landblock_id(u32::from_str_radix(
        args.landblock.trim_start_matches("0x"),
        16,
    )?);
    let content = ContentRepository::from_hba_path(args.dats)?;
    let cache = ContentDecodeCache::new();
    let outdoor = LandblockOutdoorAssetAssembler::new().assemble_landblock_with_cache(
        &content,
        &cache,
        landblock_id,
    );
    let env_asset = LandblockEnvCellsAssetAssembler::new().assemble_landblock_with_cache(
        &content,
        &cache,
        landblock_id,
    )?;
    let env_portals_by_cell_and_index = env_asset
        .env_cells
        .iter()
        .flat_map(|cell| {
            cell.prepared_cell.portals.iter().map(|portal| {
                (
                    (cell.env_cell.env_cell_id, portal.source_index),
                    EnvPortalSummary {
                        flags: portal.flags,
                        is_outside_transition: portal.is_outside_transition,
                        portal_id: portal.portal_id.clone(),
                    },
                )
            })
        })
        .collect::<BTreeMap<_, _>>();

    let building_members = outdoor
        .statics
        .iter()
        .filter(|member| member.building.is_some())
        .collect::<Vec<_>>();
    let building_portal_count = building_members
        .iter()
        .filter_map(|member| member.building.as_ref())
        .map(|building| building.portals.len())
        .sum::<usize>();

    println!("landblock=0x{landblock_id:08x}");
    println!(
        "outdoorStatics={} buildings={} buildingPortals={}",
        outdoor.statics.len(),
        building_members.len(),
        building_portal_count
    );

    let mut linked_env_cell_ids = BTreeSet::new();
    for member in building_members {
        let Some(building) = member.building.as_ref() else {
            continue;
        };
        println!(
            "building instance={} sourceDid=0x{:08x} sourceIndex={} portals={}",
            member.instance.instance_id,
            member.instance.source_did,
            member.instance.source_index,
            building.portals.len()
        );
        for portal in &building.portals {
            linked_env_cell_ids.extend(portal.linked_env_cell_ids.iter().copied());
            let target_env_cell_id = (landblock_id & 0xffff_0000) | u32::from(portal.other_cell_id);
            let target_env_portal = env_portals_by_cell_and_index
                .get(&(target_env_cell_id, usize::from(portal.other_portal_id)));
            println!(
                "  portal={} index={} flags=0x{:04x} otherCell=0x{:04x} otherPortal=0x{:04x} target={} stabs={:?} linkedEnvCells={}",
                portal.portal_id,
                portal.source_index,
                portal.flags,
                portal.other_cell_id,
                portal.other_portal_id,
                format_target_env_portal(target_env_portal),
                portal.stab_list,
                format_env_cell_ids(portal.linked_env_cell_ids.iter().copied()),
            );
        }
    }
    println!(
        "buildingLinkedEnvCells count={} ids={}",
        linked_env_cell_ids.len(),
        format_env_cell_ids(linked_env_cell_ids.iter().copied()),
    );

    if args.portal_duplicates {
        report_duplicate_transition_portal_linkage(
            landblock_id,
            &env_asset.env_cells,
            &linked_env_cell_ids,
        );
    }

    Ok(())
}

fn report_duplicate_transition_portal_linkage(
    landblock_id: u32,
    cells: &[holtburger_content::LandblockEnvCellBundleCell],
    linked_env_cell_ids: &BTreeSet<u32>,
) {
    let mut groups = BTreeMap::<String, Vec<TransitionPortalApertureDump>>::new();
    for cell in cells {
        let apertures_by_portal = cell
            .prepared_cell
            .portal_apertures
            .iter()
            .map(|aperture| (aperture.portal_id.as_str(), aperture))
            .collect::<BTreeMap<_, _>>();
        for portal in &cell.prepared_cell.portals {
            if !portal.is_outside_transition {
                continue;
            }
            let Some(aperture) = apertures_by_portal.get(portal.portal_id.as_str()) else {
                continue;
            };
            let world_points = aperture
                .points
                .iter()
                .map(|point| {
                    transform_render_local_point(*point, &cell.prepared_cell.local_placement)
                })
                .collect::<Vec<_>>();
            groups
                .entry(canonical_point_set_key(&world_points))
                .or_default()
                .push(TransitionPortalApertureDump {
                    env_cell_id: cell.env_cell.env_cell_id,
                    flags: portal.flags,
                    portal_id: portal.portal_id.clone(),
                });
        }
    }

    println!("duplicateTransitionPortalBuildingLinkage landblock=0x{landblock_id:08x}");
    for group in groups.values().filter(|group| group.len() > 1) {
        let linked_count = group
            .iter()
            .filter(|member| linked_env_cell_ids.contains(&member.env_cell_id))
            .count();
        println!(
            "duplicateGroup members={} linkedByBuilding={} allLinkedByBuilding={}",
            group.len(),
            linked_count,
            linked_count == group.len()
        );
        for member in group {
            println!(
                "  envCell=0x{:08x} portal={} flags=0x{:04x} linkedByBuilding={}",
                member.env_cell_id,
                member.portal_id,
                member.flags,
                linked_env_cell_ids.contains(&member.env_cell_id),
            );
        }
    }
}

#[derive(Debug)]
struct TransitionPortalApertureDump {
    env_cell_id: u32,
    flags: u16,
    portal_id: String,
}

#[derive(Debug)]
struct EnvPortalSummary {
    flags: u16,
    is_outside_transition: bool,
    portal_id: String,
}

fn canonical_point_set_key(points: &[PreparedVec3]) -> String {
    let mut point_keys = points.iter().map(canonical_point_key).collect::<Vec<_>>();
    point_keys.sort();
    point_keys.join("|")
}

fn canonical_point_key(point: &PreparedVec3) -> String {
    format!(
        "{},{},{}",
        quantize_coord(point.x),
        quantize_coord(point.y),
        quantize_coord(point.z)
    )
}

fn quantize_coord(value: f32) -> i32 {
    (value * 1000.0).round() as i32
}

fn transform_render_local_point(point: PreparedVec3, ac_frame: &Frame) -> PreparedVec3 {
    ac_to_render_point(
        ac_frame.origin + rotate_ac_vector(render_to_ac_point(point), ac_frame.orientation),
    )
}

fn render_to_ac_point(point: PreparedVec3) -> holtburger_common::Vector3 {
    holtburger_common::Vector3 {
        x: point.x,
        y: if point.z == 0.0 { 0.0 } else { -point.z },
        z: point.y,
    }
}

fn rotate_ac_vector(
    vector: holtburger_common::Vector3,
    rotation: holtburger_common::Quaternion,
) -> holtburger_common::Vector3 {
    let u = holtburger_common::Vector3 {
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
    };
    let s = rotation.w;
    let uv = cross(u, vector);
    let uuv = cross(u, uv);
    vector + (uv * (2.0 * s)) + (uuv * 2.0)
}

fn cross(
    left: holtburger_common::Vector3,
    right: holtburger_common::Vector3,
) -> holtburger_common::Vector3 {
    holtburger_common::Vector3 {
        x: left.y * right.z - left.z * right.y,
        y: left.z * right.x - left.x * right.z,
        z: left.x * right.y - left.y * right.x,
    }
}

fn ac_to_render_point(point: holtburger_common::Vector3) -> PreparedVec3 {
    PreparedVec3 {
        x: point.x,
        y: point.z,
        z: -point.y,
    }
}

fn format_env_cell_ids(ids: impl IntoIterator<Item = u32>) -> String {
    let ids = ids
        .into_iter()
        .map(|id| format!("0x{id:08x}"))
        .collect::<Vec<_>>();
    format!("[{}]", ids.join(", "))
}

fn format_target_env_portal(portal: Option<&EnvPortalSummary>) -> String {
    match portal {
        Some(portal) => format!(
            "{} flags=0x{:04x} outsideTransition={}",
            portal.portal_id, portal.flags, portal.is_outside_transition
        ),
        None => "missing".to_string(),
    }
}
