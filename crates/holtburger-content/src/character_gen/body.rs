//! Body and face choices shared by creation and in-world appearance editing.

use super::CharacterGenAppearanceOptions;
use super::appearance::CharacterGenAppearanceError;
use crate::ContentRepository;
use anyhow::{Context, Result};
use holtburger_dat::file_type::char_gen::CharacterGenGender;
use holtburger_dat::file_type::material::{ObjDesc, SubPalette};
use serde::{Deserialize, Serialize};
use std::ops::Range;

impl ContentRepository {
    /// Mean RGB of an absolute substituted palette interval, shared by appearance editors.
    pub fn read_appearance_palette_swatch(&self, id: u32, range: Range<usize>) -> Result<[u8; 3]> {
        let palette = self.read_palette(id)?;
        let colors = palette
            .colors_argb
            .get(range)
            .with_context(|| format!("appearance swatch exceeds palette 0x{id:08X}"))?;
        anyhow::ensure!(!colors.is_empty(), "appearance swatch has no colors");
        let channel = |shift| {
            (colors
                .iter()
                .map(|color| u64::from((color >> shift) & 255_u32))
                .sum::<u64>()
                / colors.len() as u64) as u8
        };
        Ok([channel(16), channel(8), channel(0)])
    }
}

/// Authored body style ordinals and palette shades, independent of starter garments and identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BodyAppearanceChoices {
    /// Eye strip ordinal; the hair style selects its bald variant.
    pub eyes: u32,
    /// Nose strip ordinal.
    pub nose: u32,
    /// Mouth strip ordinal.
    pub mouth: u32,
    /// Hair palette-set ordinal.
    pub hair_color: u32,
    /// Eye palette ordinal.
    pub eye_color: u32,
    /// Hair or nonhuman body style ordinal.
    pub hair_style: u32,
    /// Skin palette-set shade in the inclusive unit interval.
    pub skin_hue: f64,
    /// Hair palette-set shade in the inclusive unit interval.
    pub hair_hue: f64,
}

/// Authored list sizes used by the common validator; no clothing or creation workflow facts.
pub(super) struct BodyAppearanceLimits {
    /// Number of eye strips.
    pub eyes: usize,
    /// Number of nose strips.
    pub noses: usize,
    /// Number of mouth strips.
    pub mouths: usize,
    /// Number of hair palette sets.
    pub hair_colors: usize,
    /// Number of eye palettes.
    pub eye_colors: usize,
    /// Number of hair/body styles.
    pub hair_styles: usize,
}

impl From<&CharacterGenGender> for BodyAppearanceLimits {
    fn from(gender: &CharacterGenGender) -> Self {
        Self {
            eyes: gender.eye_strip_list.len(),
            noses: gender.nose_strip_list.len(),
            mouths: gender.mouth_strip_list.len(),
            hair_colors: gender.hair_color_list.len(),
            eye_colors: gender.eye_color_list.len(),
            hair_styles: gender.hair_style_list.len(),
        }
    }
}

impl From<&CharacterGenAppearanceOptions> for BodyAppearanceLimits {
    fn from(options: &CharacterGenAppearanceOptions) -> Self {
        Self {
            eyes: options.eye_strips.len(),
            noses: options.nose_strips.len(),
            mouths: options.mouth_strips.len(),
            hair_colors: options.hair_color_ids.len(),
            eye_colors: options.eye_color_ids.len(),
            hair_styles: options.hair_styles.len(),
        }
    }
}

impl BodyAppearanceChoices {
    /// Validate against raw authored body data without loading starter clothing.
    pub fn validate(&self, gender: &CharacterGenGender) -> Vec<CharacterGenAppearanceError> {
        self.validate_limits(&BodyAppearanceLimits::from(gender))
    }

    pub(super) fn validate_limits(
        &self,
        limits: &BodyAppearanceLimits,
    ) -> Vec<CharacterGenAppearanceError> {
        let mut errors = Vec::new();
        for (field, selected, options_len) in [
            ("eyes", self.eyes, limits.eyes),
            ("nose", self.nose, limits.noses),
            ("mouth", self.mouth, limits.mouths),
            ("hair_color", self.hair_color, limits.hair_colors),
            ("eye_color", self.eye_color, limits.eye_colors),
            ("hair_style", self.hair_style, limits.hair_styles),
        ] {
            // Empty authored lists retain the existing inert zero convention used by creation.
            if selected as usize >= options_len && !(options_len == 0 && selected == 0) {
                errors.push(CharacterGenAppearanceError::ChoiceOutOfRange {
                    field,
                    selected,
                    options_len,
                });
            }
        }
        for (field, shade) in [("skin_hue", self.skin_hue), ("hair_hue", self.hair_hue)] {
            if !(0.0..=1.0).contains(&shade) {
                errors.push(CharacterGenAppearanceError::InvalidShade { field });
            }
        }
        errors
    }
}

/// Gender base and selected hair/body style, before any garments or face layers are applied.
pub(super) fn body_base(gender: &CharacterGenGender, choices: &BodyAppearanceChoices) -> ObjDesc {
    let mut result = ObjDesc {
        palette_id: Some(gender.base_palette),
        ..ObjDesc::empty()
    };
    result.overlay(&gender.base_obj_desc);
    if let Some(style) = gender.hair_style_list.get(choices.hair_style as usize) {
        result.overlay(&style.obj_desc);
    }
    result
}

/// Face texture layers with hair-dependent bald selection; palettes are resolved separately.
pub(super) fn face_textures(
    gender: &CharacterGenGender,
    choices: &BodyAppearanceChoices,
) -> ObjDesc {
    let mut result = ObjDesc::empty();
    let bald = gender
        .hair_style_list
        .get(choices.hair_style as usize)
        .is_some_and(|style| style.bald);
    if let Some(eyes) = gender.eye_strip_list.get(choices.eyes as usize) {
        result.overlay(if bald {
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
    result
}

/// Concrete palette selections used both by composed visuals and barber submission assets.
pub(super) struct ResolvedFaceLayer {
    /// Face textures and palettes, applied after any creation garments.
    pub appearance: ObjDesc,
    /// Skin palette DID selected from the authored set.
    pub skin_palette: u32,
    /// Hair palette DID; absent only when the authored body has no hair-color list.
    pub hair_palette: Option<u32>,
    /// Eye palette DID; absent only when the authored body has no eye-color list.
    pub eyes_palette: Option<u32>,
}

/// Resolve each palette once, then expose its identity alongside the normalized face layer.
pub(super) fn resolve_face_layer(
    repository: &ContentRepository,
    gender: &CharacterGenGender,
    choices: &BodyAppearanceChoices,
) -> Result<ResolvedFaceLayer> {
    let palette = |id, shade| -> Result<u32> {
        repository
            .read_palette_set(id)?
            .palette_id_for_shade(shade)
            .with_context(|| format!("palette set 0x{id:08X} has no palette for shade {shade}"))
    };
    resolve_face_layer_with_palettes(gender, choices, palette)
}

/// Pure composition entrypoint shared by archive-backed creation and parsed barber rules.
pub(super) fn resolve_face_layer_with_palettes(
    gender: &CharacterGenGender,
    choices: &BodyAppearanceChoices,
    palette: impl Fn(u32, f64) -> Result<u32>,
) -> Result<ResolvedFaceLayer> {
    let skin_palette = palette(gender.skin_palette_set, choices.skin_hue)?;
    let hair_palette = gender
        .hair_color_list
        .get(choices.hair_color as usize)
        .map(|id| palette(*id, choices.hair_hue))
        .transpose()?;
    let eyes_palette = gender
        .eye_color_list
        .get(choices.eye_color as usize)
        .copied();
    let mut appearance = face_textures(gender, choices);
    let mut palettes = ObjDesc::empty();
    for (id, offset, num_colors) in [
        (Some(skin_palette), 0, 192),
        (hair_palette, 192, 64),
        (eyes_palette, 256, 64),
    ] {
        if let Some(sub_id) = id {
            palettes.sub_palettes.push(SubPalette {
                sub_id,
                offset,
                num_colors,
            });
        }
    }
    appearance.overlay(&palettes);
    Ok(ResolvedFaceLayer {
        appearance,
        skin_palette,
        hair_palette,
        eyes_palette,
    })
}
