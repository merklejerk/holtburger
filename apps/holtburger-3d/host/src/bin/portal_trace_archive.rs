use anyhow::{Context, ensure};
use holtburger_3d_host::{
    LandblockSourceLayer, discover_content_runtime, load_active_region_data_bytes,
    load_env_cell_source_record_bytes, load_landblock_source_batch_bytes,
    load_particle_emitter_bytes, load_physics_script_bytes,
};
use holtburger_content::{
    ContentRepository, LandblockAsset, LandblockInteriorSystemAsset, LandblockPortalEndpoint,
};
use holtburger_core::{ContentAsset, ContentAssetRequest};
use holtburger_dat::EOR_CELL_NAMESPACE;
use holtburger_dat::file_type::setup_model::AnimationHookPayload;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const CENSUS_CONCURRENCY: usize = 16;
const FACILITY_HUB_LANDBLOCK_ID: u32 = 0x8a02_ffff;
const FACILITY_HUB_STAIRCASE_CELL_ID: u32 = 0x8a02_010c;
const FACILITY_HUB_ROOM_AFTER_DOOR_CELL_ID: u32 = 0x8a02_01c2;

/// One canonical source batch encoded for the browser-free TypeScript trace evaluator.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveTraceRecord {
    /// Closed production source batch used to derive content-preparation work.
    source_batch_hex: String,
    /// Canonical HBEC bytes; hex keeps stdout self-framing and dependency-free for Node.
    env_cell_record_hex: String,
    /// Landblock requested from the same production content adapter used by the app host.
    landblock_id: String,
}

/// Complete disposable archive input for one matched TypeScript trace run.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveTraceExport {
    /// Regional terrain/material facts needed by the production batch decoder.
    active_region_hex: String,
    /// Requested real-scene records in canonical argument order.
    records: Vec<ArchiveTraceRecord>,
}

/// One exact typed frontend asset used by the deterministic particle-runtime trace.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BehaviorTraceRecord {
    /// Canonical lowercase DAT id.
    id: String,
    /// Existing typed frontend record encoded as lowercase hex.
    record_hex: String,
}

/// Complete transitive behavior closure for the requested root physics scripts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BehaviorTraceExport {
    /// Every particle emitter referenced by the closed script graph.
    particle_emitters: Vec<BehaviorTraceRecord>,
    /// Every reachable physics script, including each requested root.
    physics_scripts: Vec<BehaviorTraceRecord>,
}

/// Archive-wide structural portal facts used to select real-scene trace strata.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortalCensusExport {
    /// Every landblock with an authored LandblockInfo record, ordered by landblock id.
    landblocks: Vec<PortalCensusLandblock>,
    /// Explicit content failures; Gate C cannot accept a census containing any entry here.
    failures: Vec<PortalCensusFailure>,
}

/// One landblock's renderer-independent interior topology and source-aperture density.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortalCensusLandblock {
    /// Outdoor landblock DID corresponding to the inspected LandblockInfo.
    landblock_id: String,
    /// Authored EnvCell count.
    env_cell_count: usize,
    /// Deduplicated Environment resource count retained by the interior system.
    environment_count: usize,
    /// Directed EnvCell portal record count.
    directed_portal_count: usize,
    /// Directed indoor-to-indoor portal count.
    internal_portal_count: usize,
    /// Directed indoor-to-outdoor transition count.
    outside_portal_count: usize,
    /// EnvCells containing at least one outdoor transition.
    outside_transition_cell_count: usize,
    /// Cells carrying the authored SeenOutside bit.
    seen_outside_cell_count: usize,
    /// Largest authored outgoing portal vector among the cells.
    maximum_outgoing_portal_count: usize,
    /// Largest shortest indoor crossing distance from any outdoor-transition cell.
    maximum_indoor_distance_from_outside: usize,
    /// Cells not reachable through internal crossings from any outdoor-transition cell.
    unreachable_from_outside_cell_count: usize,
    /// Sum of source polygon vertices over every directed portal.
    source_aperture_vertex_count: usize,
    /// Sum of fan-triangulated source aperture triangles over every directed portal.
    source_aperture_triangle_count: usize,
    /// Largest source polygon vertex count on one directed portal.
    maximum_source_aperture_vertex_count: usize,
    /// Raw authored visible-cell references, including malformed duplicates and dangling ids.
    authored_visible_reference_count: usize,
    /// Per-source effective PVS size after adding the source and deduplicating valid references.
    effective_pvs_cell_count: PortalCensusDistribution,
    /// Per-source size of the weak internal portal component containing that source.
    internal_component_cell_count: PortalCensusDistribution,
    /// Directed component portals retained when both endpoints belong to one source's effective PVS.
    pvs_retained_internal_portal_count: PortalCensusDistribution,
    /// Directed internal portals in each source's weak portal component before PVS filtering.
    internal_component_portal_count: PortalCensusDistribution,
    /// Authored visible-cell references that do not resolve to a resident EnvCell.
    dangling_visible_reference_count: usize,
    /// Repeated visible-cell references after their first occurrence in one source list.
    duplicate_visible_reference_count: usize,
    /// Source cells that explicitly include themselves in their authored visible list.
    self_visible_reference_count: usize,
    /// Directed internal portals whose target is absent from the source's effective PVS.
    immediate_neighbor_omission_count: usize,
    /// Replayable identity for every immediate-neighbor omission in this landblock.
    immediate_neighbor_omissions: Vec<PortalCensusCellPair>,
    /// Directed authored PVS references whose inverse reference is absent.
    asymmetric_visible_reference_count: usize,
    /// Named malformed pair retained only for the authoritative Facility Hub landblock.
    facility_hub_fixture: Option<FacilityHubPvsFixture>,
    /// Authored building transition records carrying a stab list.
    building_portal_count: usize,
    /// Raw authored building stab-list references.
    building_stab_reference_count: usize,
    /// Building stab-list references that do not resolve to a resident EnvCell.
    dangling_building_stab_reference_count: usize,
    /// Repeated building stab-list references after their first occurrence.
    duplicate_building_stab_reference_count: usize,
    /// Building portals whose stab list omits the portal's own target EnvCell.
    building_stab_missing_target_count: usize,
    /// Component cells omitted after adding the building portal target to its valid stab list.
    building_component_omission_count: usize,
    /// Per-building-portal effective candidate count after adding the target and deduplicating.
    effective_building_stab_cell_count: PortalCensusDistribution,
}

/// Exact integer order statistics retained without assigning guessed weights.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct PortalCensusDistribution {
    minimum: usize,
    median: usize,
    p90: usize,
    maximum: usize,
    total: usize,
}

/// One directed authored portal whose target is absent from the source PVS.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortalCensusCellPair {
    source_env_cell_id: String,
    target_env_cell_id: String,
}

/// Authoritative Facility Hub asymmetry identified from the ACE repro and current EOR archive.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FacilityHubPvsFixture {
    staircase_env_cell_id: String,
    room_after_door_env_cell_id: String,
    staircase_lists_room_after_door: bool,
    room_after_door_lists_staircase: bool,
    staircase_to_room_portal_distance: Option<usize>,
    room_to_staircase_portal_distance: Option<usize>,
}

struct PortalPvsCensus {
    authored_visible_reference_count: usize,
    effective_pvs_cell_count: PortalCensusDistribution,
    internal_component_cell_count: PortalCensusDistribution,
    pvs_retained_internal_portal_count: PortalCensusDistribution,
    internal_component_portal_count: PortalCensusDistribution,
    dangling_visible_reference_count: usize,
    duplicate_visible_reference_count: usize,
    self_visible_reference_count: usize,
    immediate_neighbor_omissions: Vec<PortalCensusCellPair>,
    asymmetric_visible_reference_count: usize,
    facility_hub_fixture: Option<FacilityHubPvsFixture>,
    building_portal_count: usize,
    building_stab_reference_count: usize,
    dangling_building_stab_reference_count: usize,
    duplicate_building_stab_reference_count: usize,
    building_stab_missing_target_count: usize,
    building_component_omission_count: usize,
    effective_building_stab_cell_count: PortalCensusDistribution,
}

/// One archive record that could not participate in the structural census.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortalCensusFailure {
    /// Outdoor landblock DID whose content failed.
    landblock_id: String,
    /// Full contextual failure retained for an actionable Gate C rejection.
    detail: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let landblock_ids = std::env::args().skip(1).collect::<Vec<_>>();
    ensure!(
        !landblock_ids.is_empty(),
        "usage: portal_trace_archive <landblock-id> [landblock-id ...]"
    );
    let runtime = discover_content_runtime()?;
    if landblock_ids
        .first()
        .is_some_and(|argument| argument == "--behavior")
    {
        let roots = landblock_ids.iter().skip(1).collect::<Vec<_>>();
        ensure!(
            !roots.is_empty(),
            "usage: portal_trace_archive --behavior <physics-script-id> [physics-script-id ...]"
        );
        println!(
            "{}",
            serde_json::to_string(&export_behavior(&runtime, roots).await?)?
        );
        return Ok(());
    }
    if landblock_ids
        .first()
        .is_some_and(|argument| argument == "--census")
    {
        ensure!(
            landblock_ids.len() == 1,
            "usage: portal_trace_archive --census"
        );
        println!(
            "{}",
            serde_json::to_string(&export_portal_census(&runtime).await?)?
        );
        return Ok(());
    }
    let active_region_hex = hex::encode(load_active_region_data_bytes(&runtime).await?);
    let mut records = Vec::with_capacity(landblock_ids.len());
    for landblock_id in landblock_ids {
        let bytes = load_env_cell_source_record_bytes(&runtime, &landblock_id)
            .await
            .with_context(|| format!("Could not export EnvCell topology for {landblock_id}"))?;
        let source_batch = load_landblock_source_batch_bytes(
            &runtime,
            &landblock_id,
            vec![
                LandblockSourceLayer::Terrain,
                LandblockSourceLayer::Buildings,
                LandblockSourceLayer::Objects,
                LandblockSourceLayer::Generated,
                LandblockSourceLayer::EnvCells,
            ],
        )
        .await
        .with_context(|| format!("Could not export scene workload for {landblock_id}"))?;
        records.push(ArchiveTraceRecord {
            env_cell_record_hex: hex::encode(bytes),
            landblock_id,
            source_batch_hex: hex::encode(source_batch),
        });
    }
    println!(
        "{}",
        serde_json::to_string(&ArchiveTraceExport {
            active_region_hex,
            records,
        })?
    );
    Ok(())
}

async fn export_portal_census(
    runtime: &holtburger_core::ContentAssetRuntime,
) -> anyhow::Result<PortalCensusExport> {
    let repository = ContentRepository::discover(None)?;
    let landblock_ids = repository
        .resource_index()
        .iter()
        .filter(|entry| {
            entry.namespace == EOR_CELL_NAMESPACE
                && entry.file_id & 0xffff == 0xfffe
                && !entry.is_pruned
        })
        .map(|entry| entry.file_id | 1)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut landblocks = Vec::with_capacity(landblock_ids.len());
    let mut failures = Vec::new();
    for chunk in landblock_ids.chunks(CENSUS_CONCURRENCY) {
        let handles = chunk
            .iter()
            .copied()
            .map(|landblock_id| {
                let runtime = runtime.clone();
                tokio::spawn(async move {
                    let result = load_census_landblock(&runtime, landblock_id).await;
                    (landblock_id, result)
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            let (landblock_id, result) = handle.await.context("Portal census worker panicked")?;
            match result {
                Ok(Some(record)) => landblocks.push(record),
                Ok(None) => failures.push(PortalCensusFailure {
                    landblock_id: format!("0x{landblock_id:08x}"),
                    detail: "LandblockInfo index entry resolved without a CellLandblock."
                        .to_string(),
                }),
                Err(error) => failures.push(PortalCensusFailure {
                    landblock_id: format!("0x{landblock_id:08x}"),
                    detail: format!("{error:#}"),
                }),
            }
        }
    }
    landblocks.sort_by_key(|record| record.landblock_id.clone());
    failures.sort_by_key(|record| record.landblock_id.clone());
    Ok(PortalCensusExport {
        landblocks,
        failures,
    })
}

async fn load_census_landblock(
    runtime: &holtburger_core::ContentAssetRuntime,
    landblock_id: u32,
) -> anyhow::Result<Option<PortalCensusLandblock>> {
    let landblock = runtime
        .load(ContentAssetRequest::Landblock(landblock_id))
        .await
        .with_context(|| format!("Could not load portal census landblock 0x{landblock_id:08X}"))?;
    let ContentAsset::Landblock(landblock) = landblock else {
        unreachable!("Landblock request must return a Landblock")
    };
    let Some(landblock) = landblock else {
        return Ok(None);
    };
    let interior = runtime
        .load(ContentAssetRequest::LandblockInteriorSystem(landblock_id))
        .await
        .with_context(|| format!("Could not load portal census interior 0x{landblock_id:08X}"))?;
    let ContentAsset::LandblockInteriorSystem(interior) = interior else {
        unreachable!("LandblockInteriorSystem request must return a LandblockInteriorSystem")
    };
    let interior = interior.with_context(|| {
        format!("Portal census landblock 0x{landblock_id:08X} lost its promised interior")
    })?;
    Ok(Some(census_landblock(&landblock, &interior)?))
}

fn census_landblock(
    landblock: &LandblockAsset,
    interior: &LandblockInteriorSystemAsset,
) -> anyhow::Result<PortalCensusLandblock> {
    let cells_by_id = interior
        .cells
        .iter()
        .map(|cell| (cell.env_cell_id, cell))
        .collect::<BTreeMap<_, _>>();
    let mut outgoing_counts = BTreeMap::<u32, usize>::new();
    let mut internal_targets = BTreeMap::<u32, Vec<u32>>::new();
    let mut outside_cells = BTreeSet::new();
    let mut internal_portal_count = 0;
    let mut outside_portal_count = 0;
    let mut source_aperture_vertex_count = 0;
    let mut source_aperture_triangle_count = 0;
    let mut maximum_source_aperture_vertex_count = 0;
    for portal in &interior.topology.portals {
        *outgoing_counts
            .entry(portal.source.env_cell_id)
            .or_default() += 1;
        match portal.endpoint {
            LandblockPortalEndpoint::Internal {
                target_env_cell_id, ..
            } => {
                internal_portal_count += 1;
                internal_targets
                    .entry(portal.source.env_cell_id)
                    .or_default()
                    .push(target_env_cell_id);
            }
            LandblockPortalEndpoint::Outside { .. } => {
                outside_portal_count += 1;
                outside_cells.insert(portal.source.env_cell_id);
            }
        }
        let cell = cells_by_id
            .get(&portal.source.env_cell_id)
            .with_context(|| {
                format!(
                    "Portal source EnvCell 0x{:08X} is unavailable",
                    portal.source.env_cell_id
                )
            })?;
        let environment = interior
            .environments
            .get(&cell.structure.environment_id)
            .with_context(|| {
                format!(
                    "EnvCell 0x{:08X} lost Environment 0x{:08X}",
                    cell.env_cell_id, cell.structure.environment_id
                )
            })?;
        let structure = environment
            .cells
            .get(&cell.structure.local_selector)
            .with_context(|| {
                format!(
                    "Environment 0x{:08X} lost CellStruct 0x{:04X}",
                    cell.structure.environment_id, cell.structure.local_selector
                )
            })?;
        let polygon = structure
            .polygons
            .get(&portal.polygon_id)
            .with_context(|| {
                format!(
                    "EnvCell 0x{:08X} portal {} lost polygon {}",
                    cell.env_cell_id, portal.source.portal_index, portal.polygon_id
                )
            })?;
        let vertex_count = polygon.vertex_ids.len();
        ensure!(
            vertex_count >= 3,
            "EnvCell 0x{:08X} portal {} polygon {} has fewer than three vertices",
            cell.env_cell_id,
            portal.source.portal_index,
            portal.polygon_id
        );
        source_aperture_vertex_count += vertex_count;
        source_aperture_triangle_count += vertex_count - 2;
        maximum_source_aperture_vertex_count =
            maximum_source_aperture_vertex_count.max(vertex_count);
    }
    let distances = indoor_distances_from_outside(&outside_cells, &internal_targets);
    let pvs = census_pvs(landblock, interior, &internal_targets);
    let immediate_neighbor_omission_count = pvs.immediate_neighbor_omissions.len();
    Ok(PortalCensusLandblock {
        landblock_id: format!("0x{:08x}", interior.landblock_id),
        env_cell_count: interior.cells.len(),
        environment_count: interior.environments.len(),
        directed_portal_count: interior.topology.portals.len(),
        internal_portal_count,
        outside_portal_count,
        outside_transition_cell_count: outside_cells.len(),
        seen_outside_cell_count: interior
            .cells
            .iter()
            .filter(|cell| cell.seen_outside)
            .count(),
        maximum_outgoing_portal_count: outgoing_counts.values().copied().max().unwrap_or(0),
        maximum_indoor_distance_from_outside: distances.values().copied().max().unwrap_or(0),
        unreachable_from_outside_cell_count: interior
            .cells
            .iter()
            .filter(|cell| !distances.contains_key(&cell.env_cell_id))
            .count(),
        source_aperture_vertex_count,
        source_aperture_triangle_count,
        maximum_source_aperture_vertex_count,
        authored_visible_reference_count: pvs.authored_visible_reference_count,
        effective_pvs_cell_count: pvs.effective_pvs_cell_count,
        internal_component_cell_count: pvs.internal_component_cell_count,
        pvs_retained_internal_portal_count: pvs.pvs_retained_internal_portal_count,
        internal_component_portal_count: pvs.internal_component_portal_count,
        dangling_visible_reference_count: pvs.dangling_visible_reference_count,
        duplicate_visible_reference_count: pvs.duplicate_visible_reference_count,
        self_visible_reference_count: pvs.self_visible_reference_count,
        immediate_neighbor_omission_count,
        immediate_neighbor_omissions: pvs.immediate_neighbor_omissions,
        asymmetric_visible_reference_count: pvs.asymmetric_visible_reference_count,
        facility_hub_fixture: pvs.facility_hub_fixture,
        building_portal_count: pvs.building_portal_count,
        building_stab_reference_count: pvs.building_stab_reference_count,
        dangling_building_stab_reference_count: pvs.dangling_building_stab_reference_count,
        duplicate_building_stab_reference_count: pvs.duplicate_building_stab_reference_count,
        building_stab_missing_target_count: pvs.building_stab_missing_target_count,
        building_component_omission_count: pvs.building_component_omission_count,
        effective_building_stab_cell_count: pvs.effective_building_stab_cell_count,
    })
}

fn census_pvs(
    landblock: &LandblockAsset,
    interior: &LandblockInteriorSystemAsset,
    internal_targets: &BTreeMap<u32, Vec<u32>>,
) -> PortalPvsCensus {
    let cell_ids = interior
        .cells
        .iter()
        .map(|cell| cell.env_cell_id)
        .collect::<BTreeSet<_>>();
    let mut authored_by_cell = BTreeMap::<u32, BTreeSet<u32>>::new();
    let mut effective_by_cell = BTreeMap::<u32, BTreeSet<u32>>::new();
    let mut authored_visible_reference_count = 0;
    let mut dangling_visible_reference_count = 0;
    let mut duplicate_visible_reference_count = 0;
    let mut self_visible_reference_count = 0;
    for cell in &interior.cells {
        authored_visible_reference_count += cell.visible_cell_ids.len();
        let mut authored = BTreeSet::new();
        for target in &cell.visible_cell_ids {
            if !authored.insert(*target) {
                duplicate_visible_reference_count += 1;
                continue;
            }
            if *target == cell.env_cell_id {
                self_visible_reference_count += 1;
            }
            if !cell_ids.contains(target) {
                dangling_visible_reference_count += 1;
            }
        }
        let mut effective = authored
            .iter()
            .filter(|target| cell_ids.contains(target))
            .copied()
            .collect::<BTreeSet<_>>();
        effective.insert(cell.env_cell_id);
        authored_by_cell.insert(cell.env_cell_id, authored);
        effective_by_cell.insert(cell.env_cell_id, effective);
    }

    let component_by_cell = internal_components(&cell_ids, internal_targets);
    let mut component_members = BTreeMap::<u32, BTreeSet<u32>>::new();
    for (cell_id, component_id) in &component_by_cell {
        component_members
            .entry(*component_id)
            .or_default()
            .insert(*cell_id);
    }
    let mut component_portal_counts = BTreeMap::<u32, usize>::new();
    for (source, targets) in internal_targets {
        let component_id = component_by_cell[source];
        for target in targets {
            if component_by_cell.get(target) == Some(&component_id) {
                *component_portal_counts.entry(component_id).or_default() += 1;
            }
        }
    }

    let mut effective_pvs_cell_counts = Vec::with_capacity(interior.cells.len());
    let mut internal_component_cell_counts = Vec::with_capacity(interior.cells.len());
    let mut retained_internal_portal_counts = Vec::with_capacity(interior.cells.len());
    let mut internal_component_portal_counts = Vec::with_capacity(interior.cells.len());
    for cell in &interior.cells {
        let effective = &effective_by_cell[&cell.env_cell_id];
        let component_id = component_by_cell[&cell.env_cell_id];
        effective_pvs_cell_counts.push(effective.len());
        internal_component_cell_counts.push(component_members[&component_id].len());
        retained_internal_portal_counts.push(
            effective
                .iter()
                .map(|source| {
                    internal_targets
                        .get(source)
                        .into_iter()
                        .flatten()
                        .filter(|target| effective.contains(target))
                        .count()
                })
                .sum(),
        );
        internal_component_portal_counts.push(
            component_portal_counts
                .get(&component_id)
                .copied()
                .unwrap_or(0),
        );
    }

    let mut immediate_neighbor_omissions = Vec::new();
    for (source, targets) in internal_targets {
        let effective = &effective_by_cell[source];
        for target in targets {
            if !effective.contains(target) {
                immediate_neighbor_omissions.push(PortalCensusCellPair {
                    source_env_cell_id: format!("0x{source:08x}"),
                    target_env_cell_id: format!("0x{target:08x}"),
                });
            }
        }
    }
    immediate_neighbor_omissions.sort_by(|left, right| {
        left.source_env_cell_id
            .cmp(&right.source_env_cell_id)
            .then_with(|| left.target_env_cell_id.cmp(&right.target_env_cell_id))
    });
    let mut asymmetric_visible_reference_count = 0;
    for (source, targets) in &authored_by_cell {
        for target in targets {
            if *target == *source
                || authored_by_cell
                    .get(target)
                    .is_none_or(|inverse| inverse.contains(source))
            {
                continue;
            }
            asymmetric_visible_reference_count += 1;
        }
    }
    let facility_hub_fixture = (landblock.landblock_id == FACILITY_HUB_LANDBLOCK_ID).then(|| {
        let staircase = &authored_by_cell[&FACILITY_HUB_STAIRCASE_CELL_ID];
        let room_after_door = &authored_by_cell[&FACILITY_HUB_ROOM_AFTER_DOOR_CELL_ID];
        FacilityHubPvsFixture {
            staircase_env_cell_id: format!("0x{FACILITY_HUB_STAIRCASE_CELL_ID:08x}"),
            room_after_door_env_cell_id: format!("0x{FACILITY_HUB_ROOM_AFTER_DOOR_CELL_ID:08x}"),
            staircase_lists_room_after_door: staircase
                .contains(&FACILITY_HUB_ROOM_AFTER_DOOR_CELL_ID),
            room_after_door_lists_staircase: room_after_door
                .contains(&FACILITY_HUB_STAIRCASE_CELL_ID),
            staircase_to_room_portal_distance: shortest_portal_distance(
                internal_targets,
                FACILITY_HUB_STAIRCASE_CELL_ID,
                FACILITY_HUB_ROOM_AFTER_DOOR_CELL_ID,
            ),
            room_to_staircase_portal_distance: shortest_portal_distance(
                internal_targets,
                FACILITY_HUB_ROOM_AFTER_DOOR_CELL_ID,
                FACILITY_HUB_STAIRCASE_CELL_ID,
            ),
        }
    });

    let mut building_portal_count = 0;
    let mut building_stab_reference_count = 0;
    let mut dangling_building_stab_reference_count = 0;
    let mut duplicate_building_stab_reference_count = 0;
    let mut building_stab_missing_target_count = 0;
    let mut building_component_omission_count = 0;
    let mut effective_building_stab_cell_counts = Vec::new();
    for portal in landblock
        .buildings
        .iter()
        .flat_map(|building| &building.portals)
    {
        building_portal_count += 1;
        building_stab_reference_count += portal.linked_env_cell_ids.len();
        let mut authored = BTreeSet::new();
        for target in &portal.linked_env_cell_ids {
            if !authored.insert(*target) {
                duplicate_building_stab_reference_count += 1;
                continue;
            }
            if !cell_ids.contains(target) {
                dangling_building_stab_reference_count += 1;
            }
        }
        let target_env_cell_id =
            (landblock.landblock_id & 0xffff_0000) | u32::from(portal.other_cell_id);
        if !authored.contains(&target_env_cell_id) {
            building_stab_missing_target_count += 1;
        }
        let mut effective = authored
            .iter()
            .filter(|target| cell_ids.contains(target))
            .copied()
            .collect::<BTreeSet<_>>();
        if cell_ids.contains(&target_env_cell_id) {
            effective.insert(target_env_cell_id);
            let component_id = component_by_cell[&target_env_cell_id];
            building_component_omission_count += component_members[&component_id]
                .iter()
                .filter(|cell_id| !effective.contains(cell_id))
                .count();
        }
        effective_building_stab_cell_counts.push(effective.len());
    }

    PortalPvsCensus {
        authored_visible_reference_count,
        effective_pvs_cell_count: census_distribution(effective_pvs_cell_counts),
        internal_component_cell_count: census_distribution(internal_component_cell_counts),
        pvs_retained_internal_portal_count: census_distribution(retained_internal_portal_counts),
        internal_component_portal_count: census_distribution(internal_component_portal_counts),
        dangling_visible_reference_count,
        duplicate_visible_reference_count,
        self_visible_reference_count,
        immediate_neighbor_omissions,
        asymmetric_visible_reference_count,
        facility_hub_fixture,
        building_portal_count,
        building_stab_reference_count,
        dangling_building_stab_reference_count,
        duplicate_building_stab_reference_count,
        building_stab_missing_target_count,
        building_component_omission_count,
        effective_building_stab_cell_count: census_distribution(
            effective_building_stab_cell_counts,
        ),
    }
}

fn internal_components(
    cell_ids: &BTreeSet<u32>,
    internal_targets: &BTreeMap<u32, Vec<u32>>,
) -> BTreeMap<u32, u32> {
    let mut parents = cell_ids
        .iter()
        .map(|cell_id| (*cell_id, *cell_id))
        .collect::<BTreeMap<_, _>>();
    for (source, targets) in internal_targets {
        for target in targets {
            let source_root = component_root(&parents, *source);
            let target_root = component_root(&parents, *target);
            if source_root == target_root {
                continue;
            }
            let first = source_root.min(target_root);
            let second = source_root.max(target_root);
            parents.insert(second, first);
        }
    }
    cell_ids
        .iter()
        .map(|cell_id| (*cell_id, component_root(&parents, *cell_id)))
        .collect()
}

fn component_root(parents: &BTreeMap<u32, u32>, cell_id: u32) -> u32 {
    let mut root = cell_id;
    loop {
        let parent = parents[&root];
        if parent == root {
            return root;
        }
        root = parent;
    }
}

fn shortest_portal_distance(
    internal_targets: &BTreeMap<u32, Vec<u32>>,
    source: u32,
    target: u32,
) -> Option<usize> {
    let mut visited = BTreeSet::from([source]);
    let mut pending = VecDeque::from([(source, 0)]);
    while let Some((cell_id, distance)) = pending.pop_front() {
        if cell_id == target {
            return Some(distance);
        }
        for neighbor in internal_targets.get(&cell_id).into_iter().flatten() {
            if visited.insert(*neighbor) {
                pending.push_back((*neighbor, distance + 1));
            }
        }
    }
    None
}

fn census_distribution(mut values: Vec<usize>) -> PortalCensusDistribution {
    if values.is_empty() {
        return PortalCensusDistribution::default();
    }
    values.sort_unstable();
    let last = values.len() - 1;
    PortalCensusDistribution {
        minimum: values[0],
        median: values[last / 2],
        p90: values[last * 90 / 100],
        maximum: values[last],
        total: values.iter().sum(),
    }
}

fn indoor_distances_from_outside(
    roots: &BTreeSet<u32>,
    targets: &BTreeMap<u32, Vec<u32>>,
) -> BTreeMap<u32, usize> {
    let mut distances = BTreeMap::new();
    let mut pending = VecDeque::new();
    for root in roots {
        distances.insert(*root, 0);
        pending.push_back(*root);
    }
    while let Some(source) = pending.pop_front() {
        let next_distance = distances[&source] + 1;
        for target in targets.get(&source).into_iter().flatten() {
            if distances.contains_key(target) {
                continue;
            }
            distances.insert(*target, next_distance);
            pending.push_back(*target);
        }
    }
    distances
}

async fn export_behavior(
    runtime: &holtburger_core::ContentAssetRuntime,
    roots: Vec<&String>,
) -> anyhow::Result<BehaviorTraceExport> {
    let mut pending = roots
        .into_iter()
        .map(|root| parse_dat_id(root, 0x33))
        .collect::<anyhow::Result<BTreeSet<_>>>()?;
    let mut visited = BTreeSet::new();
    let mut emitter_ids = BTreeSet::new();
    while let Some(script_id) = pending.pop_first() {
        if !visited.insert(script_id) {
            continue;
        }
        let asset = runtime
            .load(ContentAssetRequest::PhysicsScript(script_id))
            .await
            .with_context(|| format!("Could not inspect PhysicsScript 0x{script_id:08X}"))?;
        let ContentAsset::PhysicsScript(script) = asset else {
            unreachable!("PhysicsScript request must return a PhysicsScript")
        };
        for record in &script.records {
            match &record.hook.payload {
                AnimationHookPayload::CallPes(call) if !visited.contains(&call.script_id) => {
                    pending.insert(call.script_id);
                }
                AnimationHookPayload::CallPes(_) => {}
                AnimationHookPayload::CreateParticle(particle) => {
                    emitter_ids.insert(particle.emitter_info_id);
                }
                _ => {}
            }
        }
    }
    let mut physics_scripts = Vec::with_capacity(visited.len());
    for script_id in visited {
        let id = format!("0x{script_id:08x}");
        physics_scripts.push(BehaviorTraceRecord {
            record_hex: hex::encode(load_physics_script_bytes(runtime, &id).await?),
            id,
        });
    }
    let mut particle_emitters = Vec::with_capacity(emitter_ids.len());
    for emitter_id in emitter_ids {
        let id = format!("0x{emitter_id:08x}");
        particle_emitters.push(BehaviorTraceRecord {
            record_hex: hex::encode(load_particle_emitter_bytes(runtime, &id).await?),
            id,
        });
    }
    Ok(BehaviorTraceExport {
        particle_emitters,
        physics_scripts,
    })
}

fn parse_dat_id(raw: &str, expected_family: u32) -> anyhow::Result<u32> {
    let hexadecimal = raw
        .strip_prefix("0x")
        .or_else(|| raw.strip_prefix("0X"))
        .unwrap_or(raw);
    ensure!(
        hexadecimal.len() == 8
            && hexadecimal
                .chars()
                .all(|character| character.is_ascii_hexdigit()),
        "DAT id must contain exactly eight hexadecimal digits"
    );
    let id = u32::from_str_radix(hexadecimal, 16).context("DAT id is not hexadecimal")?;
    ensure!(
        id >> 24 == expected_family,
        "DAT id must identify family 0x{expected_family:02X}"
    );
    Ok(id)
}
