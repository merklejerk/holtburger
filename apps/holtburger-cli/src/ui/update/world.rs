use crate::ui::model::AppState;
use crate::ui::types::{ChatMessageKind, UIState};
use holtburger_common::properties::PropertyInt;
use holtburger_core::ClientEvent;
use holtburger_protocol::messages::EquipMask;

impl AppState {
    pub(super) fn handle_received_event(&mut self, event: ClientEvent) {
        match event {
            ClientEvent::CharacterList(mut chars) => {
                chars.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
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
            ClientEvent::World(_) => {
                // All stateful WorldEvents are now handled via ClientViewEvent projection
            }
            ClientEvent::ResourcesResolved(resources) => {
                for resource in resources {
                    match resource {
                        holtburger_core::ResolvedResource::Spell { spell_id, info } => {
                            self.spell_info.insert(spell_id, info);
                        }
                    }
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
            ClientEvent::PingResponse => {
                self.log_chat(ChatMessageKind::System, "Pong!".to_string());
            }
            ClientEvent::RawMessage(data) => {
                self.net_stats.bytes_in += data.len() as u64;
            }
            _ => {}
        }
    }

    pub(super) fn handle_client_view_event(&mut self, event: holtburger_core::ClientViewEvent) {
        use holtburger_core::ClientViewEvent;
        match event {
            ClientViewEvent::StatusUpdate { state } => {
                self.core_state = state;
                if self.core_state == holtburger_core::ClientState::InWorld {
                    self.logon_retry.reset();
                    self.enter_retry.reset();
                }
            }
            ClientViewEvent::ErrorRaised {
                source: _,
                kind,
                code,
                message,
                is_transient: _,
            } => {
                use holtburger_core::ErrorKind;
                use holtburger_protocol::errors::CharacterError;

                if let (ErrorKind::Character, Some(error_code)) = (kind, code) {
                    let error =
                        CharacterError::from_repr(error_code).unwrap_or(CharacterError::None);
                    if error == CharacterError::Logon {
                        self.logon_retry.schedule();
                        self.log_chat(
                            ChatMessageKind::Warning,
                            format!(
                                "Account already logged on. Retrying in {}s...",
                                self.logon_retry.backoff_secs
                            ),
                        );
                        return;
                    } else if error == CharacterError::EnterGameCharacterInWorld {
                        self.enter_retry.schedule();
                        self.log_chat(
                            ChatMessageKind::Warning,
                            format!(
                                "Character still in world. Retrying in {}s...",
                                self.enter_retry.backoff_secs
                            ),
                        );
                        return;
                    }
                }

                let kind = match kind {
                    ErrorKind::Weenie | ErrorKind::Character | ErrorKind::Client => {
                        ChatMessageKind::Error
                    }
                    ErrorKind::Transport => ChatMessageKind::Warning,
                };
                self.log_chat(kind, format!("[!] {}", message));
            }
            ClientViewEvent::PlayerEnchantmentsUpdated {
                enchantments,
                resolved_names,
            } => {
                self.player_enchantments = enchantments;
                for (id, name) in resolved_names {
                    self.spell_names.insert(id, name);
                }
            }
            ClientViewEvent::PlayerStatsSkillsUpdated {
                attributes,
                skills,
                resistances,
                armor,
                vitae,
                level_info,
            } => {
                self.attributes = attributes;
                self.skills = skills;
                self.resistances = resistances;
                self.armor = armor;
                self.vitae = vitae;
                self.level_info = Some(level_info);
            }
            ClientViewEvent::PlayerVitalUpdated { vital } => {
                self.vitals.insert(vital.vital_type, vital);
            }
            ClientViewEvent::PlayerSpellsUpdated {
                spell_ids,
                resolved,
            } => {
                self.player_spells = spell_ids;
                for summary in resolved {
                    if let (id, Some(name)) = (summary.spell_id, summary.name) {
                        self.spell_names.insert(id, name);
                    }
                    // We could also populate self.spell_info here if we added enough fields to ResolvedSpellSummary
                }
            }
            ClientViewEvent::EntityUpserted { entity } => {
                let guid = entity.guid;
                if Some(guid) == self.player_guid {
                    self.player_pos = Some(entity.position);
                }

                // Update inventory tracking
                if let Some(pguid) = self.player_guid {
                    if let Some(cid) = entity.container_id
                        && (cid == pguid || self.inventory.contains(&cid))
                    {
                        self.inventory.insert(guid);
                    } else if let Some(wid) = entity.wielder_id
                        && wid == pguid
                    {
                        self.inventory.insert(guid);
                    } else {
                        // If it's no longer in our inventory/wielded, remove it
                        self.inventory.remove(&guid);
                    }
                }

                // Update equipment tracking
                if let Some(&loc) = entity
                    .int_properties
                    .get(&(PropertyInt::CurrentWieldedLocation as u32))
                {
                    let mask = EquipMask::from_bits_truncate(loc as u32);
                    if mask.is_empty() {
                        self.equipment.remove(&guid);
                    } else {
                        self.equipment.insert(guid, mask);
                    }
                } else {
                    self.equipment.remove(&guid);
                }

                self.entities.insert(entity.guid, *entity);
            }
            ClientViewEvent::EntityRemoved { guid } => {
                self.update_inventory_recursive(guid, false);
                self.entities.remove(&guid);
                self.equipment.remove(&guid);
                if self.current_debug_guid == Some(guid) {
                    self.current_debug_guid = None;
                }
            }
            ClientViewEvent::ServerTimeUpdated { time } => {
                self.server_time = Some((time, std::time::Instant::now()));
            }
            ClientViewEvent::CombatModeUpdated { mode } => {
                self.combat_mode = mode;
            }
            ClientViewEvent::NoClipUpdated { enabled } => {
                self.noclip = enabled;
                let status = if enabled { "ENABLED" } else { "DISABLED" };
                self.log_chat(
                    ChatMessageKind::System,
                    format!(">> NoClip is now {}", status),
                );
            }
        }
    }
}
