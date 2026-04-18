# Mage Spellcasting State Machine Plan

## Context And Boundaries

### Goal
Replace the mage script's patchwork spellcast bookkeeping with an explicit spellcasting lifecycle model that is easier to reason about, test, and extend without breaking combat, healing, and follow behavior.

### In Scope
- Refactor the mage script's spellcasting runtime state into a unified lifecycle shape.
- Centralize spellcast outcome resolution from workflow, chat, timeout, and local interruption signals.
- Preserve the current combat, healing, and party-follow behavior unless the current behavior is clearly accidental or bug-shaped.
- Keep vulnerability retry and success-lockout semantics explicit and separate.
- Leave the mage package compilable and testable at each phase.

### Out Of Scope
- Reworking spell selection heuristics or preferred damage ordering.
- Changing how the script discovers monsters, party targets, or spellbook contents.
- Moving mage script behavior into shared Rust crates in this pass.
- Replacing the top-level mage loop with a fully generic planner architecture.
- Any ACE or protocol-side behavior changes.

## Why This Needs Refactoring

The current mage runtime works, but the spellcasting lifecycle is spread across multiple unrelated state holders and event paths:

- cast issuance and throttling: [scripts/src/mage/src/runtime-actions.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/runtime-actions.ts)
- top-level tick orchestration and pending-cast pauses: [scripts/src/mage/src/engine.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/engine.ts)
- event-driven resolution from workflow, chat, and error events: [scripts/src/mage/src/index.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/index.ts)
- planner-side vuln retry policy: [scripts/src/mage/src/combat.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/combat.ts)
- runtime state storage: [scripts/src/mage/src/types.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/types.ts) and [scripts/src/mage/src/state.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/state.ts)

That split has already produced one real bug class: the runtime can decide a cast fizzled before the host has finished reporting the cast lifecycle, which then feeds back into vuln retry logic and duplicate cast emission.

The recent busy-grace patch fixes that symptom, but the underlying shape is still awkward:

- `pendingSpellCast` is not a full state machine; it is a partial record plus ad hoc booleans.
- `actionTimes` controls issuance cadence but sits outside the cast lifecycle.
- `vulnerabilityAttempts` and `vulnerabilityTimes` are planner/runtime policy state, but the lifecycle that should update them is not unified.
- several unrelated entry points can clear or finalize a cast.

## Ground Truth

### Current Mage Runtime
- top-level event entry: [scripts/src/mage/src/index.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/index.ts)
- main decision loop: [scripts/src/mage/src/engine.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/engine.ts)
- combat planner and vuln selection: [scripts/src/mage/src/combat.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/combat.ts)
- cast issuance and resolution helpers: [scripts/src/mage/src/runtime-actions.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/runtime-actions.ts)
- runtime state model: [scripts/src/mage/src/types.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/types.ts)
- initial/reset state wiring: [scripts/src/mage/src/state.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/state.ts)
- current tests: [scripts/src/mage/src/runtime-actions.test.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/runtime-actions.test.ts)

### Existing Behavioral Constraints
- successful vuln casts should create a 10-minute target lockout.
- failed or resisted vuln casts should consume attempt budget without creating the 10-minute lockout.
- healing, follow, and combat should not stomp an unresolved cast silently unless that interruption is intentional and logged.
- the mage loop should not issue a second spell while one is still plausibly unresolved.

## Dry-Run Findings

Running this plan against the current mage runtime exposed a few seams that should shape the refactor order.

### Verified Seams
- `pendingSpellCast` in [scripts/src/mage/src/types.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/types.ts) only tracks `spellId`, `targetGuid`, `damageType`, `isVulnerability`, `issuedAt`, and `busyObserved`. It cannot represent distinct phases such as `awaiting_busy`, `active`, `resolved_resist`, or `timed_out`.
- `castSpell()` in [scripts/src/mage/src/runtime-actions.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/runtime-actions.ts) both throttles emission and allocates lifecycle state. That bundles "may I issue?" policy together with "what phase is this cast in?" bookkeeping.
- `handlePendingSpellChatMessage()`, `resolvePendingSpellCastOnIdle()`, `logPendingSpellCastFailure()`, timeout handling in [scripts/src/mage/src/engine.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/engine.ts), and follow override cleanup in [scripts/src/mage/src/engine.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/engine.ts) can all terminate the current cast through separate paths.
- `clearPendingSpellCast()` is a raw state reset. It has no required reason or transition type, so callers can discard lifecycle context without expressing whether the cast succeeded, failed, timed out, or was intentionally interrupted.
- `vulnerabilityAttempts` and `vulnerabilityTimes` live beside the cast lifecycle in [scripts/src/mage/src/state.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/state.ts), but they are updated as side effects from whichever completion path happened to fire. There is no single authoritative resolution point.
- planner logic in [scripts/src/mage/src/combat.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/combat.ts) knows about attempt budget and success lockout, while runtime logic in [scripts/src/mage/src/runtime-actions.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/runtime-actions.ts) knows about host feedback and timing. That is the right high-level split, but the contract between them is too implicit.
- `runMage()` in [scripts/src/mage/src/engine.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/engine.ts) mixes three concerns in one control band: resolving host feedback, deciding whether the engine should pause, and performing new planning. That makes future lifecycle extensions awkward.

### Natural Shape Adjustment
- A full "everything mage does" state machine is too broad for the first refactor.
- The more natural first-class domain is a `spellcast` lifecycle substate plus a small `vulnerability memory` policy store.
- Combat target acquisition, healing choice, and party-follow should stay outside that substate for now and query it through simple predicates such as "is a cast unresolved?" and "may I issue this cast intent?"

That narrower shape is the best fit for the current codebase because it removes the current bug class without forcing a full rewrite of the planner.

## Proposed Shape

### Core Runtime Model

Replace `pendingSpellCast` with an explicit spellcast lifecycle value, conceptually shaped like this:

```text
SpellcastState
- idle
- issuing { request }
- awaiting_busy { request }
- active { request, busy_since }
- resolved { request, outcome, resolved_at }

SpellcastRequest
- spellId
- targetGuid
- damageType
- kind: Vulnerability | Attack | Heal | Revitalize | Transfer
- issuedAt

SpellcastOutcome
- succeeded
- resisted
- fizzled
- interrupted { reason }
- timed_out
```

Important properties:

- the runtime always knows which phase a cast is in
- all completion paths express an outcome rather than silently clearing state
- non-vuln and vuln casts share the same lifecycle model
- vuln-specific retry and success-lockout policy remain separate from generic lifecycle state

### Supporting Policy State

Keep a separate, explicit vulnerability memory model:

```text
VulnerabilityPolicyState
- attemptsByTarget: Map<Guid, number>
- lastSuccessfulVulnAtByTarget: Map<Guid, number>
```

This keeps the core split honest:

- spellcast lifecycle answers: what happened to the current cast?
- vulnerability memory answers: given past outcomes, should combat try another vuln?

### Suggested API Boundary

Instead of raw helpers that mutate scattered fields directly, prefer a small lifecycle API in `runtime-actions.ts` or a new colocated `spellcast.ts` module:

- `beginSpellcast(state, request)`
- `observeSpellcastBusy(state)`
- `resolveSpellcastFromIdle(state)`
- `resolveSpellcastFromResistMessage(state, chatEvent)`
- `resolveSpellcastFromWeenieError(state)`
- `resolveSpellcastFromTimeout(state)`
- `interruptSpellcast(state, reason)`
- `currentSpellcastBlocksPlanning(state)`

The important constraint is not the exact names. The important constraint is that the lifecycle is finalized in one conceptual place rather than through raw field resets.

## Phased Implementation

### Phase 1: Introduce Explicit Spellcast Domain Types

#### Deliverables
- update [scripts/src/mage/src/types.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/types.ts) with explicit spellcast request, phase, and outcome types
- update [scripts/src/mage/src/state.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/state.ts) to hold the new spellcast substate
- keep vulnerability policy state explicit rather than folded into the spellcast record

#### Acceptance Criteria
- state types compile
- there is no ambiguous `pendingSpellCast` record left in runtime state
- existing behavior can still be expressed with the new types without changing planner semantics yet

### Phase 2: Centralize Lifecycle Transitions

#### Deliverables
- refactor [scripts/src/mage/src/runtime-actions.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/runtime-actions.ts) so every cast completion path produces an explicit outcome
- replace raw clear/reset paths with named interrupt or resolve transitions
- preserve the busy-grace behavior introduced by the recent patch

#### Acceptance Criteria
- all host-facing spellcast transitions flow through the spellcast lifecycle API
- no caller clears the current cast without a stated reason
- runtime tests cover success, resist, fizzle-after-grace, timeout, and interruption

### Phase 3: Rewire Engine Pause Semantics Around Lifecycle Queries

#### Deliverables
- refactor [scripts/src/mage/src/engine.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/engine.ts) to ask the lifecycle whether planning should pause
- keep planning, lifecycle resolution, and interruption handling visually separate in the loop

#### Acceptance Criteria
- the engine no longer infers lifecycle state from raw field presence alone
- unresolved casts block replanning consistently
- follow override and other interruptions go through explicit lifecycle transitions

### Phase 4: Tighten Planner Contract For Vulnerability Policy

#### Deliverables
- refactor [scripts/src/mage/src/combat.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/combat.ts) to consume explicit lifecycle/policy predicates instead of low-level state details
- make vulnerability-attempt and success-lockout checks read from the dedicated policy state only

#### Acceptance Criteria
- combat logic does not need to know how host feedback resolves casts internally
- successful and failed vuln outcomes update policy in one clear place
- duplicate vuln emission regressions are covered by tests

### Phase 5: Optional Cleanup Pass

#### Deliverables
- evaluate whether `actionTimes` should remain a general issue throttle or split into cast-throttle versus interaction-throttle state
- decide whether a dedicated `spellcast.ts` module is now a cleaner home than keeping everything in [scripts/src/mage/src/runtime-actions.ts](/home/cluracan/code/holtburger/scripts/src/mage/src/runtime-actions.ts)

#### Acceptance Criteria
- module boundaries are cleaner than the pre-refactor shape
- the final shape feels smaller and more obvious, not more abstract for its own sake

## Risks And Mitigations

### Risk: Over-generalizing Into A Giant Mage State Machine
Mitigation:
keep the first refactor scoped to spellcasting lifecycle plus vulnerability policy state. Do not try to absorb target acquisition, healing strategy, and party follow into the same machine.

### Risk: Breaking Working Healing Or Follow Behavior While Refactoring Combat
Mitigation:
introduce neutral spellcast lifecycle types first, then migrate all spell kinds through the same API before changing planner policy. Keep follow interruption explicit and tested.

### Risk: Outcome Semantics Stay Implicit Even After The Refactor
Mitigation:
ban raw `clearPendingSpellCast()`-style resets from the new shape. Every lifecycle end must produce an outcome or interruption reason.

### Risk: `weenie_error` Is Too Coarse To Model Precisely
Mitigation:
model it first as a generic interruption/failure outcome and refine later if host error classes become richer. The state machine should not depend on perfect host diagnostics to be useful.

### Risk: Tests Keep Mirroring Current Accidents
Mitigation:
write tests around lifecycle contracts, not current function names. For example: "a cast in `awaiting_busy` does not replan before grace expires" is a behavior contract; "`resolvePendingSpellCastOnIdle()` returns false on first tick" is implementation-shaped.

## Definition Of Done

- mage runtime uses an explicit spellcast lifecycle shape rather than a partial pending-cast record
- all cast completion paths produce named outcomes or interruptions
- vuln attempt and success-lockout policy are updated from one authoritative lifecycle resolution path
- focused runtime tests cover success, resist, fizzle, timeout, and interruption
- mage package typecheck, lint, format check, and build pass
- combat behavior is at least as stable as the current patched grace-window version

## Living Worksheet

### Task Checklist
- [x] Phase 1: add explicit spellcast domain types
- [x] Phase 2: centralize lifecycle transitions
- [x] Phase 3: rewire engine pause semantics
- [x] Phase 4: tighten planner contract for vuln policy
- [x] Phase 5: cleanup module boundaries and throttling seams

### Decisions Log
- 2026-04-17: The first refactor target should be a spellcasting substate, not a giant top-level mage state machine.
- 2026-04-17: Vulnerability policy should stay separate from generic spellcast lifecycle state.
- 2026-04-17: The recent busy-grace patch should be preserved as part of the lifecycle contract, not treated as a temporary hack to delete blindly.
- 2026-04-17: `actionTimes` remains the generic issue-throttle store for non-spell actions; spell emission blocking now comes from explicit spellcast lifecycle state.
- 2026-04-17: The lifecycle stayed in `runtime-actions.ts` for this pass because the resulting module remained small and coherent enough without a dedicated `spellcast.ts` split.

### Verification Log
- 2026-04-17: Observed false-fizzle behavior in live logs where vuln casts were marked failed before host confirmation.
- 2026-04-17: Patched the busy-grace behavior and verified focused runtime tests plus mage package build pass.
- 2026-04-17: Replaced `pendingSpellCast` with explicit `spellcast` lifecycle phases and dedicated vulnerability policy state.
- 2026-04-17: Added lifecycle tests covering success, resist, fizzle, timeout, `weenie_error` interruption, and follow interruption semantics.
- 2026-04-17: Verified `npm --prefix /home/cluracan/code/holtburger/scripts/src/mage exec -- tsx --test src/runtime-actions.test.ts && npm --prefix /home/cluracan/code/holtburger/scripts/src/mage run build` passes.

### Open Questions
- Should `actionTimes` remain a generic issue-throttle map, or should spell emission throttling move under the spellcast domain while follow/heal-kit throttles stay generic?
- Should a successful non-vuln cast ever leave behind reusable per-target memory, or is vulnerability the only spell family that needs target-scoped post-success policy for now?
- Is `runtime-actions.ts` still a good home after this refactor, or will a dedicated `spellcast.ts` module make the resulting shape easier to read?