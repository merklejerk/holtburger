//! Live-only stimulus and observation. This does not serialize commands into stationary replays.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use holtburger_common::{Guid, position::WorldPosition};
use holtburger_core::client::movement_types::{CharacterDrive, PlayerDriveIntent};
use holtburger_core::{
    ClientAttackProfile, ClientCombatControlState, ClientCommand, ClientLifecycleState,
    ClientRuntime, ClientViewEvent, DynamicEntityEvent, DynamicEntityHostTime,
    DynamicEntityPlacedPath, DynamicEntityPlacementAdvanceKind, DynamicEntityPlacementView,
    DynamicEntityPresentationClass, DynamicEntitySnapshot, DynamicEntityTickBatch,
    DynamicEntityView,
};
use holtburger_protocol::messages::combat::AttackHeight;
use serde::Serialize;
use tokio::sync::{broadcast, mpsc};
use tokio::time::{Instant, MissedTickBehavior, timeout, timeout_at};

const SETTLEMENT: Duration = Duration::from_secs(5);
const TARGET_RANGE_M: f32 = 32.0;
const CONTROL_PERIOD: Duration = Duration::from_secs(1);
const CYCLE: Duration = Duration::from_secs(10);

/// Separate manual motion from melee so one does not repeatedly cancel the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Forward,
    Backstep,
    Combat,
}

impl Phase {
    fn at(elapsed: Duration) -> Self {
        match elapsed.as_secs() % CYCLE.as_secs() {
            0 => Self::Forward,
            1 => Self::Backstep,
            _ => Self::Combat,
        }
    }

    fn stimulus(self) -> Stimulus {
        match self {
            Self::Forward => Stimulus::Forward,
            Self::Backstep => Stimulus::Backstep,
            Self::Combat => Stimulus::ReleaseManual,
        }
    }
}

/// The probe owns stimulus policy; production controllers retain movement and attack semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Stimulus {
    Forward,
    Backstep,
    ReleaseManual,
    Engage {
        /// Known nearby public mob selected by the probe, validated by the production attack owner.
        target: Guid,
    },
    Stop,
}

/// Accepted path provenance stays paired; an unchanged level has no fabricated path.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Travel<'a> {
    Stable,
    Advanced {
        /// Distinguishes ordinary integration from correction/reset travel.
        disposition: DynamicEntityPlacementAdvanceKind,
        /// Complete accepted path, including intermediate residency and returning travel.
        path: &'a DynamicEntityPlacedPath,
    },
}

/// Newline JSON records intentionally contain no credentials, names, or incoming messages.
#[derive(Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum Record<'a> {
    Started {
        /// Established local identity, independent of character-list ordering.
        player: Guid,
        /// Bounded observation duration after settlement, not proof of heavy workload coverage.
        seconds: u64,
        /// Starting geometry identity and coordinates.
        pose: WorldPosition,
    },
    Requested {
        /// Enqueue time relative to the observation window; not command dispatch acknowledgement.
        at_seconds: f64,
        /// Exact harness policy edge sent through the production command channel.
        stimulus: Stimulus,
    },
    Player {
        /// Observation time; profile logs own simulation elapsed/admitted accounting.
        at_seconds: f64,
        /// Producer completion offset, distinct from receiver observation time above.
        host_time: DynamicEntityHostTime,
        /// Published elapsed interval; zero for correction-only batches, not admitted physics time.
        published_interval_ms: f64,
        /// Dynamic publication population; not a substitute for solver body/mover/projectile census.
        dynamic_entities: usize,
        /// Canonical pose and contact/sampling state from the producer.
        placement: &'a DynamicEntityPlacementView,
        /// Ordinary accepted path or explicit correction provenance when published.
        travel: Travel<'a>,
    },
    Combat {
        /// Observation time relative to the window.
        at_seconds: f64,
        /// Accepted desired target; a request alone cannot establish active engagement.
        desired_target: Option<Guid>,
        /// Shared attack owner actually entered its active state.
        active: bool,
    },
    Finished {
        /// Actual elapsed observation window.
        elapsed_seconds: f64,
        /// Explicit engagement requests, distinct from accepted combat states above.
        engagement_requests: usize,
        /// Player path publications, distinct from unchanged levels and requested controls.
        player_advances: usize,
        /// At least one accepted attack-owner active state; requests alone cannot pass this check.
        combat_active_observed: bool,
    },
}

/// Keep only placement and target-selection facts; animation/appearance clones would add work
/// to the measured host without contributing to this diagnostic.
struct ObservedEntity {
    /// Incarnation used to reject stale removals and retire zero-health observations.
    generation: u64,
    /// Latest producer placement supplies selection distance and accepted player contact state.
    placement: DynamicEntityPlacementView,
    /// Producer classification supplies known-mob selection, never solver role census.
    class: DynamicEntityPresentationClass,
    /// Hidden entities are excluded from this probe's target policy.
    hidden: bool,
}

impl From<&DynamicEntityView> for ObservedEntity {
    fn from(entity: &DynamicEntityView) -> Self {
        Self {
            generation: entity.generation,
            placement: entity.placement.clone(),
            class: entity.presentation.entity_class,
            hidden: entity.physics.hidden,
        }
    }
}

/// A diagnostic mirror consumes complete products, never re-derives solver participation roles.
#[derive(Default)]
struct Mirror {
    /// Current producer levels used for nearest known-mob selection and player observations.
    entities: BTreeMap<Guid, ObservedEntity>,
    /// Zero health is scoped to an observed incarnation so respawns are selectable again.
    dead: BTreeSet<(Guid, u64)>,
    /// Accepted attack-owner level prevents repeatedly restarting a live engagement.
    desired_target: Option<Guid>,
}

impl Mirror {
    fn observe(&mut self, event: &ClientViewEvent) {
        match event {
            ClientViewEvent::ApplicationSnapshot(snapshot) => {
                self.replace(&snapshot.dynamic);
                self.desired_target = snapshot.combat.desired.map(|desired| desired.target);
            }
            ClientViewEvent::DynamicEntity(DynamicEntityEvent::Snapshot { snapshot }) => {
                self.replace(snapshot);
            }
            ClientViewEvent::DynamicEntity(DynamicEntityEvent::Upserted { entity }) => {
                self.entities
                    .insert(entity.identity.guid, ObservedEntity::from(entity.as_ref()));
            }
            ClientViewEvent::DynamicEntity(DynamicEntityEvent::Removed { guid, generation })
                if self
                    .entities
                    .get(guid)
                    .is_some_and(|entity| entity.generation == *generation) =>
            {
                self.entities.remove(guid);
            }
            ClientViewEvent::PresentationTick {
                dynamic: Some(batch),
                ..
            }
            | ClientViewEvent::DynamicEntity(DynamicEntityEvent::Ticked { batch }) => {
                for entity in batch
                    .advances
                    .iter()
                    .map(|advance| &advance.entity)
                    .chain(&batch.updates)
                {
                    self.entities
                        .insert(entity.identity.guid, ObservedEntity::from(entity.as_ref()));
                }
            }
            ClientViewEvent::EntityHealthUpdated {
                guid,
                health_fraction,
            } => {
                if let Some(entity) = self.entities.get(guid) {
                    let identity = (*guid, entity.generation);
                    if *health_fraction <= 0.0 {
                        self.dead.insert(identity);
                    } else {
                        self.dead.remove(&identity);
                    }
                }
            }
            ClientViewEvent::CombatStatusUpdated(status) => {
                self.desired_target = status.desired.map(|desired| desired.target);
            }
            _ => {}
        }
    }

    fn replace(&mut self, snapshot: &DynamicEntitySnapshot) {
        self.entities = snapshot
            .entities
            .iter()
            .map(|entity| (entity.identity.guid, ObservedEntity::from(entity)))
            .collect();
    }

    fn player(&self, guid: Guid) -> Result<&ObservedEntity> {
        self.entities
            .get(&guid)
            .context("local player has no dynamic level")
    }

    fn nearest_target(&self, player: Guid) -> Result<Option<Guid>> {
        let DynamicEntityPlacementView::World { pose, .. } = self.player(player)?.placement else {
            bail!("stress probe requires a world-placed player");
        };
        Ok(self
            .entities
            .iter()
            .filter_map(|(&guid, entity)| {
                // World already classifies public attackable creatures as Mob, excluding players/vendors.
                if entity.class != DynamicEntityPresentationClass::Mob
                    || entity.hidden
                    || self.dead.contains(&(guid, entity.generation))
                {
                    return None;
                }
                let DynamicEntityPlacementView::World { pose: target, .. } = entity.placement
                else {
                    return None;
                };
                let distance = pose.distance_to(&target);
                (distance.is_finite() && distance <= TARGET_RANGE_M).then_some((distance, guid))
            })
            .min_by(|left, right| left.0.total_cmp(&right.0).then(left.1.cmp(&right.1)))
            .map(|(_, guid)| guid))
    }
}

fn emit(record: Record<'_>) -> Result<()> {
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, &record)?;
    writeln!(stdout)?;
    Ok(())
}

fn send(
    commands: &mpsc::UnboundedSender<ClientCommand>,
    start: Instant,
    stimulus: Stimulus,
) -> Result<()> {
    let command = match stimulus {
        Stimulus::Forward => ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(
            CharacterDrive::builder().walk().forward().build(),
        )),
        Stimulus::Backstep => ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(
            CharacterDrive::builder().walk().backstep().build(),
        )),
        Stimulus::ReleaseManual => ClientCommand::DriveSelf(PlayerDriveIntent::ReleaseManual),
        Stimulus::Engage { target } => ClientCommand::BeginCombatEngagement {
            target,
            profile: ClientAttackProfile::Melee {
                height: AttackHeight::Medium,
                power: 0.5,
            },
        },
        Stimulus::Stop => ClientCommand::DriveSelf(PlayerDriveIntent::Stop),
    };
    commands
        .send(command)
        .context("stress runtime stopped before control enqueue")?;
    emit(Record::Requested {
        at_seconds: start.elapsed().as_secs_f64(),
        stimulus,
    })
}

pub(super) async fn run(
    mut client: ClientRuntime,
    password: String,
    character: Option<u32>,
    seconds: u64,
) -> Result<()> {
    ensure!(
        log::log_enabled!(target: "holtburger_core::client::runtime_profile", log::Level::Debug)
            && log::log_enabled!(target: "holtburger_world::spatial::contact_profile", log::Level::Debug),
        "stress requires RUST_LOG=warn,holtburger_core::client::runtime_profile=debug,holtburger_world::spatial::contact_profile=debug"
    );
    let mut events = client.subscribe_client_view_events();
    let (commands, rx) = mpsc::unbounded_channel();
    client.set_command_rx(rx);
    let mut task = tokio::spawn(async move { client.run().await });
    let result = observe(&commands, &mut events, password, character, seconds).await;
    // Always retire controls and disconnect, including lifecycle, receiver-lag, and output failures.
    let stopped = commands.send(ClientCommand::StopCombatEngagement);
    let released = commands.send(ClientCommand::DriveSelf(PlayerDriveIntent::Stop));
    let disconnected = commands.send(ClientCommand::Disconnect);
    let joined = match timeout(Duration::from_secs(5), &mut task).await {
        Ok(joined) => joined.context("stress runtime task failed")?,
        Err(_) => {
            task.abort();
            let stopped = task.await;
            ensure!(
                stopped.is_err_and(|error| error.is_cancelled()),
                "stress runtime failed during shutdown"
            );
            bail!("stress runtime did not disconnect; observation: {result:?}");
        }
    };
    result?;
    stopped.context("runtime stopped before combat retirement")?;
    released.context("runtime stopped before movement retirement")?;
    disconnected.context("runtime stopped before disconnect")?;
    joined.context("stress runtime failed")
}

async fn observe(
    commands: &mpsc::UnboundedSender<ClientCommand>,
    events: &mut broadcast::Receiver<ClientViewEvent>,
    password: String,
    character: Option<u32>,
    seconds: u64,
) -> Result<()> {
    let player = super::enter_world(commands, events, password, character).await?;
    commands.send(ClientCommand::RequestCurrentApplicationState)?;
    let mut mirror = Mirror::default();
    let settled = Instant::now() + SETTLEMENT;
    while let Ok(event) = timeout_at(settled, events.recv()).await {
        let event = event.context("stress settlement stream failed")?;
        require_active_world(&event, player)?;
        mirror.observe(&event);
    }
    let DynamicEntityPlacementView::World { pose, .. } = mirror.player(player)?.placement else {
        bail!("stress player is not world placed after settlement");
    };
    let start = Instant::now();
    let deadline = start + Duration::from_secs(seconds);
    let mut controls = tokio::time::interval(CONTROL_PERIOD);
    controls.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut previous_phase = None;
    let mut engagement_requests = 0;
    let mut player_advances = 0;
    let mut combat_active_observed = false;
    emit(Record::Started {
        player,
        seconds,
        pose,
    })?;
    // Same stderr stream as profiles defines the audit window; omit its boundary-straddling tick.
    eprintln!("H3D_STRESS_WINDOW start");
    let outcome: Result<()> = async {
        loop {
            tokio::select! {
                _ = tokio::time::sleep_until(deadline) => break,
                _ = controls.tick() => {
                    // Use elapsed wall time so a delayed callback cannot compress multiple phases.
                    let phase = Phase::at(start.elapsed());
                    if previous_phase != Some(phase) {
                        send(commands, start, phase.stimulus())?;
                    }
                    if phase == Phase::Combat && mirror.desired_target.is_none()
                        && let Some(target) = mirror.nearest_target(player)? {
                        send(commands, start, Stimulus::Engage { target })?;
                        engagement_requests += 1;
                    }
                    previous_phase = Some(phase);
                }
                event = events.recv() => {
                    let event = event.context("stress observation stream failed")?;
                    require_active_world(&event, player)?;
                    mirror.observe(&event);
                    match &event {
                        ClientViewEvent::CombatStatusUpdated(status) => {
                            let active = status.state == ClientCombatControlState::Active;
                            combat_active_observed |= active;
                            emit(Record::Combat { at_seconds: start.elapsed().as_secs_f64(), desired_target: status.desired.map(|desired| desired.target), active })?;
                        }
                        ClientViewEvent::PresentationTick { dynamic: Some(batch), .. }
                        | ClientViewEvent::DynamicEntity(DynamicEntityEvent::Ticked { batch }) => {
                            player_advances += observe_player(&mirror, player, batch, start)?;
                        }
                        _ => {}
                    }
                }
            }
        }
        send(commands, start, Stimulus::Stop)?;
        emit(Record::Finished { elapsed_seconds: start.elapsed().as_secs_f64(), engagement_requests, player_advances, combat_active_observed })?;
        ensure!(engagement_requests > 0, "stress window found no selectable mob within {TARGET_RANGE_M} meters");
        ensure!(player_advances > 0, "stress window published no accepted player paths");
        ensure!(combat_active_observed, "stress attack owner never entered its active state");
        Ok(())
    }.await;
    eprintln!("H3D_STRESS_WINDOW end");
    outcome
}

/// A reset or lost lifecycle invalidates the whole measurement, including settlement.
fn require_active_world(event: &ClientViewEvent, player: Guid) -> Result<()> {
    match event {
        ClientViewEvent::PresentationDiscontinuity { .. }
        | ClientViewEvent::RuntimeBodiesReset { .. } => {
            bail!("stress window interrupted by a world discontinuity")
        }
        ClientViewEvent::LifecycleChanged(state) if *state != ClientLifecycleState::InWorld => {
            bail!("stress window left the active world")
        }
        ClientViewEvent::EntityHealthUpdated {
            guid,
            health_fraction,
        } if *guid == player && *health_fraction <= 0.0 => bail!("stress player died"),
        _ => Ok(()),
    }
}

fn observe_player(
    mirror: &Mirror,
    player: Guid,
    batch: &DynamicEntityTickBatch,
    start: Instant,
) -> Result<usize> {
    let advance = batch
        .advances
        .iter()
        .find(|advance| advance.entity.identity.guid == player);
    let travel = advance.map_or(Travel::Stable, |advance| Travel::Advanced {
        disposition: advance.kind,
        path: &advance.path,
    });
    emit(Record::Player {
        at_seconds: start.elapsed().as_secs_f64(),
        host_time: batch.host_time,
        published_interval_ms: batch.duration_ms,
        dynamic_entities: mirror.entities.len(),
        placement: &mirror.player(player)?.placement,
        travel,
    })?;
    Ok(usize::from(advance.is_some()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_core::{
        DynamicEntityContactView, DynamicEntitySampleModeView, DynamicEntitySpatialMembership,
    };

    fn entity(class: DynamicEntityPresentationClass, distance: f32) -> ObservedEntity {
        ObservedEntity {
            generation: 1,
            placement: DynamicEntityPlacementView::World {
                pose: WorldPosition {
                    landblock_id: Guid(0x1234_0001),
                    coords: Vector3::new(distance, 0.0, 0.0),
                    rotation: Quaternion::identity(),
                },
                spatial_membership: DynamicEntitySpatialMembership::from(
                    &holtburger_world::SpatialMembership::outdoor(),
                ),
                contact: DynamicEntityContactView::Grounded,
                sample_mode: DynamicEntitySampleModeView::SimulatingMotionState,
            },
            class,
            hidden: false,
        }
    }

    #[test]
    fn target_selection_excludes_friendly_hidden_dead_and_distant_entities_but_allows_respawns() {
        let player = Guid(1);
        let dead = Guid(2);
        let live = Guid(3);
        let hidden = Guid(5);
        let mut mirror = Mirror::default();
        mirror
            .entities
            .insert(player, entity(DynamicEntityPresentationClass::Player, 0.0));
        mirror.entities.insert(
            dead,
            entity(DynamicEntityPresentationClass::Mob, TARGET_RANGE_M / 2.0),
        );
        mirror.entities.insert(
            live,
            entity(DynamicEntityPresentationClass::Mob, TARGET_RANGE_M * 0.75),
        );
        mirror.entities.insert(
            Guid(4),
            entity(DynamicEntityPresentationClass::Npc, TARGET_RANGE_M / 4.0),
        );
        let mut hidden_entity = entity(DynamicEntityPresentationClass::Mob, TARGET_RANGE_M / 4.0);
        hidden_entity.hidden = true;
        mirror.entities.insert(hidden, hidden_entity);
        mirror.entities.insert(
            Guid(6),
            entity(DynamicEntityPresentationClass::Mob, TARGET_RANGE_M * 2.0),
        );
        mirror.observe(&ClientViewEvent::EntityHealthUpdated {
            guid: dead,
            health_fraction: 0.0,
        });
        assert_eq!(mirror.nearest_target(player).unwrap(), Some(live));
        mirror.entities.get_mut(&dead).unwrap().generation += 1;
        assert_eq!(mirror.nearest_target(player).unwrap(), Some(dead));
        let generation = mirror.entities[&dead].generation;
        mirror.observe(&ClientViewEvent::DynamicEntity(
            DynamicEntityEvent::Removed {
                guid: dead,
                generation: generation - 1,
            },
        ));
        assert_eq!(mirror.nearest_target(player).unwrap(), Some(dead));
        mirror.observe(&ClientViewEvent::DynamicEntity(
            DynamicEntityEvent::Removed {
                guid: dead,
                generation,
            },
        ));
        assert_eq!(mirror.nearest_target(player).unwrap(), Some(live));
    }

    #[test]
    fn delayed_control_observes_current_phase_without_replaying_missed_movement() {
        assert_eq!(Phase::at(Duration::ZERO), Phase::Forward);
        assert_eq!(Phase::at(CONTROL_PERIOD), Phase::Backstep);
        assert_eq!(Phase::at(CONTROL_PERIOD * 2), Phase::Combat);
        // A delayed observer enters combat directly in its current cycle.
        assert_eq!(Phase::at(CYCLE * 3 + CONTROL_PERIOD * 4), Phase::Combat);
        assert_eq!(Phase::at(CYCLE * 4), Phase::Forward);
    }
}
