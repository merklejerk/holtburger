use crate::ui::ContextView;
use crate::ui::state::AppState;
use holtburger_core::ClientViewEvent;
use holtburger_world::entity::Entity;

impl AppState {
    pub(super) fn handle_combat_event(&mut self, event: ClientViewEvent) {
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
            ClientViewEvent::PlayerSpellsUpdated { spell_ids, spells } => {
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

    pub(super) fn handle_entity_identified(&mut self, entity: &Entity) {
        if let Some(game) = self.game_option_mut() {
            let guid = entity.guid;
            game.data.entities.insert(guid, entity.clone());
            game.view.context_view = ContextView::Assess(guid);
        }
    }
}
