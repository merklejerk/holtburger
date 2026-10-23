//! Core-owned timing for direct object-state records on dynamic entities.
//!
//! Browser presentation owns full PhysicsScript playback, including `CallPES`. The host retains
//! direct scale, visibility, and lighting records so server updates can reconcile their results.
//! Census 2026-10-22: the 4,248 scripts contain three NoDraw/SetLight records in two collision
//! roots, all at time zero; none is nested through CallPES or installed as a setup default.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use holtburger_common::Guid;
use holtburger_dat::file_type::PhysicsScript;
use holtburger_dat::file_type::setup_model::{AnimationHookPayload, ScaleHookPayload};
use holtburger_world::EntityPresentationChange;
use thiserror::Error;

/// Existing dynamic entity identity used to reject late content preparation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DynamicScriptTarget {
    pub guid: Guid,
    pub instance_sequence: u16,
}

/// A script request's entity incarnation and physics authority epoch, retained through loading.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DynamicScriptActivation {
    /// Entity generation whose controller owns this root.
    pub target: DynamicScriptTarget,
    /// Complete server state replacements supersede this root's predicted presentation flags.
    pub physics_revision: u64,
}

/// A direct object-state command applied by the host rather than browser playback.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DynamicScriptCommand {
    /// Whole-object scale, including an optional timed transition.
    Scale(ScaleHookPayload),
    /// Predicted visibility or emitted-light state reconciled by server physics updates.
    Presentation(EntityPresentationChange),
}

/// One direct object-state record retained from an activated PhysicsScript root.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreparedScriptRecord {
    /// Offset from root activation on the core simulation clock.
    pub start_time: Duration,
    /// Stable authored order among records with the same start time.
    pub authored_order: usize,
    /// State mutation to apply when this record becomes due.
    pub command: DynamicScriptCommand,
}

/// Direct object-state consequences of one PhysicsScript root.
#[derive(Debug, Clone, PartialEq)]
pub struct PreparedDynamicScriptTimeline {
    pub records: Vec<PreparedScriptRecord>,
}

impl PreparedDynamicScriptTimeline {
    pub fn new(records: Vec<PreparedScriptRecord>) -> Self {
        Self { records }
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
}

/// One object-state command made due by the simulation clock.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DueDynamicScriptCommand {
    /// Request identity captured before asynchronous content preparation.
    pub activation: DynamicScriptActivation,
    /// State mutation admitted for this exact target generation.
    pub command: DynamicScriptCommand,
}

/// Failure of a direct script-timeline invariant.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum DynamicScriptError {
    #[error("PhysicsScript 0x{script_did:08X} record {authored_order} has an invalid start time")]
    InvalidStartTime {
        script_did: u32,
        authored_order: usize,
    },
    #[error("dynamic script target {guid} instance {instance_sequence} is not current")]
    StaleTarget { guid: Guid, instance_sequence: u16 },
    #[error("dynamic script simulation clock moved backwards")]
    ClockMovedBackwards,
}

/// Extracts host-owned state commands; browser-only effects keep their independent playback.
pub fn prepare_dynamic_script_timeline(
    root: &PhysicsScript,
) -> Result<PreparedDynamicScriptTimeline, DynamicScriptError> {
    let records = root
        .records
        .iter()
        .filter_map(|record| match record.hook.payload {
            AnimationHookPayload::Scale(scale) => {
                Some((record, DynamicScriptCommand::Scale(scale)))
            }
            AnimationHookPayload::NoDraw(enabled) => Some((
                record,
                DynamicScriptCommand::Presentation(EntityPresentationChange::NoDraw(enabled)),
            )),
            AnimationHookPayload::SetLight(enabled) => Some((
                record,
                DynamicScriptCommand::Presentation(EntityPresentationChange::Lighting(enabled)),
            )),
            _ => None,
        })
        .map(|(record, command)| {
            if !record.start_time.is_finite() || record.start_time < 0.0 {
                return Err(DynamicScriptError::InvalidStartTime {
                    script_did: root.id,
                    authored_order: record.authored_order,
                });
            }
            Ok(PreparedScriptRecord {
                start_time: Duration::from_secs_f64(record.start_time),
                authored_order: record.authored_order,
                command,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(PreparedDynamicScriptTimeline::new(records))
}

#[derive(Debug)]
struct ActiveTimeline {
    timeline: Arc<PreparedDynamicScriptTimeline>,
    started_at: Duration,
    next_record: usize,
    activation_order: u64,
    /// Authority epoch at activation; later server states supersede predicted flag commands.
    physics_revision: u64,
}

#[derive(Debug)]
struct EntityTimelines {
    target: DynamicScriptTarget,
    timelines: Vec<ActiveTimeline>,
    next_activation_order: u64,
}

impl EntityTimelines {
    fn new(target: DynamicScriptTarget) -> Self {
        Self {
            target,
            timelines: Vec::new(),
            next_activation_order: 0,
        }
    }
}

/// Owns direct dynamic-entity state timelines; it neither loads content nor mutates entities.
#[derive(Debug, Default)]
pub struct DynamicScriptController {
    entities: BTreeMap<Guid, EntityTimelines>,
    advanced_to: Duration,
}

impl DynamicScriptController {
    /// Atomically replaces any prior instance before asynchronous preparation starts.
    pub fn install_target(&mut self, target: DynamicScriptTarget) {
        self.entities
            .insert(target.guid, EntityTimelines::new(target));
    }

    /// Starts one independently prepared root on the exact current entity instance.
    pub fn activate(
        &mut self,
        activation: DynamicScriptActivation,
        timeline: Arc<PreparedDynamicScriptTimeline>,
        started_at: Duration,
    ) -> Result<(), DynamicScriptError> {
        let target = activation.target;
        let entity = self
            .entities
            .get_mut(&target.guid)
            .filter(|entity| entity.target == target)
            .ok_or(DynamicScriptError::StaleTarget {
                guid: target.guid,
                instance_sequence: target.instance_sequence,
            })?;
        if timeline.is_empty() {
            return Ok(());
        }
        let activation_order = entity.next_activation_order;
        entity.next_activation_order = entity.next_activation_order.saturating_add(1);
        entity.timelines.push(ActiveTimeline {
            timeline,
            started_at,
            next_record: 0,
            activation_order,
            physics_revision: activation.physics_revision,
        });
        Ok(())
    }

    /// Removes only the exact instance so a late removal cannot retire its successor.
    pub fn remove_target(&mut self, target: DynamicScriptTarget) -> bool {
        if self
            .entities
            .get(&target.guid)
            .is_some_and(|entity| entity.target == target)
        {
            self.entities.remove(&target.guid);
            true
        } else {
            false
        }
    }

    pub fn holds(&self, target: DynamicScriptTarget) -> bool {
        self.entities
            .get(&target.guid)
            .is_some_and(|entity| entity.target == target)
    }

    /// Advances participating instances and returns direct state records in deterministic due order.
    /// Unavailable targets retain their cursor and original due times until they participate again.
    pub fn advance_to(
        &mut self,
        now: Duration,
        participates: impl Fn(DynamicScriptTarget) -> bool,
    ) -> Result<Vec<DueDynamicScriptCommand>, DynamicScriptError> {
        if now < self.advanced_to {
            return Err(DynamicScriptError::ClockMovedBackwards);
        }
        self.advanced_to = now;
        let mut due = Vec::new();
        for entity in self.entities.values_mut() {
            if !participates(entity.target) {
                continue;
            }
            for active in &mut entity.timelines {
                while let Some(record) = active.timeline.records.get(active.next_record) {
                    let due_at = active.started_at.saturating_add(record.start_time);
                    if due_at > now {
                        break;
                    }
                    due.push((
                        due_at,
                        entity.target,
                        active.activation_order,
                        record.authored_order,
                        DueDynamicScriptCommand {
                            activation: DynamicScriptActivation {
                                target: entity.target,
                                physics_revision: active.physics_revision,
                            },
                            command: record.command,
                        },
                    ));
                    active.next_record += 1;
                }
            }
            entity
                .timelines
                .retain(|active| active.next_record < active.timeline.records.len());
        }
        due.sort_by_key(|(due_at, target, activation_order, authored_order, _)| {
            (*due_at, target.guid, *activation_order, *authored_order)
        });
        Ok(due
            .into_iter()
            .map(|(_, _, _, _, command)| command)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::PhysicsScriptRecord;
    use holtburger_dat::file_type::setup_model::{AnimationHook, SoundTableHookPayload};

    fn target(instance_sequence: u16) -> DynamicScriptTarget {
        DynamicScriptTarget {
            guid: Guid(0x7000_0001),
            instance_sequence,
        }
    }

    fn script(id: u32, hooks: Vec<(f64, u32, AnimationHookPayload)>) -> Arc<PhysicsScript> {
        Arc::new(PhysicsScript {
            id,
            records: hooks
                .into_iter()
                .enumerate()
                .map(
                    |(authored_order, (start_time, hook_type, payload))| PhysicsScriptRecord {
                        start_time,
                        authored_order,
                        hook: AnimationHook {
                            hook_type,
                            direction: -1,
                            payload,
                        },
                    },
                )
                .collect(),
        })
    }

    #[test]
    fn preparation_extracts_host_state_without_rejecting_browser_effects() {
        let root_id = 0x3300_0001;
        let root = script(
            root_id,
            vec![
                (
                    0.0,
                    2,
                    AnimationHookPayload::SoundTable(SoundTableHookPayload { sound_type: 7 }),
                ),
                (
                    1.0,
                    12,
                    AnimationHookPayload::Scale(ScaleHookPayload {
                        end: 3.0,
                        duration_seconds: 2.0,
                    }),
                ),
                (1.0, 16, AnimationHookPayload::NoDraw(true)),
                (1.0, 25, AnimationHookPayload::SetLight(false)),
            ],
        );

        let prepared = prepare_dynamic_script_timeline(&root).unwrap();

        assert_eq!(prepared.records.len(), 3);
        assert!(matches!(
            prepared.records[0].command,
            DynamicScriptCommand::Scale(ScaleHookPayload { end: 3.0, .. })
        ));
        assert_eq!(
            prepared.records[1].command,
            DynamicScriptCommand::Presentation(EntityPresentationChange::NoDraw(true))
        );
        assert_eq!(
            prepared.records[2].command,
            DynamicScriptCommand::Presentation(EntityPresentationChange::Lighting(false))
        );
    }

    fn timeline(records: &[(f64, usize, f32, f32)]) -> Arc<PreparedDynamicScriptTimeline> {
        Arc::new(PreparedDynamicScriptTimeline::new(
            records
                .iter()
                .map(|(start, order, end, duration)| PreparedScriptRecord {
                    start_time: Duration::from_secs_f64(*start),
                    authored_order: *order,
                    command: DynamicScriptCommand::Scale(ScaleHookPayload {
                        end: *end,
                        duration_seconds: *duration,
                    }),
                })
                .collect(),
        ))
    }

    #[test]
    fn emits_only_due_records_in_stable_cross_root_order() {
        let mut controller = DynamicScriptController::default();
        controller.install_target(target(1));
        controller
            .activate(
                DynamicScriptActivation {
                    target: target(1),
                    physics_revision: 0,
                },
                timeline(&[(1.0, 1, 3.0, 2.0), (1.0, 2, 4.0, 0.0)]),
                Duration::from_secs(5),
            )
            .unwrap();
        controller
            .activate(
                DynamicScriptActivation {
                    target: target(1),
                    physics_revision: 0,
                },
                timeline(&[(0.5, 0, 2.0, 0.0)]),
                Duration::from_secs(5),
            )
            .unwrap();

        assert!(
            controller
                .advance_to(Duration::from_secs_f64(5.4), |_| true)
                .unwrap()
                .is_empty()
        );
        let due = controller
            .advance_to(Duration::from_secs(6), |_| true)
            .unwrap();
        assert_eq!(
            due.iter()
                .map(|command| match command.command {
                    DynamicScriptCommand::Scale(scale) => scale.end,
                    _ => panic!("expected a scale command"),
                })
                .collect::<Vec<_>>(),
            vec![2.0, 3.0, 4.0]
        );
        assert!(
            controller
                .entities
                .values()
                .all(|entity| entity.timelines.is_empty())
        );
    }

    #[test]
    fn replacement_rejects_late_preparation_and_removal() {
        let mut controller = DynamicScriptController::default();
        controller.install_target(target(1));
        controller.install_target(target(2));

        assert_eq!(
            controller.activate(
                DynamicScriptActivation {
                    target: target(1),
                    physics_revision: 0
                },
                timeline(&[(0.0, 0, 2.0, 0.0)]),
                Duration::ZERO,
            ),
            Err(DynamicScriptError::StaleTarget {
                guid: target(1).guid,
                instance_sequence: 1,
            })
        );
        assert!(!controller.remove_target(target(1)));
        assert!(controller.holds(target(2)));
    }
}
