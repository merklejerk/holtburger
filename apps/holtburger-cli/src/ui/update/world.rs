use holtburger_core::ClientEvent;
use holtburger_core::world::WorldEvent;
use crate::ui::model::AppState;
use crate::ui::types::UIState;

impl AppState {
    pub(super) fn handle_received_event(&mut self, event: ClientEvent) {
        match event {
            ClientEvent::Message(msg) => {
                self.messages.push(msg);
                if self.messages.len() > 1000 {
                    self.messages.remove(0);
                }
            }
            ClientEvent::CharacterList(chars) => {
                self.characters = chars;
                self.state = UIState::CharacterSelection;
                self.selected_character_index = 0;
            }
            ClientEvent::PlayerEntered { guid, name } => {
                self.player_guid = Some(guid);
                self.character_name = Some(name);
            }
            ClientEvent::World(world_event) => {
                match *world_event {
                    WorldEvent::PlayerInfo {
                        guid,
                        name,
                        pos,
                        attributes,
                        vitals,
                        skills,
                        enchantments,
                    } => {
                        self.player_guid = Some(guid);
                        self.character_name = Some(name);
                        if let Some(p) = pos {
                            self.player_pos = Some(p);
                        }
                        self.attributes = attributes
                            .into_iter()
                            .map(|a| (a.attr_type, a))
                            .collect();
                        self.vitals = vitals
                            .into_iter()
                            .map(|v| (v.vital_type, v))
                            .collect();
                        self.skills = skills
                            .into_iter()
                            .map(|s| (s.skill_type, s))
                            .collect();
                        self.player_enchantments = enchantments;
                        self.refresh_context_buffer();
                    }
                    WorldEvent::AttributeUpdated(attr) => {
                        self.attributes.insert(attr.attr_type, attr);
                    }
                    WorldEvent::VitalUpdated(vital) => {
                        self.vitals.insert(vital.vital_type, vital);
                    }
                    WorldEvent::SkillUpdated(skill) => {
                        self.skills.insert(skill.skill_type, skill);
                    }
                    WorldEvent::EntityMoved { guid, pos } => {
                        if Some(guid) == self.player_guid {
                            self.player_pos = Some(pos);
                        } else if let Some(entity) = self.entities.get_mut(&guid) {
                            entity.position = pos;
                        }
                    }
                    WorldEvent::EntitySpawned(entity) => {
                        self.entities.insert(entity.guid, *entity);
                    }
                    WorldEvent::EntityDespawned(guid) => {
                        self.entities.remove(&guid);
                    }
                    // Handle inventory events if they exist in WorldEvent, otherwise skip
                    // For now, these were placeholders and need to match actual WorldEvent variants
                    WorldEvent::EnchantmentUpdated(enchant) => {
                        if let Some(existing) = self.player_enchantments.iter_mut().find(|e| {
                            e.spell_id == enchant.spell_id && e.layer == enchant.layer
                        }) {
                            *existing = enchant;
                        } else {
                            self.player_enchantments.push(enchant);
                        }
                    }
                    WorldEvent::EnchantmentRemoved { spell_id, layer } => {
                        self.player_enchantments
                            .retain(|e| e.spell_id != spell_id || e.layer != layer);
                    }
                    WorldEvent::EnchantmentsPurged => {
                        self.player_enchantments.clear();
                    }
                    WorldEvent::ServerTimeUpdate(time) => {
                        self.server_time = Some((time, std::time::Instant::now()));
                    }
                    _ => {}
                }
            }
            ClientEvent::StatusUpdate {
                state,
                logon_retry,
                enter_retry,
            } => {
                self.core_state = state;
                self.logon_retry = logon_retry;
                self.enter_retry = enter_retry;
            }
            ClientEvent::PingResponse => {
                self.messages.push(holtburger_core::ChatMessage {
                    kind: holtburger_core::ChatMessageKind::System,
                    text: "Pong! (Received PingResponse)".to_string(),
                });
            }
            ClientEvent::ViewContents { container, items } => {
                self.messages.push(holtburger_core::ChatMessage {
                    kind: holtburger_core::ChatMessageKind::System,
                    text: format!(
                        "Received ViewContents for {:08X} ({} items)",
                        container,
                        items.len()
                    ),
                });
            }
            _ => {}
        }
    }
}
