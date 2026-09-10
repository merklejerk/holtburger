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
- Status: **Reported hallway freeze resolved — live-verified and accepted by the user.** The supported floor/wall response and query corrections are implemented and included in the issue 3 follow-up commit. The separate slow-angle accumulated-rounding failure remains open as follow-up 3a below; acceptance of this fix does not establish that every wall-slide case is resolved.
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


### Reopened — real dungeon wall at `0x00a9013d`

The user reports catches against the uneven walls of dungeon `00A9`. An offline reproduction now uses the actual `0x00a9ffff` collision asset, `SpatialScene::advance_dynamic_entity_collection`, and the recorded character's humanoid setup `0x02001a9c` (lower/upper sphere radii 0.48 m). No server connection, player relocation, other entities, or production correction was needed.

Cell `0x00a9013d` uses environment `0x0d000128`, structure 0, placed at `(20, -40, 0)` with the authored -90-degree Z rotation. Its lower wall faces lean outward approximately 7 degrees from vertical. The cell is a diagonal corridor segment; it has no static-object placements. The freeze reproduced inside the cell rather than at a portal seam.

The diagnostic starts near a wall and drives 3 m/s along the hallway plus 2 m/s into that wall, at `MOBILE_CONTACT_TICK_SECONDS` (1/30 s). After initial motion it freezes at root `(23.068447, -36.365875, 0.005)` in `0x00a9013d`. In the 100-tick matrix run this pose remains unchanged through tick 99. Reversing hallway travel against the same wall continues moving. Parallel controls also traverse the cell normally. This is an actual-content production-solver reproduction, not a live replay of the user's exact inputs.

The focused contact trace establishes a remaining numerical mismatch:

| Fact | Captured value |
| --- | --- |
| Repeated wall normal | `(-0.70185983, -0.7018589, 0.12160195)` |
| Initial requested displacement | `(0.1178512, -0.02357032, ~0)` m |
| Requested displacement after slide response | `(0.07140775, -0.07001371, 0.008046641)` m |
| Slide velocity dot wall normal | `+4.284083843231e-8` m/s (non-inward) |
| Scaled displacement dot same normal | `-1.280568540096e-9` m (inward by rounding) |
| Repeated impact time | Zero, against the same normal on all three passes |

`HardMovement::requested` scales the accepted slide velocity by tick duration and remaining time. That multiplication alone can reverse the sign of the near-zero normal component. `MovingSphereCast::update_triangle_hit` admits any negative normal approach, and at this contact its narrow phase returns another zero-time hit. The response checks the velocity, which is already non-inward, so it makes no correction. The identical requested displacement hits again until `MOBILE_CONTACT_HARD_SLIDE_PASSES` is exhausted. The next tick repeats the cycle.

The earlier displacement-contract fix remains useful: the sweep still receives the intended displacement directly. It was insufficient as a complete solution to tangent-contact robustness. This reproduction does not depend on reconstructing an endpoint, alternating between several bumps, or the separate cached-sphere/root publication discrepancy. The angled wall normal exposes the remaining failure, but the trace does not establish that only slanted walls can do so.

Retail reference rechecked: `COLLISIONINFO::set_sliding_normal` stores a horizontal normal (`acclient.c:300478-300493`); the supported transition projects along the intersection of that sliding plane and the contact plane (`:300623-300668`). Our generic 3-D wall projection also produces a small upward component here, and the matrix includes brief grounded/airborne transitions. That is a separate response-policy observation, not yet proven to cause this freeze. Do not silently broaden the numerical fix into slope, stair, or moving-platform behavior changes.

Correction direction to scope next: make slide response and subsequent sweep admission agree on an already established contact constraint, so a computed tangent cannot become a fresh blocking impact solely through representational rounding. Repeating the projection or increasing the pass limit does not resolve the demonstrated unchanged-velocity loop. Evaluate a contact-aware continuation contract against real inward travel, distinct adjacent faces/corners, both body spheres, and supported movement before selecting an implementation. This investigation does not yet establish the final API or justify globally ignoring small inward moves.

Artifacts: `/tmp/wall-00a9-geometry.txt`, `/tmp/wall-00a9-runs.txt`, `/tmp/wall-00a9-focused.txt`, `/tmp/wall-00a9-trace.txt`; reproducible temporary sources `/tmp/wall-00a9-probe-matrix.rs`, `/tmp/wall-00a9-probe-focused.rs`, and `/tmp/wall-00a9-step-instrumented.rs`. Temporary instrumentation and the asset-dependent harness were removed. Only the worksheet remains changed; issue 3 remains open for correction design and validation.


### Structural correction scope — problem-solving pass

**Required contracts.** A slide accepted by response must survive positive time scaling without becoming a new blocking impact from rounding. Genuine inward motion still blocks, including very slow motion over many ticks. Both authored body spheres participate; a lower-sphere wall contact must not hide an upper-sphere obstruction. Finite edges, a second face, corners, thin geometry, and topology coverage remain authoritative. Collision must continue to select the earliest actual obstruction. Existing support, stairs, launches, airborne response, projectiles, and accepted-path reporting retain their meanings. Numerical allowances must be measured against a fixed geometric boundary, never replenished relative to the previous tick's position.

**Observed data.** The current reproduction involves one repeated face normal, not a multi-contact corner. The wall normal has a vertical component about 0.122; the trace's false inward displacement is about 1.28 nanometres. Other tested directions move, and the earlier flat-wall matrix was orientation-sensitive. These observations justify testing face orientation, travel direction, tick scaling, and coordinate magnitude; they do not establish a full dungeon/content census. Installed collision geometry includes finite polygon faces, warped polygon fan triangles, and separate sphere/cylinder targets. A plane-only result cannot automatically be generalized to every feature.

**Concessions.** Collision already operates at finite precision and has an established contact band; exact real-number tangency is not a viable public invariant for arbitrary stored float vectors. It is acceptable to classify motion inside a justified numerical uncertainty interval, provided the fixed collision boundary prevents cumulative penetration and meaningful inward movement remains blocked. A real closed corner may stop movement. Moving-platform behavior, a new animation system, and a global body-placement rewrite are outside this correction unless new evidence requires them. The separate root/sphere discrepancy remains a test consideration, not a proven prerequisite.

**Ownership map.** Movement produces drive/continuation velocity. `advance_hard_candidate` owns response and remaining physical time; `HardMovement::requested` creates displacement. `sweep_body_motion` queries both spheres and chooses the shared stopping fraction. `MovingSphereCast` owns actual shape geometry, feature classification, and impact admission. Accepted paths then own topology and publication. The failed seam is between response's non-inward velocity and the sweep's strict negative-displacement predicate. A bare hit normal and time do not carry a geometric contact witness or distinguish a retained contact from a fresh encounter.

**Alternatives, in increasing architectural cost:**

1. Reproject after scaling, increase precision, or increase retries. These can alter the failing numbers but do not establish the required invariant across further transforms, normalization, and published positions. Precision may be useful inside the final algorithm; it is not by itself the ownership solution.
2. Make the existing sphere/face query explicitly classify initial contact and geometric clearance before invoking a future-impact cast. The query already has the face, sphere, and complete displacement, so it can own a fixed-boundary clearance decision without adding persistent state to callers. This is the first candidate to prototype. It must cover finite features and the actual stored endpoints; merely copying the existing convex-volume roundoff allowance is insufficient. An earlier polygon allowance prototype eventually stalled, so its acceptance is not presumed.
3. Carry a solve-local geometric contact witness from the query into continuation. A witness would need enough information to validate the contacted boundary and distinguish it from adjacent geometry, and would expire when that geometric condition no longer holds. This can preserve the meaning of an already accepted contact but changes the sweep hit contract and its body-sphere aggregation consumers. Prefer it only if candidate 2 cannot enforce the invariant locally. Do not introduce cross-tick persistence or a general manifold framework without demonstrated need.
4. Adopt retail's horizontal wall-slide/support-plane intersection policy. This addresses the observed upward deflection against flared walls, but is a movement-policy change and does not alone prove numerical robustness. Evaluate separately rather than use it to obscure the nanometre-scale admission failure.

**Recommended next experiment.** Prototype candidate 2 at the shared sphere/face admission boundary, with no permanent implementation commitment. Require a geometric explanation for both admission and rejection, and keep the ordinary future-impact query for features not covered by that proof. If that requires broad exceptions or cannot prevent long-run drift, reject it and scope the solve-local witness explicitly. The old 2-D structural prototype is useful investigation history, not validation of a 3-D production design.

**Acceptance evidence before selecting the fix.** Replay the real `00A9` matrix in both directions with both body spheres; measure lateral progress, fixed-boundary clearance, and repeated zero-time hits. Add sustained pressed-wall runs, inward/outward and head-on controls, several speeds/durations and coordinate offsets, a second wall/corner, finite ends, and a distinct upper-sphere obstacle. Repeat the prior oblique-wall fixture and focused stairs, ramp-seam, hard-entity, projectile, and support regressions. A fix that frees the hallway by weakening those contracts is rejected. Where a result depends on retail policy, verify the corresponding source path separately. Final implementation shape and cost remain unproven until these experiments pass.

This pass changes the worksheet only. It scopes investigation toward the narrowest owner that has the required geometry; it does not green-light a general contact solver rewrite.


### Prototype results — local clearance and supported-slide candidates rejected

The user authorized prototyping. Two isolated experiments used the same 12-run real-asset matrix (two walls, two hallway directions, inward speed 0/0.5/2 m/s, hallway speed 3 m/s, 100 ticks including five initial settling ticks) and the 728-test world library suite. Each experiment was run separately; neither remains in production code.

**A — fixed-boundary triangle clearance.** The prototype compared the complete start/stored-end chord with the maximum projection of the triangle's vertices, using double-precision dot products and a coordinate-scaled float uncertainty allowance. This tested a local geometric classification without adding contact state. It improved some matrix paths, but the original `side=-1, forward=+1, inward=2` path still froze at `(23.068447, -36.365875, 0.005)`. Two existing tests failed: `repeated_inward_casts_cannot_replenish_the_contact_band` and `driven_corner_crowd_respects_hard_walls_and_releases_the_player`; 726 passed. The allowance weakened the established collision boundary and did not cure the reported case. Rejected; no larger allowance was attempted.

The focused clearance trace adds a material constraint to the diagnosis. At the frozen lower sphere, distance from the enclosing face boundary is approximately `0.47968857` m, while the hard-query radius is `0.4798` m. That is about 0.111 mm of overlap beyond the existing reduced-radius boundary, versus the candidate's approximately 0.020 mm uncertainty allowance. Thus the nanometre-scale inward tangent is the repeated-stop trigger, but not a complete account of how the body arrived there. The earlier baseline trace includes an upward wall response, an airborne tick, and subsequent return to ground. The exact producer of this additional overlap has **not** been isolated; do not attribute it to floor settling, GJK, or root publication without tracing the accepted movement/adjustment path. A query that faithfully enforces fixed-boundary clearance cannot simply declare this starting state separated.

**B — supported floor/wall intersection.** With A fully removed, a second prototype constrained supported stable-body response along the intersection of the retained support plane and the wall's horizontal sliding plane, following the retail direction identified above. The experiment applied that direction to physical and kinematic velocity after ordinary impact response. All 728 world tests passed, but the real hallway still froze. The original failing route moved farther before stopping near `(24.553465, -37.850685, 0.005)`; several other pressed-wall routes also stopped. Keeping support and eliminating the upward component alone is insufficient. This was a bounded policy experiment, not a claim of complete retail transition equivalence. Rejected as a fix for issue 3.

**Result and next scope.** Neither candidate meets the real-content acceptance criterion. The local clearance prototype also violates existing regression constraints, so it cannot be salvaged by increasing a tolerance. Before choosing the next implementation, trace the accepted paths that first exceed the fixed wall boundary, then scope an explicit solve-local contact/continuation contract that can distinguish an existing contact (including legitimate escape from overlap) from new inward penetration. Do not suppress all hits with a matching normal: that would erase distinct parallel faces and upper-sphere obstacles. The need for richer contact information is supported by these failures; its exact representation and whether it alone is sufficient remain open. Full sustained-motion and extended geometry matrices were not run for candidates that already failed the reported hallway.

Artifacts: `/tmp/wall-00a9-prototype-a.txt`, `/tmp/wall-00a9-prototype-a-tests.txt`, `/tmp/wall-00a9-prototype-a-clearance.txt`, `/tmp/wall-00a9-prototype-a-sweep.rs`; `/tmp/wall-00a9-prototype-b.txt`, `/tmp/wall-00a9-prototype-b-tests.txt`, `/tmp/wall-00a9-prototype-b-step.rs`. The common matrix source remains `/tmp/wall-00a9-probe-matrix.rs`. Temporary asset-backed harness and source instrumentation were removed, and both production files were restored to their exact pre-prototype contents. Only worksheet changes remain. No candidate is ready for user testing or commit; issue 3 remains open.


### Deeper trace — initial face contact falls through to a future cast

The user authorized continued investigation. Instrumentation followed accepted ordinary segments and the final support adjustment rather than inferring the source from the published pose.

At tick 10, ordinary movement ends at lower-sphere center `(23.068447, -36.365875, 0.4808845)`. The following downward support probe requests `(0, 0, -0.04)`. Its wall-plane distance is `0.47979912` m against hard-query radius `0.4798` m: already overlapping by approximately 0.88 micrometres in the query's own arithmetic. The exact face-hit time is negative (`-0.00017768372`), so the existing `0..=1` face branch does not handle it and delegates to the generic triangle cast. One fan triangle reports no hit; the other reports a converged future hit at fraction `0.05089691` (about 2.036 mm down). The floor needs only about 0.8845 mm of descent, so the settle accepts it. The wall's vertical normal component turns that accepted descent into approximately 0.108 mm of additional wall penetration. Subsequent pose publication preserves that result; it is not the source of this overlap.

This proves an initial-contact classification gap in `MovingSphereCast::update_triangle_hit`: an already-contacting sphere approaching a finite face must not rely on a future-impact iterative cast to recover time zero. The generic cast's result is observed directly; the investigation does not infer a particular internal Parry convergence defect. Existing face containment and one-sided policy must still distinguish actual face contact from edges or vertices.

**C — explicit initial face contact.** A prototype detects an already-overlapping, front-side sphere whose projected contact lies on the finite triangle, and returns time zero before the generic future cast. All 728 world tests pass. It prevents the specific tick-10 settle described above, but by itself the original hallway route later stops at `(23.244867, -36.54245, 0.005)`. The independent near-tangent sign ambiguity therefore remains.

**D — initial contact plus bounded near-tangent classification.** Combined C with a local classification that requires both (1) normal approach within a displacement/dot-product roundoff estimate and (2) start and stored endpoint within a fixed geometric clearance bound enclosing the triangle. Unlike rejected A, meaningful inward displacement cannot use the geometric allowance. All 728 world tests pass, including the two that rejected A. The original 100-tick route now traverses into `0x00a90142`; no persistent freeze remains in that matrix's final reported samples. This prototype introduces no movement-policy change or contact lifetime outside the query.

A longer experiment reverses hallway direction at offsets ±1 m while continuously pressing into a wall, remaining in the source corridor region. It runs 2,000 ticks per combination: both wall sides, dt `0.01/0.02/1/30` seconds, and along-wall speed `3/9` m/s, inward speed 2 m/s (12 runs, 24,000 ticks per build). It measures accumulated absolute along-wall travel, maximum consecutive ticks below 0.1 mm along-wall movement, and minimum lower-sphere clearance to the two actual lower wall planes. Clearances are relative to the nominal 0.48 m radius; existing hard admission already permits a 0.2 mm contact band.

| Candidate D workload | Travel, wall side -1 / +1 | Longest near-zero streak, -1 / +1 |
| --- | --- | --- |
| dt .01, speed 3 | 59.846 / 59.846 m | 0 / 0 ticks |
| dt .01, speed 9 | 177.534 / 179.538 m | 3 / 0 ticks |
| dt .02, speed 3 | 111.235 / 110.960 m | 0 / 0 ticks |
| dt .02, speed 9 | 334.423 / 333.119 m | 0 / 0 ticks |
| dt 1/30, speed 3 | 178.170 / 177.943 m | 0 / 0 ticks |
| dt 1/30, speed 9 | 536.150 / 533.665 m | 0 / 0 ticks |

Candidate minimum plane clearance ranges from approximately -0.204 to -0.220 mm across these runs (at most approximately 0.020 mm beyond the existing contact band under this diagnostic). This is measured bounded depth for these runs, not a proof of the allowance for all coordinates/content. The baseline comparison exhibits persistent stalls, including 1,979 near-zero ticks and only 0.456 m travel for side -1/dt .01/speed 3, and 1,989 near-zero ticks and 0.600 m travel for side -1/dt 1/30/speed 3. Baseline also shows larger plane penetration in some other runs. Complete rows are preserved in the logs.

**Updated direction.** These results support a local, explicit initial-contact/near-tangent classification before future-impact casting. The earlier conclusion that a richer contact contract must be the next design was premature: a local query candidate now has direct positive evidence. D remains a prototype, not a finished numerical contract. Its coefficients (4×coordinate epsilon and 8×dot-product epsilon) require derivation or replacement by a defensible existing numerical primitive; they must not become empirically tuned magic constants. Additional verification should isolate exact initial overlap and inward descent, near tangents, finite face/edge boundaries, genuine slow inward motion, both sphere roles, coordinate ranges, and repeated stored-pose behavior. The residual three-tick catch and remaining supported/airborne oscillation are recorded rather than claimed fixed.

Artifacts: `/tmp/wall-00a9-deep-poses.txt`, `/tmp/wall-00a9-deep-trace.txt`, `/tmp/wall-00a9-deep-step-instrumented.rs`, `/tmp/wall-00a9-deep-stairs-instrumented.rs`, `/tmp/wall-00a9-deep-sweep-instrumented.rs`; `/tmp/wall-00a9-prototype-c-sweep.rs`, `/tmp/wall-00a9-prototype-c.txt`, `/tmp/wall-00a9-prototype-c-tests.txt`; `/tmp/wall-00a9-prototype-d-sweep.rs`, `/tmp/wall-00a9-prototype-d.txt`, `/tmp/wall-00a9-prototype-d-tests.txt`, `/tmp/wall-00a9-prototype-d-long.txt`, `/tmp/wall-00a9-baseline-long.txt`, `/tmp/wall-00a9-long-probe.rs`. All instrumentation, temporary asset-dependent harnesses, and prototype production edits were removed after comparison. Only the worksheet remains changed. The issue stays open; no final fix or commit is claimed.


### Authorized implementation scope

The user authorized the gated query correction and explicitly waived performance benchmarking. Implement initial front-side face contact in the existing analytic face branch; gate near-tangent clearance work with arithmetic approach uncertainty and face proximity. Keep the fixed geometric boundary (including all triangle vertices and the stored endpoint), finite-feature fallback, both-sphere aggregation, existing response policy, and topology contracts. No persistent contact state or movement-policy change. Express uncertainty using the standard bounded-operation floating-point error factor rather than unexplained empirical multipliers. Validate focused initial-overlap/tangent/inward/finite-face cases, the world regression suite, and the real hallway sustained runs. Performance benchmarking is out of scope by user instruction. Do not commit until requested.


### Implementation and verification — gated face contact

Implemented in `crates/holtburger-world/src/spatial/collision/static_sphere_sweep.rs`. The existing analytic face-hit branch now handles initial front-side overlap at time zero and checks projected finite-face containment. Ordinary edge/vertex fallback remains in place. The near-tangent helper first checks the sign against the five-operation dot-product error factor, then face proximity; only eligible contacts receive the higher-precision fixed-boundary clearance check. It encloses all triangle vertices and evaluates both start and stored endpoint. Clear separation and ordinary inward approaches retain the existing query path.

The prototype's sixteen-operation direction estimate was narrowed to the actual three-product/two-addition admission dot (`gamma(5)`); this classifies uncertainty in that evaluation rather than claiming to bound arbitrary upstream cancellation. Coordinate clearance uses `gamma(8)` for the storage/endpoint/plane evaluation envelope. Neither is a configurable angular tolerance. The geometric depth check prevents the allowance from being replenished from each preceding position. As with the prototype, measured representation-scale penetration can exceed the nominal contact band by a few micrometres; it is bounded against the fixed plane, not treated as fresh clearance on each tick.

Added three asset-free regressions from the captured numeric wall geometry: initial contact must block downward settling at time zero; rounded tangency admits travel while genuine small inward motion, deeper overlap, and combined inward/tangential motion block; and finite face contact must not extend the triangle indefinitely. Existing repeated-inward, crossed-wall, edge, two-sphere, staircase, ramp, support, and hard-entity tests remain in the verified suite.

Validation: 731 world + 378 core + 283 host library tests pass (1,392 total). The final gated implementation also completed the same 24,000-tick real-asset correctness matrix, matching the recorded prototype travel/clearance values. It has no persistent stall in those runs; the one three-tick near-zero streak at dt .01/speed 9 remains a stated limitation, as does the pre-existing supported/airborne oscillation. This does not claim every short interruption or every geometry configuration is solved. The user explicitly waived performance benchmarking; no performance result is inferred from these correctness runs.

Logs: `/tmp/wall-00a9-focused-tests.txt`, `/tmp/wall-00a9-final-tests.txt`, `/tmp/wall-00a9-final-long.txt`, and `/tmp/wall-00a9-final-clippy.txt`. The temporary asset-dependent harness is removed. The correction is present in production code for user testing; no commit was requested. Historical prototype removals above describe those earlier experiments, not the current implementation status.


### Live verification correction — omitted ledge-protection policy in offline fixtures

The user reported the same hallway still sticks and supplied `0x00a90139`, then authorized live-client investigation using the worktree credentials. The credentials were read from `apps/holtburger-3d/.dev.env` without printing their values. A fresh debug build of the actual client host connected to local ACE through the noninteractive sidecar protocol; no TUI was run. After an initial passive snapshot, short forward-drive probes acquired run movement for two seconds, stopped, and disconnected. The parked character stayed at `(8.10335922241211, -66.59151458740234, 0.005000002682209015)` in `0x00a90139`, quaternion `(w=.94929683,x=0,y=0,z=.3143835)`. Forty samples showed running playback and identical position. This is a live reproduction of the user's stall, not merely an offline analogue.

The offline replay initially moved from the same position. The missing producer fact was then identified: earlier body fixtures prepared with only `PhysicsState::GRAVITY`. The actual character mask is `0x00404410`, including `EDGE_SLIDE` (`0x00400000`). Physical preparation maps that flag to `EdgeProtection::Creature`; its absence selected `EdgeProtection::None`. **The previous 24,000-tick runs therefore did not exercise the character's ledge-protection policy.** They remain evidence for numerical contact behavior under their stated fixture, but were insufficient evidence for the live player fix. Replaying the actual position, orientation, and mask reproduces the exact stationary result offline.

Live solver tracing shows wall response accepting a slide with an upward component (one captured continuation is approximately `(-.00437254, .19859241, .02504054)` m, with no additional hard hit). `advance_hard_motion` then receives unsupported footing: the candidate cannot settle back onto standing support. Because the character has ledge protection, the edge-slide fallback restores the previous protected pose and ultimately rejects the move. Every tick repeats the same lift/rejection. This explains why the gravity-only fixture could advance while the real character remained stationary. It is not a networking failure or evidence that the user ran stale code.

A separate expanded offline matrix also exposed a finite-edge stall in `0x00a9013d` at higher inward/along-wall speeds. Its actual closest-feature normal is `(-.70191455,-.701636,.12256797)`, whereas the contacted triangle's authored face normal is `(-.98509413,0,.17201616)`. The existing near-tangent gate uses the face normal and does not handle that edge tangent; initial edge overlap was about .312 mm beyond the reduced query radius. This remains a separate incomplete contact case, not the proven cause of the live `0139` stall. Do not globally ignore matching normals or increase the face allowance to cover it.

**Counterfactual check.** Reapplied the earlier supported floor/wall-intersection prototype on top of the current numerical query correction, now using the actual character mask and parked pose. The corrected-facts replay advances through `0x00a90139` into `0x00a90136` while remaining grounded; its last tested root is approximately `(8.100892,-63.578682,.005)`. Without that prototype, the same replay remains at the initial root. Thus supported movement policy is now directly implicated, rather than a speculative retail alternative. This is not yet a live test of the supported-slide prototype or full validation of its effects on stairs, slopes, corners, and airborne bodies.

**Scope correction.** The previous no-movement-policy-change constraint must be revisited. A numerical face-query fix alone cannot resolve a move that is accepted by collision but rejected by ledge protection. Scope supported stable-body wall response around both the floor and blocking wall constraints, preserving actual ledge protection, deliberate launches, and existing stair decisions. Retail's horizontal sliding normal plus support-plane intersection is a grounded reference for that correction (`acclient.c:300478-300493,300623-300668`). Keep the edge-contact numerical case explicit and validate with the actual producer-owned physics flags going forward. A new general persistent-contact framework is still not established as necessary by these results.

Artifacts: `/tmp/wall-feedback-live.jsonl` (passive snapshot), `/tmp/wall-feedback-live-drive.jsonl`, `/tmp/wall-feedback-live-traced.jsonl`, `/tmp/wall-feedback-live-traced.stderr`; `/tmp/wall-feedback-live-drive.mjs` (forward-only script, no jumps/teleports); `/tmp/wall-feedback-matrix.rs`, `/tmp/wall-feedback-0139.txt`, `/tmp/wall-feedback-013d.txt`, `/tmp/wall-feedback-edge-trace.txt`; `/tmp/wall-feedback-live-facts-probe.rs`, `/tmp/wall-feedback-live-facts-replay.txt`, `/tmp/wall-feedback-live-facts-trace.txt`, `/tmp/wall-feedback-supported-prototype.txt`. Instrumentation and the new supported-slide prototype were removed after verification. Only the previously implemented query correction and worksheet remain changed; no new production fix or commit is claimed.


### Revised problem-solving scope — supported response owns simultaneous constraints

**Constraints first.** Supported stable-body movement must preserve standing support when a valid along-wall path exists. Ledge protection must still prevent unintended departures; disabling `EDGE_SLIDE` is not a fix. A successful stair maneuver still owns a deliberate change in height. Launches, airborne impacts, free bodies, and elastic/sliding surface policies retain their distinct responses. The accepted path must satisfy both body spheres and real collision geometry, including corners and finite features. A real blocked corner may stop movement. Physics flags must come from the actual prepared entity facts in integration fixtures.

**Data and limits.** The live `0139` character has `EDGE_SLIDE` and contacts a wall that flares with height over a flat floor. The existing generic wall projection introduces upward travel; reacquisition of floor support fails and ledge protection rejects the whole route. A corrected-facts replay and a supported-intersection counterfactual establish this failure chain. The separate `013d` edge-contact counterexample remains relevant to numerical admission but must not be substituted for this live policy failure. No full content census or universal slope/corner success claim follows from these two cases. Performance benchmarking remains waived by the user.

**Ownership neighborhood.** `advance_hard_candidate` already owns the hit, remaining movement, support state, and response policy; it tries stairs before ordinary wall continuation. `HardMovement` distinguishes timed travel and positional correction. `WorkingBody` retains separate physical and kinematic velocities. `stairs::settle_after_movement` validates support after the candidate, while `ProtectedFooting` owns rollback. The correct insertion point is ordinary supported hit response, before another sweep or support settle. Content, network state, renderer, and ledge-protection policy do not need new responsibilities.

**Recommended structural shape.** For an already supported stable body, compute continuation under the current support plane and the blocking surface together. Preserve the incoming supported component when it is non-inward; when the wall constraint is active, choose the along-surface direction that also preserves support. On a flat floor this is the horizontal wall tangent, matching the live counterfactual. Replace the existing supported wall response calculation with this decision; do not first compute an upward wall slide and then append a cleanup projection as the diagnostic prototype did. Keep ordinary future sweeps and support validation authoritative.

Use one response calculation for the relevant physical, authored/kinematic, and positional-correction consumers, with their existing semantic distinctions preserved. Compute the geometric constraint once at its owning response boundary rather than let each channel independently rediscover it. The final helper/type shape should follow those real callers; no general contact-manifold framework or persistent cross-tick state is justified yet. A second obstacle remains a collision to solve, not an excluded matching normal.

**Slope decision to resolve explicitly.** Retail retains a horizontal sliding normal and intersects it with the contact plane. On the live flat floor that agrees with intersecting actual floor/wall planes. On a sloped floor those constructions need not agree: flattening a tilted wall normal can produce a direction entering the actual wall. Prototype the actual two-plane geometric constraint and compare with the relevant retail behavior before claiming general equivalence. Do not blindly extend the flat-floor counterfactual to every slope, or impose horizontal-only movement that breaks uphill travel. A degenerate intersection must produce an explicit stationary/ordinary outcome appropriate to the response mode, not an arbitrary direction.

**Concessions and subtraction.** Reject routes that genuinely cannot satisfy support and obstacle clearance; do not bypass support checks to guarantee motion. Preserve successful stair decisions and legitimate airborne departures. Keep the initial-contact query correction as independently supported behavior, but reassess its near-tangent portion and finite-edge limitation against the final response rather than treating the accumulated diff as mandatory. Remove any experiment-only projection or duplicate response path during cutover.

**Acceptance before closing.** Add an asset-free integrated fixture with the actual `EDGE_SLIDE` policy, flared wall, floor, and two-sphere body; prove sustained grounded lateral progress and perpendicular blocking. Include controls for ledges, deliberate launch, stair ascent, supported slope travel, corners, a distinct upper-body obstruction, and positional correction under support. Replay the captured live pose/flags and both reported cells, then repeat the forward-only live-client check. Tests of the generic no-ledge-protection body are additional coverage, not a substitute. Track the `013d` finite-edge failure separately and do not claim the complete wall-sliding issue resolved while a required reproducer still fails.

This pass scopes the response correction from verified live facts. It adds no production edits and does not claim the diagnostic prototype is ready for cutover.

### Supported-response correction — live success and user acceptance

Implemented the scoped correction in `advance_hard_candidate`: for an already supported stable body hitting a non-walkable obstacle, one `SupportedWallResponse` computes the actual support/wall intersection. Physical velocity, kinematic travel, and positional correction consume that constraint. Successful stairs still return first; ordinary sweeps and ledge-protection validation remain authoritative. Airborne and other response policies keep their existing branch. This replaces the supported wall-only projection rather than appending another projection after it.

Two asset-free regressions cover sustained two-sphere wall sliding with `EdgeProtection::Creature` (including rotated placement) and simultaneous slope/wall constraints. The slope fixture proves a specific limitation of retail's flattened sliding normal: against an overhanging wall, the flattened-wall intersection points into the actual wall during uphill travel. The actual-plane result preserves both constraints. This deliberate difference is documented beside `SupportedWallResponse` with retail citations and the evidence scope. The synthetic counterexample proves the geometric distinction, not universal retail equivalence; no authored-slope census was completed.

**Live verification now succeeds.** Rebuilt the actual host and repeated the authorized forward-only drive against local ACE. Forty samples start at the unchanged parked point in `0139` and finish near `(-1.886707, -45.979794, .005)` in `0122`, passing through cells `0136`, `0135`, `0132`, `0131`, `012f`, `012d`, and `0124`. Every sample reports grounded contact. The probe stops movement and disconnects successfully. This directly verifies the supported-response correction against the original live freeze; the character is now farther along the corridor, not at the original parking position. Log: `/tmp/wall-supported-live.jsonl`.

**User acceptance.** After the live-check handoff, the user replied “lgtm.” The reported hallway freeze is accepted as resolved; no more specific user test procedure is inferred. Quality review traced the supported response, timed/correction consumers, launch support release, stair priority, and protected-footing rollback. No broader refactor was identified. This cleanup changes comments and worksheet status only.

### Follow-up 3a — Slow-angle accumulated contact rounding

Status: **Open — independently reproduced; not resolved by the accepted supported-response correction.**

The corrected-physics-mask matrix in `013d` ran 24 combinations of two wall sides, along-wall speeds .5/3/9, and inward speeds .25/1/3/9 m/s, 600 ticks each at the production contact interval. Seven .5 m/s cases eventually stick. The old 9/9 finite-edge case no longer stalls with this response, but that does not establish universal finite-edge robustness. No performance benchmark was run.

The first remaining failure is now isolated to a repeated zero-time face hit, not ledge rollback. At root `(23.634102,-36.93159,.005)`, the supported continuation is approximately `(-.011785112,.011785128,0)`. The wall normal is `(-.70185983,-.7018589,.12160195)`. The lower sphere's measured plane distance is `.47973382` against reduced query radius `.4798`; the enclosing triangle boundary adds another approximately `.00000295`. Earlier accepted positions were much closer to the intended boundary. The final continuation has essentially zero approach (the tiny vertical residual gives roughly `-2.2e-20`), but the accumulated depth exceeds the current geometric admission bound. Every slide pass then repeats the same zero-time hit.

The query's existing non-inward fast path and the bounded near-tangent path do not enforce the same stored-position invariant: exactly non-inward requested motion can bypass the latter even though rounding its endpoint can change clearance. Repeated rounded coordinate updates therefore need investigation at the accepted-placement boundary. Enlarging the allowance only postpones this failure and is not the proposed correction. Next isolate a contact-safe placement rule that prevents accumulated inward rounding while preserving real inward blocking, both body spheres, and finite features. Do not silently turn the numerical admission rule into general overlap forgiveness.

Validation: 733 world, 378 core, and 283 host library tests pass (1,394 total); Clippy passes with warnings denied. The integrated flared-wall regression fails with the original response (`travel=0`) and passes with the prototype, so it specifically detects the repaired support-policy failure. Logs: `/tmp/wall-supported-all-tests.txt`, `/tmp/wall-supported-clippy.txt`, `/tmp/wall-supported-regression-control.txt`. The temporary asset-dependent harness has been archived under `/tmp` and removed from the worktree.

Artifacts: `/tmp/wall-supported-live-facts.txt`, `/tmp/wall-supported-matrix-013d.txt`, `/tmp/wall-supported-slow-trace.txt`, `/tmp/wall-supported-slow-gate.txt`, `/tmp/wall-supported-matrix.rs`. Temporary production tracing is removed. The supported response is included in the issue 3 follow-up commit as an accepted correction. Follow-up 3a retains the separate unresolved reproducer and its evidence; the worksheet remains open for further issues.

## Issue 4 — Excessive overlap with closed doors

Status: **Resolved — implemented and accepted by the user.** Final quality review completed; included in the issue 4 commit.

### Report and consequence

The user reports that entities, including the player, enter visibly closed doors too deeply. Movement eventually stops, but the player's position can reach the opposite side as understood by ACE, allowing a locked door to open.

ACE `Door.ActOnUse` admits use when `!IsLocked || behind` (`ACE/Source/ACE.Server/WorldObjects/Door.cs:91`). `WorldObject.GetRelativeDir` compares the player's horizontal root position with the door's origin and facing (`WorldObject.cs:990`). A negative facing dot product means behind. This opens the door through its permitted back-side interaction; it does not itself clear the lock property.

### Proven collision-pose mismatch

A passive local-ACE probe observed +Holtmage in cell `0x001e0224` at approximately `(61.0114, -279.9394, -8.9950)`, and a closed Door `0x7001e018` (WCID 278), setup `0x0200024f`, at `(120, -295.245, -12)`. Its presentation holds animation `0x03000559`, frame 0. This is an observed door from the same dungeon, not yet confirmed by the user as the exact reported instance. The probe did not drive the player or use the door.

Dynamic target preparation (`crates/holtburger-core/src/dynamic_entity.rs::prepare_target_geometry`, `stable_part_frames`) captures the setup default animation's first frame, otherwise its Resting/Default placement. `placed_target_shapes` in `crates/holtburger-world/src/spatial/dynamic_index.rs` continues placing those captured part transforms. The current motion cursor does not update them.

This door has no setup default animation. Its Default placement has the two blocking panels about 30 degrees inward from closed, with centers at local Y `-0.441256` and `-0.444426`. Its actual closed animation frame has nearly straight panels, at Y `-0.00865101` and `-0.00450118`. The visible closed door and its collision geometry therefore disagree substantially. Both panels use physics BSP `0x0100097c`; the third part has no physics BSP. The player's authored movement spheres have radius 0.48 m.

A temporary asset-backed probe placed these exact BSPs and each set of part transforms into the production `CollisionScene::sweep_hard_sphere` query. The scene contained only the target door, with resident empty static coverage. It tested a radius-0.48 sphere at upper-body height across seven lateral positions from both sides (28 queries total). At the doorway center, approaching from the front:

| Collision part pose | Player center Y at first hit, relative to door origin |
| --- | --- |
| Current setup Default placement | -0.228175 m: already behind ACE's side boundary |
| Actual closed animation frame 0 | +0.620705 m: remains in front |

Changing only the part poses moves first contact forward by approximately 0.849 m. Both variants block travel; the setup pose creates an inward pocket near the middle. This reproduces the consequential geometric error with the production sweep, without changing collision radius, tolerances, or response. It is not a complete live movement/interaction replay or a full content census.

### Retail evidence and correction direction

Retail `CPartArray::UpdateParts` combines the object's frame with **current animation part frames** and scale (`acclient-eor-source/acclient.c:314107-314132`). `CPartArray::FindObjCollisions` visits those parts (`:313270-313287`), and `CPhysicsPart::find_obj_collisions` transforms the moving spheres using the part's current pose before testing its physics BSP (`:303185-303200`). The useful clue is pose ownership, not a special door penetration allowance.

The correction should make dynamic physics-BSP part placement follow the host-owned authored motion pose. The existing motion cursor should remain the single timing owner; collision needs the part transforms sampled from it, including initial settled poses and animation transitions. The renderer must not become the source of physical transforms. Keep shared BSP meshes immutable and update their placement, including affected collision bounds/shadow membership. Resolve ordering with ethereal hooks and pending solidification so each collision query sees coherent geometry and participation.

This is a broader missing connection between authored motion and dynamic collision, demonstrated by a common door asset. It does not justify rewriting the movement solver or adding door-specific radius/padding. Detailed implementation scope and a content census remain to be worked out. A closed-pose-only patch would fix this sample while leaving collision wrong during other solid animation states; evaluate that limitation explicitly before choosing a narrower scope.

Verification for implementation should include this exact front/back reproduction, initial login to a closed door, open/close transitions and obstructed solidification, and a live user check at the reported door. Tests retained in the repository should use asset-free representative geometry rather than depend on locally installed archives.

Diagnostics: `/tmp/holtburger-door-passive.jsonl`, `/tmp/door-asset-results.txt`, `/tmp/door-sweep-probe.rs`, `/tmp/door-sweep-results.txt`. Temporary Rust harness source was removed after the experiment. No production code changed.

### Follow-up investigation — scope and cost (2026-09-10)

Progress: completed an archive/catalog census and traced the runtime integration boundaries. No production implementation or performance claim yet.

#### Census method and corrections

The existing `physics_bsp_part_animation` diagnostic is insufficient for this issue: it excludes single-part setups, follows only setup-default motion tables, and classifies animation of any part rather than the actual physics-BSP part indices. Its claim that a single part is necessarily root-equivalent is incorrect: retail composes the object root with the animation's part transform even for one part. Do not use that diagnostic's old population estimate to scope this fix.

A temporary replacement scanned unique EOR-namespace setup/GfxObj resources and joined `dats/weenies.hwc` setup IDs with template motion-table IDs. For each BSP-carrying setup, it examined its default animation and the union of setup-default and template motion-table animations. It compared only BSP-carrying part tracks with the pose currently chosen by `stable_part_frames`, and separately checked whether those tracks change within an animation. Frames and quaternion components were compared exactly, so tiny authored differences remain counted.

| Measurement | Result |
| --- | ---: |
| Setups carrying at least one physics-BSP part | 530 |
| Those with a discovered animation source | 128 |
| Setups with a differing collision-part pose in that source envelope | 92 |
| Those with collision-part tracks varying within an animation | 87 |
| Differing-pose setups with only one model part | 45 |
| Setups with 1 / 2 / 9 / 11 differing collision parts | 54 / 36 / 1 / 1 |
| Unique differing `(animation ID, part index)` tracks | 121 |
| Frame samples in those tracks | 5,677 |
| Raw 7-float transform payload for those samples | 158,956 bytes (about 155 KiB) |

These are **potential asset combinations**, not active solid objects or live concurrency. The union deliberately includes entire referenced animations rather than only selected clip windows and gameplay-reachable command sequences. Templates sharing a setup need not share behavior. Live appearance substitutions and runtime motion-table overrides are not enumerated. The payload estimate excludes containers, indexing, unchanged tracks, and any additional pose storage; it is not a runtime memory measurement or a complete upper bound.

The scan reported two unavailable GfxObj references (`0x00000000`, `0x01004e29`) and 50 animation/part combinations without a corresponding frame track, concentrated in setups `0x020003b5` and `0x02001bf2`. These were reported, not silently treated as stationary. Retail `UpdateParts` limits updates to the smaller of setup and animation part counts (`acclient.c:314119-314129`); handling shorter animations is therefore a real pose-retention question, not automatically corrupt content. This census does not simulate transitions through those combinations.

Representative authored candidates (template names identify content, not guaranteed active solid-state behavior):

| Setup | Example template | Differing collision parts |
| --- | --- | ---: |
| `0x0200024f` | Door, WCID 278; reported reproduction asset | 2 |
| `0x02000310` | Sliding Door, WCID 720 | 1 |
| `0x02000c56` | Bookcase, WCID 15301 | 2 |
| `0x02000bde` | Fireplace / Portcullis, WCIDs 14467 / 22615 | 1 |
| `0x0200025a` | Pressure Plate, WCID 298 | 1, no within-animation variation found |
| `0x020018c4` | Walkway, WCID 72919 | 1, no within-animation variation found |
| `0x02000fda` | Sealed Door, WCID 25565 | 11; nine vary within animation |
| `0x02001bf2` | Rynthid Assessment Crystal / Sparking Crystal | 9; includes shorter-animation caveat above |

#### Runtime and retail findings

- Retail `CSequence::get_curr_animframe` selects `floor(frame_number)` and uses the placement frame only when no animation is current (`acclient.c:326259-326270`). Its collision parts do not require interpolating a complete skeleton every physics tick. Retain the host cursor as timing owner and detect actual collision-pose changes; a changed clip/frame identity alone does not prove the transforms changed.
- The host already owns clip identity and whole frame through `MotionSequenceRuntime`. However, `MotionAnimation::project` in `crates/holtburger-content/src/motion_sequence.rs` currently discards part transforms while extracting their hooks. This requires a deliberate extension of simulation content, not merely connecting two existing complete contracts. Preserve only justified collision-pose data rather than retaining every character limb track by default.
- `PreparedEntityBspPart` currently stores local transforms inside shared prepared target geometry. Keep immutable meshes/preparation shareable; give changing instance poses an explicit runtime owner. Avoid rebuilding or reloading BSP meshes for frame changes.
- Client simulation advances authored motion, applies authored physics hooks, and then runs physical movement (`crates/holtburger-core/src/client/simulation.rs:153`). `apply_authored_motion_physics` retries pending solidification and runs ethereal hooks (`crates/holtburger-world/src/state/motion_resolution.rs:741`). The exact pose visible to each solidification check must be designed and verified, including ticks crossing multiple hook frames; merely installing the final tick pose before all hooks may not preserve event-time behavior.
- `placed_target_shapes` feeds movement, peer overlap, snapshots and spatial indexing. Update this common source rather than add a door-only query. Indoor BSP-body membership derives from transformed part boxes, so a stationary root does not imply unchanged membership.
- `EntityCollisionProof` retains root pose, target geometry, branch and membership. Once instance part poses can change independently, retained surface proofs must include the owner-produced pose identity or equivalent geometry fact, so a precise-jump target cannot remain valid after its surface moves.
- Existing dynamic snapshots/index preparation already places target shapes. Attribute new cost separately from existing work; a transform microbenchmark alone would not measure membership traversal, snapshots, contact queries or support invalidation.

#### Performance evaluation shape

No user-provided crowded scene is required. The archive supplies representative assets. Start with a production-path controlled workload at 1, 16, 64 and 256 copies, using the common two-panel door and the 11-part sealed door as separate workloads. Label high counts as synthetic stress, not observed live density. Include settled, repeatedly changing solid poses, and normal ethereal open/close behavior as distinct cases; forcing solid poses is a diagnostic stress condition, not a claim about authored gameplay.

Measure an unchanged baseline and a candidate through pose selection/publication, membership refresh, and ordinary collision queries. Use both open-space placement and portal-straddling indoor placement because the latter exercises cell traversal. Include a player approaching the objects, and report how many part transforms actually changed. Report median and spread across at least five runs, with build profile, tick cadence, object count and geometry configuration. A settled workload should demonstrate absence of repeated pose updates. The user-suggested dungeon 6146 remains an optional overall live regression workload; a mob crowd alone cannot isolate this cost.

The census supports a small-data, selective-update approach: 90 of 92 candidate setups have only one or two differing collision parts. It does **not** yet prove the complete update is cheap. Remaining work before final implementation scope: settle pose/hook ordering and shorter-animation semantics, account for initial settled-body installation and appearance replacement, and prototype the common collision-pose update boundary before timing it. Moving surfaces pushing or carrying actors is a separate response question; updating geometry alone must not be described as complete moving-platform physics.

Artifacts: `/tmp/collision-pose-census.txt` (complete rows and exceptions), `/tmp/collision-pose-census-build.txt`, `/tmp/collision_pose_census.rs` (reproducible temporary source). The temporary binary source was removed from the repository after the run. The older census was inspected but not rewritten as part of this investigation.

### Proposed solution — shared authored collision poses

Status: **Implemented and accepted.** The user authorized implementation and accepted the candidate after the requested live-check handoff. This section supersedes the earlier suggestion that part transforms necessarily belong in the global `MotionAnimation` projection.

#### Constraints and scope

Goal: every dynamic physics-BSP target uses the host-selected authored part pose, including its initial settled state, while retaining shared immutable collision meshes.

The required contract is the collision pose of the model's BSP parts, not a new skeleton simulation. Scope includes single- and multi-part targets, setup placement fallback, settled and changing animations, effective motion-table changes, appearance/setup replacement, state reconciliation, cell membership, and retained surface-reference validity. Root motion and sphere/cylinder movement bodies keep their existing meanings. Static landblock placement is not converted into animated entities.

The existing motion owner selects and advances playback. The content layer supplies decoded tracks. The scene owns mutable instance collision placement. No renderer-to-host pose messages, archive reads during a physics tick, independent collision clock, per-frame BSP rebuilding, or door-specific collision padding.

Concessions: use retail's whole-frame part sampling. This does not implement swept moving-obstacle collision, actor pushing, or platform carrying. Pose replacement must still invalidate stale support/target facts and preserve existing collision/solidification behavior. If verification demonstrates that the reported door requires additional response behavior, stop and scope that evidence rather than silently growing a moving-platform solver.

#### Alternatives considered

| Approach | Assessment |
| --- | --- |
| Force doors to a known closed frame | Too narrow: bypasses current motion selection and leaves other poses/objects wrong. |
| Retain every animation part in the global motion catalog | Simple access, but expands the shared simulation payload to all character limbs. Current bootstrap deliberately seeks past approximately 52 MB of transforms; the sparse collision population does not justify undoing that globally. |
| Rebuild prepared geometry whenever a frame changes | Reuses an existing path but confuses immutable content preparation with instance movement, introducing allocation and asynchronous readiness into animation. |
| Prepare sparse collision tracks with the body, then publish instance poses | **Recommended.** Extends existing preparation and scene boundaries, preserves one clock, and limits data to a proven consumer. |

#### Ownership and data flow

1. **Content preparation:** for the effective setup/appearance, identify actual BSP part indices. Resolve the entity's effective motion table using the existing entity-over-setup selection rule, plus any setup default animation used by the runtime. Prepare immutable tracks for those indices across the reachable animations. Preserve constant tracks as constants and varying tracks as frame arrays. Preserve the distinction between an authored missing part track and missing/unavailable content. Share prepared content using the existing content-service/cache conventions; do not introduce a global cache framework for this feature.
2. **Body definition:** retain meshes, part indices/scales, initial placement poses and prepared track references as immutable facts. Initial transforms are explicitly initial values, not simultaneously the live collision pose. Use `RigidTransform` for related origin/orientation values where compatible with existing math types. A private validated aggregate ties instance pose slots to ordered BSP parts; consumers must not zip unrelated public vectors or synthesize missing transforms.
3. **Motion selection:** expose one reusable owner-produced sample identifying the selected authored animation and whole frame, or explicit placement-pose state. Derive it at the motion owner using its existing action/command precedence. Do not ask collision to interpret `MotionPresentation::Playing`, infer a cursor from elapsed time, or select a presentation-only locomotion channel independently. Resolve any necessary common selection helper once and reuse it without making renderer policy own physics.
4. **World instance:** retain the current local collision-part poses with the body's dynamic runtime state. Apply the selected sample to those slots, compare the resulting transforms, and publish only actual changes. The scene owns a collision-pose identity/revision if needed by retained surface proofs; it changes with geometry, not merely a new animation ID or frame. No revision or pose traffic is added to the frontend just for implementation bookkeeping.
5. **Scene publication:** one scene operation updates part poses and their geometry-dependent membership together. Root position is unchanged by a local part-pose update. Route movement sweeps, peer overlap, snapshots/indexing, support queries, and target proofs through the existing common placed-target-shape path. Snapshots retain a coherent pose rather than referencing mutable live transforms. Refresh affected support/reference facts when a stationary-root object's surface moves.

Preparation captures effective motion-table identity in addition to setup and appearance; it participates in async completion currentness. A frame change does **not** cause a preparation job. On setup/appearance/table replacement, prepare the successor content through the existing coordinator, reject stale completions, and initialize from the **current** motion sample when installing. Reuse geometry for motion-only preparation where practical; do not invoke full-body replacement on ordinary pose updates.

Initially installed bodies receive their selected settled collision pose. The original plan also required topology-resolved membership before any query; the later real-door verification withdrew that broader installation rewrite as a blocker. Existing installation seeds membership from the root cell, and normal collection refresh resolves coverage before movement snapshots. For an already moving body whose new animation omits trailing parts, retain those current part poses: retail updates only `min(setup parts, animation parts)` (`acclient.c:314119-314129`). An initial body seeds all slots from the established setup/default preparation policy, then applies authored entries. Missing resource data is an explicit preparation failure/readiness condition, never equivalent to an authored omitted track. Table switches and shorter clips therefore require stateful instance poses even though the tracks remain immutable.

#### Tick ordering and retail evidence

Retail queues hooks while traversing frames: `CSequence::execute_hooks` calls `add_anim_hook` (`acclient.c:326199-326215`). It does not execute collision queries at each departed frame. In the dynamic-object path, `UpdatePositionInternal` advances the sequence and processes queued hooks (`:308262-308298`); `UpdateObjectInternal` subsequently calls `set_frame`, including for objects without movement spheres (`:310860-310950`). `set_frame` refreshes parts (`:309528-309546`). Pending ethereal restoration is checked before this advance (`:310850-310855`).

For the client dynamic-body path, preserve that relationship:

1. Advance the existing motion owner once and retain its ordered hooks/final pose sample.
2. Run pending solidification and authored hooks against the previously published collision pose, preserving the current hook order.
3. Publish the sampled new part poses and refresh membership for changed bodies.
4. Run the ordinary movement/contact queries against that coherent successor geometry.

This is a deliberate simplification supported by the dynamic retail path, not a per-hook replay engine. Retail's separate static-object animation path updates parts before processing hooks (`:309397-309409`); do not present the dynamic order as universal. During implementation, verify the reported door's dynamic classification and closing-hook boundary against these references and a focused test. If that classification contradicts the intended client path, resolve it before wiring the order.

Ethereal objects still need a coherent current pose for later solidification and re-entry. Do not freeze animation poses merely because collision participation is currently disabled. Snapshot/state replacement and initial installation must not wait for a nonzero motion tick to synchronize a settled pose.

#### Implementation phases and acceptance

**Phase 1 — Content and sample contract.** Extend content-owned collision preparation and `ClientEntityBodyFacts`/preparation identity, using `dynamic_entity.rs` and the existing content service. Add the owner-produced pose sample in the world motion registry. Keep global root/hook bootstrap sparse. Cover a single moving part, a constant non-default pose, sparse BSP indices among visual parts, a shorter animation, and an explicit missing-resource failure. Acceptance: the observed door's frame-0 sample resolves its correct two panel transforms through prepared content without any tick-time I/O or second cursor.

**Phase 2 — Runtime ownership and common placement.** Cut over `PreparedEntityBspPart`'s live-placement use to scene-owned instance poses; retain only honest initial/prepared facts in the definition. Update `placed_target_shapes`, dynamic snapshots, `EntityCollisionProof`, and membership publication together. Acceptance: changing only a part pose moves the common collision surface and invalidates its old retained proof; snapshots remain unchanged after later live updates; a repeated identical pose performs no membership refresh. Sphere/cylinder target branches do not require animation tracks.

**Phase 3 — Lifecycle and tick integration.** Wire initial installation, current-pose sampling after hooks, motion-table/appearance replacement, and authoritative state reconciliation through the same publication boundary. Exercise closed-door login, opening/closing, obstructed solidification/retry, a multi-frame hook tick, and an ethereal object's later return to solid. Acceptance: no queryable setup-pose interval on closed-door installation; no stale async completion resets a newer pose; ordinary frame changes never reprepare geometry. Reassess scope here if moving-surface response, default-animation timing, or hook classification exposes a demonstrated gap.

**Phase 4 — Correctness and cost.** Re-run the real door's front/back sweep comparison and verify live with the user. Retain asset-free regressions for the behavioral invariants; keep installed-archive probes in diagnostics. Run the controlled baseline/candidate workload described above, including settled and portal-straddling cases. Acceptance: front approach stops before ACE's side boundary, expected open passage remains available, back-side interaction remains possible, and measured costs are reported with workload and repeated-run spread. An unexplained cost that scales with all character limb tracks or requires settled geometry refresh every tick requires redesign before closeout.

**Phase 5 — Quality and cleanup.** Remove the obsolete `AnimatedPhysicsBsp` refusal for newly supported cases and tests preserving frozen collision placement. Sweep comments claiming all part transforms are presentation-only or single parts are necessarily root-equivalent; replace or retire the misleading old census. Keep root/hook-only decoder comments accurate about their consumer rather than pretending pruned frames prove authored absence. Run affected content/world/core/host checks and tests, clippy with warnings denied, formatting and diff checks. No frontend contract change is expected; if implementation crosses that boundary, add the corresponding browser verification. No commit until requested.

#### Definition of done and remaining decisions

Done means the common collision path follows the host pose across initial state and transitions, geometry-dependent references remain coherent, settled objects avoid repeated pose work, the live door report is resolved, and validation/performance evidence is recorded. The existing mesh and motion timing owners remain singular. This should add a small content projection plus one instance-pose publication path; if implementation starts resembling a second animation system or requires a general scene invalidation framework, revisit the boundary before adding it.

No user preference is needed to choose the recommended architecture. Implementation must still settle exact cache reuse with existing content service APIs, verify dynamic door hook classification, and trace default-animation/no-table ownership before extending that branch. These are bounded engineering checks, not permission gates or justification for a new clock.

### Implementation progress

- Added `holtburger-content::collision_pose`: sparse collision-part animation projection, constant-track compaction, explicit whole-frame bounds, authored trailing-part omission, and preparation of a motion-table/default-animation closure using `ContentDecodeCache`. This remains off the tick path. Three focused asset-free tests pass.
- Added an authored collision-pose sample on the existing world motion runtime, using its command/action sequence rather than the presentation-only locomotion sequence. No new cursor or clock.
- Began the scene cutover: dynamic bodies retain immutable instance pose arrays independently of prepared meshes. Common target placement reads these poses; retained collision proofs include them, so snapshots preserve a coherent pose value. Current initialization still uses the previous prepared pose; animated publication and initial settled synchronization are not wired yet.
- `cargo check -p holtburger-world` and content/world all-target clippy with warnings denied pass for this intermediate state. This is not end-to-end validation and the door behavior is not fixed yet.
- Additional census: one of the 92 differing-pose setups has a setup default animation (`0x02001bf2`, the crystal family); its catalog templates also specify motion tables. Bulk client playback requires network motion/table input. The no-table default-animation path still needs an explicit lifecycle decision if reached; no demonstrated blocker to the door path was established by this scan. Evidence: `/tmp/collision-pose-default-sources.txt`.
- Next: connect prepared tracks and effective table identity to body preparation/currentness, publish sampled poses with scene membership, then wire installation and tick ordering. No production runtime integration claim, no performance claim, no commit.

### Implementation progress — preparation and client publication

- Wired collision-track preparation into the shared dynamic definition builder, using the content decode cache from the client content service (and a retained decode cache in Explorer preparation). Effective motion-table identity now participates in client async preparation/currentness. Removed the obsolete moving-default-BSP refusal and its Explorer fixture/test that enshrined rejection.
- Replaced parallel runtime pose fields with `CollisionPartPoses`, a validated ordered pose aggregate plus its last applied owner sample. Shared meshes remain immutable. Repeated identical samples do not allocate/recompute poses; an animation/frame change whose transforms are equal does not refresh membership. Missing trailing tracks retain their prior poses.
- Initial client configurations apply the selected authored sample before installation. A zero-time existing motion reconciliation establishes the cursor if necessary; no separate clock is used. Frame publication follows existing hook processing and precedes movement queries. Pose and membership publication uses a private body candidate and commits only after successful resolution.
- Body state/demand reconfiguration preserves instance poses when prepared target geometry is unchanged. Collision snapshots/proofs retain the pose value. Existing entity-support queries recheck the target each collection (`mobile_contact/step.rs:758` onward), so no separate support invalidation system was added.
- Added a scene-level regression for pose change, repeated-frame no-op, immutable snapshot behavior, surface-proof invalidation, and pose retention across reconfiguration.
- Current validation: 78 content + 726 world + 378 core + 283 host library tests pass (1,465 total). Content/world/core/host all-target clippy passes with warnings denied. Logs: `/tmp/collision-pose-integration-tests.txt`, `/tmp/collision-pose-integration-clippy.txt`.
- Still incomplete: real-asset candidate verification and live door test, performance matrix, deeper lifecycle tests (shorter clips/solidification/initial async replacement), Explorer playback publication integration or explicit scope resolution, stale diagnostic vocabulary cleanup, and final quality review. The client code path is wired, but end-to-end correctness and completion are not yet claimed.

### Implementation progress — real-asset component measurements

The real WCID 278 two-panel door and WCID 25565 sealed door both prepare successfully through the new `prepare_dynamic_entity_physical_definition` path, including sparse tracks from their motion tables. The diagnostic installs configurations sampled at frame 0 and calls production `SpatialScene::publish_collision_pose`, snapshot compilation, and one production surface ray per iteration.

Workload: release build, 120 iterations per run, five runs per combination, 1/16/64/256 copies, either fixed frame 0 or cycling frames 0–31 once per iteration. It measures component time per iteration; it does not advance motion clocks or claim a particular animation framerate. All targets are forced solid for this diagnostic. Outdoor copies are spread on an 8 m grid in one empty resident landblock. Indoor copies deliberately coincide at the actual dungeon door position `(120, -295.245, -12)`, cell `0x001e016f`, with real dungeon topology. The indoor case stresses coincident targets/cell traversal and is not claimed representative gameplay density. The ray starts in front of the first target. These are comparisons of settled/changing workloads on the candidate, **not a complete old-build/new-build client benchmark**.

| Domain | Setup | Copies | Pose | Median µs/iteration | Five-run range µs |
| --- | --- | ---: | --- | ---: | --- |
| Outdoor | `0200024f` | 1 | Settled | 2.84 | 2.83–2.95 |
| Outdoor | `0200024f` | 1 | Changing | 3.40 | 3.39–3.46 |
| Outdoor | `0200024f` | 16 | Settled | 12.30 | 12.16–12.41 |
| Outdoor | `0200024f` | 16 | Changing | 20.62 | 20.59–21.20 |
| Outdoor | `0200024f` | 64 | Settled | 43.97 | 43.71–45.24 |
| Outdoor | `0200024f` | 64 | Changing | 77.60 | 77.09–78.10 |
| Outdoor | `0200024f` | 256 | Settled | 166.38 | 162.96–211.94 |
| Outdoor | `0200024f` | 256 | Changing | 298.52 | 295.90–301.31 |
| Outdoor | `02000fda` | 1 | Settled | 12.32 | 12.31–12.43 |
| Outdoor | `02000fda` | 1 | Changing | 14.05 | 13.97–14.11 |
| Outdoor | `02000fda` | 16 | Settled | 55.37 | 55.06–55.39 |
| Outdoor | `02000fda` | 16 | Changing | 81.32 | 81.05–82.36 |
| Outdoor | `02000fda` | 64 | Settled | 189.08 | 188.39–192.08 |
| Outdoor | `02000fda` | 64 | Changing | 294.70 | 292.51–297.24 |
| Outdoor | `02000fda` | 256 | Settled | 519.59 | 514.20–519.97 |
| Outdoor | `02000fda` | 256 | Changing | 940.73 | 938.26–947.49 |
| Dungeon doorway | `0200024f` | 1 | Settled | 16.31 | 16.29–16.53 |
| Dungeon doorway | `0200024f` | 1 | Changing | 18.30 | 18.26–18.48 |
| Dungeon doorway | `0200024f` | 16 | Settled | 38.31 | 38.19–38.59 |
| Dungeon doorway | `0200024f` | 16 | Changing | 68.69 | 68.31–69.16 |
| Dungeon doorway | `0200024f` | 64 | Settled | 113.10 | 112.01–113.84 |
| Dungeon doorway | `0200024f` | 64 | Changing | 235.97 | 234.86–237.05 |
| Dungeon doorway | `0200024f` | 256 | Settled | 420.38 | 417.10–421.79 |
| Dungeon doorway | `0200024f` | 256 | Changing | 918.40 | 908.81–930.44 |
| Dungeon doorway | `02000fda` | 1 | Settled | 25.27 | 25.22–26.03 |
| Dungeon doorway | `02000fda` | 1 | Changing | 30.16 | 30.12–30.26 |
| Dungeon doorway | `02000fda` | 16 | Settled | 181.70 | 180.78–182.03 |
| Dungeon doorway | `02000fda` | 16 | Changing | 261.70 | 261.34–263.44 |
| Dungeon doorway | `02000fda` | 64 | Settled | 689.09 | 688.41–706.52 |
| Dungeon doorway | `02000fda` | 64 | Changing | 1011.44 | 1009.59–1013.24 |
| Dungeon doorway | `02000fda` | 256 | Settled | 2788.09 | 2700.79–2791.93 |
| Dungeon doorway | `02000fda` | 256 | Changing | 4004.00 | 3997.99–4033.86 |

The measurements support the expected shape: pose changes add modest per-target work, while actual indoor topology is more expensive than empty outdoor coverage. At 256 overlapping complex doors this remains a synthetic stress load; it must not be quoted as a normal dungeon scene. This does not replace the live player collision/interaction check or prove moving-platform response.

Retail classification was checked explicitly: the observed closed-door mask `0x10018` does not contain `PhysicsState::STATIC` (`0x1`), so the plan's dynamic-object hook/part ordering applies to this door. It is not inferred from the object's stationary root.

Artifacts: `/tmp/collision-pose-probe.txt`, `/tmp/collision-pose-probe-indoor.txt`, `/tmp/collision-pose-probe-outdoor.rs`, `/tmp/collision-pose-probe-indoor.rs`. The temporary harness file was removed from the worktree. A live client test request is pending with the user; independent lifecycle/Explorer integration and quality work remain.

### Implementation progress — Explorer and replacement continuity

- Explorer now publishes ordinary authored collision poses through the shared scene path. Possessed playback attaches its proposed sample to `PhysicalBodyInput`; the scene applies it to the speculative body and publishes it with the accepted movement result. Failed sample preparation leaves the previous collision pose intact.
- Initial Explorer BSP configurations sample the existing motion-table playback before installation. Clean instance replacement initializes its new playback consistently with its new body. Non-BSP entities keep their existing initialization path.
- Contact collection publication now resolves BSP part-box membership at the accepted root and part pose, instead of retaining movement-sphere coverage as the final target membership.
- Client preparation checks the effective motion-table identity before selecting the initial sample. Compatible part slots retain live poses across a prepared-library replacement before applying the new clip, so omitted trailing parts do not reset to setup placement. Ordinary state/demand reconfiguration continues to retain current poses.
- Extended the asset-free scene regression to exercise accepted and rejected pose proposals and omitted-part retention across a library replacement. It passes. All 1,465 content/world/core/host library tests and all-target clippy with warnings denied passed before this final regression extension; the extended regression then passed separately. Logs: `/tmp/collision-pose-lifecycle-tests.txt`, `/tmp/collision-pose-lifecycle-clippy.txt`, `/tmp/collision-pose-replacement-regression.txt`.
- The candidate is available for the requested live door check. Issue remains open and uncommitted. Remaining review includes initial installation/cell-membership visibility (the low-level installation API still takes a seed cell, not collision topology), hook/solidification lifecycle coverage, default-animation scope, stale diagnostic cleanup, and final quality review. Current tests do not establish all of phase 3 or the full definition of done.

### Implementation stop — initial collision publication contract

The user requested a stop for a major blocker/gap. An initial-publication gap is now reproduced, rather than inferred. The existing `physics_bsp_placement_uses_part_boxes_beyond_the_movement_sphere` fixture installs a BSP body just inside an indoor/outdoor portal. Its correctly resolved part-box membership reaches outdoors, but the installed body's published membership does not. A temporary assertion of initial published outdoor reach failed with `initial published membership omits BSP portal reach`; evidence is `/tmp/collision-pose-initial-membership-gap.txt`. The diagnostic assertion was removed after recording the failure; the retained test currently verifies the resolver, not initial publication.

Cause: `PhysicalBodyState::new_dynamic` seeds membership from the root cell, and `SpatialScene::set_dynamic_physical_body` does not receive collision topology. Client completion and Explorer installation can therefore publish an initialized part pose with incomplete cell coverage. A later collection refresh corrects coverage, but that does not satisfy the plan's explicit requirement that the initial body be coherent before it becomes queryable. Identical-sample suppression does not repair this interval. This is a pre-existing installation-contract weakness exposed by the stronger pose-publication requirement; the current candidate does not close it.

Recommended scope adjustment, pending user review:

1. Make the world scene's production installation/reconfiguration path stage a complete candidate body, selected part poses, and topology-resolved membership before publishing it. Preserve the previous body on a genuine preparation failure. Known missing collision residency should produce the existing suspended state, not an indexed target with guessed coverage.
2. Have client completion supply its resident collision scene after async currentness checks. Have Explorer supply its host collision snapshot while holding the existing simulation lock, before publishing body/registry success.
3. Keep readiness and publication in these existing owners. Do not introduce another animation clock or a general invalidation system. Restrict unchecked seed-only construction to paths whose caller explicitly completes placement before exposure.
4. Require regressions for portal-reaching geometry immediately after installation, missing topology at installation, and replacement failure preserving the previous queryable body. Recheck initial hook/solidification queries against the completed target membership.

Independent progress before the stop: animated pose publication now retains the latest pose and suspends its collision target when required collision topology is absent. The ordinary residency refresh restores it when topology returns. The new asset-free `animated_target_retains_pose_while_collision_residency_is_absent` regression passes. This uses existing body suspension and target-index admission; no extra clock or readiness state was added.

Validation at this stop: all 1,466 content/world/core/host library tests pass; all-target clippy with warnings denied, formatting, and diff whitespace checks pass. Logs: `/tmp/collision-pose-prepause-tests.txt`, `/tmp/collision-pose-prepause-clippy.txt`. These passing checks do not prove the unresolved initial-publication requirement.

Implementation remains open and uncommitted. Live door feedback can still inform the geometry correction, but cannot substitute for this initial-publication requirement. Awaiting review of the installation-contract adjustment before implementing it.

### Verification correction — installation gap is not a demonstrated door blocker

The user challenged whether the synthetic installation-membership mismatch can cause a real failure and authorized verification. The earlier classification as a major blocker was too strong. The synthetic assertion proves incomplete initial coverage is representable; it does not prove that a production collision consumer observes a harmful state.

Real-content verification used the recorded door `0x7001e018` (WCID 278, setup `0x0200024f`), its exact recorded root `(120, -295.2449951171875, -12)`, identity rotation, cell `0x001e016f`, animation `0x03000559`, and the installed dungeon collision asset `0x001effff`. For every frame 0–31, the diagnostic installed the production prepared definition at that frame, recorded initial membership, then ran the normal collection residency refresh with movement excluded and recorded resolved membership. Frames 0–2 occupy only `0x001e016f`; frames 3–31 also reach `0x001e016d`. Thus real geometry does cross a cell boundary, but the recorded closed pose does not have the proposed missing-cell problem.

The real animation has forward ethereal-on and backward ethereal-off hooks at frame 1. Its actual motion table `0x09000016` plays opening at +30 fps and closing at -30 fps, with settled closed/open frames 0/31. The production `MotionSequenceRuntime`, using the real projected closing clip at normal speed and the maximum admitted physics interval (`MOBILE_CONTACT_TICK_SECONDS`, 1/30 s), fired ethereal-off on frame 1 → 0. This held for starting phase offsets of 0, 0.1, 0.5, and 0.9 ticks. Both the previously published pose used by the hook and its successor occupy only the original cell. The extra-cell poses occur while normal door playback is ethereal.

Production ordering was checked: client completion installation precedes the simulation call (`client/runtime.rs`); hooks precede pose publication (`client/simulation.rs`); normal movement collection refreshes every participating body's placement before building its query snapshots (`scene/contact_collection.rs`). The proposed pre-refresh solidification query exists, but its actual door frames do not require the missing neighboring cell.

Conclusion: no gameplay failure was reproduced for this door's ordinary closed/open/closing path. This is not a proof for every animated asset, unusual playback speed, or other query consumer. **Withdraw the installation-contract change as a blocker to issue 4 on the current evidence.** Do not broaden the architecture solely to satisfy the synthetic initial-membership assertion. Preserve it as an unproven edge case until a concrete content/consumer/timing combination demonstrates an observable failure. The previous stop section is investigation history, not a current implementation gate.

Artifacts: `/tmp/door-membership-verify.rs`, `/tmp/door-membership-verify.txt`, `/tmp/door-membership-verify-build.txt`, with recorded-instance provenance in `/tmp/holtburger-door-passive.jsonl`. The asset-dependent diagnostic was removed from the worktree after execution. No production code was changed during this verification.

### Quality pass and candidate contact verification

- Applied the code-quality-review skill to the changed content projection, client preparation/currentness, world cursor sample, scene pose/snapshot placement, client hook ordering, and Explorer initialization/proposal consumers. Immutable tracks remain content-owned; current authored frame selection remains motion-owned; collision poses and query coverage remain scene-owned. No additional animation clock or general installation framework was added.
- Consolidated duplicated Explorer spawn/replacement collision-playback initialization into one helper and renamed its missing-table error to `UnprojectedMotionTable`, reflecting its use beyond possession. Moved the collision-pose scene regressions into their own module alongside the existing contact tests.
- Retired `physics_bsp_part_animation.rs` and its derived fixed-list `bsp_setup_solidity.rs` diagnostic. Their single-part/root-equivalence assumption and incomplete table population were disproven by this investigation. Historical mentions above explain the superseded evidence; neither tool remains available to produce a misleading census.
- Added an asset-free world regression for multiple ethereal hooks observing the previously published part pose, subsequent pose publication changing overlap, blocked solidification preserving that pose, and successful retry after the peer clears. A round collision part isolates transform/state ownership from BSP-specific polygon behavior. Added explicit missing-animation rejection alongside invalid-frame rejection in the scene transaction regression.
- All 1,467 content/world/core/host library tests pass after cleanup and the new hook regression. All-target clippy also covers the debug harness with its physics-profiling feature. Logs: `/tmp/collision-pose-final-library-tests.txt`, `/tmp/collision-pose-quality-clippy.txt`; final verification is recorded in `/tmp/collision-pose-final-clippy.txt`.

The real-asset contact probe prepares the observed door and the recorded character's humanoid setup (`0x02001a9c`) through the production definition builder, installs sampled configurations, and calls `SpatialScene::dynamic_body_overlaps_peer`. It compares initial setup placement with closed animation frame 0 at a controlled outdoor root. It samples player-root positions at 5 mm intervals, using the authored lower/upper spheres (radius 0.48, center heights 0.475/1.35). This is a first-overlap measurement through the shared placed-target path, not a full movement-solver or live-client result.

| Pose | Player lateral offset | First overlap approaching from front (+Y) | First overlap approaching from back (-Y) |
| --- | ---: | ---: | ---: |
| Setup placement | -0.8 m | +0.230 m | -1.205 m |
| Setup placement | 0 m | -0.230 m | -1.405 m |
| Setup placement | +0.8 m | +0.230 m | -1.205 m |
| Closed frame 0 | -0.8 m | +0.620 m | -0.625 m |
| Closed frame 0 | 0 m | +0.620 m | -0.635 m |
| Closed frame 0 | +0.8 m | +0.615 m | -0.630 m |

Values are root Y relative to the door origin. At the center, the setup pose admits the player 23 cm behind the door origin before contact; the corrected closed pose contacts 62 cm in front. This independently corroborates the earlier raw-shape sweep through the actual candidate definition/instance-placement path. Back-side contact remains on the back side. The diagnostic initially used an owner ID as an outdoor position cell; that harness error was corrected to a valid outdoor cell before these measurements. Artifacts: `/tmp/door-contact-verify.rs`, `/tmp/door-contact-verify.txt`, `/tmp/door-contact-verify-build.txt`. The asset-dependent diagnostic was removed from the worktree.

Current outcome: the user replied “lgtm” to the requested live-check handoff. Issue 4 is resolved on that acceptance, the automated checks, and the real-content evidence above. No more specific account of the user's test procedure is inferred. The synthetic installation concern remains withdrawn as a blocker; no broader installation rewrite is included.

### Closeout

- Collision BSP parts now follow the existing authored motion cursor, including the settled closed-door pose. Immutable meshes/tracks remain separate from instance poses; hooks retain their existing ordering.
- Quality cleanup and automated verification passed: 1,467 library tests plus all-target clippy with warnings denied, including the debug harness profiling feature. Real-content contact and animation/cell-coverage results are recorded above with their limits.
- User acceptance completes the pending handoff. Historical progress and stop sections above are retained as investigation history, not outstanding gates. The user subsequently requested a final code-quality pass and commit.
- Final commit review covered content projection and its preparation callers, client async currentness and installation, motion sampling and hook ordering, scene publication and snapshot/proof consumers, and Explorer initialization and accepted movement proposals. Corrected two displaced method documentation blocks and documented the retained pose field in surface proofs. No further blocking quality findings. This final pass changed comments and worksheet text only; the 1,467 passing tests remain applicable. Formatting and whitespace checks were repeated.
- This worksheet remains open for subsequent issues.

## 5. Camera-dependent door selection and precise-jump targeting

**Status: implemented, accepted by the user, and closed. Final quality review completed for commit.**

Reports:
- Door in `0x001103b3` cannot be selected while the boom camera is in `0x001103b4`; moving the camera into the lower cell restores selection.
- Player in `0x00a9011e`, camera in `0x00a90159`: precise-jump targeting appears to hit an invisible nearby surface. Moving the camera into the player's cell restores floor targeting.

### Initial evidence

Both consumers use the shared static-surface ray path: entity selection clips browser mesh refinement at the host's static hit; precise jump compares that static hit with entity collision surfaces. The frontend samples both rays from the presented camera, including its cell assignment.

Decoded the four reported cells. Both cell pairs connect vertically: `03b3/03b4` at Z = 21.002; `011e/0159` at Z = 0. Their connecting portal polygons are absent from the physics polygon maps. The initial hypothesis that targeting's all-polygon iteration directly tests a portal polygon is not supported by these assets.

Production static-collision queries against the complete real assets pass through both openings. In `00A9`, six vertical samples (origins above and below the seam) reach the Z = -6 floor, including 192 m ray limits. All 81 oblique samples from a 3×3 upper-cell grid to a 3×3 floor grid also reach the floor at the production precise-jump limit of 120 m. Four rays from the upper `0011` cell toward its lower doorways hit static geometry beyond the intended doorway points. These are offline static-scene probes, not full live selection results.

A passive live login confirms the character is parked in `0x00a9011e`, at `(69.0980148, -67.0580444, -5.9949999)`. No movement or jump was dispatched. Aim-only queries reproduce a discrepancy: downward rays from `(70,-70,3)` and `(69.098,-67.058,3)` hit Z = -0.9000003, normal +Z, and report `unproven`; starting at `(70,-70,-1)` reaches the Z = -6 floor and reports `reachable`. The invisible hit is therefore reproduced in the live host and absent from the offline static scene. Identifying its exact collision owner is the next step; do not infer that it is the portal plane.

Artifacts: `/tmp/portal-ray-probe.txt`, `/tmp/portal-ray-probe-long.txt`, `/tmp/portal-ray-grid.txt`, `/tmp/portal-ray-door.txt`, `/tmp/portal-ray-live.jsonl`, `/tmp/portal-ray-live-aim.jsonl`. Temporary asset probes and owner instrumentation were subsequently removed.

### Root cause and controlled reproductions

The missing offline ingredient was neighboring **outdoor** collision residency. Adding `0x00a8ffff` reproduces the live `00A9` hit exactly, with that neighbor's owner proof. Removing all static colliders and cell volumes from the neighbor leaves the failure intact: its terrain alone supplies Z = -0.9000003. This rules out a dynamic entity and identifies the invisible horizontal surface as outdoor terrain, not a portal.

The traced 120 m downward path starts correctly in `0x00a90159`, crosses the real portal at Z = 0 into `0x00a9011e`, then ends at Z = -117. That un-clipped endpoint lies beyond the floor and cannot be contained by an interior cell. Generic placement recovery returns `Recovered { previous_cell: 0x00a9011e, recovered_cell: None }`, with `reaches_outdoors: true`. `trace_static_surface_ray_with_policy` merges every endpoint's membership before any collision test. The distant endpoint's recovery therefore admits outdoor terrain and entirely-water barriers against the **whole** ray, including its earlier indoor prefix. The floor hit that should have stopped the ray is discovered too late to prevent this domain contamination.

The door cells reproduce the same failure family when `0x0010ffff` is resident. A ray from upper-cell `(40,1,22)` toward the lower doorway point `(40,-4.5,19)` is clipped at `(40,0,21.454546)`, distance 1.1390877 m, normal +Y, with owner `0x0010ffff`. This is the entirely-water landblock entry barrier, while the hit's own placement remains `0x001103b4`. Starting instead at lower-cell `(40,-1,20)` reaches ordinary dungeon geometry beyond the doorway, at `(40,-8,18)`. These are controlled real-content rays; the actual live door instance and user's exact camera ray have not been captured. Do not equate this reproduction with an exact end-to-end door-selection trace.

Why zoom matters: in the jump report, zooming below the erroneous outdoor terrain plane puts it behind the ray; in the door reproduction, starting inside the nominal water landblock avoids its entry barrier. Neither change repairs the query's domain handling. The vertical portal configuration makes the symptoms conspicuous but is not a necessary condition for this broader bug.

Ownership and correction direction: the shared world ray traversal/geometry-selection boundary owns this, not the frontend selection or precise-jump systems. Geometry must be eligible only over the ray intervals that actually inhabit its domain. An unaccepted distant endpoint's placement recovery must not authorize outdoor geometry along an indoor prefix. Preserve real indoor-to-outdoor exits, outdoor starts, and through-wall selection prevention; do not simply disable outdoor hits whenever the camera starts indoors. Inspect whether the sphere-query domain handling can provide a shared rule without importing body-placement recovery into visibility/targeting semantics. Formal implementation scope and tests remain to be agreed.

This is the same failure class as issue 1, in the separate finite-ray implementation. The earlier sphere correction did not cover this consumer. Entity surface rays also merge full-path membership; review that adjacent consumer when scoping the shared ray contract, without claiming an independently reproduced entity-target failure.

Additional artifacts: `/tmp/portal-ray-live-trace.jsonl`, `/tmp/portal-ray-neighbor.txt`, `/tmp/portal-ray-final-probe.txt`, `/tmp/portal-ray-final-paths.txt`, and archived diagnostic source `/tmp/portal-ray-final-probe.rs`. Temporary production instrumentation and asset-dependent executable were removed. Live probes only logged in, registered a diagnostic camera, and sampled aim; they did not move the character or commit jumps. No product behavior was changed.

### Loading-policy evidence and corrected terminology

The renderer and collision runtime do not currently share a resolved scene context. Renderer demand classifies an `env-cell` or `automatic-landblock` target through the existing `LandblockSceneClass` (`scene-target.ts:85–119`); dungeon demand selects the owner's EnvCells layer. In contrast, `ClientCollisionCoordinator::target_from_world` (`client/collision.rs:658–681`) always calls `SimulationSceneInterest::follow_neighborhood` with radius 1 and exit margin 1. `simulation_scene.rs:36–86` expands numeric owner coordinates without considering dungeon classification. This requests up to nine nominal owners (fewer at map edges), and can retain earlier owners within the wider exit radius.

`ContentAssetService::resolve_collision` (`content_assets.rs:236–270`) unconditionally resolves outdoor generated scenery and converts the owner's terrain to `TerrainCollisionSurface`; `LandblockColliderAssembler::assemble` also assembles outdoor explicit/generated/building placements before interior geometry. Thus there are two distinct loading gaps: unnecessary geographic neighbor demand, and creation of outdoor collision products for dungeon-only owners themselves.

Fresh decoded classifications: `0x0010ffff` = DungeonOnly (656 cells), `0x0011ffff` = DungeonOnly (712), `0x00a8ffff` = DungeonOnly (447), `0x00a9ffff` = DungeonOnly (360); all four have zero outdoor explicit objects. **Correction to earlier shorthand:** the reproduced “outdoor geometry” is dummy terrain/water collision synthesized from neighboring dungeon-only owners' terrain records, not evidence that those owners have traversable overworld content. The records exist; promoting them to playable outdoor collision is the mistake.

ACE corroborates both classification and isolation: `ACE/Source/ACE.Server/Physics/Common/Landblock.cs:575–608` defines IsDungeon from zero height indices, EnvCells, no buildings, with the northwest exception. `ACE/Source/ACE.Server/Managers/LandblockManager.cs:577–582` returns no adjacent landblocks for a dungeon. Our content classifier already implements that predicate (`content/landblock.rs:366–386`); do not introduce a competing heuristic based on cell selector, negative coordinates, or the presence of any EnvCells.

Consequences demonstrated: false targeting hits and reproduction sensitivity to resident neighbors. Consequences visible from code: unnecessary content assembly/retention and independent renderer/collision policy decisions. CPU, memory, and latency costs have not been measured. Do not present them as benchmark results or claim other gameplay failures without reproductions.

### Problem-solving constraints, distribution, and concessions

1. Classification is content-owned and computed once in the existing landblock foundation. Renderer and collision consumers use that fact; neither derives a replacement predicate. OutdoorWithEnvCells must remain outdoor-capable, including owners that contain disconnected interiors as well as overworld.
2. Dungeon residency follows the authored owner and all its interior cells/objects, regardless of whether coordinates lie outside its nominal 192 m square. Internal portal targets are owner-local selectors (`interior.rs:271–274`). Numeric proximity is not dungeon connectivity. Teleports switch context; they do not establish geometric adjacency.
3. Blocking content work stays in the existing asynchronous source/coordinator boundary. Missing/failed classification must be explicit and must not default to outdoors. Source-generation, request-generation, player/destination currentness, and existing body-readiness guards must survive.
4. Dungeon-only collision products contain no terrain, water-entry barrier, or outdoor static layers. Preserve EnvCell shells, containment volumes, portal topology, indoor static objects, and dynamic entity preparation. Raw decoded terrain remains available to content inspection; do not erase source data.
5. Retained outdoor owners must not survive a switch into dungeon-only demand through the outdoor hysteresis rule. Conversely, genuine outdoor movement retains existing neighborhood behavior. Residency remains an owner-set mechanism, not a new global scene-mode singleton.
6. Rays must respect actual portal traversal even when unrelated geometry is resident. A long unaccepted endpoint cannot authorize a new domain. Real exterior exits and outdoor starts continue to work. Indoor/outdoor transitions must constrain both geometry and required coverage to their own portions of the ray.
7. A query may report explicit missing coverage or invalid origin; it must not invent an outdoor route to recover a speculative endpoint. Keep bounded traversal/cycle guards. No arbitrary maximum indoor distance, portal-count hack, or camera-zoom workaround.
8. Keep the existing physical motion solver and its accepted-placement recovery intact. Targeting is not body movement. Share proven portal-intersection primitives and owner-selection mechanics where appropriate, without forcing rays through body-placement publication.

### Fresh local-content census

A complete pass over present, non-pruned CellLandblock entries assembled 65,025 owners through the production `LandblockAssetAssembler`: 1,720 DungeonOnly, 61,620 OutdoorOnly, and 1,685 OutdoorWithEnvCells. The 1,720 dungeon-only owners contain 611,764 EnvCells, **zero exterior portals** (authored portal flag `0x04`), and **zero outdoor explicit placements**. This supports owner-local dungeon residency without excluding a shipped exterior exit in this archive. It does not prove the same distribution for future/custom archives, nor count generated scenery outputs. Preserve truthful classification and explicit error handling rather than silently accommodating contradictory content.

Scope: locally discovered archive, all present/non-pruned owners assembled successfully, all dungeon EnvCells decoded. The probe uses the production content classifier and decoded portal records; it does not run a performance benchmark or measure geometric extents. Artifacts: `/tmp/dungeon-scope-census.txt`, `/tmp/dungeon-scope-census.stderr` (empty), and `/tmp/dungeon-scope-probe.rs`. The temporary asset-dependent executable was removed from the worktree.

### Neighborhood and ownership map

`LandblockAssetAssembler` (content classification) → cached `ContentAssetService` foundation → two independent consumers:
- Frontend scene-interest policy selects render layers; retain this app-local ownership.
- `ClientCollisionCoordinator` resolves collision context asynchronously, selects owner demand, then uses the existing `SimulationSceneResidency` request/publication machinery. Collision content assembly consumes the same foundation classification to choose legal layers.

Installed collision products → world portal traversal and interval-scoped ray casts → entity-selection candidates/static distance limit, and precise-jump environment/entity surface evaluation. The frontend continues to supply the presented camera ray and refine rendered entity meshes; neither frontend caller gains a dungeon exception.

### Recommended solution shape

**A. Correct collision content at its producer.** Branch complete collision assembly on the existing scene class. DungeonOnly builds the interior product and an empty non-water terrain surface, skipping outdoor generated/explicit/building work. Reuse the existing `TerrainCollisionSurface::empty` representation and interior assembly loop; do not add an optional terrain field plus a redundant dungeon boolean. Refactor assembly into shared interior work and class-selected outdoor work as needed, rather than assembling everything and filtering afterward. Apply this to the common product so client, Explorer, and diagnostics agree.

**B. Resolve classification before expanding client demand.** Extend the injected content-source contract to return the owner's existing scene classification without constructing full collision. Resolve it on the existing scene-worker/completion channel, keyed by normalized authoritative owner and content-source generation. A typed pending/resolved/failed context stage in the coordinator feeds the current residency machinery: DungeonOnly → exactly its owner; either outdoor-capable class → the existing neighborhood/hysteresis rule. Never run a synchronous content read inside `observe` or optimistically prefetch nine owners before classification. Reuse the cached foundation for subsequent collision assembly. Separate player/body fact capture from scene-interest derivation so body completion checks do not depend on classification I/O. Guard late completions after teleport, disconnect, and source changes; retire prior context demand on the normal publication path. Do not add a second source cache/service or move renderer radii into core.

**C. Make finite-ray traversal describe query intervals, not speculative body placements.** Use an ordered, bounded traversal of the source domain and actual portal crossings. Each interval owns its allowed static/entity geometry and coverage; stop at the nearest admissible hit. No endpoint containment recovery is needed to decide candidates. Preserve the hit point's cell membership and the reached prefix needed by selection. Reuse `next_placement_transition`'s directed portal geometry where its contract fits, separating it from `placement_for_committed_cell` recovery rather than adding an `is_ray` switch to the body solver. Cast within each allowed interval (not a whole-ray first hit subsequently rejected, which can hide a later valid intersection). Bound outdoors to exterior intervals even when a genuine exit occurs farther along the ray. Keep transition-time ties and straddling entity membership deterministic.

Static and entity surface queries should consume one traversal contract. Avoid retaining their duplicate full-path membership-merging algorithms. Selection's existing static-distance clipping remains; precise jump's existing target eligibility remains. Exact internal helper/type shape should follow the implementation's smallest reusable cut; no general collision framework or persistent portal cache is required.

### Alternatives considered

- Loading only the dungeon owner: removes neighbors, but leaves its own dummy terrain and does not fix real mixed/outdoor scenes.
- Removing dummy terrain alone: corrects products, but leaves needless residency and the ray's domain leak against legitimate outdoor geometry.
- Reusing only `sweep_candidate_membership`: removes speculative endpoint recovery, but its merged reach still loses where along a genuine indoor-to-outdoor path outdoor geometry becomes eligible. Useful primitives, insufficient final ray contract.
- Disable outdoor ray tests for all indoor origins: breaks targeting through real exits.
- Shared renderer/collision loading manager or universal scene flag: couples independent lifecycles and expands scope. Shared content facts plus typed local demand are sufficient.

### Verification and implementation boundaries

The implementation followed three phases, beginning with producer and residency corrections, then ray traversal. The original verification scope follows; completed results and acceptance are recorded below.

- Content: synthetic DungeonOnly products contain interior geometry but no terrain/water/outdoor colliders; outdoor and mixed classes retain their legal layers. Verify generated-scenery work is not requested for DungeonOnly. Keep classifier boundary tests tied to ACE's predicate.
- Coordinator: dungeon entry requests exactly its owner and sheds retained outdoor neighbors; mixed owners preserve outdoor demand. Test outdoor↔dungeon and dungeon↔dungeon teleports, late classification completions, source changes, and explicit missing/failed classification. Use injected sources; no runtime-asset-dependent committed tests.
- Ray correctness: indoor floor before an uncontained distant endpoint, indoor prefix before a genuine outdoor exit with overlapping terrain, outdoor→indoor entry, an exterior hit after a real exit, water-entry barriers restricted to outdoor intervals, finite range/no-hit, portal-boundary ties, and legitimate walls occluding entities. Include missing data beyond an earlier blocker versus missing data on the accepted prefix. Exercise entity targets across seams through the same traversal.
- Real content: replay the recorded `00A9` rays both with and without adjacent products, and the `0011` upper/lower doorway rays. Correct results must not depend on irrelevant residency. Repeat the aim-only live capture; capture actual door selection when the character is parked there. Browser-harness verification must cover the presented-ray/selection and marker handoff for the completed change; no claim of exact live door acceptance yet.
- Run relevant content/world/core/host tests, warnings-denied Clippy, formatting, and diff checks after implementation. No benchmark was requested; any performance claim needs separate measurements.


### Implementation progress

- Phase 1 implemented: complete collision assembly skips outdoor scenery/terrain for DungeonOnly, and the collider assembler retains only interior assembly for that class. Existing empty non-water terrain represents the absence; raw content remains intact. A synthetic source test proves absent outdoor tables do not block dungeon assembly and missing promised interior content still fails. Content/core library suites passed (78 + 379 tests) before phase 2 edits. Recorded real-content rays now hit the dungeon floor/beyond-door geometry with neighbors installed; `/tmp/dungeon-phase1-real-content.txt`.
- Phase 2 implemented, further verification pending: classification runs on the existing scene worker channel before owner-set selection. Current owner/context state gates demand; body fact capture is independent. Dungeon demand drops geographic hysteresis, outdoor-capable demand preserves it. Twenty-two coordinator tests pass, including dungeon-to-dungeon and return-to-outdoor residency. The seam test now waits for classification and verifies no collision reload/republication, rather than equating any scene-worker job with collision loading. `/tmp/dungeon-phase2-tests.txt`.
- All three phases and final quality/runtime verification are complete; see the results below. No commit requested or made.

### Implementation verification and quality review

All three production changes are implemented. Static and entity surface rays now share `surface_ray_path.rs` traversal; their previous full-body-path union and the unused point-radius motion-path wrapper were removed. Each iteration finds the current domain's nearest candidate before searching for earlier portals, avoiding missing-target errors beyond a blocker. Coverage is checked only for the accepted domain interval. Directed crossings at the origin use the existing portal tolerance; an explicit portal-origin regression first failed and then passed (`/tmp/dungeon-phase3-boundary-control.txt`, `/tmp/dungeon-phase3-ray-tests.txt`). A surface wins an exact boundary-distance tie in the source domain. Physical motion recovery is unchanged.

The entity seam regression uses a target whose geometry fits its movement/residency bounds, refreshes membership through the production collection, and covers both a farther-cell target and a target straddling the seam. An initial diagnostic fixture used a 1 m target sphere with the helper's smaller character movement bounds, so its membership did not cover the target's full geometry; that inconsistent fixture was corrected, not treated as proof of this ray contract. No generic target-residency rewrite was added.

Current automated results: 78 content + 737 world + 383 core + 283 host library tests = **1,481 passing**. All-target Clippy for those crates passes with warnings denied. Logs: `/tmp/dungeon-final-library-tests.txt`, `/tmp/dungeon-final-clippy.txt`. Coordinator coverage includes classification absence/failure without outdoor fallback, stale completions, owner switching, and retained seam crossings without collision reload. The injected content source is immutable for the coordinator lifetime; source replacement creates a new coordinator, while shared residency's existing source-generation guards remain intact.

Quality review covered content foundation → common collision producer → client source/coordinator → shared residency publication, including interruption/error paths; and presented frontend ray → unchanged host/core adapters → static/entity world traversal → selection distance limit / precise-jump target proof. Renderer scene-class policy remains independent but consumes the same existing content fact. No new global scene-mode service, persistent ray cache, or movement solver was introduced. Additional state is confined to the coordinator's asynchronous classification stage; body preparation remains independent. New regression tests account for much of the diff.

The rebuilt debug host passed the same aim-only live probe on the parked `00A9` character: starts `(70,-70,3)`, `(69.098,-67.058,3)`, and `(70,-70,-1)` all target `(x,y,-6)` in `0x00a9011e` and report `reachable`. Previously the upper two hit Z = -0.9 and reported `unproven`. No movement or jump was committed. Artifacts: `/tmp/dungeon-final-live-aim.jsonl`, `/tmp/dungeon-final-live-aim.stderr`, `/tmp/dungeon-final-host-build.txt`. Browser/UI verification and the exact live door-click handoff remain pending at this point.

### Acceptance and closeout

The user reported “lgtm” after the manual-test handoff for door selection from `0x001103b4` and precise-jump targeting from `0x00a90159`. This closes issue 5. The acceptance is user-reported; the automated live probe independently verified the recorded jump rays, while exact live door selection was not captured by automation.

The browser probe reached the rendered world but dispatched the precise-jump shortcut while lifecycle was still `portal-space`, before gameplay input became enabled. It timed out and disconnected cleanly. This is a remaining probe-readiness limitation, not evidence of a product regression. No harness change was included. Historical pending-verification notes above describe earlier investigation stages and are superseded by this closeout.

Final commit review rechecked the accumulated diff, including the new shared traversal file, collision product producers, classification completion/reset handling, activation readiness, selection prefix consumption, and precise-jump hit/proof consumption. No blocking quality findings or additional production changes. Existing visual-membership limitations in selection remain outside this correction. The 1,481 passing library tests, warnings-denied Clippy, live ray replay, and user acceptance remain applicable; formatting and whitespace checks were repeated. The user requested this review and commit.

## Issue queue

Issue 5 is closed following user acceptance. Worksheet remains open for subsequent reports; the previously recorded issue 3a follow-up remains separate.
