# 3D client physics worksheet

Status: **Open**. This worksheet tracks successive user-reported issues; keep it open until the user exhausts their TODO list.

## 1. Sloped dungeon elbow blocks movement at portal seams

- Reported: 2026-09-09.
- Status: **Resolved**. Shared-physics fix implemented, automated and real-content checks passed, and the user confirmed the live client appears fixed on 2026-09-09.
- Location: EnvCell `0x001e02dc`, in an elbow corridor ascending two slopes.
- Symptom: Character gets stuck attempting to cross each portal seam. User additionally confirmed the opposite-side uphill approach; the reverse approach through `0x001e02da` is now reproduced offline as well.
- Evidence requested: Identify blocking geometry and solver decision, compare against retail behavior, and reproduce with a focused diagnostic before proposing a correction.
- Investigation route: Trace shared world collision and grounded movement, inspect authored corridor geometry, then use a live or offline harness as needed. Do not run the TUI.
- Local prerequisites: `dats/assets.hba` and `apps/holtburger-3d/.dev.env` exist. Offline diagnosis did not require reading credentials, logging in, or interrupting the user’s session. Credentials must not be copied into this worksheet or diagnostic output.

### Findings

**A speculative footing sweep invents an outdoor dependency; failure of that query rolls back an otherwise accepted move.** This reproduces with real dungeon content through `advance_body_contact_collection`, the contact solver used by the client. The exact logged-in character has not been replayed.

Authored geometry:

- `0x001e02dc`: environment `0x0d000115`, CellStruct `0x0002`, origin `(390, -270, 0)`, approximately 180° Z rotation. The elbow’s floor is at Z = -3.
- Portal 0 leads to `0x001e02da`; portal 1 leads to `0x001e02db`. Both reciprocal endpoints validate.
- These are internal portals. `collision_scene_probe`’s automatic crossing routes cover outside portals only; its zero traversals here do not establish successful movement.

Observed failure chain:

1. `mobile_contact/step/stairs.rs::settle_down` asks for the full downward probe before choosing reachable support.
2. `collision/static_sphere_sweep.rs::trace_static_sphere` computes placement over the entire attempted path before collision clipping.
3. The downward endpoint is beyond the cell’s containing volume. `collision.rs::recover_placement` searches nominal outdoor-grid owners and turns zero containment candidates into `Recovered { recovered_cell: None }`.
4. The resulting path says it reaches outdoors. This dungeon’s extended local coordinates map to outdoor owner `0x021cffff`, which the query then requires.
5. `settle_after_movement` treats that unavailable-owner error as unsupported footing. `advance_hard_motion` restores the saved supported pose and zeros timed movement velocity. Consequently, the final update’s `unavailable_owner` remains `None`, obscuring the rejected optional query.

Captured westbound failing lower-sphere query:

```text
anchor       0x001effff
previous     0x001e02da
radius       0.48
start        (387.79666, -270, -2.52)
end          (387.79666, -270, -4.02)
end recovery Recovered { previous_cell: 0x001e02da, recovered_cell: None }
query error  collision query requires unavailable owner 0x021cffff
```

Controlled replay: standard lower/upper centers Z = 0.475/1.35, radius 0.48, start root `(390, -270, -2.995)`, ten settling ticks then 80 driven ticks at 30 Hz, horizontal drive 4 m/s. Grounded settings copied from the existing diagnostic. Each direction starts independently at the elbow.

| Route | Dungeon owner only | Same replay with `0x021cffff` also resident |
| --- | --- | --- |
| West toward `0x001e02da` | Held at `(387.86334, -270, -2.995)` through tick 89 | Continued into `0x001e0269`, X ≈ 382.696 by end of tick 89 |
| South through `0x001e02db` | Held at `(390, -275.4678, 0.5917994)` in `0x001e02dd` | Continued in `0x001e02dd`, Y ≈ -277.222 by end of tick 89 |

Only the unrelated owner’s residency changed. This demonstrates a false dependency, not a recommendation to load neighboring terrain. It does not establish that every seam or character configuration has the same failure.

#### Follow-up: uphill approach into the elbow

The user also reports sticking on the other side while going uphill. A separate reverse-route replay confirms the same unavailable-owner failure approaching east through `0x001e02da` into `0x001e02dc`.

- Start: root `(383, -270, -5.995)` in `0x001e0269`, drive `(4, 0, 0)`, ten settling ticks then 120 driven ticks. Same body and physics settings as above.
- Dungeon owner only: climbs the ramp and crosses the portal, then remains at `(388.79733, -270, -2.4116764)` in `0x001e02dc` through tick 129.
- The instrumented rejected settle reports `collision query requires unavailable owner 0x021CFFFF`; an example candidate lower-sphere center is `(388.83798, -270, -1.9000686)`.
- Residency control: with only the additional `0x021cffff` owner loaded, the body continues onto the elbow’s flat floor, reaching X ≈ 390.385 and root Z = -2.995 after tick 90. Continuing straight eventually stops at the actual opposite wall, X ≈ 391.187; that terminal wall stop is expected.
- The baseline retains the ramp’s overhanging support above the flat floor near the seam. The control establishes the unavailable-owner dependency for this uphill failure too; it does not validate the separate support-footprint approximation.
- Evidence: `/tmp/holtburger-seam-uphill.txt`, `/tmp/holtburger-seam-uphill-control.txt`, `/tmp/holtburger-seam-uphill-traced.txt`, `/tmp/holtburger-seam-uphill-probe.rs`. Temporary harness and production instrumentation were removed again.

Retail reference comparison:

- `acclient.c:301308–301350`: `CTransition::step_down` probes downward through `transitional_insert`, requires valid support, then validates placement.
- `acclient.c:301488–301547`: `transitional_insert` starts with the existing `check_cell`, inserts into that cell, and checks other cells after an OK result.
- `acclient.c:302082–302090` and `345329–345510`: walkable footprint checks. Our full-radius horizontal footprint is already marked as a retail divergence in `bsp_query.rs`; the replay also exposes support overhang behavior, but changing that is not justified by the residency control alone.

The architectural issue is that a proposed endpoint’s containment recovery is being treated as required travel before hard collision has established how far the body can actually move. Retail references corroborate the relevance of collision-aware cell handling; they are not a complete differential proof of a replacement algorithm.

### Investigation handoff (before implementation)

- Completed real-content baseline and residency-control replays; temporary logging captured the downward path, false outdoor recovery, and swallowed unavailable-owner failure.
- Removed all temporary production instrumentation, the temporary visibility change, and the asset-dependent harness source from the repository. Only this worksheet remains changed.
- Local evidence: `/tmp/holtburger-dungeon-seam-final.txt`, `/tmp/holtburger-dungeon-seam-neighbor.txt`, `/tmp/holtburger-elbow-geometry.txt`, and `/tmp/holtburger-dungeon-seam-probe.rs`. These are session-local diagnostics, not durable test fixtures. The saved harness used a temporary public `ContactBodyUpdate::apply_physical_state`; adapt it to a module-local test or a public scene API for future runs.
- Proposed correction direction: keep speculative collision queries tied to reachable cell topology and resolve coverage against physically reachable travel. An endpoint behind a floor must not manufacture outdoor residency. Audit the zero-candidate recovery rule for dungeon coordinates as part of that work. Do not fix this by globally suppressing unavailable-owner errors or expanding dungeon interest to outdoor terrain.
- Before landing a correction, add an asset-free regression covering a sloped seam beyond the nominal 192 m owner square, downward probes extending past solid floors, and genuine portal exits/missing coverage. Verify both movement directions through these real cells and finally the user’s character in the 3D client.
- At the investigation handoff, no production fix had been implemented. See the completion record below for the final implementation and verification.

### Fix scope and implementation plan

Goal: cross the reported ramp seams in both directions with only the dungeon’s required content resident, while preserving solid collision and genuine missing-coverage rejection.

This is a focused correction to shared collision-query semantics in `holtburger-world`. The evidence proves the reported routes depend on unrelated outdoor residency; it does not yet prove a final algorithm or the prevalence of the bug across all dungeons. The phases below define the completed implementation scope. The completion record below captures the final contract, evidence, and limitations.

#### Boundaries

| In scope | Outside this issue |
| --- | --- |
| Distinguish attempted sweep geometry from physically reachable travel and accepted placement | Corridor-specific IDs, coordinate exceptions, or authored asset changes |
| Stop speculative endpoint recovery from manufacturing an outdoor requirement behind solid geometry | Loading neighboring terrain to compensate or changing scene-interest policy |
| Audit dungeon owner handling in containment recovery where it participates in this failure | A general rewrite of authoritative relocation, reconciliation, or all placement APIs |
| Carry coherent hit, path, membership, and coverage facts through static, hard-entity, and two-sphere sweep composition | New frontend physics policy, UI diagnostics, or permanent logging/metrics |
| Preserve grounded settling, stair clearance, genuine exits, and missing-content rejection | Retuning slope thresholds, step heights, sphere sizes, or collision tolerances |
| Add deterministic synthetic regressions and real-content replay verification | Replacing the existing support-footprint approximation without separate evidence |

The overhanging ramp support observed in the replay remains an explicit limitation of the current model. If it independently prevents acceptance after this correction, isolate that failure and revise scope with evidence; do not bundle a speculative footprint redesign into the residency fix.

#### Contracts and implementation direction

- A sweep endpoint is a proposal, not proof that a body occupies that domain. `transit_motion_path` explicitly documents accepted geometric motion as its input, but `trace_static_sphere` currently sends it the full attempted segment. Remove this semantic mismatch at the query boundary.
- Start from the prior cell and authored portal connectivity. Reuse existing portal traversal and geometric queries; do not replace them with a whole-dungeon scan or rebuild retail’s object architecture.
- Evaluate collision and coverage in travel order. A proved blocker can terminate a query before an otherwise missing domain is needed. Missing coverage encountered before that blocker remains a failure: finding a wall somewhere in the resident geometry is insufficient proof that the preceding path is covered.
- Sphere extent matters at portals. Admit adjacent geometry when the sphere can contact it, not only after its center crosses the plane. Preserve legitimate indoor-to-outdoor portals, including a real outdoor exit followed by a collision.
- Resolve static and hard-entity hits before declaring the reachable extent final. Resolve the common stopping fraction for the lower and upper spheres before requiring coverage that lies only beyond that stop. Do not allow a full-length query for one sphere to fail on an unreachable suffix when the other sphere already blocks the body.
- Keep fractions in the original requested segment’s frame, or migrate every consumer together. `accepted_prefix`, `ContactBodyPath`, and support settling must not reinterpret a shortened path as if it still represented the full attempt.
- The layer deciding reachability owns its contract facts. Consumers read those facts; they must not independently reconstruct coverage from the attempted endpoint or a union of domains beyond the hit. Prefer refining existing internal result types over parallel APIs or additional flags.
- Containment recovery is distinct from portal traversal. Review `recover_placement`’s nominal-grid search and zero-candidate outdoor result for this use. First remove its use as proof of a speculative endpoint; change general recovery behavior only where an explicit caller and regression establish the need. Do not globally force all failed indoor containment to remain in the old room.
- Keep legitimate errors explicit. Optional stair/settle routes may still reject missing coverage; this fix removes the false dependency rather than swallowing `UnavailableOwner`.

#### Ground truth and expected touch points

All paths below are relative to `crates/holtburger-world/src/spatial/` unless otherwise stated.

| File / symbols | Responsibility in this fix |
| --- | --- |
| `collision/static_sphere_sweep.rs`: `trace_static_sphere`, `sweep_hard_sphere`, `HardSphereSweep` | Separate attempted geometry from reachable domains; compose geometry and coverage without inferring outdoors from a blocked endpoint |
| `collision.rs`: `transit_motion_path_internal`, `infer_placement_from_cell`, `recover_placement`, `require_query_coverage`, `complete_query` | Reuse portal traversal, preserve accepted-path semantics, and audit recovery/coverage ownership |
| `mobile_contact/step.rs`: `sweep_body_chords`, `accepted_prefix`, `ContactBodyPath`, `advance_hard_motion` | Compose both spheres’ blocking fraction and retain coherent accepted paths and membership |
| `mobile_contact/step/stairs.rs`: `settle_down`, `settle_support_candidate`, `settle_after_movement` | Consume proved reachable support without demanding domains beyond the stopping contact |
| Existing collision tests and `scene/physical_body_tests/contact_step_tests.rs` | Colocate synthetic query-level and integrated movement regressions |
| `crates/holtburger-debug-harness/src/bin/collision_scene_probe.rs` or a temporary module-local replay | Re-run the recorded internal seam routes using the actual contact solver, without public API changes solely for diagnostics |

Retail reference anchors are the `step_down`, `transitional_insert`, and footprint functions listed above. Before changing portal traversal, inspect their called cell-insertion/other-cell routines as well; the existing excerpts alone do not specify all sphere-overlap or recovery behavior. Use the existing synthetic portal/placement tests as controls, not as unquestionable specifications when they encode the faulty ordering.

#### Phase 1 — Pin the failure and settle the query contract

- [x] Build an asset-free floor/ramp and adjoining-cell fixture outside the owner’s nominal 192 m square. Demonstrate an attempted downward endpoint outside containment while a floor blocks the probe first.
- [x] Reproduce the false owner requirement at query level and the held pose through the contact collection. Assert behavior and membership, not temporary diagnostic messages.
- [x] Trace all consumers of any sweep/path contract to be changed, including static-only sweeps, hard entities, two-sphere movement, and support selection. Name where the attempted extent, stopping fraction, and accepted placement are needed.
- [x] Choose the smallest internal traversal/result change satisfying the contracts above. Prefer splitting the mismatched responsibility and deleting redundant inference over adding a second solver or a recovery mode flag.

Acceptance: the regression fails for the demonstrated reason on the current implementation; the chosen contract accounts for hard-entity and upper-sphere blockers as well as the lower-sphere floor case. Record the decision here before extending implementation.

#### Phase 2 — Correct collision and coverage ordering

- [x] Implement reachable-domain collision admission and coverage in the shared query path, preserving portal overlap and movement fraction semantics.
- [x] Compose static, hard-entity, and body-sphere results so unreachable suffixes do not impose coverage requirements.
- [x] Adapt grounded support selection and accepted path publication to the result once, at their owning boundaries. Keep existing support/step policy unless a separate failure is proved.
- [x] Audit recovery callers and remove speculative-endpoint recovery from this path. Apply any necessary dungeon owner correction with its own focused regression.
- [x] Reassess scope if the implementation starts duplicating portal traversal, introducing broad recovery fallbacks, or adding substantial solver machinery. Record the concrete reason and simplify before proceeding.

Acceptance: the synthetic seam passes without unrelated content; adding that content does not change accepted movement, cell membership, or support within the test’s numerical tolerance. Genuine missing coverage still fails.

#### Phase 3 — Verify the compatibility boundary

Required regression scenarios (share fixtures where they exercise the same geometry):

| Scenario | Required outcome |
| --- | --- |
| Downward probe extends beyond a solid dungeon floor | Finds reachable support without an outdoor lookup |
| Ramp-to-flat and flat-to-ramp across connected cells, both directions | Continues with supported motion and correct committed cell |
| Same indoor fixture with unrelated outdoor owner absent/present | Equivalent accepted trajectory and support |
| Wall or floor blocks travel before a missing domain | Accepts only the proved collision-limited movement; no demand for content beyond it |
| Real portal leads into missing coverage before any proved blocker | Explicit missing-coverage rejection; no tunneling or fabricated support |
| Real loaded indoor/outdoor crossing and sphere overlap at its seam | Preserves collision with both legitimately reached sides and correct placement |
| Upper sphere or hard entity blocks before a lower sphere’s proposed endpoint | Stops the complete body at the shared earliest hit; no unsupported suffix requirement |
| Actual unsupported edge and low-ceiling stair attempt | Retains existing edge protection and upper-clearance rejection |
| Valid initial placement versus genuinely invalid initial containment | Does not hide real recovery errors under the speculative-query correction |

- [x] Run focused regressions, then `cargo test -p holtburger-world` and `cargo test -p holtburger-core` for shared movement consumers.
- [x] Run `cargo fmt --all -- --check` and `cargo clippy -p holtburger-world -p holtburger-core --all-targets -- -D warnings`; include any changed harness package in lint/check coverage.
- [x] Replay all three recorded routes with dungeon-only residency: westbound descent, southbound ascent, and eastbound uphill approach. Compare with the unrelated-owner control. Use route checkpoints before actual corridor walls as the success criterion, not indefinite straight-line motion.
- [x] Confirm the user’s character crosses the reported seams in the 3D client. The temporary standard-body replay is not a substitute for final live verification. Never run the TUI for this check.

Acceptance: automated contracts pass, every recorded route clears its seam without the control owner, and live verification is recorded or explicitly remains outstanding. If a browser/host boundary changes, also run the canonical browser harness for that boundary.

#### Phase 4 — Cleanup and closure of issue 1

- [x] Remove superseded inference, duplicate paths, stale terminology, temporary visibility changes, logs, and asset-dependent tests. Retain only useful reusable diagnostic support.
- [x] Review the final diff for crate ownership, honest result types, and justified line growth. No app-local workaround should remain.
- [x] Record final implementation decisions, validation results, and residual support-geometry limitations here. Mark issue 1 resolved only after its acceptance checks pass; keep the overall worksheet open for subsequent reports.

#### Risks and implementation decisions

The main risk is a superficially successful fix that checks coverage only after finding a resident hit: it could miss unavailable geometry earlier in the path. Ordered reachability and explicit missing-before-hit tests are mandatory. A second risk is publishing membership or support from the discarded part of a sweep; verify these facts alongside position. Finally, truncating a path too early can lose adjacent-cell collision or corrupt existing fraction consumers, so the contract review precedes implementation.

The implementation separates candidate membership, prepared hits, and collision-limited placement. Portal-plane overlap intervals restrict outdoor coverage within accepted legs. General placement recovery, support-footprint policy, and scene interest remain outside the correction; changes to those mechanisms require independent evidence.

### Completion record

Issue 1 is resolved. The user confirmed the live result with “yup, seems fixed to me” after being asked to try both seams in both directions, including the uphill approach. This is user-observed verification, not an instrumented live trajectory capture.

#### Final implementation and ownership

- `collision.rs` reuses one directed portal-crossing loop for accepted motion and candidate selection. `sweep_candidate_membership` does not recover an unaccepted endpoint behind solid geometry as outdoors. The shared return is candidate membership, not a fabricated accepted path.
- `collision/static_sphere_sweep.rs` separates resident hit preparation from accepted path and coverage validation. Hard entities participate before coverage rejection; the body solver combines both movement spheres’ hits before finalizing their common stopping fraction.
- `HardSphereSweep.path` contains only collision-limited travel, normalized to that accepted segment. The hit fraction retains its meaning relative to the original request. Body travel, projectiles, edge slides, and stair lifts consume the accepted path directly. Downward support selection converts its fraction to the accepted path’s normalization before retaining a shorter interval.
- Interior coverage uses authored owners. Outdoor coverage applies over the sphere’s overlap intervals with authored outside portal planes, using the existing cell-reach tolerance. Legs beginning outdoors retain ordinary outdoor checks. Exceptional accepted placement recovery keeps conservative coverage validation.
- General accepted-placement recovery remains intact. Its existing regression demonstrated why removing endpoint recovery globally would be incorrect. No general relocation redesign or forced dungeon membership was needed.
- The change stays in `holtburger-world`. No corridor-specific condition, terrain-loading workaround, app-local physics policy, or support tuning change was added.

#### Verification evidence

| Gate | Evidence |
| --- | --- |
| Original failure pinned without assets | `indoor_floor_sweep_does_not_require_outdoors_beyond_the_floor` failed with missing outdoor coverage on the original implementation, then passed with the fix |
| Integrated ramp seams and residency independence | `dungeon_ramp_seam_crosses_both_directions_without_unrelated_outdoor_content` checks both directions, poses, support classification/normal, and committed cell with/without the unrelated owner |
| Coverage before versus after blockers | `sphere_sweep_requires_coverage_before_a_blocker_but_not_after_it` exercises static and hard-entity blockers and genuine missing coverage |
| Composite body clearance | `upper_sphere_blocker_limits_both_spheres_coverage` proves an upper blocker bounds both spheres, while the lower-only control requires the missing owner |
| Physical outside portal | `outdoor_portal_overlap_requires_neighbor_before_center_crossing` checks overlap before center crossing, a missing neighbor, a loaded exit, and reverse entry |
| Unsupported edges and low ceilings | Existing `ordinary_edge_protection_keeps_footing_and_tangent_motion_but_accepts_short_drops`, `contact_correction_preserves_protected_ledge_footing`, and `contact_advance_steps_without_launching_and_respects_upper_clearance` pass |
| Legitimate recovery | Existing `generic_body_commits_the_placement_repaired_by_its_motion_path` and the placement/recovery suite pass |
| Full shared-runtime checks | `cargo test -p holtburger-world -p holtburger-core`: 724 world tests and 375 core tests passed; doc tests passed |
| Static checks | `cargo clippy -p holtburger-world -p holtburger-core --all-targets -- -D warnings`, `cargo fmt --all -- --check`, and `git diff --check` passed |
| Real-content replay | All three routes cleared their seams. 390 diagnostic rows (130 ticks per route) matched exactly with/without `0x021cffff` resident |
| Live client | User confirmed the fix after rebuilding/restarting and testing; no TUI diagnostics were used |

Final real-content checkpoints at the start of tick 90, each still moving:

| Route | Cell | Root position |
| --- | --- | --- |
| Westbound descent | `0x001e0269` | `(382.6956, -270, -5.995)` |
| Southbound ascent | `0x001e02dd` | `(390, -277.2221, 0.005)` |
| Eastbound uphill approach | `0x001e02dc` | `(390.25195, -270, -2.995)` |

Session-local evidence: `/tmp/holtburger-seam-completion-tests.txt`, `/tmp/holtburger-seam-completion-clippy.txt`, `/tmp/holtburger-seam-completion-routes.txt`, and `/tmp/holtburger-seam-completion-control.txt`. These logs are diagnostic artifacts, not required test assets.

#### Scope correction during implementation

A 375-metre synthetic sweep through an extended room to an outside opening exposed a remaining coverage-contract limitation. It was initially described as a major blocker without proving that shipped content and a current gameplay caller could produce that combination. That characterization was too strong: ordinary movement is tick-bounded, and this was not a reproduced gameplay scenario or a teleport portal.

The test still provided a useful contract check. `finish_sphere_path` had applied an endpoint’s outdoor reach to an entire accepted leg, demanding terrain under earlier indoor travel. Portal-plane overlap intervals resolved that limitation without a new traversal system or a broader physics rewrite. The synthetic distant-exit test now passes. No claim is made that the synthetic configuration occurs in retail content.

#### Cleanup, review, and residual limits

- Reviewed the candidate/accepted boundary, static-only and hard-entity sweep callers, two-sphere composition, support fractions, projectile/edge/stair consumers, and the camera’s explicit uncovered-query policy. Core and world tests validate those shared consumers; no browser, renderer, or host API boundary changed.
- Extra query work is the cost of resolving accepted placement after hit composition and restricting coverage to portal overlap. No performance improvement is claimed. Most added lines are synthetic regression fixtures; retained runtime helpers each own a distinct decision and reuse the existing crossing loop.
- Temporary production logging, public visibility for replay, and asset-dependent harness source were removed. The retail decompile is unchanged.
- The requested pre-commit code-quality pass found no blocking design issues. Final cleanup colocated imports and documented conservative outdoor coverage after accepted placement recovery.
- The existing full-radius horizontal support-footprint approximation remains. This work proves the seam fix and listed compatibility checks, not a census of all collision/content behavior or complete retail parity.
- The overall worksheet remains **open** for the user’s next physics issue.

## 2. Brief directional slowdowns while running through a hallway

- Status: **Implemented and verified with automated checks and live host runs**. User visual confirmation remains optional; the worksheet stays open.
- Reported/investigated: 2026-09-10.
- Report: At full running speed, moving straight ahead from the parked character produces roughly two slight slowdowns. Similar behavior occurs in some hallways and directions.
- Captured parked pose: cell `0x001e0122`, position `(470.2124, -328.0878, -17.9950)`, rotation `(w=0.00699426, x=0, y=0, z=0.99997431)`. User confirmed the facing direction is the reproduction direction.
- Investigation: Passive diagnostic login captured the pose without issuing movement. Compare production contact-solver travel against requested speed, then identify the geometry and exact decision at each loss. Distinguish collision response, contact-pass exhaustion, and presentation/network timing before assigning a cause.
- Scope: Investigation and worksheet evidence; no production fix selected yet.

### Findings and evidence

**The live position-confirmation constraint periodically throttles otherwise valid running.** The geometry-only replay does not reproduce the slowdown. There are also two physical NPCs near the middle of this particular route; the original live run deflects around them. Those deflections should not be conflated with the independently measured synchronization slowdown.

- Passive login captured the parked pose, setup `0x02001a9c`, and scale 1. No graphical client or TUI was needed.
- Offline production contact-collection replay traversed the authored hallway from the parked pose, both along the facing direction and exactly south, at 8 and 18 m/s. After motor acceleration, travel stays at the requested speed until the real end wall around Y = -407.8535. The diagnostic uses the standard human sphere pair and no live entities or server confirmations; it isolates static geometry rather than reproducing the complete character runtime.
- A 6.5-second live forward run through the actual client host showed approximately 18 m/s before the dips. It remained grounded at Z = -17.995. This establishes actual host movement loss independently of renderer timing.
- A subsequent instrumented northbound run independently reproduced gradual throttling. Of 82 sampled full-speed proposed steps, 64 were reduced by the confirmation constraint. These are samples from one diagnostic run, not population statistics.
- At `(468.62317, -390.74673, -17.995)` in cell `0x001e0128`, the producer requested Y travel `+0.541215`; the confirmation layer reduced it to `+0.21835627`. Its accumulated distance was `13.948165`, giving the exact multiplier `(20 - 13.948165) / (20 - 5) = 0.403456`. The resulting accepted tick travelled `+0.21835327`, at Y velocity `7.260342` m/s. Its path contained ordinary travel without a hard impact. The next confirmation reset the distance to `0.21840854`, and the next full-speed proposal was admitted without damping.
- The two physical Viamontian Knights were observed around `(470, -369.98)` and `(468.587, -372.98)`. The forward run's sideways excursions occur in this area. Their presence is established; this investigation does not claim that every NPC-contact response is correct.

### Cause and source contract

1. `client/messages.rs::apply_local_position_authority` classifies ordinary local-player position packets as `AuthoritativePoseEffect::Confirm`.
2. `SpatialScene` applies the confirmation to `PoseReconciliationState`. It starts with the distance from the newly confirmed pose to the current client pose.
3. `pose_reconciliation.rs::retail_constraint_distances` permits 5 m of indoor travel before damping and uses a 20 m limit. `constrain_translation` scales each proposed step, accumulating the scaled distance until another confirmation arrives. The live diagnostic directly captured this reduction before collision handling.
4. `client/movement/common.rs` sets the routine autonomous-position heartbeat to one second. `maybe_send_autonomous_position_heartbeat` checks that deadline; it does not trigger on cell or contact-plane changes. At 18 m/s, five metres takes roughly 0.28 seconds, so a healthy connection can still spend much of the interval throttled.
5. ACE `Player_Tick.cs::UpdatePlayerPosition` sends an update to the player after an accepted position update, including when the broader one-second broadcast threshold has not elapsed. The client's outgoing-report policy therefore matters to when its next confirmation becomes available.

Retail references establish an actual publication-policy gap, not grounds to delete the constraint:

- `acclient.c:304336-304373`: the same 5/20 m indoor and 10/50 m outdoor thresholds.
- `acclient.c:372268-372319`: contact-gated travel damping and reset from confirmed/current separation.
- `acclient.c:139027-139039`: routine local-player position updates re-arm the constraint.
- `acclient.c:682586-682608`: `ShouldSendPositionEvent` sends early when the cell or contact plane differs, before the ordinary time interval expires. On the timed path, it checks that position actually changed.
- `acclient.c:682671-682708`: `SendPositionEvent` checks valid supported placement and records the sent position, time, and contact plane together.
- `acclient.c:682267`: retail's ordinary position interval is also one second. Merely copying that interval omits its event-driven send conditions.

### Agreed design direction — movement position publication

Status: **Implemented**. Replace timer-only routine scheduling with one publication decision combining cell change, meaningful support change, distance travelled, and heartbeat. Retail establishes the omitted behavior and useful reference contracts; reproducing its exact trigger set is not a requirement. Measure this policy before introducing a complete contact-plane trigger.

#### Ownership and available facts

Keep publication policy in the existing `holtburger-core` client `MovementSystem`. It already owns movement packets, sequence metadata, control authority, successful movement publication, and world-epoch cleanup. A small internal publication state/helper is appropriate; a separate top-level system or frontend event channel is unnecessary.

| Owner | Responsibility |
| --- | --- |
| `holtburger-world` | Produce accepted placement, committed cell, contact state, and support facts; retain the server-confirmation constraint. |
| Core `MovementSystem` | Decide when to report those facts, construct movement packets, and record successful publication. |
| `holtburger-session` | Transport packets; do not derive gameplay publication policy. |
| 3D app | Supply input; no position-report scheduler or copied physics state. |

`MovementSystem::tick` already receives `WorldState`. Existing builders read `local_player_runtime_pose` and runtime contact state; the scene exposes the player's body, accepted motion, and physical response. These facts can be read directly. Retained support contains a normal, footprint classification, and source proof, but not a complete contact plane. Do not expand that contract solely to copy retail's plane comparison.

Current runtime ordering publishes movement before physics simulation. Keep input admission before simulation, but evaluate routine position publication after the accepted physics step, still through `MovementSystem`. This lets the decision use the newly accepted cell, support, and travel without introducing asynchronous state transfer.

#### Proposed triggers

| Trigger | Meaning and boundary |
| --- | --- |
| Committed cell change | Report entry into a different cell. Sphere overlap with an adjacent cell alone is not a committed transition. |
| Meaningful support change | Report landing, leaving support, or switching support bodies, such as floor to moving platform. Verify stable support identity before implementing the comparison. |
| Distance travelled | Report after a measured budget of accepted travel since the last position publication. Faster actual movement naturally sends more frequently; held input against a wall does not. |
| Heartbeat | Preserve a maximum routine interval and explicitly define unchanged-pose behavior and any outstanding synchronization needs. |

Combine applicable triggers into at most one routine position report per simulation tick. Do not equate a new triangle, supporting polygon, or collision-proof revision with a meaningful support change: those can change while traversing one continuous floor. Contact state and support source already exist. The implementation uses entity body IDs as stable support identity and ignores static-world proof revisions; grounded/sliding transitions and support disappearance are covered explicitly.

Prefer accumulated accepted travel over displacement from the last sent position, because turns and backtracking still consume the confirmation travel allowance. The existing `AcceptedBodyMotion` stores net displacement divided by tick duration, not exact path length. Decide whether summing consecutive accepted tick displacements is sufficient; if exact within-tick path length is necessary, derive it once in the physics owner. Do not silently treat requested speed or retained velocity as distance actually travelled. Teleports and other epoch resets must not count as ordinary travel.

#### Publication state and constraints

- Consolidate related bookkeeping around the last successfully published position sample: pose/cell, meaningful support state as available, send time, and travel accumulated since publication. Audit every position-bearing send path, including `MoveToState`, stops, and explicit synchronization. Respect differences in the facts each packet carries rather than resetting all baselines indiscriminately.
- Advance send bookkeeping only after successful submission to the session. Sending a report does not itself confirm the position: only incoming authority resets the spatial confirmation constraint.
- Preserve packet sequence metadata, control/autonomy rules, and world-epoch cleanup. Audit packet/contact eligibility for landing and leaving support; do not copy retail's supported-placement gate in a way that makes the proposed departure trigger unreachable.
- Keep confirmation damping intact. Choose the distance budget with room below the 5 m indoor threshold for normal confirmation latency and tick granularity. Select the actual budget from measurements, not an unexplained constant. No cadence can prevent throttling when confirmations stop arriving.
- More frequent reports cost bandwidth and server work. Measure publication frequency alongside speed stability. A distance trigger may also be useful outdoors, where the free-travel threshold differs; avoid inventing separate speed-adaptive timers unless the simpler policy proves inadequate.
- Document the departure from retail scheduling with source citations and measured scope under the repository's compatibility-marker convention. The bounded evidence below establishes the improvement for the tested conditions, without claiming complete retail equivalence.

#### Validation requirements

Replay the same hallway at the character's actual full speed. Capture sent and received positions, report reasons, and pre/post-constraint displacement; distinguish clear-floor intervals from NPC encounters. Measure trigger contributions separately so a successful combined run does not hide an ineffective or noisy trigger.

Focused checks should cover committed cell transitions, landing/departure and support-body changes, continuous-floor polygon changes, fast and slow travel, backtracking, stationary/wall-blocked input, heartbeat behavior, failed sends, position-bearing message coordination, and authority/teleport resets. Test latency and missing confirmations to ensure the safeguard still works. The implementation outcome below records the selected support comparison, distance budget, unchanged-pose heartbeat behavior, and post-simulation integration.

### Implementation outcome and verification

- [x] Resolve publication ownership and support identity without adding a new subsystem.
- [x] Replace the timer-only state and evaluate routine publication after accepted simulation.
- [x] Coordinate successful movement/transient/stop and autonomous-position publication.
- [x] Verify meaningful support changes, distance/backtracking, heartbeat, and epoch behavior.
- [x] Reproduce the improvement in the live hallway and measure report cadence.
- [x] Remove temporary production diagnostics and rebuild the clean host.

`MovementSystem` retains a small `PositionPublication` helper in `client/movement/position_publication.rs`. Initial valid placement reports immediately. Subsequent routine reports combine committed-cell change, contact/support-body change, **2 m accumulated accepted travel**, and a **one-second heartbeat**. The heartbeat remains active while stationary, preserving the prior keepalive behavior. At most one routine decision is evaluated per simulation tick; explicit command packets retain their own protocol ordering.

Support comparison distinguishes unknown, airborne, grounded, and sliding states. Supported states retain the entity body ID when present; static geometry and its proof revisions do not create distinct supporting bodies. No full contact plane or new shared-world API was added. The runtime reads the world's solved facts directly.

Distance is the sum of successive accepted tick displacements in `WorldPosition` coordinates, not retained velocity or a straight line from the last report. It counts backtracking across ticks. It intentionally does not request exact within-tick collision-path length: this publication budget is an early-report policy, not the authoritative confirmation constraint. Player identity and instance, teleport, force-position, and server-control sequences delimit the baseline; retirement/absence clears it. Normal server confirmations do not clear the publisher's travel counter, and sending never clears the world's confirmation constraint.

Movement-state, transient-motion, and stop packets now share one packet-construction/submission path and update the same successful-publication baseline as autonomous position reports. Failed submission does not record a successful report. The jump packet remains separate: it carries the launch origin and velocity rather than the accepted post-step contact sample. ACE `Player.cs::HandleActionJump` applies the jump velocity/contact transition without consuming `jump.Position`; the subsequent routine support-departure report must not be suppressed by treating that action as a position confirmation.

#### Evidence

| Check | Observed result |
| --- | --- |
| Real confirmation constraint, 18 m/s and 100 ms delayed echoes, one-second-only control | Throttles below 60% of requested speed. |
| Same synthetic case with the 2 m trigger | No damping; a slower 6 m/s run also remains unthrottled and sends fewer reports. |
| Same policy with confirmations withheld | Still throttles below 1% of requested speed; reporting does not bypass the safeguard. |
| Live southbound clear hallway section, approximately Y -326 to -364 | 70 full-speed proposed steps, zero damped; maximum observed pre-step confirmation distance 1.628 m. |
| Live northbound return, approximately Y -363 to -333 | 57 full-speed proposed steps, zero damped; maximum observed pre-step confirmation distance 1.631 m. |
| Return-run publication reasons | During the 1.8-second drive: 13 distance reports and 3 cell reports, about 8.9 routine reports/s. Entire capture additionally included one initial and two heartbeat reports. |
| Core/world suites after implementation cleanup | 378 core and 724 world tests passed (1,102 total), plus doctests. |
| Final checks | Core/world/3D-host all-target clippy passed with warnings denied; formatting and diff checks passed; clean debug host rebuilt successfully. |

These are two local-host run captures and deterministic fixtures, not a latency or content census. The 2 m budget reserves 3 m before the indoor damping threshold; tick granularity and time awaiting confirmation consume that margin. The 100 ms delayed-echo fixture and actual hallway runs validate this choice for those conditions. Higher latency can still cause damping, intentionally. Extra network/server work is the measured trade-off; no runtime-configurable speed timer or adaptive latency controller was added.

Policy tests independently exercise the triggers, support-body transitions, ignored geometry-proof changes, retry bookkeeping, backtracking, stationary behavior, and all recorded epochs. Integration tests verify that accepted placement is read at publication and that motion packets/explicit synchronization prevent a redundant routine report. The full core suite retains packet metadata and authority/control tests. The `RETAIL DIVERGENCE` comment cites the original scheduling rules and the bounded verification scope.

Final live pose: `(471.0750, -331.6026, -17.995)` in `0x001e0122`, near the original entrance and facing approximately north. Both diagnostic clients disconnected cleanly. The requested pre-commit code-quality pass covered the publication policy, packet builders and send paths, post-simulation runtime integration, epoch cleanup, tests, and worksheet. It found no blocking design issues. The delayed-confirmation fixture now schedules its 100 ms echoes by time rather than assuming three simulation ticks.

### Diagnostic artifacts and cleanup

Implementation evidence is also retained under `/tmp/holtburger-publication-live.jsonl`, `/tmp/holtburger-publication-live-stderr.txt`, `/tmp/holtburger-publication-return.jsonl`, `/tmp/holtburger-publication-return-stderr.txt`, and `/tmp/holtburger-publication-final-tests.txt`. Temporary constraint/report logging was removed; shared world physics and its confirmation safeguard have no implementation diff.

Session-local evidence: `/tmp/holtburger-hallway-passive.json`, `/tmp/holtburger-hallway-live.jsonl`, `/tmp/holtburger-hallway-offline.txt`, `/tmp/holtburger-hallway-offline-18.txt`, `/tmp/holtburger-hallway-instrumented.jsonl`, and `/tmp/holtburger-hallway-instrumented-stderr.txt`. Temporary offline harness and instrumented source copies are retained only under `/tmp`; no credential values belong in this worksheet.

The original diagnosis runs moved the character. At that stage, the last observed pose after the return run was: `(467.2666, -366.6013, -17.995)` in `0x001e0126`, facing approximately north. Diagnostic clients disconnected after each capture.

## 3. Angled movement sticks against walls

- Reported: 2026-09-10.
- Status: **Resolved**. The user confirmed the movement-vector change fixes the observed behavior and authorized closing this issue.
- Symptom: Running obliquely into obstacles frequently stops the character instead of preserving lateral wall sliding. The user reports retail preserves the lateral component except for a directly perpendicular approach.

### Diagnosis

**The shared hard-collision sweep can mistake a projected wall tangent for another inward impact because its endpoints round in the stored coordinate frame.** Repeated zero-time impacts consume all three slide continuations and leave the character stationary. This reproduces through the production scene contact path against one flat polygon wall, without networking, portals, ramps, or other bodies. The exact wall observed by the user has not been captured; the synthetic case proves an independently sufficient cause of the reported symptom.

The active path is `mobile_contact/step.rs::advance_hard_candidate`, not the older standalone grounded solver. It already removes inward velocity and spends the remaining time sliding. `sweep_body_motion` checks both body spheres. `collision/static_sphere_sweep.rs::MovingSphereCast::new` reconstructs travel by subtracting stored endpoints; `update_triangle_hit` treats any negative normal approach as collision-eligible. At an existing wall contact, the tiny inward component created by that rounding can produce another immediate hit even though the intended motion is tangent.

Recorded 30-degree wall case:

- Wall normal: `(-0.8660254, -0.5, 0)`.
- Intended tangent for a remaining tick: `(-0.0075, 0.012990382, 0)`; its normal dot product is approximately `-4.66e-10`.
- Reconstructed sweep chord: `(-0.007499695, 0.012992859, 0)`; its normal approach is approximately `-1.50e-6` m.
- Starting plane distance: `0.47979707` m versus query radius `0.4798` m. The few micrometres of rounded overlap plus rounded inward travel repeatedly yield time of impact zero.
- All three continuation attempts hit the same normal; subsequent ticks repeat the stopped state. Increasing the retry count would not correct this geometric classification.

### Reproduction and scope

A temporary asset-free diagnostic used `SpatialScene::advance_dynamic_entity_collection`, a grounded character, a flat floor, and the existing finite polygon-wall fixture. It rotated the wall, starting placement, and requested drive together, preserving the same relative approach: 2 m/s into the wall and 0.5 m/s along it. Each run lasted 60 ticks of 0.03 seconds; unconstrained lateral travel is 0.9 m. Wall rotation below is orientation in the coordinate frame, **not** a change in the relative approach angle.

| Wall rotation | Accepted lateral travel |
| --- | --- |
| 0 degrees | 0.86367 m |
| 15 degrees | 0.89996 m |
| 30 degrees | 0.02822 m |
| 45 degrees | 0.07498 m |
| 60 degrees | 0.90017 m |
| 75 degrees | 0.01500 m |
| 90 degrees | 0.86367 m |
| 135 degrees | 0.89985 m |

This is a general numerical weakness in polygon contact admission, not a special dungeon configuration or a missing wall-slide feature. Orientation and position affect representable endpoint rounding, explaining why equivalent approaches can behave differently. The evidence does not establish that every obstacle class has this defect. The same narrow-phase module already handles a related projected-tangent rounding case for convex volume contacts using a bounded whole-chord penetration check; polygon triangles do not have that treatment. Existing axis-aligned wall and cylinder sliding tests therefore do not cover this failure.

Scope clarification: the reproduction wall was explicitly placed as `StaticColliderPlacement::OutdoorExplicit`, not an EnvCell structure. Building shells, outdoor static objects, and cell structures selected by `CollisionScene` share `MovingSphereCast::update_collider_hit`; BSP polygon shapes then share `sweep_polygon` and `update_triangle_hit`. Thus buildings and other static polygon geometry are within the affected implementation scope. Hard entity BSP shapes also call this same collider narrow phase, and terrain calls the triangle routine directly. Shared code establishes exposure, not a reproduced failure for every content category; balls and cylinders take different shape-specific paths. Validation must include outdoor buildings and static objects as well as indoor walls.

### Final fix and live confirmation

Preserve the requested displacement through the hard-sphere sweep instead of converting it to an endpoint and reconstructing it by subtraction. `StaticSphereSweepRequest` now owns `start` plus `displacement`; `end()` is derived for spatial selection and placement. `sweep_motion_sphere` passes the actual requested movement. Narrow-phase collision, accepted-prefix construction, terrain candidate midpoint, and water-entry restriction checks consume that displacement directly. Camera clearance also passes its existing ray directly. Accepted-path report queries derive displacement from their actual path endpoints at their own boundary.

The user tested the worktree change and reported “seems good now,” then authorized closing the issue. This supports resolving the reported symptom with the narrower fix. No new tolerance, contact-boundary solver, persistent manifold, or body-placement refactor is part of this change. The worksheet remains open for subsequent issues.

Retail retains a horizontal sliding normal (`acclient.c:300478-300493`) and projects movement along its intersection with the supporting plane (`acclient.c:300623-300668`). Preserving the already-computed slide removes a lossy internal conversion; it does not introduce a new retail response policy.

### Review and verification

The final quality review covers the movement producer, public sweep contract and constructors, static/entity narrow phase, accepted-prefix and topology boundary, terrain selection, water restriction entry, camera-clearance caller, endpoint-based report queries, and migrated tests. Existing contact bands, collision response, impact timing, coverage policy, and crate ownership remain intact. The retained change avoids parallel endpoint/displacement state and adds no new subsystem.

Final validation: **378 core and 725 world tests passed (1,103 total)**, plus doctests; core/world/3D-host all-target clippy passed with warnings denied; formatting and diff checks passed. The focused collision regression admits a tangent whose rounded endpoint would imply inward movement and still blocks genuine inward travel. Review removed the remaining camera-clearance endpoint round trip; no blocking design findings remain in the reviewed scope. Logs: `/tmp/wall-closeout-tests.txt` and `/tmp/wall-closeout-clippy.txt`. User verification covers the reported live behavior, not every geometry or character configuration.

### Separate finding and superseded exploration

The earlier investigation explored bounded contact allowances, conservative stopping distance, and a richer contact-boundary solver. The first two failed sustained-motion or existing physics checks and were removed. An isolated 2-D structural prototype passed 768 synthetic cases but did not establish a need for that machinery in the reported live case. The broader solver proposal is **superseded for this issue**, not pending implementation work.

A synthetic offset-body counterexample also showed that independently translating cached sphere centers and body roots can rebuild a sphere 7.62939453125 micrometres beyond its previously accepted center on the next tick. This is a confirmed arithmetic discrepancy, but its connection to the user's character or an observable remaining defect is **unproven**. Calling pose-owned placement a prerequisite for this fix was stronger than the evidence justified. Do not expand this resolved issue into a movement/stairs/rotation refactor without a separate behavioral reproduction.

The possible follow-up direction, if such a reproduction is found, is to validate the exact root/orientation and derived sphere geometry that will be published. It is a separate concern, not a blocker to closing this issue.

Session-local diagnostic artifacts remain available:

- Original wall captures: `/tmp/holtburger-wall-angle-results.txt`, `/tmp/holtburger-wall-contact-trace.txt`, `/tmp/holtburger-wall-cast-trace.txt`.
- Rejected experiments: `/tmp/wall-prototype-bound.txt`, `/tmp/wall-prototype-matrix.txt`, `/tmp/wall-prototype-world-tests.txt`.
- Isolated structural prototype: `/tmp/wall-structural-prototype.py`, `/tmp/wall-structural-results-final.json`.
- Offset-body arithmetic reproduction: `/tmp/wall-root-publication-repro.py`, `/tmp/wall-root-publication-repro.json`.

## Issue queue

Awaiting subsequent user reports. Worksheet remains open after individual issues are resolved.
