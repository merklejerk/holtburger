# Hygiene Assessment 2026-02-14 Worksheet (Issue #18)

Source issue: https://github.com/merklejerk/holtburger/issues/18

This worksheet is intentionally self-contained so implementation can proceed without reopening the issue.

## 1) Problem Context (Full Summary)

Issue #18 reports that protocol coverage is broad but maintainability and parity confidence are weakened by four specific concerns:

1. A known parity exception remains for a major payload (`PLAYER_DESCRIPTION`), where strict repack parity is intentionally bypassed.
2. Parity test style is inconsistent across domains (some tests use bespoke loops, others use shared parity helpers), reducing auditability.
3. Several protocol files have grown into very large modules (“god files”), increasing regression risk and slowing safe change.
4. Ground-truth fixture provenance and regeneration workflow are under-specified and path guidance is inconsistent between docs and implementation.

Issue #18 also includes a phased remediation direction (close parity gap, normalize tests, decompose modules, harden provenance).

---

## 2) Detailed Concerns and Evidence

### Concern A — Open parity gap for `PLAYER_DESCRIPTION`

- Reported location: `crates/holtburger-protocol/src/messages/game_message.rs` around the dispatch test currently using `assert_dispatch_match_no_parity`.
- Why this matters: this allows a high-impact payload to pass without byte-for-byte round-trip guarantees.
- Desired state: strict fixture-driven parity (`assert_pack_unpack_parity`) for the full path, including currently lossy nested structures.
- Ground truth: fixture generation should align with ACE synthetic protocol output flow.

#### Validation (2026-02-14, current branch)

- **Confirmed**: The no-parity helper and usage are still present.
  - `assert_dispatch_match_no_parity` exists in `crates/holtburger-protocol/src/messages/game_message.rs`.
  - `test_dispatch_game_event_player_description` still uses `assert_dispatch_match_no_parity(test_fixtures::PLAYER_DESCRIPTION, ...)` with an inline "KNOWN PARITY GAP" comment.
- **Observed blast radius**: dispatch tests in this module mostly use strict parity helper (`assert_dispatch_match`), making `PLAYER_DESCRIPTION` a clear outlier rather than a general policy.
- **Implementation implication**: parity closure work can be scoped to `PLAYER_DESCRIPTION` serialization paths plus one dispatch test conversion.

### Concern B — Inconsistent parity testing idioms

- Reported locations:
  - `crates/holtburger-protocol/src/messages/character/types.rs`
  - `crates/holtburger-protocol/src/messages/network/events.rs`
  - `crates/holtburger-protocol/src/messages/inventory/types.rs`
- Why this matters: bespoke assert styles make parity intent less obvious and increase reviewer effort.
- Desired state: standardize fixture-based parity checks on shared helper usage, while keeping semantic asserts where needed.
- Existing helper reference: `crates/holtburger-protocol/src/test_helpers.rs` (`assert_pack_unpack_parity`).

#### Validation (2026-02-14, current branch)

- **Confirmed**: The three referenced modules still use bespoke unpack/match/repack test loops rather than shared helper calls:
  - `crates/holtburger-protocol/src/messages/character/types.rs`
  - `crates/holtburger-protocol/src/messages/network/events.rs`
  - `crates/holtburger-protocol/src/messages/inventory/types.rs`
- **Confirmed**: Shared helper exists and is widely used elsewhere (`crates/holtburger-protocol/src/test_helpers.rs`, `assert_pack_unpack_parity`).
- **Observation**: Inconsistent style is now mostly a local cleanup problem in specific modules, not a project-wide absence of helper-based parity testing.
- **Implementation implication**: migration can be incremental and low risk by replacing repeated parity boilerplate while preserving existing semantic assertions.

### Concern C — Very large protocol modules

- Reported locations:
  - `crates/holtburger-protocol/src/messages/object/messages.rs`
  - `crates/holtburger-protocol/src/messages/movement/messages.rs`
  - `crates/holtburger-protocol/src/messages/game_message.rs`
- Why this matters: large files reduce local reasoning, slow refactors, and increase merge/regression complexity.
- Desired state: split by focused submodules/message families while preserving current public API and behavior.

#### Validation (2026-02-14, current branch)

- **Confirmed**: File sizes match the issue claim for two modules and are near-identical for one:
  - `crates/holtburger-protocol/src/messages/object/messages.rs`: **1298** lines
  - `crates/holtburger-protocol/src/messages/movement/messages.rs`: **901** lines
  - `crates/holtburger-protocol/src/messages/game_message.rs`: **896** lines (issue reported 896)
- **Observation**: `game_message.rs` currently reports 897 total lines in editor metadata, with tests in same file; practical maintainability concern remains unchanged.
- **Implementation implication**: prioritize behavior-preserving extraction boundaries (domain family first, then optional pack/unpack/test separation).

### Concern D — Fixture provenance ambiguity

- Reported locations:
  - `crates/holtburger-core/client-world-boundary-worksheet.md`
  - `crates/holtburger-protocol/ARCHITECTURE.md`
  - `crates/holtburger-protocol/src/test_fixtures.rs`
- Why this matters: contributors can’t reliably reproduce fixtures end-to-end without interpretation.
- Observed mismatch: docs mention one fixture path convention while protocol fixtures currently live under `crates/holtburger-protocol/tests/fixtures/`.
- Desired state: one canonical provenance SOP with source commit/hash, generator path, output destination policy, and update flow.

#### Validation (2026-02-14, current branch)

- **Confirmed**: `crates/holtburger-protocol/src/test_fixtures.rs` resolves fixture constants from `../tests/fixtures/...`, i.e. protocol-owned fixture directory.
- **Confirmed**: `crates/holtburger-protocol/tests/fixtures/` exists and contains the active fixture corpus.
- **Confirmed mismatch**: multiple docs/instructions still reference `crates/holtburger-core/tests/fixtures/` even though that directory is absent in this checkout.
  - References found in `.github/copilot-instructions.md`, `crates/holtburger-core/client-world-boundary-worksheet.md`, and `docs/gameplay_options.md`.
- **Nuance vs issue text**: ACE/ACViewer trees are present in this workspace, so the strongest current reproducibility gap is path/convention drift rather than missing reference repositories.
- **Reference Shelf Life**: Several persistent files (like `.github/copilot-instructions.md`) currently reference the `/docs` folder. Since `/docs` is deleted upon merge to the main branch, these references will become broken links.
- **Implementation implication**: provenance hardening should include a docs sweep to remove stale `holtburger-core/tests/fixtures` guidance and point all generation/consumption to one canonical destination policy. It must also remove or relocate any persistent references to the ephemeral `/docs` folder.

---

## 2.1) Validation Summary (Current Branch)

- Concern A: **Confirmed** (active no-parity exception remains for `PLAYER_DESCRIPTION`).
- Concern B: **Confirmed** (outlier modules still use bespoke parity loops; helper already exists).
- Concern C: **Confirmed** (module sizes remain in god-file territory).
- Concern D: **Confirmed with nuance** (path/provenance guidance is inconsistent; ACE/ACViewer availability itself is not currently the blocker in this workspace).

These findings mean Issue #18 remains actionable without major re-triage; only concern D wording should reflect that reference trees are present here, while fixture path conventions are still inconsistent.

---

## 3) Constraints and Ground Rules

- **Documentation Boundary**: The `/docs` folder is ephemeral and will be removed upon merging to the main branch. Persistent documentation must not reference files within `/docs`. Canonical protocol documentation should prioritize in-code comments or ARCHITECTURE.md files within the crate trees.
- Do not guess protocol behavior. Verify against ACE/ACViewer references.
- Prefer ACE synthetic generation as fixture source of truth.
- Use fixture-driven parity testing as the default contract.
- Keep refactors behavior-preserving; avoid unrelated protocol changes in decomposition work.

---

## 4) Phased Implementation Plan

### Phase 1 — Close the `PLAYER_DESCRIPTION` parity exception

#### Tasks
- Identify lossy encode/decode paths in `PlayerDescription` and related nested payload structures.
- Implement deterministic pack/unpack behavior for those structures.
- Replace no-parity dispatch coverage with strict parity coverage.
- Add/refresh fixture(s) from ACE synthetic output as needed.

#### Exit Criteria
- `PLAYER_DESCRIPTION` fixture round-trips byte-identically.
- No `assert_dispatch_match_no_parity` usage remains for this path.

### Phase 2 — Normalize parity test style across domains

#### Tasks
- Convert outlier tests in character/network/inventory domains to shared parity helper usage.
- Retain or add semantic assertions only where they provide additional behavioral signal.
- Ensure helper usage pattern is documented in-test and consistent.

#### Exit Criteria
- Fixture parity tests use one primary idiom (`assert_pack_unpack_parity`) across protocol domains.
- Remaining bespoke checks are explicitly semantic, not parity substitutes.

### Phase 3 — Decompose protocol god files

#### Tasks
- Split each large module into focused internal submodules (message-family or pack/unpack/test separation).
- Preserve existing public exports and behavior to avoid downstream churn.
- Keep mapping to ACE message families clear for cross-reference.

#### Exit Criteria
- Target files are materially smaller and easier to reason about.
- Existing behavior and test outcomes remain unchanged.

### Phase 4 — Harden fixture provenance workflow

#### Tasks
- Publish a canonical fixture provenance doc (inputs, generator path, source refs, destination conventions).
- Align docs between `holtburger-core` and `holtburger-protocol` for fixture storage and regeneration flow.
- Remove all references to the ephemeral `/docs` folder from persistent files (e.g., `.github/copilot-instructions.md`, READMEs).
- Add lightweight reproducible regeneration instructions with at least one complete worked example.

#### Exit Criteria
- A contributor can regenerate a fixture from source-of-truth references without guesswork.
- Path conventions and ownership are consistent across docs.
- No dangling references to the `/docs` folder remain in persistent files.

---

## 5) Execution Worksheet

### A) Implementation Checklist

#### Phase 1
- [ ] Locate all lossy `PLAYER_DESCRIPTION` sub-structures.
- [ ] Implement deterministic pack/unpack in protocol structs.
- [ ] Replace no-parity dispatch assertion with strict parity.
- [ ] Verify fixture parity for `PLAYER_DESCRIPTION`.

#### Phase 2
- [ ] Convert character parity outliers to shared helper.
- [ ] Convert network parity outliers to shared helper.
- [ ] Convert inventory parity outliers to shared helper.
- [ ] Keep only additive semantic asserts where needed.

#### Phase 3
- [ ] Split `object/messages.rs` into focused modules.
- [ ] Split `movement/messages.rs` into focused modules.
- [ ] Split `game_message.rs` into focused modules.
- [ ] Confirm public API and behavior stability.

#### Phase 4
- [ ] Draft fixture provenance SOP (single canonical doc).
- [ ] Align fixture path conventions in protocol/core docs.
- [ ] Remove `/docs` references from persistent files.
- [ ] Add regeneration instructions with one worked example.
- [ ] Validate docs by following instructions end-to-end.

### B) Decision Log

| Date | Decision | Why | Impact |
|---|---|---|---|
| 2026-02-14 | Make strict parity non-optional for `PLAYER_DESCRIPTION` | High-impact payload should not bypass round-trip guarantees | Reduces silent regression risk |
| 2026-02-14 | Standardize parity tests on shared helper idiom | Improves consistency and review speed | Easier auditing and maintenance |
| 2026-02-14 | Decompose protocol god files without API change | Improve maintainability with low blast radius | Safer long-term protocol expansion |
| 2026-02-14 | Adopt one fixture provenance SOP | Remove ambiguity and guessing | Reproducible contributor workflow |

### C) Verification Log

| Date | Check | Result | Notes |
|---|---|---|---|
| YYYY-MM-DD | `cargo check -p holtburger-protocol` | ⬜ | |
| YYYY-MM-DD | `cargo test -p holtburger-protocol` | ⬜ | Run focused module tests first, then package-wide |
| YYYY-MM-DD | Fixture regeneration dry-run from docs | ⬜ | Confirm no undocumented manual steps |

### D) Risks and Mitigations

- **Risk:** Structural parity fixes may expose latent mismatches in legacy fixtures.  
  **Mitigation:** Regenerate from ACE synthetic outputs and document provenance for each new fixture.
- **Risk:** File decomposition can accidentally change module visibility/exports.  
  **Mitigation:** Preserve export surface first, then run focused compile/test checks after each split.
- **Risk:** Test normalization could remove useful semantic checks.  
  **Mitigation:** Keep semantic assertions as additive checks above shared parity helper.
- **Risk:** SOP drift over time.  
  **Mitigation:** Centralize provenance policy in one canonical doc and link to it from all related docs.

### E) Open Questions

1. Which document should be the permanent canonical fixture provenance source (protocol architecture doc vs dedicated fixture SOP doc)?
2. Should parity-helper standardization be enforced via a lint/checklist rule in reviews?
3. During module decomposition, do we prefer split-by-message-family first or split-by-pack/unpack/test first for minimal churn?

---

## 6) Definition of Done

- `PLAYER_DESCRIPTION` no longer relies on no-parity dispatch testing.
- Protocol parity tests use a consistent helper-driven pattern across targeted domains.
- Large protocol files are decomposed into maintainable focused modules without behavior changes.
- Fixture provenance/regeneration is documented canonically and validated by reproduction.
