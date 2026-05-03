# Holtburger 3D Phase 11 Prep Checklist

## Context And Boundaries

### Goal
Freeze the minimum grounded decisions needed to start Phase 11 implementation without reopening the indoor contract vocabulary or guessing beyond ACE and ACViewer evidence.

### In Scope
- confirm the minimum runtime facts that Phase 11 should add to the host boundary
- confirm the minimum indoor asset-family split that should become first-class on the asset channel
- map the current app-local seams that must change to replace the `indoor-gap` placeholder with a real indoor scene-context model
- leave behind a short implementation checklist with explicit file targets and validation points

### Out Of Scope
- full indoor rendering
- portal-derived visibility replacement for `VisibleCells`
- BSP-driven picking or collision work
- shared-crate refactors outside the current app boundary unless Phase 11 implementation proves they are actually required

## Ground Truth

### Runtime Visibility And Indoor Relevance
- ACE `EnvCell` exposes `EnvironmentId`, `CellStructure`, `VisibleCells`, `SeenOutside`, surface bindings, and static objects in [ACE/Source/ACE.DatLoader/FileTypes/EnvCell.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.DatLoader/FileTypes/EnvCell.cs).
- ACE object maintenance treats `VisibleCells` plus `SeenOutside` as real indoor relevance inputs in [ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs).
- ACE comments explicitly warn that visible-cell relationships are not safely assumed to be symmetric in [ACE/Source/ACE.Server/Command/Handlers/PlayerCommands.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.Server/Command/Handlers/PlayerCommands.cs).

### Indoor Level Asset Shape
- `Environment` is a reusable container of `CellStruct`s in [ACE/Source/ACE.DatLoader/FileTypes/Environment.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.DatLoader/FileTypes/Environment.cs).
- `CellStruct` contains render polygons, portal indices, cell BSP, physics polygons, physics BSP, and optional drawing BSP in [ACE/Source/ACE.DatLoader/Entity/CellStruct.cs](/home/cluracan/code/holtburger/ACE/Source/ACE.DatLoader/Entity/CellStruct.cs).
- ACViewer renders and inspects visible env cells by walking `VisibleCells` and `CellStructure.Polygons` in [ACViewer/ACViewer/Picker.cs](/home/cluracan/code/holtburger/ACViewer/ACViewer/Picker.cs).

## Current App Seams

### Runtime Boundary Today
- `RuntimeResidencyDto` still exposes only `focusEntityId`, `focusLandblockId`, `focusCellId`, `focusLocationLabel`, `indoors`, and `trackedBodyCount` in [apps/holtburger-3d/src/lib/host/contracts.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/host/contracts.ts) and [apps/holtburger-3d/src-tauri/src/contracts.rs](/home/cluracan/code/holtburger/apps/holtburger-3d/src-tauri/src/contracts.rs).
- The host adapter still populates indoor state as a boolean-only branch in [apps/holtburger-3d/src-tauri/src/adapter.rs](/home/cluracan/code/holtburger/apps/holtburger-3d/src-tauri/src/adapter.rs).
- The host boundary overview already publishes the intended Phase 11 backlog fields and asset families in [apps/holtburger-3d/src-tauri/src/adapter.rs](/home/cluracan/code/holtburger/apps/holtburger-3d/src-tauri/src/adapter.rs).

### Frontend Scene Model Today
- `WorldDisplaySceneContext` still switches between `outdoor-landblock-ring` and `indoor-gap` in [apps/holtburger-3d/src/lib/world-display/model.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/world-display/model.ts).
- The current test suite explicitly defends that placeholder branch in [apps/holtburger-3d/src/lib/world-display/model.test.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/world-display/model.test.ts).

### Asset Channel Today
- prepared asset state only has `outdoor-landblock`, `indoor-env-cell`, and `unknown` residency kinds in [apps/holtburger-3d/src/lib/assets/types.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/assets/types.ts).
- the worker currently knows how to prepare terrain payloads plus generic JSON payloads in [apps/holtburger-3d/src/workers/asset-worker.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/workers/asset-worker.ts).

## Resolved Prep Decisions

### 1. Minimum Runtime DTO Expansion
Phase 11 should add all five backlog facts named in Phase 10.5 rather than trying to stage them behind another placeholder.

Recommended `RuntimeResidencyDto` additions:
- `focusEnvCellId: number | null`
- `visibleCellIds: number[]`
- `seenOutside: boolean | null`
- `environmentId: number | null`
- `cellStructureId: number | null`

Why this is the minimum honest set:
- `focusEnvCellId` is the indoor anchor that `focusCellId` does not provide clearly.
- `visibleCellIds` is the current authoritative relevance input; Phase 11 should not replace it with topology guesses.
- `seenOutside` is part of ACE visibility behavior, not frontend decoration.
- `environmentId` and `cellStructureId` must remain separate because the indoor asset path is not one opaque room bundle.

### 2. Minimum Indoor Asset-Family Split
Phase 11 should make these three asset families first-class without forcing renderer-ready indoor geometry too early:
- `indoor-env-cell/<cell-id>`
- `environment/<environment-id>`
- `cell-structure/<structure-id>`

Recommended first payload shape:
- `indoor-env-cell/*`: JSON metadata and relevance facts only. Include env-cell id, environment id, cell-structure id, visible-cell ids, `seenOutside`, and surface identifiers.
- `environment/*`: JSON reference payload identifying the environment and the cell-structure ids it contains.
- `cell-structure/*`: JSON structural summary first. Include structure id, polygon counts, portal counts, and BSP availability flags before deciding whether Phase 11 actually needs polygon buffers.

Rationale:
- this is enough to make indoor assets first-class in the channel and telemetry
- this is enough to replace the frontend `indoor-gap` placeholder with a real scene-context model
- this avoids pretending that the first indoor phase already owns final geometry decode or renderer-ready meshes

### 3. Frontend Scene-Context Target
Phase 11 should replace `indoor-gap` with a real indoor scene-context branch that answers:
- which env cell is currently authoritative
- which visible cells are currently relevant
- whether outdoor objects remain relevant because `seenOutside` is set
- which indoor asset ids should be considered scene members right now

The scene-context model should stay frontend-owned. The host should publish facts and stable asset references; `WorldDisplay` should decide how those facts map to requests and local render membership.

### 4. Phase 11 Non-Goals
Phase 11 should explicitly avoid:
- deriving indoor visibility from portals alone
- treating `Environment` or `CellStruct` as hidden details of an env-cell DTO
- widening outdoor landblock types into fake-universal scene units
- committing to polygon-buffer or BSP-buffer payloads unless the first indoor display path actually needs them

## Implementation Checklist

### Phase A: Runtime Contract Expansion
Files:
- [apps/holtburger-3d/src-tauri/src/contracts.rs](/home/cluracan/code/holtburger/apps/holtburger-3d/src-tauri/src/contracts.rs)
- [apps/holtburger-3d/src/lib/host/contracts.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/host/contracts.ts)
- [apps/holtburger-3d/src-tauri/src/adapter.rs](/home/cluracan/code/holtburger/apps/holtburger-3d/src-tauri/src/adapter.rs)

Tasks:
- widen `RuntimeResidencyDto` on both sides with the five indoor fields
- populate nullable or empty values honestly in the host adapter until live runtime sources can provide stronger data
- keep the existing overview backlog if it still adds value as a capability note; otherwise narrow it once the fields land

Acceptance criteria:
- the runtime DTO no longer represents indoor state as only `indoors: true`
- TypeScript Zod schemas and Rust DTOs remain aligned

### Phase B: Indoor Asset Contract Introduction
Files:
- [apps/holtburger-3d/src-tauri/src/contracts.rs](/home/cluracan/code/holtburger/apps/holtburger-3d/src-tauri/src/contracts.rs)
- [apps/holtburger-3d/src/lib/host/contracts.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/host/contracts.ts)
- [apps/holtburger-3d/src-tauri/src/adapter.rs](/home/cluracan/code/holtburger/apps/holtburger-3d/src-tauri/src/adapter.rs)
- [apps/holtburger-3d/src/workers/asset-worker.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/workers/asset-worker.ts)
- [apps/holtburger-3d/src/lib/assets/types.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/assets/types.ts)

Tasks:
- add typed JSON DTO schemas for `indoor-env-cell`, `environment`, and `cell-structure` payloads
- teach the worker to parse those DTOs into prepared metadata records instead of falling through to generic `unknown`
- extend asset residency or asset-kind typing only where the current code actually needs the distinction

Acceptance criteria:
- the asset channel can report first-class indoor family payloads without pretending they are terrain or appearance stubs
- prepared asset records keep provenance and machine-meaningful fields rather than summary strings

### Phase C: Indoor Scene-Context Adoption
Files:
- [apps/holtburger-3d/src/lib/world-display/model.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/world-display/model.ts)
- [apps/holtburger-3d/src/app/frontend-state.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/app/frontend-state.ts)

Tasks:
- replace `indoor-gap` with a real indoor scene-context branch
- derive indoor scene membership from runtime residency plus stable asset ids
- make the model text and telemetry explain indoor membership in AC-shaped terms: env cell, visible cells, environment, and cell structure

Acceptance criteria:
- indoor scene membership is explicit in app code and telemetry
- outdoor and indoor scene membership are distinct concepts rather than one shared branch with a TODO

### Phase D: Tests And Validation
Files:
- [apps/holtburger-3d/src/lib/host/contracts.test.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/host/contracts.test.ts)
- [apps/holtburger-3d/src/lib/world-display/model.test.ts](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/world-display/model.test.ts)
- any affected asset-worker tests under [apps/holtburger-3d/src/lib/assets](/home/cluracan/code/holtburger/apps/holtburger-3d/src/lib/assets)

Tasks:
- replace the `indoor-gap` expectation with the new indoor scene-context shape
- add schema tests for widened runtime DTOs and new indoor payload DTOs
- add worker tests for indoor family preparation behavior

Acceptance criteria:
- `npm run test:ts -- --run src/lib/host/contracts.test.ts src/lib/world-display/model.test.ts` passes
- `npm run check` passes

## Open Questions To Keep Narrow
- Does the first Phase 11 pass need `StaticObjects` or surface identifiers exposed immediately, or can those remain internal to the env-cell payload until the frontend asks for them?
- Does `cell-structure/*` need polygon buffers in the first pass, or is structural metadata enough until the first diagnostic indoor draw path lands?
- Once the new runtime fields land, should `HostBoundaryOverviewDto.indoorContractBacklog` shrink or remain as a declaration of future indoor work beyond Phase 11?

## Definition Of Done For Prep
- the minimum runtime field set is frozen
- the minimum asset-family split is frozen
- the current app files that must change are named explicitly
- the remaining open questions are payload-width questions rather than vocabulary or ownership questions

## Execution Notes

### Landed On 2026-04-28
- `RuntimeResidencyDto` was widened on both sides with `focusEnvCellId`, `visibleCellIds`, `seenOutside`, `environmentId`, and `cellStructureId`.
- the asset channel now supports first-class `indoor-env-cell/*`, `environment/*`, and `cell-structure/*` payloads with typed frontend parsing and preparation.
- the frontend request policy now switches between outdoor terrain coverage and indoor scene coverage instead of treating all asset sync as terrain-only.
- `WorldDisplay` replaced `indoor-gap` with an explicit indoor visible-cell scene context driven by env-cell residency and prepared indoor asset ids.

### Course Correction Applied
- `indoor-env-cell/*` now uses real repo-local HBA-backed `EnvCell` metadata because the necessary parser already exists.
- `environment/*` and `cell-structure/*` stay metadata-first and reference-first for now, because shared parsers for those structures do not yet exist in `holtburger-dat`.
- wiring the real env-cell path exposed incorrect `EnvCell` flag masks in `holtburger-dat`; those masks were corrected to match ACE so `SeenOutside`, static objects, and restriction-object semantics stay grounded.

### Follow-Up Left For Later Phases
- deeper `Environment` and `CellStruct` decoding
- indoor geometry or BSP payloads
- portal-driven indoor render expansion beyond authoritative `VisibleCells`