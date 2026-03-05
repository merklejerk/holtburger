use super::super::*;

impl WorldState {
    pub(crate) fn handle_login_event(
        &mut self,
        _msg: &GameMessage,
        ev: &GameEventMessage,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        match &ev.event {
            GameEvent::PlayerDescription(data) => {
                let guid: Guid = data.guid;
                let name = &data.name;
                let pos = &data.pos;

                // Ensure entity in our map has the correct name
                if let Some(entity) = self.entities.get_mut(guid) {
                    entity.set_string_prop(PropertyString::Name, name.clone());
                }

                if let Some(p) = pos {
                    events.extend(self.set_player_position(*p));
                }

                events.push(StateEvent::PlayerInfo(Box::new(crate::PlayerInfoData {
                    guid,
                    name: name.clone(),
                    pos: *pos,
                    attributes: self.player.get_attributes(),
                    vitals: self.player.get_vitals(),
                    skills: self.player.get_skills(),
                    enchantments: self.player.enchantments.clone(),
                    spells: self.player.spells.keys().cloned().collect(),
                    vitae: self.player.vitae(),
                    spell_names: self.get_player_spell_names(),
                    inventory: self.player.inventory.clone(),
                    equipment: self.player.equipment.clone(),
                })));

                self.emit_level_info(events);
            }
            _ => return false,
        }
        true
    }
}
