//! Reusable interpretation of semantic character drive and jump commands.

use super::movement_types::CharacterDrive;
use std::time::Duration;

const MINIMUM_RETAIL_JUMP_EXTENT: f32 = 0.001;

/// A finite normalized jump-power request.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JumpExtent(
    /// Validated normalized power in the inclusive retail range.
    f32,
);

impl JumpExtent {
    pub const MINIMUM: Self = Self(MINIMUM_RETAIL_JUMP_EXTENT);
    pub const MAXIMUM: Self = Self(1.0);

    pub fn new(value: f32) -> Result<Self, JumpExtentError> {
        if !value.is_finite() {
            return Err(JumpExtentError::NonFinite);
        }
        if !(MINIMUM_RETAIL_JUMP_EXTENT..=1.0).contains(&value) {
            return Err(JumpExtentError::OutsideRetailRange);
        }
        Ok(Self(value))
    }

    pub const fn get(self) -> f32 {
        self.0
    }
}

/// Why a requested jump extent could not be represented.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JumpExtentError {
    NonFinite,
    OutsideRetailRange,
}

/// Frontend-readable timing policy for converting a hold duration to requested power.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JumpChargeProfile {
    /// Time at which the frontend power bar reaches full charge.
    full_charge_duration: Duration,
}

impl JumpChargeProfile {
    /// Retail's normal one-second charge profile (`acclient.c:390379-390640`).
    pub const RETAIL_STANDARD: Self = Self {
        full_charge_duration: Duration::from_secs(1),
    };

    /// Retail's DualWieldCombat 0.8-second profile (`acclient.c:390379-390640`).
    pub const RETAIL_DUAL_WIELD: Self = Self {
        full_charge_duration: Duration::from_millis(800),
    };

    pub fn new(full_charge_duration: Duration) -> Result<Self, JumpChargeProfileError> {
        if full_charge_duration.is_zero() {
            return Err(JumpChargeProfileError::ZeroDuration);
        }
        Ok(Self {
            full_charge_duration,
        })
    }

    pub const fn full_charge_duration(self) -> Duration {
        self.full_charge_duration
    }

    /// Converts frontend-measured elapsed time into the retail-clamped requested extent.
    pub fn extent_for_elapsed(self, elapsed: Duration) -> JumpExtent {
        let ratio = elapsed.as_secs_f32() / self.full_charge_duration.as_secs_f32();
        JumpExtent(ratio.clamp(MINIMUM_RETAIL_JUMP_EXTENT, 1.0))
    }
}

/// Why a requested charge profile could not be represented.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JumpChargeProfileError {
    ZeroDuration,
}

/// Monotonic ordering token for jump lifecycle edges within one input-ownership epoch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CharacterMotionSequence(
    /// Monotonic value assigned by the current input owner.
    pub u64,
);

/// World-owned readiness required to accept the start of a retail-style jump charge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharacterMotionReadiness {
    Ready,
    Airborne,
    Unsupported,
    Overburdened,
    CapabilityUnavailable,
}

/// An ordered, non-replaceable character-motion lifecycle edge.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SequencedCharacterMotionEvent {
    /// Ordering within the current input-ownership epoch.
    pub sequence: CharacterMotionSequence,
    /// Non-coalescible lifecycle edge at this sequence.
    pub event: CharacterMotionEvent,
}

/// Jump lifecycle events carrying their contemporaneous semantic drive snapshot.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CharacterMotionEvent {
    BeginJump {
        /// Semantic drive sampled at the press edge.
        drive: CharacterDrive,
    },
    ReleaseJump {
        /// Semantic drive sampled at the release edge.
        drive: CharacterDrive,
        /// Frontend-measured and validated requested power.
        extent: JumpExtent,
    },
    Reset,
}

/// Actor-neutral jump request emitted exactly once for an accepted release edge.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JumpAttempt {
    /// Release-time semantic drive used by the actor resolver.
    pub drive: CharacterDrive,
    /// Requested normalized jump power.
    pub extent: JumpExtent,
    /// Whether charge began without translation or turn input.
    pub standing_long_jump: bool,
}

/// Typed result of applying one ordered controller event.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CharacterMotionEventResult {
    ChargeAccepted,
    /// A newer repeated begin edge was consumed without restarting the active charge.
    ChargeContinues,
    JumpReleased(JumpAttempt),
    Reset,
    Rejected(CharacterMotionRejection),
    IgnoredStale {
        /// Most recent event already processed in this ownership epoch.
        last_accepted: CharacterMotionSequence,
    },
}

/// Controller-owned reasons for rejecting an otherwise well-formed event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharacterMotionRejection {
    ChargeNotActive,
    Airborne,
    Unsupported,
    Overburdened,
    CapabilityUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CharacterMotionPhase {
    Idle,
    Charging {
        /// Captured once at charge start; later drive changes do not rewrite it.
        standing_long_jump: bool,
    },
}

/// Deterministic, clock-free interpreter for semantic drive and jump lifecycle edges.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CharacterMotionController {
    /// Latest replaceable semantic drive snapshot.
    drive: CharacterDrive,
    /// Accepted charge lifecycle state.
    phase: CharacterMotionPhase,
    /// Most recent processed lifecycle edge in the current ownership epoch.
    last_sequence: Option<CharacterMotionSequence>,
}

impl Default for CharacterMotionController {
    fn default() -> Self {
        Self {
            drive: CharacterDrive::default(),
            phase: CharacterMotionPhase::Idle,
            last_sequence: None,
        }
    }
}

impl CharacterMotionController {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces coalescible drive state without creating an ordered lifecycle edge.
    pub fn replace_drive(&mut self, drive: CharacterDrive) {
        self.drive = drive;
    }

    /// Returns interpreted drive, suppressing translation during a standing charge.
    pub fn effective_drive(self) -> CharacterDrive {
        match self.phase {
            CharacterMotionPhase::Charging {
                standing_long_jump: true,
            } => self.drive.without_translation(),
            CharacterMotionPhase::Idle
            | CharacterMotionPhase::Charging {
                standing_long_jump: false,
            } => self.drive,
        }
    }

    pub fn is_charging(self) -> bool {
        matches!(self.phase, CharacterMotionPhase::Charging { .. })
    }

    /// Whether the active charge began with no translation or turn input.
    pub fn is_standing_long_jump(self) -> bool {
        matches!(
            self.phase,
            CharacterMotionPhase::Charging {
                standing_long_jump: true
            }
        )
    }

    /// Applies one event if it is newer than every accepted event in this epoch.
    pub fn apply_event(
        &mut self,
        input: SequencedCharacterMotionEvent,
        readiness: CharacterMotionReadiness,
    ) -> CharacterMotionEventResult {
        if let Some(last_accepted) = self.last_sequence
            && input.sequence <= last_accepted
        {
            return CharacterMotionEventResult::IgnoredStale { last_accepted };
        }
        self.last_sequence = Some(input.sequence);

        match input.event {
            CharacterMotionEvent::BeginJump { drive } => {
                self.drive = drive;
                if self.is_charging() {
                    return CharacterMotionEventResult::ChargeContinues;
                }
                let rejection = match readiness {
                    CharacterMotionReadiness::Ready => None,
                    CharacterMotionReadiness::Airborne => Some(CharacterMotionRejection::Airborne),
                    CharacterMotionReadiness::Unsupported => {
                        Some(CharacterMotionRejection::Unsupported)
                    }
                    CharacterMotionReadiness::Overburdened => {
                        Some(CharacterMotionRejection::Overburdened)
                    }
                    CharacterMotionReadiness::CapabilityUnavailable => {
                        Some(CharacterMotionRejection::CapabilityUnavailable)
                    }
                };
                if let Some(rejection) = rejection {
                    return CharacterMotionEventResult::Rejected(rejection);
                }

                self.phase = CharacterMotionPhase::Charging {
                    standing_long_jump: drive.is_stationary(),
                };
                CharacterMotionEventResult::ChargeAccepted
            }
            CharacterMotionEvent::ReleaseJump { drive, extent } => {
                self.drive = drive;
                let CharacterMotionPhase::Charging { standing_long_jump } = self.phase else {
                    return CharacterMotionEventResult::Rejected(
                        CharacterMotionRejection::ChargeNotActive,
                    );
                };
                self.phase = CharacterMotionPhase::Idle;
                CharacterMotionEventResult::JumpReleased(JumpAttempt {
                    drive,
                    extent,
                    standing_long_jump,
                })
            }
            CharacterMotionEvent::Reset => {
                self.drive = CharacterDrive::default();
                self.phase = CharacterMotionPhase::Idle;
                CharacterMotionEventResult::Reset
            }
        }
    }

    /// Clears input ownership, including the sequence epoch.
    pub fn clear(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::movement_types::{LateralMotion, LongitudinalMotion};

    fn event(sequence: u64, event: CharacterMotionEvent) -> SequencedCharacterMotionEvent {
        SequencedCharacterMotionEvent {
            sequence: CharacterMotionSequence(sequence),
            event,
        }
    }

    #[test]
    fn jump_extent_rejects_non_finite_and_out_of_range_values() {
        assert_eq!(JumpExtent::new(f32::NAN), Err(JumpExtentError::NonFinite));
        assert_eq!(
            JumpExtent::new(f32::INFINITY),
            Err(JumpExtentError::NonFinite)
        );
        assert_eq!(
            JumpExtent::new(0.0),
            Err(JumpExtentError::OutsideRetailRange)
        );
        assert_eq!(
            JumpExtent::new(1.01),
            Err(JumpExtentError::OutsideRetailRange)
        );
        assert_eq!(JumpExtent::new(0.5).expect("valid extent").get(), 0.5);
    }

    #[test]
    fn charge_profiles_publish_retail_timing_and_clamp_requested_extent() {
        assert_eq!(
            JumpChargeProfile::new(Duration::ZERO),
            Err(JumpChargeProfileError::ZeroDuration)
        );
        assert_eq!(
            JumpChargeProfile::RETAIL_STANDARD.full_charge_duration(),
            Duration::from_secs(1)
        );
        assert_eq!(
            JumpChargeProfile::RETAIL_STANDARD.extent_for_elapsed(Duration::ZERO),
            JumpExtent::MINIMUM
        );
        assert_eq!(
            JumpChargeProfile::RETAIL_STANDARD
                .extent_for_elapsed(Duration::from_millis(500))
                .get(),
            0.5
        );
        assert_eq!(
            JumpChargeProfile::RETAIL_DUAL_WIELD.extent_for_elapsed(Duration::from_millis(800)),
            JumpExtent::MAXIMUM
        );
        assert_eq!(
            JumpChargeProfile::RETAIL_STANDARD.extent_for_elapsed(Duration::from_secs(2)),
            JumpExtent::MAXIMUM
        );
    }

    #[test]
    fn motion_state_represents_simultaneous_forward_strafe_and_turn() {
        let drive = CharacterDrive::builder()
            .run()
            .forward()
            .strafe_left()
            .turn_right()
            .build();

        assert_eq!(drive.longitudinal, Some(LongitudinalMotion::Forward));
        assert_eq!(drive.lateral, Some(LateralMotion::Left));
        assert!(!drive.is_stationary());
    }

    #[test]
    fn standing_charge_suppresses_translation_but_release_samples_latest_drive() {
        let mut controller = CharacterMotionController::new();
        assert_eq!(
            controller.apply_event(
                event(
                    1,
                    CharacterMotionEvent::BeginJump {
                        drive: CharacterDrive::default(),
                    },
                ),
                CharacterMotionReadiness::Ready,
            ),
            CharacterMotionEventResult::ChargeAccepted
        );

        let release_drive = CharacterDrive::builder()
            .run()
            .forward()
            .strafe_right()
            .build();
        controller.replace_drive(release_drive);
        assert_eq!(controller.effective_drive().longitudinal, None);
        assert_eq!(controller.effective_drive().lateral, None);

        assert_eq!(
            controller.apply_event(
                event(
                    2,
                    CharacterMotionEvent::ReleaseJump {
                        drive: release_drive,
                        extent: JumpExtent::new(0.5).expect("valid extent"),
                    },
                ),
                CharacterMotionReadiness::Ready,
            ),
            CharacterMotionEventResult::JumpReleased(JumpAttempt {
                drive: release_drive,
                extent: JumpExtent::new(0.5).expect("valid extent"),
                standing_long_jump: true,
            })
        );
        assert_eq!(controller.effective_drive(), release_drive);
    }

    #[test]
    fn moving_charge_keeps_emitting_translation() {
        let drive = CharacterDrive::builder().run().forward().build();
        let mut controller = CharacterMotionController::new();

        controller.apply_event(
            event(1, CharacterMotionEvent::BeginJump { drive }),
            CharacterMotionReadiness::Ready,
        );

        assert_eq!(controller.effective_drive(), drive);
    }

    #[test]
    fn begin_requires_walkable_contact_and_repeated_begin_does_not_restart_charge() {
        let mut controller = CharacterMotionController::new();
        let begin = CharacterMotionEvent::BeginJump {
            drive: CharacterDrive::default(),
        };

        assert_eq!(
            controller.apply_event(event(1, begin), CharacterMotionReadiness::Unsupported),
            CharacterMotionEventResult::Rejected(CharacterMotionRejection::Unsupported)
        );
        assert!(!controller.is_charging());
        assert_eq!(
            controller.apply_event(event(2, begin), CharacterMotionReadiness::Ready),
            CharacterMotionEventResult::ChargeAccepted
        );
        assert_eq!(
            controller.apply_event(event(3, begin), CharacterMotionReadiness::Ready),
            CharacterMotionEventResult::ChargeContinues
        );
        assert!(controller.is_charging());
    }

    #[test]
    fn stale_and_duplicate_edges_cannot_retrigger_release() {
        let mut controller = CharacterMotionController::new();
        controller.apply_event(
            event(
                10,
                CharacterMotionEvent::BeginJump {
                    drive: CharacterDrive::default(),
                },
            ),
            CharacterMotionReadiness::Ready,
        );
        let release = CharacterMotionEvent::ReleaseJump {
            drive: CharacterDrive::default(),
            extent: JumpExtent::MAXIMUM,
        };
        assert!(matches!(
            controller.apply_event(event(11, release), CharacterMotionReadiness::Ready),
            CharacterMotionEventResult::JumpReleased(_)
        ));
        assert_eq!(
            controller.apply_event(event(11, release), CharacterMotionReadiness::Ready),
            CharacterMotionEventResult::IgnoredStale {
                last_accepted: CharacterMotionSequence(11)
            }
        );
        assert_eq!(
            controller.apply_event(event(9, release), CharacterMotionReadiness::Ready),
            CharacterMotionEventResult::IgnoredStale {
                last_accepted: CharacterMotionSequence(11)
            }
        );
    }

    #[test]
    fn reset_and_ownership_clear_cancel_charge() {
        let mut controller = CharacterMotionController::new();
        controller.apply_event(
            event(
                1,
                CharacterMotionEvent::BeginJump {
                    drive: CharacterDrive::default(),
                },
            ),
            CharacterMotionReadiness::Ready,
        );
        assert_eq!(
            controller.apply_event(
                event(2, CharacterMotionEvent::Reset),
                CharacterMotionReadiness::Unsupported
            ),
            CharacterMotionEventResult::Reset
        );
        assert!(!controller.is_charging());

        controller.clear();
        assert_eq!(
            controller.apply_event(
                event(
                    1,
                    CharacterMotionEvent::BeginJump {
                        drive: CharacterDrive::default(),
                    },
                ),
                CharacterMotionReadiness::Ready,
            ),
            CharacterMotionEventResult::ChargeAccepted
        );
    }

    #[test]
    fn release_without_charge_is_typed_rejection_and_updates_drive() {
        let mut controller = CharacterMotionController::new();
        let drive = CharacterDrive::builder().walk().backstep().build();

        assert_eq!(
            controller.apply_event(
                event(
                    1,
                    CharacterMotionEvent::ReleaseJump {
                        drive,
                        extent: JumpExtent::MINIMUM,
                    },
                ),
                CharacterMotionReadiness::Ready,
            ),
            CharacterMotionEventResult::Rejected(CharacterMotionRejection::ChargeNotActive)
        );
        assert_eq!(controller.effective_drive(), drive);
    }

    #[test]
    fn gait_and_direction_at_release_are_preserved_in_attempt() {
        let cases = [
            CharacterDrive::builder().walk().forward().build(),
            CharacterDrive::builder().run().backstep().build(),
            CharacterDrive::builder().run().strafe_left().build(),
            CharacterDrive::builder()
                .walk()
                .forward()
                .strafe_right()
                .build(),
        ];

        for release_drive in cases {
            let mut controller = CharacterMotionController::new();
            controller.apply_event(
                event(
                    1,
                    CharacterMotionEvent::BeginJump {
                        drive: CharacterDrive::default(),
                    },
                ),
                CharacterMotionReadiness::Ready,
            );
            let result = controller.apply_event(
                event(
                    2,
                    CharacterMotionEvent::ReleaseJump {
                        drive: release_drive,
                        extent: JumpExtent::MAXIMUM,
                    },
                ),
                CharacterMotionReadiness::Ready,
            );

            assert!(matches!(
                result,
                CharacterMotionEventResult::JumpReleased(JumpAttempt { drive, .. })
                    if drive == release_drive
            ));
        }
    }
}
