use anyhow::{Result, ensure};
use holtburger_dat::file_type::Animation;
use serde::Serialize;

use crate::behavior_hook_source::{
    BehaviorHookPayloadManifest, PartIndexScope, behavior_hook_payload, hook_direction, hook_name,
};
use crate::binary_source_record::{
    BinarySectionManifest, BinarySectionWriter, serialize_binary_envelope,
};
use crate::source_projection::dat_id;

pub(crate) const ANIMATION_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBAN";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnimationRecordManifest {
    transport: &'static str,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    animation_id: String,
    frame_count: usize,
    part_count: usize,
    has_position_frames: bool,
    hooks: Vec<AnimationHookManifest>,
    sections: Vec<BinarySectionManifest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnimationHookManifest {
    frame_index: usize,
    authored_order: usize,
    hook_type: u32,
    hook_name: &'static str,
    direction: &'static str,
    raw_direction: i32,
    payload: BehaviorHookPayloadManifest,
}

/// Serialize one decoded DAT animation into a compact typed frontend record.
pub(crate) fn serialize_animation_record_binary(animation: &Animation) -> Result<Vec<u8>> {
    let frame_count = usize::try_from(animation.num_frames)?;
    let part_count = usize::try_from(animation.num_parts)?;
    ensure!(
        animation.part_frames.len() == frame_count,
        "animation part-frame count does not match its header"
    );
    ensure!(
        animation.pos_frames.is_empty() || animation.pos_frames.len() == frame_count,
        "animation position-frame count does not match its header"
    );

    let mut writer = BinarySectionWriter::default();
    writer.append_f32(
        "partFrames",
        animation
            .part_frames
            .iter()
            .flat_map(|frame| frame.frames.iter())
            .flat_map(frame_values),
    )?;
    writer.append_f32(
        "positionFrames",
        animation.pos_frames.iter().flat_map(frame_values),
    )?;

    let mut hook_payload_bytes = Vec::new();
    let hooks = animation
        .part_frames
        .iter()
        .enumerate()
        .flat_map(|(frame_index, frame)| {
            frame
                .hooks
                .iter()
                .enumerate()
                .map(move |(authored_order, hook)| (frame_index, authored_order, hook))
        })
        .map(|(frame_index, authored_order, hook)| {
            Ok(AnimationHookManifest {
                frame_index,
                authored_order,
                hook_type: hook.hook_type,
                hook_name: hook_name(hook.hook_type),
                direction: hook_direction(hook.direction),
                raw_direction: hook.direction,
                payload: behavior_hook_payload(
                    hook,
                    PartIndexScope::Known(part_count),
                    &mut hook_payload_bytes,
                )?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    writer.append_u8("hookPayloadBytes", &hook_payload_bytes);
    let (sections, section_bytes) = writer.finish();
    let manifest = AnimationRecordManifest {
        transport: "holtburger-animation",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        animation_id: dat_id(animation.id),
        frame_count,
        part_count,
        has_position_frames: !animation.pos_frames.is_empty(),
        hooks,
        sections,
    };
    serialize_binary_envelope(ANIMATION_RECORD_BINARY_MAGIC, &manifest, &section_bytes)
}

fn frame_values(frame: &holtburger_dat::graphics::Frame) -> [f32; 7] {
    [
        frame.origin.x,
        frame.origin.y,
        frame.origin.z,
        frame.orientation.w,
        frame.orientation.x,
        frame.orientation.y,
        frame.orientation.z,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::binary_source_record::BINARY_HEADER_LENGTH;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_dat::file_type::animation::AnimationFlags;
    use holtburger_dat::file_type::setup_model::{
        AnimationFrame, AnimationHook, AnimationHookPayload, SetOmegaHookPayload,
        TransparentPartHookPayload,
    };
    use holtburger_dat::graphics::Frame;

    #[test]
    fn serializes_flat_frames_and_typed_hook_provenance() {
        let animation = Animation {
            id: 0x0300_0001,
            flags: AnimationFlags::empty(),
            num_parts: 1,
            num_frames: 1,
            pos_frames: Vec::new(),
            part_frames: vec![AnimationFrame {
                frames: vec![Frame {
                    origin: Vector3::new(1.0, 2.0, 3.0),
                    orientation: Quaternion {
                        w: 1.0,
                        x: 0.0,
                        y: 0.0,
                        z: 0.0,
                    },
                }],
                hooks: vec![
                    AnimationHook {
                        hook_type: 22,
                        direction: 0,
                        payload: AnimationHookPayload::SetOmega(SetOmegaHookPayload {
                            omega: Vector3::new(0.0, 0.0, 1.0),
                        }),
                    },
                    AnimationHook {
                        hook_type: 7,
                        direction: 1,
                        payload: AnimationHookPayload::TransparentPart(
                            TransparentPartHookPayload {
                                part_index: 0,
                                start: 0.25,
                                end: 1.0,
                                duration_seconds: 0.75,
                            },
                        ),
                    },
                ],
            }],
        };

        let bytes = serialize_animation_record_binary(&animation).unwrap();
        assert_eq!(&bytes[..4], ANIMATION_RECORD_BINARY_MAGIC);
        let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let manifest: serde_json::Value = serde_json::from_slice(
            &bytes[BINARY_HEADER_LENGTH..BINARY_HEADER_LENGTH + manifest_length],
        )
        .unwrap();
        assert_eq!(manifest["animationId"], "0x03000001");
        assert_eq!(manifest["frameCount"], 1);
        assert_eq!(manifest["partCount"], 1);
        assert_eq!(manifest["hooks"][0]["hookName"], "set-omega");
        assert_eq!(manifest["hooks"][0]["direction"], "both");
        assert_eq!(
            manifest["hooks"][0]["payload"]["omega"],
            serde_json::json!([0.0, 0.0, 1.0])
        );
        assert_eq!(manifest["hooks"][1]["hookName"], "transparent-part");
        assert_eq!(manifest["hooks"][1]["direction"], "forward");
        assert_eq!(manifest["hooks"][1]["payload"]["partIndex"], 0);
        assert_eq!(manifest["hooks"][1]["payload"]["start"], 0.25);
        assert_eq!(manifest["hooks"][1]["payload"]["end"], 1.0);
        assert_eq!(manifest["hooks"][1]["payload"]["durationSeconds"], 0.75);
        assert_eq!(
            manifest["sections"]
                .as_array()
                .unwrap()
                .iter()
                .find(|section| section["name"] == "hookPayloadBytes")
                .unwrap()["byteLength"],
            0
        );
    }

    #[test]
    fn rejects_invalid_transparent_part_projection_facts() {
        let animation = |payload| Animation {
            id: 0x0300_0001,
            flags: AnimationFlags::empty(),
            num_parts: 1,
            num_frames: 1,
            pos_frames: Vec::new(),
            part_frames: vec![AnimationFrame {
                frames: vec![Frame::default()],
                hooks: vec![AnimationHook {
                    hook_type: 7,
                    direction: 0,
                    payload: AnimationHookPayload::TransparentPart(payload),
                }],
            }],
        };

        let invalid_part =
            serialize_animation_record_binary(&animation(TransparentPartHookPayload {
                part_index: 1,
                start: 0.0,
                end: 1.0,
                duration_seconds: 0.5,
            }))
            .expect_err("out-of-range TransparentPart should fail");
        assert!(invalid_part.to_string().contains("out of range"));

        let non_finite =
            serialize_animation_record_binary(&animation(TransparentPartHookPayload {
                part_index: 0,
                start: f32::INFINITY,
                end: 1.0,
                duration_seconds: 0.5,
            }))
            .expect_err("non-finite TransparentPart should fail");
        assert!(non_finite.to_string().contains("non-finite"));
    }
}
