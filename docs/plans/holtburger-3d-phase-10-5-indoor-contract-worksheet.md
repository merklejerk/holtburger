# Holtburger 3D Phase 10.5 Indoor Contract Worksheet

## Purpose

Freeze the minimum indoor-capable runtime and asset vocabulary that Phase 11 must land, while keeping the current runtime DTO honest about still being outdoor-first today.

## Current Runtime Boundary

Current `RuntimeResidencyDto` facts already crossing the boundary:

```text
RuntimeResidency
  focus_entity_id: u64 | null
  focus_landblock_id: u32
  focus_cell_id: u32 | null
  focus_location_label: string
  indoors: bool
  tracked_body_count: usize
```

Phase 10.5 decision:

- keep the current runtime DTO unchanged during Phase 10.5 so the app does not pretend indoor scene ownership exists yet
- record the missing indoor fields explicitly in code and docs instead of overloading `indoors: true` into a fake-complete scene contract

## Phase 11 Runtime Field Backlog

These are the minimum next-step runtime facts Phase 11 must evaluate or add explicitly:

```text
IndoorRuntimeFieldBacklog
  focus_env_cell_id: u32 | null
  visible_cell_ids: u32[]
  seen_outside: bool | null
  environment_id: u32 | null
  cell_structure_id: u32 | null
```

Phase 10.5 decision:

- `focus_env_cell_id` is the first missing anchor because `focus_cell_id` is not a clear env-cell contract on its own
- `visible_cell_ids` should remain the authoritative indoor visibility input until stronger evidence justifies a narrower host projection
- `seen_outside` should cross the boundary explicitly when available rather than being re-derived in the frontend
- `environment_id` and `cell_structure_id` should be named as separate facts so the asset channel can keep env-cell metadata distinct from indoor structural assets

## Asset Taxonomy Groundwork

Outdoor and indoor level assets should no longer be described as one vague scene bucket.

Phase 10.5 taxonomy:

```text
Outdoor asset family
  terrain/<xxyyffff>

Indoor asset families
  indoor-env-cell/<cell-id>
  environment/<environment-id>
  cell-structure/<structure-id>
```

Phase 10.5 decision:

- `terrain/*` stays the outdoor-only terrain family
- `indoor-env-cell/*` should carry env-cell-scoped metadata and relevance facts, not full renderer bundles
- `environment/*` should represent the reusable indoor level container layer
- `cell-structure/*` should remain explicitly separate so later BSP or structural intermediates do not get hidden behind env-cell DTOs

## Live-Host Parity Notes

The live Tauri path is now the only supported startup path.

Phase 10.5 completion notes:

- the TypeScript host bridge fails fast outside Tauri instead of synthesizing preview snapshots or runtime notifications
- terrain provenance remains explicit through repo-local `CellLandblock` notes, which lets the app distinguish real HBA-backed terrain from unknown or missing provenance
- the host boundary overview now publishes the indoor runtime-field backlog and indoor asset-family backlog directly so the next phase starts from named seams

## Deferred Until Phase 11

- widening `RuntimeResidencyDto` itself with env-cell and visible-cell facts
- deciding whether indoor asset lookups should return references only or a lightly decoded structural intermediate
- replacing the frontend `indoor-gap` placeholder with a real indoor scene-context model