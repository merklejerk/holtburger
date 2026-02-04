use byteorder::{ByteOrder, LittleEndian};
use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
pub use crate::protocol::messages::common::Enchantment;

#[derive(Debug, Clone, PartialEq)]
pub struct MagicUpdateEnchantmentData {
    pub target: u32,
    pub sequence: u32,
    pub enchantment: Enchantment,
}

impl MessageUnpack for MagicUpdateEnchantmentData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let enchantment = Enchantment::unpack(data, offset)?;
        Some(MagicUpdateEnchantmentData { target: 0, sequence: 0, enchantment })
    }
}

impl MessagePack for MagicUpdateEnchantmentData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.enchantment.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicUpdateMultipleEnchantmentsData {
    pub target: u32,
    pub sequence: u32,
    pub enchantments: Vec<Enchantment>,
}

impl MessageUnpack for MagicUpdateMultipleEnchantmentsData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() { return None; }
        let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut enchantments = Vec::new();
        for _ in 0..count {
            enchantments.push(Enchantment::unpack(data, offset)?);
        }
        Some(MagicUpdateMultipleEnchantmentsData { target: 0, sequence: 0, enchantments })
    }
}

impl MessagePack for MagicUpdateMultipleEnchantmentsData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.enchantments.len() as u32).to_le_bytes());
        for enchantment in &self.enchantments {
            enchantment.pack(buf);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicRemoveEnchantmentData {
    pub target: u32,
    pub sequence: u32,
    pub spell_id: u16,
    pub layer: u16,
}

impl MessageUnpack for MagicRemoveEnchantmentData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() { return None; }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(MagicRemoveEnchantmentData { target: 0, sequence: 0, spell_id, layer })
    }
}

impl MessagePack for MagicRemoveEnchantmentData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.spell_id.to_le_bytes());
        buf.extend_from_slice(&self.layer.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicRemoveMultipleEnchantmentsData {
    pub target: u32,
    pub sequence: u32,
    pub spells: Vec<(u16, u16)>,
}

impl MessageUnpack for MagicRemoveMultipleEnchantmentsData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() { return None; }
        let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut spells = Vec::new();
        for _ in 0..count {
            if *offset + 4 > data.len() { return None; }
            let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
            let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
            *offset += 4;
            spells.push((spell_id, layer));
        }
        Some(MagicRemoveMultipleEnchantmentsData { target: 0, sequence: 0, spells })
    }
}

impl MessagePack for MagicRemoveMultipleEnchantmentsData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.spells.len() as u32).to_le_bytes());
        for (spell_id, layer) in &self.spells {
            buf.extend_from_slice(&spell_id.to_le_bytes());
            buf.extend_from_slice(&layer.to_le_bytes());
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicPurgeEnchantmentsData {
    pub target: u32,
    pub sequence: u32,
}

impl MessageUnpack for MagicPurgeEnchantmentsData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(MagicPurgeEnchantmentsData { target: 0, sequence: 0 })
    }
}

impl MessagePack for MagicPurgeEnchantmentsData {
    fn pack(&self, _buf: &mut Vec<u8>) {
        // Body is empty
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicPurgeBadEnchantmentsData {
    pub target: u32,
    pub sequence: u32,
}

impl MessageUnpack for MagicPurgeBadEnchantmentsData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(MagicPurgeBadEnchantmentsData { target: 0, sequence: 0 })
    }
}

impl MessagePack for MagicPurgeBadEnchantmentsData {
    fn pack(&self, _buf: &mut Vec<u8>) {
        // Body is empty
    }
}
