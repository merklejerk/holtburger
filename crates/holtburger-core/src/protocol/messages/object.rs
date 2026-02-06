use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::utils::{
    align_to_4, read_packed_u32, read_packed_u32_with_known_type, read_string16,
    write_packed_u32_with_known_type, write_string16,
};
use crate::world::position::WorldPosition;
use crate::world::properties::{
    ObjectDescriptionFlag, PhysicsDescriptionFlag, PhysicsState, WeenieHeaderFlag,
    WeenieHeaderFlag2,
};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectDescriptionData {
    pub guid: u32,
    pub model_header: u8,
    pub physics_flags: PhysicsDescriptionFlag,
    pub physics_state: PhysicsState,
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
    pub weenie_flags2: WeenieHeaderFlag2,
    pub container_id: Option<u32>,
    pub wielder_id: Option<u32>,
    pub valid_locations: Option<u32>,
    pub currently_wielded_location: Option<u32>,
    pub priority: Option<u32>,
    pub burden: Option<u16>,
}

impl MessageUnpack for ObjectDescriptionData {
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

        let mut weenie_flags2 = WeenieHeaderFlag2::empty();
        if obj_desc_flags.contains(ObjectDescriptionFlag::INCLUDES_SECOND_HEADER) {
            if *offset + 4 > data.len() {
                return None;
            }
            weenie_flags2 = WeenieHeaderFlag2::from_bits_retain(
                LittleEndian::read_u32(&data[*offset..*offset + 4]),
            );
            *offset += 4;
        }

        // ---- Weenie header fields (ACE serialization order) ----
        // The order here MUST match the ACE server's exact write order.

        if weenie_flags.contains(WeenieHeaderFlag::PLURAL_NAME) {
            read_string16(data, offset);
        }
        // ITEMS_CAPACITY: byte (1)
        if weenie_flags.contains(WeenieHeaderFlag::ITEMS_CAPACITY) {
            if *offset >= data.len() {
                return None;
            }
            *offset += 1;
        }
        // CONTAINERS_CAPACITY: byte (1)
        if weenie_flags.contains(WeenieHeaderFlag::CONTAINERS_CAPACITY) {
            if *offset >= data.len() {
                return None;
            }
            *offset += 1;
        }
        // AMMO_TYPE: ushort (2)
        if weenie_flags.contains(WeenieHeaderFlag::AMMO_TYPE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        // VALUE: int (4)
        if weenie_flags.contains(WeenieHeaderFlag::VALUE) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        // USABLE: uint (4)
        if weenie_flags.contains(WeenieHeaderFlag::USABLE) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        // USE_RADIUS: float (4)
        if weenie_flags.contains(WeenieHeaderFlag::USE_RADIUS) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        // TARGET_TYPE: uint (4)
        if weenie_flags.contains(WeenieHeaderFlag::TARGET_TYPE) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        // UI_EFFECTS: uint (4)
        if weenie_flags.contains(WeenieHeaderFlag::UI_EFFECTS) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        // COMBAT_USE: sbyte (1)
        if weenie_flags.contains(WeenieHeaderFlag::COMBAT_USE) {
            if *offset >= data.len() {
                return None;
            }
            *offset += 1;
        }
        // STRUCTURE: ushort (2)
        if weenie_flags.contains(WeenieHeaderFlag::STRUCTURE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        // MAX_STRUCTURE: ushort (2)
        if weenie_flags.contains(WeenieHeaderFlag::MAX_STRUCTURE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        // STACK_SIZE: ushort (2)
        if weenie_flags.contains(WeenieHeaderFlag::STACK_SIZE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        // MAX_STACK_SIZE: ushort (2)
        if weenie_flags.contains(WeenieHeaderFlag::MAX_STACK_SIZE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        // CONTAINER: uint (4)
        let mut container_id = None;
        if weenie_flags.contains(WeenieHeaderFlag::CONTAINER) {
            if *offset + 4 > data.len() {
                return None;
            }
            container_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        // WIELDER: uint (4)
        let mut wielder_id = None;
        if weenie_flags.contains(WeenieHeaderFlag::WIELDER) {
            if *offset + 4 > data.len() {
                return None;
            }
            wielder_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        // VALID_LOCATIONS: uint (4)
        let mut valid_locations = None;
        if weenie_flags.contains(WeenieHeaderFlag::VALID_LOCATIONS) {
            if *offset + 4 > data.len() {
                return None;
            }
            valid_locations = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        // CURRENTLY_WIELDED_LOCATION: uint (4)
        let mut currently_wielded_location = None;
        if weenie_flags.contains(WeenieHeaderFlag::CURRENTLY_WIELDED_LOCATION) {
            if *offset + 4 > data.len() {
                return None;
            }
            currently_wielded_location =
                Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        // PRIORITY: uint (4)
        let mut priority = None;
        if weenie_flags.contains(WeenieHeaderFlag::PRIORITY) {
            if *offset + 4 > data.len() {
                return None;
            }
            priority = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        // RADAR_BLIP_COLOR: byte (1)
        if weenie_flags.contains(WeenieHeaderFlag::RADAR_BLIP_COLOR) {
            if *offset >= data.len() {
                return None;
            }
            *offset += 1;
        }
        // RADAR_BEHAVIOR: byte (1)
        if weenie_flags.contains(WeenieHeaderFlag::RADAR_BEHAVIOR) {
            if *offset >= data.len() {
                return None;
            }
            *offset += 1;
        }
        // PSCRIPT: ushort (2)
        if weenie_flags.contains(WeenieHeaderFlag::PSCRIPT) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        // WORKMANSHIP: float (4)
        if weenie_flags.contains(WeenieHeaderFlag::WORKMANSHIP) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        // BURDEN: ushort (2)
        let mut burden = None;
        if weenie_flags.contains(WeenieHeaderFlag::BURDEN) {
            if *offset + 2 > data.len() {
                return None;
            }
            burden = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]));
            *offset += 2;
        }
        // SPELL: ushort (2)
        if weenie_flags.contains(WeenieHeaderFlag::SPELL) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        // HOUSE_OWNER: uint (4)
        if weenie_flags.contains(WeenieHeaderFlag::HOUSE_OWNER) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        // HOUSE_RESTRICTIONS: variable (HAR struct) — skip the AccessList
        if weenie_flags.contains(WeenieHeaderFlag::HOUSE_RESTRICTIONS) {
            // HouseAccess: bitmask(4) + MonarchID(4) + GuestList hash table + Roommate list
            if *offset + 12 > data.len() {
                return None;
            }
            *offset += 4; // bitmask
            *offset += 4; // MonarchID
            // Guest list (PackableHashTable<ObjectGuid, GuestInfo>)
            let guest_count =
                LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
            *offset += 4; // count + buckets
            // Each entry: ObjectGuid(4) + GuestInfo(4)
            let skip = guest_count * 8;
            if *offset + skip > data.len() {
                return None;
            }
            *offset += skip;
            // Roommate list (PackableList<ObjectGuid>)
            if *offset + 4 > data.len() {
                return None;
            }
            let roommate_count =
                LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
            *offset += 4;
            let skip = roommate_count * 4;
            if *offset + skip > data.len() {
                return None;
            }
            *offset += skip;
        }
        // HOOK_ITEM_TYPES: uint (4)
        if weenie_flags.contains(WeenieHeaderFlag::HOOK_ITEM_TYPES) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        // MONARCH: uint (4)
        if weenie_flags.contains(WeenieHeaderFlag::MONARCH) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        // HOOK_TYPE: ushort (2)
        if weenie_flags.contains(WeenieHeaderFlag::HOOK_TYPE) {
            if *offset + 2 > data.len() {
                return None;
            }
            *offset += 2;
        }
        // ICON_OVERLAY: PackedDwordOfKnownType (variable)
        if weenie_flags.contains(WeenieHeaderFlag::ICON_OVERLAY) {
            read_packed_u32_with_known_type(data, offset, 0x06000000);
        }
        // WeenieHeaderFlag2::ICON_UNDERLAY: PackedDwordOfKnownType (variable)
        if weenie_flags2.contains(WeenieHeaderFlag2::ICON_UNDERLAY) {
            read_packed_u32_with_known_type(data, offset, 0x06000000);
        }
        // MATERIAL_TYPE: uint (4)
        if weenie_flags.contains(WeenieHeaderFlag::MATERIAL_TYPE) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        // WeenieHeaderFlag2::COOLDOWN: int (4)
        if weenie_flags2.contains(WeenieHeaderFlag2::COOLDOWN) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }
        // WeenieHeaderFlag2::COOLDOWN_DURATION: double (8)
        if weenie_flags2.contains(WeenieHeaderFlag2::COOLDOWN_DURATION) {
            if *offset + 8 > data.len() {
                return None;
            }
            *offset += 8;
        }
        // WeenieHeaderFlag2::PET_OWNER: uint (4)
        if weenie_flags2.contains(WeenieHeaderFlag2::PET_OWNER) {
            if *offset + 4 > data.len() {
                return None;
            }
            *offset += 4;
        }

        // Final alignment
        *offset = align_to_4(*offset);

        Some(ObjectDescriptionData {
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

impl MessagePack for ObjectDescriptionData {
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
        buf.write_u32::<LittleEndian>(self.physics_state.bits())
            .unwrap();

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
            buf.write_u32::<LittleEndian>(self.weenie_flags2.bits())
                .unwrap();
        }

        // ---- Weenie header fields (ACE serialization order) ----
        if self.weenie_flags.contains(WeenieHeaderFlag::CONTAINER) {
            buf.write_u32::<LittleEndian>(self.container_id.unwrap())
                .unwrap();
        }
        if self.weenie_flags.contains(WeenieHeaderFlag::WIELDER) {
            buf.write_u32::<LittleEndian>(self.wielder_id.unwrap())
                .unwrap();
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

impl MessagePack for ParentEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.child_guid.to_le_bytes());
        buf.extend_from_slice(&self.parent_guid.to_le_bytes());
        buf.extend_from_slice(&self.location.to_le_bytes());
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

impl MessagePack for PickupEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.guid.to_le_bytes());
        buf.write_u32::<LittleEndian>(if self.success { 1 } else { 0 })
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SetStateData {
    pub guid: u32,
    pub physics_state: PhysicsState,
    pub instance_sequence: u16,
    pub state_sequence: u16,
}

impl MessageUnpack for SetStateData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
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

impl MessagePack for SetStateData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.guid).unwrap();
        buf.write_u32::<LittleEndian>(self.physics_state.bits())
            .unwrap();
        buf.write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.state_sequence).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_set_state_parity() {
        let hex = "010000500804400063010100";
        let expected = SetStateData {
            guid: 0x50000001,
            physics_state: PhysicsState::REPORT_COLLISIONS
                | PhysicsState::GRAVITY
                | PhysicsState::EDGE_SLIDE,
            instance_sequence: 355,
            state_sequence: 1,
        };
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_object_create_minimal_fixture() {
        let mut sequences = [0u16; 9];
        for (i, seq) in sequences.iter_mut().enumerate() {
            *seq = i as u16;
        }

        let expected = ObjectDescriptionData {
            guid: 0x50000001,
            model_header: 1,
            physics_flags: PhysicsDescriptionFlag::POSITION | PhysicsDescriptionFlag::TIMESTAMPS,
            physics_state: PhysicsState::empty(),
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
        let mut sequences = [0u16; 9];
        for (i, seq) in sequences.iter_mut().enumerate() {
            *seq = (100 + i) as u16;
        }

        let expected = ObjectDescriptionData {
            guid: 0x50000002,
            model_header: 0x11,
            physics_flags: PhysicsDescriptionFlag::POSITION
                | PhysicsDescriptionFlag::PARENT
                | PhysicsDescriptionFlag::OBJSCALE
                | PhysicsDescriptionFlag::TIMESTAMPS,
            physics_state: PhysicsState::empty(),
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
            weenie_flags2: WeenieHeaderFlag2::empty(),
            container_id: Some(0x50001001),
            wielder_id: Some(0x50001002),
            valid_locations: None,
            currently_wielded_location: None,
            priority: None,
            burden: None,
        };

        assert_pack_unpack_parity(fixtures::OBJECT_CREATE_COMPLEX, &expected);
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

        let mut offset = 0;
        let unpacked = UpdatePropertyIntData::unpack(&packed, &mut offset, true).unwrap();
        assert_eq!(unpacked, msg);
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

        let mut offset = 0;
        let unpacked = UpdatePropertyFloatData::unpack(&packed, &mut offset, false).unwrap();
        assert_eq!(unpacked, msg);
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

        let mut offset = 0;
        let unpacked = UpdatePropertyStringData::unpack(&packed, &mut offset, false).unwrap();
        assert_eq!(unpacked, msg);
    }

    #[test]
    fn test_update_health_fixture() {
        let hex = "010000500000003f";
        let data = hex::decode(hex).unwrap();
        let expected = UpdateHealthData {
            target: 0x50000001,
            health: 0.5,
        };
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_object_delete_fixture() {
        let hex = "01000050";
        let data = hex::decode(hex).unwrap();
        let expected = ObjectDeleteData { guid: 0x50000001 };
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_routing_update_property_int() {
        use crate::protocol::messages::GameMessage;
        let hex = "CE02000001150000000200000001000000";
        let data = hex::decode(hex).unwrap();
        let msg = GameMessage::unpack(&data).unwrap();
        if let GameMessage::UpdatePropertyInt(prop) = msg {
            assert_eq!(prop.guid, 0x15);
            assert_eq!(prop.property, 2);
            assert_eq!(prop.value, 1);
        } else {
            panic!("Expected UpdatePropertyInt, got {:?}", msg);
        }
    }
}
