//! Captured creature-preview facts independent of appraisal presentation and scene residency.

use super::entity_visual_facts::entity_visual_facts;
use holtburger_common::Guid;
use holtburger_world::{EntityAppearance, WorldState};
use serde::{Deserialize, Serialize};

/// One resolved animation window in the default idle sequence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPreviewClip {
    /// Animation DAT identity loaded by the frontend's existing animation source.
    pub animation_id: u32,
    /// Inclusive first frame after content-owned window normalization.
    pub low_frame: u32,
    /// Inclusive last frame after content-owned window normalization.
    pub high_frame: u32,
    /// Signed authored traversal rate; zero deliberately holds the entry pose.
    pub framerate: f32,
}

/// Pose policy captured from the entity's effective motion table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ObjectPreviewPose {
    /// Complete default-style sequence; clips before `first_cyclic_clip` play once.
    DefaultIdle {
        /// Ordered authored clips, including any non-cyclic entry prefix.
        clips: Vec<ObjectPreviewClip>,
        /// First clip of the looping tail under the shared retail-shaped sequence contract.
        first_cyclic_clip: usize,
    },
    /// No usable default cycle exists; retain the setup's authored default/resting pose.
    SetupPose,
}

/// Immutable renderer-source facts captured while the appraised entity is still retained.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPreviewSource {
    /// Examined identity and frontend correlation key.
    pub guid: Guid,
    /// Exact setup model used by the accepted entity generation.
    pub setup_did: u32,
    /// Lossless ordered appearance substitutions applied to that setup.
    pub appearance: EntityAppearance,
    /// Accepted whole-object scale, independent of preview camera zoom.
    pub scale: f32,
    /// Accepted whole-object translucency applied before authored preview effects.
    pub translucency: f32,
    /// Shared motion selection result; the frontend only samples this description.
    pub pose: ObjectPreviewPose,
}

/// Cold capture outcome emitted next to a successful creature appraisal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPreviewResult {
    /// Examined identity and latest-request correlation key.
    pub guid: Guid,
    /// Complete distinction between a captured visual and absent visual identity.
    pub outcome: ObjectPreviewOutcome,
}

/// Whether retained world facts can identify a creature visual.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ObjectPreviewOutcome {
    /// Visual source facts captured before later despawn can remove them.
    Ready { source: Box<ObjectPreviewSource> },
    /// The entity is absent or lacks valid visual facts required to render a preview.
    Unavailable,
}

/// Capture one creature's visual source without loading assets or joining it to a scene.
pub fn capture_object_preview(world: &WorldState, guid: Guid) -> ObjectPreviewResult {
    let Some(entity) = world.entities.get(guid) else {
        return ObjectPreviewResult {
            guid,
            outcome: ObjectPreviewOutcome::Unavailable,
        };
    };
    let Ok(visual) = entity_visual_facts(entity) else {
        return ObjectPreviewResult {
            guid,
            outcome: ObjectPreviewOutcome::Unavailable,
        };
    };
    let pose = world
        .effective_motion_table_id_for_guid(guid)
        .and_then(|table_id| world.motion_sequences.table(table_id))
        .and_then(|table| table.default_cycle())
        .filter(|cycle| !cycle.clips.is_empty())
        .map_or(ObjectPreviewPose::SetupPose, |cycle| {
            ObjectPreviewPose::DefaultIdle {
                clips: cycle
                    .clips
                    .iter()
                    .map(|clip| ObjectPreviewClip {
                        animation_id: clip.animation.id,
                        low_frame: clip.low_frame,
                        high_frame: clip.high_frame,
                        framerate: clip.framerate,
                    })
                    .collect(),
                // `MotionSequenceRuntime::append` moves the cyclic-tail marker to each appended
                // clip, so a freshly installed cycle plays every prefix clip once and loops the
                // final clip. Preserve that non-obvious shared semantic instead of inferring it in
                // the browser.
                first_cyclic_clip: cycle.clips.len() - 1,
            }
        });
    ObjectPreviewResult {
        guid,
        outcome: ObjectPreviewOutcome::Ready {
            source: Box::new(ObjectPreviewSource {
                guid,
                setup_did: visual.setup_did,
                appearance: visual.appearance.clone(),
                scale: visual.scale,
                translucency: visual.translucency,
                pose,
            }),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::properties::{
        PropertyDataId, PropertyFloat, WorldObjectPropertyAccessorsMut as _,
    };
    use holtburger_content::MotionSequenceCatalog;
    use holtburger_dat::file_type::animation::AnimationFlags;
    use holtburger_dat::file_type::motion_table::{AnimData, MotionData, MotionDataFlags};
    use holtburger_dat::file_type::setup_model::AnimationFrame;
    use holtburger_dat::file_type::{Animation, MotionTable};
    use holtburger_world::{EntityScaleState, entity::Entity};
    use std::collections::HashMap;

    fn catalog_with_two_clip_default(table_id: u32) -> MotionSequenceCatalog {
        const STYLE: u32 = 0x8000_003d;
        const SUBSTATE: u32 = 0x4000_003d;
        let animation = |id| Animation {
            id,
            flags: AnimationFlags::empty(),
            num_parts: 0,
            num_frames: 10,
            pos_frames: Vec::new(),
            part_frames: (0..10)
                .map(|_| AnimationFrame {
                    frames: Vec::new(),
                    hooks: Vec::new(),
                })
                .collect(),
        };
        let table = MotionTable {
            id: table_id,
            default_style: STYLE,
            style_defaults: HashMap::from([(STYLE, SUBSTATE)]),
            cycles: HashMap::from([(
                MotionTable::cycle_key(STYLE, SUBSTATE),
                MotionData {
                    bitfield: 0,
                    flags: MotionDataFlags::empty(),
                    anims: vec![
                        AnimData {
                            anim_id: 0x0300_0001,
                            low_frame: 2,
                            high_frame: 8,
                            framerate: 20.0,
                        },
                        AnimData {
                            anim_id: 0x0300_0002,
                            low_frame: 1,
                            high_frame: 5,
                            framerate: -10.0,
                        },
                    ],
                    velocity: None,
                    omega: None,
                },
            )]),
            modifiers: HashMap::new(),
            links: HashMap::new(),
        };
        MotionSequenceCatalog::assemble(
            [table],
            [animation(0x0300_0001), animation(0x0300_0002)],
            [],
        )
        .expect("preview fixture should assemble")
    }

    #[test]
    fn capture_preserves_the_complete_default_sequence_and_visual_identity() {
        const GUID: Guid = Guid(0x5000_0001);
        const SETUP: u32 = 0x0200_0001;
        const TABLE: u32 = 0x0900_0001;
        let mut world = WorldState::synthetic();
        world.set_motion_sequences(catalog_with_two_clip_default(TABLE));
        let mut entity = Entity::new(GUID, "Preview".to_owned(), Default::default());
        entity.set_did_prop(PropertyDataId::Setup, SETUP.into());
        entity.set_did_prop(PropertyDataId::MotionTable, TABLE.into());
        entity.set_float_prop(PropertyFloat::Translucency, 0.5);
        entity.scale = EntityScaleState::new(1.25).expect("valid scale");
        world.add_entity(entity);

        let result = capture_object_preview(&world, GUID);

        let ObjectPreviewOutcome::Ready { source } = result.outcome else {
            panic!("preview should be available");
        };
        assert_eq!(source.setup_did, SETUP);
        assert_eq!(source.scale, 1.25);
        assert_eq!(source.translucency, 0.5);
        assert_eq!(
            source.pose,
            ObjectPreviewPose::DefaultIdle {
                clips: vec![
                    ObjectPreviewClip {
                        animation_id: 0x0300_0001,
                        low_frame: 2,
                        high_frame: 8,
                        framerate: 20.0,
                    },
                    ObjectPreviewClip {
                        animation_id: 0x0300_0002,
                        low_frame: 1,
                        high_frame: 5,
                        framerate: -10.0,
                    },
                ],
                first_cyclic_clip: 1,
            }
        );
    }

    #[test]
    fn capture_distinguishes_setup_pose_from_missing_visual_identity() {
        const GUID: Guid = Guid(0x5000_0001);
        let mut world = WorldState::synthetic();
        let mut entity = Entity::new(GUID, "Preview".to_owned(), Default::default());
        entity.set_did_prop(PropertyDataId::Setup, 0x0200_0001.into());
        world.add_entity(entity);
        let result = capture_object_preview(&world, GUID);
        assert!(matches!(
            result.outcome,
            ObjectPreviewOutcome::Ready { source }
                if source.pose == ObjectPreviewPose::SetupPose
        ));

        let missing = capture_object_preview(&WorldState::synthetic(), GUID);
        assert_eq!(missing.outcome, ObjectPreviewOutcome::Unavailable);
    }

    #[test]
    fn capture_rejects_invalid_whole_object_translucency() {
        const GUID: Guid = Guid(0x5000_0001);
        let mut world = WorldState::synthetic();
        let mut entity = Entity::new(GUID, "Preview".to_owned(), Default::default());
        entity.set_did_prop(PropertyDataId::Setup, 0x0200_0001.into());
        entity.set_float_prop(PropertyFloat::Translucency, f64::NAN);
        world.add_entity(entity);

        let result = capture_object_preview(&world, GUID);

        assert_eq!(result.outcome, ObjectPreviewOutcome::Unavailable);
    }
}
