use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

#[derive(Debug, Clone, PartialEq)]
pub struct CastTargetedSpellData {
    pub target: Guid,
    pub spell_id: u32,
}

impl ProtocolUnpack for CastTargetedSpellData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let target = Guid::unpack(data, offset)?;
        let spell_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(CastTargetedSpellData { target, spell_id })
    }
}

impl ProtocolPack for CastTargetedSpellData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.target.pack(buf);
        buf.write_u32::<LittleEndian>(self.spell_id).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CastUntargetedSpellData {
    pub spell_id: u32,
}

impl ProtocolUnpack for CastUntargetedSpellData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(CastUntargetedSpellData { spell_id })
    }
}

impl ProtocolPack for CastUntargetedSpellData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.spell_id).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_cast_targeted_spell_parity() {
        let expected = CastTargetedSpellData {
            target: Guid(0x50000001),
            spell_id: 1234,
        };
        // Generated from ACE: SyntheticProtocolTests.DumpSpells
        let fixture = hex::decode("01000050D2040000").unwrap();
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_cast_untargeted_spell_parity() {
        let expected = CastUntargetedSpellData { spell_id: 1234 };
        // Generated from ACE: SyntheticProtocolTests.DumpSpells
        let fixture = hex::decode("D2040000").unwrap();
        assert_pack_unpack_parity(&fixture, &expected);
    }
}
