//! Parsed appearance editing rules; no account, network, scene, or equipment authority.

use super::body::{BodyAppearanceChoices, body_base, resolve_face_layer_with_palettes};
use crate::ContentRepository;
use anyhow::{Context, Result, bail, ensure};
use holtburger_dat::file_type::CharGen;
use holtburger_dat::file_type::char_gen::CharacterGenGender;
use holtburger_dat::file_type::material::{ObjDesc, PaletteSet};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Current/default texture pair kept together for preview interpretation and final submission.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppearanceTexturePair {
    /// Texture to install.
    pub current: u32,
    /// Authored texture replaced by the current texture.
    pub original: u32,
}

/// Server appearance assets interpreted by content rules, independent of their wire encoding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BarberAppearanceAssets {
    /// Base model palette.
    pub base_palette: u32,
    /// Head model, with zero accepted for nonhuman bodies.
    pub head_object: u32,
    /// Hair current/default textures.
    pub hair: AppearanceTexturePair,
    /// Eyes current/default textures.
    pub eyes: AppearanceTexturePair,
    /// Nose current/default textures.
    pub nose: AppearanceTexturePair,
    /// Mouth current/default textures.
    pub mouth: AppearanceTexturePair,
    /// Selected skin palette.
    pub skin_palette: u32,
    /// Selected hair palette.
    pub hair_palette: u32,
    /// Selected eye palette.
    pub eyes_palette: u32,
    /// Effective setup, including flame/crown variants.
    pub setup: u32,
    /// Empyrean earthbound flag supplied by ACE; other heritages derive their option from setup.
    pub option1: u32,
}

/// Only the applicable racial option can exist in a barber draft.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum BarberRacialChoice {
    /// No racial toggle.
    Standard,
    /// Empyrean animation/movement choice, committed through ACE's property update.
    Empyrean {
        /// Whether to suppress levitation.
        earthbound: bool,
    },
    /// Undead default head particles, independent of skeleton/zombie body style.
    Undead {
        /// Whether to display head flames.
        flames: bool,
    },
    /// Umbraen crown and body particle selection.
    Umbraen {
        /// Whether to display the crown.
        crown: bool,
    },
    /// Penumbraen crown particle selection.
    Penumbraen {
        /// Whether to display the crown.
        crown: bool,
    },
}

/// Editable body and its single heritage-specific option; no clothing or wire assets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BarberAppearanceChoices {
    /// Common body choices shared with creation.
    pub body: BodyAppearanceChoices,
    /// Applicable racial toggle.
    pub racial: BarberRacialChoice,
}

/// Source-backed local Apply consequence; zero script means clear particles without replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BarberParticleChange {
    /// Ordinary and Empyrean editing does not replace the live particle manager.
    Preserve,
    /// Retail clears live particles before optionally starting the selected default script.
    Replace {
        /// Selected physics script; absent for no-flame and Penumbraen no-crown.
        script: Option<u32>,
    },
}

/// Single resolved source consumed by the bare-body preview and finish adapter.
#[derive(Debug, Clone)]
pub struct ResolvedBarberAppearance {
    /// Complete bare-body substitutions, without equipment or creation garments.
    pub appearance: ObjDesc,
    /// Concrete asset identities for the complete finish request.
    pub assets: BarberAppearanceAssets,
    /// Local particle consequence on Apply; never changes simulation geometry.
    pub particles: BarberParticleChange,
}

/// Style control availability is one coherent choice, rather than independent contradictory flags.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BarberStyleOptions {
    /// Authored style counts for bodies whose styles can be persisted through FinishBarber.
    Editable {
        /// Hair/body style count.
        hair: usize,
        /// Eye strip count.
        eyes: usize,
        /// Nose strip count.
        noses: usize,
        /// Mouth strip count.
        mouths: usize,
    },
    /// Nonhuman style is frozen to the original, but palettes remain editable.
    Fixed,
}

/// Static control data resolved once for the selected character's barber interaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarberAppearanceCatalog {
    /// Applicable authored style controls.
    pub styles: BarberStyleOptions,
    /// Hair colors, with swatches in shade order within each palette set.
    pub hair_colors: Vec<Vec<[u8; 3]>>,
    /// Skin palette swatches in shade order.
    pub skin_colors: Vec<[u8; 3]>,
    /// Eye palette swatches in authored ordinal order.
    pub eye_colors: Vec<[u8; 3]>,
}

/// Parsed character-bound rules; callers can evaluate drafts without archive reads.
#[derive(Debug, Clone)]
pub struct BarberAppearanceRules {
    /// Heritage used by the single racial decision owner.
    heritage: u32,
    /// Gender index used to select source-backed racial setup/script identities.
    gender_index: usize,
    /// Authored body records, also consumed by the host's control/catalog projection.
    gender: CharacterGenGender,
    /// Complete palette sets needed by forward and inverse resolution.
    palettes: BTreeMap<u32, PaletteSet>,
}

impl ContentRepository {
    /// Load just the selected body and palette closure; no skills, garments, backdrop, or idle.
    pub fn read_barber_appearance_rules(
        &self,
        heritage_id: u32,
        gender_id: u32,
    ) -> Result<BarberAppearanceRules> {
        let table = self.read_asset::<CharGen>("barber character table")?;
        let heritage = table
            .heritage_groups
            .get(&heritage_id)
            .with_context(|| format!("unknown barber heritage {heritage_id}"))?;
        let gender_key =
            i32::try_from(gender_id).context("barber gender exceeds authored key range")?;
        let gender = heritage.genders.get(&gender_key).with_context(|| {
            format!("unknown barber gender {gender_id} for heritage {heritage_id}")
        })?;
        let mut palettes = BTreeMap::new();
        for id in
            std::iter::once(gender.skin_palette_set).chain(gender.hair_color_list.iter().copied())
        {
            if let std::collections::btree_map::Entry::Vacant(entry) = palettes.entry(id) {
                entry.insert(self.read_palette_set(id)?);
            }
        }
        BarberAppearanceRules::from_assets(heritage_id, gender_id, gender.clone(), palettes)
    }
}

impl BarberAppearanceRules {
    /// Assemble a closed parsed ruleset; custom sources and fixtures use the same checks.
    pub fn from_assets(
        heritage: u32,
        gender_id: u32,
        gender: CharacterGenGender,
        palettes: BTreeMap<u32, PaletteSet>,
    ) -> Result<Self> {
        ensure!(
            matches!(gender_id, 1 | 2),
            "unsupported barber gender {gender_id}"
        );
        for id in
            std::iter::once(gender.skin_palette_set).chain(gender.hair_color_list.iter().copied())
        {
            let set = palettes
                .get(&id)
                .with_context(|| format!("barber palette set 0x{id:08X} is missing"))?;
            ensure!(
                !set.palette_ids.is_empty(),
                "barber palette set 0x{id:08X} has no palettes"
            );
        }
        Ok(Self {
            heritage,
            gender_index: (gender_id - 1) as usize,
            gender,
            palettes,
        })
    }

    /// Prepare display swatches outside the authority turn; draft edits use only parsed rules.
    pub fn catalog(&self, repository: &ContentRepository) -> Result<BarberAppearanceCatalog> {
        let swatches = |id, range: std::ops::Range<usize>| -> Result<Vec<[u8; 3]>> {
            let set = self.palette_set(id)?;
            set.palette_ids
                .iter()
                .map(|id| repository.read_appearance_palette_swatch(*id, range.clone()))
                .collect()
        };
        Ok(BarberAppearanceCatalog {
            styles: if self.body_style_editable() {
                BarberStyleOptions::Editable {
                    hair: self.gender.hair_style_list.len(),
                    eyes: self.gender.eye_strip_list.len(),
                    noses: self.gender.nose_strip_list.len(),
                    mouths: self.gender.mouth_strip_list.len(),
                }
            } else {
                BarberStyleOptions::Fixed
            },
            hair_colors: self
                .gender
                .hair_color_list
                .iter()
                .map(|id| swatches(*id, 192..256))
                .collect::<Result<_>>()?,
            skin_colors: swatches(self.gender.skin_palette_set, 0..192)?,
            eye_colors: self
                .gender
                .eye_color_list
                .iter()
                .map(|id| repository.read_appearance_palette_swatch(*id, 256..320))
                .collect::<Result<_>>()?,
        })
    }
    /// ACE persists nonhuman body styles outside the retail FinishBarber contract.
    pub fn body_style_editable(&self) -> bool {
        !matches!(self.heritage, 6 | 12 | 13)
    }

    /// Interpret actual assets, using retained body rows only for disabled nonhuman styles.
    pub fn interpret(
        &self,
        assets: &BarberAppearanceAssets,
        accepted: &ObjDesc,
    ) -> Result<BarberAppearanceChoices> {
        ensure!(
            assets.base_palette == self.gender.base_palette,
            "barber base palette 0x{:08X} is not authored for this body",
            assets.base_palette
        );
        let mut matches = Vec::new();
        for (index, style) in self.gender.hair_style_list.iter().enumerate() {
            let identifies_style = if self.body_style_editable() {
                style
                    .obj_desc
                    .anim_part_changes
                    .first()
                    .is_some_and(|part| part.part_id == assets.head_object)
                    && style
                        .obj_desc
                        .texture_changes
                        .first()
                        .is_some_and(|texture| {
                            texture.new_texture == assets.hair.current
                                && texture.old_texture == assets.hair.original
                        })
            } else {
                style
                    .obj_desc
                    .anim_part_changes
                    .iter()
                    .all(|part| accepted.anim_part_changes.contains(part))
                    && style
                        .obj_desc
                        .texture_changes
                        .iter()
                        .all(|texture| accepted.texture_changes.contains(texture))
            };
            if identifies_style {
                matches.push(index);
            }
        }
        let first = *matches.first().with_context(|| {
            format!(
                "cannot map barber head 0x{:08X} and hair texture 0x{:08X} to a body style",
                assets.head_object, assets.hair.current
            )
        })?;
        let style = &self.gender.hair_style_list[first];
        ensure!(
            matches.iter().all(|index| {
                let candidate = &self.gender.hair_style_list[*index];
                candidate.obj_desc == style.obj_desc
                    && candidate.alternate_setup == style.alternate_setup
                    && candidate.bald == style.bald
            }),
            "barber body style is ambiguous for the supplied appearance"
        );
        let skeleton = skeleton_setup(assets.setup);
        // ACE PlayerFactory.cs and SexCG.Get*Texture store the first facial substitution even
        // for skeleton bodies. Both Undead substitutions identify the same authored face choice.
        // Finish still uses the setup-specific pair, as retail does (acclient.c:260111–260334).
        let undead_face_aliases = self.heritage == 11;
        let face_index = |label: &str,
                          pair: AppearanceTexturePair,
                          descriptions: Vec<&ObjDesc>|
         -> Result<u32> {
            for (index, description) in descriptions.iter().enumerate() {
                let matches = if undead_face_aliases {
                    description.texture_changes.iter().any(|change| {
                        change.new_texture == pair.current && change.old_texture == pair.original
                    })
                } else {
                    texture_pair(description, skeleton)? == pair
                };
                if matches {
                    return Ok(index as u32);
                }
            }
            bail!("cannot map barber {label} texture pair {pair:?}")
        };
        let eyes = face_index(
            "eyes",
            assets.eyes,
            self.gender
                .eye_strip_list
                .iter()
                .map(|eye| {
                    if style.bald {
                        &eye.obj_desc_bald
                    } else {
                        &eye.obj_desc
                    }
                })
                .collect(),
        )?;
        let nose = face_index(
            "nose",
            assets.nose,
            self.gender
                .nose_strip_list
                .iter()
                .map(|strip| &strip.obj_desc)
                .collect(),
        )?;
        let mouth = face_index(
            "mouth",
            assets.mouth,
            self.gender
                .mouth_strip_list
                .iter()
                .map(|strip| &strip.obj_desc)
                .collect(),
        )?;
        let skin_hue = self.shade_for_palette(self.gender.skin_palette_set, assets.skin_palette)?;
        let mut selected_hair_palette = None;
        for (index, set) in self.gender.hair_color_list.iter().enumerate() {
            let palettes = self.palette_set(*set)?;
            if let Some(shade) = shade_for_palette(palettes, assets.hair_palette) {
                selected_hair_palette = Some((index as u32, shade));
                break;
            }
        }
        let (hair_color, hair_hue) = selected_hair_palette.with_context(|| {
            format!(
                "cannot map barber hair palette 0x{:08X}",
                assets.hair_palette
            )
        })?;
        let eye_color = self
            .gender
            .eye_color_list
            .iter()
            .position(|id| *id == assets.eyes_palette)
            .with_context(|| {
                format!(
                    "cannot map barber eye palette 0x{:08X}",
                    assets.eyes_palette
                )
            })? as u32;
        let racial = self.racial_from_assets(assets)?;
        let choices = BarberAppearanceChoices {
            body: BodyAppearanceChoices {
                eyes,
                nose,
                mouth,
                hair_color,
                eye_color,
                hair_style: first as u32,
                skin_hue,
                hair_hue,
            },
            racial,
        };
        let resolved = self.resolve(&choices, &choices)?;
        // Disabled nonhuman style fields contain legitimate non-assignment words, not style IDs.
        if self.body_style_editable() {
            let mut normalized = assets.clone();
            if undead_face_aliases {
                // Only same-choice authored aliases admitted above may normalize. Preserve every
                // other opening asset; do not turn an unknown texture into a default face.
                normalized.eyes = resolved.assets.eyes;
                normalized.nose = resolved.assets.nose;
                normalized.mouth = resolved.assets.mouth;
            }
            // ACE's option word is meaningful only for Empyrean; other toggles use setup.
            if self.heritage != 9 {
                normalized.option1 = 0;
            }
            ensure!(
                resolved.assets == normalized,
                "barber opening does not round-trip its authored appearance assets"
            );
        } else {
            ensure!(
                resolved.assets.setup == assets.setup,
                "barber setup does not match the retained nonhuman style"
            );
        }
        Ok(choices)
    }

    /// Validate the exact candidate against its original interaction before resolving it once.
    pub fn resolve(
        &self,
        original: &BarberAppearanceChoices,
        choices: &BarberAppearanceChoices,
    ) -> Result<ResolvedBarberAppearance> {
        let errors = choices.body.validate(&self.gender);
        ensure!(
            errors.is_empty(),
            "{}",
            errors
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\n")
        );
        if !self.body_style_editable() {
            ensure!(
                choices.body.hair_style == original.body.hair_style,
                "body-style editing is unavailable for this heritage on the current server"
            );
            ensure!(
                (choices.body.eyes, choices.body.nose, choices.body.mouth)
                    == (original.body.eyes, original.body.nose, original.body.mouth),
                "facial-style editing is unavailable for this heritage"
            );
        }
        let style = self
            .gender
            .hair_style_list
            .get(choices.body.hair_style as usize)
            .context("barber body has no authored style")?;
        let base_setup = if style.alternate_setup == 0 {
            self.gender.setup_id
        } else {
            style.alternate_setup
        };
        let (setup, option1, particles) = self.resolve_racial(&choices.racial, base_setup)?;
        let face = resolve_face_layer_with_palettes(&self.gender, &choices.body, |id, shade| {
            self.palette_for_shade(id, shade)
        })?;
        let mut appearance = body_base(&self.gender, &choices.body);
        appearance.overlay(&face.appearance);
        let nonhuman = !self.body_style_editable();
        let hair = if nonhuman {
            AppearanceTexturePair {
                current: 0,
                original: 0,
            }
        } else {
            texture_pair(&style.obj_desc, false)?
        };
        let head_object = if self.heritage == 6 {
            0
        } else {
            style
                .obj_desc
                .anim_part_changes
                .first()
                .context("barber style has no model substitution")?
                .part_id
        };
        let eye = &self
            .gender
            .eye_strip_list
            .get(choices.body.eyes as usize)
            .context("barber body has no eye strip")?;
        let eyes = if style.bald {
            &eye.obj_desc_bald
        } else {
            &eye.obj_desc
        };
        let face_pair = |strips: &[holtburger_dat::file_type::char_gen::FaceStrip],
                         index: u32|
         -> Result<AppearanceTexturePair> {
            texture_pair(
                &strips
                    .get(index as usize)
                    .context("barber body has no facial strip")?
                    .obj_desc,
                skeleton_setup(setup),
            )
        };
        let assets = BarberAppearanceAssets {
            base_palette: self.gender.base_palette,
            head_object,
            hair,
            eyes: texture_pair(eyes, skeleton_setup(setup))?,
            nose: face_pair(&self.gender.nose_strip_list, choices.body.nose)?,
            mouth: face_pair(&self.gender.mouth_strip_list, choices.body.mouth)?,
            skin_palette: face.skin_palette,
            hair_palette: face
                .hair_palette
                .context("barber body has no hair palette")?,
            eyes_palette: face
                .eyes_palette
                .context("barber body has no eye palette")?,
            setup,
            option1,
        };
        Ok(ResolvedBarberAppearance {
            appearance,
            assets,
            particles,
        })
    }

    fn shade_for_palette(&self, set: u32, palette: u32) -> Result<f64> {
        shade_for_palette(self.palette_set(set)?, palette)
            .with_context(|| format!("barber palette 0x{palette:08X} is not in set 0x{set:08X}"))
    }

    fn palette_for_shade(&self, set: u32, shade: f64) -> Result<u32> {
        self.palette_set(set)?
            .palette_id_for_shade(shade)
            .with_context(|| format!("barber palette set 0x{set:08X} cannot resolve shade {shade}"))
    }

    fn palette_set(&self, set: u32) -> Result<&PaletteSet> {
        self.palettes
            .get(&set)
            .with_context(|| format!("barber palette set 0x{set:08X} is not loaded"))
    }

    fn racial_from_assets(&self, assets: &BarberAppearanceAssets) -> Result<BarberRacialChoice> {
        let sex = self.gender_index;
        Ok(match self.heritage {
            9 => {
                ensure!(
                    assets.option1 <= 1,
                    "invalid Empyrean earthbound option {}",
                    assets.option1
                );
                BarberRacialChoice::Empyrean {
                    earthbound: assets.option1 == 1,
                }
            }
            11 => {
                ensure!(
                    UNDEAD_SETUPS.iter().any(|row| row[sex] == assets.setup),
                    "unknown Undead barber setup 0x{:08X}",
                    assets.setup
                );
                BarberRacialChoice::Undead {
                    flames: assets.setup == UNDEAD_SETUPS[0][sex]
                        || assets.setup == UNDEAD_SETUPS[2][sex],
                }
            }
            5 => {
                ensure!(
                    assets.setup == UMBRAEN_SETUPS[0][sex]
                        || assets.setup == UMBRAEN_SETUPS[1][sex]
                        || assets.setup == [0x02001972, 0x02001970][sex],
                    "unknown Umbraen barber setup 0x{:08X}",
                    assets.setup
                );
                BarberRacialChoice::Umbraen {
                    crown: assets.setup != UMBRAEN_SETUPS[1][sex],
                }
            }
            10 => {
                ensure!(
                    assets.setup == PENUMBRAEN_SETUPS[0][sex]
                        || assets.setup == PENUMBRAEN_SETUPS[1][sex]
                        || assets.setup == [0x02001971, 0x0200196D][sex],
                    "unknown Penumbraen barber setup 0x{:08X}",
                    assets.setup
                );
                BarberRacialChoice::Penumbraen {
                    crown: assets.setup != PENUMBRAEN_SETUPS[1][sex],
                }
            }
            _ => BarberRacialChoice::Standard,
        })
    }

    fn resolve_racial(
        &self,
        choice: &BarberRacialChoice,
        base_setup: u32,
    ) -> Result<(u32, u32, BarberParticleChange)> {
        let sex = self.gender_index;
        Ok(match (self.heritage, choice) {
            (9, BarberRacialChoice::Empyrean { earthbound }) => (
                base_setup,
                u32::from(*earthbound),
                BarberParticleChange::Preserve,
            ),
            (11, BarberRacialChoice::Undead { flames }) => {
                let zombie = UNDEAD_SETUPS[2..]
                    .iter()
                    .any(|row| row.contains(&base_setup));
                ensure!(
                    UNDEAD_SETUPS.iter().any(|row| row.contains(&base_setup)),
                    "unknown authored Undead style setup 0x{base_setup:08X}"
                );
                let row = usize::from(zombie) * 2 + usize::from(!flames);
                (
                    UNDEAD_SETUPS[row][sex],
                    0,
                    BarberParticleChange::Replace {
                        script: if *flames {
                            Some(UNDEAD_SCRIPTS[usize::from(zombie)][sex])
                        } else {
                            None
                        },
                    },
                )
            }
            (5, BarberRacialChoice::Umbraen { crown }) => {
                let row = usize::from(!crown);
                (
                    UMBRAEN_SETUPS[row][sex],
                    0,
                    BarberParticleChange::Replace {
                        script: Some(UMBRAEN_SCRIPTS[row][sex]),
                    },
                )
            }
            (10, BarberRacialChoice::Penumbraen { crown }) => (
                PENUMBRAEN_SETUPS[usize::from(!crown)][sex],
                0,
                BarberParticleChange::Replace {
                    script: if *crown {
                        Some(PENUMBRAEN_SCRIPTS[sex])
                    } else {
                        None
                    },
                },
            ),
            (5 | 9 | 10 | 11, _) => {
                bail!("barber racial option does not match the character's heritage")
            }
            (_, BarberRacialChoice::Standard) => (base_setup, 0, BarberParticleChange::Preserve),
            _ => bail!("this heritage has no barber racial option"),
        })
    }
}

/// Pick a deterministic shade within a palette bucket, including singleton and endpoint buckets.
fn shade_for_palette(palettes: &PaletteSet, palette: u32) -> Option<f64> {
    palettes
        .palette_ids
        .iter()
        .position(|id| *id == palette)
        .map(|index| (index as f64 + 0.5) / palettes.palette_ids.len() as f64)
}

/// Retail GenerateBaseAppearanceData (acclient.c:471165) selects texture 1 for skeleton faces.
fn skeleton_setup(setup: u32) -> bool {
    UNDEAD_SETUPS[..2].iter().any(|row| row.contains(&setup))
}

fn texture_pair(description: &ObjDesc, skeleton: bool) -> Result<AppearanceTexturePair> {
    let change = if skeleton && description.texture_changes.len() > 1 {
        &description.texture_changes[1]
    } else {
        description
            .texture_changes
            .first()
            .context("barber style has no texture substitution")?
    };
    Ok(AppearanceTexturePair {
        current: change.new_texture,
        original: change.old_texture,
    })
}

// Retail gmBarberUI::ListenToElementMessage, acclient.c:260170-260334, and initialized
// constants at acclient.c:44186-44216. Rows select the option; columns are male/female.
const UNDEAD_SETUPS: [[u32; 2]; 4] = [
    [0x02001A9C, 0x02001AA0],
    [0x02001A9E, 0x02001A9F],
    [0x02001A9D, 0x02001AA1],
    [0x02001A96, 0x02001AA2],
];
const UNDEAD_SCRIPTS: [[u32; 2]; 2] = [[0x330012D4, 0x330012D5], [0x330012D3, 0x330012D6]];
const UMBRAEN_SETUPS: [[u32; 2]; 2] = [[0x0200196F, 0x02001970], [0x02001A5F, 0x02001A5E]];
const UMBRAEN_SCRIPTS: [[u32; 2]; 2] = [[0x33001256, 0x33001257], [0x330012BB, 0x330012BA]];
const PENUMBRAEN_SETUPS: [[u32; 2]; 2] = [[0x0200196E, 0x0200196D], [0x02001A5D, 0x02001A5C]];
const PENUMBRAEN_SCRIPTS: [u32; 2] = [0x33001255, 0x33001254];

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::char_gen::{EyeStrip, FaceStrip, HairStyle};
    use holtburger_dat::file_type::material::{AnimationPartChange, TextureMapChange};

    const BASE_PALETTE: u32 = 0x0400_0100;
    const SKIN_SET: u32 = 0x0f00_0001;
    const HAIR_SET: u32 = 0x0f00_0002;
    const SKIN_LIGHT: u32 = 0x0400_0101;
    const SKIN_DARK: u32 = 0x0400_0102;
    const HAIR_LIGHT: u32 = 0x0400_0103;
    const HAIR_DARK: u32 = 0x0400_0104;
    const EYES: u32 = 0x0400_0105;
    const BODY_SETUP: u32 = 0x0200_0001;
    const HEAD: u32 = 0x0100_0100;
    const HAIR_TEXTURE: u32 = 0x0500_0100;

    fn description(texture: u32) -> ObjDesc {
        ObjDesc {
            texture_changes: vec![TextureMapChange {
                part_index: 16,
                old_texture: texture + 1,
                new_texture: texture,
            }],
            ..ObjDesc::empty()
        }
    }

    fn rules(heritage: u32, gender_index: usize, setup: u32) -> BarberAppearanceRules {
        let mut hair = description(HAIR_TEXTURE);
        hair.anim_part_changes.push(AnimationPartChange {
            part_index: 16,
            part_id: HEAD,
        });
        let mut alternate = hair.clone();
        alternate.texture_changes[0].new_texture += 2;
        let face = |texture| FaceStrip {
            icon_image: 0,
            obj_desc: description(texture),
        };
        BarberAppearanceRules {
            heritage,
            gender_index,
            gender: CharacterGenGender {
                name: "Synthetic body".into(),
                scale: 100,
                setup_id: setup,
                sound_table: 0,
                icon_image: 0,
                base_palette: BASE_PALETTE,
                skin_palette_set: SKIN_SET,
                physics_table: 0,
                motion_table: 0,
                combat_table: 0,
                base_obj_desc: ObjDesc::empty(),
                hair_color_list: vec![HAIR_SET],
                hair_style_list: vec![
                    HairStyle {
                        icon_image: 0,
                        bald: false,
                        alternate_setup: setup,
                        obj_desc: hair,
                    },
                    HairStyle {
                        icon_image: 0,
                        bald: true,
                        alternate_setup: setup,
                        obj_desc: alternate,
                    },
                ],
                eye_color_list: vec![EYES],
                eye_strip_list: vec![EyeStrip {
                    icon_image: 0,
                    icon_image_bald: 0,
                    obj_desc: description(HAIR_TEXTURE + 10),
                    obj_desc_bald: description(HAIR_TEXTURE + 20),
                }],
                nose_strip_list: vec![face(HAIR_TEXTURE + 30)],
                mouth_strip_list: vec![face(HAIR_TEXTURE + 40)],
                headgear_list: vec![],
                shirt_list: vec![],
                pants_list: vec![],
                footwear_list: vec![],
                clothing_colors_list: vec![],
            },
            palettes: BTreeMap::from([
                (
                    SKIN_SET,
                    PaletteSet {
                        id: SKIN_SET,
                        palette_ids: vec![SKIN_LIGHT, SKIN_DARK],
                    },
                ),
                (
                    HAIR_SET,
                    PaletteSet {
                        id: HAIR_SET,
                        palette_ids: vec![HAIR_LIGHT, HAIR_DARK],
                    },
                ),
            ]),
        }
    }

    fn choices(racial: BarberRacialChoice) -> BarberAppearanceChoices {
        BarberAppearanceChoices {
            body: BodyAppearanceChoices {
                eyes: 0,
                nose: 0,
                mouth: 0,
                hair_color: 0,
                eye_color: 0,
                hair_style: 0,
                skin_hue: 0.25,
                hair_hue: 0.75,
            },
            racial,
        }
    }

    #[test]
    fn forward_inverse_round_trip_uses_texture_pair_to_disambiguate_shared_heads() {
        let rules = rules(1, 0, BODY_SETUP);
        for style in 0..rules.gender.hair_style_list.len() {
            let mut original = choices(BarberRacialChoice::Standard);
            original.body.hair_style = style as u32;
            let resolved = rules.resolve(&original, &original).unwrap();
            let interpreted = rules
                .interpret(&resolved.assets, &resolved.appearance)
                .unwrap();
            assert_eq!(interpreted, original);
            assert_eq!(
                rules.resolve(&interpreted, &interpreted).unwrap().assets,
                resolved.assets
            );
            assert_eq!(resolved.assets.head_object, HEAD);
            assert_eq!(resolved.assets.skin_palette, SKIN_LIGHT);
            assert_eq!(resolved.assets.hair_palette, HAIR_DARK);
            let face = if style == 0 {
                &rules.gender.eye_strip_list[0].obj_desc
            } else {
                &rules.gender.eye_strip_list[0].obj_desc_bald
            };
            assert_eq!(resolved.assets.eyes, texture_pair(face, false).unwrap());
        }
    }

    #[test]
    fn ace_created_undead_face_variants_preserve_nondefault_choices() {
        for family in [UNDEAD_SETUPS[0], UNDEAD_SETUPS[2]] {
            for (sex, setup) in family.into_iter().enumerate() {
                let mut rules = rules(11, sex, setup);
                let add_variant = |description: &mut ObjDesc| {
                    let mut alternate = description.texture_changes[0].clone();
                    alternate.old_texture += 1000;
                    alternate.new_texture += 1000;
                    description.texture_changes.push(alternate);
                };
                let mut eye = rules.gender.eye_strip_list[0].clone();
                for description in [&mut eye.obj_desc, &mut eye.obj_desc_bald] {
                    add_variant(description);
                    for change in &mut description.texture_changes {
                        change.new_texture += 100;
                    }
                }
                rules.gender.eye_strip_list.push(eye);
                for strips in [
                    &mut rules.gender.nose_strip_list,
                    &mut rules.gender.mouth_strip_list,
                ] {
                    let mut strip = strips[0].clone();
                    add_variant(&mut strip.obj_desc);
                    for change in &mut strip.obj_desc.texture_changes {
                        change.new_texture += 100;
                    }
                    strips.push(strip);
                }
                for flames in [false, true] {
                    for hair_style in 0..2 {
                        let mut original = choices(BarberRacialChoice::Undead { flames });
                        original.body.eyes = 1;
                        original.body.nose = 1;
                        original.body.mouth = 1;
                        original.body.hair_style = hair_style;
                        let resolved = rules.resolve(&original, &original).unwrap();
                        let eye = &rules.gender.eye_strip_list[1];
                        let eyes = if hair_style == 0 {
                            &eye.obj_desc
                        } else {
                            &eye.obj_desc_bald
                        };
                        let mut opening = resolved.assets.clone();
                        // ACE PlayerFactory/SexCG always stores the first facial texture pair,
                        // including when the selected hair/body style uses a skeleton setup.
                        opening.eyes = texture_pair(eyes, false).unwrap();
                        opening.nose =
                            texture_pair(&rules.gender.nose_strip_list[1].obj_desc, false).unwrap();
                        opening.mouth =
                            texture_pair(&rules.gender.mouth_strip_list[1].obj_desc, false)
                                .unwrap();
                        let interpreted = rules.interpret(&opening, &resolved.appearance).unwrap();
                        assert_eq!(interpreted, original);
                        let canonical = rules.resolve(&interpreted, &interpreted).unwrap();
                        assert_eq!(canonical.assets, resolved.assets);
                        assert_eq!(canonical.appearance, resolved.appearance);
                        opening.eyes.original += 1;
                        assert!(rules.interpret(&opening, &resolved.appearance).is_err());
                    }
                }
            }
        }
    }

    #[test]
    fn palette_buckets_round_trip_endpoints_singletons_and_duplicate_ids() {
        for palette_ids in [
            vec![SKIN_LIGHT],
            vec![SKIN_LIGHT, SKIN_DARK],
            vec![SKIN_LIGHT, SKIN_LIGHT, SKIN_DARK],
        ] {
            let set = PaletteSet {
                id: SKIN_SET,
                palette_ids,
            };
            for palette in &set.palette_ids {
                let shade = shade_for_palette(&set, *palette).unwrap();
                assert_eq!(set.palette_id_for_shade(shade), Some(*palette));
            }
        }
    }

    #[test]
    fn disabled_nonhuman_styles_preserve_body_while_accepting_palette_edits() {
        for heritage in [6, 12, 13] {
            let rules = rules(heritage, 0, BODY_SETUP);
            assert!(!rules.body_style_editable());
            let original = choices(BarberRacialChoice::Standard);
            let mut edited = original.clone();
            edited.body.hair_style = 1;
            assert!(
                rules
                    .resolve(&original, &edited)
                    .unwrap_err()
                    .to_string()
                    .contains("body-style editing is unavailable")
            );
            edited = original.clone();
            edited.body.skin_hue = 0.75;
            let resolved = rules.resolve(&original, &edited).unwrap();
            assert_eq!(resolved.assets.skin_palette, SKIN_DARK);
            assert_eq!(
                resolved.assets.hair,
                AppearanceTexturePair {
                    current: 0,
                    original: 0
                }
            );
            if heritage == 6 {
                assert_eq!(resolved.assets.head_object, 0);
            }
            let mut opening = resolved.assets.clone();
            opening.head_object = 0;
            assert_eq!(
                rules
                    .interpret(&opening, &resolved.appearance)
                    .unwrap()
                    .body
                    .hair_style,
                original.body.hair_style
            );
        }
    }

    #[test]
    fn racial_setup_and_script_matrix_covers_both_sexes_and_undead_families() {
        for sex in 0..2 {
            for (family, setups) in [UNDEAD_SETUPS[0], UNDEAD_SETUPS[2]].iter().enumerate() {
                let mut rules = rules(11, sex, setups[sex]);
                // Skeleton facial strips select the second texture when authored.
                for strip in [
                    &mut rules.gender.nose_strip_list[0].obj_desc,
                    &mut rules.gender.mouth_strip_list[0].obj_desc,
                    &mut rules.gender.eye_strip_list[0].obj_desc,
                ] {
                    let mut alternate = strip.texture_changes[0].clone();
                    alternate.new_texture += 100;
                    strip.texture_changes.push(alternate);
                }
                for flames in [false, true] {
                    let original = choices(BarberRacialChoice::Undead { flames });
                    let resolved = rules.resolve(&original, &original).unwrap();
                    assert_eq!(
                        resolved.assets.setup,
                        UNDEAD_SETUPS[family * 2 + usize::from(!flames)][sex]
                    );
                    assert_eq!(
                        resolved.particles,
                        BarberParticleChange::Replace {
                            script: flames.then_some(UNDEAD_SCRIPTS[family][sex])
                        }
                    );
                    assert_eq!(
                        rules
                            .interpret(&resolved.assets, &resolved.appearance)
                            .unwrap(),
                        original
                    );
                }
            }
            for (heritage, setups, scripts) in [
                (
                    5,
                    UMBRAEN_SETUPS,
                    [Some(UMBRAEN_SCRIPTS[0][sex]), Some(UMBRAEN_SCRIPTS[1][sex])],
                ),
                (10, PENUMBRAEN_SETUPS, [Some(PENUMBRAEN_SCRIPTS[sex]), None]),
            ] {
                let rules = rules(heritage, sex, setups[0][sex]);
                for crown in [false, true] {
                    let original = choices(if heritage == 5 {
                        BarberRacialChoice::Umbraen { crown }
                    } else {
                        BarberRacialChoice::Penumbraen { crown }
                    });
                    let resolved = rules.resolve(&original, &original).unwrap();
                    assert_eq!(resolved.assets.setup, setups[usize::from(!crown)][sex]);
                    assert_eq!(
                        resolved.particles,
                        BarberParticleChange::Replace {
                            script: scripts[usize::from(!crown)]
                        }
                    );
                    assert_eq!(
                        rules
                            .interpret(&resolved.assets, &resolved.appearance)
                            .unwrap(),
                        original
                    );
                }
            }
        }
    }

    #[test]
    fn empyrean_changes_only_the_option_word_and_requires_the_matching_racial_contract() {
        let rules = rules(9, 0, BODY_SETUP);
        let original = choices(BarberRacialChoice::Empyrean { earthbound: false });
        let mut edited = original.clone();
        edited.racial = BarberRacialChoice::Empyrean { earthbound: true };
        let floating = rules.resolve(&original, &original).unwrap();
        let bound = rules.resolve(&original, &edited).unwrap();
        assert_eq!(bound.assets.option1, 1);
        assert_eq!(bound.appearance, floating.appearance);
        assert_eq!(bound.particles, BarberParticleChange::Preserve);
        edited.racial = BarberRacialChoice::Standard;
        assert!(rules.resolve(&original, &edited).is_err());
    }

    #[test]
    fn invalid_edits_and_unmapped_openings_are_explicit_errors() {
        let rules = rules(1, 0, BODY_SETUP);
        let original = choices(BarberRacialChoice::Standard);
        for shade in [f64::NAN, f64::INFINITY, -0.1, 1.1] {
            let mut edited = original.clone();
            edited.body.skin_hue = shade;
            assert!(rules.resolve(&original, &edited).is_err());
        }
        let resolved = rules.resolve(&original, &original).unwrap();
        let mut custom = resolved.assets.clone();
        custom.head_object = 0;
        assert!(
            rules
                .interpret(&custom, &resolved.appearance)
                .unwrap_err()
                .to_string()
                .contains("cannot map barber head")
        );
        custom = resolved.assets;
        custom.skin_palette = 0;
        assert!(
            rules
                .interpret(&custom, &resolved.appearance)
                .unwrap_err()
                .to_string()
                .contains("barber palette 0x00000000")
        );
    }
}
