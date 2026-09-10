//! Sparse authored part poses for dynamic physics-BSP targets.
//!
//! These tracks carry geometry only. The world motion cursor supplies frame selection.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Cursor;
use std::sync::Arc;

use anyhow::{Result, ensure};
use holtburger_common::RigidTransform;
use holtburger_dat::file_type::{Animation, MotionTable};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};

use crate::{ContentDecodeCache, ContentRepository};

/// One part's authored track, compacting a constant pose without losing frame bounds.
#[derive(Debug, Clone, PartialEq)]
enum PartPoseTrack {
    Constant(RigidTransform),
    Varying(Arc<[RigidTransform]>),
}

impl PartPoseTrack {
    fn sample(&self, frame: usize) -> RigidTransform {
        match self {
            Self::Constant(pose) => *pose,
            Self::Varying(poses) => poses[frame],
        }
    }
}

/// Collision-relevant portion of one animation, shared independently of instance state.
#[derive(Debug, Clone, PartialEq)]
pub struct CollisionPoseAnimation {
    /// Authored animation identity, also owned by the motion cursor selecting this record.
    animation_id: u32,
    /// Validates frame selection even when every retained track is constant.
    frame_count: usize,
    /// Only requested parts authored by this animation. Missing trailing tracks retain instance poses.
    tracks: BTreeMap<usize, PartPoseTrack>,
}

impl CollisionPoseAnimation {
    /// Projects only collision parts. Retail permits an animation with fewer parts than its setup.
    pub fn project(animation: &Animation, part_indices: &[usize]) -> Result<Self> {
        let frame_count = animation.num_frames as usize;
        ensure!(
            frame_count > 0,
            "collision animation 0x{:08X} has no frames",
            animation.id
        );
        ensure!(
            animation.part_frames.len() == frame_count,
            "collision animation 0x{:08X} frame count does not match its records",
            animation.id
        );
        ensure!(
            animation
                .part_frames
                .iter()
                .all(|frame| frame.frames.len() == animation.num_parts as usize),
            "collision animation 0x{:08X} part count does not match its records",
            animation.id
        );
        let mut tracks = BTreeMap::new();
        for &part in part_indices {
            if part >= animation.num_parts as usize {
                continue;
            }
            let poses = animation
                .part_frames
                .iter()
                .map(|frame| {
                    let frame = &frame.frames[part];
                    RigidTransform {
                        translation: frame.origin,
                        rotation: frame.orientation,
                    }
                })
                .collect::<Vec<_>>();
            let first = poses[0];
            let track = if poses.iter().all(|pose| *pose == first) {
                PartPoseTrack::Constant(first)
            } else {
                PartPoseTrack::Varying(poses.into())
            };
            tracks.insert(part, track);
        }
        Ok(Self {
            animation_id: animation.id,
            frame_count,
            tracks,
        })
    }

    /// Samples authored entries only; the instance owner retains omitted trailing part poses.
    pub fn sample(
        &self,
        frame: usize,
    ) -> Result<impl Iterator<Item = (usize, RigidTransform)> + '_> {
        ensure!(
            frame < self.frame_count,
            "collision animation 0x{:08X} frame {frame} exceeds frame count {}",
            self.animation_id,
            self.frame_count
        );
        Ok(self
            .tracks
            .iter()
            .map(move |(&part, track)| (part, track.sample(frame))))
    }
}

/// Immutable sparse animations prepared for one physical body's authored motion sources.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CollisionPoseLibrary {
    /// Records keyed by the same animation identity published by the motion owner.
    animations: BTreeMap<u32, Arc<CollisionPoseAnimation>>,
}

impl CollisionPoseLibrary {
    /// Loads the complete source closure off the simulation thread, reusing decoded animations.
    pub fn prepare(
        content: &ContentRepository,
        cache: &ContentDecodeCache,
        motion_table: Option<u32>,
        default_animation: Option<u32>,
        parts: &[usize],
    ) -> Result<Self> {
        if parts.is_empty() {
            return Ok(Self::default());
        }
        let mut animation_ids = BTreeSet::new();
        animation_ids.extend(default_animation);
        if let Some(table_id) = motion_table {
            let bytes = content.read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, table_id))?;
            let table = MotionTable::read(&mut Cursor::new(bytes.bytes))?;
            for motion in table
                .cycles
                .values()
                .chain(table.modifiers.values())
                .chain(table.links.values().flat_map(|links| links.values()))
            {
                animation_ids.extend(motion.anims.iter().map(|clip| clip.anim_id));
            }
        }
        let animations = animation_ids
            .into_iter()
            .map(|id| cache.animation(content, id))
            .collect::<Result<Vec<_>>>()?;
        Self::project(animations, parts)
    }

    /// Projects a resolved source closure without archive or runtime dependencies.
    pub fn project(
        animations: impl IntoIterator<Item = Arc<Animation>>,
        parts: &[usize],
    ) -> Result<Self> {
        let animations = animations
            .into_iter()
            .map(|animation| {
                Ok((
                    animation.id,
                    Arc::new(CollisionPoseAnimation::project(&animation, parts)?),
                ))
            })
            .collect::<Result<_>>()?;
        Ok(Self { animations })
    }

    /// Requires prepared content for a selected animation; absence is not a placement fallback.
    pub fn animation(&self, id: u32) -> Result<&CollisionPoseAnimation> {
        self.animations.get(&id).map(Arc::as_ref).ok_or_else(|| {
            anyhow::anyhow!("collision animation 0x{id:08X} was not prepared for this body")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_dat::file_type::{animation::AnimationFlags, setup_model::AnimationFrame};
    use holtburger_dat::graphics::Frame;

    fn animation() -> Animation {
        Animation {
            id: 0x03000001,
            flags: AnimationFlags::empty(),
            num_parts: 2,
            num_frames: 2,
            pos_frames: Vec::new(),
            part_frames: [0.0, 1.0]
                .into_iter()
                .map(|x| AnimationFrame {
                    frames: [0.0, x]
                        .into_iter()
                        .map(|x| Frame {
                            origin: Vector3::new(x, 0.0, 0.0),
                            orientation: Quaternion::identity(),
                        })
                        .collect(),
                    hooks: Vec::new(),
                })
                .collect(),
        }
    }

    #[test]
    fn samples_sparse_parts_and_leaves_unauthored_parts_to_instance_owner() {
        let projected = CollisionPoseAnimation::project(&animation(), &[1, 3]).unwrap();
        let samples = projected.sample(1).unwrap().collect::<Vec<_>>();
        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].0, 1);
        assert_eq!(samples[0].1.translation, Vector3::new(1.0, 0.0, 0.0));
    }

    #[test]
    fn constant_tracks_retain_authored_frame_bounds() {
        let projected = CollisionPoseAnimation::project(&animation(), &[0]).unwrap();
        assert!(matches!(projected.tracks[&0], PartPoseTrack::Constant(_)));
        assert!(projected.sample(1).is_ok());
        assert!(projected.sample(2).is_err());
    }

    #[test]
    fn rejects_frame_records_shorter_than_the_declared_part_count() {
        let mut source = animation();
        source.part_frames[1].frames.clear();
        assert!(CollisionPoseAnimation::project(&source, &[1]).is_err());
    }
}
