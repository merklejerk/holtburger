use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

#[derive(Debug, Clone, PartialEq)]
pub struct RaiseAttributeData {
    pub attribute_type: u32,
    pub xp_spent: u32,
}

impl ProtocolUnpack for RaiseAttributeData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let attribute_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let xp_spent = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            attribute_type,
            xp_spent,
        })
    }
}

impl ProtocolPack for RaiseAttributeData {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer
            .write_u32::<LittleEndian>(self.attribute_type)
            .unwrap();
        writer.write_u32::<LittleEndian>(self.xp_spent).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RaiseVitalData {
    pub vital_type: u32,
    pub xp_spent: u32,
}

impl ProtocolUnpack for RaiseVitalData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let vital_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let xp_spent = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            vital_type,
            xp_spent,
        })
    }
}

impl ProtocolPack for RaiseVitalData {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.vital_type).unwrap();
        writer.write_u32::<LittleEndian>(self.xp_spent).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RaiseSkillData {
    pub skill_type: u32,
    pub xp_spent: u32,
}

impl ProtocolUnpack for RaiseSkillData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let skill_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let xp_spent = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            skill_type,
            xp_spent,
        })
    }
}

impl ProtocolPack for RaiseSkillData {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.skill_type).unwrap();
        writer.write_u32::<LittleEndian>(self.xp_spent).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrainSkillData {
    pub skill_type: u32,
    pub credits_spent: i32,
}

impl ProtocolUnpack for TrainSkillData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let skill_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let credits_spent = LittleEndian::read_i32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            skill_type,
            credits_spent,
        })
    }
}

impl ProtocolPack for TrainSkillData {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.skill_type).unwrap();
        writer
            .write_i32::<LittleEndian>(self.credits_spent)
            .unwrap();
    }
}
