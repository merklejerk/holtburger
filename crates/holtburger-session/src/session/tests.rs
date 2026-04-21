use super::{Session, SessionEvent, Transport};
use anyhow::{Result, anyhow};
use async_trait::async_trait;
use byteorder::{ByteOrder, LittleEndian};
use holtburger_protocol::messages::transport::{self, packet_flags};
use holtburger_protocol::messages::*;
use holtburger_protocol::traits::{ProtocolPack, ProtocolUnpack};
use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;

type SentPacket = (SocketAddr, Vec<u8>);
type RecvPacket = (Vec<u8>, SocketAddr);
type RecvQueue = Arc<Mutex<VecDeque<RecvPacket>>>;

#[derive(Clone)]
struct ScriptedTransport {
    sent: Arc<Mutex<Vec<SentPacket>>>,
    recv: Arc<Mutex<Vec<Vec<u8>>>>,
    recv_addr: SocketAddr,
}

impl ScriptedTransport {
    fn new(recv_packets: Vec<Vec<u8>>, recv_addr: SocketAddr) -> Self {
        Self {
            sent: Arc::new(Mutex::new(Vec::new())),
            recv: Arc::new(Mutex::new(recv_packets)),
            recv_addr,
        }
    }

    async fn sent_packets(&self) -> Vec<Vec<u8>> {
        self.sent
            .lock()
            .await
            .iter()
            .map(|(_, bytes)| bytes.clone())
            .collect()
    }

    async fn sent_entries(&self) -> Vec<(SocketAddr, Vec<u8>)> {
        self.sent.lock().await.clone()
    }
}

#[async_trait]
impl Transport for ScriptedTransport {
    async fn send_to(&self, buf: &[u8], addr: SocketAddr) -> Result<usize> {
        self.sent.lock().await.push((addr, buf.to_vec()));
        Ok(buf.len())
    }

    async fn recv_from(&self, buf: &mut [u8]) -> Result<(usize, SocketAddr)> {
        let mut recv = self.recv.lock().await;
        if recv.is_empty() {
            return Err(anyhow!("Empty"));
        }

        let data = recv.remove(0);
        buf[..data.len()].copy_from_slice(&data);
        Ok((data.len(), self.recv_addr))
    }
}

#[derive(Clone)]
struct SequencedTransport {
    sent: Arc<Mutex<Vec<SentPacket>>>,
    recv: RecvQueue,
}

impl SequencedTransport {
    fn new(recv_packets: Vec<(Vec<u8>, SocketAddr)>) -> Self {
        Self {
            sent: Arc::new(Mutex::new(Vec::new())),
            recv: Arc::new(Mutex::new(recv_packets.into_iter().collect())),
        }
    }
}

#[async_trait]
impl Transport for SequencedTransport {
    async fn send_to(&self, buf: &[u8], addr: SocketAddr) -> Result<usize> {
        self.sent.lock().await.push((addr, buf.to_vec()));
        Ok(buf.len())
    }

    async fn recv_from(&self, buf: &mut [u8]) -> Result<(usize, SocketAddr)> {
        let mut recv = self.recv.lock().await;
        if let Some((data, addr)) = recv.pop_front() {
            buf[..data.len()].copy_from_slice(&data);
            Ok((data.len(), addr))
        } else {
            Err(anyhow!("Empty"))
        }
    }
}

fn build_transport_packet(header: PacketHeader, payload: &[u8]) -> Vec<u8> {
    let session = Session::new_test();
    let mut header = header;
    header.size = payload.len() as u16;

    let payload_hash = session
        .calculate_payload_hash(header.flags, payload)
        .unwrap();
    header.checksum = header.calculate_checksum().wrapping_add(payload_hash);

    let mut packet = Vec::new();
    header.pack(&mut packet);
    packet.extend_from_slice(payload);
    packet
}

fn unpack_header(packet: &[u8]) -> PacketHeader {
    let mut offset = 0;
    PacketHeader::unpack(packet, &mut offset).expect("packet header should unpack")
}

fn build_connect_request_packet(connect_request: ConnectRequestData) -> Vec<u8> {
    let mut payload = vec![0u8; transport::CONNECT_REQUEST_SIZE];
    LittleEndian::write_f64(&mut payload[0..8], connect_request.time);
    LittleEndian::write_u64(&mut payload[8..16], connect_request.cookie);
    LittleEndian::write_u32(&mut payload[16..20], u32::from(connect_request.client_id));
    LittleEndian::write_u32(&mut payload[20..24], connect_request.server_seed);
    LittleEndian::write_u32(&mut payload[24..28], connect_request.client_seed);

    build_transport_packet(
        PacketHeader {
            flags: packet_flags::CONNECT_REQUEST,
            size: payload.len() as u16,
            ..Default::default()
        },
        &payload,
    )
}

fn build_connect_response_packet(cookie: u64, client_id: u16) -> Vec<u8> {
    build_transport_packet(
        PacketHeader {
            flags: packet_flags::CONNECT_RESPONSE,
            id: client_id,
            size: transport::CONNECT_RESPONSE_SIZE as u16,
            ..Default::default()
        },
        &cookie.to_le_bytes(),
    )
}

fn build_single_fragment_packet(sequence: u32, payload: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    FragmentHeader {
        sequence: 1,
        id: 1,
        count: 1,
        index: 0,
        size: (transport::FRAGMENT_HEADER_SIZE + payload.len()) as u16,
        queue: transport::queues::GENERAL,
    }
    .pack(&mut body);
    body.extend_from_slice(payload);

    build_transport_packet(
        PacketHeader {
            sequence,
            flags: packet_flags::BLOB_FRAGMENTS,
            size: body.len() as u16,
            ..Default::default()
        },
        &body,
    )
}

#[tokio::test]
async fn test_payload_offset_handshake() {
    let session = Session::new("127.0.0.1:9000".parse().unwrap())
        .await
        .unwrap();

    assert_eq!(
        session.get_payload_offset(packet_flags::CONNECT_RESPONSE, &[0u8; 100]),
        8
    );

    assert_eq!(
        session.get_payload_offset(
            packet_flags::ACK_SEQUENCE | packet_flags::CONNECT_RESPONSE,
            &[0u8; 100]
        ),
        12
    );

    assert_eq!(
        session.get_payload_offset(packet_flags::ECHO_RESPONSE, &[0u8; 100]),
        8
    );
}

#[tokio::test]
async fn test_payload_hash_handshake() {
    let session = Session::new("127.0.0.1:9000".parse().unwrap())
        .await
        .unwrap();

    let payload = vec![1u8; 32];
    let hash = session
        .calculate_payload_hash(packet_flags::CONNECT_REQUEST, &payload)
        .unwrap();
    assert!(hash > 0);

    let expected = holtburger_protocol::crypto::Hash32::compute(&payload);
    assert_eq!(hash, expected);
}

#[tokio::test]
async fn test_payload_hash_blobs() {
    let session = Session::new("127.0.0.1:9000".parse().unwrap())
        .await
        .unwrap();

    let mut payload = vec![0u8; 16];
    LittleEndian::write_u16(&mut payload[10..12], 20);
    payload.extend_from_slice(&[1, 2, 3, 4]);

    let hash = session
        .calculate_payload_hash(packet_flags::BLOB_FRAGMENTS, &payload)
        .unwrap();

    let h1 = holtburger_protocol::crypto::Hash32::compute(&payload[0..16]);
    let h2 = holtburger_protocol::crypto::Hash32::compute(&payload[16..20]);
    assert_eq!(hash, h1.wrapping_add(h2));
}

#[test]
fn test_echo_response_hash_size() {
    let session = Session::new_test();
    let mut payload = vec![0u8; 8];
    payload[0] = 0xAA;
    payload[7] = 0xBB;

    let hash = session
        .calculate_payload_hash(packet_flags::ECHO_RESPONSE, &payload)
        .unwrap();
    let expected = holtburger_protocol::crypto::Hash32::compute(&payload);
    assert_eq!(hash, expected);
}

#[test]
fn test_encrypted_checksum_xor_logic() {
    let mut session = Session::new_test();
    let seed = 0x99E77855;
    session.isaac_c2s = Some(holtburger_protocol::crypto::Isaac::new(seed));

    let expected_key = 0xAD497DF3;

    let header = PacketHeader {
        sequence: 10,
        flags: packet_flags::ENCRYPTED_CHECKSUM,
        checksum: 0,
        id: 123,
        time: 1000,
        size: 4,
        iteration: 0,
    };

    let payload = vec![0x11, 0x22, 0x33, 0x44];

    let header_hash = header.calculate_checksum();
    let payload_hash = session
        .calculate_payload_hash(header.flags, &payload)
        .unwrap();

    let final_checksum = header_hash.wrapping_add(payload_hash ^ expected_key);

    assert_eq!(
        session.isaac_c2s.as_ref().unwrap().current_key,
        expected_key
    );

    assert_eq!(
        header_hash.wrapping_add(payload_hash ^ expected_key),
        final_checksum
    );
}

#[tokio::test]
async fn test_multi_fragment_packet_unaligned() {
    struct MultiFragMock(Arc<Mutex<Vec<Vec<u8>>>>);
    #[async_trait]
    impl Transport for MultiFragMock {
        async fn send_to(&self, _buf: &[u8], _addr: SocketAddr) -> Result<usize> {
            Ok(0)
        }
        async fn recv_from(&self, buf: &mut [u8]) -> Result<(usize, SocketAddr)> {
            let mut q = self.0.lock().await;
            if q.is_empty() {
                return Err(anyhow!("Empty"));
            }
            let data = q.remove(0);
            buf[..data.len()].copy_from_slice(&data);
            Ok((data.len(), "127.0.0.1:9000".parse().unwrap()))
        }
    }

    let hex = "71000000060000003C8E48C70B0029B157000100AD0000000000008001001D0000000900E9020000000200000001000000AE0000000000008001001D0000000900E9020000000400000001000000AF0000000000008001001D0000000900E9020000000600000001000000";
    let data = hex::decode(hex).unwrap();
    let mut header = unpack_header(&data);
    header.flags &= !packet_flags::ENCRYPTED_CHECKSUM;
    let packet = build_transport_packet(header, &data[transport::HEADER_SIZE..]);

    let q = Arc::new(Mutex::new(vec![packet]));
    let mut session = Session::new_test();
    session.transport = Box::new(MultiFragMock(q));
    session.last_server_seq = 112;
    session.has_server_seq = true;

    let events = session.recv_message().await.unwrap();

    assert_eq!(events.len(), 3);

    for (i, event) in events.iter().enumerate() {
        if let SessionEvent::Message(msg_data) = event {
            assert_eq!(msg_data.len(), 13);
            assert_eq!(msg_data[0..2], [0xE9, 0x02]);

            let vital_id = u32::from_le_bytes(msg_data[5..9].try_into().unwrap());
            let expected_id = match i {
                0 => 2,
                1 => 4,
                2 => 6,
                _ => panic!("Too many messages"),
            };
            assert_eq!(vital_id, expected_id);
        } else {
            panic!("Expected SessionEvent::Message");
        }
    }
}

#[tokio::test]
async fn test_ack_sequence_prunes_cached_packets() {
    let transport = ScriptedTransport::new(
        vec![build_transport_packet(
            PacketHeader {
                sequence: 11,
                flags: packet_flags::ACK_SEQUENCE,
                size: 4,
                ..Default::default()
            },
            &6u32.to_le_bytes(),
        )],
        "127.0.0.1:9000".parse().unwrap(),
    );

    let mut session = Session::new_test();
    session.transport = Box::new(transport);

    session
        .send_packet(
            PacketHeader {
                sequence: 5,
                flags: packet_flags::BLOB_FRAGMENTS,
                id: session.client_id,
                ..Default::default()
            },
            &[1, 2, 3, 4],
        )
        .await
        .unwrap();
    session
        .send_packet(
            PacketHeader {
                sequence: 6,
                flags: packet_flags::BLOB_FRAGMENTS,
                id: session.client_id,
                ..Default::default()
            },
            &[5, 6, 7, 8],
        )
        .await
        .unwrap();

    assert!(session.cached_packets.contains_key(&5));
    assert!(session.cached_packets.contains_key(&6));

    let mut buf = [0u8; 1024];
    let _ = session.recv_packet(&mut buf).await.unwrap();

    assert!(!session.cached_packets.contains_key(&5));
    assert!(session.cached_packets.contains_key(&6));
}

#[tokio::test]
async fn test_piggybacked_ack_still_queues_ack_for_ordered_packet() {
    let fragment_packet = build_single_fragment_packet(7, &[0xAA, 0xBB, 0xCC]);
    let fragment_payload = &fragment_packet[transport::HEADER_SIZE..];

    let mut payload = Vec::with_capacity(transport::ACK_SEQUENCE_SIZE + fragment_payload.len());
    payload.extend_from_slice(&6u32.to_le_bytes());
    payload.extend_from_slice(fragment_payload);

    let packet = build_transport_packet(
        PacketHeader {
            sequence: 7,
            flags: packet_flags::BLOB_FRAGMENTS | packet_flags::ACK_SEQUENCE,
            size: payload.len() as u16,
            ..Default::default()
        },
        &payload,
    );
    let transport = ScriptedTransport::new(vec![packet], "127.0.0.1:9000".parse().unwrap());
    let sent_handle = transport.clone();

    let mut session = Session::new_test();
    session.transport = Box::new(transport);
    session.last_server_seq = 6;
    session.has_server_seq = true;

    let events = session.recv_message().await.unwrap();
    assert_eq!(events.len(), 1);
    assert!(session.flush_pending_control_packets().await.unwrap());

    let sent_packets = sent_handle.sent_packets().await;
    assert!(
        sent_packets
            .iter()
            .any(|packet| unpack_header(packet).flags == packet_flags::ACK_SEQUENCE)
    );

    let sent_entries = sent_handle.sent_entries().await;
    assert!(sent_entries.iter().any(|(addr, packet)| {
        *addr == session.server_addr && unpack_header(packet).flags == packet_flags::ACK_SEQUENCE
    }));
}

#[test]
fn test_payload_hash_multi_fragment_unaligned_matches_wire_layout() {
    let session = Session::new_test();
    let hex = "71000000060000003C8E48C70B0029B157000100AD0000000000008001001D0000000900E9020000000200000001000000AE0000000000008001001D0000000900E9020000000400000001000000AF0000000000008001001D0000000900E9020000000600000001000000";
    let packet = hex::decode(hex).unwrap();
    let payload = &packet[transport::HEADER_SIZE..];

    let hash = session
        .calculate_payload_hash(packet_flags::BLOB_FRAGMENTS, payload)
        .unwrap();

    let expected = holtburger_protocol::crypto::Hash32::compute(&payload[0..16])
        .wrapping_add(holtburger_protocol::crypto::Hash32::compute(
            &payload[16..29],
        ))
        .wrapping_add(holtburger_protocol::crypto::Hash32::compute(
            &payload[29..45],
        ))
        .wrapping_add(holtburger_protocol::crypto::Hash32::compute(
            &payload[45..58],
        ))
        .wrapping_add(holtburger_protocol::crypto::Hash32::compute(
            &payload[58..74],
        ))
        .wrapping_add(holtburger_protocol::crypto::Hash32::compute(
            &payload[74..87],
        ));

    assert_eq!(hash, expected);
}

#[tokio::test]
async fn test_request_retransmit_sends_cached_packet() {
    let requested_sequence = 9u32;
    let retransmit_payload = [1u32.to_le_bytes(), requested_sequence.to_le_bytes()].concat();
    let transport = ScriptedTransport::new(
        vec![build_transport_packet(
            PacketHeader {
                sequence: 12,
                flags: packet_flags::REQUEST_RETRANSMIT,
                size: retransmit_payload.len() as u16,
                ..Default::default()
            },
            &retransmit_payload,
        )],
        "127.0.0.1:9000".parse().unwrap(),
    );
    let sent_handle = transport.clone();

    let mut session = Session::new_test();
    session.transport = Box::new(transport);

    session
        .send_packet(
            PacketHeader {
                sequence: requested_sequence,
                flags: packet_flags::BLOB_FRAGMENTS,
                id: session.client_id,
                ..Default::default()
            },
            &[0xAA, 0xBB, 0xCC, 0xDD],
        )
        .await
        .unwrap();

    let original_packet = sent_handle.sent_packets().await[0].clone();

    let mut buf = [0u8; 1024];
    let _ = session.recv_packet(&mut buf).await.unwrap();
    assert!(session.flush_pending_control_packets().await.unwrap());

    let sent_packets = sent_handle.sent_packets().await;
    assert_eq!(sent_packets.len(), 2);

    let original_header = unpack_header(&original_packet);
    let retransmit_header = unpack_header(&sent_packets[1]);
    assert_eq!(retransmit_header.sequence, original_header.sequence);
    assert_eq!(retransmit_header.id, original_header.id);
    assert_eq!(
        retransmit_header.flags,
        original_header.flags | packet_flags::RETRANSMISSION
    );
}

#[tokio::test]
async fn test_handshake_response_is_scheduled_and_flushed_outside_recv() {
    let connect_request = ConnectRequestData {
        time: 123.5,
        cookie: 0x1122_3344_5566_7788,
        client_id: 0x345,
        server_seed: 0x1234_5678,
        client_seed: 0x9ABC_DEF0,
    };
    let transport = ScriptedTransport::new(
        vec![build_connect_request_packet(connect_request.clone())],
        "127.0.0.1:9000".parse().unwrap(),
    );
    let sent_handle = transport.clone();

    let mut session = Session::new_test();
    session.transport = Box::new(transport);

    let events = session.recv_message().await.unwrap();
    assert_eq!(events.len(), 1);
    assert!(matches!(events[0], SessionEvent::TimeSync(time) if time == connect_request.time));
    assert_eq!(
        session.server_source_addr,
        "127.0.0.1:9000".parse().unwrap()
    );
    assert_eq!(
        session.pending_server_source_addr,
        Some("127.0.0.1:9001".parse().unwrap())
    );
    assert_eq!(session.pending_control_packets.len(), 1);
    assert!(sent_handle.sent_packets().await.is_empty());

    session
        .pending_control_packets
        .first_mut()
        .expect("handshake response should be queued")
        .ready_at = std::time::Instant::now() - std::time::Duration::from_millis(1);

    assert!(session.flush_pending_control_packets().await.unwrap());

    let sent_packets = sent_handle.sent_packets().await;
    assert_eq!(sent_packets.len(), 1);
    let header = unpack_header(&sent_packets[0]);
    assert_eq!(header.flags, packet_flags::CONNECT_RESPONSE);
    assert_eq!(header.sequence, 1);
    assert_eq!(header.id, 0);
    assert_eq!(header.size, transport::CONNECT_RESPONSE_SIZE as u16);
}

#[tokio::test]
async fn test_packets_from_activation_port_are_accepted_after_handshake_request() {
    let connect_request = ConnectRequestData {
        time: 123.5,
        cookie: 0x1122_3344_5566_7788,
        client_id: 0x345,
        server_seed: 0x1234_5678,
        client_seed: 0x9ABC_DEF0,
    };
    let transport = SequencedTransport::new(vec![
        (
            build_connect_request_packet(connect_request),
            "127.0.0.1:9000".parse().unwrap(),
        ),
        (
            build_transport_packet(
                PacketHeader {
                    flags: packet_flags::TIME_SYNC,
                    size: 8,
                    ..Default::default()
                },
                &1.25f64.to_le_bytes(),
            ),
            "127.0.0.1:9001".parse().unwrap(),
        ),
    ]);

    let mut session = Session::new_test();
    session.transport = Box::new(transport);

    let first_events = session.recv_message().await.unwrap();
    assert_eq!(first_events.len(), 1);
    assert!(matches!(first_events[0], SessionEvent::TimeSync(time) if time == 123.5));
    assert_eq!(
        session.server_source_addr,
        "127.0.0.1:9000".parse().unwrap()
    );
    assert_eq!(
        session.pending_server_source_addr,
        Some("127.0.0.1:9001".parse().unwrap())
    );

    let second_events = session.recv_message().await.unwrap();
    assert_eq!(second_events.len(), 1);
    assert!(matches!(second_events[0], SessionEvent::TimeSync(time) if time == 1.25));
    assert_eq!(
        session.server_source_addr,
        "127.0.0.1:9001".parse().unwrap()
    );
    assert_eq!(session.pending_server_source_addr, None);
}

#[tokio::test]
async fn test_packets_from_login_port_are_accepted_until_activation_port_is_confirmed() {
    let connect_request = ConnectRequestData {
        time: 123.5,
        cookie: 0x1122_3344_5566_7788,
        client_id: 0x345,
        server_seed: 0x1234_5678,
        client_seed: 0x9ABC_DEF0,
    };
    let boot_message = GameMessage::AccountBoot(Box::new(BootAccountData {
        reason: Some(" because the password entered for this account was not correct".to_string()),
    }));
    let mut boot_payload = Vec::new();
    boot_message.pack(&mut boot_payload);

    let transport = SequencedTransport::new(vec![
        (
            build_connect_request_packet(connect_request),
            "127.0.0.1:9000".parse().unwrap(),
        ),
        (
            build_single_fragment_packet(2, &boot_payload),
            "127.0.0.1:9000".parse().unwrap(),
        ),
    ]);

    let mut session = Session::new_test();
    session.transport = Box::new(transport);

    let first_events = session.recv_message().await.unwrap();
    assert_eq!(first_events.len(), 1);
    assert!(matches!(first_events[0], SessionEvent::TimeSync(time) if time == 123.5));
    assert_eq!(
        session.pending_server_source_addr,
        Some("127.0.0.1:9001".parse().unwrap())
    );

    let second_events = session.recv_message().await.unwrap();
    assert_eq!(second_events.len(), 1);
    assert!(matches!(second_events[0], SessionEvent::Message(ref msg) if msg == &boot_payload));
    assert_eq!(
        session.server_source_addr,
        "127.0.0.1:9000".parse().unwrap()
    );
    assert_eq!(
        session.pending_server_source_addr,
        Some("127.0.0.1:9001".parse().unwrap())
    );
}

#[tokio::test]
async fn test_connect_response_parses_cookie_from_optional_header_offset() {
    let cookie = 0x1122_3344_5566_7788u64;
    let client_id = 0x345u16;
    let transport = ScriptedTransport::new(
        vec![build_connect_response_packet(cookie, client_id)],
        "127.0.0.1:9000".parse().unwrap(),
    );

    let mut session = Session::new_test();
    session.transport = Box::new(transport);

    let events = session.recv_message().await.unwrap();
    assert!(events.is_empty());
    assert_eq!(session.connection_cookie, cookie);
    assert_eq!(session.client_id, client_id);
}

#[tokio::test]
async fn test_wrapped_server_sequence_zero_is_processed_as_expected() {
    let transport = ScriptedTransport::new(
        vec![build_single_fragment_packet(0, &[0xAA, 0xBB, 0xCC])],
        "127.0.0.1:9000".parse().unwrap(),
    );

    let mut session = Session::new_test();
    session.transport = Box::new(transport);
    session.last_server_seq = u32::MAX;
    session.has_server_seq = true;

    let events = session.recv_message().await.unwrap();
    assert_eq!(events.len(), 1);
    assert!(matches!(events[0], SessionEvent::Message(ref msg) if msg == &vec![0xAA, 0xBB, 0xCC]));
    assert_eq!(session.last_server_seq, 0);
}

#[tokio::test]
async fn test_out_of_order_server_packet_requests_retransmit() {
    let transport = ScriptedTransport::new(
        vec![
            build_transport_packet(
                PacketHeader {
                    sequence: 4,
                    ..Default::default()
                },
                &[],
            ),
            build_transport_packet(
                PacketHeader {
                    sequence: 2,
                    ..Default::default()
                },
                &[],
            ),
        ],
        "127.0.0.1:9000".parse().unwrap(),
    );
    let sent_handle = transport.clone();

    let mut session = Session::new_test();
    session.transport = Box::new(transport);
    session.packet_sequence = 5;
    session.last_server_seq = 1;
    session.has_server_seq = true;

    let events = session.recv_message().await.unwrap();
    assert!(events.is_empty());

    let sent_packets = sent_handle.sent_packets().await;
    let retransmit_packet = sent_packets
        .iter()
        .find(|packet| (unpack_header(packet).flags & packet_flags::REQUEST_RETRANSMIT) != 0)
        .expect("missing retransmit request packet");
    let retransmit_header = unpack_header(retransmit_packet);
    assert_eq!(retransmit_header.sequence, 4);
    assert_eq!(retransmit_header.flags, packet_flags::REQUEST_RETRANSMIT);

    let sent_entries = sent_handle.sent_entries().await;
    assert!(sent_entries.iter().any(|(addr, packet)| {
        *addr == session.server_addr
            && (unpack_header(packet).flags & packet_flags::REQUEST_RETRANSMIT) != 0
    }));

    let payload = &retransmit_packet[transport::HEADER_SIZE..];
    assert_eq!(LittleEndian::read_u32(&payload[0..4]), 2);
    assert_eq!(LittleEndian::read_u32(&payload[4..8]), 2);
    assert_eq!(LittleEndian::read_u32(&payload[8..12]), 3);
}

#[tokio::test]
async fn test_single_packet_gap_requests_retransmit() {
    let transport = ScriptedTransport::new(
        vec![build_transport_packet(
            PacketHeader {
                sequence: 3,
                ..Default::default()
            },
            &[],
        )],
        "127.0.0.1:9000".parse().unwrap(),
    );
    let sent_handle = transport.clone();

    let mut session = Session::new_test();
    session.transport = Box::new(transport);
    session.packet_sequence = 5;
    session.last_server_seq = 1;
    session.has_server_seq = true;

    let error = session.recv_message().await.unwrap_err();
    assert!(error.to_string().contains("Empty"));

    let sent_packets = sent_handle.sent_packets().await;
    let retransmit_packet = sent_packets
        .iter()
        .find(|packet| (unpack_header(packet).flags & packet_flags::REQUEST_RETRANSMIT) != 0)
        .expect("missing retransmit request packet");

    let payload = &retransmit_packet[transport::HEADER_SIZE..];
    assert_eq!(LittleEndian::read_u32(&payload[0..4]), 1);
    assert_eq!(LittleEndian::read_u32(&payload[4..8]), 2);
}

#[tokio::test]
async fn test_send_request_retransmit_wraps_sequence_window() {
    let transport = ScriptedTransport::new(vec![], "127.0.0.1:9000".parse().unwrap());
    let sent_handle = transport.clone();

    let mut session = Session::new_test();
    session.transport = Box::new(transport);
    session.last_server_seq = u32::MAX;

    session.send_request_retransmit(1).unwrap();
    assert!(session.flush_pending_control_packets().await.unwrap());

    let sent_packets = sent_handle.sent_packets().await;
    let retransmit_packet = sent_packets
        .iter()
        .find(|packet| (unpack_header(packet).flags & packet_flags::REQUEST_RETRANSMIT) != 0)
        .expect("missing retransmit request packet");

    let payload = &retransmit_packet[transport::HEADER_SIZE..];
    assert_eq!(LittleEndian::read_u32(&payload[0..4]), 1);
    assert_eq!(LittleEndian::read_u32(&payload[4..8]), 0);
}

#[tokio::test]
async fn test_queued_ack_uses_latest_client_sequence_when_flushed() {
    let transport = ScriptedTransport::new(vec![], "127.0.0.1:9000".parse().unwrap());
    let sent_handle = transport.clone();

    let mut session = Session::new_test();
    session.transport = Box::new(transport);
    session.packet_sequence = 2;
    session.client_id = 0x123;

    session.queue_ack(0x55).unwrap();

    let header = PacketHeader {
        sequence: session.packet_sequence,
        flags: packet_flags::BLOB_FRAGMENTS,
        id: session.client_id,
        ..Default::default()
    };
    session.packet_sequence += 1;
    session.send_packet(header, &[]).await.unwrap();

    assert!(session.flush_pending_control_packets().await.unwrap());

    let sent_packets = sent_handle.sent_packets().await;
    assert_eq!(sent_packets.len(), 2);
    assert_eq!(unpack_header(&sent_packets[0]).sequence, 2);

    let ack_header = unpack_header(&sent_packets[1]);
    assert_eq!(ack_header.flags, packet_flags::ACK_SEQUENCE);
    assert_eq!(ack_header.sequence, 2);
}

#[test]
fn test_read_sequence_list_rejects_oversized_count() {
    let session = Session::new_test();
    let count = (crate::session::types::MAX_RETRANSMIT_SEQUENCE_IDS + 1) as u32;
    let payload = count.to_le_bytes();

    let result = session.read_sequence_list(
        packet_flags::REQUEST_RETRANSMIT,
        &payload,
        packet_flags::REQUEST_RETRANSMIT,
    );
    assert!(result.is_none());
}

#[test]
fn test_build_packet_bytes_rejects_payloads_larger_than_u16() {
    let mut session = Session::new_test();
    let payload = vec![0u8; u16::MAX as usize + 1];

    let err = session.send_packet_to_addr(
        PacketHeader {
            flags: packet_flags::BLOB_FRAGMENTS,
            sequence: 1,
            ..Default::default()
        },
        &payload,
        session.server_addr,
    );

    let runtime = tokio::runtime::Runtime::new().expect("runtime should build");
    let err = runtime.block_on(err).unwrap_err();
    assert!(err.to_string().contains("packet payload too large"));
}

#[test]
fn test_build_cleartext_control_packet_rejects_payloads_larger_than_u16() {
    let mut session = Session::new_test();
    let payload = vec![0u8; u16::MAX as usize + 1];

    let err = session
        .queue_deferred_cleartext_control_packet(
            PacketHeader {
                flags: packet_flags::ACK_SEQUENCE,
                ..Default::default()
            },
            &payload,
            session.server_addr,
            std::time::Instant::now(),
            false,
        )
        .unwrap_err();

    assert!(err.to_string().contains("packet payload too large"));
}

#[test]
fn test_handshake_request_rejects_activation_port_overflow() {
    let mut session = Session::new_test();
    session.server_addr = "127.0.0.1:65535".parse().unwrap();

    let err = session
        .handle_handshake_request(ConnectRequestData {
            time: 1.0,
            cookie: 0x1122_3344_5566_7788,
            client_id: 0x345,
            server_seed: 0x1234_5678,
            client_seed: 0x9ABC_DEF0,
        })
        .unwrap_err();

    assert!(err.to_string().contains("activation port overflow"));
}

#[tokio::test]
async fn test_first_server_packet_sequence_two_does_not_request_retransmit() {
    let transport = ScriptedTransport::new(
        vec![build_transport_packet(
            PacketHeader {
                sequence: 2,
                flags: packet_flags::TIME_SYNC,
                size: 8,
                ..Default::default()
            },
            &0.0f64.to_le_bytes(),
        )],
        "127.0.0.1:9000".parse().unwrap(),
    );
    let sent_handle = transport.clone();

    let mut session = Session::new_test();
    session.transport = Box::new(transport);

    let events = session.recv_message().await.unwrap();
    assert_eq!(events.len(), 1);
    assert!(matches!(events[0], SessionEvent::TimeSync(_)));

    let sent_packets = sent_handle.sent_packets().await;
    assert!(
        sent_packets.iter().all(|packet| {
            (unpack_header(packet).flags & packet_flags::REQUEST_RETRANSMIT) == 0
        })
    );
}

#[tokio::test]
async fn test_retransmit_uses_cached_packet_with_piggybacked_ack() {
    let requested_sequence = 9u32;
    let retransmit_payload = [1u32.to_le_bytes(), requested_sequence.to_le_bytes()].concat();
    let transport = ScriptedTransport::new(
        vec![build_transport_packet(
            PacketHeader {
                sequence: 50,
                flags: packet_flags::REQUEST_RETRANSMIT,
                size: retransmit_payload.len() as u16,
                ..Default::default()
            },
            &retransmit_payload,
        )],
        "127.0.0.1:9000".parse().unwrap(),
    );
    let sent_handle = transport.clone();

    let mut session = Session::new_test();
    session.transport = Box::new(transport);
    session.has_server_seq = true;
    session.last_server_seq = 42;

    session
        .send_packet(
            PacketHeader {
                sequence: requested_sequence,
                flags: packet_flags::BLOB_FRAGMENTS,
                id: session.client_id,
                ..Default::default()
            },
            &[0xAA, 0xBB, 0xCC, 0xDD],
        )
        .await
        .unwrap();

    let original_packet = sent_handle.sent_packets().await[0].clone();
    let original_header = unpack_header(&original_packet);
    assert_ne!(original_header.flags & packet_flags::ACK_SEQUENCE, 0);

    let mut buf = [0u8; 1024];
    let _ = session.recv_packet(&mut buf).await.unwrap();
    assert!(session.flush_pending_control_packets().await.unwrap());

    let sent_packets = sent_handle.sent_packets().await;
    assert_eq!(sent_packets.len(), 2);

    let retransmit_header = unpack_header(&sent_packets[1]);
    assert_eq!(retransmit_header.sequence, original_header.sequence);
    assert_eq!(
        retransmit_header.flags,
        original_header.flags | packet_flags::RETRANSMISSION
    );
}
