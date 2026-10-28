# Session Layer Architecture

`holtburger-session` owns UDP transport, packet sequencing, checksum-key use, fragmentation,
acknowledgements, and recovery. Core consumes ordered message bytes and time notifications through
`Session::recv_message`; it owns game-message dispatch and client lifecycle policy. The session
contains no world-state or frontend policy.

## Reception and delivery

`session/receive.rs` has one admission path for both receive-driven and send-driven socket work:

1. Read a bounded batch of immediately available datagrams. Wrong-source and rejected datagrams
   consume the same batch budget as accepted ones.
2. Check source, framing, sequence window, duplicate eligibility, and payload/checksum validity.
   An already accepted encrypted sequence is discarded before ISAAC key search, including when its
   original is buffered behind a hole.
3. Apply accepted control metadata once and retain packet content for ordered delivery.
4. Schedule due reliability controls, attempt ready writes, and return one ordered packet's events.
   Remaining ready packets are delivered without admitting another full batch for each return,
   except when due or pending normal controls require fresh ingress before a write attempt.

The accepted packet span is distinct from `last_server_seq`, the delivery cursor. Recovery derives
its missing IDs from the span, excluding buffered packets and server-confirmed rejections. ACKs
are eligible only when the span has no holes; accepted later data may still await core delivery.
A received packet wins over a rejection that crosses it before delivery advances past the stamp.

The packet count, datagram size, and forward window bound retained read-ahead. Source activation
is confirmed only by a validated packet from the pending activation address. Connect setup is a
read-pass barrier: initialize keys and source expectations before admitting subsequent encrypted
traffic. Repeated setup does not reset keys or control pacing. Notifications produced while a
send services ingress remain available to the normal receive API.

## ACK and resend policy

`session/reliability.rs` owns the policy derived from retail's `SharedNet::UseTime`, `EnqueuePak`,
and `EnqueueNaks` (`acclient.c:354039`, `:355374`, `:355416`):

- One connection clock starts when an accepted `ConnectRequest` initializes the session.
- With missing IDs, schedule a request after **more than 600 ms** since the previous normal
  control was scheduled. Build its list from current facts when attempting the write.
- Without missing IDs, schedule an ACK after **at least two seconds** on the same clock.
- An ordinary game send does not independently create an ACK or reset that clock. A due ACK may
  piggyback once if space permits; otherwise it is a standalone control.
- At most one unsent normal control intent exists. A pending request disappears if its holes fill.
  A queued ACK retains its safe boundary rather than advancing through a later hole.
- A socket/deadline wait wakes recovery even if no more server packets arrive. Internal deadlines
  use Tokio's monotonic clock; the strict resend boundary adds one timer-wheel tick to idle wakes.
  Reception and scheduling share the exact eligibility decision; timer rounding does not delay
  the ingress pass when the executor is already running.

ACKs, requests, and rejection responses are disposable controls and do not allocate a new reliable
packet identity or checksum key. ACE handles only cleartext resend requests in its special request
path, so requests stay standalone and cleartext. ACE's incoming rejection packets can have their
own sequence and still participate in ordered delivery.

Core can cancel a receive future for commands or physics. The same bounded ingress service runs
before outgoing control composition; this prevents a cancelled receive from leaving an obsolete
request ahead of an original already readable on the socket. If read and write readiness arrive
together during a parked write, the read wins, and the next attempt recompiles current intent.

## Retained sends and repair cache

`session/send.rs` owns packet/key allocation and a bounded session-owned outbox. Prepared ordinary
packets survive cancellation, as do controls and repairs. Later ordinary writes cannot overtake an
earlier prepared original. Datagram completion commits cache insertion, byte counts, and packet
observations synchronously. Send errors and short writes propagate through the existing error API.

`PendingPacketData` distinguishes reliable originals, prebuilt handshakes/repairs, deferred cleartext
responses, and normal control intent. These variants determine cache reservation and serialization;
callers do not infer them from an arbitrary payload. Core requests disconnect through the session's
send operation rather than allocating a transport sequence itself.

Successfully sent originals retain their address and repairable bytes. Disposable ACK/request/
rejection headers are removed and size/checksum rebuilt using the original ISAAC key. Repairs reuse
that sequence/key, set `RETRANSMISSION`, and allocate no new cache slot. Duplicate pending repair
requests coalesce. ACK eviction uses wrap-aware serial order and retains the boundary packet.

The reliable-cache limit includes reserved unsent originals. Capacity exhaustion fails before
allocating the next identity/key or sending its content; it never silently discards an
unacknowledged original. Repairs and normal controls still work when the reliable cache is full.
The aggregate outbox also has a bound so a blocked socket cannot accumulate unlimited responses.

An unavailable requested client packet gets a bounded cleartext rejection, without the remote
fork's cache-miss-triggered logout policy. Local ACE parses such rejection bytes but has no handler
that releases its C2S hole. The response therefore does not prove that ACE has recovered; the client
never fabricates replacement data or advances the peer's delivery state.

## Checksums and observations

`EncryptedChecksum` masks the payload hash with an ISAAC word. Payload bytes remain readable;
this is not RC4 payload encryption. New packets and genuine repairs use ACE-compatible bounded key
search. The hashing path validates optional-header and fragment extents before key consumption or
control side effects. Fragment assembly remains owned by session and message interpretation by core.

`TransportReliability` reports admitted sequenced traffic, successfully sent sequenced traffic,
and known receive holes. Early-discarded encrypted duplicates do not increment admitted counters.
Core owns quality thresholds and display cadence. Public traffic-age observations retain their
`std::time::Instant` basis; internal virtual-time tests do not compare those against Tokio deadlines.

Tests use a gated transport and paused Tokio time for loss, reordering, idle retries, cancellation,
cache pressure, and source activation. A synthetic peer models InfiniteLeaftide's observed
cache-miss logout rule without accounts, live servers, DAT assets, or captured login bytes. Core
also has a real loopback UDP test for its bounded network dispatch. Interactive h3d acceptance
belongs to the user; do not launch the TUI as a diagnostic harness.
