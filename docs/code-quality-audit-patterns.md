# Code Quality Audit Patterns

This document is a living catalog of implementation-independent problem patterns found during
code review. It is intended to become source material for a universal audit rubric. Entries
describe detection signals, risks, and preferred corrections without naming a particular feature,
file, or product.

The catalog is evidence-led: add a pattern when a real review demonstrates that it can hide a bug,
inflate a contract, or materially obstruct verification. Do not add stylistic preferences that
cannot name a failure mode.

## Validate Before Mutating

**Pattern:** Admission, freshness, authorization, or validation occurs after state has already been
changed.

**Detection signals:**

- A function mutates outer state before calling a reducer that can reject the input.
- A stale or duplicate branch returns successfully after counters, ownership, queues, or pending
  work have changed.
- Validation is repeated in several consumers because no single boundary owns admission.

**Why it matters:** Rejected input becomes observably non-idempotent. Stale resets can retire newer
work, malformed commands can consume capacity, and retries can change state even when their result
says they were ignored.

**Preferred correction:** Reduce or validate first, return immediately on rejection, and commit all
related mutations in one explicit accepted branch. Test both stale destructive input and stale
constructive input.

**False positives:** Some protocols intentionally advance one timestamp before rejecting a later
gate. Preserve that ordering only with primary-source evidence and a regression that names the
exception.

## Retain the Operands of a Stateful Decision

**Pattern:** A lifecycle stores only part of a decision, then recomputes the missing operands from
moving input while deciding whether the original work completed.

**Detection signals:**

- State retains a direction, boolean, or enum but not the target/value that produced it.
- Completion compares the current result of a moving query with a choice made on an earlier tick.
- An external target changing sides can masquerade as the controlled object crossing its target.

**Why it matters:** Completion and reversal become functions of unrelated external motion. Stateful
work may terminate early, oscillate, or reverse even though the controlled system made no progress.

**Preferred correction:** Store the admitted target and chosen direction in one progress value.
Evaluate completion against that fixed decision until the lifecycle explicitly starts a new node.

**False positives:** A controller designed to continuously track a target should recompute it, but
that tracking policy must be explicit and must not reuse a fixed-target crossing test.

## Collapse Interdependent State into a Composite Type

**Pattern:** Fields that must change together are represented independently or encoded through
opaque combinations such as nested optionals and sentinel values.

**Detection signals:**

- Only a subset of the Cartesian product of several fields is valid.
- `Option<Option<T>>`, paired booleans, or nullable values encode lifecycle phases.
- Consumers need assertions, fallbacks, or comments to explain impossible combinations.

**Why it matters:** Partial updates create invalid intermediate states, while reviewers must infer a
hidden state machine from field combinations.

**Preferred correction:** Use an enum for mutually exclusive phases and a struct for facts that
must travel together. Give every representable state a domain name.

**False positives:** A nested optional can be appropriate in a generic patch/merge format where
“omitted,” “clear,” and “set” are the format's public semantics. It should not leak into domain
state merely because it is compact.

## Treat Explicit Empty State as State

**Pattern:** An initialized but empty value is collapsed into “never initialized” or “no update.”

**Detection signals:**

- `None` represents both “no authority received” and “authority explicitly says idle/empty.”
- Empty collections or absent channels skip publication despite needing to retire prior work.
- A stop depends on a later timeout because the empty successor was discarded.

**Why it matters:** Previous level-triggered behavior survives explicit retirement. Animations,
subscriptions, motion, or cached results can run forever after a valid empty update.

**Preferred correction:** Model initialization separately from payload contents. Publish and apply
empty successors when they carry authority.

## Make Lifecycle Retirement Exact

**Pattern:** One-shot work ends through elapsed time, lack of recent input, or an unrelated state
change instead of its authored completion boundary.

**Detection signals:**

- A timeout approximates completion of queued work with known internal boundaries.
- The next command implicitly retires the current command.
- Cyclic and non-cyclic portions are not distinguished in sequence state.

**Why it matters:** Variable rates, frame ranges, and transition paths make wall-clock guesses
incorrect. Work either loops forever or is cut off early.

**Preferred correction:** Mark the exact terminal node/event when selecting the work and propagate
that edge through the owning runtime. Keep steady state and transient FIFO state separate.

## Require a Named Consumer for Public Surface

**Pattern:** A helper, field, metric, or abstraction is public without an existing production
consumer.

**Detection signals:**

- Repository search finds only tests or the defining module using a public item.
- A metric cannot name a scenario in which it changes a decision.
- A generic abstraction exists for one concrete use and has no second caller.

**Why it matters:** Public visibility creates a compatibility and validation obligation. Premature
primitives encourage callers to bypass the composite contract that owns the real invariant.

**Preferred correction:** Keep the item private until a named consumer exists. Export the smallest
composite semantic contract, not intermediate formulae or transport-shaped pieces.

## Keep Source Adapters Separate and Converge Early

**Pattern:** Entity categories or input sources acquire parallel controllers after ingestion even
though they share the same semantic behavior.

**Detection signals:**

- Local, remote, automated, or category-specific branches independently select equivalent motion,
  animation, or physical effects.
- Fixes repeatedly land in one category while another continues to skate, loop, or diverge.
- Presentation infers semantic intent from displacement because the authoritative adapter dropped
  it.

**Why it matters:** Parallel pipelines drift and turn every behavior fix into a matrix of patches.
Inference from effects also misclassifies corrections, teleports, and knockback as intentional
actions.

**Preferred correction:** Preserve source-specific ordering and authority rules at ingestion, then
normalize into one semantic order/event contract consumed by one runtime and solver.

**False positives:** Different authority sources may require genuinely different admission,
prediction, or reconciliation. Convergence begins after those policies have produced equivalent
semantic facts, not before.

## Compute Derived Facts Once at Their Owning Boundary

**Pattern:** Several layers independently derive the same semantic fact from lower-level inputs.

**Detection signals:**

- Physics, presentation, and transport each interpret support, stance, capability, or effective
  resource identity.
- A frontend or renderer reconstructs gameplay state from poses or velocities.
- The same fallback chain appears in more than one layer.

**Why it matters:** Slightly different defaults and timing produce contradictory outputs that are
individually plausible and difficult to diagnose.

**Preferred correction:** Compute the fact once where all authoritative inputs exist, include it in
the contract, and make downstream consumers read it without re-deriving it.

## Avoid Duplicating Complete Products on Hot Paths

**Pattern:** A wrapper allocates or clones a second complete result even when the wrapped operation
already produced exactly the required golden-path value.

**Detection signals:**

- Frame/tick code maps or clones a complete array solely to preserve a sparse exceptional case.
- A merge function always allocates despite equal source and destination coverage.
- Memoization is proposed before eliminating structural duplicate work.

**Why it matters:** Per-frame allocation increases garbage collection and cache pressure in the
most common case, while obscuring the simpler ownership contract.

**Preferred correction:** Return the already-complete product on the golden path. Allocate only
when extending, truncating, or isolating ownership is actually required.

## Use Checked Contract Conversions

**Pattern:** A boundary narrows a value with an unchecked cast because current producers happen to
fit.

**Detection signals:**

- Duration, identifier, count, or sequence values use `as` at a wire/UI boundary.
- The source domain is wider than the destination schema.
- A future producer can silently truncate rather than fail at the owner boundary.

**Why it matters:** Contract corruption remains invisible until a value exceeds today's informal
range. The receiving side sees a valid but false value.

**Preferred correction:** Use a checked conversion and fail loudly with an invariant-specific
message, or narrow the source type if the smaller range is authoritative.

## Isolate Outlier Payloads in Sum Types

**Pattern:** One large variant determines the size of every value in an otherwise small event or
command enum.

**Detection signals:**

- Size analysis or linting reports a large difference between enum variants.
- A queue of tiny tick/key/control events reserves space for an occasional aggregate snapshot.
- Adding one field to a cold payload unexpectedly inflates a hot dispatcher type.

**Why it matters:** Every queued or moved value pays the outlier's stack and cache footprint even
when the common variant is tiny. Small unrelated additions can also push the enum across warning or
stack-size thresholds.

**Preferred correction:** Put deliberate indirection around the cold outlier at the dispatch
boundary, preserving direct storage for common small variants. Keep the allocation at ownership
transfer rather than repeatedly boxing and unboxing inside consumers.

**False positives:** Do not add indirection to a hot large variant merely to satisfy an arbitrary
size ratio. Measure frequency and ownership; a uniformly large enum or latency-critical payload may
be better represented directly.

## Keep Diagnostics Downstream of Semantics

**Pattern:** Logging, probes, or debug needs shape the production state contract or become required
for correctness.

**Detection signals:**

- Production types retain fields used only for messages or tests.
- Behavior changes to make a probe easier to observe.
- A diagnostic reconstructs semantics that the runtime itself discarded.

**Why it matters:** Diagnostics become accidental authorities, add permanent state, and can mask
the missing production contract they were meant to investigate.

**Preferred correction:** Expose existing semantic decisions to diagnostics at a read-only edge.
Keep temporary instrumentation out of durable state, and remove it after evidence is gathered.

## Control Test-Fixture Gravity

**Pattern:** Integration fixtures and scenario setup grow until they dominate the module containing
the production code.

**Detection signals:**

- Reviewers cannot see the production change in an ordinary diff because thousands of fixture
  lines surround it.
- Multiple tests rebuild the same world, graph, or protocol payload with small variations.
- Helper setup silently establishes unrelated invariants.

**Why it matters:** Auditability declines, fixture behavior becomes a shadow framework, and broad
setup makes tests brittle or misleading.

**Preferred correction:** Keep focused unit fixtures near their owner, move large scenario suites
to dedicated test modules, and extract only honest shared builders whose names state every
important invariant. Do not create a generic test framework merely to reduce line count.

## Sweep Vocabulary with Structural Changes

**Pattern:** A mechanism is removed or renamed while old terminology survives in symbols,
diagnostics, comments, tests, or documentation.

**Detection signals:**

- Searches find both old and new names for one concept.
- Comments describe a superseded architecture despite compiling code.
- A diagnostic label implies behavior the runtime no longer performs.

**Why it matters:** Stale vocabulary sends future maintainers toward dead architecture and makes
search-based audits unreliable.

**Preferred correction:** Treat the vocabulary sweep as part of the same change. Search code,
tests, metrics, logs, UI labels, and active documentation before declaring the cutover complete.

## Audit Checklist Seed

For each changed lifecycle or cross-layer contract, ask:

1. Can rejected, stale, duplicate, or unauthorized input mutate anything?
2. Does completion use the exact operands admitted when the work began?
3. Can the type represent an invalid phase or partial combination?
4. Is explicit empty/idle distinct from uninitialized or absent input?
5. Is transient retirement tied to an exact semantic boundary?
6. Does every public field, helper, metric, and abstraction have a named production consumer?
7. Do different sources normalize into one semantic runtime after their authority-specific gates?
8. Is each derived fact computed once by the layer that owns all of its inputs?
9. Does the frame/tick golden path avoid redundant allocations and clones?
10. Are boundary conversions checked against the destination domain?
11. Does a cold outlier inflate every value of a frequently moved sum type?
12. Did diagnostics remain consumers rather than authorities?
13. Are production changes still reviewable without understanding a large fixture framework?
14. Has obsolete vocabulary been removed from every surviving surface?
