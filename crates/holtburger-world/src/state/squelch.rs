//! Character-owned ignore facts and shared scope/category interpretation.

use holtburger_common::Guid;
use holtburger_protocol::messages::squelch::{SetSquelchDbEventData, SquelchInfo};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Target scope; the owning player's list always belongs to one character.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SquelchScope {
    /// Every character on the target account.
    Account,
    /// Only the named target character.
    Character,
}

/// Coverage of the retained category bitset, including unfamiliar categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SquelchCoverage {
    /// No category bits are set.
    None,
    /// All 128 retail category bits are set.
    All,
    /// Some category bits are set; distinct from an all-channel character ignore.
    Partial,
}

/// Lossless category words; interpretation belongs here, not to each frontend.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SquelchFilter {
    /// Consecutive words, with unknown bits and trailing words retained.
    pub words: Vec<u32>,
}
impl SquelchFilter {
    /// Retail tests all 128 bits for AllChannels, not just the first mask word
    /// (acclient.c:678831, vlong::bit at 453450).
    pub fn coverage(&self) -> SquelchCoverage {
        if self.words.iter().all(|word| *word == 0) {
            SquelchCoverage::None
        } else if self.words.len() >= 4 && self.words[..4].iter().all(|word| *word == u32::MAX) {
            SquelchCoverage::All
        } else {
            SquelchCoverage::Partial
        }
    }
}

/// A merged server record; an account flag does not erase character categories.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SquelchRecord {
    /// Server-resolved representative character name, also used for account removal.
    pub name: String,
    /// Restriction affecting all characters of the represented account.
    pub account: bool,
    /// Character categories, or the account's all-channel representation.
    pub filter: SquelchFilter,
}
impl From<&SquelchInfo> for SquelchRecord {
    fn from(info: &SquelchInfo) -> Self {
        Self {
            name: info.name.clone(),
            account: info.account,
            filter: SquelchFilter {
                words: info.words.clone(),
            },
        }
    }
}
/// Shared facts needed by basic ignore management; computed together from one record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SquelchManagement {
    /// Coverage of character categories, distinct from the account flag.
    pub coverage: SquelchCoverage,
    /// Scope represented as a basic all-channel ignore; partial character filters differ.
    pub removal_scope: Option<SquelchScope>,
}
impl SquelchRecord {
    /// Account records with all bits cannot prove a separate character restriction
    /// exists. Account removal reveals any retained character entry in the next DB.
    pub fn management(&self) -> SquelchManagement {
        let coverage = self.filter.coverage();
        let removal_scope = if self.account {
            Some(SquelchScope::Account)
        } else if coverage == SquelchCoverage::All {
            Some(SquelchScope::Character)
        } else {
            None
        };
        SquelchManagement {
            coverage,
            removal_scope,
        }
    }
}

/// Complete retained database; Some(empty) is established at initial character entry.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SquelchState {
    /// Legacy table with uncertain key identity; retained and disclosed read-only.
    pub accounts: BTreeMap<String, Guid>,
    /// Merged account and character records keyed by representative identity.
    pub characters: BTreeMap<Guid, SquelchRecord>,
    /// Global record retained losslessly, including metadata.
    pub globals: SquelchRecord,
}
impl From<&SetSquelchDbEventData> for SquelchState {
    fn from(db: &SetSquelchDbEventData) -> Self {
        Self {
            accounts: db.accounts.iter().cloned().collect(),
            characters: db
                .characters
                .iter()
                .map(|(guid, info)| (*guid, info.into()))
                .collect(),
            globals: (&db.globals).into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn squelch_category_coverage_and_scope_do_not_flatten_words() {
        for (words, expected) in [
            (vec![], SquelchCoverage::None),
            (vec![0; 5], SquelchCoverage::None),
            (vec![u32::MAX], SquelchCoverage::Partial),
            (vec![u32::MAX; 4], SquelchCoverage::All),
            (vec![0, 1], SquelchCoverage::Partial),
            (vec![0, 0, 0, 0, 1], SquelchCoverage::Partial),
        ] {
            let filter = SquelchFilter { words };
            assert_eq!(filter.coverage(), expected);
        }
        let mut merged = SquelchRecord {
            account: true,
            filter: SquelchFilter {
                words: vec![8, 8, 8, 8],
            },
            name: "Amy".into(),
        };
        assert_eq!(
            merged.management().removal_scope,
            Some(SquelchScope::Account)
        );
        merged.account = false;
        assert_eq!(merged.management().removal_scope, None);
        merged.filter.words = vec![u32::MAX; 4];
        assert_eq!(
            merged.management().removal_scope,
            Some(SquelchScope::Character)
        );
    }
    #[test]
    fn squelch_replacements_retain_overlap_and_unknown_data() {
        let db = SetSquelchDbEventData {
            accounts: vec![("legacy".into(), Guid(12))],
            characters: vec![(
                Guid(10),
                SquelchInfo {
                    account: true,
                    name: "Amy".into(),
                    words: vec![8, 0, 1, 0, 0x80000000],
                },
            )],
            globals: SquelchInfo {
                name: "metadata".into(),
                account: false,
                words: vec![0, 1],
            },
            ..Default::default()
        };
        let mut world = crate::WorldState::synthetic();
        let event = |db| holtburger_protocol::messages::GameEventMessage {
            target: Guid(1),
            sequence: 1,
            event: holtburger_protocol::messages::GameEvent::SetSquelchDb(Box::new(db)),
        };
        let mut events = vec![];
        assert!(crate::handlers::squelch::handle_event(
            &mut world,
            &event(db.clone()),
            &mut events
        ));
        let state = world.squelch.as_ref().unwrap();
        assert_eq!(
            state.characters[&Guid(10)].filter.words,
            db.characters[0].1.words
        );
        assert_eq!(state.globals.name, "metadata");
        assert_eq!(state.accounts["legacy"], Guid(12));
        assert!(matches!(events[0], crate::WorldEvent::SquelchStateUpdated));
        crate::handlers::squelch::handle_event(
            &mut world,
            &event(SetSquelchDbEventData::default()),
            &mut events,
        );
        assert_eq!(world.squelch, Some(SquelchState::default()));
    }
}
