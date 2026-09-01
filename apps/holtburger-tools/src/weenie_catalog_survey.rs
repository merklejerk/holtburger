//! Deterministic census over an offline weenie catalog and normal mounted client content.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Cursor;
use std::path::Path;

use anyhow::{Context, Result};
use holtburger_content::{ContentRepository, MotionSequenceCatalog};
use holtburger_dat::file_type::motion_table::{AnimData, MotionData};
use holtburger_dat::file_type::setup_model::{AnimationHook, AnimationHookPayload};
use holtburger_dat::file_type::{
    Animation, DatFileType, GfxObj, MotionTable, PhysicsScript, SetupModel,
};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_weenie_catalog::{PhysicsBoolOverrides, WeenieCatalog, WeenieTemplate};
use serde::Serialize;

const DEFAULT_PHYSICS_STATE: u32 = 0x0040_0C08;
const STATIC: u32 = 0x0000_0001;
const ETHEREAL: u32 = 0x0000_0004;
const REPORT_COLLISIONS: u32 = 0x0000_0008;
const IGNORE_COLLISIONS: u32 = 0x0000_0010;
const NO_DRAW: u32 = 0x0000_0020;
const MISSILE: u32 = 0x0000_0040;
const GRAVITY: u32 = 0x0000_0400;
const LIGHTING_ON: u32 = 0x0000_0800;
const SCRIPTED_COLLISION: u32 = 0x0000_8000;
const HAS_PHYSICS_BSP: u32 = 0x0001_0000;
const INELASTIC: u32 = 0x0002_0000;
const HAS_DEFAULT_ANIM: u32 = 0x0004_0000;
const HAS_DEFAULT_SCRIPT: u32 = 0x0008_0000;
const REPORT_COLLISIONS_AS_ENVIRONMENT: u32 = 0x0020_0000;
const EDGE_SLIDE: u32 = 0x0040_0000;
const FROZEN: u32 = 0x0100_0000;
const KNOWN_PHYSICS_BITS: u32 = 0x01FF_FFFF;
const FIXED_TICKS_PER_SECOND: f64 = 30.0;
const ROOT_IDENTITY_EPSILON: f64 = 1.0e-6;
const REPRESENTATIVE_SPEED_MULTIPLIER: f64 = 3.0;
const REPRESENTATIVE_WCIDS: [u32; 10] = [1, 21, 147, 158, 239, 400, 1499, 34621, 27437, 52077];

/// Stable, machine-readable Phase R0 measurements.
#[derive(Debug, Serialize)]
pub struct WeenieCatalogSurvey {
    /// Catalog-only facts that require no client content.
    pub catalog: CatalogSurvey,
    /// Setup/GfxObj facts resolved through the normal content repository.
    pub content: ContentSurvey,
}

/// Catalog-only population measurements.
#[derive(Debug, Serialize)]
pub struct CatalogSurvey {
    /// Number of WCID records.
    pub records: usize,
    /// Distribution of encoded record bytes.
    pub encoded_payload_bytes: IntegerDistribution,
    /// Counts of absent optional facts.
    pub missing: BTreeMap<&'static str, u64>,
    /// Counts by raw ACE `WeenieType` value.
    pub weenie_types: BTreeMap<i32, u64>,
    /// Counts by optional raw base physics mask.
    pub base_physics_masks: BTreeMap<String, u64>,
    /// Absent/false/true counts for every exported bool override.
    pub bool_overrides: BTreeMap<&'static str, OptionalBoolDistribution>,
    /// Per-record palette-range cardinality.
    pub sub_palette_counts: BTreeMap<usize, u64>,
    /// Per-record texture-substitution cardinality.
    pub texture_change_counts: BTreeMap<usize, u64>,
    /// Per-record animation-part-substitution cardinality.
    pub anim_part_change_counts: BTreeMap<usize, u64>,
    /// Palette ranges with zero packed length.
    pub zero_length_sub_palettes: u64,
    /// Palette ranges whose expanded color interval exceeds the 2048-color palette.
    pub out_of_bounds_sub_palettes: u64,
    /// Overlapping palette-range pairs within one WCID.
    pub overlapping_sub_palette_pairs: u64,
    /// Present default scales that cannot produce positive finite geometry.
    pub invalid_default_scales: u64,
    /// Present default-scale distribution.
    pub default_scale: FloatDistribution,
    /// Present friction distribution.
    pub friction: FloatDistribution,
    /// Present elasticity distribution.
    pub elasticity: FloatDistribution,
    /// Present launch-speed magnitude distribution.
    pub maximum_velocity: FloatDistribution,
    /// Present projectile rotation-speed distribution.
    pub rotation_speed: FloatDistribution,
    /// Appearance-input census used to size face resolution and the equipment merge.
    pub appearance: AppearanceSurvey,
}

/// Distribution of the authored appearance facts and wielded equipment.
#[derive(Debug, Serialize)]
pub struct AppearanceSurvey {
    /// Records carrying each optional appearance data ID, keyed by field name.
    pub present_appearance_dids: BTreeMap<&'static str, u64>,
    /// Records carrying at least one explicit face data ID.
    pub records_with_any_face_did: u64,
    /// Records with both a resolvable heritage and gender source, i.e. face-generation eligible.
    pub generation_eligible: u64,
    /// Eligible records whose skin, hair, and eyes palettes are all authored.
    pub eligible_fully_authored: u64,
    /// Eligible records with some but not all of those three authored.
    pub eligible_partly_authored: u64,
    /// Eligible records authoring none of them, so every feature is generated.
    pub eligible_fully_generated: u64,
    /// Records carrying `ClothingBase`, i.e. wearable items.
    pub records_with_clothing_base: u64,
    /// Per-record wielded-entry cardinality.
    pub wielded_counts: BTreeMap<usize, u64>,
    /// Total wielded entries by raw destination type.
    pub wielded_by_destination_type: BTreeMap<i32, u64>,
    /// Distinct heritage/sex string pairs observed, as `heritage/sex`.
    pub heritage_sex_pairs: BTreeMap<String, u64>,
}

/// Client-content measurements and the effective masks derived from them.
#[derive(Debug, Serialize)]
pub struct ContentSurvey {
    /// Number of distinct non-null setup DIDs referenced by templates.
    pub referenced_setups: usize,
    /// Distinct setup DIDs decoded successfully.
    pub decoded_setups: usize,
    /// Distinct setup resources that could not be read.
    pub unavailable_setups: usize,
    /// Distinct setup resources that were present but malformed.
    pub malformed_setups: usize,
    /// First bounded examples of setup failures.
    pub setup_failure_samples: Vec<String>,
    /// Setup part-count distribution.
    pub part_counts: BTreeMap<usize, u64>,
    /// Ordinary setup sphere-count distribution.
    pub sphere_counts: BTreeMap<usize, u64>,
    /// Setup cylsphere-count distribution.
    pub cylsphere_counts: BTreeMap<usize, u64>,
    /// Ordinary sphere-radius distribution.
    pub sphere_radii: FloatDistribution,
    /// Cylsphere-radius distribution.
    pub cylsphere_radii: FloatDistribution,
    /// Cylsphere-height distribution.
    pub cylsphere_heights: FloatDistribution,
    /// Setups whose part list contains at least one physics BSP.
    pub setups_with_physics_bsp: usize,
    /// Setups that name a default animation.
    pub setups_with_default_animation: usize,
    /// Setups that name a default physics script.
    pub setups_with_default_script: usize,
    /// Physics-BSP setups that also name a default animation.
    pub physics_bsp_setups_with_default_animation: usize,
    /// Physics-BSP setups that also name a default physics script.
    pub physics_bsp_setups_with_default_script: usize,
    /// Exact catalog-reachable physics-BSP setups with authored default behavior.
    pub physics_bsp_default_behavior_setups: Vec<PhysicsBspDefaultBehaviorSetupSurvey>,
    /// Appearance substitutions that change a part consulted by the physics-BSP target branch.
    pub physics_bsp_appearance_changes: Vec<PhysicsBspAppearanceChangeSurvey>,
    /// Distinct referenced GfxObjs that could not be read or decoded.
    pub unavailable_or_malformed_gfx_objs: usize,
    /// Effective mask counts for templates whose setup decoded.
    pub effective_physics_masks: BTreeMap<String, u64>,
    /// Effective per-bit population for templates whose setup decoded.
    pub effective_physics_bits: BTreeMap<&'static str, u64>,
    /// Effective collision/reporting bit combinations, keyed by the masked value.
    pub collision_filter_masks: BTreeMap<String, u64>,
    /// Moving-query geometry chosen by retail's sphere-path initialization.
    pub moving_geometry_classes: BTreeMap<&'static str, u64>,
    /// Dynamic-target geometry selected by the retail collision branch.
    pub target_geometry_classes: BTreeMap<&'static str, u64>,
    /// Counts of overlapping state-selected solver roles.
    pub state_participation: StateParticipationCounts,
    /// Templates retaining bits outside ACE's currently named mask.
    pub templates_with_unknown_physics_bits: u64,
    /// Explicit rule used to derive the reported effective mask.
    pub effective_mask_rule: &'static str,
    /// Bounded deterministic WCID examples for measured branches and rejection cases.
    pub representative_samples: BTreeMap<&'static str, Vec<RepresentativeTemplate>>,
    /// Authored locomotion vectors from the derived HBA motion-kinematics asset.
    pub motion_contract: MotionContractSurvey,
    /// Ordered animation root-transform facts from raw motion tables and animations.
    pub authored_root_motion: AuthoredRootMotionSurvey,
}

/// One physics-BSP setup that authors a default animation or physics script.
#[derive(Debug, Clone, Serialize)]
pub struct PhysicsBspDefaultBehaviorSetupSurvey {
    /// Setup resource id.
    pub setup_did: String,
    /// Every catalog template that references this setup.
    pub templates: Vec<PhysicsBspDefaultBehaviorTemplateSurvey>,
    /// Zero-based setup part indexes whose GfxObj contains a physics BSP.
    pub physics_bsp_part_indices: Vec<usize>,
    /// Default-animation behavior, when authored by the setup.
    pub default_animation: Option<DefaultAnimationSurvey>,
    /// Default-script behavior and transitive `CallPES` closure, when authored by the setup.
    pub default_script: Option<DefaultScriptSurvey>,
}

/// Catalog identity retained for a physics-BSP default-behavior census entry.
#[derive(Debug, Clone, Serialize)]
pub struct PhysicsBspDefaultBehaviorTemplateSurvey {
    /// Catalog WCID.
    pub wcid: u32,
    /// Human-facing name, falling back to the source class name.
    pub name: String,
    /// Effective BSP-bearing part indexes after this template's animation-part substitutions.
    pub effective_physics_bsp_part_indices: Vec<usize>,
}

/// One template whose appearance changes whether one or more parts carry a physics BSP.
#[derive(Debug, Clone, Serialize)]
pub struct PhysicsBspAppearanceChangeSurvey {
    /// Catalog WCID.
    pub wcid: u32,
    /// Human-facing template name.
    pub name: String,
    /// Setup resource whose base parts select the physics-BSP branch.
    pub setup_did: String,
    /// Retail's branch decision cached from the unmodified setup before substitutions apply.
    pub cached_physics_bsp_branch: bool,
    /// Collision-relevant part substitutions in source order.
    pub substitutions: Vec<PhysicsBspPartSubstitutionSurvey>,
}

/// One animation-part substitution where either the old or replacement part carries a physics BSP.
#[derive(Debug, Clone, Serialize)]
pub struct PhysicsBspPartSubstitutionSurvey {
    /// Zero-based setup part index.
    pub part_index: usize,
    /// Base setup GfxObj resource id.
    pub base_part_did: String,
    /// Replacement GfxObj resource id.
    pub replacement_part_did: String,
    /// Whether the base part carries a physics BSP.
    pub base_has_physics_bsp: bool,
    /// Whether the replacement part carries a physics BSP.
    pub replacement_has_physics_bsp: bool,
}

/// Collision-relevant facts decoded from one setup default animation.
#[derive(Debug, Clone, Serialize)]
pub struct DefaultAnimationSurvey {
    /// Animation resource id.
    pub animation_did: String,
    /// Number of authored frames.
    pub frames: u32,
    /// Whether the animation carries root-position frames.
    pub has_position_frames: bool,
    /// Physics-BSP parts whose local frame differs during the animation.
    pub moving_physics_bsp_part_indices: Vec<usize>,
    /// Count of every authored hook type across all animation frames.
    pub hook_types: BTreeMap<&'static str, u64>,
    /// Hooks requiring host physics semantics rather than frontend-only presentation.
    pub collision_relevant_hooks: Vec<CollisionRelevantHookSurvey>,
}

/// Collision-relevant facts decoded from a setup default script and its chained scripts.
#[derive(Debug, Clone, Serialize)]
pub struct DefaultScriptSurvey {
    /// Root script resource id named by the setup.
    pub root_script_did: String,
    /// Deterministically sorted transitive script resource ids reached through `CallPES`.
    pub script_dids: Vec<String>,
    /// Count of every authored hook type in the transitive closure.
    pub hook_types: BTreeMap<&'static str, u64>,
    /// Hooks requiring host physics semantics rather than frontend-only presentation.
    pub collision_relevant_hooks: Vec<CollisionRelevantHookSurvey>,
}

/// One authored hook whose execution can alter collision geometry, transforms, or filtering.
#[derive(Debug, Clone, Serialize)]
pub struct CollisionRelevantHookSurvey {
    /// Script DID for script hooks; animation DID for animation-frame hooks.
    pub source_did: String,
    /// Script start time, absent for animation-frame hooks.
    pub start_time_seconds: Option<f64>,
    /// Stable decoded hook name.
    pub hook: &'static str,
    /// Why the hook is relevant to host collision truth.
    pub effect: &'static str,
}

/// Population and magnitude ranges of authored cyclic motion vectors, read from the runtime motion
/// contract rather than from a derived asset.
#[derive(Debug, Default, Serialize)]
pub struct MotionContractSurvey {
    /// Setup-to-default-motion-table mappings.
    pub setup_defaults: usize,
    /// Distinct projected motion tables.
    pub motion_tables: usize,
    /// Stance/command cycle entries across all motion tables.
    pub cycle_entries: usize,
    /// Magnitudes of authored velocity vectors in metres per second. Only explicit motion-data
    /// velocity is counted: cycles whose motion is authored as root transforms contribute nothing
    /// here, because reducing them to a speed would be a second, competing motion fact.
    pub velocity_magnitudes: FloatDistribution,
    /// Magnitudes of authored angular-velocity vectors in radians per second.
    pub omega_magnitudes: FloatDistribution,
    /// Cycles whose only motion source is authored root transforms.
    pub cycles_authored_only: usize,
}

/// Population evidence used to choose the Phase 6 solver root-motion contract.
#[derive(Debug, Default, Serialize)]
pub struct AuthoredRootMotionSurvey {
    /// Raw motion tables present in the mounted content population.
    pub motion_tables: usize,
    /// Motion-data records across cycles, modifiers, and links.
    pub motion_data_entries: usize,
    /// Animation range/rate records across all motion-data records.
    pub animation_entries: usize,
    /// Distinct animations referenced by those records.
    pub referenced_animations: usize,
    /// Referenced animations carrying authored root-position frames.
    pub animations_with_position_frames: usize,
    /// Referenced animations with a non-identity root translation.
    pub animations_with_translation: usize,
    /// Referenced animations with a non-identity root rotation.
    pub animations_with_rotation: usize,
    /// Motion tables whose selected ranges contain authored root-position frames.
    pub motion_tables_with_position_frames: usize,
    /// Motion tables whose selected ranges contain non-identity root translation.
    pub motion_tables_with_translation: usize,
    /// Motion tables whose selected ranges contain non-identity root rotation.
    pub motion_tables_with_rotation: usize,
    /// Authored root-position frames across distinct referenced animations.
    pub position_frames: usize,
    /// Magnitudes of non-identity authored root translations in metres.
    pub translation_magnitudes: FloatDistribution,
    /// Angles of non-identity authored root rotations in radians.
    pub rotation_angles: FloatDistribution,
    /// Maximum possible authored frame boundaries crossed in one 30 Hz tick at stored rate.
    pub frame_boundaries_per_tick_1x: IntegerDistribution,
    /// Same bound under an explicit 3x speed-modifier stress case.
    pub frame_boundaries_per_tick_3x: IntegerDistribution,
    /// Root-transform animation entries able to cross more than one boundary per tick at stored rate.
    pub multi_boundary_entries_1x: usize,
    /// Root-transform animation entries able to cross more than one boundary per tick at 3x rate.
    pub multi_boundary_entries_3x: usize,
    /// Catalog templates whose effective target is a physics BSP and whose motion table references root transforms.
    pub physics_bsp_templates_with_root_motion: usize,
    /// Catalog templates naming a motion table through an override or setup default.
    pub catalog_templates_with_motion_table_reference: usize,
    /// Catalog templates whose named motion table exists in mounted content and decoded.
    pub catalog_templates_with_decoded_motion_table: usize,
    /// Missing effective motion-table DIDs and the number of affected templates.
    pub unavailable_motion_table_references: BTreeMap<String, u64>,
    /// Catalog templates whose resolved table contains selected root-position frames.
    pub catalog_templates_with_position_frames: usize,
    /// Catalog templates whose resolved table contains non-identity root translation.
    pub catalog_templates_with_translation: usize,
    /// Catalog templates whose resolved table contains non-identity root rotation.
    pub catalog_templates_with_rotation: usize,
    /// Every catalog template combining a physics-BSP target with table-reachable root motion.
    pub physics_bsp_root_motion_templates: Vec<PhysicsBspRootMotionTemplateSurvey>,
    /// Root-motion reachability for the plan's fixed representative WCID population.
    pub representative_templates: Vec<RepresentativeRootMotionSurvey>,
    /// Numeric tolerance used only to classify an authored transform as identity.
    pub identity_epsilon: f64,
}

/// One catalog template proving that a physics-BSP target can also resolve root motion.
#[derive(Debug, Serialize)]
pub struct PhysicsBspRootMotionTemplateSurvey {
    /// Catalog WCID.
    pub wcid: u32,
    /// Human-facing catalog name.
    pub name: String,
    /// Effective motion table.
    pub motion_table_did: String,
    /// Whether selected ranges contain non-identity root translation.
    pub has_translation: bool,
    /// Whether selected ranges contain non-identity root rotation.
    pub has_rotation: bool,
}

/// Motion-table and root-transform facts for one representative catalog template.
#[derive(Debug, Serialize)]
pub struct RepresentativeRootMotionSurvey {
    /// Catalog WCID.
    pub wcid: u32,
    /// Human-facing catalog name.
    pub name: String,
    /// Effective motion-table reference and its mounted-content availability, when named.
    pub motion_table: Option<RepresentativeMotionTableSurvey>,
    /// Whether the resolved table references any authored root-position frame.
    pub has_position_frames: bool,
    /// Whether those selected ranges contain non-identity root translation.
    pub has_translation: bool,
    /// Whether those selected ranges contain non-identity root rotation.
    pub has_rotation: bool,
    /// Whether retail's effective dynamic-target branch is a physics BSP.
    pub physics_bsp_target: bool,
    /// Maximum possible frame boundaries crossed per tick at stored rate.
    pub max_frame_boundaries_per_tick_1x: u64,
    /// Maximum possible frame boundaries crossed per tick under the explicit 3x stress case.
    pub max_frame_boundaries_per_tick_3x: u64,
}

/// One representative template's effective motion-table reference.
#[derive(Debug, Serialize)]
pub struct RepresentativeMotionTableSurvey {
    /// Motion-table resource id.
    pub did: String,
    /// Whether the resource exists in mounted content and decoded.
    pub available: bool,
}

/// Count and percentile summary for non-negative integer values.
#[derive(Debug, Default, Serialize)]
pub struct IntegerDistribution {
    /// Number of samples.
    pub count: usize,
    /// Sum of all samples.
    pub total: u64,
    /// Minimum sample.
    pub min: u64,
    /// Median sample.
    pub p50: u64,
    /// 95th-percentile sample.
    pub p95: u64,
    /// 99th-percentile sample.
    pub p99: u64,
    /// Maximum sample.
    pub max: u64,
}

/// Count and range summary for finite floating-point values.
#[derive(Debug, Default, Serialize)]
pub struct FloatDistribution {
    /// Number of present samples.
    pub count: usize,
    /// Minimum sample, absent when the population is empty.
    pub min: Option<f64>,
    /// Maximum sample, absent when the population is empty.
    pub max: Option<f64>,
}

/// Three-way population of an optional boolean.
#[derive(Debug, Default, Serialize)]
pub struct OptionalBoolDistribution {
    /// Property row absent.
    pub absent: u64,
    /// Explicit false row.
    pub false_count: u64,
    /// Explicit true row.
    pub true_count: u64,
}

/// State-only participation counts; live motion, parentage, and insertion policy remain separate.
#[derive(Debug, Default, Serialize)]
pub struct StateParticipationCounts {
    /// Bodies not blocked from fixed-tick integration by `Static` or `Frozen`.
    pub integration_eligible: u64,
    /// Bodies blocked from fixed-tick integration by `Static` or `Frozen`.
    pub integration_blocked: u64,
    /// Bodies with target geometry that is not suppressed by `Ethereal|IgnoreCollisions`.
    pub dynamic_collision_targets: u64,
    /// Bodies suppressed as targets by `Ethereal|IgnoreCollisions`.
    pub state_suppressed_targets: u64,
    /// Bodies with no setup target geometry in the selected retail branch.
    pub geometry_absent_targets: u64,
}

/// One deterministic catalog example retained to make a measured branch reproducible.
#[derive(Debug, Clone, Serialize)]
pub struct RepresentativeTemplate {
    /// Catalog identity.
    pub wcid: u32,
    /// Human-facing name from the source row.
    pub name: String,
    /// Raw ACE object category.
    pub weenie_type: i32,
    /// Referenced setup DID.
    pub setup_did: u32,
    /// Raw optional ACE default scale.
    pub default_scale: Option<f64>,
    /// Effective mask calculated by this survey.
    pub effective_mask: String,
    /// Dynamic-target geometry branch.
    pub target_geometry: &'static str,
}

#[derive(Debug)]
struct SetupFacts {
    has_physics_bsp: bool,
    has_default_animation: bool,
    has_default_script: bool,
    physics_bsp_part_indices: Vec<usize>,
    parts: Vec<u32>,
    default_animation: Option<u32>,
    default_script: Option<u32>,
    default_motion_table: Option<u32>,
    sphere_count: usize,
    cylsphere_count: usize,
}

#[derive(Debug)]
struct PhysicsBspAppearanceSurvey {
    effective_parts_by_wcid: BTreeMap<u32, Vec<usize>>,
    changes: Vec<PhysicsBspAppearanceChangeSurvey>,
}

/// Surveys every catalog record and every distinct referenced setup through mounted HBA content.
pub fn survey_weenie_catalog(
    catalog_path: &Path,
    content: &ContentRepository,
) -> Result<WeenieCatalogSurvey> {
    let catalog = WeenieCatalog::open(catalog_path)
        .with_context(|| format!("could not open catalog {}", catalog_path.display()))?;
    let mut templates = Vec::with_capacity(catalog.len());
    let encoded_lengths = catalog
        .records()
        .map(|record| u64::from(record.encoded_length))
        .collect::<Vec<_>>();
    for record in catalog.records() {
        let template = catalog
            .lookup(record.wcid)
            .with_context(|| format!("could not decode catalog WCID {}", record.wcid))?
            .with_context(|| format!("catalog index lost WCID {}", record.wcid))?;
        templates.push(template);
    }

    let catalog_survey = survey_templates(&templates, encoded_lengths);
    let content_survey = survey_content(&templates, content)?;
    Ok(WeenieCatalogSurvey {
        catalog: catalog_survey,
        content: content_survey,
    })
}

fn survey_templates(templates: &[WeenieTemplate], encoded_lengths: Vec<u64>) -> CatalogSurvey {
    let mut missing = BTreeMap::new();
    let mut weenie_types = BTreeMap::new();
    let mut base_physics_masks = BTreeMap::new();
    let mut bool_overrides = bool_distributions();
    let mut sub_palette_counts = BTreeMap::new();
    let mut texture_change_counts = BTreeMap::new();
    let mut anim_part_change_counts = BTreeMap::new();
    let mut default_scale = FloatDistribution::default();
    let mut friction = FloatDistribution::default();
    let mut elasticity = FloatDistribution::default();
    let mut maximum_velocity = FloatDistribution::default();
    let mut rotation_speed = FloatDistribution::default();
    let mut zero_length_sub_palettes = 0;
    let mut out_of_bounds_sub_palettes = 0;
    let mut overlapping_sub_palette_pairs = 0;
    let mut invalid_default_scales = 0;

    for template in templates {
        count_missing(&mut missing, "name", template.name.is_none());
        count_missing(&mut missing, "setup_did", template.setup_did.is_none());
        count_missing(
            &mut missing,
            "motion_table_did",
            template.motion_table_did.is_none(),
        );
        count_missing(
            &mut missing,
            "sound_table_did",
            template.sound_table_did.is_none(),
        );
        count_missing(
            &mut missing,
            "physics_effect_table_did",
            template.physics_effect_table_did.is_none(),
        );
        count_missing(
            &mut missing,
            "palette_base_did",
            template.palette_base_did.is_none(),
        );
        count_missing(
            &mut missing,
            "default_scale",
            template.default_scale.is_none(),
        );
        count_missing(&mut missing, "friction", template.friction.is_none());
        count_missing(&mut missing, "elasticity", template.elasticity.is_none());
        count_missing(
            &mut missing,
            "maximum_velocity",
            template.maximum_velocity.is_none(),
        );
        count_missing(
            &mut missing,
            "rotation_speed",
            template.rotation_speed.is_none(),
        );
        count_missing(
            &mut missing,
            "base_physics_mask",
            template.physics.base_mask.is_none(),
        );
        *weenie_types.entry(template.weenie_type).or_default() += 1;
        let base_key = template
            .physics
            .base_mask
            .map_or_else(|| "absent".to_owned(), mask_key);
        *base_physics_masks.entry(base_key).or_default() += 1;
        count_overrides(&mut bool_overrides, &template.physics.overrides);
        increment_histogram(&mut sub_palette_counts, template.sub_palettes.len());
        increment_histogram(&mut texture_change_counts, template.texture_changes.len());
        increment_histogram(
            &mut anim_part_change_counts,
            template.anim_part_changes.len(),
        );
        default_scale.observe(template.default_scale);
        friction.observe(template.friction);
        elasticity.observe(template.elasticity);
        maximum_velocity.observe(template.maximum_velocity);
        rotation_speed.observe(template.rotation_speed);
        if template.default_scale.is_some_and(|scale| scale <= 0.0) {
            invalid_default_scales += 1;
        }
        zero_length_sub_palettes += template
            .sub_palettes
            .iter()
            .filter(|palette| palette.length == 0)
            .count() as u64;
        out_of_bounds_sub_palettes += template
            .sub_palettes
            .iter()
            .filter(|palette| {
                (u32::from(palette.offset) + u32::from(palette.length)).saturating_mul(8) > 2048
            })
            .count() as u64;
        for (index, left) in template.sub_palettes.iter().enumerate() {
            for right in &template.sub_palettes[index + 1..] {
                let left_end = u32::from(left.offset) + u32::from(left.length);
                let right_end = u32::from(right.offset) + u32::from(right.length);
                if u32::from(left.offset) < right_end && u32::from(right.offset) < left_end {
                    overlapping_sub_palette_pairs += 1;
                }
            }
        }
    }

    CatalogSurvey {
        records: templates.len(),
        encoded_payload_bytes: integer_distribution(encoded_lengths),
        missing,
        weenie_types,
        base_physics_masks,
        bool_overrides,
        sub_palette_counts,
        texture_change_counts,
        anim_part_change_counts,
        zero_length_sub_palettes,
        out_of_bounds_sub_palettes,
        overlapping_sub_palette_pairs,
        invalid_default_scales,
        default_scale,
        friction,
        elasticity,
        maximum_velocity,
        rotation_speed,
        appearance: survey_appearance(templates),
    }
}

fn survey_appearance(templates: &[WeenieTemplate]) -> AppearanceSurvey {
    let mut present_appearance_dids = BTreeMap::new();
    let mut records_with_any_face_did = 0;
    let mut generation_eligible = 0;
    let mut eligible_fully_authored = 0;
    let mut eligible_partly_authored = 0;
    let mut eligible_fully_generated = 0;
    let mut records_with_clothing_base = 0;
    let mut wielded_counts = BTreeMap::new();
    let mut wielded_by_destination_type = BTreeMap::new();
    let mut heritage_sex_pairs = BTreeMap::new();

    for template in templates {
        let appearance = &template.appearance;
        let face_dids: [(&'static str, bool); 11] = [
            ("clothing_base_did", appearance.clothing_base_did.is_some()),
            ("head_object_did", appearance.head_object_did.is_some()),
            ("skin_palette_did", appearance.skin_palette_did.is_some()),
            ("hair_palette_did", appearance.hair_palette_did.is_some()),
            ("eyes_palette_did", appearance.eyes_palette_did.is_some()),
            ("eyes_texture_did", appearance.eyes_texture_did.is_some()),
            (
                "default_eyes_texture_did",
                appearance.default_eyes_texture_did.is_some(),
            ),
            ("nose_texture_did", appearance.nose_texture_did.is_some()),
            (
                "default_nose_texture_did",
                appearance.default_nose_texture_did.is_some(),
            ),
            ("mouth_texture_did", appearance.mouth_texture_did.is_some()),
            (
                "default_mouth_texture_did",
                appearance.default_mouth_texture_did.is_some(),
            ),
        ];
        for (field, present) in face_dids {
            let counter = present_appearance_dids.entry(field).or_insert(0);
            if present {
                *counter += 1;
            }
        }
        // `ClothingBase` marks a wearable item rather than a face, so it is excluded here.
        if face_dids
            .iter()
            .any(|(field, present)| *present && *field != "clothing_base_did")
        {
            records_with_any_face_did += 1;
        }
        if appearance.clothing_base_did.is_some() {
            records_with_clothing_base += 1;
        }

        let has_heritage =
            appearance.heritage_group.is_some() || appearance.heritage_group_name.is_some();
        let has_gender = appearance.gender.is_some() || appearance.sex.is_some();
        if has_heritage && has_gender {
            generation_eligible += 1;
            let authored = u8::from(appearance.skin_palette_did.is_some())
                + u8::from(appearance.hair_palette_did.is_some())
                + u8::from(appearance.eyes_palette_did.is_some());
            match authored {
                3 => eligible_fully_authored += 1,
                0 => eligible_fully_generated += 1,
                _ => eligible_partly_authored += 1,
            }
        }
        if let (Some(heritage), Some(sex)) = (
            appearance.heritage_group_name.as_deref(),
            appearance.sex.as_deref(),
        ) {
            *heritage_sex_pairs
                .entry(format!("{heritage}/{sex}"))
                .or_insert(0) += 1;
        }

        *wielded_counts.entry(template.wielded.len()).or_insert(0) += 1;
        for entry in &template.wielded {
            *wielded_by_destination_type
                .entry(entry.destination_type)
                .or_insert(0) += 1;
        }
    }

    AppearanceSurvey {
        present_appearance_dids,
        records_with_any_face_did,
        generation_eligible,
        eligible_fully_authored,
        eligible_partly_authored,
        eligible_fully_generated,
        records_with_clothing_base,
        wielded_counts,
        wielded_by_destination_type,
        heritage_sex_pairs,
    }
}

fn survey_content(
    templates: &[WeenieTemplate],
    content: &ContentRepository,
) -> Result<ContentSurvey> {
    let setup_ids = templates
        .iter()
        .filter_map(|template| template.setup_did)
        .collect::<BTreeSet<_>>();
    let mut setup_facts = BTreeMap::new();
    let mut unavailable_setups = 0;
    let mut malformed_setups = 0;
    let mut setup_failure_samples = Vec::new();
    let mut part_counts = BTreeMap::new();
    let mut sphere_counts = BTreeMap::new();
    let mut cylsphere_counts = BTreeMap::new();
    let mut sphere_radii = FloatDistribution::default();
    let mut cylsphere_radii = FloatDistribution::default();
    let mut cylsphere_heights = FloatDistribution::default();
    let mut gfx_facts = BTreeMap::<u32, Option<bool>>::new();

    for setup_id in &setup_ids {
        let resource =
            match content.read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, *setup_id)) {
                Ok(resource) => resource,
                Err(error) => {
                    unavailable_setups += 1;
                    push_failure(
                        &mut setup_failure_samples,
                        format!("0x{setup_id:08X}: unavailable: {error:#}"),
                    );
                    continue;
                }
            };
        let setup = match SetupModel::unpack(&mut Cursor::new(resource.bytes)) {
            Ok(setup) => setup,
            Err(error) => {
                malformed_setups += 1;
                push_failure(
                    &mut setup_failure_samples,
                    format!("0x{setup_id:08X}: malformed: {error}"),
                );
                continue;
            }
        };
        increment_histogram(&mut part_counts, setup.parts.len());
        increment_histogram(&mut sphere_counts, setup.spheres.len());
        increment_histogram(&mut cylsphere_counts, setup.cyl_spheres.len());
        for sphere in &setup.spheres {
            sphere_radii.observe(Some(f64::from(sphere.radius)));
        }
        for cylsphere in &setup.cyl_spheres {
            cylsphere_radii.observe(Some(f64::from(cylsphere.radius)));
            cylsphere_heights.observe(Some(f64::from(cylsphere.height)));
        }
        let physics_bsp_part_indices = setup
            .parts
            .iter()
            .enumerate()
            .filter_map(|(part_index, part_id)| {
                gfx_facts
                    .entry(*part_id)
                    .or_insert_with(|| {
                        content
                            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, *part_id))
                            .ok()
                            .and_then(|resource| {
                                GfxObj::unpack(&mut Cursor::new(resource.bytes)).ok()
                            })
                            .map(|gfx| gfx.physics_bsp.is_some())
                    })
                    .is_some_and(|has_bsp| has_bsp)
                    .then_some(part_index)
            })
            .collect::<Vec<_>>();
        setup_facts.insert(
            *setup_id,
            SetupFacts {
                has_physics_bsp: !physics_bsp_part_indices.is_empty(),
                has_default_animation: setup.default_animation.is_some(),
                has_default_script: setup.default_script.is_some(),
                physics_bsp_part_indices,
                parts: setup.parts,
                default_animation: setup.default_animation,
                default_script: setup.default_script,
                default_motion_table: setup.default_motion_table,
                sphere_count: setup.spheres.len(),
                cylsphere_count: setup.cyl_spheres.len(),
            },
        );
    }

    let physics_bsp_appearance =
        survey_physics_bsp_appearance(templates, &setup_facts, content, &mut gfx_facts)?;

    let mut effective_physics_masks = BTreeMap::new();
    let mut effective_physics_bits = physics_bit_counts();
    let mut collision_filter_masks = BTreeMap::new();
    let mut moving_geometry_classes = BTreeMap::new();
    let mut target_geometry_classes = BTreeMap::new();
    let mut state_participation = StateParticipationCounts::default();
    let mut representative_samples = BTreeMap::new();
    let mut templates_with_unknown_physics_bits = 0;
    for template in templates {
        let Some(setup) = template.setup_did.and_then(|id| setup_facts.get(&id)) else {
            continue;
        };
        let mask = effective_mask(template, setup);
        *effective_physics_masks.entry(mask_key(mask)).or_default() += 1;
        for (name, bit) in physics_bits() {
            if mask & bit != 0 {
                *effective_physics_bits.entry(name).or_default() += 1;
            }
        }
        if mask & !KNOWN_PHYSICS_BITS != 0 {
            templates_with_unknown_physics_bits += 1;
        }
        let filter_mask = mask
            & (ETHEREAL | REPORT_COLLISIONS | IGNORE_COLLISIONS | REPORT_COLLISIONS_AS_ENVIRONMENT);
        *collision_filter_masks
            .entry(mask_key(filter_mask))
            .or_default() += 1;

        let moving_geometry = match setup.sphere_count {
            0 => "dummy_sphere",
            1 => "one_sphere",
            _ => "two_spheres",
        };
        *moving_geometry_classes.entry(moving_geometry).or_default() += 1;
        let target_geometry = target_geometry_class(mask, setup);
        *target_geometry_classes.entry(target_geometry).or_default() += 1;

        if mask & (STATIC | FROZEN) == 0 {
            state_participation.integration_eligible += 1;
        } else {
            state_participation.integration_blocked += 1;
        }
        if mask & (ETHEREAL | IGNORE_COLLISIONS) == (ETHEREAL | IGNORE_COLLISIONS) {
            state_participation.state_suppressed_targets += 1;
        } else if target_geometry == "none" {
            state_participation.geometry_absent_targets += 1;
        } else {
            state_participation.dynamic_collision_targets += 1;
        }
        let sample = RepresentativeTemplate {
            wcid: template.wcid,
            name: template
                .name
                .clone()
                .unwrap_or_else(|| template.class_name.clone()),
            weenie_type: template.weenie_type,
            setup_did: template.setup_did.expect("resolved setup has a DID"),
            default_scale: template.default_scale,
            effective_mask: mask_key(mask),
            target_geometry,
        };
        push_sample(&mut representative_samples, target_geometry, &sample);
        push_sample(&mut representative_samples, moving_geometry, &sample);
        if template.weenie_type == 10 {
            push_sample(&mut representative_samples, "creature", &sample);
        }
        if mask & MISSILE != 0 {
            push_sample(&mut representative_samples, "missile", &sample);
        }
        if mask & REPORT_COLLISIONS_AS_ENVIRONMENT != 0 {
            push_sample(
                &mut representative_samples,
                "reports_as_environment",
                &sample,
            );
        } else if mask & REPORT_COLLISIONS != 0 {
            push_sample(&mut representative_samples, "reports_collisions", &sample);
        }
        if mask & (ETHEREAL | IGNORE_COLLISIONS) == (ETHEREAL | IGNORE_COLLISIONS) {
            push_sample(&mut representative_samples, "nonblocking_target", &sample);
        }
        if !template.sub_palettes.is_empty()
            || !template.texture_changes.is_empty()
            || !template.anim_part_changes.is_empty()
        {
            push_sample(&mut representative_samples, "appearance_changes", &sample);
        }
        if template.default_scale.is_some_and(|scale| scale <= 0.0) {
            push_sample(&mut representative_samples, "invalid_scale", &sample);
        }
        if template
            .sub_palettes
            .iter()
            .any(|palette| palette.length == 0)
        {
            push_sample(&mut representative_samples, "zero_length_palette", &sample);
        }
    }

    let motion_contract = content
        .read_motion_sequence_catalog()
        .context("could not project the motion contract for the survey")?;
    let physics_bsp_default_behavior_setups = survey_physics_bsp_default_behavior_setups(
        templates,
        &setup_facts,
        &physics_bsp_appearance.effective_parts_by_wcid,
        content,
    )?;
    let authored_root_motion = survey_authored_root_motion(templates, &setup_facts, content)?;

    Ok(ContentSurvey {
        referenced_setups: setup_ids.len(),
        decoded_setups: setup_facts.len(),
        unavailable_setups,
        malformed_setups,
        setup_failure_samples,
        part_counts,
        sphere_counts,
        cylsphere_counts,
        sphere_radii,
        cylsphere_radii,
        cylsphere_heights,
        setups_with_physics_bsp: setup_facts
            .values()
            .filter(|facts| facts.has_physics_bsp)
            .count(),
        setups_with_default_animation: setup_facts
            .values()
            .filter(|facts| facts.has_default_animation)
            .count(),
        setups_with_default_script: setup_facts
            .values()
            .filter(|facts| facts.has_default_script)
            .count(),
        physics_bsp_setups_with_default_animation: setup_facts
            .values()
            .filter(|facts| facts.has_physics_bsp && facts.has_default_animation)
            .count(),
        physics_bsp_setups_with_default_script: setup_facts
            .values()
            .filter(|facts| facts.has_physics_bsp && facts.has_default_script)
            .count(),
        physics_bsp_default_behavior_setups,
        physics_bsp_appearance_changes: physics_bsp_appearance.changes,
        unavailable_or_malformed_gfx_objs: gfx_facts.values().filter(|fact| fact.is_none()).count(),
        effective_physics_masks,
        effective_physics_bits,
        collision_filter_masks,
        moving_geometry_classes,
        target_geometry_classes,
        state_participation,
        templates_with_unknown_physics_bits,
        effective_mask_rule: "ACE base mask or PhysicsGlobals.DefaultState; apply the eleven nullable PropertyBool overrides; replace HasPhysicsBSP from setup parts; for Static templates replace HasDefaultAnim/HasDefaultScript from setup defaults",
        representative_samples,
        motion_contract: survey_motion_contract(&motion_contract),
        authored_root_motion,
    })
}

fn survey_physics_bsp_appearance(
    templates: &[WeenieTemplate],
    setup_facts: &BTreeMap<u32, SetupFacts>,
    content: &ContentRepository,
    gfx_facts: &mut BTreeMap<u32, Option<bool>>,
) -> Result<PhysicsBspAppearanceSurvey> {
    let mut effective_parts_by_wcid = BTreeMap::new();
    let mut changes = Vec::new();
    for template in templates {
        let Some(setup_did) = template.setup_did else {
            continue;
        };
        let Some(setup) = setup_facts.get(&setup_did) else {
            continue;
        };
        let mut effective_parts = setup.parts.clone();
        let mut substitutions = Vec::new();
        for change in &template.anim_part_changes {
            let part_index = usize::from(change.part_index);
            let base_part_did = *setup.parts.get(part_index).with_context(|| {
                format!(
                    "WCID {} setup 0x{setup_did:08X} has no animation-part index {part_index}",
                    template.wcid
                )
            })?;
            let base_has_physics_bsp = require_gfx_bsp_fact(base_part_did, content, gfx_facts)?;
            let replacement_has_physics_bsp =
                require_gfx_bsp_fact(change.animation_part_did, content, gfx_facts)?;
            effective_parts[part_index] = change.animation_part_did;
            if base_has_physics_bsp != replacement_has_physics_bsp
                || (base_has_physics_bsp && base_part_did != change.animation_part_did)
            {
                substitutions.push(PhysicsBspPartSubstitutionSurvey {
                    part_index,
                    base_part_did: resource_key(base_part_did),
                    replacement_part_did: resource_key(change.animation_part_did),
                    base_has_physics_bsp,
                    replacement_has_physics_bsp,
                });
            }
        }
        if setup.has_physics_bsp {
            let mut effective_indices = Vec::new();
            for (part_index, part_did) in effective_parts.iter().enumerate() {
                if require_gfx_bsp_fact(*part_did, content, gfx_facts)? {
                    effective_indices.push(part_index);
                }
            }
            effective_parts_by_wcid.insert(template.wcid, effective_indices);
        }
        if !substitutions.is_empty() {
            changes.push(PhysicsBspAppearanceChangeSurvey {
                wcid: template.wcid,
                name: template
                    .name
                    .clone()
                    .unwrap_or_else(|| template.class_name.clone()),
                setup_did: resource_key(setup_did),
                cached_physics_bsp_branch: setup.has_physics_bsp,
                substitutions,
            });
        }
    }
    Ok(PhysicsBspAppearanceSurvey {
        effective_parts_by_wcid,
        changes,
    })
}

fn require_gfx_bsp_fact(
    gfx_did: u32,
    content: &ContentRepository,
    gfx_facts: &mut BTreeMap<u32, Option<bool>>,
) -> Result<bool> {
    let fact = gfx_facts.entry(gfx_did).or_insert_with(|| {
        content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, gfx_did))
            .ok()
            .and_then(|resource| GfxObj::unpack(&mut Cursor::new(resource.bytes)).ok())
            .map(|gfx| gfx.physics_bsp.is_some())
    });
    (*fact).with_context(|| format!("could not decode GfxObj 0x{gfx_did:08X}"))
}

fn survey_physics_bsp_default_behavior_setups(
    templates: &[WeenieTemplate],
    setup_facts: &BTreeMap<u32, SetupFacts>,
    effective_bsp_parts_by_wcid: &BTreeMap<u32, Vec<usize>>,
    content: &ContentRepository,
) -> Result<Vec<PhysicsBspDefaultBehaviorSetupSurvey>> {
    let mut templates_by_setup =
        BTreeMap::<u32, Vec<PhysicsBspDefaultBehaviorTemplateSurvey>>::new();
    for template in templates {
        if let Some(setup_did) = template.setup_did {
            templates_by_setup.entry(setup_did).or_default().push(
                PhysicsBspDefaultBehaviorTemplateSurvey {
                    wcid: template.wcid,
                    name: template
                        .name
                        .clone()
                        .unwrap_or_else(|| template.class_name.clone()),
                    effective_physics_bsp_part_indices: effective_bsp_parts_by_wcid
                        .get(&template.wcid)
                        .cloned()
                        .unwrap_or_default(),
                },
            );
        }
    }

    let mut surveys = Vec::new();
    let mut script_cache = BTreeMap::<u32, DefaultScriptSurvey>::new();
    for (setup_did, facts) in setup_facts {
        if !facts.has_physics_bsp
            || (facts.default_animation.is_none() && facts.default_script.is_none())
        {
            continue;
        }
        let default_animation = facts
            .default_animation
            .map(|animation_did| {
                survey_default_animation(animation_did, &facts.physics_bsp_part_indices, content)
            })
            .transpose()
            .with_context(|| {
                format!("could not survey default animation for setup 0x{setup_did:08X}")
            })?;
        let default_script = if let Some(script_did) = facts.default_script {
            let survey = if let Some(survey) = script_cache.get(&script_did) {
                survey.clone()
            } else {
                let survey = survey_default_script(script_did, content).with_context(|| {
                    format!("could not survey default script for setup 0x{setup_did:08X}")
                })?;
                script_cache.insert(script_did, survey.clone());
                survey
            };
            Some(survey)
        } else {
            None
        };
        surveys.push(PhysicsBspDefaultBehaviorSetupSurvey {
            setup_did: resource_key(*setup_did),
            templates: templates_by_setup
                .get(setup_did)
                .cloned()
                .unwrap_or_default(),
            physics_bsp_part_indices: facts.physics_bsp_part_indices.clone(),
            default_animation,
            default_script,
        });
    }
    Ok(surveys)
}

fn survey_default_animation(
    animation_did: u32,
    physics_bsp_part_indices: &[usize],
    content: &ContentRepository,
) -> Result<DefaultAnimationSurvey> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, animation_did))
        .with_context(|| format!("could not read animation 0x{animation_did:08X}"))?;
    let animation = Animation::read(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("could not decode animation 0x{animation_did:08X}"))?;
    let moving_physics_bsp_part_indices =
        moving_physics_bsp_parts(&animation, physics_bsp_part_indices).with_context(|| {
            format!("animation 0x{animation_did:08X} has incomplete physics-BSP part frames")
        })?;

    let mut hook_types = BTreeMap::new();
    let mut collision_relevant_hooks = Vec::new();
    for frame in &animation.part_frames {
        for hook in &frame.hooks {
            observe_hook(
                hook,
                animation_did,
                None,
                &mut hook_types,
                &mut collision_relevant_hooks,
            );
        }
    }
    Ok(DefaultAnimationSurvey {
        animation_did: resource_key(animation_did),
        frames: animation.num_frames,
        has_position_frames: !animation.pos_frames.is_empty(),
        moving_physics_bsp_part_indices,
        hook_types,
        collision_relevant_hooks,
    })
}

fn moving_physics_bsp_parts(
    animation: &Animation,
    physics_bsp_part_indices: &[usize],
) -> Result<Vec<usize>> {
    let mut moving = Vec::new();
    for &part_index in physics_bsp_part_indices {
        let frames = animation
            .part_frames
            .iter()
            .map(|frame| frame.frames.get(part_index))
            .collect::<Option<Vec<_>>>()
            .with_context(|| format!("missing physics-BSP part index {part_index}"))?;
        if frames
            .first()
            .is_some_and(|first| frames.iter().skip(1).any(|frame| *frame != *first))
        {
            moving.push(part_index);
        }
    }
    Ok(moving)
}

fn survey_default_script(
    root_script_did: u32,
    content: &ContentRepository,
) -> Result<DefaultScriptSurvey> {
    let mut pending = BTreeSet::from([root_script_did]);
    let mut visited = BTreeSet::new();
    let mut hook_types = BTreeMap::new();
    let mut collision_relevant_hooks = Vec::new();
    while let Some(script_did) = pending.pop_first() {
        if !visited.insert(script_did) {
            continue;
        }
        let resource = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, script_did))
            .with_context(|| format!("could not read physics script 0x{script_did:08X}"))?;
        let script = PhysicsScript::read(&mut Cursor::new(resource.bytes))
            .with_context(|| format!("could not decode physics script 0x{script_did:08X}"))?;
        for record in &script.records {
            observe_hook(
                &record.hook,
                script_did,
                Some(record.start_time),
                &mut hook_types,
                &mut collision_relevant_hooks,
            );
            if let AnimationHookPayload::CallPes(call) = record.hook.payload {
                pending.insert(call.script_id);
            }
        }
    }
    Ok(DefaultScriptSurvey {
        root_script_did: resource_key(root_script_did),
        script_dids: visited.into_iter().map(resource_key).collect(),
        hook_types,
        collision_relevant_hooks,
    })
}

fn observe_hook(
    hook: &AnimationHook,
    source_did: u32,
    start_time_seconds: Option<f64>,
    hook_types: &mut BTreeMap<&'static str, u64>,
    collision_relevant_hooks: &mut Vec<CollisionRelevantHookSurvey>,
) {
    let hook_name = animation_hook_name(hook.hook_type);
    *hook_types.entry(hook_name).or_default() += 1;
    if let Some(effect) = collision_relevant_effect(hook.hook_type) {
        collision_relevant_hooks.push(CollisionRelevantHookSurvey {
            source_did: resource_key(source_did),
            start_time_seconds,
            hook: hook_name,
            effect,
        });
    }
}

fn animation_hook_name(hook_type: u32) -> &'static str {
    match hook_type {
        0 => "NoOp",
        1 => "Sound",
        2 => "SoundTable",
        3 => "Attack",
        4 => "AnimationDone",
        5 => "ReplaceObject",
        6 => "Ethereal",
        7 => "TransparentPart",
        8 => "Luminous",
        9 => "LuminousPart",
        10 => "Diffuse",
        11 => "DiffusePart",
        12 => "Scale",
        13 => "CreateParticle",
        14 => "DestroyParticle",
        15 => "StopParticle",
        16 => "NoDraw",
        17 => "DefaultScript",
        18 => "DefaultScriptPart",
        19 => "CallPES",
        20 => "Transparent",
        21 => "SoundTweaked",
        22 => "SetOmega",
        23 => "TextureVelocity",
        24 => "TextureVelocityPart",
        25 => "SetLight",
        26 => "CreateBlockingParticle",
        _ => "Unknown",
    }
}

fn collision_relevant_effect(hook_type: u32) -> Option<&'static str> {
    match hook_type {
        6 => Some("changes collision filtering through Ethereal state"),
        12 => Some("changes the scale of every collision shape"),
        22 => Some("changes root angular velocity and therefore collision transforms"),
        26 => Some("creates a separately blocking particle object"),
        _ => None,
    }
}

fn resource_key(id: u32) -> String {
    format!("0x{id:08X}")
}

fn survey_motion_contract(catalog: &MotionSequenceCatalog) -> MotionContractSurvey {
    let mut survey = MotionContractSurvey {
        setup_defaults: catalog.setup_default_tables().count(),
        motion_tables: catalog.tables().count(),
        ..MotionContractSurvey::default()
    };
    for table in catalog.tables() {
        for (_, sequence) in table.cycles() {
            survey.cycle_entries += 1;
            survey.velocity_magnitudes.observe(
                sequence
                    .velocity
                    .map(|velocity| f64::from(velocity.length())),
            );
            survey
                .omega_magnitudes
                .observe(sequence.omega.map(|omega| f64::from(omega.length())));
            if sequence.velocity.is_none() && sequence.omega.is_none() && !sequence.is_motionless()
            {
                survey.cycles_authored_only += 1;
            }
        }
    }
    survey
}

#[derive(Debug, Default)]
struct MotionTableRootFacts {
    has_position_frames: bool,
    has_translation: bool,
    has_rotation: bool,
    max_frame_boundaries_per_tick_1x: u64,
    max_frame_boundaries_per_tick_3x: u64,
}

#[derive(Debug, Default)]
struct AnimationRootFacts {
    has_position_frames: bool,
    has_translation: bool,
    has_rotation: bool,
}

fn survey_authored_root_motion(
    templates: &[WeenieTemplate],
    setups: &BTreeMap<u32, SetupFacts>,
    content: &ContentRepository,
) -> Result<AuthoredRootMotionSurvey> {
    let motion_table_ids = content
        .resource_index()
        .iter()
        .filter(|entry| {
            entry.namespace == EOR_PORTAL_NAMESPACE
                && entry.type_id == DatFileType::MotionTable as u32
        })
        .map(|entry| entry.file_id)
        .collect::<BTreeSet<_>>();
    let mut motion_tables = BTreeMap::new();
    let mut referenced_animation_ids = BTreeSet::new();
    let mut motion_data_entries = 0;
    let mut animation_entries = 0;

    for motion_table_id in motion_table_ids {
        let resource = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, motion_table_id))
            .with_context(|| format!("could not read motion table 0x{motion_table_id:08X}"))?;
        let table = MotionTable::read(&mut Cursor::new(resource.bytes))
            .with_context(|| format!("could not decode motion table 0x{motion_table_id:08X}"))?;
        for data in motion_data_records(&table) {
            motion_data_entries += 1;
            animation_entries += data.anims.len();
            referenced_animation_ids.extend(data.anims.iter().map(|anim| anim.anim_id));
        }
        motion_tables.insert(motion_table_id, table);
    }

    let mut animations = BTreeMap::new();
    let mut survey = AuthoredRootMotionSurvey {
        motion_tables: motion_tables.len(),
        motion_data_entries,
        animation_entries,
        referenced_animations: referenced_animation_ids.len(),
        identity_epsilon: ROOT_IDENTITY_EPSILON,
        ..AuthoredRootMotionSurvey::default()
    };
    for animation_id in referenced_animation_ids {
        let resource = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, animation_id))
            .with_context(|| format!("could not read motion animation 0x{animation_id:08X}"))?;
        let animation = Animation::read(&mut Cursor::new(resource.bytes))
            .with_context(|| format!("could not decode motion animation 0x{animation_id:08X}"))?;
        let mut facts = AnimationRootFacts {
            has_position_frames: !animation.pos_frames.is_empty(),
            ..AnimationRootFacts::default()
        };
        survey.position_frames += animation.pos_frames.len();
        for frame in &animation.pos_frames {
            let translation = f64::from(frame.origin.length());
            if !translation.is_finite() {
                anyhow::bail!("animation 0x{animation_id:08X} has a non-finite root translation");
            }
            if translation > ROOT_IDENTITY_EPSILON {
                facts.has_translation = true;
                survey.translation_magnitudes.observe(Some(translation));
            }
            let rotation = root_rotation_angle(frame.orientation).with_context(|| {
                format!("animation 0x{animation_id:08X} has an invalid root rotation")
            })?;
            if rotation > ROOT_IDENTITY_EPSILON {
                facts.has_rotation = true;
                survey.rotation_angles.observe(Some(rotation));
            }
        }
        survey.animations_with_position_frames += usize::from(facts.has_position_frames);
        survey.animations_with_translation += usize::from(facts.has_translation);
        survey.animations_with_rotation += usize::from(facts.has_rotation);
        animations.insert(animation_id, animation);
    }

    let mut table_facts = BTreeMap::new();
    let mut boundaries_1x = Vec::new();
    let mut boundaries_3x = Vec::new();
    for (motion_table_id, table) in &motion_tables {
        let mut facts = MotionTableRootFacts::default();
        for data in motion_data_records(table) {
            for anim in &data.anims {
                let animation = animations
                    .get(&anim.anim_id)
                    .expect("every referenced animation was decoded");
                let selected = selected_position_frames(animation, anim);
                if selected.is_empty() {
                    continue;
                }
                facts.has_position_frames = true;
                for frame in selected {
                    facts.has_translation |=
                        f64::from(frame.origin.length()) > ROOT_IDENTITY_EPSILON;
                    facts.has_rotation |=
                        root_rotation_angle(frame.orientation)? > ROOT_IDENTITY_EPSILON;
                }
                let at_1x = maximum_frame_boundaries_per_tick(anim.framerate, 1.0)?;
                let at_3x = maximum_frame_boundaries_per_tick(
                    anim.framerate,
                    REPRESENTATIVE_SPEED_MULTIPLIER,
                )?;
                boundaries_1x.push(at_1x);
                boundaries_3x.push(at_3x);
                survey.multi_boundary_entries_1x += usize::from(at_1x > 1);
                survey.multi_boundary_entries_3x += usize::from(at_3x > 1);
                facts.max_frame_boundaries_per_tick_1x =
                    facts.max_frame_boundaries_per_tick_1x.max(at_1x);
                facts.max_frame_boundaries_per_tick_3x =
                    facts.max_frame_boundaries_per_tick_3x.max(at_3x);
            }
        }
        table_facts.insert(*motion_table_id, facts);
    }
    survey.frame_boundaries_per_tick_1x = integer_distribution(boundaries_1x);
    survey.frame_boundaries_per_tick_3x = integer_distribution(boundaries_3x);
    survey.motion_tables_with_position_frames = table_facts
        .values()
        .filter(|facts| facts.has_position_frames)
        .count();
    survey.motion_tables_with_translation = table_facts
        .values()
        .filter(|facts| facts.has_translation)
        .count();
    survey.motion_tables_with_rotation = table_facts
        .values()
        .filter(|facts| facts.has_rotation)
        .count();

    for template in templates {
        let setup = template.setup_did.and_then(|id| setups.get(&id));
        let motion_table_did = template
            .motion_table_did
            .or_else(|| setup.and_then(|facts| facts.default_motion_table));
        let facts = motion_table_did.and_then(|id| table_facts.get(&id));
        let physics_bsp_target = setup.is_some_and(|setup| {
            target_geometry_class(effective_mask(template, setup), setup) == "physics_bsp"
        });
        survey.catalog_templates_with_motion_table_reference +=
            usize::from(motion_table_did.is_some());
        survey.catalog_templates_with_decoded_motion_table += usize::from(facts.is_some());
        if let Some(motion_table_did) = motion_table_did
            && facts.is_none()
        {
            *survey
                .unavailable_motion_table_references
                .entry(resource_key(motion_table_did))
                .or_default() += 1;
        }
        survey.catalog_templates_with_position_frames +=
            usize::from(facts.is_some_and(|facts| facts.has_position_frames));
        survey.catalog_templates_with_translation +=
            usize::from(facts.is_some_and(|facts| facts.has_translation));
        survey.catalog_templates_with_rotation +=
            usize::from(facts.is_some_and(|facts| facts.has_rotation));
        if physics_bsp_target && facts.is_some_and(|facts| facts.has_position_frames) {
            survey.physics_bsp_templates_with_root_motion += 1;
            survey
                .physics_bsp_root_motion_templates
                .push(PhysicsBspRootMotionTemplateSurvey {
                    wcid: template.wcid,
                    name: template
                        .name
                        .clone()
                        .unwrap_or_else(|| template.class_name.clone()),
                    motion_table_did: resource_key(
                        motion_table_did.expect("root-motion facts require a motion table"),
                    ),
                    has_translation: facts.is_some_and(|facts| facts.has_translation),
                    has_rotation: facts.is_some_and(|facts| facts.has_rotation),
                });
        }
        if REPRESENTATIVE_WCIDS.contains(&template.wcid) {
            survey
                .representative_templates
                .push(RepresentativeRootMotionSurvey {
                    wcid: template.wcid,
                    name: template
                        .name
                        .clone()
                        .unwrap_or_else(|| template.class_name.clone()),
                    motion_table: motion_table_did.map(|did| RepresentativeMotionTableSurvey {
                        did: resource_key(did),
                        available: facts.is_some(),
                    }),
                    has_position_frames: facts.is_some_and(|facts| facts.has_position_frames),
                    has_translation: facts.is_some_and(|facts| facts.has_translation),
                    has_rotation: facts.is_some_and(|facts| facts.has_rotation),
                    physics_bsp_target,
                    max_frame_boundaries_per_tick_1x: facts
                        .map_or(0, |facts| facts.max_frame_boundaries_per_tick_1x),
                    max_frame_boundaries_per_tick_3x: facts
                        .map_or(0, |facts| facts.max_frame_boundaries_per_tick_3x),
                });
        }
    }
    survey
        .physics_bsp_root_motion_templates
        .sort_by_key(|template| template.wcid);
    survey
        .representative_templates
        .sort_by_key(|template| template.wcid);
    if survey.representative_templates.len() != REPRESENTATIVE_WCIDS.len() {
        anyhow::bail!(
            "catalog contains {} of {} required representative WCIDs",
            survey.representative_templates.len(),
            REPRESENTATIVE_WCIDS.len()
        );
    }
    Ok(survey)
}

fn motion_data_records(table: &MotionTable) -> impl Iterator<Item = &MotionData> {
    table
        .cycles
        .values()
        .chain(table.modifiers.values())
        .chain(table.links.values().flat_map(|links| links.values()))
}

fn selected_position_frames<'a>(
    animation: &'a Animation,
    anim: &AnimData,
) -> &'a [holtburger_dat::graphics::Frame] {
    if animation.pos_frames.is_empty() {
        return &[];
    }
    let last = animation.pos_frames.len() - 1;
    let low = usize::try_from(anim.low_frame.max(0))
        .unwrap_or(0)
        .min(last);
    let high = if anim.high_frame < 0 {
        last
    } else {
        usize::try_from(anim.high_frame).unwrap_or(last).min(last)
    };
    let high = high.max(low);
    &animation.pos_frames[low..=high]
}

fn root_rotation_angle(rotation: holtburger_common::Quaternion) -> Result<f64> {
    let [w, x, y, z] = [rotation.w, rotation.x, rotation.y, rotation.z].map(f64::from);
    let norm = (w * w + x * x + y * y + z * z).sqrt();
    if !norm.is_finite() || norm <= f64::EPSILON {
        anyhow::bail!("root quaternion has non-finite or zero norm");
    }
    Ok(2.0 * (w / norm).abs().clamp(0.0, 1.0).acos())
}

fn maximum_frame_boundaries_per_tick(framerate: f32, speed_multiplier: f64) -> Result<u64> {
    let frames = f64::from(framerate).abs() * speed_multiplier / FIXED_TICKS_PER_SECOND;
    if !frames.is_finite() || frames > u64::MAX as f64 {
        anyhow::bail!("invalid animation framerate {framerate}");
    }
    Ok(frames.ceil() as u64)
}

fn target_geometry_class(mask: u32, setup: &SetupFacts) -> &'static str {
    if mask & HAS_PHYSICS_BSP != 0 {
        "physics_bsp"
    } else if setup.cylsphere_count > 0 {
        "cylspheres"
    } else if setup.sphere_count > 0 {
        "spheres"
    } else {
        "none"
    }
}

fn effective_mask(template: &WeenieTemplate, setup: &SetupFacts) -> u32 {
    let mut mask = template.physics.base_mask.unwrap_or(DEFAULT_PHYSICS_STATE);
    for (bit, value) in [
        (ETHEREAL, template.physics.overrides.ethereal),
        (
            REPORT_COLLISIONS,
            template.physics.overrides.report_collisions,
        ),
        (
            IGNORE_COLLISIONS,
            template.physics.overrides.ignore_collisions,
        ),
        (NO_DRAW, template.physics.overrides.no_draw),
        (GRAVITY, template.physics.overrides.gravity),
        (LIGHTING_ON, template.physics.overrides.lighting),
        (
            SCRIPTED_COLLISION,
            template.physics.overrides.scripted_collision,
        ),
        (INELASTIC, template.physics.overrides.inelastic),
        (
            REPORT_COLLISIONS_AS_ENVIRONMENT,
            template.physics.overrides.report_collisions_as_environment,
        ),
        (EDGE_SLIDE, template.physics.overrides.allow_edge_slide),
        (FROZEN, template.physics.overrides.frozen),
    ] {
        if let Some(enabled) = value {
            set_bit(&mut mask, bit, enabled);
        }
    }
    set_bit(&mut mask, HAS_PHYSICS_BSP, setup.has_physics_bsp);
    let is_static = mask & STATIC != 0;
    set_bit(
        &mut mask,
        HAS_DEFAULT_ANIM,
        is_static && setup.has_default_animation,
    );
    set_bit(
        &mut mask,
        HAS_DEFAULT_SCRIPT,
        is_static && setup.has_default_script,
    );
    mask
}

fn set_bit(mask: &mut u32, bit: u32, enabled: bool) {
    if enabled {
        *mask |= bit;
    } else {
        *mask &= !bit;
    }
}

fn bool_distributions() -> BTreeMap<&'static str, OptionalBoolDistribution> {
    [
        "ethereal",
        "report_collisions",
        "ignore_collisions",
        "no_draw",
        "gravity",
        "lighting",
        "scripted_collision",
        "inelastic",
        "report_collisions_as_environment",
        "allow_edge_slide",
        "frozen",
    ]
    .into_iter()
    .map(|name| (name, OptionalBoolDistribution::default()))
    .collect()
}

fn count_overrides(
    counts: &mut BTreeMap<&'static str, OptionalBoolDistribution>,
    overrides: &PhysicsBoolOverrides,
) {
    for (name, value) in [
        ("ethereal", overrides.ethereal),
        ("report_collisions", overrides.report_collisions),
        ("ignore_collisions", overrides.ignore_collisions),
        ("no_draw", overrides.no_draw),
        ("gravity", overrides.gravity),
        ("lighting", overrides.lighting),
        ("scripted_collision", overrides.scripted_collision),
        ("inelastic", overrides.inelastic),
        (
            "report_collisions_as_environment",
            overrides.report_collisions_as_environment,
        ),
        ("allow_edge_slide", overrides.allow_edge_slide),
        ("frozen", overrides.frozen),
    ] {
        counts
            .get_mut(name)
            .expect("all bool names are initialized")
            .observe(value);
    }
}

fn physics_bit_counts() -> BTreeMap<&'static str, u64> {
    physics_bits()
        .into_iter()
        .map(|(name, _)| (name, 0))
        .collect()
}

fn physics_bits() -> [(&'static str, u32); 25] {
    [
        ("Static", 0x0000_0001),
        ("Unused1", 0x0000_0002),
        ("Ethereal", 0x0000_0004),
        ("ReportCollisions", 0x0000_0008),
        ("IgnoreCollisions", 0x0000_0010),
        ("NoDraw", 0x0000_0020),
        ("Missile", 0x0000_0040),
        ("Pushable", 0x0000_0080),
        ("AlignPath", 0x0000_0100),
        ("PathClipped", 0x0000_0200),
        ("Gravity", 0x0000_0400),
        ("LightingOn", 0x0000_0800),
        ("ParticleEmitter", 0x0000_1000),
        ("Unused2", 0x0000_2000),
        ("Hidden", 0x0000_4000),
        ("ScriptedCollision", 0x0000_8000),
        ("HasPhysicsBSP", 0x0001_0000),
        ("Inelastic", 0x0002_0000),
        ("HasDefaultAnim", 0x0004_0000),
        ("HasDefaultScript", 0x0008_0000),
        ("Cloaked", 0x0010_0000),
        ("ReportCollisionsAsEnvironment", 0x0020_0000),
        ("EdgeSlide", 0x0040_0000),
        ("Sledding", 0x0080_0000),
        ("Frozen", 0x0100_0000),
    ]
}

fn mask_key(mask: u32) -> String {
    format!("0x{mask:08X}")
}

fn count_missing(counts: &mut BTreeMap<&'static str, u64>, name: &'static str, missing: bool) {
    let count = counts.entry(name).or_default();
    if missing {
        *count += 1;
    }
}

fn increment_histogram(counts: &mut BTreeMap<usize, u64>, value: usize) {
    *counts.entry(value).or_default() += 1;
}

fn push_failure(samples: &mut Vec<String>, failure: String) {
    const MAX_FAILURE_SAMPLES: usize = 20;
    if samples.len() < MAX_FAILURE_SAMPLES {
        samples.push(failure);
    }
}

fn push_sample(
    samples: &mut BTreeMap<&'static str, Vec<RepresentativeTemplate>>,
    category: &'static str,
    sample: &RepresentativeTemplate,
) {
    const MAX_REPRESENTATIVE_SAMPLES: usize = 5;
    let category_samples = samples.entry(category).or_default();
    if category_samples.len() < MAX_REPRESENTATIVE_SAMPLES {
        category_samples.push(sample.clone());
    }
}

fn integer_distribution(mut values: Vec<u64>) -> IntegerDistribution {
    if values.is_empty() {
        return IntegerDistribution::default();
    }
    values.sort_unstable();
    IntegerDistribution {
        count: values.len(),
        total: values.iter().sum(),
        min: values[0],
        p50: percentile(&values, 50),
        p95: percentile(&values, 95),
        p99: percentile(&values, 99),
        max: *values.last().expect("nonempty values have a maximum"),
    }
}

fn percentile(values: &[u64], percentile: usize) -> u64 {
    let index = (values.len() - 1) * percentile / 100;
    values[index]
}

impl FloatDistribution {
    fn observe(&mut self, value: Option<f64>) {
        let Some(value) = value else { return };
        self.count += 1;
        self.min = Some(self.min.map_or(value, |current| current.min(value)));
        self.max = Some(self.max.map_or(value, |current| current.max(value)));
    }
}

impl OptionalBoolDistribution {
    fn observe(&mut self, value: Option<bool>) {
        match value {
            None => self.absent += 1,
            Some(false) => self.false_count += 1,
            Some(true) => self.true_count += 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Vector3;
    use holtburger_dat::file_type::animation::AnimationFlags;
    use holtburger_dat::file_type::motion_table::{AnimData, MotionData, MotionDataFlags};
    use holtburger_dat::file_type::setup_model::AnimationFrame;
    use holtburger_dat::graphics::Frame;
    use holtburger_weenie_catalog::{SubPalette, TemplatePhysics};

    fn template() -> WeenieTemplate {
        WeenieTemplate {
            wcid: 42,
            class_name: "ace42-test".to_owned(),
            weenie_type: 10,
            name: Some("Test".to_owned()),
            level: None,
            setup_did: Some(0x0200_0042),
            motion_table_did: None,
            sound_table_did: None,
            physics_effect_table_did: None,
            palette_base_did: None,
            default_scale: Some(1.0),
            friction: None,
            elasticity: None,
            maximum_velocity: None,
            rotation_speed: None,
            radar_blip_color: None,
            radar_behavior: None,
            obvious_radar_range: None,
            attackable: None,
            appearance: Default::default(),
            wielded: Vec::new(),
            physics: TemplatePhysics::default(),
            sub_palettes: Vec::new(),
            texture_changes: Vec::new(),
            anim_part_changes: Vec::new(),
        }
    }

    fn setup() -> SetupFacts {
        SetupFacts {
            has_physics_bsp: false,
            has_default_animation: false,
            has_default_script: false,
            physics_bsp_part_indices: Vec::new(),
            parts: Vec::new(),
            default_animation: None,
            default_script: None,
            default_motion_table: None,
            sphere_count: 1,
            cylsphere_count: 0,
        }
    }

    #[test]
    fn effective_mask_applies_explicit_false_and_setup_bits() {
        let mut template = template();
        template.physics.base_mask = Some(GRAVITY | REPORT_COLLISIONS | HAS_PHYSICS_BSP);
        template.physics.overrides.gravity = Some(false);
        template.physics.overrides.ignore_collisions = Some(true);

        let mask = effective_mask(&template, &setup());

        assert_eq!(mask & GRAVITY, 0);
        assert_ne!(mask & REPORT_COLLISIONS, 0);
        assert_ne!(mask & IGNORE_COLLISIONS, 0);
        assert_eq!(mask & HAS_PHYSICS_BSP, 0);
    }

    #[test]
    fn target_geometry_uses_bsp_then_cylsphere_then_sphere() {
        let mut setup = setup();
        assert_eq!(target_geometry_class(0, &setup), "spheres");
        setup.cylsphere_count = 1;
        assert_eq!(target_geometry_class(0, &setup), "cylspheres");
        setup.has_physics_bsp = true;
        assert_eq!(
            target_geometry_class(HAS_PHYSICS_BSP, &setup),
            "physics_bsp"
        );
    }

    #[test]
    fn catalog_survey_reports_palette_and_scale_hazards() {
        let mut template = template();
        template.default_scale = Some(0.0);
        template.maximum_velocity = Some(0.0);
        template.rotation_speed = Some(2.0);
        template.sub_palettes = vec![
            SubPalette {
                sub_palette_did: 1,
                offset: 0,
                length: 0,
            },
            SubPalette {
                sub_palette_did: 2,
                offset: 250,
                length: 10,
            },
            SubPalette {
                sub_palette_did: 3,
                offset: 252,
                length: 2,
            },
        ];

        let survey = survey_templates(&[template], vec![100]);

        assert_eq!(survey.invalid_default_scales, 1);
        assert_eq!(survey.zero_length_sub_palettes, 1);
        assert_eq!(survey.out_of_bounds_sub_palettes, 1);
        assert_eq!(survey.overlapping_sub_palette_pairs, 1);
        assert_eq!(survey.maximum_velocity.count, 1);
        assert_eq!(survey.maximum_velocity.min, Some(0.0));
        assert_eq!(survey.maximum_velocity.max, Some(0.0));
        assert_eq!(survey.rotation_speed.count, 1);
        assert_eq!(survey.rotation_speed.min, Some(2.0));
        assert_eq!(survey.rotation_speed.max, Some(2.0));
    }

    #[test]
    fn integer_distribution_uses_stable_percentile_floor() {
        let distribution = integer_distribution((1..=100).collect());

        assert_eq!(distribution.min, 1);
        assert_eq!(distribution.p50, 50);
        assert_eq!(distribution.p95, 95);
        assert_eq!(distribution.p99, 99);
        assert_eq!(distribution.max, 100);
    }

    #[test]
    fn motion_census_measures_authored_vector_magnitudes() {
        let stance = 3u32;
        let animation_id = 0x0300_0001;
        let explicit_key = MotionTable::cycle_key(stance, 4);
        let authored_key = MotionTable::cycle_key(stance, 5);
        let clip = AnimData {
            anim_id: animation_id,
            low_frame: 0,
            high_frame: -1,
            framerate: 30.0,
        };

        let mut cycles = std::collections::HashMap::new();
        cycles.insert(
            explicit_key,
            MotionData {
                bitfield: 0,
                flags: MotionDataFlags::HAS_VELOCITY | MotionDataFlags::HAS_OMEGA,
                anims: Vec::new(),
                velocity: Some(Vector3::new(3.0, 4.0, 0.0)),
                omega: Some(Vector3::new(0.0, 0.0, 2.0)),
            },
        );
        cycles.insert(
            authored_key,
            MotionData {
                bitfield: 0,
                flags: MotionDataFlags::empty(),
                anims: vec![clip],
                velocity: None,
                omega: None,
            },
        );

        let table = MotionTable {
            id: 2,
            default_style: stance,
            style_defaults: std::collections::HashMap::new(),
            cycles,
            modifiers: std::collections::HashMap::new(),
            links: std::collections::HashMap::new(),
        };
        let animation = Animation {
            id: animation_id,
            flags: AnimationFlags::POS_FRAMES,
            num_parts: 0,
            num_frames: 2,
            pos_frames: vec![
                Frame {
                    origin: Vector3::new(0.0, 0.5, 0.0),
                    orientation: holtburger_common::Quaternion::identity(),
                },
                Frame {
                    origin: Vector3::new(0.0, 0.5, 0.0),
                    orientation: holtburger_common::Quaternion::identity(),
                },
            ],
            part_frames: vec![
                AnimationFrame {
                    frames: Vec::new(),
                    hooks: Vec::new(),
                },
                AnimationFrame {
                    frames: Vec::new(),
                    hooks: Vec::new(),
                },
            ],
        };

        let catalog = MotionSequenceCatalog::assemble([table], [animation], [(1, 2)])
            .expect("catalog should assemble");
        let survey = survey_motion_contract(&catalog);

        assert_eq!(survey.setup_defaults, 1);
        assert_eq!(survey.motion_tables, 1);
        assert_eq!(survey.cycle_entries, 2);
        assert_eq!(survey.velocity_magnitudes.min, Some(5.0));
        assert_eq!(survey.velocity_magnitudes.max, Some(5.0));
        assert_eq!(survey.omega_magnitudes.min, Some(2.0));
        assert_eq!(survey.omega_magnitudes.max, Some(2.0));
        assert_eq!(
            survey.cycles_authored_only, 1,
            "a cycle whose motion is authored as root transforms is counted, not reduced"
        );
    }

    #[test]
    fn root_motion_census_uses_authored_ranges_and_tick_boundary_bounds() {
        let frames = (0..4)
            .map(|index| {
                let mut frame = Frame::default();
                frame.origin.x = index as f32;
                frame
            })
            .collect::<Vec<_>>();
        let animation = Animation {
            id: 1,
            flags: AnimationFlags::POS_FRAMES,
            num_parts: 0,
            num_frames: 4,
            pos_frames: frames,
            part_frames: Vec::new(),
        };
        let selected = selected_position_frames(
            &animation,
            &AnimData {
                anim_id: 1,
                low_frame: 1,
                high_frame: 2,
                framerate: 31.0,
            },
        );

        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0].origin.x, 1.0);
        assert_eq!(selected[1].origin.x, 2.0);
        assert_eq!(maximum_frame_boundaries_per_tick(30.0, 1.0).unwrap(), 1);
        assert_eq!(maximum_frame_boundaries_per_tick(31.0, 1.0).unwrap(), 2);
        assert_eq!(maximum_frame_boundaries_per_tick(-20.0, 3.0).unwrap(), 2);
    }

    #[test]
    fn root_rotation_classification_accepts_quaternion_sign_equivalence() {
        let negative_identity = holtburger_common::Quaternion {
            w: -1.0,
            x: 0.0,
            y: 0.0,
            z: 0.0,
        };
        let quarter_turn = holtburger_common::Quaternion::from_axis_angle(
            Vector3::new(0.0, 0.0, 1.0),
            std::f32::consts::FRAC_PI_2,
        )
        .unwrap();

        assert_eq!(root_rotation_angle(negative_identity).unwrap(), 0.0);
        assert!(
            (root_rotation_angle(quarter_turn).unwrap() - std::f64::consts::FRAC_PI_2).abs()
                < 1.0e-6
        );
    }

    #[test]
    fn bsp_part_census_detects_only_frames_that_vary() {
        let part_frame = |first_x, second_x| {
            [first_x, second_x].map(|x| {
                let mut frame = Frame::default();
                frame.origin.x = x;
                frame
            })
        };
        let moving = part_frame(0.0, 1.0);
        let fixed = part_frame(2.0, 2.0);
        let animation = Animation {
            id: 1,
            flags: AnimationFlags::empty(),
            num_parts: 2,
            num_frames: 2,
            pos_frames: Vec::new(),
            part_frames: vec![
                AnimationFrame {
                    frames: vec![moving[0].clone(), fixed[0].clone()],
                    hooks: Vec::new(),
                },
                AnimationFrame {
                    frames: vec![moving[1].clone(), fixed[1].clone()],
                    hooks: Vec::new(),
                },
            ],
        };

        assert_eq!(moving_physics_bsp_parts(&animation, &[0, 1]).unwrap(), [0]);
        assert!(moving_physics_bsp_parts(&animation, &[2]).is_err());
    }

    #[test]
    fn collision_relevant_hook_classification_excludes_script_chaining() {
        assert_eq!(collision_relevant_effect(19), None);
        assert_eq!(
            collision_relevant_effect(12),
            Some("changes the scale of every collision shape")
        );
        assert_eq!(animation_hook_name(22), "SetOmega");
    }
}
