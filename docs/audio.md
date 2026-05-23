# Audio: Waveforms and Sound Tables

This doc covers Asheron's Call sound assets and runtime playback, cross-
referenced against the retail client. Companion to
[`holtburger-3d-materials-texturing-strategy.md`](plans/holtburger-3d-materials-texturing-strategy.md).

Two DAT file types carry the audio system:

| DAT type | Client name | ACE class | Purpose |
|---|---|---|---|
| `0x0A` | `WaveFile` ([`acclient.h:42349`](../acclient-eor-source/acclient.h)) | `Wave` | Raw audio sample (PCM, MP3, or ACM-compressed WAV). |
| `0x20` | `CSoundTable` ([`acclient.h:12622`](../acclient-eor-source/acclient.h)) | `SoundTable` | Event → wave selector. Maps a `Sound` enum value to one or more Wave DataIDs with priority/probability/volume. |

Runtime playback uses **DirectSound** via `SoundManager` and `CDirSound`
([`acclient.h:17788`](../acclient-eor-source/acclient.h)) — including
`IDirectSound3DBuffer` for positional sound. Every loaded wave is wrapped in a
`SoundBuf` ([`acclient.h:17775`](../acclient-eor-source/acclient.h)) that owns
its DSound buffer.

## Wave (DAT `0x0A`)

### Packed format

ACE's `Wave::Unpack` ([`Wave.cs:17`](../ACViewer/ACE/Source/ACE.DatLoader/FileTypes/Wave.cs))
is essentially right:

```
object_id    : u32
header_size  : u32
data_size    : u32
header       : u8[header_size]
data         : u8[data_size]
```

`header` is a **bare `WAVEFORMATEX` chunk** — no `RIFF`/`WAVE` envelope, no `fmt `
or `data` chunk markers. Layout starts at `wFormatTag`:

```c
WORD  wFormatTag;       // 1 = PCM, 85 = MPEGLAYER3, 2 = ADPCM, etc.
WORD  nChannels;
DWORD nSamplesPerSec;
DWORD nAvgBytesPerSec;
WORD  nBlockAlign;
WORD  wBitsPerSample;
WORD  cbSize;           // length of optional codec-specific tail
BYTE  extra[cbSize];    // codec-specific
```

Most retail waves are PCM mono 11025 Hz / 16-bit. Notable exceptions:

- `0x0A000393` has a 30-byte header instead of the usual 18 (extra codec
  configuration tail).
- Some waves are MPEG Layer 3 (`wFormatTag == 85`, ACE detects by
  `header[0] == 0x55`).

`data` is the raw sample stream in the format described by `header` —
exactly what would go inside the `data` chunk of a real `.wav` file.

### How the client consumes it

The client does not re-parse the dat header itself. Instead, `SoundBuf::Create`
([`acclient.c:368954`](../acclient-eor-source/acclient.c)) pulls the
`DBObj` for the wave via `DBObj::Get(QualifiedDataID(id, DB_TYPE_WAVE))`,
and the cached `DBObj` already exposes a fully populated `WaveFile`
([`acclient.h:42349`](../acclient-eor-source/acclient.h)) — meaning the DAT
loader populates `m_pwfmt` / `m_pData` / `m_nDataSize` directly from the
packed blob.

`WaveFile` is the in-memory representation:

```c
tWAVEFORMATEX *m_pwfmt;       // parsed header
u8            *m_pData;       // raw sample data
HMMIO         *m_hmmio;       // only used for filesystem .wav fallback
_MMCKINFO      m_mmckiRiff, m_mmckiFmt, m_mmckiData;  // RIFF chunk metadata, fallback path only
u32 m_nDuration, m_nBlockAlign, m_nAvgDataRate, m_nDataSize, m_nFormatSize, m_nBytesPlayed;
```

`SoundBuf::Create` then:

1. Picks DSound buffer flags based on `m_3D` (3D positional vs. stereo)
   and `use_static` (static buffer for short SFX).
2. If `m_pwfmt->wFormatTag == 1` (PCM), uses the wave data directly.
3. Otherwise (compressed), opens an `acmStreamOpen` decoder targeting
   PCM mono 11025 Hz / 16-bit, allocates an intermediate stream, decodes
   into a target buffer, then hands that to DSound. (See decode path at
   [`acclient.c:369030`](../acclient-eor-source/acclient.c).)
4. Calls `IDirectSound::CreateSoundBuffer` and locks/copies the sample data
   into the DSound buffer.

Important: **all compressed waves are normalized to PCM mono 11025 Hz / 16-bit
at load time**. The client does not stream audio decode at playback.

### Re-emitting as a real `.wav`

If we ever want to export (or to load into a non-Windows audio backend), we
just need to synthesize a RIFF envelope around the packed `header` + `data`:

```
"RIFF" <u32 filesize-8> "WAVE"
"fmt " <u32 header_size> <header_bytes>
"data" <u32 data_size>   <data_bytes>
```

ACE's `ReadData` does this but truncates the header to 16 bytes (i.e., drops
`cbSize` + the codec tail). That works for plain PCM. For ADPCM / MP3 / etc.
we **must** keep the full `header_size` bytes verbatim in the `fmt ` chunk or
decoders won't find the codec parameters.

> **Bug to avoid copying from ACE**: don't truncate `header` to 16 bytes on
> export — ADPCM/MP3 entries need the full `cbSize` tail.

## SoundTable (DAT `0x20`)

`CSoundTable` is a single recursive `SoundTableData` tree. It maps `Sound`
enum events (e.g. `Sound_OpenInventoryUI`, `Sound_HitFlesh1`,
`Sound_StepHard1`) to one or more wave choices.

### Packed format

`SoundTableData::UnPack` ([`acclient.c:368538`](../acclient-eor-source/acclient.c)):

```
hash_key       : u32                       // event id (Sound enum) for this node; 0 for the root
num_records    : u32
records        : SoundRecord[num_records]  // 16 bytes each
num_children   : u32
children       : SoundTableData[num_children]  // recursive
```

Where `SoundRecord` (client `SoundData` at [`acclient.h:12953`](../acclient-eor-source/acclient.h))
is the actual playback entry:

```
sound_id     : u32   // DataID of a Wave (0x0A...)
priority     : f32
probability  : f32
volume       : f32
```

`CSoundTable::UnPack` ([`acclient.c:367971`](../acclient-eor-source/acclient.c))
just calls the base class `m_bLoaded.UnPack` (which reads the file's own
`object_id`), delegates to the root `SoundTableData::UnPack`, and aligns to
4 bytes by zero-filling.

### Runtime semantics

- On unpack, each non-zero `sound_id` triggers `SoundManager::CreateSound(id)`,
  which reference-counts a `SoundBufRef` in `SoundManager::sound_hash_`. Loading
  a SoundTable thus eagerly creates DSound buffers for all referenced waves.
- When an event fires, `SoundManager::PlaySoundA(event_id, …)` looks up the
  hash bucket, picks one of the multiple records by `probability` (records
  in the same event sum probabilities), and plays it at the supplied
  position with the record's `volume` scaled by the system effect volume.
- `priority` is used to evict lower-priority sounds when the DSound voice
  pool is full.

### Naming mismatches in ACE

ACE swapped the type names. The container vs. the record are reversed:

| ACE | Client | Meaning |
|---|---|---|
| `SoundTableData` ([`Entity/SoundTableData.cs`](../ACViewer/ACE/Source/ACE.DatLoader/Entity/SoundTableData.cs)) | `SoundData` ([`acclient.h:12953`](../acclient-eor-source/acclient.h)) | 16-byte playback record: `SoundId`/`Priority`/`Probability`/`Volume`. |
| `SoundData` ([`Entity/SoundData.cs`](../ACViewer/ACE/Source/ACE.DatLoader/Entity/SoundData.cs)) | `SoundTableData` ([`acclient.h:12612`](../acclient-eor-source/acclient.h)) | Recursive container (list of playback records + child sub-tables). |

ACE also flattens the root: `SoundTable.{Id, Unknown, SoundHash, Data}` maps to
the root `SoundTableData`'s `{hash_key (always 0 at root), num_records,
records, num_children, children}`. The `Unknown` field is the root node's
`hash_key` — it's always `0` because the root is unkeyed, hence ACE's comment
that "it's the same in every file." (Spoiler: it isn't unknown, it's just
zero.)

For our `holtburger-dat` we should name these after the client:

- `SoundRecord` (the 16-byte playback entry) — clearer than either name.
- `SoundTable` for the DAT file (the root node).
- `SoundTableNode` for child sub-tables, or just keep them nested in the
  recursive structure.

### Sound enum coverage

ACE's [`ACE.Entity/Enum/Sound.cs`](../ACViewer/ACE/Source/ACE.Entity/Enum/Sound.cs)
enumerates the client's `Sound` enum (event ids used as `hash_key`). It's
broadly complete; we should reuse it as-is rather than re-derive from
`acclient.h`.

## How sounds get attached to gameplay

There are three main attachment paths in the client:

1. **`Setup` / `SetupModel`**: a model's `DefaultSoundTable` field
   ([`SetupModel.cs:41`](../ACViewer/ACE/Source/ACE.DatLoader/FileTypes/SetupModel.cs))
   points at the `SoundTable` to use for hit/step/idle effects on objects
   built from that setup.
2. **`RegionDesc.SoundInfo`** ([`RegionDesc.cs:25`](../ACViewer/ACE/Source/ACE.DatLoader/FileTypes/RegionDesc.cs))
   carries terrain-driven ambient sound info (per-region ambience and
   intermittent triggers — see `AmbientSound` / `IntermitSound` in
   `acclient.h`).
3. **UI and HUD**: a single global `UISoundTable` is used for click/open/
   close effects (see `SoundManager::PlaySoundFromCenter(Sound_UI_*, UISoundTable)`).

For richer cases (spells, animations) the server can also push raw
`PlayScript` / `PlaySound` messages that reference Sound enum events directly.

## Recommendations for `holtburger`

1. **Name DAT types after the client**: `WaveFile` (0x0A), `SoundTable` (0x20)
   with `SoundRecord` for the 16-byte playback entry. Do not adopt ACE's
   swapped `SoundData` / `SoundTableData` names.

2. **Preserve full `WAVEFORMATEX` headers** — keep `header_size` bytes verbatim,
   don't truncate to 16. Required for ADPCM/MP3 compatibility.

3. **Detect codec from `wFormatTag`** (the first `u16` of `header`), not from
   `header[0]`. ACE's `header[0] == 0x55` test works only because the low byte
   of `wFormatTag == 85` lands at offset 0 on little-endian — it's brittle if
   we ever see `wFormatTag` values ≥ 256.

4. **For decoding non-PCM**: the client uses Win32 ACM (`acmStreamOpen`). On
   our (cross-platform) client we should use a portable decoder:
   - PCM (`wFormatTag == 1`): use directly.
   - MP3 (`85`): `symphonia`, `minimp3`, or whichever crate the audio backend
     prefers.
   - IMA-ADPCM (`17`) / MS-ADPCM (`2`): there are pure-Rust decoders; or
     decode once at load to PCM.
   - Match the client's behavior of normalizing to PCM 11025 Hz / 16-bit mono
     at load. Streaming decode is unnecessary — most clips are under a few
     seconds.

5. **Eager wave creation**: when a `SoundTable` loads, the client calls
   `CreateSound` for every referenced wave id. We can defer this if memory
   is a concern (e.g. lazy-load on first play), but document the divergence.
   The retail behavior is "all waves for a setup's sound table are resident
   for the lifetime of any object using that setup."

6. **3D audio**: most placed sounds go through `IDirectSound3DBuffer`. Our
   audio backend (e.g. `rodio` / `kira` / `oddio`) should support attenuation,
   position, and listener orientation. The 3D flag lives on `SoundBuf.m_3D`
   and is set per-wave at buffer creation time, not per-event.

## Source references

- Retail client:
  - [`acclient.h:12612`](../acclient-eor-source/acclient.h) `SoundTableData` (container, ACE's `SoundData`)
  - [`acclient.h:12622`](../acclient-eor-source/acclient.h) `CSoundTable`
  - [`acclient.h:12953`](../acclient-eor-source/acclient.h) `SoundData` (record, ACE's `SoundTableData`)
  - [`acclient.h:17765`](../acclient-eor-source/acclient.h) `SoundBufRef`
  - [`acclient.h:17775`](../acclient-eor-source/acclient.h) `SoundBuf`
  - [`acclient.h:17788`](../acclient-eor-source/acclient.h) `CDirSound`
  - [`acclient.h:42349`](../acclient-eor-source/acclient.h) `WaveFile`
  - [`acclient.c:366992`](../acclient-eor-source/acclient.c) `SoundManager::CreateSound`
  - [`acclient.c:367971`](../acclient-eor-source/acclient.c) `CSoundTable::UnPack`
  - [`acclient.c:368538`](../acclient-eor-source/acclient.c) `SoundTableData::UnPack`
  - [`acclient.c:368954`](../acclient-eor-source/acclient.c) `SoundBuf::Create`
  - [`acclient.c:369876`](../acclient-eor-source/acclient.c) `WaveFile::Load`
- ACE:
  - [`ACE.DatLoader/FileTypes/Wave.cs`](../ACViewer/ACE/Source/ACE.DatLoader/FileTypes/Wave.cs)
  - [`ACE.DatLoader/FileTypes/SoundTable.cs`](../ACViewer/ACE/Source/ACE.DatLoader/FileTypes/SoundTable.cs)
  - [`ACE.DatLoader/Entity/SoundData.cs`](../ACViewer/ACE/Source/ACE.DatLoader/Entity/SoundData.cs)
  - [`ACE.DatLoader/Entity/SoundTableData.cs`](../ACViewer/ACE/Source/ACE.DatLoader/Entity/SoundTableData.cs)
  - [`ACE.Entity/Enum/Sound.cs`](../ACViewer/ACE/Source/ACE.Entity/Enum/Sound.cs)

## Open questions

- Exact behavior when multiple `SoundRecord`s within one event have
  `probability` not summing to 1.0 — does the client renormalize, or treat
  the remaining mass as "play nothing"?
- Eviction policy by `priority` when the DSound voice pool is exhausted —
  not yet read.
- Where streaming music (login, town themes) lives — appears to be outside
  the DAT in the retail install (`.mp3` files shipped alongside the
  client). Confirm and document.
- `RegionDesc` ambient sound driver (`AmbientSound` / `IntermitSound`) —
  worth its own doc once we tackle environmental audio.
