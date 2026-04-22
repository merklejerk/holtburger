use super::inventory;
use super::*;

fn log_busy_operation_result(
    operation: holtburger_core::BusyOperationKind,
    result: &holtburger_core::BusyOperationResult,
) {
    let label = match operation {
        holtburger_core::BusyOperationKind::Use => "Use",
        holtburger_core::BusyOperationKind::UseWithTarget => "Use-with-target",
        holtburger_core::BusyOperationKind::Salvage => "Salvage",
        holtburger_core::BusyOperationKind::SpellCast => "Spell cast",
        holtburger_core::BusyOperationKind::Buy => "Buy",
        holtburger_core::BusyOperationKind::Sell => "Sell",
    };

    match result {
        holtburger_core::BusyOperationResult::Completed {
            error: holtburger_protocol::errors::WeenieError::None,
            ..
        } => {
            log::debug!("{} finished.", label);
        }
        holtburger_core::BusyOperationResult::Completed { error, parameter } => match parameter {
            Some(parameter) => {
                log::warn!("{} finished with {:?} ({}).", label, error, parameter);
            }
            None => {
                log::warn!("{} finished with {:?}.", label, error);
            }
        },
        holtburger_core::BusyOperationResult::TimedOut => {
            log::warn!("{} timed out waiting for UseDone.", label);
        }
    }
}

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();
    let mut handled = false;

    match event {
        ClientViewEvent::BusyStateUpdated { busy } => {
            state.view.active_busy_operation = *busy;
            handled = true;
        }
        ClientViewEvent::BusyOperationFinished {
            operation,
            result: busy_result,
        } => {
            log_busy_operation_result(*operation, busy_result);
            result.request_redraw(RedrawPriority::Immediate);
            handled = true;
        }
        ClientViewEvent::PlayerEnchantmentsUpdated { enchantments } => {
            state.data.player_enchantments = enchantments.clone();
            handled = true;
        }
        ClientViewEvent::PlayerStatsSkillsUpdated {
            attributes,
            skills,
            resistances,
            armor,
            vitae,
        } => {
            state.data.attributes = attributes.clone();
            state.data.skills = skills.clone();
            state.data.resistances = resistances.clone();
            state.data.armor = *armor;
            state.data.vitae = *vitae;
            handled = true;
        }
        ClientViewEvent::PlayerLevelInfoUpdated { level_info } => {
            state.data.level_info = Some(level_info.clone());
            handled = true;
        }
        ClientViewEvent::PlayerVitalsUpdated { vitals } => {
            for (vt, value) in vitals.iter() {
                state.data.vitals.insert(*vt, value.clone());
            }
            handled = true;
        }
        ClientViewEvent::PlayerSpellsUpdated { spell_ids } => {
            state.data.player_spells = spell_ids.clone();
            handled = true;
        }
        ClientViewEvent::PlayerOptionsUpdated { options } => {
            state.data.player_options = Some(*options);
            handled = true;
        }
        ClientViewEvent::CombatModeUpdated { mode } => {
            if *mode != CombatMode::NonCombat {
                state.data.trade = None;
            }
            state.data.combat_mode = *mode;
            state.data.combat_runtime.handle_mode_updated(*mode);
            if matches!(
                mode,
                CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic
            ) {
                state.clear_combat_drive();
            }
            handled = true;
        }
        _ => {}
    }

    inventory::sync_weapon_swap_controller(state, Instant::now(), &mut result);
    if handled {
        result.request_redraw(RedrawPriority::Immediate);
    }
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
