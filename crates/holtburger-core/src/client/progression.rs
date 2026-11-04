//! Session-scoped admission for character advancement requests.
//!
//! A guard suppresses a second request for the same target state. It is not a
//! transaction receipt: only server-authored training/rank/XP changes release it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};

use holtburger_common::Guid;
use holtburger_world::WorldState;
use holtburger_world::progression::{
    ProgressionIntent, ProgressionQuote, ProgressionTargetState, ProgressionUnavailable, StatTarget,
};
use serde::{Deserialize, Serialize};

static NEXT_SCOPE_ID: AtomicU32 = AtomicU32::new(1);

fn next_scope_id() -> u32 {
    let id = NEXT_SCOPE_ID.fetch_add(1, Ordering::Relaxed);
    assert_ne!(id, 0, "progression quote scope identity exhausted");
    id
}

/// A world quote bound to one character-entry scope and its reference data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientProgressionQuote {
    /// Identity replaced on reconnect, character change, or world re-entry.
    pub scope_id: u32,
    /// Exact world consequence displayed to the player.
    pub quote: ProgressionQuote,
}

/// Why a quote cannot currently be offered for one intent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientProgressionUnavailable {
    /// Character description or active world entry is not complete.
    CharacterNotReady,
    /// An earlier spend against these target fields awaits an authoritative change.
    AwaitingTargetUpdate,
    /// World facts or resources make this intent unavailable.
    World(ProgressionUnavailable),
}

/// One requested intent and its current quote or typed unavailable reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientProgressionEvaluation {
    /// Intent supplied by the frontend, returned even for unavailable quotes.
    pub intent: ProgressionIntent,
    /// Current shared evaluation within the active character-entry scope.
    pub result: Result<ClientProgressionQuote, ClientProgressionUnavailable>,
}

/// Why a previously displayed quote cannot be submitted now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientProgressionRejection {
    /// No fully described in-world character may spend resources now.
    CharacterNotReady,
    /// Quote came from a retired character-entry scope.
    WrongScope,
    /// Quote belongs to a different or no longer active character.
    WrongCharacter,
    /// A request for these target fields was already sent.
    AwaitingTargetUpdate,
    /// Current world facts no longer permit this intent.
    Unavailable(ProgressionUnavailable),
    /// Its spend, resulting rank, balance, or target fields changed.
    StaleQuote,
}

/// Local dispatch feedback; `Submitted` never claims server purchase success.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientProgressionFeedback {
    Submitted {
        /// Target whose existing state is now guarded against repeat sends.
        target: StatTarget,
    },
    Rejected {
        /// Requested advancement that was not sent.
        intent: ProgressionIntent,
        /// Current reason it was rejected locally.
        reason: ClientProgressionRejection,
    },
    DispatchFailed {
        /// Attempted advancement whose transport outcome is ambiguous.
        intent: ProgressionIntent,
        /// Underlying session send error for user-visible reporting.
        message: String,
    },
}

/// One character-entry scope's independent target guards and quote identity.
#[derive(Debug)]
pub struct ProgressionState {
    scope_id: u32,
    character: Guid,
    pending: HashMap<StatTarget, ProgressionTargetState>,
}

impl Default for ProgressionState {
    fn default() -> Self {
        Self {
            scope_id: next_scope_id(),
            character: Guid::NULL,
            pending: HashMap::new(),
        }
    }
}

impl ProgressionState {
    /// Clear submissions at a character-entry boundary before the old world is replaced.
    pub fn clear(&mut self) -> bool {
        let changed = !self.pending.is_empty();
        self.pending.clear();
        self.character = Guid::NULL;
        self.scope_id = next_scope_id();
        changed
    }

    /// Release only guards whose target fields or character changed authoritatively.
    pub fn reconcile(&mut self, world: &WorldState) -> bool {
        if self.character != world.player.guid {
            let changed = !self.pending.is_empty();
            self.pending.clear();
            self.character = world.player.guid;
            self.scope_id = next_scope_id();
            return changed;
        }
        let before = self.pending.len();
        self.pending.retain(|target, submitted| {
            world.progression_target_state(*target) == Some(*submitted)
        });
        self.pending.len() != before
    }

    /// Return currently guarded targets in stable type/identifier order.
    pub fn guarded_targets(&self, world: &WorldState) -> Vec<StatTarget> {
        let mut targets: Vec<_> = self
            .pending
            .iter()
            .filter_map(|(target, submitted)| {
                (self.character == world.player.guid
                    && world.progression_target_state(*target) == Some(*submitted))
                .then_some(*target)
            })
            .collect();
        targets.sort_by_key(|target| match target {
            StatTarget::Attribute(value) => (0, *value as u32),
            StatTarget::Vital(value) => (1, *value as u32),
            StatTarget::Skill(value) => (2, *value as u32),
        });
        targets
    }

    /// Quote against current authority, suppressing a target already awaiting an update.
    pub fn quote(
        &mut self,
        world: &WorldState,
        intent: ProgressionIntent,
    ) -> Result<ClientProgressionQuote, ClientProgressionUnavailable> {
        self.reconcile(world);
        let target = intent.target();
        if self.guarded_targets(world).contains(&target) {
            return Err(ClientProgressionUnavailable::AwaitingTargetUpdate);
        }
        let quote = world
            .evaluate_progression(intent)
            .map_err(ClientProgressionUnavailable::World)?;
        Ok(ClientProgressionQuote {
            scope_id: self.scope_id,
            quote,
        })
    }

    /// Re-evaluate the exact displayed consequence before dispatch.
    pub fn validate(
        &mut self,
        world: &WorldState,
        submitted: ClientProgressionQuote,
    ) -> Result<ProgressionQuote, ClientProgressionRejection> {
        use ClientProgressionRejection as Rejection;
        self.reconcile(world);
        if submitted.scope_id != self.scope_id {
            return Err(Rejection::WrongScope);
        }
        if submitted.quote.character != world.player.guid || world.player.guid == Guid::NULL {
            return Err(Rejection::WrongCharacter);
        }
        let target = submitted.quote.intent.target();
        if self.pending.contains_key(&target) {
            return Err(Rejection::AwaitingTargetUpdate);
        }
        let current = world
            .evaluate_progression(submitted.quote.intent)
            .map_err(Rejection::Unavailable)?;
        if submitted.quote != current {
            return Err(Rejection::StaleQuote);
        }
        Ok(current)
    }

    /// Claim one target state immediately before the wire action is attempted.
    pub fn guard(&mut self, quote: ProgressionQuote) {
        self.character = quote.character;
        self.pending
            .insert(quote.intent.target(), quote.target_state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{PropertyInt64, WorldObjectPropertyAccessorsMut};
    use holtburger_dat::file_type::XpTable;
    use holtburger_world::stats::{Attribute, AttributeType, Skill, SkillType, TrainingLevel};
    use std::sync::Arc;

    fn world_with_two_attributes() -> WorldState {
        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(Guid(0x5000_0001), "Player", WorldPosition::default());
        world
            .player_entity_mut()
            .expect("seeded player")
            .properties
            .set_int64_prop(PropertyInt64::AvailableExperience, 500);
        world.xp_table = Arc::new(XpTable {
            attribute_xp_list: vec![0, 100, 300, 600],
            ..XpTable::default()
        });
        for attribute in [AttributeType::StrengthAttr, AttributeType::EnduranceAttr] {
            world.player.attributes.insert(
                attribute,
                Attribute {
                    attr_type: attribute,
                    ranks: 1,
                    start: 10,
                    spent_xp: 100,
                    next_rank_xp: Some(300),
                    base: 11,
                    current: 11,
                    breakdown: Default::default(),
                },
            );
        }
        world
    }

    fn raise(attribute: AttributeType) -> ProgressionIntent {
        ProgressionIntent::Raise {
            target: StatTarget::Attribute(attribute),
            ranks: 1,
        }
    }

    #[test]
    fn same_target_waits_for_target_change_while_other_targets_remain_available() {
        let mut world = world_with_two_attributes();
        let mut state = ProgressionState::default();
        let strength = raise(AttributeType::StrengthAttr);
        let endurance = raise(AttributeType::EnduranceAttr);
        let quote = state.quote(&world, strength).unwrap();
        let validated = state.validate(&world, quote).unwrap();
        state.guard(validated);

        assert_eq!(
            state.quote(&world, strength),
            Err(ClientProgressionUnavailable::AwaitingTargetUpdate)
        );
        assert_eq!(
            state.quote(
                &world,
                ProgressionIntent::Raise {
                    target: strength.target(),
                    ranks: 10,
                },
            ),
            Err(ClientProgressionUnavailable::AwaitingTargetUpdate)
        );
        assert_eq!(
            state.validate(&world, quote),
            Err(ClientProgressionRejection::AwaitingTargetUpdate)
        );
        assert!(state.quote(&world, endurance).is_ok());

        world
            .player_entity_mut()
            .unwrap()
            .properties
            .set_int64_prop(PropertyInt64::AvailableExperience, 300);
        assert!(!state.reconcile(&world));
        assert_eq!(state.guarded_targets(&world), vec![strength.target()]);

        let attribute = world
            .player
            .attributes
            .get_mut(&AttributeType::StrengthAttr)
            .unwrap();
        attribute.current = 15;
        assert!(!state.reconcile(&world));
        assert_eq!(state.guarded_targets(&world), vec![strength.target()]);

        world
            .player
            .attributes
            .get_mut(&AttributeType::StrengthAttr)
            .unwrap()
            .spent_xp = 150;
        assert!(state.reconcile(&world));
        assert!(state.guarded_targets(&world).is_empty());

        let renewed = state.quote(&world, strength).unwrap();
        state.guard(renewed.quote);
        let attribute = world
            .player
            .attributes
            .get_mut(&AttributeType::StrengthAttr)
            .unwrap();
        attribute.ranks = 2;
        attribute.spent_xp = 300;
        assert!(state.reconcile(&world));
        assert!(state.guarded_targets(&world).is_empty());
        assert!(state.quote(&world, strength).is_ok());
    }

    #[test]
    fn balance_and_character_entry_changes_invalidate_a_displayed_quote() {
        let mut world = world_with_two_attributes();
        let mut state = ProgressionState::default();
        let intent = raise(AttributeType::StrengthAttr);
        let quote = state.quote(&world, intent).unwrap();
        world
            .player_entity_mut()
            .unwrap()
            .properties
            .set_int64_prop(PropertyInt64::AvailableExperience, 400);
        assert_eq!(
            state.validate(&world, quote),
            Err(ClientProgressionRejection::StaleQuote)
        );

        let retired_quote = ProgressionState::default().quote(&world, intent).unwrap();
        assert_eq!(
            state.validate(&world, retired_quote),
            Err(ClientProgressionRejection::WrongScope)
        );
        let current_quote = state.quote(&world, intent).unwrap();
        state.clear();
        assert_eq!(
            state.validate(&world, current_quote),
            Err(ClientProgressionRejection::WrongScope)
        );
        let current_quote = state.quote(&world, intent).unwrap();
        world.seed_local_player_entity(Guid(0x5000_0002), "Replacement", WorldPosition::default());
        assert_eq!(
            state.validate(&world, current_quote),
            Err(ClientProgressionRejection::WrongScope)
        );
    }

    #[test]
    fn training_state_change_releases_only_its_skill_guard() {
        let mut world = world_with_two_attributes();
        let skill = SkillType::MeleeDefense;
        world.player.skills.insert(
            skill,
            Skill {
                skill_type: skill,
                ranks: 0,
                init: 0,
                spent_xp: 0,
                next_rank_xp: None,
                base: 0,
                current: 0,
                training: TrainingLevel::Untrained,
                trained_cost: 2,
                specialized_cost: 4,
                breakdown: Default::default(),
            },
        );
        let target = StatTarget::Skill(skill);
        let mut state = ProgressionState::default();
        let mut submitted = state
            .quote(&world, raise(AttributeType::StrengthAttr))
            .unwrap()
            .quote;
        submitted.intent = ProgressionIntent::Train { skill };
        submitted.target_state = world.progression_target_state(target).unwrap();
        state.guard(submitted);

        world.player.skills.get_mut(&skill).unwrap().current = 5;
        assert!(!state.reconcile(&world));
        assert_eq!(state.guarded_targets(&world), vec![target]);
        world.player.skills.get_mut(&skill).unwrap().training = TrainingLevel::Trained;
        assert!(state.reconcile(&world));
        assert!(state.guarded_targets(&world).is_empty());
    }
}
