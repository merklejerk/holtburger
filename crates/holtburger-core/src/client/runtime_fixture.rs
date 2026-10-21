//! Ordered headless-scene inputs for diagnostic replay through production core updates.
//!
//! This is a paced workload fixture, not deterministic simulation serialization. Content loading
//! and code using wall clocks still run normally; population mismatches are reported explicitly.
//! Incoming messages can contain character/chat data. Keep raw fixtures private.

use super::runtime_profile::RuntimePhaseProfile;
use super::{ClientCommand, ClientRuntime, ClientRuntimeBuilder, ClientState};
use anyhow::{Result, bail, ensure};
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_world::SpatialBodyId;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

const FORMAT_VERSION: u32 = 1;
const MAX_DURATION: Duration = Duration::from_secs(300);

/// Versioned, ordered authority inputs. Outbound login/password data is never recorded.
#[derive(Serialize, Deserialize)]
pub struct RuntimeFixture {
    /// Rejects schemas whose input semantics are incompatible with this reader.
    version: u32,
    /// Every supported input in authority processing order, including startup.
    events: Vec<TimedInput>,
}

/// Timestamp measured when core begins handling this input, relative to capture start.
#[derive(Serialize, Deserialize)]
struct TimedInput {
    /// Wall-clock offset at dispatch, before the corresponding operation runs.
    at: Duration,
    /// Inbound message, time sample, selection, or physics boundary.
    input: RuntimeFixtureInput,
}

/// Inputs supported by the stationary scene probe; unsupported commands fail capture explicitly.
#[derive(Serialize, Deserialize)]
pub(super) enum RuntimeFixtureInput {
    /// Complete reassembled incoming game message, before character-event ordering.
    Message(Vec<u8>),
    /// Session-delivered server time sample.
    TimeSync(f64),
    /// The one supported world-entry command; no credential fields.
    SelectCharacter(Guid),
    /// Production physics boundary with captured interval and population audit.
    Physics {
        /// Elapsed interval passed into simulation time admission.
        elapsed: Duration,
        /// Pre-step entity count, compared during replay to expose population drift.
        entities: usize,
    },
}

/// In-memory recording avoids synchronous disk writes in measured update paths.
pub(super) struct RuntimeFixtureCapture {
    /// Common origin for ordered dispatch offsets.
    started: Instant,
    /// Recorded inputs, persisted only after capture completes.
    events: Vec<TimedInput>,
}

impl RuntimeFixtureCapture {
    pub(super) fn record(&mut self, input: RuntimeFixtureInput) {
        self.events.push(TimedInput {
            at: self.started.elapsed(),
            input,
        });
    }

    pub(super) fn record_command(&mut self, command: &ClientCommand) -> Result<()> {
        match command {
            ClientCommand::SelectCharacter(guid) => {
                self.record(RuntimeFixtureInput::SelectCharacter(*guid));
            }
            // Login is deliberately excluded. Snapshot requests and shutdown do not drive physics.
            ClientCommand::Login(_)
            | ClientCommand::RequestCurrentApplicationState
            | ClientCommand::Disconnect => {}
            _ => bail!("runtime fixture supports only stationary scene observation commands"),
        }
        Ok(())
    }
}

impl ClientRuntime {
    /// Starts one bounded stationary-scene recording before login/character selection.
    pub fn start_fixture_capture(&mut self) -> Result<()> {
        ensure!(
            self.runtime_fixture.is_none(),
            "runtime fixture capture already started"
        );
        ensure!(
            self.state == ClientState::Connected,
            "start fixture capture before login"
        );
        self.runtime_fixture = Some(RuntimeFixtureCapture {
            started: Instant::now(),
            events: Vec::new(),
        });
        Ok(())
    }

    /// Retires capture after the runtime stops. Callers own private artifact storage.
    pub fn finish_fixture_capture(&mut self) -> Result<RuntimeFixture> {
        let Some(capture) = self.runtime_fixture.take() else {
            bail!("runtime fixture capture was not started");
        };
        let fixture = RuntimeFixture {
            version: FORMAT_VERSION,
            events: capture.events,
        };
        fixture.validate()?;
        Ok(fixture)
    }
}

/// Sanitized costs exclude pacing waits and content bootstrap before playback.
#[derive(Debug, Default, Serialize)]
pub struct RuntimeFixtureReport {
    /// Number of inbound game messages replayed in original order.
    pub messages: usize,
    /// All authority steps, including world-entry preparation.
    pub physics_ticks: usize,
    /// Steps that began in the fully activated world.
    pub active_ticks: usize,
    /// First physics-entry state and subsequent transitions, distinguishing startup from resets.
    pub activation_boundaries: Vec<RuntimeFixtureActivationBoundary>,
    /// Ticks with a different pre-step entity population than the capture.
    pub population_mismatches: usize,
    /// Largest pre-step entity population observed during replay.
    pub peak_entities: usize,
    /// Cumulative elapsed time inside production message handling, excluding transport receive.
    pub message_work_ms: f64,
    /// Cumulative elapsed time inside production physics updates, including content polling.
    pub physics_work_ms: f64,
    /// Longest production physics update.
    pub maximum_physics_work_ms: f64,
    /// Nearest-rank p95 of steps that began in the activated world; excludes startup steps.
    pub active_physics_work_p95_ms: f64,
    /// Largest dispatch delay beyond a recorded offset, exposing playback backlog.
    pub maximum_input_lateness_ms: f64,
    /// Final authoritative player position; this does not audit simulated displacement.
    pub final_player_position: Option<WorldPosition>,
    /// Final simulated player pose, distinct from the last authoritative position.
    pub final_runtime_player_position: Option<WorldPosition>,
}

/// One change in whether a recorded physics input begins in an activated world.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct RuntimeFixtureActivationBoundary {
    /// One-based physics input index within this complete replay.
    pub physics_tick: usize,
    /// Whether that input began after world activation completed.
    pub active: bool,
}

impl RuntimeFixtureReport {
    /// Retain timing qualification without allocating one record for every stable tick.
    fn observe_activation(&mut self, active: bool) {
        self.active_ticks += usize::from(active);
        if self
            .activation_boundaries
            .last()
            .is_none_or(|previous| previous.active != active)
        {
            self.activation_boundaries
                .push(RuntimeFixtureActivationBoundary {
                    physics_tick: self.physics_ticks,
                    active,
                });
        }
    }
}

impl RuntimeFixture {
    /// Reject incompatible, out-of-order, oversized, or incomplete input sequences before replay.
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.version == FORMAT_VERSION,
            "unsupported runtime fixture version"
        );
        ensure!(
            self.events.len() <= 1_000_000,
            "runtime fixture has too many inputs"
        );
        let mut previous = Duration::ZERO;
        let mut selections = 0;
        let mut messages = 0;
        let mut physics = 0;
        for event in &self.events {
            ensure!(
                event.at >= previous,
                "runtime fixture inputs are out of order"
            );
            ensure!(
                event.at <= MAX_DURATION,
                "runtime fixture exceeds five minutes"
            );
            previous = event.at;
            match &event.input {
                RuntimeFixtureInput::SelectCharacter(_) => selections += 1,
                RuntimeFixtureInput::Message(data) => {
                    ensure!(
                        !data.is_empty(),
                        "runtime fixture contains an empty message"
                    );
                    ensure!(
                        data.len() <= 16 * 1024 * 1024,
                        "runtime fixture message exceeds 16 MiB"
                    );
                    messages += 1;
                }
                RuntimeFixtureInput::Physics { elapsed, .. } => {
                    ensure!(
                        !elapsed.is_zero(),
                        "runtime fixture contains a zero physics interval"
                    );
                    ensure!(
                        *elapsed <= MAX_DURATION,
                        "runtime fixture physics interval exceeds five minutes"
                    );
                    physics += 1;
                }
                RuntimeFixtureInput::TimeSync(time) => {
                    ensure!(
                        time.is_finite(),
                        "runtime fixture contains non-finite server time"
                    );
                }
            }
        }
        ensure!(
            selections == 1,
            "runtime fixture must select exactly one character"
        );
        ensure!(messages > 0, "runtime fixture contains no messages");
        ensure!(physics > 0, "runtime fixture contains no physics steps");
        Ok(())
    }

    /// Replays fixed ordered inputs at their recorded offsets, with recorded simulation intervals.
    /// Outbound actions are discarded by Session's in-memory transport; no server is contacted.
    pub async fn replay(&self, builder: ClientRuntimeBuilder) -> Result<RuntimeFixtureReport> {
        self.validate()?;
        let mut client = builder.build_fixture_client()?;
        let mut report = RuntimeFixtureReport::default();
        let mut active_physics_work = Vec::new();
        let started = Instant::now();
        for event in &self.events {
            tokio::time::sleep_until(tokio::time::Instant::from_std(started + event.at)).await;
            let lateness = started.elapsed().saturating_sub(event.at).as_secs_f64() * 1000.0;
            report.maximum_input_lateness_ms = report.maximum_input_lateness_ms.max(lateness);
            match &event.input {
                RuntimeFixtureInput::Message(data) => {
                    let begin = Instant::now();
                    client.handle_message(data).await?;
                    report.message_work_ms += begin.elapsed().as_secs_f64() * 1000.0;
                    report.messages += 1;
                }
                RuntimeFixtureInput::TimeSync(time) => {
                    client.sync_server_time(*time, Instant::now())
                }
                RuntimeFixtureInput::SelectCharacter(guid) => {
                    client
                        .handle_command(ClientCommand::SelectCharacter(*guid))
                        .await?;
                }
                RuntimeFixtureInput::Physics { elapsed, entities } => {
                    let population = client.world.entities.len();
                    report.population_mismatches += usize::from(population != *entities);
                    report.peak_entities = report.peak_entities.max(population);
                    report.physics_ticks += 1;
                    let active =
                        client.activation.is_none() && client.state == ClientState::InWorld;
                    report.observe_activation(active);
                    let begin = Instant::now();
                    client
                        .advance_physics_tick(
                            begin,
                            *elapsed,
                            RuntimePhaseProfile::begin("physics_tick"),
                        )
                        .await?;
                    let work = begin.elapsed().as_secs_f64() * 1000.0;
                    report.physics_work_ms += work;
                    report.maximum_physics_work_ms = report.maximum_physics_work_ms.max(work);
                    if active {
                        active_physics_work.push(work);
                    }
                }
            }
            // Let content worker completions run even when the recorded input deadline has passed.
            tokio::task::yield_now().await;
        }
        report.final_player_position = client.world.player_position();
        report.final_runtime_player_position = client
            .world
            .runtime_body_view(SpatialBodyId::LocalPlayer(client.world.player.guid))
            .map(|body| body.runtime_pose);
        ensure!(
            report.active_ticks > 0,
            "runtime fixture never reached an activated world"
        );
        active_physics_work.sort_unstable_by(f64::total_cmp);
        report.active_physics_work_p95_ms =
            active_physics_work[(95 * active_physics_work.len()).div_ceil(100) - 1];
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activation_history_distinguishes_equal_totals_with_different_readiness() {
        let observe = |states: &[bool]| {
            let mut report = RuntimeFixtureReport::default();
            for &active in states {
                report.physics_ticks += 1;
                report.observe_activation(active);
            }
            report
        };
        let late_start = observe(&[false, false, true, true]);
        let interrupted = observe(&[false, true, false, true]);
        assert_eq!(late_start.active_ticks, interrupted.active_ticks);
        assert_eq!(
            late_start.activation_boundaries,
            vec![
                RuntimeFixtureActivationBoundary {
                    physics_tick: 1,
                    active: false,
                },
                RuntimeFixtureActivationBoundary {
                    physics_tick: 3,
                    active: true,
                },
            ]
        );
        assert_eq!(interrupted.activation_boundaries.len(), 4);
        assert!(interrupted.activation_boundaries[1].active);
        assert!(!interrupted.activation_boundaries[2].active);
    }

    #[test]
    fn credentials_never_become_recorded_inputs() {
        let mut capture = RuntimeFixtureCapture {
            started: Instant::now(),
            events: Vec::new(),
        };
        capture
            .record_command(&ClientCommand::Login("private-test-secret".into()))
            .unwrap();
        capture
            .record_command(&ClientCommand::SelectCharacter(Guid(7)))
            .unwrap();
        assert_eq!(capture.events.len(), 1);
        assert!(matches!(
            capture.events[0].input,
            RuntimeFixtureInput::SelectCharacter(Guid(7))
        ));
    }

    #[test]
    fn unsupported_actions_cannot_silently_produce_an_incomplete_replay() {
        let mut capture = RuntimeFixtureCapture {
            started: Instant::now(),
            events: Vec::new(),
        };
        let error = capture
            .record_command(&ClientCommand::SoulEmote("wave".into()))
            .unwrap_err();
        assert!(error.to_string().contains("stationary scene"));
        assert!(capture.events.is_empty());
    }

    #[test]
    fn replay_rejects_reversed_input_order() {
        let fixture = RuntimeFixture {
            version: FORMAT_VERSION,
            events: vec![
                TimedInput {
                    at: Duration::from_secs(1),
                    input: RuntimeFixtureInput::SelectCharacter(Guid(7)),
                },
                TimedInput {
                    at: Duration::ZERO,
                    input: RuntimeFixtureInput::Message(vec![1]),
                },
            ],
        };
        let error = fixture.validate().unwrap_err();
        assert!(error.to_string().contains("out of order"));
    }
}
