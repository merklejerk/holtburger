# Coincident Portal Junction Transit Investigation

Status: Finding, unowned
Created: 2026-08-13
Found by: portal compositing work on `portal-compositing-fixes`; this is a collision-solver finding
and is deliberately **not** in scope for that plan.

## Summary

Where two buildings are authored so that each one's outdoor transition portal is coincident with the
next one's, directed collision placement cannot cross the junction. A body that walks from cell A
into cell B through such a junction keeps `committed_cell = None` — the solver believes it is
outdoors while it is standing inside B.

Point containment is not the problem and recovers correctly on its own. The gap is in directed
reachability expansion.

## Reproduce

```
cargo run -p holtburger-debug-harness --bin coincident_junction_transit
```

Synthetic, no runtime assets, about a second. Two cells abut at `x = 10`. In the failing case each
owns only an `Outdoor` portal on that plane; the control joins them with an ordinary reciprocal
`EnvCell` portal.

```
== coincident outdoor junction
  initial   cell=0xDA550100
  leg 0     fraction=0.5000 x=10.0  cell=None
  leg 1     fraction=1.0000 x=15.0  cell=None
  VERDICT   DID NOT reach cell B

== direct reciprocal portal (control)
  leg 1     fraction=1.0000 x=15.0  cell=0xDA550101
  VERDICT   reached cell B
```

At `x = 15` the body is five units inside cell B, whose volume spans `10 <= x <= 20`.

## Mechanism

Containment is healthy. Seeded fresh, placement finds cell B at every sampled position:

```
transit_cell at x=15, seeded from cell A     committed=None            reached=["0xDA550100"]
transit_cell seeded outdoors at x=10.5       committed=0xDA550101      reached=["0xDA550100","0xDA550101"]
transit_cell seeded outdoors at x=11 .. 19   committed=0xDA550101      reached=["0xDA550101"]
```

The difference is the seed. `CollisionScene::transit_cell`
(`crates/holtburger-world/src/spatial/collision.rs:1036-1060`) takes an early return when
`previous_cell` is present: it seeds `reached_interior_cells` with that cell, expands, commits by
containment, and returns before the outdoor-entry scan at `:1063` ever runs.

Expansion is then the whole story. `expand_reached_cells` (`:1864-1871`) handles an `Outdoor` target
by setting `reaches_outdoors = true` and nothing else:

```rust
CellCollisionPortalTarget::Outdoor => {
    let distance = portal.plane.distance_to_point(&source_local);
    if distance.abs() < radius + CELL_PLANE_TOLERANCE {
        placement.reaches_outdoors = true;
    }
}
```

There is no far-side cell to add, because an `Outdoor` portal does not name one. Cell-to-cell
reachability is expressed only through `EnvCell`-targeted portals, so a junction chained through
Outdoor is not traversable by directed expansion at all — no matter how thin the outdoor slab is.

**Not** the advance rule. The first guess was `directed_plane_crossing_fraction`
(`:2010`), which requires `fraction > cursor + minimum_advance` with
`CELL_PLANE_TOLERANCE = 0.000_2`. That is a real structural analogue of the renderer's entry-plane
test and shares its constant, but it is not what fails here.

## Unresolved discrepancy

Worth a second pair of eyes, because it may be harness misuse rather than a defect:

```
transit_motion_path, previous_cell=None, start x=14   ->  initial cell = None
transit_cell,        previous_cell=None,       x=14   ->  committed   = 0xDA550101
```

`transit_motion_path` computes its initial point through `placement_for_committed_cell(anchor,
request.start, request.radius, request.previous_cell)` (`:1100`), which forwards straight to
`transit_cell` with the same arguments. Reading both paths did not account for the difference.

## Why it matters

The archive contains this arrangement. A census of `0xF418FFFF` found eight junctions where cells
are chained through a zero-thickness outdoor slab rather than a direct portal; two of them bracket
`0xF4180104`. It is uncommon but not rare, and it has been observed in several places.

Anything keyed on authoritative residency is wrong while a body stands in one of those cells:
interior versus exterior weather and ambient light, interior audio, and the renderer's root scope.

## Relationship to the renderer bug

The renderer fails at the same junctions for an unrelated reason — an ordered per-pixel advance test
that rejects a zero-distance step — and is being fixed under
`holtburger-3d-coincident-portal-junction-plan.md`. That fix does not transfer here: it exempts a
tolerance comparison, while this needs expansion to learn which cell lies across an `Outdoor` portal.

The two do share an input. That plan's Phase 1 computes, host-side, exactly which crossing pairs form
a coincident junction and therefore which cell sits on the far side of each such portal. If this
finding is picked up, that pairing is available rather than needing a second derivation.

Until both are addressed, solver and renderer disagree about the same authored geometry: the solver
walks you through the junction while the renderer refuses to draw the far side.

## Suggested direction, not prescribed

The owning question is whether `CellCollisionPortal` should carry an optional far-side cell for
junctions whose outdoor transit is provably zero-thickness, or whether expansion should consult the
junction pairing separately. That is a call for whoever owns collision placement.
