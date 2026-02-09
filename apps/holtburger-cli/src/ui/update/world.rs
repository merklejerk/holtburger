use crate::ui::model::AppState;
use crate::ui::types::{ChatMessageKind, ContextView, UIState};
use holtburger_core::ClientEvent;
use holtburger_core::world::{Guid, WorldEvent};

impl AppState {
    pub(super) fn handle_received_event(&mut self, event: ClientEvent) {
        match event {
            ClientEvent::CharacterList(chars) => {
                self.characters = chars;
                self.state = UIState::CharacterSelection;
                self.selected_character_index = 0;
                self.logon_retry.reset();
            }
            ClientEvent::LogMessage(msg) => {
                let kind = if msg.contains("[ERROR]") {
                    ChatMessageKind::Error
                } else if msg.contains("[WARN]") {
                    ChatMessageKind::Warning
                } else if msg.contains("[INFO]") {
                    ChatMessageKind::Info
                } else if msg.contains("[DEBUG]") || msg.contains("[TRACE]") {
                    ChatMessageKind::Debug
                } else {
                    ChatMessageKind::System
                };
                self.log_chat(kind, msg);
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
                        self.attributes =
                            attributes.into_iter().map(|a| (a.attr_type, a)).collect();
                        self.vitals = vitals.into_iter().map(|v| (v.vital_type, v)).collect();
                        self.skills = skills.into_iter().map(|s| (s.skill_type, s)).collect();
                        self.player_enchantments = enchantments;
                        self.refresh_context_buffer();
                    }
                    WorldEvent::PropertyUpdated {
                        guid,
                        property_id,
                        value,
                    } => {
                        use holtburger_core::protocol::properties::PropertyInstanceId;
                        use holtburger_core::world::properties::PropertyValue;

                        if let Some(entity) = self.entities.get_mut(&guid) {
                            match value {
                                PropertyValue::Int(v) => {
                                    entity.int_properties.insert(property_id, v);
                                }
                                PropertyValue::Int64(v) => {
                                    entity.int64_properties.insert(property_id, v);
                                }
                                PropertyValue::Bool(v) => {
                                    entity.bool_properties.insert(property_id, v);
                                }
                                PropertyValue::Float(v) => {
                                    entity.float_properties.insert(property_id, v);
                                }
                                PropertyValue::String(v) => {
                                    entity.string_properties.insert(property_id, v);
                                }
                                PropertyValue::DID(v) => {
                                    entity.did_properties.insert(property_id, v);
                                }
                                PropertyValue::IID(v) => {
                                    entity.iid_properties.insert(property_id, v);
                                    if let Some(prop) = PropertyInstanceId::from_repr(property_id) {
                                        match prop {
                                            PropertyInstanceId::Container => {
                                                entity.container_id =
                                                    if v == Guid::NULL { None } else { Some(v) };
                                                if v != Guid::NULL {
                                                    entity.position.landblock_id = Guid::NULL;
                                                }
                                            }
                                            PropertyInstanceId::Wielder => {
                                                entity.wielder_id =
                                                    if v == Guid::NULL { None } else { Some(v) };
                                                if v != Guid::NULL {
                                                    entity.position.landblock_id = Guid::NULL;
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        }
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
                    WorldEvent::DerivedStatsUpdated {
                        attributes,
                        vitals,
                        skills,
                    } => {
                        for attr in attributes {
                            self.attributes.insert(attr.attr_type, attr);
                        }
                        for vital in vitals {
                            self.vitals.insert(vital.vital_type, vital);
                        }
                        for skill in skills {
                            self.skills.insert(skill.skill_type, skill);
                        }
                    }
                    WorldEvent::EntityMoved { guid, pos } => {
                        if Some(guid) == self.player_guid {
                            self.player_pos = Some(pos);
                        }
                        if let Some(entity) = self.entities.get_mut(&guid) {
                            entity.position = pos;
                        }
                    }
                    WorldEvent::EntityIdentified(entity) => {
                        let guid = entity.guid;
                        self.log_chat(
                            ChatMessageKind::System,
                            format!("Identified: {}", entity.name),
                        );
                        self.entities.insert(guid, *entity);

                        // If we are currently debugging this entity, keep it in debug view.
                        // Otherwise, switch to Assess view for the newly identified entity.
                        if self.current_debug_guid == Some(guid)
                            && self.context_view == ContextView::Custom
                        {
                            self.refresh_context_buffer();
                        } else {
                            self.context_view = ContextView::Assess(guid);
                            self.refresh_context_buffer();
                        }
                    }
                    WorldEvent::EntityVectorUpdated { .. } => {
                        // For now we don't do anything with vectors in the CLI,
                        // but we handle it to avoid the wildcard match.
                    }
                    WorldEvent::EntitySpawned(entity) => {
                        if Some(entity.guid) == self.player_guid {
                            self.player_pos = Some(entity.position);
                        }
                        self.entities.insert(entity.guid, *entity);
                    }
                    WorldEvent::EntityDespawned(guid) => {
                        self.entities.remove(&guid);
                    }
                    // Handle inventory events if they exist in WorldEvent, otherwise skip
                    // For now, these were placeholders and need to match actual WorldEvent variants
                    WorldEvent::EnchantmentUpdated(enchant) => {
                        if let Some(existing) = self
                            .player_enchantments
                            .iter_mut()
                            .find(|e| e.spell_id == enchant.spell_id && e.layer == enchant.layer)
                        {
                            *existing = enchant;
                        } else {
                            self.player_enchantments.push(enchant);
                        }
                    }
                    WorldEvent::EnchantmentRemoved { spell_id, layer } => {
                        // Find the enchantment before removing it to log its name
                        if let Some(enchant) = self
                            .player_enchantments
                            .iter()
                            .find(|e| e.spell_id == spell_id && e.layer == layer)
                            && self.verbosity >= 1
                        {
                            self.log_chat(
                                ChatMessageKind::System,
                                format!(
                                    "Spell removed: ID {} (Layer {})",
                                    enchant.spell_id, enchant.layer
                                ),
                            );
                        }
                        self.player_enchantments
                            .retain(|e| e.spell_id != spell_id || e.layer != layer);
                    }
                    WorldEvent::EnchantmentDispelled { spell_id, layer } => {
                        if let Some(enchant) = self
                            .player_enchantments
                            .iter()
                            .find(|e| e.spell_id == spell_id && e.layer == layer)
                        {
                            self.log_chat(
                                ChatMessageKind::System,
                                format!(
                                    "Spell DISPELLED: ID {} (Layer {})",
                                    enchant.spell_id, enchant.layer
                                ),
                            );
                        }
                        self.player_enchantments
                            .retain(|e| e.spell_id != spell_id || e.layer != layer);
                    }
                    WorldEvent::EnchantmentsPurged => {
                        self.player_enchantments.clear();
                    }
                    WorldEvent::ServerTimeUpdate(time) => {
                        self.server_time = Some((time, std::time::Instant::now()));
                    }
                    WorldEvent::WeenieError { error_id } => {
                        if self.verbosity >= 1 {
                            self.log_chat(
                                ChatMessageKind::Warning,
                                format!("[WARNING] WeenieError: 0x{:08X}", error_id),
                            );
                        }
                    }
                    WorldEvent::WeenieErrorWithString { error_id, message } => {
                        if self.verbosity >= 1 {
                            self.log_chat(
                                ChatMessageKind::Warning,
                                format!("[WARNING] WeenieError: 0x{:08X} - {}", error_id, message),
                            );
                        }
                    }
                    _ => {}
                }
            }
            ClientEvent::StatusUpdate { state } => {
                self.core_state = state;
                if self.core_state == holtburger_core::ClientState::InWorld {
                    self.logon_retry.reset();
                    self.enter_retry.reset();
                }
            }
            ClientEvent::ServerMessage(message) => {
                self.log_chat(ChatMessageKind::System, message);
            }
            ClientEvent::Chat { sender, message } => {
                self.log_chat(ChatMessageKind::Chat, format!("{}: {}", sender, message));
            }
            ClientEvent::Emote { sender, text } => {
                self.log_chat(ChatMessageKind::Emote, format!("{} {}", sender, text));
            }
            ClientEvent::InventoryServerSaveFailed { item_guid, error } => {
                self.log_chat(
                    ChatMessageKind::Warning,
                    format!(
                        "[WARNING] Inventory save failed for item 0x{:08X}: {:?}",
                        item_guid.0, error
                    ),
                );
            }
            ClientEvent::CharacterError(error) => {
                use holtburger_core::protocol::errors::CharacterError;
                if error == CharacterError::Logon {
                    self.logon_retry.schedule();
                    self.log_chat(
                        ChatMessageKind::Warning,
                        format!(
                            "Account already logged on. Retrying in {}s...",
                            self.logon_retry.backoff_secs
                        ),
                    );
                } else if error == CharacterError::EnterGameCharacterInWorld {
                    self.enter_retry.schedule();
                    self.log_chat(
                        ChatMessageKind::Warning,
                        format!(
                            "Character still in world. Retrying in {}s...",
                            self.enter_retry.backoff_secs
                        ),
                    );
                }
            }
            ClientEvent::PingResponse => {
                self.log_chat(ChatMessageKind::System, "Pong!".to_string());
            }
            _ => {}
        }
    }
}
