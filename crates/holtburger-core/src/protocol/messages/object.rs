use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::utils::{
    align_to_4, read_packed_u32, read_packed_u32_with_known_type, read_string16,
    write_packed_u32_with_known_type, write_string16,
};
use crate::world::position::WorldPosition;
use crate::world::properties::{ObjectDescriptionFlag, PhysicsDescriptionFlag, WeenieHeaderFlag};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectCreateData {
    pub guid: u32,
    pub model_header: u8,
    pub physics_flags: PhysicsDescriptionFlag,
    pub physics_state: u32,
    pub pos: Option<WorldPosition>,
    pub parent_id: Option<u32>,
    pub parent_loc: Option<u32>,
    pub obj_scale: Option<f32>,
    pub sequences: [u16; 9],
    pub weenie_flags: WeenieHeaderFlag,
    pub name: Option<String>,
    pub wcid: u32,
    pub icon_id: u32,
    pub item_type: u32,
    pub obj_desc_flags: ObjectDescriptionFlag,
    pub container_id: Option<u32>,
    pub wielder_id: Option<u32>,
}

impl MessageUnpack for ObjectCreateData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        if *offset >= data.len() {
            return None;
        }
        // ModelData
        let model_header = data[*offset];
        if model_header == 0x11 {
            *offset += 1;
            if *offset + 3 > data.len() {
                return None;
            }
            let num_p = data[*offset];
            let num_t = data[*offset + 1];
            let num_m = data[*offset + 2];
            *offset += 3;

            if num_p > 0 {
                read_packed_u32(data, offset); // PaletteID
                for _ in 0..num_p {
                    read_packed_u32(data, offset); // SubPaletteId
                    if *offset + 2 > data.len() {
                        return None;
                    }
                    *offset += 2; // Offset and Length
                }
            }
            for _ in 0..num_t {
                if *offset + 1 > data.len() {
                    return None;
                }
                *offset += 1; // PartIndex
                read_packed_u32(data, offset); // OldTexture
                read_packed_u32(data, offset); // NewTexture
            }
            for _ in 0..num_m {
                if *offset + 1 > data.len() {
                    return None;
                }
                *offset += 1; // Index
                read_packed_u32(data, offset); // AnimationId
            }
            *offset = align_to_4(*offset);
        } else {
            // Modern ACE / Minimal ModelData is just 4 bytes + Align
            // If it's not 0x11, it's usually flags (u8), num_p (u8), num_t (u8), num_m (u8)
            if *offset + 4 <= data.len() {
                *offset += 4;
                *offset = align_to_4(*offset);
            }
        }

        if *offset + 8 > data.len() {
            return None;
        }
        // PhysicsData
        let phys_flags_bits = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let physics_flags = PhysicsDescriptionFlag::from_bits_retain(phys_flags_bits);
        *offset += 4;

        let physics_state = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        if physics_flags.contains(PhysicsDescriptionFlag::MOVEMENT) {
            if *offset + 4 > data.len() {
                return None;
            }
            let len = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4 + len;
            if len > 0 {
                if *offset + 4 > data.len() {
                    return None;
                }
                *offset += 4; // is_autonomous
            }
        } else if physics_flags.contains(PhysicsDescriptionFlag::ANIMATION_FRAME) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }

        let mut pos = None;
        if physics_flags.contains(PhysicsDescriptionFlag::POSITION) {
            pos = WorldPosition::unpack(data, offset);
        }

        if physics_flags.contains(PhysicsDescriptionFlag::MTABLE) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::STABLE) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::PETABLE) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::CSETUP) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }

        let mut parent_id = None;
        let mut parent_loc = None;
        if physics_flags.contains(PhysicsDescriptionFlag::PARENT) {
            if *offset + 8 > data.len() {
                return None;
            }
            parent_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
            parent_loc = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::CHILDREN) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4 + (count * 8);
        }
        let mut obj_scale = None;
        if physics_flags.contains(PhysicsDescriptionFlag::OBJSCALE) {
            if *offset + 4 > data.len() {
                return None;
            }
            obj_scale = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::FRICTION) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::ELASTICITY) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::TRANSLUCENCY) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::VELOCITY) {
            if *offset + 12 > data.len() {
                return None;
            }
            *offset += 12;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::ACCELERATION) {
            if *offset + 12 > data.len() {
                return None;
            }
            *offset += 12;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::OMEGA) {
            if *offset + 12 > data.len() {
                return None;
            }
            *offset += 12;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::DEFAULT_SCRIPT) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::DEFAULT_SCRIPT_INTENSITY) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }

        if *offset + 18 > data.len() {
            return None;
        }
        // Sequences
        let mut sequences = [0u16; 9];
        for seq in &mut sequences {
            *seq = LittleEndian::read_u16(&data[*offset..*offset + 2]);
            *offset += 2;
        }
        *offset = align_to_4(*offset);

        // WeenieHeader
        if *offset + 4 > data.len() {
            return None;
        }
        let weenie_flags_bits = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let weenie_flags = WeenieHeaderFlag::from_bits_retain(weenie_flags_bits);
        *offset += 4;

        let name = read_string16(data, offset);
        let wcid = read_packed_u32_with_known_type(data, offset, 0);
        let icon_id = read_packed_u32_with_known_type(data, offset, 0x06000000);
        if *offset + 8 > data.len() {
            return None;
        }
        let item_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let obj_desc_flags_bits = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let obj_desc_flags = ObjectDescriptionFlag::from_bits_retain(obj_desc_flags_bits);
        *offset += 8;
        *offset = align_to_4(*offset);

        if obj_desc_flags.contains(ObjectDescriptionFlag::INCLUDES_SECOND_HEADER) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4; // weenie_flags2
        }

        if weenie_flags.contains(WeenieHeaderFlag::PLURAL_NAME) {
            read_string16(data, offset);
        }
        if weenie_flags.contains(WeenieHeaderFlag::ITEMS_CAPACITY) && *offset + 4 <= data.len() {
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::CONTAINERS_CAPACITY) && *offset + 4 <= data.len() {
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::AMMO_TYPE) && *offset + 2 <= data.len() {
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::VALUE) && *offset + 4 <= data.len() {
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::USABLE) && *offset + 4 <= data.len() {
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::USE_RADIUS) && *offset + 4 <= data.len() {
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::TARGET_TYPE) && *offset + 4 <= data.len() {
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::UI_EFFECTS) && *offset + 4 <= data.len() {
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::COMBAT_USE) && *offset < data.len() {
            *offset += 1;
        }
        if weenie_flags.contains(WeenieHeaderFlag::STRUCTURE) && *offset + 2 <= data.len() {
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::MAX_STRUCTURE) && *offset + 2 <= data.len() {
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::STACK_SIZE) && *offset + 2 <= data.len() {
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::MAX_STACK_SIZE) && *offset + 2 <= data.len() {
            *offset += 2;
        }

        let mut container_id = None;
        if weenie_flags.contains(WeenieHeaderFlag::CONTAINER) && *offset + 4 <= data.len() {
            container_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        let mut wielder_id = None;
        if weenie_flags.contains(WeenieHeaderFlag::WIELDER) && *offset + 4 <= data.len() {
            wielder_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        Some(ObjectCreateData {
            guid,
            model_header,
            physics_flags,
            physics_state,
            pos,
            parent_id,
            parent_loc,
            obj_scale,
            sequences,
            weenie_flags,
            name,
            wcid,
            icon_id,
            item_type,
            obj_desc_flags,
            container_id,
            wielder_id,
        })
    }
}

impl MessagePack for ObjectCreateData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.guid).unwrap();

        // ModelData
        buf.push(self.model_header);
        buf.push(0); // num_p
        buf.push(0); // num_t
        buf.push(0); // num_m
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }

        // PhysicsData
        buf.write_u32::<LittleEndian>(self.physics_flags.bits())
            .unwrap();
        buf.write_u32::<LittleEndian>(self.physics_state).unwrap();

        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::POSITION)
        {
            self.pos.as_ref().unwrap().pack(buf);
        }

        if self.physics_flags.contains(PhysicsDescriptionFlag::PARENT) {
            buf.write_u32::<LittleEndian>(self.parent_id.unwrap())
                .unwrap();
            buf.write_u32::<LittleEndian>(self.parent_loc.unwrap_or(0))
                .unwrap();
        }

        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::OBJSCALE)
        {
            buf.write_f32::<LittleEndian>(self.obj_scale.unwrap_or(1.0))
                .unwrap();
        }

        // Sequences (18 bytes)
        for val in self.sequences {
            buf.write_u16::<LittleEndian>(val).unwrap();
        }
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }

        // WeenieHeader
        buf.write_u32::<LittleEndian>(self.weenie_flags.bits())
            .unwrap();
        write_string16(buf, self.name.as_deref().unwrap_or(""));
        write_packed_u32_with_known_type(buf, self.wcid, 0);
        write_packed_u32_with_known_type(buf, self.icon_id, 0x06000000);
        buf.write_u32::<LittleEndian>(self.item_type).unwrap();
        buf.write_u32::<LittleEndian>(self.obj_desc_flags.bits())
            .unwrap();
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }

        if self
            .obj_desc_flags
            .contains(ObjectDescriptionFlag::INCLUDES_SECOND_HEADER)
        {
            buf.write_u32::<LittleEndian>(0).unwrap(); // weenie_flags2
        }

        if self.weenie_flags.contains(WeenieHeaderFlag::CONTAINER) {
            buf.write_u32::<LittleEndian>(self.container_id.unwrap())
                .unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::WIELDER) {
            buf.write_u32::<LittleEndian>(self.wielder_id.unwrap())
                .unwrap();
        }
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectDeleteData {
    pub guid: u32,
}

impl MessageUnpack for ObjectDeleteData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(ObjectDeleteData { guid })
    }
}

impl MessagePack for ObjectDeleteData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.guid.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdatePropertyIntData {
    pub sequence: u8,
    pub guid: u32,
    pub property: u32,
    pub value: i32,
    pub is_public: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdatePropertyInt64Data {
    pub sequence: u8,
    pub guid: u32,
    pub property: u32,
    pub value: i64,
    pub is_public: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdatePropertyBoolData {
    pub sequence: u8,
    pub guid: u32,
    pub property: u32,
    pub value: bool,
    pub is_public: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdatePropertyFloatData {
    pub sequence: u8,
    pub guid: u32,
    pub property: u32,
    pub value: f64,
    pub is_public: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdatePropertyStringData {
    pub sequence: u8,
    pub guid: u32,
    pub property: u32,
    pub value: String,
    pub is_public: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdatePropertyDataIdData {
    pub sequence: u8,
    pub guid: u32,
    pub property: u32,
    pub value: u32,
    pub is_public: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdatePropertyInstanceIdData {
    pub sequence: u8,
    pub guid: u32,
    pub property: u32,
    pub value: u32,
    pub is_public: bool,
}

impl UpdatePropertyIntData {
    pub fn unpack(data: &[u8], offset: &mut usize, is_public: bool) -> Option<Self> {
        if *offset >= data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;

        let guid = if is_public {
            if *offset + 4 > data.len() {
                return None;
            }
            let g = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            g
        } else {
            0
        };

        if *offset + 8 > data.len() {
            return None;
        }
        let property = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let value = LittleEndian::read_i32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(UpdatePropertyIntData {
            sequence,
            guid,
            property,
            value,
            is_public,
        })
    }
}

impl MessagePack for UpdatePropertyIntData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        if self.is_public {
            buf.write_u32::<LittleEndian>(self.guid).unwrap();
        }
        buf.write_u32::<LittleEndian>(self.property).unwrap();
        buf.write_i32::<LittleEndian>(self.value).unwrap();
    }
}

impl UpdatePropertyInt64Data {
    pub fn unpack(data: &[u8], offset: &mut usize, is_public: bool) -> Option<Self> {
        if *offset >= data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;

        let guid = if is_public {
            if *offset + 4 > data.len() {
                return None;
            }
            let g = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            g
        } else {
            0
        };

        if *offset + 12 > data.len() {
            return None;
        }
        let property = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let value = LittleEndian::read_i64(&data[*offset..*offset + 8]);
        *offset += 8;
        Some(UpdatePropertyInt64Data {
            sequence,
            guid,
            property,
            value,
            is_public,
        })
    }
}

impl MessagePack for UpdatePropertyInt64Data {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        if self.is_public {
            buf.write_u32::<LittleEndian>(self.guid).unwrap();
        }
        buf.write_u32::<LittleEndian>(self.property).unwrap();
        buf.write_i64::<LittleEndian>(self.value).unwrap();
    }
}

impl UpdatePropertyBoolData {
    pub fn unpack(data: &[u8], offset: &mut usize, is_public: bool) -> Option<Self> {
        if *offset >= data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;

        let guid = if is_public {
            if *offset + 4 > data.len() {
                return None;
            }
            let g = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            g
        } else {
            0
        };

        if *offset + 8 > data.len() {
            return None;
        }
        let property = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let value = LittleEndian::read_u32(&data[*offset..*offset + 4]) != 0;
        *offset += 4;
        Some(UpdatePropertyBoolData {
            sequence,
            guid,
            property,
            value,
            is_public,
        })
    }
}

impl MessagePack for UpdatePropertyBoolData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        if self.is_public {
            buf.write_u32::<LittleEndian>(self.guid).unwrap();
        }
        buf.write_u32::<LittleEndian>(self.property).unwrap();
        buf.write_u32::<LittleEndian>(if self.value { 1 } else { 0 })
            .unwrap();
    }
}

impl UpdatePropertyFloatData {
    pub fn unpack(data: &[u8], offset: &mut usize, is_public: bool) -> Option<Self> {
        if *offset >= data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;

        let guid = if is_public {
            if *offset + 4 > data.len() {
                return None;
            }
            let g = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            g
        } else {
            0
        };

        if *offset + 12 > data.len() {
            return None;
        }
        let property = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let value = LittleEndian::read_f64(&data[*offset..*offset + 8]);
        *offset += 8;
        Some(UpdatePropertyFloatData {
            sequence,
            guid,
            property,
            value,
            is_public,
        })
    }
}

impl MessagePack for UpdatePropertyFloatData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        if self.is_public {
            buf.write_u32::<LittleEndian>(self.guid).unwrap();
        }
        buf.write_u32::<LittleEndian>(self.property).unwrap();
        buf.write_f64::<LittleEndian>(self.value).unwrap();
    }
}

impl UpdatePropertyStringData {
    pub fn unpack(data: &[u8], offset: &mut usize, is_public: bool) -> Option<Self> {
        if *offset >= data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;

        if *offset + 4 > data.len() {
            return None;
        }
        let property = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        let guid = if is_public {
            if *offset + 4 > data.len() {
                return None;
            }
            let g = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            g
        } else {
            0
        };

        // Align before reading string
        if !(*offset).is_multiple_of(4) {
            *offset = (*offset + 4) & !3;
        }

        let value = read_string16(data, offset)?;
        Some(UpdatePropertyStringData {
            sequence,
            guid,
            property,
            value,
            is_public,
        })
    }
}

impl MessagePack for UpdatePropertyStringData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        buf.write_u32::<LittleEndian>(self.property).unwrap();
        if self.is_public {
            buf.write_u32::<LittleEndian>(self.guid).unwrap();
        }

        // Align before string
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }

        write_string16(buf, &self.value);
    }
}

impl UpdatePropertyDataIdData {
    pub fn unpack(data: &[u8], offset: &mut usize, is_public: bool) -> Option<Self> {
        if *offset >= data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;

        let guid = if is_public {
            if *offset + 4 > data.len() {
                return None;
            }
            let g = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            g
        } else {
            0
        };

        if *offset + 8 > data.len() {
            return None;
        }
        let property = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let value = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(UpdatePropertyDataIdData {
            sequence,
            guid,
            property,
            value,
            is_public,
        })
    }
}

impl MessagePack for UpdatePropertyDataIdData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        if self.is_public {
            buf.write_u32::<LittleEndian>(self.guid).unwrap();
        }
        buf.write_u32::<LittleEndian>(self.property).unwrap();
        buf.write_u32::<LittleEndian>(self.value).unwrap();
    }
}

impl UpdatePropertyInstanceIdData {
    pub fn unpack(data: &[u8], offset: &mut usize, is_public: bool) -> Option<Self> {
        if *offset >= data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;

        let guid = if is_public {
            if *offset + 4 > data.len() {
                return None;
            }
            let g = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            g
        } else {
            0
        };

        if *offset + 8 > data.len() {
            return None;
        }
        let property = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let value = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(UpdatePropertyInstanceIdData {
            sequence,
            guid,
            property,
            value,
            is_public,
        })
    }
}

impl MessagePack for UpdatePropertyInstanceIdData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        if self.is_public {
            buf.write_u32::<LittleEndian>(self.guid).unwrap();
        }
        buf.write_u32::<LittleEndian>(self.property).unwrap();
        buf.write_u32::<LittleEndian>(self.value).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateHealthData {
    pub target: u32,
    pub health: f32,
}

impl MessageUnpack for UpdateHealthData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let target = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let health = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(UpdateHealthData { target, health })
    }
}

impl MessagePack for UpdateHealthData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.target.to_le_bytes());
        buf.extend_from_slice(&self.health.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParentEventData {
    pub child_guid: u32,
    pub parent_guid: u32,
    pub location: u32,
}

impl MessageUnpack for ParentEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let child_guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let parent_guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let location = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(ParentEventData {
            child_guid,
            parent_guid,
            location,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PickupEventData {
    pub guid: u32,
    pub success: bool,
}

impl MessageUnpack for PickupEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let success = LittleEndian::read_u32(&data[*offset..*offset + 4]) != 0;
        *offset += 4;
        Some(PickupEventData { guid, success })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SetStateData {
    pub guid: u32,
    pub state: u32,
}

impl MessageUnpack for SetStateData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let state = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(SetStateData { guid, state })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;

    #[test]
    fn test_object_create_unpack_minimal() {
        let data = fixtures::OBJECT_CREATE_MINIMAL;
        let mut offset = 0;
        let msg = ObjectCreateData::unpack(data, &mut offset).unwrap();

        assert_eq!(msg.guid, 0x50000001);
        assert_eq!(msg.model_header, 1);
        assert_eq!(msg.name, Some("Buddy".to_string()));
        assert_eq!(msg.wcid, 123);
        assert_eq!(msg.icon_id, 0x06000000);
        assert_eq!(msg.item_type, 1);
        assert_eq!(msg.sequences, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(offset, data.len());
    }

    #[test]
    fn test_object_create_pack_minimal() {
        let mut sequences = [0u16; 9];
        for (i, seq) in sequences.iter_mut().enumerate() {
            *seq = i as u16;
        }

        let msg = ObjectCreateData {
            guid: 0x50000001,
            model_header: 1,
            physics_flags: PhysicsDescriptionFlag::POSITION | PhysicsDescriptionFlag::TIMESTAMPS,
            physics_state: 0,
            pos: Some(WorldPosition {
                landblock_id: 0x12340001,
                coords: crate::math::Vector3::new(100.0, 200.0, 300.0),
                rotation: crate::math::Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            }),
            parent_id: None,
            parent_loc: None,
            obj_scale: None,
            sequences,
            weenie_flags: WeenieHeaderFlag::empty(),
            name: Some("Buddy".to_string()),
            wcid: 123,
            icon_id: 0x06000000,
            item_type: 1,
            obj_desc_flags: ObjectDescriptionFlag::empty(),
            container_id: None,
            wielder_id: None,
        };

        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(packed, fixtures::OBJECT_CREATE_MINIMAL);
    }

    #[test]
    fn test_object_create_unpack_complex() {
        let data = fixtures::OBJECT_CREATE_COMPLEX;
        let mut offset = 0;
        let msg = ObjectCreateData::unpack(data, &mut offset).unwrap();

        assert_eq!(msg.guid, 0x50000002);
        assert_eq!(msg.name, Some("Fancy Buddy".to_string()));
        assert_eq!(msg.wcid, 456);
        assert_eq!(msg.icon_id, 0x0600000A);
        assert_eq!(msg.parent_id, Some(0x50000001));
        assert_eq!(msg.container_id, Some(0x50001001));
        assert_eq!(msg.wielder_id, Some(0x50001002));
        assert_eq!(msg.sequences, [100, 101, 102, 103, 104, 105, 106, 107, 108]);
        assert_eq!(offset, data.len());
    }

    #[test]
    fn test_object_create_pack_complex() {
        let mut sequences = [0u16; 9];
        for (i, seq) in sequences.iter_mut().enumerate() {
            *seq = (100 + i) as u16;
        }

        let msg = ObjectCreateData {
            guid: 0x50000002,
            model_header: 0x11,
            physics_flags: PhysicsDescriptionFlag::POSITION
                | PhysicsDescriptionFlag::PARENT
                | PhysicsDescriptionFlag::OBJSCALE
                | PhysicsDescriptionFlag::TIMESTAMPS,
            physics_state: 0,
            pos: Some(WorldPosition {
                landblock_id: 0x12340001,
                coords: crate::math::Vector3::new(10.0, 20.0, 30.0),
                rotation: crate::math::Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            }),
            parent_id: Some(0x50000001),
            parent_loc: Some(1),
            obj_scale: Some(1.5),
            sequences,
            weenie_flags: WeenieHeaderFlag::CONTAINER | WeenieHeaderFlag::WIELDER,
            name: Some("Fancy Buddy".to_string()),
            wcid: 456,
            icon_id: 0x0600000A,
            item_type: 2,
            obj_desc_flags: ObjectDescriptionFlag::INCLUDES_SECOND_HEADER,
            container_id: Some(0x50001001),
            wielder_id: Some(0x50001002),
        };

        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(packed, fixtures::OBJECT_CREATE_COMPLEX);
    }
    #[test]
    fn test_update_property_int_unpack_private() {
        let hex = "0C1900000032000000";
        let data = hex::decode(hex).unwrap();
        let mut offset = 0;
        let msg = UpdatePropertyIntData::unpack(&data, &mut offset, false).unwrap();
        assert_eq!(msg.sequence, 0x0C);
        assert_eq!(msg.property, 25);
        assert_eq!(msg.value, 50);
        assert!(!msg.is_public);
    }

    #[test]
    fn test_update_property_int_pack_private() {
        let hex = "0C1900000032000000";
        let msg = UpdatePropertyIntData {
            sequence: 0x0C,
            guid: 0,
            property: 25,
            value: 50,
            is_public: false,
        };
        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(hex::encode(&packed), hex.to_lowercase());
    }

    #[test]
    fn test_update_property_int_unpack_public() {
        let hex = "42785634121900000032000000";
        let data = hex::decode(hex).unwrap();
        let mut offset = 0;
        let msg = UpdatePropertyIntData::unpack(&data, &mut offset, true).unwrap();
        assert_eq!(msg.sequence, 0x42);
        assert_eq!(msg.guid, 0x12345678);
        assert_eq!(msg.property, 25);
        assert_eq!(msg.value, 50);
        assert!(msg.is_public);
    }

    #[test]
    fn test_update_property_int_pack_public() {
        let hex = "42785634121900000032000000";
        let msg = UpdatePropertyIntData {
            sequence: 0x42,
            guid: 0x12345678,
            property: 25,
            value: 50,
            is_public: true,
        };
        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(hex::encode(&packed), hex.to_lowercase());
    }

    #[test]
    fn test_update_property_float_unpack() {
        let hex = "D30200000C190000000000000000005940";
        let data = hex::decode(hex).unwrap();
        let mut offset = 4; // Skip opcode
        let msg = UpdatePropertyFloatData::unpack(&data, &mut offset, false).unwrap();
        assert_eq!(msg.sequence, 0x0C);
        assert_eq!(msg.property, 25);
        assert_eq!(msg.value, 100.0);
    }

    #[test]
    fn test_update_property_float_pack() {
        let hex = "0C190000000000000000005940"; // Payload only
        let msg = UpdatePropertyFloatData {
            sequence: 0x0C,
            guid: 0,
            property: 25,
            value: 100.0,
            is_public: false,
        };
        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(hex::encode(&packed), hex.to_lowercase());
    }

    #[test]
    fn test_update_property_string_unpack() {
        let hex = "01010000000000000500416C69636500";
        let data = hex::decode(hex).unwrap();
        let mut offset = 0;
        let msg = UpdatePropertyStringData::unpack(&data, &mut offset, false).unwrap();
        assert_eq!(msg.sequence, 1);
        assert_eq!(msg.property, 1);
        assert_eq!(msg.value, "Alice");
    }

    #[test]
    fn test_update_property_string_pack() {
        let hex = "01010000000000000500416C69636500";
        let msg = UpdatePropertyStringData {
            sequence: 1,
            guid: 0,
            property: 1,
            value: "Alice".to_string(),
            is_public: false,
        };
        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(hex::encode(&packed), hex.to_lowercase());
    }

    #[test]
    fn test_update_health_unpack() {
        let hex = "010000500000003f";
        let data = hex::decode(hex).unwrap();
        let mut offset = 0;
        let msg = UpdateHealthData::unpack(&data, &mut offset).unwrap();
        assert_eq!(msg.target, 0x50000001);
        assert_eq!(msg.health, 0.5);
    }

    #[test]
    fn test_update_health_pack() {
        let hex = "010000500000003f";
        let msg = UpdateHealthData {
            target: 0x50000001,
            health: 0.5,
        };
        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(hex::encode(packed), hex);
    }

    #[test]
    fn test_object_delete_unpack() {
        let hex = "01000050";
        let data = hex::decode(hex).unwrap();
        let mut offset = 0;
        let msg = ObjectDeleteData::unpack(&data, &mut offset).unwrap();
        assert_eq!(msg.guid, 0x50000001);
    }

    #[test]
    fn test_object_delete_pack() {
        let hex = "01000050";
        let msg = ObjectDeleteData { guid: 0x50000001 };
        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(hex::encode(packed), hex);
    }
}
