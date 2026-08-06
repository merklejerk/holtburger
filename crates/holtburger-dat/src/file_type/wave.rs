//! Typed 0x0A `Wave` decoding.
//!
//! A Wave record is a `WAVEFORMATEX` header plus raw payload — deliberately *not* a RIFF file, so
//! it cannot be handed to a decoder as-is. Layout proven from ACE
//! `ACE.DatLoader/FileTypes/Wave.cs`; retail decodes the same two shapes through ACM.

use binrw::{
    BinRead, BinResult,
    io::{Read, Seek},
};

/// `WAVEFORMATEX::wFormatTag` values the archive actually contains.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaveFormat {
    /// Uncompressed PCM, playable once wrapped in a RIFF container.
    Pcm,
    /// MPEG Layer 3. Retail decodes it through ACM to PCM 11025 Hz/16-bit/mono.
    Mp3,
    /// Anything else. Reported rather than guessed, so an unplayable asset is visible.
    Unsupported(u16),
}

impl WaveFormat {
    fn from_tag(tag: u16) -> Self {
        match tag {
            0x0001 => Self::Pcm,
            0x0055 => Self::Mp3,
            other => Self::Unsupported(other),
        }
    }
}

/// The `WAVEFORMATEX` fields a player needs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WaveHeader {
    pub format: WaveFormat,
    pub channels: u16,
    pub samples_per_second: u32,
    pub average_bytes_per_second: u32,
    pub block_align: u16,
    pub bits_per_sample: u16,
}

/// One decoded audio asset.
#[derive(Debug, Clone, PartialEq)]
pub struct Wave {
    pub id: u32,
    pub header: WaveHeader,
    /// Payload bytes, in whatever encoding `header.format` names.
    pub data: Vec<u8>,
}

/// `WAVEFORMATEX` is 16 bytes through `wBitsPerSample`; AC headers are usually 18 and sometimes more.
const MINIMUM_HEADER_BYTES: usize = 16;

impl Wave {
    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let header_size = u32::read_le(reader)? as usize;
        let data_size = u32::read_le(reader)? as usize;
        if header_size < MINIMUM_HEADER_BYTES {
            return Err(binrw::Error::Custom {
                pos: reader.stream_position()?,
                err: Box::new(format!(
                    "Wave 0x{id:08X} declares a {header_size}-byte header, below the \
                     {MINIMUM_HEADER_BYTES}-byte WAVEFORMATEX minimum"
                )),
            });
        }
        let mut header_bytes = vec![0u8; header_size];
        reader.read_exact(&mut header_bytes)?;
        let mut data = vec![0u8; data_size];
        reader.read_exact(&mut data)?;

        let read_u16 =
            |offset: usize| u16::from_le_bytes([header_bytes[offset], header_bytes[offset + 1]]);
        let read_u32 = |offset: usize| {
            u32::from_le_bytes([
                header_bytes[offset],
                header_bytes[offset + 1],
                header_bytes[offset + 2],
                header_bytes[offset + 3],
            ])
        };
        Ok(Self {
            id,
            header: WaveHeader {
                format: WaveFormat::from_tag(read_u16(0)),
                channels: read_u16(2),
                samples_per_second: read_u32(4),
                average_bytes_per_second: read_u32(8),
                block_align: read_u16(12),
                bits_per_sample: read_u16(14),
            },
            data,
        })
    }

    /// Wrap the payload in a RIFF container so a standard decoder can read it.
    ///
    /// Only meaningful for PCM: an MP3 payload is self-describing and is handed to a decoder
    /// directly, so callers must branch on `header.format` rather than wrapping unconditionally.
    /// AC headers can exceed 16 bytes, and RIFF's `fmt ` chunk is exactly 16, so the tail is
    /// dropped — the same truncation retail's own export path performs.
    pub fn to_riff(&self) -> Vec<u8> {
        let mut riff = Vec::with_capacity(44 + self.data.len());
        riff.extend_from_slice(b"RIFF");
        riff.extend_from_slice(&(self.data.len() as u32 + 36).to_le_bytes());
        riff.extend_from_slice(b"WAVEfmt ");
        riff.extend_from_slice(&16u32.to_le_bytes());
        let format_tag: u16 = match self.header.format {
            WaveFormat::Pcm => 0x0001,
            WaveFormat::Mp3 => 0x0055,
            WaveFormat::Unsupported(tag) => tag,
        };
        riff.extend_from_slice(&format_tag.to_le_bytes());
        riff.extend_from_slice(&self.header.channels.to_le_bytes());
        riff.extend_from_slice(&self.header.samples_per_second.to_le_bytes());
        riff.extend_from_slice(&self.header.average_bytes_per_second.to_le_bytes());
        riff.extend_from_slice(&self.header.block_align.to_le_bytes());
        riff.extend_from_slice(&self.header.bits_per_sample.to_le_bytes());
        riff.extend_from_slice(b"data");
        riff.extend_from_slice(&(self.data.len() as u32).to_le_bytes());
        riff.extend_from_slice(&self.data);
        riff
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn encode(id: u32, format_tag: u16, header_extra: usize, data: &[u8]) -> Vec<u8> {
        let mut header = Vec::new();
        header.extend_from_slice(&format_tag.to_le_bytes());
        header.extend_from_slice(&1u16.to_le_bytes()); // mono
        header.extend_from_slice(&11025u32.to_le_bytes());
        header.extend_from_slice(&22050u32.to_le_bytes());
        header.extend_from_slice(&2u16.to_le_bytes());
        header.extend_from_slice(&16u16.to_le_bytes());
        header.extend(std::iter::repeat_n(0u8, header_extra));

        let mut bytes = Vec::new();
        bytes.extend_from_slice(&id.to_le_bytes());
        bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
        bytes.extend(header);
        bytes.extend_from_slice(data);
        bytes
    }

    #[test]
    fn reads_a_pcm_asset_and_its_payload() {
        let bytes = encode(0x0A00_0207, 0x0001, 2, &[1, 2, 3, 4]);

        let wave = Wave::read(&mut Cursor::new(bytes)).expect("should parse");

        assert_eq!(wave.id, 0x0A00_0207);
        assert_eq!(wave.header.format, WaveFormat::Pcm);
        assert_eq!(wave.header.samples_per_second, 11025);
        assert_eq!(wave.header.channels, 1);
        assert_eq!(wave.data, vec![1, 2, 3, 4]);
    }

    #[test]
    fn recognizes_the_mp3_format_tag() {
        let wave = Wave::read(&mut Cursor::new(encode(0x0A00_0001, 0x0055, 2, &[9])))
            .expect("should parse");
        assert_eq!(wave.header.format, WaveFormat::Mp3);
    }

    #[test]
    fn reports_an_unknown_format_rather_than_assuming_pcm() {
        let wave = Wave::read(&mut Cursor::new(encode(0x0A00_0002, 0x1234, 2, &[9])))
            .expect("should parse");
        assert_eq!(wave.header.format, WaveFormat::Unsupported(0x1234));
    }

    #[test]
    fn rejects_a_header_shorter_than_waveformatex() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x0A00_0003u32.to_le_bytes());
        bytes.extend_from_slice(&8u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&[0u8; 8]);

        let error = Wave::read(&mut Cursor::new(bytes)).expect_err("should not parse");
        assert!(error.to_string().contains("WAVEFORMATEX minimum"));
    }

    #[test]
    fn wraps_pcm_payloads_in_a_riff_container_truncating_the_ac_header_tail() {
        // A 20-byte AC header still produces the fixed 16-byte RIFF `fmt ` chunk.
        let wave = Wave::read(&mut Cursor::new(encode(0x0A00_0004, 0x0001, 4, &[1, 2])))
            .expect("should parse");

        let riff = wave.to_riff();

        assert_eq!(&riff[0..4], b"RIFF");
        assert_eq!(&riff[8..16], b"WAVEfmt ");
        assert_eq!(&riff[36..40], b"data");
        assert_eq!(riff.len(), 44 + 2);
    }
}
