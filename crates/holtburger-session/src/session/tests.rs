use super::{Session, SessionEvent, Transport};
use anyhow::{Result, anyhow};
use async_trait::async_trait;
use byteorder::{ByteOrder, LittleEndian};
use holtburger_protocol::messages::transport::{self, packet_flags};
use holtburger_protocol::messages::*;
use holtburger_protocol::traits::{ProtocolPack, ProtocolUnpack};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
struct ScriptedTransport {
    sent: Arc<Mutex<Vec<Vec<u8>>>>,
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
        self.sent.lock().await.clone()
    }
}

#[async_trait]
impl Transport for ScriptedTransport {
    async fn send_to(&self, buf: &[u8], _addr: SocketAddr) -> Result<usize> {
        self.sent.lock().await.push(buf.to_vec());
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

fn build_transport_packet(header: PacketHeader, payload: &[u8]) -> Vec<u8> {
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
            Ok((data.len(), "127.0.0.1:9001".parse().unwrap()))
        }
    }

    let hex = "71000000060000003C8E48C70B0029B157000100AD0000000000008001001D0000000900E9020000000200000001000000AE0000000000008001001D0000000900E9020000000400000001000000AF0000000000008001001D0000000900E9020000000600000001000000";
    let data = hex::decode(hex).unwrap();

    let q = Arc::new(Mutex::new(vec![data]));
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
        "127.0.0.1:9001".parse().unwrap(),
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
async fn test_request_retransmit_replays_cached_packet() {
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
        "127.0.0.1:9001".parse().unwrap(),
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
async fn test_connect_response_parses_cookie_from_optional_header_offset() {
    let cookie = 0x1122_3344_5566_7788u64;
    let client_id = 0x345u16;
    let transport = ScriptedTransport::new(
        vec![build_connect_response_packet(cookie, client_id)],
        "127.0.0.1:9001".parse().unwrap(),
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
        "127.0.0.1:9001".parse().unwrap(),
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
        "127.0.0.1:9001".parse().unwrap(),
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
        "127.0.0.1:9001".parse().unwrap(),
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
    let transport = ScriptedTransport::new(vec![], "127.0.0.1:9001".parse().unwrap());
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
        "127.0.0.1:9001".parse().unwrap(),
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
        "127.0.0.1:9001".parse().unwrap(),
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
