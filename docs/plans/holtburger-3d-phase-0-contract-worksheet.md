# Holtburger 3D Phase 0 Contract Worksheet

## Purpose

Freeze the smallest set of named contracts needed to start Phase 1 Rust adapter work without pretending to finalize the long-term client API.

## Contract A: Browser Entry Input

Purpose: seed browser mode with a narrow, explicit world-entry request.

Initial shape:

```text
BrowserEntryRequest
  entry_kind: coordinate
  landcell: u32
  position: { x: f32, y: f32, z: f32 }
```

Phase 0 decision:

- start with direct coordinate entry only
- defer named location pickers until browser mode has a real runtime feed to consume

## Contract B: Lifecycle And Mode State

Purpose: let Rust publish lifecycle facts while the frontend owns mode and page selection policy.

Initial shape:

```text
LifecycleState
  phase: booting | ready | disconnected
  active_mode_hint: browser | client | null
  session_state: unavailable | disconnected | connected
  summary: string
```

Phase 0 decision:

- keep `active_mode_hint` advisory rather than authoritative
- keep nested page selection frontend-local in Phase 0

## Contract C: Runtime Entity Feed

Purpose: name the smallest authoritative data stream that future frontend projections will consume.

Initial shape:

```text
RuntimeEntitySnapshot
  entity_id: u64
  position: { x: f32, y: f32, z: f32 }
  heading_radians: f32
  appearance_id: string
```

```text
RuntimeBatch
  tick: u64
  entities: RuntimeEntitySnapshot[]
```

Phase 0 decision:

- keep the first snapshot shape world-facing and renderer-agnostic
- defer animation and combat-oriented detail until the runtime adapter exists

## Contract D: Authoritative State Feed For View Models

Purpose: separate semantic UI-driving facts from render snapshots.

Initial shape:

```text
FrontendStateFeed
  selected_entity_id: u64 | null
  interaction_mode: none | inspect
  busy_state: idle | loading
```

Phase 0 decision:

- start with a tiny semantic feed rather than reusing runtime snapshots for UI policy

## Contract E: Asset Lookup Request And Response

Purpose: keep heavy asset traffic demand-driven from day one.

Initial shape:

```text
AssetLookupRequest
  request_id: string
  asset_id: string
  priority: bootstrap | streaming | prefetch
```

```text
AssetLookupResponse
  request_id: string
  asset_id: string
  payload_kind: bytes | json
  payload: opaque
```

Phase 0 decision:

- keep payload typing coarse in the worksheet
- defer detailed decode ownership until the asset worker phase

## Contract F: Camera Position Hint

Purpose: reserve the JS-to-Rust hint path for future residency and camera-sensitive spatial behavior.

Initial shape:

```text
CameraPositionHint
  landcell: u32 | null
  position: { x: f32, y: f32, z: f32 }
  forward: { x: f32, y: f32, z: f32 }
```

Phase 0 decision:

- keep this a best-effort hint, not a command
- defer throttling policy until Phase 4 implementation

## Contract G: Authority-Sensitive Ray Pick Query

Purpose: keep the first authoritative query list narrow and named.

Initial shape:

```text
RayPickQuery
  origin: { x: f32, y: f32, z: f32 }
  direction: { x: f32, y: f32, z: f32 }
  max_distance: f32
```

```text
RayPickResult
  hit: bool
  entity_id: u64 | null
  point: { x: f32, y: f32, z: f32 } | null
```

Phase 0 decision:

- keep the first authority-sensitive query focused on ray-pick resolution only

## Contract H: WorldDisplay Boundary

Purpose: keep shared world-facing infrastructure separate from mode-specific policy.

Initial shape:

```text
WorldDisplayInputs
  mode: browser | client
  lifecycle_state: LifecycleState
  runtime_batch: RuntimeBatch | null
  view_model_feed: FrontendStateFeed | null
```

Phase 0 decision:

- `WorldDisplay` consumes shared inputs and emits presentation-local events later
- browser mode is the first consumer, but `WorldDisplay` must not become browser-mode-only infrastructure