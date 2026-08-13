# Coincident Portal Junction Transit Investigation

Status: Resolved on `fix/host-physics-recovery`
Created: 2026-08-13
Found by: portal compositing work on `portal-compositing-fixes`; this is a collision-solver finding
and is deliberately **not** in scope for that plan.

## Summary

Where two buildings are authored so that each one's outdoor transition portal is coincident with the
next one's, directed collision placement cannot cross the junction. A body that walks from cell A
into cell B through such a junction keeps `committed_cell = None` — the solver believes it is
outdoors while it is standing inside B.

Point containment was healthy. The gap was an early return in directed reachability expansion,
followed by same-fraction motion segmentation that exposed the zero-thickness outdoor domain.

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
  leg 0     fraction=0.5000 x=10.0  cell=0xDA550101
  leg 1     fraction=1.0000 x=15.0  cell=0xDA550101
  VERDICT   reached cell B

== direct reciprocal portal (control)
  leg 1     fraction=1.0000 x=15.0  cell=0xDA550101
  VERDICT   reached cell B
```

At `x = 15` the body is five units inside cell B, whose volume spans `10 <= x <= 20`.

The product replay is:

```
cargo run -p holtburger-debug-harness --bin collision_scene_probe -- \
  --landblock 0xf418ffff \
  --grounded-start 36.124,73.25,169.805 \
  --grounded-drive 0,-4 \
  --grounded-cell 0xf4180101 \
  --grounded-settle-ticks 4 \
  --grounded-ticks 30 \
  --grounded-body pair
```

The route crosses from `0xF4180101` to `0xF4180104` at driven tick 9 and retains full requested
horizontal progress and support.

## Root Cause

Containment is healthy. Seeded fresh, placement finds cell B at every sampled position:

```
transit_cell at x=15, seeded from cell A     committed=None            reached=["0xDA550100"]
transit_cell seeded outdoors at x=10.5       committed=0xDA550101      reached=["0xDA550100","0xDA550101"]
transit_cell seeded outdoors at x=11 .. 19   committed=0xDA550101      reached=["0xDA550101"]
```

The difference was the seed. `CollisionScene::transit_cell` returned immediately after expanding a
valid `previous_cell`, even when that expansion reached an outside portal. The existing
outdoor-entry scan therefore never had a chance to add the adjacent building's EnvCell.

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

The second failure was continuous path placement. It emitted the source cell's outside boundary,
then rejected the adjacent building entry at the same segment fraction under the ordinary minimum-
advance rule. Physical-fly body placement eventually recovered on a later endpoint query, but the
viewer path remained outdoors. Grounded movement could not reach that later query: outdoor
placement hid the target EnvCell floor, so creature edge protection treated the junction as a
precipice and rolled back with zero collision constraints—the observed invisible wall.

The old probe's `transit_motion_path(previous_cell=None)` versus direct `transit_cell` discrepancy
was not another defect. Motion-path input carries authoritative committed placement; `None` means
explicitly outdoors, so `placement_for_committed_cell` deliberately preserves it. Direct
`transit_cell` is a discovery query and may classify the same point inside an EnvCell.

## Retail Evidence

Retail performs this as ordinary reachability, not a special junction lookup:

- `CEnvCell::find_transit_cells` marks an outside portal and calls
  `CLandCell::add_all_outside_cells` (`acclient.c:334180-334430`).
- `CObjCell::find_cell_list` continues iterating the same growing `CELLARRAY`
  (`acclient.c:332969-333069`).
- The reached `CLandCell` delegates to `CSortCell::find_transit_cells`, whose building registration
  admits the adjacent EnvCell (`acclient.c:340793-340805`, `:341417-341447`).

The zero-thickness case therefore needs the same expansion to continue through the implicit outdoor
domain; it does not need renderer junction metadata or a synthetic direct portal.

## Resolution

- Placement expansion returns early from a prior EnvCell only while it remains wholly interior.
  Once an outside portal is reached, it continues through the existing outdoor-entry scan.
- Endpoint and motion probes share one post-coverage placement expansion function.
- Continuous outside crossings probe just beyond the boundary using that same expansion. One unique
  containing far-side EnvCell collapses the zero-thickness outdoor transit into a direct placement
  change. No candidate preserves an ordinary outdoor exit; multiple candidates preserve outdoor
  placement and expose all reached cells without selecting by iteration order.
- Focused tests cover endpoint expansion, zero-thickness path collapse, ordinary outdoor exit, and
  ambiguous far-side containment.

## Why it matters

The archive contains this arrangement. A census of `0xF418FFFF` found eight junctions where cells
are chained through a zero-thickness outdoor slab rather than a direct portal; two of them bracket
`0xF4180104`. It is uncommon but not rare, and it has been observed in several places.

Anything keyed on authoritative residency is wrong while a body stands in one of those cells:
interior versus exterior weather and ambient light, interior audio, and the renderer's root scope.

## Relationship to the renderer bug

The renderer failed at the same authored junction for a different reason: its per-pixel convergence
test rejected equal-depth propagation. Renderer junction identities remain a compositor-local proof.
Collision deliberately does not consume them; its fix follows retail's ordinary cell reachability.
