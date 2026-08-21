//! Turning a motion command into an installed sequence.
//!
//! A port of retail's `CMotionTable` selection (`acclient.c:324230-324400`, mirrored by ACE
//! `MotionTable.GetObjectSequence`). The shape is retail's because the rules are: which link plays
//! between two states, when modifiers are cleared, when a speed change reuses the running clips
//! instead of restarting them, and which motion a stop falls back to.
//!
//! Selection is a free function over caller-owned state, not a service. Nothing is cached, and the
//! same inputs always produce the same outcome.

use holtburger_common::Vector3;
use holtburger_content::{MotionSequence, MotionSequenceTable};

use super::sequence::{MotionSequenceRuntime, SequenceNode};
use super::state::{MotionCommand, MotionState};

/// Smallest speed multiplier treated as nonzero, matching retail's physics epsilon.
const SPEED_EPSILON: f32 = 0.000_2;

/// What a selection did.
///
/// Retail returns one boolean for the first two, which loses the distinction a command surface
/// needs: issuing a command that is already running is a success that changed nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotionSelectionOutcome {
    /// The sequence and state now play the requested motion.
    Selected,
    /// The state already satisfies the request; nothing changed.
    AlreadyActive,
    /// The table does not model this motion from the current state.
    ///
    /// This is not an error. An entity performing a command its table has no entry for simply has
    /// no authored motion, and the caller falls through to whatever other authority it has.
    Unmodelled,
}

impl MotionSelectionOutcome {
    pub fn changed(self) -> bool {
        matches!(self, Self::Selected)
    }

    pub fn is_modelled(self) -> bool {
        !matches!(self, Self::Unmodelled)
    }
}

/// Puts the body into its table's default style and substate.
pub fn set_default_state(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
) -> MotionSelectionOutcome {
    let Some(default_substate) = table.style_default(table.default_style) else {
        return MotionSelectionOutcome::Unmodelled;
    };
    let Some(cycle) = table.cycle(table.default_style, default_substate) else {
        return MotionSelectionOutcome::Unmodelled;
    };

    state.clear_modifiers();
    state.style = MotionCommand(table.default_style);
    state.substate = MotionCommand(default_substate);
    state.substate_mod = 1.0;

    sequence.clear_physics();
    sequence.clear_animations();
    add_motion(sequence, Some(cycle), 1.0);

    MotionSelectionOutcome::Selected
}

/// Selects one motion command at a speed multiplier.
pub fn select_motion(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    command: MotionCommand,
    speed_mod: f32,
) -> MotionSelectionOutcome {
    select(table, state, sequence, command, speed_mod, false)
}

/// Stops one motion, returning the body to its style's default substate.
///
/// A substate stop re-selects the style default; a modifier stop removes that modifier's
/// contribution. Anything else is not stoppable and reports as unmodelled.
pub fn stop_motion(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    command: MotionCommand,
) -> MotionSelectionOutcome {
    if command.is_substate() && state.substate == command {
        let Some(default_substate) = table.style_default(state.style.raw()) else {
            return MotionSelectionOutcome::Unmodelled;
        };
        select(
            table,
            state,
            sequence,
            MotionCommand(default_substate),
            1.0,
            true,
        );
        return MotionSelectionOutcome::Selected;
    }

    if !command.is_modifier() {
        return MotionSelectionOutcome::Unmodelled;
    }

    let Some(active) = state
        .modifiers()
        .iter()
        .find(|modifier| modifier.command == command)
        .copied()
    else {
        return MotionSelectionOutcome::Unmodelled;
    };
    let Some(modifier) = lookup_modifier(table, state, command) else {
        return MotionSelectionOutcome::Unmodelled;
    };

    subtract_motion(sequence, modifier, active.speed_mod);
    state.remove_modifier(command);
    MotionSelectionOutcome::Selected
}

/// Stops every modifier and then the substate, retail's `StopObjectCompletely`.
pub fn stop_completely(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
) -> MotionSelectionOutcome {
    let mut outcome = MotionSelectionOutcome::Unmodelled;

    while let Some(modifier) = state.modifiers().first().copied() {
        if stop_motion(table, state, sequence, modifier.command).changed() {
            outcome = MotionSelectionOutcome::Selected;
        } else {
            // The modifier is unstoppable through the table; drop it rather than spin.
            state.remove_modifier(modifier.command);
        }
    }

    if stop_motion(table, state, sequence, state.substate).changed() {
        MotionSelectionOutcome::Selected
    } else {
        outcome
    }
}

fn select(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    command: MotionCommand,
    speed_mod: f32,
    stop_modifiers: bool,
) -> MotionSelectionOutcome {
    if state.style.raw() == 0 || state.substate.raw() == 0 {
        return MotionSelectionOutcome::Unmodelled;
    }
    let style_default = table.style_default(state.style.raw());

    // Re-issuing the style's default substate while a modifier is driving the body is a no-op:
    // the default is what the body falls back to, and it is already the thing being modified.
    if Some(command.raw()) == style_default && !stop_modifiers && state.substate.is_modifier() {
        return MotionSelectionOutcome::AlreadyActive;
    }

    if command.is_style()
        && let outcome = select_style(table, state, sequence, command, speed_mod, style_default)
        && outcome.is_modelled()
    {
        return outcome;
    }

    if command.is_substate()
        && let outcome = select_substate(table, state, sequence, command, speed_mod)
        && outcome.is_modelled()
    {
        return outcome;
    }

    if command.is_modifier() {
        return select_modifier(table, state, sequence, command, speed_mod);
    }

    MotionSelectionOutcome::Unmodelled
}

/// Changing stance: play out of the current substate, through the style transition, and into the
/// new style's default substate.
fn select_style(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    command: MotionCommand,
    speed_mod: f32,
    style_default: Option<u32>,
) -> MotionSelectionOutcome {
    if state.style == command {
        return MotionSelectionOutcome::AlreadyActive;
    }
    let Some(style_default) = style_default.filter(|default| *default != 0) else {
        return MotionSelectionOutcome::Unmodelled;
    };

    // Leaving whatever substate is running for the style's default one.
    let exit = (style_default != state.substate.raw())
        .then(|| {
            get_link(
                table,
                state.style.raw(),
                state.substate.raw(),
                state.substate_mod,
                style_default,
                speed_mod,
            )
        })
        .flatten();

    let Some(cycle) = table.cycle(command.raw(), style_default) else {
        return MotionSelectionOutcome::Unmodelled;
    };
    if cycle.clears_modifiers {
        state.clear_modifiers();
    }

    let mut link = get_link(
        table,
        state.style.raw(),
        style_default,
        state.substate_mod,
        command.raw(),
        speed_mod,
    );
    let mut through_default_style = None;
    if link.is_none() && state.style != command {
        // No direct transition between these styles, so route through the table's default style.
        link = get_link(
            table,
            state.style.raw(),
            style_default,
            1.0,
            table.default_style,
            1.0,
        );
        through_default_style =
            table
                .style_default(table.default_style)
                .and_then(|default_substate| {
                    get_link(
                        table,
                        table.default_style,
                        default_substate,
                        1.0,
                        command.raw(),
                        1.0,
                    )
                });
    }

    sequence.clear_physics();
    sequence.remove_cyclic_clips();
    add_motion(sequence, exit, speed_mod);
    add_motion(sequence, link, speed_mod);
    add_motion(sequence, through_default_style, speed_mod);
    add_motion(sequence, Some(cycle), speed_mod);

    state.substate = MotionCommand(style_default);
    state.style = command;
    state.substate_mod = speed_mod;
    re_modify(table, state, sequence);

    MotionSelectionOutcome::Selected
}

/// Changing what the body is doing within its stance: walking, running, turning, standing.
fn select_substate(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    command: MotionCommand,
    speed_mod: f32,
) -> MotionSelectionOutcome {
    let Some(cycle) = table
        .cycle(state.style.raw(), command.raw())
        .or_else(|| table.cycle(table.default_style, command.raw()))
    else {
        return MotionSelectionOutcome::Unmodelled;
    };
    if !is_allowed(table, state, command, cycle) {
        return MotionSelectionOutcome::Unmodelled;
    }

    // Same motion at a new speed in the same direction: rescale the running clips instead of
    // restarting them, so a walk-to-run change does not snap the cursor back to frame zero.
    if command == state.substate
        && sequence.has_clips()
        && speed_mod.is_sign_negative() == state.substate_mod.is_sign_negative()
    {
        change_cycle_speed(sequence, state.substate_mod, speed_mod);
        subtract_motion(sequence, cycle, state.substate_mod);
        combine_motion(sequence, cycle, speed_mod);
        state.substate_mod = speed_mod;
        return MotionSelectionOutcome::Selected;
    }

    if cycle.clears_modifiers {
        state.clear_modifiers();
    }

    let style_default = table.style_default(state.style.raw());
    let mut link = get_link(
        table,
        state.style.raw(),
        state.substate.raw(),
        state.substate_mod,
        command.raw(),
        speed_mod,
    );
    let mut through_default = None;
    if link.is_none() || speed_mod.is_sign_negative() != state.substate_mod.is_sign_negative() {
        // Either no direct transition, or the direction reverses. Both route through the style's
        // default substate, which every style is guaranteed to have a link to.
        let default_substate = style_default.unwrap_or(0);
        link = get_link(
            table,
            state.style.raw(),
            state.substate.raw(),
            state.substate_mod,
            default_substate,
            1.0,
        );
        through_default = get_link(
            table,
            state.style.raw(),
            default_substate,
            1.0,
            command.raw(),
            speed_mod,
        );
    }

    sequence.clear_physics();
    sequence.remove_cyclic_clips();

    if through_default.is_some() {
        add_motion(sequence, link, state.substate_mod);
        add_motion(sequence, through_default, speed_mod);
    } else {
        // Leaving a reversed substate for a forward one plays the single transition backwards.
        let mut link_speed = speed_mod;
        if state.substate_mod < 0.0 && speed_mod > 0.0 {
            link_speed *= -1.0;
        }
        add_motion(sequence, link, link_speed);
    }

    add_motion(sequence, Some(cycle), speed_mod);

    // A modifier that was promoted to substate keeps running as a modifier once displaced.
    if state.substate != command
        && state.substate.is_modifier()
        && style_default != Some(command.raw())
    {
        state.add_modifier_unchecked(state.substate, state.substate_mod);
    }

    state.substate_mod = speed_mod;
    state.substate = command;
    re_modify(table, state, sequence);

    MotionSelectionOutcome::Selected
}

/// Layering an additive motion on top of whatever the body is already doing.
fn select_modifier(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    command: MotionCommand,
    speed_mod: f32,
) -> MotionSelectionOutcome {
    // A substate that clears modifiers cannot accept one.
    let Some(cycle) = table.cycle(state.style.raw(), state.substate.raw()) else {
        return MotionSelectionOutcome::Unmodelled;
    };
    if cycle.clears_modifiers {
        return MotionSelectionOutcome::Unmodelled;
    }
    let Some(modifier) = lookup_modifier(table, state, command) else {
        return MotionSelectionOutcome::Unmodelled;
    };

    if !state.add_modifier(command, speed_mod) {
        stop_motion(table, state, sequence, command);
        if !state.add_modifier(command, speed_mod) {
            return MotionSelectionOutcome::Unmodelled;
        }
    }
    combine_motion(sequence, modifier, speed_mod);
    MotionSelectionOutcome::Selected
}

/// Modifiers are looked up under the current style first and then unstyled, so a table can define
/// one modifier that applies in every stance.
fn lookup_modifier<'table>(
    table: &'table MotionSequenceTable,
    state: &MotionState,
    command: MotionCommand,
) -> Option<&'table MotionSequence> {
    table
        .modifier(state.style.raw(), command.raw())
        .or_else(|| table.modifier(0, command.raw()))
}

/// Retail's `CMotionTable::is_allowed` (`acclient.c:324103-324129`).
///
/// A motion flagged as requiring the default substate can only start from it, or from itself.
fn is_allowed(
    table: &MotionSequenceTable,
    state: &MotionState,
    command: MotionCommand,
    cycle: &MotionSequence,
) -> bool {
    if !cycle.requires_default_substate || command == state.substate {
        return true;
    }
    table.style_default(state.style.raw()) == Some(state.substate.raw())
}

/// Retail's `CMotionTable::get_link` (`acclient.c:326960-327030`, ACE `MotionTable.get_link`).
///
/// Playing backwards swaps which end of the transition is the key, because the same clip is being
/// traversed in the other direction.
fn get_link(
    table: &MotionSequenceTable,
    style: u32,
    substate: u32,
    substate_speed: f32,
    motion: u32,
    speed: f32,
) -> Option<&MotionSequence> {
    if speed < 0.0 || substate_speed < 0.0 {
        if let Some(reversed) = table.link(style, motion, substate) {
            return Some(reversed);
        }
        let default_motion = table.style_default(style)?;
        return table.link(style, substate, default_motion);
    }

    table
        .link(style, substate, motion)
        .or_else(|| table.link(style, 0, motion))
}

/// Installs one motion's clips and replaces the sequence's motion-data velocity and omega.
///
/// Retail *assigns* rather than accumulating here, so the last motion installed owns the explicit
/// vectors; only modifiers combine and subtract.
fn add_motion(sequence: &mut MotionSequenceRuntime, motion: Option<&MotionSequence>, speed: f32) {
    let Some(motion) = motion else {
        return;
    };
    sequence.set_physics(
        motion.velocity.unwrap_or_else(Vector3::zero) * speed,
        motion.omega.unwrap_or_else(Vector3::zero) * speed,
    );
    for clip in &motion.clips {
        sequence.append(SequenceNode::install(clip, speed));
    }
}

fn combine_motion(sequence: &mut MotionSequenceRuntime, motion: &MotionSequence, speed: f32) {
    sequence.combine_physics(
        motion.velocity.unwrap_or_else(Vector3::zero) * speed,
        motion.omega.unwrap_or_else(Vector3::zero) * speed,
    );
}

fn subtract_motion(sequence: &mut MotionSequenceRuntime, motion: &MotionSequence, speed: f32) {
    sequence.subtract_physics(
        motion.velocity.unwrap_or_else(Vector3::zero) * speed,
        motion.omega.unwrap_or_else(Vector3::zero) * speed,
    );
}

/// Rescales the looping clips when the same substate is re-issued at a new speed.
fn change_cycle_speed(sequence: &mut MotionSequenceRuntime, substate_mod: f32, speed_mod: f32) {
    if substate_mod.abs() > SPEED_EPSILON {
        sequence.multiply_cyclic_framerate(speed_mod / substate_mod);
    } else if speed_mod.abs() < SPEED_EPSILON {
        sequence.multiply_cyclic_framerate(0.0);
    }
}

/// Re-installs the active modifiers onto a sequence that was just rebuilt.
///
/// Selecting a substate clears the sequence, which drops every modifier's contribution with it.
/// Retail replays them from the state so the rebuilt sequence carries them again.
///
/// RETAIL DIVERGENCE: retail iterates a snapshot while repeatedly popping and re-selecting the live
/// list's head (`CMotionTable::re_modify`, `acclient.c:323847-323874`; ACE
/// `MotionTable.re_modify` matches). With N modifiers that installs the head N times and none of the
/// rest. We preserve the semantic list and combine every active modifier's physics exactly once.
/// This makes simultaneous sidestep and turn independent of list order; correcting retail changes
/// stacked modifier velocity or omega after a stance or substate rebuild. The archive contains
/// 1,222 turn/sidestep modifier records, and interpreted movement can activate sidestep and turn
/// together, so the defect is reachable through the normal control surface rather than dead code.
fn re_modify(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
) {
    for modifier in state.modifiers() {
        if let Some(motion) = lookup_modifier(table, state, modifier.command) {
            combine_motion(sequence, motion, modifier.speed_mod);
        }
    }
}
