//! Compact typed transport for one decoded 0x20 `SoundTable`.
//!
//! Selection is deliberately **not** resolved here: which candidate plays depends on a roll made at
//! trigger time, so the host ships every candidate and the frontend chooses. What the host does
//! resolve is the shape — a flat, ordered key/candidate listing — so no consumer re-derives the
//! archive's hash-table layout.

use anyhow::{Result, ensure};
use holtburger_dat::file_type::SoundTable;
use serde::Serialize;

use crate::binary_source_record::serialize_binary_envelope;
use crate::source_projection::dat_id;

pub(crate) const SOUND_TABLE_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBST";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SoundTableRecordManifest {
    transport: &'static str,
    byte_order: &'static str,
    sound_table_id: String,
    entries: Vec<SoundTableEntryManifest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SoundTableEntryManifest {
    /// Retail `SoundType` key.
    sound_type: u32,
    candidates: Vec<SoundCandidateManifest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SoundCandidateManifest {
    sound_id: String,
    probability: f32,
    volume: f32,
}

/// Serialize one decoded sound table into a compact typed frontend record.
pub(crate) fn serialize_sound_table_record_binary(table: &SoundTable) -> Result<Vec<u8>> {
    let entries = table
        .entries
        .iter()
        .map(|(sound_type, entry)| {
            ensure!(
                !entry.candidates.is_empty(),
                "SoundTable 0x{:08X} key {sound_type} has no candidates",
                table.id
            );
            Ok(SoundTableEntryManifest {
                sound_type: *sound_type,
                candidates: entry
                    .candidates
                    .iter()
                    .map(|candidate| SoundCandidateManifest {
                        sound_id: dat_id(candidate.sound_id),
                        probability: candidate.probability,
                        volume: candidate.volume,
                    })
                    .collect(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    // `priority` is deliberately dropped: retail uses it only for voice stealing among 16 global
    // voices, and every hook sound carries 0 and loses every contest, so no consumer can read it.
    let manifest = SoundTableRecordManifest {
        transport: "holtburger-sound-table",
        byte_order: "little-endian",
        sound_table_id: dat_id(table.id),
        entries,
    };
    serialize_binary_envelope(SOUND_TABLE_RECORD_BINARY_MAGIC, &manifest, &[])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::binary_source_record::BINARY_HEADER_LENGTH;
    use holtburger_dat::file_type::{SoundCandidate, SoundTableEntry};
    use std::collections::BTreeMap;

    fn table(candidates: Vec<SoundCandidate>) -> SoundTable {
        let mut entries = BTreeMap::new();
        entries.insert(4, SoundTableEntry { candidates });
        SoundTable {
            id: 0x2000_0001,
            entries,
        }
    }

    fn candidate(sound_id: u32) -> SoundCandidate {
        SoundCandidate {
            sound_id,
            priority: 0.0,
            probability: 1.0,
            volume: 0.75,
        }
    }

    #[test]
    fn projects_keyed_candidates_in_authored_order() {
        let bytes =
            serialize_sound_table_record_binary(&table(vec![candidate(0x0A00_0207)])).unwrap();

        let length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let manifest: serde_json::Value =
            serde_json::from_slice(&bytes[BINARY_HEADER_LENGTH..BINARY_HEADER_LENGTH + length])
                .unwrap();
        assert_eq!(manifest["soundTableId"], "0x20000001");
        assert_eq!(manifest["entries"][0]["soundType"], 4);
        assert_eq!(
            manifest["entries"][0]["candidates"][0]["soundId"],
            "0x0a000207"
        );
        assert_eq!(manifest["entries"][0]["candidates"][0]["volume"], 0.75);
    }

    #[test]
    fn refuses_a_key_with_no_candidates() {
        let error = serialize_sound_table_record_binary(&table(Vec::new()))
            .expect_err("an empty key should not project");
        assert!(error.to_string().contains("no candidates"));
    }
}
