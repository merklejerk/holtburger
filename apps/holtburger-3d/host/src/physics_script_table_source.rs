//! Compact typed transport for one decoded 0x34 `PhysicsScriptTable`.

use anyhow::{Result, ensure};
use holtburger_dat::file_type::PhysicsScriptTable;
use serde::Serialize;

use crate::binary_source_record::serialize_binary_envelope;
use crate::source_projection::dat_id;

pub(crate) const PHYSICS_SCRIPT_TABLE_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBPT";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhysicsScriptTableRecordManifest {
    transport: &'static str,
    byte_order: &'static str,
    physics_script_table_id: String,
    cues: Vec<PhysicsScriptCueManifest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhysicsScriptCueManifest {
    cue: u32,
    choices: Vec<PhysicsScriptChoiceManifest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhysicsScriptChoiceManifest {
    maximum_intensity: f32,
    script_id: String,
}

/// Serialize every authored cue choice; selection remains a browser-clock activation decision.
pub(crate) fn serialize_physics_script_table_record_binary(
    table: &PhysicsScriptTable,
) -> Result<Vec<u8>> {
    let cues = table
        .cues
        .iter()
        .map(|(cue, data)| {
            ensure!(
                !data.choices.is_empty(),
                "PhysicsScriptTable 0x{:08X} cue {cue} has no choices",
                table.id
            );
            Ok(PhysicsScriptCueManifest {
                cue: *cue,
                choices: data
                    .choices
                    .iter()
                    .map(|choice| PhysicsScriptChoiceManifest {
                        maximum_intensity: choice.maximum_intensity,
                        script_id: dat_id(choice.script_did),
                    })
                    .collect(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let manifest = PhysicsScriptTableRecordManifest {
        transport: "holtburger-physics-script-table",
        byte_order: "little-endian",
        physics_script_table_id: dat_id(table.id),
        cues,
    };
    serialize_binary_envelope(PHYSICS_SCRIPT_TABLE_RECORD_BINARY_MAGIC, &manifest, &[])
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::binary_source_record::BINARY_HEADER_LENGTH;
    use holtburger_dat::file_type::{PhysicsScriptChoice, PhysicsScriptCue};

    #[test]
    fn projects_cues_and_choices_in_stable_order() {
        let table = PhysicsScriptTable {
            id: 0x3400_0001,
            cues: BTreeMap::from([(
                7,
                PhysicsScriptCue {
                    choices: vec![PhysicsScriptChoice {
                        maximum_intensity: 0.75,
                        script_did: 0x3300_0002,
                    }],
                },
            )]),
        };

        let bytes = serialize_physics_script_table_record_binary(&table).unwrap();
        let length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let manifest: serde_json::Value =
            serde_json::from_slice(&bytes[BINARY_HEADER_LENGTH..BINARY_HEADER_LENGTH + length])
                .unwrap();
        assert_eq!(manifest["physicsScriptTableId"], "0x34000001");
        assert_eq!(manifest["cues"][0]["cue"], 7);
        assert_eq!(manifest["cues"][0]["choices"][0]["scriptId"], "0x33000002");
        assert_eq!(manifest["cues"][0]["choices"][0]["maximumIntensity"], 0.75);
    }
}
