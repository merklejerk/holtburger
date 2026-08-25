//! Compact typed transport for one decoded 0x33 `PhysicsScript`.
//!
//! Structurally the animation lane's sibling: the same binary envelope, the same shared hook
//! payload manifest, and the same raw-payload escape section. The differences are the ones the
//! source data actually has:
//!
//! - Records carry an absolute `startTime` in seconds instead of a frame index, so timing is the
//!   producer's own fact rather than a frame cadence.
//! - Part indices are **not** validated here. A script is authored independently of whichever
//!   object runs it, so the check belongs at bind time when the setup's part count is known.
//! - Hook direction is meaningless. Retail stamps `-2` on every script hook and `ScriptManager`
//!   executes unconditionally (acclient.c:316443), unlike animation frames which filter by
//!   playback direction. The frontend must not apply its animation direction rules here.

use anyhow::Result;
use holtburger_dat::file_type::PhysicsScript;
use serde::Serialize;

use crate::behavior_hook_source::{
    BehaviorHookPayloadManifest, PartIndexScope, behavior_hook_payload, hook_name,
};
use crate::binary_source_record::{
    BinarySectionManifest, BinarySectionWriter, serialize_binary_envelope,
};
use crate::source_projection::dat_id;

pub(crate) const PHYSICS_SCRIPT_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBPS";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhysicsScriptRecordManifest {
    transport: &'static str,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    script_id: String,
    /// Authored length in seconds; a self-`CallPES` repeats at exactly this interval.
    length_seconds: f64,
    records: Vec<PhysicsScriptEventManifest>,
    sections: Vec<BinarySectionManifest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhysicsScriptEventManifest {
    /// Seconds from script activation.
    start_time: f64,
    /// Authored file position, retained as the stable tiebreak for equal start times.
    authored_order: usize,
    hook_type: u32,
    hook_name: &'static str,
    payload: BehaviorHookPayloadManifest,
}

/// Serialize one decoded physics script into a compact typed frontend record.
pub(crate) fn serialize_physics_script_record_binary(script: &PhysicsScript) -> Result<Vec<u8>> {
    let mut hook_payload_bytes = Vec::new();
    let records = script
        .records
        .iter()
        .map(|record| {
            Ok(PhysicsScriptEventManifest {
                start_time: record.start_time,
                authored_order: record.authored_order,
                hook_type: record.hook.hook_type,
                hook_name: hook_name(record.hook.hook_type),
                payload: behavior_hook_payload(
                    &record.hook,
                    PartIndexScope::DeferredToBinding,
                    &mut hook_payload_bytes,
                )?,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let mut writer = BinarySectionWriter::default();
    writer.append_u8("hookPayloadBytes", &hook_payload_bytes);
    let (sections, section_bytes) = writer.finish();

    let manifest = PhysicsScriptRecordManifest {
        transport: "holtburger-physics-script",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        script_id: dat_id(script.id),
        length_seconds: script.length_seconds(),
        records,
        sections,
    };
    serialize_binary_envelope(
        PHYSICS_SCRIPT_RECORD_BINARY_MAGIC,
        &manifest,
        &section_bytes,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::binary_source_record::BINARY_HEADER_LENGTH;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_dat::file_type::PhysicsScriptRecord;
    use holtburger_dat::file_type::setup_model::{
        AnimationHook, AnimationHookPayload, CallPesHookPayload, CreateParticleHookPayload,
        SoundTweakedHookPayload,
    };
    use holtburger_dat::graphics::Frame;

    fn record(
        start_time: f64,
        authored_order: usize,
        payload: AnimationHookPayload,
    ) -> PhysicsScriptRecord {
        let hook_type = match &payload {
            AnimationHookPayload::CreateParticle(_) => 13,
            AnimationHookPayload::CallPes(_) => 19,
            AnimationHookPayload::SoundTweaked(_) => 21,
            other => panic!("unexpected fixture payload {other:?}"),
        };
        PhysicsScriptRecord {
            start_time,
            authored_order,
            hook: AnimationHook {
                hook_type,
                // Retail stamps -2 on every script hook; the transport carries no direction at all.
                direction: -2,
                payload,
            },
        }
    }

    fn parse_manifest(bytes: &[u8]) -> serde_json::Value {
        assert_eq!(&bytes[..4], PHYSICS_SCRIPT_RECORD_BINARY_MAGIC);
        let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let total_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        assert_eq!(total_length, bytes.len());
        serde_json::from_slice(&bytes[BINARY_HEADER_LENGTH..BINARY_HEADER_LENGTH + manifest_length])
            .unwrap()
    }

    #[test]
    fn projects_the_representative_self_cycling_script() {
        // 0x33000863 verbatim: an ambient sound then a self-call with a random pause bound.
        let script = PhysicsScript {
            id: 0x3300_0863,
            records: vec![
                record(
                    0.0,
                    0,
                    AnimationHookPayload::SoundTweaked(SoundTweakedHookPayload {
                        sound_id: 0x0A00_0207,
                        probability: 1.0,
                        unused: 0.0,
                        volume: 0.3,
                    }),
                ),
                record(
                    2.0,
                    1,
                    AnimationHookPayload::CallPes(CallPesHookPayload {
                        script_id: 0x3300_0863,
                        pause_seconds: 1.0,
                    }),
                ),
            ],
        };

        let manifest = parse_manifest(&serialize_physics_script_record_binary(&script).unwrap());

        assert_eq!(manifest["scriptId"], "0x33000863");
        assert_eq!(manifest["lengthSeconds"], 2.0);
        assert_eq!(manifest["records"][0]["hookName"], "sound-tweaked");
        assert_eq!(manifest["records"][0]["startTime"], 0.0);
        // Retail's field order, not ACE's: the first float after the id is the probability roll.
        assert_eq!(manifest["records"][0]["payload"]["probability"], 1.0);
        assert_eq!(manifest["records"][0]["payload"]["unused"], 0.0);
        assert_eq!(manifest["records"][0]["payload"]["soundId"], "0x0a000207");
        assert_eq!(manifest["records"][1]["hookName"], "call-pes");
        assert_eq!(manifest["records"][1]["payload"]["scriptId"], "0x33000863");
        assert_eq!(manifest["records"][1]["payload"]["pauseSeconds"], 1.0);
    }

    #[test]
    fn carries_the_whole_object_particle_sentinel_without_a_part_count() {
        // 0x330007DF: part -1 with a pure-translation offset, projected with no setup in hand.
        let script = PhysicsScript {
            id: 0x3300_07DF,
            records: vec![record(
                0.0,
                0,
                AnimationHookPayload::CreateParticle(CreateParticleHookPayload {
                    emitter_info_id: 0x3200_0829,
                    part_index: -1,
                    offset: Frame {
                        origin: Vector3::new(0.0, 0.0, 1.2),
                        orientation: Quaternion {
                            w: 1.0,
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                        },
                    },
                    emitter_id: 0,
                }),
            )],
        };

        let manifest = parse_manifest(&serialize_physics_script_record_binary(&script).unwrap());

        let payload = &manifest["records"][0]["payload"];
        assert_eq!(payload["emitterInfoId"], "0x32000829");
        assert_eq!(payload["partIndex"], -1);
        assert_eq!(payload["offsetOrigin"], serde_json::json!([0.0, 0.0, 1.2]));
        assert_eq!(payload["emitterId"], 0);
    }

    #[test]
    fn rejects_a_non_finite_particle_offset() {
        let script = PhysicsScript {
            id: 0x3300_0001,
            records: vec![record(
                0.0,
                0,
                AnimationHookPayload::CreateParticle(CreateParticleHookPayload {
                    emitter_info_id: 0x3200_0001,
                    part_index: -1,
                    offset: Frame {
                        origin: Vector3::new(0.0, f32::NAN, 0.0),
                        orientation: Quaternion {
                            w: 1.0,
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                        },
                    },
                    emitter_id: 0,
                }),
            )],
        };

        let error = serialize_physics_script_record_binary(&script)
            .expect_err("a non-finite offset should not project");
        assert!(error.to_string().contains("non-finite"));
    }
}
