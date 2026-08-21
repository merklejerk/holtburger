//! The runtime motion contract: one simulation-grade projection of raw motion tables and
//! animations, shared by every host.
//!
//! Raw content is the canonical source and this projection is the canonical runtime contract. It
//! exists because a host simulation's appetite is a strict subset of what an animation record
//! carries: root transforms, clip identity with ranges and rates, explicit velocity and omega,
//! selection semantics, and the simulation-relevant hooks. Articulated part frames and
//! presentation hooks stay with the raw animations the frontend reads, so the
//! simulation/presentation boundary is enforced by the type rather than by convention.
//!
//! The contract is built in memory and never serialized. A baked form would need a codec, a
//! version, and a second place for motion facts to drift.

use holtburger_common::{RigidTransform, Vector3};
use holtburger_dat::file_type::motion_table::MotionData;
use holtburger_dat::file_type::setup_model::{
    AnimationHook, AnimationHookPayload, AttackConeHookPayload, ReplaceObjectHookPayload,
};
use holtburger_dat::file_type::{Animation, MotionTable};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;

/// Refusals raised while projecting raw content, all of them archive-integrity failures.
///
/// Resolution-time absence — an entity performing a command its table does not model — is not an
/// error and is not represented here.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum MotionContractError {
    #[error(
        "motion table 0x{motion_table_id:08X} references animation 0x{animation_id:08X}, \
         which the archive does not contain"
    )]
    MissingAnimation {
        motion_table_id: u32,
        animation_id: u32,
    },
    #[error(
        "animation 0x{animation_id:08X} declares {declared} frames but carries {present} \
         part-frame records"
    )]
    FrameCountMismatch {
        animation_id: u32,
        declared: u32,
        present: usize,
    },
    #[error(
        "animation 0x{animation_id:08X} declares {declared} frames but carries {present} \
         root position frames"
    )]
    RootTrackLengthMismatch {
        animation_id: u32,
        declared: u32,
        present: usize,
    },
    #[error("animation 0x{animation_id:08X} declares no frames, so no clip can traverse it")]
    EmptyAnimation { animation_id: u32 },
    #[error(
        "animation 0x{animation_id:08X} carries a hook with direction {direction}, \
         which is neither forward, backward, nor both"
    )]
    UnknownHookDirection { animation_id: u32, direction: i32 },
}

/// Every motion fact a host simulation reads, keyed the way retail keys it.
#[derive(Debug, Clone, Default)]
pub struct MotionSequenceCatalog {
    /// Motion table each setup model installs by default, retail's `CSetup` field applied by
    /// `CPhysicsObj::InitDefaults` (`acclient.c:309089-309103`). An object's own motion-table
    /// property overrides it; this is the fallback when it has none.
    setup_default_tables: HashMap<u32, u32>,
    tables: HashMap<u32, MotionSequenceTable>,
}

impl MotionSequenceCatalog {
    /// Projects parsed raw records into the contract.
    ///
    /// Every animation a table references must be present: the projection resolves each reference
    /// once so no consumer ever holds an unresolvable clip.
    pub fn assemble(
        tables: impl IntoIterator<Item = MotionTable>,
        animations: impl IntoIterator<Item = Animation>,
        setup_default_tables: impl IntoIterator<Item = (u32, u32)>,
    ) -> Result<Self, MotionContractError> {
        let projected: HashMap<u32, Arc<MotionAnimation>> = animations
            .into_iter()
            .map(|animation| {
                MotionAnimation::project(animation).map(|value| (value.id, Arc::new(value)))
            })
            .collect::<Result<_, _>>()?;

        let tables = tables
            .into_iter()
            .map(|table| {
                MotionSequenceTable::project(table, &projected).map(|value| (value.id, value))
            })
            .collect::<Result<_, _>>()?;

        Ok(Self {
            setup_default_tables: setup_default_tables.into_iter().collect(),
            tables,
        })
    }

    pub fn table(&self, motion_table_id: u32) -> Option<&MotionSequenceTable> {
        self.tables.get(&motion_table_id)
    }

    pub fn default_motion_table_for_setup(&self, setup_model_id: u32) -> Option<u32> {
        self.setup_default_tables.get(&setup_model_id).copied()
    }

    pub fn tables(&self) -> impl Iterator<Item = &MotionSequenceTable> {
        self.tables.values()
    }

    pub fn setup_default_tables(&self) -> impl Iterator<Item = (u32, u32)> + '_ {
        self.setup_default_tables
            .iter()
            .map(|(setup, table)| (*setup, *table))
    }
}

/// One motion table's projection.
///
/// Cycles hold looping motion keyed by style and command, modifiers layer additively, and links
/// are the transition clips played between two states. All three are the same record type, so all
/// three project to `MotionSequence`.
#[derive(Debug, Clone)]
pub struct MotionSequenceTable {
    pub id: u32,
    /// Style a table falls back to when the requested one has no entry.
    pub default_style: u32,
    style_defaults: HashMap<u32, u32>,
    cycles: HashMap<u32, MotionSequence>,
    modifiers: HashMap<u32, MotionSequence>,
    links: HashMap<u32, HashMap<u32, MotionSequence>>,
}

impl MotionSequenceTable {
    fn project(
        table: MotionTable,
        animations: &HashMap<u32, Arc<MotionAnimation>>,
    ) -> Result<Self, MotionContractError> {
        let motion_table_id = table.id;
        let project_map = |map: HashMap<u32, MotionData>| {
            map.into_iter()
                .map(|(key, data)| {
                    MotionSequence::project(motion_table_id, data, animations)
                        .map(|sequence| (key, sequence))
                })
                .collect::<Result<HashMap<_, _>, _>>()
        };

        Ok(Self {
            id: table.id,
            default_style: table.default_style,
            style_defaults: table.style_defaults,
            cycles: project_map(table.cycles)?,
            modifiers: project_map(table.modifiers)?,
            links: table
                .links
                .into_iter()
                .map(|(from, targets)| project_map(targets).map(|targets| (from, targets)))
                .collect::<Result<HashMap<_, _>, _>>()?,
        })
    }

    /// Looping motion for one style and command.
    pub fn cycle(&self, style: u32, command: u32) -> Option<&MotionSequence> {
        self.cycles.get(&MotionTable::cycle_key(style, command))
    }

    /// Additive modifier for one style and command.
    pub fn modifier(&self, style: u32, command: u32) -> Option<&MotionSequence> {
        self.modifiers.get(&MotionTable::cycle_key(style, command))
    }

    /// Transition clip played when leaving `from_state` under `style` toward `to_motion`.
    ///
    /// The outer key masks the state the way a cycle key does; the inner key is the target motion
    /// verbatim (ACE `MotionTable.get_link`). Rate-sign key swapping and the style-default
    /// fallbacks are selection policy and live with the resolver, not here.
    pub fn link(&self, style: u32, from_state: u32, to_motion: u32) -> Option<&MotionSequence> {
        self.links
            .get(&MotionTable::cycle_key(style, from_state))
            .and_then(|targets| targets.get(&to_motion))
    }

    /// Substate a style rests in when no command is active.
    pub fn style_default(&self, style: u32) -> Option<u32> {
        self.style_defaults.get(&style).copied()
    }

    /// Every animation this table can reach, through cycles, modifiers, and links alike.
    ///
    /// Links matter disproportionately: 1,174 animations across the archive are reachable no other
    /// way, so a closure built from cycles alone would miss most transitions.
    pub fn reachable_animation_ids(&self) -> impl Iterator<Item = u32> + '_ {
        let linked = self.links.values().flat_map(|targets| targets.values());
        self.cycles
            .values()
            .chain(self.modifiers.values())
            .chain(linked)
            .flat_map(|sequence| sequence.clips.iter().map(|clip| clip.animation.id))
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
    }

    pub fn cycle_count(&self) -> usize {
        self.cycles.len()
    }

    pub fn cycles(&self) -> impl Iterator<Item = (u32, &MotionSequence)> {
        self.cycles.iter().map(|(key, sequence)| (*key, sequence))
    }
}

/// One motion-table record projected for simulation: the clips it plays in order, the explicit
/// kinematics the table authored alongside them, and the selection rules that gate it.
#[derive(Debug, Clone)]
pub struct MotionSequence {
    /// Clips in playback order. Retail advances them under one cursor and carries proportional
    /// leftover time across each boundary (`acclient.c:327134-327213`).
    pub clips: Vec<MotionClip>,
    /// Motion-data velocity, folded into the tick's composed offset as `velocity * dt`
    /// (`acclient.c:326355-326382`). It is a per-tick contribution, not retained momentum.
    pub velocity: Option<Vector3>,
    /// Motion-data omega, applied to the composed offset as a *local* rotation. Same lifetime
    /// rules as `velocity`: it is rotation in a rigid transform, never angular momentum.
    pub omega: Option<Vector3>,
    /// Bit 0 of the record's bitfield: starting this motion clears the active modifiers
    /// (`acclient.c:324307`, ACE `MotionTable.cs:88`).
    pub clears_modifiers: bool,
    /// Bit 1: this motion is only reachable from the style's default substate
    /// (`CMotionTable::is_allowed`, `acclient.c:324103-324129`).
    pub requires_default_substate: bool,
}

impl MotionSequence {
    fn project(
        motion_table_id: u32,
        data: MotionData,
        animations: &HashMap<u32, Arc<MotionAnimation>>,
    ) -> Result<Self, MotionContractError> {
        let clips = data
            .anims
            .into_iter()
            .map(|anim| {
                let animation = animations.get(&anim.anim_id).cloned().ok_or(
                    MotionContractError::MissingAnimation {
                        motion_table_id,
                        animation_id: anim.anim_id,
                    },
                )?;
                Ok(MotionClip::resolve(
                    animation,
                    anim.low_frame,
                    anim.high_frame,
                    anim.framerate,
                ))
            })
            .collect::<Result<Vec<_>, MotionContractError>>()?;

        Ok(Self {
            clips,
            velocity: data.velocity,
            omega: data.omega,
            clears_modifiers: data.bitfield & 0x01 != 0,
            requires_default_substate: data.bitfield & 0x02 != 0,
        })
    }

    /// Whether the sequence can move a body at all, by authored root motion or explicit vectors.
    pub fn is_motionless(&self) -> bool {
        self.velocity.is_none()
            && self.omega.is_none()
            && self
                .clips
                .iter()
                .all(|clip| clip.animation.root.is_stationary())
    }
}

/// One animation reference inside a sequence, with the traversal window and rate that selected it.
#[derive(Debug, Clone)]
pub struct MotionClip {
    pub animation: Arc<MotionAnimation>,
    /// First frame of the window, resolved against the animation's frame count.
    pub low_frame: u32,
    /// Last frame of the window, inclusive and never below `low_frame`.
    pub high_frame: u32,
    /// Frames per second. A negative rate traverses the window backwards; a zero rate holds the
    /// starting frame, which real content authors 11,182 times.
    pub framerate: f32,
}

impl MotionClip {
    /// Resolves an authored window against the animation it traverses.
    ///
    /// Retail performs exactly these clamps when it installs an animation into a sequence node
    /// (`AnimSequenceNode::set_animation_id`, `acclient.c:327498-327532`; ACE
    /// `AnimSequenceNode.set_animation_id`). Doing it once here means no consumer re-derives the
    /// window or has to know that `-1` means "to the end".
    fn resolve(animation: Arc<MotionAnimation>, low: i32, high: i32, framerate: f32) -> Self {
        let last = animation.frame_count.saturating_sub(1);
        let high = if high < 0 {
            last
        } else {
            (high as u32).min(last)
        };
        let low = if low < 0 { 0 } else { (low as u32).min(last) };

        Self {
            animation,
            low_frame: low,
            high_frame: high.max(low),
            framerate,
        }
    }

    /// Frames the window spans, always at least one.
    pub fn frame_span(&self) -> u32 {
        self.high_frame - self.low_frame + 1
    }
}

/// The simulation-relevant projection of one animation record.
#[derive(Debug, Clone)]
pub struct MotionAnimation {
    pub id: u32,
    /// Frames the record declares. Clip windows are resolved against it.
    pub frame_count: u32,
    pub root: RootMotionTrack,
    pub hooks: MotionHookTrack,
}

impl MotionAnimation {
    fn project(animation: Animation) -> Result<Self, MotionContractError> {
        let animation_id = animation.id;
        let declared = animation.num_frames;
        if declared == 0 {
            return Err(MotionContractError::EmptyAnimation { animation_id });
        }
        if animation.part_frames.len() != declared as usize {
            return Err(MotionContractError::FrameCountMismatch {
                animation_id,
                declared,
                present: animation.part_frames.len(),
            });
        }
        if !animation.pos_frames.is_empty() && animation.pos_frames.len() != declared as usize {
            return Err(MotionContractError::RootTrackLengthMismatch {
                animation_id,
                declared,
                present: animation.pos_frames.len(),
            });
        }

        let root = RootMotionTrack {
            frames: animation
                .pos_frames
                .into_iter()
                .map(|frame| RigidTransform {
                    translation: frame.origin,
                    rotation: frame.orientation,
                })
                .collect(),
        };

        let mut hooks = Vec::new();
        for (frame, part_frame) in animation.part_frames.into_iter().enumerate() {
            for hook in part_frame.hooks {
                if let Some(effect) = MotionHookEffect::project(&hook) {
                    hooks.push(MotionHook {
                        frame: frame as u32,
                        direction: MotionHookDirection::project(hook.direction).ok_or(
                            MotionContractError::UnknownHookDirection {
                                animation_id,
                                direction: hook.direction,
                            },
                        )?,
                        effect,
                    });
                }
            }
        }

        Ok(Self {
            id: animation_id,
            frame_count: declared,
            root,
            hooks: MotionHookTrack { hooks },
        })
    }
}

/// Ordered per-frame authored root offsets, one entry per animation frame, or empty when the
/// animation authors no root motion — which is the case for 1,585 of 1,938 referenced animations.
///
/// The track is the authored program, not a sampled path: retail composes the frames a tick
/// departs into a single rigid offset with `Frame::combine` before applying it once.
#[derive(Debug, Clone, Default)]
pub struct RootMotionTrack {
    frames: Vec<RigidTransform>,
}

impl RootMotionTrack {
    /// The offset authored for one frame, or `None` when the animation authors no root motion.
    pub fn offset(&self, frame: u32) -> Option<RigidTransform> {
        self.frames.get(frame as usize).copied()
    }

    pub fn is_stationary(&self) -> bool {
        self.frames.is_empty()
    }

    pub fn frames(&self) -> &[RigidTransform] {
        &self.frames
    }

    /// Composes the authored offsets across an inclusive frame range into one rigid transform.
    ///
    /// Ordered composition is exactly what retail does per tick, so this is the same operation at a
    /// different granularity rather than an approximation of it. Frames outside the track are
    /// skipped, which is how a stationary animation composes to identity.
    pub fn composed_over(&self, low_frame: u32, high_frame: u32) -> RigidTransform {
        let range = low_frame as usize..=high_frame as usize;
        self.frames
            .get(range)
            .unwrap_or_default()
            .iter()
            .fold(RigidTransform::identity(), |accumulated, frame| {
                accumulated.combine(frame)
            })
    }
}

/// Simulation-relevant hooks, ordered by the frame that fires them.
///
/// Retail fires hooks once per departed frame with a direction of `+1` forward and `-1` reverse
/// (`CSequence::execute_hooks`, `acclient.c:326199-326213`), so the track carries a frame index and
/// a direction — never a phase or a duration.
#[derive(Debug, Clone, Default)]
pub struct MotionHookTrack {
    hooks: Vec<MotionHook>,
}

impl MotionHookTrack {
    pub fn is_empty(&self) -> bool {
        self.hooks.is_empty()
    }

    /// Hooks the given frame fires when departed in the given direction.
    pub fn at(
        &self,
        frame: u32,
        direction: MotionHookDirection,
    ) -> impl Iterator<Item = &MotionHook> {
        self.hooks
            .iter()
            .filter(move |hook| hook.frame == frame && hook.fires_in(direction))
    }

    pub fn hooks(&self) -> &[MotionHook] {
        &self.hooks
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MotionHook {
    /// Frame whose departure fires this hook.
    pub frame: u32,
    pub direction: MotionHookDirection,
    pub effect: MotionHookEffect,
}

impl MotionHook {
    fn fires_in(&self, direction: MotionHookDirection) -> bool {
        self.direction == MotionHookDirection::Both || self.direction == direction
    }
}

/// Playback directions a hook fires in. Retail gates with `!direction || dir == direction`, so a
/// stored zero fires both ways.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotionHookDirection {
    Both,
    Forward,
    Backward,
}

impl MotionHookDirection {
    fn project(direction: i32) -> Option<Self> {
        match direction {
            0 => Some(Self::Both),
            1 => Some(Self::Forward),
            -1 => Some(Self::Backward),
            _ => None,
        }
    }
}

/// The three hook effects retail content actually authors inside table-reachable animations.
///
/// `Scale`, `SetOmega`, and `AnimationDone` occur zero times in that content, so the contract does
/// not carry variants nothing produces. A future consumer would reach those through setup defaults
/// or physics scripts instead.
///
/// Both variants below are carried and unconsumed: combat and collision-state systems are future
/// work, and preserving the hooks now means that work needs no re-plumbing.
#[derive(Debug, Clone, PartialEq)]
pub enum MotionHookEffect {
    Attack(AttackConeHookPayload),
    Ethereal { ethereal: bool },
    ReplaceObject(ReplaceObjectHookPayload),
}

impl MotionHookEffect {
    fn project(hook: &AnimationHook) -> Option<Self> {
        match &hook.payload {
            AnimationHookPayload::Attack(cone) => Some(Self::Attack(*cone)),
            AnimationHookPayload::Ethereal(payload) => Some(Self::Ethereal {
                ethereal: payload.ethereal,
            }),
            AnimationHookPayload::ReplaceObject(payload) => Some(Self::ReplaceObject(*payload)),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Quaternion;
    use holtburger_dat::file_type::animation::AnimationFlags;
    use holtburger_dat::file_type::motion_table::{AnimData, MotionDataFlags};
    use holtburger_dat::file_type::setup_model::{
        AnimationFrame, AttackConeHookPayload, EtherealHookPayload,
    };
    use holtburger_dat::graphics::Frame;
    use std::collections::HashMap;

    const TABLE_ID: u32 = 0x0900_0001;
    const STYLE: u32 = 0x8000_003D;
    const ANIMATION_ID: u32 = 0x0300_0003;

    fn translation_frame(y: f32) -> Frame {
        Frame {
            origin: Vector3::new(0.0, y, 0.0),
            orientation: Quaternion::identity(),
        }
    }

    fn animation(frames: usize, hooks: Vec<(usize, AnimationHook)>) -> Animation {
        let mut part_frames: Vec<AnimationFrame> = (0..frames)
            .map(|_| AnimationFrame {
                frames: Vec::new(),
                hooks: Vec::new(),
            })
            .collect();
        for (frame, hook) in hooks {
            part_frames[frame].hooks.push(hook);
        }

        Animation {
            id: ANIMATION_ID,
            flags: AnimationFlags::POS_FRAMES,
            num_parts: 0,
            num_frames: frames as u32,
            pos_frames: (0..frames).map(|_| translation_frame(0.5)).collect(),
            part_frames,
        }
    }

    fn table(anims: Vec<AnimData>, bitfield: u8) -> MotionTable {
        let mut cycles = HashMap::new();
        cycles.insert(
            MotionTable::cycle_key(STYLE, MotionTable::WALK_FORWARD_COMMAND),
            MotionData {
                bitfield,
                flags: MotionDataFlags::empty(),
                anims,
                velocity: None,
                omega: None,
            },
        );

        MotionTable {
            id: TABLE_ID,
            default_style: STYLE,
            style_defaults: HashMap::from([(STYLE, MotionTable::WALK_FORWARD_COMMAND)]),
            cycles,
            modifiers: HashMap::new(),
            links: HashMap::new(),
        }
    }

    fn anim_data(low_frame: i32, high_frame: i32) -> AnimData {
        AnimData {
            anim_id: ANIMATION_ID,
            low_frame,
            high_frame,
            framerate: 30.0,
        }
    }

    fn walk_clip(catalog: &MotionSequenceCatalog) -> MotionClip {
        catalog
            .table(TABLE_ID)
            .expect("table should project")
            .cycle(STYLE, MotionTable::WALK_FORWARD_COMMAND)
            .expect("walk cycle should project")
            .clips[0]
            .clone()
    }

    /// Retail resolves `-1` to the last frame and clamps everything else into range when it
    /// installs an animation (`acclient.c:327498-327532`). Doing it once at projection means no
    /// consumer has to know the sentinel exists.
    #[test]
    fn clip_windows_resolve_the_open_ended_sentinel() {
        let catalog = MotionSequenceCatalog::assemble(
            [table(vec![anim_data(0, -1)], 0)],
            [animation(36, Vec::new())],
            [],
        )
        .expect("catalog should assemble");

        let clip = walk_clip(&catalog);
        assert_eq!(clip.low_frame, 0);
        assert_eq!(clip.high_frame, 35);
        assert_eq!(clip.frame_span(), 36);
    }

    #[test]
    fn clip_windows_clamp_past_the_end_and_never_invert() {
        let catalog = MotionSequenceCatalog::assemble(
            [table(vec![anim_data(30, 4)], 0)],
            [animation(10, Vec::new())],
            [],
        )
        .expect("catalog should assemble");

        let clip = walk_clip(&catalog);
        assert_eq!(clip.low_frame, 9, "a low frame past the end clamps to it");
        assert_eq!(
            clip.high_frame, 9,
            "a high frame below the low frame is raised, never inverted"
        );
        assert_eq!(clip.frame_span(), 1);
    }

    /// The whole point of the contract: authored root motion survives as an ordered program that
    /// composes exactly, rather than as one reduced speed.
    #[test]
    fn root_motion_composes_across_the_selected_window() {
        let catalog = MotionSequenceCatalog::assemble(
            [table(vec![anim_data(0, 3)], 0)],
            [animation(36, Vec::new())],
            [],
        )
        .expect("catalog should assemble");

        let clip = walk_clip(&catalog);
        let composed = clip
            .animation
            .root
            .composed_over(clip.low_frame, clip.high_frame);
        assert_eq!(composed.translation, Vector3::new(0.0, 2.0, 0.0));
        assert_eq!(clip.animation.root.frames().len(), 36);
    }

    #[test]
    fn selection_bits_project_as_named_rules() {
        let catalog = MotionSequenceCatalog::assemble(
            [table(vec![anim_data(0, -1)], 0x03)],
            [animation(4, Vec::new())],
            [],
        )
        .expect("catalog should assemble");
        let sequence = catalog
            .table(TABLE_ID)
            .expect("table should project")
            .cycle(STYLE, MotionTable::WALK_FORWARD_COMMAND)
            .expect("walk cycle should project");

        assert!(sequence.clears_modifiers);
        assert!(sequence.requires_default_substate);
    }

    #[test]
    fn simulation_hooks_survive_with_their_frame_and_direction() {
        let attack = AnimationHook {
            hook_type: 3,
            direction: 0,
            payload: AnimationHookPayload::Attack(AttackConeHookPayload {
                part_index: 2,
                left_x: 0.0,
                left_y: 1.0,
                right_x: 1.0,
                right_y: 0.0,
                radius: 1.5,
                height: 2.0,
            }),
        };
        let ethereal = AnimationHook {
            hook_type: 6,
            direction: -1,
            payload: AnimationHookPayload::Ethereal(EtherealHookPayload { ethereal: true }),
        };
        let sound = AnimationHook {
            hook_type: 1,
            direction: 0,
            payload: AnimationHookPayload::Raw(vec![0, 0, 0, 0]),
        };

        let catalog = MotionSequenceCatalog::assemble(
            [table(vec![anim_data(0, -1)], 0)],
            [animation(4, vec![(1, attack), (2, ethereal), (2, sound)])],
            [],
        )
        .expect("catalog should assemble");

        let clip = walk_clip(&catalog);
        let hooks = clip.animation.hooks.hooks();
        assert_eq!(
            hooks.len(),
            2,
            "presentation hooks do not reach the contract"
        );
        assert_eq!(hooks[0].frame, 1);
        assert_eq!(hooks[0].direction, MotionHookDirection::Both);
        assert_eq!(hooks[1].frame, 2);
        assert_eq!(hooks[1].direction, MotionHookDirection::Backward);

        assert_eq!(
            clip.animation
                .hooks
                .at(2, MotionHookDirection::Forward)
                .count(),
            0,
            "a backward-only hook does not fire forwards"
        );
        assert_eq!(
            clip.animation
                .hooks
                .at(1, MotionHookDirection::Forward)
                .count(),
            1,
            "a both-ways hook fires in either direction"
        );
    }

    /// Every profile carries the complete representation, so a referenced animation that is absent
    /// means the archive is corrupt. There is no tier-shaped fallback to take.
    #[test]
    fn a_referenced_animation_that_is_absent_is_an_integrity_failure() {
        let error = MotionSequenceCatalog::assemble([table(vec![anim_data(0, -1)], 0)], [], [])
            .expect_err("a missing animation must not project");

        assert_eq!(
            error,
            MotionContractError::MissingAnimation {
                motion_table_id: TABLE_ID,
                animation_id: ANIMATION_ID,
            }
        );
    }

    #[test]
    fn setup_defaults_resolve_the_motion_table_an_object_installs() {
        let catalog = MotionSequenceCatalog::assemble(
            [table(vec![anim_data(0, -1)], 0)],
            [animation(4, Vec::new())],
            [(0x0200_1091, TABLE_ID)],
        )
        .expect("catalog should assemble");

        assert_eq!(
            catalog.default_motion_table_for_setup(0x0200_1091),
            Some(TABLE_ID)
        );
        assert_eq!(catalog.default_motion_table_for_setup(0x0200_0001), None);
    }
}
