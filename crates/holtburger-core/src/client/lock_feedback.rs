//! Target-local lock observations and bounded, best-effort direct-use correlation.

use holtburger_common::Guid;
use holtburger_common::properties::{PropertyBool, PropertyUpdate, WorldObjectExt};
use serde::Serialize;
use std::time::Instant;

use super::{ClientRuntime, ClientViewEvent, PendingOperation};
use crate::{ActionResultReason, ActionResultSource};
use holtburger_protocol::errors::WeenieError;

/// ACE/Source/ACE.Entity/Enum/Sound.cs: failed lockpick broadcast on the target.
const PICKLOCK_FAIL_SOUND: u32 = 0x92;
/// ACE also uses this sound for housing-storage permission denial; the visual remains target-local.
pub(super) const OPEN_FAIL_DUE_TO_LOCK_SOUND: u32 = 0x94;

/// Standard housing storage uses the same failure sound for denied access.
const RETAIL_HOUSING_STORAGE_WCID: u32 = 9687;

/// Evidence is joined in core; a completed use no longer owns the busy admission slot.
#[derive(Debug)]
enum LockUsePhase {
    /// Sound can arrive before UseDone, but cannot authorize another operation yet.
    AwaitingCompletion { rejected: bool },
    /// A successful UseDone can precede the target's broadcast sound.
    Completed,
}

/// One best-effort correlation, replaced by the next admitted operation.
#[derive(Debug)]
pub(super) struct LockUse {
    /// Directly used entity, independent of mutable frontend selection.
    target: Guid,
    /// Replacement instances cannot inherit the old use's evidence.
    generation: u64,
    /// World discontinuities retire evidence even when the target remains hydrated.
    world_generation: u64,
    /// Guarded callers receive their request identity; ordinary callers receive text.
    sequence: Option<u32>,
    /// Original operation lifetime bounds late evidence without extending busy admission.
    pub(super) deadline: Instant,
    /// Completion and sound may arrive in either order.
    phase: LockUsePhase,
}

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
    /// Capture correlation at admission; any newer operation retires the previous encounter.
    pub(super) fn track_lock_use(&mut self, operation: &PendingOperation, deadline: Instant) {
        self.lock_use = operation.direct_use_source().and_then(|target| {
            let entity = self.world.entities.get(target)?;
            Some(LockUse {
                target,
                generation: u64::from(entity.instance_sequence()),
                world_generation: self.world_generation,
                sequence: match operation {
                    PendingOperation::GuardedUse { sequence, .. } => Some(*sequence),
                    _ => None,
                },
                deadline,
                phase: LockUsePhase::AwaitingCompletion { rejected: false },
            })
        });
    }

    /// UseDone releases admission before a correlated rejection is published to consumers.
    pub(super) fn complete_lock_use(&mut self, error: WeenieError) {
        if error != WeenieError::None {
            self.lock_use = None;
            return;
        }
        let Some(pending) = self.lock_use.as_mut() else {
            return;
        };
        let rejected = matches!(
            pending.phase,
            LockUsePhase::AwaitingCompletion { rejected: true }
        );
        pending.phase = LockUsePhase::Completed;
        if rejected {
            self.publish_lock_rejection();
        }
    }

    /// Join an observed opening rejection with the captured direct use, when one exists.
    fn observe_used_lock_rejection(&mut self, target: Guid) {
        let Some(pending) = self
            .lock_use
            .as_mut()
            .filter(|pending| pending.target == target)
        else {
            return;
        };
        match &mut pending.phase {
            LockUsePhase::AwaitingCompletion { rejected } => *rejected = true,
            LockUsePhase::Completed => self.publish_lock_rejection(),
        }
    }

    /// Consume once, and validate the retained incarnation and original deadline at publication.
    fn publish_lock_rejection(&mut self) {
        let Some(pending) = self.lock_use.take() else {
            return;
        };
        let Some(entity) = self.world.entities.get(pending.target).filter(|entity| {
            Instant::now() < pending.deadline
                && self.world_generation == pending.world_generation
                && u64::from(entity.instance_sequence()) == pending.generation
                // Housing permission failures are not evidence of a pickable lock. Custom/remapped
                // storage templates and another player's same-target sound remain ambiguous.
                && entity.wcid != Some(RETAIL_HOUSING_STORAGE_WCID)
        }) else {
            return;
        };
        self.emit_action_result(
            ActionResultSource::Client,
            match pending.sequence {
                Some(sequence) => ActionResultReason::Locked {
                    target: pending.target,
                    name: entity.name().to_owned(),
                    sequence,
                },
                None => ActionResultReason::General(format!("The {} is locked", entity.name())),
            },
        );
    }

    /// Interpret lock sounds before scene/audio admission; use completion arrives independently.
    pub(super) fn observe_lock_sound(&mut self, target: Guid, sound_id: u32) {
        // ACE Sound.PicklockFail and OpenFailDueToLock (Lock.cs and Door.cs/Chest.cs).
        // These broadcasts identify the target, not the actor; nearby attempts also count.
        if matches!(sound_id, PICKLOCK_FAIL_SOUND | OPEN_FAIL_DUE_TO_LOCK_SOUND) {
            self.emit_lock_feedback(target, LockFeedbackOutcome::Failed);
            if sound_id == OPEN_FAIL_DUE_TO_LOCK_SOUND {
                self.observe_used_lock_rejection(target);
            }
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

    fn direct_use_client() -> ClientRuntime {
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.add_entity(Entity::new(
            Guid(7),
            "Door".into(),
            WorldPosition::default(),
        ));
        assert!(client.arm_busy_operation(PendingOperation::GuardedUse {
            sequence: 41,
            intent: ItemUseIntent::Direct {
                source: Guid(7),
                unrestricted: false
            },
            spell_target: None,
        }));
        client
    }

    async fn receive_lock_sound(client: &mut ClientRuntime, target: Guid) {
        let mut bytes = Vec::new();
        GameMessage::PlaySound(Box::new(PlaySoundData {
            target,
            sound_id: OPEN_FAIL_DUE_TO_LOCK_SOUND,
            volume: 1.0,
        }))
        .pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
    }

    #[tokio::test]
    async fn lock_encounter_joins_sound_and_completion_in_either_order_once() {
        for sound_first in [false, true] {
            let mut client = direct_use_client();
            let mut events = client.subscribe_client_view_events();
            if sound_first {
                receive_lock_sound(&mut client, Guid(7)).await;
                while let Ok(event) = events.try_recv() {
                    assert!(!matches!(
                        event,
                        ClientViewEvent::ActionResult {
                            reason: ActionResultReason::Locked { .. },
                            ..
                        }
                    ));
                }
            }
            client
                .finish_busy_operation_from_use_done(WeenieError::None)
                .await
                .unwrap();
            assert!(client.active_busy_operation.is_none());
            if !sound_first {
                receive_lock_sound(&mut client, Guid(7)).await;
            }
            let mut order = Vec::new();
            while let Ok(event) = events.try_recv() {
                match event {
                    ClientViewEvent::ItemUseFinished(finished) => {
                        assert_eq!(finished.sequence, 41);
                        order.push("finished");
                    }
                    ClientViewEvent::ActionResult {
                        reason:
                            ActionResultReason::Locked {
                                target,
                                name,
                                sequence,
                            },
                        ..
                    } => {
                        assert_eq!((target, name.as_str(), sequence), (Guid(7), "Door", 41));
                        order.push("locked");
                    }
                    _ => {}
                }
            }
            assert_eq!(order, ["finished", "locked"]);
            receive_lock_sound(&mut client, Guid(7)).await;
            while let Ok(event) = events.try_recv() {
                assert!(!matches!(
                    event,
                    ClientViewEvent::ActionResult {
                        reason: ActionResultReason::Locked { .. },
                        ..
                    }
                ));
            }
        }
    }

    #[tokio::test]
    async fn only_matching_sound_and_successful_completion_join() {
        for error in [WeenieError::None, WeenieError::LockUsedTooRecently] {
            let mut client = direct_use_client();
            let mut events = client.subscribe_client_view_events();
            client.observe_lock_sound(Guid(8), OPEN_FAIL_DUE_TO_LOCK_SOUND);
            client.observe_lock_sound(Guid(7), PICKLOCK_FAIL_SOUND);
            client
                .finish_busy_operation_from_use_done(error)
                .await
                .unwrap();
            while let Ok(event) = events.try_recv() {
                assert!(!matches!(
                    event,
                    ClientViewEvent::ActionResult {
                        reason: ActionResultReason::Locked { .. },
                        ..
                    }
                ));
            }
            receive_lock_sound(&mut client, Guid(7)).await;
            let mut rejections = 0;
            while let Ok(event) = events.try_recv() {
                if matches!(
                    event,
                    ClientViewEvent::ActionResult {
                        reason: ActionResultReason::Locked { .. },
                        ..
                    }
                ) {
                    rejections += 1;
                }
            }
            assert_eq!(rejections, usize::from(error == WeenieError::None));
        }
    }

    #[tokio::test]
    async fn retired_uses_cannot_authorize_late_lock_encounters() {
        for retirement in [
            "abort", "timeout", "new-use", "deadline", "removed", "replaced", "world",
        ] {
            let mut client = direct_use_client();
            match retirement {
                "abort" => client.clear_busy_operation(),
                "timeout" => client
                    .expire_busy_operation(Instant::now() + super::super::BUSY_OPERATION_TIMEOUT),
                _ => {
                    client
                        .finish_busy_operation_from_use_done(WeenieError::None)
                        .await
                        .unwrap();
                    match retirement {
                        "new-use" => {
                            assert!(
                                client
                                    .arm_busy_operation(PendingOperation::Use { source: Guid(8) })
                            );
                        }
                        "deadline" => client.lock_use.as_mut().unwrap().deadline = Instant::now(),
                        "removed" => {
                            client.world.entities.remove(Guid(7));
                        }
                        "replaced" => {
                            let entity = client.world.entities.get_mut(Guid(7)).unwrap();
                            entity.apply_remote_position_sample(
                                entity.position,
                                entity.instance_sequence() + 1,
                                0,
                                0,
                            );
                        }
                        "world" => {
                            client.bump_world_generation();
                        }
                        _ => unreachable!(),
                    }
                }
            }
            let mut events = client.subscribe_client_view_events();
            receive_lock_sound(&mut client, Guid(7)).await;
            while let Ok(event) = events.try_recv() {
                assert!(
                    !matches!(
                        event,
                        ClientViewEvent::ActionResult {
                            reason: ActionResultReason::Locked { .. },
                            ..
                        }
                    ),
                    "{retirement}"
                );
            }
        }
    }

    #[tokio::test]
    async fn housing_storage_permission_sounds_do_not_authorize_lock_encounters() {
        let mut client = direct_use_client();
        client.clear_busy_operation();
        client.world.entities.get_mut(Guid(7)).unwrap().wcid = Some(RETAIL_HOUSING_STORAGE_WCID);
        assert!(client.arm_busy_operation(PendingOperation::Use { source: Guid(7) }));
        let mut events = client.subscribe_client_view_events();
        receive_lock_sound(&mut client, Guid(7)).await;
        client
            .finish_busy_operation_from_use_done(WeenieError::None)
            .await
            .unwrap();
        while let Ok(event) = events.try_recv() {
            assert!(!matches!(event, ClientViewEvent::ActionResult { .. }));
        }
    }

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
