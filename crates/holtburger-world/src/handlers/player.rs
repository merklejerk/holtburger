use crate::StateEvent;
use crate::player::mutations::{SkillUpdateParams, VitalUpdateParams};
use crate::state::WorldState;
use holtburger_protocol::messages::*;

pub(crate) fn handle_message(
    state: &mut WorldState,
    message: &GameMessage,
    events: &mut Vec<StateEvent>,
) -> bool {
    match message {
        GameMessage::ObjectCreate(data) => {
            if data.public_weenie_desc.guid == state.player.guid
                && state.player.guid != holtburger_common::Guid::NULL
                && let Some(pos) = data.pos
            {
                state.sync_player_position(pos);
            }
            false
        }
        GameMessage::UpdatePosition(data) => {
            if data.guid == state.player.guid && state.player.guid != holtburger_common::Guid::NULL
            {
                state.player.update_position_from_server(
                    data.pos.pos,
                    data.pos.instance_sequence,
                    data.pos.position_sequence,
                    data.pos.teleport_sequence,
                    data.pos.force_position_sequence,
                    events,
                );
            }
            false
        }
        GameMessage::PrivateUpdatePosition(_) | GameMessage::PublicUpdatePosition(_) => false,
        GameMessage::VectorUpdate(data) => {
            if data.guid == state.player.guid && state.player.guid != holtburger_common::Guid::NULL
            {
                state.player.update_vector_sequence(data.instance_sequence);
                return false;
            }
            false
        }
        GameMessage::UpdateMotion(data) => {
            if data.guid == state.player.guid && state.player.guid != holtburger_common::Guid::NULL
            {
                state.player.update_motion_sequences(
                    data.object_instance_sequence,
                    data.server_control_sequence,
                    data.movement_sequence,
                );
                return false;
            }
            false
        }
        GameMessage::PlayerTeleport(data) => {
            state.player.set_teleport_sequence(data.teleport_sequence);
            true
        }
        GameMessage::PrivateUpdateAttribute(data) => {
            let UpdateAttribute {
                attribute,
                ranks,
                start,
                xp,
                ..
            } = &**data;
            state.player.update_attribute(
                *attribute,
                *ranks,
                *start,
                *xp,
                state.xp_table.as_ref(),
                events,
            );
            true
        }
        GameMessage::PublicUpdateAttribute(data) => {
            let UpdateAttribute {
                attribute,
                ranks,
                start,
                xp,
                ..
            } = &**data;
            state.player.update_attribute(
                *attribute,
                *ranks,
                *start,
                *xp,
                state.xp_table.as_ref(),
                events,
            );
            true
        }
        GameMessage::PrivateUpdateSkill(data) => {
            let UpdateSkill {
                skill,
                ranks,
                status,
                init,
                xp,
                ..
            } = &**data;
            state.player.update_skill(
                SkillUpdateParams {
                    skill_id: *skill,
                    ranks: *ranks,
                    status: *status,
                    init: *init,
                    xp: *xp,
                    xp_table: state.xp_table.as_ref(),
                    skill_table: state.skill_table.as_deref(),
                },
                events,
            );
            true
        }
        GameMessage::PublicUpdateSkill(data) => {
            let UpdateSkill {
                skill,
                ranks,
                status,
                init,
                xp,
                ..
            } = &**data;
            state.player.update_skill(
                SkillUpdateParams {
                    skill_id: *skill,
                    ranks: *ranks,
                    status: *status,
                    init: *init,
                    xp: *xp,
                    xp_table: state.xp_table.as_ref(),
                    skill_table: state.skill_table.as_deref(),
                },
                events,
            );
            true
        }
        GameMessage::PrivateUpdateVital(data) => {
            let UpdateVital {
                vital,
                ranks,
                start,
                current,
                xp,
                ..
            } = &**data;
            state.player.update_vital(
                VitalUpdateParams {
                    vital_id: *vital,
                    ranks: *ranks,
                    start: *start,
                    current: *current,
                    xp: *xp,
                    xp_table: state.xp_table.as_ref(),
                },
                events,
            );
            true
        }
        GameMessage::PublicUpdateVital(data) => {
            let UpdateVital {
                vital,
                ranks,
                start,
                current,
                xp,
                ..
            } = &**data;
            state.player.update_vital(
                VitalUpdateParams {
                    vital_id: *vital,
                    ranks: *ranks,
                    start: *start,
                    current: *current,
                    xp: *xp,
                    xp_table: state.xp_table.as_ref(),
                },
                events,
            );
            true
        }
        GameMessage::PrivateUpdateVitalCurrent(data) => {
            let UpdateVitalCurrent { vital, current, .. } = &**data;
            state.player.update_vital_current(*vital, *current, events);
            true
        }
        GameMessage::InventoryRemoveObject(data) => {
            state.player.remove_from_inventory(data.object_guid);
            false
        }
        GameMessage::GameEvent(_) => false,
        _ => false,
    }
}

pub(crate) fn handle_event(
    state: &mut WorldState,
    event: &GameEventMessage,
    events: &mut Vec<StateEvent>,
) -> bool {
    match &event.event {
        GameEvent::PlayerDescription(data) => {
            state.player.hydrate_from_player_description(
                data,
                state.xp_table.as_ref(),
                state.skill_table.as_deref(),
                events,
            );
            false
        }
        GameEvent::MagicUpdateEnchantment(data) => {
            state
                .player
                .upsert_enchantment(data.target, data.enchantment, events)
        }
        GameEvent::MagicUpdateMultipleEnchantments(data) => state
            .player
            .upsert_multiple_enchantments(data.target, &data.enchantments, events),
        GameEvent::MagicRemoveEnchantment(data) => {
            state
                .player
                .remove_enchantment(data.target, data.spell_id, data.layer, events)
        }
        GameEvent::MagicDispelEnchantment(data) => {
            state
                .player
                .remove_enchantment(data.target, data.spell_id, data.layer, events)
        }
        GameEvent::MagicRemoveMultipleEnchantments(data) => state
            .player
            .remove_multiple_enchantments(data.target, &data.spells, events),
        GameEvent::MagicDispelMultipleEnchantments(data) => state
            .player
            .remove_multiple_enchantments(data.target, &data.spells, events),
        GameEvent::MagicPurgeEnchantments(data) => {
            state.player.purge_enchantments(data.target, false, events)
        }
        GameEvent::MagicPurgeBadEnchantments(data) => {
            state.player.purge_enchantments(data.target, true, events)
        }
        GameEvent::MagicUpdateSpell(data) => {
            state.player.add_spell(data.spell_id as u32, events);
            true
        }
        GameEvent::MagicRemoveSpell(data) => {
            state.player.remove_spell(data.spell_id as u32, events);
            true
        }
        GameEvent::UpdateHealth(data) => {
            state
                .player
                .update_health_fraction(data.target, data.health, events)
        }
        GameEvent::InventoryPutObjInContainer(data) => {
            if data.container_guid == state.player.guid
                || state.player.inventory.contains(&data.container_guid)
            {
                state.player.add_to_inventory(data.item_guid);
            }
            false
        }
        GameEvent::InventoryPutObjectIn3D(data) => {
            state.player.remove_from_inventory(data.object_guid);
            false
        }
        GameEvent::WieldObject(data) => {
            if event.target == state.player.guid {
                state.player.wield_item(data.object_guid, data.equip_mask);
            }
            false
        }
        _ => false,
    }
}
