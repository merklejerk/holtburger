use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct PlaySoundData {
    pub target: u32,
    pub sound_id: u32,
    pub volume: f32,
}

impl MessageUnpack for PlaySoundData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let target = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let sound_id = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let volume = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        Some(PlaySoundData {
            target,
            sound_id,
            volume,
        })
    }
}

impl MessagePack for PlaySoundData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.target).unwrap();
        buf.write_u32::<LittleEndian>(self.sound_id).unwrap();
        buf.write_f32::<LittleEndian>(self.volume).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayEffectData {
    pub target: u32,
    pub script_id: u32,
    pub speed: f32,
}

impl MessageUnpack for PlayEffectData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let target = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let script_id = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let speed = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        Some(PlayEffectData {
            target,
            script_id,
            speed,
        })
    }
}

impl MessagePack for PlayEffectData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.target).unwrap();
        buf.write_u32::<LittleEndian>(self.script_id).unwrap();
        buf.write_f32::<LittleEndian>(self.speed).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;
    use crate::protocol::messages::GameMessage;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_play_sound_fixture() {
        let expected = PlaySoundData {
            target: 0x50000001,
            sound_id: 100,
            volume: 0.8,
        };

        // Opcode (4) + Data (12)
        let data = &fixtures::SOUND[4..];
        assert_pack_unpack_parity::<PlaySoundData>(data, &expected);

        // Verify top-level dispatch
        let GameMessage::PlaySound(msg) = GameMessage::unpack(fixtures::SOUND).unwrap() else {
            panic!("Expected PlaySound");
        };
        assert_eq!(*msg, expected);
    }

    #[test]
    fn test_play_effect_fixture() {
        let expected = PlayEffectData {
            target: 0x50000001,
            script_id: 200,
            speed: 1.5,
        };

        // Opcode (4) + Data (12)
        let data = &fixtures::PLAY_EFFECT[4..];
        assert_pack_unpack_parity::<PlayEffectData>(data, &expected);

        // Verify top-level dispatch
        let GameMessage::PlayEffect(msg) = GameMessage::unpack(fixtures::PLAY_EFFECT).unwrap()
        else {
            panic!("Expected PlayEffect");
        };
        assert_eq!(*msg, expected);
    }
}
