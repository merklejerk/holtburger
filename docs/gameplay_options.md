# GameplayOptions (CharacterOptionDataFlag::GameplayOptions)

This document captures what we can prove (and what we cannot yet prove) about the `GameplayOptions` byte blob that appears under `CharacterOptionDataFlag::GameplayOptions`.

## Where it appears

### PlayerDescription (server → client)

In ACE, `GameplayOptions` is written as raw bytes with no length prefix:

- `GameEventPlayerDescription`: `Writer.Write(Session.Player.Character.GameplayOptions);`
- Immediately followed by inventory/equipped lists.

This means that on the wire **there is no explicit delimiter** between `GameplayOptions` and the subsequent inventory fields.

### SetCharacterOptions (client → server)

ACE treats `GameplayOptions` as an opaque blob and stores it without parsing.

In `GameActionSetCharacterOptions`, ACE reads `GameplayOptions` as **“the rest of the message”** (because it is the final field in that action):

- `int size = (int)(Length - Position);`
- `ReadBytes(size)`

So server-side code does not provide an authoritative internal structure; it only confirms that the blob is intended to be opaque at this layer.

## Observed internal structure (fixture: 2026-02-07)

From fixture `crates/holtburger-core/tests/fixtures/gameplay_options_tui_2026_02_07.bin`:

- Total length: **876 bytes**
- 4-byte aligned: **yes**
- Interpretable as **219 little-endian `u32` words**
- `word[0] == 2` (interpretable as a **version**)
- Remaining **218 words** are divisible by 2 → **109 pairs** of `(u32, u32)`

This strongly supports a minimal framing of:

```
struct GameplayOptionsV2 {
    version: u32, // observed == 2
    pairs: Vec<(u32, u32)>, // observed length == 109
}
```

### What we can and can’t claim

We can claim:

- The blob is *not random*: it is aligned, word-addressable, and has stable framing properties.
- The payload *can* be losslessly represented as `version + pairs` for this fixture.

We cannot yet claim:

- The semantic meaning of each `u32`.
- Whether the number of pairs is fixed across characters / clients.
- Whether `version == 2` is always used.

## Notes from heuristic analysis

The pair stream contains multiple “shapes”:

- Many pairs look like **token → token** (both sides are > `0xFFFF`).
- Many pairs look like **token → scalar** (value ≤ `0xFFFF`).
- There are also some **scalar → token** pairs.

The data also contains values that appear to be related by **byte shifting/packing**, e.g.:

- `0x00860400` (bytes `00 86 04 00`)
- `0x00008604` (bytes `00 00 86 04`)
- `0x86040010` (bytes `86 04 00 10`)

This suggests the `u32` fields may encode multiple subfields (byte/word-sized), rather than being plain integers.

## Why parsing `GameplayOptions` is hard in PlayerDescription

Because the server→client `PlayerDescription` message does not send a `GameplayOptions` length, a decoder must do one of:

1. Already know the `GameplayOptions` length for the specific on-wire version.
2. Parse the internal format well enough to know where it ends.
3. Infer the boundary using the following known-structure fields (inventory/equipped) and validate candidates.

Option (3) is what the current Rust implementation uses as a bridge. Turning this into option (2) requires either:

- Finding a ground-truth client implementation, or
- Collecting multiple blobs with known UI changes and diffing them to map semantics.

## Next data needed

To go from “structure” to “semantics,” we need at least one additional `GameplayOptions` sample captured from a character with deliberately changed UI settings (e.g., move/resize a window, change opacity, toggle a UI element), then diff:

- Which pairs changed?
- Which tokens/fields correlate with that UI change?

A dedicated diff tool exists in `crates/holtburger-core/src/bin/diff_gameplay_options.rs`.
