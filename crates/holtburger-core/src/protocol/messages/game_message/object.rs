use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::protocol::messages::types::object::*;
use crate::protocol::messages::utils::{
    align_offset, align_to_4, pad_to_4, read_packed_u32_with_known_type, read_string16,
    write_packed_u32_with_known_type, write_string16,
};
use crate::world::Guid;
use crate::world::position::WorldPosition;
use crate::world::properties::{
    ObjectDescriptionFlag, PhysicsDescriptionFlag, PhysicsState, WeenieHeaderFlag,
    WeenieHeaderFlag2,
};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectDescriptionData {
    pub guid: Guid,
    pub model_data: ModelData,
    pub physics_flags: PhysicsDescriptionFlag,
    pub physics_state: PhysicsState,
    pub pos: Option<WorldPosition>,
    pub parent_id: Option<Guid>,
    pub parent_loc: Option<u32>,
    pub obj_scale: Option<f32>,
    pub sequences: [u16; 9],
    pub weenie_flags: WeenieHeaderFlag,
    pub name: Option<String>,
    pub wcid: u32,
    pub icon_id: u32,
    pub item_type: u32,
    pub obj_desc_flags: ObjectDescriptionFlag,
    pub weenie_flags2: WeenieHeaderFlag2,
    pub container_id: Option<Guid>,
    pub wielder_id: Option<Guid>,
    pub valid_locations: Option<u32>,
    pub currently_wielded_location: Option<u32>,
    pub priority: Option<u32>,
    pub burden: Option<u16>,
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
                *offset += 4;
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
            parent_id = Some(Guid::unpack(data, offset)?);
            if *offset + 4 > data.len() {
                return None;
            }
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
        let mut sequences = [0u16; 9];
        for seq in &mut sequences {
            *seq = LittleEndian::read_u16(&data[*offset..*offset + 2]);
            *offset += 2;
        }
        *offset = align_to_4(*offset);

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

        if weenie_flags.contains(WeenieHeaderFlag::PLURAL_NAME) {
            read_string16(data, offset);
        }
        if weenie_flags.contains(WeenieHeaderFlag::ITEMS_CAPACITY) {
            if *offset >= data.len() {
                return None;
            }
            *offset += 1;
        }
        if weenie_flags.contains(WeenieHeaderFlag::CONTAINERS_CAPACITY) {
            if *offset >= data.len() {
                return None;
            }
            *offset += 1;
        }
        if weenie_flags.contains(WeenieHeaderFlag::AMMO_TYPE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::VALUE) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::USABLE) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::USE_RADIUS) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::TARGET_TYPE) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::UI_EFFECTS) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::COMBAT_USE) {
            if *offset >= data.len() {
                return None;
            }
            *offset += 1;
        }
        if weenie_flags.contains(WeenieHeaderFlag::STRUCTURE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::MAX_STRUCTURE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::STACK_SIZE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::MAX_STACK_SIZE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }

        let mut container_id = None;
        if weenie_flags.contains(WeenieHeaderFlag::CONTAINER) {
            container_id = Some(Guid::unpack(data, offset)?);
        }
        let mut wielder_id = None;
        if weenie_flags.contains(WeenieHeaderFlag::WIELDER) {
            wielder_id = Some(Guid::unpack(data, offset)?);
        }
        let mut valid_locations = None;
        if weenie_flags.contains(WeenieHeaderFlag::VALID_LOCATIONS) {
            if *offset + 4 > data.len() {
                return None;
            }
            valid_locations = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        let mut currently_wielded_location = None;
        if weenie_flags.contains(WeenieHeaderFlag::CURRENTLY_WIELDED_LOCATION) {
            if *offset + 4 > data.len() {
                return None;
            }
            currently_wielded_location = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        let mut priority = None;
        if weenie_flags.contains(WeenieHeaderFlag::PRIORITY) {
            if *offset + 4 > data.len() {
                return None;
            }
            priority = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::RADAR_BLIP_COLOR) {
            if *offset >= data.len() {
                return None;
            }
            *offset += 1;
        }
        if weenie_flags.contains(WeenieHeaderFlag::RADAR_BEHAVIOR) {
            if *offset >= data.len() {
                return None;
            }
            *offset += 1;
        }
        if weenie_flags.contains(WeenieHeaderFlag::PSCRIPT) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::WORKMANSHIP) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }

        let mut burden = None;
        if weenie_flags.contains(WeenieHeaderFlag::BURDEN) {
            if *offset + 2 > data.len() {
                return None;
            }
            burden = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]));
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::SPELL) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::HOUSE_OWNER) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::HOUSE_RESTRICTIONS) {
            if *offset + 12 > data.len() {
                return None;
            }
            *offset += 8;
            let guest_count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4;
            *offset += guest_count * 8;
            if *offset + 4 > data.len() {
                return None;
            }
            let roommate_count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4 + (roommate_count * 4);
        }
        if weenie_flags.contains(WeenieHeaderFlag::HOOK_ITEM_TYPES) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::MONARCH) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if weenie_flags.contains(WeenieHeaderFlag::HOOK_TYPE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        if weenie_flags.contains(WeenieHeaderFlag::ICON_OVERLAY) {
            read_packed_u32_with_known_type(data, offset, 0x06000000);
        }
        if weenie_flags2.contains(WeenieHeaderFlag2::ICON_UNDERLAY) {
            read_packed_u32_with_known_type(data, offset, 0x06000000);
        }
        if weenie_flags.contains(WeenieHeaderFlag::MATERIAL_TYPE) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if weenie_flags2.contains(WeenieHeaderFlag2::COOLDOWN) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        if weenie_flags2.contains(WeenieHeaderFlag2::COOLDOWN_DURATION) {
            if *offset + 8 > data.len() {
                return None;
            }
            *offset += 8;
        }
        if weenie_flags2.contains(WeenieHeaderFlag2::PET_OWNER) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }

        *offset = align_to_4(*offset);

        Some(ObjectDescriptionData {
            guid,
            model_data,
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
            weenie_flags2,
            container_id,
            wielder_id,
            valid_locations,
            currently_wielded_location,
            priority,
            burden,
        })
    }
}

impl ProtocolPack for ObjectDescriptionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        self.model_data.pack(buf);
        buf.write_u32::<LittleEndian>(self.physics_flags.bits())
            .unwrap();
        buf.write_u32::<LittleEndian>(self.physics_state.bits())
            .unwrap();

        if self
            .physics_flags
            .contains(PhysicsDescriptionFlag::POSITION)
        {
            self.pos.as_ref().unwrap().pack(buf);
        }
        if self.physics_flags.contains(PhysicsDescriptionFlag::PARENT) {
            self.parent_id.unwrap().pack(buf);
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

        for val in self.sequences {
            buf.write_u16::<LittleEndian>(val).unwrap();
        }
        pad_to_4(buf);

        buf.write_u32::<LittleEndian>(self.weenie_flags.bits())
            .unwrap();
        write_string16(buf, self.name.as_deref().unwrap_or(""));
        write_packed_u32_with_known_type(buf, self.wcid, 0);
        write_packed_u32_with_known_type(buf, self.icon_id, 0x06000000);
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

        if self.weenie_flags.contains(WeenieHeaderFlag::CONTAINER) {
            self.container_id.unwrap().pack(buf);
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::WIELDER) {
            self.wielder_id.unwrap().pack(buf);
        }
        if self
            .weenie_flags
            .contains(WeenieHeaderFlag::VALID_LOCATIONS)
        {
            buf.write_u32::<LittleEndian>(self.valid_locations.unwrap_or(0))
                .unwrap();
        }
        if self
            .weenie_flags
            .contains(WeenieHeaderFlag::CURRENTLY_WIELDED_LOCATION)
        {
            buf.write_u32::<LittleEndian>(self.currently_wielded_location.unwrap_or(0))
                .unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::PRIORITY) {
            buf.write_u32::<LittleEndian>(self.priority.unwrap_or(0))
                .unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::BURDEN) {
            buf.write_u16::<LittleEndian>(self.burden.unwrap_or(0))
                .unwrap();
        }
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectDeleteData {
    pub guid: Guid,
}

impl ProtocolUnpack for ObjectDeleteData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        Some(ObjectDeleteData { guid })
    }
}

impl ProtocolPack for ObjectDeleteData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
    }
}

macro_rules! define_update_property {
    ($name:ident, $type:ty) => {
        #[derive(Debug, Clone, PartialEq)]
        pub struct $name<const PUBLIC: bool> {
            pub sequence: u8,
            pub guid: Guid,
            pub property: u32,
            pub value: $type,
        }

        impl<const PUBLIC: bool> ProtocolUnpack for $name<PUBLIC> {
            fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
                let sequence = u8::unpack(data, offset)?;
                let guid = if PUBLIC {
                    Guid::unpack(data, offset)?
                } else {
                    Guid::NULL
                };
                let property = u32::unpack(data, offset)?;
                let value = <$type>::unpack(data, offset)?;
                Some($name {
                    sequence,
                    guid,
                    property,
                    value,
                })
            }
        }

        impl<const PUBLIC: bool> ProtocolPack for $name<PUBLIC> {
            fn pack(&self, buf: &mut Vec<u8>) {
                self.sequence.pack(buf);
                if PUBLIC {
                    self.guid.pack(buf);
                }
                self.property.pack(buf);
                self.value.pack(buf);
            }
        }
    };
}

define_update_property!(UpdatePropertyInt, i32);
pub type PrivateUpdatePropertyIntData = UpdatePropertyInt<false>;
pub type PublicUpdatePropertyIntData = UpdatePropertyInt<true>;

define_update_property!(UpdatePropertyInt64, i64);
pub type PrivateUpdatePropertyInt64Data = UpdatePropertyInt64<false>;
pub type PublicUpdatePropertyInt64Data = UpdatePropertyInt64<true>;

define_update_property!(UpdatePropertyBool, bool);
pub type PrivateUpdatePropertyBoolData = UpdatePropertyBool<false>;
pub type PublicUpdatePropertyBoolData = UpdatePropertyBool<true>;

define_update_property!(UpdatePropertyFloat, f64);
pub type PrivateUpdatePropertyFloatData = UpdatePropertyFloat<false>;
pub type PublicUpdatePropertyFloatData = UpdatePropertyFloat<true>;

#[derive(Debug, Clone, PartialEq)]
pub struct UpdatePropertyString<const PUBLIC: bool> {
    pub sequence: u8,
    pub guid: Guid,
    pub property: u32,
    pub value: String,
}

impl<const PUBLIC: bool> ProtocolUnpack for UpdatePropertyString<PUBLIC> {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let sequence = u8::unpack(data, offset)?;
        let property = u32::unpack(data, offset)?;
        let guid = if PUBLIC {
            Guid::unpack(data, offset)?
        } else {
            Guid::NULL
        };
        align_offset(offset, 4);
        let value = read_string16(data, offset)?;
        Some(UpdatePropertyString {
            sequence,
            guid,
            property,
            value,
        })
    }
}

impl<const PUBLIC: bool> ProtocolPack for UpdatePropertyString<PUBLIC> {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.sequence.pack(buf);
        self.property.pack(buf);
        if PUBLIC {
            self.guid.pack(buf);
        }
        pad_to_4(buf);
        write_string16(buf, &self.value);
    }
}

pub type PrivateUpdatePropertyStringData = UpdatePropertyString<false>;
pub type PublicUpdatePropertyStringData = UpdatePropertyString<true>;

define_update_property!(UpdatePropertyDataId, Guid);
pub type PrivateUpdatePropertyDataIdData = UpdatePropertyDataId<false>;
pub type PublicUpdatePropertyDataIdData = UpdatePropertyDataId<true>;

define_update_property!(UpdatePropertyInstanceId, Guid);
pub type PrivateUpdatePropertyInstanceIdData = UpdatePropertyInstanceId<false>;
pub type PublicUpdatePropertyInstanceIdData = UpdatePropertyInstanceId<true>;

#[derive(Debug, Clone, PartialEq)]
pub struct SetStateData {
    pub guid: Guid,
    pub physics_state: PhysicsState,
    pub instance_sequence: u16,
    pub state_sequence: u16,
}

impl ProtocolUnpack for SetStateData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let physics_state =
            PhysicsState::from_bits_retain(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        *offset += 4;
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let state_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        Some(SetStateData {
            guid,
            physics_state,
            instance_sequence,
            state_sequence,
        })
    }
}

impl ProtocolPack for SetStateData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.physics_state.bits())
            .unwrap();
        buf.write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.state_sequence).unwrap();
    }
}

pub use crate::protocol::messages::types::common::{IdentifyObjectData, UseData};

#[derive(Debug, Clone, PartialEq)]
pub struct ParentEventData {
    pub child_guid: Guid,
    pub parent_guid: Guid,
    pub location: u32,
}

impl ProtocolUnpack for ParentEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let child_guid = Guid::unpack(data, offset)?;
        let parent_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let location = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(ParentEventData {
            child_guid,
            parent_guid,
            location,
        })
    }
}

impl ProtocolPack for ParentEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.child_guid.pack(buf);
        self.parent_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.location).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PickupEventData {
    pub guid: Guid,
    pub success: bool,
}

impl ProtocolUnpack for PickupEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let success = LittleEndian::read_u32(&data[*offset..*offset + 4]) != 0;
        *offset += 4;
        Some(PickupEventData { guid, success })
    }
}

impl ProtocolPack for PickupEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        buf.write_u32::<LittleEndian>(if self.success { 1 } else { 0 })
            .unwrap();
    }
}
#[derive(Debug, Clone, PartialEq)]
pub struct ObjDescEventData {
    pub guid: Guid,
    pub model_data: ModelData,
    pub instance_sequence: u32,
    pub visual_desc_sequence: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ForceObjectDescSendData {
    pub guid: Guid,
}

impl ProtocolUnpack for ObjDescEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;

        let model_data = ModelData::unpack(data, offset)?;

        if *offset + 8 > data.len() {
            return None;
        }
        let instance_sequence = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let visual_desc_sequence = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;

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
        buf.write_u32::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.visual_desc_sequence)
            .unwrap();
    }
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
mod tests {
    use super::*;
    use crate::math::{Quaternion, Vector3};
    use crate::protocol::fixtures;
    use crate::protocol::messages::game_message::GameMessage;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;
    use crate::world::Guid;

    #[test]
    fn test_set_state_parity() {
        let hex = "010000500804400063010100";
        let data = hex::decode(hex).unwrap();
        let expected = SetStateData {
            guid: Guid(0x50000001),
            physics_state: PhysicsState::REPORT_COLLISIONS | PhysicsState::GRAVITY | PhysicsState::EDGE_SLIDE,
            instance_sequence: 355,
            state_sequence: 1,
        };
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_object_create_minimal_fixture() {
        let expected = ObjectDescriptionData {
            guid: Guid(0x50000001),
            model_data: ModelData {
                header: 1,
                ..Default::default()
            },
            physics_flags: PhysicsDescriptionFlag::POSITION | PhysicsDescriptionFlag::TIMESTAMPS,
            physics_state: PhysicsState::empty(),
            pos: Some(WorldPosition {
                landblock_id: Guid(0x12340001),
                coords: Vector3 {
                    x: 100.0,
                    y: 200.0,
                    z: 300.0,
                },
                rotation: Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            }),
            parent_id: None,
            parent_loc: None,
            obj_scale: None,
            sequences: [0, 1, 2, 3, 4, 5, 6, 7, 8],
            weenie_flags: WeenieHeaderFlag::empty(),
            name: Some("Buddy".to_string()),
            wcid: 123,
            icon_id: 0x06000000,
            item_type: 1,
            obj_desc_flags: ObjectDescriptionFlag::empty(),
            weenie_flags2: WeenieHeaderFlag2::empty(),
            container_id: None,
            wielder_id: None,
            valid_locations: None,
            currently_wielded_location: None,
            priority: None,
            burden: None,
        };

        assert_pack_unpack_parity(fixtures::OBJECT_CREATE_MINIMAL, &expected);
    }

    #[test]
    fn test_object_create_complex_fixture() {
        let expected = ObjectDescriptionData {
            guid: Guid(0x50000002),
            model_data: ModelData {
                header: 0x11,
                ..Default::default()
            },
            physics_flags: PhysicsDescriptionFlag::POSITION
                | PhysicsDescriptionFlag::PARENT
                | PhysicsDescriptionFlag::OBJSCALE
                | PhysicsDescriptionFlag::TIMESTAMPS,
            physics_state: PhysicsState::empty(),
            pos: Some(WorldPosition {
                landblock_id: Guid(0x12340001),
                coords: Vector3 {
                    x: 10.0,
                    y: 20.0,
                    z: 30.0,
                },
                rotation: Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            }),
            parent_id: Some(Guid(0x50000001)),
            parent_loc: Some(1),
            obj_scale: Some(1.5),
            sequences: [100, 101, 102, 103, 104, 105, 106, 107, 108],
            weenie_flags: WeenieHeaderFlag::CONTAINER | WeenieHeaderFlag::WIELDER,
            name: Some("Fancy Buddy".to_string()),
            wcid: 456,
            icon_id: 0x0600000A,
            item_type: 2,
            obj_desc_flags: ObjectDescriptionFlag::INCLUDES_SECOND_HEADER,
            weenie_flags2: WeenieHeaderFlag2::empty(),
            container_id: Some(Guid(0x50001001)),
            wielder_id: Some(Guid(0x50001002)),
            valid_locations: None,
            currently_wielded_location: None,
            priority: None,
            burden: None,
        };

        assert_pack_unpack_parity(fixtures::OBJECT_CREATE_COMPLEX, &expected);
    }

    #[test]
    fn test_update_property_int_fixture() {
        let hex = "0C1900000032000000";
        let data = hex::decode(hex).unwrap();
        let expected = PrivateUpdatePropertyIntData {
            sequence: 0x0C,
            guid: Guid::NULL,
            property: 25,
            value: 50,
        };
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_object_delete_fixture() {
        let hex = "01000050";
        let data = hex::decode(hex).unwrap();
        let expected = ObjectDeleteData {
            guid: Guid(0x50000001),
        };
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_obj_desc_event_parity() {
        let expected = GameMessage::ObjDescEvent(Box::new(ObjDescEventData {
            guid: Guid(0x50000001),
            model_data: ModelData {
                header: 0x11,
                palette_id: Some(0x04000001),
                sub_palettes: vec![SubPalette {
                    id: 0x04000002,
                    offset: 0,
                    length: 32,
                }],
                texture_changes: vec![TextureChange {
                    part_index: 0,
                    old_id: 0x05000001,
                    new_id: 0x05000002,
                }],
                model_changes: vec![ModelChange {
                    index: 0,
                    animation_id: 0x01000001,
                }],
            },
            instance_sequence: 1234,
            visual_desc_sequence: 5678,
        }));
        assert_pack_unpack_parity(fixtures::OBJ_DESC_EVENT, &expected);
    }

    #[test]
    fn test_force_obj_desc_send_parity() {
        let expected = GameMessage::ForceObjectDescSend(Box::new(ForceObjectDescSendData {
            guid: Guid(0x50000001),
        }));
        assert_pack_unpack_parity(fixtures::FORCE_OBJ_DESC_SEND, &expected);
    }

    #[test]
    fn test_update_property_float_fixture() {
        let hex = "0C190000000000000000005940";
        let data = hex::decode(hex).unwrap();
        let expected = PrivateUpdatePropertyFloatData {
            sequence: 0x0C,
            guid: Guid::NULL,
            property: 25,
            value: 100.0,
        };
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_update_property_string_fixture() {
        let hex = "01010000000000000500416C69636500";
        let data = hex::decode(hex).unwrap();
        let expected = PrivateUpdatePropertyStringData {
            sequence: 1,
            guid: Guid::NULL,
            property: 1,
            value: "Alice".to_string(),
        };
        assert_pack_unpack_parity(&data, &expected);
    }
}
