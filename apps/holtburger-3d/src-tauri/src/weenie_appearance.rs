//! Deterministic weenie-template appearance resolution for Explorer-spawned entities.
//!
//! This is ACE-server emulation, not client behavior. A real client receives an already-resolved
//! ObjDesc on the wire; the Explorer needs this only because its app-local registry plays the
//! producer role. The output is the shared [`EntityAppearance`] value, so everything downstream
//! stays identical to the server-fed path.
//!
//! Two deliberate departures from ACE, both approved 2026-08-17 and covered by tests:
//!
//! 1. Rolls are seeded from the spawn identity instead of a wall clock, so a given entity's face
//!    is reproducible across runs. ACE re-rolls per spawn (`ThreadSafeRandom`).
//! 2. An explicitly authored `PaletteBase` wins over the heritage base palette. ACE assigns
//!    `PaletteBaseId = sex.BasePalette` unconditionally, before its per-property `HasValue`
//!    guards (`Creature.cs:181`), discarding the weenie's own value.

use holtburger_dat::file_type::char_gen::{CharGen, CharacterGenGender};
use holtburger_dat::file_type::{ClothingBuildObjDescError, ClothingTable, ObjDesc};
use holtburger_weenie_catalog::{TemplateAppearance, WieldEntry};
use holtburger_world::{
    EntityAppearance, EntityPartChange, EntitySubPalette, EntityTextureChange, PaintedWieldedItem,
    WieldedItemClassification,
};

/// Palette ranges ACE writes for the generated body layers, in retail's packed eight-color groups.
///
/// ACE authors these already packed (`WorldObject_Networking.cs:1011,1019,1027`) — unlike its CLO
/// ranges, which it divides by eight on the way in (`:967-968`) — so they reach `EntitySubPalette`
/// through `from_groups` like every other retail-sourced range.
const SKIN_PALETTE_OFFSET_GROUPS: u32 = 0x0;
const SKIN_PALETTE_GROUPS: u32 = 0x18;
const HAIR_PALETTE_OFFSET_GROUPS: u32 = 0x18;
const HAIR_PALETTE_GROUPS: u32 = 0x8;
const EYES_PALETTE_OFFSET_GROUPS: u32 = 0x20;
const EYES_PALETTE_GROUPS: u32 = 0x8;

/// Setup part index carrying the head, and therefore every facial texture substitution.
const HEAD_PART_INDEX: u8 = 0x10;

/// Retail's compiled hairstyle range. ACE clamps NPC rolls to this unless an operator widens it
/// with `npc_hairstyle_fullrange` (`Creature.cs:201-204`); we adopt the retail range as fixed.
const RETAIL_MAX_HAIR_STYLE_INDEX: usize = 8;

/// Why a template could not enter face generation. Neither case is an error: the template keeps
/// whatever it authored explicitly, exactly as ACE's early returns do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppearanceGenerationSkipped {
    /// No parseable heritage or gender, so the weenie is not a generated humanoid.
    NotAHumanoid,
    /// Heritage and gender parsed, but CharGen has no matching entry.
    HeritageUnavailable,
}

/// Whether a template resolves a heritage and gender, and therefore needs CharGen to be realized.
///
/// Non-humanoids answer `false` and never consult character-generation content, so a crate spawns
/// without it.
pub fn requires_character_generation(appearance: &TemplateAppearance) -> bool {
    resolve_heritage(appearance).is_some() && resolve_gender(appearance).is_some()
}

/// Body layers for a template that never enters generation.
pub fn resolve_authored_appearance(
    palette_base_did: Option<u32>,
    appearance: &TemplateAppearance,
) -> EntityAppearance {
    let mut resolved = EntityAppearance {
        palette_did: palette_base_did,
        sub_palettes: Vec::new(),
        texture_changes: Vec::new(),
        part_changes: Vec::new(),
    };
    push_authored_layers(&mut resolved, appearance);
    resolved
}

/// Resolve one template's complete appearance, filling unauthored features from CharGen.
///
/// `palette_set` resolves a `PaletteSet` resource to the palette matching a hue, mirroring ACE's
/// `PaletteSet.GetPaletteID`. It returns `None` when the resource is unavailable, which suppresses
/// only the layer that needed it rather than failing the whole appearance.
pub fn resolve_template_appearance(
    palette_base_did: Option<u32>,
    appearance: &TemplateAppearance,
    char_gen: &CharGen,
    seed: u64,
    palette_set: impl Fn(u32, f64) -> Option<u32>,
) -> (EntityAppearance, Option<AppearanceGenerationSkipped>) {
    let mut resolved = EntityAppearance {
        palette_did: palette_base_did,
        sub_palettes: Vec::new(),
        texture_changes: Vec::new(),
        part_changes: Vec::new(),
    };

    let Some(sex) = resolve_gender_entry(appearance, char_gen) else {
        let skip = if resolve_heritage(appearance).is_none() || resolve_gender(appearance).is_none()
        {
            AppearanceGenerationSkipped::NotAHumanoid
        } else {
            AppearanceGenerationSkipped::HeritageUnavailable
        };
        push_authored_layers(&mut resolved, appearance);
        return (resolved, Some(skip));
    };

    // Divergence 2: ACE overwrites here; an authored base palette wins for us.
    if resolved.palette_did.is_none() {
        resolved.palette_did = Some(sex.base_palette);
    }

    let mut roll = Roll::new(seed);
    let hair_style = if sex.hair_style_list.len() > 1 {
        roll.index(
            sex.hair_style_list
                .len()
                .min(RETAIL_MAX_HAIR_STYLE_INDEX + 1),
        )
    } else {
        0
    };
    let hair_color = roll.index(sex.hair_color_list.len());
    let hair_hue = roll.unit();
    let eye_color = roll.index(sex.eye_color_list.len());
    let eye_strip = roll.index(sex.eye_strip_list.len());
    let mouth_strip = roll.index(sex.mouth_strip_list.len());
    let nose_strip = roll.index(sex.nose_strip_list.len());
    let skin_hue = roll.unit();

    let hair_style_entry = sex.hair_style_list.get(hair_style);
    let bald = hair_style_entry.is_some_and(|entry| entry.bald);

    // Head model: authored wins, else the hairstyle's single part change. ACE returns nothing when
    // a style carries several (Gear Knights, Olthoi), and those bodies are out of scope anyway.
    let head_object = appearance.head_object_did.or_else(|| {
        hair_style_entry.and_then(|entry| match entry.obj_desc.anim_part_changes.as_slice() {
            [single] => Some(single.part_id),
            _ => None,
        })
    });
    if let Some(head_object) = head_object {
        resolved.part_changes.push(EntityPartChange {
            part_index: HEAD_PART_INDEX,
            gfx_obj_did: head_object,
        });
    }

    // The hairstyle's own ObjDesc texture change is deliberately NOT applied. ACE reaches it only
    // through the Gear Knight / Olthoi "hairstyle as body style" branch, where `HairStyle` is an
    // explicit property; an ordinary generated NPC takes the `HeadObjectDID` branch and receives
    // the head model alone, with hair colour coming from the hair palette
    // (`WorldObject_Networking.cs:984-1005`). Every shipped hairstyle carries one such change, so
    // applying it would recolour every generated head against ACE.

    push_face_texture(
        &mut resolved,
        appearance.default_eyes_texture_did,
        appearance.eyes_texture_did,
        sex.eye_strip_list.get(eye_strip).map(|strip| {
            if bald {
                &strip.obj_desc_bald
            } else {
                &strip.obj_desc
            }
        }),
    );
    push_face_texture(
        &mut resolved,
        appearance.default_nose_texture_did,
        appearance.nose_texture_did,
        sex.nose_strip_list
            .get(nose_strip)
            .map(|strip| &strip.obj_desc),
    );
    push_face_texture(
        &mut resolved,
        appearance.default_mouth_texture_did,
        appearance.mouth_texture_did,
        sex.mouth_strip_list
            .get(mouth_strip)
            .map(|strip| &strip.obj_desc),
    );

    let skin_palette = appearance
        .skin_palette_did
        .or_else(|| palette_set(sex.skin_palette_set, skin_hue));
    push_palette(
        &mut resolved,
        skin_palette,
        SKIN_PALETTE_OFFSET_GROUPS,
        SKIN_PALETTE_GROUPS,
    );

    let hair_palette = appearance.hair_palette_did.or_else(|| {
        sex.hair_color_list
            .get(hair_color)
            .and_then(|set| palette_set(*set, hair_hue))
    });
    push_palette(
        &mut resolved,
        hair_palette,
        HAIR_PALETTE_OFFSET_GROUPS,
        HAIR_PALETTE_GROUPS,
    );

    let eyes_palette = appearance
        .eyes_palette_did
        .or_else(|| sex.eye_color_list.get(eye_color).copied());
    push_palette(
        &mut resolved,
        eyes_palette,
        EYES_PALETTE_OFFSET_GROUPS,
        EYES_PALETTE_GROUPS,
    );

    (resolved, None)
}

/// Emit only what the template authored, for weenies that never enter generation.
fn push_authored_layers(resolved: &mut EntityAppearance, appearance: &TemplateAppearance) {
    if let Some(head_object) = appearance.head_object_did {
        resolved.part_changes.push(EntityPartChange {
            part_index: HEAD_PART_INDEX,
            gfx_obj_did: head_object,
        });
    }
    push_face_texture(
        resolved,
        appearance.default_eyes_texture_did,
        appearance.eyes_texture_did,
        None,
    );
    push_face_texture(
        resolved,
        appearance.default_nose_texture_did,
        appearance.nose_texture_did,
        None,
    );
    push_face_texture(
        resolved,
        appearance.default_mouth_texture_did,
        appearance.mouth_texture_did,
        None,
    );
    push_palette(
        resolved,
        appearance.skin_palette_did,
        SKIN_PALETTE_OFFSET_GROUPS,
        SKIN_PALETTE_GROUPS,
    );
    push_palette(
        resolved,
        appearance.hair_palette_did,
        HAIR_PALETTE_OFFSET_GROUPS,
        HAIR_PALETTE_GROUPS,
    );
    push_palette(
        resolved,
        appearance.eyes_palette_did,
        EYES_PALETTE_OFFSET_GROUPS,
        EYES_PALETTE_GROUPS,
    );
}

/// One facial texture substitution needs both halves. ACE stores them as separate properties and
/// emits nothing unless both are present (`AddBaseModelData`); the CharGen strip carries a paired
/// ObjDesc, so it can supply either half the template omitted.
fn push_face_texture(
    resolved: &mut EntityAppearance,
    authored_old: Option<u32>,
    authored_new: Option<u32>,
    strip: Option<&ObjDesc>,
) {
    let generated = strip.and_then(|desc| desc.texture_changes.first());
    let old_texture = authored_old.or_else(|| generated.map(|change| change.old_texture));
    let new_texture = authored_new.or_else(|| generated.map(|change| change.new_texture));
    if let (Some(old_texture), Some(new_texture)) = (old_texture, new_texture) {
        push_head_texture(resolved, old_texture, new_texture);
    }
}

fn push_head_texture(resolved: &mut EntityAppearance, old_texture: u32, new_texture: u32) {
    resolved.texture_changes.push(EntityTextureChange {
        part_index: HEAD_PART_INDEX,
        old_texture_did: old_texture,
        new_texture_did: new_texture,
    });
}

fn push_palette(
    resolved: &mut EntityAppearance,
    palette_did: Option<u32>,
    offset_groups: u32,
    group_count: u32,
) {
    if let Some(palette_did) = palette_did {
        resolved.sub_palettes.push(EntitySubPalette::from_groups(
            palette_did,
            offset_groups,
            group_count,
        ));
    }
}

fn resolve_gender_entry<'a>(
    appearance: &TemplateAppearance,
    char_gen: &'a CharGen,
) -> Option<&'a CharacterGenGender> {
    let heritage = resolve_heritage(appearance)?;
    let gender = resolve_gender(appearance)?;
    char_gen
        .heritage_groups
        .get(&heritage)?
        .genders
        .get(&gender)
}

/// ACE prefers the int property and falls back to parsing the name with apostrophes stripped
/// (`Creature.cs:152-161`).
fn resolve_heritage(appearance: &TemplateAppearance) -> Option<u32> {
    if let Some(heritage) = appearance.heritage_group {
        return u32::try_from(heritage).ok();
    }
    let name = appearance.heritage_group_name.as_deref()?;
    HERITAGE_NAMES
        .iter()
        .find(|(candidate, _)| equals_ace_name(name, candidate))
        .map(|(_, value)| *value)
}

fn resolve_gender(appearance: &TemplateAppearance) -> Option<i32> {
    if let Some(gender) = appearance.gender {
        return Some(gender);
    }
    let name = appearance.sex.as_deref()?;
    GENDER_NAMES
        .iter()
        .find(|(candidate, _)| equals_ace_name(name, candidate))
        .map(|(_, value)| *value)
}

/// `Enum.TryParse(name.Replace("'", ""), ignoreCase: true, ...)`.
fn equals_ace_name(value: &str, candidate: &str) -> bool {
    let stripped = value.replace('\'', "");
    stripped.eq_ignore_ascii_case(candidate)
}

/// `ACE.Entity.Enum.HeritageGroup`, apostrophe-free as ACE parses them.
const HERITAGE_NAMES: [(&str, u32); 12] = [
    ("Aluvian", 1),
    ("Gharundim", 2),
    ("Sho", 3),
    ("Viamontian", 4),
    ("Shadowbound", 5),
    ("Gearknight", 6),
    ("Tumerok", 7),
    ("Lugian", 8),
    ("Empyrean", 9),
    ("Penumbraen", 10),
    ("Undead", 11),
    ("Olthoi", 12),
];

/// `ACE.Entity.Enum.Gender`.
const GENDER_NAMES: [(&str, i32); 2] = [("Male", 1), ("Female", 2)];

/// ACE's `DestinationType::Treasure`; combined with `Wield` it makes `WieldTreasure`, where the
/// row's `shade` column carries a selection probability instead of a CLO shade.
const DESTINATION_TREASURE: i32 = 8;

/// A `create_list` row naming no weenie, which content uses to spend a probability chunk's
/// remaining mass on "nothing". ACE selects such a row like any other and only drops it afterwards,
/// when `WorldObjectFactory` fails to create the weenie (`Creature_Equipment.cs:622-624`), so the
/// row must keep taking part in the selection walk before it is discarded.
const EMPTY_WIELD_WCID: u32 = 0;

/// The template key `ClothingTable::build_obj_desc` reads as "this garment contributes parts and
/// textures but no palette layer", matching retail's own early return (`acclient.c:444343`).
const NO_PALETTE_TEMPLATE: u32 = 0;

/// Whether a shade can select a palette at all.
///
/// Retail refuses to index a palette set outside `[0, 1]` (`acclient.c:449254`), our `PaletteSet`
/// applies the same bound, and ACE returns zero from the same guard. Content authors shades outside
/// it, so this is an authored fact to read rather than a failure to report.
fn selects_a_palette(shade: f64) -> bool {
    (0.0..=1.0).contains(&shade)
}

/// The CLO palette selection for one application of a clothing table.
///
/// The selection reaches a garment from two different carriers — the weenie's own properties, or a
/// wield row overlaid on the created item's properties — which ACE resolves in two different places.
/// Carrying the resolved answer as one value keeps that resolution at the layer that owns it instead
/// of re-deriving it at each call site, which is exactly how the wield row's palette came to be read
/// without its fallback.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ClothingPaletteSelection {
    /// `PropertyInt::PaletteTemplate`. Absence is distinct from `Some(0)` at the source, though both
    /// resolve to "no palette layer" once composed (`acclient.c:444343`).
    pub palette_template: Option<u32>,
    /// `PropertyFloat::Shade`, the hue handed to a CLO palette set.
    pub shade: Option<f64>,
}

impl ClothingPaletteSelection {
    /// The palette a weenie selects through its own `ClothingBase`.
    pub fn from_own_properties(appearance: &TemplateAppearance) -> Self {
        Self {
            palette_template: appearance.palette_template,
            shade: appearance.shade,
        }
    }

    /// The palette a wielded item selects once its wield row is overlaid on its own properties.
    ///
    /// ACE creates the item from its weenie and then overwrites only what the row authored: the
    /// row's palette wins when positive, and its shade wins only on a non-treasure row, where that
    /// column is a shade rather than a selection probability
    /// (`WorldObjectFactory.cs:409-414`). No decompile counterpart exists — the client never sees a
    /// `create_list` — but two retail comparisons agree with it, WCIDs 25709 and 11506.
    pub fn overlay(entry: &WieldEntry, item: &TemplateAppearance) -> Self {
        Self {
            palette_template: (entry.palette_template > 0)
                .then_some(entry.palette_template)
                .or(item.palette_template),
            shade: if entry.destination_type & DESTINATION_TREASURE == 0 {
                Some(entry.shade)
            } else {
                item.shade
            },
        }
    }

    /// The key handed to `ClothingTable::build_obj_desc`, which reads zero as "no palette layer".
    fn template_key(self) -> u32 {
        self.palette_template.unwrap_or(NO_PALETTE_TEMPLATE)
    }

    /// The hue handed to the palette set; ACE defaults an unauthored shade to zero
    /// (`WorldObject_Networking.cs:956-958`).
    fn hue(self) -> f64 {
        self.shade.unwrap_or_default()
    }
}

/// One clothing base to apply, and the weenie that owns it.
///
/// `wcid` and `clothing_base_did` are both bare identifiers that would transpose silently, so they
/// travel with the palette selection they are always resolved alongside rather than as three loose
/// arguments.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClothingSource {
    /// The weenie whose clothing base this is: a wielded item, or the wearer painting itself.
    pub wcid: u32,
    /// `PropertyDataId::ClothingBase`.
    pub clothing_base_did: u32,
    /// The palette this application selects.
    pub palette: ClothingPaletteSelection,
}

/// One wielded item's facts, joined from its own catalog template by the caller.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WieldedItem {
    /// Item weenie class, for error reporting.
    pub wcid: u32,
    /// `PropertyDataId::ClothingBase`; an item without one paints nothing.
    pub clothing_base_did: Option<u32>,
    /// Once-derived painted/held presentation mechanism, or neither.
    pub classification: Option<WieldedItemClassification>,
    /// `PropertyInt::ClothingPriority` coverage mask, used to order clothing.
    pub clothing_priority: Option<i32>,
    /// Palette selection resolved once from the wield row and the item's own properties.
    pub palette: ClothingPaletteSelection,
}

impl WieldedItem {
    /// The clothing base this item applies, absent when it carries none and so paints nothing.
    pub fn clothing_source(&self) -> Option<ClothingSource> {
        Some(ClothingSource {
            wcid: self.wcid,
            clothing_base_did: self.clothing_base_did?,
            palette: self.palette,
        })
    }
}

/// Selects the wield rows that actually dress the wearer this spawn.
///
/// Ordinary `Wield` rows always apply. `WieldTreasure` rows accumulate their `shade` as a
/// probability in source order and one row per 0-1 chunk is selected, mirroring
/// `Creature_Equipment.CreateListSelect`; the same seeded stream keeps the outcome stable per
/// spawn.
///
/// Every returned row names a real weenie: [`EMPTY_WIELD_WCID`] rows take part in the walk, so
/// they still spend their probability mass, and are discarded only once it has been spent. That
/// postcondition is what lets the caller treat an unresolvable WCID as a hard error.
pub fn select_wielded(entries: &[WieldEntry], seed: u64) -> Vec<WieldEntry> {
    let mut roll = Roll::new(seed);
    let mut draw = roll.unit();
    let mut total_probability = 0.0_f64;
    let mut chunk_selected = false;
    let mut selected = Vec::new();

    for entry in entries {
        let uses_probability =
            entry.destination_type & DESTINATION_TREASURE != 0 && entry.shade != 0.0;
        if !uses_probability {
            selected.push(*entry);
            continue;
        }
        if total_probability >= 1.0 {
            total_probability = 0.0;
            draw = roll.unit();
            chunk_selected = false;
        }
        total_probability += entry.shade;
        if chunk_selected || draw >= total_probability {
            continue;
        }
        chunk_selected = true;
        selected.push(*entry);
    }
    selected.retain(|entry| entry.wcid != EMPTY_WIELD_WCID);
    selected
}

/// Everything worn equipment contributes, in ACE's layer order, held apart from the body.
///
/// ACE discards this entire layer when it turns out to paint nothing and the wearer has a
/// `ClothingBase` of its own (`Creature_Networking.cs:239`), so the merge yields it rather than
/// folding it straight into the body appearance.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct WornEquipmentLayer(Vec<ObjDesc>);

impl WornEquipmentLayer {
    /// ACE's `coverage.Count == 0` test, which asks what was painted rather than what was worn.
    ///
    /// A garment whose clothing table dresses this setup with no object effects — a pure recolour,
    /// which is exactly the shape of the rabbit tables — adds no coverage entry in ACE, and neither
    /// does one whose table does not dress this body at all.
    pub fn paints_body(&self) -> bool {
        self.0
            .iter()
            .any(|obj_desc| !obj_desc.anim_part_changes.is_empty())
    }

    /// Layer these garments onto an already-resolved body appearance, in order.
    pub fn apply(&self, appearance: &mut EntityAppearance) {
        for obj_desc in &self.0 {
            push_clothing_obj_desc(appearance, obj_desc);
        }
    }
}

/// Resolve worn clothing and armor against one wearer's setup.
///
/// Items are ordered as `Creature_Networking.CalculateObjDesc` orders them: clothing by its
/// authored `ClothingPriority`, then armor by the coverage its clothing table paints. An item
/// whose clothing table does not dress this setup is skipped, exactly as ACE skips it, because
/// that is authored content rather than an error.
pub fn resolve_worn_equipment(
    setup_did: u32,
    items: &[WieldedItem],
    clothing_table: impl Fn(u32) -> Option<ClothingTable>,
    palette_set: impl Fn(u32, f64) -> Option<u32>,
) -> Result<WornEquipmentLayer, ClothingError> {
    let mut clothing = Vec::new();
    let mut armor = Vec::new();
    for item in items {
        let bucket = match item.classification {
            Some(WieldedItemClassification::Painted(bucket)) => bucket,
            Some(WieldedItemClassification::Held(_)) | None => continue,
        };
        let Some(clothing_base_did) = item.clothing_base_did else {
            continue;
        };
        let table = clothing_table(clothing_base_did).ok_or(ClothingError::MissingTable {
            wcid: item.wcid,
            clothing_base_did,
        })?;
        let Some(coverage) = table.visual_coverage(setup_did) else {
            // Authored gap: this garment has no mapping for this body.
            continue;
        };
        match bucket {
            PaintedWieldedItem::Armor => armor.push((coverage.bits(), *item, table)),
            PaintedWieldedItem::Clothing => {
                clothing.push((item.clothing_priority.unwrap_or_default(), *item, table))
            }
        }
    }
    clothing.sort_by_key(|(priority, item, _)| (*priority, item.wcid));
    armor.sort_by_key(|(coverage, item, _)| (*coverage, item.wcid));

    let mut layer = WornEquipmentLayer::default();

    for (_, item, table) in clothing.into_iter().chain(
        armor
            .into_iter()
            .map(|(coverage, item, table)| (coverage as i32, item, table)),
    ) {
        let obj_desc =
            build_clothing(&table, setup_did, item.palette, &palette_set).map_err(|message| {
                ClothingError::Build {
                    wcid: item.wcid,
                    message,
                }
            })?;
        layer.0.push(obj_desc);
    }
    Ok(layer)
}

/// Apply one `ClothingBase` to one setup, layering the result onto an appearance.
///
/// This is ACE's base `CalculateObjDesc` (`WorldObject_Networking.cs:916-973`) reduced to the part
/// that produces appearance rows. Three callers share it: a weenie painting itself, a held item
/// painting its own model, and — through [`resolve_worn_equipment`] — a garment painting its
/// wearer. They differ only in which setup they dress and where the palette selection came from,
/// so the mechanism belongs here once rather than at each call site.
pub fn apply_clothing_base(
    appearance: &mut EntityAppearance,
    setup_did: u32,
    source: ClothingSource,
    clothing_table: impl Fn(u32) -> Option<ClothingTable>,
    palette_set: impl Fn(u32, f64) -> Option<u32>,
) -> Result<(), ClothingError> {
    let ClothingSource {
        wcid,
        clothing_base_did,
        palette,
    } = source;
    let table = clothing_table(clothing_base_did).ok_or(ClothingError::MissingTable {
        wcid,
        clothing_base_did,
    })?;
    let obj_desc = build_clothing(&table, setup_did, palette, &palette_set)
        .map_err(|message| ClothingError::Build { wcid, message })?;
    push_clothing_obj_desc(appearance, &obj_desc);
    Ok(())
}

/// Build one garment's ObjDesc, separating content's authored gaps from real failures.
///
/// Retail's `ClothingTable::BuildObjDesc` treats three authored conditions as ordinary no-ops, and
/// this wrapper must not be stricter than the primitive it wraps:
///
/// - a table that does not dress this body returns success with the ObjDesc untouched
///   (`acclient.c:444330-444331`), which ACE matches by skipping its clothing block
///   (`WorldObject_Networking.cs:923`);
/// - a zero template key yields parts and textures but no palettes (`acclient.c:444343`);
/// - a template key absent from the table yields the same (`acclient.c:444345-444347`).
///
/// ACE substitutes the table's first defined template in that last case
/// (`WorldObject_Networking.cs:948-951`). We deliberately do not. Retail defines no such fallback,
/// and WCID 17 Gromnie confirms it observationally: its own template 71 is absent from table
/// `0x100000AF`, retail leaves it unpainted, and ACE's substitution would have replaced all 2048
/// palette entries. Census 2026-08-22: 274 weenies request an absent template.
fn build_clothing(
    table: &ClothingTable,
    setup_did: u32,
    palette: ClothingPaletteSelection,
    palette_set: &impl Fn(u32, f64) -> Option<u32>,
) -> Result<ObjDesc, String> {
    let resolver = |set: u32, hue: f64| {
        palette_set(set, hue).ok_or(ClothingBuildObjDescError::MissingPaletteSet {
            palette_set_id: set,
        })
    };
    let hue = palette.hue();
    // RETAIL DIVERGENCE: retail range-checks the shade and hands back an invalid palette DID for
    // anything outside [0, 1] (`acclient.c:449254-449262`). That invalid subpalette then makes
    // `Palette::Modify` abandon the *entire* subpalette list (`acclient.c:349808,349824`), so
    // `CPartArray::SetPalette` recolours nothing at all on the object (`acclient.c:314006-314021`).
    // We skip only this template's ranges instead of poisoning the object. Census 2026-08-22: both
    // shipped cases are wield rows on WCIDs 31365 and 28701 carrying shades 14 and 1.2, and both
    // are held weapons whose whole subpalette set comes from this one template at this one shade —
    // so every entry is invalid under either reading and both produce an unrecoloured object. A
    // held weapon is its own physics object, so neither can poison a wearer's skin, hair, or eye
    // palettes. Reproducing the poisoning would mean giving `EntityAppearance` a failed state for
    // two objects that look identical either way. It becomes observable only if content ever pairs
    // an out-of-range shade with other, valid subpalettes on one object.
    let requested = if selects_a_palette(hue) {
        palette.template_key()
    } else {
        NO_PALETTE_TEMPLATE
    };
    match table.build_obj_desc(setup_did, requested, hue, resolver) {
        Ok(obj_desc) => Ok(obj_desc),
        // Retail returns before applying anything when the table does not dress this body, so
        // nothing survives. Census 2026-08-22: 60 of the 854 wielded items carrying a
        // `ClothingBase` name such a table, all reached through the held path, which passes the
        // item's own setup rather than the wearer's.
        Err(ClothingBuildObjDescError::MissingClothingBase { .. }) => Ok(ObjDesc::empty()),
        // Retail applies the parts and textures *first* and only then misses the template lookup,
        // leaving them in the ObjDesc it already mutated (`acclient.c:444341-444347`). Rebuilding
        // without a palette layer reproduces that exactly; returning an empty ObjDesc would drop
        // the garment's model.
        Err(ClothingBuildObjDescError::MissingPaletteTemplate { .. }) => table
            .build_obj_desc(setup_did, NO_PALETTE_TEMPLATE, hue, resolver)
            .map_err(|source| format!("{source:?}")),
        Err(source) => Err(format!("{source:?}")),
    }
}

/// A clothing base that cannot be resolved at all, as distinct from one that simply does not dress
/// this body.
///
/// The `wcid` names whichever weenie owns the failing clothing base: a wielded item on the worn and
/// held paths, and the wearer itself when it paints through its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClothingError {
    /// The weenie names a clothing table absent from mounted content.
    MissingTable { wcid: u32, clothing_base_did: u32 },
    /// The clothing table exists but could not produce an ObjDesc.
    Build { wcid: u32, message: String },
}

impl std::fmt::Display for ClothingError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingTable {
                wcid,
                clothing_base_did,
            } => write!(
                formatter,
                "WCID {wcid} names missing clothing table 0x{clothing_base_did:08X}"
            ),
            Self::Build { wcid, message } => {
                write!(formatter, "WCID {wcid} clothing failed: {message}")
            }
        }
    }
}

impl std::error::Error for ClothingError {}

fn push_clothing_obj_desc(appearance: &mut EntityAppearance, obj_desc: &ObjDesc) {
    for change in &obj_desc.anim_part_changes {
        appearance.part_changes.push(EntityPartChange {
            part_index: change.part_index,
            gfx_obj_did: change.part_id,
        });
    }
    for change in &obj_desc.texture_changes {
        appearance.texture_changes.push(EntityTextureChange {
            part_index: change.part_index,
            old_texture_did: change.old_texture,
            new_texture_did: change.new_texture,
        });
    }
    for palette in &obj_desc.sub_palettes {
        appearance.sub_palettes.push(EntitySubPalette {
            palette_did: palette.sub_id,
            offset: palette.offset,
            color_count: palette.num_colors,
        });
    }
}

/// Deterministic splitmix64 stream. ACE uses `ThreadSafeRandom`; seeding from the spawn identity is
/// divergence 1, and keeps a given entity's face identical across runs and harness captures.
struct Roll {
    state: u64,
}

impl Roll {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Uniform index below `length`; always consumes one step so the stream stays aligned when a
    /// CharGen list is empty.
    fn index(&mut self, length: usize) -> usize {
        let draw = self.next_u64();
        if length == 0 {
            return 0;
        }
        usize::try_from(draw % (length as u64)).unwrap_or(0)
    }

    /// Uniform hue in `[0, 1)`, matching the domain `PaletteSet` selection accepts.
    fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1_u64 << 53) as f64
    }
}

/// Synthetic CharGen and clothing fixtures shared by this module's tests and the driver's, so a
/// single definition backs both rather than two drifting copies.
#[cfg(test)]
pub mod test_support {
    use super::*;
    use holtburger_dat::file_type::char_gen::{EyeStrip, FaceStrip, HairStyle, HeritageGroup};
    use holtburger_dat::file_type::{
        AnimationPartChange, CloObjectEffect, CloPaletteTemplate, CloSubpalEffect,
        CloSubpaletteRange, CloTextureEffect, ClothingBase, SubPalette, TextureMapChange,
    };
    use std::collections::{BTreeMap, HashMap};

    pub const GHARUNDIM: u32 = 2;
    pub const MALE: i32 = 1;
    pub const SKIN_SET: u32 = 0x0F00_0001;
    pub const HAIR_SET_A: u32 = 0x0F00_0010;
    pub const HAIR_SET_B: u32 = 0x0F00_0011;
    /// ACE coverage-map body part indices used by the fixtures.
    pub const PART_CHEST: u32 = 9;
    pub const PART_LEFT_FOOT: u32 = 3;

    pub fn obj_desc(part: Option<u32>, texture: Option<(u32, u32)>) -> ObjDesc {
        ObjDesc {
            palette_id: None,
            sub_palettes: Vec::<SubPalette>::new(),
            texture_changes: texture
                .map(|(old_texture, new_texture)| TextureMapChange {
                    part_index: HEAD_PART_INDEX,
                    old_texture,
                    new_texture,
                })
                .into_iter()
                .collect(),
            anim_part_changes: part
                .map(|part_id| AnimationPartChange {
                    part_index: HEAD_PART_INDEX,
                    part_id,
                })
                .into_iter()
                .collect(),
        }
    }

    pub fn gender_entry(bald_style: bool) -> CharacterGenGender {
        CharacterGenGender {
            name: "Male".to_owned(),
            scale: 100,
            setup_id: 0x0200_0001,
            sound_table: 0,
            icon_image: 0,
            base_palette: 0x0400_0900,
            skin_palette_set: SKIN_SET,
            physics_table: 0,
            motion_table: 0,
            combat_table: 0,
            base_obj_desc: obj_desc(None, None),
            hair_color_list: vec![HAIR_SET_A, HAIR_SET_B],
            hair_style_list: vec![
                HairStyle {
                    icon_image: 0,
                    bald: bald_style,
                    alternate_setup: 0,
                    obj_desc: obj_desc(Some(0x0200_1111), Some((0x0500_0001, 0x0500_0002))),
                },
                HairStyle {
                    icon_image: 0,
                    bald: bald_style,
                    alternate_setup: 0,
                    obj_desc: obj_desc(Some(0x0200_2222), Some((0x0500_0003, 0x0500_0004))),
                },
            ],
            eye_color_list: vec![0x0400_0A01, 0x0400_0A02],
            eye_strip_list: vec![EyeStrip {
                icon_image: 0,
                icon_image_bald: 0,
                obj_desc: obj_desc(None, Some((0x0500_1000, 0x0500_1001))),
                obj_desc_bald: obj_desc(None, Some((0x0500_1000, 0x0500_1BA1))),
            }],
            nose_strip_list: vec![FaceStrip {
                icon_image: 0,
                obj_desc: obj_desc(None, Some((0x0500_2000, 0x0500_2001))),
            }],
            mouth_strip_list: vec![FaceStrip {
                icon_image: 0,
                obj_desc: obj_desc(None, Some((0x0500_3000, 0x0500_3001))),
            }],
            headgear_list: Vec::new(),
            shirt_list: Vec::new(),
            pants_list: Vec::new(),
            footwear_list: Vec::new(),
            clothing_colors_list: Vec::new(),
        }
    }

    pub fn char_gen_with(bald_style: bool) -> CharGen {
        let mut genders = HashMap::new();
        genders.insert(MALE, gender_entry(bald_style));
        let mut heritage_groups = HashMap::new();
        heritage_groups.insert(
            GHARUNDIM,
            HeritageGroup {
                name: "Gharu'ndim".to_owned(),
                icon_image: 0,
                setup_id: 0,
                environment_setup_id: 0,
                attribute_credits: 0,
                skill_credits: 0,
                primary_start_areas: Vec::new(),
                secondary_start_areas: Vec::new(),
                skills: Vec::new(),
                templates: Vec::new(),
                genders,
            },
        );
        CharGen {
            id: CharGen::FILE_ID,
            starter_areas: Vec::new(),
            heritage_groups,
        }
    }

    pub fn synthetic_char_gen() -> CharGen {
        char_gen_with(false)
    }

    pub fn clothing_for(setup: u32, part: u32, texture: (u32, u32), model: u32) -> ClothingTable {
        let mut clothing_bases = BTreeMap::new();
        clothing_bases.insert(
            setup,
            ClothingBase {
                object_effects: vec![CloObjectEffect {
                    part_num: part,
                    object_id: model,
                    texture_effects: vec![CloTextureEffect {
                        old_texture: texture.0,
                        new_texture: texture.1,
                    }],
                }],
            },
        );
        ClothingTable {
            id: 0x1000_0001,
            clothing_bases,
            palette_templates: BTreeMap::new(),
        }
    }

    pub fn synthetic_clothing(setup: u32) -> ClothingTable {
        clothing_for(setup, PART_CHEST, (0x0500_0020, 0x0500_0021), 0x0100_0020)
    }

    /// A garment that dresses `setup` and defines exactly one palette template, so a test can tell
    /// a skipped palette layer apart from a table that never offered one.
    pub fn clothing_with_palette_template(
        setup: u32,
        key: u32,
        palette_set_id: u32,
    ) -> ClothingTable {
        let mut table = clothing_for(setup, PART_CHEST, (0x0500_0001, 0x0500_0002), 0x0100_0001);
        table.palette_templates.insert(
            key,
            CloPaletteTemplate {
                icon_id: 0,
                subpal_effects: vec![CloSubpalEffect {
                    palette_set_id,
                    ranges: vec![CloSubpaletteRange {
                        offset: 0,
                        num_colors: 16,
                    }],
                }],
            },
        );
        table
    }

    /// A table shaped like the rabbit's: it dresses `setup` and defines a palette template, but
    /// carries no object effects, so it recolours without painting any body part.
    pub fn pure_recolour_clothing(setup: u32, key: u32, palette_set_id: u32) -> ClothingTable {
        let mut table = clothing_with_palette_template(setup, key, palette_set_id);
        table.clothing_bases.insert(
            setup,
            ClothingBase {
                object_effects: Vec::new(),
            },
        );
        table
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{GHARUNDIM, MALE, char_gen_with, synthetic_char_gen};
    use super::*;

    fn humanoid() -> TemplateAppearance {
        TemplateAppearance {
            heritage_group_name: Some("Gharu'ndim".to_owned()),
            sex: Some("Male".to_owned()),
            ..TemplateAppearance::default()
        }
    }

    /// Every palette set resolves to a distinct id derived from its inputs, so a test can tell
    /// which set and hue produced a layer.
    fn palette_set(set: u32, hue: f64) -> Option<u32> {
        Some(set ^ ((hue * 1024.0) as u32))
    }

    fn expanded(groups: u32) -> u32 {
        groups * EntitySubPalette::GROUP_COLORS
    }

    fn palette_at(appearance: &EntityAppearance, offset: u32) -> Option<EntitySubPalette> {
        appearance
            .sub_palettes
            .iter()
            .find(|entry| entry.offset == offset)
            .copied()
    }

    /// ACE authors the body bands already packed, unlike its CLO ranges, so the expansion into
    /// `EntityAppearance`'s color units is easy to drop — and dropping it leaves the hair band
    /// sitting inside the skin band, which renders every NPC with one skin tone and one hair
    /// colour. Asserting against the constants would pass either way, so these are the literal
    /// expanded colors: three adjacent, non-overlapping bands.
    #[test]
    fn generated_body_bands_expand_to_retail_color_counts() {
        let (resolved, _) =
            resolve_template_appearance(None, &humanoid(), &synthetic_char_gen(), 42, palette_set);

        let band = |offset| palette_at(&resolved, offset).map(|entry| entry.color_count);
        assert_eq!(band(0), Some(192), "skin covers 0x18 groups from 0");
        assert_eq!(band(192), Some(64), "hair covers 0x8 groups from 0x18");
        assert_eq!(band(256), Some(64), "eyes covers 0x8 groups from 0x20");
    }

    #[test]
    fn generated_humanoid_fills_every_body_layer() {
        let (resolved, skipped) =
            resolve_template_appearance(None, &humanoid(), &synthetic_char_gen(), 42, palette_set);

        assert_eq!(skipped, None);
        assert_eq!(resolved.palette_did, Some(0x0400_0900));
        assert_eq!(
            palette_at(&resolved, expanded(SKIN_PALETTE_OFFSET_GROUPS))
                .map(|entry| entry.color_count),
            Some(expanded(SKIN_PALETTE_GROUPS))
        );
        assert!(palette_at(&resolved, expanded(HAIR_PALETTE_OFFSET_GROUPS)).is_some());
        assert!(palette_at(&resolved, expanded(EYES_PALETTE_OFFSET_GROUPS)).is_some());
        // The head model, plus exactly the eyes, nose, and mouth strips. The hairstyle's own
        // texture change is ACE's body-style branch only, so a generated NPC must not receive it.
        assert_eq!(resolved.part_changes.len(), 1);
        assert_eq!(resolved.part_changes[0].part_index, HEAD_PART_INDEX);
        assert_eq!(resolved.texture_changes.len(), 3);
        assert!(
            !resolved
                .texture_changes
                .iter()
                .any(|change| change.new_texture_did == 0x0500_0002),
            "the hairstyle texture change belongs to the body-style branch, not a generated NPC"
        );
        assert!(
            resolved
                .texture_changes
                .iter()
                .all(|change| change.part_index == HEAD_PART_INDEX)
        );
    }

    #[test]
    fn authored_facts_suppress_their_generated_counterparts() {
        let mut appearance = humanoid();
        appearance.skin_palette_did = Some(0x0400_DEAD);
        appearance.hair_palette_did = Some(0x0400_BEEF);
        appearance.eyes_palette_did = Some(0x0400_CAFE);
        appearance.head_object_did = Some(0x0200_FEED);

        let (resolved, skipped) =
            resolve_template_appearance(None, &appearance, &synthetic_char_gen(), 7, palette_set);

        assert_eq!(skipped, None);
        assert_eq!(
            palette_at(&resolved, expanded(SKIN_PALETTE_OFFSET_GROUPS))
                .map(|entry| entry.palette_did),
            Some(0x0400_DEAD)
        );
        assert_eq!(
            palette_at(&resolved, expanded(HAIR_PALETTE_OFFSET_GROUPS))
                .map(|entry| entry.palette_did),
            Some(0x0400_BEEF)
        );
        assert_eq!(
            palette_at(&resolved, expanded(EYES_PALETTE_OFFSET_GROUPS))
                .map(|entry| entry.palette_did),
            Some(0x0400_CAFE)
        );
        assert_eq!(resolved.part_changes[0].gfx_obj_did, 0x0200_FEED);
    }

    /// Divergence 2: ACE assigns the heritage base palette unconditionally.
    #[test]
    fn authored_palette_base_wins_over_heritage_base() {
        let (resolved, _) = resolve_template_appearance(
            Some(0x0400_1234),
            &humanoid(),
            &synthetic_char_gen(),
            1,
            palette_set,
        );

        assert_eq!(resolved.palette_did, Some(0x0400_1234));
    }

    /// Divergence 1: the roll is seeded, so a spawn identity reproduces its own face and different
    /// identities still differ.
    #[test]
    fn faces_are_stable_per_seed_and_vary_across_seeds() {
        let template = humanoid();
        let (first, _) = resolve_template_appearance(
            None,
            &template,
            &synthetic_char_gen(),
            0xf000_0001,
            palette_set,
        );
        let (repeat, _) = resolve_template_appearance(
            None,
            &template,
            &synthetic_char_gen(),
            0xf000_0001,
            palette_set,
        );
        let (other, _) = resolve_template_appearance(
            None,
            &template,
            &synthetic_char_gen(),
            0xf000_0002,
            palette_set,
        );

        assert_eq!(first, repeat);
        assert_ne!(first, other);
    }

    #[test]
    fn bald_hairstyle_selects_the_bald_eye_strip() {
        let (haired, _) =
            resolve_template_appearance(None, &humanoid(), &synthetic_char_gen(), 3, palette_set);
        let (bald, _) =
            resolve_template_appearance(None, &humanoid(), &char_gen_with(true), 3, palette_set);

        let bald_eyes = bald
            .texture_changes
            .iter()
            .any(|change| change.new_texture_did == 0x0500_1BA1);
        let haired_eyes = haired
            .texture_changes
            .iter()
            .any(|change| change.new_texture_did == 0x0500_1001);
        assert!(bald_eyes, "bald body must use the bald eye strip");
        assert!(haired_eyes, "haired body must use the ordinary eye strip");
    }

    /// A creature with no heritage or sex is not a generated humanoid; it keeps only what it
    /// authored, exactly as ACE's early return leaves it.
    #[test]
    fn non_humanoid_keeps_only_authored_layers() {
        let appearance = TemplateAppearance {
            skin_palette_did: Some(0x0400_0077),
            ..TemplateAppearance::default()
        };

        let (resolved, skipped) =
            resolve_template_appearance(None, &appearance, &synthetic_char_gen(), 9, palette_set);

        assert_eq!(skipped, Some(AppearanceGenerationSkipped::NotAHumanoid));
        assert_eq!(resolved.part_changes, Vec::new());
        assert_eq!(resolved.texture_changes, Vec::new());
        assert_eq!(
            palette_at(&resolved, expanded(SKIN_PALETTE_OFFSET_GROUPS))
                .map(|entry| entry.palette_did),
            Some(0x0400_0077)
        );
    }

    #[test]
    fn heritage_parses_from_apostrophe_name_and_prefers_the_int_property() {
        let named = TemplateAppearance {
            heritage_group_name: Some("gharu'ndim".to_owned()),
            sex: Some("MALE".to_owned()),
            ..TemplateAppearance::default()
        };
        assert_eq!(resolve_heritage(&named), Some(GHARUNDIM));
        assert_eq!(resolve_gender(&named), Some(MALE));

        // The int wins even when the name says something else.
        let mut mixed = named.clone();
        mixed.heritage_group = Some(7);
        assert_eq!(resolve_heritage(&mixed), Some(7));
    }

    /// A parseable humanoid whose heritage is absent from CharGen is reported distinctly, so a
    /// caller can tell "not a humanoid" from "content is missing this heritage".
    #[test]
    fn unknown_heritage_entry_is_reported_distinctly() {
        let mut appearance = humanoid();
        appearance.heritage_group = Some(9);

        let (_, skipped) =
            resolve_template_appearance(None, &appearance, &synthetic_char_gen(), 5, palette_set);

        assert_eq!(
            skipped,
            Some(AppearanceGenerationSkipped::HeritageUnavailable)
        );
    }

    /// One partly authored face proves precedence is per property rather than all-or-nothing:
    /// the authored skin survives while eyes still come from the generated strip.
    #[test]
    fn partly_authored_face_mixes_authored_and_generated_layers() {
        let mut appearance = humanoid();
        appearance.skin_palette_did = Some(0x0400_5150);

        let (resolved, _) =
            resolve_template_appearance(None, &appearance, &synthetic_char_gen(), 11, palette_set);

        assert_eq!(
            palette_at(&resolved, expanded(SKIN_PALETTE_OFFSET_GROUPS))
                .map(|entry| entry.palette_did),
            Some(0x0400_5150)
        );
        assert!(
            resolved
                .texture_changes
                .iter()
                .any(|change| change.new_texture_did == 0x0500_1001),
            "eyes must still come from the generated strip"
        );
    }

    #[test]
    fn palette_set_hue_selection_matches_ace_bounds() {
        use holtburger_dat::file_type::material::PaletteSet;

        let set = PaletteSet {
            id: 0,
            palette_ids: vec![10, 20, 30],
        };
        assert_eq!(set.palette_id_for_shade(0.0), Some(10));
        assert_eq!(set.palette_id_for_shade(1.0), Some(30));
        assert_eq!(set.palette_id_for_shade(0.5), Some(20));
        assert_eq!(set.palette_id_for_shade(-0.1), None);
        assert_eq!(set.palette_id_for_shade(1.1), None);
    }
}

#[cfg(test)]
mod equipment_tests {
    use super::test_support::{
        PART_CHEST, PART_LEFT_FOOT, clothing_for, clothing_with_palette_template,
        pure_recolour_clothing,
    };
    use super::*;
    use holtburger_common::properties::ItemType;
    use holtburger_world::{WieldedItemSlotFacts, classify_wielded_item};

    const HUMAN_MALE: u32 = 0x0200_0001;
    const OTHER_BODY: u32 = 0x0200_0099;

    fn item(wcid: u32, clothing_base_did: u32, valid_locations: i32) -> WieldedItem {
        typed_item(
            wcid,
            clothing_base_did,
            Some(ItemType::CLOTHING.bits() as i32),
            valid_locations,
        )
    }

    fn typed_item(
        wcid: u32,
        clothing_base_did: u32,
        item_type: Option<i32>,
        valid_locations: i32,
    ) -> WieldedItem {
        WieldedItem {
            wcid,
            clothing_base_did: Some(clothing_base_did),
            classification: classify_wielded_item(WieldedItemSlotFacts {
                valid_locations: Some(valid_locations),
                item_type,
                default_combat_style: None,
            })
            .unwrap(),
            clothing_priority: None,
            palette: ClothingPaletteSelection::default(),
        }
    }

    /// A wielded item whose row-overlaid selection is already resolved.
    fn painted(mut item: WieldedItem, palette_template: u32, shade: f64) -> WieldedItem {
        item.palette = ClothingPaletteSelection {
            palette_template: Some(palette_template),
            shade: Some(shade),
        };
        item
    }

    fn empty_appearance() -> EntityAppearance {
        EntityAppearance {
            palette_did: None,
            sub_palettes: Vec::new(),
            texture_changes: Vec::new(),
            part_changes: Vec::new(),
        }
    }

    #[test]
    fn worn_clothing_paints_the_wearer_model() {
        let mut appearance = empty_appearance();
        let shirt = item(130, 0x1000_0001, 0x1E);

        resolve_worn_equipment(
            HUMAN_MALE,
            &[shirt],
            |_| {
                Some(clothing_for(
                    HUMAN_MALE,
                    PART_CHEST,
                    (0x0500_0001, 0x0500_0002),
                    0x0100_0001,
                ))
            },
            |_, _| Some(0x0400_0001),
        )
        .unwrap()
        .apply(&mut appearance);

        assert_eq!(appearance.part_changes.len(), 1);
        assert_eq!(appearance.texture_changes.len(), 1);
        assert_eq!(appearance.texture_changes[0].new_texture_did, 0x0500_0002);
    }

    /// A garment with no mapping for this body is authored content, not a failure: ACE skips it.
    #[test]
    fn clothing_without_a_mapping_for_this_body_is_skipped() {
        let mut appearance = empty_appearance();
        let robe = item(2593, 0x1000_0002, 0x1E);

        resolve_worn_equipment(
            HUMAN_MALE,
            &[robe],
            |_| Some(clothing_for(OTHER_BODY, PART_CHEST, (1, 2), 3)),
            |_, _| Some(0x0400_0001),
        )
        .unwrap()
        .apply(&mut appearance);

        assert_eq!(appearance, empty_appearance());
    }

    /// A missing clothing table is a real content failure and must be loud.
    #[test]
    fn missing_clothing_table_fails_loudly_naming_the_item() {
        let boots = item(115, 0x1000_00FF, 0x180);

        let error =
            resolve_worn_equipment(HUMAN_MALE, &[boots], |_| None, |_, _| Some(0x0400_0001))
                .unwrap_err();

        assert!(matches!(
            error,
            ClothingError::MissingTable { wcid: 115, .. }
        ));
        assert!(error.to_string().contains("115"));
    }

    /// Clothing paints before armor, so boots layer over a tunic rather than under it.
    #[test]
    fn armor_layers_after_clothing() {
        let mut appearance = empty_appearance();
        // Boots partition as armor through FootWear; the tunic is ordinary clothing.
        let boots = item(115, 0x1000_0007, 0x180);
        let tunic = item(2593, 0x1000_0001, 0x1E);

        resolve_worn_equipment(
            HUMAN_MALE,
            &[boots, tunic],
            |clothing_base| {
                Some(if clothing_base == 0x1000_0007 {
                    clothing_for(
                        HUMAN_MALE,
                        PART_LEFT_FOOT,
                        (0x0500_0010, 0x0500_0011),
                        0x0100_0010,
                    )
                } else {
                    clothing_for(
                        HUMAN_MALE,
                        PART_CHEST,
                        (0x0500_0020, 0x0500_0021),
                        0x0100_0020,
                    )
                })
            },
            |_, _| Some(0x0400_0001),
        )
        .unwrap()
        .apply(&mut appearance);

        let order: Vec<u32> = appearance
            .texture_changes
            .iter()
            .map(|change| change.new_texture_did)
            .collect();
        assert_eq!(
            order,
            vec![0x0500_0021, 0x0500_0011],
            "clothing must be applied before armor regardless of wield order"
        );
    }

    /// Classification precedes content lookup: a held child cannot accidentally enter CLO just
    /// because its own setup carries a clothing table.
    #[test]
    fn held_items_never_consult_clothing_content_or_paint_the_wearer() {
        let mut appearance = empty_appearance();
        // Royal Guard's Sword of Lost Light: a real held item with a ClothingBase.
        let sword = typed_item(24611, 0x1000_0001, Some(0x1), 0x10_0000);

        resolve_worn_equipment(
            HUMAN_MALE,
            &[sword],
            |_| panic!("held items must be classified before CLO lookup"),
            |_, _| panic!("held items must not resolve a CLO palette"),
        )
        .unwrap()
        .apply(&mut appearance);

        assert_eq!(appearance, empty_appearance());
    }

    /// The held path passes the item's own setup, and 60 shipped wielded items name a clothing
    /// table that does not dress it. That omission is authored content, exactly as it is for a
    /// garment on a body it does not fit, so it must yield no changes rather than fail the spawn.
    #[test]
    fn held_item_clothing_without_a_mapping_for_its_own_setup_is_skipped() {
        let mut appearance = empty_appearance();
        // Assassin's Acid Simi: a real held weapon whose CLO table dresses no setup of its own.
        let simi = typed_item(12194, 0x1000_00F6, Some(0x1), 0x10_0000);

        apply_clothing_base(
            &mut appearance,
            OTHER_BODY,
            simi.clothing_source().unwrap(),
            |_| Some(clothing_for(HUMAN_MALE, PART_CHEST, (1, 2), 3)),
            |_, _| Some(0x0400_0001),
        )
        .unwrap();

        assert_eq!(appearance, empty_appearance());
    }

    /// Two shipped wield rows carry shades of 14 and 1.2. Retail will not index a palette set
    /// outside `[0, 1]`, so the garment keeps its parts and textures and gains no palette rather
    /// than failing the spawn.
    #[test]
    fn a_shade_outside_the_selectable_range_skips_the_palette_layer() {
        let mut appearance = empty_appearance();
        let trident = painted(typed_item(7772, 0x1000_0001, Some(0x1), 0x10_0000), 4, 14.0);

        apply_clothing_base(
            &mut appearance,
            HUMAN_MALE,
            trident.clothing_source().unwrap(),
            |_| Some(clothing_with_palette_template(HUMAN_MALE, 4, 0x0F00_0001)),
            |_, _| panic!("an unselectable shade must never reach a palette set"),
        )
        .unwrap();

        assert_eq!(appearance.part_changes.len(), 1);
        assert_eq!(appearance.texture_changes.len(), 1);
        assert!(
            appearance.sub_palettes.is_empty(),
            "no palette may be selected on an out-of-range shade"
        );
    }

    /// A wield row authoring no palette leaves the item's own `PaletteTemplate` standing, because
    /// ACE only overwrites the created item's property when the row's value is positive
    /// (`WorldObjectFactory.cs:409-410`). Confirmed against retail on WCIDs 25709 and 11506;
    /// census 2026-08-22: 1,484 shipped rows depend on it.
    #[test]
    fn a_zero_row_palette_keeps_the_items_own_template() {
        let item = TemplateAppearance {
            palette_template: Some(14),
            shade: Some(0.66),
            ..TemplateAppearance::default()
        };
        let row = WieldEntry {
            wcid: 25702,
            destination_type: 2,
            palette_template: 0,
            shade: 0.0,
        };

        let selection = ClothingPaletteSelection::overlay(&row, &item);

        assert_eq!(selection.palette_template, Some(14));
        // A non-treasure row's shade column is a shade, and ACE assigns it unconditionally.
        assert_eq!(selection.shade, Some(0.0));
    }

    /// A positive row palette wins, and on a treasure row the `shade` column is a selection
    /// probability rather than a hue, so the item keeps its own (`WorldObjectFactory.cs:412-414`).
    /// Census 2026-08-22: 393 treasure rows carry an item with a `ClothingBase`.
    #[test]
    fn a_treasure_row_keeps_the_items_own_shade() {
        let item = TemplateAppearance {
            palette_template: Some(14),
            shade: Some(0.66),
            ..TemplateAppearance::default()
        };
        let row = WieldEntry {
            wcid: 25702,
            destination_type: 10,
            palette_template: 20,
            shade: 0.1,
        };

        let selection = ClothingPaletteSelection::overlay(&row, &item);

        assert_eq!(selection.palette_template, Some(20));
        assert_eq!(
            selection.shade,
            Some(0.66),
            "0.1 is a probability, not a hue"
        );
    }

    /// ACE counts coverage from CLO object effects, so a garment that only recolours paints no body
    /// part and cannot suppress the wearer's own clothing (`Creature_Networking.cs:239`).
    #[test]
    fn a_pure_recolour_garment_paints_no_body_part() {
        let shirt = painted(item(130, 0x1000_0001, 0x1E), 61, 0.5);

        let layer = resolve_worn_equipment(
            HUMAN_MALE,
            &[shirt],
            |_| Some(pure_recolour_clothing(HUMAN_MALE, 61, 0x0F00_0001)),
            |set, hue| Some(set ^ ((hue * 1024.0) as u32)),
        )
        .unwrap();

        assert!(!layer.paints_body());
        let mut appearance = empty_appearance();
        layer.apply(&mut appearance);
        assert!(
            !appearance.sub_palettes.is_empty(),
            "the recolour itself still resolved"
        );
    }

    /// Ordinary wields always apply; treasure rows compete inside a probability chunk and the
    /// same seed reproduces the same outfit.
    #[test]
    fn treasure_wields_select_one_per_chunk_and_are_stable_per_seed() {
        let entries = vec![
            WieldEntry {
                wcid: 100,
                destination_type: 2,
                palette_template: 0,
                shade: 0.0,
            },
            WieldEntry {
                wcid: 200,
                destination_type: 10,
                palette_template: 0,
                shade: 0.5,
            },
            WieldEntry {
                wcid: 201,
                destination_type: 10,
                palette_template: 0,
                shade: 0.5,
            },
        ];

        let first = select_wielded(&entries, 0xf000_0001);
        let repeat = select_wielded(&entries, 0xf000_0001);

        assert_eq!(first, repeat, "same seed must reproduce the same outfit");
        assert!(
            first.iter().any(|entry| entry.wcid == 100),
            "ordinary wields always apply"
        );
        let chosen = first.iter().filter(|entry| entry.wcid >= 200).count();
        assert_eq!(chosen, 1, "exactly one treasure row per probability chunk");
    }

    /// A zero-WCID row is how content spends part of a probability chunk on "no item". It must
    /// still compete for the chunk — otherwise the rows it outbids would be promoted in its place —
    /// and must never reach the caller, which treats an unresolvable WCID as a hard error.
    #[test]
    fn empty_wield_rows_spend_their_probability_and_never_escape() {
        let empty = WieldEntry {
            wcid: EMPTY_WIELD_WCID,
            destination_type: 10,
            palette_template: 0,
            shade: 0.5,
        };
        let item = WieldEntry {
            wcid: 300,
            destination_type: 10,
            palette_template: 0,
            shade: 0.5,
        };

        // The two rows split one chunk, so the item wins exactly the draws the empty row loses.
        // Dropping the empty row before the walk would invert that, for every seed.
        for seed in 0..64u64 {
            let with_empty = select_wielded(&[empty, item], seed);
            let without_empty = select_wielded(&[item], seed);

            assert!(
                with_empty
                    .iter()
                    .all(|entry| entry.wcid != EMPTY_WIELD_WCID),
                "an empty row must never reach the caller"
            );
            assert_ne!(
                with_empty, without_empty,
                "the empty row must consume its share of the chunk"
            );
        }

        assert!(
            (0..64u64).any(|seed| select_wielded(&[empty, item], seed).is_empty()),
            "the empty row must sometimes win its chunk"
        );
        assert!(
            (0..64u64).any(|seed| select_wielded(&[empty, item], seed).len() == 1),
            "the item must sometimes win its chunk"
        );

        // Every shipped row of this shape but one carries shade 0, which makes it an unconditional
        // selection rather than a probability entry. It must be dropped just the same.
        let unconditional = WieldEntry {
            shade: 0.0,
            ..empty
        };
        assert!(select_wielded(&[unconditional], 1).is_empty());
    }

    /// A palette template absent from the table paints no palette, and is not a failure. Retail
    /// looks the key up, misses, and leaves the ObjDesc with the parts and textures it already
    /// applied (`acclient.c:444345-444347`); ACE's first-defined-template substitution is not
    /// reproduced, because WCID 17 shows retail leaving such a weenie unpainted.
    #[test]
    fn an_absent_palette_template_paints_no_palette_without_failing() {
        let mut appearance = empty_appearance();
        let shirt = painted(item(130, 0x1000_0001, 0x1E), 5, 0.67);

        resolve_worn_equipment(
            HUMAN_MALE,
            &[shirt],
            // Defines template 9, never the requested 5.
            |_| Some(clothing_with_palette_template(HUMAN_MALE, 9, 0x0F00_0001)),
            |_, _| panic!("an absent template must not be substituted with another"),
        )
        .expect("a garment missing the requested template must still paint its model and textures")
        .apply(&mut appearance);

        assert_eq!(appearance.texture_changes.len(), 1);
        assert_eq!(appearance.part_changes.len(), 1);
        assert!(appearance.sub_palettes.is_empty());
    }

    #[test]
    fn items_without_clothing_paint_nothing() {
        let mut appearance = empty_appearance();
        let mut trinket = item(999, 0, 0x1E);
        trinket.clothing_base_did = None;

        resolve_worn_equipment(
            HUMAN_MALE,
            &[trinket],
            |_| panic!("an item without a clothing base must not be looked up"),
            |_, _| Some(0x0400_0001),
        )
        .unwrap()
        .apply(&mut appearance);

        assert_eq!(appearance, empty_appearance());
    }
}
