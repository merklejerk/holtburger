use crate::state::ChatMessageKind;
use crate::state::{AppState, GameState, Page, SelectionState};
use crate::types::{ContextView, DashboardTab};
use holtburger_common::Guid;
use holtburger_core::{ClientState, ClientViewEvent, ErrorReason};
use holtburger_protocol::errors::CharacterError;
use holtburger_world::entity::Entity;

impl AppState {
    fn handle_setup_event(&mut self, event: &ClientViewEvent) {
        match event {
            ClientViewEvent::WorldNameUpdated(name) => {
                self.world_name = name.clone();
                if let Page::Game(ref mut game) = self.page {
                    game.data.world_name = name.clone();
                }
            }
            ClientViewEvent::CharacterList(chars) => {
                let mut chars = chars.clone();
                chars.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
                self.page = Page::Selection(SelectionState {
                    characters: chars,
                    selected_character_index: 0,
                });
                self.logon_retry.reset();
            }
            ClientViewEvent::PlayerEntered { guid, name } => {
                if let Page::Game(game) = &mut self.page {
                    game.data.player_guid = Some(*guid);
                    game.data.character_name = Some(name.clone());
                    game.data.world_name = self.world_name.clone();
                } else {
                    self.page = Page::Game(Box::new(GameState::new(
                        *guid,
                        name.clone(),
                        self.world_name.clone(),
                    )));
                }
            }
            ClientViewEvent::ServerTimeUpdated { time } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.server_time = Some((*time, std::time::Instant::now()));
                }
            }
            _ => {}
        }
    }

    fn handle_client_status_event(&mut self, event: ClientViewEvent) {
        match event {
            ClientViewEvent::StatusUpdate { state } => {
                self.core_state = state;
                if self.core_state == ClientState::InWorld {
                    self.logon_retry.reset();
                    self.enter_retry.reset();
                }
            }
            ClientViewEvent::ErrorRaised {
                reason,
                message,
                ..
            } => {
                if let ErrorReason::Character(error) = reason {
                    if error == CharacterError::Logon {
                        self.logon_retry.schedule();
                        self.chat.log(
                            ChatMessageKind::Warning,
                            format!(
                                "* Retrying login (attempt {}/{})...",
                                self.logon_retry.attempts, self.logon_retry.max_attempts
                            ),
                        );
                        return;
                    } else if error == CharacterError::EnterGameCharacterInWorld {
                        self.enter_retry.schedule();
                        self.chat.log(
                            ChatMessageKind::Warning,
                            format!(
                                "* Retrying enter world (attempt {}/{})...",
                                self.enter_retry.attempts, self.enter_retry.max_attempts
                            ),
                        );
                        return;
                    }
                }

                let chat_kind = match reason {
                    ErrorReason::Weenie(_, _)
                    | ErrorReason::Character(_)
                    | ErrorReason::General(_) => ChatMessageKind::Error,
                    ErrorReason::Transport(_) => ChatMessageKind::Warning,
                };
                self.chat.log(chat_kind, format!("[!] {}", message));
            }
            _ => {}
        }
    }

    pub(super) fn handle_client_view_event(&mut self, event: ClientViewEvent) {
        // Handle setup and chat events regardless of being locally in-game
        match &event {
            ClientViewEvent::CharacterList(_)
            | ClientViewEvent::PlayerEntered { .. }
            | ClientViewEvent::ServerTimeUpdated { .. } 
            | ClientViewEvent::WorldNameUpdated(_) => {
                self.handle_setup_event(&event);
            }
            ClientViewEvent::LogMessage(_)
            | ClientViewEvent::ServerMessage { .. }
            | ClientViewEvent::Chat { .. }
            | ClientViewEvent::Emote { .. }
            | ClientViewEvent::PingResponse
            | ClientViewEvent::BootAccount(_) => {
                self.chat.handle_event(&event);
            }
            _ => {}
        }

        // Skip other events if not in-game, unless it's a StatusUpdate or ErrorRaised
        // that handles transitions.
        if !matches!(
            event,
            ClientViewEvent::CharacterList(_)
                | ClientViewEvent::PlayerEntered { .. }
                | ClientViewEvent::WorldNameUpdated(_)
                | ClientViewEvent::StatusUpdate { .. }
                | ClientViewEvent::ErrorRaised { .. }
                | ClientViewEvent::LogMessage(_)
                | ClientViewEvent::ServerMessage { .. }
                | ClientViewEvent::Chat { .. }
                | ClientViewEvent::Emote { .. }
                | ClientViewEvent::PingResponse
                | ClientViewEvent::BootAccount(_)
        ) && self.game_option().is_none()
        {
            return;
        }

        match event {
            ClientViewEvent::StatusUpdate { .. } | ClientViewEvent::ErrorRaised { .. } => {
                self.handle_client_status_event(event);
            }
            ClientViewEvent::PlayerEnchantmentsUpdated { .. }
            | ClientViewEvent::PlayerStatsSkillsUpdated { .. }
            | ClientViewEvent::PlayerVitalsUpdated { .. }
            | ClientViewEvent::PlayerSpellsUpdated { .. }
            | ClientViewEvent::CombatModeUpdated { .. } => {
                self.handle_player_event(event);
            }
            ClientViewEvent::EntityDebugInfoSnapshot { entity } => {
                let entity_ref = entity.as_ref();
                if let Some(game) = self.game_option_mut() {
                    // Update our local cache with the high-fidelity snapshot
                    game.data
                        .entities
                        .insert(entity_ref.guid, entity_ref.clone());
                }
            }
            ClientViewEvent::EntitySpawned { entity } => {
                let entity_ref = entity.as_ref();
                if let Some(game) = self.game_option_mut() {
                    game.data
                        .entities
                        .insert(entity_ref.guid, entity_ref.clone());
                }
                self.update_inventory_and_equipment(entity_ref);
            }
            ClientViewEvent::EntityPropertiesUpdated { guid, updates } => {
                let mut needs_update = false;
                if let Some(game) = self.game_option_mut()
                    && let Some(entity) = game.data.entities.get_mut(&guid)
                {
                    for update in updates {
                        entity.properties.apply(update);
                    }
                    needs_update = true;
                }
                if needs_update
                    && let Some(game) = self.game_option()
                    && let Some(entity) = game.data.entities.get(&guid).cloned()
                {
                    self.update_inventory_and_equipment(&entity);
                }
            }
            ClientViewEvent::EntityMoved { guid, pos } => {
                if let Some(game) = self.game_option_mut()
                    && let Some(entity) = game.data.entities.get_mut(&guid)
                {
                    entity.position = pos;
                    if Some(guid) == game.data.player_guid {
                        game.data.player_pos = Some(pos);
                    }
                }
            }
            ClientViewEvent::EntityDespawned { guid } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.entities.remove(&guid);
                }
                self.handle_entity_removed(guid);
            }
            ClientViewEvent::VendorStateUpdated { vendor } => {
                if let Some(game) = self.game_option_mut() {
                    let vendor_guid = vendor.as_ref().map(|v| v.vendor_guid);
                    game.data.vendor = vendor;
                    // If we just opened a vendor and we initiated it, switch to Trade tab.
                    if let Some(v_guid) = vendor_guid
                        && let Some((last_time, target_guid)) = game.view.last_trade_initiation
                        && target_guid == v_guid
                        && last_time.elapsed() < std::time::Duration::from_secs(5)
                    {
                        game.dashboard.active_tab = DashboardTab::Trade;
                    }
                }
            }
            ClientViewEvent::TradeStateUpdated { trade } => {
                if let Some(game) = self.game_option_mut() {
                    let partner_guid = trade.as_ref().map(|t| t.partner_side.guid);
                    game.data.trade = trade;
                    // If we just opened a trade and we initiated it, switch to Trade tab.
                    if let Some(p_guid) = partner_guid
                        && let Some((last_time, target_guid)) = game.view.last_trade_initiation
                        && target_guid == p_guid
                        && last_time.elapsed() < std::time::Duration::from_secs(5)
                    {
                        game.dashboard.active_tab = DashboardTab::Trade;
                    }
                }
            }
            ClientViewEvent::EntityIdentified { entity } => {
                let entity_ref = entity.as_ref();
                if let Some(game) = self.game_option_mut() {
                    let guid = entity_ref.guid;
                    game.data.entities.insert(guid, entity_ref.clone());
                    game.view.context_view = ContextView::Assess(guid);
                }
                self.update_inventory_and_equipment(entity_ref);
                self.handle_entity_identified(entity_ref);
            }
            ClientViewEvent::NoClipUpdated { .. } => {
                self.handle_navigation_event(event);
            }
            ClientViewEvent::ContainerOpened { guid } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.open_containers.insert(guid);
                }
            }
            ClientViewEvent::ContainerClosed { guid } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.open_containers.remove(&guid);
                }
            }
            _ => {}
        }
    }

    fn handle_player_event(&mut self, event: ClientViewEvent) {
        match event {
            ClientViewEvent::PlayerEnchantmentsUpdated {
                enchantments,
                resolved_names,
            } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.player_enchantments = enchantments;
                    for (id, name) in resolved_names {
                        game.data.spell_names.insert(id, name);
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
                    game.data.attributes = attributes;
                    game.data.skills = skills;
                    game.data.resistances = resistances;
                    game.data.armor = armor;
                    game.data.vitae = vitae;
                    game.data.level_info = Some(level_info);
                }
            }
            ClientViewEvent::PlayerVitalsUpdated { vitals } => {
                if let Some(game) = self.game_option_mut() {
                    for (vt, v) in vitals {
                        game.data.vitals.insert(vt, v);
                    }
                }
            }
            ClientViewEvent::PlayerSpellsUpdated {
                spell_ids,
                spells,
            } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.player_spells = spell_ids;
                    for (id, info) in spells {
                        game.data.spell_names.insert(id, info.name.clone());
                        game.data.spell_info.insert(id, Box::new(info));
                    }
                }
            }
            ClientViewEvent::CombatModeUpdated { mode } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.combat_mode = mode;
                }
            }
            _ => {}
        }
    }

    fn handle_entity_identified(&mut self, entity: &Entity) {
        if let Some(game) = self.game_option_mut() {
            let guid = entity.guid;
            game.data.entities.insert(guid, entity.clone());
            game.view.context_view = ContextView::Assess(guid);
        }
    }

    fn update_inventory_and_equipment(&mut self, entity: &Entity) {
        if let Some(game) = self.game_option_mut() {
            let guid = entity.guid;
            let pguid = game.data.player_guid;

            // Handle player position if it's the player entity
            if Some(guid) == pguid {
                game.data.player_pos = Some(entity.position);
            }

            // Update inventory tracking
            if let Some(pguid) = pguid {
                if let Some(cid) = entity.container_id()
                    && (cid == pguid || game.data.inventory.contains(&cid))
                {
                    game.data.inventory.insert(guid);
                } else if let Some(wid) = entity.wielder_id()
                    && wid == pguid
                {
                    game.data.inventory.insert(guid);
                } else {
                    // If it's no longer in our inventory/wielded, remove it
                    game.data.inventory.remove(&guid);
                }
            }

            // Update equipment tracking
            if let Some(pguid) = pguid
                && entity.wielder_id() == Some(pguid)
            {
                let mask = entity.wield_location();
                if mask.is_empty() {
                    game.data.equipment.remove(&guid);
                } else {
                    game.data.equipment.insert(guid, mask);
                }
            } else {
                game.data.equipment.remove(&guid);
            }

            game.data.entities.insert(entity.guid, entity.clone());
        }
    }

    fn handle_entity_removed(&mut self, guid: Guid) {
        if let Page::Game(_) = self.page {
            self.update_inventory_recursive(guid, false);
            if let Some(game) = self.game_option_mut() {
                game.data.entities.remove(&guid);
                game.data.equipment.remove(&guid);
                if game.view.current_debug_guid == Some(guid) {
                    game.view.current_debug_guid = None;
                }
            }
        }
    }

    fn handle_navigation_event(&mut self, event: ClientViewEvent) {
        if let ClientViewEvent::NoClipUpdated { enabled } = event
            && let Some(game) = self.game_option_mut() {
                game.data.noclip = enabled;
                let status = if enabled { "ENABLED" } else { "DISABLED" };
                self.chat.log(
                    ChatMessageKind::System,
                    format!(">> NoClip is now {}", status),
                );
            }
    }
}

