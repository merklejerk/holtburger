use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaySoundData {
    pub target: Guid,
    pub sound_id: u32,
    pub volume: f32,
}

impl ProtocolUnpack for PlaySoundData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let sound_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let volume = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(PlaySoundData {
            target,
            sound_id,
            volume,
        })
    }
}

impl ProtocolPack for PlaySoundData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.target.pack(buf);
        buf.write_u32::<LittleEndian>(self.sound_id).unwrap();
        buf.write_f32::<LittleEndian>(self.volume).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayEffectData {
    pub target: Guid,
    pub script_id: u32,
    pub speed: f32,
}

impl ProtocolUnpack for PlayEffectData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let script_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let speed = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(PlayEffectData {
            target,
            script_id,
            speed,
        })
    }
}

impl ProtocolPack for PlayEffectData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.target.pack(buf);
        buf.write_u32::<LittleEndian>(self.script_id).unwrap();
        buf.write_f32::<LittleEndian>(self.speed).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;
    use crate::traits::ProtocolUnpack;

    #[test]
    fn test_play_sound_fixture() {
        let expected = PlaySoundData {
            target: Guid(0x50000001),
            sound_id: 100,
            volume: 0.8,
        };

        // Opcode (4) + Data (12)
        let data = &test_fixtures::SOUND[4..];
        assert_pack_unpack_parity::<PlaySoundData>(data, &expected);

        // Verify top-level dispatch
        let mut offset = 0;
        let GameMessage::PlaySound(msg) =
            GameMessage::unpack(test_fixtures::SOUND, &mut offset).unwrap()
        else {
            panic!("Expected PlaySound");
        };
        assert_eq!(*msg, expected);
    }

    #[test]
    fn test_play_effect_fixture() {
        let expected = PlayEffectData {
            target: Guid(0x50000001),
            script_id: 200,
            speed: 1.5,
        };

        // Opcode (4) + Data (12)
        let data = &test_fixtures::PLAY_EFFECT[4..];
        assert_pack_unpack_parity::<PlayEffectData>(data, &expected);

        // Verify top-level dispatch
        let mut offset = 0;
        let GameMessage::PlayEffect(msg) =
            GameMessage::unpack(test_fixtures::PLAY_EFFECT, &mut offset).unwrap()
        else {
            panic!("Expected PlayEffect");
        };
        assert_eq!(*msg, expected);
    }
}
