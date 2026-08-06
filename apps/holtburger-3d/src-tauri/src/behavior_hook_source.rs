//! Shared projection of one authored `AnimationHook` into the frontend's behavior transport.
//!
//! Animations and physics scripts are two independent producers of the *same* hook vocabulary, so
//! they project through one manifest shape rather than two parallel ones. The frontend compiles
//! both into a single `PreparedBehaviorCommand` union; keeping the transport shared is what makes
//! that possible without an adapter per producer.

use anyhow::{Result, ensure};
use holtburger_dat::file_type::setup_model::{
    AnimationHook, AnimationHookPayload, CallPesHookPayload, CreateParticleHookPayload,
    ScaleHookPayload, SoundTableHookPayload, SoundTweakedHookPayload, TextureVelocityHookPayload,
    TextureVelocityPartHookPayload, TransparentPartHookPayload,
};
use serde::Serialize;

use crate::source_projection::dat_id;

/// Whether a producer knows its target's part array while projecting.
///
/// Animations are authored against one setup, so a bad part index is a source defect we can reject
/// immediately. Physics scripts are authored independently of whichever object runs them, so their
/// part indices are only checkable when the script binds to an entity.
#[derive(Debug, Clone, Copy)]
pub(crate) enum PartIndexScope {
    Known(usize),
    DeferredToBinding,
}

/// One authored hook projected losslessly, with raw payloads escaping to a byte section.
#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum BehaviorHookPayloadManifest {
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
    SoundTable {
        sound_type: u32,
    },
    Scale {
        end: f32,
        duration_seconds: f32,
    },
    CreateParticle {
        emitter_info_id: String,
        /// `-1` addresses the whole object; any other value addresses a part.
        part_index: i32,
        offset_origin: [f32; 3],
        /// Retained for losslessness; retail never applies the hook frame's rotation.
        offset_orientation: [f32; 4],
        emitter_id: u32,
    },
    CallPes {
        script_id: String,
        /// Upper bound of a uniform random delay, not a fixed delay.
        pause_seconds: f32,
    },
    SoundTweaked {
        sound_id: String,
        probability: f32,
        unused: f32,
        volume: f32,
    },
}

/// Project one hook's payload, appending raw escape-hatch bytes to `raw_payloads`.
pub(crate) fn behavior_hook_payload(
    hook: &AnimationHook,
    part_scope: PartIndexScope,
    raw_payloads: &mut Vec<u8>,
) -> Result<BehaviorHookPayloadManifest> {
    let payload = match &hook.payload {
        AnimationHookPayload::NoPayload => BehaviorHookPayloadManifest::NoPayload,
        AnimationHookPayload::Raw(bytes) => {
            let (byte_offset, byte_length) = append_payload(raw_payloads, bytes);
            BehaviorHookPayloadManifest::Raw {
                byte_offset,
                byte_length,
            }
        }
        AnimationHookPayload::ReplaceObject(bytes) => {
            let (byte_offset, byte_length) = append_payload(raw_payloads, bytes);
            BehaviorHookPayloadManifest::ReplaceObject {
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
            BehaviorHookPayloadManifest::SetOmega {
                omega: [payload.omega.x, payload.omega.y, payload.omega.z],
            }
        }
        AnimationHookPayload::TransparentPart(TransparentPartHookPayload {
            part_index,
            start,
            end,
            duration_seconds,
        }) => {
            ensure_part_index("TransparentPart", *part_index, part_scope)?;
            ensure!(
                start.is_finite() && end.is_finite() && duration_seconds.is_finite(),
                "TransparentPart payload contains a non-finite value"
            );
            BehaviorHookPayloadManifest::TransparentPart {
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
            BehaviorHookPayloadManifest::TextureVelocity {
                u_speed: *u_speed,
                v_speed: *v_speed,
            }
        }
        AnimationHookPayload::TextureVelocityPart(TextureVelocityPartHookPayload {
            part_index,
            u_speed,
            v_speed,
        }) => {
            ensure_part_index("TextureVelocityPart", *part_index, part_scope)?;
            ensure!(
                u_speed.is_finite() && v_speed.is_finite(),
                "TextureVelocityPart payload contains a non-finite value"
            );
            BehaviorHookPayloadManifest::TextureVelocityPart {
                part_index: *part_index,
                u_speed: *u_speed,
                v_speed: *v_speed,
            }
        }
        AnimationHookPayload::SoundTable(SoundTableHookPayload { sound_type }) => {
            BehaviorHookPayloadManifest::SoundTable {
                sound_type: *sound_type,
            }
        }
        AnimationHookPayload::Scale(ScaleHookPayload {
            end,
            duration_seconds,
        }) => {
            ensure!(
                end.is_finite() && duration_seconds.is_finite(),
                "Scale payload contains a non-finite value"
            );
            ensure!(*end > 0.0, "Scale target {end} is not a usable scale");
            BehaviorHookPayloadManifest::Scale {
                end: *end,
                duration_seconds: *duration_seconds,
            }
        }
        AnimationHookPayload::CreateParticle(CreateParticleHookPayload {
            emitter_info_id,
            part_index,
            offset,
            emitter_id,
        }) => {
            if *part_index >= 0 {
                ensure_part_index("CreateParticle", u32::try_from(*part_index)?, part_scope)?;
            }
            ensure!(
                offset.origin.x.is_finite()
                    && offset.origin.y.is_finite()
                    && offset.origin.z.is_finite(),
                "CreateParticle offset contains a non-finite component"
            );
            BehaviorHookPayloadManifest::CreateParticle {
                emitter_info_id: dat_id(*emitter_info_id),
                part_index: *part_index,
                offset_origin: [offset.origin.x, offset.origin.y, offset.origin.z],
                offset_orientation: [
                    offset.orientation.w,
                    offset.orientation.x,
                    offset.orientation.y,
                    offset.orientation.z,
                ],
                emitter_id: *emitter_id,
            }
        }
        AnimationHookPayload::CallPes(CallPesHookPayload {
            script_id,
            pause_seconds,
        }) => BehaviorHookPayloadManifest::CallPes {
            script_id: dat_id(*script_id),
            pause_seconds: *pause_seconds,
        },
        AnimationHookPayload::SoundTweaked(SoundTweakedHookPayload {
            sound_id,
            probability,
            unused,
            volume,
        }) => BehaviorHookPayloadManifest::SoundTweaked {
            sound_id: dat_id(*sound_id),
            probability: *probability,
            unused: *unused,
            volume: *volume,
        },
    };
    Ok(payload)
}

fn ensure_part_index(hook_name: &str, part_index: u32, scope: PartIndexScope) -> Result<()> {
    let PartIndexScope::Known(part_count) = scope else {
        return Ok(());
    };
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

pub(crate) fn hook_direction(direction: i32) -> &'static str {
    match direction {
        -2 => "unknown",
        -1 => "backward",
        0 => "both",
        1 => "forward",
        _ => "invalid",
    }
}

pub(crate) fn hook_name(hook_type: u32) -> &'static str {
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
