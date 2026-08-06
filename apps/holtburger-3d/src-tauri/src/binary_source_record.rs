use anyhow::{Result, ensure};
use serde::Serialize;

/// `magic` + manifest length + total length, ahead of every app-host binary source record.
pub(crate) const BINARY_HEADER_LENGTH: usize = 12;

/// Wrap a JSON manifest and its typed section bytes in the shared binary envelope.
///
/// The manifest is space-padded so the section data stays 4-byte aligned, which is what lets the
/// frontend read `Float32Array`/`Uint32Array` views directly over the response buffer.
pub(crate) fn serialize_binary_envelope<T: Serialize>(
    magic: &[u8; 4],
    manifest: &T,
    section_bytes: &[u8],
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(manifest)?;
    while !(BINARY_HEADER_LENGTH + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_length = BINARY_HEADER_LENGTH + manifest_bytes.len() + section_bytes.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(magic);
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    bytes.extend(section_bytes);
    Ok(bytes)
}

/// One typed, aligned scalar section in an app-host binary source record.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BinarySectionManifest {
    pub(crate) name: String,
    pub(crate) scalar_type: &'static str,
    pub(crate) element_count: usize,
    pub(crate) byte_offset: usize,
    pub(crate) byte_length: usize,
}

/// Appends typed little-endian sections while owning their manifest offsets.
#[derive(Default)]
pub(crate) struct BinarySectionWriter {
    bytes: Vec<u8>,
    sections: Vec<BinarySectionManifest>,
}

impl BinarySectionWriter {
    pub(crate) fn append_f32(
        &mut self,
        name: impl Into<String>,
        values: impl IntoIterator<Item = f32>,
    ) -> Result<()> {
        let values = values.into_iter().collect::<Vec<_>>();
        let name = name.into();
        ensure!(
            values.iter().copied().all(f32::is_finite),
            "section {name} contains non-finite values"
        );
        self.align(4);
        let byte_offset = self.bytes.len();
        for value in &values {
            self.bytes.extend(value.to_le_bytes());
        }
        self.push_manifest(name, "f32", values.len(), byte_offset, 4);
        Ok(())
    }

    pub(crate) fn append_u32(
        &mut self,
        name: impl Into<String>,
        values: impl IntoIterator<Item = u32>,
    ) {
        let values = values.into_iter().collect::<Vec<_>>();
        self.align(4);
        let byte_offset = self.bytes.len();
        for value in &values {
            self.bytes.extend(value.to_le_bytes());
        }
        self.push_manifest(name.into(), "u32", values.len(), byte_offset, 4);
    }

    pub(crate) fn append_u16(
        &mut self,
        name: impl Into<String>,
        values: impl IntoIterator<Item = u16>,
    ) {
        let values = values.into_iter().collect::<Vec<_>>();
        self.align(2);
        let byte_offset = self.bytes.len();
        for value in &values {
            self.bytes.extend(value.to_le_bytes());
        }
        self.push_manifest(name.into(), "u16", values.len(), byte_offset, 2);
    }

    pub(crate) fn append_u8(&mut self, name: impl Into<String>, values: &[u8]) {
        let byte_offset = self.bytes.len();
        self.bytes.extend(values);
        self.push_manifest(name.into(), "u8", values.len(), byte_offset, 1);
    }

    pub(crate) fn finish(self) -> (Vec<BinarySectionManifest>, Vec<u8>) {
        (self.sections, self.bytes)
    }

    fn align(&mut self, alignment: usize) {
        self.bytes
            .resize(self.bytes.len().next_multiple_of(alignment), 0);
    }

    fn push_manifest(
        &mut self,
        name: String,
        scalar_type: &'static str,
        element_count: usize,
        byte_offset: usize,
        element_size: usize,
    ) {
        self.sections.push(BinarySectionManifest {
            name,
            scalar_type,
            element_count,
            byte_offset,
            byte_length: element_count * element_size,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::BinarySectionWriter;

    #[test]
    fn writes_aligned_little_endian_sections_and_matching_manifests() {
        let mut writer = BinarySectionWriter::default();
        writer.append_u8("flags", &[7]);
        writer.append_u32("indices", [0x0102_0304]);
        writer.append_f32("positions", [0.5]).unwrap();
        let (sections, bytes) = writer.finish();

        assert_eq!(sections[0].byte_offset, 0);
        assert_eq!(sections[1].byte_offset, 4);
        assert_eq!(sections[2].byte_offset, 8);
        assert_eq!(&bytes[4..8], &0x0102_0304u32.to_le_bytes());
        assert_eq!(&bytes[8..12], &0.5f32.to_le_bytes());
    }

    #[test]
    fn rejects_non_finite_float_sections() {
        let mut writer = BinarySectionWriter::default();
        assert!(writer.append_f32("positions", [f32::NAN]).is_err());
    }
}
