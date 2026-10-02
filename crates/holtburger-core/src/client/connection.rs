//! Shared, bounded-cadence transport observations for client shells.

use holtburger_session::{PacketDeliveryCounters, TransportReliability};
use serde::Serialize;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Silence warning before the existing terminal connection timeout.
pub const CONNECTION_WARNING_AFTER: Duration = Duration::from_secs(10);
/// Maximum tolerated receive silence before core terminates the session.
pub const CONNECTION_TIMEOUT: Duration = Duration::from_secs(15);

/// Window for retransmitted sequenced traffic; long enough to avoid single-tick flicker.
pub const RELIABILITY_WINDOW: Duration = Duration::from_secs(10);
/// Highest repair share still classified as good.
const GOOD_REPAIR_SHARE: f64 = 0.02;
/// Highest repair share still classified as fair.
const FAIR_REPAIR_SHARE: f64 = 0.10;

/// Shared reliability classification; frontends map these tiers to their own presentation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionQuality {
    Good,
    Fair,
    Poor,
    Unavailable,
}

/// Rolling repair traffic, measured independently in each transport direction.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionReliability {
    /// Retransmitted incoming sequenced datagram share; absent without recent incoming samples.
    pub receive_repair_share: Option<f64>,
    /// Retransmitted outgoing sequenced datagram share; absent without recent outgoing samples.
    pub send_repair_share: Option<f64>,
    /// Ordered reception currently awaits a missing packet before buffered traffic can be delivered.
    pub receive_gap: bool,
}

/// Transport health, independent of character/world lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionHealth {
    Connected,
    Waiting,
    Disconnected,
}

/// One owner-calculated observation; rates include transport overhead.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSample {
    /// Core-owned tier based on the worse repair direction, receive gaps, and silence.
    pub quality: ConnectionQuality,
    /// Evidence behind the quality tier; repair share is not an inferred packet-loss percentage.
    pub reliability: ConnectionReliability,
    /// Receive-silence classification using the same clock as the timeout.
    pub health: ConnectionHealth,
    /// Seconds since the rate interval completed; prevents snapshot recovery replaying old activity.
    pub sample_age_seconds: f64,
    /// Seconds since traffic from the accepted server endpoint was received.
    pub receive_age_seconds: f64,
    /// Received bytes per second over the actual sampling interval.
    pub receive_bytes_per_second: f64,
    /// Sent bytes per second over the actual sampling interval.
    pub send_bytes_per_second: f64,
}

/// Previous cumulative traffic observation; a new runtime starts without a baseline.
struct TrafficBaseline {
    at: Instant,
    received: u64,
    sent: u64,
    reliability: TransportReliability,
}

/// Completed byte rates retain their own clock for snapshot recovery.
struct TrafficRates {
    at: Instant,
    received: f64,
    sent: f64,
}

/// One completed interval in the bounded rolling repair window.
struct RepairInterval {
    at: Instant,
    received: PacketDeliveryCounters,
    sent: PacketDeliveryCounters,
}

/// Byte-rate and rolling repair owner; no UI cadence or rendering policy lives here.
#[derive(Default)]
pub(super) struct ConnectionSampler {
    baseline: Option<TrafficBaseline>,
    rates: Option<TrafficRates>,
    repairs: VecDeque<RepairInterval>,
}

fn packet_delta(
    current: PacketDeliveryCounters,
    previous: PacketDeliveryCounters,
) -> PacketDeliveryCounters {
    PacketDeliveryCounters {
        packets: current.packets.wrapping_sub(previous.packets),
        retransmissions: current
            .retransmissions
            .wrapping_sub(previous.retransmissions),
    }
}

fn repair_share(counts: PacketDeliveryCounters) -> Option<f64> {
    (counts.packets != 0).then(|| counts.retransmissions as f64 / counts.packets as f64)
}

impl ConnectionSampler {
    pub fn observe(
        &mut self,
        now: Instant,
        received: u64,
        sent: u64,
        reliability: TransportReliability,
    ) {
        if let Some(previous) = &self.baseline {
            let seconds = now.duration_since(previous.at).as_secs_f64();
            // Preserve all traffic until the clock advances; zero-length samples cannot have rates.
            if seconds == 0.0 {
                return;
            }
            self.rates = Some(TrafficRates {
                at: now,
                received: received.wrapping_sub(previous.received) as f64 / seconds,
                sent: sent.wrapping_sub(previous.sent) as f64 / seconds,
            });
            self.repairs.push_back(RepairInterval {
                at: now,
                received: packet_delta(reliability.received, previous.reliability.received),
                sent: packet_delta(reliability.sent, previous.reliability.sent),
            });
            while self
                .repairs
                .front()
                .is_some_and(|interval| now.duration_since(interval.at) >= RELIABILITY_WINDOW)
            {
                self.repairs.pop_front();
            }
        }
        self.baseline = Some(TrafficBaseline {
            at: now,
            received,
            sent,
            reliability,
        });
    }

    pub fn snapshot(
        &self,
        now: Instant,
        last_receive: Instant,
        disconnected: bool,
        receive_gap: bool,
    ) -> Option<ConnectionSample> {
        let (sampled_at, receive_bytes_per_second, send_bytes_per_second) = match &self.rates {
            Some(rates) => (rates.at, rates.received, rates.sent),
            None if disconnected => (now, 0.0, 0.0),
            None => return None,
        };
        let mut received = PacketDeliveryCounters::default();
        let mut sent = PacketDeliveryCounters::default();
        // Read-only replacements must expire old evidence too, even if the sampler has stopped.
        for interval in self
            .repairs
            .iter()
            .filter(|interval| now.duration_since(interval.at) < RELIABILITY_WINDOW)
        {
            received.packets += interval.received.packets;
            received.retransmissions += interval.received.retransmissions;
            sent.packets += interval.sent.packets;
            sent.retransmissions += interval.sent.retransmissions;
        }
        let reliability = ConnectionReliability {
            receive_repair_share: repair_share(received),
            send_repair_share: repair_share(sent),
            receive_gap,
        };
        let age = now.duration_since(last_receive);
        let health = if disconnected {
            ConnectionHealth::Disconnected
        } else if age >= CONNECTION_WARNING_AFTER {
            ConnectionHealth::Waiting
        } else {
            ConnectionHealth::Connected
        };
        let worst_share = reliability
            .receive_repair_share
            .into_iter()
            .chain(reliability.send_repair_share)
            .reduce(f64::max);
        let quality = if disconnected {
            ConnectionQuality::Unavailable
        } else if receive_gap || health == ConnectionHealth::Waiting {
            ConnectionQuality::Poor
        } else {
            match worst_share {
                Some(share) if share <= GOOD_REPAIR_SHARE => ConnectionQuality::Good,
                Some(share) if share <= FAIR_REPAIR_SHARE => ConnectionQuality::Fair,
                Some(_) => ConnectionQuality::Poor,
                None => ConnectionQuality::Unavailable,
            }
        };
        Some(ConnectionSample {
            health,
            quality,
            reliability,
            sample_age_seconds: now.duration_since(sampled_at).as_secs_f64(),
            receive_age_seconds: age.as_secs_f64(),
            receive_bytes_per_second,
            send_bytes_per_second,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{
        builder::build_test_client,
        types::{ClientState, ClientViewEvent},
    };

    #[test]
    fn repair_tiers_use_the_worse_direction_and_include_threshold_boundaries() {
        let now = Instant::now();
        for (share, expected) in [
            (0.0, ConnectionQuality::Good),
            (GOOD_REPAIR_SHARE, ConnectionQuality::Good),
            (
                (GOOD_REPAIR_SHARE + FAIR_REPAIR_SHARE) * 0.5,
                ConnectionQuality::Fair,
            ),
            (FAIR_REPAIR_SHARE, ConnectionQuality::Fair),
            (FAIR_REPAIR_SHARE * 2.0, ConnectionQuality::Poor),
        ] {
            for outgoing in [false, true] {
                let mut sampler = ConnectionSampler::default();
                sampler.observe(now, 0, 0, TransportReliability::default());
                let repaired = PacketDeliveryCounters {
                    packets: 1000,
                    retransmissions: (share * 1000.0).round() as u64,
                };
                let healthy = PacketDeliveryCounters {
                    packets: 1000,
                    retransmissions: 0,
                };
                sampler.observe(
                    now + Duration::from_secs(1),
                    100,
                    100,
                    TransportReliability {
                        received: if outgoing { healthy } else { repaired },
                        sent: if outgoing { repaired } else { healthy },
                        receive_gap: false,
                    },
                );
                let sample = sampler
                    .snapshot(now + Duration::from_secs(1), now, false, false)
                    .unwrap();
                assert_eq!(sample.quality, expected);
                assert_eq!(
                    sample.reliability.send_repair_share,
                    Some(if outgoing {
                        repaired.retransmissions as f64 / repaired.packets as f64
                    } else {
                        0.0
                    })
                );
                assert_eq!(
                    sample.reliability.receive_repair_share,
                    Some(if outgoing {
                        0.0
                    } else {
                        repaired.retransmissions as f64 / repaired.packets as f64
                    })
                );
            }
        }
    }

    #[test]
    fn repair_window_expires_and_receive_gap_and_silence_override_recent_traffic() {
        let now = Instant::now();
        let sampled = now + Duration::from_secs(1);
        let mut sampler = ConnectionSampler::default();
        sampler.observe(now, 0, 0, TransportReliability::default());
        sampler.observe(
            sampled,
            100,
            0,
            TransportReliability {
                received: PacketDeliveryCounters {
                    packets: 10,
                    retransmissions: 0,
                },
                ..Default::default()
            },
        );
        assert_eq!(
            sampler
                .snapshot(sampled, sampled, false, false)
                .unwrap()
                .quality,
            ConnectionQuality::Good
        );
        let gap = sampler.snapshot(sampled, sampled, false, true).unwrap();
        assert_eq!(gap.quality, ConnectionQuality::Poor);
        assert!(gap.reliability.receive_gap);
        assert_eq!(
            sampler
                .snapshot(sampled, sampled, true, true)
                .unwrap()
                .quality,
            ConnectionQuality::Unavailable
        );
        let expired_at = sampled + RELIABILITY_WINDOW;
        let expired = sampler
            .snapshot(expired_at, expired_at, false, false)
            .unwrap();
        assert_eq!(expired.quality, ConnectionQuality::Unavailable);
        assert_eq!(expired.reliability.receive_repair_share, None);
        assert_eq!(expired.reliability.send_repair_share, None);
        assert_eq!(
            sampler
                .snapshot(now + CONNECTION_WARNING_AFTER, now, false, false)
                .unwrap()
                .quality,
            ConnectionQuality::Poor
        );
    }

    #[test]
    fn repair_window_recovers_when_old_retransmissions_age_out() {
        let now = Instant::now();
        let mut sampler = ConnectionSampler::default();
        sampler.observe(now, 0, 0, TransportReliability::default());
        let mut counts = TransportReliability {
            received: PacketDeliveryCounters {
                packets: 1,
                retransmissions: 1,
            },
            ..Default::default()
        };
        sampler.observe(now + Duration::from_secs(1), 0, 0, counts);
        assert_eq!(
            sampler
                .snapshot(now + Duration::from_secs(1), now, false, false)
                .unwrap()
                .quality,
            ConnectionQuality::Poor
        );
        let recovered_at = now + Duration::from_secs(1) + RELIABILITY_WINDOW;
        counts.received.packets += 100;
        sampler.observe(recovered_at, 0, 0, counts);
        let recovered = sampler
            .snapshot(recovered_at, recovered_at, false, false)
            .unwrap();
        assert_eq!(recovered.quality, ConnectionQuality::Good);
        assert_eq!(recovered.reliability.receive_repair_share, Some(0.0));
        assert_eq!(sampler.repairs.len(), 1);
    }

    #[test]
    fn rates_use_elapsed_time_and_wrapping_transport_counters() {
        let now = Instant::now();
        let mut sampler = ConnectionSampler::default();
        sampler.observe(now, u64::MAX - 9, 100, TransportReliability::default());
        assert!(sampler.snapshot(now, now, false, false).is_none());
        sampler.observe(
            now + Duration::from_secs(2),
            10,
            180,
            TransportReliability::default(),
        );
        let sample = sampler
            .snapshot(now + Duration::from_secs(2), now, false, false)
            .unwrap();
        assert_eq!(sample.receive_bytes_per_second, 10.0);
        assert_eq!(sample.send_bytes_per_second, 40.0);
    }

    #[test]
    fn same_clock_observation_preserves_bytes_until_time_advances() {
        let now = Instant::now();
        let mut sampler = ConnectionSampler::default();
        sampler.observe(now, 0, 0, TransportReliability::default());
        sampler.observe(now, 100, 50, TransportReliability::default());
        assert!(sampler.snapshot(now, now, false, false).is_none());
        sampler.observe(
            now + Duration::from_secs(1),
            100,
            50,
            TransportReliability::default(),
        );
        let sample = sampler
            .snapshot(now + Duration::from_secs(1), now, false, false)
            .unwrap();
        assert_eq!(sample.receive_bytes_per_second, 100.0);
        assert_eq!(sample.send_bytes_per_second, 50.0);
    }

    #[test]
    fn core_publishes_terminal_health_before_shell_lifecycle_exit() {
        let mut client = build_test_client(ClientState::Disconnected);
        let mut events = client.subscribe_client_view_events();
        client.send_status_event();
        let ClientViewEvent::ConnectionUpdated(sample) = events.try_recv().unwrap() else {
            panic!("Expected terminal connection observation");
        };
        assert_eq!(sample.health, ConnectionHealth::Disconnected);
        assert_eq!(
            client.application_snapshot().connection.unwrap().health,
            sample.health
        );
    }

    #[test]
    fn replacement_preserves_rate_age_and_disconnect_is_available_before_first_interval() {
        let now = Instant::now();
        let mut sampler = ConnectionSampler::default();
        assert_eq!(
            sampler.snapshot(now, now, true, false).unwrap().health,
            ConnectionHealth::Disconnected
        );
        sampler.observe(now, 0, 0, TransportReliability::default());
        sampler.observe(
            now + Duration::from_secs(1),
            100,
            50,
            TransportReliability::default(),
        );
        let sample = sampler
            .snapshot(now + Duration::from_secs(4), now, false, false)
            .unwrap();
        assert_eq!(sample.sample_age_seconds, 3.0);
        assert_eq!(sample.receive_bytes_per_second, 100.0);
    }

    #[test]
    fn silence_warns_then_recovery_restores_health_and_exit_overrides_it() {
        let now = Instant::now();
        let mut sampler = ConnectionSampler::default();
        sampler.observe(now, 0, 0, TransportReliability::default());
        sampler.observe(
            now + Duration::from_secs(1),
            0,
            0,
            TransportReliability::default(),
        );
        let warning = now + CONNECTION_WARNING_AFTER;
        assert_eq!(
            sampler.snapshot(warning, now, false, false).unwrap().health,
            ConnectionHealth::Waiting
        );
        assert_eq!(
            sampler
                .snapshot(warning, warning, false, false)
                .unwrap()
                .health,
            ConnectionHealth::Connected
        );
        assert_eq!(
            sampler
                .snapshot(warning, warning, true, false)
                .unwrap()
                .health,
            ConnectionHealth::Disconnected
        );
    }
}
