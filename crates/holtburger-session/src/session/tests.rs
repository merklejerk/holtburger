use super::types::*;
use super::{Session, SessionEvent, Transport};
use crate::optional_header::OptionalHeaderCursor;
use anyhow::{Result, anyhow};
use async_trait::async_trait;
use byteorder::{ByteOrder, LittleEndian};
use futures::{FutureExt, task::AtomicWaker};
use holtburger_protocol::crypto::Isaac;
use holtburger_protocol::messages::transport::{self, packet_flags};
use holtburger_protocol::messages::*;
use holtburger_protocol::traits::{ProtocolPack, ProtocolUnpack};
use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::task::Poll;
use tokio::time::{Instant, advance};

/// Gate reads and writes independently; Pending never consumes or commits a datagram.
#[derive(Default)]
struct TransportState {
    incoming: VecDeque<(Vec<u8>, SocketAddr)>,
    sent: Vec<Vec<u8>>,
    writes_blocked: bool,
    fail_send: bool,
    short_send: bool,
    read_calls: usize,
}

#[derive(Clone, Default)]
struct ScriptedTransport {
    state: Arc<Mutex<TransportState>>,
    read_waker: Arc<AtomicWaker>,
    write_waker: Arc<AtomicWaker>,
    sent_notify: Arc<tokio::sync::Notify>,
}

impl ScriptedTransport {
    fn new(packets: Vec<Vec<u8>>, addr: SocketAddr) -> Self {
        let transport = Self::default();
        for packet in packets {
            transport.push_from(packet, addr);
        }
        transport
    }
    fn push(&self, packet: Vec<u8>) {
        self.push_from(packet, "127.0.0.1:9000".parse().unwrap());
    }
    fn push_from(&self, packet: Vec<u8>, addr: SocketAddr) {
        self.state
            .lock()
            .unwrap()
            .incoming
            .push_back((packet, addr));
        self.read_waker.wake();
    }
    fn block_writes(&self, blocked: bool) {
        self.state.lock().unwrap().writes_blocked = blocked;
        self.write_waker.wake();
    }
    async fn sent_packets(&self) -> Vec<Vec<u8>> {
        self.state.lock().unwrap().sent.clone()
    }
    async fn wait_for_sent(&self, count: usize) {
        loop {
            let notified = self.sent_notify.notified();
            if self.state.lock().unwrap().sent.len() >= count {
                return;
            }
            notified.await;
        }
    }
}

#[async_trait]
impl Transport for ScriptedTransport {
    async fn send_to(&self, bytes: &[u8], _addr: SocketAddr) -> Result<usize> {
        std::future::poll_fn(|cx| {
            self.write_waker.register(cx.waker());
            let mut state = self.state.lock().unwrap();
            if state.fail_send {
                return Poll::Ready(Err(anyhow!("Synthetic send failure")));
            }
            if state.writes_blocked {
                return Poll::Pending;
            }
            if state.short_send {
                return Poll::Ready(Ok(bytes.len() - 1));
            }
            state.sent.push(bytes.to_vec());
            self.sent_notify.notify_one();
            Poll::Ready(Ok(bytes.len()))
        })
        .await
    }
    async fn recv_from(&self, bytes: &mut [u8]) -> Result<(usize, SocketAddr)> {
        std::future::poll_fn(|cx| {
            self.read_waker.register(cx.waker());
            let mut state = self.state.lock().unwrap();
            state.read_calls += 1;
            let Some((packet, addr)) = state.incoming.pop_front() else {
                return Poll::Pending;
            };
            let len = packet.len().min(bytes.len());
            bytes[..len].copy_from_slice(&packet[..len]);
            Poll::Ready(Ok((len, addr)))
        })
        .await
    }
}

fn connected(transport: &ScriptedTransport) -> Session {
    let mut session = Session::new_test();
    session.transport = Box::new(transport.clone());
    session.packet_sequence = 2;
    session.last_sent_client_sequence = 1;
    session.has_server_seq = true;
    session.last_control_scheduled = Some(Instant::now());
    session
}

fn control(sequence: u32, flags: u32, payload: &[u8]) -> Vec<u8> {
    build_transport_packet(
        PacketHeader {
            sequence,
            flags,
            ..Default::default()
        },
        payload,
    )
}

fn encrypted_packet(sequence: u32, payload: &[u8], crypto: &mut Isaac) -> Vec<u8> {
    let mut bytes = build_single_fragment_packet(sequence, payload);
    let mut header = unpack_header(&bytes);
    header.flags |= packet_flags::ENCRYPTED_CHECKSUM;
    let hash = Session::new_test()
        .calculate_payload_hash(header.flags, &bytes[transport::HEADER_SIZE..])
        .unwrap();
    header.checksum = header
        .calculate_checksum()
        .wrapping_add(hash ^ crypto.current_key);
    crypto.consume_key();
    let mut head = Vec::new();
    header.pack(&mut head);
    bytes[..transport::HEADER_SIZE].copy_from_slice(&head);
    bytes
}

fn logout_message() -> GameMessage {
    GameMessage::CharacterLogOff
}

fn request_ids(bytes: &[u8]) -> Vec<u32> {
    let header = unpack_header(bytes);
    Session::new_test()
        .read_sequence_list(
            header.flags,
            &bytes[transport::HEADER_SIZE..],
            packet_flags::REQUEST_RETRANSMIT,
        )
        .unwrap()
}

async fn delivered_byte(session: &mut Session, byte: u8) {
    let events = session.recv_message().await.unwrap();
    assert!(matches!(events.as_slice(), [SessionEvent::Message(message)] if message == &[byte]));
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
    let session = Session::new_test();

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
    let session = Session::new_test();

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
    let session = Session::new_test();

    let mut payload = vec![0u8; 16];
    LittleEndian::write_u16(&mut payload[8..10], 1);
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

/// ACE NetworkSession.SendBundle keeps UIQueue messages ordered when stock spans packets.
/// Datagram reordering must not let the terminal UseDone overtake sale receipts or refresh.
#[tokio::test]
async fn fragmented_vendor_refresh_preserves_sale_receipts_before_completion() {
    use holtburger_common::Guid;
    use holtburger_common::properties::InventoryEntryKind;
    use holtburger_protocol::errors::WeenieError;

    const UI_QUEUE: u16 = 9;
    let vendor = Guid(100);
    let receipt = |item| {
        GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
            item_guid: Guid(item),
            container_guid: vendor,
            slot: 0,
            container_type: InventoryEntryKind::Item,
        }))
    };
    let expected = vec![
        receipt(200),
        GameEvent::ApproachVendor(Box::new(ApproachVendorEventData {
            vendor_guid: vendor,
            items: (0..100)
                .map(|index| VendorItemEventData {
                    packed_stack_size: u32::MAX,
                    description: PublicWeenieDescription {
                        guid: Guid(1000 + index),
                        name: Some(format!("Vendor offer {index}")),
                        icon_id: 0x06000010,
                        ..Default::default()
                    },
                })
                .collect(),
            ..Default::default()
        })),
        receipt(201),
        GameEvent::UseDone(Box::new(UseDoneEventData {
            error: WeenieError::None,
        })),
    ];
    let chunk_size =
        transport::MAX_PACKET_SIZE - transport::HEADER_SIZE - transport::FRAGMENT_HEADER_SIZE;
    let mut packets = Vec::new();
    for (index, event) in expected.iter().enumerate() {
        let mut message = Vec::new();
        GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(1),
            sequence: index as u32 + 1,
            event: event.clone(),
        }))
        .pack(&mut message);
        let count = message.len().div_ceil(chunk_size);
        if index == 1 {
            assert!(count > 1, "Stock fixture must actually fragment");
        }
        for (part, data) in message.chunks(chunk_size).enumerate() {
            let mut body = Vec::new();
            FragmentHeader {
                sequence: index as u32 + 1,
                id: 1,
                count: count as u16,
                index: part as u16,
                size: (transport::FRAGMENT_HEADER_SIZE + data.len()) as u16,
                queue: UI_QUEUE,
            }
            .pack(&mut body);
            body.extend_from_slice(data);
            packets.push(build_transport_packet(
                PacketHeader {
                    sequence: packets.len() as u32 + 2,
                    flags: packet_flags::BLOB_FRAGMENTS,
                    ..Default::default()
                },
                &body,
            ));
        }
    }
    let packet_count = packets.len();
    // Completion physically arrives before the fragmented catalog and second receipt.
    packets.swap(1, packet_count - 1);
    let mut session = Session::new_test();
    session.has_server_seq = true;
    session.last_server_seq = 1;
    session.transport = Box::new(ScriptedTransport::new(packets, session.server_addr));
    let mut actual = Vec::new();
    for _ in 0..packet_count {
        for event in session.recv_message().await.unwrap() {
            let SessionEvent::Message(bytes) = event else {
                panic!("Unexpected clock update")
            };
            let GameMessage::GameEvent(message) = GameMessage::unpack(&bytes, &mut 0).unwrap()
            else {
                panic!("Expected UI event")
            };
            actual.push(message.event);
        }
    }
    assert_eq!(actual, expected);
}

/// InfiniteLeaftide mirror 975060438fa0f44c4e5aa3f0cdd4adf409184cab,
/// NetworkSession.Retransmit: any missing cached server packet forces player logout.
#[derive(Default)]
struct StrictPeer {
    cache: std::collections::BTreeSet<u32>,
    forced_logout: bool,
}
impl StrictPeer {
    fn process(&mut self, bytes: &[u8]) {
        let header = unpack_header(bytes);
        let payload = &bytes[transport::HEADER_SIZE..];
        let session = Session::new_test();
        if header.flags & packet_flags::ACK_SEQUENCE != 0 {
            let ack = session.read_ack_sequence(header.flags, payload).unwrap();
            self.cache.retain(|sequence| *sequence >= ack);
        }
        if header.flags & packet_flags::REQUEST_RETRANSMIT != 0 {
            self.forced_logout |= request_ids(bytes).iter().any(|id| !self.cache.contains(id));
        }
    }
}

#[tokio::test(start_paused = true)]
async fn captured_reorder_avoids_the_strict_peers_cache_miss_logout() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    session.last_server_seq = 10431;
    advance(ACK_INTERVAL).await;
    transport.push(build_single_fragment_packet(10433, &[3]));
    transport.push(build_single_fragment_packet(10432, &[2]));
    delivered_byte(&mut session, 2).await;
    delivered_byte(&mut session, 3).await;
    let sent = transport.sent_packets().await;
    assert!(
        sent.iter()
            .all(|packet| unpack_header(packet).flags & packet_flags::REQUEST_RETRANSMIT == 0)
    );
    let mut peer = StrictPeer {
        cache: [10432, 10433].into(),
        ..Default::default()
    };
    for packet in &sent {
        peer.process(packet);
    }
    assert!(!peer.forced_logout);
    assert!(!peer.cache.contains(&10432));
    // Prove this peer detects the actual race, instead of accepting all client traffic.
    peer.process(&control(
        1,
        packet_flags::REQUEST_RETRANSMIT,
        &Session::pack_sequence_list(&[10432]),
    ));
    assert!(peer.forced_logout);
}

#[tokio::test(start_paused = true)]
async fn due_recovery_drains_ingress_even_between_the_strict_boundary_and_idle_wake() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    for byte in [2, 3, 5] {
        transport.push(build_single_fragment_packet(u32::from(byte), &[byte]));
    }
    delivered_byte(&mut session, 2).await;
    // Earlier content is still ready, but the deadline now permits a request for packet 4.
    advance(REQUEST_RETRANSMIT_INTERVAL + std::time::Duration::from_nanos(1)).await;
    transport.push(build_single_fragment_packet(4, &[4]));
    delivered_byte(&mut session, 3).await;
    assert!(transport.sent_packets().await.is_empty());
    assert!(!session.reliability().receive_gap);
    delivered_byte(&mut session, 4).await;
    delivered_byte(&mut session, 5).await;
}

#[tokio::test(start_paused = true)]
async fn pending_recovery_drains_ingress_before_sending_while_earlier_content_is_ready() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    for byte in [2, 3, 4, 6] {
        transport.push(build_single_fragment_packet(u32::from(byte), &[byte]));
    }
    delivered_byte(&mut session, 2).await;
    advance(REQUEST_RETRANSMIT_INTERVAL + CONTROL_TIMER_TICK).await;
    transport.block_writes(true);
    delivered_byte(&mut session, 3).await;
    transport.push(build_single_fragment_packet(5, &[5]));
    transport.block_writes(false);
    delivered_byte(&mut session, 4).await;
    assert!(transport.sent_packets().await.is_empty());
    assert!(!session.reliability().receive_gap);
    delivered_byte(&mut session, 5).await;
    delivered_byte(&mut session, 6).await;
}

#[tokio::test(start_paused = true)]
async fn loss_retries_while_idle_and_uses_the_shared_strict_clock() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    transport.push(build_single_fragment_packet(3, &[3]));
    assert!(session.recv_message().now_or_never().is_none());
    advance(REQUEST_RETRANSMIT_INTERVAL).await;
    assert!(session.recv_message().now_or_never().is_none());
    assert!(transport.sent_packets().await.is_empty());
    advance(std::time::Duration::from_nanos(1)).await;
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(request_ids(&transport.sent_packets().await[0]), vec![2]);
    advance(REQUEST_RETRANSMIT_INTERVAL + std::time::Duration::from_nanos(1)).await;
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(transport.sent_packets().await.len(), 2);
    transport.push(build_single_fragment_packet(2, &[2]));
    delivered_byte(&mut session, 2).await;
    delivered_byte(&mut session, 3).await;
    advance(ACK_INTERVAL - std::time::Duration::from_nanos(1)).await;
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(transport.sent_packets().await.len(), 2);
    advance(std::time::Duration::from_nanos(1)).await;
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(
        unpack_header(&transport.sent_packets().await[2]).flags,
        packet_flags::ACK_SEQUENCE
    );
}

#[tokio::test(start_paused = true)]
async fn timer_wakes_recovery_without_another_inbound_packet() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    transport.push(build_single_fragment_packet(3, &[3]));
    let task = tokio::spawn(async move { session.recv_message().await });
    tokio::task::yield_now().await;
    advance(REQUEST_RETRANSMIT_INTERVAL + CONTROL_TIMER_TICK).await;
    tokio::time::timeout(REQUEST_RETRANSMIT_INTERVAL, transport.wait_for_sent(1))
        .await
        .unwrap();
    assert_eq!(request_ids(&transport.sent_packets().await[0]), vec![2]);
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
}

#[tokio::test(start_paused = true)]
async fn game_sends_piggyback_only_a_due_ack_and_never_piggyback_a_nak() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    session.send_message(&logout_message()).await.unwrap();
    assert_eq!(
        unpack_header(&transport.sent_packets().await[0]).flags & packet_flags::ACK_SEQUENCE,
        0
    );
    advance(ACK_INTERVAL).await;
    session.send_message(&logout_message()).await.unwrap();
    assert_ne!(
        unpack_header(&transport.sent_packets().await[1]).flags & packet_flags::ACK_SEQUENCE,
        0
    );
    transport.push(build_single_fragment_packet(3, &[3]));
    advance(REQUEST_RETRANSMIT_INTERVAL + std::time::Duration::from_nanos(1)).await;
    session.send_message(&logout_message()).await.unwrap();
    let sent = transport.sent_packets().await;
    assert_eq!(
        unpack_header(&sent[2]).flags,
        packet_flags::REQUEST_RETRANSMIT
    );
    assert_eq!(request_ids(&sent[2]), vec![2]);
    assert_eq!(
        unpack_header(&sent[3]).flags
            & (packet_flags::REQUEST_RETRANSMIT | packet_flags::ACK_SEQUENCE),
        0
    );
}

#[tokio::test(start_paused = true)]
async fn cancelled_pending_request_is_recompiled_after_send_path_ingress() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    transport.push(build_single_fragment_packet(3, &[3]));
    advance(ACK_INTERVAL).await;
    transport.block_writes(true);
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(session.pending_packets.len(), 1);
    let stamp = session.last_control_scheduled;
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(session.pending_packets.len(), 1);
    assert_eq!(session.last_control_scheduled, stamp);
    transport.push(build_single_fragment_packet(2, &[2]));
    transport.block_writes(false);
    session.send_message(&logout_message()).await.unwrap();
    assert!(
        transport
            .sent_packets()
            .await
            .iter()
            .all(|packet| unpack_header(packet).flags & packet_flags::REQUEST_RETRANSMIT == 0)
    );
    delivered_byte(&mut session, 2).await;
    delivered_byte(&mut session, 3).await;
}

#[tokio::test(start_paused = true)]
async fn pending_ack_keeps_its_safe_boundary_when_a_later_hole_appears() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    advance(ACK_INTERVAL).await;
    transport.block_writes(true);
    assert!(session.recv_message().now_or_never().is_none());
    transport.push(build_single_fragment_packet(3, &[3]));
    transport.block_writes(false);
    assert!(session.recv_message().now_or_never().is_none());
    let bytes = transport.sent_packets().await;
    assert_eq!(
        LittleEndian::read_u32(&bytes[0][transport::HEADER_SIZE..]),
        1
    );
    assert!(session.reliability().receive_gap);
}

#[tokio::test(start_paused = true)]
async fn encrypted_originals_and_duplicates_preserve_keys_before_and_after_delivery() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    let seed = 7;
    session.isaac_s2c = Some(Isaac::new(seed));
    let mut peer = Isaac::new(seed);
    let first = encrypted_packet(2, &[2], &mut peer);
    let second = encrypted_packet(3, &[3], &mut peer);
    transport.push(second.clone());
    assert!(session.recv_message().now_or_never().is_none());
    let key = session.isaac_s2c.as_ref().unwrap().current_key;
    transport.push(second.clone());
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(session.isaac_s2c.as_ref().unwrap().current_key, key);
    let mut corrupt = first.clone();
    corrupt[8] ^= 1;
    transport.push(corrupt);
    transport.push(first);
    delivered_byte(&mut session, 2).await;
    delivered_byte(&mut session, 3).await;
    let key_after_recovery = session.isaac_s2c.as_ref().unwrap().current_key;
    transport.push(second);
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(session.reliability().received.packets, 2);
    assert_eq!(
        session.isaac_s2c.as_ref().unwrap().current_key,
        key_after_recovery
    );
}

#[tokio::test(start_paused = true)]
async fn pending_original_survives_cancellation_and_precedes_later_originals() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    session.isaac_c2s = Some(Isaac::new(7));
    transport.block_writes(true);
    assert!(
        session
            .send_message(&logout_message())
            .now_or_never()
            .is_none()
    );
    let next = session.packet_sequence;
    let key = session.isaac_c2s.as_ref().unwrap().current_key;
    assert_eq!(session.pending_packets.len(), 1);
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(session.packet_sequence, next);
    assert_eq!(session.isaac_c2s.as_ref().unwrap().current_key, key);
    transport.block_writes(false);
    session.send_message(&logout_message()).await.unwrap();
    let bytes = transport.sent_packets().await;
    assert_eq!(
        bytes
            .iter()
            .map(|packet| unpack_header(packet).sequence)
            .collect::<Vec<_>>(),
        vec![2, 3]
    );
    assert_eq!(session.cached_packets.len(), 2);
    assert!(session.pending_packets.is_empty());
}

#[tokio::test(start_paused = true)]
async fn cache_strips_ack_and_repair_reuses_the_original_key() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    let seed = 9;
    let mut peer = Isaac::new(seed);
    let original_key = peer.current_key;
    session.isaac_c2s = Some(Isaac::new(seed));
    advance(ACK_INTERVAL).await;
    session.send_message(&logout_message()).await.unwrap();
    let original = transport.sent_packets().await[0].clone();
    assert_ne!(
        unpack_header(&original).flags & packet_flags::ACK_SEQUENCE,
        0
    );
    let retained = &session.cached_packets[&2].bytes;
    assert_eq!(
        unpack_header(retained).flags & packet_flags::ACK_SEQUENCE,
        0
    );
    let next_key = session.isaac_c2s.as_ref().unwrap().current_key;
    transport.push(control(
        1,
        packet_flags::REQUEST_RETRANSMIT,
        &Session::pack_sequence_list(&[2]),
    ));
    assert!(session.recv_message().now_or_never().is_none());
    let repaired = &transport.sent_packets().await[1];
    let header = unpack_header(repaired);
    let hash = session
        .calculate_payload_hash(header.flags, &repaired[transport::HEADER_SIZE..])
        .unwrap();
    assert_eq!(header.sequence, 2);
    assert_eq!(header.flags & packet_flags::ACK_SEQUENCE, 0);
    assert_ne!(header.flags & packet_flags::RETRANSMISSION, 0);
    assert_eq!(
        header.checksum.wrapping_sub(header.calculate_checksum()) ^ hash,
        original_key
    );
    assert_eq!(session.isaac_c2s.as_ref().unwrap().current_key, next_key);
    peer.consume_key();
    assert_eq!(peer.current_key, next_key);
}

#[tokio::test(start_paused = true)]
async fn ack_eviction_retains_boundary_and_late_requests_receive_rejections() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    for _ in 0..2 {
        session.send_message(&logout_message()).await.unwrap();
    }
    transport.push(control(1, packet_flags::ACK_SEQUENCE, &3u32.to_le_bytes()));
    assert!(session.recv_message().now_or_never().is_none());
    assert!(!session.cached_packets.contains_key(&2));
    assert!(session.cached_packets.contains_key(&3));
    advance(ACK_INTERVAL).await;
    assert!(session.recv_message().now_or_never().is_none());
    assert!(!session.cached_packets.contains_key(&2));
    transport.push(control(
        1,
        packet_flags::REQUEST_RETRANSMIT,
        &Session::pack_sequence_list(&[2]),
    ));
    assert!(session.recv_message().now_or_never().is_none());
    let sent = transport.sent_packets().await;
    let header = unpack_header(sent.last().unwrap());
    assert_eq!(header.flags, packet_flags::REJECT_RETRANSMIT);
    assert_eq!(header.sequence, 3);
    assert_eq!(session.cached_packets.len(), 1);
    // ACE PacketHeaderOptional reads this list without retaining a consumer for C2S holes.
    assert_eq!(
        session
            .read_sequence_list(
                header.flags,
                &sent.last().unwrap()[transport::HEADER_SIZE..],
                packet_flags::REJECT_RETRANSMIT
            )
            .unwrap(),
        vec![2]
    );
}

#[tokio::test(start_paused = true)]
async fn cache_capacity_counts_reserved_originals_and_fails_before_identity_allocation() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    session.isaac_c2s = Some(Isaac::new(9));
    transport.block_writes(true);
    for _ in 0..MAX_CACHED_PACKETS {
        assert!(
            session
                .send_message(&logout_message())
                .now_or_never()
                .is_none()
        );
    }
    let sequence = session.packet_sequence;
    let key = session.isaac_c2s.as_ref().unwrap().current_key;
    let error = session.send_message(&logout_message()).await.unwrap_err();
    assert!(error.to_string().contains("capacity exhausted"));
    assert_eq!(session.packet_sequence, sequence);
    assert_eq!(session.isaac_c2s.as_ref().unwrap().current_key, key);
    assert!(transport.sent_packets().await.is_empty());
    transport.block_writes(false);
    assert!(session.recv_message().now_or_never().is_none());
    // Receive turns have bounded write work too; service the remaining retained originals.
    for _ in 0..MAX_CACHED_PACKETS / RECEIVE_BATCH_LIMIT {
        assert!(session.recv_message().now_or_never().is_none());
    }
    assert_eq!(session.cached_packets.len(), MAX_CACHED_PACKETS);
    transport.push(control(
        1,
        packet_flags::REQUEST_RETRANSMIT,
        &Session::pack_sequence_list(&[2]),
    ));
    assert!(session.recv_message().now_or_never().is_none());
    assert_ne!(
        unpack_header(transport.sent_packets().await.last().unwrap()).flags
            & packet_flags::RETRANSMISSION,
        0
    );
}

#[tokio::test(start_paused = true)]
async fn received_packets_win_over_crossed_rejections_and_release_confirmed_holes() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    transport.push(build_single_fragment_packet(3, &[3]));
    transport.push(control(
        4,
        packet_flags::REJECT_RETRANSMIT,
        &Session::pack_sequence_list(&[2, 3]),
    ));
    delivered_byte(&mut session, 3).await;
    assert!(session.recv_message().await.unwrap().is_empty());
    assert_eq!(session.last_server_seq, 4);
    assert!(session.rejected_server_sequences.is_empty());
}

#[tokio::test(start_paused = true)]
async fn receive_window_and_rejections_are_bounded_before_timers() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    let too_far = session.last_server_seq + MAX_RETRANSMIT_SEQUENCE_WINDOW + 1;
    transport.push(build_single_fragment_packet(too_far, &[1]));
    assert!(
        session
            .recv_message()
            .await
            .unwrap_err()
            .to_string()
            .contains("Abnormal server")
    );
    assert!(session.pending_server_packets.is_empty());
    transport.push(control(
        2,
        packet_flags::REJECT_RETRANSMIT,
        &Session::pack_sequence_list(&[too_far]),
    ));
    assert!(
        session
            .recv_message()
            .await
            .unwrap_err()
            .to_string()
            .contains("Abnormal server")
    );
    assert!(session.rejected_server_sequences.is_empty());
}

#[tokio::test(start_paused = true)]
async fn read_ahead_does_not_admit_another_batch_per_delivered_packet() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    for sequence in 2..2 + MAX_BUFFERED_PACKETS as u32 + RECEIVE_BATCH_LIMIT as u32 {
        transport.push(build_single_fragment_packet(sequence, &[1]));
    }
    delivered_byte(&mut session, 1).await;
    let remaining = transport.state.lock().unwrap().incoming.len();
    for _ in 1..RECEIVE_BATCH_LIMIT {
        delivered_byte(&mut session, 1).await;
    }
    assert_eq!(transport.state.lock().unwrap().incoming.len(), remaining);
    assert!(session.pending_server_packets.is_empty());
}

#[tokio::test(start_paused = true)]
async fn wrong_source_traffic_consumes_the_read_budget() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    for _ in 0..RECEIVE_BATCH_LIMIT * 3 {
        transport.push_from(vec![0], "127.0.0.2:9000".parse().unwrap());
    }
    assert!(session.recv_message().now_or_never().is_none());
    assert!(transport.state.lock().unwrap().read_calls <= RECEIVE_BATCH_LIMIT + 1);
}

#[tokio::test(start_paused = true)]
async fn handshake_barrier_initializes_once_before_encrypted_read_ahead() {
    let transport = ScriptedTransport::default();
    let mut session = Session::new_test();
    session.transport = Box::new(transport.clone());
    let request = ConnectRequestData {
        time: 123.5,
        cookie: 42,
        client_id: 216,
        server_seed: 7,
        client_seed: 9,
    };
    transport.push(build_connect_request_packet(request.clone()));
    let mut server = Isaac::new(request.server_seed);
    let data = encrypted_packet(2, &[2], &mut server);
    transport.push_from(data.clone(), "127.0.0.1:9001".parse().unwrap());
    assert!(
        matches!(session.recv_message().await.unwrap().as_slice(), [SessionEvent::TimeSync(time)] if *time == request.time)
    );
    let initialized_at = session.last_control_scheduled;
    delivered_byte(&mut session, 2).await;
    let key = session.isaac_s2c.as_ref().unwrap().current_key;
    assert_eq!(session.server_source_addr.port(), 9001);
    transport.push_from(
        build_connect_request_packet(request.clone()),
        session.server_source_addr,
    );
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(session.last_control_scheduled, initialized_at);
    assert_eq!(session.isaac_s2c.as_ref().unwrap().current_key, key);
    assert_eq!(session.packet_sequence, 2);
    let mut fresh = Session::new_test();
    assert_eq!(
        fresh.handle_handshake_request(request).unwrap(),
        Some(123.5)
    );
    assert!(fresh.last_control_scheduled.is_some());
}

#[tokio::test(start_paused = true)]
async fn handshake_delay_and_port_overflow_remain_explicit() {
    let transport = ScriptedTransport::default();
    let mut session = Session::new_test();
    session.transport = Box::new(transport.clone());
    transport.push(build_connect_request_packet(ConnectRequestData {
        time: 0.0,
        cookie: 42,
        client_id: 216,
        server_seed: 7,
        client_seed: 9,
    }));
    session.recv_message().await.unwrap();
    assert!(transport.sent_packets().await.is_empty());
    advance(std::time::Duration::from_millis(
        transport::ACE_HANDSHAKE_RACE_DELAY_MS,
    ))
    .await;
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(
        unpack_header(&transport.sent_packets().await[0]).flags,
        packet_flags::CONNECT_RESPONSE
    );
    let mut invalid = Session::new_test();
    invalid.server_addr.set_port(u16::MAX);
    assert!(
        invalid
            .handle_handshake_request(ConnectRequestData {
                time: 0.0,
                cookie: 1,
                client_id: 2,
                server_seed: 3,
                client_seed: 4
            })
            .unwrap_err()
            .to_string()
            .contains("activation port overflow")
    );
}

#[tokio::test(start_paused = true)]
async fn wrapping_delivery_and_ack_eviction_use_serial_order() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    session.last_server_seq = u32::MAX;
    transport.push(build_single_fragment_packet(0, &[0]));
    delivered_byte(&mut session, 0).await;
    session.packet_sequence = u32::MAX;
    session.last_sent_client_sequence = u32::MAX - 1;
    session.send_message(&logout_message()).await.unwrap();
    session.send_message(&logout_message()).await.unwrap();
    assert!(session.cached_packets.contains_key(&u32::MAX));
    assert!(session.cached_packets.contains_key(&1));
    transport.push(control(0, packet_flags::ACK_SEQUENCE, &1u32.to_le_bytes()));
    assert!(session.recv_message().now_or_never().is_none());
    assert!(!session.cached_packets.contains_key(&u32::MAX));
    assert!(session.cached_packets.contains_key(&1));
}

#[tokio::test(start_paused = true)]
async fn outgoing_lists_use_retail_limit_while_parser_accepts_wire_capacity() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    transport.push(build_single_fragment_packet(
        MAX_RETRANSMIT_SEQUENCE_WINDOW,
        &[1],
    ));
    advance(ACK_INTERVAL).await;
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(
        request_ids(&transport.sent_packets().await[0]).len(),
        MAX_OUTGOING_SEQUENCE_IDS
    );
    let ids = vec![2; MAX_RETRANSMIT_SEQUENCE_IDS];
    let payload = Session::pack_sequence_list(&ids);
    assert_eq!(
        session
            .read_sequence_list(
                packet_flags::REQUEST_RETRANSMIT,
                &payload,
                packet_flags::REQUEST_RETRANSMIT
            )
            .unwrap()
            .len(),
        MAX_RETRANSMIT_SEQUENCE_IDS
    );
    assert!(
        session
            .read_sequence_list(
                packet_flags::REQUEST_RETRANSMIT,
                &Session::pack_sequence_list(&vec![2; MAX_RETRANSMIT_SEQUENCE_IDS + 1]),
                packet_flags::REQUEST_RETRANSMIT
            )
            .is_none()
    );
}

#[tokio::test(start_paused = true)]
async fn failed_and_short_writes_do_not_commit_cache_or_observations() {
    for short in [false, true] {
        let transport = ScriptedTransport::default();
        {
            let mut state = transport.state.lock().unwrap();
            state.short_send = short;
            state.fail_send = !short;
        }
        let mut session = connected(&transport);
        assert!(session.send_message(&logout_message()).await.is_err());
        assert_eq!(session.bytes_out, 0);
        assert_eq!(session.reliability().sent.packets, 0);
        assert!(session.cached_packets.is_empty());
    }
}

#[tokio::test(start_paused = true)]
async fn partial_recovery_retries_only_current_holes() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    transport.push(build_single_fragment_packet(6, &[6]));
    advance(ACK_INTERVAL).await;
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(
        request_ids(&transport.sent_packets().await[0]),
        vec![2, 3, 4, 5]
    );
    transport.push(build_single_fragment_packet(3, &[3]));
    transport.push(build_single_fragment_packet(5, &[5]));
    advance(REQUEST_RETRANSMIT_INTERVAL + CONTROL_TIMER_TICK).await;
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(request_ids(&transport.sent_packets().await[1]), vec![2, 4]);
    transport.push(build_single_fragment_packet(2, &[2]));
    delivered_byte(&mut session, 2).await;
    assert!(session.reliability().receive_gap);
    delivered_byte(&mut session, 3).await;
    transport.push(build_single_fragment_packet(4, &[4]));
    for byte in [4, 5, 6] {
        delivered_byte(&mut session, byte).await;
    }
    assert!(!session.reliability().receive_gap);
}

#[tokio::test(start_paused = true)]
async fn future_rejection_never_skips_an_earlier_unresolved_packet() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    transport.push(build_single_fragment_packet(5, &[5]));
    transport.push(control(
        6,
        packet_flags::REJECT_RETRANSMIT,
        &Session::pack_sequence_list(&[4]),
    ));
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(session.last_server_seq, 1);
    transport.push(build_single_fragment_packet(2, &[2]));
    transport.push(build_single_fragment_packet(3, &[3]));
    for byte in [2, 3, 5] {
        delivered_byte(&mut session, byte).await;
    }
    assert!(session.recv_message().await.unwrap().is_empty());
    assert_eq!(session.last_server_seq, 6);
}

#[tokio::test(start_paused = true)]
async fn activation_is_confirmed_only_by_valid_traffic_and_login_source_remains_allowed() {
    let transport = ScriptedTransport::default();
    let mut session = Session::new_test();
    session.transport = Box::new(transport.clone());
    transport.push(build_connect_request_packet(ConnectRequestData {
        time: 1.0,
        cookie: 42,
        client_id: 216,
        server_seed: 7,
        client_seed: 9,
    }));
    session.recv_message().await.unwrap();
    let mut corrupt = build_single_fragment_packet(2, &[2]);
    corrupt[8] ^= 1;
    transport.push_from(corrupt, "127.0.0.1:9001".parse().unwrap());
    transport.push(build_single_fragment_packet(2, &[2]));
    delivered_byte(&mut session, 2).await;
    assert_eq!(session.server_source_addr.port(), 9000);
    assert_eq!(session.pending_server_source_addr.unwrap().port(), 9001);
    transport.push_from(
        build_single_fragment_packet(3, &[3]),
        "127.0.0.1:9001".parse().unwrap(),
    );
    delivered_byte(&mut session, 3).await;
    assert_eq!(session.server_source_addr.port(), 9001);
    assert!(session.pending_server_source_addr.is_none());
}

#[tokio::test(start_paused = true)]
async fn normal_controls_do_not_repopulate_cache_or_allocate_keys_at_capacity() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    session.isaac_c2s = Some(Isaac::new(9));
    for _ in 0..MAX_CACHED_PACKETS {
        session.send_message(&logout_message()).await.unwrap();
    }
    let next = session.packet_sequence;
    let key = session.isaac_c2s.as_ref().unwrap().current_key;
    advance(ACK_INTERVAL).await;
    assert!(session.recv_message().now_or_never().is_none());
    let sent = transport.sent_packets().await;
    assert_eq!(
        unpack_header(sent.last().unwrap()).flags,
        packet_flags::ACK_SEQUENCE
    );
    assert_eq!(session.cached_packets.len(), MAX_CACHED_PACKETS);
    assert_eq!(session.packet_sequence, next);
    assert_eq!(session.isaac_c2s.as_ref().unwrap().current_key, key);
    transport.push(control(
        1,
        packet_flags::ACK_SEQUENCE,
        &(next - 1).to_le_bytes(),
    ));
    assert!(session.recv_message().now_or_never().is_none());
    session.send_message(&logout_message()).await.unwrap();
    assert_eq!(session.cached_packets.len(), 2);
}

#[tokio::test(start_paused = true)]
async fn reliable_admission_rejects_oversized_messages_without_spending_identity() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    session.isaac_c2s = Some(Isaac::new(7));
    let sequence = session.packet_sequence;
    let key = session.isaac_c2s.as_ref().unwrap().current_key;
    let oversized = vec![0; transport::MAX_PACKET_SIZE];
    assert!(
        session
            .prepare_reliable(packet_flags::BLOB_FRAGMENTS, &oversized)
            .is_err()
    );
    assert_eq!(session.packet_sequence, sequence);
    assert_eq!(session.isaac_c2s.as_ref().unwrap().current_key, key);
    assert!(transport.sent_packets().await.is_empty());
}

#[tokio::test(start_paused = true)]
async fn outgoing_response_queue_is_bounded_and_repeated_repairs_are_coalesced() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    session.send_message(&logout_message()).await.unwrap();
    session
        .retransmit_sequences(&vec![2; MAX_RETRANSMIT_SEQUENCE_IDS])
        .unwrap();
    session.retransmit_sequences(&[2]).unwrap();
    assert_eq!(session.pending_packets.len(), 1);
    while session.pending_packets.len() < MAX_PENDING_PACKETS {
        session
            .queue_cleartext_control(
                packet_flags::REJECT_RETRANSMIT,
                Session::pack_sequence_list(&[0]),
            )
            .unwrap();
    }
    assert!(
        session
            .queue_cleartext_control(
                packet_flags::REJECT_RETRANSMIT,
                Session::pack_sequence_list(&[0])
            )
            .unwrap_err()
            .to_string()
            .contains("queue capacity exhausted")
    );
    assert_eq!(session.pending_packets.len(), MAX_PENDING_PACKETS);
}

#[tokio::test(start_paused = true)]
async fn malformed_payload_does_not_acknowledge_or_close_a_hole() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    transport.push(build_single_fragment_packet(3, &[3]));
    let mut malformed = build_single_fragment_packet(2, &[2]);
    // A zero fragment count is structurally invalid even with a matching additive checksum.
    malformed[transport::HEADER_SIZE + 8..transport::HEADER_SIZE + 10]
        .copy_from_slice(&0u16.to_le_bytes());
    transport.push(malformed);
    assert!(session.recv_message().now_or_never().is_none());
    assert!(session.reliability().receive_gap);
    assert_eq!(session.reliability().received.packets, 1);
    transport.push(build_single_fragment_packet(2, &[2]));
    delivered_byte(&mut session, 2).await;
    delivered_byte(&mut session, 3).await;
    assert!(
        OptionalHeaderCursor::new(&[], packet_flags::ACK_SEQUENCE)
            .hash_bytes()
            .is_err()
    );
    assert!(
        OptionalHeaderCursor::new(&[], packet_flags::REQUEST_RETRANSMIT)
            .hash_bytes()
            .is_err()
    );
    assert!(
        OptionalHeaderCursor::new(&u32::MAX.to_le_bytes(), packet_flags::REJECT_RETRANSMIT)
            .hash_bytes()
            .is_err()
    );
}

#[tokio::test(start_paused = true)]
async fn wire_size_and_future_ack_validation_precede_control_side_effects() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    let mut truncated = build_single_fragment_packet(2, &[2]);
    truncated.pop();
    transport.push(truncated);
    assert!(
        session
            .recv_message()
            .await
            .unwrap_err()
            .to_string()
            .contains("payload size")
    );
    assert_eq!(session.reliability().received.packets, 0);
    transport.push(control(1, packet_flags::ACK_SEQUENCE, &2u32.to_le_bytes()));
    assert!(
        session
            .recv_message()
            .await
            .unwrap_err()
            .to_string()
            .contains("unsent C2S")
    );
    assert_eq!(session.last_sent_client_sequence, 1);
}

#[tokio::test(start_paused = true)]
async fn late_original_wins_when_pending_read_and_write_become_ready_together() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    transport.push(build_single_fragment_packet(3, &[3]));
    advance(ACK_INTERVAL).await;
    transport.block_writes(true);
    let task = tokio::spawn(async move {
        let events = session.recv_message().await.unwrap();
        (session, events)
    });
    tokio::task::yield_now().await;
    transport.push(build_single_fragment_packet(2, &[2]));
    transport.block_writes(false);
    let (mut session, events) = task.await.unwrap();
    assert!(matches!(events.as_slice(), [SessionEvent::Message(bytes)] if bytes == &[2]));
    assert!(
        transport
            .sent_packets()
            .await
            .iter()
            .all(|packet| unpack_header(packet).flags & packet_flags::REQUEST_RETRANSMIT == 0)
    );
    delivered_byte(&mut session, 3).await;
}

#[tokio::test(start_paused = true)]
async fn repeated_handshake_ack_does_not_rewind_the_sent_control_stamp() {
    let transport = ScriptedTransport::default();
    let mut session = Session::new_test();
    session.transport = Box::new(transport.clone());
    let request = ConnectRequestData {
        time: 1.0,
        cookie: 42,
        client_id: 216,
        server_seed: 7,
        client_seed: 9,
    };
    transport.push(build_connect_request_packet(request.clone()));
    session.recv_message().await.unwrap();
    advance(std::time::Duration::from_millis(
        transport::ACE_HANDSHAKE_RACE_DELAY_MS,
    ))
    .await;
    session.send_message(&logout_message()).await.unwrap();
    assert_eq!(session.last_sent_client_sequence, 2);
    transport.push(build_connect_request_packet(request));
    assert!(session.recv_message().now_or_never().is_none());
    advance(std::time::Duration::from_millis(
        transport::ACE_HANDSHAKE_RACE_DELAY_MS,
    ))
    .await;
    assert!(session.recv_message().now_or_never().is_none());
    assert_eq!(session.last_sent_client_sequence, 2);
    transport.push(control(1, packet_flags::ACK_SEQUENCE, &2u32.to_le_bytes()));
    assert!(session.recv_message().now_or_never().is_none());
}

#[test]
fn retained_content_removes_all_disposable_header_ranges_in_wire_order() {
    let session = Session::new_test();
    let fragment = build_single_fragment_packet(2, &[7]);
    let fragment_body = &fragment[transport::HEADER_SIZE..];
    let mut body = Session::pack_sequence_list(&[1]);
    body.extend_from_slice(&Session::pack_sequence_list(&[3]));
    body.extend_from_slice(&4u32.to_le_bytes());
    body.extend_from_slice(fragment_body);
    let flags = packet_flags::REQUEST_RETRANSMIT
        | packet_flags::REJECT_RETRANSMIT
        | packet_flags::ACK_SEQUENCE
        | packet_flags::BLOB_FRAGMENTS;
    let original = control(2, flags, &body);
    let retained = session.retained_packet(&original).unwrap();
    assert_eq!(unpack_header(&retained).flags, packet_flags::BLOB_FRAGMENTS);
    assert_eq!(&retained[transport::HEADER_SIZE..], fragment_body);
    assert_eq!(retained, fragment);
}

#[tokio::test(start_paused = true)]
async fn action_identity_commits_with_retained_send_and_not_with_failed_preparation() {
    use holtburger_protocol::messages::misc::actions::PingRequestActionData;
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    transport.block_writes(true);
    assert!(
        session
            .send_action(GameAction::PingRequest(Box::new(PingRequestActionData)))
            .now_or_never()
            .is_none()
    );
    assert_eq!(session.game_action_sequence, 1);
    transport.block_writes(false);
    session
        .send_action(GameAction::PingRequest(Box::new(PingRequestActionData)))
        .await
        .unwrap();
    assert_eq!(session.game_action_sequence, 2);
    for packet in transport.sent_packets().await {
        let mut offset = transport::HEADER_SIZE + transport::FRAGMENT_HEADER_SIZE;
        let message = GameMessage::unpack(&packet, &mut offset).unwrap();
        let GameMessage::GameAction(action) = message else {
            panic!("expected a game action");
        };
        assert_eq!(action.sequence, unpack_header(&packet).sequence - 1);
    }
    while session.cached_packets.len() < MAX_CACHED_PACKETS {
        session.send_message(&logout_message()).await.unwrap();
    }
    let before = session.game_action_sequence;
    assert!(
        session
            .send_action(GameAction::PingRequest(Box::new(PingRequestActionData)))
            .await
            .is_err()
    );
    assert_eq!(session.game_action_sequence, before);
}

#[tokio::test(start_paused = true)]
async fn echo_control_keeps_its_mandatory_payload_and_uses_client_identity() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    session.isaac_c2s = Some(Isaac::new(7));
    session.last_server_seq = 40;
    let timestamp = 10_f32;
    transport.push(control(
        41,
        packet_flags::ECHO_REQUEST,
        &timestamp.to_le_bytes(),
    ));
    assert!(session.recv_message().await.unwrap().is_empty());
    let sent = transport.sent_packets().await;
    let header = unpack_header(&sent[0]);
    assert_eq!(header.sequence, 2);
    assert_eq!(
        header.flags,
        packet_flags::ECHO_RESPONSE | packet_flags::ENCRYPTED_CHECKSUM
    );
    assert_eq!(header.size as usize, transport::ECHO_RESPONSE_SIZE);
    assert_eq!(
        &sent[0][transport::HEADER_SIZE..transport::HEADER_SIZE + transport::ECHO_REQUEST_SIZE],
        &timestamp.to_le_bytes()
    );
}

#[tokio::test(start_paused = true)]
async fn timer_wakes_normal_ack_without_server_or_game_traffic() {
    let transport = ScriptedTransport::default();
    let mut session = connected(&transport);
    let task = tokio::spawn(async move { session.recv_message().await });
    tokio::task::yield_now().await;
    advance(ACK_INTERVAL).await;
    tokio::time::timeout(ACK_INTERVAL, transport.wait_for_sent(1))
        .await
        .unwrap();
    let sent = transport.sent_packets().await;
    assert_eq!(unpack_header(&sent[0]).flags, packet_flags::ACK_SEQUENCE);
    assert_eq!(
        LittleEndian::read_u32(&sent[0][transport::HEADER_SIZE..]),
        1
    );
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
}
