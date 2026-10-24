//! Captured creature-preview facts independent of appraisal presentation and scene residency.

use super::entity_visual_facts::entity_visual_facts;
use holtburger_common::properties::{EquipMask, WorldObjectExt as _};
use holtburger_common::{Guid, ParentLocation, Placement};
use holtburger_world::{EntityAppearance, WorldState};
use holtburger_world::{context::WorldContext, state::storage::RosterCoverage};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

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
pub struct ObjectPreviewVisual {
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

/// A separately rendered direct child; painted clothing remains in the body appearance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPreviewAttachment {
    /// Captured independent visual, with its placement pose supplied below.
    pub visual: ObjectPreviewVisual,
    /// Accepted named holding location, without frontend part-index assumptions.
    pub parent_location: ParentLocation,
    /// Accepted child-side authored placement key.
    pub placement: Placement,
}

/// Complete immutable creature composition, independent of the original entities' lifetimes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPreviewSource {
    /// Body appearance already includes accepted clothing and armor substitutions.
    pub body: ObjectPreviewVisual,
    /// Flat separately rendered children; no arbitrary world hierarchy or backdrop policy.
    pub attachments: Vec<ObjectPreviewAttachment>,
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
    /// Equipment or parent-announced children are awaiting required accepted facts.
    PendingEquipment,
    /// The entity is absent or lacks valid visual facts required to render a preview.
    Unavailable,
}

/// ACE Selectable, whose items remain children even outside combat
/// (`Creature_Equipment.cs:463-470`). Ammunition is deliberately excluded from player displays.
const DISPLAY_EQUIPMENT: EquipMask = EquipMask::from_bits_retain(
    EquipMask::MELEE_WEAPON.bits()
        | EquipMask::SHIELD.bits()
        | EquipMask::MISSILE_WEAPON.bits()
        | EquipMask::CASTER.bits()
        | EquipMask::TWO_HANDED.bits(),
);

/// Capture accepted child placement rather than reconstructing ACE's server-only combat style.
/// Player rosters prove complete equipment; generic creatures use all announced direct children.
fn preview_children(
    world: &WorldState,
    guid: Guid,
) -> Result<BTreeSet<Guid>, ObjectPreviewOutcome> {
    if guid != world.player.guid || guid == Guid::NULL {
        return Ok(world.expected_attachment_children(guid));
    }
    if world.storage_coverage(guid) != Some(RosterCoverage::Announced) {
        return Err(ObjectPreviewOutcome::PendingEquipment);
    }
    let mut children = BTreeSet::new();
    for item in world.iter_equipment() {
        let mask = world
            .equipment_mask(item)
            .ok_or(ObjectPreviewOutcome::PendingEquipment)?;
        if world.entities.get(item).is_none() {
            return Err(ObjectPreviewOutcome::PendingEquipment);
        }
        if mask.intersects(DISPLAY_EQUIPMENT) {
            children.insert(item);
        }
    }
    Ok(children)
}

/// Capture one creature without loading assets or joining it to a scene.
pub fn capture_object_preview(world: &WorldState, guid: Guid) -> ObjectPreviewResult {
    ObjectPreviewResult {
        guid,
        outcome: capture_composition(world, guid, CapturePolicy::Inspection),
    }
}

/// Saved selection previews exclude transient script scale and whole-object visibility.
#[derive(Clone, Copy)]
enum CapturePolicy {
    Inspection,
    SavedCharacter,
}

/// Capture only complete player visuals, using the same equipment and idle semantics as inspection.
pub(super) fn capture_saved_player_visual(world: &WorldState) -> Option<ObjectPreviewSource> {
    if !world.all_player_contained_objects_exist() {
        return None;
    }
    match capture_composition(world, world.player.guid, CapturePolicy::SavedCharacter) {
        ObjectPreviewOutcome::Ready { source } => Some(*source),
        ObjectPreviewOutcome::PendingEquipment | ObjectPreviewOutcome::Unavailable => None,
    }
}

fn capture_visual(
    entity: &holtburger_world::entity::Entity,
    pose: ObjectPreviewPose,
    policy: CapturePolicy,
) -> Option<ObjectPreviewVisual> {
    let facts = entity_visual_facts(entity).ok()?;
    let (scale, translucency) = match policy {
        CapturePolicy::Inspection => (facts.scale, facts.translucency),
        // Physics description omission means unit scale (WorldObject hydration); scripts mutate
        // EntityScaleState without changing this accepted DefaultScale property.
        CapturePolicy::SavedCharacter => (entity.obj_scale().unwrap_or(1.0) as f32, 0.0),
    };
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    Some(ObjectPreviewVisual {
        setup_did: facts.setup_did,
        appearance: facts.appearance.clone(),
        scale,
        translucency,
        pose,
    })
}

fn capture_composition(
    world: &WorldState,
    guid: Guid,
    policy: CapturePolicy,
) -> ObjectPreviewOutcome {
    let Some(entity) = world.entities.get(guid) else {
        return ObjectPreviewOutcome::Unavailable;
    };
    let children = match preview_children(world, guid) {
        Ok(children) => children,
        Err(outcome) => return outcome,
    };
    let mut attachments = Vec::with_capacity(children.len());
    for child in children {
        let Some(child) = world.entities.get(child) else {
            return ObjectPreviewOutcome::PendingEquipment;
        };
        let Some(link) = child.attachment().filter(|link| link.parent == guid) else {
            return ObjectPreviewOutcome::PendingEquipment;
        };
        let Some(visual) = capture_visual(child, ObjectPreviewPose::SetupPose, policy) else {
            return ObjectPreviewOutcome::PendingEquipment;
        };
        attachments.push(ObjectPreviewAttachment {
            visual,
            parent_location: link.location,
            placement: link.placement,
        });
    }
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
    let Some(body) = capture_visual(entity, pose, policy) else {
        return ObjectPreviewOutcome::Unavailable;
    };
    ObjectPreviewOutcome::Ready {
        source: Box::new(ObjectPreviewSource { body, attachments }),
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
    use holtburger_protocol::messages::object::messages::description::PhysicsChildData;
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, ObjectDescriptionData, PlayerDescriptionEventData,
    };
    use holtburger_world::PhysicsAttachment;
    use holtburger_world::{EntityScaleState, entity::Entity};
    use std::collections::HashMap;

    const PLAYER: Guid = Guid(0x5000_0001);
    const SWORD: Guid = Guid(0x7000_0001);
    const ARMOR: Guid = Guid(0x7000_0002);
    const AMMO: Guid = Guid(0x7000_0003);

    fn visual_entity(guid: Guid) -> Entity {
        let mut entity = Entity::new(guid, "Visual".into(), Default::default());
        entity.set_did_prop(PropertyDataId::Setup, 0x0200_0001.into());
        entity
    }

    fn player_roster(world: &mut WorldState, equipment: &[(Guid, EquipMask)]) {
        world.handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: PLAYER,
            sequence: 0,
            event: GameEvent::PlayerDescription(Box::new(PlayerDescriptionEventData {
                guid: PLAYER,
                sequence: 0,
                name: "Player".into(),
                wee_type: 1,
                pos: None,
                properties: Default::default(),
                positions: Default::default(),
                attributes: Default::default(),
                skills: Default::default(),
                enchantments: Vec::new(),
                spells: Default::default(),
                has_health: true,
                options1: Default::default(),
                options2: Default::default(),
                shortcuts: Vec::new(),
                hotbar_spells: Vec::new(),
                desired_comps: Vec::new(),
                spellbook_filters: 0,
                gameplay_options: Vec::new(),
                inventory: Vec::new(),
                equipped_objects: equipment
                    .iter()
                    .map(|(guid, mask)| (*guid, mask.bits(), 0))
                    .collect(),
            })),
        })));
        world.add_entity(visual_entity(PLAYER));
    }

    #[test]
    fn remote_capture_waits_for_announced_children_and_survives_their_removal() {
        let mut world = WorldState::synthetic();
        let mut parent = ObjectDescriptionData::with_guid(PLAYER);
        parent.csetup_id = Some(0x0200_0001);
        parent.children = Some(vec![PhysicsChildData {
            guid: SWORD,
            location_id: ParentLocation::LeftHand as u32,
        }]);
        world.handle_message(&GameMessage::ObjectCreate(Box::new(parent)));
        assert_eq!(
            world.expected_attachment_children(PLAYER),
            BTreeSet::from([SWORD])
        );
        assert_eq!(
            capture_object_preview(&world, PLAYER).outcome,
            ObjectPreviewOutcome::PendingEquipment
        );
        let mut child = ObjectDescriptionData::with_guid(SWORD);
        child.csetup_id = Some(0x0200_0002);
        child.animation_frame = Some(Placement::LeftHand as u32);
        world.handle_message(&GameMessage::ObjectCreate(Box::new(child)));
        let ObjectPreviewOutcome::Ready { source } = capture_object_preview(&world, PLAYER).outcome
        else {
            panic!("complete remote composition should be captured");
        };
        assert_eq!(source.attachments.len(), 1);
        assert_eq!(
            source.attachments[0].parent_location,
            ParentLocation::LeftHand
        );
        assert_eq!(source.attachments[0].placement, Placement::LeftHand);
        world.remove_entity(SWORD);
        world.remove_entity(PLAYER);
        assert_eq!(source.attachments[0].visual.setup_did, 0x0200_0002);
    }

    #[test]
    fn player_capture_uses_announced_equipment_and_never_repaints_armor_or_captures_ammo() {
        let mut world = WorldState::synthetic();
        player_roster(
            &mut world,
            &[
                (SWORD, EquipMask::MISSILE_WEAPON),
                (ARMOR, EquipMask::CHEST_ARMOR),
                (AMMO, EquipMask::MISSILE_AMMO),
            ],
        );
        assert_eq!(
            capture_object_preview(&world, PLAYER).outcome,
            ObjectPreviewOutcome::PendingEquipment
        );
        world.add_entity(visual_entity(SWORD));
        // These descriptions have no independent setup: worn armor is already baked into the body.
        world.add_entity(Entity::new(ARMOR, "Armor".into(), Default::default()));
        world.add_entity(Entity::new(AMMO, "Ammo".into(), Default::default()));
        assert_eq!(
            capture_object_preview(&world, PLAYER).outcome,
            ObjectPreviewOutcome::PendingEquipment
        );
        world
            .entities
            .get_mut(SWORD)
            .unwrap()
            .set_attachment(Some(PhysicsAttachment {
                parent: PLAYER,
                location: ParentLocation::LeftHand,
                placement: Placement::LeftHand,
            }));
        // No DefaultCombatStyle is present or needed: the accepted bow relationship owns handedness.
        let ObjectPreviewOutcome::Ready { source } = capture_object_preview(&world, PLAYER).outcome
        else {
            panic!("complete player composition should be captured");
        };
        assert_eq!(source.attachments.len(), 1);
        assert_eq!(
            source.attachments[0].parent_location,
            ParentLocation::LeftHand
        );
        assert_eq!(
            source.attachments[0].visual.pose,
            ObjectPreviewPose::SetupPose
        );
        player_roster(&mut world, &[]);
        let ObjectPreviewOutcome::Ready { source } = capture_object_preview(&world, PLAYER).outcome
        else {
            panic!("confirmed empty equipment should be captured");
        };
        assert!(source.attachments.is_empty());
    }

    #[test]
    fn player_capture_requires_roster_receipt_even_when_no_items_are_retained() {
        let mut world = WorldState::synthetic();
        world.player.guid = PLAYER;
        world.add_entity(visual_entity(PLAYER));
        assert_eq!(
            capture_object_preview(&world, PLAYER).outcome,
            ObjectPreviewOutcome::PendingEquipment
        );
    }

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
        assert_eq!(source.body.setup_did, SETUP);
        assert_eq!(source.body.scale, 1.25);
        assert_eq!(source.body.translucency, 0.5);
        assert_eq!(
            source.body.pose,
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
                if source.body.pose == ObjectPreviewPose::SetupPose
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
