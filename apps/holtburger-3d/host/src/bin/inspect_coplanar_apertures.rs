//! Census of coplanar, screen-overlapping portal apertures within one landblock interior system.
//!
//! The portal compositor resolves per-pixel arrival state with a single depth-tested propagation
//! draw over every selected crossing, and each crossing additionally tests itself against its
//! source scope's local opaque depth. Both comparisons are ties when two apertures share a plane,
//! so this tool reports every same-source-scope coplanar overlap the authored data actually
//! contains, together with the `has_render_surface` fact that currently picks the equal-depth
//! policy.

use std::collections::BTreeMap;
use std::sync::Arc;

use anyhow::{Context, Result};
use holtburger_3d_host::cell_struct_projection::{
    CellStructProjection, CellStructProjectionContext, project_cell_struct,
};
use holtburger_3d_host::discover_content_runtime;
use holtburger_3d_host::gfx_obj_geometry::build_gfx_obj_portal_apertures;
use holtburger_3d_host::interior_seam::{
    IndoorSeamClassification, IndoorSeamEvidence, classify_indoor_seam,
};
use holtburger_3d_host::polygon_geometry::RenderVec3;
use holtburger_3d_host::portal_geometry::accepted_plane_side;
use holtburger_3d_host::portal_geometry::{PortalAperture, transform_aperture};
use holtburger_3d_host::portal_visibility::apertures_form_junction;
use holtburger_content::{LandblockAsset, LandblockInteriorSystemAsset, LandblockPortalEndpoint};
use holtburger_core::{ContentAsset, ContentAssetRequest, ContentAssetRuntime};

/// Distance tolerance, in authored landblock units, for treating two parallel planes as identical.
const PLANE_OFFSET_EPSILON: f32 = 0.05;

/// One directed crossing reduced to the facts the depth-tie question needs.
#[derive(Debug, Clone)]
struct CrossingRecord {
    /// Scope the crossing is rasterized from: `None` is the outdoor render domain.
    source_scope: Option<u32>,
    /// Scope the crossing arrives in: `None` is the outdoor render domain.
    target_scope: Option<u32>,
    /// Human-readable authored identity.
    label: String,
    /// Whether the aperture polygon also contributes a material-bearing shell side, which is the
    /// sole input to today's equal-depth mask policy.
    has_render_surface: bool,
    /// Authored aperture transformed into landblock space.
    aperture: PortalAperture,
}

#[tokio::main]
async fn main() -> Result<()> {
    let landblock_id = match std::env::args().nth(1) {
        Some(argument) => {
            let trimmed = argument.trim_start_matches("0x");
            let parsed = u32::from_str_radix(trimmed, 16)
                .with_context(|| format!("could not parse landblock id {argument}"))?;
            if parsed & 0xffff == 0 {
                parsed | 0xffff
            } else {
                parsed
            }
        }
        None => 0xf418_ffff,
    };

    let runtime = discover_content_runtime()?;
    let (landblock, interior) = load_landblock(&runtime, landblock_id).await?;
    let projections = project_cells(&interior)?;
    let crossings = collect_crossings(&runtime, &landblock, &interior, &projections).await?;
    let islands = resolve_render_domains(&interior, &projections)?;

    report_scopes(&interior, &projections);
    report_crossings(&crossings);
    report_coplanar_pairs(&crossings);
    report_coincident_groups(&crossings);
    report_recurrence_preconditions(&crossings, &islands);
    Ok(())
}

async fn load_landblock(
    runtime: &ContentAssetRuntime,
    landblock_id: u32,
) -> Result<(Arc<LandblockAsset>, Arc<LandblockInteriorSystemAsset>)> {
    let ContentAsset::Landblock(landblock) = runtime
        .load(ContentAssetRequest::Landblock(landblock_id))
        .await
        .with_context(|| format!("could not load landblock 0x{landblock_id:08X}"))?
    else {
        unreachable!("Landblock request must return a Landblock")
    };
    let landblock =
        landblock.with_context(|| format!("landblock 0x{landblock_id:08X} has no record"))?;
    let ContentAsset::LandblockInteriorSystem(interior) = runtime
        .load(ContentAssetRequest::LandblockInteriorSystem(landblock_id))
        .await
        .with_context(|| format!("could not load interior 0x{landblock_id:08X}"))?
    else {
        unreachable!("LandblockInteriorSystem request must return a LandblockInteriorSystem")
    };
    let interior =
        interior.with_context(|| format!("landblock 0x{landblock_id:08X} has no interior"))?;
    Ok((landblock, interior))
}

fn project_cells(
    interior: &LandblockInteriorSystemAsset,
) -> Result<BTreeMap<u32, CellStructProjection>> {
    let mut projections = BTreeMap::new();
    for cell in &interior.cells {
        let environment = interior
            .environments
            .get(&cell.structure.environment_id)
            .with_context(|| {
                format!(
                    "EnvCell 0x{:08X} names absent Environment 0x{:08X}",
                    cell.env_cell_id, cell.structure.environment_id
                )
            })?;
        let cell_struct = environment
            .cells
            .get(&cell.structure.local_selector)
            .with_context(|| {
                format!(
                    "Environment 0x{:08X} has no CellStruct 0x{:04X}",
                    environment.id, cell.structure.local_selector
                )
            })?;
        let projection = project_cell_struct(
            CellStructProjectionContext {
                landblock_id: interior.landblock_id,
                env_cell_id: cell.env_cell_id,
                environment_id: environment.id,
                cell_structure_id: cell.structure.local_selector,
                surface_count: cell.surface_ids.len(),
            },
            cell_struct,
        )?;
        projections.insert(cell.env_cell_id, projection);
    }
    Ok(projections)
}

async fn collect_crossings(
    runtime: &ContentAssetRuntime,
    landblock: &LandblockAsset,
    interior: &LandblockInteriorSystemAsset,
    projections: &BTreeMap<u32, CellStructProjection>,
) -> Result<Vec<CrossingRecord>> {
    let placements = interior
        .cells
        .iter()
        .map(|cell| (cell.env_cell_id, cell.placement))
        .collect::<BTreeMap<_, _>>();
    let mut crossings = Vec::new();
    for portal in &interior.topology.portals {
        let source_cell = portal.source.env_cell_id;
        let projection = &projections[&source_cell];
        let selected = projection
            .apertures
            .iter()
            .find(|aperture| aperture.polygon_id == portal.polygon_id)
            .with_context(|| {
                format!(
                    "EnvCell 0x{source_cell:08X} portal polygon {} has no aperture",
                    portal.polygon_id
                )
            })?;
        let aperture = transform_aperture(&selected.aperture, placements[&source_cell])?;
        let (target_scope, kind) = match &portal.endpoint {
            LandblockPortalEndpoint::Internal {
                target_env_cell_id,
                validated_target,
                ..
            } => (
                Some(*target_env_cell_id),
                format!(
                    "internal->0x{target_env_cell_id:08X}{}",
                    if validated_target.is_some() {
                        ""
                    } else {
                        " (unvalidated)"
                    }
                ),
            ),
            LandblockPortalEndpoint::Outside { .. } => (None, "outside".to_owned()),
        };
        crossings.push(CrossingRecord {
            source_scope: Some(source_cell),
            target_scope,
            label: format!(
                "envcell 0x{source_cell:08X} portal {} poly {} flags 0x{:04X} {kind}",
                portal.source.portal_index, portal.polygon_id, portal.flags
            ),
            has_render_surface: selected.has_render_surface,
            aperture,
        });

        let LandblockPortalEndpoint::Outside {
            building_portal: Some(building_ref),
            ..
        } = &portal.endpoint
        else {
            continue;
        };
        let building = &landblock.buildings[building_ref.building_index];
        let ContentAsset::GfxObj(gfx_obj) = runtime
            .load(ContentAssetRequest::GfxObj(building.source_did))
            .await
            .with_context(|| {
                format!(
                    "could not load building GfxObj 0x{:08X}",
                    building.source_did
                )
            })?
        else {
            unreachable!("GfxObj request must return a GfxObj")
        };
        let projected = build_gfx_obj_portal_apertures(&gfx_obj)?;
        let selected_building = projected
            .iter()
            .find(|aperture| aperture.portal_index == building_ref.portal_index)
            .with_context(|| {
                format!(
                    "building GfxObj 0x{:08X} has no portal aperture {}",
                    building.source_did, building_ref.portal_index
                )
            })?;
        crossings.push(CrossingRecord {
            source_scope: None,
            target_scope: Some(source_cell),
            label: format!(
                "building {} (0x{:08X}) portal {} -> 0x{source_cell:08X}",
                building_ref.building_index, building.source_did, building_ref.portal_index
            ),
            has_render_surface: selected_building.has_drawing_bsp_node_polygon,
            aperture: transform_aperture(&selected_building.aperture, building.placement)?,
        });
    }
    Ok(crossings)
}

fn report_scopes(
    interior: &LandblockInteriorSystemAsset,
    projections: &BTreeMap<u32, CellStructProjection>,
) {
    println!(
        "landblock 0x{:08X}: cells={} portals={}",
        interior.landblock_id,
        interior.cells.len(),
        interior.topology.portals.len()
    );
    for cell in &interior.cells {
        let projection = &projections[&cell.env_cell_id];
        println!(
            "  cell 0x{:08X} env=0x{:08X}/{:04X} apertures={} shellTriangles={} seenOutside={}",
            cell.env_cell_id,
            cell.structure.environment_id,
            cell.structure.local_selector,
            projection.apertures.len(),
            projection.shell.triangles.len(),
            cell.seen_outside,
        );
    }
}

fn report_crossings(crossings: &[CrossingRecord]) {
    println!("\ncrossings ({}):", crossings.len());
    for crossing in crossings {
        let center = aperture_center(&crossing.aperture);
        println!(
            "  [{}] {} plane=({:.4},{:.4},{:.4}|{:.4}) center=({:.2},{:.2},{:.2}) renderSurface={} policy={}",
            scope_label(crossing.source_scope),
            crossing.label,
            crossing.aperture.plane.normal.x,
            crossing.aperture.plane.normal.y,
            crossing.aperture.plane.normal.z,
            crossing.aperture.plane.d,
            center.x,
            center.y,
            center.z,
            crossing.has_render_surface,
            if crossing.has_render_surface {
                "reject-equal-depth"
            } else {
                "allow-equal-depth"
            },
        );
    }
}

fn report_coplanar_pairs(crossings: &[CrossingRecord]) {
    let mut same_scope = 0usize;
    let mut cross_scope = 0usize;
    for left in 0..crossings.len() {
        for right in (left + 1)..crossings.len() {
            let (a, b) = (&crossings[left], &crossings[right]);
            if !apertures_form_junction(&a.aperture, &b.aperture).expect("junction predicate") {
                continue;
            }
            if a.source_scope == b.source_scope {
                same_scope += 1;
            } else {
                cross_scope += 1;
            }
        }
    }
    println!(
        "\ncoplanar overlapping pairs: sameSourceScope={same_scope} crossSourceScope={cross_scope}"
    );
}

/// Report crossings that occupy the *same* authored aperture footprint, not merely the same plane.
///
/// A group larger than one means two directed crossings are geometrically indistinguishable, so
/// every depth comparison between them is an exact tie and any scope transit between them is
/// zero-thickness.
fn report_coincident_groups(crossings: &[CrossingRecord]) {
    let mut groups = BTreeMap::<(i64, i64, i64, i64, i64, i64), Vec<&CrossingRecord>>::new();
    for crossing in crossings {
        let bounds = crossing.aperture.bounds;
        // Quantize to the plane-offset tolerance so authored duplicates land in one bucket.
        let quantize = |value: f32| (f64::from(value) / f64::from(PLANE_OFFSET_EPSILON)) as i64;
        groups
            .entry((
                quantize(bounds.min.x),
                quantize(bounds.min.y),
                quantize(bounds.min.z),
                quantize(bounds.max.x),
                quantize(bounds.max.y),
                quantize(bounds.max.z),
            ))
            .or_default()
            .push(crossing);
    }

    let coincident = groups
        .values()
        .filter(|group| group.len() > 1)
        .collect::<Vec<_>>();
    println!("\ncoincident aperture footprints ({}):", coincident.len());
    for group in coincident {
        let center = aperture_center(&group[0].aperture);
        let scopes = group
            .iter()
            .map(|crossing| scope_label(crossing.source_scope))
            .collect::<Vec<_>>();
        let distinct_scopes = scopes.iter().collect::<std::collections::BTreeSet<_>>();
        println!(
            "  center=({:.2},{:.2},{:.2}) crossings={} distinctSourceScopes={}",
            center.x,
            center.y,
            center.z,
            group.len(),
            distinct_scopes.len(),
        );
        for crossing in group {
            println!(
                "      [{}] -> [{}]  {}  renderSurface={}",
                scope_label(crossing.source_scope),
                scope_label(crossing.target_scope),
                crossing.label,
                crossing.has_render_surface,
            );
        }
    }
}

fn aperture_center(aperture: &PortalAperture) -> RenderVec3 {
    RenderVec3 {
        x: (aperture.bounds.min.x + aperture.bounds.max.x) * 0.5,
        y: (aperture.bounds.min.y + aperture.bounds.max.y) * 0.5,
        z: (aperture.bounds.min.z + aperture.bounds.max.z) * 0.5,
    }
}

fn scope_label(scope: Option<u32>) -> String {
    match scope {
        Some(cell) => format!("0x{cell:08X}"),
        None => "outdoor".to_owned(),
    }
}

/// Render-domain identity for each authored scope: `None` (outdoor) plus every EnvCell island.
///
/// Depth-continuous indoor seams collapse their cells into one render domain, which is the unit the
/// propagation shader's entry test actually compares against.
struct RenderDomains {
    /// Island representative per EnvCell id; outdoor is its own domain and never merges.
    representative_by_cell: BTreeMap<u32, u32>,
}

impl RenderDomains {
    fn domain(&self, scope: Option<u32>) -> Option<u32> {
        scope.map(|cell| self.representative_by_cell[&cell])
    }

    fn label(&self, scope: Option<u32>) -> String {
        match self.domain(scope) {
            Some(representative) => format!("island@0x{representative:08X}"),
            None => "outdoor".to_owned(),
        }
    }
}

fn resolve_render_domains(
    interior: &LandblockInteriorSystemAsset,
    projections: &BTreeMap<u32, CellStructProjection>,
) -> Result<RenderDomains> {
    let mut representative_by_cell = interior
        .cells
        .iter()
        .map(|cell| (cell.env_cell_id, cell.env_cell_id))
        .collect::<BTreeMap<_, _>>();
    // Iterative pointer chase; the cell count per landblock keeps this trivially cheap.
    fn find(map: &BTreeMap<u32, u32>, mut cell: u32) -> u32 {
        while map[&cell] != cell {
            cell = map[&cell];
        }
        cell
    }

    let placements = interior
        .cells
        .iter()
        .map(|cell| (cell.env_cell_id, cell.placement))
        .collect::<BTreeMap<_, _>>();
    // LandblockEnvCellPortalRef is not Ord, so index on its component fields instead.
    let portals_by_ref = interior
        .topology
        .portals
        .iter()
        .map(|portal| {
            (
                (portal.source.env_cell_id, portal.source.portal_index),
                portal,
            )
        })
        .collect::<BTreeMap<_, _>>();

    for portal in &interior.topology.portals {
        let LandblockPortalEndpoint::Internal {
            validated_target: Some(target_ref),
            ..
        } = portal.endpoint
        else {
            continue;
        };
        let target_portal = portals_by_ref[&(target_ref.env_cell_id, target_ref.portal_index)];
        let source_cell = portal.source.env_cell_id;
        let target_cell = target_ref.env_cell_id;
        let source_aperture =
            transformed_aperture(projections, &placements, source_cell, portal.polygon_id)?;
        let target_aperture = transformed_aperture(
            projections,
            &placements,
            target_cell,
            target_portal.polygon_id,
        )?;
        let classification = classify_indoor_seam(IndoorSeamEvidence {
            reciprocal_identity_proven: true,
            source_exact_match: (portal.flags & 0x01) != 0,
            target_exact_match: (target_portal.flags & 0x01) != 0,
            source_aperture: &source_aperture,
            target_aperture: &target_aperture,
            source_accepted_side: accepted_plane_side(portal.flags),
            target_accepted_side: accepted_plane_side(target_portal.flags),
            source_cell_bounds: projections[&source_cell].shell.bounds,
            target_cell_bounds: projections[&target_cell].shell.bounds,
        });
        if classification != IndoorSeamClassification::DepthContinuous {
            continue;
        }
        let source_root = find(&representative_by_cell, source_cell);
        let target_root = find(&representative_by_cell, target_cell);
        if source_root != target_root {
            let (keep, merge) = if source_root < target_root {
                (source_root, target_root)
            } else {
                (target_root, source_root)
            };
            representative_by_cell.insert(merge, keep);
        }
    }

    let resolved = representative_by_cell
        .keys()
        .map(|cell| (*cell, find(&representative_by_cell, *cell)))
        .collect();
    Ok(RenderDomains {
        representative_by_cell: resolved,
    })
}

fn transformed_aperture(
    projections: &BTreeMap<u32, CellStructProjection>,
    placements: &BTreeMap<u32, holtburger_content::LandblockPlacement>,
    env_cell_id: u32,
    polygon_id: u16,
) -> Result<PortalAperture> {
    let selected = projections[&env_cell_id]
        .apertures
        .iter()
        .find(|aperture| aperture.polygon_id == polygon_id)
        .with_context(|| {
            format!("EnvCell 0x{env_cell_id:08X} polygon {polygon_id} has no aperture")
        })?;
    transform_aperture(&selected.aperture, placements[&env_cell_id])
}

/// Report the only shape that could make a crossing recur once equal-depth advances are admitted:
/// one render domain owning two outgoing crossings whose apertures are coplanar and share interior
/// area. Without such a pair, no pixel can leave a domain twice at the same depth.
fn report_recurrence_preconditions(crossings: &[CrossingRecord], domains: &RenderDomains) {
    let mut by_domain = BTreeMap::<String, Vec<&CrossingRecord>>::new();
    for crossing in crossings {
        by_domain
            .entry(domains.label(crossing.source_scope))
            .or_default()
            .push(crossing);
    }

    let mut findings = Vec::new();
    for (domain, outgoing) in &by_domain {
        for left in 0..outgoing.len() {
            for right in (left + 1)..outgoing.len() {
                let (a, b) = (outgoing[left], outgoing[right]);
                // A domain's own reciprocal pair cannot recur; the shader rejects it by arrival id.
                if domains.domain(a.target_scope) == domains.domain(b.target_scope) {
                    continue;
                }
                if apertures_form_junction(&a.aperture, &b.aperture).expect("junction predicate") {
                    findings.push((domain.clone(), a, b));
                }
            }
        }
    }

    // A same-depth walk is confined to one plane, and the shader already rejects the reciprocal of
    // whichever crossing admitted the pixel. A cycle therefore needs some domain to retain two
    // usable exits after that rejection, i.e. a mutually-coplanar exit group larger than two.
    let mut largest_group = 0usize;
    for (domain, outgoing) in &by_domain {
        let mut component = vec![usize::MAX; outgoing.len()];
        let mut next_component = 0usize;
        for left in 0..outgoing.len() {
            if component[left] == usize::MAX {
                component[left] = next_component;
                next_component += 1;
            }
            for right in (left + 1)..outgoing.len() {
                if apertures_form_junction(&outgoing[left].aperture, &outgoing[right].aperture)
                    .expect("junction predicate")
                {
                    component[right] = component[left];
                }
            }
        }
        let mut sizes = BTreeMap::<usize, usize>::new();
        for id in &component {
            *sizes.entry(*id).or_default() += 1;
        }
        let domain_largest = sizes.values().copied().max().unwrap_or(0);
        largest_group = largest_group.max(domain_largest);
        if domain_largest > 1 {
            println!(
                "\ndomain [{domain}] largest mutually-coplanar overlapping exit group: {domain_largest}"
            );
        }
    }
    println!(
        "\nlargest coplanar exit group across all render domains: {largest_group} (a cycle needs > 2)"
    );

    println!(
        "\nrecurrence preconditions (one render domain, two coplanar overlapping exits): {}",
        findings.len()
    );
    for (domain, a, b) in &findings {
        println!("  [{domain}]");
        println!("      {}  -> [{}]", a.label, domains.label(a.target_scope));
        println!("      {}  -> [{}]", b.label, domains.label(b.target_scope));
    }
}
