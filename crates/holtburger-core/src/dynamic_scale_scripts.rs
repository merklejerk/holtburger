//! Core-owned timing for direct whole-object `Scale` records on dynamic entities.
//!
//! Browser presentation owns full PhysicsScript playback, including `CallPES`. The host retains
//! only direct scale records because world collision and residency need their authoritative result.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use holtburger_common::Guid;
use holtburger_dat::file_type::PhysicsScript;
use holtburger_dat::file_type::setup_model::{AnimationHookPayload, ScaleHookPayload};
use thiserror::Error;

/// Existing dynamic entity identity used to reject late content preparation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DynamicScaleTarget {
    pub guid: Guid,
    pub instance_sequence: u16,
}

/// One direct scale record retained from an activated PhysicsScript root.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreparedScaleRecord {
    /// Offset from root activation on the core simulation clock.
    pub start_time: Duration,
    /// Stable authored order among records with the same start time.
    pub authored_order: usize,
    pub scale: ScaleHookPayload,
}

/// Direct scale consequences of one PhysicsScript root.
#[derive(Debug, Clone, PartialEq)]
pub struct PreparedDynamicScaleTimeline {
    pub records: Vec<PreparedScaleRecord>,
}

impl PreparedDynamicScaleTimeline {
    pub fn new(records: Vec<PreparedScaleRecord>) -> Self {
        Self { records }
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
}

/// One scale command made due by the simulation clock.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DueDynamicScale {
    pub target: DynamicScaleTarget,
    pub due_at: Duration,
    pub scale: ScaleHookPayload,
}

/// Failure of a focused scale-timeline invariant.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum DynamicScaleScriptError {
    #[error("PhysicsScript 0x{script_did:08X} record {authored_order} has an invalid start time")]
    InvalidStartTime {
        script_did: u32,
        authored_order: usize,
    },
    #[error("dynamic scale target {guid} instance {instance_sequence} is not current")]
    StaleTarget { guid: Guid, instance_sequence: u16 },
    #[error("dynamic scale simulation clock moved backwards")]
    ClockMovedBackwards,
}

/// Extracts direct scale records and ignores every presentation-owned hook.
pub fn prepare_dynamic_scale_timeline(
    root: &PhysicsScript,
) -> Result<PreparedDynamicScaleTimeline, DynamicScaleScriptError> {
    let records = root
        .records
        .iter()
        .filter_map(|record| match record.hook.payload {
            AnimationHookPayload::Scale(scale) => Some((record, scale)),
            _ => None,
        })
        .map(|(record, scale)| {
            if !record.start_time.is_finite() || record.start_time < 0.0 {
                return Err(DynamicScaleScriptError::InvalidStartTime {
                    script_did: root.id,
                    authored_order: record.authored_order,
                });
            }
            Ok(PreparedScaleRecord {
                start_time: Duration::from_secs_f64(record.start_time),
                authored_order: record.authored_order,
                scale,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(PreparedDynamicScaleTimeline::new(records))
}

#[derive(Debug)]
struct ActiveTimeline {
    timeline: Arc<PreparedDynamicScaleTimeline>,
    started_at: Duration,
    next_record: usize,
    activation_order: u64,
}

#[derive(Debug)]
struct EntityTimelines {
    target: DynamicScaleTarget,
    timelines: Vec<ActiveTimeline>,
    next_activation_order: u64,
}

impl EntityTimelines {
    fn new(target: DynamicScaleTarget) -> Self {
        Self {
            target,
            timelines: Vec::new(),
            next_activation_order: 0,
        }
    }
}

/// Owns direct dynamic-entity scale timelines; it neither loads content nor applies scale.
#[derive(Debug, Default)]
pub struct DynamicScaleScriptController {
    entities: BTreeMap<Guid, EntityTimelines>,
    advanced_to: Duration,
}

impl DynamicScaleScriptController {
    /// Atomically replaces any prior instance before asynchronous preparation starts.
    pub fn install_target(&mut self, target: DynamicScaleTarget) {
        self.entities
            .insert(target.guid, EntityTimelines::new(target));
    }

    /// Starts one independently prepared root on the exact current entity instance.
    pub fn activate(
        &mut self,
        target: DynamicScaleTarget,
        timeline: Arc<PreparedDynamicScaleTimeline>,
        started_at: Duration,
    ) -> Result<(), DynamicScaleScriptError> {
        let entity = self
            .entities
            .get_mut(&target.guid)
            .filter(|entity| entity.target == target)
            .ok_or(DynamicScaleScriptError::StaleTarget {
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
        });
        Ok(())
    }

    /// Removes only the exact instance so a late removal cannot retire its successor.
    pub fn remove_target(&mut self, target: DynamicScaleTarget) -> bool {
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

    pub fn holds(&self, target: DynamicScaleTarget) -> bool {
        self.entities
            .get(&target.guid)
            .is_some_and(|entity| entity.target == target)
    }

    /// Advances all current instances and returns direct scale records in deterministic due order.
    pub fn advance_to(
        &mut self,
        now: Duration,
    ) -> Result<Vec<DueDynamicScale>, DynamicScaleScriptError> {
        if now < self.advanced_to {
            return Err(DynamicScaleScriptError::ClockMovedBackwards);
        }
        self.advanced_to = now;
        let mut due = Vec::new();
        for entity in self.entities.values_mut() {
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
                        DueDynamicScale {
                            target: entity.target,
                            due_at,
                            scale: record.scale,
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

    fn target(instance_sequence: u16) -> DynamicScaleTarget {
        DynamicScaleTarget {
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
    fn preparation_extracts_direct_scale_without_rejecting_other_root_hooks() {
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
            ],
        );

        let prepared = prepare_dynamic_scale_timeline(&root).unwrap();

        assert_eq!(prepared.records.len(), 1);
        assert_eq!(prepared.records[0].scale.end, 3.0);
    }

    fn timeline(records: &[(f64, usize, f32, f32)]) -> Arc<PreparedDynamicScaleTimeline> {
        Arc::new(PreparedDynamicScaleTimeline::new(
            records
                .iter()
                .map(|(start, order, end, duration)| PreparedScaleRecord {
                    start_time: Duration::from_secs_f64(*start),
                    authored_order: *order,
                    scale: ScaleHookPayload {
                        end: *end,
                        duration_seconds: *duration,
                    },
                })
                .collect(),
        ))
    }

    #[test]
    fn emits_only_due_records_in_stable_cross_root_order() {
        let mut controller = DynamicScaleScriptController::default();
        controller.install_target(target(1));
        controller
            .activate(
                target(1),
                timeline(&[(1.0, 1, 3.0, 2.0), (1.0, 2, 4.0, 0.0)]),
                Duration::from_secs(5),
            )
            .unwrap();
        controller
            .activate(
                target(1),
                timeline(&[(0.5, 0, 2.0, 0.0)]),
                Duration::from_secs(5),
            )
            .unwrap();

        assert!(
            controller
                .advance_to(Duration::from_secs_f64(5.4))
                .unwrap()
                .is_empty()
        );
        let due = controller.advance_to(Duration::from_secs(6)).unwrap();
        assert_eq!(
            due.iter()
                .map(|command| command.scale.end)
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
        let mut controller = DynamicScaleScriptController::default();
        controller.install_target(target(1));
        controller.install_target(target(2));

        assert_eq!(
            controller.activate(target(1), timeline(&[(0.0, 0, 2.0, 0.0)]), Duration::ZERO,),
            Err(DynamicScaleScriptError::StaleTarget {
                guid: target(1).guid,
                instance_sequence: 1,
            })
        );
        assert!(!controller.remove_target(target(1)));
        assert!(controller.holds(target(2)));
    }
}
