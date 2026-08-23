# Holtburger 3D Explorer Self-ClothingBase Plan

Status: Complete 2026-08-22 (Phases 0-4); retail evidence pass 2026-08-22
Created: 2026-08-22
Parent: follow-on to `holtburger-3d-explorer-weenie-appearance-plan.md` (complete 2026-08-17)

## Context and Boundaries

### Goal

An Explorer-spawned weenie that paints itself — through its own `ClothingBase` plus
`PaletteTemplate`/`Shade`, with no worn equipment involved — renders in its authored colour.

### Why

Spawning WCID 2568 (White Rabbit) produces a black rabbit. All three rabbit variants share setup
`0x0200047B`; the only thing separating the coloured ones from the black one is a clothing table
applied to the weenie itself:

| WCID | Class | PaletteBase | ClothingBase | PaletteTemplate | Shade |
| --- | --- | --- | --- | --- | --- |
| 2566 | rabbitblack | *(none)* | *(none)* | *(none)* | *(none)* |
| 2567 | rabbitbrown | `0x040001B4` | `0x1000010D` | 4 | 0.5 |
| 2568 | rabbitwhite | `0x040001B4` | `0x1000010D` | 61 | 0.5 |

`ClothingTable 0x1000010D` carries a `ClothingBase` for setup `0x0200047B` with **zero** object
effects — it is a pure recolour — and palette template 61 resolves through `PaletteSet 0x0F000039`
at shade 0.5 to palette `0x040009AA`. We apply none of it, so 2568 renders on bare `PaletteBase`
with no recolour at all, which is the black fur that was reported. Two independent gaps produce
that:

- The exporter never selects `PropertyInt::PaletteTemplate` (3) or `PropertyFloat::Shade` (12)
  (`weenie_catalog_export.rs:193,199`), and `TemplateAppearance` has no field to hold them.
- `resolve_appearance` (`explorer_entity_driver.rs:763`) reads `clothing_base_did` only from
  *wielded* items. With nothing wielded it falls to `append_template_obj_desc`, which contributes
  nothing for a weenie with no biota ObjDesc rows.

Worn equipment already works and is unaffected: WCID 32836 (Bhravarn ibn Salizim) has no
ClothingBase or PaletteTemplate of its own and takes all four of its colours from wield rows with
`palette = 86`, which is the landed path.

Investigating the fix surfaced two further defects with the same root cause — the palette
selection has two carriers and we read only one — plus one place where our composition follows ACE
where the retail client disagrees. All four are addressed together because they are one change to
one contract.

### In Scope

- Catalog format v5 carrying `PropertyInt::PaletteTemplate` and `PropertyFloat::Shade`.
- Applying a weenie's own `ClothingBase` when no worn equipment paints its body.
- Correcting the wield-row palette overlay so an item keeps its own `PaletteTemplate` when the row
  authors none, and its own `Shade` on a treasure row.
- Removing the ACE-derived first-defined-template fallback that retail does not perform.
- Re-export of `dats/weenies.hwc`.
- Discarding `create_list` rows that name no weenie, which currently block six weenies from spawning
  at all (Phase 0, landed).
- Tolerating a clothing table that dresses no matching body on the held path, as the worn path
  already does (Phase 0b, landed).

### Out of Scope

- `AddSetupAsClothingBase` (`Creature_Networking.cs:248`, the Ursuin Guise case). Census: **zero**
  wield rows in paintable slots reference an item without a `ClothingBase`, so the branch is
  unreachable from shipped content. A documented gap, not a divergence.
- The creature/non-creature split over biota ObjDesc rows. ACE's base path never reads them; ours
  does. Census: 12 weenies world-wide carry such rows and **none** carries a `ClothingBase`, so the
  branches provably never collide.
- `ShadePackage` multi-value shades. Retail takes one shade per subpal-effect index
  (`acclient.c:444361`); we pass a scalar, as does ACE. A server-sent ObjDesc carries no shade at
  all — it ships resolved subpalettes — and the only multi-value producer is character creation.
  Revisit with the barber, not here.
- Any frontend, renderer, protocol, or feed change.

## Authority Split

This plan spans two questions with two different sources of truth. Conflating them is what
produced the wrong first draft of this fix.

| Question | Authority | Where it lives |
| --- | --- | --- |
| Given a clothing table, setup, template key and shade, what ObjDesc results? | **Retail decompile** — `ClothingTable::BuildObjDesc` is Turbine's own code | `holtburger-dat` |
| How does an ObjDesc paint a model? | **Retail decompile** | `holtburger-content`, frontend |
| Which clothing base, template and shade does *this weenie* use? | **ACE, unavoidably** | app-local `weenie_appearance.rs` |

The client never derives the third from weenie properties: it receives a resolved ObjDesc on the
wire. There is no decompile answer for "does the wearer's own ClothingBase apply" or "does worn
equipment override it", so ACE is the only available reference, and `weenie_appearance.rs` already
documents itself as ACE-server emulation rather than client behavior. The error to avoid is
letting that ACE grounding leak *downward* into the composition primitives, where Turbine's own
code is readable and disagrees.

Outcomes are certified by neither: the check is observed retail appearance plus DAT content. ACE
supplies the mechanism hypothesis only.

## Ground Truth

| Fact | Source |
| --- | --- |
| CLO composition: parts/textures, then palettes | `acclient.c:444235` (`ClothingTable::BuildObjDesc`) |
| Palette template `0` yields parts and textures but no palettes | `acclient.c:444343-444344` (`if (!a3) return 1;`) |
| A palette template key absent from the table yields no palettes | `acclient.c:444345-444347` (lookup miss falls through to `return 0`; `od` keeps the parts already applied) |
| Subpalette offset and colour count are applied in raw units | `acclient.c:444372-444373` |
| Shade is per subpal-effect index | `acclient.c:444361` (`ShadePackage::GetVal(a4, v14)`) |
| ObjDescs accumulate by layering into one target | `acclient.c:273308-273393` (char-gen composes base palette, hair, then four `BuildObjDesc` calls into one `ObjDesc`) |
| Setup fallback table for alternate body styles | `acclient.c:444283-444337` |
| Part/texture change application | `acclient.c:445751` (`ClothingBase::ApplyPartAndTextureChanges`) |
| A wearer's own `ClothingBase` applies when nothing worn paints the body | `Creature_Networking.cs:239` → `WorldObject_Networking.cs:906-976` |
| Biota ObjDesc rows apply only when nothing paintable is equipped | `Creature_Networking.cs:129-141` |
| Wield rows overlay the created item's own palette properties | `WorldObjectFactory.cs:409-414` |
| ACE's `/8` on CLO ranges is a storage artifact of its packed rows | `WorldObject_Networking.cs:967-968` vs `acclient.c:444372` |
| Live distributions below | `ace_world` via `ace-root` compose (2026-08-22 queries) |

## Census

Against live `ace_world` (43,913 templates) and the mounted HBA content:

| Measure | Count |
| --- | --- |
| Weenies carrying their own `ClothingBase` | 13,810 |
| …of those, also carrying `PaletteTemplate` and/or `Shade` | 12,331 |
| …of those, creatures (`WeenieType` 10) | 3,813 |
| …of those, also carrying wield rows (could be painted by equipment instead) | 727 |
| Guaranteed-unpaintable today (12,331 − 727) | 11,604 |
| Creatures carrying both their own `ClothingBase` and wield rows | 800 |
| …of those, wielding at least one item that carries a `ClothingBase` | 531 |
| Wield rows with `palette = 0` whose item carries its own `PaletteTemplate` | 1,484 |
| Treasure wield rows whose item carries a `ClothingBase` | 393 |

Resolving all 13,810 self-`ClothingBase` weenies against real DAT content:

| Outcome | Count |
| --- | --- |
| Clothing table has no base for the weenie's setup (no-op, as in retail) | 681 |
| Palette template `0` — parts and textures only | 1,447 |
| Palette template present in the table | 11,408 |
| …of those, more than one subpal effect (where `ShadePackage` would differ) | 1,444 |
| **Palette template missing from the table — ACE's first-key fallback fires** | **274** |

The 274 are weenies we would paint a colour retail leaves unpainted. Examples: WCIDs 17, 3675,
3703, 4235, 4236, 5181-5183. They split further by whether their clothing base paints anything at
all:

| Of the 274 | Count |
| --- | --- |
| CLO base has **zero** object effects — retail contributes nothing, so our current no-op already matches | 27 |
| CLO base **has** object effects — retail applies parts and textures, and the fix changes the model | 247 |

Separately, six `WieldTreasure` rows across six weenies name WCID 0. See Phase 0.

## Retail Evidence

Observations taken against retail on 2026-08-22, chosen so that each isolates one variable. Two of
them settle questions the decompile could only answer by inference.

**WCID 17 Gromnie — retail does not substitute a fallback palette.** Its clothing base for setup
`0x02000037` has **zero** object effects, so parts and textures cannot account for any difference;
the palette is the only variable. Its own template 71 is absent from table `0x100000AF` (which
defines 1-14, 17, 25, 27). ACE's fallback would substitute template 1 → `PaletteSet 0F0009EB` at
shade 0.5 → palette `040001BB`, replacing all 2048 colours over its `PaletteBase 040002AB` — a
conspicuous change. **Observed identical in retail and the Explorer**, which today applies nothing.
Retail therefore applies no palette for an absent template key, exactly as `acclient.c:444345`
reads, and ACE's substitution is an ACE-ism.

**WCID 4235 Thin Gromnie Hide — retail does apply the self-`ClothingBase` parts and textures.**
Clothing base `0x10000178` on setup `0x02000181` carries one object effect: part 0 → GfxObj
`0100029A`, with texture effect `05000F90 → 05000F95`. Its own template 22 is absent from the table.
**Observed different in retail and the Explorer**, which today applies nothing at all. The
difference is the texture swap. Paired with Gromnie this pins the behavior on both variables: parts
and textures yes, fallback palette no.

**WCID 25709 Bandit — supports the wield-row overlay.** The mask (25702) is the only one of its four
items whose wield row carries `palette = 0`; Breeches say 8, Shirt and Slippers say 14. Clothing
table `0x100004EF` defines exactly one template, 14, which is also the item's own: `PaletteSet
0F00051F` at shade 0 → palette `0400169F` over range offset 1920, 128 colours, on part 16.
**Observed different in retail and the Explorer.** This proves retail colours that mask differently
than we do; it does not uniquely prove the overlay is the mechanism, but the item's own
`PaletteTemplate` is the only palette fact in play and it is the single template that table defines.

**WCID 32689 Whispering Blade Guard, and WCID 25965 Maddened Zharalim — discarded, invalid tests.**
Both were reported as looking identical in retail and the Explorer, and neither observation carries
information: the boots' template 1 and Shadow's Garb's template 4 each define **zero subpal
effects**, so applying them is a no-op under retail, ACE, and this plan alike. Candidate selection
had filtered on "template present in the table" without also requiring that the template define
subpal effects. Both were chosen that way, the second after the first had already been diagnosed.

### Choosing a discriminating subject

A retail comparison only carries information when the two hypotheses predict different pixels. Every
subsequent subject must pass all of:

1. Wield row `palette = 0`, and the item authors its own `PaletteTemplate`.
2. The item's clothing table has a base for the setup it is applied to.
3. That template exists in the table.
4. **That template defines at least one subpal effect.**
5. **The replacement palette differs from the wearer's base palette inside the covered range**, at
   the shade the overlay would actually select.

Applied to the 111 shipped candidates that carry a wearer `PaletteBase`:

| Outcome | Count |
| --- | --- |
| No clothing base for the wearer's setup | 2 |
| Template absent from the table | 1 |
| **Template defines no subpal effects** | **48** |
| Palette identical to the wearer's base in range | 0 |
| **Viable, discriminating** | **60** |

Two things follow. Coincidental agreement is not the hazard — once a template defines effects, the
palette always differs. The hazard is the degenerate template, which is 43% of the population and
produces "looks the same" for a structural reason. And the Bandit Mask observation above **is**
valid: 128 of its 128 covered colours differ from the wearer's base palette, so it discriminated.

**WCID 11506 Zharalim — second discriminating subject, observed different.** Wearing 12193 Dho Vest
and Robe on a `palette = 0` row, 603 of 608 covered colours differ from its base palette
`040001BE`. Observed clearly different between retail and the Explorer, which applies no palette
there today. Defect 2 now rests on two independent subjects with different items, different
templates, and different wearers.

### The one hypothesis still merged

Both observations confirm retail applies *a* palette where we apply none, but neither yet proves
*which* template it chose. For the Bandit Mask the item's own template and the table's only defined
key are both 14, so the two readings coincide. Measured across the viable candidates:

| Item's own template vs the table's lowest key | Count |
| --- | --- |
| Coincide — cannot distinguish the readings | 16 |
| **Differ — can distinguish** | **46** |

11506 is in the second group, and its prediction is unusually clean. Its table defines 29 templates;
the item's own is 4 and the lowest is 1, and they disagree on the robe's largest range:

| Reading | Palette | Mean RGB over `[320, 640)` | Appearance |
| --- | --- | --- | --- |
| Item's own `PaletteTemplate` 4 | `04000EC6` | (173, 107, 37) | tan / orange-brown |
| Table's lowest key 1 | `04000ED8` | (54, 208, 181) | teal / cyan |

A single glance at that robe in retail settles it. Note the "lowest key" reading has no retail basis
in the first place — it is ACE's substitution, already disproven by WCID 17 — so this is a
confirmation rather than a live contest.

Other strong subjects, if more are wanted:

| Wearer | Wears | Differing colours | Spawns |
| --- | --- | --- | --- |
| 46885 Lugian Miner | 27453 Renegade Hauberk | 766 / 768 | 6 |
| 37084 Tanada Burrows Sapper | 87464 Shou-jen Shozoku Sleeve Gauntlets | 48 / 48 | 17 |

## Design

### One palette selection value

`ClothingPaletteSelection { palette_template: Option<u32>, shade: Option<f64> }`, resolved by two
constructors that name their carrier:

- `from_own_properties(&TemplateAppearance)` — the weenie's own facts.
- `overlay(&WieldEntry, &TemplateAppearance)` — ACE's item creation
  (`WorldObjectFactory.cs:409-414`): the row's palette wins when positive, otherwise the item keeps
  its own; the row's shade wins only on a non-treasure row, where that column is a shade rather
  than a selection probability.

Both `unwrap_or` into `build_obj_desc`'s existing `(u32, f64)` inputs. No gate method is required:
ACE's `Shade.HasValue || PaletteTemplate.HasValue` check (`WorldObject_Networking.cs:940`)
collapses under retail composition semantics, because template key `0` already yields no palettes.
The two rules disagree on exactly one population — 55 weenies with a `Shade` but no
`PaletteTemplate`, where ACE paints via its first-key fallback and retail paints nothing — and
retail wins.

`build_clothing` takes the selection instead of a whole `WieldedItem`, which collapses
`merge_item_clothing` (held children) and the new self-clothing path into one
`apply_clothing_base` call. `WieldedItem` sheds its `palette_template`/`shade` fields for the
composite.

### Composition order in `resolve_appearance`

Following `Creature_Networking.CalculateObjDesc` structurally:

1. Body layers (`AddBaseModelData` equivalent) — unchanged.
2. If nothing paintable is equipped and the template carries biota ObjDesc rows, apply those and
   stop (`:129-141`) — unchanged.
3. Merge worn equipment.
4. Otherwise, if the weenie carries its own `ClothingBase`, apply it (`:239`).

ACE's `coverage.Count == 0` test is whether anything *actually* painted, not whether anything
intended to: a garment whose table has no base for this body, or whose base has zero object
effects, contributes no coverage. 800 creatures carry both a self `ClothingBase` and wield rows, so
the distinction is live. `merge_worn_equipment` therefore yields its per-item ObjDescs rather than
folding them into the body appearance, and the driver applies them only when they paint.

Decision 2026-08-22: this lands as one change rather than shipping a naive "nothing paintable
equipped" gate first. The coverage-accurate test is the whole point of the phase.

ACE additionally *discards* the worn layer in that case and returns the base path's ObjDesc. That
is server-side reasoning with no decompile analogue and no way to verify; this plan implements the
observable part — nothing painted means self-clothing applies — and records the omission rather
than reproducing the discard on ACE's word alone. That exclusion is unchanged by the decision
above, which was about sequencing.

### Deletion, not addition

`build_clothing`'s first-defined-template fallback (`weenie_appearance.rs:528-538`) is removed.
Retail performs no such substitution: a missing key leaves the ObjDesc with its parts and textures
and no palettes — proven from `acclient.c:444345` and confirmed observationally by WCID 17 under
Retail Evidence. Removing it also restores the "fail loudly, no silent fallbacks" property — the
fallback currently hides a missing key behind a plausible wrong colour on 274 weenies.

The `palette_template_key == 0` early return in `build_obj_desc`
(`material.rs:528`) is **retail-correct and stays**. An earlier draft of this plan proposed
deleting it to match ACE; that would have moved 1,546 wield rows and 55 weenies off retail
behavior.

## Phases

### Phase 0 — Empty wield rows (landed 2026-08-22)

Unrelated to palettes, but it hard-blocked spawning six weenies and therefore blocked the empirical
work above, so it landed standalone and first.

Six `WieldTreasure` rows across six weenies (11506, 12186, 25965, 25966, 38029, 27799) name WCID 0.
That is how content spends part of a probability chunk on "no item". `select_wielded` correctly
selected such a row and the catalog lookup then raised `MissingWieldedItem`, so WCID 25965 could not
spawn at all. ACE keeps the row in the selection walk — it must, or the rows it outbids get promoted
in its place — and drops it only afterwards, when the weenie fails to create
(`Creature_Equipment.cs:622-624`).

`select_wielded` now discards `EMPTY_WIELD_WCID` rows after the walk rather than before it, giving
the function the postcondition that every returned row names a real weenie. That is what lets the
caller keep treating an unresolvable non-zero WCID as a hard error, which it still does.

Note that five of the six rows carry `shade = 0`, which makes them unconditional selections rather
than probability entries, so they failed on every spawn rather than intermittently.

The test asserts both halves and is checked against the plausible-but-wrong fix: filtering the rows
before the walk makes the selection identical to one with the rows removed for every seed, which the
test detects.

### Phase 0b — Clothing tables that dress no matching body (landed 2026-08-22)

Surfaced immediately by Phase 0, once WCID 25965 got far enough to equip.

`merge_item_clothing` passes the **item's own** setup, because a held item is rendered as its own
object rather than painted onto the wearer. 60 of the 854 wielded items that carry a `ClothingBase`
name a table with no base for that setup, and `build_clothing` raised `MissingClothingBase` as a
hard error for every one of them, failing the whole spawn.

Both references treat the omission as an ordinary no-op — retail's `BuildObjDesc` returns success
with the ObjDesc untouched (`acclient.c:444330-444331`), ACE skips its clothing block
(`WorldObject_Networking.cs:923`) — and `merge_worn_equipment` had always agreed, skipping a garment
with no mapping for the body. Only the held path disagreed. `build_clothing` now yields an empty
ObjDesc for that case, which places the rule once, on the path both callers share, rather than
duplicating the worn path's guard.

### Phase 0c — Out-of-range authored shades (landed 2026-08-22)

A pre-flight simulating all 10,940 wield rows against mounted content — 39,028 resolutions, covering
both the worn and held setups, under both today's behavior and the planned overlay — found exactly
two remaining spawn-blocking content failures, both `MissingPaletteSet`:

| Wearer | Item | Row palette | Row shade | Blocks |
| --- | --- | --- | --- | --- |
| 31365 Farmer Kao | 7772 Trident | 4 | **14** | today |
| 28701 Elena Du Furza | 2547 Staff | 0 | **1.2** | after the overlay lands |

Neither is a broken reference. Both are authored shades outside `[0, 1]`, and retail range-checks
for exactly that:

```c
// acclient.c:449254-449262 — PalSet::GetPaletteID
if ( v3 && (v4 = this[15]) != 0 && a3 <= 1.0 && a3 >= 0.0 )
    *a2 = /* selected palette */;
else
    *a2 = INVALID_DID_353.baseclass_0.id;
```

`PaletteSet::palette_id_for_shade` already applies the same range check and returns `None`, and ACE
returns `0` from the same guard — all three agree that an out-of-range shade selects no palette. The
defect is downstream: our resolver maps that `None` to `MissingPaletteSet`, which aborts the spawn.
Retail instead adds the subpalette carrying an invalid palette DID, which cannot recolour anything.

This is the fourth dialect of the design note below, and the third spawn-blocker it has produced.

**What retail actually does with the invalid subpalette**, settled from `Palette::Modify`:

```c
// acclient.c:349808 — the per-range overload rejects an invalid replacement outright
if ( this[8] || a2 == INVALID_DID_264.baseclass_0.id )
    return 0;

// acclient.c:349824 — and the list walker abandons the whole list at the first failure
while ( Palette::Modify(this, v2->subID, v2->offset, v2->numcolors) ) { v2 = v2->next; ... }
return 0;
```

`CPartArray::SetPalette` then returns 0 and recolours nothing (`acclient.c:314006-314021`). So an
out-of-range shade does not skip one range in retail — it suppresses **every** subpalette on that
object.

We nonetheless skip only the offending template's ranges, marked `RETAIL DIVERGENCE` in
`build_clothing`, because content cannot observe the difference. Census: both shipped cases are held weapons, whose entire subpalette set
comes from one template resolved at that single out-of-range shade, so every entry is invalid under
either reading and both produce an unrecoloured object. A held weapon is its own physics object, so
neither can suppress a wearer's skin, hair, or eye palettes. Modelling retail's poisoning faithfully
would mean giving `EntityAppearance` a failed state for two objects that look identical either way.

Should a future case pair an out-of-range shade with other, valid subpalettes on the same object,
this divergence becomes observable and must be revisited.

### Design note: content's silence is not our failure

Phases 0 and 0b are the same defect twice, and the plan's own fallback deletion is a third instance
of the surrounding confusion. Content says "nothing here" in several dialects:

| Dialect | Means | Correct response |
| --- | --- | --- |
| `create_list` row with WCID 0 | this probability chunk yields no item | spend the mass, drop the row |
| Clothing table with no base for a setup | this table does not dress this body | no changes |
| Palette template absent, or present and empty | no palette layer | no palettes |
| Shade outside `[0, 1]` | no palette selected | no recolour from that range |
| Clothing table DID that does not resolve | **a broken reference** | fail loudly |

"Fail loudly" governs the last row only. The first three are authored facts, and treating them as
failures is what produced two spawn-blocking bugs. Phase 2's `apply_clothing_base` collapse must
land this distinction by construction rather than by patch: exactly one of these conditions is an
error, and it is the one where content names something that does not exist.

### Phase 1 — Catalog v5 (landed 2026-08-22)

- `TemplateAppearance` gains `palette_template: Option<u32>` and `shade: Option<f64>`, each
  commented with why absence is distinct from zero.
- Exporter: add type 3 to the int filter and type 12 to the float filter, plus their `set_once`
  arms; reject a negative palette template through the existing `ValueOutOfRange` path.
- Encode via the existing `optional_u32`/`optional_f64`; bump `CATALOG_FORMAT_VERSION` 4 → 5.
- Re-export `dats/weenies.hwc` from live `ace_world`; survey reproduces the recorded distributions.

Landed as described. `TemplateAppearance` drops its `Eq` derive, because `shade` is an authored
float exactly as on `WieldEntry` and `WeenieTemplate`; nothing depended on the stronger bound. A
negative `PaletteTemplate` is rejected through the existing `ValueOutOfRange` path rather than being
folded into absence or wrapped into a huge key.

Re-exported at 43,913 templates, matching the recorded population, with provenance
`ACE-World-v0.8.8+v0.9.294` preserved. Spot-checked against the database: 2566 carries no clothing
base, template, or shade; 2567 carries template 4 shade 0.5; 2568 carries template 61 shade 0.5; and
4235 round-trips `Some(22)` with an absent shade, so absence survives independently per field.

### Phase 2 — Selection and composition (landed 2026-08-22)

- Introduce `ClothingPaletteSelection` with its two constructors.
- Re-point `build_clothing` at the selection; collapse `merge_item_clothing` and the self path into
  `apply_clothing_base`.
- Delete the first-defined-template fallback.

Landed as described. `ClothingPaletteSelection` carries both `Option` fields with two constructors
named for their carrier, `from_own_properties` and `overlay`; `WieldedItem` sheds its two scalars for
the composite. `merge_item_clothing` is gone, replaced by `apply_clothing_base`, which all three
paths share.

One correction the tests forced: mapping `MissingPaletteTemplate` to an empty ObjDesc is wrong.
Retail applies the parts and textures *first* and only then misses the template lookup, leaving them
in the ObjDesc it has already mutated (`acclient.c:444341-444347`). Returning an empty ObjDesc
dropped the garment's model entirely, which the Trophy Collector spawn test caught immediately. The
missing-template case now rebuilds with `NO_PALETTE_TEMPLATE`, reproducing retail exactly, while
`MissingClothingBase` keeps returning empty because retail returns there before applying anything.

### Phase 3 — Driver order (landed 2026-08-22)

- `merge_worn_equipment` yields its layers plus whether they paint.
- `resolve_appearance` implements the four-step order above.
- Held children resolve their selection through `overlay`, matching ACE's created-item properties.

Landed unsplit, as decided. `WornEquipmentLayer` is a newtype over the ordered per-item ObjDescs with
`paints_body()` and `apply()`; `merge_worn_equipment` became `resolve_worn_equipment` and no longer
takes the appearance. `resolve_appearance` follows ACE's order literally: biota rows when nothing
paintable is equipped, then the worn merge, then the wearer's own clothing base when the worn layer
painted nothing.

Both halves are mutation-tested. Disabling the self-clothing branch fails
`a_weenie_that_wears_nothing_paints_itself_through_its_own_clothing_base` and
`worn_equipment_that_paints_nothing_yields_to_the_wearers_own_clothing_base`; substituting the naive
"was anything equipped" gate for `paints_body()` fails the second alone, which is precisely the
distinction the phase exists for.

### Phase 4 — Proof (landed 2026-08-22)

- Focused unit tests (below).
- Temporary debug-harness run over the real catalog: report how many weenies gain a palette layer,
  and print the resolved `EntityAppearance` for 2566/2567/2568. Deleted afterwards — `dats/` is not
  checked in, and tests must not depend on uncommitted runtime assets.
- Browser-harness visual comparison of the three rabbits.

**Resolution over the real catalog and mounted content.** A temporary probe ran the landed self path
across every catalog record, then was deleted. 13,810 weenies carry both a clothing base and a setup;
**11,137 gained a palette layer, with zero errors** — no spawn-blocking content remains on this path.
The rabbits resolve to three distinct results:

| WCID | `palette_did` | Sub-palettes |
| --- | --- | --- |
| 2566 Black Rabbit | *(none)* | *(none)* |
| 2567 Brown Rabbit | `0x040001B4` | `0x04000AEB` over the full 2048 range |
| 2568 White Rabbit | `0x040001B4` | `0x040009AA` over the full 2048 range |

`0x040009AA` is exactly the palette the first content probe predicted for template 61 at shade 0.5,
resolved this time through the landed code rather than by hand.

**Runtime evidence.** `npm run harness:browser -- --brief --gpu --spawn-wcid <id> --spawn-distance 4`
against the real catalog host, GPU-backed, one run per subject:

| WCID | `paletteDid` | `subPalettes` | Screenshot |
| --- | --- | --- | --- |
| 2566 Black Rabbit | `null` | 0 | renders black |
| 2567 Brown Rabbit | `67109300` | 1 | renders brown |
| 2568 White Rabbit | `67109300` | 1 | **renders white** |
| 32836 Bhravarn ibn Salizim | `67108990` | 17 | fully dressed |
| 3921 Trophy Collector | `67108990` | 8 | fully dressed |

The two equipment-painted NPCs exercise the worn path end to end and are structurally unable to reach
the new branch: neither carries a self `ClothingBase`, and every one of 32836's wield rows authors a
positive palette, so the overlay changes nothing for them.

## Tests

Synthetic fixtures only.

- Codec: round-trip with both new fields present and absent; version rejection stays distinct
  across the bump.
- Exporter projection: types 3 and 12 land in their slots; unexpected-property errors still fire;
  a negative palette template is rejected.
- Resolver:
  - Self `ClothingBase` with a template present emits the CLO subpalettes.
  - Self `ClothingBase` with template `0` emits part and texture changes and **no** subpalettes —
    the Black Rabbit invariant, covering the 1,447 weenies that authored no template.
  - A palette template absent from the table emits no subpalettes rather than substituting one.
  - A wield row with `palette = 0` falls back to the item's own `PaletteTemplate`.
  - A treasure wield row uses the item's own `Shade`, not the row's probability column.
  - A worn layer that paints nothing leaves self-clothing to apply; one that paints suppresses it.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| ACE-only rules cannot be verified against retail | Each is marked in code with its ACE citation and an explicit note that no decompile counterpart exists; outcomes are checked against observed retail appearance and DAT content instead. The wield-row overlay is the one such rule with real blast radius (1,484 rows), and it now has two independent discriminating observations, WCID 25709 and WCID 11506 |
| Removing the first-key fallback changes 274 weenies | That is the intent, and WCID 17 confirms it observationally. 27 of the 274 are already no-ops; the other 247 gain parts and textures |
| A palette template can exist and define no subpal effects, making it a visual no-op | **Measured 2026-08-22.** Of the 11,408 self-path weenies whose template resolves in its own table, 282 define no subpal effects; **11,126 genuinely gain a palette layer**. Phase 4 should expect nearly everything to change, unlike the wielded `palette = 0` population where 43% are no-ops |
| Format bump invalidates an operator's catalog | Same discipline as v3/v4: version rejection is distinct, and `weenies.hwc` re-exports in the same change |
| Worn-layer restructure regresses the landed equipment path | WCID 32836 and the Trophy Collectors (3921/3922) are unchanged-appearance regression subjects; they exercise the worn path end to end |
| The coverage test disagrees with ACE on the 531 both-carriers creatures | The discard half is deliberately not implemented; the omission is recorded here and in code so a later observation can settle it |

## Definition of Done

- [x] Empty wield rows spend their probability and never reach the caller.
- [x] A clothing table that dresses no matching body yields no changes on both the worn and held
      paths; WCID 25965 spawns.
- [x] A shade outside `[0, 1]` skips the palette layer instead of failing the spawn, marked as a
      divergence with its census.
- [x] Catalog v5 exports `PaletteTemplate` and `Shade` losslessly; older versions rejected
      distinctly; `dats/weenies.hwc` re-exported.
- [x] One palette-selection type carries both carriers' facts; `merge_item_clothing` and the self
      path are one function.
- [x] The ACE first-key fallback is deleted and the retail zero-key return is preserved, each with
      an `acclient.c` citation in code.
- [x] WCIDs 2566/2567/2568 render black, brown and white respectively in the Explorer.
- [ ] WCID 4235 matches retail; WCID 17 remains unchanged. **Not re-checked against retail after the
      fix.** Both are predicted unchanged — 17 resolves no palette either way, and 4235 now gains the
      parts and textures retail applies — but that prediction is unverified.
- [x] WCID 32836 and 3921/3922 render fully dressed through the worn path after the change.
- [x] The empty-subpal-effect population is measured across the self path: 282 of 11,408 resolve to
      a no-op, so 11,126 genuinely gain a palette layer.
- [x] Every ACE-only rule carries its citation and its "no decompile counterpart" note.
- [x] No frontend, protocol, or feed contract change.

## Debt and Adjacent Observations

Carried out of implementation, none addressed here.

- `append_template_obj_desc` still copies `template.palette_base_did` into `appearance.palette_did`
  when that field is `None`. Both resolvers already seed it from the same value, so the branch is
  provably dead. Left alone to keep this change to its subject.
- `collision_scene_probe` in `holtburger-debug-harness` emits a `clippy::collapsible_else_if`
  warning. Confirmed pre-existing: that crate has no diff in this change.
- Held children still apply their own biota ObjDesc rows through `append_template_obj_desc`, where
  ACE's base path reads none. Unobservable on shipped content per the Out of Scope census — the 12
  weenies with such rows carry no `ClothingBase` — so it stays a documented gap.

Noted while reading the decompile; neither is addressed here.

- `ClothingBase::ApplyPartAndTextureChanges` (`acclient.c:445751`) adds a texture change even when
  an id is invalid, and reports failure through its return value — which `BuildObjDesc` uses to
  skip palettes entirely (`:444341`). Our `apply_part_and_texture_changes`
  (`material.rs:858`) returns a hard error instead. If shipped content never authors a zero id the
  difference is unobservable; that has not been measured.
- `resolve_clothing_base_setup_id` (`material.rs:897`) applies the alternate-body-style remap
  unconditionally, where retail consults the table only after a lookup miss (`acclient.c:444283`).
  These differ only if a clothing table carries a base for one of the remapped source setups
  directly; that has not been measured.
