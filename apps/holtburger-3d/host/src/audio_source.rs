//! Compact typed transport for one decoded 0x0A `Wave`.
//!
//! The payload is delivered **decoder-ready**: PCM assets arrive RIFF-wrapped and MP3 assets arrive
//! as-is, so the frontend hands the bytes straight to `decodeAudioData` without knowing anything
//! about `WAVEFORMATEX`. Container assembly is a fact of the source format, so it is computed once
//! here rather than by every consumer.

use anyhow::{Result, ensure};
use holtburger_dat::file_type::{Wave, WaveFormat};
use serde::Serialize;

use crate::binary_source_record::serialize_binary_envelope;
use crate::source_projection::dat_id;

pub(crate) const AUDIO_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBAU";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioRecordManifest {
    transport: &'static str,
    byte_order: &'static str,
    sound_id: String,
    /// MIME type the payload can be decoded as, chosen from the source format tag.
    media_type: &'static str,
    channels: u16,
    samples_per_second: u32,
    bits_per_sample: u16,
    /// Byte length of the decoder-ready payload that follows the manifest.
    payload_byte_length: usize,
}

/// Serialize one decoded audio asset into a compact typed frontend record.
pub(crate) fn serialize_audio_record_binary(wave: &Wave) -> Result<Vec<u8>> {
    let (media_type, payload) = match wave.header.format {
        // A Wave record is a bare header plus payload, so PCM needs its container built.
        WaveFormat::Pcm => ("audio/wav", wave.to_riff()),
        // MP3 payloads are self-describing; wrapping one would corrupt it.
        WaveFormat::Mp3 => ("audio/mpeg", wave.data.clone()),
        WaveFormat::Unsupported(tag) => {
            anyhow::bail!(
                "Wave 0x{:08X} has unsupported format tag 0x{tag:04X}",
                wave.id
            )
        }
    };
    ensure!(
        !payload.is_empty(),
        "Wave 0x{:08X} carries no audio payload",
        wave.id
    );
    let manifest = AudioRecordManifest {
        transport: "holtburger-audio",
        byte_order: "little-endian",
        sound_id: dat_id(wave.id),
        media_type,
        channels: wave.header.channels,
        samples_per_second: wave.header.samples_per_second,
        bits_per_sample: wave.header.bits_per_sample,
        payload_byte_length: payload.len(),
    };
    serialize_binary_envelope(AUDIO_RECORD_BINARY_MAGIC, &manifest, &payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::binary_source_record::BINARY_HEADER_LENGTH;
    use holtburger_dat::file_type::WaveHeader;

    fn wave(format: WaveFormat) -> Wave {
        Wave {
            id: 0x0A00_0207,
            header: WaveHeader {
                format,
                channels: 1,
                samples_per_second: 11025,
                average_bytes_per_second: 22050,
                block_align: 2,
                bits_per_sample: 16,
            },
            data: vec![1, 2, 3, 4],
        }
    }

    fn parts(bytes: &[u8]) -> (serde_json::Value, Vec<u8>) {
        assert_eq!(&bytes[..4], AUDIO_RECORD_BINARY_MAGIC);
        let length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let manifest =
            serde_json::from_slice(&bytes[BINARY_HEADER_LENGTH..BINARY_HEADER_LENGTH + length])
                .unwrap();
        (manifest, bytes[BINARY_HEADER_LENGTH + length..].to_vec())
    }

    #[test]
    fn wraps_pcm_into_a_decoder_ready_container() {
        let (manifest, payload) =
            parts(&serialize_audio_record_binary(&wave(WaveFormat::Pcm)).unwrap());

        assert_eq!(manifest["soundId"], "0x0a000207");
        assert_eq!(manifest["mediaType"], "audio/wav");
        assert_eq!(manifest["samplesPerSecond"], 11025);
        // RIFF header is 44 bytes ahead of the four payload bytes.
        assert_eq!(&payload[..4], b"RIFF");
        assert_eq!(payload.len(), 48);
        assert_eq!(manifest["payloadByteLength"], 48);
    }

    #[test]
    fn passes_mp3_through_untouched() {
        let (manifest, payload) =
            parts(&serialize_audio_record_binary(&wave(WaveFormat::Mp3)).unwrap());

        assert_eq!(manifest["mediaType"], "audio/mpeg");
        // Wrapping a self-describing payload would corrupt it.
        assert_eq!(payload, vec![1, 2, 3, 4]);
    }

    #[test]
    fn refuses_an_unsupported_format() {
        let error = serialize_audio_record_binary(&wave(WaveFormat::Unsupported(0x1234)))
            .expect_err("an unknown format should not project");
        assert!(error.to_string().contains("unsupported format tag"));
    }
}
