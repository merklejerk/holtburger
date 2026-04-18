use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::Guid;

#[derive(Debug, Clone, PartialEq)]
pub struct FellowshipCreateActionData {
    pub name: String,
    pub share_xp: bool,
}

impl ProtocolUnpack for FellowshipCreateActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let name = read_string16(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let share_xp = u32::from_le_bytes(data[*offset..*offset + 4].try_into().ok()?) != 0;
        *offset += 4;
        Some(Self { name, share_xp })
    }
}

impl ProtocolPack for FellowshipCreateActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.name);
        buf.extend_from_slice(&u32::from(self.share_xp).to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FellowshipRecruitActionData {
    pub player_guid: Guid,
}

impl ProtocolUnpack for FellowshipRecruitActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let player_guid = Guid(u32::from_le_bytes(
            data[*offset..*offset + 4].try_into().ok()?,
        ));
        *offset += 4;
        Some(Self { player_guid })
    }
}

impl ProtocolPack for FellowshipRecruitActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.player_guid.0.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FellowshipQuitActionData {
    pub disband: bool,
}

impl ProtocolUnpack for FellowshipQuitActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let disband = u32::from_le_bytes(data[*offset..*offset + 4].try_into().ok()?) != 0;
        *offset += 4;
        Some(Self { disband })
    }
}

impl ProtocolPack for FellowshipQuitActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&u32::from(self.disband).to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FellowshipDismissActionData {
    pub player_guid: Guid,
}

impl ProtocolUnpack for FellowshipDismissActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let player_guid = Guid(u32::from_le_bytes(
            data[*offset..*offset + 4].try_into().ok()?,
        ));
        *offset += 4;
        Some(Self { player_guid })
    }
}

impl ProtocolPack for FellowshipDismissActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.player_guid.0.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FellowshipAssignNewLeaderActionData {
    pub new_leader_guid: Guid,
}

impl ProtocolUnpack for FellowshipAssignNewLeaderActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }

        let new_leader_guid = Guid(u32::from_le_bytes(
            data[*offset..*offset + 4].try_into().ok()?,
        ));
        *offset += 4;
        Some(Self { new_leader_guid })
    }
}

impl ProtocolPack for FellowshipAssignNewLeaderActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.new_leader_guid.0.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FellowshipUpdateRequestActionData {
    pub panel_open: bool,
}

impl ProtocolUnpack for FellowshipUpdateRequestActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }

        let panel_open = u32::from_le_bytes(data[*offset..*offset + 4].try_into().ok()?) != 0;
        *offset += 4;
        Some(Self { panel_open })
    }
}

impl ProtocolPack for FellowshipUpdateRequestActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&u32::from(self.panel_open).to_le_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_fellowship_create_fixture() {
        let action = GameActionMessage {
            sequence: 0x01020304,
            action: GameAction::FellowshipCreate(Box::new(FellowshipCreateActionData {
                name: "Raid Bus".to_string(),
                share_xp: true,
            })),
        };

        let fixture = hex::decode("04030201A200000008005261696420427573000001000000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_fellowship_recruit_fixture() {
        let action = GameActionMessage {
            sequence: 0x11223344,
            action: GameAction::FellowshipRecruit(Box::new(FellowshipRecruitActionData {
                player_guid: Guid(0x50000042),
            })),
        };

        let fixture = hex::decode("44332211A500000042000050").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_fellowship_quit_fixture() {
        let action = GameActionMessage {
            sequence: 0x55667788,
            action: GameAction::FellowshipQuit(Box::new(FellowshipQuitActionData {
                disband: false,
            })),
        };

        let fixture = hex::decode("88776655A300000000000000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_fellowship_dismiss_fixture() {
        let action = GameActionMessage {
            sequence: 0x99AABBCC,
            action: GameAction::FellowshipDismiss(Box::new(FellowshipDismissActionData {
                player_guid: Guid(0x50000099),
            })),
        };

        let fixture = hex::decode("CCBBAA99A400000099000050").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_fellowship_assign_new_leader_fixture() {
        let action = GameActionMessage {
            sequence: 0x01020304,
            action: GameAction::FellowshipAssignNewLeader(Box::new(
                FellowshipAssignNewLeaderActionData {
                    new_leader_guid: Guid(0x50000042),
                },
            )),
        };

        let fixture = hex::decode("040302019002000042000050").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_fellowship_update_request_fixture() {
        let action = GameActionMessage {
            sequence: 0x1234ABCD,
            action: GameAction::FellowshipUpdateRequest(Box::new(
                FellowshipUpdateRequestActionData { panel_open: true },
            )),
        };

        let fixture = hex::decode("CDAB3412A600000001000000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }
}
