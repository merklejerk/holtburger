# Camera solid-recovery investigation

## Goal and scope

Recover a collision-safe camera placement during initial entry and teleport when its target
origin starts inside authored BSP geometry, without oscillating between adjacent solid leaves.
Portal rendering defects in the same area are a separate investigation.

The user authorized production implementation after the candidate investigation. The stationary
recovery fix is implemented and validated below. Grounded movement response and portal rendering
remain outside this change.

## Proven reproduction

- Live h3d login uses `apps/holtburger-3d/.dev.env`; never copy credentials into this document.
- Sending `@tele 42.4S 91.1W` reproduced:
  `Camera settlement exhausted its bounded work for world generation 2 at destination 0x0D4A0129`.
- Initial entry also reproduced the same failure for world generation 1.
- Camera origin: approximately `(107.99951, 83.99902, 19.550001)` in owner `0x0D4AFFFF`.
  The target child commits cell `0x0D4A012D`; the player root is in `0x0D4A0129`.
- Requested camera radius: `0.18131289` meters.
- Each failed activation attempt returns `Fallback / FreeSphereQuery`, eight contact passes,
  full collision coverage, and zero radial clearance sweeps.
- The offending collider is indoor static source index 0 in cell `0x0D4A0129`, setup
  `0x0200104D` (assembly collider index 76 in this content capture).
- Offline static-content reproduction cycles through solid leaves 17, 20, 17, 19. The contact
  normals reverse across the same BSP partition planes, which do not exit the complete solid.
- Increasing the stationary placement budget from 8 to 256 still fails. Removing only this
  collider settles immediately; removing the nearby building or cell shell does not.
- Radius `0.48` settles in three passes at the captured origin. This is a measured alternative,
  not evidence that larger recovery spheres are a generally correct solution.
- A successful login used Y approximately `82.66569`, where the camera sphere is already clear.
  These differing positions explain the observed outcome difference; their server-side cause
  has not been established.

Previous artifacts are `/tmp/h3d-camera-offline.txt` and
`/tmp/h3d-camera-settlement-probe.rs`. They are temporary evidence, not durable prerequisites.

## References and ownership

- `crates/holtburger-world/src/spatial/bsp_query.rs`: `descend` classifies the center-containing
  solid leaf; `shallowest_contact` chooses among all ancestor partition planes.
- `crates/holtburger-world/src/spatial/free_sphere.rs`: `settle_free_sphere_with_policy` consumes
  placement contacts with bounded work and never publishes an unconverged candidate.
- `crates/holtburger-world/src/spatial/collision.rs`: static contact and grounded obstruction
  consumers, plus cell transit and building-shell center-solid exclusions.
- `crates/holtburger-world/src/spatial/volume_query.rs`: prepared entity shapes share BSP queries.
- `crates/holtburger-core/src/kinematic_boom.rs`: initial and subsequent cast-origin placement
  both use the stationary free-sphere solver.
- `crates/holtburger-core/src/client/camera.rs`: activation repeats up to 256 stationary camera
  solves against one captured scene; failed solves do not advance the origin.
- `crates/holtburger-core/src/client/mod.rs`: activation requires camera settlement before
  enabling ordinary world simulation and sending login completion.
- `acclient-eor-source/acclient.c:348570-348652` and `:349132-349163`: retail distinguishes
  center-solid occupancy from an authored polygon hit.
- `acclient-eor-source/acclient.c:345850-345935` and `:345246-345286`: retail placement searches
  for a polygon and corrects against its plane; it expands its search when no polygon is found.

Geometry and placement correctness belong in the shared world layer. Camera convergence and
activation remain core behavior. App-host transport and h3d presentation should not implement
their own collision workaround.

## Constraints and accepted concessions

- A published placement must clear the requested sphere, not merely its center.
- Validate against the complete object and preserve scene-level contact and membership checks.
- Keep finite work and explicit failure when no valid placement is established.
- Rejecting all candidates must not become an empty contact list that falsely means clear.
- Preserve radius-only surface contacts, building-shell exclusions, and transformed geometry.
- Camera recovery must not mutate the authoritative player or enable gameplay during activation.
- A valid recovery endpoint need not be the mathematically nearest endpoint. Exact global
  optimality is outside this investigation; jumps through unrelated obstacles still need scrutiny.
- No camera-radius inflation, retry-budget increase, ignored collider, or swallowed fatal error
  is accepted as the production solution without an explicit decision.

## Candidate approaches

1. **Validate existing ancestor-plane correction candidates.** Test each endpoint against the
   full solid, reject solid-to-solid transitions, and select the shortest proven candidate.
   First test this offline; candidate completeness, work bounds, and failure representation are
   unresolved. Do not introduce production contracts before those questions are answered.
2. **Search authored external boundary geometry.** More general recovery, with additional
   geometric search and validation complexity. Revisit if the existing candidates are inadequate.
3. **Larger camera recovery envelope.** Narrower workaround, but changes camera placement policy
   and can reject tight spaces. The captured success alone is insufficient to select it.

## Initial offline candidate experiment (completed)

The original diagnostic walker has been removed. Asset-independent regressions now live alongside
the world solver and use its production implementation:

```sh
cargo test -p holtburger-world stationary
```

The temporary replay executable checked all eight captured input samples through the production
solver without logging in. It was removed during final review; the captured replay evidence remains
in `/tmp/h3d-camera-production-recovery.txt`, and the checked-in synthetic tests cover the algorithm
without requiring local DAT archives.

The prototype followed the center-containing leaf, transformed its ancestor planes into owner
space, sorts outward sphere corrections by distance, and checks every endpoint using cell transit,
scene placement contacts, and physical restrictions. A path deeper than 32 partition nodes fails
explicitly. The diagnostic examines every candidate to expose the distribution; a production
implementation now stops at the shortest validated candidate. No wall-clock performance claim
is made from this diagnostic.

| Case | Existing settlement | Candidate experiment |
| --- | --- | --- |
| Captured Y `83.99902`, radius `0.18131289` | Exhausts eight passes | Seven candidates; shortest clear correction rises `0.651812` m to Z `20.201813` |
| Nearby Y `83.8` / `84.2`, same radius | Exhausts eight passes | Seven / six candidates; same upward correction clears |
| Successful-login Y `82.66569`, either radius | Already clear | No recovery search |
| Captured and nearby origins, radius `0.48` | Settles in two to four passes | Shortest clear candidate rises `0.950499` m |
| Two adjacent synthetic solid leaves | Oscillates and exhausts | Rejects internal Y partition; either exterior X correction clears |
| Synthetic center outside, sphere overlaps face | Settles in one pass | Remains occupied; ordinary surface recovery applies |
| Rotated slab with nonuniform scale | Exhausts eight passes | Rejects internal partition; transformed exterior corrections clear |
| Surrounding slab blocks every selected-object candidate | Exhausts eight passes | Explicit recovery unavailable; never reports clearance |

The blocked-candidate fixture proves **incompleteness**, not impossibility: an endpoint beyond the
surrounding slab would be clear, but the selected object's ancestor planes do not propose it.
Candidate failure must therefore mean "no endpoint established by this search," not "no valid
placement exists." The existing impossible-corridor regression continues to reject placement.

Historical evidence: `/tmp/h3d-camera-recovery-candidates.txt`. The production replay is
`/tmp/h3d-camera-production-recovery.txt`. Checked-in tests need no external assets.
The initial content experiment covered one authored object and
eight origin/radius combinations; it does not establish a world-wide success rate.

## Selected production contract

- The BSP geometry layer owns center-containing solid classification, node-bounds pruning,
  transformed ancestor planes, and proposed endpoints. `SolidRegionRecovery` distinguishes outside,
  occupied (including no proposed endpoints), and the partition work limit.
- The scene layer gathers candidates from **all** initially occupied static BSP colliders, preserves
  ordinary admission and interior building-shell exclusions, and orders the endpoints by correction
  distance. `SolidPlacementCandidates` privately retains those starting collider references.
- Recovery paths may leave those starting colliders. Existing continuous sweeps still block other
  admitted geometry, terrain, and physical restrictions with their existing facing and contact-band
  semantics. Exemption is per placed collider, not per connected component within one collider.
- The free-sphere solver separately checks endpoint occupancy, full sphere contacts, restrictions,
  cell membership, coverage, and the complete correction path. It retains ordinary surface
  settlement for non-solid centers. Failed searches return `RecoveryUnavailable`, never an empty
  contact list or an unproven body. The contact-pass budget is retained.
- `SphereCollisionQuery::entity_sweep_sphere` supplies entity-only continuous collision for recovery.
  Camera queries reuse the normal sweep's entity admission, immutable part poses, and target
  exclusion. Static and entity endpoint checks use the same captured query authority.
- Core camera initialization and subsequent origin settlement handle recovery failure explicitly,
  retaining the existing failure policy. Initialization now carries the actual spent contact passes
  and coverage proof instead of inventing the maximum pass count for every failed settlement.
- Grounded response and ordinary motion still use their existing contact routing. Their shared
  helper was audited but not replaced as part of this stationary recovery change.

The search caps partition depth, total proposed endpoints, and starting-collider references at 32.
It checks at most 32 recovery endpoints per occupied placement, stopping at the first allowed clear
endpoint. The captured failure requires one correction rather than repeated alternating contact
passes. Ordinary stationary queries gain a center-region walk for nearby admitted BSP statics;
no performance benchmark or world-wide success rate is claimed.

The implementation adds roughly 430 lines of production collision/camera logic, with additional
synthetic regression coverage. The continuous sweep and entity narrow phases are reused, and the
copied prototype walker, its fixture code, and the incident-specific replay executable are removed. The extra
logic is chiefly occupancy/failure contracts, whole-scene admission, and path validation; a radius
workaround would be much smaller but would change the camera envelope.

### Accepted limits and follow-up work

- This finite candidate search is not a complete general penetration solver and does not promise
  the globally nearest exit. Limit exhaustion remains explicit.
- Exiting one containing collider can cross another component of that same collider. Connected
  component recovery is not implemented. Non-containing colliders and camera entities remain
  obstacles, and every final sphere placement is checked.
- Candidate generation covers authored static BSP occupancy. Deep initial entity-BSP penetration
  still relies on ordinary entity contact settlement; this change validates entities as obstacles.
- The same-destination UI teleport probe stalled in portal-space with no new camera generation;
  its cause is unproven. Arrival from another landblock produced a new, clear camera at this
  destination. Do not conflate the stalled activation with the proven partition oscillation.
- The full UI probe observes initial camera events as `advanced`, so its strict
  `provenInitialReseed` assertion fails even when destination readiness and a new camera generation
  are observed. The assertion was not weakened. Direct host lifecycle validation succeeds.
- Portal z fighting and popping were not visually checked or modified.

## Final validation

- `cargo test -p holtburger-world --lib`: 924 passed. Coverage includes adjacent solid leaves,
  overlapping starting solids, requested radius, outside-surface recovery, rotated nonuniform
  placement, unrelated path walls, entity path/endpoint blocking and target exclusion, work-limit
  failure, a solid region with no candidate, building-shell exclusion, and the impossible corridor.
- `cargo test -p holtburger-core --lib`: 559 passed with local socket permission. The four initial
  sandbox failures were socket creation errors; the complete permitted rerun passes.
- Clippy across world, core, debug harness, and h3d host, all targets, with warnings denied: passed.
  Cargo retains the existing `binrw` future-compatibility notice.
- Production static-content replay: all eight captured samples settle with complete coverage.
  Original radius `0.18131289` at the failing origin rises about `0.651812` m in one correction;
  the already-clear sample stays unchanged.
- Full h3d app: initial world entry succeeds at the failing location. Teleport away to
  `33.17S 72.85E`, then exact `@tele 42.4S 91.1W`, both report destination readiness with new camera
  generations. Return camera uses radius `0.1813128889`, approximately Z `20.201696`.
  Overall UI assertion remains false for the reseed-observation reason above.
- Direct host probe: `ok: true`, initial entry and both teleport generations reach `in-world`,
  no runtime-failure terminal event, and orderly exit code 0. Evidence is
  `/tmp/h3d-camera-host-fix.txt`; full UI evidence is `/tmp/h3d-camera-live-fix-arrival.txt`.
  A focused `teleport` host-probe mode was added to avoid unrelated movement/jump exercises.
- Rust formatting, focused probe-script formatting/lint, and diff whitespace checks pass.

## Phases and progress

### 1. Establish the algorithm with independent evidence

- [x] Reproduce the live failure and isolate stationary BSP penetration.
- [x] Reproduce offline and isolate the static collider.
- [x] Trace alternating solid-leaf partition corrections and compare retail behavior.
- [x] Prototype candidate validation in a diagnostic harness without changing production queries.
- [x] Compare the captured origin, nearby origins, and both measured radii.
- [x] Build asset-independent adjacent-solid, outside-surface, transformed, and blocked-candidate fixtures.
- [x] Verify genuine impossible-corridor rejection under the production contract.
- [x] Measure candidate count/query work and identify cases the candidate set cannot cover.

Acceptance: distinguish a proven clear endpoint, genuine occupied placement, and recovery failure
without conflating them; decide whether the narrow algorithm deserves production integration.

### 2. Reassess scope before production integration

- [x] Choose the owning query and explicit failure contract from the prototype evidence.
- [x] Audit grounded, static, and entity-shape consumers of the affected primitive.
- [x] Estimate runtime and line-count cost; prefer replacing the defective mechanism to layering
  a second camera-only path over it.
- [x] Record any change in approach or unresolved compatibility question here.

### 3. Implement and validate the selected change

- [x] Add focused synthetic regression coverage alongside the owning code.
- [x] Preserve outside-surface, transformed-shape, exclusion, and impossible-placement behavior.
- [x] Replay the captured real-content placement as a temporary diagnostic.
- [x] Verify initial entry and the exact live teleport command, allowing ACE session cleanup.
- [x] Run relevant Rust tests and clippy with warnings denied.

### 4. Cleanup and completion

- [x] Remove temporary instrumentation and tests requiring untracked runtime content.
- [x] Remove obsolete helpers and vocabulary if their mechanism is replaced.
- [x] Update this document with final evidence and limitations.

## Final code quality review

Reviewed the accumulated feature against HEAD, including new files, tests, immediate consumers,
and this document. The unrelated ACE submodule worktree was excluded.

- Traced transformed BSP candidates into scene admission, endpoint validation, correction-path
  sweeps, and committed sphere state. Scene-owned starting collider references stay private and
  are used only for the correction-path exemption.
- Inspected both `SphereCollisionQuery` implementations and the shared entity narrow phase,
  including current animation poses, swept membership, and camera-target exclusion. Inspected
  both core settlement consumers: initial activation and subsequent cast-origin settlement.
- Checked success, bounded recovery failure, contact-budget exhaustion, and strict versus
  explicitly uncovered coverage handling. Core consumes world outcomes and coverage evidence;
  it does not reconstruct solid occupancy or alter the requested camera envelope.
- Retained ordinary surface settlement and movement contact routing because those remain active
  behaviors. The new work belongs to stationary placement rather than a parallel camera solver.
- Removed the incident-specific DAT replay executable after validation, moved new test imports
  to the module header, and reused the already constructed placement request.

No blocking quality findings remain in the reviewed diff. The added geometry and validation logic
is justified by the bounded recovery contract; a smaller radius workaround changes behavior.
Accepted limitations above remain, particularly finite candidate completeness and exemption of an
entire starting collider. Rendering, UI event capture, same-destination teleport activation, and
world-wide content compatibility were not covered by this code quality verdict.

## Operational constraints

Do not run the interactive TUI or perform visual acceptance checks. Live h3d probes may capture
typed lifecycle and camera evidence. Avoid rapid reconnects: ACE rejects an account while its
previous session is registered; its example/default network timeout is 60 seconds. Actual server
configuration and final logout processing may differ. Prefer offline experiments and explicitly
allow cleanup time between live attempts.

## Decision log

- 2026-10-03: User authorized the investigation document and continued candidate investigation.
  Start with offline ancestor-plane endpoint validation; production algorithm remains undecided.
- 2026-10-03: The narrow search clears the captured and nearby failing static placements at the
  original radius. Preserve it as a candidate, with explicit unavailable recovery and complete
  scene validation. Blocked-candidate evidence rules out treating the search as exhaustive.
- 2026-10-03: Diagnostic executable and clippy with warnings denied pass. Production queries and
  camera behavior were unchanged at this checkpoint; live fix validation awaited implementation. Cargo reports an
  existing dependency future-compatibility notice for `binrw`, separate from clippy diagnostics.
- 2026-10-03: User authorized implementation. Selected stationary recovery with explicit failure,
  full endpoint validation, and path sweeps exempting only the initially containing static colliders.
  Production replay, world/core tests, clippy, and direct host entry/teleport checks now pass.
  Full app observations confirm entry and arrival at the original radius; strict UI reseed capture
  and same-destination activation observations remain separate follow-up work.
