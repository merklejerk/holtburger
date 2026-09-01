/// Search- and census-facing identity prefix shared by every encoded weenie template.
///
/// This deliberately excludes template behavior and appearance. Consumers that need those facts
/// must perform an exact WCID lookup rather than turning this lightweight projection into a second
/// template representation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WeenieTemplateIdentity {
    /// Weenie class identifier and catalog lookup key.
    pub wcid: u32,
    /// Exact ACE template class name; useful for disambiguating duplicate display names.
    pub class_name: String,
    /// Optional authored `PropertyString::Name` display name.
    pub name: Option<String>,
}

/// Static ACE World template facts retained by the Explorer weenie catalog.
#[derive(Clone, Debug, PartialEq)]
pub struct WeenieTemplate {
    /// Weenie class identifier and catalog lookup key.
    pub wcid: u32,
    /// Exact ACE template class name; this is provenance, not a display-name fallback.
    pub class_name: String,
    /// Raw ACE `WeenieType` numeric value.
    pub weenie_type: i32,
    /// Optional `PropertyString::Name` display name.
    pub name: Option<String>,
    /// Optional raw `PropertyInt::Level` (25).
    pub level: Option<i32>,
    /// Optional setup-model data ID.
    pub setup_did: Option<u32>,
    /// Optional motion-table data ID.
    pub motion_table_did: Option<u32>,
    /// Optional sound-table data ID.
    pub sound_table_did: Option<u32>,
    /// Optional physics-effect-table data ID.
    pub physics_effect_table_did: Option<u32>,
    /// Optional base palette data ID.
    pub palette_base_did: Option<u32>,
    /// Optional raw ACE World default scale.
    pub default_scale: Option<f64>,
    /// Optional raw ACE World friction.
    pub friction: Option<f64>,
    /// Optional raw ACE World elasticity.
    pub elasticity: Option<f64>,
    /// Optional ACE World launch-speed magnitude in metres per second.
    pub maximum_velocity: Option<f64>,
    /// Optional ACE World projectile rotation speed in revolutions per second.
    pub rotation_speed: Option<f64>,
    /// Optional raw `PropertyInt::RadarBlipColor` (95).
    pub radar_blip_color: Option<i32>,
    /// Optional raw `PropertyInt::ShowableOnRadar` (133) `RadarBehavior` value.
    pub radar_behavior: Option<i32>,
    /// Optional `PropertyFloat::ObviousRadarRange` (104) in metres.
    pub obvious_radar_range: Option<f64>,
    /// Optional authored `PropertyBool::Attackable` (19); ACE defaults absence to `true`.
    pub attackable: Option<bool>,
    /// Lossless template physics inputs; no effective mask has been derived.
    pub physics: TemplatePhysics,
    /// Lossless template appearance inputs; no ObjDesc has been derived.
    pub appearance: TemplateAppearance,
    /// Source-ordered wielded equipment entries; probability grouping is positional.
    pub wielded: Vec<WieldEntry>,
    /// Canonically ordered raw packed palette ranges.
    pub sub_palettes: Vec<SubPalette>,
    /// Canonically ordered texture substitutions.
    pub texture_changes: Vec<TextureChange>,
    /// Canonically ordered animation-part substitutions.
    pub anim_part_changes: Vec<AnimPartChange>,
}

/// ACE template appearance inputs consumed by face resolution and the equipment merge.
///
/// These are raw authored facts. Deriving an ObjDesc from them requires DAT content (CharGen,
/// PaletteSet, ClothingTable) and is deliberately not the catalog's job, exactly as the catalog
/// retains physics inputs without calculating the effective mask.
/// `Eq` is deliberately absent: `shade` is an authored float, exactly as on [`WieldEntry`] and
/// [`WeenieTemplate`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TemplateAppearance {
    /// `PropertyDataId::ClothingBase`. Carried both by wearable items, which paint their wearer,
    /// and by weenies that paint themselves with it when nothing worn covers them.
    pub clothing_base_did: Option<u32>,
    /// `PropertyDataId::HeadObject`.
    pub head_object_did: Option<u32>,
    /// `PropertyDataId::SkinPalette`.
    pub skin_palette_did: Option<u32>,
    /// `PropertyDataId::HairPalette`.
    pub hair_palette_did: Option<u32>,
    /// `PropertyDataId::EyesPalette`.
    pub eyes_palette_did: Option<u32>,
    /// `PropertyDataId::EyesTexture`.
    pub eyes_texture_did: Option<u32>,
    /// `PropertyDataId::DefaultEyesTexture`; the replaced texture for the eyes strip.
    pub default_eyes_texture_did: Option<u32>,
    /// `PropertyDataId::NoseTexture`.
    pub nose_texture_did: Option<u32>,
    /// `PropertyDataId::DefaultNoseTexture`.
    pub default_nose_texture_did: Option<u32>,
    /// `PropertyDataId::MouthTexture`.
    pub mouth_texture_did: Option<u32>,
    /// `PropertyDataId::DefaultMouthTexture`.
    pub default_mouth_texture_did: Option<u32>,
    /// `PropertyInt::HeritageGroup`; authoritative over `heritage_group_name` when present.
    pub heritage_group: Option<i32>,
    /// `PropertyInt::Gender`; authoritative over `sex` when present.
    pub gender: Option<i32>,
    /// `PropertyString::HeritageGroupName`, e.g. `Gharu'ndim`.
    pub heritage_group_name: Option<String>,
    /// `PropertyString::Sex`, e.g. `Male`.
    pub sex: Option<String>,
    /// `PropertyInt::ItemType`; ACE's `ItemType` flags, which partition worn items into clothing
    /// and armor. Distinct from `WeenieType`, where armor and clothing are both `Clothing`.
    pub item_type: Option<i32>,
    /// `PropertyInt::DefaultCombatStyle`; selects the wield side for missile weapons.
    pub default_combat_style: Option<i32>,
    /// `PropertyInt::ClothingPriority`; a `CoverageMask` used to sort worn clothing.
    pub clothing_priority: Option<i32>,
    /// `PropertyInt::ValidLocations`; an `EquipMask` selecting the wield slot.
    pub valid_locations: Option<i32>,
    /// `PropertyInt::PaletteTemplate`; selects the CLO palette-template effect applied through this
    /// weenie's own `ClothingBase`, and the fallback when a wield row authors no palette. Absence
    /// is distinct from `Some(0)`: only a positive row value overrides it
    /// (`WorldObjectFactory.cs:409-410`).
    pub palette_template: Option<u32>,
    /// `PropertyFloat::Shade`; the hue handed to a CLO palette set. Absence is distinct from
    /// `Some(0.0)` because a non-treasure wield row overwrites it unconditionally while a treasure
    /// row leaves the item's own value standing (`WorldObjectFactory.cs:412-414`).
    pub shade: Option<f64>,
}

/// One `weenie_properties_create_list` entry that a creature wields.
///
/// `shade` is overloaded at the source: on a `Treasure`-flagged destination it is a selection
/// probability, otherwise it is the CLO shade. The catalog stores the raw row plus its
/// destination type and leaves that split to the consumer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WieldEntry {
    /// Weenie class of the wielded item.
    pub wcid: u32,
    /// Raw ACE `DestinationType` bits.
    pub destination_type: i32,
    /// `PaletteTemplate` selector; ACE treats zero as unset.
    pub palette_template: u32,
    /// CLO shade, or a selection probability on treasure destinations.
    pub shade: f64,
}

/// ACE template physics inputs that must preserve property absence.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TemplatePhysics {
    /// Optional raw `PropertyInt::PhysicsState` bit pattern.
    pub base_mask: Option<u32>,
    /// Nullable ACE property-bool overrides consumed by `CalculatedPhysicsState()`.
    pub overrides: PhysicsBoolOverrides,
}

/// Nullable ACE physics property-bools; `None`, false, and true are distinct.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PhysicsBoolOverrides {
    /// `PropertyBool::Ethereal`.
    pub ethereal: Option<bool>,
    /// `PropertyBool::ReportCollisions`.
    pub report_collisions: Option<bool>,
    /// `PropertyBool::IgnoreCollisions`.
    pub ignore_collisions: Option<bool>,
    /// `PropertyBool::NoDraw`.
    pub no_draw: Option<bool>,
    /// `PropertyBool::GravityStatus`.
    pub gravity: Option<bool>,
    /// `PropertyBool::LightsStatus`.
    pub lighting: Option<bool>,
    /// `PropertyBool::ScriptedCollision`.
    pub scripted_collision: Option<bool>,
    /// `PropertyBool::Inelastic`.
    pub inelastic: Option<bool>,
    /// `PropertyBool::ReportCollisionsAsEnvironment`.
    pub report_collisions_as_environment: Option<bool>,
    /// `PropertyBool::AllowEdgeSlide`.
    pub allow_edge_slide: Option<bool>,
    /// `PropertyBool::IsFrozen`.
    pub frozen: Option<bool>,
}

/// Raw packed ObjDesc subpalette range from ACE World.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct SubPalette {
    /// Replacement palette data ID.
    pub sub_palette_did: u32,
    /// Packed ACE range offset; runtime expansion is intentionally deferred.
    pub offset: u16,
    /// Packed ACE range length; runtime expansion is intentionally deferred.
    pub length: u16,
}

/// One setup-part texture substitution.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TextureChange {
    /// Setup part index.
    pub part_index: u8,
    /// Authored texture data ID to replace.
    pub old_texture_did: u32,
    /// Replacement texture data ID.
    pub new_texture_did: u32,
}

/// One setup animation-part substitution.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct AnimPartChange {
    /// Setup part index.
    pub part_index: u8,
    /// Replacement animation-part data ID.
    pub animation_part_did: u32,
}
