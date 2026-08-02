use anyhow::{Result, ensure};
use holtburger_dat::file_type::Animation;
use holtburger_dat::file_type::setup_model::{
    AnimationHook, AnimationHookPayload, TextureVelocityHookPayload,
    TextureVelocityPartHookPayload, TransparentPartHookPayload,
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
    },
    TransparentPart {
        part_index: u32,
        start: f32,
        end: f32,
        duration_seconds: f32,
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
        .map(|(frame_index, authored_order, hook)| {
            Ok(AnimationHookManifest {
                frame_index,
                authored_order,
                hook_type: hook.hook_type,
                hook_name: hook_name(hook.hook_type),
                direction: hook_direction(hook.direction),
                raw_direction: hook.direction,
                payload: hook_payload(hook, part_count, &mut hook_payload_bytes)?,
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

fn hook_payload(
    hook: &AnimationHook,
    part_count: usize,
    raw_payloads: &mut Vec<u8>,
) -> Result<AnimationHookPayloadManifest> {
    let payload = match &hook.payload {
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
            ensure!(
                payload.omega.x.is_finite()
                    && payload.omega.y.is_finite()
                    && payload.omega.z.is_finite(),
                "SetOmega payload contains a non-finite component"
            );
            AnimationHookPayloadManifest::SetOmega {
                omega: [payload.omega.x, payload.omega.y, payload.omega.z],
            }
        }
        AnimationHookPayload::TransparentPart(TransparentPartHookPayload {
            part_index,
            start,
            end,
            duration_seconds,
        }) => {
            ensure_part_index("TransparentPart", *part_index, part_count)?;
            ensure!(
                start.is_finite() && end.is_finite() && duration_seconds.is_finite(),
                "TransparentPart payload contains a non-finite value"
            );
            AnimationHookPayloadManifest::TransparentPart {
                part_index: *part_index,
                start: *start,
                end: *end,
                duration_seconds: *duration_seconds,
            }
        }
        AnimationHookPayload::TextureVelocity(TextureVelocityHookPayload { u_speed, v_speed }) => {
            ensure!(
                u_speed.is_finite() && v_speed.is_finite(),
                "TextureVelocity payload contains a non-finite value"
            );
            AnimationHookPayloadManifest::TextureVelocity {
                u_speed: *u_speed,
                v_speed: *v_speed,
            }
        }
        AnimationHookPayload::TextureVelocityPart(TextureVelocityPartHookPayload {
            part_index,
            u_speed,
            v_speed,
        }) => {
            ensure_part_index("TextureVelocityPart", *part_index, part_count)?;
            ensure!(
                u_speed.is_finite() && v_speed.is_finite(),
                "TextureVelocityPart payload contains a non-finite value"
            );
            AnimationHookPayloadManifest::TextureVelocityPart {
                part_index: *part_index,
                u_speed: *u_speed,
                v_speed: *v_speed,
            }
        }
    };
    Ok(payload)
}

fn ensure_part_index(hook_name: &str, part_index: u32, part_count: usize) -> Result<()> {
    ensure!(
        usize::try_from(part_index)? < part_count,
        "{hook_name} part index {part_index} is out of range for {part_count} parts"
    );
    Ok(())
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
    use holtburger_dat::file_type::setup_model::{
        AnimationFrame, SetOmegaHookPayload, TransparentPartHookPayload,
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
