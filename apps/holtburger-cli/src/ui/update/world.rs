use crate::ui::model::AppState;
use crate::ui::types::{ChatMessageKind, UIState};
use holtburger_core::ClientEvent;
use holtburger_core::world::WorldEvent;

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
            ClientEvent::CharacterError(error_code) => {
                use holtburger_core::protocol::messages::character_error_codes;
                if error_code == character_error_codes::ACCOUNT_ALREADY_LOGGED_ON {
                    self.logon_retry.schedule();
                    self.log_chat(
                        ChatMessageKind::Warning,
                        format!(
                            "Account already logged on. Retrying in {}s...",
                            self.logon_retry.backoff_secs
                        ),
                    );
                } else if error_code == character_error_codes::ENTER_GAME_CHARACTER_IN_WORLD {
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
