//! App-local spell artwork selection over shared static reference data.

use std::{collections::HashSet, num::NonZeroU32};

use anyhow::{Result, ensure};
use holtburger_content::{
    spells::spell_reference,
    ui_assets::{UiAssetReader, UiAssets},
};
use holtburger_dat::file_type::SpellTable;
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

/// Exactly one result per requested spell identity.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SpellReferenceResult {
    Known {
        /// Stable identity, also suitable for future spell-bar bindings.
        id: u32,
        /// Authored name independent of image availability.
        name: String,
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

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::ui_assets::{UiAssetError, UiImage};
    use holtburger_dat::file_type::spell_table::SpellBase;
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
            artwork: SpellArtwork::Ready {
                spec: spell_icon_spec(&mut Mappings, 1, 10, 0x2008).unwrap(),
            },
        };
        assert_eq!(
            serde_json::to_value(reference).unwrap(),
            serde_json::json!({
                "kind":"known", "id":1, "name":"Spell", "artwork": {
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
