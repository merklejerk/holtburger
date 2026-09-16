//! App-local spell reference projection and artwork selection over static content.

use std::{collections::HashSet, num::NonZeroU32};

use anyhow::{Result, ensure};
use holtburger_content::{
    spells::spell_reference,
    ui_assets::{UiAssetReader, UiAssets},
};
use holtburger_dat::file_type::SpellTable;
use holtburger_world::spell::SpellCastingRoute;
use serde::{Deserialize, Serialize};

use crate::{shared_host_content::SharedHostContent, ui_icons::UiIconSpec};

/// Bound reference work independently of PNG preparation batches.
pub const MAX_SPELL_REFERENCE_BATCH: usize = 128;

/// Ordered, unique spell identities; knowledge is deliberately not an input.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadSpellReferencesRequest {
    /// Nonzero identities queried in request order, with no duplicate work.
    pub spell_ids: Vec<u32>,
}

impl LoadSpellReferencesRequest {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.spell_ids.is_empty() && self.spell_ids.len() <= MAX_SPELL_REFERENCE_BATCH,
            "spell reference batch must contain 1..={MAX_SPELL_REFERENCE_BATCH} identities"
        );
        let mut seen = HashSet::new();
        for &id in &self.spell_ids {
            ensure!(id != 0, "spell identity must be nonzero");
            ensure!(seen.insert(id), "duplicate spell identity");
        }
        Ok(())
    }
}

/// Preserve the name even if a required icon mapping cannot be resolved.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SpellArtwork {
    Ready {
        /// Complete resolved recipe consumed by the shared icon repository.
        spec: UiIconSpec,
    },
    Failed {
        /// Bounded diagnostic preserved alongside the authored name.
        detail: String,
    },
}

/// Immutable authored inspection facts, independent of current character state.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellDetails {
    /// Shared ordinary-cast recipient selection, independent of authored recipient masks.
    pub casting_route: SpellCastingRoute,
    /// Static discovery classifications, independent of artwork.
    pub classification: holtburger_content::spells::classification::SpellClassification,
    /// Authored description.
    pub description: String,
    /// Authored school ID; unknown values remain distinguishable.
    pub school: u32,
    /// Base mana before economy adjustments.
    pub base_mana: u32,
    /// Additional mana per target.
    pub mana_per_target: u32,
    /// Positive authored duration, when applicable.
    pub duration_seconds: Option<f64>,
}

/// Exactly one result per requested spell identity.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SpellReferenceResult {
    Known {
        /// Stable identity, also suitable for future spell-bar bindings.
        id: u32,
        /// Authored name independent of image availability.
        name: String,
        /// Static examination facts, available even if artwork fails.
        details: SpellDetails,
        /// Resolved visual inputs or their explicit failure.
        artwork: SpellArtwork,
    },
    Missing {
        /// Keep a known player spell visible even when static content lacks it.
        id: u32,
    },
}

/// Validate before content work; reuse the host's cached parsed table.
pub fn load_spell_references(
    content: &SharedHostContent,
    request: &LoadSpellReferencesRequest,
) -> Result<Vec<SpellReferenceResult>> {
    request.validate()?;
    let table = content.spell_table()?;
    let mut assets = UiAssetReader::new(&content.repository);
    Ok(project_references(&table, &mut assets, &request.spell_ids))
}

fn project_references(
    table: &SpellTable,
    assets: &mut impl UiAssets,
    ids: &[u32],
) -> Vec<SpellReferenceResult> {
    ids.iter()
        .map(|&id| {
            let Some(spell) = spell_reference(table, id) else {
                return SpellReferenceResult::Missing { id };
            };
            let artwork =
                match spell_icon_spec(assets, spell.icon_id, spell.power_tier, spell.flags) {
                    Ok(spec) => SpellArtwork::Ready { spec },
                    Err(error) => SpellArtwork::Failed {
                        detail: error.to_string().chars().take(1024).collect(),
                    },
                };
            SpellReferenceResult::Known {
                id,
                name: spell.name.to_owned(),
                details: SpellDetails {
                    casting_route: SpellCastingRoute::from_decoded_formula(
                        spell.flags,
                        spell.components,
                    ),
                    classification: spell.classification,
                    description: spell.description.to_owned(),
                    school: spell.school,
                    base_mana: spell.base_mana,
                    mana_per_target: spell.mana_mod,
                    duration_seconds: spell.duration_seconds,
                },
                artwork,
            }
        })
        .collect()
}

fn spell_icon_spec(
    assets: &mut impl UiAssets,
    base: u32,
    tier: u32,
    flags: u32,
) -> Result<UiIconSpec> {
    let nonzero =
        |id| NonZeroU32::new(id).ok_or_else(|| anyhow::anyhow!("spell artwork identity is zero"));
    // ClientMagicSystem::CompositeSpellIcon, acclient.c:386851. Fellowship wins
    // over self-targeting; the measured 6,266-spell corpus has 138 with both flags.
    let overlay = if flags & 0x2000 != 0 {
        Some(4)
    } else if flags & 8 != 0 {
        Some(3)
    } else {
        None
    };
    Ok(UiIconSpec::Spell {
        base: nonzero(base)?,
        background: nonzero(assets.enum_did(0x10000006, tier)?)?,
        effects: nonzero(assets.enum_did(0x10000007, if flags & 0x10 != 0 { 1 } else { 2 })?)?,
        overlay: overlay
            .map(|entry| {
                assets
                    .enum_did(0x10000007, entry)
                    .map_err(anyhow::Error::from)
                    .and_then(nonzero)
            })
            .transpose()?,
    })
}

/// Component identity, authored name, and the complete image transform recipe.
#[derive(Debug, Serialize)]
pub struct SpellComponentReference {
    /// Formula component identity, not an item GUID.
    pub id: u32,
    /// Authored display name.
    pub name: String,
    /// Explicit image availability; missing art does not hide the name.
    pub artwork: SpellArtwork,
}

/// The measured component table has 163 entries; one lazy content lookup serves all inspectors.
pub fn load_spell_components(content: &SharedHostContent) -> Result<Vec<SpellComponentReference>> {
    let table = holtburger_content::spells::spell_components(&content.repository)?;
    let mut references: Vec<_> = table
        .components
        .into_iter()
        .map(|(id, component)| {
            let artwork = match NonZeroU32::new(component.icon) {
                Some(base) => SpellArtwork::Ready {
                    spec: UiIconSpec::SpellComponent { base },
                },
                None => SpellArtwork::Failed {
                    detail: "Component artwork identity is zero".into(),
                },
            };
            SpellComponentReference {
                id,
                name: component.name,
                artwork,
            }
        })
        .collect();
    references.sort_by_key(|reference| reference.id);
    Ok(references)
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::{
        spells::classification::SpellRecipientAssociation,
        ui_assets::{UiAssetError, UiImage},
    };
    use holtburger_dat::file_type::spell_table::SpellBase;
    use holtburger_world::spell::SpellInfo;
    use std::{collections::HashMap, sync::Arc};

    struct Mappings;
    impl UiAssets for Mappings {
        fn enum_did(&mut self, group: u32, entry: u32) -> Result<u32, UiAssetError> {
            if entry == 0 {
                return Err(UiAssetError::MissingMapping {
                    mapper: group,
                    entry,
                });
            }
            Ok((group & 0xff) * 100 + entry)
        }
        fn image(&mut self, id: u32) -> Result<Arc<UiImage>, UiAssetError> {
            Err(UiAssetError::MissingAsset { id })
        }
    }

    #[test]
    fn shared_command_and_reference_wire_match_the_frontend_contract() {
        let command: crate::protocol::HostCommand = serde_json::from_value(serde_json::json!({
            "command":"load_spell_references", "request":{"spellIds":[1]}
        }))
        .unwrap();
        assert!(matches!(command, crate::protocol::HostCommand::Shared(
            crate::shared_host_content::SharedContentCommand::LoadSpellReferences {request}
        ) if request.spell_ids == vec![1]));
        let reference = SpellReferenceResult::Known {
            id: 1,
            name: "Spell".into(),
            details: SpellDetails {
                casting_route: SpellCastingRoute::Untargeted,
                classification: holtburger_content::spells::classification::classify(
                    1,
                    &holtburger_dat::file_type::spell_table::SpellBase::default(),
                ),
                description: "Description".into(),
                school: 3,
                base_mana: 10,
                mana_per_target: 2,
                duration_seconds: Some(60.0),
            },
            artwork: SpellArtwork::Ready {
                spec: spell_icon_spec(&mut Mappings, 1, 10, 0x2008).unwrap(),
            },
        };
        assert_eq!(
            serde_json::to_value(reference).unwrap(),
            serde_json::json!({
                "kind":"known", "id":1, "name":"Spell",
                "details":{"castingRoute":"untargeted","classification":{"beneficial":false,"level":null,"recipient":null,"fellowship":false,"damage":null},"description":"Description", "school":3, "baseMana":10, "manaPerTarget":2, "durationSeconds":60.0}, "artwork": {
                    "kind":"ready", "spec":{"kind":"spell", "base":1,"background":610,"effects":702,"overlay":704}
                }
            })
        );
    }

    #[test]
    fn resolves_complete_visual_inputs_with_fellowship_precedence() {
        for (flags, effect, overlay) in [
            (0, 702, None),
            (8, 702, Some(703)),
            (0x10, 701, None),
            (0x2008, 702, Some(704)),
        ] {
            assert_eq!(
                spell_icon_spec(&mut Mappings, 1, 10, flags).unwrap(),
                UiIconSpec::Spell {
                    base: NonZeroU32::new(1).unwrap(),
                    background: NonZeroU32::new(610).unwrap(),
                    effects: NonZeroU32::new(effect).unwrap(),
                    overlay: overlay.and_then(NonZeroU32::new),
                }
            );
        }
    }

    #[test]
    fn reference_routes_match_casting_despite_authored_recipient_disagreements() {
        // Synthetic decoded formulas exercise both directions of the observed
        // Frost Blast / Flame Wave disagreement, plus self-first precedence.
        for (flags, mask, components, route, recipient) in [
            (
                0,
                0,
                [1, 1, 1, 1, 0x31, 0, 0, 0],
                SpellCastingRoute::SelectedTarget,
                None,
            ),
            (
                0,
                16,
                [1, 1, 1, 1, 0x3a, 0, 0, 0],
                SpellCastingRoute::Untargeted,
                Some(SpellRecipientAssociation::Creature),
            ),
            (
                8,
                16,
                [0; 8],
                SpellCastingRoute::SelfTarget,
                Some(SpellRecipientAssociation::Creature),
            ),
            (
                0,
                6,
                [1, 1, 1, 1, 0x39, 0, 0, 0],
                SpellCastingRoute::SelectedTarget,
                Some(SpellRecipientAssociation::Item),
            ),
        ] {
            let definition = SpellBase {
                bitfield: flags,
                non_component_target_type: mask,
                components,
                ..SpellBase::default()
            };
            let casting_spell = SpellInfo::from(definition.clone());
            let table = SpellTable {
                id: SpellTable::FILE_ID,
                spells: HashMap::from([(1, definition)]),
                spell_sets: HashMap::new(),
            };
            let results = project_references(&table, &mut Mappings, &[1]);
            let SpellReferenceResult::Known { details, .. } = &results[0] else {
                panic!("Present spell definition must produce reference details");
            };
            assert_eq!(details.casting_route, route);
            assert_eq!(details.casting_route, casting_spell.casting_route());
            assert_eq!(details.classification.recipient, recipient);
        }
    }

    #[test]
    fn preserves_names_when_artwork_fails_and_reports_missing_definitions() {
        let table = SpellTable {
            id: SpellTable::FILE_ID,
            spells: HashMap::from([(
                1,
                SpellBase {
                    name: "Known spell".into(),
                    icon_id: 1,
                    ..SpellBase::default()
                },
            )]),
            spell_sets: HashMap::new(),
        };
        let results = project_references(&table, &mut Mappings, &[1, 2]);
        assert!(
            matches!(&results[0],SpellReferenceResult::Known {name,artwork:SpellArtwork::Failed {detail},..} if name=="Known spell" && detail.contains("no entry"))
        );
        assert!(matches!(
            &results[1],
            SpellReferenceResult::Missing { id: 2 }
        ));
    }

    #[test]
    fn rejects_empty_duplicate_zero_and_oversized_requests() {
        for spell_ids in [
            vec![],
            vec![1, 1],
            vec![0],
            vec![1; MAX_SPELL_REFERENCE_BATCH + 1],
        ] {
            assert!(LoadSpellReferencesRequest { spell_ids }.validate().is_err());
        }
        assert!(
            LoadSpellReferencesRequest {
                spell_ids: vec![1, 2]
            }
            .validate()
            .is_ok()
        );
    }
}
