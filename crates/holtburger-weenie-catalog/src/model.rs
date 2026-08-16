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
    /// Lossless template physics inputs; no effective mask has been derived.
    pub physics: TemplatePhysics,
    /// Canonically ordered raw packed palette ranges.
    pub sub_palettes: Vec<SubPalette>,
    /// Canonically ordered texture substitutions.
    pub texture_changes: Vec<TextureChange>,
    /// Canonically ordered animation-part substitutions.
    pub anim_part_changes: Vec<AnimPartChange>,
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
