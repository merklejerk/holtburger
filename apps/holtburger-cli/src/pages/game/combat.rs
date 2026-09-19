use crate::pages::game::GameState;
use holtburger_common::Guid;
use holtburger_common::properties::{
    ItemType, PropertyBool, WorldObjectExt as _, WorldObjectPropertyAccessors as _,
};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_world::context::{CombatTargetStatus, WorldContextExt};
use holtburger_world::entity::Entity;

/// Compact TUI presentation state derived from the shared combat owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttackActivity {
    Ready,
    Active,
}

/// Returns whether a projected entity can be offered as an explicit attack target.
pub fn can_locally_attack_entity(entity: &Entity, target_status: CombatTargetStatus) -> bool {
    entity
        .item_type()
        .is_some_and(|item_type| item_type.contains(ItemType::CREATURE))
        && entity.get_bool_prop(PropertyBool::Attackable)
        && target_status != CombatTargetStatus::DeathMotionObserved
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LocalCombatTargetDisqualifier {
    MissingEntity,
    NotCreature,
    DeathMotionObserved,
    NotAttackable,
}

pub(crate) fn explicit_attack_failure_message(
    state: &GameState,
    target_guid: Guid,
) -> Option<String> {
    explicit_attack_target_failure_reason(state, target_guid)
        .map(|reason| explicit_attack_target_failure_message(target_guid, reason))
}

pub(crate) fn explicit_attack_mode(state: &GameState) -> Option<CombatMode> {
    match state.data.combat_mode {
        CombatMode::Melee | CombatMode::Missile => Some(state.data.combat_mode),
        CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => {
            match state.data.get_suggested_combat_mode() {
                CombatMode::Melee | CombatMode::Missile => {
                    Some(state.data.get_suggested_combat_mode())
                }
                CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
            }
        }
    }
}

fn explicit_attack_target_failure_reason(
    state: &GameState,
    target_guid: Guid,
) -> Option<LocalCombatTargetDisqualifier> {
    let entity = state.data.entities.get(&target_guid);
    let target_status = state.data.combat_target_status(target_guid);
    let is_creature = entity
        .and_then(|entity| entity.item_type())
        .is_some_and(|item_type| item_type.contains(ItemType::CREATURE));
    let attackable = entity.is_some_and(|entity| can_locally_attack_entity(entity, target_status));

    if entity.is_none() {
        return Some(LocalCombatTargetDisqualifier::MissingEntity);
    }
    if !is_creature {
        return Some(LocalCombatTargetDisqualifier::NotCreature);
    }
    if target_status == CombatTargetStatus::DeathMotionObserved {
        return Some(LocalCombatTargetDisqualifier::DeathMotionObserved);
    }
    if !attackable {
        return Some(LocalCombatTargetDisqualifier::NotAttackable);
    }
    None
}

fn explicit_attack_target_failure_message(
    target_guid: Guid,
    reason: LocalCombatTargetDisqualifier,
) -> String {
    match reason {
        LocalCombatTargetDisqualifier::MissingEntity => {
            format!(
                "Can't attack 0x{:08X}; target is unavailable.",
                target_guid.0
            )
        }
        LocalCombatTargetDisqualifier::NotCreature => format!(
            "Can't attack 0x{:08X}; target must be a creature.",
            target_guid.0
        ),
        LocalCombatTargetDisqualifier::DeathMotionObserved => format!(
            "Can't attack 0x{:08X}; target is already in its death animation.",
            target_guid.0
        ),
        LocalCombatTargetDisqualifier::NotAttackable => format!(
            "Can't attack 0x{:08X}; target must be an attackable creature.",
            target_guid.0
        ),
    }
}
