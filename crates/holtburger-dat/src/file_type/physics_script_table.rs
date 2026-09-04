//! Typed 0x34 `PhysicsScriptTable` decoding and cue resolution.
//!
//! A table maps a retail `PlayScript` cue to an authored list of intensity thresholds and 0x33
//! `PhysicsScript` DIDs. The layout and lookup rule are proven against ACE
//! `ACE.DatLoader/FileTypes/PhysicsScriptTable.cs` and retail
//! `PhysicsScriptTableData::GetScript` (acclient.c:323183-323218).

use std::collections::BTreeMap;

use binrw::{
    BinRead, BinResult,
    io::{Read, Seek},
};

/// One authored intensity threshold and its selected PhysicsScript.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicsScriptChoice {
    /// Inclusive upper intensity threshold used by retail's first-match lookup.
    pub maximum_intensity: f32,
    /// Selected 0x33 `PhysicsScript` DID.
    pub script_did: u32,
}

/// The authored choices for one `PlayScript` cue, retained in file order.
#[derive(Debug, Clone, PartialEq)]
pub struct PhysicsScriptCue {
    pub choices: Vec<PhysicsScriptChoice>,
}

impl PhysicsScriptCue {
    /// Resolves the first authored threshold greater than or equal to `intensity`.
    ///
    /// Retail does not clamp the intensity or fall back to the last record. An intensity above
    /// every authored threshold therefore has no script.
    pub fn select(&self, intensity: f32) -> Option<u32> {
        intensity.is_finite().then_some(())?;
        self.choices
            .iter()
            .find(|choice| intensity <= choice.maximum_intensity)
            .map(|choice| choice.script_did)
    }
}

/// A decoded PhysicsScriptTable keyed by raw retail `PlayScript` cue value.
#[derive(Debug, Clone, PartialEq)]
pub struct PhysicsScriptTable {
    pub id: u32,
    /// Ordered map for deterministic diagnostics; choice order remains authored.
    pub cues: BTreeMap<u32, PhysicsScriptCue>,
}

impl PhysicsScriptTable {
    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let cue_count = u32::read_le(reader)?;
        let mut cues = BTreeMap::new();

        for _ in 0..cue_count {
            let cue = u32::read_le(reader)?;
            let choice_count = u32::read_le(reader)?;
            let mut choices = Vec::with_capacity(choice_count as usize);
            for choice_index in 0..choice_count as usize {
                let maximum_intensity = f32::read_le(reader)?;
                if !maximum_intensity.is_finite() {
                    return Err(binrw::Error::Custom {
                        pos: reader.stream_position()?,
                        err: Box::new(format!(
                            "PhysicsScriptTable 0x{id:08X} cue {cue} choice {choice_index} has non-finite intensity {maximum_intensity}"
                        )),
                    });
                }
                choices.push(PhysicsScriptChoice {
                    maximum_intensity,
                    script_did: u32::read_le(reader)?,
                });
            }
            if cues.insert(cue, PhysicsScriptCue { choices }).is_some() {
                return Err(binrw::Error::Custom {
                    pos: reader.stream_position()?,
                    err: Box::new(format!(
                        "PhysicsScriptTable 0x{id:08X} contains duplicate cue {cue}"
                    )),
                });
            }
        }

        Ok(Self { id, cues })
    }

    /// Resolves one cue/intensity pair through retail's first-threshold rule.
    pub fn select(&self, cue: u32, intensity: f32) -> Option<u32> {
        self.cues.get(&cue)?.select(intensity)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn encode(id: u32, cues: &[(u32, &[(f32, u32)])]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&id.to_le_bytes());
        bytes.extend_from_slice(&(cues.len() as u32).to_le_bytes());
        for (cue, choices) in cues {
            bytes.extend_from_slice(&cue.to_le_bytes());
            bytes.extend_from_slice(&(choices.len() as u32).to_le_bytes());
            for (maximum_intensity, script_did) in *choices {
                bytes.extend_from_slice(&maximum_intensity.to_le_bytes());
                bytes.extend_from_slice(&script_did.to_le_bytes());
            }
        }
        bytes
    }

    #[test]
    fn reads_cues_and_resolves_retail_intensity_thresholds() {
        const TABLE: u32 = 0x3400_0001;
        let bytes = encode(
            TABLE,
            &[
                (7, &[(0.25, 0x3300_0001), (0.75, 0x3300_0002)]),
                (8, &[(1.0, 0x3300_0003)]),
            ],
        );

        let table = PhysicsScriptTable::read(&mut Cursor::new(bytes)).expect("table should parse");

        assert_eq!(table.id, TABLE);
        assert_eq!(table.select(7, 0.0), Some(0x3300_0001));
        assert_eq!(table.select(7, 0.25), Some(0x3300_0001));
        assert_eq!(table.select(7, 0.5), Some(0x3300_0002));
        assert_eq!(table.select(7, 0.75), Some(0x3300_0002));
        assert_eq!(table.select(7, 0.76), None);
        assert_eq!(table.select(99, 0.5), None);
        assert_eq!(table.select(7, f32::NAN), None);
    }

    #[test]
    fn retains_authored_choice_order_instead_of_sorting_thresholds() {
        let bytes = encode(
            0x3400_0001,
            &[(7, &[(0.75, 0x3300_0001), (0.25, 0x3300_0002)])],
        );
        let table = PhysicsScriptTable::read(&mut Cursor::new(bytes)).expect("table should parse");

        assert_eq!(table.select(7, 0.2), Some(0x3300_0001));
    }

    #[test]
    fn rejects_non_finite_thresholds() {
        let bytes = encode(0x3400_0001, &[(7, &[(f32::NAN, 0x3300_0001)])]);
        let error = PhysicsScriptTable::read(&mut Cursor::new(bytes))
            .expect_err("non-finite threshold should fail");

        assert!(error.to_string().contains("non-finite intensity"));
    }

    #[test]
    fn rejects_duplicate_cues() {
        let bytes = encode(
            0x3400_0001,
            &[(7, &[(0.5, 0x3300_0001)]), (7, &[(1.0, 0x3300_0002)])],
        );
        let error = PhysicsScriptTable::read(&mut Cursor::new(bytes))
            .expect_err("duplicate cue should fail");

        assert!(error.to_string().contains("duplicate cue"));
    }
}
