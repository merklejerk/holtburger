//! Stateless construction of conservative unit-scale animated visual envelopes.

use std::collections::BTreeSet;
use std::sync::Arc;

use anyhow::{Result, bail};
use holtburger_common::{Placement, Sphere, Vector3};
use holtburger_dat::file_type::{Animation, GfxObj, MotionTable, SetupModel};
use holtburger_dat::graphics::Frame;
use holtburger_dat::physics::BspNode;

/// Final geometry identity for a reusable unit-scale selection envelope.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct SelectionEnvelopeProfile {
    pub setup_did: u32,
    /// Ordered GfxObj identities after applying all ordered part substitutions.
    pub effective_parts: Vec<u32>,
    pub motion_table_did: Option<u32>,
}

/// Applies ordered geometry substitutions to produce the persistent cache identity.
pub fn resolve_selection_envelope_profile(
    setup: &SetupModel,
    part_changes: impl IntoIterator<Item = (u8, u32)>,
    motion_table_did: Option<u32>,
) -> Result<SelectionEnvelopeProfile> {
    let mut effective_parts = setup.parts.clone();
    for (part_index, gfx_obj_did) in part_changes {
        let index = usize::from(part_index);
        let Some(part) = effective_parts.get_mut(index) else {
            bail!(
                "selection profile replaces missing part {index} on SetupModel 0x{:08X}",
                setup.id
            );
        };
        *part = gfx_obj_did;
    }
    Ok(SelectionEnvelopeProfile {
        setup_did: setup.id,
        effective_parts,
        motion_table_did,
    })
}

/// Computes the smallest origin-centered radius covering every reachable part-frame sphere.
pub fn compute_selection_envelope_radius(
    setup: &SetupModel,
    profile: &SelectionEnvelopeProfile,
    motion_table: Option<&MotionTable>,
    mut load_animation: impl FnMut(u32) -> Result<Arc<Animation>>,
    mut load_gfx_obj: impl FnMut(u32) -> Result<Arc<GfxObj>>,
) -> Result<f32> {
    if setup.id != profile.setup_did {
        bail!(
            "selection profile names SetupModel 0x{:08X}, supplied 0x{:08X}",
            profile.setup_did,
            setup.id
        );
    }
    if setup.parts.len() != profile.effective_parts.len() {
        bail!(
            "selection profile for SetupModel 0x{:08X} has {} parts, expected {}",
            profile.setup_did,
            profile.effective_parts.len(),
            setup.parts.len()
        );
    }
    if motion_table.map(|table| table.id) != profile.motion_table_did {
        bail!("selection profile motion-table identity does not match supplied content");
    }

    let stable_pose = stable_pose(setup, &mut load_animation)?;
    let part_radii = profile
        .effective_parts
        .iter()
        .enumerate()
        .map(|(index, did)| {
            let gfx = load_gfx_obj(*did)?;
            Ok(gfx
                .drawing_bsp
                .as_ref()
                .and_then(bsp_root_sphere)
                .map(|sphere| {
                    rotation_invariant_part_radius(sphere, setup_part_scale(setup, index))
                }))
        })
        .collect::<Result<Vec<_>>>()?;

    let mut radius = setup.selection_sphere.center.length() + setup.selection_sphere.radius;
    include_pose(&mut radius, &stable_pose, &part_radii);
    let clips = motion_table.map_or_else(
        || {
            setup
                .default_animation
                .map(|animation_did| ClipSpec {
                    animation_did,
                    low_frame: 0,
                    high_frame: -1,
                })
                .into_iter()
                .collect()
        },
        playable_clips,
    );
    for clip in deduplicate_clips(clips) {
        let animation = load_animation(clip.animation_did)?;
        if animation.part_frames.is_empty() {
            continue;
        }
        let (low, high) = resolved_clip_window(&animation, clip);
        for frame in &animation.part_frames[low..=high] {
            include_animation_frame(&mut radius, &frame.frames, &stable_pose, &part_radii);
        }
    }
    if !radius.is_finite() || radius < 0.0 {
        bail!("computed selection-envelope radius is not finite and nonnegative");
    }
    Ok(radius)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct ClipSpec {
    animation_did: u32,
    low_frame: i32,
    high_frame: i32,
}

fn playable_clips(table: &MotionTable) -> Vec<ClipSpec> {
    table
        .cycles
        .values()
        .chain(table.modifiers.values())
        .chain(table.links.values().flat_map(|links| links.values()))
        .flat_map(|motion| &motion.anims)
        .map(|animation| ClipSpec {
            animation_did: animation.anim_id,
            low_frame: animation.low_frame,
            high_frame: animation.high_frame,
        })
        .collect()
}

fn deduplicate_clips(clips: impl IntoIterator<Item = ClipSpec>) -> Vec<ClipSpec> {
    clips
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn stable_pose(
    setup: &SetupModel,
    load_animation: &mut impl FnMut(u32) -> Result<Arc<Animation>>,
) -> Result<Vec<Frame>> {
    let mut pose = setup
        .placement_frames
        .get(&Placement::Resting)
        .or_else(|| setup.placement_frames.get(&Placement::Default))
        .map(|placement| placement.anim_frame.frames.clone())
        .unwrap_or_else(|| vec![Frame::default(); setup.parts.len()]);
    pose.resize(setup.parts.len(), Frame::default());
    if let Some(did) = setup.default_animation
        && let Some(first) = load_animation(did)?.part_frames.first()
    {
        for (destination, source) in pose.iter_mut().zip(&first.frames) {
            *destination = source.clone();
        }
    }
    Ok(pose)
}

fn bsp_root_sphere(node: &BspNode) -> Option<Sphere> {
    match node {
        BspNode::Port(portal) => portal.sphere,
        BspNode::Leaf(leaf) => leaf.sphere,
        BspNode::Internal(internal) => internal.sphere,
    }
}

fn setup_part_scale(setup: &SetupModel, part_index: usize) -> Vector3 {
    setup
        .default_scale
        .get(part_index)
        .copied()
        .unwrap_or(Vector3::new(1.0, 1.0, 1.0))
}

fn rotation_invariant_part_radius(sphere: Sphere, scale: Vector3) -> f32 {
    let center = Vector3::new(
        sphere.center.x * scale.x,
        sphere.center.y * scale.y,
        sphere.center.z * scale.z,
    );
    center.length() + sphere.radius * scale.x.abs().max(scale.y.abs()).max(scale.z.abs())
}

fn include_pose(radius: &mut f32, pose: &[Frame], part_radii: &[Option<f32>]) {
    for (frame, part_radius) in pose.iter().zip(part_radii) {
        if let Some(part_radius) = part_radius {
            *radius = radius.max(frame.origin.length() + part_radius);
        }
    }
}

fn include_animation_frame(
    radius: &mut f32,
    sampled_pose: &[Frame],
    stable_pose: &[Frame],
    part_radii: &[Option<f32>],
) {
    for (index, part_radius) in part_radii.iter().enumerate() {
        if let Some(part_radius) = part_radius {
            let frame = sampled_pose.get(index).unwrap_or(&stable_pose[index]);
            *radius = radius.max(frame.origin.length() + part_radius);
        }
    }
}

fn resolved_clip_window(animation: &Animation, clip: ClipSpec) -> (usize, usize) {
    let last = animation.part_frames.len().saturating_sub(1);
    let low = if clip.low_frame < 0 {
        0
    } else {
        (clip.low_frame as usize).min(last)
    };
    let high = if clip.high_frame < 0 {
        last
    } else {
        (clip.high_frame as usize).min(last)
    };
    (low, high.max(low))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn empty_setup(id: u32) -> SetupModel {
        SetupModel {
            id,
            flags: 0,
            parts: Vec::new(),
            parent_index: Vec::new(),
            default_scale: Vec::new(),
            holding_locations: HashMap::new(),
            connection_points: HashMap::new(),
            placement_frames: HashMap::new(),
            cyl_spheres: Vec::new(),
            spheres: Vec::new(),
            height: 0.0,
            radius: 0.0,
            step_up: 0.0,
            step_down: 0.0,
            sorting_sphere: Sphere {
                center: Vector3::zero(),
                radius: 0.0,
            },
            selection_sphere: Sphere {
                center: Vector3::zero(),
                radius: 0.0,
            },
            lights: Vec::new(),
            default_animation: None,
            default_script_did: None,
            default_motion_table: None,
            default_sound_table: None,
            default_script_table: None,
        }
    }

    fn empty_motion_table(id: u32) -> MotionTable {
        MotionTable {
            id,
            default_style: 0,
            style_defaults: HashMap::new(),
            cycles: HashMap::new(),
            modifiers: HashMap::new(),
            links: HashMap::new(),
        }
    }

    #[test]
    fn envelope_calculation_rejects_mismatched_profile_content() {
        let setup = empty_setup(0x0200_0001);
        let profile = SelectionEnvelopeProfile {
            setup_did: 0x0200_0002,
            effective_parts: Vec::new(),
            motion_table_did: None,
        };
        assert!(
            compute_selection_envelope_radius(
                &setup,
                &profile,
                None,
                |_| unreachable!(),
                |_| unreachable!(),
            )
            .is_err()
        );

        let profile = SelectionEnvelopeProfile {
            setup_did: setup.id,
            effective_parts: Vec::new(),
            motion_table_did: Some(0x0900_0001),
        };
        assert!(
            compute_selection_envelope_radius(
                &setup,
                &profile,
                Some(&empty_motion_table(0x0900_0002)),
                |_| unreachable!(),
                |_| unreachable!(),
            )
            .is_err()
        );
    }
}
