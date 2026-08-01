use anyhow::{Result, ensure};
use holtburger_dat::file_type::Animation;
use holtburger_dat::file_type::setup_model::{
    AnimationHook, AnimationHookPayload, TextureVelocityHookPayload, TextureVelocityPartHookPayload,
};
use serde::Serialize;

use crate::binary_source_record::{BinarySectionManifest, BinarySectionWriter};
use crate::source_projection::dat_id;

pub(crate) const ANIMATION_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBAN";
const BINARY_HEADER_LENGTH: usize = 12;

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
    payload: AnimationHookPayloadManifest,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum AnimationHookPayloadManifest {
    NoPayload,
    Raw {
        byte_offset: usize,
        byte_length: usize,
    },
    ReplaceObject {
        byte_offset: usize,
        byte_length: usize,
    },
    SetOmega {
        omega: [f32; 3],
        byte_offset: usize,
        byte_length: usize,
    },
    TextureVelocity {
        u_speed: f32,
        v_speed: f32,
    },
    TextureVelocityPart {
        part_index: u32,
        u_speed: f32,
        v_speed: f32,
    },
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
        .map(
            |(frame_index, authored_order, hook)| AnimationHookManifest {
                frame_index,
                authored_order,
                hook_type: hook.hook_type,
                hook_name: hook_name(hook.hook_type),
                direction: hook_direction(hook.direction),
                raw_direction: hook.direction,
                payload: hook_payload(hook, &mut hook_payload_bytes),
            },
        )
        .collect::<Vec<_>>();
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
    serialize_binary_envelope(&manifest, &section_bytes)
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

fn hook_payload(hook: &AnimationHook, raw_payloads: &mut Vec<u8>) -> AnimationHookPayloadManifest {
    match &hook.payload {
        AnimationHookPayload::NoPayload => AnimationHookPayloadManifest::NoPayload,
        AnimationHookPayload::Raw(bytes) => {
            let (byte_offset, byte_length) = append_payload(raw_payloads, bytes);
            AnimationHookPayloadManifest::Raw {
                byte_offset,
                byte_length,
            }
        }
        AnimationHookPayload::ReplaceObject(bytes) => {
            let (byte_offset, byte_length) = append_payload(raw_payloads, bytes);
            AnimationHookPayloadManifest::ReplaceObject {
                byte_offset,
                byte_length,
            }
        }
        AnimationHookPayload::SetOmega(payload) => {
            let (byte_offset, byte_length) =
                append_payload(raw_payloads, &payload.raw_payload_bytes);
            AnimationHookPayloadManifest::SetOmega {
                omega: [payload.omega.x, payload.omega.y, payload.omega.z],
                byte_offset,
                byte_length,
            }
        }
        AnimationHookPayload::TextureVelocity(TextureVelocityHookPayload { u_speed, v_speed }) => {
            AnimationHookPayloadManifest::TextureVelocity {
                u_speed: *u_speed,
                v_speed: *v_speed,
            }
        }
        AnimationHookPayload::TextureVelocityPart(TextureVelocityPartHookPayload {
            part_index,
            u_speed,
            v_speed,
        }) => AnimationHookPayloadManifest::TextureVelocityPart {
            part_index: *part_index,
            u_speed: *u_speed,
            v_speed: *v_speed,
        },
    }
}

fn append_payload(target: &mut Vec<u8>, payload: &[u8]) -> (usize, usize) {
    let byte_offset = target.len();
    target.extend(payload);
    (byte_offset, payload.len())
}

fn hook_direction(direction: i32) -> &'static str {
    match direction {
        -2 => "unknown",
        -1 => "backward",
        0 => "both",
        1 => "forward",
        _ => "invalid",
    }
}

fn hook_name(hook_type: u32) -> &'static str {
    match hook_type {
        0 => "no-op",
        1 => "sound",
        2 => "sound-table",
        3 => "attack",
        4 => "animation-done",
        5 => "replace-object",
        6 => "ethereal",
        7 => "transparent-part",
        8 => "luminous",
        9 => "luminous-part",
        10 => "diffuse",
        11 => "diffuse-part",
        12 => "scale",
        13 => "create-particle",
        14 => "destroy-particle",
        15 => "stop-particle",
        16 => "no-draw",
        17 => "default-script",
        18 => "default-script-part",
        19 => "call-pes",
        20 => "transparent",
        21 => "sound-tweaked",
        22 => "set-omega",
        23 => "texture-velocity",
        24 => "texture-velocity-part",
        25 => "set-light",
        26 => "create-blocking-particle",
        _ => "unsupported",
    }
}

fn serialize_binary_envelope(
    manifest: &AnimationRecordManifest,
    section_bytes: &[u8],
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(manifest)?;
    while !(BINARY_HEADER_LENGTH + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_length = BINARY_HEADER_LENGTH + manifest_bytes.len() + section_bytes.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(ANIMATION_RECORD_BINARY_MAGIC);
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    bytes.extend(section_bytes);
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_dat::file_type::animation::AnimationFlags;
    use holtburger_dat::file_type::setup_model::{AnimationFrame, SetOmegaHookPayload};
    use holtburger_dat::graphics::Frame;

    #[test]
    fn serializes_flat_frames_and_typed_hook_provenance() {
        let raw_omega = [0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x00, 0x80, 0x3f];
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
                hooks: vec![AnimationHook {
                    hook_type: 22,
                    direction: 0,
                    payload: AnimationHookPayload::SetOmega(SetOmegaHookPayload {
                        omega: Vector3::new(0.0, 0.0, 1.0),
                        raw_payload_bytes: raw_omega,
                    }),
                }],
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
        assert_eq!(
            &bytes[BINARY_HEADER_LENGTH + manifest_length..][28..40],
            &raw_omega
        );
    }
}
