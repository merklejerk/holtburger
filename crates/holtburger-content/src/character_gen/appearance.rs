//! Deterministic player-creation appearance interpretation, independent of wire and world types.

use super::{CharacterGenAppearanceOptions, CharacterGenGenderDefinition};
use crate::ui_assets::{UiAssetReader, UiAssets};
use crate::{ContentRepository, MotionClip};
use anyhow::{Context, Result, bail};
use holtburger_dat::file_type::char_gen::{CharacterGenGender, HeritageGroup};
use holtburger_dat::file_type::material::{ObjDesc, PaletteSet, SubPalette};
use holtburger_dat::file_type::{Animation, CharGen};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use std::io::Cursor;
use thiserror::Error;

/// Authored style ordinals, clothing palette-template keys and shades; no account, world identity, or submission fields.
#[derive(Debug, Clone, PartialEq)]
pub struct CharacterGenAppearanceChoices {
    /// Selected eye strip, with its bald variant chosen from the hair style.
    pub eyes: u32,
    /// Selected nose strip.
    pub nose: u32,
    /// Selected mouth strip.
    pub mouth: u32,
    /// Hair palette-set ordinal.
    pub hair_color: u32,
    /// Eye palette ordinal.
    pub eye_color: u32,
    /// Hair/body style ordinal, including alternate setups.
    pub hair_style: u32,
    /// Headgear ordinal; `u32::MAX` explicitly selects no headgear.
    pub headgear_style: u32,
    /// Headgear palette-template key.
    pub headgear_color: u32,
    /// Shirt ordinal.
    pub shirt_style: u32,
    /// Shirt palette-template key.
    pub shirt_color: u32,
    /// Trousers ordinal.
    pub pants_style: u32,
    /// Trousers palette-template key.
    pub pants_color: u32,
    /// Footwear ordinal.
    pub footwear_style: u32,
    /// Footwear palette-template key.
    pub footwear_color: u32,
    /// Skin palette-set shade in the inclusive unit interval.
    pub skin_hue: f64,
    /// Hair palette-set shade in the inclusive unit interval.
    pub hair_hue: f64,
    /// Headgear shade in the inclusive unit interval.
    pub headgear_hue: f64,
    /// Shirt shade in the inclusive unit interval.
    pub shirt_hue: f64,
    /// Trousers shade in the inclusive unit interval.
    pub pants_hue: f64,
    /// Footwear shade in the inclusive unit interval.
    pub footwear_hue: f64,
}

/// Invalid choices reported identically by full creation validation and preview resolution.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CharacterGenAppearanceError {
    /// An ordinal does not name an authored option; empty lists accept only the inert zero value.
    #[error("appearance choice {field}={selected} is out of range for {options_len} options")]
    ChoiceOutOfRange {
        /// User-editable field requiring correction.
        field: &'static str,
        /// Submitted ordinal.
        selected: u32,
        /// Number of authored choices.
        options_len: usize,
    },
    /// A template key is not offered by the selected garment.
    #[error("appearance color {field}={selected} is not available for the selected garment")]
    ClothingColorUnavailable {
        /// User-editable color requiring correction.
        field: &'static str,
        /// Submitted palette-template key.
        selected: u32,
    },
    /// NaN, infinity and values outside the inclusive unit interval are invalid shades.
    #[error("appearance shade {field} must be finite and between 0 and 1")]
    InvalidShade {
        /// User-editable shade requiring correction.
        field: &'static str,
    },
}

impl CharacterGenAppearanceChoices {
    /// Validate appearance independently of name, attributes, skills and server submission.
    pub fn validate(
        &self,
        options: &CharacterGenAppearanceOptions,
    ) -> Vec<CharacterGenAppearanceError> {
        let mut errors = Vec::new();
        let mut choices = vec![
            ("eyes", self.eyes, options.eye_strips.len()),
            ("nose", self.nose, options.nose_strips.len()),
            ("mouth", self.mouth, options.mouth_strips.len()),
            ("hair_color", self.hair_color, options.hair_color_ids.len()),
            ("eye_color", self.eye_color, options.eye_color_ids.len()),
            ("hair_style", self.hair_style, options.hair_styles.len()),
            ("shirt_style", self.shirt_style, options.shirts.len()),
            ("pants_style", self.pants_style, options.pants.len()),
            (
                "footwear_style",
                self.footwear_style,
                options.footwear.len(),
            ),
        ];
        if self.headgear_style != u32::MAX {
            choices.push((
                "headgear_style",
                self.headgear_style,
                options.headgear.len(),
            ));
        }
        for (field, selected, options_len) in choices {
            if selected as usize >= options_len && !(options_len == 0 && selected == 0) {
                errors.push(CharacterGenAppearanceError::ChoiceOutOfRange {
                    field,
                    selected,
                    options_len,
                });
            }
        }
        for (field, styles, style, selected) in [
            (
                "headgear_color",
                &options.headgear,
                self.headgear_style,
                self.headgear_color,
            ),
            (
                "shirt_color",
                &options.shirts,
                self.shirt_style,
                self.shirt_color,
            ),
            (
                "pants_color",
                &options.pants,
                self.pants_style,
                self.pants_color,
            ),
            (
                "footwear_color",
                &options.footwear,
                self.footwear_style,
                self.footwear_color,
            ),
        ] {
            if let Some(gear) = styles.get(style as usize)
                && !gear.palette_template_ids.contains(&selected)
            {
                errors.push(CharacterGenAppearanceError::ClothingColorUnavailable {
                    field,
                    selected,
                });
            }
        }
        for (field, shade) in [
            ("skin_hue", self.skin_hue),
            ("hair_hue", self.hair_hue),
            ("headgear_hue", self.headgear_hue),
            ("shirt_hue", self.shirt_hue),
            ("pants_hue", self.pants_hue),
            ("footwear_hue", self.footwear_hue),
        ] {
            if !(0.0..=1.0).contains(&shade) {
                errors.push(CharacterGenAppearanceError::InvalidShade { field });
            }
        }
        errors
    }
}

/// Static authored visual result, before adaptation into runtime preview contracts.
#[derive(Debug, Clone)]
pub struct CharacterGenVisual {
    /// Effective gender setup or selected body-style alternate.
    pub setup_id: u32,
    /// Gender scale converted from its authored percentage.
    pub scale: f32,
    /// Ordered normalized substitutions with expanded palette color intervals.
    pub appearance: ObjDesc,
    /// Independent heritage backdrop; absent when the authored DID is zero.
    pub background_setup_id: Option<u32>,
    /// Retail creation idle at the authored preview traversal rate.
    pub idle: MotionClip,
}

impl ContentRepository {
    /// Resolve a valid appearance draft without world bootstrap or network authority.
    pub fn resolve_character_gen_visual(
        &self,
        heritage_id: u32,
        gender_id: u32,
        choices: &CharacterGenAppearanceChoices,
    ) -> Result<CharacterGenVisual> {
        let table = self.read_asset::<CharGen>("character generator table")?;
        let heritage = table
            .heritage_groups
            .get(&heritage_id)
            .with_context(|| format!("unknown creation heritage {heritage_id}"))?;
        let gender_key =
            i32::try_from(gender_id).context("creation gender exceeds the authored key range")?;
        let gender = heritage
            .genders
            .get(&gender_key)
            .with_context(|| format!("unknown gender {gender_id} for heritage {heritage_id}"))?;
        resolve_visual(self, heritage_id, heritage, gender_id, gender, choices)
    }
}

fn resolve_visual(
    repository: &ContentRepository,
    heritage_id: u32,
    heritage: &HeritageGroup,
    gender_id: u32,
    gender: &CharacterGenGender,
    choices: &CharacterGenAppearanceChoices,
) -> Result<CharacterGenVisual> {
    let uses_starter_clothing = super::uses_starter_clothing(heritage_id);
    let clothing = super::read_clothing_tables(
        repository,
        std::iter::once(gender).filter(|_| uses_starter_clothing),
    )?;
    let options = CharacterGenGenderDefinition::from_asset(
        gender_id,
        gender,
        uses_starter_clothing,
        &clothing,
    )?;
    let errors = choices.validate(&options.appearance);
    if !errors.is_empty() {
        bail!(
            errors
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\n")
        );
    }
    let style = gender.hair_style_list.get(choices.hair_style as usize);
    let setup_id = match style {
        Some(style) if style.alternate_setup != 0 => style.alternate_setup,
        _ => gender.setup_id,
    };
    if setup_id == 0 {
        bail!("creation body has no setup identity");
    }
    if gender.scale == 0 {
        bail!("creation body has zero authored scale");
    }
    let appearance = compose_appearance(
        repository,
        gender,
        choices,
        setup_id,
        super::uses_starter_clothing(heritage_id),
    )?;
    // gmCG3DView::{Initialize,Update}, acclient.c:273119/273253. The mapper, not these
    // enum values, owns resource identity; the Olthoi bodies use distinct animation sets.
    let idle_enum = match heritage_id {
        12 => 0x1000_0011,
        13 => 0x1000_0013,
        _ => 0x1000_0006,
    };
    let mut mapper = UiAssetReader::new(repository);
    let idle_id = mapper.enum_did(7, idle_enum)?;
    let animation = |id| -> Result<Animation> {
        let bytes = repository
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, id))?
            .bytes;
        let animation = Animation::read(&mut Cursor::new(bytes))?;
        if animation.id != id {
            bail!("creation animation identity differs from requested 0x{id:08X}");
        }
        Ok(animation)
    };
    Ok(CharacterGenVisual {
        setup_id,
        scale: gender.scale as f32 / 100.0,
        appearance,
        background_setup_id: (heritage.environment_setup_id != 0)
            .then_some(heritage.environment_setup_id),
        // gmCG3DView::StartAnimation, acclient.c:273029.
        idle: MotionClip::from_animation(animation(idle_id)?, 0, -1, 30.0)?,
    })
}

/// Retail gmCG3DView::Update (acclient.c:273308–273490) composition order.
fn compose_appearance(
    repository: &ContentRepository,
    gender: &CharacterGenGender,
    choices: &CharacterGenAppearanceChoices,
    setup_id: u32,
    uses_starter_clothing: bool,
) -> Result<ObjDesc> {
    let mut result = ObjDesc {
        palette_id: Some(gender.base_palette),
        ..ObjDesc::empty()
    };
    result.overlay(&gender.base_obj_desc);
    let hair = gender.hair_style_list.get(choices.hair_style as usize);
    if let Some(hair) = hair {
        result.overlay(&hair.obj_desc);
    }
    let clothing = [
        (
            &gender.headgear_list,
            choices.headgear_style,
            choices.headgear_color,
            choices.headgear_hue,
        ),
        (
            &gender.pants_list,
            choices.pants_style,
            choices.pants_color,
            choices.pants_hue,
        ),
        (
            &gender.shirt_list,
            choices.shirt_style,
            choices.shirt_color,
            choices.shirt_hue,
        ),
        (
            &gender.footwear_list,
            choices.footwear_style,
            choices.footwear_color,
            choices.footwear_hue,
        ),
    ];
    for (styles, selected, color, shade) in clothing.into_iter().filter(|_| uses_starter_clothing) {
        if let Some(gear) = styles.get(selected as usize) {
            result.overlay(&repository.build_clothing_obj_desc(
                gear.clothing_table,
                setup_id,
                color,
                shade,
            )?);
        }
    }
    if let Some(eyes) = gender.eye_strip_list.get(choices.eyes as usize) {
        result.overlay(if hair.is_some_and(|style| style.bald) {
            &eyes.obj_desc_bald
        } else {
            &eyes.obj_desc
        });
    }
    if let Some(nose) = gender.nose_strip_list.get(choices.nose as usize) {
        result.overlay(&nose.obj_desc);
    }
    if let Some(mouth) = gender.mouth_strip_list.get(choices.mouth as usize) {
        result.overlay(&mouth.obj_desc);
    }
    let palette = |id, shade| -> Result<u32> {
        let bytes = repository
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, id))?
            .bytes;
        let set = PaletteSet::unpack(&mut Cursor::new(bytes))?;
        if set.id != id {
            bail!("creation palette set identity differs from requested 0x{id:08X}");
        }
        set.palette_id_for_shade(shade)
            .with_context(|| format!("palette set 0x{id:08X} has no palette for shade {shade}"))
    };
    let mut face = ObjDesc::empty();
    face.sub_palettes.push(SubPalette {
        sub_id: palette(gender.skin_palette_set, choices.skin_hue)?,
        offset: 0,
        num_colors: 192,
    });
    if let Some(id) = gender.hair_color_list.get(choices.hair_color as usize) {
        face.sub_palettes.push(SubPalette {
            sub_id: palette(*id, choices.hair_hue)?,
            offset: 192,
            num_colors: 64,
        });
    }
    if let Some(id) = gender.eye_color_list.get(choices.eye_color as usize) {
        face.sub_palettes.push(SubPalette {
            sub_id: *id,
            offset: 256,
            num_colors: 64,
        });
    }
    result.overlay(&face);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::CountingSource;
    use crate::ui_assets::MASTER_DID_MAPPER;
    use holtburger_dat::file_type::char_gen::{EyeStrip, Gear, HairStyle};
    use holtburger_dat::file_type::material::{AnimationPartChange, TextureMapChange};
    use std::{collections::HashMap, sync::Arc};

    const SETUP: u32 = 0x0200_0001;
    const ALTERNATE: u32 = 0x0200_0002;
    const BASE_PALETTE: u32 = 0x0400_0001;
    const SKIN_SET: u32 = 0x0F00_0001;
    const HAIR_SET: u32 = 0x0F00_0002;
    const FIRST_SKIN: u32 = 0x0400_0010;
    const LAST_SKIN: u32 = 0x0400_0011;
    const HAIR: u32 = 0x0400_0020;
    const EYES: u32 = 0x0400_0030;
    const IDLE: u32 = 0x0300_0001;
    const ACID_IDLE: u32 = 0x0300_0002;
    const CLOTHING: u32 = 0x1000_0001;
    const TEMPLATE: u32 = 17;

    #[test]
    fn garment_colors_filter_authored_keys_and_validate_membership_after_style_changes() {
        use holtburger_dat::file_type::material::{
            CloPaletteTemplate, CloSubpalEffect, ClothingTable,
        };
        use std::collections::BTreeMap;
        let effect = CloSubpalEffect {
            ranges: vec![],
            palette_set_id: SKIN_SET,
        };
        let template = |has_effect| CloPaletteTemplate {
            icon_id: 0,
            subpal_effects: if has_effect {
                vec![effect.clone()]
            } else {
                vec![]
            },
        };
        let tables = BTreeMap::from([(
            CLOTHING,
            ClothingTable {
                id: CLOTHING,
                clothing_bases: BTreeMap::new(),
                palette_templates: BTreeMap::from([
                    (TEMPLATE, template(true)),
                    (42, template(true)),
                    (43, template(false)),
                    (44, template(true)),
                ]),
            },
        )]);
        let item = Gear {
            name: "Shirt".into(),
            clothing_table: CLOTHING,
            weenie_default: 0,
        };
        let first =
            super::super::CharacterGenGear::from_asset(&item, &[TEMPLATE, 43], &tables).unwrap();
        let second = super::super::CharacterGenGear::from_asset(&item, &[42], &tables).unwrap();
        assert_eq!(first.palette_template_ids, vec![TEMPLATE]);
        assert_eq!(second.palette_template_ids, vec![42]);
        let mut options =
            CharacterGenGenderDefinition::from_asset(1, &gender(), true, &BTreeMap::new())
                .unwrap()
                .appearance;
        options.shirts = vec![first, second];
        let mut draft = choices();
        assert!(draft.validate(&options).is_empty());
        draft.shirt_style = 1;
        assert_eq!(
            draft.validate(&options),
            vec![CharacterGenAppearanceError::ClothingColorUnavailable {
                field: "shirt_color",
                selected: TEMPLATE,
            }]
        );
        draft.shirt_color = 42;
        assert!(draft.validate(&options).is_empty());
        // An index of zero is not a substitute for a garment's nonzero template key.
        draft.shirt_color = 0;
        assert!(matches!(
            draft.validate(&options)[0],
            CharacterGenAppearanceError::ClothingColorUnavailable { .. }
        ));
        let uncolored = super::super::CharacterGenGear::from_asset(&item, &[43], &tables).unwrap();
        assert_eq!(uncolored.palette_template_ids, vec![0]);
    }

    #[test]
    fn gear_and_olthoi_skip_clothing_records_that_do_not_dress_their_bodies() {
        let repo = repository();
        let mut body = gender();
        body.shirt_list.push(Gear {
            name: "Ignored clothing".into(),
            clothing_table: u32::MAX,
            weenie_default: 0,
        });
        for heritage_id in [6, 12, 13] {
            let options = CharacterGenGenderDefinition::from_asset(
                1,
                &body,
                super::super::uses_starter_clothing(heritage_id),
                &std::collections::BTreeMap::new(),
            )
            .unwrap();
            assert!(options.appearance.shirts.is_empty());
            assert!(choices().validate(&options.appearance).is_empty());
            let result = compose_appearance(&repo, &body, &choices(), ALTERNATE, false).unwrap();
            assert_eq!(result.anim_part_changes.last().unwrap().part_id, 4);
        }
    }

    fn description(part: u32) -> ObjDesc {
        ObjDesc {
            palette_id: Some(BASE_PALETTE + 1),
            anim_part_changes: vec![AnimationPartChange {
                part_index: 0,
                part_id: part,
            }],
            texture_changes: vec![TextureMapChange {
                part_index: 0,
                old_texture: 1,
                new_texture: part,
            }],
            ..ObjDesc::empty()
        }
    }

    fn gender() -> CharacterGenGender {
        CharacterGenGender {
            name: "Body".into(),
            scale: 125,
            setup_id: SETUP,
            sound_table: 0,
            icon_image: 0,
            base_palette: BASE_PALETTE,
            skin_palette_set: SKIN_SET,
            physics_table: 0,
            motion_table: 0,
            combat_table: 0,
            base_obj_desc: description(1),
            hair_color_list: vec![HAIR_SET],
            hair_style_list: vec![HairStyle {
                icon_image: 0,
                bald: true,
                alternate_setup: ALTERNATE,
                obj_desc: ObjDesc {
                    anim_part_changes: vec![
                        AnimationPartChange {
                            part_index: 0,
                            part_id: 2,
                        },
                        AnimationPartChange {
                            part_index: 1,
                            part_id: 20,
                        },
                    ],
                    ..ObjDesc::empty()
                },
            }],
            eye_color_list: vec![EYES],
            eye_strip_list: vec![EyeStrip {
                icon_image: 0,
                icon_image_bald: 0,
                obj_desc: description(3),
                obj_desc_bald: description(4),
            }],
            nose_strip_list: vec![],
            mouth_strip_list: vec![],
            headgear_list: vec![],
            shirt_list: vec![],
            pants_list: vec![],
            footwear_list: vec![],
            clothing_colors_list: vec![],
        }
    }

    fn choices() -> CharacterGenAppearanceChoices {
        CharacterGenAppearanceChoices {
            eyes: 0,
            nose: 0,
            mouth: 0,
            hair_color: 0,
            eye_color: 0,
            hair_style: 0,
            headgear_style: u32::MAX,
            headgear_color: 0,
            shirt_style: 0,
            shirt_color: TEMPLATE,
            pants_style: 0,
            pants_color: 0,
            footwear_style: 0,
            footwear_color: 0,
            skin_hue: 1.0,
            hair_hue: 0.0,
            headgear_hue: 0.0,
            shirt_hue: 0.0,
            pants_hue: 0.0,
            footwear_hue: 0.0,
        }
    }

    fn mapper(id: u32, entries: &[(u32, u32)]) -> Vec<u8> {
        let mut bytes = id.to_le_bytes().to_vec();
        bytes.extend([0, entries.len() as u8]);
        for (key, value) in entries {
            bytes.extend(key.to_le_bytes());
            bytes.extend(value.to_le_bytes());
        }
        bytes.extend([0; 6]); // Empty client names, server IDs, server names.
        bytes
    }

    fn repository() -> ContentRepository {
        let animation = |id: u32| {
            [id, 0, 0, 1, 0]
                .into_iter()
                .flat_map(u32::to_le_bytes)
                .collect()
        };
        let palette = |id: u32, entries: &[u32]| {
            [id, entries.len() as u32]
                .into_iter()
                .chain(entries.iter().copied())
                .flat_map(u32::to_le_bytes)
                .collect()
        };
        let group = MASTER_DID_MAPPER + 1;
        // One base/object effect, followed by the non-ordinal palette-template key and no subpalettes.
        let mut clothing = CLOTHING.to_le_bytes().to_vec();
        clothing.extend(1u16.to_le_bytes());
        clothing.extend(1u16.to_le_bytes());
        for value in [ALTERNATE, 1, 0, 8, 0] {
            clothing.extend(value.to_le_bytes());
        }
        clothing.extend(1u16.to_le_bytes());
        clothing.extend(1u16.to_le_bytes());
        for value in [TEMPLATE, 0, 0] {
            clothing.extend(value.to_le_bytes());
        }
        let files = [
            (SKIN_SET, palette(SKIN_SET, &[FIRST_SKIN, LAST_SKIN])),
            (HAIR_SET, palette(HAIR_SET, &[HAIR])),
            (MASTER_DID_MAPPER, mapper(MASTER_DID_MAPPER, &[(7, group)])),
            (
                group,
                mapper(
                    group,
                    &[
                        (0x1000_0006, IDLE),
                        (0x1000_0011, IDLE),
                        (0x1000_0013, ACID_IDLE),
                    ],
                ),
            ),
            (IDLE, animation(IDLE)),
            (ACID_IDLE, animation(ACID_IDLE)),
            (CLOTHING, clothing),
        ]
        .into_iter()
        .map(|(id, bytes)| ((EOR_PORTAL_NAMESPACE.into(), id), bytes))
        .collect();
        ContentRepository::from_mounts(vec![Arc::new(CountingSource::new(files))])
    }

    #[test]
    fn composition_preserves_base_palette_and_expanded_face_ranges_with_bald_and_multipart_styles()
    {
        let repo = repository();
        let gender = gender();
        let result = compose_appearance(&repo, &gender, &choices(), ALTERNATE, true).unwrap();
        assert_eq!(result.palette_id, Some(BASE_PALETTE));
        assert_eq!(
            result.anim_part_changes,
            vec![
                AnimationPartChange {
                    part_index: 1,
                    part_id: 20
                },
                AnimationPartChange {
                    part_index: 0,
                    part_id: 4
                },
            ]
        );
        assert_eq!(result.texture_changes[0].new_texture, 4);
        assert_eq!(
            result.sub_palettes,
            vec![
                SubPalette {
                    sub_id: LAST_SKIN,
                    offset: 0,
                    num_colors: 192
                },
                SubPalette {
                    sub_id: HAIR,
                    offset: 192,
                    num_colors: 64
                },
                SubPalette {
                    sub_id: EYES,
                    offset: 256,
                    num_colors: 64
                },
            ]
        );
        let mut edited = choices();
        edited.skin_hue = 0.0;
        assert_eq!(
            compose_appearance(&repo, &gender, &edited, ALTERNATE, true)
                .unwrap()
                .sub_palettes[0]
                .sub_id,
            FIRST_SKIN
        );
    }

    #[test]
    fn clothing_uses_authored_template_key_and_precedes_face_overlays() {
        let repo = repository();
        let mut gender = gender();
        gender.shirt_list.push(Gear {
            name: "Shirt".into(),
            clothing_table: CLOTHING,
            weenie_default: 0,
        });
        gender.clothing_colors_list.push(TEMPLATE);
        let result = compose_appearance(&repo, &gender, &choices(), ALTERNATE, true).unwrap();
        assert_eq!(result.anim_part_changes.last().unwrap().part_id, 4);
        gender.eye_strip_list.clear();
        assert_eq!(
            compose_appearance(&repo, &gender, &choices(), ALTERNATE, true)
                .unwrap()
                .anim_part_changes
                .last()
                .unwrap()
                .part_id,
            8
        );
    }

    #[test]
    fn appearance_validation_covers_empty_choices_sentinels_and_all_nonfinite_or_out_of_range_shades()
     {
        let options = CharacterGenGenderDefinition::from_asset(
            1,
            &gender(),
            true,
            &std::collections::BTreeMap::new(),
        )
        .unwrap()
        .appearance;
        assert!(choices().validate(&options).is_empty());
        let mut edited = choices();
        edited.headgear_color = u32::MAX;
        assert!(edited.validate(&options).is_empty());
        edited.nose = 1;
        assert!(matches!(
            edited.validate(&options)[0],
            CharacterGenAppearanceError::ChoiceOutOfRange { field: "nose", .. }
        ));
        for shade in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.1, 1.1] {
            let mut edited = choices();
            edited.skin_hue = shade;
            assert_eq!(
                edited.validate(&options),
                vec![CharacterGenAppearanceError::InvalidShade { field: "skin_hue" }]
            );
        }
    }

    #[test]
    fn resolution_uses_alternate_setup_percentage_scale_and_mapped_heritage_animations() {
        let repo = repository();
        let heritage = HeritageGroup {
            name: "Heritage".into(),
            icon_image: 0,
            setup_id: 0,
            environment_setup_id: SETUP,
            attribute_credits: 0,
            skill_credits: 0,
            primary_start_areas: vec![],
            secondary_start_areas: vec![],
            skills: vec![],
            templates: vec![],
            genders: HashMap::new(),
        };
        for (heritage_id, idle_id) in [(1, IDLE), (12, IDLE), (13, ACID_IDLE)] {
            let result =
                resolve_visual(&repo, heritage_id, &heritage, 1, &gender(), &choices()).unwrap();
            assert_eq!(result.setup_id, ALTERNATE);
            assert_eq!(result.scale, 1.25);
            assert_eq!(result.background_setup_id, Some(SETUP));
            assert_eq!(result.idle.animation.id, idle_id);
            assert_eq!(result.idle.framerate, 30.0);
        }
    }
}
