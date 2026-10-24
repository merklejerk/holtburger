# h3d character creation and selection

Status: implementation and final verification are complete. The user accepted creator and picker visuals. All phases and steering checkpoints are closed; synthetic server flows and production-content diagnostics provide automated acceptance evidence. No real server character was created.

## Goal and boundaries

Deliver a character creator with an editable 3D preview and retail background, and a character picker with previews reconstructed from locally saved gameplay appearances.

In scope:

- Make existing presentation assets available before world presentation starts.
- Extend the isolated preview to support appearance replacement, attached equipment, an optional background, rotation, and face/body framing.
- Migrate the inspector to the same equipment-capable preview path.
- Expose the existing creation rules and protocol through the h3d host, implement the creation UI, and reconcile successful creation into the authoritative roster.
- Save complete player visual captures during gameplay and display them at selection.
- Verify asynchronous replacement, resource ownership, protocol responses, and persistence failures.

Out of scope:

- Server extensions or requests for offline character appearances.
- A new renderer, general scene framework, arbitrary attachment hierarchy, or simultaneous animated previews for every roster entry.
- Terrain, portal traversal, collision, live movement, regional weather, or positional audio in previews.
- New deletion/restoration UX, a general logout/character-switch feature, or authentication redesign. Preserve existing behavior and correctly handle roster refreshes.
- Exact reproduction of every retail layout or decorative interaction. Reproduce the appearance/content semantics; use existing h3d UI conventions.

The user authorized implementation and asked to stop for a major blocker/gap or when visual review is needed. The clothing-contract gap was reported, the user chose template IDs throughout, and implementation resumed. No live server character has been created.

## Ground truth and existing paths

Use these references before changing their corresponding behavior:

| Concern | Reference |
| --- | --- |
| Roster fields and ordering | `ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessageCharacterList.cs`; `Network/Handlers/AuthenticationHandler.cs` |
| Creation success, rejection, and entry handshake | `ACE/Source/ACE.Server/Network/Handlers/CharacterHandler.cs`; `ACE/Source/ACE.Entity/CharacterCreateInfo.cs`; `crates/holtburger-protocol/src/messages/character/types.rs` |
| Retail creation viewport and appearance composition | `acclient-eor-source/acclient.c:273058–273497`, `gmCG3DView::{Initialize,Update}`; `gmCGAppearancePage::{ZoomIn,ZoomOut,Update}` at lines 177471, 177525, 178899 and `InitializePage` at 179748 |
| Creation data | `ACE/Source/ACE.DatLoader/FileTypes/CharGen.cs`; `ACE/Source/ACE.DatLoader/Entity/{HeritageGroupCG,SexCG}.cs`; `crates/holtburger-dat/src/file_type/char_gen.rs` |
| Server appearance and equipment | `ACE/Source/ACE.Server/WorldObjects/{Creature_Networking,WorldObject_Networking,Player_Networking,Creature_Equipment}.cs` |
| Existing creation catalog/rules/UI precedent | `crates/holtburger-content/src/character_gen.rs`; `crates/holtburger-core/src/character_gen.rs`; `apps/holtburger-cli/src/pages/selection/creation.rs` |
| Existing isolated preview | `apps/holtburger-3d/src/lib/game/{preview,renderer/webgl2-preview-renderer.ts,runtime/object-preview-source.ts}` |
| Current ownership | `src/client/{client-presentation-session,client-object-preview-service}.ts`; `src/lib/game/runtime/{game-presentation-owner,presentation-asset-service}.ts` within h3d |
| Capturing accepted appearance | `crates/holtburger-core/src/client/{entity_visual_facts,object_preview,dynamic_entity_view}.rs` |
| Ownership, equipment, readiness | `crates/holtburger-world/src/{attachment,entity_appearance}.rs`; `state/{storage,mutations}.rs`; `crates/holtburger-core/src/client/mod.rs` activation checks |
| Host/content boundary | `apps/holtburger-3d/host/src/{shared_host_content,client_runtime,client_host,client_projection,setup_visual_source}.rs` |
| Persistence precedent | `apps/holtburger-3d/electron/{client-settings-store,client-profile-key}.ts`; `src/client/client-settings-persistence.ts` |
| Snapshot recovery and browser contract admission | `host/src/client_host.rs:228` (`forward_client_events`); `src/client/{client-host-contract,client-lifecycle-session}.ts`; `src/lib/host/host-transport.ts` within h3d |
| Current preview remount and additive residency | `src/client/ClientInspectionWindow.svelte:159`; `src/lib/game/renderer/webgl2-preview-texture-residency.ts` within h3d |
| Capture invalidation and remote-child completeness | `crates/holtburger-core/src/client/entity_facts.rs`; `crates/holtburger-world/src/state/attachment_lifecycle.rs` |
| Main-process shutdown and preload | `apps/holtburger-3d/electron/{main.ts,preload.cts}` |

The retail decompile is read-only. Resolve discrepancies from code and references; do not fill them with guessed asset IDs or appearance rules.

### Evidence from the investigation

- `CharacterList` carries character ID, name, deletion metadata, slot capacity, and account flags. It carries no appearance.
- The local `dats/assets.hba` character-generation table has 13 heritage entries referencing six distinct backgrounds. Each referenced background setup has one model part and zero default animation/script/motion/sound/script-table IDs. This was a read-only record inspection, not a material-closure or visual acceptance check.

| Heritage | Background setup |
| --- | --- |
| Aluvian | `0x020005A1` |
| Gharu'ndim, Gear, Olthoi, OlthoiAcid | `0x020005A4` |
| Sho | `0x020005A5` |
| Viamontian | `0x0200196B` |
| Umbraen, Tumerok, Lugian, Empyrean, Penumbraen | `0x0200196C` |
| Undead | `0x02001A1E` |

- Retail adds the background setup and character to a dedicated viewport. These backgrounds do not require loading an EnvCell/portal scene.
- The preview machinery already shares object materials, animation, effects, and particles with world presentation, without joining its scene.
- Its resource provider currently starts world presentation, including active-region loading, world GPU resources, audio, portal-transition assets, and sky.
- The preview is one immutable model capture. Its public handle can change viewport policy, but cannot replace appearance in a retained renderer.
- The creation catalog drops base/hair/face `ObjDesc` data preserved by the DAT decoder. Existing clothing/palette resolution can be reused.
- Explorer NPC generation has randomization and server-emulation semantics. It is not the player-creation resolver.
- ACE announces equipped IDs/slots in `PlayerDescription`, then sends item descriptions. World retains this roster and activation already checks containment hydration.
- Core currently discards `max_slots`; h3d has no creation command/response surface. ACE acknowledges successful creation without resending the roster.
- Existing local character identity is server endpoint plus GUID. Use that identity rather than adding account identity without a demonstrated need.
- Creation commands currently enter core as prebuilt wire requests. `CharacterGenBuilder` is a reusable library helper, not an automatic validation step in `ClientCommand::CreateCharacter`. Runtime admission must additionally guard lifecycle, capacity, and overlapping management operations.
- Host event forwarding suppresses deltas while awaiting the initial/recovery application snapshot. A creation result or gameplay capture exposed only as a one-shot event can be lost to recovery.
- Inspector markup keys the preview by revision, and `ClientCreaturePreview` opens its handle only on mount. Both must change to make replacement retain the device. Preview texture residency currently accumulates additions until destruction; retaining the renderer without changing residency would leak obsolete textures across edits.
- `EntityFactsPublication` drains `world.take_storage_changes()`. A new snapshot producer must not independently drain that same change set.
- World retains parent-announced children before their descriptions arrive. Enumerating only hydrated child entities cannot prove a remote creature's attachment capture is complete.
- Browser `beforeunload` does not await the existing settings flush callback. Electron's `before-quit` can await main-owned work, so the visual cache will stage accepted captures and debounce disk writes in main rather than leave the latest capture in a renderer timer.
- Despite its name, `WorkerTexturePreparer` currently wraps host requests and in-flight coalescing; it does not create a browser worker. This work does not require adding one.

## North Stars

Use these principles to choose between implementations and reassess scope at the steering checkpoints:

- **One visual pipeline:** Creator, picker, and inspector reuse the existing preview machinery.
- **Pre-game stands alone:** Previews load content without activating world systems.
- **Resolve once, render faithfully:** Owning layers supply complete appearance and equipment facts.
- **Keep ownership explicit:** Asset lifetime follows the client; preview lifetime follows its surface.
- **Build for the demonstrated workload:** Support one character, equipment, and an optional backdrop. Introduce abstractions only when these consumers require them.
- **Preserve useful state through uncertainty:** Stale work cannot replace current visuals; incomplete captures cannot overwrite complete ones.
- **Cut over cleanly:** Migrate consumers together and delete superseded paths.

## Constraints and concessions

1. Preserve crate boundaries: DAT decodes; content interprets static records; world owns accepted entity/storage/attachment facts; core owns reusable creation validation and capture behavior; h3d owns presentation, navigation, and persistence policy.
2. Compute appearance/attachment decisions once at their owning layer. The frontend renders explicit facts rather than reinterpreting equipment flags or creation choices.
3. Keep one displayed preview and one active preview device. Character thumbnails and multiple simultaneous preview contexts are unnecessary.
4. Keep the mounted preview device alive across edits and selection changes. Release replaced assets, bound pending work, and reject stale preparation results.
5. UI drafts and lifecycle are cold reactive state. Animation, transforms, rendering, and frame scheduling remain imperative.
6. Never store world bodies, positions, velocity, live simulation runtimes, or decoded/GPU assets in the appearance cache.
7. Unseen characters may display a clear placeholder. Cached previews are explicitly last observed, and can be stale after using another client.
8. A cache error may make that preview unavailable; it must not prevent character selection or world entry. Report the error without replacing valid saved data with an incomplete capture.
9. No arbitrary quiet-period heuristic establishes protocol completeness. Debounce limits disk writes; it does not prove a snapshot is complete.
10. Prefer existing helpers and focused functions. No preview plugin system, generic persistence platform, or new dependency is justified in advance.

## Data flow and ownership

```text
Creation draft (h3d UI)
  -> validation/request building (core)
  -> static visual resolution (content, through h3d host)
  -> character visual + optional heritage background
                                             \
Inspector capture (core/world accepted facts) -> isolated preview preparation
                                             /    -> retained WebGL2 preview
Gameplay capture (core/world accepted facts) /         -> canvas
  -> immediate typed IPC to Electron main
  -> main-owned staging and debounced atomic cache write
  -> picker cache read/validation ------------/
```

Use a small explicit composition: one character visual, a flat list of its attached visuals, and an optional independent background. Attached visuals carry their own appearance/scale and the resolved parent location and child placement. They do not carry independent world transforms.

Keep request correlation separate from visual identity. Creation drafts do not need a fabricated world GUID. Reuse existing visual fields, extracting a smaller common value only where these concrete consumers require it.

Content resolution returns content-layer setup/appearance data, using existing DAT/content representations where possible. It must not introduce a dependency from `holtburger-content` to `holtburger-world` or `holtburger-core`. Normalize that result into the shared runtime appearance contract in the existing core/host adapter direction.

Appearance choice validation belongs with the content-owned appearance input and catalog interpretation. Core adapts wire choices to that input and incorporates its validation errors into full-build validation; the host uses the same validation for appearance-only resolution. Core retains name, budget, skill, privilege, and submission rules. Do not make content depend on protocol types or keep a second implementation of appearance rules in core. Browser validation is admission feedback, not the authority for those rules.

The app client composition owns content-backed presentation assets. World presentation and isolated previews borrow them and release their leases. On application shutdown, retire borrowers before destroying asset services and host transport. Do not make an inspector mount own shared sources.

The preview controller owns asynchronous preparation and the latest requested revision; the renderer owns its device resources. Prepare a complete replacement, atomically install it if still current, then release the previous visual. Preparation failure retains the last successful visual with an explicit error state. Disposal releases active and pending acquisitions exactly once.

Bound replacement to one installed visual, one preparing replacement, and one latest pending request. An installed visual is a bundle of appearance/geometry/texture/pose/effect leases. Stage new bindings without mutating those used by the active draw; commit synchronously between draws, or release the staged bundle on failure/staleness. Rebuilding this bounded visual bundle is acceptable. Preserve the device/program and reuse existing immutable repositories; do not invent a fine-grained GPU diff engine.

Apply the same latest-request policy before static host resolution: one resolving appearance and one latest pending appearance. Correlate completion to the draft revision before handing it to preview preparation. Renderer-side coalescing alone does not bound queued host work. A superseded caller receives an explicit superseded outcome; cancellation does not imply that an already dispatched host command was canceled.

Creation management state and the latest complete local-player capture are retained levels with matching snapshot and delta projections. Creation has one outstanding operation; a browser request/revision identifies local work but cannot correlate server responses that contain no request ID. Retain the last result until superseded by the next operation or a defined character/session boundary. Do not retry an uncertain create automatically.

Electron main validates and stages each complete capture under a server scope derived from launch configuration, acknowledges acceptance, and owns write coalescing. The browser never supplies a filesystem path or arbitrary endpoint. Main closes write admission, drains accepted work, and flushes staged captures during orderly shutdown. No guarantee depends on an async renderer unload callback. An unclean exit can lose captures not yet committed to disk.

Camera fit includes the character and visible attachments. Background geometry affects required clipping coverage, but never character framing. Character heading changes independently of the background; inspection orbit behavior may retain its existing policy. Face zoom is a concrete creator control, not a general camera scripting API.

## Phased implementation

### Phase 1: Establish pre-game contracts and close protocol gaps

Deliverables: core character-selection state/types and response handling; h3d host/projection contracts; creation catalog queries and typed draft contracts.

- [x] Retain server `max_slots` in the core-owned roster contract and project it to h3d. Migrate touched consumers in one cutover rather than maintaining duplicate roster facts.
- [x] Trace full-slot/deletion behavior and roster ordinals against ACE and the retail client before assigning `character_slot`. Never derive server slots from an alphabetically sorted UI list.
- [x] Expose creation catalog/allowed choices through `shared_host_content.rs`, without requiring world activation. Reuse `CharacterGenCatalog` and `CharacterGenBuilder`; define a narrow host projection rather than serializing implementation internals wholesale.
- [x] Add a semantic h3d creation draft DTO. At the host adapter, call the existing core `CharacterGenBuilder` over the content-owned catalog to validate/build the existing wire request, then enqueue the existing core command. Core continues to supply account identity. Keep wire constants and privileged flags out of browser input; no new catalog dependency in the transport runtime is needed just to call the builder.
- [x] Add core admission guards for character-selection lifecycle, advertised capacity, and a single pending character-management operation. Guard entry as well as creation while management is pending; UI disablement alone is insufficient. Retain the pending create metadata needed for response handling, and unwind it on send failure. Distinguish command enqueue/admission from server confirmation.
- [x] Cover both `CharacterCreateResponse` and applicable selection-phase `CharacterError` replies (for example, ACE's world-closed creation rejection), plus boot/disconnect. A generic action-result toast does not resolve the pending creator operation. Retain a typed rejected/terminal result where the reply proves it; if completion is uncertain, expose that state and allow disconnect rather than timing out into an automatic retry.
- [x] Retain pending/completed creation state in `ClientApplicationSnapshot` and expose it through `ClientCurrentState`, matching delta events, `client-host-contract.ts`, `client-lifecycle-session.ts`, and the host command/event registries. Resync must recover rejection feedback and release pending UI even if the result event was suppressed. A full roster refresh must not silently erase an unresolved create and enable an unsafe retry.
- [x] Reconcile successful create responses into core's retained roster using confirmed GUID/name and pending operation metadata. Publish a reconstructible lifecycle update; preserve failure feedback and handle duplicate/stale responses without duplicate entries.
- [x] Check the TUI's existing local success insertion and migrate any now-duplicated roster handling. Preserve authoritative response ordering across current-state snapshots and events.

Acceptance: synthetic packet/host tests prove slot capacity survives projection; failed creation leaves the roster unchanged; successful creation appears once without a second `CharacterList`; UI reload/current-state reconstruction retains it. Include direct host calls outside selection, duplicate submission, send failure, both creation-response and `CharacterError` rejection paths, disconnect, result/roster refresh interleavings, and broadcast lag across both success and rejection. Repeated protocol replies cannot be attributed by a fabricated server request ID. No live server mutation is needed for these checks.

Execution notes:

- Removed the duplicate roster payload from `ClientState`; retained roster entries and capacity have one core owner. Removed unused `EnterWorld` and frontend first-free-slot assignment. Core assigns ACE's append ordinal immediately before sending.
- Creation/restore results now update that roster, with snapshot/delta management state and TUI consumers reading authoritative metadata. A roster refresh before the create ACK does not duplicate the new character or erase its pending operation.
- Character command admission failures are recoverable domain feedback. The existing run loop terminates on `Err`, so ordinary full-roster/overlap/lifecycle rejections return `Ok` after publishing feedback. Actual send failures retain the transport error path.
- Widened unvalidated attribute totals to prevent overflow before the shared builder can report malformed host drafts.
- Added `load_character_creation_catalog` and `create_client_character`, a narrow catalog projection and semantic draft, and matching strict browser contracts. Catalog assembly lives in content and is reused by the TUI.
- Verified 377 host, 321 TUI-library, and 701 core tests; 3,377 TypeScript tests plus a subsequent focused 64-test run; `npm run check`, TypeScript lint, and Electron-main build/runtime checks. Socket tests require unsandboxed local UDP access; they passed with that access.
- Read-only production-content probe passed through the real client-mode stdio sidecar and browser catalog decoder: 13 heritages, 55 skill slots, five starting areas, all template skill-vector lengths valid, host still `client-host-ready`. No network client was started and no server character was created. Probe output: `/tmp/h3d-pregame-catalog-probe.json` (session-local diagnostic, not a permanent fixture).

### Phase 2: Separate asset lifetime from world presentation

Deliverables: h3d client composition ownership, `game-presentation-owner.ts`, `client-presentation-session.ts`, and preview service wiring.

- [x] Construct the existing `PresentationAssetService` lazily from static host capabilities at client-composition scope.
- [x] Inject it into world presentation and preview preparation. Remove the preview dependency on `ClientPresentationSession.start()`.
- [x] Preserve Explorer's ownership through its composition; do not introduce a universal client/Explorer owner or command dispatcher.
- [x] Move teardown responsibility with ownership. Update failure rollback, cancellation, and shutdown ordering; do not double-destroy host sources or the texture preparer. Keep the world borrow explicit, so failed world construction cannot destroy the app-owned service. Migrate Explorer factories/callers to an explicit owned lifetime rather than an optional injection/fallback ownership mode.
- [x] Portal-transition loading currently borrows setup/animation host sources directly. Preserve those narrow loading capabilities at the asset owner or adapt the loader to existing repository acquisitions; do not re-create and separately destroy duplicate source instances.
- [x] Update `ClientApp.svelte` composition and cleanup, preview-service access, presentation factory dependencies, and affected harness/test factories together. Asset construction must depend on host/session lifetime, never preview payload or frame-rate reactive state. Await borrower retirement before clearing transport; Svelte effect cleanup itself is not an awaited shutdown owner.
- [x] Keep audio, sky, active-region loading, collision, and portal-transition resources world-owned.

Acceptance: a pre-game preview loads through production asset adapters while instrumentation confirms no active-region request or world renderer/audio creation. World entry reuses the asset owner; world teardown does not destroy assets borrowed by a pre-game preview. Shutdown releases every lease.

Execution evidence to reconcile at acceptance: `HostPresentationAssets` now owns the shared content capabilities; client and Explorer world factories borrow them. Focused tests include failed world startup without destroying shared assets. The existing pre-game browser probe reports a real backdrop draw, no browser errors, shared assets surviving preview retirement, and zero remaining setup leases. This proves the isolated path and focused lifetime cases; it does not replace the later integrated world-transition and replacement checks. Withdrawing a Svelte transport reference is not closing the actual host transport; shutdown ordering applies to the captured transport capability and its owning process.

The complete TypeScript suite subsequently passed: 378 files and 3,379 tests, before phase-3 contract changes.

### Phase 3: Resolve creation appearance from static content

Deliverables: focused resolution in `holtburger-content`, host query/response, and reusable core validation where needed.

- [x] Preserve or privately read the DAT appearance descriptions omitted by the UI-oriented catalog. Avoid expanding every public option type if a content-owned resolver can consume the raw records directly.
- [x] Resolve base setup, alternate setup/body styles, scale, base appearance, hair/face substitutions, palette shades, and starter clothing using retail composition order.
- [x] Reuse `ContentRepository::build_clothing_obj_desc`, palette-set selection, existing appearance normalization, and motion-sequence interpretation.
- [x] Resolve valid intermediate appearance drafts without requiring a completed name, skills, or attribute budget. Full submission still uses `CharacterGenBuilder` validation.
- [x] Resolve creator idle animation identities from retail references and their content enum mapping. The creator need not use the inspector's default idle if retail uses a distinct sequence. Keep camera/zoom/lighting policy in h3d; content returns authored visual facts rather than frontend camera decisions. Retail zoom uses heritage-specific positions; h3d keeps idle unchanged in Face mode at the user’s request and derives bounded framing without assuming every body has a human head part.
- [x] Define appearance-only validation shared by preview resolution and full build validation. Check finite hue ranges, required/optional index sentinels, dependent choice changes, and alternate setups once; do not require a valid name/attribute/skill draft to turn the preview. Preserve base-100 scale conversion (`PlayerFactory.cs:61`) in the content-owned result.
- [x] Extract only the visual value needed by creation from the existing identity-bearing preview source. Keep examined GUID/result correlation in the inspector envelope; the creation result carries no fabricated world identity. Update Rust/host/browser contracts and their current consumers together so this phase compiles before retained composition is added in phase 4.
- [x] Make ordered `ObjDesc` composition reuse the DAT material module's existing retail texture/part/palette replacement helpers, after checking `ObjDesc::operator+=`. Preserve expanded palette color units across the host adapter; do not expand them a second time as protocol groups. Pass validated garment-specific palette-template keys directly to the existing clothing resolver; UI ordering is not wire identity.
- [x] Reuse `UiAssetReader::enum_did` for the retail group-7 animation lookup; do not introduce another mapper reader or hard-code resolved animation DIDs. Enumerate unsupported animation hooks as part of the content diagnostics.
- [x] Return explicit visual facts and the heritage background identity. Do not route player creation through randomized Explorer NPC generation.
- [x] Check all catalog heritages/genders and alternate setups; honor existing client policy and server rejection rather than silently adding a humanoid-only restriction.

Execution findings and decisions:

- The initial body-style census exposed 22 Gear/Olthoi cases that attempted inappropriate clothing. Content now identifies those heritages as not using starter clothing, matching ACE `PlayerFactory.Create` and retail's hidden controls. Their projected garment lists are empty; the rest of the visual remains available.
- **Resolved major gap: clothing color semantics.** Retail `CharGenState::StoreColorInformation` (`acclient.c:472586`) filters each garment's actual palette templates against the gender whitelist and requires subpalette effects. Retail converts display ordinals into those keys before populating `charGenResult` (`acclient.c:472337–472410`); ACE `PlayerFactory.GetClothingObject` (`PlayerFactory.cs:420`) consumes the key directly. The user selected actual keys throughout the semantic draft, preview, validation and submission. The previous gender-wide color count has been removed.
- Content assembles garment-specific keys once into the catalog and shares their interpretation with appearance-only resolution. A garment with no eligible palette effects explicitly offers key zero, matching retail's no-overlay behavior. UI ordering is deterministic and need not reproduce retail's internal hash-table iteration order.
- The existing TUI has no manual color editor/cycler: it calls shared appearance randomization at submission. That randomizer now selects the garment and one of its actual template keys together. Its fixtures and the h3d catalog/schema migrated with the shared contract.
- Asset-independent fixtures verify filtering, nonzero keys that differ from ordinals, invalidation when switching between garments with distinct colors, direct clothing composition, and rejection of a submitted ordinal in place of a template key. The shared builder preserves the validated key in the wire request.
- Production census: all 3,281 cases passed static resolution plus setup/material closure: 869 body styles and 2,412 offered garment/color combinations. The initial diagnostic hit its own five-minute limit after 1,900 verified cases; the remaining 1,381 passed on a resumed sweep. The prefix log and resumed JSON are `/tmp/h3d-pregame-appearance-prefix.log` and `/tmp/h3d-pregame-appearance-probe.json` (session-local evidence). No network client was started.
- Browser evidence: all 26 offered bodies prepare their idle and held-rest poses through production preview preparation; all six backgrounds prepare; the Aluvian character draws 16 ranges. No browser errors, shared assets survive preview closure, and setup reference count returns to zero. This verifies runtime behavior and resource lifetime, not visual acceptance.
- Broad checks: 377 host, 321 TUI, 114 content, 703 core, 131 DAT, and 971 world tests passed (three existing world tests ignored). The complete TypeScript suite passed 3,380 tests across 378 files. The expanded harness also passed app type checks, TypeScript lint and its runtime probe; affected-package all-target Clippy passed with warnings denied.

### Steering checkpoint A

- [x] Trace one draft end to end through host resolution and pre-game asset preparation.
- [x] Confirm the new public fields have named consumers and the shared crate boundaries remain intact.
- [x] Reassess code growth. Remove redundant adapters and avoid building a general composition framework around the two required object relationships.
- [x] Record unresolved content exceptions before implementing UI policy around them.
- [x] Prove one weapon and one shield can be placed on a chosen stable preview pose using existing attachment/holding-location semantics. Choose the shared display pose and capture policy here, before phase 4 hardens the composition contract. If the required facts are absent, bring the narrow phase-5 capture investigation forward rather than guessing placements or leaving the decision until persistence.

Steering decisions:

- Preserve the existing default motion-table idle for captured gameplay characters; persist a deliberate equipment-display view rather than a transient live animation. Player equipment uses accepted holding relationships; phase 5 proved that missing links should remain pending instead of requiring server-only classification properties. Keep accepted live attachment placement for generic creature inspection. Phase 7 records the implemented visual-normalization policy.
- A read-only catalog diagnostic identified Short Sword WCID 352 / setup `0x02000148` at right-hand placement 1 and Round Shield WCID 93 / setup `0x02000162` at shield placement 6, resolving through retail fallback 0. The temporary Rust diagnostic was removed. The browser probe uses the production holding-location/placement and part-transform helpers to check three sampled part frames for each item on the creator idle. Actual equipment drawing/framing remains phase-4 acceptance.
- No general scene graph or separate creation renderer is needed. Keep the flat composition contract. The required content/protocol adapter is explicit because those crates cannot depend on one another; no serialization round trip is used. The catalog now carries garment-specific keys instead of a redundant global count.

### Phase 4: Make preview replacement and composition reusable

Deliverables: `lib/game/preview/*`, `webgl2-preview-renderer.ts`, camera fitting, preview contracts/service, and the existing canvas component.

- [x] Add source replacement to the retained preview controller/renderer with a per-request completion/error result. The existing one-time `ready` promise is insufficient to report later failures. Preserve device/program lifetime; replace the bounded visual bundle rather than requiring fine-grained per-field GPU updates.
- [x] Coalesce rapid edits to the latest request and enforce revision checks. Release obsolete preparation results and prevent late completions from reviving disposed previews.
- [x] Support one optional independent background setup and flat character attachments. Reuse the object draw/material pipeline, pose sampling, effect/particle behavior, holding-location resolution, and child placement math.
- [x] Replace the texture residency's lifetime-only accumulation with bundle-owned release or an exact required-set lifetime. Account for shared textures across body, equipment, backdrop, and a staged replacement. Release obsolete geometry, materials, pose allocation, and particle/effect state as well as CPU leases. Preserve opaque/transparent/additive ordering across the complete composition, not independently per model.
- [x] Add body/face framing and independent character heading. Include attached visuals in fit; keep background out of fit while ensuring clipping planes encompass rendered background geometry.
- [x] Keep existing neutral inspector lighting; add only the lighting/camera inputs the creator actually needs.
- [x] Stop hidden rendering and animation time through the existing viewport suspension path. Keep one-active-preview admission and ensure route transitions retire the old preview before admitting the next.
- [x] Consolidate the actual shared canvas/rotation behavior from `ClientCreaturePreview.svelte`; leave creator controls and inspector layout with their consumers.
- [x] Remove `{#key preview.revision}` in `ClientInspectionWindow.svelte` as a resource-lifetime mechanism and forward source changes to the retained handle. The new shared preview surface reacts only to cold source revisions and explicit viewport policy; it must not rebuild its owner on source publication. Identity-bound inspector window lifetime can remain separate from same-surface appearance replacement.
- [x] Land this phase in compilable steps: first same-model source replacement and bundle retirement, then backdrop/attachment composition and framing, then component cutover. Provide explicit subject withdrawal while retaining the device, so phase 8 can hide a previous character immediately without abusing viewport suspension or showing the previous subject when rendering resumes.

Acceptance: unit tests cover transformed attachment fit and camera policies. Browser harness exercises replacement races, failed replacement, source changes during teardown, hidden/resumed rendering, and rapid edits. Device lifetime is stable across edits; repeated distinct texture/appearance replacements plateau at the active-plus-staged workload and retained resource counts return to baseline after close. Failed staging preserves the prior drawable composition. Do not claim performance improvements without measurement.

Execution notes:

- `WebGL2PreviewRenderer` now owns the mounted context and object program; a private GPU visual bundle owns textures, geometry, material/pose tables, samplers and particle residency. Bundle replacement preserves the program and stages disjoint resources. Each bundle receives a fresh particle-mesh source, so retiring the previous cache cannot close the next source.
- `ObjectPreviewController` has one preparation loop for initial loading and later edits, one latest pending request, revision admission, per-request completion, and explicit subject withdrawal. GPU/CPU installation changes synchronously between draws. CPU lease ownership transfers at installation; previous GPU retirement may complete later without causing a second release if the new subject is withdrawn meanwhile.
- Failed current preparation rejects its own request and retains the last installed visual. Obsolete request failures cannot overwrite current UI feedback; failed ownership cleanup remains observable at shutdown. Disposal waits for preparation and staged resources before closing the device.
- Browser evidence: 12 real appearance edits used one native context request and one object program. Native texture peak was 43 within the active-plus-staged ceiling; all 332 created texture objects were retired. An injected allocation failure after two staged uploads preserved the previous drawable model. Hidden preparation did not resume rendering; withdrawal cleared the old subject while keeping the device. Shutdown reported zero live programs/textures/buffers/vertex arrays and zero setup leases. `/tmp/h3d-pregame-retained-browser-proof.log` is session-local evidence, not visual acceptance or performance timing.
- The full TypeScript suite passed 3,394 tests across 380 files. App type checks and TypeScript lint passed. The production Svelte surface was also mounted, edited and unmounted in the browser probe: one open, one replacement, one context/program, and zero retained native GPU resources after unmount.
- Composition flattens body, direct attachments and independent backdrop into the existing merged geometry/material layout. This preserves one GPU state/program writer and global opaque/transparent/additive ordering without a scene graph or separate model draw passes. Model animation/effects runtimes remain distinct; attachment frames exclude geometry scale. Particle record streams merge dirty spawn intervals, with the particle program retained at device lifetime.
- The expanded browser probe prepared all 26 heritage/gender bodies in idle/rest and six backdrop closures. It checked sword/shield compiled part frames against shared placement math, independent subject rotation, body/face framing, hidden replacement, failure rollback and bounded retirement. The native object context/program survived 12 edits; final GPU resources and setup leases were zero. `/tmp/h3d-pregame-composition-browser-proof.log` records machine evidence; it does not approve visual appearance.
- `ClientModelPreview.svelte` now owns shared canvas/gesture behavior. Cold sources replace the retained bundle; source failures preserve the previous successful visual with a diagnostic. The inspector revision key was removed. Pointer-rate heading stays outside Svelte state. Creator controls remain a later consumer task.

### Phase 5: Capture equipment and migrate the inspector

Deliverables: `core/client/object_preview.rs`, world fact queries if necessary, h3d preview contracts, and inspector integration.

- [x] Extend capture to include visible separately rendered equipment using accepted ownership and attachment facts. Keep worn armor/clothing already present in the body appearance; do not repaint it a second time.
- [x] Inspect the distinction between equipped items and currently attached/visible items. Use accepted holding-location/placement facts for the equipment display; never infer missing live facts from server-only classification properties. The investigation below justifies waiting for the announced relationship instead of fabricating a fallback.
- [x] Define an explicit equipment-ready capture result for missing descriptions/required visual facts. Do not silently turn a partial capture into a complete equipment preview.
- [x] Preserve generic creature inspection: use accepted attachments for non-player creatures without forcing them through player-only equipment queries.
- [x] Add a narrow read-only world query for expected direct attachment children, including unresolved announcements, if existing APIs cannot express them. A remote creature with an announced but unhydrated child must not be reported as a complete weapon-free capture. Do not change missing-object retention/deadline semantics or add a duplicate child registry. Later appraisal may retry capture; no perpetual remote-preview subscription is required.
- [x] Migrate inspector capture, wire decoding, and rendering in one cutover. Retain capture independence from later despawn and remove superseded one-model paths.

Acceptance: fixtures cover armor baked into the body, weapon/shield placements, bow/caster distinctions where classified, empty equipment, missing item descriptions, and capture survival after source entities disappear. Browser evidence verifies attachment transforms follow the preview animation and participate in framing.

Execution notes:

- ACE `Creature_Equipment.IsInChildLocation` (lines 463–470) keeps every Selectable slot as a visible child, including noncombat mode. `GetPlacementLocation` consumes the actual wielded slot, and missile handedness additionally reads server-only `DefaultCombatStyle`. Capture therefore preserves accepted relationships; a missing held relationship is pending equipment, not a reason to guess placement from template eligibility. This narrows the earlier fallback proposal and avoids introducing a private server-property prerequisite into live client capture.
- Local-player capture requires an announced equipment roster, known masks and hydrated equipment descriptions. It includes separately rendered selectable equipment and excludes transient ammunition; worn armor/clothing stays in accepted body appearance. Generic creatures capture all expected direct children, including announcements whose descriptions have not arrived. No new registry or deadline policy was added.
- `ObjectPreviewSource` is now body plus flat attachments. `ObjectPreviewVisual` is the identity-free one-model primitive shared with creation. Child relationships retain typed locations/placements through Rust and strict browser decoding; shared attachment vocabulary supplies numeric DAT keys at renderer admission. The old feed-specific placement map was moved, not copied.
- The inspector forwards the complete source to `ClientModelPreview`. Pending equipment withdraws its subject while retaining the mounted handle; the same empty-source capability serves the picker later. The browser probe verified withdrawal and restoration without a second context/program or a second mount.
- Focused capture tests prove pending announcements, later hydration, accepted bow handedness without DefaultCombatStyle, armor/ammunition exclusion, empty-roster replacement and independence from later entity removal. Wire fixtures cover named equipment placements and pending equipment. Full suites passed 377 host, 706 core and 971 world tests (three existing ignored), and 3,396 TypeScript tests. Affected-package all-target Clippy and app checks passed before starting creator acceptance.

### Phase 6: Deliver the complete creator UI

Deliverables: app-local creator owner/components, selection navigation, host session integration, and shared UI usage.

- [x] Add explicit picker/create navigation within character selection. Cancel returns to the picker without entering the world.
- [x] Implement heritage/gender and facial appearance, randomized starter clothing, Custom attributes/skills, starting area, name, review, submission, and rejection feedback using existing creation rules and UI primitives.
- [x] Keep one draft owner. Resolve preview changes only when appearance inputs change; changing a name or skill must not prepare a new model.
- [x] On heritage/gender changes, rebuild dependent choices and attribute/skill/template/start-area selections using existing rules before requesting a new preview. Keep nonvisual full-draft errors separate from appearance errors. A rejected draft remains editable; an unresolved submitted draft cannot be resubmitted by canceling and reopening the creator.
- [x] Complete the catalog projection with heritage-specific starting-area IDs, reusing the content query already consumed by the TUI. Keep the existing full-builder membership policy explicit: offering authored heritage choices does not silently change core's current permissive submission policy. Verify that every dependent UI choice is represented before building the controls.
- [x] Coalesce appearance-only host queries before dispatch and correlate their results to the current draft revision, then use the retained preview's separate replacement completion. An obsolete resolution or preparation error must not overwrite the current draft's success/error state. Exercise a hue-slider burst while the first host resolution is delayed.
- [x] Preserve heading/zoom across ordinary appearance edits. Prepare the latest draft asynchronously without rebuilding the WebGL owner.
- [x] Prevent duplicate submission, creation beyond advertised capacity, and world entry while creation is pending. Keep the draft after rejection.
- [x] On confirmed success, return to the picker and select the confirmed GUID from core's updated roster. Do not automatically enter the world.
- [x] Retain the placeholder policy for a newly created character until its first complete gameplay capture; do not add a second cache-seeding pipeline solely for this case.

Acceptance: synthetic host/browser flows exercise creation, cancellation, rejection/retry, successful roster reconciliation, all offered choices, and disconnect during preparation/submission. No live character is created without explicit authorization for that server-side action.

Execution checkpoint — specialization cost gap (2026-10-23):

- Implemented `ClientCharacterCreator.svelte` and `client-character-creation.ts`: one immutable draft owner, existing UI tabs/controls, appearance and garment-specific template keys, template/attribute/skill editing, review/start area/name, cancellation, retained body/face preview and static host-request coalescing. Name/build edits do not request new visuals. Completed visual results retain their heritage so a pending heritage change cannot pair an old model with new face framing.
- `ClientCharacterSelect` now owns picker/creator navigation and confirmed-GUID selection. `ClientApp` forwards retained management state and injects static/submit capabilities. UI and core admission both guard pending management. The shared surface accepts an empty subject without preparing a device and preserves the device through withdrawal/restoration.
- The new synthetic creator harness drives actual controls and validates drafts through a diagnostic-only production-builder endpoint. It never sends character creation to a real server. Its first end-to-end run stopped before submission because the selected authored template showed negative skill credits. Do not count the creator workflow as passed or claim a live creation.
- Proven cause: `ACE.DatLoader/Entity/SkillBase.cs:17–18` defines `SpecializedCost` as the **total including training**, and its `UpgradeCostFromTrainedToSpecialized` subtracts `TrainedCost`. `ACE.Server/Factories/PlayerFactory.cs:184–192` uses that upgrade amount for base skills but uses heritage `NormalCost`/`PrimaryCost` directly as training/upgrade overrides. Our `content/character_gen.rs::skill_costs_for_heritage` puts a base total or a heritage upgrade in the same `specialized_cost` field; core validation and TUI then add training to both. The new h3d accounting faithfully inherited the defect.
- A temporary read-only production-content diagnostic evaluated all **79 authored templates**. **66 templates across heritages 1–11** are over budget under current shared rules; all 66 cost exactly 52 under ACE's base/override interpretation. For Aluvian Bow Hunter the difference is 72 versus 52. The 13 remaining initial/custom templates are unchanged. `/tmp/h3d-pregame-skill-cost-census.log` is session-local evidence; the temporary Rust example was removed.
- Recommended correction: keep raw DAT totals intact, normalize reusable creation costs to explicitly named training and specialization-upgrade costs at the content boundary, preserve heritage overrides' existing upgrade semantics, and migrate core validation, TUI tier/spend helpers, host catalog and h3d together. Do not subtract training in the UI alone or change all raw fields uniformly; base and override inputs have different meanings. Add focused base/override fixtures and rerun the real-content census and creator acceptance.
- Verification at the checkpoint: 3,400 TypeScript tests across 381 files passed; app checks have zero errors/warnings and TypeScript lint passed. Phase-5 full Rust suites passed 377 host, 706 core and 971 world tests, and affected-package all-target Clippy passed. The diagnostic-only HTTP validation route compiled and ran in the failed creator probe. The creator acceptance remains red for the documented cost contract, not an infrastructure limitation.
- The user authorized the shared correction ("go for it"). Content now preserves raw `specialization_total_cost` and exposes normalized `specialization_upgrade_cost`; core, TUI, host catalog and h3d use that same contract. Heritage upgrade overrides stay unchanged. Unavailable totals retain the content-owned sentinel instead of becoming offered costs after subtraction.
- A second real-content census evaluated all 79 templates after the correction: zero mismatches with ACE, zero over-budget templates, and all 66 affected presets exactly fill their 52-credit budget. `/tmp/h3d-pregame-skill-cost-census-fixed.log` is session-local evidence; the temporary Rust example was removed. Focused tests cover base conversion, override semantics, sentinel preservation and full-build admission at the exact budget. Creator browser acceptance and broad regression checks are now being rerun.

Creator milestone verification and review:

- A second integration failure exposed unused SkillTable slots projected as Untrained by the new host template mapper. The mapper now keeps sparse holes Inactive; known skills alone receive interpreted template minima. The production-builder acceptance then passed.
- `PregameCreatorHarness.svelte` drove production UI controls through a delayed appearance-resolution burst, obsolete rejection suppression, body/face switching, template/name edits without appearance resolution, full build validation, pending duplicate/cancel guards, synthetic rejection/retry, confirmed GUID selection without automatic entry, cancellation and disconnect. It recorded two submissions, three appearance requests, zero automatic entries and zero retained GPU resources. `/tmp/h3d-pregame-creator-browser-proof.log` contains machine evidence and zero browser errors. No live character was created.
- Regression verification: 117 content, 707 core, 321 TUI and 377 host tests passed. All-target Clippy passed for those packages with warnings denied. All 3,400 TypeScript tests passed; app checks reported zero errors/warnings and TypeScript lint passed. Vite build succeeded with its large-chunk advisory; final phase-9 bundle review remains open.
- A manual, static-content-only creator view is available through the existing harness at `?pregame-preview=1&creator-showcase=1&contentHost=<diagnostic-host-url>`. Submission reports that no game server is connected. A machine probe verified the actual review route mounts all three tabs, presents controls, draws a model and has no browser exceptions. It did not visually approve the result.
- Review servers are deliberately left running for the user: content `http://127.0.0.1:42095` (restarted tool session 38562), Vite `http://127.0.0.1:34697` (session 91813). Review URL: `http://127.0.0.1:34697/harness/browser/?pregame-preview=1&creator-showcase=1&contentHost=http%3A%2F%2F127.0.0.1%3A42095`. Stop these diagnostic sessions when review is finished. They are session-local, not durable deployment configuration.
- User acceptance is pending for body/face framing, faces and clothing, heritage backdrops, rotation and alternate bodies. The user asked to stop when their eyes are needed. Do not mark the overall implementation complete: persistence, cached picker and cleanup remain outstanding. Complete broader disconnect-during-submission/preparation integration evidence at steering/cleanup in addition to the current core/session and navigation checks.

User visual-review feedback and changes:

- The user saw empty space behind the character rather than the backdrop wall. Retail places the creator camera at negative authored Y (`acclient.c:177525`) and initializes subject heading to 180 degrees (`acclient.c:180040`). Authored negative Y maps to render +Z; the inspector's inherited camera was on render -Z. The shared viewport now accepts an explicit fixed camera yaw for subject-rotation mode, and the creator surface supplies the retail camera side and heading together. Inspector orbit policy stays separate. Camera unit checks cover the corrected side; the production creator browser workflow passed after the change. Visual acceptance of wall placement is still the user's.
- The user requested randomized clothing instead of garment/style/color/shade controls. Those controls and their handler were deleted. Clothing is chosen once on initial body selection or heritage/body reset, using that garment's actual offered palette keys; facial, name and build edits preserve the selected outfit. Headgear randomization includes no headgear. A deterministic injected random source verifies key membership and unchanged face/build facts. The appearance UI now offers only body and facial choices.
- Face mode deliberately switches the idle to retail's held resting animation (`gmCG3DView::StopAnimation`, `acclient.c:273042`; invoked by ZoomIn at `177518`). The user's question was answered; no pose-policy change was requested or applied.
- Clarified that build templates do not change skill costs. They initialize attributes/advancement choices; ACE also saves the template name and awards its starting title (`PlayerFactory.cs:135–138`). Heritage owns skill-cost overrides (`184–192`). The corrected specialization accounting is independent of template selection.

- Follow-up user review identified the remaining empty corner as the view being wider than retail. The creator now presents a bounded 3:4 portrait viewport while retaining the corrected fixed camera direction. The live review route measured 353.5 × 471.328 CSS pixels (aspect 0.750008), drew a model, and had no browser errors. This is machine evidence of framing dimensions; the user still owns visual acceptance of backdrop coverage.
- Added the requested `Randomize clothes` action for bodies using starter clothing. It shares the same randomizer as initial outfit selection, changes only clothing, and explicitly clears old headgear when the new outcome is none. A focused test preserves edited face fields and input immutability; synthetic browser acceptance now clicks the action before validating/submitting the retained draft. The initial garment/color/shade control lists remain removed.

- Further user review requested camera-only Face mode, hidden headgear in Face mode, "Skills & Stats" naming, and Custom-only creation. The explicit rest-pose response/content preparation was removed. Face mode resolves a preview-only appearance with no headgear; the actual outfit remains in the draft and is restored in Body mode. Body appearance replacements now carry the animation cursor forward when the authored clip sequence is unchanged, rebasing on the new setup pose without replaying old hooks or retaining the previous runtime. Unit checks and production-content matrix checks prove no animation restart at the replacement boundary.
- Removed the h3d template selector, full preset catalog projection and browser `templateOption` field. The host selects `custom_template_for_heritage` for both projected starting values and submission. Sparse inactive skill slots remain preserved. Core/TUI's general template support is unchanged; this is h3d creator policy. The UI tab and its IDs now use Skills & Stats. The browser workflow edits the actual attribute controls to create a custom build rather than selecting a preset.
- Verification after this review: 3,405 TypeScript tests passed, app checks and TypeScript lint passed, 377 host and 117 content tests passed, and both packages' all-target Clippy passed. The production browser workflow passed with no browser errors and zero retained resources. A separate machine probe of the actual review URL verified Skills & Stats, no template selector, a real randomized headgear choice hidden in Face and restored in Body, portrait sizing and no browser exceptions. The static host was restarted on the same port to serve the updated contract; the review URL is unchanged.

- User accepted the revised creator as "good enough for now" after reviewing portrait framing, randomized clothing, headgear-free Face mode, Custom-only creation and the Skills & Stats label. This records creator visual acceptance for the current milestone; it does not approve unfinished picker/persistence behavior or replace remaining integration checks.

### Steering checkpoint B

- [x] Exercise creator and inspector through the same production preview path, and verify one preview device at a time.
- [x] Confirm preview resource ownership survives pre-game/world transitions and cancellation without starting unrelated world systems.
- [x] Review snapshot shape against the working equipment capture; persist only facts with a picker consumer.
- [x] Revisit remaining scope using measured failures rather than speculative compatibility requirements.

### Phase 7: Save complete player visual captures

Deliverables: reusable core capture/event contract; h3d capture/write owner; Electron typed cache storage and IPC.

- [x] Capture the body and equipment after existing initial containment readiness and required visual validation succeed. Reuse current equipment rosters; do not create a second equipment registry.
- [x] Use a deliberate preview pose/appearance policy. Do not accidentally persist death animation, portal fade, temporary invisibility, or world placement just because the live entity exposes them. Trace the relevant accepted fields before choosing normalization.
- [x] Observe relevant body, appearance, equipment, and attachment changes after message application. Capture on those cold changes, compare the complete result, and emit only changed captures. Avoid movement/frame-rate serialization.
- [x] Integrate a dirty marker with the existing event observation path and evaluate once after the complete message mutation, before returning to the event loop. Never add a second destructive `take_storage_changes()` reader: derive relevance from shared observed events or pass the already collected change set through its current owner. Cover setup, motion identity, server-authored base scale, appearance, storage membership, and attachment changes; movement and transient script-scale ramps alone must not cause capture/serialization.
- [x] Retain the latest complete player capture, keyed to the character lifetime, in core and `ClientApplicationSnapshot`. Project it into current-state recovery as well as cold deltas; a browser resync during a one-time equipment update must recover the same capture without needing another gameplay change.
- [x] Forward complete changed captures immediately through typed preload IPC. Keep debounce in Electron main's disk-write policy. A pending/incomplete capture retains the prior complete capture; normal equipment removal must still publish the new complete result.
- [x] Persist an explicitly versioned visual value under the existing endpoint/GUID identity. Store resource identities and visual/pose facts, not prepared geometry, arbitrary live animation state, or world entities.
- [x] Reuse current serialization/atomic replacement and write-coalescing patterns where practical. Add a narrow visual-cache bridge in `electron/preload.cts`, matching types/validation and sender/launch-scope checks in `electron/main.ts`, and an injected in-memory equivalent for browser tests. Keep cache schemas separate from strict user-settings startup validation; a corrupt optional cache must not make the application unusable.
- [x] Stage immutable identity plus complete capture in main; do not read mutable selected-character identity when a delayed write runs. One character's retirement/write failure must not merge with or overwrite another character's pending capture.
- [x] On orderly shutdown, close cache-write admission, drain accepted IPC work and flush main-owned staged captures before exit. Integrate with Electron's actual `before-quit` path, not only browser `beforeunload`. Character retirement uses the already retained capture; it must not attempt a last-minute world query. Document that the guarantee covers captures accepted by main, not packets still in flight or an unclean process exit.
- [x] Reject unsupported versions/malformed values with an actionable diagnostic. Do not build migration infrastructure for this first version.

Acceptance: tests cover announced-but-missing equipment, complete initial capture, equip/unequip, appearance replacement, unchanged captures, failed writes, stale character/session work, corrupt cache, endpoint isolation, broadcast-lag recovery, and shutdown ordering. Include a case where the renderer window closes before the main-process debounce fires: the last accepted capture must still reach disk. A partial capture cannot replace a saved complete preview. Reopening after an unclean exit may show the last successful write.

### Phase 8: Deliver the cached character picker

Deliverables: `ClientCharacterSelect.svelte`, app-local picker state/cache reads, preview integration, and user-facing cached-status/error handling.

- [x] Load only the selected character's cached visual; use the server roster as the authority for selectable characters.
- [x] Keep stable server slot metadata while applying any frontend presentation ordering. Preserve explicit entry and pending-entry guards.
- [x] Display the character through the shared equipment-capable preview and existing rotation controls. No new selection backdrop is required; the retail heritage backdrop is a creation requirement.
- [x] Show a clear first-use placeholder for missing captures and last-observed wording for cached ones. An invalid cache or unavailable resource produces a preview diagnostic while selection/entry remains functional.
- [x] Cancel/supersede stale reads and preparations on fast selection changes, roster refresh, creation navigation, world entry, and disconnect.
- [x] Distinguish same-character edit failure from switching subjects: keep the last good visual for a failed creator edit, but hide the previous character immediately when a different roster character is selected. A failed/missing B capture must never display A's model under B's name. The device may remain mounted while its subject is loading/unavailable.
- [x] Never offer a cache-only character absent from the current roster. Do not add a general cache browser, quota manager, or eager cache migration.

Acceptance: synthetic browser flows cover uncached/cached characters, rapid switching, failure isolation, roster changes, creation return, entry, and disconnect. A saved preview reloads across application launches and includes the captured equipment.

Implementation evidence for phases 7–8:

- Core owns `PlayerVisualCapture { guid, source }` and retains the latest complete body/attachment source. Existing world containment/attachment readiness gates capture; incomplete updates preserve the prior complete source. Packet-level invalidation shares the existing entity-facts collector's storage-change observation; there is still only one destructive storage drain. Relevant property/appearance/attachment changes invalidate; movement does not.
- Saved visuals use authored default idle, opaque visibility and accepted `PropertyFloat::DefaultScale` (hydrated from physics `obj_scale`), excluding live world placement and transient script-scale ramps. This is deliberate picker policy; inspection still uses the live effective scale/translucency. Unit tests prove the distinction and normal equipment removal/hydration behavior.
- Core application snapshots and cold deltas carry the same complete capture through host projection and strict browser decoding. A session recovery test forwards a missed one-time equipped appearance to persistence without requiring another gameplay change. Retirement emits/retains no partial replacement and never queries the old world at shutdown.
- `persistPlayerVisualCapture` is a stateless frontend adapter. Typed preload IPC stages immediately in Electron main; disk debounce is main-owned. `ClientVisualCacheStore` keeps immutable endpoint/GUID identities per staged value, serializes atomic replacements and preserves newer captures arriving during a prior write. `replaceLocalFile` now serves both settings and optional visual-cache writes. Independent version-1 files use a SHA-256 encoding of the existing canonical endpoint/GUID profile key beneath `userData/character-visuals`; no account identity or general cache framework was added.
- Missing, unsupported, malformed, mismatched and unreadable optional entries remain local preview outcomes. Disk failures are reported, retain the previous successful file, leave failed values pending for retry, and do not block other characters. Admission closes synchronously in `before-quit`; shutdown waits for host, settings and accepted cache writes with `Promise.allSettled`. This guarantee covers captures already accepted by main, not in-flight packets or an unclean process exit.
- Focused filesystem tests cover round-trip equipment, immutable staging, coalescing, endpoint/character isolation, corrupt/future values, replacement failure/retry, and a newer capture arriving during an in-flight write. An isolated actual Electron run staged through preload, closed its renderer before debounce, exited successfully and left the accepted equipped value on disk. A second actual Electron launch recovered that same equipped capture through preload (`/tmp/h3d-visual-cache-restart-proof.log`).
- The picker reads only the selected current-roster character, preserves server slot labels, and displays a first-use placeholder or last-observed caption. Identity-gated source publication withdraws A before B loads. Read revisions and the existing shared preview preparation revisions reject stale work through selection, roster removal, creator navigation, entry and disconnect.
- The production-content browser workflow rendered captured sword/shield equipment, tested missing/unreadable captures, delayed stale reads, roster ordering/removal, creator return, explicit entry and disconnect. Selection changes used one context/program; final GPU and CPU setup leases were zero, with no browser errors (`/tmp/h3d-player-picker-browser.log`). A separate machine check of the manual review route proved its model mounted, two roster entries appeared, and the uncached selection hid the previous model while retaining entry (`/tmp/h3d-picker-showcase-proof.log`). It did not visually approve the result.
- Verification: all 3,417 TypeScript tests passed; Svelte/TypeScript/Electron checks passed with no errors/warnings; full app lint passed including unused exports and host Clippy. Rust regression suites passed: 712 core, 378 host, 321 CLI and 16 CLI integration tests. All-target Clippy also passed for core/host/CLI. Unused feature exports were narrowed; a state-free writer class was collapsed into the stateless adapter during review.
- Manual picker review URL: `http://127.0.0.1:34697/harness/browser/?pregame-preview=1&picker-showcase=1&contentHost=http%3A%2F%2F127.0.0.1%3A42095`. It uses static content and synthetic roster/cache data; no real character is created or entered. The user accepted the picker/equipment for this milestone ("looks fine"). Review services (sessions 91813 and 38562) were retired after user acceptance and final verification.

### Phase 9: Cleanup and integrated verification

- [x] Delete obsolete one-model contracts, redundant catalog mappings, duplicate roster-success handling, and preview-to-world-start wiring. Sweep surviving names, docs, and diagnostics for removed mechanisms.
- [x] Review resource/error ownership and ensure each new type/field and unintuitive ordering rule is documented at its definition.
- [x] Verify each earlier phase's acceptance criteria at its cutover, keeping compilation/checks green as contracts migrate. This final phase integrates the evidence; it is not the first time to run the checks.
- [x] Run focused Rust tests for changed content/core/world/host behavior, then `cargo clippy` for those packages with `--all-targets -- -D warnings` and `cargo fmt --all -- --check`.
- [x] In h3d, run `npm run check`, `npm run lint`, affected `npm run test:ts -- ...` tests, and relevant build checks. Use existing package scripts; do not install new tooling just for verification.
- [x] Extend `npm run harness:browser -- ...` for machine-readable pre-game/preview lifecycle evidence and synthetic creator/picker responses. Existing preview probes currently start from an Explorer spawn; add the genuinely pre-game case rather than treating that probe as proof of independence.
- [x] Exercise real background/body content through production loaders in diagnostics. Runtime-asset diagnostics may remain harness operations; permanent unit tests must use checked-in/synthetic fixtures.
- [x] Leave visual acceptance of faces, clothing, framing, background placement, and equipment appearance to the user. Agent checks runtime state, errors, resource lifecycle, and transforms; it does not independently approve the visuals.
- [x] Update durable architecture/protocol documentation only for implemented ownership/contracts and verified findings. Do not turn this temporary plan into a maintained specification.

Final cleanup and integrated acceptance:

- User accepted the picker as "looks fine" after its separate visual review. Both visual gates are closed; automated checks remain separate evidence.
- The production-content browser probe now constructs and retires a real `GamePresentationOwner` using the existing app assets, cancels a second construction after its active-region response, and then draws an equipped preview using those same assets. Its first failures identified two concrete ownership defects: world teardown left its created `AudioContext` open, and `DynamicEntitySystem.destroy` destroyed the app-owned animation repository. The world owner now closes its context; dynamics retires resident handles, runtime retires its own GPU template repository, and shared animation resources remain app-owned. The dynamic-system port no longer exposes repository destruction. A focused unit test acquires a preview animation after resident retirement.
- `/tmp/h3d-final-browser5.log` proves successful and canceled world retirement, a subsequent equipped preview draw, zero tracked world/preview GPU resources, closed world audio, and zero remaining shared setup leases. Its creator workflow additionally disconnects with a pending submitted operation and an appearance resolution in flight, then rejects the retired resolution without surfacing a stale error. The same run prepares all 26 offered bodies and six heritage backgrounds, exercises sword/shield transforms and retained replacement failure/currentness, and reports no browser errors.
- Final Rust regression evidence: `/tmp/h3d-final-rust-tests.log` passed 378 host, 321 CLI plus 16 CLI integration, 117 content, 712 core, 131 DAT plus two DAT integration, and 971 world tests (three existing ignored tests). All-target warnings-as-errors Clippy passed for content/core/world/DAT/host/CLI in `/tmp/h3d-final-clippy.log`. Formatting and whitespace checks pass.
- Final frontend evidence: `/tmp/h3d-final-ts-tests2.log` passed all 3,418 TypeScript tests across 384 files; `/tmp/h3d-final-check3.log` passed Svelte, app, test, and Electron checks; `/tmp/h3d-final-lint.log` passed full lint including unused exports and host Clippy. `/tmp/h3d-final-electron-build.log` passed emitted Electron runtime dependency checks. `/tmp/h3d-final-build2.log` passed the production bundle build. Its large-chunk advisory remains: the existing shared inspection and portal-transition bundles exceed the reporting threshold; no new splitting policy was introduced for this feature.
- Durable implementation documentation is in the h3d README and content/core architecture documents. The handshake document now states the appearance-free roster contract and verified creation confirmation/error behavior. Historical inactive plans were not rewritten. The superseded one-model component, world-owned preview resource capability, template picker/catalog projection, rest-pose projection and duplicate roster insertion paths are removed; unused feature exports were narrowed. No lint suppressions or asset-dependent unit tests were retained.
- Final review traced creation draft → host builder → core admission/reply/roster recovery, world facts → complete capture → snapshot/delta → main cache → selected-only picker, and app assets → preview/world borrowers → teardown. The two demonstrated ownership defects above were fixed. Accepted limits remain explicit: no server-side offline appearance query, no preview before the first complete gameplay observation, no cross-packet equipment atomicity, no guarantee for an unclean exit or data not yet accepted by main, and no real-server creation during diagnostics.
- User-review Vite/content sessions 91813 and 38562 were stopped after acceptance. No files were staged or committed; pre-existing ACE/ACViewer work was left untouched.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Creation differs from gameplay appearance, especially alternate bodies | Trace retail preview and ACE player creation separately; use explicit composition fixtures and production-content census. |
| Fast edits create unbounded preparation or leaked leases | Latest-request coalescing, revision admission, complete replacement before commit, and disposal-race harness cases. |
| Host appearance requests queue despite bounded renderer preparation | Coalesce before host dispatch and reject stale resolution results before they reach the renderer. |
| Shared appearance validation introduces a crate dependency cycle | Content owns choice interpretation/validation; core adapts protocol values and adds submission-only rules. |
| Retained renderer keeps every previously used texture | Bundle-owned GPU lifetimes and repeated replacement evidence; CPU lease release alone is insufficient. |
| Background breaks fit or rotates with the character | Separate background placement from character heading and camera-fit inputs; include its depth only in clipping coverage. |
| Preview accidentally starts world systems | Pre-game harness asserts absence of active-region/world/audio startup requests. |
| Core/TUI/h3d disagree after creation | Make roster reconciliation core-owned and migrate duplicate consumer updates together. |
| Broadcast recovery drops a creation result or capture | Retain operation/capture levels in the atomic application snapshot and test lag at the result boundary. |
| Snapshot matches an intermediate equipment state | Reuse announced roster/readiness plus required visual validation; preserve the previous complete capture while prerequisites are absent. This does not promise cross-packet atomicity that the server never supplies. |
| Reconstructible cache failure prevents login | Keep optional visual cache handling separate from strict settings validation; surface diagnostics locally. |
| Window closes before renderer debounce/flush finishes | Stage captures immediately in Electron main, debounce there, and drain accepted work on quit. |
| Picker displays the previous subject on load failure | Withdraw A's visible model when selecting B, while retaining the device and rejecting stale completions. |
| Stored identities become stale after a server reset/content change | Validate against current roster and content; allow preview unavailability without blocking entry. No speculative database-generation identity protocol. |
| Broader shared APIs become frontend UX containers | Keep backdrop, framing, draft navigation, and cache policy app-local; shared crates expose content interpretation and accepted game facts only. |

## Definition of done

- [x] Creation works from character selection through server confirmation and roster update without reconnecting or starting world presentation for the preview.
- [x] The creator previews every offered supported appearance with the appropriate heritage background and body/face controls.
- [x] Inspector and picker share equipment-capable preview machinery with stable device lifetime across source changes.
- [x] Complete gameplay captures survive restart; missing/stale/invalid captures have explicit, nonblocking behavior.
- [x] Character lifecycle, slot capacity, asynchronous request currentness, asset teardown, and write ordering have focused evidence.
- [x] Required checks pass with no lint suppressions, retained asset-dependent unit tests, or duplicated obsolete paths.
- [x] User visual acceptance is recorded separately from automated correctness checks.

## Open questions and execution decisions

No answer is required to finish this plan. Defaults below bound implementation; record evidence-driven changes here during execution.

- Picker pose: prefer a stable equipment display pose over persisting the last live combat/death state. Determine exact animation and item placement from existing shared semantics and references in phases 3/5/7.
- Creation layout: use h3d's existing controls and a focused staged flow; exact retail layout reproduction is not required.
- First-use picker: placeholder until first complete gameplay capture, including newly created characters.
- Content gaps: enumerate offered heritage/gender/alternate-setup failures before narrowing support. Missing content must produce an explicit diagnostic, not a substituted generic human.
- Clothing contract: the user selected garment-specific template keys throughout; the cutover is implemented. See phase 3 for the verified retail/server semantics and completed census.
- Cache storage: use a separate optional visual-cache file/value with existing endpoint/GUID keys, main-owned staging/debounce, and atomic-write patterns; implemented as independent version-1 files keyed by the existing profile identity, without a general storage framework.
- Live acceptance: synthetic protocol/browser tests are the default. Any test that creates/deletes a real character needs explicit authorization for that action and server; writing this plan does not authorize it.
