//! Explorer-only dynamic-entity and possession wire contracts.

use serde::{Deserialize, Serialize};

use crate::{explorer_entity_runtime, explorer_possession_control};

/// Stable lifecycle identity returned after one focused Explorer mutation commits and publishes.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerEntityMutationReceipt {
    /// App-local live identity.
    pub guid: holtburger_common::Guid,
    /// Monotonic instance generation guarding late frontend realization.
    pub generation: u64,
}

/// Explorer-local choice for whether an entity is presentation-only or physically integrated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExplorerPhysicalMode {
    /// Retain authoritative pose and presentation without local physical roles.
    PoseOnly,
    /// Resolve target and integration demand from the entity's complete semantic state.
    Integrated,
}

/// Typed simulation flag and realization-mode update requested by one Explorer scenario.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceExplorerEntityPhysicsStateRequest {
    /// Exact current entity identity.
    pub guid: holtburger_common::Guid,
    /// Exact current instance generation.
    pub generation: u64,
    /// Typed simulation flags merged onto the entity's current `PhysicsState` on the host.
    pub flags: holtburger_core::DynamicEntityPhysicsFlags,
    /// Explicit Explorer-local physical realization policy.
    pub physical_mode: ExplorerPhysicalMode,
}

/// Frontend request naming which entity to possess, or releasing whatever is possessed.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PossessExplorerEntityRequest {
    /// Entity to possess. `None` releases.
    pub guid: Option<holtburger_common::Guid>,
}

/// What the frontend needs to render possession: identity and what the entity can actually do.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPossessionReceipt {
    pub guid: Option<holtburger_common::Guid>,
    pub entity_generation: Option<u64>,
    pub possession_generation: u64,
    pub motion_table_id: Option<String>,
    pub accepted_stance: Option<u32>,
    pub run_rate_capability: Option<explorer_possession_control::PossessionRunRateCapability>,
    pub stances: Vec<explorer_possession_control::PossessionStanceCapability>,
}

impl ExplorerPossessionReceipt {
    pub fn active(possession: explorer_entity_runtime::ExplorerPossession) -> Self {
        Self {
            guid: Some(possession.guid),
            entity_generation: Some(possession.entity_generation),
            possession_generation: possession.possession_generation,
            motion_table_id: Some(format!("0x{:08x}", possession.motion_table_id)),
            accepted_stance: Some(possession.accepted_stance),
            run_rate_capability: Some(possession.run_rate_capability),
            stances: possession.stances,
        }
    }

    pub fn released(possession_generation: u64) -> Self {
        Self {
            guid: None,
            entity_generation: None,
            possession_generation,
            motion_table_id: None,
            accepted_stance: None,
            run_rate_capability: None,
            stances: Vec::new(),
        }
    }
}

/// Replaceable semantic character intent targeted at one exact possession epoch.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPossessionIntentWireRequest {
    possession_generation: u64,
    revision: u64,
    stance: u32,
    drive: explorer_possession_control::CharacterDriveRequest,
    run_rate_scalar: f32,
}

impl ExplorerPossessionIntentWireRequest {
    pub fn resolve(
        self,
    ) -> Result<explorer_entity_runtime::ExplorerPossessionIntentRequest, String> {
        explorer_possession_control::PossessionRunRateScalar::new(self.run_rate_scalar)
            .map_err(|error| error.to_string())?;
        Ok(explorer_entity_runtime::ExplorerPossessionIntentRequest {
            possession_generation: self.possession_generation,
            revision: self.revision,
            stance: self.stance,
            drive: self.drive.resolve(),
            run_rate_scalar: self.run_rate_scalar,
        })
    }
}

/// Relative yaw displacement applied to the currently possessed entity.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyExplorerPossessionYawRequest {
    /// Exact possession epoch that owns this yaw sample.
    pub possession_generation: u64,
    /// Relative clockwise facing displacement in radians.
    pub delta_radians: f32,
}

/// Lifecycle payload whose drive and stance come from the enclosing semantic snapshot.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ExplorerPossessionEventKind {
    BeginJump,
    ReleaseJump { extent: f32 },
    Reset,
}

/// Ordered edge carrying its complete contemporaneous semantic intent.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPossessionEventWireRequest {
    possession_generation: u64,
    sequence: u64,
    revision: u64,
    stance: u32,
    drive: explorer_possession_control::CharacterDriveRequest,
    run_rate_scalar: f32,
    #[serde(flatten)]
    event: ExplorerPossessionEventKind,
}

impl ExplorerPossessionEventWireRequest {
    pub fn resolve(
        self,
    ) -> Result<explorer_entity_runtime::ExplorerPossessionEventRequest, String> {
        explorer_possession_control::PossessionRunRateScalar::new(self.run_rate_scalar)
            .map_err(|error| error.to_string())?;
        let event = match self.event {
            ExplorerPossessionEventKind::BeginJump => {
                explorer_possession_control::PossessionLifecycleEvent::BeginJump
            }
            ExplorerPossessionEventKind::ReleaseJump { extent } => {
                explorer_possession_control::PossessionLifecycleEvent::ReleaseJump {
                    extent: holtburger_core::JumpExtent::new(extent)
                        .map_err(|error| format!("invalid possession jump extent: {error:?}"))?,
                }
            }
            ExplorerPossessionEventKind::Reset => {
                explorer_possession_control::PossessionLifecycleEvent::Reset
            }
        };
        Ok(explorer_entity_runtime::ExplorerPossessionEventRequest {
            possession_generation: self.possession_generation,
            sequence: self.sequence,
            revision: self.revision,
            stance: self.stance,
            drive: self.drive.resolve(),
            run_rate_scalar: self.run_rate_scalar,
            event,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wire_drive() -> explorer_possession_control::CharacterDriveRequest {
        explorer_possession_control::CharacterDriveRequest {
            gait: explorer_possession_control::CharacterGaitRequest::Run,
            longitudinal: Some(explorer_possession_control::CharacterLongitudinalRequest::Forward),
            lateral: None,
            turn: None,
        }
    }

    #[test]
    fn possession_wire_requests_reject_non_finite_or_out_of_range_run_rates() {
        for run_rate_scalar in [f32::NAN, f32::INFINITY, 0.5, 10.001] {
            let request = ExplorerPossessionIntentWireRequest {
                possession_generation: 1,
                revision: 1,
                stance: 0x8000_003d,
                drive: wire_drive(),
                run_rate_scalar,
            };
            assert!(
                request.resolve().is_err(),
                "wire intent must reject {run_rate_scalar:?}"
            );

            let event = ExplorerPossessionEventWireRequest {
                possession_generation: 1,
                sequence: 0,
                revision: 1,
                stance: 0x8000_003d,
                drive: wire_drive(),
                run_rate_scalar,
                event: ExplorerPossessionEventKind::BeginJump,
            };
            assert!(
                event.resolve().is_err(),
                "wire lifecycle edge must reject {run_rate_scalar:?}"
            );
        }
    }
}
