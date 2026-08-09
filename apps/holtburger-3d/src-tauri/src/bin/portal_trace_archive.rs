use anyhow::{Context, ensure};
use holtburger_3d::{
    LandblockSourceLayer, discover_content_runtime, load_active_region_data_bytes,
    load_env_cell_source_record_bytes, load_landblock_source_batch_bytes,
    load_particle_emitter_bytes, load_physics_script_bytes,
};
use holtburger_content::{
    ContentRepository, LandblockInteriorSystemAsset, LandblockPortalEndpoint,
};
use holtburger_core::{ContentAsset, ContentAssetRequest};
use holtburger_dat::EOR_CELL_NAMESPACE;
use holtburger_dat::file_type::setup_model::AnimationHookPayload;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const CENSUS_CONCURRENCY: usize = 16;

/// One canonical source batch encoded for the browser-free TypeScript trace evaluator.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveTraceRecord {
    /// Closed production source batch used to derive content-preparation work.
    source_batch_hex: String,
    /// Canonical HBEC bytes; hex keeps stdout self-framing and dependency-free for Node.
    env_cell_record_hex: String,
    /// Landblock requested from the same production content adapter used by Tauri.
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
                    let result = runtime
                        .load(ContentAssetRequest::LandblockInteriorSystem(landblock_id))
                        .await
                        .with_context(|| {
                            format!("Could not load portal census landblock 0x{landblock_id:08X}")
                        });
                    (landblock_id, result)
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            let (landblock_id, result) = handle.await.context("Portal census worker panicked")?;
            match result {
                Ok(ContentAsset::LandblockInteriorSystem(Some(interior))) => {
                    landblocks.push(census_landblock(&interior)?);
                }
                Ok(ContentAsset::LandblockInteriorSystem(None)) => {
                    failures.push(PortalCensusFailure {
                        landblock_id: format!("0x{landblock_id:08x}"),
                        detail: "LandblockInfo index entry resolved without a CellLandblock."
                            .to_string(),
                    })
                }
                Ok(_) => unreachable!(
                    "LandblockInteriorSystem request must return a LandblockInteriorSystem"
                ),
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

fn census_landblock(
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
    })
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
