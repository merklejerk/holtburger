# Textures & Materials

This document records how Asheron's Call represents textures and materials across
three reference codebases:

- **Retail client** ([`acclient-eor-source/`](../../acclient-eor-source/)) — ground truth.
- **ACE Server** ([`ACE/`](../../ACE/), vendored inside [`ACViewer/`](../../ACViewer/)) — DAT parsers
  and a partial physics port.
- **ACViewer** ([`ACViewer/`](../../ACViewer/)) — a working renderer that consumes ACE's
  parsed data.

It also lists the discrepancies between the open-source ports and the retail
client, and the design recommendations we should follow in `holtburger-dat`,
`holtburger-content`, `holtburger-world`, and the renderer in `apps/holtburger-3d`
to stay close to client behavior.

> When the docs and the retail client disagree, the retail client wins.
>
> This is the authoritative holtburger reference for textures and materials.
> Older notes in `texturing_and_materials.md` were folded into this document.

## Scope and priority

The near-term renderer target is the legacy AC material path, not the dormant
EOR programmable material system:

1. Decode and preserve `RenderSurface`, `RenderTexture`, `CSurface`, `Palette`,
   `PaletteSet`, `ObjDesc`, clothing, and terrain data accurately.
2. Render static `GfxObj` and environment geometry with real solid, direct-color,
   indexed, and clipmapped materials.
3. Apply per-instance `ObjDesc` texture swaps and subpalette changes.
4. Add terrain texture blending and preserve serialized terrain color-variation
   fields for later validation.
5. Recognize modern `RenderMaterial`/`MaterialModifier`/`MaterialInstance`
   files without blocking asset loading; defer full parsing until content
   pressure proves it is needed.

## Reference layers

The client's texture/material system is layered. From bottom to top:

| Layer | DAT type | Client struct | ACE class | Purpose |
|---|---|---|---|---|
| Pixel grid | `0x06` | `RenderSurface` ([`acclient.h:10938`](../../acclient-eor-source/acclient.h)) | `Texture` | A single 2D image: width/height, pixel format, palette ID (optional), raw bytes. |
| Mipmap chain | `0x05` | `RenderTexture` ([`acclient.h:11702`](../../acclient-eor-source/acclient.h)) | `SurfaceTexture` | An array of `RenderSurface` DataIDs (one per mip level) plus type/format/level-count metadata. |
| UI texture | `0x15` | `RenderTexture` (same struct) | `RenderTexture` | UI-targeted mip chain; same shape as 0x05. |
| Material | `0x08` | `CSurface` ([`acclient.h:13427`](../../acclient-eor-source/acclient.h)) | `Surface` | The "material": either a textured surface (links a `RenderTexture` + base palette) or a solid color. Carries translucency, luminosity, diffuse. |
| Palette | `0x04` | `Palette` | `Palette` | 8-bit color tables. Up to 2048 colors, addressed in groups of 8. |
| Palette set | `0x0F` | `PalSet` ([`acclient.h:50694`](../../acclient-eor-source/acclient.h)) | `PaletteSet` | Multiple palettes selectable by hue (used for shading / dye). |
| Mesh material binding | n/a | `Polygon` slots indexing `m_rgSurfaces` on `GfxObj` | `Polygon.PosSurface/NegSurface` | Each polygon picks two materials (front/back) by index into the mesh's surface list. |
| Appearance overlay | runtime | `ObjDesc` ([`acclient.h:15478`](../../acclient-eor-source/acclient.h)) | `ObjDesc` | Per-instance overrides: subpalettes, texture swaps, animation-part swaps. |
| Outfit recipe | DAT `0x10000000` | `ClothingTable` ([`acclient.h:50659`](../../acclient-eor-source/acclient.h)) | `ClothingTable` | Maps `(setup, palette template, shade)` → an `ObjDesc`. |
| Terrain material | runtime | `TexMerge` ([`acclient.h:46984`](../../acclient-eor-source/acclient.h)) | `TextureMergeInfo` | Per-pcode merged landscape texture (base + up to 3 terrain overlays + up to 2 road overlays). |

## Pixel format and palette flow

`RenderSurface` (DAT `0x06`) stores the pixel grid in a `PixelFormat` declared by
`SurfacePixelFormat` enum (see [`acclient.h`](../../acclient-eor-source/acclient.h)
and ACE's `SurfacePixelFormat.cs`). Common formats:

- `PFID_P8` / `PFID_INDEX16` — 8/16-bit palette indices; the `m_didPalatte` field
  on the `RenderSurface` points at the palette DataID.
- `PFID_A8R8G8B8` / `PFID_R8G8B8` — direct RGB(A).
- `PFID_DXT*` — pre-compressed block formats (used by the high-res JPEG retex
  pack via `PFID_CUSTOM_RAW_JPEG`).

**Indexed textures are first-class.** Skin, hair, and dyed clothing all depend on
swapping the active palette for an indexed `RenderSurface`. The renderer must
sample the palette at draw time — it cannot just bake to RGBA at load.
ACViewer uploads palettes as small 1D textures and does the lookup in the pixel
shader; we should do the same.

The high-res JPEG retex pack (`client_highres.dat`) substitutes JPEG-encoded
`RenderSurface` blobs at the same DataIDs. The custom `PFID_CUSTOM_RAW_JPEG`
format decodes via standard JPEG and swaps R/B channels at load.

### WebGL palette sampling strategy

For indexed textures, upload the index image and palette separately rather than
expanding to RGBA at asset load time. That keeps per-instance dye and appearance
changes cheap and avoids incorrect texture cache sharing.

Recommended GPU resources:

- Index texture: single-channel texture for `PFID_P8`, or an integer/packed path
  for `PFID_INDEX16`.
- Palette texture: 1D/2D lookup texture sized to the actual palette length, not
  hard-coded to 256 entries. AC palettes can be larger, and 16-bit indices need a
  wider lookup.
- Per-instance palette view: either a small uploaded palette with subpalette
  replacements already applied, or shader-visible range replacement data if that
  proves faster later.

Fragment shader sketch for the `PFID_P8` case:

```glsl
uniform sampler2D tIndexMap;
uniform sampler2D tPalette;
uniform float uPaletteLength;
uniform bool uClipmap;
uniform float uTranslucency;
varying vec2 vUv;

void main() {
    float normalizedIndex = texture2D(tIndexMap, vUv).r;
    float index = floor(normalizedIndex * 255.0 + 0.5);

    if (uClipmap && index < 8.0) {
        discard;
    }

    float paletteCoord = (index + 0.5) / uPaletteLength;
    vec4 color = texture2D(tPalette, vec2(paletteCoord, 0.5));
    color.a *= 1.0 - uTranslucency;
    gl_FragColor = color;
}
```

This sketch intentionally covers only the 8-bit indexed path. The 16-bit path
needs an integer-safe representation and should be designed when we have a
fixture that requires it.

## CSurface (the "material")

The packed wire format ([`CSurface::Serialize` at acclient.c:343379](../../acclient-eor-source/acclient.c)):

```
type             : u32   // SurfaceType flag mask
if (type & 0x6) {        // Base1Image | Base1ClipMap
    orig_texture_id : u32   // -> RenderTexture (0x05)
    orig_palette_id : u32   // -> Palette (0x04), or 0
} else {
    color_value  : u32   // packed ARGB solid color
}
translucency     : f32
luminosity       : f32
diffuse          : f32
```

`SurfaceType` is a flag mask, but only bits `0x2` (`Base1Image`) and `0x4`
(`Base1ClipMap`) trigger the image branch on unpack. `Base1Solid = 0x1` on its
own falls through to the color branch.

### Runtime state that ACE drops

[`acclient.h:13427`](../../acclient-eor-source/acclient.h) shows `CSurface` carries
more state than the wire format does:

```cpp
SurfaceHandlerEnum handler;            // SH_UNKNOWN/SH_DATABASE/SH_PALSHIFT/SH_TEXMERGE/SH_CUSTOMDB
unsigned int color_value;
int solid_index;                       // runtime-resolved solid palette index
IDClass indexed_texture_id;            // current active SurfaceTexture (after TM changes)
ImgTex *base1map;                      // cached resolved image
Palette *base1pal;                     // cached resolved palette
float translucency, luminosity, diffuse;       // mutable, "current"
IDClass orig_texture_id, orig_palette_id;      // immutable, dat originals
float orig_luminosity, orig_diffuse;           // immutable, dat originals
```

After unpack, the client mirrors `luminosity → orig_luminosity` and
`diffuse → orig_diffuse`, calls `InitEnd(SurfaceInitLoading)`, and sets
`handler = SH_DATABASE`. ACE collapses these to a single set of fields and
treats `Surface` as read-only.

### `SurfaceHandlerEnum`

Defined at [`acclient.h:3964`](../../acclient-eor-source/acclient.h):

| Value | Meaning |
|---|---|
| `SH_UNKNOWN` (0) | Not yet initialized. |
| `SH_DATABASE` (1) | Standard DAT-loaded material. |
| `SH_PALSHIFT` (2) | Landscape palette-shift mode (`LandSurf.Type == 1`). Unused in retail; ACE throws on this path. |
| `SH_TEXMERGE` (3) | Landscape merged terrain texture (output of `TexMerge::MakeNewSurface`). |
| `SH_CUSTOMDB` (4) | Runtime-mutated copy of a database material. Set automatically when a `CSurface` is copy-constructed. |

The handler is the renderer's dispatch tag — it decides which sampling path to
use. ACE has no equivalent.

## ObjDesc and the appearance pipeline

`ObjDesc` is the per-instance overlay applied on top of a `Setup`'s default
materials. It is produced two ways:

1. **From a `ClothingTable`** by `ClothingTable::BuildObjDesc(setup, paletteTemplate, shade)`.
2. **By the server** sending appearance overrides directly in a Create message.

### Packed wire format

[`ObjDesc::UnPack` at acclient.c:448703](../../acclient-eor-source/acclient.c):

```
magic                       : u8   // must equal 0x11; reject otherwise
num_palettes                : u8
num_texture_map_changes     : u8   // capped at 255 on read
num_anim_part_changes       : u8
if (num_palettes > 0) {
    palette_id              : u32  // DataID, known type 0x04000000
    subpalettes[num_palettes]      // see Subpalette below
}
texture_map_changes[num_texture_map_changes]
anim_part_changes[num_anim_part_changes]
align next read to 4 bytes
```

Notes from the client unpack body:

- The 255 cap on `num_texture_map_changes` is enforced — overflow silently
  discards new entries.
- `RemoveDuplicateTextureMapChange` is called per entry during unpack so a later
  swap targeting the same part replaces (not stacks on) an earlier one.
- In memory the client uses singly-linked lists (`firstSubpal`/`lastSubpal`/
  `num_subpalettes`, and similar for the two `*_changes` lists). ACE flattens to
  `List<T>`. Wire format is identical.

### Subpalette

[`Subpalette::UnPack` at acclient.c:450438](../../acclient-eor-source/acclient.c):

```
subID    : u32   // DataID, known type 0x04000000 (palette)
offset   : u8 ; offset *= 8        // dest offset in target palette
numcolors: u8 ; if 0 then 256 ; numcolors *= 8
```

The `* 8` quantization is in the client and is correct in ACE.

### TextureMapChange & AnimPartChange

```
TextureMapChange { partIndex : u8 ; oldTextureID : u32 ; newTextureID : u32 }
AnimPartChange   { partIndex : u8 ; partID : u32 }
```

## ClothingTable

[`acclient.h:50659`](../../acclient-eor-source/acclient.h):

```cpp
class ClothingTable : public DBObj {
    PackableHashTable<DataID, ClothingBase>      _cloBaseHash;          // keyed by Setup DID
    PackableHashTable<unsigned int, CloPaletteTemplate> _paletteTemplatesHash;  // keyed by PaletteTemplate enum
};
```

**Naming**: ACE renames most of the nested types. The client names (and the
struct shapes) are:

| ACE name | Client name | Source |
|---|---|---|
| `ClothingBaseEffect` | `ClothingBase` | [acclient.h:18671](../../acclient-eor-source/acclient.h) |
| `CloObjectEffect` | `CloObjectEffect` | [acclient.h:18679](../../acclient-eor-source/acclient.h) |
| `CloTextureEffect` | `CloTextureEffect` | [acclient.h:18689](../../acclient-eor-source/acclient.h) |
| `CloSubPalEffect` | `CloPaletteTemplate` | [acclient.h:18715](../../acclient-eor-source/acclient.h) |
| `CloSubPalette` | `CloSubpalEffect` (note lowercase `pal`) | [acclient.h:18724](../../acclient-eor-source/acclient.h) |
| `CloSubPaletteRange` | — (inline parallel arrays `rangeStart[]` / `rangeLength[]`) | |
| `Icon` (on `CloSubPalEffect`) | `iconID` | |
| `PaletteSet` (on `CloSubPalette`) | `palSet` | |

`CloObjectEffect` member names: client uses `partNum`, `objectID`,
`textureEffects` (ACE: `Index`, `ModelId`, `CloTextureEffects`).
`CloTextureEffect` uses `oldTexID`, `newTexID` (ACE: `OldTexture`,
`NewTexture`).

Wire format is identical despite the renames. The `paletteTemplates` map's key
is a small integer (`PaletteTemplate` enum), **not** a DataID — ACE's
`Dictionary<uint, …>` is correct.

### Shade selection

`PalSet::GetPaletteID(hue)` in the client is:

```
palIndex = (int)((PaletteList.Count - 0.000001f) * hue);
clamp palIndex to [0, Count-1];
```

ACE's `PaletteSet.cs` has this exactly, including the magic epsilon, and even
calls out the Aerfalle's Pallium (WCID 8133) bug-fix. **Do not change the
epsilon** — it is intentional client behavior.

## Terrain pipeline

Landscape rendering is the area where ACE/ACViewer diverge most from the
retail client.

### Pcode-driven assembly (matches client)

For each terrain tile the client computes a `pcode` from the four corner terrain
types and a `rcode` from road bits. `TexMerge::FillTempTexBuffer`
([acclient.c:294957](../../acclient-eor-source/acclient.c)):

```
GetTerrain(pcode, terrain_tex[4], tcode[3])     // base + up to 3 overlays
GetRoadCode(pcode, road_fill, rcode[2])         // up to 2 road overlays
base = road_fill ? roadBase : terrain_tex[0]
CopyAndTile(buf, tex_size, base)
for i in 0..3: if tcode[i]:
    FindTerrainAlpha(tcode[i], &alpha, &rot, pcode)
    Merge(buf, tex_size, alpha->texture, rot, terrain_tex[i+1])
for j in 0..2: if rcode[j]:
    FindRoadAlpha(rcode[j], &alpha, &rot, pcode)
    Merge(buf, tex_size, alpha->texture, rot, roadBase)
```

The output is a **single 256×256 RGBA texture per unique pcode**, wrapped in a
`CSurface` with `handler = SH_TEXMERGE`, cached and shared across all landcells
with the same pcode. Each landcell draws with one texture sample.

### Serialized terrain color-variation fields

`TerrainTex` carries six fields ACE faithfully unpacks but neither ACE nor
ACViewer apply:

```
min_vert_bright / max_vert_bright
min_vert_saturate / max_vert_saturate
min_vert_hue / max_vert_hue
```

The current retail decompile does not show these fields feeding landblock
vertex lighting or `TexMerge` texture generation. `CLandBlockStruct::calc_lighting`
computes vertex lighting from polygon normals, ambient light, and sunlight only;
`TexMerge::CopyAndTile` / `Merge` use `tex_gid`, `base_texture`, and
`tex_tiling`. Treat the six color-variation fields as serialized data that
should be preserved, not as a proven rendering requirement.

Earlier versions of this research described these fields as "HSB jitter." That
was an inference from the field names and from the visual problem of repeated
terrain tiling, not behavior proven from the retail client. Until a call path is
found, avoid implementing a synthetic jitter pass and avoid documenting these
fields as active retail rendering behavior.

### Detail texture pass

`TerrainTex.DetailTexGID` / `DetailTexTiling` drive a second high-frequency
detail surface. `LandSurf::GetDetailTex` and `LandSurf::GetDetailTiling` select
the texture and tiling from `TexMerge.terrain_desc[terrain_number]`, where the
terrain-number slots used by `LScape::SetDetailTexturing` are:

| Terrain number | Detail role |
|---:|---|
| `0` | Landscape |
| `1` | Building |
| `2` | Environment |
| `3` | Object |

`LScape::GenerateDetailSurface` wraps the selected detail texture in a custom
`CSurface` (`SH_CUSTOMDB`) and marks the surface type with `0x20000`.
Landblock drawing binds terrain detail as:

```
Render::curr_detail_surface = Render::landscape_detail_surface
Render::curr_detail_tiling = Render::landscape_detail_tiling
Render::curr_detail_src_blend = BLEND_SRCALPHA
Render::curr_detail_dst_blend = BLEND_INVSRCALPHA
```

There are two retail render paths:

- Single-pass, when the device supports it and the base surface is not a
  clipmap: stage 0 samples the base material, stage 1 samples the detail
  texture with wrapped linear filtering. Stage 0 uses `TEXOP_PREMODULATE` for
  alpha; stage 1 uses `TEXOP_BLENDCURRENTALPHA` for color and
  `TEXOP_MODULATE` for alpha.
- Multi-pass fallback: draw the base surface first, then bind the detail
  surface at stage 0, switch to the detail UVs, and alpha-blend over the base
  with `BLEND_SRCALPHA` / `BLEND_INVSRCALPHA`.

Detail UVs reuse the base UVs after texture-size scaling and then multiply by
`curr_detail_tiling`. Both paths fade the detail overlay by camera depth:
alpha is 255 before `zw = 10`, fades linearly to 0 from `zw = 10..50`, and is 0
after `zw = 50`. Some non-landscape paths honor `noFadeDetail`; land terrain
does not appear to bypass this fade.

### ACE port: structurally present but inactive

ACE's `ACE.Server.Physics.Common.TextureMergeInfo` mirrors the client's data
flow (`BuildTexture` populates the same per-overlay records) but the actual
`Merge` and `CopyAndTile` calls are commented out — it never produces the
merged byte buffer. ACE also throws `NotImplementedException` on
`LandSurf.Type == 1` (`SH_PALSHIFT`).

### ACViewer: GPU multi-pass (different architecture)

ACViewer ignores `TexMerge` and does the blend in `texture_clamp.fx`
([`CombineOverlays` line 392, `CombineRoad` line 439](../../ACViewer/ACViewer/Content/texture_clamp.fx)):

- Atlas chains via `Texture2DArray xOverlays` + `Texture2DArray xAlphas`.
- Per-vertex z coord = array index per layer (negative = unused).
- `maskBlend3` blends three terrain overlays.
- Roads use `1 - (a0 * a1)` multiplicative alpha.

This is far cheaper in VRAM, scales to the high-res JPEG pack at native
resolution, and gives clean mipmaps and anisotropic filtering — but the per-
pixel output does not match the client's pre-merged texture bit-for-bit.

### holtburger-3d terrain direction

Use the ACViewer-style GPU blend path for the browser renderer unless exact
retail pixel output becomes a hard requirement. The practical path is:

1. Preserve terrain base textures, alpha maps, road maps, detail maps, tiling,
   and the six serialized terrain color-variation fields in `holtburger-dat`.
2. Carry terrain material references through `holtburger-content` landblock
   preparation instead of reducing terrain to debug colors.
3. Build terrain batches that bind texture arrays for base/overlay/alpha/road
   textures.
4. Add detail texture sampling from the proven detail-surface path.
5. Revisit the serialized terrain color-variation fields only if a later retail
   trace or visual comparison proves they are used by an active render path.

## The "modern" programmable material system (RenderMaterial / MaterialModifier / MaterialInstance)

Everything above describes the **legacy** material path — `CSurface` (0x08), the
fixed-function shader (texture + palette + diffuse/luminosity/translucency), and
the per-poly `m_rgSurfaces` binding. That is what 100% of retail content
actually uses and what ACE/ACViewer model.

The client also ships a second, much richer material system that is mostly
**dormant** in retail data. It's worth knowing about because:

- It exists in the engine and is what a from-scratch client would need to
  cover for full file-format parity.
- ACE has placeholder DAT type entries for it but **no parser** — so we'd be
  on our own.
- Per [`ACE.DatLoader.Tests/DatTests.cs:144-146`](../../ACViewer/ACE/Source/ACE.DatLoader.Tests/DatTests.cs),
  retail `client_portal.dat` contains exactly **1 file of each type** —
  `RenderMaterial` (0x16), `MaterialModifier` (0x17), `MaterialInstance`
  (0x18). The system was clearly built out but never put into broad use.

### DAT types

| DAT type | Client struct | Description |
|---|---|---|
| `0x16` `RenderMaterial` | [`acclient.h:11791`](../../acclient-eor-source/acclient.h) | A full programmable material: array of `MaterialLayer`s, per-material shader constants, opacity, multi-pass flags. |
| `0x17` `MaterialModifier` | [`acclient.h:11721`](../../acclient-eor-source/acclient.h) | A bag of `MaterialProperty` overrides. Applied to a `RenderMaterial` to mutate it. |
| `0x18` `MaterialInstance` | [`acclient.h:11751`](../../acclient-eor-source/acclient.h) | A "use" of a `RenderMaterial`: base material DID + list of `MaterialModifier` refs → produces a `m_pModifiedMaterial`. |

### `MaterialLayer`

[`acclient.h:11835`](../../acclient-eor-source/acclient.h):

```c
struct MaterialLayer {
    u32 m_Options;
    u32 m_TrueFlags, m_FalseFlags;
    RenderPassType m_RenderPass;
    SmartArray<ShaderResourceType,1> m_ShaderResources;   // VS+PS source/binary
    SmartArray<LayerStage*,1> m_Stages;                   // texture stages (fixed-function)
    SmartArray<LayerModifier*,1> m_FFModifiers;           // procedural UV/property mods
    BlendMode m_SourceBlend, m_DestBlend;
    BlendOpType m_BlendOp;
    DepthTestMode m_DepthTest;
    bool m_DepthWrite;
    CullModeType m_CullMode;
    bool m_AlphaTest;
    Waveform m_AlphaTestRef;          // <-- ANIMATED alpha threshold
    RGBAColor m_cDiffuse, m_cSpecular;
    Waveform m_wSpecularPower;        // <-- ANIMATED specular exponent
    RGBAColor m_cDye;
};
```

This is conceptually close to a **Quake 3 shader stage**: configurable blend
modes, depth/cull state, programmable shaders, animated material parameters
via `Waveform`, and per-stage UV modifiers.

`LayerStage` ([`acclient.h:11869`](../../acclient-eor-source/acclient.h)) is one
texture binding within the layer: sampler name, texture DID (→ `RenderTexture`
0x05), address modes, filter modes, and fixed-function color/alpha combiner
ops.

### `Waveform` — the animation primitive

[`acclient.h:10055`](../../acclient-eor-source/acclient.h):

```c
struct Waveform {
    WaveformType type;       // see enum below
    float base, base_vel;
    float amplitude, amplitude_vel;
    float phase, phase_vel;
    float frequency, frequency_vel;
    float roughness, roughness_vel;
};

enum WaveformType {
    WAVEFORM_INVALID = 0,
    WAVEFORM_NONE    = 1,    // constant; evaluates to `base`
    WAVEFORM_SPEED   = 2,    // linear ramp: base + frequency*t
    WAVEFORM_NOISE   = 3,    // hash-based pseudo-random
    WAVEFORM_SINE    = 4,    // base + amplitude * sin(2π * (frequency*t + phase))
    WAVEFORM_SQUARE  = 5,    // duty-cycled square; `roughness` likely controls width
    WAVEFORM_BOUNCE  = 6,    // |sin| / triangle bounce
    WAVEFORM_PERLIN  = 7,    // Perlin noise (1D)
    WAVEFORM_FRACTAL = 8,    // fractional Brownian motion
    WAVEFORM_FRAMELOOP = 9,  // discrete frame counter (for sprite-sheet animation)
};
```

The `*_vel` fields are **per-second deltas** applied to the corresponding base
parameters — they let the parameters themselves drift over time (e.g.
`frequency_vel != 0` makes a sine sweep). Exact integration semantics aren't
nailed down here; the eval lives somewhere we haven't traced yet.

A `Waveform` is sampled at render time, given the current game time, and
produces a scalar that drives whatever it's wired to.

### `LayerModifier`s — procedural UV / property animation

These are the AC equivalents of Q3's `tcMod` stack. Each is a small object
holding `Waveform`s that drive UV (or other) transforms per frame.

| Client struct | Drives | Fields |
|---|---|---|
| `LM_UVTranslate` ([`acclient.h:42410`](../../acclient-eor-source/acclient.h)) | Scrolling textures | `texCoordIndex`, `Waveform uTranslate, vTranslate` |
| `LM_UVRotate` ([`acclient.h:42434`](../../acclient-eor-source/acclient.h)) | Rotating textures | `texCoordIndex`, `Waveform rotate` |
| `LM_UVScale` ([`acclient.h:42457`](../../acclient-eor-source/acclient.h)) | Pulsing scale | `texCoordIndex`, `Waveform uScale, vScale` |
| `LM_UVTransform` | Full 2x3 UV matrix | _(not enumerated above; same pattern)_ |
| `WaveformPropertyValue` ([`acclient.h:44026`](../../acclient-eor-source/acclient.h)) | Any `MaterialProperty` value | `Waveform m_value` |

So an animated water material would, e.g., bind a noise/perlin texture, add
`LM_UVTranslate` with `WAVEFORM_SPEED` u/v components for a constant scroll,
plus `LM_UVRotate(WAVEFORM_SINE)` for a wobble, plus a
`WaveformPropertyValue(WAVEFORM_SINE)` on the diffuse alpha for a fade.

### `MaterialProperty` / `BasePropertyDesc` and `GRVDataType_Waveform`

The generic property system (`MaterialModifier::properties`) is a typed
key/value store. `GRVDataType_Waveform = 0xE`
([`acclient.h:2244`](../../acclient-eor-source/acclient.h)) is one of the supported
value types, alongside `Int`/`Float`/`Vector3`/`RGBAColor`/`PString`/etc. That
means any named material property can be either a constant or a `Waveform`,
and the engine will sample it per-frame.

ACE mirrors this enum in [`ACE.Entity/Enum/BasePropertyType.cs`](../../ACViewer/ACE/Source/ACE.Entity/Enum/BasePropertyType.cs)
(`Waveform = 11`), but again, no parser uses it.

### Don't confuse `Waveform` with `WaveFile`

| Concept | Type | DAT | Purpose |
|---|---|---|---|
| `Waveform` | inline struct (44 bytes) | n/a | Material animation primitive (sine/perlin/etc.) for UV scrolling, alpha pulsing, etc. |
| `WaveFile` (audio) | DAT object | `0x0A` | An audio sample. Covered in [`audio.md`](../audio.md). |

Same family of words, completely unrelated systems. The audio one is what the
"wave" / DAT 0x0A entries are; the material one is what shows up inside
`MaterialLayer` / `LM_UV*`.

### What we should do about it

Short answer: **defer it**, with awareness.

- It's safe to ship `holtburger` with only the legacy `CSurface` material
  path because retail content effectively doesn't use the modern system.
- DAT loader should at least **recognize** type IDs `0x16` / `0x17` / `0x18`
  and not panic — we can stub them with "unknown material file, length
  recorded, body skipped" until we have a parser.
- If we ever do build out the modern path, design our `Material` data model
  with extension points (layered stages, per-stage UV mods, animated
  properties) so we don't have to rip out the legacy model. The cleanest
  bridge is: treat legacy `CSurface` as a special-case `MaterialLayer` with
  one texture stage, no shaders, no modifiers — i.e. the legacy data
  collapses into a degenerate modern material at load time.
- `Waveform` itself is small enough to implement standalone whenever we
  need it: 11 floats + an enum, eval function that returns
  `base + amplitude * basis(frequency*t + phase)` plus per-frame integration
  of the `_vel` deltas. Trivial Rust struct.

## holtburger-3d renderer strategy

The current `apps/holtburger-3d` renderer already has enough geometry metadata
to start introducing real materials:

- `PreparedGfxObjPayload.surfaceIds` preserves the `GfxObj` surface list.
- `PreparedPolygonSetRenderGeometry.triangles` carries each triangle's source
  polygon and surface slot.
- Prepared geometry already includes UVs when source data has them.
- Static objects, buildings, interiors, and terrain currently use generated
  colors rather than AC material data.

### Material resource ownership

Keep parsing and content resolution out of Three.js code. The app should receive
prepared material/texture payloads from the host/content layer and own only GPU
resource lifetime.

Recommended app-local responsibilities:

- Decode or upload direct-color `RenderSurface` textures.
- Upload indexed textures and palette lookup textures.
- Create Three.js materials for solid, direct-color, palettized, and clipmapped
  surfaces.
- Cache GPU resources by resolved material identity plus per-instance appearance
  overlays.
- Dispose textures and materials through the existing renderer lifecycle.

Do not cache visible player or creature materials by `GfxObjId` alone. The cache
key must include texture-map changes and palette/subpalette changes, or distinct
outfits and dye colors will collapse to the same GPU resource.

### Batching key

Batch geometry by resolved render material, not just by `GfxObj` or debug color.
A useful first key is:

```text
material source:
  solid color surface id
  image surface id + render texture id + palette id

appearance overlay:
  part-indexed texture-map changes
  palette/subpalette changes

render behavior:
  clipmap flag
  translucency/luminosity/diffuse
```

Start with one mesh per material bucket. Consider `BufferGeometry` groups later
if draw-call count becomes the bottleneck.

### Shader use

Use stock Three.js materials for simple solid and opaque direct-color surfaces
when they match AC behavior closely enough. Use custom shader materials for:

- Indexed palette lookup.
- Clipmap discard (`Base1ClipMap`, index values below 8).
- AC-specific luminosity/diffuse/translucency behavior when stock lighting
  diverges.
- Terrain texture-array blending.

### Render-state mapping notes

These mappings are useful for the modern material path and for any legacy state
we choose to expose through internal material descriptors:

| AC cull mode | Value | Three.js mapping |
|---|---:|---|
| `CULLMODE_NONE` | `1` | `DoubleSide` |
| `CULLMODE_CW` | `2` | `BackSide` or `FrontSide`, depending on AC-to-Three handedness conversion |
| `CULLMODE_CCW` | `3` | `FrontSide` or `BackSide`, depending on AC-to-Three handedness conversion |

| AC depth test | Value | Three.js mapping |
|---|---:|---|
| `DEPTHTEST_NEVER` | `1` | `NeverDepth` |
| `DEPTHTEST_LESS` | `2` | `LessDepth` |
| `DEPTHTEST_EQUAL` | `3` | `EqualDepth` |
| `DEPTHTEST_LESSEQUAL` | `4` | `LessEqualDepth` |
| `DEPTHTEST_GREATER` | `5` | `GreaterDepth` |
| `DEPTHTEST_NOTEQUAL` | `6` | `NotEqualDepth` |
| `DEPTHTEST_GREATEREQUAL` | `7` | `GreaterEqualDepth` |
| `DEPTHTEST_ALWAYS` | `8` | `AlwaysDepth` |

| AC blend factor | Value | Three.js mapping |
|---|---:|---|
| `BLEND_ZERO` | `1` | `ZeroFactor` |
| `BLEND_ONE` | `2` | `OneFactor` |
| `BLEND_SRCCOLOR` | `3` | `SrcColorFactor` |
| `BLEND_INVSRCCOLOR` | `4` | `OneMinusSrcColorFactor` |
| `BLEND_SRCALPHA` | `5` | `SrcAlphaFactor` |
| `BLEND_INVSRCALPHA` | `6` | `OneMinusSrcAlphaFactor` |
| `BLEND_DSTALPHA` | `7` | `DstAlphaFactor` |
| `BLEND_INVDSTALPHA` | `8` | `OneMinusDstAlphaFactor` |
| `BLEND_DSTCOLOR` | `9` | `DstColorFactor` |
| `BLEND_INVDSTCOLOR` | `10` | `OneMinusDstColorFactor` |
| `BLEND_SRCALPHASAT` | `11` | `SrcAlphaSaturateFactor` |

| AC blend op | Value | Three.js mapping |
|---|---:|---|
| `BLENDOP_ADD` | `1` | `AddEquation` |
| `BLENDOP_SUBTRACT` | `2` | `SubtractEquation` |
| `BLENDOP_REVSUBTRACT` | `3` | `ReverseSubtractEquation` |
| `BLENDOP_MIN` | `4` | `MinEquation` |
| `BLENDOP_MAX` | `5` | `MaxEquation` |

Texture address mapping:

| AC address mode | Value | Three.js mapping |
|---|---:|---|
| `TEXADDRESS_WRAP` | `1` | `RepeatWrapping` |
| `TEXADDRESS_MIRROR` | `2` | `MirroredRepeatWrapping` |
| `TEXADDRESS_CLAMP` | `3` | `ClampToEdgeWrapping` |

Texture filter mapping:

| AC filter mode | Value | Three.js mapping |
|---|---:|---|
| `TEXFILTER_NONE` | `0` | `NearestFilter` |
| `TEXFILTER_POINT` | `1` | `NearestFilter` / `NearestMipmapNearestFilter` |
| `TEXFILTER_LINEAR` | `2` | `LinearFilter` / `LinearMipmapLinearFilter` |

### Implementation milestones

1. Add DAT parsers and tests for `RenderSurface`, `RenderTexture`, `CSurface`,
   `Palette`, and the common pixel formats needed by visible world objects.
2. Extend prepared asset responses with material references and texture
   dependencies.
3. Replace debug colors on static `GfxObj` renderables with solid and
   direct-color texture materials, preserving debug fallback for missing data.
4. Add terrain material rendering with texture arrays, road overlays, and
   detail textures; preserve unused terrain color-variation fields.
5. Add indexed texture upload, palette upload, clipmap discard, and per-instance
   palette cache keys.
6. Apply `ObjDesc` texture swaps and subpalette changes for spawned objects and
   setup parts.
7. Recognize modern material DAT types and report unsupported diagnostics
   without blocking asset loading.

## Current holtburger integration findings

This pass reviewed the current Rust content path, the Tauri host adapter, and
the Three.js renderer. The important shape is:

- `holtburger-dat` already recognizes the relevant DAT file type IDs:
  `Palette` (`0x04`), `SurfaceTexture`/`RenderTexture` (`0x05`),
  `Texture`/`RenderSurface` (`0x06`/`0x07`), `Surface`/`CSurface` (`0x08`),
  and `Clothing` (`0x10`). It does not yet parse those records into typed
  Rust structures.
- The "essential" DAT profile excludes the material stack today. `Palette`,
  `RenderTexture`, `RenderSurface`, `CSurface`, and `ClothingTable` are not
  part of `StripperManifest::logic_only()` or the micro profile.
- `holtburger-content` currently reads and caches landblocks, env cells,
  scenes, setups, and `GfxObj`s, but it has no surface/material/texture
  accessors. This is the right layer to add dependency resolution from mesh
  surface slots to material recipes.
- Landblock preparation already preserves the material binding we need.
  Prepared polygon-set render geometry carries per-triangle `surface_id` and a
  per-geometry `surface_ids` table. Env-cell surfaces are expanded to
  `0x08000000 | surface_index`, while `GfxObj` surfaces are carried as their
  DAT IDs.
- The Tauri `HostBoundaryAdapter` only serves `LandblockPack`,
  `LandblockSummary`, `GfxObj`, and `SetupModel` payloads. It already serializes
  `surfaceIds` and per-triangle `surfaceId`, but it does not expose material
  assets, texture bytes, palette data, or material dependencies.
- `apps/holtburger-3d` currently renders structured interiors and static
  objects with debug `MeshStandardMaterial`s. Static objects are batched as
  `InstancedMesh`es keyed mostly by chunk and `GfxObj`, which is good for the
  placeholder path but not enough once two instances of the same setup can have
  different texture swaps or palette changes.
- The checked-in `dats/assets.hba` contains material record types, but its
  flags show many entries are pruned. The renderer needs an archive capability
  diagnostic and, for real parity, a full/render-oriented HBA profile that
  preserves visual geometry and all material dependencies.

These findings mean the first real-material implementation should not start in
Three.js. It should start by making the content layer able to resolve a
lossless material dependency graph, then let the app-local renderer decide how
to batch and upload that graph to the GPU.

### Current renderer coverage target

This plan is intended to texture every AC-authored world surface that
`holtburger-3d` currently renders:

- structured interior cell geometry, using env-cell surface indices resolved to
  `CSurface` material records;
- indoor and outdoor static renderables, including setup-model parts, using
  `GfxObj` surface slots and part placement;
- terrain tiles, replacing height/type debug coloring with terrain texture
  layers, road overlays, and detail textures.

It does not try to texture renderer-owned helper geometry such as portal
stencil masks, portal aperture pass meshes, selection/debug overlays, or other
diagnostic lines. Those should remain technical/debug materials. It also does
not fully implement the sparse modern material DAT path; the near-term target
is to recognize those records and report unsupported diagnostics without
blocking legacy world rendering.

### Texture animation scope

The initial material pass should be treated as a textured static snapshot. It
does not fully implement animated texture behavior.

There are two distinct animation paths to keep separate:

- Legacy animation hooks `TextureVelocity` (`23`) and `TextureVelocityPart`
  (`24`) set per-object or per-part UV velocity. Retail routes these through
  `CPhysicsObj::SetTextureVelocity` / `SetPartTextureVelocity`, stores gfx IDs
  in `CPhysics::texture_velocity_gids`, and each frame calls
  `CGfxObj::TexVelocity` to mark the constructed mesh as UV-animated with a
  current UV delta. `holtburger-dat` currently preserves these hook payloads
  opaquely, but `holtburger-3d` does not execute animation hooks or animate UVs.
- Modern DAT `RenderMaterial` / `MaterialModifier` / `MaterialInstance`
  records can animate layer properties with `Waveform` and `LayerModifier`
  records such as UV translate, rotate, and scale. These records are sparse in
  retail and are not part of the near-term legacy material target.

Add animated texture support after static material binding is working. The
legacy first step should be to parse the two texture-velocity hook payloads
into typed data, preserve them in setup/animation assets, and expose a renderer
UV-offset path keyed by object/part instance rather than mutating shared
`GfxObj` geometry. Full modern `Waveform` material animation remains deferred
until a visible asset needs it.

## Tighter client integration plan

### Phase 0: archive capability and diagnostics

Status: **implemented for archive-level capability and current visual
source-to-`CSurface` references**.

The implemented phase 0 path lives in `holtburger-content` and is surfaced by
the `holtburger-3d` host startup:

- count available `CSurface`, `RenderTexture`, `RenderSurface`, `Palette`, and
  `ClothingTable` records;
- report whether visual source records used by the 3D client are pruned;
- parse available `GfxObj` and `EnvCell` visual source records only far enough
  to collect referenced `CSurface` IDs;
- report referenced `CSurface` IDs as available, pruned, or missing;
- mark the archive material-complete only when all tracked legacy material
  record classes are present and unpruned, current visual source records are
  unpruned, and referenced `CSurface` records are present;
- keep the current debug material renderer as the fallback when the archive is
  not material-complete.

Decision: phase 0 does **not** validate deep material dependencies yet. Without
typed `CSurface`, `RenderTexture`, `RenderSurface`, and `Palette` parsers, any
claim that `CSurface -> RenderTexture -> RenderSurface -> Palette` edges are
complete would be guesswork. That validation moves into phases 1 and 2 after
the DAT structs exist.

Course correction: the capability report belongs in `holtburger-content`, not
inside the Three.js renderer. The content repository already owns mounted HBA
indexes and resource lookup behavior, so it can produce the same report for the
browser app, debug harnesses, and future client frontends. The Tauri adapter
currently logs the report on startup; a later host-contract phase can expose it
as a typed frontend diagnostic if the UI needs it.

For normal 3D development, add or use an HBA profile that preserves visual data
and the material stack; do not rely on the logic-only or micro profiles.

### Phase 1: DAT parsers and focused fixtures

Status: **implemented for the legacy material records and ObjDesc appearance
changes needed by the near-term renderer**.

Added typed parsers in `holtburger-dat` for:

- `Palette` (`0x04`);
- `RenderTexture` (`0x05`, currently named `SurfaceTexture` in ACE);
- `RenderSurface` (`0x06`/`0x07`, currently named `Texture` in ACE);
- `CSurface` (`0x08`);
- `ObjDesc` texture and palette changes, matching retail dedup behavior.

Parser coverage and tests now include:

- `Palette` ARGB tables;
- `RenderSurface` headers, source bytes, indexed default palettes, and
  `PixelFormatId` metadata for `A8R8G8B8`, `R8G8B8`, `R5G6B5`, `A4R4G4B4`,
  `P8`, `INDEX16`, `A8`, `DXT1`, `DXT3`, `DXT5`, and raw JPEG;
- `RenderTexture` mip/source surface ID chains;
- `CSurface` solid color, textured-without-palette, and textured-with-palette
  cases. `CSurface` records do not carry their own DataID in the body; callers
  must pair the parsed body with the archive entry ID;
- `ObjDesc` marker validation and retail texture-change deduplication, where a
  later change replaces an earlier change with the same part index and old
  texture.

Decision: phase 1 is a **lossless parser step**, not a texture decoder step.
`RenderSurface` preserves source bytes and format metadata; conversion to GPU
formats, palette sampling, DXT upload/decompression policy, and JPEG decoding
belong in renderer/resource-cache phases. This keeps `holtburger-dat` focused
on static DAT decoding instead of frontend presentation.

Course correction: the existing `char_gen` `ObjDesc` reader also needed the
retail `0x11` marker check and duplicate-change behavior. It now matches the
new material `ObjDesc` parser, avoiding two subtly different parsers for the
same appearance structure.

Open follow-up: `RenderTexture` preserves the ACE-observed persisted shape
(`id`, unknown `i32`, texture type byte, `RenderSurface` ID list). The retail
runtime `RenderTexture` contains richer per-level resource state, but the DAT
file loader path currently proven in ACE/ACViewer does not expose meaningful
names for the unknown field. Keep it named `unknown` until a retail trace or
fixture proves its semantic role.

### Phase 2: material graph in `holtburger-content`

Status: **implemented for static `GfxObj` and env-cell material slots, plus
deep legacy dependency validation**.

This phase added `holtburger-content` material graph APIs that turn existing
geometry references into explicit material recipes:

- `GfxObj` surface slots -> `ResolvedMaterialSlot[]`;
- env-cell surface indices -> `ResolvedMaterialSlot[]`;

`ResolvedMaterialRecipe` preserves the immutable legacy material facts the
renderer needs for initial scheduling: `surface_id`, `SurfaceType`, solid color
or texture source, `RenderTexture` ID, mip/render-surface IDs, explicit palette
ID, render-surface default palette IDs, translucency, luminosity, and diffuse.
It intentionally does **not** carry decoded pixel bytes; that remains a phase 3
/ phase 4 host and renderer-resource-cache concern.

The phase 0 capability report now validates the full legacy dependency chain:

- visual source records still provide the root `CSurface` references;
- available `CSurface` records are parsed to find `RenderTexture` and explicit
  palette IDs;
- available `RenderTexture` records are parsed to find render-surface/mip IDs;
- available indexed `RenderSurface` records are parsed to find default palette
  IDs;
- referenced `RenderTexture`, `RenderSurface`, and `Palette` records are
  reported as available, pruned, or missing;
- parser failures for `CSurface`, `RenderTexture`, `RenderSurface`, and
  `Palette` records block `material_complete`.

Decision: this phase keeps parsed DAT records immutable and exposes stable
recipe IDs instead of renderer-owned objects. Runtime appearance state still
belongs in later resolved descriptors keyed by the actual inputs: surface ID,
render texture ID, palette ID, texture swaps, subpalette changes, translucency,
luminosity, and diffuse color. This prevents the renderer from caching all
players or spawned objects by `GfxObjId` alone.

Course correction: `Setup + ObjDesc` resolution was not included in the first
phase 2 implementation. The new APIs cover material slots for static meshes and
interior cells, but setup part selection, texture-map changes, animation part
changes, and clothing/subpalette edits still need an appearance-aware resolver.
That resolver should reuse the phase 1 `ObjDesc` parser and return a material
appearance key rather than mutating the base `CSurface`/`RenderTexture`
records.

Refinement for the next steps: host scheduling should consume these material
recipe IDs before inlining bytes. Prepared `GfxObj` and landblock payloads can
list material recipe dependencies first; separate material/render-surface
payloads can then carry compact bytes and format metadata only when requested.

### Phase 3: host contract, asset scheduling, and runtime appearance

Extend `ContentAssetRequest` and prepared responses with material dependency
edges before sending texture bytes inline:

- prepared `GfxObj` and landblock payloads list required material asset IDs;
- material asset payloads list their render-texture, render-surface, explicit
  palette, and default render-surface palette dependencies;
- render-surface payloads carry compact binary pixel data plus format metadata,
  not JSON-expanded texels.

This keeps landblock payloads small and lets the existing asset scheduler fetch
texture resources independently. The host boundary should expose typed
capability errors for missing material dependencies instead of silently
downgrading to debug colors.

Phase 3 must also implement the runtime appearance layer that sits on top of
the phase 2 base material graph. Static world geometry can use the phase 2
recipes directly; dynamic actors and setup-authored objects need a resolved
appearance key before renderer caching is safe.

Required runtime appearance deliverables:

- add a content-level setup/appearance resolver that takes a setup ID plus
  optional `ObjDesc`/appearance inputs and returns selected part mesh IDs,
  resolved material recipe IDs, and a stable material appearance key;
- apply `ObjDesc.texture_changes` as `RenderTexture` substitutions for the
  matching part/old-texture pair, without mutating the base `RenderTexture`
  record;
- apply `ObjDesc.anim_part_changes` before material binding so part swaps use
  the replacement mesh's own surface table and material slots;
- carry `ObjDesc.palette_id` and `ObjDesc.sub_palettes` into the appearance
  key and palette dependency list, even if subpalette pixel rewriting remains a
  renderer/cache implementation detail until phase 4;
- route protocol/entity creation appearance data into this resolver instead of
  letting renderer code apply ad hoc texture overrides;
- expose missing/pruned/unsupported appearance dependencies as typed host
  capability errors, not silent debug-material downgrades.

Acceptance criteria for this phase: a dynamic actor/setup payload with a
texture-map change must request the replacement `RenderTexture` and render with
a different material appearance key than the same setup without that change.
Two entities sharing the same base setup but different texture or palette
overrides must not share a renderer material instance unless the resolved
appearance keys are identical.

### Phase 4: renderer material resource cache

Add an app-local material resource cache under `apps/holtburger-3d` and inject
it into the world-display renderer. Its responsibilities:

- convert resolved material recipes into Three.js `Material` and `Texture`
  resources;
- cache GPU textures by render-surface ID and decode parameters;
- cache palette textures by palette ID plus subpalette edits;
- cache material instances by resolved appearance key, including runtime
  texture substitutions and palette/subpalette edits, not by mesh ID;
- dispose textures and materials through the renderer lifecycle.

Keep the existing debug material path behind an explicit missing-material
fallback so world rendering remains usable while individual formats are added.

### Phase 5: first batching shape

Use a conservative material-aware batching path first:

- structured interiors: use `BufferGeometry` groups or split geometry by
  contiguous material runs;
- static `GfxObj`s: create render buckets by chunk, `GfxObj`, material recipe,
  and appearance key;
- keep `InstancedMesh` only for objects whose material recipe and appearance key
  are identical.

This is intentionally less aggressive than the current debug instancing, but it
matches the AC data model. Reintroduce broader instancing later after material
identity is stable.

### Phase 6: terrain materials

Terrain should follow the shared material graph and renderer resource cache,
but it should not wait for `ObjDesc` or clothing. Its dependencies are mostly
parallel to object appearance: terrain needs DAT parsers for terrain-specific
records plus a custom shader path, while clothing needs runtime appearance
composition.

- parse `TerrainTex`, `TMTerrainDesc`, `LandSurf`, `TexMerge`, and terrain alpha
  maps in Rust;
- pass ACViewer-style terrain layer data to the app renderer;
- blend base, terrain overlays, and road overlays on the GPU with texture
  arrays;
- preserve the serialized terrain color-variation fields in the data model, but
  do not implement a jitter approximation unless a later trace proves an active
  retail render path uses them;
- implement detail-texture rendering from the proven detail-surface path as a
  separate overlay using detail UVs and distance fade. Do not bake detail
  textures into the terrain texture merge or the base/overlay/road texture-array
  blend.

Avoid a CPU `TexMerge::FillTempTexBuffer` clone unless exact retail-pixel parity
becomes more important than renderer flexibility.

### Phase 7: indexed textures, `ObjDesc`, and clothing

Implement indexed texture rendering with palette textures first. Compose
subpalette edits into a per-appearance palette texture on the CPU, then sample
the indexed source texture in a shader material.

Implement retail `ObjDesc` behavior in Rust:

- validate the `0x11` magic byte;
- enforce byte-sized change counts;
- remove duplicate texture changes while unpacking, with later changes winning
  for the same part and old texture.

After direct `ObjDesc` works, implement `ClothingTable::BuildObjDesc` in
`holtburger-content`. Do not depend on ACViewer's `GetVisualPriority` helper as
core behavior; retail clothing appearance is driven by `BuildObjDesc`,
`ClothingBase`, palette templates, and subpalette effects.

## Cross-reference summary: where ACE/ACViewer diverge from the client

| Topic | Client (truth) | ACE / ACViewer | Recommendation |
|---|---|---|---|
| DAT `0x06` name | `RenderSurface` (pixel grid) | `Texture` | Rename to `RenderSurface`. |
| DAT `0x05` name | `RenderTexture` (mip chain) | `SurfaceTexture` (described as "list of Texture IDs") | Rename to `RenderTexture`, model as proper mip chain. |
| DAT `0x16` / `0x17` / `0x18` | `RenderMaterial` / `MaterialModifier` / `MaterialInstance` — full programmable material system with shaders, layers, animated `Waveform` properties | DAT type IDs known but **no parser** — these files are silently unhandled | Recognize the IDs so DAT loading doesn't panic. Defer full parsing (retail ships 1 file of each). |
| Animated material properties | `Waveform` (sine/perlin/etc.) drives UV translate/rotate/scale, alpha threshold, specular power, arbitrary `GRVDataType_Waveform` properties | Not modeled | Implement on demand; not blocking. Standalone 11-float struct. |
| DAT `0x05` semantics | Real mip chain with type/format/level-count metadata | Flat list of "Texture" DataIDs | Carry mip dims + format explicitly; do not regenerate mips. |
| `CSurface` runtime fields | `handler`, `solid_index`, `indexed_texture_id`, cached `ImgTex*`/`Palette*`, `orig_*` mirror of mutable fields | Read-only `Surface`, originals only | Split into `MaterialDef` (immutable parsed) + `MaterialInstance` (mutable runtime). |
| `SurfaceHandlerEnum` | Dispatch tag selecting renderer path | Missing | Mirror as `MaterialKind { Database, CustomDB, PalShift, TexMerge }`. |
| `ObjDesc` magic byte | `0x11` checked; reject otherwise | Checked | Match. |
| `ObjDesc` dedup | `RemoveDuplicateTextureMapChange` per entry on unpack | ACE reads change arrays directly | Replicate retail behavior: later swap replaces earlier swap on the same part and old texture. |
| `ObjDesc` cap | Change counts are serialized as bytes | Same serialized shape | Enforce byte-sized counts when constructing runtime appearances; DAT unpack cannot contain larger counts. |
| Terrain merge | CPU `TexMerge::FillTempTexBuffer` → one 256×256 texture per pcode | ACE: stubbed. ACViewer: GPU multi-pass with texture arrays. | Keep GPU path; document the divergence. Add CPU fallback only if exact retail-pixel parity becomes a requirement. |
| Terrain color-variation fields | Serialized on `TerrainTex`, but no active use found in landblock lighting or `TexMerge` | Unpacked but unused | Preserve the fields; do not invent an HSB jitter formula without a proven retail call path. |
| `LandSurf.Type == 1` (`SH_PALSHIFT`) | Alternate landscape pipeline | ACE throws | Unused in retail; safe to defer. Note in renderer. |
| `ClothingTable` nested type names | `ClothingBase`, `CloPaletteTemplate`, `CloSubpalEffect` | `ClothingBaseEffect`, `CloSubPalEffect`, `CloSubPalette` | Use client names. ACE's `*Effect` suffixes are invented. |
| Two `TextureMergeInfo`s in ACE | Distinct concepts: terrain merge vs runtime object appearance | Same class name | Disambiguate (e.g. `TerrainSurfaceMerge` vs `ObjectAppearance`). |
| PalSet shade formula | `(Count - 0.000001f) * hue`, clamped | Same, with the magic epsilon | Keep as-is. |

## Recommendations for our crates

1. **`holtburger-dat`**: name DAT types after the client (`RenderSurface`,
   `RenderTexture`, `CSurface`/`Material`, `Palette`, `PaletteSet`,
   `ClothingTable` + `ClothingBase` / `CloPaletteTemplate` / `CloSubpalEffect`).
   Model `RenderTexture` as an explicit mip chain (level dims + pixel format),
   not a list of IDs.

2. **Split material def vs instance**: parsed-from-DAT `MaterialDef` is
   immutable; per-rendered-object `MaterialInstance` carries the mutable state
   (`current_translucency/luminosity/diffuse`, `indexed_texture_id`,
   `solid_index`, cached resolved image+palette refs) and a `MaterialKind` tag
   equivalent to `SurfaceHandlerEnum`.

3. **`holtburger-content`** owns the resolution rules:
   `ClothingTable + (setup, paletteTemplate, shade) → ObjDesc`, and
   `ObjDesc + Setup → flat list of (part → MaterialInstance)`. Apply
   `RemoveDuplicateTextureMapChange` and the 255 cap.

4. **Renderer (`apps/holtburger-3d`)**:
   - Sample palettes at runtime (palette uploaded as 1D texture, lookup in
     pixel shader). Do not bake indexed textures to RGBA at load.
   - Cache material instances by resolved appearance key — not by `GfxObjId`
     alone, or every player wearing the same setup ends up the same dye color.
   - Keep ACViewer's GPU terrain blend path. Preserve the terrain
     color-variation fields in prepared data, but do not render them until an
     active retail use is proven.
   - Add a detail-texture pass driven by `TerrainTex.DetailTexGID` /
     `DetailTexTiling` as a separate overlay: wrapped linear sampling, base UVs
     multiplied by detail tiling, and retail-style distance fade. Do not fold it
     into `TexMerge` or terrain texture-array blending.

5. **High-res JPEG pack support**: when present in `client_highres.dat`, the
   substitution is at the `RenderSurface` (0x06) DataID. The custom
   `PFID_CUSTOM_RAW_JPEG` format decodes via standard JPEG and swaps R/B
   channels. Make sure our DAT loader checks all archives in priority order and
   that `RenderSurface` returns the override.

## Key source references

- Retail client:
  - [`acclient.h:10938`](../../acclient-eor-source/acclient.h) `RenderSurface`
  - [`acclient.h:11702`](../../acclient-eor-source/acclient.h) `RenderTexture`
  - [`acclient.h:13427`](../../acclient-eor-source/acclient.h) `CSurface`
  - [`acclient.h:11791`](../../acclient-eor-source/acclient.h) `RenderMaterial` (DAT 0x16)
  - [`acclient.h:11721`](../../acclient-eor-source/acclient.h) `MaterialModifier` (DAT 0x17)
  - [`acclient.h:11751`](../../acclient-eor-source/acclient.h) `MaterialInstance` (DAT 0x18)
  - [`acclient.h:11835`](../../acclient-eor-source/acclient.h) `MaterialLayer`
  - [`acclient.h:11869`](../../acclient-eor-source/acclient.h) `LayerStage`
  - [`acclient.h:10055`](../../acclient-eor-source/acclient.h) `Waveform`
  - [`acclient.h:2164`](../../acclient-eor-source/acclient.h) `WaveformType` enum
  - [`acclient.h:42410-42462`](../../acclient-eor-source/acclient.h) `LM_UVTranslate` / `LM_UVRotate` / `LM_UVScale`
  - [`acclient.h:44026`](../../acclient-eor-source/acclient.h) `WaveformPropertyValue`
  - [`acclient.c:130288`](../../acclient-eor-source/acclient.c) `MaterialLayer::Serialize`
  - [`acclient.c:136190`](../../acclient-eor-source/acclient.c) `LM_UVTranslate::Serialize` (note: actually serializes `LM_UVScale` due to copy-paste — uses `uScale`/`vScale` member names)
  - [`acclient.h:15478`](../../acclient-eor-source/acclient.h) `ObjDesc` & friends
  - [`acclient.h:18671`](../../acclient-eor-source/acclient.h) `ClothingBase` and nested types
  - [`acclient.h:20877`](../../acclient-eor-source/acclient.h) `TerrainTex` / `TMTerrainDesc`
  - [`acclient.h:46975`](../../acclient-eor-source/acclient.h) `PalShift` / `TexMerge` / `LandSurf`
  - [`acclient.h:50659`](../../acclient-eor-source/acclient.h) `ClothingTable`
  - [`acclient.h:3964`](../../acclient-eor-source/acclient.h) `SurfaceHandlerEnum`
  - [`acclient.c:294140`](../../acclient-eor-source/acclient.c) `TerrainTex::UnPack`
  - [`acclient.c:294812`](../../acclient-eor-source/acclient.c) `TMTerrainDesc::UnPack`
  - [`acclient.c:294957`](../../acclient-eor-source/acclient.c) `TexMerge::FillTempTexBuffer`
  - [`acclient.c:343379`](../../acclient-eor-source/acclient.c) `CSurface::Serialize`
  - [`acclient.c:445149`](../../acclient-eor-source/acclient.c) `CloObjectEffect::UnPack`
  - [`acclient.c:445246`](../../acclient-eor-source/acclient.c) `CloTextureEffect::UnPack`
  - [`acclient.c:445438`](../../acclient-eor-source/acclient.c) `CloPaletteTemplate::UnPack`
  - [`acclient.c:445543`](../../acclient-eor-source/acclient.c) `CloSubpalEffect::UnPack`
  - [`acclient.c:445865`](../../acclient-eor-source/acclient.c) `ClothingBase::UnPack`
  - [`acclient.c:448703`](../../acclient-eor-source/acclient.c) `ObjDesc::UnPack`
  - [`acclient.c:450369`](../../acclient-eor-source/acclient.c) `TextureMapChange::UnPack`
  - [`acclient.c:450404`](../../acclient-eor-source/acclient.c) `AnimPartChange::UnPack`
  - [`acclient.c:450438`](../../acclient-eor-source/acclient.c) `Subpalette::UnPack`

- ACE:
  - [`ACE.DatLoader/FileTypes/{Surface,SurfaceTexture,Texture,RenderTexture,PaletteSet,ClothingTable}.cs`](../../ACViewer/ACE/Source/ACE.DatLoader/FileTypes/)
  - [`ACE.DatLoader/Entity/{TerrainTex,TerrainAlphaMap,TMTerrainDesc,LandSurf,TexMerge,TerrainType,TerrainDesc,ObjDesc,SubPalette,TextureMapChange,AnimationPartChange,ClothingBaseEffect,CloObjectEffect,CloTextureEffect,CloSubPalEffect,CloSubPalette,CloSubPaletteRange,Polygon}.cs`](../../ACViewer/ACE/Source/ACE.DatLoader/Entity/)
  - [`ACE.Server/Physics/Common/{TextureMergeInfo,LandSurf}.cs`](../../ACViewer/ACE/Source/ACE.Server/Physics/Common/)
  - [`ACE.Entity/Enum/{SurfaceType,SurfacePixelFormat}.cs`](../../ACViewer/ACE/Source/ACE.Entity/Enum/)

- ACViewer:
  - [`ACViewer/Render/{TextureCache,TerrainBatchDraw,GfxObjTexturePalette,TextureSet,TextureAtlasChain}.cs`](../../ACViewer/ACViewer/Render/)
  - [`ACViewer/Content/texture_clamp.fx`](../../ACViewer/ACViewer/Content/texture_clamp.fx) (`CombineOverlays` line 392, `CombineRoad` line 439)

## Resolved investigation questions

- ACE's `ObjDesc` parser does not appear to call
  `RemoveDuplicateTextureMapChange`; it reads the change arrays directly. The
  retail client does validate the `0x11` magic byte and deduplicates texture
  changes during unpack. Implement the retail behavior, not the ACE shortcut.
- The 255 cap is inherent in the serialized byte-sized counts for texture,
  animation-part, and subpalette changes. Treat larger constructed runtime
  lists as invalid or truncate before serialization; DAT unpack cannot contain a
  larger count.
- The first useful pixel-format set is
  `A8R8G8B8`, `R8G8B8`, `R5G6B5`, `A4R4G4B4`, `P8`, `INDEX16`, and `A8`.
  Add DXT1/DXT3/DXT5 and raw JPEG immediately after that initial path.
- Current HBA profiles do not all preserve material-ready data. `full` is the
  only clearly safe source profile. `logic_only` and `micro` omit the material
  stack; the checked-in `assets.hba` contains material records but also has many
  pruned entries, so the client needs capability diagnostics.
- ACViewer's `GetVisualPriority` should not drive core clothing behavior. Retail
  appearance is built through `ClothingTable::BuildObjDesc`, `ClothingBase`,
  palette templates, and subpalette effects.
- The first Three.js batching shape should be material buckets, not one
  `InstancedMesh` per `GfxObj`. Reuse instancing only when the full resolved
  material appearance key is identical.
- The six serialized `TerrainTex` color-variation fields should be treated as
  preserved-but-unused data for now. This pass found only struct, pack, and
  unpack references. The active landblock lighting and `TexMerge` paths do not
  read them, so do not keep an open implementation item for HSB jitter unless a
  new retail call path is found.
- Detail-texture rendering is an overlay pass, not part of `TexMerge`'s merged
  terrain texture. Select `DetailTexGID` / `DetailTexTiling` through
  `LandSurf`, use wrapped linear sampling, multiply base UVs by detail tiling,
  and blend/fade the detail texture over the already-rendered base terrain.
- Setup part-frame selection is resolved for static/default rendering:
  `0x65` is `Placement.Resting`, not an arbitrary placement key. Retail
  `CPhysicsObj::InitObjectEnd` calls `CPartArray::SetPlacementFrame(0x65)`;
  `CPartArray::SetPlacementFrame` first looks up the requested placement ID in
  `CSetup.placement_frames`, then falls back to placement `0`
  (`Placement.Default`) if the requested key is absent. Parent/equipment
  updates pass their runtime placement ID through the same lookup. For
  holtburger static setup rendering, use `Placement.Resting` then
  `Placement.Default`, and avoid a "lowest key" fallback.

## Remaining questions

- Full `ClothingTable::Serialize` body and all setup fallback mappings.
  `BuildObjDesc` behavior is sufficiently understood to plan the integration,
  but the parser should still be validated with fixtures before implementation.
