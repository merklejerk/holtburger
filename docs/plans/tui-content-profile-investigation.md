# TUI content profile investigation

Updated: 2026-10-27

Remaining end-to-end implementation is tracked in the [CLI navigation and split alpha release plan](cli-navigation-and-split-alpha-release-plan.md). This document remains the evidence log.

Status: production codec, generator, and prepared scene adapter are implemented. The complete generated content is 31,237,537 bytes including bootstrap and metadata. Production loading passes doorway and slide probes; TUI runtime integration is pending. Representative paced ACE replays reached the destination correctly; the earlier one-shot failure does not require a movement-policy change.

## Objective and size guidance

Provide compact distributable CLI content supporting the agreed reduced TUI movement behavior without bundling full retail content. **64 MB is a rough size target, not an acceptance gate.** Do not add CI size enforcement or pursue additional compression solely to cross a threshold. Report complete content size, including bootstrap data and all metadata, so growth is visible.

New derived formats, grouping, and deduplication are acceptable where their benefits justify their implementation and maintenance costs. User-supplied full content remains a fallback; the current TUI loader accepts full HBAs, not raw retail DATs. Direct DAT support would be a separate change.

## Distribution pivot: separate CLI and 3D bundles

The user explicitly changed the intended distribution from a combined alpha suite to **distinct CLI and 3D downloads**. TUI must no longer ride inside the h3d package. This section defines future scope; current release scripts, Flatpak manifests, and draft assets still describe/contain the combined suite.

| Contents | CLI bundle | 3D bundle |
| --- | --- | --- |
| Terminal client | Include | Exclude |
| h3d client and Explorer | Exclude | Include, sharing the existing app/runtime |
| Electron, private host, renderer/resources | Exclude | Include required app dependencies |
| Compact navigation/bootstrap content | Include once production integration works | Exclude; h3d uses user-supplied full content |
| `fighter` / `mage` scripts and required sidecars | Include for the current TUI scripting consumer | Exclude; these are not h3d's internal physics-script content |
| `dat2hba` and `dat-tool` | Keep the previously approved utilities here | Exclude; h3d directly supports retail DATs and full HBA input |
| Identity, license/notices, launch/content instructions | Include | Include |

The utility placement preserves their existing approved shipping scope while avoiding duplicates in the 3D download. Do not add a third tools distribution solely for this split. The new navigation generator is build/maintenance tooling; it need not become a shipped executable just because it generates bundled data.

Packaging consequences:

- Native targets stay Linux x86-64, Windows x86-64, and Apple Silicon macOS. The split changes artifact inventory, not the platform matrix.
- Produce independently downloadable CLI and 3D native packages. CLI packaging must not depend on assembling Electron/h3d resources.
- Preserve the CLI Flatpak. Replace the combined-suite Flatpak's contents with a 3D-only package; do not retain an additional combined suite. The 3D Flatpak retains the existing alpha app ID and settings; download names become product-specific.
- Retain one release workflow and shared version/source/checksum conventions. Build shared Rust outputs once per target where practical; assemble the two products separately. Shared tests remain Linux-only; the split must not duplicate the full validation suite.
- A 3D package must not download or package TUI micro/navigation content. CLI packaging must not download/build the Electron runtime as its own prerequisite.
- Package locally generated, pinned approved CLI content; do not regenerate derived retail content in CI.
- Use bundle-specific inventories and launch checks so missing required files and accidental inclusion of the other frontend are caught cheaply.
- Use consumer-appropriate checked-in notices. Sharing an existing notice file initially is acceptable; avoid a new notice-generation project just to minimize bytes.
- Update release manifest expectations, checksums, quickstarts, and content instructions when the packaging cutover is implemented. Do not rewrite current-artifact documentation as though the split has already shipped.

The new CLI content format and movement policy are still experimental. Until integrated, a CLI build needs explicit full-HBA setup; separating packages does not make the existing incomplete micro playable.

## Agreed movement behavior

Think of rooms and landscape as empty: retain room physics shells and cell topology; omit furniture, scenery, and entity-to-entity collision obstacles.

| Concern | Local character | Predicted remote entities |
| --- | --- | --- |
| Movement acceptance | Resolve a valid destination cell and position before reporting to the server | Constrain predicted travel against room shells and traverse passable portal openings |
| Intermediate cell path | Not required initially; A → C can skip an intervening B | Follow valid cell transitions along accepted travel |
| Wall response | Do not impose the remote path constraint on local travel | Reuse existing sweep/slide response where practical |
| Server corrections / teleports | Authoritative placements, not ordinary traversed paths | Authoritative placements, not ordinary traversed paths |
| Object obstacles | Omit | Omit |

An accepted cell change must retain the existing cell-change publication trigger: report the newest committed cell at the next publication opportunity, not only on a heartbeat. No report is manufactured for an intermediate cell that never became a committed sample.

These are intentionally different local and remote policies. They should share geometry, motion inputs, authoritative state, and reconciliation rather than duplicate the world model. h3d must retain its existing complete physical behavior.

Subsequently accepted: local movement may interpolate full destination X/Y/Z; local gravity, jumping, falling, and stair handling are deferred. For known geometry, local interpolation continues through invalid-cell candidate samples while committed/reported position remains at the last valid point; a later valid candidate is committed directly. This is intent progress, not a parallel world pose, and does not treat unavailable geometry as open space. Remote envelope size, overlap/owner-transition handling, and coverage failures still need precise contracts. Exterior building model obstacles are omitted initially while transition metadata is retained. The probe's 0.2 m sphere is not a finalized runtime policy. Server acceptance of the proposed local shortcuts has not been empirically verified. The 3D Flatpak keeps the existing alpha app ID; an intermediate proposal for a new ID was withdrawn.

## Why this investigation started

The installed alpha Flatpak's TUI failed character creation with missing resource `eor/portal:0x10000009`. Its micro HBA matched the regenerated release artifact; this was an incomplete profile, not a stale installation.

The release bootstrap probe parsed startup tables but did not call the complete character-creation catalog loader. Full content loads that catalog successfully; micro does not. The creation catalog references 35 clothing tables:

- Those 35 records occupy 15,213 bytes compressed, including HBA index entries.
- The entire 1,917-record clothing family occupies 472,967 bytes, including index entries.

The wider survey found that the current TUI registers `ContentClientCollisionSource` and uses the same core physical movement path as h3d client mode. World activation also waits for physical-body and destination collision readiness. This coupling predates the release work; it entered with `da7f5e384` ("Implement 3D client mode"). Simply removing collision-source registration would not restore a working lightweight TUI.

Current micro omits region/cell/collision content and strips animation part transforms that the current physical runtime consumes. Fixing clothing alone does not make that runtime's full data requirements available.

Remote pose-only dead reckoning remains an active code path for qualifying entities. It is not a separate lightweight local-player movement mode. Both apps currently inherit shared per-entity physical-demand decisions.

## Architectural findings

- **Content layer:** `LandblockInteriorSystemAssembler` owns parsed cells, Environments, and portal links. `CellVolume` retains placement, containment planes, and enriched portals. Repeated cell placements can share Environment structures.
- **Geometry distinction:** containment uses the cell BSP; room contacts use the physics BSP. A visible portal is not necessarily physically passable. Room-shell barriers are appropriate for the agreed empty-room behavior.
- **World layer:** existing contact movement supports free movement and sliding without grounded walking. `transit_motion_path` annotates an accepted path with transitions; it does not itself solve wall contacts. Containment recovery already searches cells independently of the traversed path, but its primitive would need an ordinary-query contract before use for local destinations.
- **Core layer:** world activation and physical preparation currently impose broader content demand. Future TUI integration must select the reduced behavior explicitly, without treating missing physical assets as an implicit fallback.
- **App layer:** TUI would select its movement policy; h3d retains its complete physical policy and scene.

## Work completed

### Initial solver experiment

Added [`room_shell_probe.rs`](../../crates/holtburger-world/examples/room_shell_probe.rs), an explicitly invoked real-content diagnostic, not an automated asset-dependent test.

The initial experiment assembled complete collision content and filtered out every collider except `EnvCellShell`. It demonstrated that the existing solver could traverse a doorway and slide against a wall with a simple sphere and no peer collision targets, gravity, animations, or scripts. This first experiment did **not** prove reduced archive loading.

### Separate room-shell assembly

Added `LandblockRoomShellAssembler` in [`object_collision.rs`](../../crates/holtburger-content/src/object_collision.rs). It assembles room physics shells and cell volumes from the parsed interior's owned Environment records, without repository/model access.

Complete assembly reuses this step and adds indoor objects, preserving the original per-cell shell-then-object ordering. Outdoor complete assembly remains on its existing path. No TUI/h3d runtime selection or release assets have changed.

The probe now uses this assembler directly; it no longer loads object geometry and filters it afterward.

### Model-free archive experiment

Temporary fixture: `/tmp/holtburger-room-shell-fixture.hba`.

Its inclusion rules are:

- `eor/cell`: all records owned by landblock `0x8602FFFF`.
- `eor/portal`: all 772 Environment records (`0x0D`) plus region `0x13000000`.
- Nothing else.

Records were copied intact through the production HBA writer with compression. **There is no field-level pruning or deduplication in this fixture.** Environment records are worldwide; cell records cover one landblock. The fixture has no object models, setups, animations, motion tables, scenery Scene records, or physics scripts.

| Fixture component | Records | Compressed bytes plus 60-byte HBA index entries |
| --- | ---: | ---: |
| Environments | 772 | 2,181,249 |
| Indoor cells | 568 | 173,243 |
| CellLandblock | 1 | 87 |
| LandblockInfo | 1 | 76 |
| Region | 1 | 6,483 |
| Header / namespace metadata | — | 108 |
| **Total** | **1,343** | **2,361,246** |

None of these records overlap the current 2,762,679-byte micro baseline. Their combined size would be approximately 4.89 MiB. This is not a worldwide profile estimate and does not yet include the clothing fix.

Observed probe results:

- 568 cells and 568 room shells load from the model-free archive.
- Doorway `86020100 → 86020101`: accepted movement from `(150, -234.4, -9)` to `(150, -235.6, -9)` and committed the destination cell.
- Wall slide in `86020100`, physics polygon 0: requested 2 m toward a wall plus 1 m tangent; accepted approximately 0.8002 m toward the wall, leaving the 0.2 m sphere clearance, while retaining the full 1 m tangent travel.
- Negative control: complete assembly rejects the same archive because setup `eor/portal:0x02000BD4` is missing.
- Complete assembly on full content retains the original 948 colliders, including 568 matching room shells and their polygon geometry; per-cell shell/object ordering was checked.
- 14 object-collision tests and 3 interior tests passed. Warnings-denied Clippy and formatting passed for the affected code/probe.

Run the retained probe with:

```sh
cargo run --offline -p holtburger-world --example room_shell_probe -- /tmp/holtburger-room-shell-fixture.hba
```

The temporary HBA and fixture-generation/comparison helpers under `/tmp` are local evidence, not checked-in assets. The probe also accepts a full HBA. These checks establish two sampled indoor behaviors, not worldwide correctness, exterior transitions, runtime integration, or server acceptance.

## Worldwide size evidence

Measured from local full `dats/assets.hba`:

- 734,976 indoor cell records across **3,409 landblock owners**.
- Their current outer HBA index entries alone occupy **44,098,560 bytes** (about 42.06 MiB).
- One outer entry per indoor-cell owner would occupy **204,540 bytes**. This excludes all internal cell lookup metadata and other record families.
- All current cell-namespace records together occupy 217,615,501 bytes compressed plus index (about 207.53 MiB).
- A broad cell/physics-family selection using existing full record sizes occupies about 294.86 MiB. This is a census baseline, not a stripped-profile prediction.

The per-record index overhead is a material obstacle to the 64 MB target. Grouping may also improve compression compared with independently compressed cell records.

Potential payload savings, not yet measured:

- Remove object placements, visibility-only lists, and visual references from cell data.
- Remove drawing data from Environments while preserving room contact geometry, containment, and portals.
- Preserve existing shared Environment geometry rather than duplicating shells into each placed cell.
- Detect additional repeated geometry or record structures before choosing a deduplication scheme.

Existing-format pruning is suitable only when flags/counts and empty optional fields honestly represent the retained record. Derived grouped records should have an explicit format and decoder; existing readers must not guess which mandatory fields are absent.

## Original size investigation scope

Compare measured complete-HBA sizes for:

1. Format-preserving pruning of existing records.
2. Grouped cell records, with a per-landblock internal lookup.
3. Grouped records with shared geometry and any additional deduplication justified by the census.

Include bootstrap/creation data, all required world coverage, indexes, internal references, and archive metadata. Keep serialized size separate from decoded memory/runtime loading costs. Count existing Environment sharing once; do not claim it as a new saving.

Choose a layout using measured size, loading cost, and implementation complexity; 64 MB is guidance rather than a gate. Runtime integration, worldwide behavior checks, and release regeneration follow that decision; they are not part of the completed probe work.


## Worldwide size experiment results

The temporary experiment produced actual HBA files, not estimates. It used the current micro baseline, **all** clothing tables, all worldwide cell-namespace records, all 772 intact shared Environments, and the region record. Object models, scenery Scene records, and physics scripts were not added. Existing micro motion/setup records remain included in the baseline. No extra geometry deduplication or Environment stripping was necessary.

| Layout | Complete HBA bytes | MiB | Under 64,000,000 bytes? |
| --- | ---: | ---: | --- |
| Individually indexed, pruned indoor cells | 110,207,300 | 105.10 | No |
| Cells grouped by owner, otherwise intact | 105,269,359 | 100.39 | No |
| **Pruned cells grouped by owner** | **32,671,417** | **31.16** | **Yes** |

Both pruning and grouping matter. The third layout has **31,328,583 bytes of headroom** under the stricter decimal limit. This establishes a feasible data budget for the selected content contract, not a finished shipping profile or proof of all runtime requirements.

### What was retained and stripped

Indoor cells retain their original identity, flags except `HasStaticObjs`, authored cell ID, Environment/structure selectors, full placement frame, all portal flags/polygon IDs/endpoints, and restriction-object reference when present. Surface references, visibility lists, and static-object placements are emptied. The existing EnvCell binary layout is preserved, with counts and flags adjusted honestly.

All 734,976 indoor cells were processed. Their uncompressed payload fell from 191,593,266 to 50,635,504 bytes. Other selected record families were copied intact; the experiment did not aggressively optimize outdoor metadata or Environment records.

### Experimental grouping layout

The HBA v2 outer container is unchanged. One experimental `investigation/cell-groups` entry per indoor-cell owner contains:

- Four-byte `TCG0` magic, little-endian u32 version 1, and u32 cell count.
- A selector-sorted lookup table of `(u16 cell selector, u32 byte offset, u32 length)`.
- Concatenated ordinary EnvCell record bytes.

There are 3,409 groups. Internal headers and lookup tables total **7,390,668 uncompressed bytes** and are compressed inside their group. There is still a 60-byte outer HBA index entry per group; this is included in the measured totals. Group compression uses Zstd level 3, retaining raw bytes when compression would increase size, matching the production writer's compression policy. A final production namespace/type and version contract remain undecided.

This layout preserves shared Environment references rather than copying geometry into each cell. Group compression exploits repeated bytes across cells without adding a separate template/dictionary format.

### Winning archive breakdown

| Component | Stored bytes including outer index entries |
| --- | ---: |
| Existing micro baseline | 2,762,571 |
| All clothing tables | 472,967 |
| All outdoor landblock/info and other non-indoor cell records | 10,990,949 |
| All intact shared Environments | 2,181,249 |
| Region | 6,483 |
| Grouped pruned indoor cells, including internal lookup tables | 16,257,010 |
| HBA header / namespace metadata | 188 |
| **Total** | **32,671,417** |

The baseline row excludes its standalone header/namespace metadata, which is replaced by the combined archive's metadata. No accounting component is omitted from the total.

### Evidence and reproducibility

Temporary experiment script: `/tmp/holtburger-tui-size-experiment.py`.

Temporary results and archives: `/tmp/holtburger-tui-size-experiment/`:

- `results.json`: per-layout counts, sizes, component breakdowns, and SHA-256 digests.
- `individual-pruned.hba`, `grouped-intact.hba`, `grouped-pruned.hba`.
- `grouped-pruned-probe-expanded.hba`: one decoded group's ordinary EnvCell entries plus shared records, used with the existing probe.

Source full HBA SHA-256: `20fa252ad80b4daf314fd098d1f48a386ce6a8f326b4007f3f33561c38be75b7`.

Baseline micro HBA SHA-256: `70eaf7637e0fca5e1b9f9c442dc4609035da58937e3e96c3cb3bad38529f8251`.

Winning archive SHA-256: `dcffa79f1418fe2e42376635f481ae9eb29bd95ef0b2b9b9cd2f2d10cc4707f1`.

The Python experiment reopened both grouped archives and compared all 734,976 decoded cells byte-for-byte against their intact or pruned source representation. A separate temporary Rust verifier (`/tmp/holtburger-tui-group-verify.rs`) then opened the winning archive through the production HBA reader, decoded every grouped cell with the production EnvCell decoder, and checked every retained field and portal against full source content. All 734,976 cells across 3,409 groups passed; stripped fields were empty and every record was consumed exactly. The grouped-pruned archive's `0x8602FFFF` group was then expanded into ordinary cell records, and the existing Rust movement probe again passed doorway `86020100 → 86020101` and the wall-slide check. This validates the decoded geometry path; the application repository does not yet resolve grouped cells directly. The character-creation catalog also loads successfully from the combined candidate (13 heritages, 26 genders, 35 referenced clothing tables), and the active region loads successfully.

### Remaining work after sizing

- Choose between the grouped HBA and standalone prepared-navigation prototype below, then implement production lookup/enumeration, including archived-cell discovery.
- Validate the chosen format's decoded memory and largest-group loading costs; compressed size alone does not establish runtime suitability.
- Select and integrate the reduced TUI movement/activation behavior, including the distinct local and remote policies.
- Resolve the outstanding concessions recorded above and verify server interaction separately.
- Run broader representative geometry checks before treating the candidate as release content.

Do not add a separate geometry deduplication format merely to reduce size further: the measured grouped/pruned layout already clears the budget substantially. Production readiness, not further compression, is now the next decision.


## Standalone prepared-navigation experiment

The user authorized investigating a format tailored to TUI needs rather than requiring HBA/DAT storage. All implementation for this comparison is temporary under `/tmp/holtburger-nav-experiment/`; no production loader, TUI runtime, h3d behavior, or release asset was changed.

### Representation and scope

The prototype file, `navigation.tnav`, stores world navigation in prepared form:

- **734,976 cell instances in 3,409 owner chunks:** parsed placement, identity/flags, shared-template reference, portal connections/flags, and restriction reference. No retail EnvCell parser runs on the read path.
- **3,145 referenced shared room structures in 769 Environment chunks:** prepared containment planes, physics BSPs and bounds, resolved physics polygons with normals, and resolved portal planes/apertures. These products are generated through `LandblockRoomShellAssembler`, rather than reimplementing polygon projection. Unreferenced Environment structures are not included.
- **65,025 terrain chunks:** resolved height samples, terrain samples, triangulation choices, scene classification, and parsed building-transition/restriction metadata. There is no retail terrain/region decoding for these navigation products. Object placements are excluded; exterior building model geometry is still outside the chosen scope.
- **Unchanged bootstrap content:** baseline game tables, clothing, region, and the small non-navigation cell metadata record remain in an embedded HBA section, using existing readers. This isolates the navigation-format comparison; it is not an experiment in replacing every bootstrap serializer.

No geometry quantization or coordinate precision reduction was introduced. Existing Environment sharing is preserved; no separate content-hash geometry deduplication or dictionary scheme was needed.

The experimental container has a 32-byte header (`TNAVEXP1`, block count, directory offset, padding) and a sorted directory of 28-byte entries `(kind, ID, offset, raw length, stored length, compression flags)`. Chunks use Zstd level 3 only when smaller than raw. Directory lookup is binary search; cell chunks have a selector/offset/length table. Shared geometry and terrain are serialized typed products using MessagePack (`rmp-serde`), not retail record byte layouts. Reconstructing the existing runtime types still allocates trees/maps; this is not a zero-copy/memory-mapped implementation.

### Complete file size

| Component | Bytes, including directory entries |
| --- | ---: |
| Existing bootstrap section | 3,242,269 |
| Parsed cell-instance chunks | 14,206,727 |
| Prepared shared room structures | 1,531,427 |
| Prepared terrain/building-transition metadata | 11,200,351 |
| Container header | 32 |
| **Complete standalone prototype** | **30,180,806** |

This is **30.18 MB / 28.78 MiB**, compared with **32.67 MB / 31.16 MiB** for the grouped/pruned HBA. Both clear the 64,000,000-byte limit. The standalone prototype is 2,490,611 bytes smaller (about 7.6%); its more significant potential benefit is reduced content preparation.

Prototype SHA-256: `557d7e1a222f79c162ff3cff9d95e825b6acb0f3b41b28a4c07d1b0541420b07`.

### Loading and memory measurements

Measured fresh-reader room-geometry preparation in **unoptimized debug builds**, with warm filesystem caches and allocation accounting enabled. The operation opens the store, loads the selected owner's cells/shared room data, and produces `LandblockColliders`; it excludes network activity, simulation ticks, rendering, and terrain collision assembly. The existing-content comparison uses the expanded grouped-HBA adapter, so its measurements exclude the extra group-expansion step. These are feasibility measurements, not release-performance or cold-disk claims.

| Fixture | Path | Samples | Median preparation | Peak live allocated bytes | Retained scene bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| `8602FFFF`, 568 cells | Existing content projection | 15 | 443.72 ms | 19,984,677 | 1,050,618 |
| `8602FFFF`, 568 cells | Standalone prepared data | 15 | 30.62 ms | 4,152,240 | 971,030 |
| `00D1FFFF`, 4,213 cells | Existing content projection | 3 | 1,442.47 ms | 20,921,546 | 5,489,556 |
| `00D1FFFF`, 4,213 cells | Standalone prepared data | 3 | 35.64 ms | 7,786,728 | 4,950,872 |

Peak/live figures count Rust heap allocations during the operation, not process RSS, page cache, or GPU memory. The steady-scene comparison excludes visibility-only reciprocal aperture intersections and outdoor static shadow registration from the standalone path; those have no consumers in the selected reduced mode. Physical shell geometry, containment, portal planes/apertures, and movement endpoints are compared separately.

Chunk distribution provides no current reason to introduce a more complex paging scheme:

- Indoor cells per owner: median 74; 95th percentile 831; maximum 4,213.
- Native cell chunk, uncompressed: median 5,516 bytes; 95th percentile 63,356 bytes; maximum 314,324 bytes.
- Prepared Environment chunk, uncompressed: median 4,035 bytes; 95th percentile 26,452 bytes; maximum 93,201 bytes.

### Validation

- Every one of the **734,976 native cell instances** restores exactly to the previously validated pruned source record, including all retained flags, placement values, restriction references, and portal data.
- Every stored native block was read back. All **3,145 shared structures** roundtrip their prepared physics geometry through the runtime representation exactly; all **65,025 terrain blocks** roundtrip their typed values exactly.
- Native movement geometry equals the existing production projection for both **568-cell** `8602FFFF` and **4,213-cell** `00D1FFFF`. Canonical comparisons include cell placements, containment planes, portal planes/apertures/sides/endpoints, and complete physics BSPs, bounds, and polygon geometry. Visibility-only aperture intersections and outdoor static shadow registration are explicitly excluded.
- The existing doorway and sliding checks pass **directly from the native file**, without expanding it into an HBA or invoking retail navigation-record decoders.

The prototype reader is diagnostic code, not a production-safe format implementation. It does not establish malformed-input behavior, release-build speed, cold-storage performance, server acceptance, local locomotion semantics, or worldwide movement correctness. Its findings justify choosing a production design; they do not finish integration.

### Evidence and next decision

Temporary source/tooling under `/tmp/holtburger-nav-experiment/`:

- `prepare.py`: derive compact native cell instances and enumerate referenced shared geometry.
- `nav.rs` and `Cargo.toml`: export prepared products, read the native container, compare geometry, and measure allocation/time costs.
- `pack.py`: package the complete standalone file.
- `verify_cells.py`: compare all cell instances with the validated grouped/pruned candidate.
- `movement.rs`: reuse the existing movement probe with native scene loading.
- `results.json`: combined size, benchmark, and validation results.

The next design should favor the standalone prepared-navigation path if this reduced TUI mode proceeds: it fits the size limit with less source-record decoding and lower measured preparation overhead. Keep the bootstrap representation unchanged initially, preserve one shared runtime geometry model, and avoid additional chunking/deduplication without evidence. A production design still needs explicit versioning and lookup/enumeration contracts, the previously agreed local/remote policies, and release-build validation before replacing the runtime content path.

## Production codec and generator milestone

The new `cli-content` maintenance command emits an adjacent `bootstrap.hba`, `navigation.hnav`, and `content-info.json`, plus a deterministic approved-input ZIP. Generation uses existing production content projections; runtime navigation decoding uses the new typed payloads and existing in-memory geometry types. It does not decode retail cell/Environment records or resolve models.

Worldwide generation from source SHA-256 `20fa252ad80b4daf314fd098d1f48a386ce6a8f326b4007f3f33561c38be75b7` retained all 734,976 cells, 65,025 terrain owners, and 3,145 shared structures. Component sizes are 3,255,862 bytes bootstrap, 27,981,202 bytes navigation, and 473 bytes metadata (31,237,537 total). The bootstrap includes all clothing and intact setup facts; animation part transforms are stripped with the existing simulation-facts projection.

Two generations from the fixed 568-cell model-free fixture were byte-identical, including ZIP metadata. The worldwide source was generated once. The prepared pair passes creation/motion catalog loading and inspection. The room-shell probe loads the production pair and passes doorway `0100 → 0101` and wall sliding in owner `8602FFFF`. These results establish storage-to-solver integration, not the reduced TUI runtime or server acceptance. Recorded identities and verification are in [Phase 1 evidence](evidence/cli-navigation-phase1.json).

Reproduction (new output directory required):

```sh
cargo run --offline -p holtburger-tools --bin cli-content -- generate --source dats/assets.hba --output /tmp/cli-content-output
cargo run --offline -p holtburger-tools --bin cli-content -- info --content /tmp/cli-content-output/content
cargo run --offline -p holtburger-world --example room_shell_probe -- /tmp/cli-content-output/content
```

No existing release pin, package, draft asset, TUI movement path, or h3d runtime has been switched by this milestone. The remaining work follows the active end-to-end plan.

## Live ACE movement verification: important endpoint-only limitation

With the user's dev credentials and test character, a temporary noninteractive probe used the actual session/protocol stack against `127.0.0.1:9000`. It ran no TUI or client physical simulation. ACE's `@myloc` returned both gameplay `Location` and physics `Position` after requests.

Direct `EC0E0103 → EC0E0106` (skipping `0105`), another `0107 → 0109` shortcut, sampled authored portal crossings, and adjacent outdoor-owner transitions passed. However, a subsequent roughly 20 m move from `0107` to valid destination `010B` produced gameplay location `010B` while physics retained `0109`. Larger diagnostic setup moves also exposed this discrepancy. An authoritative `@teleloc` restored the original cell in both representations. The character was logged out/disconnected afterward.

The source explains a path for this: server `change_cell` calls `change_cell_server`; `enter_cell_server` writes `RequestPos.ObjCellID`. Legacy `UpdateObjectInternalServer` can trigger that during collision processing before `update_object_server` forces `RequestPos`. `Player.UpdatePlayerPosition` subsequently assigns the originally requested gameplay location separately. The earlier extracted C# fixture stubbed cell entry and missed this mutation. The running server's exact build/FastTick configuration was not identified; these results are not a statement that every ACE mode behaves identically.

This initially prompted a product-review escalation, but the diagnostic sent each endpoint in one report and did not implement the agreed interpolation/cell-change publication. That escalation was premature. Preserve the one-shot finding as a limitation; use the paced follow-up below to assess the proposed runtime behavior. Do not silently add portal traversal, full collision, or server changes as a workaround. [Sanitized live evidence](evidence/cli-navigation-live-ace.json) records the requests and both observations, including the successful restore. No credentials or account/character names are included.

### Representative interpolated follow-up

Replayed the same 20.206 m `EC0E0107 → EC0E010B` movement with 102 candidate samples, at most 0.2 m per admitted 50 ms step (nominal 4 m/s; observation pauses make wall-clock travel slower). Each sample resolved containment, preferring the retained cell, destination, then another containing cell; the outdoor-capable owner permits an outdoor fallback outside all room volumes. The resulting committed sequence was `0107 → 0108 → 0109 → outdoors 0033 → 010B`, with zero invalid-cell samples.

Sending every sample reached the destination with matching gameplay/physics coordinates and cell IDs at all 15 checkpoints. A second replay using the existing publisher's cell-change, 2 m accumulated-travel, and one-second thresholds sent 13 position reports and also reached the destination with matching cells and coordinates. All gameplay checkpoint cells and all gameplay/physics checkpoint coordinates matched requests. One intermediate physics cell differed near the Z=20 boundary: gameplay `0107`, physics `0108` at root Z=19.59935. ACE `ObjCell.find_cell_list` selects physics residency by `sphere[0].Center`, transformed by `SpherePath.CacheGlobalSphere`, so equality with a root-point containment selector is not a universal invariant. That difference is consistent with sphere-center residency, though the exact setup sphere was not captured for this probe.

**Keep the agreed interpolated movement policy.** The one-shot failure did not demonstrate a failure of that policy. Remaining work includes invalid-cell-gap and forced-correction fixtures; these replays did not cover them. The probe reconstructed the current publication thresholds from source and did not run the actual TUI controller or simulate support-change triggers. Both runs restored the exact original pose, logged off, and disconnected. [Paced evidence](evidence/cli-navigation-interpolated-ace.json) retains parameters and observations.

## Runtime integration foundation

`NavigationContent::open` now binds the exact indexed bootstrap to either the generated navigation reader or an on-demand HBA room-shell projection. A directory requires both generated companions; an explicit HBA selects that file alone. Missing companions and mismatched pair generations are errors rather than discovery fallbacks. Both sources pass the explicit 568-cell probe, including complete creation-catalog loading (13 heritages), doorway traversal, endpoint containment, and wall sliding; the HBA fixture contains no model resources.

TUI bootstrap now loads `CharacterGenCatalog` once and passes the parsed Arc through bootstrap outcomes and AppState. Selection reconstruction consumes that catalog; the UI no longer retains a raw repository solely for creation. The public TUI source selection/policy has not yet cut over, so this does not make the generated pair playable by the current TUI runtime.

Core scene demand now depends on player identity and placement rather than Setup/WCID body facts. Geometry can load and remain resident before those facts arrive. Physical body preparation and readiness remain separate; selected existing physical/coordinator regressions pass.

The world layer's new `CollisionScene::point_placement` query returns unique placement, sorted overlap choices, known outside space, or unavailable coverage. It reuses existing cell planes and preserves authored indoor frames with negative coordinates. It does not select local movement preference or change the physical sweep solver. Intent progress through known gaps, waits for missing geometry, and lifecycle reset wiring remain the next runtime work.

### Remove position-changing settlement

The only production caller of the controller's optional settlement pose was TUI navigation. It copied a target cell/Z onto the actor's current X/Y and core applied that pose before ordinary simulation. Removed this path rather than adding another validator/cache around it: `ClientDirectedCommand::Settle` now only stops at the committed pose. Core no longer has pending-arrival state or an early arrival pose setter.

TUI arrival and displacement now use full XYZ distance. The existing shared speed resolver supplies the budget; near-vertical steps cannot multiply vertical travel by a small planar distance, and the final step cannot overshoot. A close horizontal target at a different height keeps the controller pursuing. Existing source-ownership, contact, sequencing, and publication regressions remain covered: 36 navigation tests and 64 movement-owner tests passed, with warnings denied. The physical solver itself has not changed; reduced-policy composition and intent progress remain pending.

### Reduced runtime and TUI source cutover (2026-10-28)

The TUI now explicitly chooses navigation movement and opens exactly one prepared pair or full HBA. `--content` overrides `HOLTBURGER_CONTENT`; automatic candidates are working-directory `content`, executable-adjacent `content`, and platform-data `content`, in that order. Existing malformed sources stop discovery. The app supplies precedence while the content layer owns opening/validation. Bootstrap and the complete creation catalog read the selected indexed repository, without constructing the full physical/render asset service.

Core now holds uncommitted intent progress through known gaps while world state and packets retain the last valid pose. Missing or ambiguous geometry waits without banking travel. Client-directed, server-directed, authored, and sticky contributions have one translation owner per tick. Reduced local sticky following retains XYZ and authored setup clearance. Physical actors retain their existing grounded/support policy. Setup dimensions are available independently for interaction ranges; navigation advertises no jump capability and honors authoritative integration exclusion.

Synthetic prepared-content fixtures now exercise the production reader, coordinator, and core simulation: a remote envelope crosses a passable doorway, slides along the surrounding shell, and holds through missing setup content before resuming from its committed pose after hydration. A session-capture regression decodes actual movement/position packets and verifies valid committed positions, authority sequences, and immediate accepted-cell reporting across a gap. These tests require no retail assets in CI.

The updated noninteractive `content_bootstrap` diagnostic passes on the worldwide generated pair and the model-free HBA fixture: 13 creation heritages and 568 cells/room shells in the representative owner. The app's portable-selection test loads from an unrelated directory. The CLI Flatpak recipe now names the companion files and the new environment variable; approved input pinning, native/Flatpak staging, receipts, and shared workflow migration remain in progress. No new release candidate has been assembled from this work yet. The active end-to-end plan tracks remaining runtime/lifecycle validation and packaging.

### Production runtime ACE checkpoint (2026-10-28)

Added the headless `live_navigation_probe` diagnostic. It opens the real `NavigationContent`, uses `ClientRuntimeBuilder.navigation_content`, enters through the ordinary client lifecycle, and sends frontend `ClientDirected` pulses into the production run loop. Core owns scene acquisition, interpolation, containment, canonical placement, and packet publication. It neither launches the TUI nor reconstructs the publisher. Endpoints come from an explicit route file and character identity is explicit; credentials are environment-only. Each completed run restored the original position using ACE teleloc within 0.05m and disconnected. ACE teleloc raises the gameplay root by about 0.005m; restoration is not bit identical.

The original paced route passed through canonical cells `EC0E0107 → 0108 → 0109 → outdoors 0033 → 010B`, with matching ACE gameplay/physics cell and coordinates at arrival. A second 14.142m route in dungeon owner `8602` crosses a known void between rooms `0101` and `0104`; offline geometry sampling found 58 outside-cell samples. The first runtime run stalled at the first room boundary. This was a client tick-lifetime bug, not evidence of ACE rejection: `ClientDirected(None)` discarded gap progress on simulation ticks between 50ms frontend pulses. Preserve progress on those ticks without reusing the consumed travel budget. Explicit acquisition, settle, release, correction, and epoch resets retain their owners. After this fix the same live route reached `86020104`, with matching server gameplay/physics cell and coordinates.

New synthetic regressions cover interleaved empty ticks (no extra travel, no progress loss) and an actual newer-force-sequence `UpdatePosition` through the production message handler, both with different coordinates and with identical coordinates. All 15 navigation-progress tests pass. Live intermediate packet payloads were not captured here; the existing synthetic session capture proves valid committed publication and immediate cell-change reporting. These live routes do not establish ground-level exterior doorway behavior or a live rejection-induced correction. See [runtime evidence](evidence/cli-navigation-runtime-ace.json) and [gap evidence](evidence/cli-navigation-runtime-gap-ace.json).

### Ground-level doorway and cancellation audit (2026-10-28)

The production headless runtime crossed the authored outside-to-cell doorway at `A9B40102`, starting 0.2m above outdoor terrain Z=66 and targeting 0.2m above the door sill Z=67. ACE gameplay and physics agreed on the destination cell and coordinates. This covers a ground-level entrance with a raised sill, not another upper-floor opening. It uses the agreed destination-height interpolation rather than gravity/stair handling. The character was restored within the documented tolerance and disconnected. Prepared and exact-full-HBA terrain surfaces also compared equal in `EC0E`, `8602`, and `A9B4`; the earlier doorway search failure did not demonstrate a prepared-terrain defect. [Recorded doorway evidence](evidence/cli-navigation-runtime-doorway-ace.json).

A focused regression exposed a second gap-lifecycle bug: `admit_server_gesture` retired automatic approach without clearing uncommitted progress. Starting new authored motion could consume the cancelled approach's hidden candidate and commit across the gap. Reset progress when that automatic source is retired, preserving held manual input. The test failed before the change and passes after it; all 98 movement tests pass.

**Product decision pending: missile admission.** `combat_runtime.rs::missile_request_grounded` requires a runtime body with `ContactState::Grounded`. Navigation deliberately installs no local physical solver, so its contact is `Unknown`; even the last server contact does not enter this gate. Therefore normal reduced TUI missile requests would wait indefinitely. ACE independently rejects missile attacks while `IsJumping` (`Player_Missile.cs:64`; definition in `Player.cs:49` uses physics OnWalkable and, outside FastTick, velocity). Proposed first-pass policy: let navigation-mode missile requests reach ACE while retaining the physical client's grounded gate. This is an explicit combat concession, not a reason to invent a local physical body. Implementation pauses for the user's decision; no missile-gate change has been made.

### Accepted server-owned eligibility policy (2026-10-28)

The user accepted delegating gameplay eligibility to ACE when the reduced TUI cannot meaningfully simulate the required physical condition. Preserve meaningful shared checks and h3d's physical behavior. This is a general policy for similar consumer gaps, not an instruction to invent a grounded pose, skip unavailable navigation coverage, or add deferred local movement capabilities.

`missile_request_ready` now allows navigation-mode requests without solved local contact; physical mode retains the grounded requirement. The regression covers both policies across unknown/airborne/sliding/grounded contact. All 22 focused combat tests pass. Four existing intentional send-failure tests initially could not create sockets under the sandbox; rerunning the same tests with loopback socket access passed. No live attacks were sent. Content/core/world/TUI architecture docs and the prepared-format reference now describe these ownership and compatibility contracts.
