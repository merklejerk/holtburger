use std::collections::{BTreeMap, BTreeSet};
use std::io::Cursor;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockOutdoorAsset, LandblockOutdoorAssetAssembler,
    LandblockOutdoorAssetRequest, LandblockOutdoorStaticMember, ResolvedMaterialRecipe,
    ResolvedMaterialSource, ResolvedRegionDetailRoleKind, StaticOutdoorSceneSourceFamilies,
    build_gfx_obj_render_geometry, normalize_landblock_id,
};
use holtburger_dat::file_type::{
    GfxObj, Palette, PixelFormatId, REGION_DESC_FILE_ID, RegionDesc, RenderSurface, SetupModel,
    SurfaceType,
};
use holtburger_dat::landblock::LandblockInfo;
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaReader, ResourceKey};

const DEFAULT_ATLAS_PAGE_SIZE: u32 = 2048;
const FILTERABLE_GUTTER_PIXELS: u32 = 4;

#[derive(Parser, Debug)]
/// Inputs for the Level 1 evidence report and optional archive census.
struct Args {
    #[arg(long, default_value = "dats/assets.hba")]
    dats: PathBuf,
    /// Scan landblock-info records to identify setup-backed building acceptance samples.
    #[arg(long)]
    scan_setup_samples: bool,
    #[arg(long, default_value_t = 12)]
    sample_limit: usize,
    #[arg(default_value = "0xda55ffff")]
    landblocks: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
/// Static renderable source families admitted by the content assembler.
enum SourceFamily {
    GfxObj,
    SetupModel,
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
/// Renderer pass implied by lossless DAT material facts.
enum MaterialPass {
    Opaque,
    AlphaTest,
    Transparent,
    Additive,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
/// App-local physical texture purposes exercised by object materials.
enum TexturePurpose {
    ObjectDirectColor,
    ObjectIndex8,
    ObjectIndex16,
    ObjectPalette,
    ObjectDetail,
}

#[derive(Default)]
/// Deduplicated source closure and its derived presentation requirements.
struct Evidence {
    gfx_objects: BTreeMap<u32, GfxEvidence>,
    setup_models: BTreeMap<u32, SetupEvidence>,
    /// Every material slot declared by a selected source GfxObj.
    materials: BTreeMap<u32, ResolvedMaterialRecipe>,
    /// Materials referenced by at least one render triangle.
    used_materials: BTreeMap<u32, ResolvedMaterialRecipe>,
    render_surfaces: BTreeMap<u32, RenderSurface>,
    /// Palette IDs and their authored color counts.
    palettes: BTreeMap<u32, usize>,
    texture_purposes: BTreeMap<TexturePurpose, BTreeSet<u32>>,
    unavailable_source_levels: BTreeSet<u32>,
    errors: Vec<String>,
}

/// Geometry and used-material facts for one deduplicated GfxObj.
struct GfxEvidence {
    vertices: usize,
    triangles: usize,
    material_slots: usize,
    used_material_slots: BTreeSet<usize>,
    used_material_passes: Vec<MaterialPass>,
}

/// Setup composition and classification facts needed before static baking.
struct SetupEvidence {
    parts: Vec<u32>,
    default_animation: Option<u32>,
    default_scales: Vec<String>,
    placement_sets: Vec<(i32, Vec<String>)>,
}

#[derive(Default)]
/// Projected worker inputs and naive draw count for one landblock.
struct DryRunCounts {
    static_residents: usize,
    dynamic_residents: usize,
    static_parts: usize,
    static_triangles: usize,
    naive_draws: usize,
    blended_draws: usize,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::from_hba_path(&args.dats)
        .with_context(|| format!("failed to open {}", args.dats.display()))?;
    let decode_cache = ContentDecodeCache::new();

    print_authoritative_contract_evidence();
    print_region_detail_evidence(&content)?;

    for raw_landblock in &args.landblocks {
        let landblock_id = normalize_landblock_id(parse_hex_u32(raw_landblock)?);
        inspect_landblock(&content, &decode_cache, landblock_id)?;
    }

    if args.scan_setup_samples {
        scan_setup_backed_buildings(&args.dats, args.sample_limit)?;
    }

    Ok(())
}

fn print_authoritative_contract_evidence() {
    println!("contractEvidence");
    println!("  sourceFamily=buildings ownership=caller-selected");
    println!(
        "  promotionPredicate=setup-model && defaultAnimation!=null source=apps/holtburger-3d-legacy/src/lib/static/objects/outdoor-static-objects-resolver.ts"
    );
    println!(
        "  alphaTestPredicate=BASE1_CLIP_MAP && !TRANSLUCENT source=apps/holtburger-3d-legacy/src/lib/visual/object-visual-material-planner.ts"
    );
    println!(
        "  transparentPredicate=TRANSLUCENT|ALPHA|INV_ALPHA|translucency>0 source=apps/holtburger-3d-legacy/src/lib/visual/object-visual-material-planner.ts"
    );
    println!(
        "  additivePredicate=ADDITIVE source=apps/holtburger-3d-legacy/src/lib/visual/object-visual-material-planner.ts"
    );
    println!(
        "  atlasPolicy proposedPage={} maxMustBeClampedTo=WebGL2.MAX_TEXTURE_SIZE filterableGutter={}",
        DEFAULT_ATLAS_PAGE_SIZE, FILTERABLE_GUTTER_PIXELS,
    );
    println!(
        "  gutterConstraint=4px is legacy-proven for level-0 filtering; full atlas mip chains require per-entry mip isolation or a bounded max LOD"
    );
}

fn print_region_detail_evidence(content: &ContentRepository) -> Result<()> {
    println!("activeRegion");
    let region_number = read_active_region_number(content)?;
    let profile = content.resolve_region_render_profile(region_number)?;
    let building_roles = profile
        .detail_roles
        .iter()
        .filter(|role| role.role == ResolvedRegionDetailRoleKind::Building)
        .collect::<Vec<_>>();
    anyhow::ensure!(
        building_roles.len() == 1,
        "active region {} declared {} building-detail roles, expected exactly one",
        profile.region_number,
        building_roles.len()
    );
    println!(
        "  region={} buildingDetailRoles={}",
        profile.region_number,
        building_roles.len()
    );
    for role in building_roles {
        println!(
            "    texture=0x{:08x} tiling={} ownership=active-region purpose={:?}",
            role.detail_texture_id,
            role.detail_tiling,
            TexturePurpose::ObjectDetail,
        );
    }
    Ok(())
}

fn inspect_landblock(
    content: &ContentRepository,
    decode_cache: &ContentDecodeCache,
    landblock_id: u32,
) -> Result<()> {
    let asset = LandblockOutdoorAssetAssembler::new().assemble_landblock_with_cache(
        content,
        decode_cache,
        LandblockOutdoorAssetRequest::new(
            landblock_id,
            false,
            StaticOutdoorSceneSourceFamilies::new(false, true, false),
        ),
    );
    let buildings = building_members(&asset);
    let mut source_counts = BTreeMap::<SourceFamily, usize>::new();
    for member in buildings {
        *source_counts
            .entry(source_family(member.instance.source_did))
            .or_default() += 1;
    }

    println!("landblock=0x{landblock_id:08x} sourceFamily=buildings");
    println!(
        "  buildings={} sources={source_counts:?} diagnostics(records={},errors={},omissions={})",
        buildings.len(),
        asset.diagnostics.source_records.len(),
        asset.diagnostics.errors.len(),
        asset.diagnostics.omissions.len(),
    );
    for error in &asset.diagnostics.errors {
        println!(
            "    assemblerError {}:0x{:08x} role={} code={} detail={}",
            error.namespace, error.file_id, error.role, error.error_code, error.detail
        );
    }
    for omission in &asset.diagnostics.omissions {
        println!(
            "    assemblerOmission {}:0x{:08x} role={} reason={} detail={}",
            omission.namespace, omission.file_id, omission.role, omission.reason, omission.detail
        );
    }

    print_instance_sources(buildings);
    let mut evidence = Evidence::default();
    for source_id in buildings
        .iter()
        .map(|member| member.instance.source_did)
        .collect::<BTreeSet<_>>()
    {
        gather_source_evidence(content, source_id, &mut evidence);
    }
    print_source_evidence(&evidence);
    print_material_evidence(&evidence);
    print_dry_run(buildings, &evidence);

    if asset.diagnostics.errors.is_empty()
        && asset.diagnostics.omissions.is_empty()
        && evidence.errors.is_empty()
    {
        println!("  accounting=complete");
    } else {
        println!("  accounting=incomplete");
    }
    println!();
    Ok(())
}

fn building_members(asset: &LandblockOutdoorAsset) -> &[LandblockOutdoorStaticMember] {
    &asset.statics
}

fn print_instance_sources(buildings: &[LandblockOutdoorStaticMember]) {
    let mut instances_by_source = BTreeMap::<u32, Vec<&LandblockOutdoorStaticMember>>::new();
    for member in buildings {
        instances_by_source
            .entry(member.instance.source_did)
            .or_default()
            .push(member);
    }
    println!("  sourceInstances={}", instances_by_source.len());
    for (source_id, members) in instances_by_source {
        let sample = &members[0].instance;
        println!(
            "    source=0x{source_id:08x} family={:?} instances={} sampleOrigin=({:.3},{:.3},{:.3}) sampleScale=({:.3},{:.3},{:.3})",
            source_family(source_id),
            members.len(),
            sample.local_placement.origin.x,
            sample.local_placement.origin.y,
            sample.local_placement.origin.z,
            sample.source_scale.x,
            sample.source_scale.y,
            sample.source_scale.z,
        );
    }
}

fn gather_source_evidence(content: &ContentRepository, source_id: u32, evidence: &mut Evidence) {
    match source_family(source_id) {
        SourceFamily::GfxObj => gather_gfx_evidence(content, source_id, evidence),
        SourceFamily::SetupModel => {
            let setup_model = match read_setup_model(content, source_id) {
                Ok(setup_model) => setup_model,
                Err(error) => {
                    evidence
                        .errors
                        .push(format!("SetupModel 0x{source_id:08X}: {error:#}"));
                    return;
                }
            };
            let placement_sets = setup_model
                .placement_frames
                .iter()
                .map(|(key, placement)| {
                    (
                        *key,
                        placement
                            .anim_frame
                            .frames
                            .iter()
                            .map(|frame| {
                                format!(
                                    "origin=({:.3},{:.3},{:.3}) quat=({:.4},{:.4},{:.4},{:.4})",
                                    frame.origin.x,
                                    frame.origin.y,
                                    frame.origin.z,
                                    frame.orientation.w,
                                    frame.orientation.x,
                                    frame.orientation.y,
                                    frame.orientation.z,
                                )
                            })
                            .collect(),
                    )
                })
                .collect();
            let default_scales = setup_model
                .default_scale
                .iter()
                .map(|scale| format!("({:.3},{:.3},{:.3})", scale.x, scale.y, scale.z))
                .collect();
            evidence.setup_models.insert(
                source_id,
                SetupEvidence {
                    parts: setup_model.parts.clone(),
                    default_animation: setup_model.default_animation,
                    default_scales,
                    placement_sets,
                },
            );
            for gfx_obj_id in setup_model.parts {
                gather_gfx_evidence(content, gfx_obj_id, evidence);
            }
        }
        SourceFamily::Unsupported => evidence.errors.push(format!(
            "building source 0x{source_id:08X} has unsupported DID family"
        )),
    }
}

fn gather_gfx_evidence(content: &ContentRepository, gfx_obj_id: u32, evidence: &mut Evidence) {
    if evidence.gfx_objects.contains_key(&gfx_obj_id) {
        return;
    }
    let gfx_obj = match read_gfx_obj(content, gfx_obj_id) {
        Ok(gfx_obj) => gfx_obj,
        Err(error) => {
            evidence
                .errors
                .push(format!("GfxObj 0x{gfx_obj_id:08X}: {error:#}"));
            return;
        }
    };
    let geometry = build_gfx_obj_render_geometry(&gfx_obj);
    let used_material_slots = geometry
        .triangles
        .iter()
        .filter_map(|triangle| triangle.surface_id)
        .filter_map(|slot| usize::try_from(slot).ok())
        .collect::<BTreeSet<_>>();
    let (material_slots, used_material_passes) =
        match content.resolve_gfx_obj_material_slots(gfx_obj_id) {
            Ok(slots) => {
                for slot in &slots {
                    evidence
                        .materials
                        .entry(slot.material.surface_id)
                        .or_insert_with(|| slot.material.clone());
                    if used_material_slots.contains(&slot.slot_index) {
                        evidence
                            .used_materials
                            .entry(slot.material.surface_id)
                            .or_insert_with(|| slot.material.clone());
                        gather_material_dependencies(content, &slot.material, evidence);
                    }
                }
                let used_passes = used_material_slots
                    .iter()
                    .filter_map(|slot_index| slots.get(*slot_index))
                    .map(|slot| material_pass(&slot.material))
                    .collect();
                (slots.len(), used_passes)
            }
            Err(error) => {
                evidence.errors.push(format!(
                    "GfxObj 0x{gfx_obj_id:08X} material closure: {error:#}"
                ));
                (0, Vec::new())
            }
        };
    evidence.gfx_objects.insert(
        gfx_obj_id,
        GfxEvidence {
            vertices: geometry.vertex_count,
            triangles: geometry.triangle_count,
            material_slots,
            used_material_slots,
            used_material_passes,
        },
    );
}

fn gather_material_dependencies(
    content: &ContentRepository,
    material: &ResolvedMaterialRecipe,
    evidence: &mut Evidence,
) {
    let ResolvedMaterialSource::Texture(texture) = &material.source else {
        return;
    };
    if let Some(palette_id) = texture.palette_id {
        evidence
            .texture_purposes
            .entry(TexturePurpose::ObjectPalette)
            .or_default()
            .insert(palette_id);
        gather_palette_dependency(content, palette_id, evidence);
    }
    let mut selected_surface = None;
    for render_surface_id in &texture.render_surface_ids {
        match read_render_surface(content, *render_surface_id) {
            Ok(surface) => {
                selected_surface = Some(surface);
                break;
            }
            Err(_) => {
                evidence
                    .unavailable_source_levels
                    .insert(*render_surface_id);
            }
        }
    }
    let Some(surface) = selected_surface else {
        evidence.errors.push(format!(
            "SurfaceTexture 0x{:08X} has no available RenderSurface source level",
            texture.surface_texture_id
        ));
        return;
    };
    let render_surface_id = surface.id;
    if let Some(palette_id) = surface.default_palette_id {
        evidence
            .texture_purposes
            .entry(TexturePurpose::ObjectPalette)
            .or_default()
            .insert(palette_id);
        gather_palette_dependency(content, palette_id, evidence);
    }
    if let Some(purpose) = texture_purpose(surface.format) {
        evidence
            .texture_purposes
            .entry(purpose)
            .or_default()
            .insert(render_surface_id);
    } else {
        evidence.errors.push(format!(
            "RenderSurface 0x{render_surface_id:08X} format {:?} has no proposed building conversion",
            surface.format
        ));
    }
    evidence.render_surfaces.insert(render_surface_id, surface);
}

fn gather_palette_dependency(
    content: &ContentRepository,
    palette_id: u32,
    evidence: &mut Evidence,
) {
    match read_palette(content, palette_id) {
        Ok(palette) => {
            evidence
                .palettes
                .insert(palette_id, palette.colors_argb.len());
        }
        Err(error) => evidence
            .errors
            .push(format!("Palette 0x{palette_id:08X}: {error:#}")),
    }
}

fn print_source_evidence(evidence: &Evidence) {
    println!(
        "  sourceClosure setupModels={} gfxObjs={}",
        evidence.setup_models.len(),
        evidence.gfx_objects.len()
    );
    for (setup_id, setup) in &evidence.setup_models {
        println!(
            "    setup=0x{setup_id:08x} parts={} defaultAnimation={} classification={}",
            setup.parts.len(),
            format_optional_did(setup.default_animation),
            if setup.default_animation.is_some() {
                "dynamic"
            } else {
                "static"
            },
        );
        for (part_index, gfx_obj_id) in setup.parts.iter().enumerate() {
            println!(
                "      part={part_index} gfx=0x{gfx_obj_id:08x} scale={}",
                setup
                    .default_scales
                    .get(part_index)
                    .map(String::as_str)
                    .unwrap_or("(1.000,1.000,1.000)")
            );
        }
        for (key, frames) in &setup.placement_sets {
            println!("      placementSet=0x{key:x} frames={}", frames.len());
            for (part_index, frame) in frames.iter().enumerate() {
                println!("        part={part_index} {frame}");
            }
        }
    }
    for (gfx_obj_id, gfx) in &evidence.gfx_objects {
        println!(
            "    gfx=0x{gfx_obj_id:08x} vertices={} triangles={} materialSlots={} usedSlots={:?}",
            gfx.vertices, gfx.triangles, gfx.material_slots, gfx.used_material_slots
        );
    }
}

fn print_material_evidence(evidence: &Evidence) {
    let passes = declared_pass_counts(evidence);
    let used_passes = used_pass_counts(evidence);
    let formats = format_counts(evidence);
    println!(
        "  materialClosure declaredMaterials={} usedMaterials={} renderSurfaces={} palettes={} declaredPasses={passes:?} usedSourceSlotPasses={used_passes:?} usedFormats={formats:?}",
        evidence.materials.len(),
        evidence.used_materials.len(),
        evidence.render_surfaces.len(),
        evidence.palettes.len(),
    );
    for material in evidence.materials.values() {
        println!(
            "    material=0x{:08x} flags=0x{:08x} source={} translucency={:.3} pass={:?}",
            material.surface_id,
            material.surface_type.bits(),
            material_source_label(&material.source),
            material.translucency,
            material_pass(material),
        );
    }
    for surface in evidence.render_surfaces.values() {
        println!(
            "    renderSurface=0x{:08x} {}x{} format={:?}/0x{:x} bytes={} conversion={}",
            surface.id,
            surface.width,
            surface.height,
            surface.format,
            surface.format_raw,
            surface.source_data.len(),
            conversion_label(surface.format),
        );
    }
    for (purpose, ids) in &evidence.texture_purposes {
        println!("    packInput purpose={purpose:?} entries={}", ids.len());
    }
    println!(
        "    unavailablePreferredSourceLevels={} fallbackPolicy=first-available",
        evidence.unavailable_source_levels.len()
    );
    print_atlas_dimension_summary(evidence);
    for error in &evidence.errors {
        println!("    unsupported={error}");
    }
}

fn print_atlas_dimension_summary(evidence: &Evidence) {
    for (purpose, ids) in &evidence.texture_purposes {
        let mut maximum_width = 0u32;
        let mut maximum_height = 0u32;
        let mut padded_area = 0u64;
        for id in ids {
            let (width, height, gutter) = match purpose {
                TexturePurpose::ObjectPalette => (
                    u32::try_from(evidence.palettes.get(id).copied().unwrap_or_default())
                        .unwrap_or(u32::MAX),
                    1,
                    0,
                ),
                TexturePurpose::ObjectIndex8 | TexturePurpose::ObjectIndex16 => evidence
                    .render_surfaces
                    .get(id)
                    .map(|surface| (surface.width, surface.height, 0))
                    .unwrap_or_default(),
                TexturePurpose::ObjectDirectColor | TexturePurpose::ObjectDetail => evidence
                    .render_surfaces
                    .get(id)
                    .map(|surface| (surface.width, surface.height, FILTERABLE_GUTTER_PIXELS))
                    .unwrap_or_default(),
            };
            maximum_width = maximum_width.max(width);
            maximum_height = maximum_height.max(height);
            padded_area += u64::from(width + gutter * 2) * u64::from(height + gutter * 2);
        }
        let page_area = u64::from(DEFAULT_ATLAS_PAGE_SIZE) * u64::from(DEFAULT_ATLAS_PAGE_SIZE);
        println!(
            "    atlasSizing purpose={purpose:?} maxEntry={}x{} paddedArea={} areaLowerBoundPages={}",
            maximum_width,
            maximum_height,
            padded_area,
            padded_area.div_ceil(page_area),
        );
    }
}

fn print_dry_run(buildings: &[LandblockOutdoorStaticMember], evidence: &Evidence) {
    let mut counts = DryRunCounts::default();
    for member in buildings {
        match source_family(member.instance.source_did) {
            SourceFamily::GfxObj => {
                counts.static_residents += 1;
                accumulate_gfx(member.instance.source_did, evidence, &mut counts);
            }
            SourceFamily::SetupModel => {
                let Some(setup) = evidence.setup_models.get(&member.instance.source_did) else {
                    continue;
                };
                if setup.default_animation.is_some() {
                    counts.dynamic_residents += 1;
                    continue;
                }
                counts.static_residents += 1;
                for gfx_obj_id in &setup.parts {
                    accumulate_gfx(*gfx_obj_id, evidence, &mut counts);
                }
            }
            SourceFamily::Unsupported => {}
        }
    }
    let texture_entries = evidence
        .texture_purposes
        .values()
        .map(BTreeSet::len)
        .sum::<usize>();
    println!("  dryRunHostManifest");
    println!(
        "    residents={} setupModels={} gfxObjs={} declaredMaterials={} workerMaterials={} renderSurfaces={} palettes={} pixelBytes=0",
        buildings.len(),
        evidence.setup_models.len(),
        evidence.gfx_objects.len(),
        evidence.materials.len(),
        evidence.used_materials.len(),
        evidence.render_surfaces.len(),
        evidence.palettes.len(),
    );
    println!("  dryRunWorkerJobs geometry=1 packing=parallel-by-purpose");
    println!(
        "    geometry staticResidents={} deferredDynamicResidents={} parts={} triangles={} naiveDraws={} independentlySortableDraws={}",
        counts.static_residents,
        counts.dynamic_residents,
        counts.static_parts,
        counts.static_triangles,
        counts.naive_draws,
        counts.blended_draws,
    );
    println!(
        "    packing purposes={} uniqueEntries={} pagePolicy={}x{} clampedToDeviceMax=true",
        evidence.texture_purposes.len(),
        texture_entries,
        DEFAULT_ATLAS_PAGE_SIZE,
        DEFAULT_ATLAS_PAGE_SIZE,
    );
    println!("    join=logical-material-bindings+atlas-bindings mainThreadRebake=false");
}

fn accumulate_gfx(gfx_obj_id: u32, evidence: &Evidence, counts: &mut DryRunCounts) {
    let Some(gfx) = evidence.gfx_objects.get(&gfx_obj_id) else {
        return;
    };
    counts.static_parts += 1;
    counts.static_triangles += gfx.triangles;
    counts.naive_draws += gfx.used_material_slots.len();
    for pass in &gfx.used_material_passes {
        if matches!(pass, MaterialPass::Transparent | MaterialPass::Additive) {
            counts.blended_draws += 1;
        }
    }
}

fn scan_setup_backed_buildings(path: &Path, sample_limit: usize) -> Result<()> {
    let archive = HbaReader::open(path)
        .with_context(|| format!("failed to open {} for setup census", path.display()))?;
    let mut setup_usage = BTreeMap::<u32, Vec<u32>>::new();
    let mut setup_object_usage = BTreeMap::<u32, Vec<u32>>::new();
    let mut outdoor_object_sources = BTreeSet::<u32>::new();
    let mut outdoor_object_landblocks = BTreeMap::<u32, BTreeSet<u32>>::new();
    let mut buildings_by_landblock = BTreeMap::<u32, Vec<u32>>::new();
    let mut building_family_counts = BTreeMap::<SourceFamily, usize>::new();
    let mut landblock_info_count = 0usize;
    let mut building_count = 0usize;
    for entry in archive.entries() {
        let entry = entry?;
        if entry.namespace_id()?.as_str() != EOR_CELL_NAMESPACE || entry.file_id & 0xffff != 0xfffe
        {
            continue;
        }
        landblock_info_count += 1;
        let bytes = archive.get_file_in_namespace(EOR_CELL_NAMESPACE, entry.file_id)?;
        let info = LandblockInfo::unpack(&bytes)
            .with_context(|| format!("failed to parse LandblockInfo 0x{:08X}", entry.file_id))?;
        let landblock_id = normalize_landblock_id(entry.file_id);
        for object in &info.objects {
            outdoor_object_sources.insert(object.id);
            outdoor_object_landblocks
                .entry(object.id)
                .or_default()
                .insert(landblock_id);
            if source_family(object.id) == SourceFamily::SetupModel {
                setup_object_usage
                    .entry(object.id)
                    .or_default()
                    .push(landblock_id);
            }
        }
        building_count += info.buildings.len();
        for building in info.buildings {
            *building_family_counts
                .entry(source_family(building.model_id))
                .or_default() += 1;
            buildings_by_landblock
                .entry(landblock_id)
                .or_default()
                .push(building.model_id);
            if source_family(building.model_id) == SourceFamily::SetupModel {
                setup_usage
                    .entry(building.model_id)
                    .or_default()
                    .push(landblock_id);
            }
        }
    }

    println!("setupBuildingCensus");
    println!(
        "  landblockInfoRecords={landblock_info_count} buildings={building_count} families={building_family_counts:?} setupBuildingSources={}",
        setup_usage.len(),
    );
    let content = ContentRepository::from_hba_path(path)?;
    let mut building_evidence = Evidence::default();
    for source_id in buildings_by_landblock
        .values()
        .flatten()
        .copied()
        .collect::<BTreeSet<_>>()
    {
        gather_source_evidence(&content, source_id, &mut building_evidence);
    }
    let mut maximum_geometry = (0usize, 0u32);
    let mut alpha_test_landblock = None;
    for (landblock_id, source_ids) in &buildings_by_landblock {
        let triangles = source_ids
            .iter()
            .map(|source_id| source_triangle_count(*source_id, &building_evidence))
            .sum::<usize>();
        maximum_geometry = maximum_geometry.max((triangles, *landblock_id));
        if alpha_test_landblock.is_none()
            && source_ids.iter().any(|source_id| {
                source_uses_pass(*source_id, MaterialPass::AlphaTest, &building_evidence)
            })
        {
            alpha_test_landblock = Some(*landblock_id);
        }
    }
    println!(
        "  globalBuildingClosure uniqueSources={} gfxObjs={} declaredMaterials={} usedMaterials={} selectedRenderSurfaces={} palettes={}",
        buildings_by_landblock
            .values()
            .flatten()
            .collect::<BTreeSet<_>>()
            .len(),
        building_evidence.gfx_objects.len(),
        building_evidence.materials.len(),
        building_evidence.used_materials.len(),
        building_evidence.render_surfaces.len(),
        building_evidence.palettes.len(),
    );
    println!(
        "  globalBuildingMaterials declaredPasses={:?} usedSourceSlotPasses={:?} formats={:?}",
        declared_pass_counts(&building_evidence),
        used_pass_counts(&building_evidence),
        format_counts(&building_evidence),
    );
    print_atlas_dimension_summary(&building_evidence);
    println!(
        "  maximumLandblockGeometry landblock=0x{:08x} triangles={}",
        maximum_geometry.1, maximum_geometry.0,
    );
    println!(
        "  alphaTestLandblockSample={}",
        alpha_test_landblock
            .map(|landblock_id| format!("0x{landblock_id:08x}"))
            .unwrap_or_else(|| "none".to_string())
    );
    println!(
        "  globalUnsupported={} unavailablePreferredSourceLevels={}",
        building_evidence.errors.len(),
        building_evidence.unavailable_source_levels.len(),
    );
    let mut static_object_evidence = Evidence::default();
    let mut static_object_sources = BTreeSet::new();
    let mut deferred_dynamic_source_count = 0usize;
    for source_id in outdoor_object_sources {
        if source_family(source_id) == SourceFamily::SetupModel
            && read_setup_model(&content, source_id)?
                .default_animation
                .is_some()
        {
            deferred_dynamic_source_count += 1;
            continue;
        }
        static_object_sources.insert(source_id);
        gather_source_evidence(&content, source_id, &mut static_object_evidence);
    }
    println!(
        "  explicitObjectStaticEvidence gfxObjs={} setupModels={} deferredDynamicSources={} usedSourceSlotPasses={:?} formats={:?} unsupported={}",
        static_object_evidence.gfx_objects.len(),
        static_object_evidence.setup_models.len(),
        deferred_dynamic_source_count,
        used_pass_counts(&static_object_evidence),
        format_counts(&static_object_evidence),
        static_object_evidence.errors.len(),
    );
    print_explicit_material_samples(
        &content,
        &static_object_sources,
        &outdoor_object_landblocks,
        &static_object_evidence,
    )?;
    for (setup_id, landblocks) in setup_usage.into_iter().take(sample_limit) {
        let setup = read_setup_model(&content, setup_id)?;
        let unique_landblocks = landblocks.into_iter().collect::<BTreeSet<_>>();
        println!(
            "    setup=0x{setup_id:08x} parts={} defaultAnimation={} classification={} landblocks={}",
            setup.parts.len(),
            format_optional_did(setup.default_animation),
            if setup.default_animation.is_some() {
                "dynamic"
            } else {
                "static"
            },
            unique_landblocks
                .iter()
                .take(sample_limit)
                .map(|id| format!("0x{id:08x}"))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    println!(
        "  setupBackedExplicitObjectSources={} note=shared-non-terrain-pipeline-evidence",
        setup_object_usage.len()
    );
    let mut static_samples = Vec::new();
    let mut dynamic_samples = Vec::new();
    for (setup_id, landblocks) in setup_object_usage {
        let setup = read_setup_model(&content, setup_id)?;
        let unique_landblocks = landblocks.into_iter().collect::<BTreeSet<_>>();
        let row = format!(
            "setup=0x{setup_id:08x} parts={} defaultAnimation={} classification={} landblocks={}",
            setup.parts.len(),
            format_optional_did(setup.default_animation),
            if setup.default_animation.is_some() {
                "dynamic"
            } else {
                "static"
            },
            unique_landblocks
                .iter()
                .take(sample_limit)
                .map(|id| format!("0x{id:08x}"))
                .collect::<Vec<_>>()
                .join(","),
        );
        if setup.default_animation.is_some() {
            dynamic_samples.push(row);
        } else {
            static_samples.push(row);
        }
    }
    println!(
        "    classifications staticSources={} dynamicSources={}",
        static_samples.len(),
        dynamic_samples.len()
    );
    for row in static_samples.iter().take(sample_limit.min(3)) {
        println!("    staticSample {row}");
    }
    for row in dynamic_samples.iter().take(sample_limit) {
        println!("    dynamicSample {row}");
    }
    Ok(())
}

fn source_triangle_count(source_id: u32, evidence: &Evidence) -> usize {
    match source_family(source_id) {
        SourceFamily::GfxObj => evidence
            .gfx_objects
            .get(&source_id)
            .map(|gfx| gfx.triangles)
            .unwrap_or_default(),
        SourceFamily::SetupModel => evidence
            .setup_models
            .get(&source_id)
            .into_iter()
            .flat_map(|setup| &setup.parts)
            .filter_map(|gfx_obj_id| evidence.gfx_objects.get(gfx_obj_id))
            .map(|gfx| gfx.triangles)
            .sum(),
        SourceFamily::Unsupported => 0,
    }
}

fn source_uses_pass(source_id: u32, pass: MaterialPass, evidence: &Evidence) -> bool {
    match source_family(source_id) {
        SourceFamily::GfxObj => evidence
            .gfx_objects
            .get(&source_id)
            .is_some_and(|gfx| gfx.used_material_passes.contains(&pass)),
        SourceFamily::SetupModel => evidence
            .setup_models
            .get(&source_id)
            .into_iter()
            .flat_map(|setup| &setup.parts)
            .filter_map(|gfx_obj_id| evidence.gfx_objects.get(gfx_obj_id))
            .any(|gfx| gfx.used_material_passes.contains(&pass)),
        SourceFamily::Unsupported => false,
    }
}

/// Print deterministic live witnesses for material paths that only explicit objects exercise.
fn print_explicit_material_samples(
    content: &ContentRepository,
    static_sources: &BTreeSet<u32>,
    source_landblocks: &BTreeMap<u32, BTreeSet<u32>>,
    evidence: &Evidence,
) -> Result<()> {
    println!("  explicitObjectMaterialSamples");
    for (kind, source_id) in [
        (
            "transparent",
            static_sources.iter().copied().find(|source_id| {
                source_uses_pass(*source_id, MaterialPass::Transparent, evidence)
            }),
        ),
        (
            "additive",
            static_sources
                .iter()
                .copied()
                .find(|source_id| source_uses_pass(*source_id, MaterialPass::Additive, evidence)),
        ),
        (
            "dxt3",
            find_source_using_format(content, static_sources, evidence, PixelFormatId::Dxt3)?,
        ),
    ] {
        let Some(source_id) = source_id else {
            println!("    kind={kind} sample=none");
            continue;
        };
        let landblock_id = source_landblocks
            .get(&source_id)
            .and_then(|landblocks| landblocks.first())
            .copied()
            .context("static explicit source has no landblock witness")?;
        println!(
            "    kind={kind} landblock=0x{landblock_id:08x} source=0x{source_id:08x} family={:?}",
            source_family(source_id),
        );
    }
    Ok(())
}

fn find_source_using_format(
    content: &ContentRepository,
    sources: &BTreeSet<u32>,
    evidence: &Evidence,
    format: PixelFormatId,
) -> Result<Option<u32>> {
    for source_id in sources {
        if source_uses_format(content, *source_id, evidence, format)? {
            return Ok(Some(*source_id));
        }
    }
    Ok(None)
}

fn source_uses_format(
    content: &ContentRepository,
    source_id: u32,
    evidence: &Evidence,
    format: PixelFormatId,
) -> Result<bool> {
    for gfx_obj_id in source_gfx_objects(source_id, evidence) {
        let Some(gfx) = evidence.gfx_objects.get(&gfx_obj_id) else {
            continue;
        };
        let slots = content.resolve_gfx_obj_material_slots(gfx_obj_id)?;
        for slot_index in &gfx.used_material_slots {
            let Some(slot) = slots.get(*slot_index) else {
                continue;
            };
            let ResolvedMaterialSource::Texture(texture) = &slot.material.source else {
                continue;
            };
            let selected = texture
                .render_surface_ids
                .iter()
                .find_map(|render_surface_id| {
                    read_render_surface(content, *render_surface_id).ok()
                });
            if selected.is_some_and(|surface| surface.format == format) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn source_gfx_objects(source_id: u32, evidence: &Evidence) -> Vec<u32> {
    match source_family(source_id) {
        SourceFamily::GfxObj => vec![source_id],
        SourceFamily::SetupModel => evidence
            .setup_models
            .get(&source_id)
            .map(|setup| setup.parts.clone())
            .unwrap_or_default(),
        SourceFamily::Unsupported => Vec::new(),
    }
}

fn declared_pass_counts(evidence: &Evidence) -> BTreeMap<MaterialPass, usize> {
    let mut counts = BTreeMap::new();
    for material in evidence.materials.values() {
        *counts.entry(material_pass(material)).or_default() += 1;
    }
    counts
}

fn used_pass_counts(evidence: &Evidence) -> BTreeMap<MaterialPass, usize> {
    let mut counts = BTreeMap::new();
    for gfx in evidence.gfx_objects.values() {
        for pass in &gfx.used_material_passes {
            *counts.entry(*pass).or_default() += 1;
        }
    }
    counts
}

fn format_counts(evidence: &Evidence) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for surface in evidence.render_surfaces.values() {
        *counts.entry(format!("{:?}", surface.format)).or_default() += 1;
    }
    counts
}

fn source_family(source_id: u32) -> SourceFamily {
    match source_id >> 24 {
        0x01 => SourceFamily::GfxObj,
        0x02 => SourceFamily::SetupModel,
        _ => SourceFamily::Unsupported,
    }
}

fn material_pass(material: &ResolvedMaterialRecipe) -> MaterialPass {
    let flags = material.surface_type;
    if flags.contains(SurfaceType::ADDITIVE) {
        MaterialPass::Additive
    } else if flags.contains(SurfaceType::TRANSLUCENT)
        || flags.contains(SurfaceType::ALPHA)
        || flags.contains(SurfaceType::INV_ALPHA)
        || material.translucency > 0.0
    {
        MaterialPass::Transparent
    } else if flags.contains(SurfaceType::BASE1_CLIP_MAP) {
        MaterialPass::AlphaTest
    } else {
        MaterialPass::Opaque
    }
}

fn texture_purpose(format: PixelFormatId) -> Option<TexturePurpose> {
    match format {
        PixelFormatId::P8 => Some(TexturePurpose::ObjectIndex8),
        PixelFormatId::Index16 => Some(TexturePurpose::ObjectIndex16),
        PixelFormatId::R8G8B8
        | PixelFormatId::A8R8G8B8
        | PixelFormatId::X8R8G8B8
        | PixelFormatId::R5G6B5
        | PixelFormatId::A4R4G4B4
        | PixelFormatId::Dxt1
        | PixelFormatId::Dxt3
        | PixelFormatId::Dxt5 => Some(TexturePurpose::ObjectDirectColor),
        PixelFormatId::Unknown
        | PixelFormatId::A8
        | PixelFormatId::CustomLandscapeR8G8B8
        | PixelFormatId::CustomLandscapeAlpha
        | PixelFormatId::CustomRawJpeg
        | PixelFormatId::Other(_) => None,
    }
}

fn conversion_label(format: PixelFormatId) -> &'static str {
    match format {
        PixelFormatId::P8 => "preserve-r8-index",
        PixelFormatId::Index16 => "preserve-rg8-index-le",
        PixelFormatId::R8G8B8 => "rgb-to-rgba8",
        PixelFormatId::A8R8G8B8 => "bgra-to-rgba8",
        PixelFormatId::X8R8G8B8 => "bgrx-to-rgba8",
        PixelFormatId::R5G6B5 => "rgb565-to-rgba8",
        PixelFormatId::A4R4G4B4 => "argb4444-to-rgba8",
        PixelFormatId::Dxt1 => "bc1-to-rgba8",
        PixelFormatId::Dxt3 => "bc2-to-rgba8",
        PixelFormatId::Dxt5 => "bc3-to-rgba8",
        _ => "unsupported",
    }
}

fn material_source_label(source: &ResolvedMaterialSource) -> String {
    match source {
        ResolvedMaterialSource::SolidColor(argb) => format!("solid(0x{argb:08x})"),
        ResolvedMaterialSource::Texture(texture) => format!(
            "texture(surfaceTexture=0x{:08x},levels={},palette={})",
            texture.surface_texture_id,
            texture.render_surface_ids.len(),
            format_optional_did(texture.palette_id),
        ),
    }
}

fn read_active_region_number(content: &ContentRepository) -> Result<u32> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, REGION_DESC_FILE_ID))
        .with_context(|| format!("failed to read RegionDesc 0x{REGION_DESC_FILE_ID:08X}"))?;
    let region = RegionDesc::unpack(&resource.bytes)
        .with_context(|| format!("failed to parse RegionDesc 0x{REGION_DESC_FILE_ID:08X}"))?;
    Ok(region.region_number)
}

fn read_setup_model(content: &ContentRepository, setup_model_id: u32) -> Result<SetupModel> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, setup_model_id))
        .with_context(|| format!("failed to read SetupModel 0x{setup_model_id:08X}"))?;
    SetupModel::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse SetupModel 0x{setup_model_id:08X}"))
}

fn read_gfx_obj(content: &ContentRepository, gfx_obj_id: u32) -> Result<GfxObj> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, gfx_obj_id))
        .with_context(|| format!("failed to read GfxObj 0x{gfx_obj_id:08X}"))?;
    GfxObj::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse GfxObj 0x{gfx_obj_id:08X}"))
}

fn read_render_surface(
    content: &ContentRepository,
    render_surface_id: u32,
) -> Result<RenderSurface> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, render_surface_id))
        .with_context(|| format!("failed to read RenderSurface 0x{render_surface_id:08X}"))?;
    RenderSurface::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse RenderSurface 0x{render_surface_id:08X}"))
}

fn read_palette(content: &ContentRepository, palette_id: u32) -> Result<Palette> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, palette_id))
        .with_context(|| format!("failed to read Palette 0x{palette_id:08X}"))?;
    Palette::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse Palette 0x{palette_id:08X}"))
}

fn parse_hex_u32(value: &str) -> Result<u32> {
    u32::from_str_radix(value.trim_start_matches("0x"), 16)
        .with_context(|| format!("invalid hexadecimal DID {value}"))
}

fn format_optional_did(value: Option<u32>) -> String {
    value
        .map(|did| format!("0x{did:08x}"))
        .unwrap_or_else(|| "none".to_string())
}
