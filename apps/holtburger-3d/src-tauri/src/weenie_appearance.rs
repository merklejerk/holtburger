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

use holtburger_dat::file_type::char_gen::{CharGen, CharacterGenGender, ObjDesc};
use holtburger_weenie_catalog::TemplateAppearance;
use holtburger_world::{EntityAppearance, EntityPartChange, EntitySubPalette, EntityTextureChange};

/// Palette ranges ACE writes for the generated body layers (`AddBaseModelData`).
const SKIN_PALETTE_OFFSET: u32 = 0x0;
const SKIN_PALETTE_LENGTH: u32 = 0x18;
const HAIR_PALETTE_OFFSET: u32 = 0x18;
const HAIR_PALETTE_LENGTH: u32 = 0x8;
const EYES_PALETTE_OFFSET: u32 = 0x20;
const EYES_PALETTE_LENGTH: u32 = 0x8;

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

    // Hair texture rides the hairstyle's own ObjDesc and has no authored counterpart property.
    if let Some(entry) = hair_style_entry
        && let Some(change) = entry.obj_desc.texture_changes.first()
    {
        push_head_texture(&mut resolved, change.old_texture, change.new_texture);
    }

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
        SKIN_PALETTE_OFFSET,
        SKIN_PALETTE_LENGTH,
    );

    let hair_palette = appearance.hair_palette_did.or_else(|| {
        sex.hair_color_list
            .get(hair_color)
            .and_then(|set| palette_set(*set, hair_hue))
    });
    push_palette(
        &mut resolved,
        hair_palette,
        HAIR_PALETTE_OFFSET,
        HAIR_PALETTE_LENGTH,
    );

    let eyes_palette = appearance
        .eyes_palette_did
        .or_else(|| sex.eye_color_list.get(eye_color).copied());
    push_palette(
        &mut resolved,
        eyes_palette,
        EYES_PALETTE_OFFSET,
        EYES_PALETTE_LENGTH,
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
        SKIN_PALETTE_OFFSET,
        SKIN_PALETTE_LENGTH,
    );
    push_palette(
        resolved,
        appearance.hair_palette_did,
        HAIR_PALETTE_OFFSET,
        HAIR_PALETTE_LENGTH,
    );
    push_palette(
        resolved,
        appearance.eyes_palette_did,
        EYES_PALETTE_OFFSET,
        EYES_PALETTE_LENGTH,
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
    offset: u32,
    color_count: u32,
) {
    if let Some(palette_did) = palette_did {
        resolved.sub_palettes.push(EntitySubPalette {
            palette_did,
            offset,
            color_count,
        });
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

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::char_gen::{
        AnimationPartChange, EyeStrip, FaceStrip, HairStyle, HeritageGroup, SubPalette,
        TextureMapChange,
    };
    use std::collections::HashMap;

    const GHARUNDIM: u32 = 2;
    const MALE: i32 = 1;
    const SKIN_SET: u32 = 0x0F00_0001;
    const HAIR_SET_A: u32 = 0x0F00_0010;
    const HAIR_SET_B: u32 = 0x0F00_0011;

    fn obj_desc(part: Option<u32>, texture: Option<(u32, u32)>) -> ObjDesc {
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

    fn gender_entry(bald_style: bool) -> CharacterGenGender {
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

    fn char_gen(bald_style: bool) -> CharGen {
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

    fn palette_at(appearance: &EntityAppearance, offset: u32) -> Option<EntitySubPalette> {
        appearance
            .sub_palettes
            .iter()
            .find(|entry| entry.offset == offset)
            .copied()
    }

    #[test]
    fn generated_humanoid_fills_every_body_layer() {
        let (resolved, skipped) =
            resolve_template_appearance(None, &humanoid(), &char_gen(false), 42, palette_set);

        assert_eq!(skipped, None);
        assert_eq!(resolved.palette_did, Some(0x0400_0900));
        assert_eq!(
            palette_at(&resolved, SKIN_PALETTE_OFFSET).map(|entry| entry.color_count),
            Some(SKIN_PALETTE_LENGTH)
        );
        assert!(palette_at(&resolved, HAIR_PALETTE_OFFSET).is_some());
        assert!(palette_at(&resolved, EYES_PALETTE_OFFSET).is_some());
        // Head model plus hair, eyes, nose, and mouth textures, all on the head part.
        assert_eq!(resolved.part_changes.len(), 1);
        assert_eq!(resolved.part_changes[0].part_index, HEAD_PART_INDEX);
        assert_eq!(resolved.texture_changes.len(), 4);
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
            resolve_template_appearance(None, &appearance, &char_gen(false), 7, palette_set);

        assert_eq!(skipped, None);
        assert_eq!(
            palette_at(&resolved, SKIN_PALETTE_OFFSET).map(|entry| entry.palette_did),
            Some(0x0400_DEAD)
        );
        assert_eq!(
            palette_at(&resolved, HAIR_PALETTE_OFFSET).map(|entry| entry.palette_did),
            Some(0x0400_BEEF)
        );
        assert_eq!(
            palette_at(&resolved, EYES_PALETTE_OFFSET).map(|entry| entry.palette_did),
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
            &char_gen(false),
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
            &char_gen(false),
            0xf000_0001,
            palette_set,
        );
        let (repeat, _) = resolve_template_appearance(
            None,
            &template,
            &char_gen(false),
            0xf000_0001,
            palette_set,
        );
        let (other, _) = resolve_template_appearance(
            None,
            &template,
            &char_gen(false),
            0xf000_0002,
            palette_set,
        );

        assert_eq!(first, repeat);
        assert_ne!(first, other);
    }

    #[test]
    fn bald_hairstyle_selects_the_bald_eye_strip() {
        let (haired, _) =
            resolve_template_appearance(None, &humanoid(), &char_gen(false), 3, palette_set);
        let (bald, _) =
            resolve_template_appearance(None, &humanoid(), &char_gen(true), 3, palette_set);

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
            resolve_template_appearance(None, &appearance, &char_gen(false), 9, palette_set);

        assert_eq!(skipped, Some(AppearanceGenerationSkipped::NotAHumanoid));
        assert_eq!(resolved.part_changes, Vec::new());
        assert_eq!(resolved.texture_changes, Vec::new());
        assert_eq!(
            palette_at(&resolved, SKIN_PALETTE_OFFSET).map(|entry| entry.palette_did),
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
            resolve_template_appearance(None, &appearance, &char_gen(false), 5, palette_set);

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
            resolve_template_appearance(None, &appearance, &char_gen(false), 11, palette_set);

        assert_eq!(
            palette_at(&resolved, SKIN_PALETTE_OFFSET).map(|entry| entry.palette_did),
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
