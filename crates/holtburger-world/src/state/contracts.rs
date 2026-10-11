//! Character contract retention and shared interpretation of server tracker facts.

use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_content::ContractCatalog;
use holtburger_dat::file_type::ContractPosition;
use holtburger_protocol::messages::contracts::{
    ContractStage, ContractTracker, ContractTrackerTable, ContractTrackerUpdate,
};
use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Instant;

/// A server duration observed at a monotonic receipt time.
#[derive(Debug, Clone, PartialEq)]
struct ContractObservation {
    /// Complete server tracker retained independently of static lookup.
    tracker: ContractTracker,
    /// Monotonic receipt time for both remaining durations.
    received_at: Instant,
}

/// Actual registry transitions, independent of progress updates and presentation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContractMembershipChangeKind {
    /// A previously absent identity entered the registry.
    Added,
    /// An existing identity left the registry.
    Removed,
}

/// Ephemeral accepted mutation; snapshots never retain or replay this activity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContractMembershipChange {
    /// The transition classified by the authoritative reducer.
    pub kind: ContractMembershipChangeKind,
    /// Registry identity, including contracts missing from static content.
    pub id: u32,
    /// Authored name, absent when the static definition is unresolved.
    pub name: Option<String>,
}

/// Character-owned registry, independent of scene residency and panel lifetime.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ContractsState {
    observations: BTreeMap<u32, ContractObservation>,
}

impl ContractsState {
    /// Replace the whole registry, including an explicitly empty table.
    pub fn replace(&mut self, table: &ContractTrackerTable, now: Instant) {
        self.observations = table
            .trackers
            .iter()
            .map(|(&id, tracker)| {
                (
                    id,
                    ContractObservation {
                        tracker: tracker.clone(),
                        received_at: now,
                    },
                )
            })
            .collect();
    }

    /// Apply an authoritative upsert/removal; deleting an absent ID is idempotent.
    /// Returns only a membership transition, never progress/timer activity.
    pub fn update(
        &mut self,
        update: &ContractTrackerUpdate,
        now: Instant,
    ) -> Option<ContractMembershipChangeKind> {
        if update.delete {
            self.observations
                .remove(&update.tracker.id)
                .map(|_| ContractMembershipChangeKind::Removed)
        } else {
            self.observations
                .insert(
                    update.tracker.id,
                    ContractObservation {
                        tracker: update.tracker.clone(),
                        received_at: now,
                    },
                )
                .is_none()
                .then_some(ContractMembershipChangeKind::Added)
        }
    }

    /// Whether a mutation targets a retained registry identity.
    pub fn contains(&self, id: u32) -> bool {
        self.observations.contains_key(&id)
    }

    /// Resolve every tracker at one observation time for both events and recovery.
    pub fn resolve(&self, catalog: &ContractCatalog, now: Instant) -> ContractsSnapshot {
        ContractsSnapshot {
            rows: self
                .observations
                .values()
                .map(|observation| resolve(observation, catalog, now))
                .collect(),
        }
    }
}

/// Shared quest state, with counter text and repeat semantics already interpreted.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContractStatus {
    /// The quest is available; this does not imply completion history.
    Available,
    /// Started/counter state; absent authored counter text remains ordinary progress.
    InProgress {
        /// Authored counter text, absent when no counter format applies.
        progress: Option<String>,
    },
    /// Completed without a repeat flag/duration.
    Completed,
    /// A positive repeat duration expires to Available without another server update.
    WaitingToRepeat {
        /// Remaining seconds at snapshot production.
        #[serde(rename = "remainingSeconds")]
        remaining_seconds: f64,
    },
}

/// Deadline semantics independent of completion/status.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContractDeadline {
    /// The deadline is no longer running; this does not complete the quest.
    Finished,
    /// Remaining deadline duration at snapshot production.
    Running {
        /// Positive seconds remaining.
        #[serde(rename = "remainingSeconds")]
        remaining_seconds: f64,
    },
}

/// Destination classification with retail journal labels and lossless outdoor placement.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContractLocation {
    /// No authored cell was supplied.
    Missing,
    /// The cell does not resolve to an outdoor terrain square.
    Indoor {
        /// Preserve the identity without guessing an entrance.
        #[serde(rename = "cellId")]
        cell_id: u32,
    },
    /// Retail cell-based Journal labels alongside the original authored placement.
    Outdoor {
        /// Degrees north; negative values are south.
        latitude: f64,
        /// Degrees east; negative values are west.
        longitude: f64,
        /// Original cell, local origin, and orientation for consumers such as the map.
        /// Indirection keeps the resolved/unresolved row union compact without changing serialization.
        position: Box<WorldPosition>,
    },
}

impl ContractLocation {
    /// Retail acclient.c:199929 and 201376 use cell coordinates, not frame offsets.
    fn from_position(source: &ContractPosition) -> Self {
        let cell_id = source.cell_id;
        if cell_id == 0 {
            return Self::Missing;
        }
        let cell = cell_id & 0xffff;
        let block_x = cell_id >> 24;
        let block_y = (cell_id >> 16) & 0xff;
        if !(1..=64).contains(&cell) || block_x > 254 || block_y > 254 {
            return Self::Indoor { cell_id };
        }
        let x = block_x * 8 + (cell - 1) / 8;
        let y = block_y * 8 + (cell - 1) % 8;
        Self::Outdoor {
            latitude: (f64::from(y) - 1024.0) * 0.1 + 0.5,
            longitude: (f64::from(x) - 1024.0) * 0.1 + 0.5,
            position: Box::new(WorldPosition {
                landblock_id: Guid(cell_id),
                coords: source.frame.origin,
                rotation: source.frame.orientation,
            }),
        }
    }
}

/// Authored role of the selected contact, rather than an inferred quest objective.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContractContactRole {
    /// Contact from the starting fields.
    Start,
    /// Contact from the ending fields.
    End,
}

/// Selected contact and destination kept together.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ContractContact {
    /// Starting/ending authored role.
    pub role: ContractContactRole,
    /// Authored NPC name.
    pub name: String,
    /// Selected contact's location.
    pub location: ContractLocation,
}

/// Resolved journal facts or an explicit content lookup failure for one identity.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContractRow {
    /// Static definition and tracker successfully joined.
    Resolved {
        /// Stable identity, never the name.
        id: u32,
        /// Authored display name.
        name: String,
        /// Authored quest notes.
        description: String,
        /// Server stage interpreted with static repeat/progress facts.
        status: ContractStatus,
        /// Selected authored contact, absent only when both names are empty.
        contact: Option<ContractContact>,
        /// Authored quest-area destination.
        area: ContractLocation,
        /// Absent when no deadline flag exists.
        deadline: Option<ContractDeadline>,
    },
    /// Keep the tracker visible/removable when static content is missing.
    Unresolved {
        /// Identity whose definition was not supplied by client content.
        id: u32,
    },
}

/// One coherent shared read model, sampled without periodic core publication.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ContractsSnapshot {
    /// Every retained identity, including unresolved content.
    pub rows: Vec<ContractRow>,
}

fn resolve(
    observation: &ContractObservation,
    catalog: &ContractCatalog,
    now: Instant,
) -> ContractRow {
    let tracker = &observation.tracker;
    let Some(reference) = catalog.get(tracker.id) else {
        return ContractRow::Unresolved { id: tracker.id };
    };
    let definition = &reference.definition;
    let elapsed = now
        .saturating_duration_since(observation.received_at)
        .as_secs_f64();
    let repeat = (tracker.repeat_seconds - elapsed).max(0.0);
    // Retail acclient.c:201079 interprets stage 3 using the original positive
    // repeat duration first, then the presence of the static repeat flag.
    let status = match tracker.stage {
        ContractStage::Available => ContractStatus::Available,
        ContractStage::InProgress => ContractStatus::InProgress { progress: None },
        ContractStage::Progress { count } => ContractStatus::InProgress {
            progress: reference
                .progress_format
                .as_ref()
                .map(|format| format.render(count.get())),
        },
        ContractStage::DoneOrPendingRepeat if tracker.repeat_seconds > 0.0 => {
            if repeat > 0.0 {
                ContractStatus::WaitingToRepeat {
                    remaining_seconds: repeat,
                }
            } else {
                ContractStatus::Available
            }
        }
        ContractStage::DoneOrPendingRepeat if definition.repeat_flag.is_empty() => {
            ContractStatus::Completed
        }
        ContractStage::DoneOrPendingRepeat => ContractStatus::Available,
    };
    let deadline = if definition.timer_flag.is_empty() {
        None
    } else {
        let remaining_seconds = (tracker.deadline_seconds - elapsed).max(0.0);
        Some(if remaining_seconds > 0.0 {
            ContractDeadline::Running { remaining_seconds }
        } else {
            ContractDeadline::Finished
        })
    };
    // Retail acclient.c:201343 chooses the ending contact for active/counter
    // stages, or when there is no starting contact; stage 3 uses the start contact.
    let use_end = !definition.end_npc.is_empty()
        && (matches!(
            tracker.stage,
            ContractStage::InProgress | ContractStage::Progress { .. }
        ) || definition.start_npc.is_empty());
    let (role, name, position) = if use_end {
        (
            ContractContactRole::End,
            &definition.end_npc,
            &definition.end_position,
        )
    } else {
        (
            ContractContactRole::Start,
            &definition.start_npc,
            &definition.start_position,
        )
    };
    let contact = (!name.is_empty()).then(|| ContractContact {
        role,
        name: name.clone(),
        location: ContractLocation::from_position(position),
    });
    ContractRow::Resolved {
        id: tracker.id,
        name: definition.name.clone(),
        description: definition.description.clone(),
        status,
        contact,
        area: ContractLocation::from_position(&definition.area_position),
        deadline,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::{ContractDefinition, ContractPosition, ContractTable};
    use holtburger_dat::graphics::Frame;
    use holtburger_protocol::messages::contracts::ContractProgressCount;
    use std::time::Duration;

    #[test]
    fn membership_transitions_exclude_existing_updates_and_absent_deletions() {
        let now = Instant::now();
        let mut state = ContractsState::default();
        let mut activity = update(1, ContractStage::Available);
        assert_eq!(
            state.update(&activity, now),
            Some(ContractMembershipChangeKind::Added)
        );
        activity.tracker.stage = ContractStage::InProgress;
        assert_eq!(state.update(&activity, now), None);
        activity.delete = true;
        assert_eq!(
            state.update(&activity, now),
            Some(ContractMembershipChangeKind::Removed)
        );
        assert_eq!(state.update(&activity, now), None);
    }

    #[test]
    fn outdoor_destination_preserves_source_offsets_and_orientation() {
        let source = ContractPosition {
            cell_id: 0x8080000a,
            frame: Frame {
                origin: holtburger_common::Vector3::new(36.0, 42.0, 50.0),
                orientation: holtburger_common::Quaternion {
                    w: 0.5,
                    x: 0.5,
                    y: 0.5,
                    z: 0.5,
                },
            },
        };
        let ContractLocation::Outdoor { position, .. } = ContractLocation::from_position(&source)
        else {
            panic!("expected outdoor destination");
        };
        assert_eq!(position.landblock_id, Guid(source.cell_id));
        assert_eq!(position.coords, source.frame.origin);
        assert_eq!(position.rotation, source.frame.orientation);
    }

    fn catalog() -> ContractCatalog {
        let position = |cell_id| ContractPosition {
            cell_id,
            frame: Frame::default(),
        };
        let definition = ContractDefinition {
            version: 0,
            id: 1,
            name: "Quest".into(),
            description: "Quest notes".into(),
            progress_description: "%d/20 Tuskers".into(),
            start_npc: "Fred".into(),
            end_npc: "Bob".into(),
            stamped_flag: "".into(),
            started_flag: "start".into(),
            finished_flag: "done".into(),
            progress_flag: "count".into(),
            timer_flag: "timer".into(),
            repeat_flag: "repeat".into(),
            start_position: position(0x80800001),
            end_position: position(0x80800100),
            area_position: position(0),
        };
        ContractCatalog::from_table(ContractTable {
            id: ContractTable::FILE_ID,
            contracts: [
                (1, definition.clone()),
                (
                    2,
                    ContractDefinition {
                        id: 2,
                        repeat_flag: String::new(),
                        timer_flag: String::new(),
                        start_npc: String::new(),
                        ..definition.clone()
                    },
                ),
                (
                    3,
                    ContractDefinition {
                        id: 3,
                        progress_description: String::new(),
                        ..definition
                    },
                ),
            ]
            .into(),
        })
        .unwrap()
    }

    fn update(id: u32, stage: ContractStage) -> ContractTrackerUpdate {
        ContractTrackerUpdate {
            tracker: ContractTracker {
                version: 0,
                id,
                stage,
                deadline_seconds: 10.0,
                repeat_seconds: 20.0,
            },
            delete: false,
            set_as_display: false,
        }
    }

    #[test]
    fn counters_contacts_and_deadlines_are_independent() {
        let now = Instant::now();
        let mut state = ContractsState::default();
        let _ = state.update(
            &update(
                1,
                ContractStage::Progress {
                    count: ContractProgressCount::new(0).unwrap(),
                },
            ),
            now,
        );
        let snapshot = state.resolve(&catalog(), now + Duration::from_secs(12));
        assert!(matches!(&snapshot.rows[0], ContractRow::Resolved {
            status: ContractStatus::InProgress { progress: Some(progress) },
            contact: Some(ContractContact { role: ContractContactRole::End, location: ContractLocation::Indoor { cell_id: 0x80800100 }, .. }),
            deadline: Some(ContractDeadline::Finished), area: ContractLocation::Missing, ..
        } if progress == "0/20 Tuskers"));
        let _ = state.update(&update(1, ContractStage::Available), now);
        assert!(matches!(
            &state.resolve(&catalog(), now).rows[0],
            ContractRow::Resolved {
                contact: Some(ContractContact {
                    role: ContractContactRole::Start,
                    location: ContractLocation::Outdoor {
                        latitude: 0.5,
                        longitude: 0.5,
                        ..
                    },
                    ..
                }),
                ..
            }
        ));
    }

    #[test]
    fn contact_roles_follow_authored_names_across_stages() {
        let now = Instant::now();
        let reference = catalog().get(1).unwrap().definition.clone();
        for (start, end, expected) in [
            ("Only start", "", ContractContactRole::Start),
            ("", "Only end", ContractContactRole::End),
        ] {
            let definitions = ContractCatalog::from_table(ContractTable {
                id: ContractTable::FILE_ID,
                contracts: [(
                    1,
                    ContractDefinition {
                        start_npc: start.into(),
                        end_npc: end.into(),
                        ..reference.clone()
                    },
                )]
                .into(),
            })
            .unwrap();
            for stage in [
                ContractStage::Available,
                ContractStage::InProgress,
                ContractStage::DoneOrPendingRepeat,
                ContractStage::Progress {
                    count: ContractProgressCount::new(1).unwrap(),
                },
            ] {
                let mut state = ContractsState::default();
                let _ = state.update(&update(1, stage), now);
                assert!(matches!(&state.resolve(&definitions, now).rows[0],
                    ContractRow::Resolved { contact: Some(contact), .. }
                    if contact.role == expected && contact.name == if start.is_empty() { end } else { start }
                ));
            }
        }
        let mut state = ContractsState::default();
        let _ = state.update(&update(1, ContractStage::DoneOrPendingRepeat), now);
        assert!(matches!(
            &state.resolve(&catalog(), now).rows[0],
            ContractRow::Resolved {
                contact: Some(ContractContact {
                    role: ContractContactRole::Start,
                    ..
                }),
                ..
            }
        ));
    }

    #[test]
    fn counter_without_authored_format_stays_in_progress() {
        let now = Instant::now();
        let mut state = ContractsState::default();
        let _ = state.update(
            &update(
                3,
                ContractStage::Progress {
                    count: ContractProgressCount::new(7).unwrap(),
                },
            ),
            now,
        );
        assert!(matches!(
            &state.resolve(&catalog(), now).rows[0],
            ContractRow::Resolved {
                status: ContractStatus::InProgress { progress: None },
                ..
            }
        ));
    }

    #[test]
    fn unrelated_updates_and_recovery_do_not_restart_repeat_timers() {
        let now = Instant::now();
        let mut state = ContractsState::default();
        let _ = state.update(&update(1, ContractStage::DoneOrPendingRepeat), now);
        let _ = state.update(
            &update(2, ContractStage::InProgress),
            now + Duration::from_secs(5),
        );
        assert!(matches!(
            &state.resolve(&catalog(), now + Duration::from_secs(7)).rows[0],
            ContractRow::Resolved {
                status: ContractStatus::WaitingToRepeat {
                    remaining_seconds: 13.0
                },
                ..
            }
        ));
        assert!(matches!(
            &state
                .resolve(&catalog(), now + Duration::from_secs(21))
                .rows[0],
            ContractRow::Resolved {
                status: ContractStatus::Available,
                ..
            }
        ));
        let mut completed = update(2, ContractStage::DoneOrPendingRepeat);
        completed.tracker.repeat_seconds = -1.0;
        let _ = state.update(&completed, now);
        assert!(matches!(
            &state.resolve(&catalog(), now).rows[1],
            ContractRow::Resolved {
                status: ContractStatus::Completed,
                contact: Some(ContractContact {
                    role: ContractContactRole::End,
                    ..
                }),
                deadline: None,
                ..
            }
        ));
        completed.tracker.id = 1;
        let _ = state.update(&completed, now);
        assert!(matches!(
            &state.resolve(&catalog(), now).rows[0],
            ContractRow::Resolved {
                status: ContractStatus::Available,
                ..
            }
        ));
    }

    #[test]
    fn replacements_deletes_and_missing_content_reconcile_by_identity() {
        let now = Instant::now();
        let mut state = ContractsState::default();
        let unknown = update(99, ContractStage::Available);
        let _ = state.update(&unknown, now);
        assert_eq!(
            state.resolve(&catalog(), now).rows,
            vec![ContractRow::Unresolved { id: 99 }]
        );
        state.replace(
            &ContractTrackerTable {
                buckets: 32,
                trackers: [(1, update(1, ContractStage::Available).tracker)].into(),
            },
            now,
        );
        assert!(!state.contains(99));
        assert!(state.contains(1));
        let _ = state.update(
            &ContractTrackerUpdate {
                delete: true,
                ..unknown
            },
            now,
        );
        assert!(!state.contains(99));
        let _ = state.update(
            &ContractTrackerUpdate {
                delete: true,
                ..update(1, ContractStage::Available)
            },
            now,
        );
        assert!(state.resolve(&catalog(), now).rows.is_empty());
        state.replace(
            &ContractTrackerTable {
                buckets: 32,
                trackers: BTreeMap::new(),
            },
            now,
        );
        assert!(state.resolve(&catalog(), now).rows.is_empty());
    }
}
