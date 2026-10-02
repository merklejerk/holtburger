//! Transport observations only; client quality policy belongs to core.

use holtburger_protocol::messages::{PacketHeader, transport::packet_flags};

/// Cumulative sequenced datagrams, including repeated repair transmissions.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PacketDeliveryCounters {
    /// Observed sequenced traffic, excluding standalone ACKs and retransmit requests.
    pub packets: u64,
    /// Observed datagrams explicitly marked RETRANSMISSION by their sender.
    pub retransmissions: u64,
}

impl PacketDeliveryCounters {
    pub(super) fn record(&mut self, header: &PacketHeader) {
        // ACE repeats sequence numbers for standalone ACKs and does not sequence NAKs:
        // ACE/Source/ACE.Server/Network/NetworkSession.cs:719-726.
        // A repaired standalone ACK remains unsequenced control traffic.
        if header.sequence < 2
            || header.flags & !packet_flags::RETRANSMISSION == packet_flags::ACK_SEQUENCE
            || header.flags & packet_flags::REQUEST_RETRANSMIT != 0
        {
            return;
        }
        self.packets = self.packets.wrapping_add(1);
        if header.flags & packet_flags::RETRANSMISSION != 0 {
            self.retransmissions = self.retransmissions.wrapping_add(1);
        }
    }
}

/// Coherent transport facts sampled without modifying delivery or retransmission behavior.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct TransportReliability {
    /// Checksum-accepted incoming sequenced datagrams, including repair duplicates.
    pub received: PacketDeliveryCounters,
    /// Successfully sent sequenced datagrams, including repair transmissions.
    pub sent: PacketDeliveryCounters,
    /// Ordered receive delivery is blocked by a missing sequence preceding buffered traffic.
    pub receive_gap: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_sequenced_originals_and_repairs_but_excludes_unsequenced_controls() {
        let mut counters = PacketDeliveryCounters::default();
        for (sequence, flags) in [
            (0, 0),
            (1, 0),
            (2, packet_flags::ACK_SEQUENCE),
            (2, packet_flags::ACK_SEQUENCE | packet_flags::RETRANSMISSION),
            (2, packet_flags::REQUEST_RETRANSMIT),
            (2, packet_flags::BLOB_FRAGMENTS),
            (
                2,
                packet_flags::BLOB_FRAGMENTS | packet_flags::RETRANSMISSION,
            ),
        ] {
            counters.record(&PacketHeader {
                sequence,
                flags,
                ..Default::default()
            });
        }
        assert_eq!(
            counters,
            PacketDeliveryCounters {
                packets: 2,
                retransmissions: 1
            }
        );
    }
}
