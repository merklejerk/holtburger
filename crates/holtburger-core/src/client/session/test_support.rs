use byteorder::{LittleEndian, ReadBytesExt};
use holtburger_protocol::messages::game_action::GameAction;
use holtburger_protocol::messages::game_message::GameMessage;
use holtburger_protocol::messages::transport::{FragmentHeader, PacketHeader, packet_flags};
use holtburger_protocol::traits::ProtocolUnpack;
use std::io::{Cursor, Read};

/// Decode the unfragmented outbound actions produced by an isolated test session.
pub(crate) fn captured_actions(file: &tempfile::NamedTempFile) -> Vec<GameAction> {
    let bytes = std::fs::read(file.path()).unwrap();
    let mut capture = Cursor::new(bytes.as_slice());
    let mut actions = Vec::new();
    while (capture.position() as usize) < bytes.len() {
        assert_eq!(
            capture.read_u8().unwrap(),
            holtburger_session::capture::Direction::Outbound as u8
        );
        capture.read_u64::<LittleEndian>().unwrap();
        let address_len = capture.read_u16::<LittleEndian>().unwrap();
        capture.set_position(capture.position() + u64::from(address_len));
        let packet_len = capture.read_u32::<LittleEndian>().unwrap();
        let mut packet = vec![0; packet_len as usize];
        capture.read_exact(&mut packet).unwrap();
        let mut offset = 0;
        let header = PacketHeader::unpack(&packet, &mut offset).unwrap();
        assert_eq!(header.flags, packet_flags::BLOB_FRAGMENTS);
        let fragment = FragmentHeader::unpack(&packet, &mut offset).unwrap();
        assert_eq!(fragment.count, 1);
        let GameMessage::GameAction(message) = GameMessage::unpack(&packet, &mut offset).unwrap()
        else {
            panic!("test fixture emitted a non-action message");
        };
        assert_eq!(offset, packet.len());
        actions.push(message.action);
    }
    actions
}
