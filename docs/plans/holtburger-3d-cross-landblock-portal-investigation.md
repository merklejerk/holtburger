# Cross-landblock portal investigation: D599 / D699

2026-10-17. **Renderer investigation resolved and user accepted.** The
reported rendering cause is proven. Scene-owned junction resolution now handles
the previously failing 0D4A content without changing geometric tolerances. See
E10 onward for numerical evidence and current checks. The user replied “lgtm”
after the final verification report; acceptance is recorded in E14. **The client
movement correction is implemented and automated checks pass.** Live movement
acceptance against unmodified ACE remains open; see M11 onward.

## Goal and scope

Explain the outdoor scene visible through the reported passage and the subsequent
movement lockup, then establish an appropriately scoped renderer correction.

Track both symptoms because they occur at the same seam. Keep renderer junction
classification, physical traversal, and server-compatible position publication as
separate decisions until evidence establishes a shared implementation requirement.
The renderer correction is accepted. The active follow-up corrects shared client
movement transitions to work with unmodified ACE. Server changes are out of scope.

The user authorized diagnostic builds and runs, creation of this working document,
then completion and resolution of the investigation, and explicitly authorized
“Implement the client correction” in `holtburger-world`. Leave visual acceptance to
the user. Do not run the TUI or modify the
retail decompile. Do not stage or commit without a separate request.

## Reported reproduction

The user reports that the passage appears to show the outdoor scene. Walking into
it eventually leaves the character unable to move.

Initial report:

```text
Player(AC) cell=0xd5990109 pos=(188.925, 132.22, 374.005) quat(wxyz)=(-0.7234, 0, 0, 0.6904)
Camera(scene) lb=0xd599ffff cell=0xd5990100 pos=(41077.682, 377.063, -29507.554) quat(wxyz)=(0.7339, -0.085, -0.6695, -0.0776)
```

Reported desynchronized position:

```text
Player(AC) cell=0xd6990120 pos=(11.579, 138.111, 374.005) quat(wxyz)=(-0.9986, 0, 0, 0.0534)
Camera(scene) lb=0xd699ffff cell=0xd6990125 pos=(41099.329, 375.926, -29511.775) quat(wxyz)=(0.9915, -0.1187, -0.0531, -0.0064)
```

The crossing itself is between `D5990109` and `D6990121`; the later reported
`D6990120` is farther along the local route. A player and third-person camera may
legitimately occupy different cells. Their differing IDs alone do not prove a bug.

## Evidence ledger

### E1. ACE rejects the actual reported movement

The local server log, `ace-root/logs/ACE_Log.txt`, records:

```text
2026-10-16 22:37:04,199 [World Manager] ERROR (ACE.Server.WorldObjects.Player) +Holtfighter.UpdatePlayerPosition() - movement pre-validation failed from D5990109 [191.06296 132.31973 374.005] to D6990121 [0.013595581 132.36415 374.005]
```

Subsequent entries repeatedly reject the exact reported destination:

```text
movement pre-validation failed from D5990109 [191.77927 132.35323 374.005] to D6990120 [11.579418 138.11111 374.005]
```

The log is mutable local evidence, not a checked-in fixture. The destination and
rejection text were observed directly; use a new log capture for future runs.

`ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs:543` rejects ordinary movement
between indoor cells in different landblocks unless both cells are in its explicit
exception set. That set contains `D6990112` and `D599012C`, not this crossing.
ACE commit `5bba05ab` introduced those exceptions with the subject
`suppress server error from bugged cells in asheron's castle (#3241)`.

Conclusion: the server rejection is confirmed. Do not infer that the client has
chosen an invalid physical destination merely from this validation failure.

### E2. Current collision traversal crosses the seam successfully

The initially available `collision_scene_probe` binary was older than the current
collision source. Its early results were superseded by a fresh build:

```sh
cargo build -p holtburger-debug-harness --bin collision_scene_probe
target/debug/collision_scene_probe \
  --landblock 0xd599ffff --portal-cell 0xd5990109 \
  --grounded-start 188.925,132.22,374.005 \
  --grounded-drive 4,0.187 --grounded-cell 0xd5990109 \
  --grounded-ticks 70
```

At driven tick 23 the fresh probe reports:

```text
start=(191.991623,132.363541,374.005005)
final=(0.124954,132.369781,374.005005)
cell=0xD6990121 ground=supported
achieved=(3.999939,0.187225,0.000000)
```

The local X wrap is a coordinate-frame change across the 192 m landblock boundary,
not a 192 m physical jump. This diagnostic exercises static collision traversal;
it does not exercise ACE acceptance, network timing, or confirmation damping.

`crates/holtburger-world/src/spatial/collision.rs:2314` already discovers a unique
coincident destination through outdoors. Its `append_motion_leg` function at
`:3082` collapses multiple zero-duration boundaries to their final placement.

### E3. Render apertures meet across the boundary without a shared junction

Built and ran the production source exporter:

```sh
cargo build -p holtburger-3d-host --bin portal_trace_archive
target/debug/portal_trace_archive 0xd599ffff 0xd699ffff
```

Decode each `records[].envCellRecordHex` as HBEC: the little-endian u32 at byte 8
is the manifest length; the JSON manifest begins at byte 16. Binary section
offsets are relative to the byte immediately after that manifest. Source IDs can
be recovered from the `cellIds` section and crossing cell indices.

Measured local source counts:

| Owner      | Cells | Directed crossings | Directed exterior crossings | Local junction groups |
| ---------- | ----: | -----------------: | --------------------------: | --------------------: |
| `D599FFFF` |    78 |                224 |                          72 |                     2 |
| `D699FFFF` |    44 |                120 |                          42 |                     2 |

The two directed crossings for each reported opening have `junctionGroupId=null`.
Their render-space source aperture bounds are:

| Cell       | Local X           | Render Y (height) | Render Z               |
| ---------- | ----------------- | ----------------- | ---------------------- |
| `D5990109` | approximately 192 | 374 to 378        | -134.2000 to -130.5000 |
| `D6990121` | 0                 | 374 to 378        | -134.2000 to -130.5000 |

Reanchoring `D699` into `D599` adds 192 m to X, placing these openings at the same
boundary. Small authored/transform deviations remain; comparisons need the
existing geometric tolerances and a nearby coordinate anchor.

A restricted scan of outdoor-source crossings found two cross-owner candidates
with coincident X planes and positive projected bounds overlap. Both bounds
overlaps measured approximately 14.8 square metres. The reported candidate uses
building 0 / portal 2 in D599 and building 2 / portal 1 in D699. The other uses
building 2 / portal 4 in D599 and building 1 / portal 0 in D699.

This was an axis-aligned plane/bounds broad phase, not a polygon-intersection
census. It establishes more than one local candidate, not archive-wide frequency
or proof that every candidate qualifies for a junction.

### E4. Production admission requires a matching junction at equal depth

The production CPU helper `portalEntryAdvanceAdmitted` in
`apps/holtburger-3d/src/lib/game/renderer/portal-model.ts:131` admits equal depth
only for matching non-null junction groups. The propagation shader expresses the
corresponding rule in `webgl2-portal-scope-atlas-programs.ts:360`.

A direct Node invocation of the production identity and CPU admission helpers
returned:

```json
{
  "source": { "junctionGroupId": 3583574017 },
  "target": { "junctionGroupId": 3600351233 },
  "equalDepthCrossLandblock": false,
  "equalDepthSameGroup": true
}
```

This used local ordinal 1 qualified for each owner and equal entry/candidate
depths. It proves the identity/admission rule, not actual GPU execution at the
reported camera pose. Actual seam groups are null, as E3 records.

### E5. Movement throttling explains the symptom but needs runtime measurement

`crates/holtburger-world/src/spatial/pose_reconciliation.rs:796` selects indoor
confirmed-travel thresholds of 5 m before damping and 20 m at full suppression.
The translation constraint accumulates travel without advancing confirmation.

Combined with E1, this provides a code-supported explanation for movement
progressively stopping. The active constraint state was not captured during the
reported lockup, so its exact contribution remains an inference.

### E6. Two immediate position reports are not a proven compatibility fix

`ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs:300` assigns a single
`RequestedLocation`. `Player_Tick.cs:303` later consumes and clears it during the
physics update. Consequently, an outdoor report immediately followed by an indoor
report can replace the first before physics processes it.

Retail `acclient.c:682586` shows `ShouldSendPositionEvent` comparing current and
last-sent cells, contact planes, and elapsed time. It does not establish that retail
publishes an intermediate outdoor state at this seam. No retail packet capture or
equivalent complete execution trace has been collected.

## Architecture and constraints

| Layer                | Relevant responsibility                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `holtburger-content` | Authored geometry, local portal endpoints, provenance, collision asset preparation                     |
| `holtburger-world`   | Resident physical scene; body/ray traversal and accepted placement                                     |
| `holtburger-core`    | Position publication and server-facing client behavior                                                 |
| h3d host             | Render aperture preparation, reciprocal geometry, and local visibility islands                         |
| h3d frontend scene   | Compose resident render crossings, classify junctions, and publish topology revisions                   |
| h3d renderer         | Consume prepared topology and enforce depth/arrival rules                                              |

Before the correction, render junction preparation lived in host
`env_cell_source.rs` and `portal_visibility.rs`, seeing one landblock per source
record; frontend `portal-scene-identity.ts` qualified its local IDs by owner. The
correction removes that assignment and qualification. `SceneGraph` now invokes
`resolvePortalJunctions` over the composed view and caches it by topology revision.

Requirements for a correction:

- Discover genuine junctions across resident owners, including partitioned openings.
- Retain the geometric overlap, reciprocal, and same-render-domain ambiguity proof.
- Keep authoritative physical traversal separate from rendering permission.
- Derive each junction assignment once; consumers must not independently regroup.
- Recompute on topology changes, not camera frames; use a nearby comparison frame.
- Handle insertion, replacement, removal, rollback, and reinsertion coherently.
- Keep incomplete or ambiguous evidence under strict admission; do not invent joins.
- Preserve existing renderer depth rules and avoid cell-ID exceptions.

The previous [0D4A investigation](holtburger-3d-0d4a-portal-rendering-investigation.md)
documents partitioned-opening and ambiguity cases. Treat its old measured counts
as historical evidence, not a current census of this region.

## Design assessment and revised conclusions

These are alternatives considered during scoping, not implemented changes:

1. **A new asynchronous host operation for composed junction resolution.** Reuses
   Rust geometry, but introduces transport, stale-result handling, and publication
   coordination. That cost needs stronger justification than implementation reuse.
2. **A shared runtime connection graph in `world`.** Premature as currently proposed.
   World already discovers the physical crossing. Movement's need to retain path
   history does not establish a need for the renderer's visibility-domain grouping.
3. **A synchronous h3d scene-topology resolver.** Current preferred direction.
   Move final junction assignment to the composed scene's topology-revision rebuild,
   using a proven polygon library rather than hand-written general polygon clipping.
   Delete the superseded per-record assignment and qualification mechanism.

The third option keeps the current synchronous publication lifecycle, but moves
geometry work to TypeScript and may add a dependency. Before implementation, prove
the GPU failure and check that porting the existing proof is bounded and preserves
its accepted and rejected cases. Do not treat this preference as a settled design
or assume dependency choice/version without inspection.

No new shared contract has yet been justified. Reuse existing authored geometry
and provenance. Extract further shared machinery only when both consumers need the
same fact with the same semantics, rather than merely referring to the same place.

## Progress and next evidence

- [x] Capture user poses and identify the actual boundary crossing.
- [x] Confirm server rejection from the live log and inspect ACE validation.
- [x] Rebuild the collision probe and reproduce the physical crossing.
- [x] Export current render geometry for both owners and inspect local distribution.
- [x] Verify the equal-depth CPU rule and per-owner identity separation.
- [x] Inspect movement publication constraints and ACE pending-position behavior.
- [x] Reproduce both directions through the production GPU path with numeric arrival
      and composition evidence; distinguish missing preparation from GPU rejection.
- [x] Measure a controlled junction-metadata change to isolate causation without
      changing geometry, shader depth rules, capacities, or camera pose.
- [x] Survey cross-owner candidates beyond this pair and classify exact, partial,
      partitioned, ambiguous, and boundary-only overlap shapes before generalizing.
      E11/E14 bound the local content survey; synthetic cases cover classes not
      established by that sample. No archive-wide claim is made.
- [x] Dry-run the synchronous resolver design against scene revision, rollback,
      eviction, and ordering invariants; inspect suitable existing polygon libraries.
- [x] Agree the implementation scope and obtain authorization before production edits.
- [x] Implement and verify focused geometry, topology lifecycle, and GPU regressions.
      The E9 numerical blocker is resolved; current results are in E10–E13.
- [x] Leave visual acceptance to the user; user replied “lgtm” (E14).

Movement follow-up:

- [x] Explain confirmation throttling from source and focused replay (M3–M5).
- [x] Establish retail behavior: the user reports no desync or freeze. Execute
      the source-aligned transition reference and isolate the frame difference (M8–M11).
- [x] Implement the correction in shared world traversal; preserve the existing
      accepted-pose publisher and unmodified server (M12).
- [ ] Verify corrected live walking/running against unmodified ACE (M13).

## Definition of done: renderer correction

The renderer correction is complete only when all of the following are satisfied:

- [x] Numeric evidence from the production GPU path confirms the cause and verifies
      traversal through the reported seam in both directions.
- [x] Junction assignment has one owner operating over composed resident topology;
      superseded per-landblock assignment and ID qualification are removed.
- [x] Existing valid junctions, including partitioned openings, retain their behavior.
      Ambiguous, separated, and edge-touching openings receive no unsafe exemption.
- [x] Loading, eviction, replacement, rollback, and reinsertion preserve coherent
      topology and junction assignments.
- [x] Focused geometry and topology lifecycle tests, GPU harness assertions, type
      checks, lint, and applicable Rust checks pass. Clippy warnings are errors.
- [x] The user accepts the visual result. Agent numeric GPU checks do not constitute
      visual acceptance.
- [x] This document records the final design, verification evidence, and remaining
      limitations, with hypotheses updated to reflect the results.

Movement desynchronization remains a separately tracked unresolved issue. Meeting
this renderer completion gate does not establish that server rejection or the
movement lockup is fixed, and does not close the movement follow-up checklist.

## Validation and working-tree state

### E7. Production GPU seam experiment (2026-10-16)

The harness-only `portal-seam-probe.ts` captures one production executor input and
replays it synchronously. It reads each propagation round from the actual frontier
framebuffer using `RGBA_INTEGER` / `UNSIGNED_INT`, explicitly restoring the read
framebuffer binding. A control repeats unchanged metadata. The experimental run
changes only the selected seam crossings' junction fields; geometry, camera,
opaque atlas, depth rules, and capacities stay fixed.

Forward pose: the first user camera position, root `D5990100`, yaw 84.3 degrees,
pitch -13.3 degrees (orientation approximated from the supplied quaternion).
Forward crossing IDs are `portal-crossing:0xd599ffff/23` and
`portal-crossing:0xd699ffff/93`.

- Baseline: 16,078 pixels arrive outdoors in round one; zero arrive in `D6990121`.
- Shared junction: those 16,078 pixels arrive in `D6990121` in round two.
- Final opaque composition changes at 16,078 pixels; unchanged control changes zero.
- All measured WebGL errors are zero; all planner capacity retreat counters are zero.

Reverse pose: root `D6990121`, scene position `(41089, 376, -29508.4)`, yaw 270
degrees, pitch zero. Reverse IDs are `portal-crossing:0xd699ffff/92` and
`portal-crossing:0xd599ffff/24`.

- Baseline: 900,355 pixels arrive outdoors; the seam arrival into `D5990109` is absent.
- Shared junction: 900,355 pixels arrive in `D5990109` in round two.
- Final composition changes at 872,662 pixels; unchanged control changes zero.
- All measured WebGL errors are zero.

Local outputs: `/tmp/h3d-cross-landblock-gpu-before.json` and
`/tmp/h3d-cross-landblock-gpu-reverse-before.json`. Both use actual GPU rendering,
1280 x 720, radius-one buildings/EnvCells/terrain and radius-zero explicit objects.
These readbacks establish causation; they are not visual acceptance.

An initial readback used an unsupported unsigned-byte integer format and produced
GL_INVALID_OPERATION. Its arrival counts are invalid and superseded by the
unsigned-int runs above. The initial sandboxed launch also failed to bind a local
socket; the authorized socket-enabled runs completed successfully.

### Implementation progress

Junction resolution is moving to a synchronous scene-revision operation, with
source crossings and resolved crossings represented separately. The redundant
outgoing-crossing mutation index is removed; the resolved snapshot builds its
outgoing adjacency once. HBEC v6 removes record-local junction assignments.

The initial candidate used `polygon-clipping` 0.15.7. E10 records its replacement
with `polyclip-ts` and the precision required by authored geometry. The existing
component and competing-exit proof is retained. Collision, position publication, and ACE remain unchanged.

The initial 58 focused geometry, SceneGraph, and environment-publication tests
pass, including a real SceneGraph/EnvCellSystem replacement, rollback, eviction,
and reinsertion exercise. Full validation and broader content compatibility are
not equivalent: the latter exposed the stopping condition below.

### E8. Candidate correction passes the reported GPU seam

Repeated the E7 runs after moving junction resolution into the scene. The seam
crossings receive the same non-null scene-owned ID (3 in these snapshots).

- Forward: the ordinary production input now admits 16,078 destination pixels in
  round two. Injecting the diagnostic junction ID produces zero additional pixel
  changes; the ordinary path already matches the controlled experiment.
- Reverse: the ordinary input admits 900,355 destination pixels in round two.
  Diagnostic injection likewise changes zero final pixels.
- Both unchanged controls change zero pixels; all measured WebGL errors are zero.
- Both browser reports contain no console errors or exceptions.

Outputs: `/tmp/h3d-cross-landblock-gpu-after.json` and
`/tmp/h3d-cross-landblock-gpu-reverse-after.json`. These prove the candidate at the
tested seam, not general content compatibility or visual acceptance.

### E9. Historical blocker: candidate polygon intersection fails on existing 0D4A content

The broader diagnostic exported twelve regional owners (`D498` through `D79A`
over a 4 x 3 rectangle) and the previous partitioned-opening regression owner
`0D4A`. It decoded production HBEC v6 through `decodeEnvCellRecord`,
`planEnvCellMaterialization`, and `createEnvCellEnvironmentArtifact`, then invoked
the candidate `resolvePortalJunctions` on each owner's complete topology.

D599 (224 crossings) and D699 (120 crossings) resolve successfully in isolation.
The 342-crossing 0D4A input throws while intersecting:

```text
portal-aperture:0x0d4affff/env-cell/0d4a0122/polygon/0012
portal-aperture:0x0d4affff/env-cell/0d4a0116/polygon/000e

Unable to complete output ring starting at [11.20000076244218, -15.528877258248217].
Last matching segment found ends at [21.999999999143263, -15.528877258206238].
```

The exception originates in `polygon-clipping` 0.15.7, called with the candidate
resolver's orthonormal projection. Whether projection conditioning, input handling,
or a library defect was responsible had not yet been established at this stop. Do not attribute it
to malformed authored data or assume another library automatically fixes it.

The original authored boundary coordinates retained for reproduction are:

```json
{
  "0d4a0122/0012": {
    "vertices": [
      91.76444244384766, 40.20000076293945, -72, 74.4000015258789,
      30.200000762939453, -72, 76.23491668701172, 29, -71.9999008178711,
      91.76444244384766, 29, -72
    ],
    "normal": [4.7641242417739704e-7, 8.1589032561169e-6, 1],
    "d": 71.99967956542969
  },
  "0d4a0116/000e": {
    "vertices": [
      91.76445007324219, 18.200000762939453, -72, 76.23556518554688,
      18.200000762939453, -72.00001525878906, 76.23556518554688, 29,
      -72.00001525878906, 91.76445007324219, 29, -72
    ],
    "normal": [5.960464477539062e-7, 0, -1.0000005960464478],
    "d": -72.00008392333984
  }
}
```

Both use indices `[0,1,2,0,2,3]`. The full candidate artifact is retained locally at
`/tmp/h3d-cross-landblock-failing-artifact.json`. The export is
`/tmp/h3d-cross-landblock-region-export.json`; the failure trace is
`/tmp/h3d-cross-landblock-region-survey-error.txt`. These are disposable local
diagnostics, not checked-in asset-dependent tests. The aborted survey is not a
completed census or proof of the frequency of any content class.

This is a material regression against an existing rendering case, despite green
unit tests. The requested major-gap stop applies. No fallback, tolerance increase,
or swallowed exception was added. The failure is rethrown with both aperture
identities so it remains diagnosable.

Before resuming implementation, isolate this pair in an asset-free numerical
reproduction and establish a robust overlap calculation. Reassess the TypeScript
geometry choice against retaining the existing Rust geometry if this requires
substantial new numerical machinery. Then repeat 0D4A, the reported seam, the
broader survey, and all affected checks. Do not mark the renderer done based on
the local seam success alone.

### Checks completed before the major-gap stop

- All 3,070 TypeScript tests passed (362 files).
- Svelte check reported zero errors and warnings; application, script, test,
  Electron main, and preload type checks passed.
- ESLint passed.
- `cargo check -p holtburger-3d-host` passed.
- `cargo clippy -p holtburger-3d-host --all-targets -- -D warnings` passed.
- Focused GPU runs above passed; broad content compatibility failed (E9).
- Host unit tests, dead-code lint, and final completed-change review remain open.

These check results predate the final diagnostic error-context addition and
documentation updates. The broader runtime failure takes precedence over green
aggregate checks. No final acceptance claim is made.

Diagnostic builds of `collision_scene_probe` and `portal_trace_archive` passed.
The fresh collision run, HBEC manifest inspection, restricted candidate scan, and
direct Node admission check completed. GPU evidence and current implementation
progress are recorded above. No visual acceptance check or commit was performed.
Existing untracked content in the ACE and ACViewer submodules was present
before this investigation and was left untouched.


### E10. Numerical isolation and correction (2026-10-17)

The E9 stop was resumed with explicit authorization to investigate and resolve the
numerical failure. Both projected rings in the isolated pair are convex. An
independent rational calculation, starting from the exact binary double values of
the projected coordinates, finds a positive intersection of approximately
`7.249485868550964e-9 m²`. This is below the junction union threshold but must still
count when proving competing-exit ambiguity. Dropping tiny intersections or
catching the error and returning zero would weaken that proof.

`polygon-clipping` 0.15.7 fails with the original pair, reversed arguments, and a
translated frame. Changing projection basis can erase this sliver because the
authored surfaces are slightly nonplanar; that is not a precision correction.
The isolated inputs are retained at `/tmp/h3d-numerical-pair.json`.

The replacement [polyclip-ts](https://github.com/luizbarboza/polyclip-ts) 0.16.8
uses `bignumber.js` arithmetic and resolves the first pair. Its default 20 decimal
places still fail another authored pair: `0D4A0122/0013` versus `0D4A0119/0013`.
A complete 342-crossing 0D4A comparison gives:

| Division decimal places | Result | One diagnostic run |
| --- | --- | --- |
| 20 | Output-ring connectivity exception on the second pair | 64 ms |
| 40 | 55 junction groups | 163 ms |
| 80 | 55 junction groups | 162 ms |
| 160 | 55 junction groups | 198 ms |

The resolver uses 80 decimal places, with headroom over the lowest successful
survey setting. This is bounded empirical evidence, not a proof for every possible
polygon. Arithmetic precision does not change plane, snapping, or area tolerances.
The synchronous intersection saves and restores the shared BigNumber configuration
in `finally`; it invokes no application callbacks. The direct dependency and the
clipper currently share the deduplicated BigNumber 9.3.1 constructor. No epsilon
snapping is enabled. Unexpected failures still throw with both aperture identities.

Area accumulation uses triangles relative to the returned ring's first point,
avoiding cancellation between large absolute-coordinate products. Three asset-free
regressions cover both authored failures, preserve the positive sliver when it
blocks an ambiguous junction, and verify restoration of the caller's precision.
No runtime DAT asset is required by these tests.

This retains one junction owner in the composed scene layer. Reintroducing host
junction assignment would restore the original cross-owner defect; moving the
whole composed scene to Rust would broaden the boundary change. The tradeoff is
an additional decimal-arithmetic dependency and cold topology rebuild cost.

### E11. Completed local content survey

The repeated production HBEC decode/materialization survey completes for all 13
requested owners: twelve in the D498–D79A rectangle plus 0D4A. Ten regional owners
have no interior topology. D599 has 224 crossings and two local groups; D699 has
120 and two; 0D4A has 342 and 55. Composing the 686 crossings produces 61 groups,
including two four-crossing groups spanning D599/D699. Reversing input order
preserves group membership. The combined cold resolution took approximately
190 ms in this diagnostic run; it is cached per topology revision, not per frame.

The survey is local, not archive-wide. Synthetic tests cover partial, partitioned,
ambiguous, separated, and boundary-only shapes beyond this content sample.
Outputs: `/tmp/h3d-numerical-region-survey.json` and
`/tmp/h3d-numerical-precision-survey.txt`.


### E12. Current automated checks and bounded design review

- All 3,073 TypeScript tests pass across 362 files. After normalizing one fixture
  literal to its identical representable double for ESLint, all 15 resolver tests
  pass again.
- Svelte reports zero errors and warnings; application, scripts, tests, Electron
  main, and preload type checks pass.
- ESLint, Knip, and host Clippy with `-D warnings` pass. The dynamically loaded
  seam diagnostic is registered as a harness entry, following the existing probe
  convention rather than suppressing dead-code analysis.
- All 367 Rust host library tests pass.
- `git diff --check` passes.

The final ownership review follows HBEC v6 raw crossings through environment
publication, scene revision resolution, outgoing adjacency, and renderer metadata.
Junction identity has one producer: the composed scene. The former Rust assignment,
per-owner ID qualification, and redundant mutable outgoing index are removed.
Reciprocal aperture geometry remains in Rust because it is still needed to produce
source records; the retained diagnostic overlap predicate does not assign runtime
junction identities. No additional shared-crate contract was introduced.
Replacement/rollback and eviction/reinsertion use the same scene revision path.

Accepted costs are the decimal-arithmetic dependency and approximately 190 ms
cold resolution in the combined local survey. Resolution is synchronous and cached
for the topology revision. Precision/configuration restoration is explicit; errors
remain contextual and fatal rather than silently weakening the overlap proof.
No additional correctness or ownership blocker was found within this boundary.
This review does not establish archive-wide numerical compatibility, interactive
frame latency on larger resident scenes, server movement acceptance, or visual
acceptance.


### E13. Final production GPU numeric regression

Fresh sequential browser runs after the precision correction pass all four poses:

| Opening and direction | Destination | Destination frontier pixels in round two |
| --- | --- | --- |
| Reported seam forward | D6990121 | 16,078 |
| Reported seam reverse | D5990109 | 900,355 |
| Existing partitioned opening forward | 0D4A012D | 128,616 |
| Existing partitioned opening reverse | 0D4A011D | 150,984 |

Each unchanged control changes zero final pixels. Injecting the diagnostic seam
junction identity changes zero additional pixels in both reported-seam directions;
the production scene assignments already provide the required permission. The
0D4A poses have no diagnostic seam overrides. Every run reports WebGL errors
`[0,0,0]` and empty browser console messages. These are numeric readbacks, not
visual acceptance checks.

Outputs are `/tmp/h3d-numerical-gpu-d599-forward.json`,
`/tmp/h3d-numerical-gpu-d699-reverse.json`,
`/tmp/h3d-numerical-gpu-0d4a-forward.json`, and
`/tmp/h3d-numerical-gpu-0d4a-reverse.json`. An initial concurrent forward seam run
was invalidated by a development-server reload; the successful sequential rerun
supersedes it. No renderer failure was inferred from that harness interruption.

The numerical failure is resolved within the tested scope. At the time of this
report, user visual acceptance was outstanding; E14 records the subsequent
acceptance. An archive-wide content-class census was not performed; the local
survey and synthetic cases above define the evidence boundary. Movement remains
unresolved. No agent visual inspection, staging, or commit was performed.


### E14. Acceptance and completion audit

The user replied “lgtm” after the E13 verification report. This is the user-owned
acceptance gate; the agent did not perform visual acceptance or infer a separate
four-pose visual test from that reply.

The completion audit inspected the current resolver and contract, scene snapshot
publication, lifecycle regression, package scripts, validation outputs, GPU
readbacks, and resident-content survey. All renderer definition-of-done items are
satisfied. The current architecture table above now describes the final ownership;
the earlier per-landblock design is explicitly historical.

To finish the local candidate classification, the production HBEC decoder,
materialization planner, and artifact builder were rerun on the regional export.
The two cross-owner groups are:

| Indoor endpoints | Footprint class | Approximate projected area per side |
| --- | --- | --- |
| D5990109 ↔ D6990121 | Matching five-sided boundaries within authored transform tolerances | 13.225 m² |
| D599012C ↔ D6990112 | Matching five-sided boundaries within authored transform tolerances | 13.225 m² |

Both groups consist of four directed crossings: an indoor/outdoor reciprocal pair
from each owner. These are full-footprint matches within tolerances, not claims of
bit-identical coordinates. The earlier 14.8 m² figure was only bounding-box overlap;
the authored polygon has a sloping shoulder. The second group is distinct from
the originally reported crossing. Boundary coordinates and source IDs are retained
in `/tmp/h3d-final-candidate-classification.json`.

Partial overlap and opposed normals, tall openings opposite disjoint partition
pieces, ambiguous overlapping exits, boundary-only contact, separated planes,
and separated footprints have explicit asset-free resolver regressions. The
existing 0D4A partitioned case additionally passes the production GPU path in both
directions. The local sample does not establish archive-wide frequencies for
these classes, nor is such a frequency census required to claim the tested
renderer correction.

The renderer investigation is resolved, with the documented numerical/performance
limits. Movement work remains explicitly outside this correction: ACE rejection
is confirmed, confirmation damping is a code-supported explanation rather than a
captured runtime fact, and retail-compatible publication still requires evidence.
No movement fix, ACE change, commit, or staging is included in this completion.


## Movement/transition investigation resumed (2026-10-17)

The user requested investigation of the desync/transition after renderer acceptance.
Renderer completion above remains valid. This phase investigates movement; it does
not authorize a production compatibility workaround or an ACE behavior change.
Existing diagnostic builds/runs and maintenance of this evidence document were
previously authorized. The user subsequently said “go on” after the focused
comparison proposal, authorizing this diagnostic work. Production behavior remains
unchanged.

### M1. Constraints and decision owners

- Content/world owns physical reachability and the accepted body cell. Renderer
  junction groups cannot establish server movement permission.
- Core publishes the accepted position after simulation and owns any eventual
  client publication compatibility policy. Session delivery is not server pose
  acceptance: `PositionPublication::record` commits on successful submission.
- ACE owns its pre-validation and subsequent authoritative collision check.
- Confirmation damping is retail behavior. Disabling it or treating a submitted
  position as confirmed would hide missing authority rather than restore agreement.
- A compatibility strategy must survive both autonomous-position and motion-state
  packets. Both can overwrite ACE's single pending requested position.
- Any eventual correction must cover both directions, the already exempt castle
  seam, ordinary indoor/outdoor transitions, and teleport/forced-placement resets.

### M2. Controlled comparison of the two castle seams

Replayed both routes using the existing production collision diagnostic, without
changing its source or the world solver:

```sh
target/debug/collision_scene_probe \
  --landblock 0xd599ffff --portal-cell 0xd5990109 \
  --grounded-start 188.925,132.22,374.005 --grounded-drive 4,0.187 \
  --grounded-cell 0xd5990109 --grounded-ticks 70

target/debug/collision_scene_probe \
  --landblock 0xd599ffff --portal-cell 0xd599012c \
  --grounded-start 188.925,179.7,374.005 --grounded-drive 4,0 \
  --grounded-cell 0xd599012c --grounded-ticks 70
```

Both cross on driven tick 23, from local X `191.991623` to `0.124954` in
the neighboring owner. The destinations are D6990121 and D6990112 respectively.
Both remain floor-supported, report zero collision constraints, and continue at
approximately 4 m/s through tick 69. The wrap represents approximately 0.133 m
of world-space travel. The probe's raw local-coordinate displacement field shows
approximately -191.867 m at the wrap; its achieved velocity uses the proper frame.
`WorldPosition::distance_to` also uses global-space distance across distinct cells,
so that diagnostic field is not evidence of a production distance-budget jump.

Outputs: `/tmp/h3d-transition-reported-collision.txt` and
`/tmp/h3d-transition-exempt-collision.txt`. These are collision runs, not live
server acceptance tests. The exempt route's successful live acceptance has not
been claimed.

ACE `Player_Tick.cs:543` permits the latter pair through its explicit `buggedCells`
set, and rejects the reported pair before requesting collision validation.
Commit `5bba05ab` added precisely the latter pair as an Asheron's Castle exception.
The two physical paths have the same direct cross-owner indoor transition shape;
the server's exception policy distinguishes them. This is strong evidence of a
server pre-validation coverage gap. It does not by itself choose a portable client
workaround for unmodified servers.

### M3. Latest live rejection and missing-confirmation evidence

The current ACE log contains 61 matching rejection reports during the
`2026-10-17 00:23:56`–`00:24:15` interval. The held source positions remain in
D5990109 (two distinct positions during the interval); requested destinations are
in D699. The first rejected request is only approximately 0.224 m from its held
server pose after accounting for the owner offset. Therefore a large physical
jump is not necessary to trigger this failure. Maximum observed endpoint
separation in this sample is approximately 13.127 m.

`UpdatePlayerPosition` returns at its pre-validation failure (`:419–423`), before
its normal location update and position response (`:507–516`). The handler for
autonomous position stores `RequestedLocation`; it does not independently confirm
the pose. The rejected call therefore does not produce its normal confirmation.
This does not assert that no other server subsystem can emit a position message.

The focused production test
`client::movement::position_publication::tests::distance_publication_prevents_healthy_fast_run_throttling_but_not_missing_confirmation_throttling`
passes. It runs the real confirmation state: healthy delayed confirmations allow
full movement with distance publication; missing confirmations suppress movement
even with frequent reports. An initial invocation with `--exact` and only the short
name selected zero tests and is not evidence; the corrected substring invocation
ran and passed the one named test.

This establishes the suppression mechanism in a controlled test, not the active
constraint state in the user's freeze. Net endpoint separation below 20 m does
not disprove it: the constraint accumulates travel, including backtracking, and
starts with current-to-confirmed separation. A live capture or production-path
replay must distinguish it from other local movement gates.

### M4. Retail transition and publication references

- `acclient.c:332969–333125`, `CObjCell::find_cell_list`, grows the candidate array
  while iterating it, then chooses a containing cell with an indoor preference.
- `:334136–334300`, `CEnvCell::find_transit_cells`, adds outdoor cells to that
  same search; `:341417`, `CSortCell::find_transit_cells`, expands buildings.
- `:301074`, `CTransition::check_other_cells`, installs the selected check cell.
- `:310624–310695`, `CPhysicsObj::SetPositionInternal`, commits the transition's
  final cell and frame. `:310896–310912` calls this after solving a transition.
- `:682586`, `ShouldSendPositionEvent`, compares the last sent cell/contact state
  with the current physics pose. `:682671`, `SendPositionEvent`, packages that
  current pose rather than an enumerated traversal history.

These references support a direct indoor-to-indoor result within one physical
search. They do not establish a mandatory separately published outdoor frame.
No complete retail execution or packet capture at this exact seam is available.
An intermediate-outdoor workaround remains unproven. Even sending two packets is
insufficient evidence: ACE can replace the first request before its physics tick,
and the first must itself be accepted before the second can rely on it.

### M5. Next diagnostic and current disposition

A focused offline debug-harness probe is proposed: combine the authored seam
collision solve with production confirmation damping, and compare responses under
ACE's current acceptance predicate against an accepting control. Keep the copied
server predicate explicitly a control model, not a claim to execute ACE physics.
Include both castle seams and print accepted world displacement, committed cell,
requested/accepted drive, last simulated confirmation, publication/acceptance
counts, and the damping state. Unexpected collision failure must abort the replay.
This can isolate whether rejection is sufficient to reproduce the lockup without
altering production behavior or logging into the user's character.

Diagnostic source-edit permission was requested because the standing AGENTS.md
requires explicit approval. The earlier build/run approval permitted build
artifacts and output only. Production motion/physics/ACE source remains unchanged.
The user subsequently clarified that the correction must work in our clients
against unmodified ACE. An ACE behavior change is outside scope. M6/M7 supersede
this diagnostic emphasis with a retail/client transition comparison.


### M6. Client compatibility is the requirement; frame handling differs

The user clarified: fixing ACE is not our task. Establish how retail works and
make our clients compatible with the unmodified server. ACE's exception list is
an observed constraint/control, not the implementation destination. M2's
pre-validation-gap interpretation does not establish retail equivalence for our
physical transition. M4's generic same-search reachability was too weak to imply
that different-owner indoor cells are reached in that same search.

A closer trace identifies a concrete frame difference:

1. `SPHEREPATH::cache_global_sphere`, `acclient.c:302345`, transforms body spheres
   using `check_pos.frame`, in the current landblock coordinate frame. “Global”
   here does not mean absolute coordinates across all landblocks.
2. `CEnvCell::check_building_transit`, `:333984–334032`, transforms those centers
   directly through the candidate cell's frame before calling
   `CCellStruct::sphere_intersects_cell`. It does not use the passed `Position p`
   to apply a landblock offset. `CBuildingObj::find_building_transit_cells`,
   `:683450–683470`, forwards the spheres without rebasing them.
3. `CLandCell::add_all_outside_cells`, `:340704–340780`, adjusts a local copy to
   discover outdoor cell IDs; it does not replace the original sphere centers.
4. `SPHEREPATH::adjust_check_pos`, `:302532–302548`, rebases both the check frame
   and cached sphere centers when the chosen cell is outdoors (selector < 0x100).
   Its indoor branch only assigns the cell ID.
5. Our `CollisionScene::transit_cell_installed`, `collision.rs:1718`, instead
   converts the query center into every touched owner's frame before testing
   outdoor building entries. `coincident_outdoor_target_after_crossing` then uses
   that expanded membership to collapse coincident outdoor boundaries directly
   into a neighboring indoor placement.

This is a demonstrated difference in the entry-test inputs. It gives us a
client-side hypothesis with a concrete owning layer: shared world spatial
transition semantics. Rendering does not decide this, and a network packet
workaround is premature.

A read-only Node diagnostic loaded the saved production HBEC v6 export through
the current decoder, materializer, and environment artifact builder. It evaluated
the destination's authored Cell BSP positive-chain planes at a support-sphere
center just beyond each seam (body Z 374.005005 plus support offset 0.475):

| Destination | Center X in original frame | Minimum plane distance | X after owner conversion | Minimum plane distance |
| --- | ---: | ---: | ---: | ---: |
| D6990121 | 192.124954 | -184.525 m | 0.124954 | +0.125 m |
| D5990109 | -0.124954 | -188.155 m | 191.875046 | +0.125 m |
| D6990112 | 192.124954 | -184.525 m | 0.124954 | +0.125 m |
| D599012C | -0.124954 | -184.325 m | 191.875046 | +0.125 m |

The original-frame points fail containment; converted points pass. A sphere radius
of 0.480 m cannot bridge the original-frame rejection by over 184 m. Retail's
actual sphere-BSP predicate (`:347929`) uses radius plus 0.01 m; this is distinct
from our point-containment epsilon and still far below the measured separation.
The diagnostic measures the entry-input difference; it does not execute the
complete retail tick or establish what gets published on the wire.

### M7. Next proof and correction scope

The next useful diagnostic is a retail/client transition differential, superseding
the M5 emphasis on replaying server rejection and damping, which already have
independent evidence. Reconstruct the cited retail entry test and cell/frame
commit order alongside the current production traversal on authored seam data.
Preserve the original query frame until the retail operation actually changes it.

Trace the full tick, including collision support, step-down/reinsertion, and
substeps: an outdoor choice during an inner search does not prove that an outdoor
pose survives to publication. Then trace routine and motion-state publication,
both of which may carry position. The observed result must explain successful
operation against unmodified ACE; do not assume an arbitrary one-frame delay or
synthetic outdoor packet is sufficient.

The comparison must cover both directions of both castle seams, ordinary
same-owner coincident junctions, ordinary building entry/exit, and varying travel
per tick. In particular, keep separate candidate reachability, committed cell,
coordinate frame, and final published pose. A broad “ignore neighboring owners”
filter would not faithfully reconstruct the actual entry test, which can have
coordinate aliases; it is not yet justified.

If the complete trace confirms that our early owner conversion removes a
retail-observable outdoor stage, correct the shared world transition behavior at
that boundary and let core publish the resulting accepted pose. Mark any
intentional reproduction of retail's missing-offset behavior according to the
repository's RETAIL QUIRK convention, including a measured blast radius. Preserve
confirmation damping. No ACE, production collision, publication, or protocol
source has been changed during this investigation.


### M8. Executable transition comparison and controlled intervention

Built ACE from current source at commit
`c455c0097f62c15e2959b3f90855338fbe191be9`, using the installed .NET 10 SDK and
cached dependencies. Build succeeded with zero warnings/errors. No ACE source was
edited. A disposable C# project at `/tmp/h3d-retail-transition/` references that
build, loads the local raw DATs, and runs `Transition.FindTransitionalPosition` in
ACE's **client mode** (`PhysicsEngine.Server=false`). It does not start the server,
connect a socket, create a Player/session, or access the database.

This executes the complete transition search, collision insertion, support and
step-down/reinsertion paths. It is not the retail executable or the complete live
client loop. The caller supplies the two-sphere body used by the collision replay
(lower center 0.475 m, upper 1.350 m, both radii 0.480 m). Castle cases use a
supported horizontal step at body Z 374.005005 with a 374 m floor. The same-owner
controls use an airborne horizontal path inside 0D4A at body Z 22 m, with no
step-down. Step-up/down limits are explicit probe settings (0.3/0.6 m), not a claim
to decode every character setup. Only the transition's final accepted pose is
carried into the next iteration.

Runtime Harmony hooks log candidate lists, selected cells, frame rebasing,
transitional insertion, support, and final transition positions. The relevant
ACE routines were compared with the retail decompile. Three port bookkeeping
issues were aligned inside the diagnostic, without editing ACE:

- Retail initializes `do_not_load_cells=false` (`acclient.c:300347`). The probe
  calls `CellArray.SetDynamic` to obtain the corresponding `LoadCells=true`.
- Retail resets the candidate array's active count for each search (`:333003`).
  ACE resets `NumCells` but retains its dictionary, which consumers iterate by
  dictionary count. A diagnostic prefix clears that dictionary at the search start.
- Retail sets `added_outside=1` on outdoor expansion (`:340740`). The ACE overload
  omits that assignment; a diagnostic postfix restores the flag.

After correcting this bookkeeping, all final cell sequences were identical to
the initial comparison. The final evidence below uses the aligned version. An
initial trace hook failed on a null path during lazy static loading; the hook was
corrected, owners preloaded, and the complete sweep rerun successfully. Aborted
runs are not counted.

Each mode runs six routes (both directions of both castle seams, and both
directions of 0D4A011D/012D), seven travel distances per transition
`[0.03,0.133331,0.4,0.6,0.8,1.2,2.0]` m, and three starting phases
`[0.05,0.5,0.95]` of that distance before the boundary. Each run advances four
transitions. All 126 runs / 504 transitions per mode complete successfully.

At the representative walking distance:

| Direction | First final pose after crossing | Next final pose |
| --- | --- | --- |
| D5990109 → D6990121 | D6990006, outdoors | D6990121 |
| D6990121 → D5990109 | D599003E, outdoors | D5990109 |
| D599012C → D6990112 | D6990008, outdoors | D6990112 |
| D6990112 → D599012C | D5990040, outdoors | D599012C |

The outdoor stage survives the entire transition; it is not just a discarded
inner candidate. Floor support survives in the castle routes. Independent runs
of the current Rust collision diagnostic go directly between the indoor endpoints
in all four directions, including fresh reverse runs saved at
`/tmp/h3d-transition-reported-reverse-collision.txt` and
`/tmp/h3d-transition-exempt-reverse-collision.txt`.

The second mode is a controlled **owner-aware intervention**, not a proposed fix:
rebase the building-entry test spheres into the candidate owner's coordinates,
and also rebase the accepted indoor frame to keep coordinates coherent. These
are runtime diagnostic hooks. This reproduces our client’s early coordinate
conversion while keeping the rest of the transition implementation fixed.

| Travel per transition | Castle cases ending outdoors, reference mode | Castle cases ending outdoors, intervention |
| --- | ---: | ---: |
| 0.03 m | 12 / 12 | 0 / 12 |
| 0.133331 m | 12 / 12 | 0 / 12 |
| 0.4 m | 12 / 12 | 0 / 12 |
| 0.6 m | 8 / 12 | 0 / 12 |
| 0.8 m | 8 / 12 | 0 / 12 |
| 1.2 m | 4 / 12 | 0 / 12 |
| 2.0 m | 4 / 12 | 0 / 12 |

The intervention changes 60 castle cell sequences. All 42 same-owner control
sequences remain identical, crossing directly into the opposite interior in both
modes. Total successful execution is 252 runs / 1,008 transitions across the two
modes. This isolates the coordinate/frame semantics as a cause of the missing
outdoor stage in the tested cases, rather than relying only on correlation with
ACE's exception list.

Artifacts:

- `/tmp/h3d-retail-transition/Program.cs`, `Probe.csproj`: diagnostic source.
- `/tmp/h3d-transition-ace-build.txt`, `/tmp/h3d-retail-transition/build.txt`:
  successful builds with zero warnings/errors.
- `/tmp/h3d-retail-transition/retail-aligned-matrix.jsonl`: final reference trace.
- `/tmp/h3d-retail-transition/owner-aware-matrix.jsonl`: controlled intervention.
- `/tmp/h3d-retail-transition/comparison-summary.json`: counts and changed cases.
- Both final diagnostic stderr files are empty.

For reproduction, build the ACE project with `dotnet build --no-restore
-p:Platform=x64 -m:1 -p:MSBuildEnableWorkloadResolver=false`, then build the probe
with `dotnet build --no-restore -p:DisableTransitiveFrameworkReferenceDownloads=true`.
`DOTNET_CLI_HOME=/tmp/h3d-dotnet-home` and telemetry opt-out keep first-run writes
inside the diagnostic directory. Run the probe DLL once normally and once with
`--owner-aware`. The first local restore used cached framework assets with
`--ignore-failed-sources -p:NuGetAudit=false
-p:DisableTransitiveFrameworkReferenceDownloads=true`; no package version was
invented or server installation modified.

### M9. Publication and server processing boundary

Retail `ShouldSendPositionEvent` (`acclient.c:682586–682608`) requests a report when
the committed cell differs from the last sent cell. `SendPositionEvent`
(`:682671–682707`) packages the current physics pose. For the walking trace, that
makes the completed outdoor pose eligible before the next indoor pose. This is a
source-supported publication consequence, not a captured retail datagram trace.
The ACE port's corresponding methods are stubs and were not used as a network
oracle.

Our core already triggers `PositionPublicationReason::Cell` on accepted cell changes
(`position_publication.rs:149`). Runtime invokes publication after simulation
(`client/runtime.rs:406`), and the autonomous-position builder captures the current
accepted pose. Session `send_message` serializes each action into a fragment and
calls `send_packet`; the latter submits it through `send_raw_packet`. There is no
routine publication mechanism that emits every interior solver substep.

ACE drains inbound actions before world updates (`WorldManager.cs:363–376`), runs
world physics at a configured 60 Hz rate limit (`:313`), and consumes one
`RequestedLocation` (`Player_Tick.cs:303`). These facts explain why a separately
published outdoor tick can avoid the indoor-cross-owner pre-validation rejection
under normal separate arrivals. They do not guarantee that two packets processed
in one server interval will preserve both requested poses. Sending a fabricated
outdoor report immediately before an indoor report remains unjustified.

### M10. Confirmed client divergence; remaining compatibility gap

The missing outdoor stage at short travel distances is now supported by source,
full-transition execution, same-owner controls, and a controlled intervention.
The correction's owning layer is shared world spatial transition semantics:
preserve the current query frame and retail's cell/frame commit order, then let
existing core publication report the accepted result. Renderer junction groups
remain unrelated to server publication permission.

This is more than deleting the coincident helper or adding a one-tick flag.
Current `infer_placement_from_cell` intentionally refuses containment-only entry
when seeded outdoors, and motion paths use one anchor across their retained
boundaries. A correction must handle the subsequent legitimate outdoor-to-indoor
entry and preserve coherent path sampling, contact support, and coordinate frames.
A blanket neighboring-owner filter would also erase coordinate-alias behavior
without evidence. No such production changes were made.

**The longer-move gap remains real:** the reference itself can choose outdoors on
one collision substep and enter the neighboring interior on a later substep in
the same transition. At 0.6 m with an early crossing, the trace goes from
D5990109 to D6990006 and then D6990121 before its final pose is returned. The
ordinary final-pose publisher has no completed outdoor pose to report in that
case. At a hypothetical 30 Hz client update rate, 0.6 m corresponds to 18 m/s;
this is a distance-to-rate conversion, not a measured retail speed or update rate.
Retail also has variable update quanta (`acclient.c:311146–311210`), so its live
behavior cannot be inferred from a fixed 30 Hz assumption.

This was the investigation boundary before the user's follow-up. The user has
since confirmed: **“retail doesn't desync or freeze in this scenario.”** That
establishes the compatibility target; another retail walking/running check is
not required. The fixed-distance port sweep is not a capture of the complete
retail client's timing or packets and cannot overturn that observation.

At this point in the investigation production movement code was unchanged.
M11–M13 record the subsequently authorized client implementation and its checks.

### M11. Replay through the current production dynamic solver

The earlier grounded probe did not exercise the same dynamic collection path as
the live client. A disposable Rust replay now calls
`SpatialScene::advance_dynamic_entity_collection` with the shared retail human
movement profile and the player's entity-contact policy. It loads production
collision assets for the radius-two region around D599. It uses no server,
account, socket, or interactive client.

The matrix covers both directions of both castle seams, speeds 4, 10.7, and
18 m/s, durations 0.030 s and `MOBILE_CONTACT_TICK_SECONDS` (1/30 s), and boundary
phases 0.05, 0.5, and 0.95. Each of 72 runs settles for four ticks, then drives
for four ticks: 576 ticks total. Core's nominal physics tick is 30 ms, with an
admitted duration cap of 1/30 s; these durations test actual client boundaries.
The current dynamic solver uses continuous sweeps. The older grounded solver's
subdivision must not be assumed to describe it.

Before correction, **all 72 first crossing ticks committed directly to the
neighboring interior**. Paired reference execution at these distances ended
outdoors in 24/24 cases at 4 m/s, 24/24 at 10.7 m/s, and 16/24 at 18 m/s.
The maximum first-step position difference was 0.000019258 m: the meaningful
difference was committed cell and query order, rather than movement geometry.
At 18 m/s, the reference can perform another collision substep before returning;
that port-specific subdivision does not define the current solver's query cadence.

Artifacts:

- `/tmp/h3d-dynamic-seam-transition.txt`: current production solver before correction.
- `/tmp/h3d-retail-transition/client-cadence.jsonl`: paired reference transitions.
- `/tmp/h3d-retail-transition/production-cadence-comparison.json`: paired positions/cells.

### M12. Client correction and ownership

The correction is confined to `holtburger-world/src/spatial/collision.rs`.
That layer owns accepted spatial domains and query frames, shared by the client
frontends. Its existing `PlacedMotionPath` contract already carries the decision.
Core consumes that accepted pose and publishes cell changes without reconstructing
entry permission. Renderer junctions remain a separate geometric decision.

Three related changes preserve the query's entry order:

1. Coincident building entry tests the destination volume using the sphere in
   the **source query owner's coordinates**, transformed through the destination
   cell frame. The predicate uses retail's radius + 0.01 m allowance. Geometric
   candidate discovery still converts between owners correctly. This distinction
   preserves collision reach while preventing premature body entry.
2. A traversed motion endpoint retains the committed domain selected by its path.
   Containment at that endpoint cannot immediately overwrite a completed outdoor
   transition. Existing explicit recovery remains available for an invalid retained cell.
3. A fresh body query seeded outdoors performs initial building containment in
   its current, rebased owner frame. This permits the next ordinary indoor entry
   even when the previous tick moved the center beyond the coincident plane.

There is no added timer, retained transition flag, fabricated position packet,
cell-ID exception list, or ACE change. Zero-radius rays retain geometric
connectivity. Same-owner junctions retain direct interior-to-interior traversal
because their query and destination owner frames coincide.

The coordinate behavior is intentionally marked `RETAIL QUIRK`, with decompile
citations, the consequence of correcting it, and the limited regional census.
This reproduces observable entry semantics without rebuilding retail's mutable
cell-list architecture. It does not claim an archive-wide content census or
byte-for-byte equivalence to the complete retail client.

An initial version applied fresh containment to ray roots as well. The existing
`indoor_crossing_of_a_water_owner_boundary_is_not_an_outdoor_entry` regression
caught that domain change. Fresh body placement is now separate from explicit
ray-root and endpoint placement; the ray regression passes unchanged.

### M13. Verification and remaining live acceptance

After correction the same production dynamic replay gives:

| Observation | Before | After |
| --- | ---: | ---: |
| First driven tick commits outdoors | 0 / 72 | 72 / 72 |
| Next driven tick commits to destination interior | 72 / 72 | 72 / 72 |
| Grounded ticks | 576 / 576 | 576 / 576 |

All recorded physical positions are identical before/after at the diagnostic's
six-decimal output precision. The change is the accepted cell sequence; support
and physical travel remain intact. The existing position-distance helper reports
up to 0.003388 m different travel when cell identity changes, because its
different-cell branch subtracts global `f32` coordinates. That is a derived
measurement difference, not a changed replay position.

Artifacts:

- `/tmp/h3d-dynamic-seam-transition-after.txt`: corrected production replay.
- `/tmp/h3d-dynamic-seam-comparison.json`: before/after counts and positions.
- `/tmp/h3d-transition-regression-before.txt`: new body-order regression fails
  before the correction, selecting the neighbor interior instead of outdoors.

The retained asset-free regression exercises both directions of a bounded,
cross-owner junction: body exit commits outdoors, the next rebased query enters
the destination, and a physical ray can still reach a destination-domain surface.
Existing tests cover ordinary entry/exit, thin interiors, same-owner coincident
entries, ambiguous targets, support, recovery, and water-boundary rays.

Final automated checks:

- `cargo test -p holtburger-world --lib`: **968 passed**.
- `cargo test -p holtburger-core --lib`: **660 passed**. The sandboxed run initially
  passed 654 and failed six at denied local UDP socket binds. Rerunning with local
  socket access passes all tests; it does not log in or connect to ACE.
- `cargo test -p holtburger-3d-host --lib`: **367 passed**.
- `cargo clippy -p holtburger-world -p holtburger-core --all-targets -- -D warnings`:
  passed.
- Formatting checks for world, core, and host, plus `git diff --check`: passed.
- `cargo build -p holtburger-3d-host --bin holtburger-3d-host`: passed. The debug
  sidecar used by the normal development launcher now contains the correction.

Test/build output is retained at `/tmp/h3d-transition-{world-tests,core-tests-unrestricted,
host-tests,clippy,format,host-build}.txt`. The temporary asset-dependent Rust
binary source was copied to `/tmp/h3d-retail-transition/seam_transition_probe.rs`
and removed from the repository. To repeat the asset replay, temporarily copy it
into the harness's `src/bin`, run `cargo run -p holtburger-debug-harness --bin
seam_transition_probe`, then remove that temporary copy. Only the asset-free
regression remains in production source.

Review covered geometric candidate discovery → body entry permission → retained
motion-domain placement, then the existing dynamic-pose commit → core publication
boundary. No new contract fields or retained state were needed. Final production
diff is one world source file, with about 50 added runtime/comment lines and one
120-line bidirectional regression fixture. The entry predicate has a distinct
responsibility from owner-correct geometric containment; merging them would
reintroduce the observed bug. The review does not establish network timing or
live server acceptance.

Live acceptance remains distinct: in the rebuilt client, walk and run through the reported seam
in both directions, then the other castle seam and an ordinary building entry/exit.
Confirm continued movement, normal position confirmations, and no new
`movement pre-validation failed` messages for these crossings. These are checks
of the corrected client; no further retail reproduction is requested.

#### Definition of done: movement correction

- [x] Explain the client/server divergence using source and executed transitions.
- [x] Locate entry permission and committed-domain order in shared world traversal.
- [x] Correct both castle seams in both directions through the production dynamic solver.
- [x] Preserve physical positions and floor support in the measured walking/running matrix.
- [x] Retain asset-free coverage for outdoor staging, subsequent entry, and ray connectivity.
- [x] Complete formatting, world/core/host tests, and Clippy with warnings denied.
- [x] Remove temporary asset-dependent Rust diagnostic from the repository after saving evidence.
- [ ] Verify live corrected-client movement and confirmations against unmodified ACE.
- [ ] Record live acceptance and close this movement follow-up.

### M14. Final code-quality review before commit

**Verdict: ready with bounded follow-up after the fixes below.** The review uses
HEAD as its baseline and includes the accumulated renderer and movement changes,
new source/tests/harness, deleted mechanisms, and current durable documentation.
The user's latest “lgtm” accepts the implementation/design and authorizes this
review and commit; it does not establish a separate live-client movement test.
The existing untracked contents of the ACE and ACViewer submodules are excluded.

Confirmed findings resolved in this pass:

1. **Owner-local selector lookup could commit a foreign cell (required fix).**
   `containing_reached_cell` looked up the low 16 bits of every reached cell in
   one owner's geometry without first checking the cell's owner. That lookup
   predates this diff, but fresh outdoor body placement now consumes its result
   directly. Adjacent owners reusing selector `010A` exposed an incorrect
   `DA55010A` result where `DB55010A` was required. The existing bidirectional
   junction regression now covers distinct and identical selectors; it fails
   before the owner filter. Containment now filters reached IDs by the geometry
   asset's owner before interpreting the selector. This retains one decision at
   the spatial owner without adding state or a fallback path.
2. **Two test producers retained the resolved crossing contract.** SceneGraph
   input fixtures still supplied `junctionGroupId: null`, and an EnvCellSystem
   test double accepted resolved crossings. They now use
   `ScenePortalCrossingInput`; renderer fixtures continue to use the resolved
   type because their consumers require junction permission. This completes the
   producer/consumer cutover without weakening the renderer contract.
3. **Durable docs still assigned junction ownership to the host.** Updated
   `docs/portal_rendering.md` and the app architecture audit to describe HBEC v6,
   revision-local scene IDs, robust clipping, and competing-exit rejection.
   Historical investigation plans remain historical. The stale rule would have
   encouraged reintroducing per-owner IDs and missing cross-owner junctions.

Contract and seam coverage:

| Boundary inspected | Producer guarantee and immediate consumer |
| --- | --- |
| Host HBEC → decoder → materialization/artifact | Version 6 carries authored/effective apertures, reciprocal identity, and island facts; producers no longer provide junction IDs. |
| EnvCellSystem → SceneGraph snapshot | Synchronous replace/remove/restore invalidates topology; one cached revision derives junctions and builds outgoing adjacency from the same resolved crossing objects. Load, eviction, replacement, rollback, reinsertion, and destruction are covered. |
| Snapshot → culler/planner → stream → shader/models | Consumers retain the resolved crossing type and copy its junction permission into arrival metadata. Existing depth, reciprocal, and ambiguity bounds remain intact. Numeric GPU evidence is recorded in E13. |
| Accepted geometric motion → placement → body commit | Candidate geometry uses proper owner conversion; body entry uses retail's source query frame; endpoint commitment and next-query containment remain distinct. Full owner IDs survive containment even when selectors match. |
| Dynamic collection → core publisher → session | Accepted membership places/reanchors the root before ordinary cell-change publication. Coverage/invalid-placement handling and authority/reset paths keep their existing owners; no transition queue or parallel publication state was added. |

The consolidation pass deliberately keeps render junction proof, physical
geometry reach, and body-entry permission separate: their guarantees and
consumers differ. The host's remaining overlap predicate serves offline geometry
diagnostics, not production junction assignment. The scene cutover removes the
host resolver, owner-qualified ID packing, and redundant mutation-time outgoing
index. The body's entry predicate adds no lifetime or invalidation work. Loading
or evicting the neighboring owner therefore changes one scene revision; resetting
movement continues to use existing body and publication epochs.

Review limits: no archive-wide content claim, independent visual acceptance, or
live network-timing verdict is implied. The remaining live movement DoD above
stays open. No broader architecture refactor is required for this correction.

Final validation after the owner-selector fix:

- World: 968 tests pass; core: 660 pass; host: 367 pass. The core/host run used
  local socket access for the existing UDP unit fixtures.
- Frontend: 3,073 tests pass across 362 files. The two changed producer-test
  files also pass their focused rerun, and the complete type check passes again.
- ESLint, Knip, and host Clippy pass. A final combined world/core/host
  `--all-targets` Clippy run also passes with `-D warnings`.
- All changed frontend files pass Prettier; world/core/host Rust formatting passes.
- The debug h3d host rebuild passes after the ownership correction.
- The refreshed production replay retains outdoor → indoor in 72/72 cases,
  with all 576 ticks grounded. Its text output is identical to the prior corrected
  replay. Evidence: `/tmp/h3d-review-dynamic-seam-transition.txt` and
  `/tmp/h3d-review-dynamic-seam-summary.json`.
- The expanded selector-alias regression fails before the filter at
  `/tmp/h3d-review-owner-selector-before.txt`; the final world suite includes its
  passing result. The disposable Rust replay source is removed again.

The full app formatter reports one pre-existing
failure in `src/harness/browser/client-precise-jump-probe.ts`; that file is
identical to HEAD and is excluded from the diff. Formatting of every changed
frontend file is checked separately.
