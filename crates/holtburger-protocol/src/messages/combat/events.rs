use crate::errors::WeenieError;
use crate::messages::utils::{align_offset, pad_to_4, read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::properties::DamageType;

use super::types::{AttackConditions, DamageLocation};

#[derive(Debug, Clone, PartialEq)]
pub struct AttackDoneEventData {
    pub error: WeenieError,
}

impl ProtocolUnpack for AttackDoneEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }

        let error_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        Some(Self {
            error: WeenieError::from_repr(error_raw).unwrap_or(WeenieError::None),
        })
    }
}

impl ProtocolPack for AttackDoneEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.error as u32).to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AttackerNotificationEventData {
    pub defender_name: String,
    pub damage_type: DamageType,
    pub health_percent: f64,
    pub damage: u32,
    pub critical_hit: bool,
    pub attack_conditions: AttackConditions,
}

impl ProtocolUnpack for AttackerNotificationEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let defender_name = read_string16(data, offset)?;
        if *offset + 28 > data.len() {
            return None;
        }

        let damage_type =
            DamageType::from_bits_retain(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        let health_percent = LittleEndian::read_f64(&data[*offset + 4..*offset + 12]);
        let damage = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let critical_hit = LittleEndian::read_u32(&data[*offset + 16..*offset + 20]) != 0;
        let attack_conditions = AttackConditions::from_bits_retain(LittleEndian::read_u64(
            &data[*offset + 20..*offset + 28],
        ));
        *offset += 28;

        Some(Self {
            defender_name,
            damage_type,
            health_percent,
            damage,
            critical_hit,
            attack_conditions,
        })
    }
}

impl ProtocolPack for AttackerNotificationEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.defender_name);
        buf.extend_from_slice(&self.damage_type.bits().to_le_bytes());
        buf.extend_from_slice(&self.health_percent.to_le_bytes());
        buf.extend_from_slice(&self.damage.to_le_bytes());
        buf.extend_from_slice(&(self.critical_hit as u32).to_le_bytes());
        buf.extend_from_slice(&self.attack_conditions.bits().to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefenderNotificationEventData {
    pub attacker_name: String,
    pub damage_type: DamageType,
    pub health_percent: f64,
    pub damage: u32,
    pub damage_location: DamageLocation,
    pub critical_hit: bool,
    pub attack_conditions: AttackConditions,
}

impl ProtocolUnpack for DefenderNotificationEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let attacker_name = read_string16(data, offset)?;
        if *offset + 32 > data.len() {
            return None;
        }

        let damage_type =
            DamageType::from_bits_retain(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        let health_percent = LittleEndian::read_f64(&data[*offset + 4..*offset + 12]);
        let damage = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let damage_location_raw = LittleEndian::read_u32(&data[*offset + 16..*offset + 20]);
        let critical_hit = LittleEndian::read_u32(&data[*offset + 20..*offset + 24]) != 0;
        let attack_conditions = AttackConditions::from_bits_retain(LittleEndian::read_u64(
            &data[*offset + 24..*offset + 32],
        ));
        *offset += 32;
        align_offset(offset, 4);

        Some(Self {
            attacker_name,
            damage_type,
            health_percent,
            damage,
            damage_location: DamageLocation::from_repr(damage_location_raw)
                .unwrap_or(DamageLocation::Chest),
            critical_hit,
            attack_conditions,
        })
    }
}

impl ProtocolPack for DefenderNotificationEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.attacker_name);
        buf.extend_from_slice(&self.damage_type.bits().to_le_bytes());
        buf.extend_from_slice(&self.health_percent.to_le_bytes());
        buf.extend_from_slice(&self.damage.to_le_bytes());
        buf.extend_from_slice(&(self.damage_location as u32).to_le_bytes());
        buf.extend_from_slice(&(self.critical_hit as u32).to_le_bytes());
        buf.extend_from_slice(&self.attack_conditions.bits().to_le_bytes());
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvasionAttackerNotificationEventData {
    pub defender_name: String,
}

impl ProtocolUnpack for EvasionAttackerNotificationEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            defender_name: read_string16(data, offset)?,
        })
    }
}

impl ProtocolPack for EvasionAttackerNotificationEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.defender_name);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvasionDefenderNotificationEventData {
    pub attacker_name: String,
}

impl ProtocolUnpack for EvasionDefenderNotificationEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            attacker_name: read_string16(data, offset)?,
        })
    }
}

impl ProtocolPack for EvasionDefenderNotificationEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.attacker_name);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VictimNotificationEventData {
    pub death_message: String,
}

impl ProtocolUnpack for VictimNotificationEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            death_message: read_string16(data, offset)?,
        })
    }
}

impl ProtocolPack for VictimNotificationEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.death_message);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct KillerNotificationEventData {
    pub death_message: String,
}

impl ProtocolUnpack for KillerNotificationEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            death_message: read_string16(data, offset)?,
        })
    }
}

impl ProtocolPack for KillerNotificationEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.death_message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::WeenieError;
    use crate::messages::game_event::{GameEvent, GameEventMessage};
    use crate::test_helpers::assert_pack_unpack_parity;
    use holtburger_common::Guid;

    #[test]
    fn test_attack_done_fixture() {
        let fixture = hex::decode("B0F700000000000000000000A701000036000000").unwrap();
        let expected = crate::messages::GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0),
            sequence: 0,
            event: GameEvent::AttackDone(Box::new(AttackDoneEventData {
                error: WeenieError::ActionCancelled,
            })),
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_attacker_notification_fixture() {
        let fixture = hex::decode("B0F700000000000001000000B10100000E0044727564676520526176656E657201000000000000000000D03F25000000010000000600000000000000").unwrap();
        let expected = crate::messages::GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0),
            sequence: 1,
            event: GameEvent::AttackerNotification(Box::new(AttackerNotificationEventData {
                defender_name: "Drudge Ravener".to_string(),
                damage_type: DamageType::SLASH,
                health_percent: 0.25,
                damage: 37,
                critical_hit: true,
                attack_conditions: AttackConditions::RECKLESSNESS | AttackConditions::SNEAK_ATTACK,
            })),
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_defender_notification_fixture() {
        let fixture = hex::decode("B0F700000000000002000000B20100000A0042616E6465726C696E6710000000000000000000C03F1200000001000000000000000800000000000000").unwrap();
        let expected = crate::messages::GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0),
            sequence: 2,
            event: GameEvent::DefenderNotification(Box::new(DefenderNotificationEventData {
                attacker_name: "Banderling".to_string(),
                damage_type: DamageType::FIRE,
                health_percent: 0.125,
                damage: 18,
                damage_location: DamageLocation::Chest,
                critical_hit: false,
                attack_conditions: AttackConditions::OVERPOWER,
            })),
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_evasion_attacker_notification_fixture() {
        let fixture =
            hex::decode("B0F700000000000003000000B301000008004D6F7373776172740000").unwrap();
        let expected = crate::messages::GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0),
            sequence: 3,
            event: GameEvent::EvasionAttackerNotification(Box::new(
                EvasionAttackerNotificationEventData {
                    defender_name: "Mosswart".to_string(),
                },
            )),
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_evasion_defender_notification_fixture() {
        let fixture = hex::decode("B0F700000000000004000000B401000004004D6974650000").unwrap();
        let expected = crate::messages::GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0),
            sequence: 4,
            event: GameEvent::EvasionDefenderNotification(Box::new(
                EvasionDefenderNotificationEventData {
                    attacker_name: "Mite".to_string(),
                },
            )),
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_combat_commence_attack_fixture() {
        let fixture = hex::decode("B0F700000000000005000000B8010000").unwrap();
        let expected = crate::messages::GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0),
            sequence: 5,
            event: GameEvent::CombatCommenceAttack,
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_victim_notification_fixture() {
        let fixture =
            hex::decode("B0F700000000000006000000AC0100000E00596F752068617665206469656421")
                .unwrap();
        let expected = crate::messages::GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0),
            sequence: 6,
            event: GameEvent::VictimNotification(Box::new(VictimNotificationEventData {
                death_message: "You have died!".to_string(),
            })),
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_killer_notification_fixture() {
        let fixture = hex::decode(
            "B0F700000000000007000000AD0100001600596F75206B696C6C6564207468652064727564676521",
        )
        .unwrap();
        let expected = crate::messages::GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0),
            sequence: 7,
            event: GameEvent::KillerNotification(Box::new(KillerNotificationEventData {
                death_message: "You killed the drudge!".to_string(),
            })),
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }
}
