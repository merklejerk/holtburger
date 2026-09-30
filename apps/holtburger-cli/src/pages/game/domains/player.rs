use super::*;
use holtburger_core::ClientCharacterSheet;

fn quote_basis_changed(state: &GameState, sheet: &ClientCharacterSheet) -> bool {
    let data = &state.data;
    data.level_info.as_ref().is_none_or(|level| {
        level.unspent_xp != sheet.level.unspent_xp
            || level.unspent_skill_points != sheet.level.unspent_skill_points
    }) || data.attributes.len() != sheet.attributes.len()
        || sheet.attributes.iter().any(|stat| {
            data.attributes
                .get(&stat.attr_type)
                .is_none_or(|old| old.ranks != stat.ranks || old.spent_xp != stat.spent_xp)
        })
        || data.vitals.len() != sheet.vitals.len()
        || sheet.vitals.iter().any(|stat| {
            data.vitals
                .get(&stat.vital_type)
                .is_none_or(|old| old.ranks != stat.ranks || old.spent_xp != stat.spent_xp)
        })
        || data.skills.len() != sheet.skills.len()
        || sheet.skills.iter().any(|row| {
            data.skills.get(&row.stat.skill_type).is_none_or(|old| {
                old.ranks != row.stat.ranks
                    || old.spent_xp != row.stat.spent_xp
                    || old.training != row.stat.training
            })
        })
}

fn apply_character_sheet(
    state: &mut GameState,
    sheet: Option<&ClientCharacterSheet>,
) -> UpdateResult {
    if sheet.is_some_and(|sheet| Some(sheet.character) != state.data.player_guid) {
        return UpdateResult::new();
    }
    let Some(sheet) = sheet else {
        state.data.level_info = None;
        state.data.attributes.clear();
        state.data.vitals.clear();
        state.data.skills.clear();
        state.data.resistances = Default::default();
        state.data.armor = 0;
        state.data.vitae = 1.0;
        state.data.player_enchantments.clear();
        state.data.resolved_enchantments = None;
        state.data.progression = Default::default();
        return UpdateResult::redraw();
    };
    let requote = quote_basis_changed(state, sheet);
    let data = &mut state.data;
    data.level_info = Some(sheet.level.clone());
    data.attributes = sheet
        .attributes
        .iter()
        .cloned()
        .map(|stat| (stat.attr_type, stat))
        .collect();
    data.vitals = sheet
        .vitals
        .iter()
        .cloned()
        .map(|stat| (stat.vital_type, stat))
        .collect();
    data.skills = sheet
        .skills
        .iter()
        .map(|row| (row.stat.skill_type, row.stat.clone()))
        .collect();
    data.resistances = sheet.resistances.clone();
    data.armor = sheet.armor;
    data.vitae = sheet.vitae;
    data.progression.guarded_targets = sheet.guarded_targets.iter().copied().collect();
    let mut result = UpdateResult::redraw();
    if requote {
        result.merge(super::progression::request_quotes(state));
    }
    result
}

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
        holtburger_core::BusyOperationResult::Failed { message } => {
            log::warn!("{} failed: {}", label, message);
        }
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
        ClientViewEvent::CharacterSheetUpdated(sheet) => {
            return apply_character_sheet(state, sheet.as_deref());
        }
        ClientViewEvent::ApplicationSnapshot(snapshot) => {
            if snapshot
                .character_sheet
                .as_ref()
                .is_some_and(|sheet| Some(sheet.character) != state.data.player_guid)
            {
                return UpdateResult::new();
            }
            state.data.resolved_enchantments = snapshot.enchantments.as_ref().map(|effects| {
                crate::pages::game::data::TimedResolvedEnchantments {
                    resolved: effects.resolved.clone(),
                    received_at: std::time::Instant::now(),
                }
            });
            state.data.player_enchantments = snapshot
                .enchantments
                .as_ref()
                .map_or_else(Vec::new, |effects| effects.records.clone());
            return apply_character_sheet(state, snapshot.character_sheet.as_deref());
        }
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
        ClientViewEvent::PlayerEnchantmentsUpdated {
            enchantments,
            resolved,
        } => {
            state.data.player_enchantments = enchantments.clone();
            state.data.resolved_enchantments =
                Some(crate::pages::game::data::TimedResolvedEnchantments {
                    resolved: resolved.clone(),
                    received_at: std::time::Instant::now(),
                });
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
            handled = true;
        }
        _ => {}
    }

    if handled {
        result.request_redraw(RedrawPriority::Immediate);
    }
    result
}

pub(super) fn apply_tick(state: &mut GameState, result: &mut UpdateResult) {
    if state
        .data
        .resolved_enchantments
        .as_ref()
        .is_some_and(|enchantments| !enchantments.resolved.instances.is_empty())
    {
        result.request_redraw(RedrawPriority::Motion);
    }
}
