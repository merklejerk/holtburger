//! Character-bound spell examination, independent of panel lifetime and membership.

use super::{ClientRuntime, ClientViewEvent};
use holtburger_common::Guid;
use holtburger_world::{
    spell::{MagicSchool, formula, spellbook_range_metres},
    stats::SkillType,
};
use serde::{Deserialize, Serialize};

/// Caller correlation identity and stable spell identity. No casting action is implied.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpellInspectionQuery {
    /// Consumer-owned sequence, echoed even for unavailable results.
    pub sequence: u32,
    /// Requested definition, independent of known spell membership.
    pub spell_id: u32,
}

/// Cold authority context token; a new token retires previous inspection results.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellInspectionContext {
    /// Monotonic token for relevant character inputs within this runtime.
    pub revision: u64,
    /// Character with an accepted initial description, or no baseline yet.
    pub player: Option<Guid>,
}

/// A correlated inspection reply evaluated against exactly one context token.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellInspectionResult {
    /// Consumer query identity.
    pub sequence: u32,
    /// Stable definition identity.
    pub spell_id: u32,
    /// Context used for evaluation.
    pub context: SpellInspectionContext,
    /// Explicit availability instead of a fabricated range.
    pub outcome: SpellInspectionOutcome,
}

/// Runtime facts are never stored in the static content-reference cache.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SpellInspectionOutcome {
    /// Character description or necessary skill records are not available.
    Pending,
    /// Parsed content has no requested definition.
    Missing,
    /// Retail inspection and ordinary spellbook casting share this distance limit.
    Ready {
        /// Shared retail examination and spellbook casting range.
        range_metres: f32,
        /// Formula can await inventory independently of range readiness.
        formula: SpellFormulaResult,
    },
}

/// Applicable ordered slots, pending character inputs, or a diagnosed formula failure.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SpellFormulaResult {
    /// Required character or inventory facts are still absent.
    Pending,
    /// Ordered retail formula slots, including trailing zeros.
    Ready { components: [u32; 8] },
    /// Source data cannot produce a valid formula.
    Failed { detail: String },
}

/// Semantic inputs whose changes retire character-bound inspection results.
#[derive(Debug, PartialEq, Eq)]
struct InspectionInputs {
    /// Character baseline identity.
    player: Guid,
    /// Ranks and initial bonus for each magic school.
    skills: [Option<(u32, u32)>; 5],
    /// Per-school ownership or augmentation route, with unresolved roster facts explicit.
    foci: [Option<bool>; 5],
    /// Legacy account personalization seed or an encoding diagnostic.
    account_hash: Result<u32, String>,
}

/// Retained comparison inputs suppress invalidation from unrelated world events.
#[derive(Debug, Default)]
pub(super) struct SpellInspectionState {
    revision: u64,
    inputs: Option<InspectionInputs>,
}

fn account_formula_hash(account: &str) -> Result<u32, String> {
    if account.is_empty() {
        return Err("Account identity is unavailable for spell formula.".into());
    }
    let (bytes, _, errors) = encoding_rs::WINDOWS_1252.encode(account);
    if errors || bytes.contains(&0) {
        return Err("Account identity cannot be encoded for spell formula.".into());
    }
    Ok(holtburger_common::legacy_hash::legacy_string_hash(&bytes))
}

impl ClientRuntime {
    pub(super) fn refresh_spell_inspection_context(&mut self) {
        let inputs = self
            .described_character
            .filter(|guid| *guid == self.world.player.guid)
            .map(|guid| InspectionInputs {
                player: guid,
                skills: [
                    SkillType::WarMagic,
                    SkillType::LifeMagic,
                    SkillType::ItemEnchantment,
                    SkillType::CreatureEnchantment,
                    SkillType::VoidMagic,
                ]
                .map(|kind| {
                    self.world
                        .player
                        .skills
                        .get(&kind)
                        .map(|skill| (skill.init, skill.ranks))
                }),
                foci: [
                    MagicSchool::WarMagic,
                    MagicSchool::LifeMagic,
                    MagicSchool::ItemEnchantment,
                    MagicSchool::CreatureEnchantment,
                    MagicSchool::VoidMagic,
                ]
                .map(|school| formula::has_foci(&self.world, school)),
                account_hash: account_formula_hash(&self.character_selection.account_name),
            });
        if self.spell_inspection.inputs != inputs {
            self.spell_inspection.inputs = inputs;
            self.spell_inspection.revision += 1;
            self.emit_spell_inspection_context();
        }
    }

    fn spell_inspection_context(&self) -> SpellInspectionContext {
        SpellInspectionContext {
            revision: self.spell_inspection.revision,
            player: self
                .spell_inspection
                .inputs
                .as_ref()
                .map(|inputs| inputs.player),
        }
    }

    pub(super) fn emit_spell_inspection_context(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::SpellInspectionContext(
                self.spell_inspection_context(),
            ));
    }

    fn inspect_spell_formula(
        &self,
        spell: &holtburger_world::spell::SpellInfo,
    ) -> SpellFormulaResult {
        let Some(inputs) = &self.spell_inspection.inputs else {
            return SpellFormulaResult::Pending;
        };
        let result = match formula::has_foci(&self.world, spell.school) {
            None => return SpellFormulaResult::Pending,
            Some(true) => Ok(formula::foci(spell.components)),
            Some(false) => match &inputs.account_hash {
                Ok(hash) => formula::customize(spell.components, spell.formula_version, *hash),
                Err(detail) => {
                    return SpellFormulaResult::Failed {
                        detail: detail.clone(),
                    };
                }
            },
        };
        match result {
            Ok(components) => SpellFormulaResult::Ready { components },
            Err(error) => SpellFormulaResult::Failed {
                detail: error.to_string(),
            },
        }
    }

    pub(super) fn query_spell_inspection(&mut self, query: SpellInspectionQuery) {
        self.refresh_spell_inspection_context();
        let context = self.spell_inspection_context();
        let outcome = match (context.player, self.world.spell_catalog.get(query.spell_id)) {
            (None, _) => SpellInspectionOutcome::Pending,
            (Some(_), None) => SpellInspectionOutcome::Missing,
            (Some(_), Some(spell)) => {
                match spellbook_range_metres(spell, &self.world.player.skills) {
                    Some(range_metres) => SpellInspectionOutcome::Ready {
                        range_metres,
                        formula: self.inspect_spell_formula(spell),
                    },
                    None => SpellInspectionOutcome::Pending,
                }
            }
        };
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::SpellInspectionResult(
                SpellInspectionResult {
                    sequence: query.sequence,
                    spell_id: query.spell_id,
                    context,
                    outcome,
                },
            ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{ClientState, builder::build_test_client};

    #[test]
    fn context_changes_only_for_relevant_inputs_and_retires_character_baselines() {
        let mut client = build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        client.refresh_spell_inspection_context();
        assert!(events.try_recv().is_err());
        client.world.player.guid = Guid(1);
        client.described_character = Some(Guid(1));
        client.refresh_spell_inspection_context();
        let initial = client.spell_inspection_context();
        assert_eq!(initial.player, Some(Guid(1)));
        assert!(matches!(
            events.try_recv(),
            Ok(ClientViewEvent::SpellInspectionContext(_))
        ));
        client.refresh_spell_inspection_context();
        assert!(events.try_recv().is_err());
        client.query_spell_inspection(SpellInspectionQuery {
            sequence: 7,
            spell_id: 123,
        });
        assert!(matches!(
            events.try_recv(),
            Ok(ClientViewEvent::SpellInspectionResult(
                SpellInspectionResult {
                    sequence: 7,
                    outcome: SpellInspectionOutcome::Missing,
                    ..
                }
            ))
        ));
        client.described_character = None;
        client.refresh_spell_inspection_context();
        assert!(client.spell_inspection_context().revision > initial.revision);
        assert_eq!(client.spell_inspection_context().player, None);
        client.described_character = Some(Guid(1));
        client.refresh_spell_inspection_context();
        assert!(client.spell_inspection_context().revision > initial.revision + 1);
    }
}
