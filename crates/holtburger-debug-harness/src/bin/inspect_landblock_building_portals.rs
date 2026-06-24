use anyhow::Result;
use clap::Parser;
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockEnvCellsAssetAssembler,
    LandblockOutdoorAssetAssembler, PreparedAabb, PreparedVec3, normalize_landblock_id,
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
    #[arg(long)]
    aperture_alignment: bool,
    #[arg(long)]
    module_seams: bool,
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
    let env_apertures_by_cell_and_index = build_env_apertures_by_cell_and_index(&env_asset);

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
    let building_portals_by_target =
        build_building_portals_by_target(landblock_id, &building_members);

    println!("landblock=0x{landblock_id:08x}");
    println!(
        "outdoorStatics={} buildings={} buildingPortals={} buildingTransitionApertures={}",
        outdoor.statics.len(),
        building_members.len(),
        building_portal_count,
        outdoor.building_transition_apertures.len()
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
        report_duplicate_building_transition_apertures(
            landblock_id,
            &outdoor.building_transition_apertures,
        );
        report_duplicate_transition_portal_linkage(
            landblock_id,
            &env_asset.env_cells,
            &linked_env_cell_ids,
        );
    }
    if args.aperture_alignment {
        report_building_transition_aperture_alignment(
            landblock_id,
            &outdoor.building_transition_apertures,
            &env_apertures_by_cell_and_index,
        );
    }
    if args.module_seams {
        report_duplicate_outside_transition_module_seams(
            landblock_id,
            &env_asset.env_cells,
            &building_portals_by_target,
        );
    }

    Ok(())
}

fn build_building_portals_by_target(
    landblock_id: u32,
    building_members: &[&holtburger_content::LandblockOutdoorStaticMember],
) -> BTreeMap<(u32, usize), Vec<BuildingPortalTargetDump>> {
    let mut targets = BTreeMap::<(u32, usize), Vec<BuildingPortalTargetDump>>::new();
    for member in building_members {
        let Some(building) = member.building.as_ref() else {
            continue;
        };
        for portal in &building.portals {
            let target_env_cell_id = (landblock_id & 0xffff_0000) | u32::from(portal.other_cell_id);
            targets
                .entry((target_env_cell_id, usize::from(portal.other_portal_id)))
                .or_default()
                .push(BuildingPortalTargetDump {
                    building_instance_id: member.instance.instance_id.clone(),
                    building_portal_id: portal.portal_id.clone(),
                    flags: portal.flags,
                    linked_env_cell_ids: portal.linked_env_cell_ids.clone(),
                    source_did: member.instance.source_did,
                    source_index: member.instance.source_index,
                });
        }
    }
    targets
}

fn build_env_apertures_by_cell_and_index(
    env_asset: &holtburger_content::LandblockEnvCellsAsset,
) -> BTreeMap<(u32, usize), EnvPortalApertureSummary> {
    let mut apertures = BTreeMap::new();
    for cell in &env_asset.env_cells {
        let aperture_by_portal_id = cell
            .prepared_cell
            .portal_apertures
            .iter()
            .map(|aperture| (aperture.portal_id.as_str(), aperture))
            .collect::<BTreeMap<_, _>>();
        for portal in &cell.prepared_cell.portals {
            let Some(aperture) = aperture_by_portal_id.get(portal.portal_id.as_str()) else {
                continue;
            };
            let points = aperture
                .points
                .iter()
                .map(|point| {
                    transform_render_local_point(*point, &cell.prepared_cell.local_placement)
                })
                .collect::<Vec<_>>();
            apertures.insert(
                (cell.env_cell.env_cell_id, portal.source_index),
                EnvPortalApertureSummary {
                    flags: portal.flags,
                    is_outside_transition: portal.is_outside_transition,
                    points,
                    portal_id: portal.portal_id.clone(),
                },
            );
        }
    }
    apertures
}

fn report_building_transition_aperture_alignment(
    landblock_id: u32,
    apertures: &[holtburger_content::PreparedBuildingTransitionAperture],
    env_apertures_by_cell_and_index: &BTreeMap<(u32, usize), EnvPortalApertureSummary>,
) {
    let mut matched = 0usize;
    let mut mismatched = 0usize;
    let mut missing = 0usize;
    for aperture in apertures {
        let target_env_cell_id = (landblock_id & 0xffff_0000) | u32::from(aperture.other_cell_id);
        let target_portal_index = usize::from(aperture.other_portal_id);
        let Some(env_aperture) =
            env_apertures_by_cell_and_index.get(&(target_env_cell_id, target_portal_index))
        else {
            missing += 1;
            print_aperture_alignment_missing(aperture, target_env_cell_id, target_portal_index);
            continue;
        };
        let building_key = canonical_point_set_key(&aperture.points);
        let env_key = canonical_point_set_key(&env_aperture.points);
        if building_key == env_key {
            matched += 1;
            continue;
        }
        mismatched += 1;
        print_aperture_alignment_mismatch(
            aperture,
            env_aperture,
            target_env_cell_id,
            target_portal_index,
        );
    }
    println!(
        "buildingTransitionApertureAlignment landblock=0x{landblock_id:08x} apertures={} matched={} mismatched={} missing={}",
        apertures.len(),
        matched,
        mismatched,
        missing
    );
}

fn print_aperture_alignment_missing(
    aperture: &holtburger_content::PreparedBuildingTransitionAperture,
    target_env_cell_id: u32,
    target_portal_index: usize,
) {
    println!(
        "missingTargetAperture aperture={} building={} portal={} targetEnvCell=0x{target_env_cell_id:08x} targetPortalIndex={target_portal_index}",
        aperture.aperture_id, aperture.building_instance_id, aperture.building_portal_id
    );
}

fn print_aperture_alignment_mismatch(
    aperture: &holtburger_content::PreparedBuildingTransitionAperture,
    env_aperture: &EnvPortalApertureSummary,
    target_env_cell_id: u32,
    target_portal_index: usize,
) {
    println!(
        "mismatchedTargetAperture aperture={} building={} portal={} targetEnvCell=0x{target_env_cell_id:08x} targetPortalIndex={} targetPortal={} buildingBounds={} envBounds={} buildingKey={} envKey={}",
        aperture.aperture_id,
        aperture.building_instance_id,
        aperture.building_portal_id,
        target_portal_index,
        format_env_aperture_summary(env_aperture),
        format_bounds(&bounds_for_points(&aperture.points)),
        format_bounds(&bounds_for_points(&env_aperture.points)),
        ordered_point_set_key(&aperture.points),
        ordered_point_set_key(&env_aperture.points),
    );
}

fn report_duplicate_building_transition_apertures(
    landblock_id: u32,
    apertures: &[holtburger_content::PreparedBuildingTransitionAperture],
) {
    let mut groups = BTreeMap::<String, Vec<BuildingTransitionApertureDump>>::new();
    for aperture in apertures {
        groups
            .entry(canonical_point_set_key(&aperture.points))
            .or_default()
            .push(BuildingTransitionApertureDump {
                aperture_id: aperture.aperture_id.clone(),
                building_instance_id: aperture.building_instance_id.clone(),
                building_portal_id: aperture.building_portal_id.clone(),
                flags: aperture.flags,
                linked_env_cell_ids: aperture.linked_env_cell_ids.clone(),
                other_cell_id: aperture.other_cell_id,
                other_portal_id: aperture.other_portal_id,
                points: aperture.points.clone(),
                poly_id: aperture.poly_id,
                portal_index: aperture.portal_index,
                source_did: aperture.source_did,
            });
    }

    let duplicate_groups = groups
        .values()
        .filter(|group| group.len() > 1)
        .collect::<Vec<_>>();
    println!(
        "duplicateBuildingTransitionApertureSummary landblock=0x{landblock_id:08x} buildingTransitionApertures={} duplicateGroups={}",
        apertures.len(),
        duplicate_groups.len()
    );
    for group in duplicate_groups {
        println!(
            "duplicateBuildingTransitionApertureGroup members={}",
            group.len()
        );
        for member in group {
            println!(
                "  aperture={} building={} portal={} portalIndex={} polyId={} sourceDid=0x{:08x} flags=0x{:04x} otherCell=0x{:04x} otherPortal=0x{:04x} linkedEnvCells={} orderedKey={}",
                member.aperture_id,
                member.building_instance_id,
                member.building_portal_id,
                member.portal_index,
                member.poly_id,
                member.source_did,
                member.flags,
                member.other_cell_id,
                member.other_portal_id,
                format_env_cell_ids(member.linked_env_cell_ids.iter().copied()),
                ordered_point_set_key(&member.points),
            );
        }
    }
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

fn report_duplicate_outside_transition_module_seams(
    landblock_id: u32,
    cells: &[holtburger_content::LandblockEnvCellBundleCell],
    building_portals_by_target: &BTreeMap<(u32, usize), Vec<BuildingPortalTargetDump>>,
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

    let seam_groups = groups
        .values()
        .filter(|group| {
            group.len() > 1
                && group.iter().all(|member| {
                    building_portals_by_target
                        .get(&(member.env_cell_id, extract_portal_index(&member.portal_id)))
                        .is_some_and(|portals| !portals.is_empty())
                })
        })
        .count();
    println!(
        "outsideTransitionModuleSeamSummary landblock=0x{landblock_id:08x} seamGroups={seam_groups}"
    );

    for group in groups.values().filter(|group| group.len() > 1) {
        let all_have_building_targets = group.iter().all(|member| {
            building_portals_by_target
                .get(&(member.env_cell_id, extract_portal_index(&member.portal_id)))
                .is_some_and(|portals| !portals.is_empty())
        });
        if !all_have_building_targets {
            continue;
        }
        println!("outsideTransitionModuleSeam members={}", group.len());
        for member in group {
            println!(
                "  envCell=0x{:08x} portal={} flags=0x{:04x}",
                member.env_cell_id, member.portal_id, member.flags
            );
            let building_portals = building_portals_by_target
                .get(&(member.env_cell_id, extract_portal_index(&member.portal_id)))
                .into_iter()
                .flatten();
            for portal in building_portals {
                println!(
                    "    building={} sourceDid=0x{:08x} sourceIndex={} portal={} flags=0x{:04x} linkedEnvCells={}",
                    portal.building_instance_id,
                    portal.source_did,
                    portal.source_index,
                    portal.building_portal_id,
                    portal.flags,
                    format_env_cell_ids(portal.linked_env_cell_ids.iter().copied()),
                );
            }
        }
    }
}

fn extract_portal_index(portal_id: &str) -> usize {
    portal_id
        .rsplit_once("/portal/")
        .and_then(|(_, index)| index.parse::<usize>().ok())
        .unwrap_or(usize::MAX)
}

#[derive(Debug)]
struct TransitionPortalApertureDump {
    env_cell_id: u32,
    flags: u16,
    portal_id: String,
}

#[derive(Debug)]
struct BuildingTransitionApertureDump {
    aperture_id: String,
    building_instance_id: String,
    building_portal_id: String,
    flags: u16,
    linked_env_cell_ids: Vec<u32>,
    other_cell_id: u16,
    other_portal_id: u16,
    points: Vec<PreparedVec3>,
    poly_id: u16,
    portal_index: i16,
    source_did: u32,
}

#[derive(Debug)]
struct BuildingPortalTargetDump {
    building_instance_id: String,
    building_portal_id: String,
    flags: u16,
    linked_env_cell_ids: Vec<u32>,
    source_did: u32,
    source_index: usize,
}

#[derive(Debug)]
struct EnvPortalSummary {
    flags: u16,
    is_outside_transition: bool,
    portal_id: String,
}

#[derive(Debug)]
struct EnvPortalApertureSummary {
    flags: u16,
    is_outside_transition: bool,
    points: Vec<PreparedVec3>,
    portal_id: String,
}

fn format_env_aperture_summary(aperture: &EnvPortalApertureSummary) -> String {
    format!(
        "{} flags=0x{:04x} outsideTransition={}",
        aperture.portal_id, aperture.flags, aperture.is_outside_transition
    )
}

fn bounds_for_points(points: &[PreparedVec3]) -> PreparedAabb {
    let mut min = PreparedVec3 {
        x: f32::INFINITY,
        y: f32::INFINITY,
        z: f32::INFINITY,
    };
    let mut max = PreparedVec3 {
        x: f32::NEG_INFINITY,
        y: f32::NEG_INFINITY,
        z: f32::NEG_INFINITY,
    };
    for point in points {
        min.x = min.x.min(point.x);
        min.y = min.y.min(point.y);
        min.z = min.z.min(point.z);
        max.x = max.x.max(point.x);
        max.y = max.y.max(point.y);
        max.z = max.z.max(point.z);
    }
    PreparedAabb { min, max }
}

fn canonical_point_set_key(points: &[PreparedVec3]) -> String {
    let mut point_keys = points.iter().map(canonical_point_key).collect::<Vec<_>>();
    point_keys.sort();
    point_keys.join("|")
}

fn ordered_point_set_key(points: &[PreparedVec3]) -> String {
    points
        .iter()
        .map(canonical_point_key)
        .collect::<Vec<_>>()
        .join("|")
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

fn format_bounds(bounds: &PreparedAabb) -> String {
    format!(
        "min=({:.3},{:.3},{:.3}) max=({:.3},{:.3},{:.3}) size=({:.3},{:.3},{:.3})",
        bounds.min.x,
        bounds.min.y,
        bounds.min.z,
        bounds.max.x,
        bounds.max.y,
        bounds.max.z,
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
    )
}
