//! Target-local lock feedback; broadcast evidence deliberately makes no actor attribution.

use holtburger_common::Guid;
use holtburger_common::properties::{PropertyBool, PropertyUpdate};
use serde::Serialize;

use super::{ClientRuntime, ClientViewEvent};

/// ACE/Source/ACE.Entity/Enum/Sound.cs: failed lockpick broadcast on the target.
const PICKLOCK_FAIL_SOUND: u32 = 0x92;
/// ACE also uses this sound for housing-storage permission denial; the visual remains target-local.
pub(super) const OPEN_FAIL_DUE_TO_LOCK_SOUND: u32 = 0x94;

/// Observed result at a lock, independent of any local helper or request lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LockFeedbackOutcome {
    /// The server explicitly updated the target to unlocked.
    Unlocked,
    /// A lock rejected opening, a lockpick, or a key.
    Failed,
}

/// A transient observation bound to an exact target incarnation and world lifetime.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockFeedback {
    /// Target object, never the player's mutable selection.
    pub target: Guid,
    /// Authoritative target instance sequence at observation.
    pub generation: u64,
    /// Discontinuity generation prevents replay in a replacement world.
    pub world_generation: u64,
    /// Interpretation computed once from server evidence.
    pub outcome: LockFeedbackOutcome,
}

impl ClientRuntime {
    /// Observe before scene/audio admission: UI completion and sounds use different ACE queues.
    pub(super) fn observe_lock_sound(&self, target: Guid, sound_id: u32) {
        // ACE Sound.PicklockFail and OpenFailDueToLock (Lock.cs and Door.cs/Chest.cs).
        // These broadcasts identify the target, not the actor; nearby attempts also count.
        if matches!(sound_id, PICKLOCK_FAIL_SOUND | OPEN_FAIL_DUE_TO_LOCK_SOUND) {
            self.emit_lock_feedback(target, LockFeedbackOutcome::Failed);
        }
    }

    /// Property events are explicit updates; initial object hydration does not produce effects.
    pub(super) fn observe_lock_properties(&self, target: Guid, updates: &[PropertyUpdate]) {
        if updates
            .iter()
            .any(|update| matches!(update, PropertyUpdate::Bool(PropertyBool::Locked, false)))
        {
            self.emit_lock_feedback(target, LockFeedbackOutcome::Unlocked);
        }
    }

    pub(super) fn emit_lock_feedback(&self, target: Guid, outcome: LockFeedbackOutcome) {
        let Some(entity) = self.world.entities.get(target) else {
            return;
        };
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::LockFeedback(LockFeedback {
                target,
                generation: u64::from(entity.instance_sequence()),
                world_generation: self.world_generation,
                outcome,
            }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{ClientState, PendingOperation, builder};
    use holtburger_common::position::WorldPosition;
    use holtburger_protocol::{
        errors::WeenieError,
        messages::{GameMessage, PlaySoundData, PublicUpdatePropertyBoolData},
        traits::ProtocolPack,
    };
    use holtburger_world::{entity::Entity, item_use::ItemUseIntent};

    #[tokio::test]
    async fn target_sound_feedback_survives_completion_without_scene_admission() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let target = Guid(7);
        client.world.add_entity(Entity::new(
            target,
            "Chest".into(),
            WorldPosition::default(),
        ));
        client.arm_busy_operation(PendingOperation::GuardedUse {
            sequence: 41,
            intent: ItemUseIntent::Targeted {
                source: Guid(8),
                target,
            },
            spell_target: None,
        });
        client
            .finish_busy_operation_from_use_done(WeenieError::None)
            .await
            .unwrap();
        let mut events = client.subscribe_client_view_events();
        // Smartbox sound may follow the UI completion. No pending operation or scene is required.
        for sound_id in [PICKLOCK_FAIL_SOUND, OPEN_FAIL_DUE_TO_LOCK_SOUND] {
            let mut bytes = Vec::new();
            GameMessage::PlaySound(Box::new(PlaySoundData {
                target,
                sound_id,
                volume: 1.0,
            }))
            .pack(&mut bytes);
            client.handle_message(&bytes).await.unwrap();
            let mut observations = Vec::new();
            while let Ok(event) = events.try_recv() {
                if let ClientViewEvent::LockFeedback(feedback) = event {
                    observations.push(feedback);
                }
            }
            assert_eq!(observations.len(), 1);
            assert_eq!(observations[0].target, target);
            assert_eq!(observations[0].outcome, LockFeedbackOutcome::Failed);
        }
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn wrong_key_retains_the_submitted_target_and_does_not_infer_success_from_completion() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let target = Guid(7);
        client
            .world
            .add_entity(Entity::new(target, "Door".into(), WorldPosition::default()));
        let mut events = client.subscribe_client_view_events();
        for error in [WeenieError::KeyDoesntFitThisLock, WeenieError::None] {
            client.arm_busy_operation(PendingOperation::GuardedUse {
                sequence: 41,
                intent: ItemUseIntent::Targeted {
                    source: Guid(8),
                    target,
                },
                spell_target: None,
            });
            client
                .finish_busy_operation_from_use_done(error)
                .await
                .unwrap();
            let mut feedback = Vec::new();
            while let Ok(event) = events.try_recv() {
                if let ClientViewEvent::LockFeedback(observation) = event {
                    feedback.push(observation);
                }
            }
            assert_eq!(feedback.len(), usize::from(error != WeenieError::None));
            if let Some(observation) = feedback.first() {
                assert_eq!(observation.target, target);
                assert_eq!(observation.outcome, LockFeedbackOutcome::Failed);
            }
        }
    }

    #[tokio::test]
    async fn only_explicit_unlock_updates_and_known_failure_sounds_emit_feedback() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let target = Guid(7);
        let mut events = client.subscribe_client_view_events();
        client.world.add_entity(Entity::new(
            target,
            "Chest".into(),
            WorldPosition::default(),
        ));
        client.observe_lock_sound(target, 0x93); // Key success sound duplicates the property evidence.
        client.observe_lock_sound(Guid(99), PICKLOCK_FAIL_SOUND);
        assert!(events.try_recv().is_err());
        // Exercise decode -> world property update -> core observation, not just the helper.
        for (sequence, locked) in [(1, true), (2, false)] {
            let mut bytes = Vec::new();
            GameMessage::PublicUpdatePropertyBool(Box::new(PublicUpdatePropertyBoolData {
                sequence,
                guid: target,
                property: PropertyBool::Locked as u32,
                value: locked,
            }))
            .pack(&mut bytes);
            client.handle_message(&bytes).await.unwrap();
            let mut observations = Vec::new();
            while let Ok(event) = events.try_recv() {
                if let ClientViewEvent::LockFeedback(feedback) = event {
                    observations.push(feedback);
                }
            }
            assert_eq!(observations.len(), usize::from(!locked));
            if let Some(observation) = observations.first() {
                assert_eq!(observation.target, target);
                assert_eq!(observation.outcome, LockFeedbackOutcome::Unlocked);
                assert_eq!(observation.world_generation, client.world_generation);
                assert_eq!(
                    observation.generation,
                    u64::from(
                        client
                            .world
                            .entities
                            .get(target)
                            .unwrap()
                            .instance_sequence()
                    )
                );
            }
        }
    }
}
