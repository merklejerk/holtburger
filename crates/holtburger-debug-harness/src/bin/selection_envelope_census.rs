//! Measures whether a static host selection envelope covers Client-mode animated presentation.
//!
//! The census first measures the rejected default-pose envelope, then benchmarks the accepted
//! origin-centered unit-scale closure over effective appearance and motion profiles. Whole-object
//! scale is intentionally absent: world applies its current value once when a cached envelope is
//! placed for a query.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::Cursor;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result, bail};
use clap::Parser;
use holtburger_common::{Placement, Sphere, Vector3};
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::motion_table::{AnimData, MotionData};
use holtburger_dat::file_type::{Animation, GfxObj, MotionTable, SetupModel};
use holtburger_dat::graphics::Frame;
use holtburger_dat::physics::BspNode;
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_weenie_catalog::{WeenieCatalog, WeenieTemplate};
use serde::Serialize;

const SETUP_MODEL_TYPE: u32 = 0x02;
const MOTION_TABLE_TYPE: u32 = 0x09;
const CONTAINMENT_EPSILON: f32 = 0.000_1;

#[derive(Parser)]
#[command(about = "Measure static selection-envelope coverage over shipped Client visuals")]
struct Args {
    /// HBA file/directory; normal repository discovery is used when omitted.
    #[arg(long)]
    content: Option<PathBuf>,
    /// Offline ACE World template catalog used for actual appearance and motion-table overrides.
    #[arg(long, default_value = "dats/weenies.hwc")]
    catalog: PathBuf,
    /// Number of worst escaping profile/animation examples to print.
    #[arg(long, default_value_t = 20)]
    worst: usize,
    /// Compute-only benchmark rounds for a sphere-only full-animation closure; zero disables it.
    #[arg(long, default_value_t = 0)]
    benchmark_rounds: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct ProfileKey {
    setup_did: u32,
    effective_parts: Vec<u32>,
    motion_table_did: Option<u32>,
}

#[derive(Default)]
struct ProfileSources {
    template_count: usize,
    attackable_template_count: usize,
    example_wcids: Vec<u32>,
    example_attackable_wcids: Vec<u32>,
}

#[derive(Debug, Clone, Copy)]
struct ClipSpec {
    animation_did: u32,
    low_frame: i32,
    high_frame: i32,
    framerate: f32,
}

#[derive(Debug, Clone, Copy)]
struct GfxSphereFact {
    sphere: Option<Sphere>,
    drawing_polygon_count: usize,
}

#[derive(Debug, Clone)]
struct EscapeExample {
    excess: f32,
    ratio: f32,
    setup_did: u32,
    animation_did: u32,
    frame_index: usize,
    part_index: usize,
    gfx_obj_did: u32,
    template_examples: Vec<u32>,
    attackable_template_examples: Vec<u32>,
}

#[derive(Default)]
struct Census {
    setup_count: usize,
    catalog_template_count: usize,
    catalog_attackable_template_count: usize,
    catalog_templates_with_setup: usize,
    catalog_templates_with_part_changes: usize,
    distinct_profiles: usize,
    catalog_profiles: usize,
    profiles_without_drawing_spheres: usize,
    profiles_without_envelope: usize,
    profiles_with_animation: usize,
    profile_poses_sampled: u64,
    part_spheres_sampled: u64,
    escaping_profiles: usize,
    escaping_catalog_profiles: usize,
    affected_catalog_templates: usize,
    affected_attackable_catalog_templates: usize,
    animation_escape_profiles: usize,
    escaping_profile_poses: u64,
    escaping_part_spheres: u64,
    sorting_union_escaping_profiles: usize,
    sorting_union_affected_catalog_templates: usize,
    sorting_union_escaping_part_spheres: u64,
    sorting_union_maximum_escape: f32,
    root_rotated_profiles: usize,
    root_rotation_escape_profiles: usize,
    missing_motion_tables: BTreeSet<u32>,
    missing_animations: BTreeSet<u32>,
    default_frame_part_mismatches: usize,
    invalid_spheres: usize,
    maximum_escape: f32,
    maximum_escape_ratio: f32,
    escapes: Vec<EscapeExample>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModeledCandidate {
    guid: u32,
    envelope_entry_distance: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModeledAvailableResult {
    sequence: u64,
    kind: &'static str,
    static_limit_distance: f32,
    candidates: Vec<ModeledCandidate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModeledMembershipAvailableResult {
    sequence: u64,
    kind: &'static str,
    static_limit_distance: f32,
    candidate_guids: Vec<u32>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let catalog = WeenieCatalog::open(&args.catalog).context("catalog open failed")?;

    let setups = read_setups(&content)?;
    let motion_clips = read_motion_clips(&content)?;
    let templates = read_templates(&catalog)?;
    let profiles = build_profiles(&setups, &templates)?;

    let mut animations = HashMap::<u32, Option<Animation>>::new();
    let mut gfx_spheres = HashMap::<u32, Option<GfxSphereFact>>::new();
    let mut census = Census {
        setup_count: setups.len(),
        catalog_template_count: templates.len(),
        catalog_attackable_template_count: templates
            .iter()
            .filter(|template| template.attackable.unwrap_or(true))
            .count(),
        catalog_templates_with_setup: templates
            .iter()
            .filter(|template| template.setup_did.is_some())
            .count(),
        catalog_templates_with_part_changes: templates
            .iter()
            .filter(|template| !template.anim_part_changes.is_empty())
            .count(),
        distinct_profiles: profiles.len(),
        catalog_profiles: profiles
            .values()
            .filter(|sources| sources.template_count > 0)
            .count(),
        ..Census::default()
    };

    let mut distinct_referenced_gfx = BTreeSet::new();
    let mut distinct_gfx_without_drawing = BTreeSet::new();
    let mut distinct_gfx_without_root_sphere = BTreeSet::new();
    for (profile, sources) in &profiles {
        let setup = setups
            .get(&profile.setup_did)
            .expect("profile setup came from decoded setup map");
        let stable_pose = stable_pose(setup, &content, &mut animations, &mut census)?;
        let local_part_spheres = profile_part_spheres(
            profile,
            &content,
            &mut gfx_spheres,
            &mut distinct_referenced_gfx,
            &mut distinct_gfx_without_drawing,
            &mut distinct_gfx_without_root_sphere,
            &mut census,
        )?;
        if local_part_spheres.iter().all(Option::is_none) {
            census.profiles_without_drawing_spheres += 1;
        }
        let stable_part_spheres = local_part_spheres
            .iter()
            .enumerate()
            .map(|(part_index, sphere)| {
                sphere.map(|sphere| {
                    transform_part_sphere(
                        sphere,
                        &stable_pose[part_index],
                        setup_part_scale(setup, part_index),
                    )
                })
            })
            .collect::<Vec<_>>();
        let envelope = proposed_envelope(setup.selection_sphere, &stable_part_spheres, &mut census);
        let Some(envelope) = envelope else {
            census.profiles_without_envelope += 1;
            continue;
        };
        let sorting_union = enclose_spheres(envelope, setup.sorting_sphere);

        let clips = playable_clips(profile, setup, &motion_clips, &mut census);
        if !clips.is_empty() {
            census.profiles_with_animation += 1;
        }
        let profile_escape_start = census.escaping_part_spheres;
        let mut profile_had_root_rotation = false;
        let mut profile_had_root_rotation_escape = false;
        let mut profile_had_animation_escape = false;
        let mut profile_had_sorting_union_escape = false;

        for clip in clips {
            let Some(animation) =
                read_animation_cached(&content, clip.animation_did, &mut animations)?
            else {
                census.missing_animations.insert(clip.animation_did);
                continue;
            };
            if animation.part_frames.is_empty() {
                continue;
            }
            let (low, high) = resolved_clip_window(animation, clip);
            let applies_visual_root_rotation = animation_applies_visual_root_rotation(animation);
            profile_had_root_rotation |= applies_visual_root_rotation;
            for frame_index in low..=high {
                census.profile_poses_sampled += 1;
                let frame = &animation.part_frames[frame_index];
                let mut pose_escaped = false;
                for (part_index, local_sphere) in local_part_spheres.iter().enumerate() {
                    let Some(local_sphere) = local_sphere else {
                        continue;
                    };
                    let pose = frame
                        .frames
                        .get(part_index)
                        .unwrap_or(&stable_pose[part_index]);
                    let mut posed = transform_part_sphere(
                        *local_sphere,
                        pose,
                        setup_part_scale(setup, part_index),
                    );
                    if applies_visual_root_rotation {
                        let root = &animation.pos_frames[frame_index];
                        posed.center = root.orientation.rotate_vector(posed.center);
                    }
                    census.part_spheres_sampled += 1;
                    let excess = containment_excess(envelope, posed);
                    let sorting_union_excess = containment_excess(sorting_union, posed);
                    if sorting_union_excess > containment_tolerance(sorting_union) {
                        profile_had_sorting_union_escape = true;
                        census.sorting_union_escaping_part_spheres += 1;
                        census.sorting_union_maximum_escape = census
                            .sorting_union_maximum_escape
                            .max(sorting_union_excess);
                    }
                    if excess <= containment_tolerance(envelope) {
                        continue;
                    }
                    pose_escaped = true;
                    profile_had_animation_escape = true;
                    census.escaping_part_spheres += 1;
                    census.maximum_escape = census.maximum_escape.max(excess);
                    let ratio = containment_ratio(envelope, posed);
                    census.maximum_escape_ratio = census.maximum_escape_ratio.max(ratio);
                    if applies_visual_root_rotation {
                        profile_had_root_rotation_escape = true;
                    }
                    record_escape(
                        &mut census.escapes,
                        EscapeExample {
                            excess,
                            ratio,
                            setup_did: profile.setup_did,
                            animation_did: animation.id,
                            frame_index,
                            part_index,
                            gfx_obj_did: profile.effective_parts[part_index],
                            template_examples: sources.example_wcids.clone(),
                            attackable_template_examples: sources.example_attackable_wcids.clone(),
                        },
                        args.worst,
                    );
                }
                census.escaping_profile_poses += u64::from(pose_escaped);
            }
        }
        if profile_had_root_rotation {
            census.root_rotated_profiles += 1;
        }
        if profile_had_root_rotation_escape {
            census.root_rotation_escape_profiles += 1;
        }
        if census.escaping_part_spheres > profile_escape_start {
            census.escaping_profiles += 1;
            if sources.template_count > 0 {
                census.escaping_catalog_profiles += 1;
                census.affected_catalog_templates += sources.template_count;
                census.affected_attackable_catalog_templates += sources.attackable_template_count;
            }
        }
        if profile_had_animation_escape {
            census.animation_escape_profiles += 1;
        }
        if profile_had_sorting_union_escape {
            census.sorting_union_escaping_profiles += 1;
            census.sorting_union_affected_catalog_templates += sources.template_count;
        }
    }

    print_report(
        &census,
        distinct_referenced_gfx.len(),
        &distinct_gfx_without_drawing,
        &distinct_gfx_without_root_sphere,
        args.worst,
    );
    if args.benchmark_rounds > 0 {
        benchmark_animation_closures(
            &profiles,
            &setups,
            &motion_clips,
            &animations,
            &gfx_spheres,
            args.benchmark_rounds,
        );
    }
    print_modeled_event_sizes();
    Ok(())
}

fn record_escape(examples: &mut Vec<EscapeExample>, example: EscapeExample, limit: usize) {
    if limit == 0 {
        return;
    }
    let identity = |value: &EscapeExample| {
        (
            value.setup_did,
            value.animation_did,
            value.frame_index,
            value.part_index,
            value.gfx_obj_did,
        )
    };
    if let Some(existing) = examples
        .iter()
        .position(|existing| identity(existing) == identity(&example))
    {
        if examples[existing].excess >= example.excess {
            return;
        }
        examples.remove(existing);
    }
    let insertion = examples
        .binary_search_by(|current| {
            example
                .excess
                .total_cmp(&current.excess)
                .then_with(|| identity(&example).cmp(&identity(current)))
        })
        .unwrap_or_else(|index| index);
    if insertion >= limit {
        return;
    }
    examples.insert(insertion, example);
    examples.truncate(limit);
}

fn read_setups(content: &ContentRepository) -> Result<BTreeMap<u32, SetupModel>> {
    let mut setups = BTreeMap::new();
    for entry in content.resource_index().iter().filter(|entry| {
        entry.namespace == EOR_PORTAL_NAMESPACE && entry.type_id == SETUP_MODEL_TYPE
    }) {
        let bytes = read(content, entry.file_id)?;
        let setup = SetupModel::read(&mut Cursor::new(bytes))
            .with_context(|| format!("decode SetupModel 0x{:08X}", entry.file_id))?;
        setups.insert(entry.file_id, setup);
    }
    Ok(setups)
}

fn read_motion_clips(content: &ContentRepository) -> Result<BTreeMap<u32, Vec<ClipSpec>>> {
    let mut tables = BTreeMap::new();
    for entry in content.resource_index().iter().filter(|entry| {
        entry.namespace == EOR_PORTAL_NAMESPACE && entry.type_id == MOTION_TABLE_TYPE
    }) {
        let bytes = read(content, entry.file_id)?;
        let table = MotionTable::read(&mut Cursor::new(bytes))
            .with_context(|| format!("decode MotionTable 0x{:08X}", entry.file_id))?;
        let clips = motion_data_records(&table)
            .flat_map(|data| data.anims.iter())
            .map(clip_spec)
            .collect();
        tables.insert(entry.file_id, clips);
    }
    Ok(tables)
}

fn motion_data_records(table: &MotionTable) -> impl Iterator<Item = &MotionData> {
    table
        .cycles
        .values()
        .chain(table.modifiers.values())
        .chain(table.links.values().flat_map(|links| links.values()))
}

fn clip_spec(anim: &AnimData) -> ClipSpec {
    ClipSpec {
        animation_did: anim.anim_id,
        low_frame: anim.low_frame,
        high_frame: anim.high_frame,
        framerate: anim.framerate,
    }
}

fn read_templates(catalog: &WeenieCatalog) -> Result<Vec<WeenieTemplate>> {
    let mut templates = Vec::with_capacity(catalog.len());
    for record in catalog.records() {
        let template = catalog
            .lookup(record.wcid)
            .with_context(|| format!("read catalog WCID {}", record.wcid))?
            .with_context(|| format!("catalog index lost WCID {}", record.wcid))?;
        templates.push(template);
    }
    Ok(templates)
}

fn build_profiles(
    setups: &BTreeMap<u32, SetupModel>,
    templates: &[WeenieTemplate],
) -> Result<BTreeMap<ProfileKey, ProfileSources>> {
    let mut profiles = BTreeMap::new();
    for setup in setups.values() {
        profiles
            .entry(ProfileKey {
                setup_did: setup.id,
                effective_parts: setup.parts.clone(),
                motion_table_did: setup.default_motion_table,
            })
            .or_insert_with(ProfileSources::default);
    }
    for template in templates {
        let Some(setup_did) = template.setup_did else {
            continue;
        };
        let Some(setup) = setups.get(&setup_did) else {
            continue;
        };
        let mut effective_parts = setup.parts.clone();
        for change in &template.anim_part_changes {
            let part_index = usize::from(change.part_index);
            let Some(part) = effective_parts.get_mut(part_index) else {
                bail!(
                    "WCID {} replaces missing part {} on SetupModel 0x{setup_did:08X}",
                    template.wcid,
                    part_index
                );
            };
            *part = change.animation_part_did;
        }
        let sources = profiles
            .entry(ProfileKey {
                setup_did,
                effective_parts,
                motion_table_did: template.motion_table_did.or(setup.default_motion_table),
            })
            .or_insert_with(ProfileSources::default);
        sources.template_count += 1;
        let attackable = template.attackable.unwrap_or(true);
        sources.attackable_template_count += usize::from(attackable);
        if sources.example_wcids.len() < 4 {
            sources.example_wcids.push(template.wcid);
        }
        if attackable && sources.example_attackable_wcids.len() < 4 {
            sources.example_attackable_wcids.push(template.wcid);
        }
    }
    Ok(profiles)
}

fn stable_pose(
    setup: &SetupModel,
    content: &ContentRepository,
    animations: &mut HashMap<u32, Option<Animation>>,
    census: &mut Census,
) -> Result<Vec<Frame>> {
    let mut pose = setup
        .placement_frames
        .get(&Placement::Resting)
        .or_else(|| setup.placement_frames.get(&Placement::Default))
        .map(|placement| placement.anim_frame.frames.clone())
        .unwrap_or_else(|| vec![Frame::default(); setup.parts.len()]);
    if pose.len() != setup.parts.len() {
        census.default_frame_part_mismatches += 1;
        pose.resize(setup.parts.len(), Frame::default());
    }
    let Some(animation_did) = setup.default_animation else {
        return Ok(pose);
    };
    let Some(animation) = read_animation_cached(content, animation_did, animations)? else {
        census.missing_animations.insert(animation_did);
        return Ok(pose);
    };
    let Some(first) = animation.part_frames.first() else {
        return Ok(pose);
    };
    for (destination, source) in pose.iter_mut().zip(&first.frames) {
        *destination = source.clone();
    }
    Ok(pose)
}

#[allow(clippy::too_many_arguments)]
fn profile_part_spheres(
    profile: &ProfileKey,
    content: &ContentRepository,
    gfx_cache: &mut HashMap<u32, Option<GfxSphereFact>>,
    distinct_referenced: &mut BTreeSet<u32>,
    without_drawing: &mut BTreeSet<u32>,
    without_root_sphere: &mut BTreeSet<u32>,
    census: &mut Census,
) -> Result<Vec<Option<Sphere>>> {
    profile
        .effective_parts
        .iter()
        .map(|gfx_obj_did| {
            distinct_referenced.insert(*gfx_obj_did);
            let fact = read_gfx_sphere_cached(content, *gfx_obj_did, gfx_cache)?;
            let Some(fact) = fact else {
                without_drawing.insert(*gfx_obj_did);
                return Ok(None);
            };
            let Some(sphere) = fact.sphere else {
                if fact.drawing_polygon_count > 0 {
                    without_root_sphere.insert(*gfx_obj_did);
                }
                return Ok(None);
            };
            if !valid_sphere(sphere) {
                census.invalid_spheres += 1;
                return Ok(None);
            }
            Ok(Some(sphere))
        })
        .collect()
}

fn proposed_envelope(
    authored: Sphere,
    part_spheres: &[Option<Sphere>],
    census: &mut Census,
) -> Option<Sphere> {
    let authored = if valid_sphere(authored) {
        Some(authored)
    } else {
        census.invalid_spheres += 1;
        None
    };
    part_spheres
        .iter()
        .flatten()
        .copied()
        .fold(authored, |envelope, sphere| {
            Some(envelope.map_or(sphere, |current| enclose_spheres(current, sphere)))
        })
}

fn playable_clips(
    profile: &ProfileKey,
    setup: &SetupModel,
    motion_clips: &BTreeMap<u32, Vec<ClipSpec>>,
    census: &mut Census,
) -> Vec<ClipSpec> {
    if let Some(table_did) = profile.motion_table_did {
        let Some(clips) = motion_clips.get(&table_did) else {
            census.missing_motion_tables.insert(table_did);
            return Vec::new();
        };
        return deduplicate_clips(clips.iter().copied());
    }
    deduplicate_clips(
        setup
            .default_animation
            .map(|animation_did| ClipSpec {
                animation_did,
                low_frame: 0,
                high_frame: -1,
                framerate: 1.0,
            })
            .into_iter()
            .collect::<Vec<_>>(),
    )
}

fn deduplicate_clips(clips: impl IntoIterator<Item = ClipSpec>) -> Vec<ClipSpec> {
    let mut unique = BTreeMap::new();
    for clip in clips {
        let direction = if clip.framerate < 0.0 { -1_i8 } else { 1_i8 };
        unique
            .entry((
                clip.animation_did,
                clip.low_frame,
                clip.high_frame,
                direction,
            ))
            .or_insert(clip);
    }
    unique.into_values().collect()
}

fn read_animation_cached<'a>(
    content: &ContentRepository,
    animation_did: u32,
    cache: &'a mut HashMap<u32, Option<Animation>>,
) -> Result<Option<&'a Animation>> {
    cache.entry(animation_did).or_insert_with(|| {
        content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, animation_did))
            .ok()
            .and_then(|resource| Animation::read(&mut Cursor::new(resource.bytes)).ok())
    });
    Ok(cache.get(&animation_did).and_then(Option::as_ref))
}

fn read_gfx_sphere_cached(
    content: &ContentRepository,
    gfx_obj_did: u32,
    cache: &mut HashMap<u32, Option<GfxSphereFact>>,
) -> Result<Option<GfxSphereFact>> {
    if let Some(fact) = cache.get(&gfx_obj_did) {
        return Ok(*fact);
    }
    let fact = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, gfx_obj_did))
        .ok()
        .and_then(|resource| GfxObj::unpack(&mut Cursor::new(resource.bytes)).ok())
        .map(|gfx| GfxSphereFact {
            sphere: gfx.drawing_bsp.as_ref().and_then(bsp_root_sphere),
            drawing_polygon_count: gfx.polygons.len(),
        });
    cache.insert(gfx_obj_did, fact);
    Ok(fact)
}

fn bsp_root_sphere(node: &BspNode) -> Option<Sphere> {
    match node {
        BspNode::Port(portal) => portal.sphere,
        BspNode::Leaf(leaf) => leaf.sphere,
        BspNode::Internal(internal) => internal.sphere,
    }
}

fn setup_part_scale(setup: &SetupModel, part_index: usize) -> Vector3 {
    setup
        .default_scale
        .get(part_index)
        .copied()
        .unwrap_or(Vector3::new(1.0, 1.0, 1.0))
}

fn transform_part_sphere(sphere: Sphere, frame: &Frame, scale: Vector3) -> Sphere {
    let scaled_center = component_product(sphere.center, scale);
    Sphere {
        center: frame.origin + frame.orientation.rotate_vector(scaled_center),
        radius: sphere.radius * maximum_absolute_component(scale),
    }
}

fn component_product(left: Vector3, right: Vector3) -> Vector3 {
    Vector3::new(left.x * right.x, left.y * right.y, left.z * right.z)
}

fn maximum_absolute_component(vector: Vector3) -> f32 {
    vector.x.abs().max(vector.y.abs()).max(vector.z.abs())
}

fn enclose_spheres(left: Sphere, right: Sphere) -> Sphere {
    let offset = right.center - left.center;
    let distance = offset.length();
    if left.radius >= distance + right.radius {
        return left;
    }
    if right.radius >= distance + left.radius {
        return right;
    }
    if distance <= f32::EPSILON {
        return Sphere {
            center: left.center,
            radius: left.radius.max(right.radius),
        };
    }
    let radius = (distance + left.radius + right.radius) * 0.5;
    Sphere {
        center: left.center + offset * ((radius - left.radius) / distance),
        radius,
    }
}

fn valid_sphere(sphere: Sphere) -> bool {
    vector_is_finite(sphere.center) && sphere.radius.is_finite() && sphere.radius >= 0.0
}

fn vector_is_finite(vector: Vector3) -> bool {
    vector.x.is_finite() && vector.y.is_finite() && vector.z.is_finite()
}

fn containment_excess(envelope: Sphere, contained: Sphere) -> f32 {
    (contained.center - envelope.center).length() + contained.radius - envelope.radius
}

fn containment_ratio(envelope: Sphere, contained: Sphere) -> f32 {
    if envelope.radius <= f32::EPSILON {
        return f32::INFINITY;
    }
    ((contained.center - envelope.center).length() + contained.radius) / envelope.radius
}

fn containment_tolerance(envelope: Sphere) -> f32 {
    CONTAINMENT_EPSILON * envelope.radius.max(1.0)
}

fn resolved_clip_window(animation: &Animation, clip: ClipSpec) -> (usize, usize) {
    let last = animation.part_frames.len().saturating_sub(1);
    let low = if clip.low_frame < 0 {
        0
    } else {
        (clip.low_frame as usize).min(last)
    };
    let high = if clip.high_frame < 0 {
        last
    } else {
        (clip.high_frame as usize).min(last)
    };
    (low, high.max(low))
}

fn animation_applies_visual_root_rotation(animation: &Animation) -> bool {
    !animation.pos_frames.is_empty()
        && !animation
            .pos_frames
            .iter()
            .any(|frame| frame.origin.length_squared() > 0.0)
}

fn read(content: &ContentRepository, did: u32) -> Result<Vec<u8>> {
    Ok(content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, did))
        .with_context(|| format!("read resource 0x{did:08X}"))?
        .bytes)
}

#[derive(Debug, Clone, Copy)]
struct ClosureMeasurement {
    elapsed_nanos: u128,
    radius: f32,
    posed_parts: u64,
    template_count: usize,
}

fn benchmark_animation_closures(
    profiles: &BTreeMap<ProfileKey, ProfileSources>,
    setups: &BTreeMap<u32, SetupModel>,
    motion_clips: &BTreeMap<u32, Vec<ClipSpec>>,
    animations: &HashMap<u32, Option<Animation>>,
    gfx_spheres: &HashMap<u32, Option<GfxSphereFact>>,
    rounds: usize,
) {
    let mut totals = BTreeMap::<ProfileKey, ClosureMeasurement>::new();
    let benchmark_start = Instant::now();
    for _ in 0..rounds {
        for (profile, sources) in profiles {
            let setup = &setups[&profile.setup_did];
            let started = Instant::now();
            let (radius, posed_parts) = compute_animation_closure_radius(
                profile,
                setup,
                motion_clips,
                animations,
                gfx_spheres,
            );
            std::hint::black_box(radius);
            let elapsed_nanos = started.elapsed().as_nanos();
            totals
                .entry(profile.clone())
                .and_modify(|measurement| measurement.elapsed_nanos += elapsed_nanos)
                .or_insert(ClosureMeasurement {
                    elapsed_nanos,
                    radius,
                    posed_parts,
                    template_count: sources.template_count,
                });
        }
    }
    let wall = benchmark_start.elapsed();

    let mut profile_nanos = Vec::with_capacity(totals.len());
    let mut catalog_nanos = Vec::new();
    let mut catalog_radii = Vec::new();
    let mut catalog_work = Vec::new();
    for measurement in totals.values() {
        let average_nanos = measurement.elapsed_nanos / rounds as u128;
        profile_nanos.push(average_nanos);
        for _ in 0..measurement.template_count {
            catalog_nanos.push(average_nanos);
            catalog_radii.push(measurement.radius);
            catalog_work.push(measurement.posed_parts);
        }
    }
    profile_nanos.sort_unstable();
    catalog_nanos.sort_unstable();
    catalog_radii.sort_by(f32::total_cmp);
    catalog_work.sort_unstable();

    println!("\nsphere-only full-animation closure benchmark:");
    println!("  rounds:                                   {rounds}");
    println!(
        "  profiles per round:                       {}",
        totals.len()
    );
    println!(
        "  total benchmark wall time:                {:.3} ms",
        wall.as_secs_f64() * 1_000.0
    );
    print_nanos_distribution("profile compute", &profile_nanos);
    print_nanos_distribution("catalog-template-weighted compute", &catalog_nanos);
    println!(
        "  catalog-weighted posed parts p50/p95/max: {}/{}/{}",
        percentile(&catalog_work, 50),
        percentile(&catalog_work, 95),
        catalog_work.last().copied().unwrap_or(0)
    );
    println!(
        "  catalog-weighted radius p50/p95/max:      {:.3}/{:.3}/{:.3} m",
        percentile(&catalog_radii, 50),
        percentile(&catalog_radii, 95),
        catalog_radii.last().copied().unwrap_or(0.0)
    );
    println!("  timing scope: cached decoded animations and GfxObj root spheres; no archive I/O");

    let mut slowest = totals.iter().collect::<Vec<_>>();
    slowest.sort_by_key(|(_, measurement)| std::cmp::Reverse(measurement.elapsed_nanos));
    println!("  slowest profiles:");
    for (profile, measurement) in slowest.into_iter().take(5) {
        println!(
            "    {:>8} ns  radius {:>7.3} m  posed {:>7}  setup 0x{:08X} motion {:?} wcids {:?}",
            measurement.elapsed_nanos / rounds as u128,
            measurement.radius,
            measurement.posed_parts,
            profile.setup_did,
            profile.motion_table_did.map(|did| format!("0x{did:08X}")),
            profiles[profile].example_wcids,
        );
    }

    let mut broadest = totals.iter().collect::<Vec<_>>();
    broadest.sort_by(|(_, left), (_, right)| right.radius.total_cmp(&left.radius));
    println!("  broadest profiles:");
    for (profile, measurement) in broadest.into_iter().take(5) {
        println!(
            "    radius {:>7.3} m  setup 0x{:08X} motion {:?} wcids {:?}",
            measurement.radius,
            profile.setup_did,
            profile.motion_table_did.map(|did| format!("0x{did:08X}")),
            profiles[profile].example_wcids,
        );
    }
}

fn compute_animation_closure_radius(
    profile: &ProfileKey,
    setup: &SetupModel,
    motion_clips: &BTreeMap<u32, Vec<ClipSpec>>,
    animations: &HashMap<u32, Option<Animation>>,
    gfx_spheres: &HashMap<u32, Option<GfxSphereFact>>,
) -> (f32, u64) {
    let stable_pose = stable_pose_from_cache(setup, animations);
    let part_radii = profile
        .effective_parts
        .iter()
        .enumerate()
        .map(|(part_index, did)| {
            gfx_spheres
                .get(did)
                .and_then(|fact| *fact)
                .and_then(|fact| fact.sphere)
                .map(|sphere| {
                    rotation_invariant_part_radius(sphere, setup_part_scale(setup, part_index))
                })
        })
        .collect::<Vec<_>>();

    let mut radius = setup.selection_sphere.center.length() + setup.selection_sphere.radius;
    let mut posed_parts = 0_u64;
    include_pose_in_origin_centered_closure(
        &mut radius,
        &mut posed_parts,
        &stable_pose,
        &part_radii,
    );

    let clips = profile
        .motion_table_did
        .and_then(|did| motion_clips.get(&did).cloned())
        .unwrap_or_else(|| {
            setup
                .default_animation
                .map(|animation_did| {
                    vec![ClipSpec {
                        animation_did,
                        low_frame: 0,
                        high_frame: -1,
                        framerate: 1.0,
                    }]
                })
                .unwrap_or_default()
        });
    for clip in deduplicate_clips(clips) {
        let Some(animation) = animations.get(&clip.animation_did).and_then(Option::as_ref) else {
            continue;
        };
        if animation.part_frames.is_empty() {
            continue;
        }
        let (low, high) = resolved_clip_window(animation, clip);
        for frame in &animation.part_frames[low..=high] {
            include_animation_frame_in_origin_centered_closure(
                &mut radius,
                &mut posed_parts,
                &frame.frames,
                &stable_pose,
                &part_radii,
            );
        }
    }
    (radius, posed_parts)
}

fn stable_pose_from_cache(
    setup: &SetupModel,
    animations: &HashMap<u32, Option<Animation>>,
) -> Vec<Frame> {
    let mut pose = setup
        .placement_frames
        .get(&Placement::Resting)
        .or_else(|| setup.placement_frames.get(&Placement::Default))
        .map(|placement| placement.anim_frame.frames.clone())
        .unwrap_or_else(|| vec![Frame::default(); setup.parts.len()]);
    pose.resize(setup.parts.len(), Frame::default());
    if let Some(first) = setup
        .default_animation
        .and_then(|did| animations.get(&did))
        .and_then(Option::as_ref)
        .and_then(|animation| animation.part_frames.first())
    {
        for (destination, source) in pose.iter_mut().zip(&first.frames) {
            *destination = source.clone();
        }
    }
    pose
}

fn rotation_invariant_part_radius(sphere: Sphere, scale: Vector3) -> f32 {
    component_product(sphere.center, scale).length()
        + sphere.radius * maximum_absolute_component(scale)
}

fn include_pose_in_origin_centered_closure(
    radius: &mut f32,
    posed_parts: &mut u64,
    pose: &[Frame],
    part_radii: &[Option<f32>],
) {
    for (frame, part_radius) in pose.iter().zip(part_radii) {
        let Some(part_radius) = part_radius else {
            continue;
        };
        *radius = radius.max(frame.origin.length() + part_radius);
        *posed_parts += 1;
    }
}

fn include_animation_frame_in_origin_centered_closure(
    radius: &mut f32,
    posed_parts: &mut u64,
    sampled_pose: &[Frame],
    stable_pose: &[Frame],
    part_radii: &[Option<f32>],
) {
    for (part_index, part_radius) in part_radii.iter().enumerate() {
        let Some(part_radius) = part_radius else {
            continue;
        };
        let frame = sampled_pose
            .get(part_index)
            .unwrap_or(&stable_pose[part_index]);
        *radius = radius.max(frame.origin.length() + part_radius);
        *posed_parts += 1;
    }
}

fn print_nanos_distribution(label: &str, values: &[u128]) {
    let max = values.last().copied().unwrap_or(0);
    println!(
        "  {label} p50/p95/p99/max: {}/{}/{}/{} ns",
        percentile(values, 50),
        percentile(values, 95),
        percentile(values, 99),
        max
    );
}

fn percentile<T: Copy>(sorted: &[T], percentile: usize) -> T {
    assert!(!sorted.is_empty());
    let index = (sorted.len() - 1) * percentile / 100;
    sorted[index]
}

fn print_report(
    census: &Census,
    distinct_referenced_gfx: usize,
    without_drawing: &BTreeSet<u32>,
    without_root_sphere: &BTreeSet<u32>,
    worst: usize,
) {
    println!("selection-envelope content census");
    println!(
        "  SetupModels:                              {}",
        census.setup_count
    );
    println!(
        "  catalog templates:                        {}",
        census.catalog_template_count
    );
    println!(
        "    with setup:                             {}",
        census.catalog_templates_with_setup
    );
    println!(
        "    effectively attackable:                 {}",
        census.catalog_attackable_template_count
    );
    println!(
        "    with direct part changes:               {}",
        census.catalog_templates_with_part_changes
    );
    println!(
        "  distinct effective selection profiles:   {}",
        census.distinct_profiles
    );
    println!(
        "    reached by catalog templates:           {}",
        census.catalog_profiles
    );
    println!("  distinct referenced GfxObjs:              {distinct_referenced_gfx}");
    println!(
        "    without drawing data:                   {}",
        without_drawing.len()
    );
    println!(
        "    drawing polygons but no root sphere:    {}",
        without_root_sphere.len()
    );
    println!(
        "  profiles without drawing spheres:         {}",
        census.profiles_without_drawing_spheres
    );
    println!(
        "  profiles without any valid envelope:      {}",
        census.profiles_without_envelope
    );
    println!(
        "  invalid spheres:                          {}",
        census.invalid_spheres
    );
    println!(
        "  default/resting part-count mismatches:    {}",
        census.default_frame_part_mismatches
    );
    println!(
        "  profiles with playable animation:         {}",
        census.profiles_with_animation
    );
    println!(
        "  profile poses sampled:                     {}",
        census.profile_poses_sampled
    );
    println!(
        "  posed part spheres sampled:               {}",
        census.part_spheres_sampled
    );
    println!(
        "  escaping profiles:                        {}",
        census.escaping_profiles
    );
    println!(
        "    catalog-backed profiles:                {}",
        census.escaping_catalog_profiles
    );
    println!(
        "    affected catalog templates:             {}",
        census.affected_catalog_templates
    );
    println!(
        "      effectively attackable:               {}",
        census.affected_attackable_catalog_templates
    );
    println!(
        "    animation/root escape profiles:         {}",
        census.animation_escape_profiles
    );
    println!(
        "  escaping profile poses:                   {}",
        census.escaping_profile_poses
    );
    println!(
        "  escaping posed part spheres:              {}",
        census.escaping_part_spheres
    );
    println!(
        "  maximum escape distance:                  {:.6} m",
        census.maximum_escape
    );
    println!(
        "  maximum required/envelope radius ratio:   {:.6}",
        census.maximum_escape_ratio
    );
    println!("  with authored sorting sphere added:");
    println!(
        "    escaping profiles:                      {}",
        census.sorting_union_escaping_profiles
    );
    println!(
        "    affected catalog templates:             {}",
        census.sorting_union_affected_catalog_templates
    );
    println!(
        "    escaping posed part spheres:            {}",
        census.sorting_union_escaping_part_spheres
    );
    println!(
        "    maximum escape distance:                {:.6} m",
        census.sorting_union_maximum_escape
    );
    println!(
        "  visual-root rotation profiles:            {}",
        census.root_rotated_profiles
    );
    println!(
        "    escaping after root rotation:           {}",
        census.root_rotation_escape_profiles
    );
    println!(
        "  missing motion tables:                    {}",
        census.missing_motion_tables.len()
    );
    println!(
        "  missing animations:                       {}",
        census.missing_animations.len()
    );

    if !without_root_sphere.is_empty() {
        println!("\nGfxObjs with drawing polygons but no drawing-BSP root sphere:");
        for did in without_root_sphere.iter().take(worst) {
            println!("  0x{did:08X}");
        }
    }
    if !without_drawing.is_empty() {
        println!("\nGfxObjs without decodable drawing data:");
        for did in without_drawing.iter().take(worst) {
            println!("  0x{did:08X}");
        }
    }
    if !census.missing_motion_tables.is_empty() {
        println!("\nmissing effective motion tables:");
        for did in census.missing_motion_tables.iter().take(worst) {
            println!("  0x{did:08X}");
        }
    }
    if !census.escapes.is_empty() {
        println!("\nworst sampled escapes:");
        let mut printed = BTreeSet::new();
        for example in &census.escapes {
            if !printed.insert((
                example.setup_did,
                example.animation_did,
                example.frame_index,
                example.part_index,
                example.gfx_obj_did,
            )) {
                continue;
            }
            println!(
                "  +{:.6} m ({:.4}x) setup 0x{:08X} animation 0x{:08X} frame {} part {} gfx 0x{:08X} wcids {:?} attackable_wcids {:?}",
                example.excess,
                example.ratio,
                example.setup_did,
                example.animation_did,
                example.frame_index,
                example.part_index,
                example.gfx_obj_did,
                example.template_examples,
                example.attackable_template_examples
            );
            if printed.len() >= worst {
                break;
            }
        }
    }
}

fn print_modeled_event_sizes() {
    println!("\nmodeled named-MessagePack envelope-result sizes:");
    for count in [0_usize, 1, 10, 50, 100, 500, 1_000, 10_000] {
        let event = ModeledAvailableResult {
            sequence: 1,
            kind: "available",
            static_limit_distance: 192.0,
            candidates: (0..count)
                .map(|index| ModeledCandidate {
                    guid: 0x7000_0000_u32.saturating_add(index as u32),
                    envelope_entry_distance: index as f32,
                })
                .collect(),
        };
        let bytes = rmp_serde::to_vec_named(&event).expect("modeled result should serialize");
        println!("  {count:>6} candidates: {:>8} bytes", bytes.len());
    }

    println!("\nmodeled named-MessagePack GUID-only membership-result sizes:");
    for count in [0_usize, 1, 10, 50, 100, 229, 500, 704, 1_000, 10_000] {
        let event = ModeledMembershipAvailableResult {
            sequence: 1,
            kind: "available",
            static_limit_distance: 192.0,
            candidate_guids: (0..count)
                .map(|index| 0x7000_0000_u32.saturating_add(index as u32))
                .collect(),
        };
        let bytes = rmp_serde::to_vec_named(&event).expect("modeled result should serialize");
        println!("  {count:>6} candidates: {:>8} bytes", bytes.len());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Quaternion;

    fn sphere(x: f32, radius: f32) -> Sphere {
        Sphere {
            center: Vector3::new(x, 0.0, 0.0),
            radius,
        }
    }

    #[test]
    fn enclosing_sphere_contains_disjoint_inputs() {
        let enclosed = enclose_spheres(sphere(-2.0, 1.0), sphere(4.0, 2.0));

        assert!(containment_excess(enclosed, sphere(-2.0, 1.0)) <= CONTAINMENT_EPSILON);
        assert!(containment_excess(enclosed, sphere(4.0, 2.0)) <= CONTAINMENT_EPSILON);
        assert!((enclosed.center.x - 1.5).abs() <= CONTAINMENT_EPSILON);
        assert!((enclosed.radius - 4.5).abs() <= CONTAINMENT_EPSILON);
    }

    #[test]
    fn enclosing_sphere_preserves_containing_input() {
        let outer = sphere(3.0, 5.0);

        assert_eq!(
            enclose_spheres(outer, sphere(4.0, 1.0)).center.x,
            outer.center.x
        );
        assert_eq!(
            enclose_spheres(outer, sphere(4.0, 1.0)).radius,
            outer.radius
        );
    }

    #[test]
    fn part_sphere_scale_uses_largest_axis() {
        let transformed = transform_part_sphere(
            Sphere {
                center: Vector3::new(1.0, 1.0, 1.0),
                radius: 2.0,
            },
            &Frame {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            Vector3::new(2.0, 3.0, 4.0),
        );

        assert_eq!(transformed.center, Vector3::new(2.0, 3.0, 4.0));
        assert_eq!(transformed.radius, 8.0);
    }

    #[test]
    fn rotation_invariant_part_radius_contains_rotated_drawing_sphere() {
        let local = Sphere {
            center: Vector3::new(1.0, -2.0, 0.5),
            radius: 0.75,
        };
        let scale = Vector3::new(-2.0, 3.0, 0.5);
        let pose = Frame {
            origin: Vector3::new(4.0, 5.0, 6.0),
            orientation: Quaternion::from_axis_angle(Vector3::new(0.3, 0.7, 0.2), 1.3).unwrap(),
        };
        let transformed = transform_part_sphere(local, &pose, scale);
        let closure_radius = pose.origin.length() + rotation_invariant_part_radius(local, scale);

        assert!(transformed.center.length() + transformed.radius <= closure_radius + 0.000_01);
    }

    #[test]
    fn endpoint_closure_contains_interpolated_translation() {
        let part_radius = 2.5;
        let start = Vector3::new(-8.0, 2.0, 1.0);
        let end = Vector3::new(3.0, 9.0, -4.0);
        let closure_radius = (start.length() + part_radius).max(end.length() + part_radius);

        for step in 0..=20 {
            let fraction = step as f32 / 20.0;
            let center = start * (1.0 - fraction) + end * fraction;
            assert!(center.length() + part_radius <= closure_radius + 0.000_01);
        }
    }

    #[test]
    fn escape_examples_remain_bounded_and_worst_first() {
        let example = |excess: f32, frame_index: usize| EscapeExample {
            excess,
            ratio: excess,
            setup_did: 1,
            animation_did: 2,
            frame_index,
            part_index: 0,
            gfx_obj_did: 3,
            template_examples: Vec::new(),
            attackable_template_examples: Vec::new(),
        };
        let mut examples = Vec::new();
        record_escape(&mut examples, example(2.0, 2), 2);
        record_escape(&mut examples, example(1.0, 1), 2);
        record_escape(&mut examples, example(3.0, 3), 2);

        assert_eq!(examples.len(), 2);
        assert_eq!(examples[0].excess, 3.0);
        assert_eq!(examples[1].excess, 2.0);
    }
}
