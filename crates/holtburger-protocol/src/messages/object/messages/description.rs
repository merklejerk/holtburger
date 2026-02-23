use crate::messages::object::types::*;
use crate::messages::utils::{
    align_to_4, pad_to_4, read_packed_data_id, read_packed_wclass_id, read_string16,
    write_packed_data_id, write_packed_wclass_id, write_string16,
};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    ObjectDescriptionFlag, PhysicsDescriptionFlag, PhysicsState, PropertyDataId, PropertyFloat,
    PropertyInstanceId, PropertyInt, PropertyString, WeenieHeaderFlag, WeenieHeaderFlag2,
};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::{Guid, Vector3};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub struct PhysicsChildData {
    pub guid: Guid,
    pub location_id: u32,
}

/// Mask for the high word of the house restrictions version.
/// If the high word is not zero, it indicates a versioned message.
const VERSION_HI_WORD_MASK: u32 = 0xFFFF0000;

#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct HouseRestrictionsData {
    pub version: u32,
    pub bitmask: Option<u32>,
    pub monarch_id: Option<Guid>,
    pub open_house: Option<bool>,
    pub bucket_count: u32,
    pub entries: Vec<(u32, u32)>,
}

impl ProtocolUnpack for HouseRestrictionsData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let version = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        let mut bitmask = None;
        let mut monarch_id = None;
        let mut open_house = None;
        let mut bucket_count = 0;
        let mut entries = Vec::new();

        if (version & VERSION_HI_WORD_MASK) != 0 {
            if version >= 0x10000002 {
                if *offset + 12 > data.len() {
                    return None;
                }
                bitmask = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
                *offset += 4;
                monarch_id = Some(Guid(LittleEndian::read_u32(&data[*offset..*offset + 4])));
                *offset += 4;

                let packed = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                let entry_count = packed & 0x00FFFFFF;

                if *offset + (entry_count as usize * 8) > data.len() {
                    return None;
                }
                for _ in 0..entry_count {
                    let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                    *offset += 4;
                    let val = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                    *offset += 4;
                    entries.push((key, val));
                }
            } else {
                if *offset + 12 > data.len() {
                    return None;
                }
                bitmask = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
                *offset += 4;
                monarch_id = Some(Guid(LittleEndian::read_u32(&data[*offset..*offset + 4])));
                *offset += 4;

                let packed = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                let hi_byte = (packed >> 24) & 0xFF;
                let entry_count = packed & 0x00FFFFFF;

                if hi_byte > 0 {
                    bucket_count = 1 << (hi_byte - 1);
                }

                if *offset + (entry_count as usize * 8) > data.len() {
                    return None;
                }
                for _ in 0..entry_count {
                    let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                    *offset += 4;
                    let val = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                    *offset += 4;
                    entries.push((key, val));
                }
            }
        } else {
            if version != 0 {
                open_house = Some(version == 1);
            } else {
                open_house = Some(false);
            }

            if *offset + 4 > data.len() {
                return None;
            }
            let packed = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            let hi_byte = (packed >> 24) & 0xFF;
            let entry_count = packed & 0x00FFFFFF;

            if hi_byte > 0 {
                bucket_count = 1 << (hi_byte - 1);
            }

            if *offset + (entry_count as usize * 8) > data.len() {
                return None;
            }
            for _ in 0..entry_count {
                let key = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                let val = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                entries.push((key, val));
            }
        }

        Some(HouseRestrictionsData {
            version,
            bitmask,
            monarch_id,
            open_house,
            bucket_count,
            entries,
        })
    }
}

impl ProtocolPack for HouseRestrictionsData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.version).unwrap();

        if (self.version & VERSION_HI_WORD_MASK) != 0 {
            buf.write_u32::<LittleEndian>(self.bitmask.unwrap_or(0))
                .unwrap();
            self.monarch_id.unwrap_or(Guid::NULL).pack(buf);

            if self.version >= 0x10000002 {
                let packed = self.entries.len() as u32 & 0x00FFFFFF;
                buf.write_u32::<LittleEndian>(packed).unwrap();
            } else {
                let hi_byte = if self.bucket_count > 0 {
                    (self.bucket_count.trailing_zeros() + 1) << 24
                } else {
                    0
                };
                let packed = hi_byte | (self.entries.len() as u32 & 0x00FFFFFF);
                buf.write_u32::<LittleEndian>(packed).unwrap();
            }
        } else {
            let hi_byte = if self.bucket_count > 0 {
                (self.bucket_count.trailing_zeros() + 1) << 24
            } else {
                0
            };
            let packed = hi_byte | (self.entries.len() as u32 & 0x00FFFFFF);
            buf.write_u32::<LittleEndian>(packed).unwrap();
        }

        for (key, val) in &self.entries {
            buf.write_u32::<LittleEndian>(*key).unwrap();
            buf.write_u32::<LittleEndian>(*val).unwrap();
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PublicWeenieDescription {
    pub guid: Guid,
    pub weenie_flags: WeenieHeaderFlag,
    pub name: Option<String>,
    pub wcid: u32,
    pub icon_id: u32,
    pub item_type: u32,
    pub obj_desc_flags: ObjectDescriptionFlag,
    pub weenie_flags2: WeenieHeaderFlag2,
    pub house_restrictions: Option<HouseRestrictionsData>,

    pub int_properties: BTreeMap<u32, i32>,
    pub int64_properties: BTreeMap<u32, i64>,
    pub bool_properties: BTreeMap<u32, bool>,
    pub float_properties: BTreeMap<u32, f64>,
    pub string_properties: BTreeMap<u32, String>,
    pub did_properties: BTreeMap<u32, Guid>,
    pub iid_properties: BTreeMap<u32, Guid>,
}

impl ProtocolUnpack for PublicWeenieDescription {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        Self::unpack_fields(data, offset, guid)
    }
}

impl ProtocolPack for PublicWeenieDescription {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        self.pack_fields(buf);
    }
}

impl PublicWeenieDescription {
    pub fn value(&self) -> u32 {
        self.int_properties
            .get(&(PropertyInt::Value as u32))
            .unwrap_or(&0)
            .to_owned() as u32
    }

    pub fn items_capacity(&self) -> Option<u32> {
        self.int_properties
            .get(&(PropertyInt::ItemsCapacity as u32))
            .map(|v| *v as u32)
    }

    pub fn plural_name(&self) -> Option<&str> {
        self.string_properties
            .get(&(PropertyString::PluralName as u32))
            .map(|s| s.as_str())
    }

    pub fn unpack_fields(data: &[u8], offset: &mut usize, guid: Guid) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let weenie_flags_bits = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let weenie_flags = WeenieHeaderFlag::from_bits_retain(weenie_flags_bits);
        *offset += 4;

        let name = read_string16(data, offset);
        let wcid = read_packed_wclass_id(data, offset);
        let icon_id = read_packed_data_id(data, offset, 0x06000000);
        if *offset + 8 > data.len() {
            return None;
        }
        let item_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let obj_desc_flags_bits = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let obj_desc_flags = ObjectDescriptionFlag::from_bits_retain(obj_desc_flags_bits);
        *offset += 8;
        *offset = align_to_4(*offset);

        let mut weenie_flags2 = WeenieHeaderFlag2::empty();
        if obj_desc_flags.contains(ObjectDescriptionFlag::INCLUDES_SECOND_HEADER) {
            if *offset + 4 > data.len() {
                return None;
            }
            weenie_flags2 = WeenieHeaderFlag2::from_bits_retain(LittleEndian::read_u32(
                &data[*offset..*offset + 4],
            ));
            *offset += 4;
        }

        let mut int_properties = BTreeMap::new();
        let int64_properties = BTreeMap::new();
        let bool_properties = BTreeMap::new();
        let mut float_properties = BTreeMap::new();
        let mut string_properties = BTreeMap::new();
        let mut did_properties = BTreeMap::new();
        let mut iid_properties = BTreeMap::new();

        if weenie_flags.contains(WeenieHeaderFlag::PLURAL_NAME)
            && let Some(val) = read_string16(data, offset)
        {
            string_properties.insert(PropertyString::PluralName as u32, val);
        }

        if weenie_flags.contains(WeenieHeaderFlag::ITEMS_CAPACITY) {
            if *offset >= data.len() {
                return None;
            }
            int_properties.insert(PropertyInt::ItemsCapacity as u32, data[*offset] as i32);
            *offset += 1;
        }

        if weenie_flags.contains(WeenieHeaderFlag::CONTAINERS_CAPACITY) {
            if *offset >= data.len() {
                return None;
            }
            int_properties.insert(PropertyInt::ContainersCapacity as u32, data[*offset] as i32);
            *offset += 1;
        }

        if weenie_flags.contains(WeenieHeaderFlag::AMMO_TYPE) {
            if *offset + 2 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::AmmoType as u32,
                LittleEndian::read_u16(&data[*offset..*offset + 2]) as i32,
            );
            *offset += 2;
        }

        if weenie_flags.contains(WeenieHeaderFlag::VALUE) {
            if *offset + 4 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::Value as u32,
                LittleEndian::read_u32(&data[*offset..*offset + 4]) as i32,
            );
            *offset += 4;
        }

        if weenie_flags.contains(WeenieHeaderFlag::USABLE) {
            if *offset + 4 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::ItemUseable as u32,
                LittleEndian::read_u32(&data[*offset..*offset + 4]) as i32,
            );
            *offset += 4;
        }

        if weenie_flags.contains(WeenieHeaderFlag::USE_RADIUS) {
            if *offset + 4 > data.len() {
                return None;
            }
            float_properties.insert(
                PropertyFloat::UseRadius as u32,
                LittleEndian::read_f32(&data[*offset..*offset + 4]) as f64,
            );
            *offset += 4;
        }

        if weenie_flags.contains(WeenieHeaderFlag::TARGET_TYPE) {
            if *offset + 4 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::TargetType as u32,
                LittleEndian::read_u32(&data[*offset..*offset + 4]) as i32,
            );
            *offset += 4;
        }

        if weenie_flags.contains(WeenieHeaderFlag::UI_EFFECTS) {
            if *offset + 4 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::UiEffects as u32,
                LittleEndian::read_u32(&data[*offset..*offset + 4]) as i32,
            );
            *offset += 4;
        }

        if weenie_flags.contains(WeenieHeaderFlag::COMBAT_USE) {
            if *offset >= data.len() {
                return None;
            }
            int_properties.insert(PropertyInt::CombatUse as u32, data[*offset] as i32);
            *offset += 1;
        }

        if weenie_flags.contains(WeenieHeaderFlag::STRUCTURE) {
            if *offset + 2 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::Structure as u32,
                LittleEndian::read_u16(&data[*offset..*offset + 2]) as i32,
            );
            *offset += 2;
        }

        if weenie_flags.contains(WeenieHeaderFlag::MAX_STRUCTURE) {
            if *offset + 2 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::MaxStructure as u32,
                LittleEndian::read_u16(&data[*offset..*offset + 2]) as i32,
            );
            *offset += 2;
        }

        if weenie_flags.contains(WeenieHeaderFlag::STACK_SIZE) {
            if *offset + 2 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::StackSize as u32,
                LittleEndian::read_u16(&data[*offset..*offset + 2]) as i32,
            );
            *offset += 2;
        }

        if weenie_flags.contains(WeenieHeaderFlag::MAX_STACK_SIZE) {
            if *offset + 2 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::MaxStackSize as u32,
                LittleEndian::read_u16(&data[*offset..*offset + 2]) as i32,
            );
            *offset += 2;
        }

        if weenie_flags.contains(WeenieHeaderFlag::CONTAINER) {
            iid_properties.insert(
                PropertyInstanceId::Container as u32,
                Guid::unpack(data, offset)?,
            );
        }
        if weenie_flags.contains(WeenieHeaderFlag::WIELDER) {
            iid_properties.insert(
                PropertyInstanceId::Wielder as u32,
                Guid::unpack(data, offset)?,
            );
        }
        if weenie_flags.contains(WeenieHeaderFlag::VALID_LOCATIONS) {
            if *offset + 4 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::ValidLocations as u32,
                LittleEndian::read_u32(&data[*offset..*offset + 4]) as i32,
            );
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::CURRENTLY_WIELDED_LOCATION) {
            if *offset + 4 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::CurrentWieldedLocation as u32,
                LittleEndian::read_u32(&data[*offset..*offset + 4]) as i32,
            );
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::PRIORITY) {
            if *offset + 4 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::ClothingPriority as u32,
                LittleEndian::read_u32(&data[*offset..*offset + 4]) as i32,
            );
            *offset += 4;
        }

        if weenie_flags.contains(WeenieHeaderFlag::RADAR_BLIP_COLOR) {
            if *offset >= data.len() {
                return None;
            }
            int_properties.insert(PropertyInt::RadarBlipColor as u32, data[*offset] as i32);
            *offset += 1;
        }

        if weenie_flags.contains(WeenieHeaderFlag::RADAR_BEHAVIOR) {
            if *offset >= data.len() {
                return None;
            }
            int_properties.insert(PropertyInt::ShowableOnRadar as u32, data[*offset] as i32);
            *offset += 1;
        }

        if weenie_flags.contains(WeenieHeaderFlag::PSCRIPT) {
            if *offset + 2 > data.len() {
                return None;
            }
            did_properties.insert(
                PropertyDataId::PhysicsScript as u32,
                Guid(LittleEndian::read_u16(&data[*offset..*offset + 2]) as u32),
            );
            *offset += 2;
        }

        if weenie_flags.contains(WeenieHeaderFlag::WORKMANSHIP) {
            if *offset + 4 > data.len() {
                return None;
            }
            let val = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            int_properties.insert(PropertyInt::ItemWorkmanship as u32, val.round() as i32);
            *offset += 4;
        }

        if weenie_flags.contains(WeenieHeaderFlag::BURDEN) {
            if *offset + 2 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::EncumbranceVal as u32,
                LittleEndian::read_u16(&data[*offset..*offset + 2]) as i32,
            );
            *offset += 2;
        }

        if weenie_flags.contains(WeenieHeaderFlag::SPELL) {
            if *offset + 2 > data.len() {
                return None;
            }
            did_properties.insert(
                PropertyDataId::Spell as u32,
                Guid(LittleEndian::read_u16(&data[*offset..*offset + 2]) as u32),
            );
            *offset += 2;
        }

        if weenie_flags.contains(WeenieHeaderFlag::HOUSE_OWNER) {
            if *offset + 4 > data.len() {
                return None;
            }
            iid_properties.insert(
                PropertyInstanceId::HouseOwner as u32,
                Guid(LittleEndian::read_u32(&data[*offset..*offset + 4])),
            );
            *offset += 4;
        }

        let mut house_restrictions = None;
        if weenie_flags.contains(WeenieHeaderFlag::HOUSE_RESTRICTIONS) {
            house_restrictions = Some(HouseRestrictionsData::unpack(data, offset)?);
        }

        if weenie_flags.contains(WeenieHeaderFlag::HOOK_ITEM_TYPES) {
            if *offset + 4 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::HookItemType as u32,
                LittleEndian::read_u32(&data[*offset..*offset + 4]) as i32,
            );
            *offset += 4;
        }

        if weenie_flags.contains(WeenieHeaderFlag::MONARCH) {
            if *offset + 4 > data.len() {
                return None;
            }
            iid_properties.insert(
                PropertyInstanceId::Monarch as u32,
                Guid(LittleEndian::read_u32(&data[*offset..*offset + 4])),
            );
            *offset += 4;
        }

        if weenie_flags.contains(WeenieHeaderFlag::HOOK_TYPE) {
            if *offset + 2 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::HookType as u32,
                LittleEndian::read_u16(&data[*offset..*offset + 2]) as i32,
            );
            *offset += 2;
        }

        if weenie_flags.contains(WeenieHeaderFlag::ICON_OVERLAY) {
            did_properties.insert(
                PropertyDataId::IconOverlay as u32,
                Guid(read_packed_data_id(data, offset, 0x06000000)),
            );
        }

        if weenie_flags2.contains(WeenieHeaderFlag2::ICON_UNDERLAY) {
            did_properties.insert(
                PropertyDataId::IconUnderlay as u32,
                Guid(read_packed_data_id(data, offset, 0x06000000)),
            );
        }

        if weenie_flags.contains(WeenieHeaderFlag::MATERIAL_TYPE) {
            if *offset + 4 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::MaterialType as u32,
                LittleEndian::read_u32(&data[*offset..*offset + 4]) as i32,
            );
            *offset += 4;
        }

        if weenie_flags2.contains(WeenieHeaderFlag2::COOLDOWN) {
            if *offset + 4 > data.len() {
                return None;
            }
            int_properties.insert(
                PropertyInt::SharedCooldown as u32,
                LittleEndian::read_u32(&data[*offset..*offset + 4]) as i32,
            );
            *offset += 4;
        }

        if weenie_flags2.contains(WeenieHeaderFlag2::COOLDOWN_DURATION) {
            if *offset + 8 > data.len() {
                return None;
            }
            float_properties.insert(
                PropertyFloat::CooldownDuration as u32,
                LittleEndian::read_f64(&data[*offset..*offset + 8]),
            );
            *offset += 8;
        }

        if weenie_flags2.contains(WeenieHeaderFlag2::PET_OWNER) {
            if *offset + 4 > data.len() {
                return None;
            }
            iid_properties.insert(
                PropertyInstanceId::PetOwner as u32,
                Guid(LittleEndian::read_u32(&data[*offset..*offset + 4])),
            );
            *offset += 4;
        }

        *offset = align_to_4(*offset);

        Some(PublicWeenieDescription {
            guid,
            weenie_flags,
            name,
            wcid,
            icon_id,
            item_type,
            obj_desc_flags,
            weenie_flags2,
            house_restrictions,
            int_properties,
            int64_properties,
            bool_properties,
            float_properties,
            string_properties,
            did_properties,
            iid_properties,
        })
    }

    pub fn pack_fields(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.weenie_flags.bits())
            .unwrap();
        write_string16(buf, self.name.as_deref().unwrap_or(""));
        write_packed_wclass_id(buf, self.wcid);
        write_packed_data_id(buf, self.icon_id, 0x06000000);
        buf.write_u32::<LittleEndian>(self.item_type).unwrap();
        buf.write_u32::<LittleEndian>(self.obj_desc_flags.bits())
            .unwrap();
        pad_to_4(buf);

        if self
            .obj_desc_flags
            .contains(ObjectDescriptionFlag::INCLUDES_SECOND_HEADER)
        {
            buf.write_u32::<LittleEndian>(self.weenie_flags2.bits())
                .unwrap();
        }

        if self.weenie_flags.contains(WeenieHeaderFlag::PLURAL_NAME) {
            let val = self
                .string_properties
                .get(&(PropertyString::PluralName as u32))
                .map(|s| s.as_str())
                .unwrap_or("");
            write_string16(buf, val);
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::ITEMS_CAPACITY) {
            let val = self
                .int_properties
                .get(&(PropertyInt::ItemsCapacity as u32))
                .copied()
                .unwrap_or(0);
            buf.write_i8(val as i8).unwrap();
        }
        if self
            .weenie_flags
            .contains(WeenieHeaderFlag::CONTAINERS_CAPACITY)
        {
            let val = self
                .int_properties
                .get(&(PropertyInt::ContainersCapacity as u32))
                .copied()
                .unwrap_or(0);
            buf.write_i8(val as i8).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::AMMO_TYPE) {
            let val = self
                .int_properties
                .get(&(PropertyInt::AmmoType as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u16::<LittleEndian>(val as u16).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::VALUE) {
            let val = self
                .int_properties
                .get(&(PropertyInt::Value as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u32::<LittleEndian>(val as u32).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::USABLE) {
            let val = self
                .int_properties
                .get(&(PropertyInt::ItemUseable as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u32::<LittleEndian>(val as u32).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::USE_RADIUS) {
            let val = self
                .float_properties
                .get(&(PropertyFloat::UseRadius as u32))
                .copied()
                .unwrap_or(0.0);
            buf.write_f32::<LittleEndian>(val as f32).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::TARGET_TYPE) {
            let val = self
                .int_properties
                .get(&(PropertyInt::TargetType as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u32::<LittleEndian>(val as u32).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::UI_EFFECTS) {
            let val = self
                .int_properties
                .get(&(PropertyInt::UiEffects as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u32::<LittleEndian>(val as u32).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::COMBAT_USE) {
            let val = self
                .int_properties
                .get(&(PropertyInt::CombatUse as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u8(val as u8).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::STRUCTURE) {
            let val = self
                .int_properties
                .get(&(PropertyInt::Structure as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u16::<LittleEndian>(val as u16).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::MAX_STRUCTURE) {
            let val = self
                .int_properties
                .get(&(PropertyInt::MaxStructure as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u16::<LittleEndian>(val as u16).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::STACK_SIZE) {
            let val = self
                .int_properties
                .get(&(PropertyInt::StackSize as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u16::<LittleEndian>(val as u16).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::MAX_STACK_SIZE) {
            let val = self
                .int_properties
                .get(&(PropertyInt::MaxStackSize as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u16::<LittleEndian>(val as u16).unwrap();
        }

        if self.weenie_flags.contains(WeenieHeaderFlag::CONTAINER) {
            self.iid_properties
                .get(&(PropertyInstanceId::Container as u32))
                .unwrap_or(&Guid::NULL)
                .pack(buf);
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::WIELDER) {
            self.iid_properties
                .get(&(PropertyInstanceId::Wielder as u32))
                .unwrap_or(&Guid::NULL)
                .pack(buf);
        }
        if self
            .weenie_flags
            .contains(WeenieHeaderFlag::VALID_LOCATIONS)
        {
            let val = self
                .int_properties
                .get(&(PropertyInt::ValidLocations as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u32::<LittleEndian>(val as u32).unwrap();
        }
        if self
            .weenie_flags
            .contains(WeenieHeaderFlag::CURRENTLY_WIELDED_LOCATION)
        {
            let val = self
                .int_properties
                .get(&(PropertyInt::CurrentWieldedLocation as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u32::<LittleEndian>(val as u32).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::PRIORITY) {
            let val = self
                .int_properties
                .get(&(PropertyInt::ClothingPriority as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u32::<LittleEndian>(val as u32).unwrap();
        }
        if self
            .weenie_flags
            .contains(WeenieHeaderFlag::RADAR_BLIP_COLOR)
        {
            let val = self
                .int_properties
                .get(&(PropertyInt::RadarBlipColor as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u8(val as u8).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::RADAR_BEHAVIOR) {
            let val = self
                .int_properties
                .get(&(PropertyInt::ShowableOnRadar as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u8(val as u8).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::PSCRIPT) {
            let val = self
                .did_properties
                .get(&(PropertyDataId::PhysicsScript as u32))
                .map(|g| g.0 as u16)
                .unwrap_or(0);
            buf.write_u16::<LittleEndian>(val).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::WORKMANSHIP) {
            let val = self
                .int_properties
                .get(&(PropertyInt::ItemWorkmanship as u32))
                .copied()
                .unwrap_or(0);
            buf.write_f32::<LittleEndian>(val as f32).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::BURDEN) {
            let val = self
                .int_properties
                .get(&(PropertyInt::EncumbranceVal as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u16::<LittleEndian>(val as u16).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::SPELL) {
            let val = self
                .did_properties
                .get(&(PropertyDataId::Spell as u32))
                .map(|g| g.0 as u16)
                .unwrap_or(0);
            buf.write_u16::<LittleEndian>(val).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::HOUSE_OWNER) {
            self.iid_properties
                .get(&(PropertyInstanceId::HouseOwner as u32))
                .unwrap_or(&Guid::NULL)
                .pack(buf);
        }
        if self
            .weenie_flags
            .contains(WeenieHeaderFlag::HOUSE_RESTRICTIONS)
        {
            if let Some(restrictions) = &self.house_restrictions {
                restrictions.pack(buf);
            } else {
                buf.write_u32::<LittleEndian>(0).unwrap();
                buf.write_u32::<LittleEndian>(0).unwrap();
            }
        }
        if self
            .weenie_flags
            .contains(WeenieHeaderFlag::HOOK_ITEM_TYPES)
        {
            let val = self
                .int_properties
                .get(&(PropertyInt::HookItemType as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u32::<LittleEndian>(val as u32).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::MONARCH) {
            self.iid_properties
                .get(&(PropertyInstanceId::Monarch as u32))
                .unwrap_or(&Guid::NULL)
                .pack(buf);
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::HOOK_TYPE) {
            let val = self
                .int_properties
                .get(&(PropertyInt::HookType as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u16::<LittleEndian>(val as u16).unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::ICON_OVERLAY) {
            let val = self
                .did_properties
                .get(&(PropertyDataId::IconOverlay as u32))
                .map(|g| g.0)
                .unwrap_or(0);
            write_packed_data_id(buf, val, 0x06000000);
        }
        if self
            .weenie_flags2
            .contains(WeenieHeaderFlag2::ICON_UNDERLAY)
        {
            let val = self
                .did_properties
                .get(&(PropertyDataId::IconUnderlay as u32))
                .map(|g| g.0)
                .unwrap_or(0);
            write_packed_data_id(buf, val, 0x06000000);
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::MATERIAL_TYPE) {
            let val = self
                .int_properties
                .get(&(PropertyInt::MaterialType as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u32::<LittleEndian>(val as u32).unwrap();
        }
        if self.weenie_flags2.contains(WeenieHeaderFlag2::COOLDOWN) {
            let val = self
                .int_properties
                .get(&(PropertyInt::SharedCooldown as u32))
                .copied()
                .unwrap_or(0);
            buf.write_u32::<LittleEndian>(val as u32).unwrap();
        }
        if self
            .weenie_flags2
            .contains(WeenieHeaderFlag2::COOLDOWN_DURATION)
        {
            let val = self
                .float_properties
                .get(&(PropertyFloat::CooldownDuration as u32))
                .copied()
                .unwrap_or(0.0);
            buf.write_f64::<LittleEndian>(val).unwrap();
        }
        if self.weenie_flags2.contains(WeenieHeaderFlag2::PET_OWNER) {
            self.iid_properties
                .get(&(PropertyInstanceId::PetOwner as u32))
                .unwrap_or(&Guid::NULL)
                .pack(buf);
        }
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectDescriptionData {
    pub model_data: ModelData,
    pub physics_flags: PhysicsDescriptionFlag,
    pub physics_state: PhysicsState,
    pub movement_data: Option<Vec<u8>>,
    pub autonomous_movement: Option<bool>,
    pub animation_frame: Option<u32>,
    pub pos: Option<WorldPosition>,
    pub mtable_id: Option<u32>,
    pub stable_id: Option<u32>,
    pub petable_id: Option<u32>,
    pub csetup_id: Option<u32>,
    pub parent_id: Option<Guid>,
    pub parent_loc: Option<u32>,
    pub children: Option<Vec<PhysicsChildData>>,
    pub obj_scale: Option<f32>,
    pub friction: Option<f32>,
    pub elasticity: Option<f32>,
    pub translucency: Option<f32>,
    pub velocity: Option<Vector3>,
    pub acceleration: Option<Vector3>,
    pub omega: Option<Vector3>,
    pub default_script_id: Option<u32>,
    pub default_script_intensity: Option<f32>,
    pub sequences: [u16; 9],
    pub public_weenie_desc: PublicWeenieDescription,
}

impl Default for ObjectDescriptionData {
    fn default() -> Self {
        Self {
            model_data: ModelData::default(),
            physics_flags: PhysicsDescriptionFlag::empty(),
            physics_state: PhysicsState::empty(),
            movement_data: None,
            autonomous_movement: None,
            animation_frame: None,
            pos: None,
            mtable_id: None,
            stable_id: None,
            petable_id: None,
            csetup_id: None,
            parent_id: None,
            parent_loc: None,
            children: None,
            obj_scale: None,
            friction: None,
            elasticity: None,
            translucency: None,
            velocity: None,
            acceleration: None,
            omega: None,
            default_script_id: None,
            default_script_intensity: None,
            sequences: [0; 9],
            public_weenie_desc: PublicWeenieDescription::default(),
        }
    }
}

impl ObjectDescriptionData {
    pub fn with_guid(guid: Guid) -> Self {
        let mut obj = Self::default();
        obj.public_weenie_desc.guid = guid;
        obj
    }
}

impl ProtocolUnpack for ObjectDescriptionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        let model_data = ModelData::unpack(data, offset)?;

        if *offset + 8 > data.len() {
            return None;
        }
        let phys_flags_bits = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let physics_flags = PhysicsDescriptionFlag::from_bits_retain(phys_flags_bits);
        *offset += 4;
        let physics_state =
            PhysicsState::from_bits_retain(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        *offset += 4;

        let mut movement_data = None;
        let mut autonomous_movement = None;
        let mut animation_frame = None;

        if physics_flags.contains(PhysicsDescriptionFlag::MOVEMENT) {
            if *offset + 4 > data.len() {
                return None;
            }
            let len = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4;
            if *offset + len > data.len() {
                return None;
            }
            movement_data = Some(data[*offset..*offset + len].to_vec());
            *offset += len;
            if len > 0 {
                if *offset + 4 > data.len() {
                    return None;
                }
                autonomous_movement =
                    Some(LittleEndian::read_u32(&data[*offset..*offset + 4]) != 0);
                *offset += 4;
            }
        } else if physics_flags.contains(PhysicsDescriptionFlag::ANIMATION_FRAME) {
            if *offset + 4 > data.len() {
                return None;
            }
            animation_frame = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        let mut pos = None;
        if physics_flags.contains(PhysicsDescriptionFlag::POSITION) {
            pos = WorldPosition::unpack(data, offset);
        }

        let mut mtable_id = None;
        let mut stable_id = None;
        let mut petable_id = None;
        let mut csetup_id = None;

        if physics_flags.contains(PhysicsDescriptionFlag::MTABLE) {
            if *offset + 4 > data.len() {
                return None;
            }
            mtable_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::STABLE) {
            if *offset + 4 > data.len() {
                return None;
            }
            stable_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::PETABLE) {
            if *offset + 4 > data.len() {
                return None;
            }
            petable_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if physics_flags.contains(PhysicsDescriptionFlag::CSETUP) {
            if *offset + 4 > data.len() {
                return None;
            }
            csetup_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        let mut parent_id = None;
        let mut parent_loc = None;
        if physics_flags.contains(PhysicsDescriptionFlag::PARENT) {
            parent_id = Some(Guid::unpack(data, offset)?);
            if *offset + 4 > data.len() {
                return None;
            }
            parent_loc = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        let mut children = None;
        if physics_flags.contains(PhysicsDescriptionFlag::CHILDREN) {
            if *offset + 4 > data.len() {
                return None;
            }
            let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4;
            if *offset + (count * 8) > data.len() {
                return None;
            }

            let mut parsed_children = Vec::with_capacity(count);
            for _ in 0..count {
                let child_guid = Guid(LittleEndian::read_u32(&data[*offset..*offset + 4]));
                *offset += 4;
                let location_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                parsed_children.push(PhysicsChildData {
                    guid: child_guid,
                    location_id,
                });
            }
            children = Some(parsed_children);
        }

        let mut obj_scale = None;
        if physics_flags.contains(PhysicsDescriptionFlag::OBJSCALE) {
            if *offset + 4 > data.len() {
                return None;
            }
            obj_scale = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        let mut friction = None;
        if physics_flags.contains(PhysicsDescriptionFlag::FRICTION) {
            if *offset + 4 > data.len() {
                return None;
            }
            friction = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        let mut elasticity = None;
        if physics_flags.contains(PhysicsDescriptionFlag::ELASTICITY) {
            if *offset + 4 > data.len() {
                return None;
            }
            elasticity = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        let mut translucency = None;
        if physics_flags.contains(PhysicsDescriptionFlag::TRANSLUCENCY) {
            if *offset + 4 > data.len() {
                return None;
            }
            translucency = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        let mut velocity = None;
        if physics_flags.contains(PhysicsDescriptionFlag::VELOCITY) {
            if *offset + 12 > data.len() {
                return None;
            }
            velocity = Some(Vector3 {
                x: LittleEndian::read_f32(&data[*offset..*offset + 4]),
                y: LittleEndian::read_f32(&data[*offset + 4..*offset + 8]),
                z: LittleEndian::read_f32(&data[*offset + 8..*offset + 12]),
            });
            *offset += 12;
        }

        let mut acceleration = None;
        if physics_flags.contains(PhysicsDescriptionFlag::ACCELERATION) {
            if *offset + 12 > data.len() {
                return None;
            }
            acceleration = Some(Vector3 {
                x: LittleEndian::read_f32(&data[*offset..*offset + 4]),
                y: LittleEndian::read_f32(&data[*offset + 4..*offset + 8]),
                z: LittleEndian::read_f32(&data[*offset + 8..*offset + 12]),
            });
            *offset += 12;
        }

        let mut omega = None;
        if physics_flags.contains(PhysicsDescriptionFlag::OMEGA) {
            if *offset + 12 > data.len() {
                return None;
            }
            omega = Some(Vector3 {
                x: LittleEndian::read_f32(&data[*offset..*offset + 4]),
                y: LittleEndian::read_f32(&data[*offset + 4..*offset + 8]),
                z: LittleEndian::read_f32(&data[*offset + 8..*offset + 12]),
            });
            *offset += 12;
        }

        let mut default_script_id = None;
        if physics_flags.contains(PhysicsDescriptionFlag::DEFAULT_SCRIPT) {
            if *offset + 4 > data.len() {
                return None;
            }
            default_script_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        let mut default_script_intensity = None;
        if physics_flags.contains(PhysicsDescriptionFlag::DEFAULT_SCRIPT_INTENSITY) {
            if *offset + 4 > data.len() {
                return None;
            }
            default_script_intensity = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        if *offset + 18 > data.len() {
            return None;
        }
        let mut sequences = [0u16; 9];
        for seq in &mut sequences {
            *seq = LittleEndian::read_u16(&data[*offset..*offset + 2]);
            *offset += 2;
        }
        *offset = align_to_4(*offset);

        let public_weenie_desc = PublicWeenieDescription::unpack_fields(data, offset, guid)?;

        Some(ObjectDescriptionData {
            model_data,
            physics_flags,
            physics_state,
            movement_data,
            autonomous_movement,
            animation_frame,
            pos,
            mtable_id,
            stable_id,
            petable_id,
            csetup_id,
            parent_id,
            parent_loc,
            children,
            obj_scale,
            friction,
            elasticity,
            translucency,
            velocity,
            acceleration,
            omega,
            default_script_id,
            default_script_intensity,
            sequences,
            public_weenie_desc,
        })
    }
}

impl ProtocolPack for ObjectDescriptionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.public_weenie_desc.guid.pack(buf);
        self.model_data.pack(buf);
        buf.write_u32::<LittleEndian>(self.physics_flags.bits())
            .unwrap();
        buf.write_u32::<LittleEndian>(self.physics_state.bits())
            .unwrap();

        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::MOVEMENT)
        {
            let payload = self.movement_data.as_deref().unwrap_or(&[]);
            buf.write_u32::<LittleEndian>(payload.len() as u32).unwrap();
            buf.extend_from_slice(payload);
            if !payload.is_empty() {
                let autonomous = self.autonomous_movement.unwrap_or(false);
                buf.write_u32::<LittleEndian>(u32::from(autonomous))
                    .unwrap();
            }
        } else if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::ANIMATION_FRAME)
        {
            buf.write_u32::<LittleEndian>(self.animation_frame.unwrap_or(0))
                .unwrap();
        }

        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::POSITION)
        {
            self.pos.as_ref().unwrap().pack(buf);
        }
        if self.physics_flags.contains(PhysicsDescriptionFlag::MTABLE) {
            buf.write_u32::<LittleEndian>(self.mtable_id.unwrap_or(0))
                .unwrap();
        }
        if self.physics_flags.contains(PhysicsDescriptionFlag::STABLE) {
            buf.write_u32::<LittleEndian>(self.stable_id.unwrap_or(0))
                .unwrap();
        }
        if self.physics_flags.contains(PhysicsDescriptionFlag::PETABLE) {
            buf.write_u32::<LittleEndian>(self.petable_id.unwrap_or(0))
                .unwrap();
        }
        if self.physics_flags.contains(PhysicsDescriptionFlag::CSETUP) {
            buf.write_u32::<LittleEndian>(self.csetup_id.unwrap_or(0))
                .unwrap();
        }
        if self.physics_flags.contains(PhysicsDescriptionFlag::PARENT) {
            self.parent_id.unwrap().pack(buf);
            buf.write_u32::<LittleEndian>(self.parent_loc.unwrap_or(0))
                .unwrap();
        }
        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::CHILDREN)
        {
            let children = self.children.as_deref().unwrap_or(&[]);
            buf.write_u32::<LittleEndian>(children.len() as u32)
                .unwrap();
            for child in children {
                child.guid.pack(buf);
                buf.write_u32::<LittleEndian>(child.location_id).unwrap();
            }
        }
        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::OBJSCALE)
        {
            buf.write_f32::<LittleEndian>(self.obj_scale.unwrap_or(1.0))
                .unwrap();
        }
        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::FRICTION)
        {
            buf.write_f32::<LittleEndian>(self.friction.unwrap_or(0.0))
                .unwrap();
        }
        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::ELASTICITY)
        {
            buf.write_f32::<LittleEndian>(self.elasticity.unwrap_or(0.0))
                .unwrap();
        }
        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::TRANSLUCENCY)
        {
            buf.write_f32::<LittleEndian>(self.translucency.unwrap_or(0.0))
                .unwrap();
        }
        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::VELOCITY)
        {
            let velocity = self.velocity.unwrap_or_default();
            buf.write_f32::<LittleEndian>(velocity.x).unwrap();
            buf.write_f32::<LittleEndian>(velocity.y).unwrap();
            buf.write_f32::<LittleEndian>(velocity.z).unwrap();
        }
        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::ACCELERATION)
        {
            let acceleration = self.acceleration.unwrap_or_default();
            buf.write_f32::<LittleEndian>(acceleration.x).unwrap();
            buf.write_f32::<LittleEndian>(acceleration.y).unwrap();
            buf.write_f32::<LittleEndian>(acceleration.z).unwrap();
        }
        if self.physics_flags.contains(PhysicsDescriptionFlag::OMEGA) {
            let omega = self.omega.unwrap_or_default();
            buf.write_f32::<LittleEndian>(omega.x).unwrap();
            buf.write_f32::<LittleEndian>(omega.y).unwrap();
            buf.write_f32::<LittleEndian>(omega.z).unwrap();
        }
        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::DEFAULT_SCRIPT)
        {
            buf.write_u32::<LittleEndian>(self.default_script_id.unwrap_or(0))
                .unwrap();
        }
        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::DEFAULT_SCRIPT_INTENSITY)
        {
            buf.write_f32::<LittleEndian>(self.default_script_intensity.unwrap_or(0.0))
                .unwrap();
        }

        for val in self.sequences {
            buf.write_u16::<LittleEndian>(val).unwrap();
        }
        pad_to_4(buf);

        self.public_weenie_desc.pack_fields(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::math::Quaternion;

    #[test]
    fn retains_extended_physics_and_weenie_fields_roundtrip() {
        let original = ObjectDescriptionData {
            model_data: ModelData {
                header: 0x11,
                ..Default::default()
            },
            physics_flags: PhysicsDescriptionFlag::MOVEMENT
                | PhysicsDescriptionFlag::POSITION
                | PhysicsDescriptionFlag::MTABLE
                | PhysicsDescriptionFlag::CHILDREN
                | PhysicsDescriptionFlag::FRICTION
                | PhysicsDescriptionFlag::VELOCITY
                | PhysicsDescriptionFlag::DEFAULT_SCRIPT
                | PhysicsDescriptionFlag::DEFAULT_SCRIPT_INTENSITY,
            physics_state: PhysicsState::REPORT_COLLISIONS,
            movement_data: Some(vec![0xAA, 0xBB, 0xCC]),
            autonomous_movement: Some(true),
            pos: Some(WorldPosition {
                landblock_id: Guid(0x1234FFFF),
                coords: Vector3 {
                    x: 1.0,
                    y: 2.0,
                    z: 3.0,
                },
                rotation: Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            }),
            mtable_id: Some(0x09000001),
            children: Some(vec![PhysicsChildData {
                guid: Guid(0x50000099),
                location_id: 2,
            }]),
            friction: Some(0.25),
            velocity: Some(Vector3 {
                x: 9.0,
                y: 8.0,
                z: 7.0,
            }),
            default_script_id: Some(0x33000001),
            default_script_intensity: Some(0.75),
            sequences: [1, 2, 3, 4, 5, 6, 7, 8, 9],
            public_weenie_desc: PublicWeenieDescription {
                guid: Guid(0x50000042),
                weenie_flags: WeenieHeaderFlag::PLURAL_NAME
                    | WeenieHeaderFlag::ITEMS_CAPACITY
                    | WeenieHeaderFlag::VALUE
                    | WeenieHeaderFlag::COMBAT_USE
                    | WeenieHeaderFlag::SPELL
                    | WeenieHeaderFlag::HOUSE_RESTRICTIONS
                    | WeenieHeaderFlag::ICON_OVERLAY
                    | WeenieHeaderFlag::MATERIAL_TYPE,
                name: Some("Roundtrip Object".to_string()),
                wcid: 1234,
                icon_id: 0x06000010,
                item_type: 1,
                obj_desc_flags: ObjectDescriptionFlag::INCLUDES_SECOND_HEADER,
                weenie_flags2: WeenieHeaderFlag2::ICON_UNDERLAY | WeenieHeaderFlag2::COOLDOWN,
                house_restrictions: Some(HouseRestrictionsData {
                    version: 0x10000002,
                    bitmask: Some(1),
                    monarch_id: Some(Guid(0x50000077)),
                    open_house: None,
                    bucket_count: 0,
                    entries: vec![(0x50000088, 1)],
                }),
                string_properties: BTreeMap::from([(
                    PropertyString::PluralName as u32,
                    "Roundtrip Objects".to_string(),
                )]),
                int_properties: BTreeMap::from([
                    (PropertyInt::ItemsCapacity as u32, 12),
                    (PropertyInt::Value as u32, 42),
                    (PropertyInt::CombatUse as u32, 1),
                    (PropertyInt::MaterialType as u32, 5),
                    (PropertyInt::SharedCooldown as u32, 100),
                ]),
                did_properties: BTreeMap::from([
                    (PropertyDataId::Spell as u32, Guid(0x9001)),
                    (PropertyDataId::IconOverlay as u32, Guid(0x06000022)),
                    (PropertyDataId::IconUnderlay as u32, Guid(0x06000023)),
                ]),
                ..Default::default()
            },
            ..Default::default()
        };

        let mut packed = Vec::new();
        original.pack(&mut packed);

        let mut offset = 0;
        let unpacked =
            ObjectDescriptionData::unpack(&packed, &mut offset).expect("roundtrip unpack");

        assert_eq!(unpacked, original);
        assert_eq!(offset, packed.len());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ObjDescEventData {
    pub guid: Guid,
    pub model_data: ModelData,
    pub instance_sequence: u16,
    pub visual_desc_sequence: u16,
}

impl ProtocolUnpack for ObjDescEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        let model_data = ModelData::unpack(data, offset)?;

        if *offset + 4 > data.len() {
            return None;
        }
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let visual_desc_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;

        Some(ObjDescEventData {
            guid,
            model_data,
            instance_sequence,
            visual_desc_sequence,
        })
    }
}

impl ProtocolPack for ObjDescEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        self.model_data.pack(buf);
        buf.write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.visual_desc_sequence)
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ForceObjectDescSendData {
    pub guid: Guid,
}

impl ProtocolUnpack for ForceObjectDescSendData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        Some(ForceObjectDescSendData { guid })
    }
}

impl ProtocolPack for ForceObjectDescSendData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
    }
}

#[cfg(test)]
mod world_object_tests {
    use super::*;
    use crate::test_fixtures;

    #[test]
    fn test_object_description_data_parity_minimal() {
        let data = test_fixtures::OBJECT_CREATE_MINIMAL;
        let mut offset = 0;
        let msg = ObjectDescriptionData::unpack(data, &mut offset).expect("Unpack failed");

        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(packed, data);
    }

    #[test]
    fn test_object_description_data_parity_complex() {
        let data = test_fixtures::OBJECT_CREATE_COMPLEX;
        let mut offset = 0;
        let msg = ObjectDescriptionData::unpack(data, &mut offset).expect("Unpack failed");

        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(packed, data);
    }
}
