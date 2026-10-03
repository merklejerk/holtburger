# Holtburger 3D World Map Implementation Plan

Status: **Raster and settlement implementation verified. User accepted the current map presentation
(“looks good”); the Crater Lake Village source gap is resolved from ACE vendor data.
Map-click teleport implemented and automated checks passed; live ACE verification is blocked
at authentication before character selection, as recorded below.**

## Goal and agreed scope

Replace the World panel terrain mesh with one 2048×2048 image containing mean diffuse terrain
colors and fixed baked hillshading. The host generates image tiles in a background job. The World
panel displays completed tiles while that job runs, using Canvas2D for pan and zoom. Successful
completion publishes one reusable image cache in the existing local profile cache directory.

The latest user steering supersedes the mesh/LOD implementation and its complete-before-display
contract. The software bake belongs to the app-local Rust host. The frontend owns ordinary image
presentation, panel lifetime, controls, and the player marker. No world-map WebGL context, shader,
normal texture, terrain index buffers, or per-view terrain preparation remains after cutover.

In scope:

- 2048×2048 RGBA8, north-up and top-down, with fixed lighting baked into RGB.
- 128×128 image tiles: 256 tiles, each 64 KiB; 16 MiB of image pixels in total.
- Progressive generation/transfer/display, one complete disk cache, and deduplicated preparation.
- Retained World panel, saved placement, fit/pan/zoom, visible progress, and outdoor player marker.
- Existing source provenance, cache bypass, failure/retry, host shutdown, and late-response guards.
- Clean removal of the superseded mesh contracts, frontend work, tests, and diagnostics.

Out of scope:

- Adjustable lighting, normal maps, contours, impassability, roads, objects, labels, or other tabs.
- View-dependent loading, tile eviction, tile priorities, multiple image resolutions, or a tile server.
- PNG encoding/compression, separate files per tile, resumable incomplete caches, or a generic cache.
- Starting preparation at login. Keep first map activation as the trigger; reassess prewarming
  after measuring progressive cold loading and its contention with gameplay.
- Changes to minimap rendering or its lighting controls, and unrelated game-scene rendering changes.

The browser may accelerate Canvas2D internally. This plan removes application-managed WebGL from
this map, rather than promising CPU-only frontend composition.

## Existing implementation and evidence

The shared outdoor terrain query, mount-time source provenance, mean texture-color helper,
World-panel registration/persistence, retained-window input behavior, and cache-bypass launch flag
are already implemented and should survive this change.

The mesh investigation found an app-local scheduling problem: LOD transitions rebuild visible
groups' indices and yield once per group before drawing. New wheel input waits for the previous
view's preparation to finish. In a 638×560 map on a Radeon 780M, five-trial medians were 0.3–0.5 ms
within one LOD and 137–386 ms across thresholds. A zero-delay timeout cost about 4.37 ms per turn;
72 group yields accounted for roughly 315 ms of one transition. These are isolated draw-submission
observations, not end-to-end input latency or gameplay budgets. Raw evidence is
`/tmp/holtburger-world-map-zoom-latency.log`.

The real-content census found 65,025 source roots, of which 63,305 were drawable outdoors and
1,720 were dungeon-only exclusions. The mesh transfers approximately 39.3 MiB and retains roughly
39.2 MiB of CPU attributes plus 35.2 MiB of GPU attributes before indices. The raster removes those
frontend products. A backing canvas logically holds 16 MiB of pixels, plus the visible canvas and
bounded tile responses; browser-internal copies and process memory must be measured, not inferred
from that figure. Cold generation still reads the terrain domain; a smaller output alone does not
prove a faster bake. Progressive display makes that work observable.

## Ground truth and ownership

| Layer and source                                                                            | Preserve or change                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared content: `crates/holtburger-content/src/landblock.rs`                                | Reuse `read_landblock_terrain`, resolved heights, transposition, canonical diagonals, for every present landblock, regardless of scene classification. Invalid terrain roots remain errors.         |
| Shared content: `repository.rs`; DAT: `archive.rs`                                          | Preserve ordered mount-time provenance captured from opened archive handles. The host owns cache identity.                                                                              |
| App host: `host/src/terrain_color.rs`; `world_map/generator.rs`                             | Reuse mean diffuse colors and the existing minimap-style normal calculation. Replace attribute packing with fixed lighting and pixel sampling.                                          |
| Existing appearance: `src/lib/game/world-map/renderer.ts`; `src/lib/frontend-tuning.ts`     | Reference the current Gouraud convention, northwest light, and ambient level when defining the host bake. World-map lighting becomes host-owned. Minimap tuning remains frontend-owned. |
| App host: `world_map/{mod.rs,format.rs,tests.rs}`                                           | Replace mesh format, preparation receipt, batch reads, and progress polling with an image job and incremental tile reads. Keep cache/error/cancellation invariants.                     |
| Host adapters: `shared_host_content.rs`, `protocol.rs`, `bin/dev_landblock_content_host.rs` | Expose one shared image service through sidecar commands and development HTTP routes. Preserve concurrent request dispatch and stop-before-drain shutdown.                              |
| Electron: `main.ts`, `client-launch.ts`, `scripts/entry-paths.*`                            | Preserve `<userData>/cache/world-map` and `--ignore-world-map-cache`. Do not put host cache policy in renderer URLs.                                                                    |
| Frontend: `assets/{world-map-source.ts,decode-world-map.ts}`                                | Replace mesh decoding and preparation polling with typed image receipt/batch decoding. Both adapters share the decoder.                                                                 |
| Frontend: `game/world-map/{types.ts,owner.ts,renderer.ts,view.ts}`                          | Retain map-plane view math and resource ownership; replace mesh rendering with backing/visible Canvas2D canvases. Delete `indices.ts`.                                                  |
| Existing Canvas2D pattern: `src/explorer/ExplorerTexturePageModal.svelte`                   | Reuse the detached canvas plus `ImageData`/`putImageData` pattern; no blob URLs or image decoder are needed for raw RGBA8.                                                              |
| Presentation: `ClientWorldPanel.svelte`, `ClientWorldView.svelte`, `ClientHudWindow.svelte` | Keep retained panel and input ownership. Permit pan/zoom during partial display and make progress non-obscuring.                                                                        |
| Diagnostics: `inspect_world_map.rs`, `WorldMapHarness.svelte`, fixture, browser script      | Exercise real image generation/transfer and synthetic progressive presentation. Replace mesh workload measurements and GPU-query probes.                                                |

No map cache, lighting, rasterization, or UI policy moves into `core`, `world`, or `dat`. The content
query remains reusable; image generation is h3d presentation. Use ACE/retail references already
cited by the authoritative content/topology code if a new source-data question arises.

## Design principles

- Return usable image extent early and show completed work; completion gates disk reuse, not drawing.
- Keep one image, one job, one cache file, and one sequential tile cursor per frontend owner.
- Generate every pixel from global coordinates. Image tiles are work units, not geometry boundaries.
- Put all lighting into the bake. The frontend only places pixels and scales/translates an image.
- Retain view/canvas lifetime across panel changes; visibility owns input and scheduled drawing.
- Prefer deletion to maintaining two representations or adding mesh optimizations to retired code.

## Raster and lighting contract

The outdoor domain is 255×255 landblocks, each 192 m, hence 48,960 m per axis. The source has
2,040 terrain cells per axis; it is not a 2,048-cell lattice. Image tiles therefore do not align
exactly with the previous 16-landblock groups. Do not pad the image with eight fake source cells,
stretch individual source groups independently, or assume one block rectangle equals one tile.

For global image pixel `(px, py)`, sample its center:

```text
worldX = minX + (px + 0.5) * (maxX - minX) / 2048
worldZ = minZ + (py + 0.5) * (maxZ - minZ) / 2048
```

Image row zero is north (`minZ`); columns increase east. Source terrain vertex rows increase north
and renderer Z is north-negative. The baker explicitly maps these coordinate systems. Output
order is northwest-first tile-row-major; each tile's pixels are top-to-bottom RGBA8. Tile rectangles
partition the image exactly and the host emits them in the receipt. The decoder checks that
partition; the renderer consumes those rectangles rather than independently choosing placement.

For each tile, derive the intersecting source landblocks from its global pixel centers. Use the
existing job-local content decode cache to avoid re-reading records shared by neighboring tiles.
Keep lit vertex colors/normal inputs temporary and tile-local; do not assemble a full world mesh.

For each drawable source block:

1. Reuse resolved heights and the existing central-difference normals, including deliberate
   flattening of crossing gradients at landblock edges. Tile edges introduce no new normal rule.
2. Resolve the authored palette code and shade each vertex with
   `palette[code] * (ambient + (1 - ambient) * max(dot(normal, normalizedSun), 0))`.
3. Locate the pixel's source cell and canonical triangle using `cell_diagonals`, then barycentrically
   interpolate the three already-lit vertex colors. This preserves Gouraud shading; it does not
   shade an interpolated normal or substitute bilinear color interpolation.
4. Clamp/round RGB to bytes and write alpha 255. Only absent terrain roots write transparent zero RGBA; dungeon-only roots are included. Present malformed records fail the job with the content ID.

The host owns one named bake specification containing resolution and fixed lighting. Initialize
lighting to the current world map's normalized northwest direction and ambient 0.35. Include the
actual bake settings in cache identity so editing them invalidates the output. Do not retain a
frontend world-map light setting with no consumer or couple future minimap tuning to host caches.
Preserve the current numeric color convention; this cutover adds no gamma-correction policy.
Single pixel-center sampling and RGBA8 quantization are accepted approximations at 2K.

## Image job, cache, and transfer

### Host service

Replace the current completed-dataset `OnceCell` assumption with one lazy job owner. Distinguish
running, complete, and failed attempts. Concurrent opens join the current attempt. Only explicit
Retry replaces a failed attempt; transport failure/reopen rejoins an active or complete attempt.
Mint an opaque receipt ID per attempt, separate from the internal source/bake cache identity, so
requests from a failed attempt cannot accidentally read its replacement.

Keep one blocking coordinator and a dedicated pool capped at four workers. Bake the first tile
serially for prompt output, then process bounded waves with independent decode caches and ordered
prefix writes. Keep immutable mounted content, cooperative checks between blocks/tiles,
and retained file handles. Opening initializes the image receipt and temporary file before the
whole bake completes. Warm opening validates a complete image cache and retains its handle without
terrain decoding. Expensive I/O runs off the async runtime thread.

A running attempt has a monotonically increasing published tile prefix. A tile becomes available
only after its full bytes have been successfully written. Append, progress publication, reads, and
final cache publication have explicit ordering. Use short file/state locks and a Tokio notification
for readers; never hold a state lock while waiting for new work. Register a notification waiter
before checking state so completion/failure/stop cannot be lost between check and wait.

### Cache file

Use one new, versioned binary image container at the existing cache pathname. Its bounded header
contains source/bake identity, image extent, and tile rectangles; fixed-size RGBA8 tile records follow
in receipt order. Initial uncompressed storage is 16 MiB plus header, avoiding PNG encode/decode,
compression options, per-tile paths, and another dependency. The old mesh format is rejected and
regenerated; no compatibility reader or second permanent map cache is retained.

Create one same-directory `NamedTempFile`, write its final header once, and append tiles. The live
attempt serves its published prefix through this file's retained handle. After every tile succeeds,
check cancellation/source revision, flush the complete output, and atomically replace the cache
pathname. Keep the previous valid cache until replacement succeeds. The attempt's reads continue
through its own handle during/after rename; another process replacing the pathname cannot switch
an outstanding receipt's bytes. Atomic publication means complete reusable cache entries, not an
atomic visible reveal in the panel.

Validate version, identity, dimensions, canonical rectangles, and exact file length before warm
reuse. Missing/stale/structurally corrupt entries regenerate once; real I/O errors remain errors.
There is no checksum in the initial raw-pixel format: an arbitrary change to otherwise well-shaped
RGB bytes is not detected. This is an explicit integrity concession, not a claim of full corruption
validation. Incomplete temporary files are never warm caches and are removed after failure/stop.
Changes to mounted sources require restart; do not accept new path stamps while reading old handles.

Preserve `--ignore-world-map-cache`: first requested preparation per launch bypasses disk reuse;
concurrent consumers and reopenings share the resulting attempt. A failed attempt may be explicitly
retried. The flag neither deletes a cache on launch nor starts a job itself.

### App-local transport contract

Replace the mesh commands and HTTP equivalents together:

```text
open_world_map({ intent: "open" | "retry" })
  -> image receipt { receiptId, width, height, bounds, tiles: pixel rectangles }

read_world_map_tiles({ receiptId, nextTile })
  -> binary envelope { receiptId, firstTile, tileCount, state: "streaming" | "complete" }
     + consecutive RGBA8 tiles
```

Each read returns up to 16 already-produced tiles (at most 1 MiB of pixels), or waits for the first
requested tile, successful completion, failure, or stop. The host owns that bound; consumers do not
supply arbitrary batch sizes. Check the actual framed response against the existing 16 MiB limit.
A complete 16 MiB image cannot be sent in one frame because the envelope would exceed that limit.

If the client has consumed every tile while cache publication is pending, `nextTile == tiles.length`
waits for completion. A terminal zero-tile response then marks successful completion. Completion
may also accompany the final nonempty batch. Zero tiles with `streaming` is invalid; there is no
busy polling or separate progress request. Host failure is an explicit command error, including
publication failure after all image pixels have been displayed. The frontend does not announce
success until the complete response is received.

Validate receipt ID, cursor range, contiguous tile coverage, payload lengths, and terminal state.
Invalid/stale requests fail before disk reads. The owner starts at tile zero and advances by decoded
`tileCount`; its progress uses applied tile count over receipt tile count. Checking/opening and the
final save wait are indeterminate stages. Remove `prepare_world_map`, `load_world_map_batch`,
`world_map_progress`, and their polling helper rather than retaining aliases.

## Canvas2D presentation and lifecycle

One frontend owner retains a detached 2048×2048 backing canvas and the visible World-panel canvas.
Create their 2D contexts once. Apply tile bytes with `ImageData`/`putImageData` at the receipt's
rectangle; release each response buffer after application. No full CPU pixel array, normals,
terrain codes, geometry, mip pyramid, blob URLs, or per-tile bitmap collection is retained.

The visible renderer fills the panel background and draws the backing canvas with the current
world-to-screen scale/translation. Transparent source holes and not-yet-arrived tiles reveal that
background. Use browser image smoothing for zoom; no application-managed texture LOD/mipmaps.
The image may blur at close zoom: 2K is an accepted overview resolution, approximately 24 m/pixel.

Keep `view.ts` fit/clamp/player projection with a bounds type independent of the old mesh manifest.
Enable fit/pan/zoom when the image receipt is installed, including before generation finishes.
Use one pending `requestAnimationFrame` to coalesce visible tile arrivals, resize, and interaction
into the latest draw. Clear that pending callback on hide/teardown; hidden arrivals can still update
the backing image but do not draw the visible canvas. Showing the panel redraws the retained image
and remembered view. Idle views have no continuous map draw loop.

Use a composite owner state: opening; streaming with receipt/applied tile count; ready; retryable
load failure; terminal Canvas2D unavailability; disposed. Shared image/view capability is explicit
for streaming and ready, rather than checking only `ready` or asserting through nullable fields.
Canvas allocation/context creation failure is renderer unavailability; host/transport errors offer Retry.
If a Canvas2D context actually loses its contents, surface that event as a retryable resource
failure rather than silently displaying stale/blank data. This differs from context creation being
unavailable: Retry can reconstruct the canvases and replay tiles from the retained host attempt. Verify the available browser event behavior during implementation; no world-map
WebGL restoration path or WebGL-specific restart message survives.

A failure after partial display clears the incomplete backing image and exposes its diagnostic.
Retry resets the tile cursor and frontend epoch/resources, then joins the current healthy host
attempt or explicitly replaces a failed one. Old replies cannot paint the replacement canvas.
Shutdown signals the worker and wakes pending reads before the protocol drains requests. Closing
or switching panels preserves the job/image; transport teardown disposes the owner and stops its
work. Do not make panel visibility own host generation lifetime.

Retain World registration/settings and the separate imperative SVG player marker.
Marker movement does not redraw terrain. Every visible image draw also reprojects the marker in
the same RAF, including pan/zoom/Fit/resize; the 30 Hz timer samples player movement between draws. Hidden windows release Escape/focus/gestures/accessibility
and stop marker timers. Replace the current opaque loading overlay with a small non-obscuring
progress area during streaming, showing displayed tiles and the final saving stage. Fatal errors
can occupy the surface; partial map interaction must not depend on generation finishing.

## Phased implementation

### Phase 1: Bake specification and software pixel generation

Files: `host/src/world_map/{format.rs,generator.rs,tests.rs}`, existing terrain-color helper.

- [x] Replace mesh array products with the image specification, canonical tile rectangles, and RGBA8.
- [x] Reuse authored terrain/palette/normals; implement global pixel-center triangle sampling.
- [x] Keep decode caching/job cancellation; generate only temporary data needed for the current tile.
- [x] Test flat and sloped terrain, both diagonals, palette interpolation, north/south orientation,
      missing roots and included dungeon terrain, invalid content, and equal global samples across tile boundaries.
- [x] Test that tiles partition exactly 2048² pixels despite the 2040-cell source domain.

Acceptance: deterministic correctly oriented tiles use fixed Gouraud lighting and canonical source
semantics; tile seams introduce no new geometry/normal boundary; tests use synthetic checked-in data.

### Phase 2: Progressive image job, one-file cache, and adapter contracts

Files: `world_map/mod.rs`, shared-content/protocol dispatch, command inventory, HTTP host,
`bin/inspect_world_map.rs`; existing Electron cache configuration remains.

- [x] Implement deduplicated running/complete/failed attempts and unique per-attempt receipts.
- [x] Publish completed tile prefixes from the retained temporary-file handle before full completion.
- [x] Implement bounded waiting reads, terminal completion, source checks, atomic publication, and stop.
- [x] Replace mesh commands/routes with image open/read commands in both adapters.
- [x] Preserve cache bypass and narrow real-content inspection; report first tile and completion times.
- [x] Test concurrent opens, valid warm cache, old mesh rejection, truncation/version/identity changes,
      I/O errors, write-before-availability, waiting reader wakeup, final save failure, cancellation cleanup,
      stale retry receipts, and retained handles across pathname replacement.

Acceptance: a cold reader receives a tile before cache completion; a warm reader performs no terrain
bake; no reader observes a partially written tile; all waiters terminate on failure/stop; only complete
cache entries are reused and the forced-generation flag remains effective.

### Steering gate: Verify first useful output and retained cost

- [x] Measure first tile, first visible draw, total cold bake, warm open/transfer, and working memory.
- [x] Confirm raw 16 MiB caching and a sequential tile cursor remain sufficient before adding codecs,
      prewarming, prioritization, extra progress protocols, or other machinery.
- [x] Check content-query, file-read, and pending-request contention with representative client work.

Acceptance: progressive delivery has runtime evidence independent of total generation speed, and
any justified change is incorporated here before frontend integration expands the contract.

### Phase 3: Typed image source and retained Canvas2D owner

Files: `assets/{decode-world-map.ts,world-map-source.ts}`, `game/world-map/{types.ts,owner.ts,
renderer.ts,view.ts}`, `ClientWorldPanel.svelte`.

- [x] Decode image receipts/batches; enforce exact sequential placement, lengths, and completion.
- [x] Build detached backing and visible canvases; apply/release tile responses and render one image.
- [x] Model streaming as usable view state; coalesce draws with RAF and retain hidden image/view.
- [x] Move progress into non-obscuring markup; enable controls before all tiles are present.
- [x] Preserve marker/input behavior, retry, partial-image failure, stale replies, and teardown.
- [x] Test malformed responses, cursor advancement, progress stages, partial interaction, retry epochs,
      coalescing, hidden arrivals, and disposal with focused fixtures.

Acceptance: tiles become visible while generation is running; zoom/pan only transform an image and
make no host calls; idle/hidden views do not continuously draw; no world-map WebGL context is created.

### Phase 4: Runtime checks and complete mesh cutover

Files: map/client browser harnesses, synthetic fixture, canonical browser script, focused tests,
frontend tuning/contracts, host binary-section helpers, README.

- [x] Replace GPU mesh counters/timing and the LOD zoom diagnostic with progressive-image and Canvas2D
      draw/interaction measurements; preserve reproducible real-content and actual ClientWorldView runs.
- [x] Delete `indices.ts`, mesh shader/buffer code, attribute encoding/decoding, and obsolete tests.
- [x] Delete `append_i16` if no surviving consumer exists; retain shared binary helpers with callers.
- [x] Remove world-map `coarseCellPixels` and every retired mesh/stride/group-draw vocabulary consumer.
      Preserve existing minimap hillshade tuning and unrelated scene WebGL code.
- [x] Remove unused preparation-progress request/types/polling; keep one source contract per transport.
- [x] Rewrite synthetic fixtures around image tiles and controlled incomplete generation.
- [x] Exercise real pointer/wheel input during partial and complete display, panel switches, Escape,
      retained reopening, forced regeneration, load/save failure, context/resource loss, and teardown.
- [x] Record five repeated interaction samples with canvas size, map span, hardware, workload, and
      whether generation/gameplay is active. User performs all visual acceptance.

Acceptance: the existing client shell is preserved, the raster is the sole world-map path, progressive
pixels and controls work together, and no mesh-specific diagnostic/test protects obsolete behavior.

### Phase 5: Quality cleanup and handoff

- [x] Review producer/adapter/decoder/owner seams for duplicate facts and hidden ordering requirements.
- [x] Assess final sLOC and justify job/transfer complexity against mesh deletion; record the
      unavailable uncommitted mesh baseline rather than inventing a numerical reduction.
- [x] Run focused Rust/TypeScript and relevant content/transport/settings regressions, required checks,
      lint, Clippy with warnings denied, formatting, and the real-content/production-panel browser suites.
- [x] Update README and this active plan with final contracts, measured costs, limitations, and status.
- [x] Provide whole-world, partial-loading, and close-up captures for user review; do not inspect them
      for visual acceptance, run the interactive TUI, stage, or commit changes unless requested.

Use app package scripts (`test:ts`, `check`, `lint:ts`, `lint:dead`, `harness:browser`) and Cargo for
relevant host/content tests, Clippy, and formatting. Static checks alone do not verify this cutover.

## Follow-up: include all landblocks, parallel bake, and synchronized marker

User steering after initial visual review: include every present landblock terrain root in the
raster, even when its normal scene classification is dungeon-only; speed up baking in parallel;
reproject the location marker immediately with map gestures.

- `read_landblock_terrain` replaces the map-only filtered query. It reads and validates the terrain
  root without fetching LandblockInfo. The full scene assembler still loads required metadata and
  classifies dungeon-only owners exactly as before. The overview does not create an outdoor scene.
- Format/bake revision 3 rejects prior caches and includes the formerly omitted terrain. Absence
  alone remains transparent; malformed terrain roots remain errors.
- One coordinator writes image prefixes and publishes the cache. It bakes/publishes the first tile
  before creating a dedicated Rayon pool capped at four workers (or available CPUs if fewer).
  Remaining tiles run in bounded waves with independent decode caches. Ordered results occupy at
  most four tiles (256 KiB), and only completed writes advance availability. All workers share
  cooperative cancellation; no global pool, unbounded queue, or progressive-order scheduler is added.
- The owner notifies imperative overlays within the visible image RAF. Pan/zoom/Fit/resize/reopen
  thus reproject the marker with the terrain. The existing 30 Hz timer handles live player movement
  between map redraws and stops while hidden; it does not trigger terrain redraws.

Latest evidence:

- Same-content unoptimized diagnostic: revised serial terrain-only bake 24.040 s; four-worker bake
  8.158 s, first tile 0.807 s. Browser: first tile/draw 0.876/0.877 s, completion 9.095 s. This is
  roughly 3× faster than the revised serial path, without claiming release-build performance.
- Completed real-content revision-3 cache: all 4,194,304 pixels opaque (previously 110,528 were
  transparent). A synthetic host regression proves a classified dungeon root produces diffuse pixels.
- Browser projection probe disabled the 30 Hz timer, then checked five pan/zoom draws. Every marker
  coordinate matched the current projection. Both real-content and client-panel browser suites passed.
- Five concurrent terrain-source requests during parallel generation completed in
  8.1/2.9/2.6/2.2/2.5 ms. This remains a small static-content contention probe, not live gameplay load.
- Host/content suite passed 346/96 tests before the additional dungeon-bake regression; all 16 focused
  world-map cases passed afterward. Eight image/frontend tests, type checks, lint/dead-code checks,
  Clippy with warnings denied and formatting passed. Final full frontend run passed all 337 files/2,721 tests; results are recorded
  in `/tmp/world-map-followup-all-ts.log`.

Evidence: `/tmp/world-map-unclassified-{serial,parallel}.log`,
`/tmp/world-map-followup-{browser,client-browser,all-rust,rust,all-ts,check,lint,dead,clippy,format}.log`.
New captures: `/tmp/holtburger-world-map-parallel.png` and its whole-world/partial companions;
not visually inspected by the agent. The older measurements below remain historical evidence of
revision 2 and serial/classified behavior, not current performance or coverage.

## Follow-up: World/Housing tabs and map controls

User steering: prevent panning past map edges, make the location marker a distinct target,
add World/Housing tabs with Housing stubbed, and replace the Fit label with a small reset overlay.

- The app-local projection clamp now constrains viewport edges in X and Z. When an axis is wider
  than the map (full-world fit and aspect letterboxing), that axis stays centered; panning cannot enlarge
  the aspect-ratio margin. Resizing and zooming use the same constraint as pointer gestures.
- The retained World panel now uses accessible World/Housing tabs, with arrow/Home/End navigation.
  Housing shows a placeholder. Switching tabs preserves the image and view, cancels gestures,
  stops visible map draws and the marker timer, and does not request more content.
- A bright yellow ring/crosshair with a dark halo and white center replaces the small plain dot.
  It remains a fixed-size SVG overlay projected in the terrain's draw frame.
- The bottom-right icon is labelled Reset view and reuses the existing HUD reset icon. It restores
  the centered full-world projection, not the player position or cache. It works during streaming.

Focused pure tests cover viewport edges on landscape/portrait projections, oversized-axis centering,
and full-world fit. Browser diagnostics check the actual reset button, retained tabs, stopped hidden
map draws and the marker transform. Captures remain for user visual acceptance.
Evidence: `/tmp/world-map-ui-{test,check,lint,dead,format,browser,client-browser}.log`;
`/tmp/holtburger-world-map-ui.png` and whole-world/partial companions.

## Follow-up: panel naming and header styling

World is now the consistent dock label, shortcut/icon identifier, icon asset name, panel title,
and settings identity. The existing world-map image/source/render terminology remains appropriate
for the panel's terrain capability. The previous `map` shortcut-to-`world` translation was removed.
World/Housing tab buttons use the Settings panel's equal-width layout and 12-pixel header spacing,
with the World header's full-width separating border removed. The north indicator was deleted;
the separate gameplay minimap/compass is unchanged.

Validation: app type checks, frontend lint/dead-code checks, formatting and the production-panel
browser suites. Evidence: `/tmp/world-panel-style-{check,lint,dead,client-browser,browser}.log`.
Updated captures: `/tmp/holtburger-world-panel-style.png` and its whole-world/partial companions;
visual acceptance remains with the user.

## Follow-up: conditional reset and position hover

The reset overlay uses the shared HUD button recipe and is hidden whenever the retained view
matches the whole-world fit. The frontend owner preserves this fit through viewport resizing.
Pointer hover projects CSS pixels into canonical terrain coordinates and uses the existing AC
coordinate formatter. Fit margins have no tooltip; edge tooltips flip inward. Tooltip text and
placement update imperatively on pointer moves and image draws, so stationary cursors reproject
during zoom or pan without publishing input-rate Svelte state.

Validation covers inverse projection, reset/resize/zoom behavior, real panel control visibility,
tooltip reprojection, edge placement, pointer exit and fit margins, plus client pointer routing.
Evidence: `/tmp/world-controls-{tests,check,lint,dead,browser,client-browser}.log`.
Captures: `/tmp/holtburger-world-hover.png` and its whole-world/partial companions.
Visual acceptance remains with the user.

## Verification checkpoint and review

Implementation is the sole raster path. Host ownership covers source identity, fixed bake settings,
job/receipt lifetime, complete-prefix publication, bounded file reads, retry, and atomic disk reuse.
The adapters expose those facts without deriving image placement. The decoder validates the external
receipt and sequential RGBA responses; the frontend owner retains one image/view, guards asynchronous
replies by attempt epoch, and schedules visible draws. Hidden arrivals update the backing image while
visible rendering and the marker timer stop. Shared content remains responsible for authoritative
outdoor classification/topology, not map presentation.

Evidence collected on Linux, Chrome/ANGLE Vulkan, AMD Radeon 780M:

- `cargo test -p holtburger-3d-host`: 345 tests passed before the final cache-header test; the subsequent
  focused world-map run passed all 15 cases. Eight frontend image tests passed after the final
  context-restoration regression was added. The preceding full app run passed 337 files/2,720 tests.
- Content/DAT tests: 96 content tests, 127 DAT tests and one additional target test passed.
- `npm run check`, `lint:ts`, `lint:dead`, Clippy all targets with warnings denied, Cargo formatting,
  and diff whitespace checks passed. Existing binrw future-incompatibility notice remains upstream.
- Real-content `--world-map --gpu` and actual-shell `--client-world-map --gpu` passed. Actual wheel/drag
  input was exercised during a controlled partial stream and after completion. Reopening retained the
  canvas/image/view without new source calls; panel switches, focus, Escape, retry and teardown passed.
- Latest real-content browser run: first tile 1.111 s, first draw 1.112 s, cold completion 27.952 s,
  256 tiles/16 MiB of pixel data. Earlier runs observed first draw 0.884–0.943 s and completion
  26.908–27.715 s. These are unoptimized host builds, not release/client gameplay budgets.
- A separate process diagnostic observed 29.050 s cold, 29.97 ms warm (first tiles 3.98 ms, open
  0.99 ms), and 25.957 s forced regeneration with an already valid cache. Largest warm response
  was 1,048,668 bytes; all transport frames stayed below the 16 MiB ceiling.
- At 638×560, five whole/close zoom round trips (768 m / 48,960 m span) took
  0.7, 0.4, 0.3, 0.4, 0.4 ms. These measure RAF/draw submission with harness vsync/frame limiting
  disabled; they do not measure input-to-display scanout. Generation and gameplay were inactive
  during these trials. The old LOD scheduling work is structurally gone.
- Five ordinary terrain-source requests while generation and a waiting image read were active took
  8.8, 2.6, 2.5, 2.5, 2.5 ms, versus 4.1, 1.8, 1.6, 1.5, 1.5 ms after completion (1,466-byte response).
  This proves concurrent content requests make progress, not performance under a live gameplay load.
- The diagnostic process group reached a cumulative child peak RSS of 138,648 KiB across cold/warm/
  bypass runs, including archive mount/index and Cargo launch overhead. Browser per-process RSS
  snapshots with stable process IDs are in the final harness report; GPU RSS grew from 163,832 to
  182,668 KiB. Several renderer processes exist and ordinary browser allocations change during the
  run, so neither these snapshots nor their sum establishes image-only memory cost. The retained
  backing image logically contains 16 MiB; browser internal copies remain a measured limitation.

Raw evidence: `/tmp/holtburger-raster-world-map-review.log`,
`/tmp/holtburger-raster-client-world-map-final.log`, `/tmp/holtburger-raster-memory.log`, and the
`/tmp/world-map-{ts-tests,rust-tests,focused-rust,content-tests,check,lint,dead,clippy}.log` files.
Captures (not visually inspected by the agent):
`/tmp/holtburger-raster-world-map-review.png` (close), its `.sweep-whole-world.png` and
`.sweep-partial.png` companions.

The quality pass removed the separate preparation polling, mesh attributes/index scheduling/shaders,
stride setting and binary i16 writer. The visible renderer is 118 physical lines; retained owner is
228. The new host job is 515 lines and its generator 443 including embedded raster tests. That host
complexity buys independently tested write-before-availability, wakeup, stop, file-handle, failure and
publication invariants; it does not introduce a generic image cache or scheduler. The superseded mesh
files were uncommitted, so Git cannot supply an honest mesh-to-raster sLOC baseline. New feature size
still includes the original panel/settings/content-query work, synthetic tests and browser diagnostics.
There is no confirmed outstanding code-quality defect in the reviewed producer/adapter/decoder/owner
seams. Accepted concessions are detailed below.

## Risks, concessions, and definition of done

The key tradeoff is lower close-up detail in exchange for a simple image renderer and responsive
view changes. The bake still scans the world; progressive tiles do not promise a startup speedup.
Raw storage avoids codecs but uses about 16 MiB on disk. Browser canvas memory/copy behavior,
scaled-image quality, and context events need empirical verification. Cache replacement has only
been empirically exercised on Linux so far; test other supported systems when available rather
than claiming that coverage. A stale unrelated broad HUD icon assertion remains outside this scope;
use the focused World-panel suite and investigate any new failures on their evidence.

- [x] One 2K fixed-light image is generated from all present authoritative terrain roots.
- [x] Cold tiles display before job/cache completion; progress remains visible without obscuring them.
- [x] Pan/zoom work during streaming, retain view, and incur no geometry work or source requests.
- [x] Complete cache reuse/bypass and retained receipts are correct; partial caches never warm-load.
- [x] Retry, late replies, failure after partial display, stop, and pending readers have tested outcomes.
- [x] The frontend retains image presentation only; mesh/normal/LOD/WebGL map products are removed.
- [x] Existing panel, settings, marker, and input behavior survive; hidden work stays bounded.
- [x] Required automated checks and browser measurements pass with scoped evidence.
- [x] User accepts the current map presentation (“looks good”).

There is no outstanding product decision blocking this plan. Raw RGBA8 and row-major tiles are the
initial narrow choices; compression and login prewarming remain deferred unless measurements or
user feedback justify them. The raster is now the sole implemented world-map path. Remaining completion work is recorded
above; visual acceptance belongs to the user.

## Follow-up: remove full-world padding

The whole-world fit and maximum zoom-out now use the exact larger projected map extent.
The 5% border multiplier and its tuning field are removed. One axis meets the viewport edges;
the other can retain letterboxing when the map and viewport aspect ratios differ.
Reset detection, resize behavior and panning continue to use this same fit.

## Next: reproducible settlement reference data and map overlay

Status: implemented; automated verification passed and user accepted the visual presentation.
This extension adds named settlement markers to the existing World map. Its source recipe and conversion remain checked in alongside the generated
reference data; coordinates are never copied manually from query output.

### Sources and boundaries

- Retail selection reference: `acclient-eor-source/acclient.c:39016`,
  `gmMapUI::s_rgLocations`, is a fixed table of 53 map locations. It includes towns, outposts and
  geographic areas; one name is unresolved in the decompile. Use it to guide settlement selection,
  not to infer world coordinates from image pixels.
- ACE coordinate source: `points_of_interest.weenie_Class_Id` identifies a portal template;
  `weenie_properties_position` with `position_Type = 2` supplies its destination. See
  `ACE/Source/ACE.Database/Models/World/PointsOfInterest.cs` and
  `ACE/Source/ACE.Entity/Enum/Properties/PositionType.cs`.
- Investigation of the local database found 40 exact-name matches among the 52 readable retail
  names, all with outdoor destinations. Missing exact matches are a curation task, not evidence
  that those settlements have no destination. Resolve aliases and missing coverage explicitly.
- The town-named templates in WCID range 42758–42798 have indoor placements. Do not use their spawn
  positions as town anchors. Portal arrivals are accepted approximate settlement anchors rather
  than claims about geographic town centers.
- Offline SQL and extraction instructions belong to diagnostics tooling. The generated settlement
  list and all label, hover and visibility policy belong to the h3d frontend. No runtime database
  access, shared-crate API, host command, image receipt, or cache-format change is required.

### Phase 1: retain the complete generation recipe

- [x] Add `apps/holtburger-tools/sql/world-map-settlements.sql`: an explicit, reviewed selection of
  settlements and source portal WCIDs, with aliases resolved in that selection. Join selected
  sources to their ACE destination records and output stable tab-separated columns: display name,
  portal WCID, destination cell ID, local X/Y/Z, and selected-row count. Preserve selected rows
  with missing destination data so conversion can report an error instead of silently shrinking the dataset.
- [x] Add `apps/holtburger-tools/sql/README.md`: document the ACE schema/source assumptions and the
  exact read-only MySQL/MariaDB batch invocation, followed by conversion. Use normal database
  credential handling; do not put credentials into generated files or command examples.
- [x] Add `apps/holtburger-3d/scripts/generate-world-map-settlements.ts`: consume the query output,
  validate its column shape, selected identities, unique names, finite coordinates, outdoor cells,
  and final world bounds, and produce deterministic TypeScript. Missing or ambiguous sources fail
  with actionable diagnostics. Do not add fuzzy matching or a fallback to retail image positions.
- [x] Convert landblock-local ACE positions once at generation: canonical X is landblock X times
  192 plus local X; canonical Z is the negative of landblock Y times 192 plus local Y; canonical
  height is local Z. Preserve source precision and use the existing branded scene-position type.
- [x] Write `apps/holtburger-3d/src/lib/game/world-map/world-map-settlements.ts`, containing only
  runtime-consumed name and position fields. Retain source WCID/cell provenance in generated
  comments and the SQL selection, rather than adding unused fields to the runtime contract.
- [x] Expose conversion through an app package script. Emit source rows to an intermediate file
  before converting; document checking the database command's exit status so a failed query cannot
  be mistaken for an empty successful export. Validate the entire input before replacing output.

Acceptance: running the documented recipe against the same source reproduces identical output.
Every selected settlement has one verified outdoor anchor, and missing data fails loudly.
The verified selection has 51 entries including Eastwatch and Westwatch. Mt Esper-Crater Village
remains explicitly deferred: source searches found nearby dungeon portals but no verified village
anchor. It is documented in the retained recipe rather than guessed or silently omitted. Initial
coverage is curated towns and inhabited outposts; geographic-area and island labels are deferred.

### Phase 2: project and present settlements

- [x] Extract the existing forward projection in `src/lib/game/world-map/view.ts` for reuse by
  settlement anchors and the player marker. Keep the player's outdoor-residency decision in its
  existing helper; settlement labels do not become authoritative entity state.
- [x] Add retained settlement groups to the existing SVG overlay in
  `src/client/ClientWorldPanel.svelte`, beneath the player target. Project them through the existing
  `subscribeDraw` callback using the same view and CSS dimensions as the terrain and player marker.
  Do not route cursor-rate or draw-rate placements through Svelte reactive state.
- [x] Use small dots and fixed-screen-size names with a contrasting halo. Keep in-view dots;
  hide labels that would overlap using a simple deterministic screen-rectangle check. Measure
  label dimensions when text/font layout changes, not on every pointer move. Do not introduce
  priorities, clustering, a spatial index, or a generic annotation framework for this small list.
- [x] Extend the existing hover tooltip with nearest-dot hit testing in screen pixels. Hovering
  a dot shows its settlement name and anchor coordinates even if its label is suppressed; ordinary
  terrain hover continues to show cursor coordinates. Resolve equal-distance ties deterministically.
- [x] Keep overlay pointer events disabled so canvas drag, wheel zoom and reset continue to work.
  Recompute placement, label visibility and stationary-pointer hover on map draws. Settlements
  appear once bounds are available during streaming; hidden panels/tabs do no overlay work. Static
  settlement placement is not part of the player's 30 Hz movement sampling.

Acceptance: markers remain aligned through zoom, pan, reset and resize, appear during progressive
loading, retain sharp screen-size symbols, and preserve existing input and hidden-panel behavior.

### Phase 3: validation and cleanup

- [x] Add lightweight conversion tests using checked-in synthetic query rows: known coordinate
  conversion, deterministic output, missing/ambiguous sources, duplicate names and invalid outdoor
  positions. Do not retain tests requiring a live ACE database or untracked DAT assets.
- [x] Add focused projection, label-overlap and hover-hit tests. Extend real-content and client
  browser probes for streaming markers, same-draw projection, stationary hover, actual pointer
  routing, reset/resize and hidden-tab behavior.
- [x] Run relevant tests, app type checks, frontend/dead-code lint, formatting and browser suites.
  Record source coverage and generation commands without credentials. Verify that regeneration
  leaves the checked-in data unchanged when the source has not changed.
- [x] Update the app README and remove temporary extraction output. Keep the SQL, conversion
  script, instructions, generated data and meaningful tests as the reproducible feature surface.
- [x] Capture views for user acceptance of town anchors, label crowding and symbol legibility.
  Visual acceptance belongs to the user; do not silently claim it from automated checks.

Implementation evidence: 31 focused tests passed; app type checks, frontend/dead-code lint and
both browser suites passed. A fresh SQL extraction reproduced all 51 rows byte-for-byte, and the
converter reproduced the checked-in TypeScript exactly. The converter uses native Node TypeScript
stripping through its package script, keeping it typed without a separate handwritten declaration.
The SQL adds selected-row count as a seventh output column so partial query output fails conversion.

Evidence logs: `/tmp/settlements-{tests,check,lint,dead,browser,client-browser,regeneration}.log`.
Captures: `/tmp/holtburger-settlements.png` and its whole-world/partial companions. They have not
been visually inspected by the agent.

- [x] User accepts approximate anchor placement, symbol legibility and label crowding (“looks good”).

The implementation adds 211 lines for pure placement and retained SVG presentation, 112 for the
typed converter, 128 generated data lines, plus the SQL, documentation, tests and browser probes.
This stays app-local and introduces no runtime source or image-format changes. Coverage and aliases
were verified before presentation; the remaining Crater Village gap is documented explicitly. The accepted tradeoff is a bundled default-world snapshot: custom servers can
move towns, and this first version does not discover server-specific settlement locations.

## Follow-up: complete Crater Lake Village from ACE

Crater Lake Village replaces the unresolved retail “Mt Esper-Crater Village” gap. ACE's vendor
templates 2497, 2498, 2499 and 27554 have `TownName = CraterLake` and placements clustered within
six horizontal meters in landblock 90D0. Use Silencia the Archmage (2498), whose placement names
outdoor cell 90D00000, as the representative anchor at approximately 64.8N, 13.4E.
The recipe checks her town tag and reads her authoritative placement. No retail pixel conversion
or nearby dungeon portal substitution is needed.

The extraction now emits eight columns, including source kind. Portal arrivals still require cells
1–64; vendor placements also admit outdoor cell zero. Both reject interior cells, missing anchors,
duplicate names/sources, invalid coordinates and truncated selections. Generated comments retain
the actual source kind, WCID and cell. The generated list has 52 entries. Earlier 51-entry counts
and the missing-source investigation above describe the initial checkpoint; this follow-up closes
that gap. The user accepted the initial overlay's visual presentation before this data addition.


Validation for the Crater Lake addition: 35 focused tests, app type checks, frontend/dead-code lint,
formatting, and the real-content browser suite passed. The browser exercised all 52 markers
during streaming and after completion. A fresh SQL extraction and conversion reproduced the data
byte-for-byte. Evidence: `/tmp/crater-{tests,check,lint,dead,browser,regeneration}.log`.

## Next: privileged map-click teleport

### Goal, evidence, and boundaries

Allow eligible characters to click a terrain location in the World panel and request ACE's normal
map teleport, while preserving drag-to-pan and progressive image display.

Ground truth:

- `acclient-eor-source/acclient.c:208796`: `gmMapUI::ListenToElementMessage` gates map teleport
  through `PlayerDesc::PlayerIsPSR`, converts the clicked map pixel to an outdoor cell, and supplies
  local X/Y of 10, height zero, and heading zero.
- `acclient-eor-source/acclient.c:424750` and `:424767`: eligibility is `IsAdmin` (44), `IsArch`
  (45), or `IsPsr` (97), rather than a generic account access-level comparison.
- `acclient-eor-source/acclient.c:670779`: `CM_Advocate::Event_Teleport` writes action 214
  (`0x00D6`), a target string, and a position using the ordinary sequenced game-action path.
- `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAdvocateTeleport.cs:14` reads that
  string and position, independently checks those three character flags, rejects entirely-water
  landblocks, calls `AdjustMapCoords`, and teleports the requesting player. The target string is
  read but unused by this ACE handler; send an empty string for self-teleport.
- `ACE/Source/ACE.Server/Entity/PositionExtensions.cs:240` supplies terrain height and adjusts
  building height/cell when applicable. Frontend terrain sampling is unnecessary.
- `ACE/Source/ACE.Server/WorldObjects/Player.cs:180` enables `IsPsr` for qualifying advocates.
  Do not restrict the feature to characters labelled admin.

This extension changes protocol support, reusable client command admission, h3d host projection,
and app-local input. It does not change ACE, map generation, image/cache formats, or settlement data.
Account administration, teleporting other characters, teleport previews, confirmations, new
terrain queries, and destination queues are outside this slice.

### Contract and ownership

```text
World panel: released click that never became a drag
  -> lifecycle session: teleportToMapPosition({ x, z })
  -> app host: validate canonical horizontal coordinates, convert to outdoor WorldPosition
  -> core: TeleportToMapPosition(WorldPosition), recheck current character and lifecycle
  -> protocol: AdvocateTeleport { target: "", position }, ordinary action sequence
  -> ACE: permission / water / height / building resolution, then normal teleport
  -> existing client teleport activation, scene loading, reveal, and marker updates
```

Core owns one derived `canTeleportFromMap` boolean, calculated from authoritative local-player
properties. Carry it in the application snapshot and a focused change event through the host
projection and frontend contract. Publish initial hydration, relevant permission changes, local
player replacement/removal, and lifecycle clearing coherently; snapshots recover subscription
races. The panel reads the capability and does not interpret raw flags. Capability availability
does not bypass core's in-world admission check or ACE's permission check.

The app host accepts a finite canonical map-plane point with named X/Z fields. Reuse
`host/src/placed_motion_presentation.rs::scene_point_to_pose` with height zero, then normalize the
outdoor cell using the existing `WorldPosition` helper. Validate the authored domain before
conversion; its upper X and northward extent are exclusive. The frontend map bounds currently
include the outer visual boundary, so an exact outer-edge click must be rejected without creating
landblock 255 or silently clamping it to another destination. Do not brand an invented full scene
position in a consumer merely to satisfy the coordinate contract.

Use the precise clicked horizontal coordinates instead of retail's fixed local 10/10 placement.
During implementation, mark this deliberate observable departure with the project convention and
the retail click-handler citation; record its scope as this map-click action only. ACE explicitly
resolves height at the supplied horizontal position. Heading remains zero. No client-side movement,
marker jump, or portal-space transition occurs merely because the request was submitted.

### Phase 1: wire support and shared client behavior

- [x] Enable `AdvocateTeleport = 0x00D6` in `crates/holtburger-protocol/src/opcodes.rs` and add a
  typed action payload alongside existing movement actions. Integrate pack/unpack in
  `messages/game_action.rs`; reuse string and `WorldPosition` codecs.
- [x] Add `ClientCommand::TeleportToMapPosition(WorldPosition)` and command handling in core.
  Validate a finite outdoor destination within the authored domain and current in-world character
  permission before dispatch. Reject stale/unauthorized intents through existing action-result
  feedback. Review existing interaction busy admission rather than introducing an independent gate.
- [x] Add the derived permission to `ClientApplicationSnapshot` and a focused view event. Compute
  the permission predicate in one owner helper and reuse it for snapshot, event, and admission.
  Hook initial hydration and permission changes into existing world-event reconciliation; clear
  the capability across character/session teardown. Do not emit unchanged capability every frame.
- [x] Add synthetic wire-byte tests independently matching ACE's field order, round-trip/truncated
  payload tests, and core tests for each allowed flag, denial, revocation, lifecycle admission, and
  exact action dispatch. No test may require untracked runtime assets.

Acceptance: authorized in-world intents produce one correctly sequenced `0x00D6` action; rejected
intents produce no action, and snapshot/event permission state remains coherent.

### Phase 2: host and frontend integration

- [x] Add the typed request to `host/src/protocol.rs`, client command registration/dispatch in
  `host/src/client_runtime.rs`, and the frontend transport registration. Keep dispatch client-only.
- [x] Reuse coordinate conversion and outdoor-cell normalization, with focused tests for axis
  direction, landblock seams, valid cell selectors, non-finite values, and exclusive outer bounds.
- [x] Project capability snapshot/event through `host/src/client_projection.rs`, frontend runtime
  schemas/decoders, and `src/client/client-lifecycle-session.ts`. Add the lifecycle session request
  method and cover decoding and transport payloads with focused tests.
- [x] Carry capability and request callback through `ClientApp.svelte` and
  `ClientWorldView.svelte` to `ClientWorldPanel.svelte`. Keep permission as cold event-driven state
  and gesture coordinates imperative. Route asynchronous request failures through existing visible
  client feedback; transport acceptance is not proof that ACE accepted the teleport.

Acceptance: the mounted panel receives current permission, requests reach core with the correct
outdoor destination, and permission/session changes cannot leave a reusable stale command target.

### Phase 3: click versus pan

- [x] Replace the panel's immediate pan gesture with one retained gesture tracking pointer identity,
  initial view/position, and whether movement ever exceeded a named frontend tuning threshold.
  Keep this panel-specific unless an existing helper can be extended narrowly without changing
  unrelated consumers. Current `trackPointerGesture` has no release/cancel callback distinction.
- [x] Primary-button release below the threshold requests one teleport only when permission,
  visibility, World tab, receipt/view, and terrain hit are still valid. Project the release point
  through `worldMapPosition`; reject letterboxing and out-of-domain outer edges. Streaming receipt
  bounds are sufficient even when the clicked image tile has not arrived.
- [x] Crossing the threshold permanently makes the gesture a pan, even if clamping prevents visible
  movement or the pointer later returns to its starting point. Preserve start-relative panning,
  wheel zoom, reset, and scene-input suppression. Settlement dots retain pointer-events disabled;
  teleport uses cursor coordinates rather than the tooltip's settlement anchor.
- [x] Discard pending clicks on pointer cancellation, panel hide, Housing selection, wheel/reset,
  teardown, and session replacement. Recheck permission at release and in core; do not replay clicks
  after loading or retain a pending destination through portal space.
- [x] Add focused gesture tests using explicit test-owned thresholds, covering jitter, return after
  drag, clamped-edge drag, wrong pointer, cancellation, and permission revocation.

Acceptance: a click dispatches once for an eligible character; panning, cancellation, margins,
and ineligible characters never dispatch. Existing pan/zoom remains usable during streaming.

### Phase 4: runtime verification and cleanup

- [x] Extend canonical World-panel and actual-client-shell browser probes with real pointer input
  for allowed clicks, ordinary-user panning, drag suppression, clamped-edge drag, cancellation,
  tab/hide behavior, permission changes, streaming, and retained view. Assert captured requests and
  destination coordinates; leave visual acceptance to the user.
- [ ] Use a focused non-interactive live ACE probe to verify an eligible map request produces the
  normal teleport sequence and destination placement, and an entirely-water request gets ACE's
  diagnostic without a transition. Check the h3d activation/reveal path and marker after arrival.
  Runtime-asset-dependent diagnostics remain temporary; do not retain asset-dependent tests.
- [x] Run appropriate protocol/core/host tests, Clippy with warnings denied, app tests/type checks,
  lint/dead-code checks, formatting, and browser suites. Record exact evidence and any genuinely
  unavailable live prerequisite rather than claiming synthetic tests prove live interoperability.
- [x] Review permission ownership and gesture teardown, remove superseded pan handling and any
  unused contract fields/helpers, and update the app README. Anticipate a few hundred net lines
  plus focused tests; revisit the design if it grows into a generic administration framework.

Done when the typed action interoperates with ACE, permission changes reach the panel and are
rechecked at dispatch, clicks cannot leak from pan/cancel gestures, and normal authoritative
teleport processing drives the resulting map marker and world transition. No outstanding product
decision blocks this extension; ordinary eligible click and drag-to-pan are the scoped interaction.


### Implementation checkpoint and live blocker

The typed action, core admission/capability, host conversion, lifecycle transport, and released-click
World-panel gesture are implemented. Snapshot fixtures were updated at their producer boundaries;
there is no compatibility default for missing permission. The app shell owns request-error toasts.
The image/cache service and ACE remain unchanged.

Coordinate tests caught the southwest-origin selector being interpreted as `Guid::NULL`. The map
adapter now seeds an outdoor selector before normalization, including in block 0000. Shared scene
conversion semantics remain unchanged. Every destination validation clause has a reaching test.

Automated evidence:

- 271 protocol, 559 core, and 349 host library tests passed. The initial sandboxed broad run failed
  four existing socket-binding tests with `Operation not permitted`; the same suites passed with
  loopback access. The new tests cover ACE wire ordering/truncation, all three permissions,
  server-style private permission revocation, lifecycle denial, and invalid destination admission.
- 456 frontend tests across client, map, and host transport passed. App type checks, frontend lint,
  dead-code checks, Clippy for affected packages/all targets with warnings denied, and formatting
  passed. Existing upstream binrw future-incompatibility notice remains.
- Both canonical browser suites passed: map gestures were exercised during streaming and ready;
  jitter/drag classification has focused unit coverage, and the panel probe checked cancellation,
  permission revocation, hiding, tab switching, and a clamped whole-world drag. The actual shell
  received a CDP click through its lifecycle transport and rejected clicks before permission and
  after revocation. Prior reset, resize, hover, retained-view, and scene-input checks also passed.
- The non-interactive live probe now accepts typed map requests, checks exact horizontal arrival,
  drives the existing camera/reveal lifecycle, and requests a return to the source. A separate
  optional water point checks ACE's diagnostic without a transition. These live assertions remain
  unverified; they are diagnostic capabilities, not evidence of successful interoperability.

Live attempt used existing local development credentials without printing them or passing them in
arguments. It received `authenticating`, then `exiting` with cause `server-disconnect`, and failed
with `timed out waiting for character-selection lifecycle after 45000ms`. Its last completed phase
was `client-start-requested`. No map request or character relocation occurred. Per the user's
instruction to stop at a major blocker, implementation work stopped here pending a usable live
login. Do not mark the goal complete or the live-check task above done.

Logs: `/tmp/map-teleport-{rust-tests,core-tests,host-tests,ts-tests,all-ts-tests,ts-check,lint,dead,
clippy,format,browser,client-browser,live}.log`. No screenshots were visually inspected. Remaining
work: live teleport/return and water rejection, confirmation of the actual h3d reveal/marker after
arrival, and final completion audit after that evidence is available. No code-level blocker was
confirmed by the automated checks.
