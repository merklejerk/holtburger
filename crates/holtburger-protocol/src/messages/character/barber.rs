//! Barber appearance assets, shared by ACE StartBarber and retail FinishBarber.

use crate::traits::{ProtocolPack, ProtocolUnpack};

/// Complete sixteen-word barber payload; style ordinals and shades never cross this wire seam.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BarberAppearanceData {
    /// Base palette for the character model.
    pub base_palette: u32,
    /// Selected head model; zero is legitimate for nonhuman bodies.
    pub head_object: u32,
    /// Replacement hair texture.
    pub hair_texture: u32,
    /// Original texture replaced by the hair texture.
    pub default_hair_texture: u32,
    /// Replacement eye texture.
    pub eyes_texture: u32,
    /// Original texture replaced by the eye texture.
    pub default_eyes_texture: u32,
    /// Replacement nose texture.
    pub nose_texture: u32,
    /// Original texture replaced by the nose texture.
    pub default_nose_texture: u32,
    /// Replacement mouth texture.
    pub mouth_texture: u32,
    /// Original texture replaced by the mouth texture.
    pub default_mouth_texture: u32,
    /// Resolved skin palette, rather than a shade or palette set.
    pub skin_palette: u32,
    /// Resolved hair palette.
    pub hair_palette: u32,
    /// Resolved eye palette.
    pub eyes_palette: u32,
    /// Effective body setup, including racial variants.
    pub setup: u32,
    /// Empyrean earthbound flag; other racial toggles are encoded through setup.
    pub option1: u32,
    /// Reserved word, preserved on decode; retail submits zero.
    pub option2: u32,
}

impl ProtocolUnpack for BarberAppearanceData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            base_palette: u32::unpack(data, offset)?,
            head_object: u32::unpack(data, offset)?,
            hair_texture: u32::unpack(data, offset)?,
            default_hair_texture: u32::unpack(data, offset)?,
            eyes_texture: u32::unpack(data, offset)?,
            default_eyes_texture: u32::unpack(data, offset)?,
            nose_texture: u32::unpack(data, offset)?,
            default_nose_texture: u32::unpack(data, offset)?,
            mouth_texture: u32::unpack(data, offset)?,
            default_mouth_texture: u32::unpack(data, offset)?,
            skin_palette: u32::unpack(data, offset)?,
            hair_palette: u32::unpack(data, offset)?,
            eyes_palette: u32::unpack(data, offset)?,
            setup: u32::unpack(data, offset)?,
            option1: u32::unpack(data, offset)?,
            option2: u32::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for BarberAppearanceData {
    fn pack(&self, buf: &mut Vec<u8>) {
        for word in [
            self.base_palette,
            self.head_object,
            self.hair_texture,
            self.default_hair_texture,
            self.eyes_texture,
            self.default_eyes_texture,
            self.nose_texture,
            self.default_nose_texture,
            self.mouth_texture,
            self.default_mouth_texture,
            self.skin_palette,
            self.hair_palette,
            self.eyes_palette,
            self.setup,
            self.option1,
            self.option2,
        ] {
            word.pack(buf);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{GameAction, GameActionMessage, GameEvent, GameEventMessage};
    use crate::opcodes::{GameActionOpcode, GameEventOpcode};
    use holtburger_common::Guid;

    #[test]
    fn start_and_finish_preserve_every_word_and_their_framing() {
        let words: Vec<u32> = (1..=16).map(|word| 0x1234_0000 + word).collect();
        let bytes: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();
        let payload = BarberAppearanceData::unpack(&bytes, &mut 0).unwrap();
        assert_eq!(payload.base_palette, words[0]);
        assert_eq!(payload.head_object, words[1]);
        assert_eq!(payload.hair_texture, words[2]);
        assert_eq!(payload.default_hair_texture, words[3]);
        assert_eq!(payload.eyes_texture, words[4]);
        assert_eq!(payload.default_eyes_texture, words[5]);
        assert_eq!(payload.nose_texture, words[6]);
        assert_eq!(payload.default_nose_texture, words[7]);
        assert_eq!(payload.mouth_texture, words[8]);
        assert_eq!(payload.default_mouth_texture, words[9]);
        assert_eq!(payload.skin_palette, words[10]);
        assert_eq!(payload.hair_palette, words[11]);
        assert_eq!(payload.eyes_palette, words[12]);
        assert_eq!(payload.setup, words[13]);
        assert_eq!(payload.option1, words[14]);
        assert_eq!(payload.option2, words[15]);
        let event = GameEventMessage {
            target: Guid(42),
            sequence: 7,
            event: GameEvent::StartBarber(Box::new(payload.clone())),
        };
        let mut encoded = Vec::new();
        event.pack(&mut encoded);
        let mut expected = Vec::new();
        event.target.pack(&mut expected);
        event.sequence.pack(&mut expected);
        (GameEventOpcode::StartBarber as u32).pack(&mut expected);
        expected.extend(&bytes);
        assert_eq!(encoded, expected);
        assert_eq!(GameEventMessage::unpack(&encoded, &mut 0), Some(event));

        let action = GameActionMessage {
            sequence: 8,
            action: GameAction::FinishBarber(Box::new(payload)),
        };
        encoded.clear();
        action.pack(&mut encoded);
        expected.clear();
        action.sequence.pack(&mut expected);
        (GameActionOpcode::FinishBarber as u32).pack(&mut expected);
        expected.extend(bytes);
        assert_eq!(encoded, expected);
        assert_eq!(GameActionMessage::unpack(&encoded, &mut 0), Some(action));
    }

    #[test]
    fn every_truncated_payload_is_rejected_and_zero_words_are_lossless() {
        let payload_bytes = [0; 16 * size_of::<u32>()];
        for length in 0..payload_bytes.len() {
            assert!(BarberAppearanceData::unpack(&payload_bytes[..length], &mut 0).is_none());
        }
        let payload = BarberAppearanceData::unpack(&payload_bytes, &mut 0).unwrap();
        let mut encoded = Vec::new();
        payload.pack(&mut encoded);
        assert_eq!(encoded, payload_bytes);
    }
}
