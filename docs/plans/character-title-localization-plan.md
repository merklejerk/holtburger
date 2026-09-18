# Character-title localization implementation plan

Status: **Complete**

## Goal and boundaries

Resolve `PropertyInt::CharacterTitleId` through retail portal and language data so creature
inspection shows the authored, localized character title with retail precedence.

In scope: the two required DAT decoders, a content-owned title catalog, bootstrap injection,
inspection resolution, presentation through the existing H3D header and TUI role row,
archive-profile retention, regeneration of the all-in-one `assets.hba`, and focused
tests/documentation.

Out of scope: a general localization service, runtime language selection, translating existing UI
copy, changing the inspection wire/frontend contract, or reproducing unrelated character-panel UI.
The first slice uses `client_local_English.dat`, but its contracts must not encode English-specific
lookup behavior.

## Ground truth and constraints

- Retail lookup: `CharacterTitleTable::GetCharacterTitleFromID` in
  `acclient-eor-source/acclient.c:474675` maps the numeric title through an enum mapper, hashes its
  symbolic name, and resolves that hash through a language string table.
- Readable equivalent: `ACE/Source/ACE.Server/WorldObjects/Player_Character.cs:377-391` identifies
  portal EnumMapper `0x22000041` and performs the same legacy-hash join.
- Binary shapes: `ACE/Source/ACE.DatLoader/FileTypes/EnumMapper.cs`,
  `FileTypes/StringTable.cs`, `Entity/StringTableData.cs`, and
  `BinaryReaderExtensions.ReadUnicodeString`.
- Character-title strings live in language StringTable `0x2300000E`; the native English source is
  available through `ace-root/dats/client_local_English.dat`.
- `dat2hba` already supports multiple inferred or explicit namespaces. `assets.hba` remains the one
  all-in-one runtime archive; do not add a second language archive or discovery path.
- `holtburger_common::legacy_hash::legacy_string_hash` is the shared hash implementation.
- The existing `CreatureIdentity::Character.role` field is the named UI consumer. Do not add a
  second title field or make frontends repeat title resolution.
- A title ID of zero or an unresolved/malformed entry does not fabricate display text. At runtime,
  a resolved character title takes precedence over `PropertyString::Template`; the template remains
  the fallback. Missing required bootstrap assets are startup errors, while an unknown individual
  title ID is an ordinary lookup miss.

## Ownership and desired flow

| Layer | Responsibility |
| --- | --- |
| `holtburger-dat` | Losslessly decode EnumMapper and StringTable binary records; classify their file types. |
| `holtburger-content` | Join the two records into an immutable `CharacterTitleCatalog`; own static reference-data lookup and validation. |
| `holtburger-world` | Carry the catalog in `WorldBootstrap` and choose the inspection role using live entity properties. |
| `holtburger-core` / 3D host | Load the catalog while constructing the existing bootstrap; no independent lookup policy. |
| H3D frontend | Render `role` below level/lineage in the identity block composited over the model preview. |
| TUI frontend | Render the same resolved `role` through its existing labeled `Role` row. |

```text
eor/portal 0x22000041               eor/language 0x2300000E
title id -> symbolic token          legacy hash -> localized strings
              |                                  ^
              +-- legacy_string_hash(token) -----+
                                 |
                                 v
                       CharacterTitleCatalog
                                 |
 entity CharacterTitleId -> resolved title -> CharacterIdentity.role
                                  fallback -> Template -> role
```

The catalog should expose a narrow lookup such as `title(title_id) -> Option<&str>`. It owns the
precomputed ID-to-display-string map so inspection never re-hashes or searches a StringTable.
Preserve decoded source structures in `holtburger-dat`; expose the purpose-built joined view from
`holtburger-content`.

## North stars

- Keep localization data inside the AIO archive and static-data policy inside `holtburger-content`.
- Decode retail structures faithfully, then project the small runtime shape once at bootstrap.
- Make the catalog required wherever a production `WorldBootstrap` is assembled; keep synthetic
  construction explicit and deterministic.
- Reuse the existing identity contract and frontend presentation. Added code should primarily be
  decoding and one content join, not plumbing or parallel state.
- Fail with record ID and namespace context when required content cannot be decoded.

## Phased implementation

### Phase 1 — Decode, retain, and pack the source records

Deliverables:

- Add `EnumMapper` and `StringTable`/`StringTableData` decoders under
  `crates/holtburger-dat/src/file_type/`, including compressed UTF-16LE string parsing with explicit
  truncation/invalid-data errors.
- Add `DatFileType` classifications for portal prefix `0x22` and language prefix `0x23`; do not
  conflate language StringTable with the existing portal `0x31` string record type.
- Add named `FILE_ID` constants for `0x22000041` and `0x2300000E` at the decoded types that own them.
- Retain those exact namespaced records in both `StripperManifest::logic_only()` and
  `StripperManifest::micro()`. Full archives already retain every record.
- Test representative synthetic records, malformed/truncated UTF-16, namespace-aware file-type
  classification, and both manifests.
- Regenerate `dats/assets.hba` from portal, cell, and English language DAT inputs before making the
  catalog a required bootstrap dependency:

  ```bash
  cargo run -p holtburger-tools --bin dat2hba -- \
    --profile full \
    eor/portal=ace-root/dats/client_portal.dat \
    eor/cell=ace-root/dats/client_cell_1.dat \
    eor/language=ace-root/dats/client_local_English.dat \
    dats/assets.hba
  ```

- Update `docs/hba_format.md` so its canonical AIO command includes the language DAT and describes
  the two records retained by smaller profiles.

Acceptance: both records decode into typed, lossless structures; malformed input fails visibly;
full, pruned, and micro archive policies can all carry the title dependencies without retaining the
whole language DAT in smaller profiles. The regenerated full archive exposes `eor/portal`,
`eor/cell`, and `eor/language`.

### Phase 2 — Build the content catalog and inject it once

Deliverables:

- Add a focused `CharacterTitleCatalog` module in `holtburger-content` that reads both typed assets,
  hashes each enum token once, and joins it to the first localized string in the matching table row.
- Define deterministic duplicate and empty-string behavior from source evidence; duplicate IDs or
  hashes that make lookup ambiguous should fail catalog construction rather than silently overwrite.
- Add the catalog to `WorldBootstrap` and update both production assembly paths:
  `ClientRuntimeBuilder::load_assets` and `SharedHostContent::client_world_bootstrap`.
- Update synthetic bootstrap helpers and direct constructor call sites in the same cutover; do not
  add an optional production fallback solely to accommodate tests.
- Unit-test successful joins, zero/unknown IDs, missing string rows, and malformed/ambiguous source
  data without depending on unchecked-in runtime assets.

Acceptance: every production bootstrap has one immutable title catalog, both core and H3D host load
it through the same content API, and consumers do not know DAT IDs or hashing details.

### Phase 3 — Resolve and surface inspection identity

Deliverables:

- Change world inspection construction to consume the bootstrap-owned catalog and compute role
  exactly once: resolved `CharacterTitleId`, then `Template`, then none.
- Update the `CreatureIdentity::Character.role` documentation to describe the resolved presentation
  role rather than a template-only value. Keep its serialized shape stable.
- Update all `ObjectInspection` construction call sites cleanly; prefer an inspection context/input
  carrying shared dependencies over adding unrelated lookup parameters one by one.
- Preserve the existing character-vs-creature discriminator: the presence of `CharacterTitleId` may
  select character presentation even when its value cannot be resolved.
- Verify the existing frontend consumers explicitly: H3D places the resolved role beneath the
  `Level · lineage` line in the top-left model-preview identity block, while the TUI emits it as the
  `Role` row. Do not add a duplicate title elsewhere in the inspector.

Acceptance: a fixture with a known title ID displays the exact localized title in both existing
inspector presentations; H3D shows it in the top-left preview identity block and TUI shows its
`Role` row. Title overrides a different template; unresolved title falls back to template; ordinary
creatures remain unchanged, and the AIO archive can build the full client bootstrap.

### Phase 4 — Verification and cleanup

- Run focused `holtburger-dat`, `holtburger-content`, `holtburger-world`, and core/host tests.
- Run formatting plus workspace checks/clippy with warnings treated as errors using repository
  package scripts where available.
- Search for duplicate title hashing, raw title DAT IDs outside the DAT/content modules, stale AIO
  generation commands, and frontend-side title inference; remove any parallel path.
- Leave visual acceptance to the user after reporting one known titled character and the expected
  title.

## Dry-run findings and risks

- **Archive ordering:** implementing required bootstrap loading before regenerating `assets.hba`
  makes the current archive fail startup. Phase 1 deliberately regenerates the archive before Phase
  2 makes the catalog a required dependency.
- **Profile omission:** current pruned/micro manifests do not retain prefix `0x22`/`0x23` records.
  Exact namespaced file rules avoid pulling all localization data into small profiles.
- **Encoding:** StringTable text is compressed-length UTF-16LE, whereas EnumMapper tokens are
  one-byte-length PStrings. Reusing the wrong string reader can appear to work on ASCII fixtures;
  include non-ASCII and truncated fixtures.
- **Hash input:** hash the EnumMapper token bytes according to retail/ACE behavior, not the localized
  UTF-16 display text.
- **Inspection dependency churn:** `ObjectInspection::from_entity` has numerous test callers. Make
  the dependency explicit in a cohesive inspection context and update callers in one cutover rather
  than retaining a context-free path with hidden fallback semantics.

## Implementation result

- Added generic EnumMapper and StringTable decoders and a content-owned
  `CharacterTitleCatalog`. The catalog is required by both production bootstrap paths and is passed
  to inspection through an explicit context.
- Preserved retail's separate decisions for presentation shape and role text: the presence of
  `CharacterTitleId` can select character presentation even when lookup fails, while displayed role
  precedence remains localized title, then `Template`, then none.
- Made `dat2hba` classification namespace-aware. The profile dry run exposed that a language record
  with an otherwise unknown prefix was previously mistaken for an indoor cell by the legacy
  ID-only heuristic, causing pruned archives to retain unrelated localization records.
- Regenerated the ignored AIO `dats/assets.hba`. Its current HBA v2 index contains 885,160 records
  across `eor/portal` (79,694), `eor/cell` (805,348), and `eor/language` (118). The title mapper and
  title StringTable are present with their typed `EnumMapper` and `StringTable` metadata.
- Dry-run archives verified exact retention: the pruned profile kept one language record, and the
  micro profile kept one language record; both retained the portal title mapper and language title
  table.
- Automated verification passed for the affected DAT, content, world, tools, core, CLI, debug
  harness, and 3D-host Rust targets. H3D Svelte/TypeScript checks, ESLint, dead-code analysis, and
  all 2,525 frontend tests also passed.

## Definition of done

- [x] The two retail records decode and are retained in all supported archive profiles.
- [x] `assets.hba` is still one AIO bundle and includes `eor/language`.
- [x] One content-owned catalog performs the cross-namespace/hash join.
- [x] Production bootstraps require and share that catalog.
- [x] Inspection uses localized title-before-template precedence with no frontend derivation.
- [x] H3D and TUI surface the resolved role in their existing inspector locations without duplicate
      presentation or a wire-contract fork.
- [x] Focused tests, formatting, checks, and clippy pass.
- [x] HBA generation documentation matches the shipped archive shape.
- [x] User visually confirms at least one titled character; no broader visual gate is delegated to
      tests.

## Open questions

None blocking. Broader localization and runtime language selection should be planned separately when
there is a concrete consumer.
