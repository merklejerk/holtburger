# Spell Name Resolution Plan (Char Tab Enchantments)

## Goal

Replace `Spell #<id>` labels in the Character tab enchantment list with spell names from portal DAT/HBA data, while preserving a safe fallback to numeric IDs.

## Scope

In scope:
- Character tab enchantment labels.
- Spell-name lookup by enchantment `spell_id`.
- Loading spell name data from portal table data.
- Tests for parser correctness and UI-facing lookup behavior.

Out of scope:
- Full spellbook UI work.
- Formula/component rendering.
- Reworking enchantment stacking logic.

## Ground Truth / References

- ACE spell table file id: `0x0E00000E`.
- ACE parser references:
  - `ACE/Source/ACE.DatLoader/FileTypes/SpellTable.cs`
  - `ACE/Source/ACE.DatLoader/Entity/SpellBase.cs`
  - `ACE/Source/ACE.DatLoader/BinaryReaderExtensions.cs` (obfuscated string decode)
  - `ACE/Source/ACE.DatLoader/UnpackableExtensions.cs` (packed hash layout)
- Existing Rust patterns:
  - `crates/holtburger-dat/src/file_type/skill_table.rs`
  - `crates/holtburger-dat/src/file_type/xp_table.rs`
  - `crates/holtburger-core/src/world/state.rs`
  - `apps/holtburger-cli/src/ui/update/world.rs`
  - `apps/holtburger-cli/src/ui/widgets/stats.rs`

## Implementation Plan (Phased)

### Phase 1: Add SpellTable parser in `holtburger-dat`

Deliverables:
- New file type module for spell table parsing (minimum viable fields):
  - table `id`
  - `spells: HashMap<u32, SpellBase>`
  - `spell_sets` map parsed/preserved (can remain unused initially)
- `SpellBase` parsing sufficient for name lookup:
  - `name` (obfuscated string decode)
  - `desc` (obfuscated string decode)
  - `meta_spell_type` + conditional fields for structural alignment parity
  - remaining fixed tail fields needed to safely advance stream
- Module export wiring in `file_type/mod.rs` and `lib.rs`.

Acceptance criteria:
- Spell table can be parsed from a valid portal provider without panics.
- Parsed names are non-empty for known spell IDs.
- No regressions in existing `holtburger-dat` tests.

### Phase 2: Load spell table in `holtburger-core`

Deliverables:
- Extend world state with optional spell table payload (or prebuilt map).
- Load table in `WorldState::new` similarly to XP/Skill table loading.
- Keep memory shape pragmatic:
  - preferred: `Arc<HashMap<u16, Arc<str>>>` or equivalent compact lookup
  - acceptable v1: `Arc<SpellTable>` then derive names at call site

Acceptance criteria:
- Client startup still succeeds with `.dat` or `.hba` providers.
- If spell table load fails, client continues with fallback behavior.

### Phase 3: Surface lookup to CLI state

Deliverables:
- Add spell-name lookup payload to `WorldEvent::PlayerInfo`.
- Thread payload through CLI `handle_received_event` into `AppState`.
- Add helper on `AppState` for safe resolution:
  - input: `spell_id: u16`
  - output: spell name or fallback `Spell #<id>`.

Acceptance criteria:
- Char tab can resolve names without direct DAT access in UI layer.
- Existing event handling remains backward-compatible in behavior.

### Phase 4: Replace Char tab label rendering

Deliverables:
- Update enchantment line rendering in stats widget to use lookup helper.
- Keep fallback for missing IDs or missing table.

Acceptance criteria:
- Former `Spell #...` labels show canonical names when available.
- Unknown/missing IDs continue to render as numeric fallback.

### Phase 5: Testing and validation

Deliverables:
- Unit tests in `holtburger-dat` for:
  - obfuscated string decode parity
  - packed hash table spell entry parsing
  - at least one fixture-backed parse path for spell names
- Unit tests in `holtburger-core`/CLI for:
  - lookup fallback logic
  - payload wiring from world event into app state
- Sanity checks:
  - `cargo check -p holtburger-dat`
  - `cargo check -p holtburger-core`
  - `cargo check -p holtburger-cli`

Acceptance criteria:
- New tests pass locally.
- No new warnings/errors in touched crates.

## Risks and Mitigations

1. Parser drift from ACE layout
- Mitigation: mirror ACE field order exactly and keep conditional branches for `MetaSpellType`.

2. Obfuscated string mismatch
- Mitigation: add explicit roundtrip/decode test based on nibble-swap behavior.

3. Event payload bloat
- Mitigation: pass compact name map (u16 -> Arc<str>) rather than full spell structs.

4. Runtime absence of table data
- Mitigation: keep numeric fallback path (`Spell #id`) as permanent guardrail.

## Definition of Done

- Char tab enchantments show spell names for known IDs.
- Unknown IDs gracefully fall back to numeric labels.
- All touched crates compile and relevant tests pass.
- TODO item for spell-id labels can be marked complete.

---

## Worksheet (Execution Tracker)

Use this section during implementation.

### A) Task Checklist

- [ ] Create `SpellTable` parser module in `holtburger-dat`.
- [ ] Implement obfuscated string decode helper for spell fields.
- [ ] Export new file type in module index.
- [ ] Add parser tests (unit + fixture where practical).
- [ ] Load spell table in `WorldState::new`.
- [ ] Add spell-name lookup payload to `WorldEvent::PlayerInfo`.
- [ ] Store lookup in CLI `AppState`.
- [ ] Replace Char tab `Spell #id` rendering with lookup helper.
- [ ] Add fallback behavior test.
- [ ] Run cargo checks for dat/core/cli crates.

### B) Decisions Log

| Date | Decision | Why | Owner |
| --- | --- | --- | --- |
| YYYY-MM-DD |  |  |  |
| YYYY-MM-DD |  |  |  |

### C) Verification Log

| Check | Result | Notes |
| --- | --- | --- |
| `cargo check -p holtburger-dat` |  |  |
| `cargo check -p holtburger-core` |  |  |
| `cargo check -p holtburger-cli` |  |  |
| Parser unit tests |  |  |
| UI fallback test |  |  |

### D) Open Questions

- [ ] Do we want localized names later, or is default portal name authoritative for now?
- [ ] Should spell names also replace ID labels in debug/system chat messages?
- [ ] Do we want to expose spell descriptions in context panes in a follow-up?
