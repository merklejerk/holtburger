use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Shortcut {
    pub index: u32,
    pub object_id: Guid,
    pub spell_id: u16,
    pub layer: u16,
}

impl ProtocolUnpack for Shortcut {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let index = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let object_id = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(Shortcut {
            index,
            object_id,
            spell_id,
            layer,
        })
    }
}

impl ProtocolPack for Shortcut {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.index).unwrap();
        self.object_id.pack(writer);
        writer.write_u16::<LittleEndian>(self.spell_id).unwrap();
        writer.write_u16::<LittleEndian>(self.layer).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_shortcut_parity() {
        let sc = Shortcut {
            index: 1,
            object_id: Guid(0x100),
            spell_id: 10,
            layer: 1,
        };
        let mut buf = Vec::new();
        sc.pack(&mut buf);
        assert_pack_unpack_parity(&buf, &sc);
    }
}
