use crate::messages::utils::{align_to_4, pad_to_4, read_packed_data_id, write_packed_data_id};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ModelData {
    pub header: u8,
    pub extra: [u8; 3], // Header bytes for non-0x11 headers, or num_p, num_t, num_m for 0x11
    pub palette_id: Option<u32>,
    pub sub_palettes: Vec<SubPalette>,
    pub texture_changes: Vec<TextureChange>,
    pub model_changes: Vec<ModelChange>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubPalette {
    pub id: u32,
    pub offset: u8,
    pub length: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextureChange {
    pub part_index: u8,
    pub old_id: u32,
    pub new_id: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelChange {
    pub index: u8,
    pub animation_id: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArmorProfile {
    pub slashing: f32,
    pub piercing: f32,
    pub bludgeoning: f32,
    pub cold: f32,
    pub fire: f32,
    pub acid: f32,
    pub nether: f32,
    pub lightning: f32,
}

impl ProtocolUnpack for ArmorProfile {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 32 > data.len() {
            return None;
        }
        let slashing = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let piercing = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let bludgeoning = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        let cold = LittleEndian::read_f32(&data[*offset + 12..*offset + 16]);
        let fire = LittleEndian::read_f32(&data[*offset + 16..*offset + 20]);
        let acid = LittleEndian::read_f32(&data[*offset + 20..*offset + 24]);
        let nether = LittleEndian::read_f32(&data[*offset + 24..*offset + 28]);
        let lightning = LittleEndian::read_f32(&data[*offset + 28..*offset + 32]);
        *offset += 32;
        Some(ArmorProfile {
            slashing,
            piercing,
            bludgeoning,
            cold,
            fire,
            acid,
            nether,
            lightning,
        })
    }
}

impl ProtocolPack for ArmorProfile {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_f32::<LittleEndian>(self.slashing).unwrap();
        buf.write_f32::<LittleEndian>(self.piercing).unwrap();
        buf.write_f32::<LittleEndian>(self.bludgeoning).unwrap();
        buf.write_f32::<LittleEndian>(self.cold).unwrap();
        buf.write_f32::<LittleEndian>(self.fire).unwrap();
        buf.write_f32::<LittleEndian>(self.acid).unwrap();
        buf.write_f32::<LittleEndian>(self.nether).unwrap();
        buf.write_f32::<LittleEndian>(self.lightning).unwrap();
    }
}

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct CreatureProfileFlags: u32 {
        const HAS_BUFFS_DEBUFFS = 0x1;
        const UNKNOWN1        = 0x2;
        const UNKNOWN2        = 0x4;
        const SHOW_ATTRIBUTES  = 0x8;
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatureProfile {
    pub flags: CreatureProfileFlags,
    pub health: u32,
    pub health_max: u32,
    pub attributes: Option<CreatureAttributes>,
    pub buffs: Option<CreatureBuffs>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatureAttributes {
    pub strength: u32,
    pub endurance: u32,
    pub quickness: u32,
    pub coordination: u32,
    pub focus: u32,
    pub self_attr: u32,
    pub stamina: u32,
    pub mana: u32,
    pub stamina_max: u32,
    pub mana_max: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreatureBuffs {
    pub highlights: u16,
    pub colors: u16,
}

impl ProtocolUnpack for CreatureProfile {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let flags = CreatureProfileFlags::from_bits_retain(LittleEndian::read_u32(
            &data[*offset..*offset + 4],
        ));
        let health = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let health_max = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 12;

        let mut attributes = None;
        if flags.contains(CreatureProfileFlags::SHOW_ATTRIBUTES) {
            if *offset + 40 > data.len() {
                return None;
            }
            attributes = Some(CreatureAttributes {
                strength: LittleEndian::read_u32(&data[*offset..*offset + 4]),
                endurance: LittleEndian::read_u32(&data[*offset + 4..*offset + 8]),
                quickness: LittleEndian::read_u32(&data[*offset + 8..*offset + 12]),
                coordination: LittleEndian::read_u32(&data[*offset + 12..*offset + 16]),
                focus: LittleEndian::read_u32(&data[*offset + 16..*offset + 20]),
                self_attr: LittleEndian::read_u32(&data[*offset + 20..*offset + 24]),
                stamina: LittleEndian::read_u32(&data[*offset + 24..*offset + 28]),
                mana: LittleEndian::read_u32(&data[*offset + 28..*offset + 32]),
                stamina_max: LittleEndian::read_u32(&data[*offset + 32..*offset + 36]),
                mana_max: LittleEndian::read_u32(&data[*offset + 36..*offset + 40]),
            });
            *offset += 40;
        }

        let mut buffs = None;
        if flags.contains(CreatureProfileFlags::HAS_BUFFS_DEBUFFS) {
            if *offset + 4 > data.len() {
                return None;
            }
            buffs = Some(CreatureBuffs {
                highlights: LittleEndian::read_u16(&data[*offset..*offset + 2]),
                colors: LittleEndian::read_u16(&data[*offset + 2..*offset + 4]),
            });
            *offset += 4;
        }

        Some(CreatureProfile {
            flags,
            health,
            health_max,
            attributes,
            buffs,
        })
    }
}

impl ProtocolPack for CreatureProfile {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.flags.bits()).unwrap();
        buf.write_u32::<LittleEndian>(self.health).unwrap();
        buf.write_u32::<LittleEndian>(self.health_max).unwrap();

        if let Some(attr) = &self.attributes {
            buf.write_u32::<LittleEndian>(attr.strength).unwrap();
            buf.write_u32::<LittleEndian>(attr.endurance).unwrap();
            buf.write_u32::<LittleEndian>(attr.quickness).unwrap();
            buf.write_u32::<LittleEndian>(attr.coordination).unwrap();
            buf.write_u32::<LittleEndian>(attr.focus).unwrap();
            buf.write_u32::<LittleEndian>(attr.self_attr).unwrap();
            buf.write_u32::<LittleEndian>(attr.stamina).unwrap();
            buf.write_u32::<LittleEndian>(attr.mana).unwrap();
            buf.write_u32::<LittleEndian>(attr.stamina_max).unwrap();
            buf.write_u32::<LittleEndian>(attr.mana_max).unwrap();
        }

        if let Some(buffs) = &self.buffs {
            buf.write_u16::<LittleEndian>(buffs.highlights).unwrap();
            buf.write_u16::<LittleEndian>(buffs.colors).unwrap();
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WeaponProfile {
    pub damage_type: u32,
    pub weapon_time: u32,
    pub weapon_skill: u32,
    pub damage: u32,
    pub damage_variance: f64,
    pub damage_mod: f64,
    pub weapon_length: f64,
    pub max_velocity: f64,
    pub weapon_offense: f64,
    pub max_velocity_estimated: u32,
}

impl ProtocolUnpack for WeaponProfile {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 60 > data.len() {
            return None;
        }
        let damage_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let weapon_time = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let weapon_skill = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let damage = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let damage_variance = LittleEndian::read_f64(&data[*offset + 16..*offset + 24]);
        let damage_mod = LittleEndian::read_f64(&data[*offset + 24..*offset + 32]);
        let weapon_length = LittleEndian::read_f64(&data[*offset + 32..*offset + 40]);
        let max_velocity = LittleEndian::read_f64(&data[*offset + 40..*offset + 48]);
        let weapon_offense = LittleEndian::read_f64(&data[*offset + 48..*offset + 56]);
        let max_velocity_estimated = LittleEndian::read_u32(&data[*offset + 56..*offset + 60]);
        *offset += 60;
        Some(WeaponProfile {
            damage_type,
            weapon_time,
            weapon_skill,
            damage,
            damage_variance,
            damage_mod,
            weapon_length,
            max_velocity,
            weapon_offense,
            max_velocity_estimated,
        })
    }
}

impl ProtocolPack for WeaponProfile {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.damage_type).unwrap();
        buf.write_u32::<LittleEndian>(self.weapon_time).unwrap();
        buf.write_u32::<LittleEndian>(self.weapon_skill).unwrap();
        buf.write_u32::<LittleEndian>(self.damage).unwrap();
        buf.write_f64::<LittleEndian>(self.damage_variance).unwrap();
        buf.write_f64::<LittleEndian>(self.damage_mod).unwrap();
        buf.write_f64::<LittleEndian>(self.weapon_length).unwrap();
        buf.write_f64::<LittleEndian>(self.max_velocity).unwrap();
        buf.write_f64::<LittleEndian>(self.weapon_offense).unwrap();
        buf.write_u32::<LittleEndian>(self.max_velocity_estimated)
            .unwrap();
    }
}

use holtburger_common::properties::EquipMask;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HookProfile {
    pub flags: u32,
    pub valid_locations: EquipMask,
    pub ammo_type: u32,
}

impl ProtocolUnpack for HookProfile {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let flags = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let valid_locations =
            EquipMask::from_bits_truncate(LittleEndian::read_u32(&data[*offset + 4..*offset + 8]));
        let ammo_type = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        Some(HookProfile {
            flags,
            valid_locations,
            ammo_type,
        })
    }
}

impl ProtocolPack for HookProfile {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.flags).unwrap();
        buf.write_u32::<LittleEndian>(self.valid_locations.bits())
            .unwrap();
        buf.write_u32::<LittleEndian>(self.ammo_type).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArmorLevels {
    pub head: u32,
    pub chest: u32,
    pub abdomen: u32,
    pub upper_arm: u32,
    pub lower_arm: u32,
    pub hand: u32,
    pub upper_leg: u32,
    pub lower_leg: u32,
    pub foot: u32,
}

impl ProtocolUnpack for ArmorLevels {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 36 > data.len() {
            return None;
        }
        let head = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let chest = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let abdomen = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let upper_arm = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let lower_arm = LittleEndian::read_u32(&data[*offset + 16..*offset + 20]);
        let hand = LittleEndian::read_u32(&data[*offset + 20..*offset + 24]);
        let upper_leg = LittleEndian::read_u32(&data[*offset + 24..*offset + 28]);
        let lower_leg = LittleEndian::read_u32(&data[*offset + 28..*offset + 32]);
        let foot = LittleEndian::read_u32(&data[*offset + 32..*offset + 36]);
        *offset += 36;
        Some(ArmorLevels {
            head,
            chest,
            abdomen,
            upper_arm,
            lower_arm,
            hand,
            upper_leg,
            lower_leg,
            foot,
        })
    }
}

impl ProtocolPack for ArmorLevels {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.head).unwrap();
        buf.write_u32::<LittleEndian>(self.chest).unwrap();
        buf.write_u32::<LittleEndian>(self.abdomen).unwrap();
        buf.write_u32::<LittleEndian>(self.upper_arm).unwrap();
        buf.write_u32::<LittleEndian>(self.lower_arm).unwrap();
        buf.write_u32::<LittleEndian>(self.hand).unwrap();
        buf.write_u32::<LittleEndian>(self.upper_leg).unwrap();
        buf.write_u32::<LittleEndian>(self.lower_leg).unwrap();
        buf.write_u32::<LittleEndian>(self.foot).unwrap();
    }
}

impl ProtocolUnpack for ModelData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset >= data.len() {
            return None;
        }
        let header = data[*offset];
        *offset += 1;

        if *offset + 3 > data.len() {
            return None;
        }
        let extra = [data[*offset], data[*offset + 1], data[*offset + 2]];
        *offset += 3;

        let mut palette_id = None;
        let mut sub_palettes = Vec::new();
        let mut texture_changes = Vec::new();
        let mut model_changes = Vec::new();

        if header == 0x11 {
            let num_p = extra[0];
            let num_t = extra[1];
            let num_m = extra[2];

            if num_p > 0 {
                palette_id = Some(read_packed_data_id(data, offset, 0x04000000));
                for _ in 0..num_p {
                    let id = read_packed_data_id(data, offset, 0x04000000);
                    if *offset + 2 > data.len() {
                        return None;
                    }
                    let offset_val = data[*offset];
                    let length = data[*offset + 1];
                    *offset += 2;
                    sub_palettes.push(SubPalette {
                        id,
                        offset: offset_val,
                        length,
                    });
                }
            }

            for _ in 0..num_t {
                if *offset >= data.len() {
                    return None;
                }
                let part_index = data[*offset];
                *offset += 1;
                let old_id = read_packed_data_id(data, offset, 0x05000000);
                let new_id = read_packed_data_id(data, offset, 0x05000000);
                texture_changes.push(TextureChange {
                    part_index,
                    old_id,
                    new_id,
                });
            }

            for _ in 0..num_m {
                if *offset >= data.len() {
                    return None;
                }
                let index = data[*offset];
                *offset += 1;
                let animation_id = read_packed_data_id(data, offset, 0x01000000);
                model_changes.push(ModelChange {
                    index,
                    animation_id,
                });
            }
        }
        *offset = align_to_4(*offset);

        Some(ModelData {
            header,
            extra,
            palette_id,
            sub_palettes,
            texture_changes,
            model_changes,
        })
    }
}

impl ProtocolPack for ModelData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.header);

        if self.header == 0x11 {
            buf.push(self.sub_palettes.len() as u8);
            buf.push(self.texture_changes.len() as u8);
            buf.push(self.model_changes.len() as u8);

            if !self.sub_palettes.is_empty() {
                write_packed_data_id(buf, self.palette_id.unwrap_or(0), 0x04000000);
                for p in &self.sub_palettes {
                    write_packed_data_id(buf, p.id, 0x04000000);
                    buf.push(p.offset);
                    buf.push(p.length);
                }
            }

            for t in &self.texture_changes {
                buf.push(t.part_index);
                write_packed_data_id(buf, t.old_id, 0x05000000);
                write_packed_data_id(buf, t.new_id, 0x05000000);
            }

            for m in &self.model_changes {
                buf.push(m.index);
                write_packed_data_id(buf, m.animation_id, 0x01000000);
            }
        } else {
            buf.extend_from_slice(&self.extra);
        }
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IdentifyObjectActionData {
    pub guid: Guid,
}

impl ProtocolUnpack for IdentifyObjectActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        Some(IdentifyObjectActionData { guid })
    }
}

impl ProtocolPack for IdentifyObjectActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UseActionData {
    pub guid: Guid,
}

impl ProtocolUnpack for UseActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        Some(UseActionData { guid })
    }
}

impl ProtocolPack for UseActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct UseWithTargetActionData {
    pub item_guid: Guid,
    pub target_guid: Guid,
}

impl ProtocolUnpack for UseWithTargetActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let item_guid = Guid::unpack(data, offset)?;
        let target_guid = Guid::unpack(data, offset)?;
        Some(UseWithTargetActionData {
            item_guid,
            target_guid,
        })
    }
}

impl ProtocolPack for UseWithTargetActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
        self.target_guid.pack(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;
    use holtburger_common::Guid;

    #[test]
    fn test_armor_profile_parity() {
        let expected = ArmorProfile {
            slashing: 1.0,
            piercing: 2.0,
            bludgeoning: 3.0,
            cold: 4.0,
            fire: 5.0,
            acid: 6.0,
            nether: 7.0,
            lightning: 8.0,
        };
        assert_pack_unpack_parity(test_fixtures::ARMOR_PROFILE, &expected);
    }

    #[test]
    fn test_creature_profile_parity() {
        let expected = CreatureProfile {
            flags: CreatureProfileFlags::SHOW_ATTRIBUTES | CreatureProfileFlags::HAS_BUFFS_DEBUFFS,
            health: 500,
            health_max: 1000,
            attributes: Some(CreatureAttributes {
                strength: 10,
                endurance: 20,
                quickness: 30,
                coordination: 40,
                focus: 50,
                self_attr: 60,
                stamina: 70,
                mana: 80,
                stamina_max: 90,
                mana_max: 100,
            }),
            buffs: Some(CreatureBuffs {
                highlights: 0xAABB,
                colors: 0xCCDD,
            }),
        };
        assert_pack_unpack_parity(test_fixtures::CREATURE_PROFILE, &expected);
    }

    #[test]
    fn test_weapon_profile_parity() {
        let expected = WeaponProfile {
            damage_type: 1,
            weapon_time: 20,
            weapon_skill: 15,
            damage: 5,
            damage_variance: 0.5,
            damage_mod: 1.5,
            weapon_length: 1.2,
            max_velocity: 100.0,
            weapon_offense: 10.0,
            max_velocity_estimated: 50,
        };
        assert_pack_unpack_parity(test_fixtures::WEAPON_PROFILE, &expected);
    }

    #[test]
    fn test_hook_profile_parity() {
        let expected = HookProfile {
            flags: 0x3, // HookFlags.Inscribable (0x1) | HookFlags.IsHealer (0x2)
            valid_locations: EquipMask::from_bits_truncate(0x100),
            ammo_type: 2,
        };
        assert_pack_unpack_parity(test_fixtures::HOOK_PROFILE, &expected);
    }

    #[test]
    fn test_armor_level_parity() {
        let expected = ArmorLevels {
            head: 10,
            chest: 20,
            abdomen: 30,
            upper_arm: 40,
            lower_arm: 50,
            hand: 60,
            upper_leg: 70,
            lower_leg: 80,
            foot: 90,
        };
        assert_pack_unpack_parity(test_fixtures::ARMOR_LEVEL, &expected);
    }

    #[test]
    fn test_identify_object_data_parity() {
        let expected = IdentifyObjectActionData {
            guid: Guid(0x12345678),
        };
        assert_pack_unpack_parity(test_fixtures::IDENTIFY_OBJECT_DATA, &expected);
    }

    #[test]
    fn test_use_data_parity() {
        let expected = UseActionData {
            guid: Guid(0x22222222),
        };
        assert_pack_unpack_parity(test_fixtures::USE_DATA, &expected);
    }

    #[test]
    fn test_use_with_target_data_parity() {
        let expected = UseWithTargetActionData {
            item_guid: Guid(0x33333333),
            target_guid: Guid(0x44444444),
        };
        assert_pack_unpack_parity(test_fixtures::USE_WITH_TARGET_DATA, &expected);
    }

    #[test]
    fn test_model_data_parity() {
        let expected = ModelData {
            header: 0x11,
            extra: [1, 1, 1],
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
        };
        assert_pack_unpack_parity(test_fixtures::MODEL_DATA, &expected);
    }
}
