# Asheron's Call Scene Lighting

This document records the retail client's lighting model as established from the End-of-Retail
decompile, plus the places where `holtburger-3d` deliberately reaches the same result by a
different mechanism. Everything below is proven from `acclient-eor-source/acclient.c` or measured
over the retail DAT archive; nothing is inferred from our own naming.

Retail is a Direct3D 9 **fixed-function** renderer. There is no shader lighting, and specular is
disabled globally (`acclient.c:440250`). Lighting reaches the screen through four paths:

| Path                                                | Applies to                 |
| --------------------------------------------------- | -------------------------- |
| Software per-vertex sun and ambient                 | Landscape                  |
| Fixed-function hardware lights plus `D3DRS_AMBIENT` | Object and building meshes |
| Burned-in static light in mesh vertex colors        | EnvCell interiors          |
| Material emissive (`luminosity`)                    | Any surface                |

## Regional Sun and Ambient

Sun and ambient are authored per region, per day group, as a ring of `SkyTimeOfDay` keyframes.
Each keyframe carries `dir_bright`, `dir_heading`, `dir_pitch`, `dir_color`, `amb_bright`,
`amb_color`, and the world-fog fields.

`DayGroup::GetTimeOfDay` (`acclient.c:290881`) selects the bracketing pair for a normalized day
fraction, wrapping the last keyframe back to the first. `SkyDesc::GetLighting`
(`acclient.c:290949`) interpolates them:

```text
ambient   = lerp(before.amb_bright, after.amb_bright, ratio)
amb_color = lerp8(before.amb_color, after.amb_color, ratio)
bright    = lerp(before.dir_bright, after.dir_bright, ratio)
heading   = deg2rad(lerp(dir_heading));  pitch = deg2rad(lerp(dir_pitch))
sun.x = sin(heading) * cos(pitch) * bright
sun.y = cos(heading) * cos(pitch) * bright
sun.z =                sin(pitch) * bright
```

The sun vector is **deliberately not normalized** — its length carries the authored brightness, so
consumers multiply by it directly rather than applying brightness as a separate term.

The day group itself is a pure hash of the in-game date (`SkyDesc::CalcPresentDayGroup`,
`acclient.c:291155`), so weather is reproducible without server state:

```text
h = (uint32)(1782775218 * (current_day + days_per_year * current_year) - 1967253934)
present_day_group = floor(h / 2^32 * num_day_groups)
```

Lighting is re-resolved only every `SkyDesc::light_tick_size` seconds of game time
(`LScape::UseTime`, `acclient.c:296190`), so it steps between samples rather than drifting.

## Ambient Levels

Three different ambient values exist, and conflating them is the easiest way to get this wrong:

- **Landscape** uses `LScape::ambient_level` directly.
- **Meshes** use the world ambient `|sunlight| * 0.2 + ambient_level`
  (`LScape::calc_object_light`, `acclient.c:140248`).
- **Sealed interiors** force a flat `0.2` white world ambient whenever the camera occupies a cell
  that does not author `SeenOutside` (`acclient.c:140480`), independent of time of day.

The interpolated ambient is floored at `LScape::min_ambient` = 0.2 (`acclient.c:747815`) so
authored night values never drive the world fully black.

## Landscape

`CLandBlockStruct::calc_lighting` (`acclient.c:339136`) bakes landscape lighting into per-vertex
colors with fixed-function lighting disabled:

1. Accumulate each triangle's plane normal into its three vertices.
2. Normalize, substituting `(0, 0, 1)` when the accumulated length is below `2e-4`.
3. Per vertex, per channel:
   `c = ambient_level * amb_color + max(0, dot(N, sunlight)) * sunlight_color`, clamped to 1.

`ACRender::landPolyDraw` (`acclient.c:684340`) writes that as the vertex diffuse and reuses the
**alpha** channel as the detail-texture fade: 255 below 10 m, ramping to 0 at 50 m.

Landscape receives no local lights of any kind.

### Authored terrain color variation is dead

`TerrainTex` carries `max/min_vert_bright`, `max/min_vert_saturate`, and `max/min_vert_hue`. In
the EoR client these six fields are read **only** by `TerrainTex::Pack` (`acclient.c:294081`) and
written **only** by `TerrainTex::UnPack` (`acclient.c:294167`). There is no HSV code anywhere in
the binary, and `CLandBlockStruct` has exactly one per-vertex color array, written solely by
`calc_lighting`. A faithful client must parse these fields for a lossless DAT round-trip and then
ignore them. Corroborating signs the feature was cut: `min_slope` at the neighbouring offset is
likewise unread and is not even serialized, and `TMTerrainDesc::UnPack` (`acclient.c:294811`)
unpacks exactly one `TerrainTex` into what is declared as a `SmartArray`, with every accessor
hardcoding index 0.

## Meshes

The effective fixed-function vertex color is:

```text
C = Emissive
  + Ambient_material * D3DRS_AMBIENT
  + Sum over lights of Diffuse_material * L.Diffuse * max(0, N·L) * atten(L)
```

clamped, and then **modulated into the texture** by the texture stage. Surface `luminosity` is
pure emissive (`CMaterial::SetLuminositySimple`, `acclient.c:345688`), so a luminous surface
scales its own texture rather than washing it out additively.

Point-light attenuation is `Attenuation1 = 1` with `Attenuation0 = Attenuation2 = 0`
(`acclient.c:432903`) — pure `1/d` inside `Range = falloff * 1.5` (`rangeAdjust`,
`acclient.c:44671`).

Retail enables the sun for the outdoor pass and disables it entirely for the cell pass
(`Render::useSunlightSet`, `acclient.c:364145`; `PView::DrawCells`, `acclient.c:441094`).

### Vertex normals

Authored `GfxObj` normals are stored verbatim: `CSWVertex::UnPack` (`acclient.c:349578`) performs
no normalization, validation, or fallback, and no code path derives a face normal for a missing
one. A census over the retail archive found **16,043 of 615,119 vertices (2.6%), across 1,000 of
15,318 objects, author exactly zero**. Retail's software sun term contributes nothing for them
because `max(0, N·L)` is zero; its point-light term still contributes, because the wrap term below
uses the unnormalized light delta. A faithful client preserves authored zeros rather than
inventing data.

## Outdoor Geometry Receives No Point Lights

This is the single most surprising rule in the model, so it is worth stating plainly: **in retail,
outdoor terrain, buildings, and objects are lit by the sun and the global ambient only.** A lamp
post standing in a landblock casts no light on the ground, on nearby objects, or on itself.

`Render::useSunlight` is a _render-pass_ flag, not a time-of-day or sun-visibility flag. It is
written only by `Render::useSunlightSet` (`acclient.c:364145`): `1` when `PView::DrawCells` begins
the outdoor pass (`acclient.c:441094`, restored at `441234`) and `0` for the EnvCell pass
(`441170`). The entire lighting logic of `RenderDeviceD3D::DrawMeshInternal` is one line
(`acclient.c:436516`):

```c
if ( !Render::useSunlight )
    Render::minimize_object_lighting();
```

So local lights are programmed into hardware slots **only during the indoor pass**.
`useSunlightSet(1)` resets all eight slots and adds exactly one entry — the sun
(`acclient.c:364152`) — leaving the other seven explicitly disabled. The player's own viewer light
is therefore invisible outdoors too, because it is a dynamic light and dynamic entries never enter
the table while `useSunlight == 1`.

Outdoor lights are not merely unused at draw time; they never reach the global light set at all.
Outdoor objects _do_ register their lights on their containing cell
(`CPhysicsObj::enter_cell` → `CPartArray::AddLightsToCell` → `CObjCell::add_light`,
`acclient.c:306571`, `313079`, `332796`), so a `CLandCell` genuinely holds a populated
`light_list`. But every caller of `add_static_to_global_lights` / `add_dynamic_to_global_lights`
walks `CEnvCell::visible_cell_table` (`acclient.c:335800`, `334987`) or the dressing-room cell
(`137839`). There is no outdoor equivalent of that loop, so the list is collected and dropped.

Burn-in is likewise indoor-only: `CEnvCell::UnPack` constructs its mesh with
`burn_in_static_lights = 1` (`acclient.c:335258`), while every `CGfxObj` mesh — objects and
buildings alike — passes `0` (`acclient.c:436061`). `SetStaticLightingVertexColors` has exactly
one call site, inside `DrawEnvCell` (`acclient.c:436444`).

Point lights in Asheron's Call are an **indoor-only feature**. Outdoors the budget is one
directional sun plus a global ambient, and that is all.

## Interior Static Lights

Authored lights live on object **Setups**, not on EnvCells — `CEnvCell::light_array` is allocated
and never used even in retail. Each `LIGHTINFO` (`acclient.h:13465`) carries a type, an offset
frame, color, intensity, falloff, and cone angle. `CPartArray::InitLights` (`acclient.c:314152`)
registers an object's lights into its containing cell.

Measured over the whole retail archive: **198,334 placed lights across 146,307 lit cells, from 288
distinct light-bearing setups. Every one is type 0 (point)**, and `cone_angle` is uninitialized
memory (`0xCDCDCDCD`) in every asset. Intensity ranges 20–100 and falloff 1–15. Lights per lit
cell: median 1, p99 5, maximum 26.

Retail delivers these two different ways depending on what is being drawn. The **cell shell** gets
them burned into its vertex colors (below). **Indoor residents** — the furniture and props inside a
cell — are `CGfxObj` meshes, so they are never burned in; they receive the same lights as _hardware_
lights instead, via `Render::minimize_object_lighting` (`acclient.c:364212`), which fills up to
eight slots with dynamic lights first and then static ones. The two paths use different falloff
shapes: the burn-in applies the half-Lambert wrap below, while the hardware path applies standard
`max(0, N·L)` with `1/d` attenuation.

Retail additionally _skips_ spot lights structurally in the burn-in path: the type dispatch has no
spot branch (`acclient.c:434632-434651`), and `LIGHTINFO::convert_to_local` (`acclient.c:433979`)
drops the frame's rotation, so a spot direction cannot even exist there.

### The burn-in

`D3DPolyRender::SetStaticLightingVertexColors` (`acclient.c:434570`) bakes static lights into the
mesh's vertex diffuse at construction. Per vertex, per light, `calc_point_light`
(`acclient.c:434189`):

```text
D     = lightPos - vertPos;  d2 = |D|^2;  d = |D|
range = falloff * 1.3                       // static_light_factor, acclient.c:44703
if (d < range) {
    w = (0.5 * d + dot(N, D)) / 1.5         // half-Lambert wrap, UNNORMALIZED N and D
    if (w > 0) {
        atten = (d2 <= 1) ? w / d : w / (d2 * d)
        s     = atten * (1 - d / range) * intensity
        per channel: c += min(s * color.c, color.c)
    }
}
```

The accumulated result is clamped to `[0, 1]`. The per-channel clamp to the light's own color is
what bounds the result, since authored intensity is far above unity.

Two quirks worth knowing before matching retail exactly: with zero static lights the vertex diffuse
is written **black**, not left alone (`acclient.c:434617-434684`), and the final write forces
alpha to `0xFF`, discarding the per-vertex translucency alpha written at build time.

Crucially, the bake uses the union of **nearby visible cells'** lights, not only the owning cell's:
`CObjCell::add_static_to_global_lights` is called across `CEnvCell::visible_cell_table`
(`acclient.c:335800`). That is what lets a torch light the corridor through a doorway.

At draw time the burned-in color enters through the emissive slot
(`FFEmissiveColorSource = FromVertex`, `acclient.c:434243`), so it **adds** to the ambient term
rather than replacing it. Only _dynamic_ lights reach hardware slots when drawing EnvCells
(`Render::minimize_envcell_lighting`, `acclient.c:363190`).

## Viewer Headlamp

`SmartBox::set_viewer` (`acclient.c:137873`) attaches one white point light to the viewer. It is
placed at offset `(0, 0, 2)` when a player carries it and at the camera with **no offset** when
there is no player — the free-camera case. Falloff is 10.0 (`acclient.c:43910`) and intensity is
`0.5 * 4.5` (`acclient.c:728925`). It is always registered as a dynamic light, so it is never
baked.

## Fog

Fog is authored alongside lighting on the same `SkyTimeOfDay` keyframes and interpolated by the
same ratio, so the two can never drift. `SkyDesc::GetWorldFog` (`acclient.c:291072`) returns fog
only when **both** bracketing keyframes set `world_fog`.

The device runs vertex fog, linear, range-based:

- `D3DRS_FOGTABLEMODE = D3DFOG_NONE` — no pixel fog
- `D3DRS_FOGVERTEXMODE = D3DFOG_LINEAR` (`acclient.c:440357`)
- `D3DRS_RANGEFOGENABLE = 1` (`acclient.c:440257`) — true radial distance, not view-space depth

so `f = saturate((fogEnd - dist) / (fogEnd - fogStart))` with `dist` the Euclidean distance to the
eye, and a **straight ramp** — no smoothstep.

Additive surfaces are excluded from fog per draw (`acclient.c:434175`).

## Constants

| Symbol                               | Value                                                           | Location                 |
| ------------------------------------ | --------------------------------------------------------------- | ------------------------ |
| `LScape::min_ambient`                | 0.2                                                             | acclient.c:747815        |
| Sealed-interior ambient              | 0.2, white                                                      | acclient.c:140521        |
| Mesh world ambient                   | `\|sunlight\| * 0.2 + ambient_level`                            | acclient.c:140248        |
| Default `ambient_level` / `sunlight` | 0.4 / (1.2, 0, 0.5)                                             | acclient.c:295928        |
| Lighting with no authored keyframes  | ambient 0.3, white, dir (0.5, 0, 0.8)                           | acclient.c:290949        |
| Point-light attenuation              | Att0 0, Att1 1, Att2 0                                          | acclient.c:432903        |
| Hardware light range multiplier      | 1.5                                                             | acclient.c:44671         |
| Burn-in range multiplier             | 1.3                                                             | acclient.c:44703         |
| Burn-in wrap                         | `(0.5·d + N·D) / 1.5`, per-channel clamp to light color         | acclient.c:434220        |
| Light tick / sky tick                | code defaults 20.0 s / 3.0 s; EoR Dereth authors 15.0 s / 0.8 s | acclient.c:290941        |
| Always-daylight day fraction         | 0.5                                                             | acclient.c:295885        |
| Terrain detail fade                  | 255 at 10 m to 0 at 50 m                                        | acclient.c:684401        |
| Viewer light falloff / intensity     | 10.0 / 2.25                                                     | acclient.c:43910, 728925 |
| Max static / dynamic lights          | 40 / 7 (degrade-scaled)                                         | acclient.c:44527         |
| Hardware light slots                 | 8                                                               | acclient.c:437231        |
| Specular                             | disabled globally                                               | acclient.c:440250        |

Read region data for the tick sizes rather than the code defaults: EoR Dereth authors values that
differ from them.

## Where holtburger-3d Diverges

These are deliberate, and each produces output equivalent to retail:

- **Sun and ambient evaluate in the vertex shader** for both landscape and meshes, rather than
  being baked per landblock. The formula is identical; evaluating it live makes a time-of-day
  change a uniform update instead of a re-bake of every loaded landblock.
- **Interior static lights are still baked**, matching retail, but the bake gathers every light in
  the landblock and relies on the authored range cutoff instead of consulting a live visibility
  set. For static content that is equivalent to retail's nearby-visible-cells union.
- **Cell shell geometry is duplicated per cell** so each cell can carry its own bake. Retail could
  share less carefully because it constructed one mesh per cell. Shell structures are tiny — median
  10 vertices, maximum 113, 45,320 vertices across all 3,145 structures in the archive — so the
  duplication is cheaper than splicing per-cell color streams onto shared buffers.
- **The viewer headlamp evaluates in the shader** rather than occupying a hardware light slot,
  since it moves with the camera and cannot be baked.
- **Retail's gamma-naive 8-bit color math is preserved.** No sRGB conversion or tone mapping is
  applied anywhere; adding either would diverge from the retail look.

Deferred, and therefore currently absent: entity-carried dynamic lights and the `SetLight`
animation hook, nearest-N light selection and hardware-slot allocation, timed
`SetLuminosity`/`SetDiffusion` interpolation, spell and quest environment overrides
(`LScape::m_override_*`), the sky pass, and the screen-brightness preference.
