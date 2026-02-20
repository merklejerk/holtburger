use crate::ui::model::{AppState, GameState, Page, SelectionState};
use crate::ui::types::{ChatMessageKind, ContextView};
use holtburger_common::properties::PropertyInt;
use holtburger_core::{StateEvent, WireEvent};
use holtburger_protocol::messages::EquipMask;

impl AppState {
    pub(super) fn handle_received_event(&mut self, event: WireEvent) {
        match event {
            WireEvent::CharacterList(mut chars) => {
                chars.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
                self.page = Page::Selection(SelectionState {
                    characters: chars,
                    selected_character_index: 0,
                });
                self.logon_retry.reset();
            }
            WireEvent::LogMessage(msg) => {
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
            WireEvent::PlayerEntered { guid, name } => {
                if let Page::Game(game) = &mut self.page {
                    game.player_guid = Some(guid);
                    game.character_name = Some(name);
                } else {
                    self.page = Page::Game(Box::new(GameState::new(guid, name)));
                }
            }
            WireEvent::ServerMessage(message) => {
                self.log_chat(ChatMessageKind::System, message);
            }
            WireEvent::Chat { sender, message } => {
                self.log_chat(ChatMessageKind::Chat, format!("{}: {}", sender, message));
            }
            WireEvent::Emote { sender, text } => {
                self.log_chat(ChatMessageKind::Emote, format!("{} {}", sender, text));
            }
            WireEvent::PingResponse => {
                self.log_chat(ChatMessageKind::System, "Pong!".to_string());
            }
            WireEvent::RawMessage(data) => {
                self.net_stats.bytes_in += data.len() as u64;
            }
            _ => {}
        }
    }

    pub(super) fn handle_received_state_event(&mut self, event: StateEvent) {
        if let StateEvent::EntityIdentified(entity) = event
            && let Some(game) = self.game_option_mut()
        {
            let guid = entity.guid;
            game.entities.insert(guid, *entity);
            game.context_view = ContextView::Assess(guid);
        }
    }

    pub(super) fn handle_client_view_event(&mut self, event: holtburger_core::ClientViewEvent) {
        use holtburger_core::ClientViewEvent;

        // Skip events if not in-game, unless it's a StatusUpdate or ErrorRaised
        // that handles transitions.
        if !matches!(
            event,
            ClientViewEvent::StatusUpdate { .. } | ClientViewEvent::ErrorRaised { .. }
        ) && self.game_option().is_none()
        {
            return;
        }

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
                if let Some(game) = self.game_option_mut() {
                    game.player_enchantments = enchantments;
                    for (id, name) in resolved_names {
                        game.spell_names.insert(id, name);
                    }
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
                if let Some(game) = self.game_option_mut() {
                    game.attributes = attributes;
                    game.skills = skills;
                    game.resistances = resistances;
                    game.armor = armor;
                    game.vitae = vitae;
                    game.level_info = Some(level_info);
                }
            }
            ClientViewEvent::PlayerVitalsUpdated { vitals } => {
                if let Some(game) = self.game_option_mut() {
                    for (vt, v) in vitals {
                        game.vitals.insert(vt, v);
                    }
                }
            }
            ClientViewEvent::PlayerSpellsUpdated { spell_ids, spells } => {
                if let Some(game) = self.game_option_mut() {
                    game.player_spells = spell_ids;
                    for (id, info) in spells {
                        game.spell_names.insert(id, info.name.clone());
                        game.spell_info.insert(id, Box::new(info));
                    }
                }
            }
            ClientViewEvent::EntityUpserted { entity } => {
                if let Some(game) = self.game_option_mut() {
                    let guid = entity.guid;
                    if Some(guid) == game.player_guid {
                        game.player_pos = Some(entity.position);
                    }

                    // Update inventory tracking
                    if let Some(pguid) = game.player_guid {
                        if let Some(cid) = entity.container_id
                            && (cid == pguid || game.inventory.contains(&cid))
                        {
                            game.inventory.insert(guid);
                        } else if let Some(wid) = entity.wielder_id
                            && wid == pguid
                        {
                            game.inventory.insert(guid);
                        } else {
                            // If it's no longer in our inventory/wielded, remove it
                            game.inventory.remove(&guid);
                        }
                    }

                    // Update equipment tracking
                    if let Some(pguid) = game.player_guid
                        && entity.wielder_id == Some(pguid)
                    {
                        if let Some(mask) = entity.currently_wielded_location {
                            if mask.is_empty() {
                                game.equipment.remove(&guid);
                            } else {
                                game.equipment.insert(guid, mask);
                            }
                        } else if let Some(&loc) = entity
                            .int_properties
                            .get(&(PropertyInt::CurrentWieldedLocation as u32))
                        {
                            let mask = EquipMask::from_bits_truncate(loc as u32);
                            if mask.is_empty() {
                                game.equipment.remove(&guid);
                            } else {
                                game.equipment.insert(guid, mask);
                            }
                        } else {
                            game.equipment.remove(&guid);
                        }
                    } else {
                        game.equipment.remove(&guid);
                    }

                    game.entities.insert(entity.guid, *entity);
                }
            }
            ClientViewEvent::EntityRemoved { guid } => {
                if let Page::Game(_) = self.page {
                    self.update_inventory_recursive(guid, false);
                    if let Some(game) = self.game_option_mut() {
                        game.entities.remove(&guid);
                        game.equipment.remove(&guid);
                        if game.current_debug_guid == Some(guid) {
                            game.current_debug_guid = None;
                        }
                    }
                }
            }
            ClientViewEvent::ServerTimeUpdated { time } => {
                if let Some(game) = self.game_option_mut() {
                    game.server_time = Some((time, std::time::Instant::now()));
                }
            }
            ClientViewEvent::CombatModeUpdated { mode } => {
                if let Some(game) = self.game_option_mut() {
                    game.combat_mode = mode;
                }
            }
            ClientViewEvent::NoClipUpdated { enabled } => {
                if let Some(game) = self.game_option_mut() {
                    game.noclip = enabled;
                    let status = if enabled { "ENABLED" } else { "DISABLED" };
                    self.log_chat(
                        ChatMessageKind::System,
                        format!(">> NoClip is now {}", status),
                    );
                }
            }
        }
    }
}
