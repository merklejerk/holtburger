use super::*;
use super::inventory;

pub(super) fn reduce_view_event(state: &mut GameState, event: ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        ClientViewEvent::PlayerEnchantmentsUpdated { enchantments } => {
            state.data.player_enchantments = enchantments;
        }
        ClientViewEvent::PlayerStatsSkillsUpdated {
            attributes,
            skills,
            resistances,
            armor,
            vitae,
        } => {
            state.data.attributes = attributes;
            state.data.skills = skills;
            state.data.resistances = resistances;
            state.data.armor = armor;
            state.data.vitae = vitae;
        }
        ClientViewEvent::PlayerLevelInfoUpdated { level_info } => {
            state.data.level_info = Some(level_info);
        }
        ClientViewEvent::PlayerVitalsUpdated { vitals } => {
            for (vt, value) in vitals {
                state.data.vitals.insert(vt, value);
            }
        }
        ClientViewEvent::PlayerSpellsUpdated { spell_ids } => {
            state.data.player_spells = spell_ids;
        }
        ClientViewEvent::PlayerOptionsUpdated { options } => {
            state.data.player_options = Some(options);
        }
        ClientViewEvent::CombatModeUpdated { mode } => {
            if mode != CombatMode::NonCombat {
                state.data.trade = None;
            }
            state.data.combat_mode = mode;
            state.data.combat_runtime.handle_mode_updated(mode);
            if matches!(
                mode,
                CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic
            ) {
                state.runtime.combat_automation = None;
            }
        }
        _ => {}
    }

    inventory::sync_weapon_swap_controller(state, Instant::now(), &mut result);
    result.request_redraw(RedrawPriority::Immediate);
    result
}

pub(super) fn apply_tick(state: &mut GameState, elapsed: f64, result: &mut UpdateResult) {
    let old_count = state.data.player_enchantments.len();
    state.data.player_enchantments.retain(|enchantment| {
        if enchantment.duration < 0.0 {
            return true;
        }
        let expires_at = enchantment.start_time + enchantment.duration;
        expires_at > 0.0
    });
    if state.data.player_enchantments.len() != old_count {
        result.request_redraw(RedrawPriority::Immediate);
    }

    for enchantment in &mut state.data.player_enchantments {
        if enchantment.duration >= 0.0 {
            enchantment.start_time -= elapsed;
        }
    }
}