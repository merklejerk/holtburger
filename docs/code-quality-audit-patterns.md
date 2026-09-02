# Software Quality Smell Worksheet

This is a working collection of domain-independent software quality smells observed during real
code review. It is raw material for a future audit rubric, not a rubric itself.

The collection is deliberately incomplete, unranked, and non-prescriptive. An entry records a
reason to investigate; it does not prove that a design is wrong. Absence from this worksheet says
nothing about a codebase's quality, and the number of matched smells is not a score.

Keep entries universal. Local names, architecture, and incidents may motivate an entry, but the
entry should describe a pattern that can recur across languages and product domains.

## Entry Template

### Short name

**Smell:** What general condition prompted investigation?

**Signals:** What concrete shapes, flows, or behavior might reveal it?

**Possible failure:** What can go wrong if the suspicion is correct?

**Questions:** What should a reviewer establish before calling it a problem?

**Counterexamples:** When might the same shape be intentional or harmless?

**Possible responses:** What kinds of correction may address the underlying risk? These are options,
not required implementations.

## Effects Before Acceptance

**Smell:** Input can change state or begin an external effect before validation, authorization,
freshness, deduplication, or admission finishes.

**Signals:**

- Mutations, resource acquisition, queue writes, or outbound calls precede a rejecting branch.
- Rejected, stale, duplicate, or retried input changes counters, ownership, pending work, or stored
  state.
- Several consumers repeat admission rules because no boundary clearly owns acceptance.

**Possible failure:** Rejected input is observably non-idempotent. Retries duplicate effects, stale
input overwrites newer state, or unauthorized requests consume resources.

**Questions:** Which effects occur before each rejection? Can rejected input be replayed safely? Is
the pre-rejection effect part of an explicit contract?

**Counterexamples:** Recording receipt, rate-limiting attempts, or advancing an audit sequence may
intentionally happen before later rejection.

**Possible responses:** Decide acceptance before effects, return immediately on rejection, or model
the intentional pre-rejection effect explicitly and test its ordering.

## Invalid Combinations Hidden in Loose Fields

**Smell:** Facts that must change together are represented independently, or phases are encoded
through undocumented combinations of booleans, nulls, sentinels, or loosely related fields.

**Signals:**

- Only a small subset of possible field combinations is valid.
- Consumers use assertions, fallbacks, or comments to exclude states permitted by the type or
  schema.
- An update can expose half of a logically atomic transition.

**Possible failure:** Partial updates and overlooked combinations produce states that consumers
interpret inconsistently. The real state machine exists only as convention.

**Questions:** Which combinations are valid? Can construction and update APIs represent an invalid
one? Can another observer see an intermediate combination?

**Counterexamples:** Generic patch formats may legitimately distinguish omitted, cleared, and set
values even when the domain model does not.

**Possible responses:** Introduce a composite value, sum type, explicit state machine, or atomic
transition at the owning boundary.

## Several Meanings Share One Empty Value

**Smell:** One representation stands for semantically different states such as not loaded, loaded
and empty, explicitly cleared, unknown, or use the default.

**Signals:**

- Empty values skip publication even when they should clear previous state.
- Missing or null sometimes means none and sometimes means unknown.
- Correctness relies on a later refresh or timeout because an empty successor was discarded.

**Possible failure:** Previous state survives an explicit clear, initialization races with
consumption, or callers invent conflicting interpretations.

**Questions:** Which empty-like states can callers observe? Do they require different behavior? Is
the distinction lost at a boundary?

**Counterexamples:** Collapsing states is harmless when every consumer treats them identically and
no future transition depends on their origin.

**Possible responses:** Give each behaviorally distinct state an explicit representation and
preserve authoritative empty results.

## Incomplete Evidence Looks Like a Negative Result

**Smell:** A query skips unavailable partitions, failed lookups, or uninspected sources and returns
the same empty or negative result it would return after complete inspection.

**Signals:**

- Missing shards, files, scene regions, pages, or services lead to `continue`, an empty collection,
  or `false` without any coverage fact.
- Callers cannot distinguish “nothing matched” from “some required inputs were unavailable.”
- Objects disappear or decisions change near loading, pagination, tenancy, or interest boundaries.

**Possible failure:** The system states that something is absent when it merely failed to look
everywhere required to prove absence, producing silent under-selection and boundary-dependent
behavior.

**Questions:** Which sources must be inspected to make the result authoritative? Is partial output
a supported contract? Can the caller identify exactly which coverage was missing?

**Counterexamples:** Search previews, diagnostics, and opportunistic caches may intentionally return
best-effort results when incompleteness is explicit and no correctness decision consumes them.

**Possible responses:** Return typed missing-coverage information, fail the exact query, load the
required partitions first, or name and isolate a deliberately best-effort operation.

## Stateful Work Forgets Why It Started

**Smell:** A process stores its chosen result but later recomputes the inputs that originally
justified it when deciding whether to continue, reverse, or complete.

**Signals:**

- State retains a direction, mode, or boolean but not the target, threshold, version, or policy
  used to choose it.
- Completion compares current external data with a choice made from an earlier snapshot.
- Unrelated changes can look like progress by changing the recomputed inputs.

**Possible failure:** Work finishes early, oscillates, reverses, or violates snapshot consistency
without making the progress the original decision required.

**Questions:** Is this operation fixed against its admitted inputs or intended to track live state?
Does completion use the same decision basis as admission?

**Counterexamples:** Continuously adaptive systems should recompute targets, provided their
completion rule is also defined against live state.

**Possible responses:** Store the admitted decision and its required operands together, or make
continuous replanning an explicit policy.

## Completion Is Inferred from an Unrelated Event

**Smell:** Transient work ends because time passed, another operation began, an observer stopped
seeing it, or unrelated state changed instead of because its own lifecycle completed.

**Signals:**

- A timeout approximates a completion event the system could represent directly.
- Starting new work is the only way to retire old work.
- Persistent state and one-shot work share storage without a lifecycle distinction.
- Cancellation, success, failure, and supersession are conflated.

**Possible failure:** Work runs forever, is truncated, completes twice, leaks ownership, or leaves
stale state behind.

**Questions:** Who owns the work? What are its terminal outcomes? Which component can know that each
outcome actually occurred?

**Counterexamples:** A timeout may be the real contract when the external system provides no
completion signal, or may be a valid safety backstop distinct from ordinary completion.

**Possible responses:** Represent ownership and terminal outcomes explicitly and propagate the
actual completion, cancellation, or supersession event.

## Partial Readiness Is Mistaken for Quiescence

**Smell:** A test or runtime decision observes one requested result and assumes that all related
concurrent work has finished.

**Signals:**

- A wait condition names one item while later assertions inspect aggregate counters or collections.
- Several jobs start together, but the code captures a supposedly stable baseline after awaiting
  only one of them.
- Timing changes alter counts or ordering without changing any individual result.

**Possible failure:** Legitimate late completions look like duplicate work, flaky tests pass in
isolation but fail in a suite, or downstream logic acts on an incomplete batch.

**Questions:** Which operations were started before the readiness check? Does the later assertion
concern only the awaited item or the whole group? What event proves the relevant scope is quiescent?

**Counterexamples:** One result can be sufficient when pending siblings cannot affect the observed
state or the contract explicitly permits a partial snapshot.

**Possible responses:** Await every operation whose result contributes to the assertion, expose a
batch-completion signal, or scope observations and counters to the specific item being tested.

## Narrowing Relies on Today's Data

**Smell:** A value is narrowed, rounded, truncated, or reinterpreted because current producers
happen to fit the destination domain.

**Signals:**

- Unchecked numeric casts at storage, serialization, foreign-function, or public API boundaries.
- Unit conversions have no explicit rounding or overflow policy.
- Identifiers or enumerations can enter values the destination cannot faithfully represent.

**Possible failure:** The receiver gets a valid-looking but false value once production data grows
beyond today's informal range.

**Questions:** What is the source domain? What is the destination domain? What happens at every
boundary value and outside the range?

**Counterexamples:** A conversion may be proven safe by a stronger source type or a preceding check
that dominates every path.

**Possible responses:** Use checked conversion, narrow the source type, or state and enforce the
rounding, saturation, or overflow policy.

## The Same Fact Has Several Owners

**Smell:** Multiple components independently derive the same semantic fact from lower-level input.

**Signals:**

- The same formula, fallback chain, classification, or policy appears in several layers.
- A downstream consumer reconstructs intent from side effects because an upstream layer discarded
  it.
- Callers use slightly different defaults for nominally identical facts.
- Every element repeats one collection-wide invariant, and consumers choose an arbitrary
  "representative" element to recover it.

**Possible failure:** Consumers produce contradictory answers that are individually plausible and
difficult to diagnose.

**Questions:** Which component has all authoritative inputs? Is the duplicated calculation truly the
same policy? Can callers observe a difference in timing or defaults?

**Counterexamples:** Similar formulas can represent distinct policies with independent ownership;
deduplicating them may create false coupling.

**Possible responses:** Compute the fact once at its owning boundary and include it in the contract,
or name the distinct policies so their differences are explicit.

## Cache Identity Omits Output-Shaping Inputs

**Smell:** Cached or deduplicated output depends on an input that is absent from the cache key or
from the scope that owns the cache.

**Signals:**

- One source asset can be projected under different filters, modes, permissions, locales, or
  dependency versions, but the key names only the source identity.
- A new output filter is added without changing cache identity or invalidation.
- Correctness depends on whichever variant happens to populate the cache first.
- Callers append ad hoc suffixes after discovering collisions between otherwise valid variants.

**Possible failure:** A valid result prepared for one context is silently reused in another,
creating order-dependent behavior that often disappears when caches are cold.

**Questions:** Which inputs can change the produced value? Are omitted inputs invariant for the
cache's complete lifetime? Does invalidation cover every mutable dependency?

**Counterexamples:** An omitted input is harmless when the producer proves it cannot affect output,
or when the cache is scoped beneath an owner that fixes that input for its lifetime.

**Possible responses:** Use a composite semantic key, move the cache under the owner of the omitted
invariant, cache an earlier context-free representation, or invalidate on every output-shaping
dependency change.

## Equivalent Inputs Stay in Parallel Pipelines

**Smell:** Inputs from different transports, callers, user types, or execution modes keep separate
implementations after their genuine semantic differences have ended.

**Signals:**

- Equivalent behavior is independently implemented for each source category.
- Fixes repeatedly land in one path while another retains the defect.
- Consumers branch on provenance even when provenance no longer affects policy.
- Effects are inspected to infer intent that an adapter could have preserved.

**Possible failure:** Parallel paths drift and turn each behavior change into a matrix of patches.

**Questions:** Which differences are required by trust, ordering, consistency, latency, or
reconciliation? At what point do the inputs mean the same thing?

**Counterexamples:** Sources with genuinely different authority or consistency requirements may
need distinct policies throughout more of the pipeline.

**Possible responses:** Keep source-specific rules in adapters, then normalize accepted input into
one semantic contract as soon as the real differences end.

## Public Surface Without a Named Consumer

**Smell:** A public helper, field, metric, extension point, or abstraction exists for hypothetical
reuse rather than current production behavior.

**Signals:**

- Only tests or the defining module use a public item.
- A metric cannot name a decision or investigation where it differs from existing telemetry.
- A generic mechanism has one concrete caller and no demonstrated variation.
- Public primitives let callers bypass a higher-level invariant.

**Possible failure:** Unused surface creates compatibility, documentation, testing, and security
obligations while exposing states that should remain owned.

**Questions:** Who consumes it today? Which supported variation requires it? What obligation does
public visibility create?

**Counterexamples:** Framework and library boundaries may intentionally define extension points
before in-repository consumers exist, but should have an external contract and audience.

**Possible responses:** Keep the item private, export a complete semantic operation, or document the
external consumer and compatibility commitment.

## Diagnostics Become Part of the Control Plane

**Smell:** Logging, metrics, tests, or debugging tools shape production state or become required for
correct behavior.

**Signals:**

- Production types retain fields used only by diagnostics.
- Behavior changes merely to make an observation easier.
- A diagnostic reconstructs important semantics the runtime discarded.
- Disabling instrumentation changes ordering, lifecycle, or outcomes.
- Counters, diagnostic result objects, or alternative schedules are still computed when
  instrumentation is disabled.

**Possible failure:** Observability becomes an accidental authority, expands permanent state, or
masks a missing production contract.

**Questions:** Does the system behave identically without the diagnostic? Is the observed fact
already owned by production code? Is temporary instrumentation leaking into durable design?

**Counterexamples:** Auditing, metering, and safety monitoring can be product requirements rather
than optional diagnostics.

**Possible responses:** Expose existing decisions at a read-only edge, separate required auditing
from debugging, and remove temporary diagnostic state after evidence gathering.

## The Common Path Duplicates a Complete Result

**Smell:** A wrapper allocates, clones, copies, serializes, or recomputes a second complete result
when the wrapped operation already produced what the caller needs.

**Signals:**

- A complete collection is copied solely to support an uncommon partial case.
- A merge or transformation always allocates even when the input already satisfies the contract.
- Caching is proposed before structurally duplicated work is removed.
- Duplication occurs on a high-frequency or high-volume path.

**Possible failure:** The common case pays unnecessary CPU, memory bandwidth, garbage collection,
allocation, or network cost while ownership becomes less clear.

**Questions:** Can ownership of the existing result be transferred? How common is the exceptional
case? Is isolation actually required?

**Counterexamples:** Copying may be required for isolation, immutability, ownership transfer, or
concurrency safety.

**Possible responses:** Reuse or transfer the complete result on the common path and pay copying or
merging costs only when needed.

## A Rare Outlier Sets Every Value's Cost

**Smell:** An uncommon case determines the memory, allocation, serialization, or dispatch cost of
every value in a frequently used representation.

**Signals:**

- One variant is much larger than the rest of a sum type.
- Every small queue item reserves capacity for an occasional large payload.
- Adding one cold field changes stack size, cache density, or copy cost for common work.
- Sparse records are materialized densely without evidence that density is cheaper.

**Possible failure:** Every common operation pays for an uncommon case, producing disproportionate
memory or throughput regressions.

**Questions:** How frequent is each shape? Where is ownership transferred? What do measurement and
allocation profiles show?

**Counterexamples:** Indirection can cost more when the large case is common, uniformly accessed, or
latency critical.

**Possible responses:** Isolate cold outliers through indirection, separate storage, or a different
transfer path after measuring frequency and locality.

## Tests Freeze an Adjustable Choice

**Smell:** A test promotes a subjective default, tuning value, implementation detail, or historical
calibration into a permanent behavioral requirement.

**Signals:**

- A lower-level test imports application configuration and asserts an exact product result.
- Refactoring internals breaks tests without changing observable behavior.
- Changing a documented tuning knob fails tests while preserving meaningful behavioral properties.
- A historical value is described as an enduring requirement without an external source.

**Possible failure:** Tests resist legitimate change, obscure real regressions among false failures,
and make adjustable values non-adjustable in practice.

**Questions:** What external contract owns the expected value? Is the test checking behavior,
wiring, or a preference? Which properties must remain stable when the value changes?

**Counterexamples:** Compatibility, accessibility, safety, regulation, and public protocols can fix
exact values.

**Possible responses:** Test stable properties and externally owned requirements, verify
configuration propagation separately, and leave subjective calibration to its actual evaluation
process.

## Adjustable Values Are Copied into Narrative

**Smell:** A manually tuned default or operational threshold is repeated as a literal in durable
documentation, help text, plans, examples, or comments that do not own the value.

**Signals:**

- Changing one configuration literal requires searching prose for matching numbers.
- Documentation describes an adjustable default as though it were a behavioral invariant.
- Runtime output and written guidance disagree after an otherwise valid calibration change.
- Several non-executable surfaces claim to be the source of truth for one mutable choice.

**Possible failure:** Users tune the wrong control, reviewers “correct” a valid runtime value back
to stale prose, or operational decisions rely on documentation that no longer describes the
running system.

**Questions:** Does the exact value need to be durable, or only its meaning and valid range? Which
artifact owns calibration? Can another surface link to, generate from, or validate against that
owner?

**Counterexamples:** Historical measurements, migration records, protocol constants, and externally
fixed compatibility values may need exact literals when their date and authority are explicit.

**Possible responses:** Keep behavior documentation value-independent, name the executable source
of truth, generate user-facing defaults where practical, or add a validation step when duplication
is unavoidable.

## A Valid Inactive State Enters a Strict Constructor

**Smell:** A disabled, empty, zero-signal, or otherwise valid no-work state is passed into a
constructor or resolver whose contract accepts only active inputs.

**Signals:**

- One mode gates an inactive input while a sibling mode calls the same strict resolver directly.
- Zero magnitude, an empty interval, or no selected work throws even though the feature can
  legitimately have nothing to produce.
- Callers catch construction errors to represent ordinary inactivity.
- The active constructor accumulates mode-specific fallback behavior to tolerate no-work inputs.

**Possible failure:** Normal lifecycle states become crashes, or broad exception handling hides
genuinely malformed inputs together with ordinary inactivity.

**Questions:** Is inactivity a valid domain state? Which boundary can distinguish it from malformed
input? Should the active value's type permit an inactive representation at all?

**Counterexamples:** A required resource or command may legitimately reject emptiness when the
caller contract guarantees active work.

**Possible responses:** Gate once before strict construction, model active/inactive as a sum type,
or provide a clearly named optional resolver while continuing to reject NaN, corruption, and other
invalid active inputs.

## Temporary Overrides Restore an Assumed Default

**Smell:** A test, diagnostic, benchmark, preview, or scoped operation temporarily changes shared
state, then restores a hard-coded “normal” value instead of the value that was actually present.

**Signals:**

- Cleanup assigns a literal default after applying a temporary override.
- Restoration runs only on the successful path rather than in guaranteed cleanup.
- The helper assumes no caller, user, environment, or concurrent owner customized the state first.
- Changing an adjustable default requires changing diagnostic cleanup code.

**Possible failure:** The observing tool leaves production state changed after failure, clobbers a
caller's valid customization, or makes later measurements and tests depend on execution order.

**Questions:** Who owns the state being overridden? Can the operation fail or be nested? Is the
original value readable and sufficient to restore the complete state? Can another writer change it
while the override is active?

**Counterexamples:** A disposable isolated process may intentionally end instead of restoring
state, and a reset operation may explicitly promise to replace all state with a canonical baseline.

**Possible responses:** Capture the complete prior value, restore it from guaranteed cleanup such
as `finally` or an RAII guard, serialize competing writers where necessary, or run the experiment
against an isolated owner whose lifetime ends with the override.

## Fixture Setup Becomes a Shadow Framework

**Smell:** Test setup grows until its implicit behavior dominates the behavior under test.

**Signals:**

- Reviewers must understand large builders or fixtures to know what one test establishes.
- Many tests rebuild the same graph with small variations.
- Helpers silently establish unrelated invariants or defaults.
- Production changes are buried beneath much larger fixture churn.

**Possible failure:** Tests become brittle, misleading, and difficult to audit. One fixture defect
can make a large suite agree on the wrong behavior.

**Questions:** Which setup facts matter to the assertion? Are they visible at the call site? Does
the fixture have more policy than the production interface?

**Counterexamples:** Large end-to-end scenarios may require substantial setup; the concern is hidden
policy, not line count alone.

**Possible responses:** Keep focused fixtures near their owner, separate large scenarios, and
extract only builders whose names and parameters reveal their relevant invariants.

## Old Concepts Survive a Structural Change

**Smell:** A mechanism is removed or renamed while its terminology, dead branches, configuration,
telemetry, tests, comments, or documentation survive.

**Signals:**

- Searches find old and new names for one concept.
- Comments describe a superseded architecture despite compiling code.
- Configuration and metrics imply behavior that no longer exists.
- Compatibility shims have no remaining caller or removal condition.

**Possible failure:** Future work follows an architecture that no longer exists, while search-based
audits and operational interpretation become unreliable.

**Questions:** Which surfaces still expose the old concept? Is compatibility required? If so, who
owns its removal condition?

**Counterexamples:** Staged migrations may deliberately retain old vocabulary and adapters for a
defined compatibility window.

**Possible responses:** Sweep code, tests, configuration, telemetry, labels, and active
documentation as part of the change, or document the migration boundary and removal trigger.

## An Auxiliary Index Outlives the Data It Indexes

**Smell:** A cache, interner, registry, reverse lookup, or side table has a stronger or longer
retention policy than the primary data it accelerates.

**Signals:**

- Weakly keyed or explicitly evictable primary records are also referenced by a strong auxiliary
  map.
- Primary eviction removes operational state but leaves compatibility keys, prepared values, or
  resource handles in a process-lifetime index.
- The auxiliary structure is cleared only by a global reset that ordinary workload churn need not
  trigger.

**Possible failure:** Traversing an unbounded sequence of otherwise evictable data grows memory,
retains retired resources, or lets stale auxiliary state influence newly created owners.

**Questions:** Which object actually determines lifetime? Does every primary eviction retire its
auxiliary entries? Can the index retain payloads or resources, rather than cheap value-only keys?
Is its domain genuinely bounded for the process lifetime?

**Counterexamples:** A process-lifetime index over a proven finite value domain can intentionally
outlive individual users, especially when its entries contain no externally owned payloads.

**Possible responses:** Tie the index to the same owner and invalidation generation, use weak keys,
store non-retaining value keys, remove entries on eviction, or bound the index with a measured
policy.

## Reusable Storage Retains Retired Payloads

**Smell:** A pool or high-water scratch structure preserves references to inactive payloads after
their reusable shell is no longer part of the current result.

**Signals:**

- Logical length shrinks while backing records beyond that length still reference scene objects,
  requests, buffers, or resources.
- Disabling a subsystem releases external resources but leaves its last submitted workload in
  reusable arrays or maps.
- Pool entries clear scalar counters but not object-valued fields or nested collections.

**Possible failure:** Short-lived workload spikes pin large object graphs for the process lifetime,
making a bounded allocation optimization behave like a memory leak.

**Questions:** Which retained fields point outside the pool? When workload shrinks or the subsystem
turns off, what severs those references? Is retaining payload identity necessary to reuse the shell?

**Counterexamples:** Retaining payloads is harmless when the pool and payload have the same explicit
lifetime, or when measurement proves the complete retained graph is small and intentionally bounded.

**Possible responses:** Clear retired object-valued fields, retain only payload-free shells, release
active prefixes on disable, truncate cold pools, or add a measured high-water shrink policy.

## Normalization and Matching Use Different Vocabularies

**Smell:** Input is normalized before branching, but one or more branches still match the source
representation rather than the normalized representation.

**Signals:**

- A value is lowercased, canonicalized, decoded, or stripped before a switch whose cases include
  pre-normalization spellings.
- Tests cover common normalized values but omit case-sensitive modifiers, sentinels, or aliases.
- A refactor adds normalization without deleting the older comparison vocabulary.

**Possible failure:** Valid input silently falls through to an unknown or default branch, often only
for one modifier, locale, legacy spelling, or edge-case representation.

**Questions:** What is the exact domain after normalization? Can every branch value occur in that
domain? Is normalization owned once at the boundary and tested there?

**Counterexamples:** A branch may intentionally compare both raw and normalized values when both are
retained as distinct, clearly named inputs.

**Possible responses:** Normalize once into a canonical type, match only that vocabulary, and test
representative values whose source and canonical spellings differ.

## Required Behavior Is Optionalized for Incidental Consumers

**Smell:** A capability required by the production path is declared optional so tests, fixtures, or
partial adapters do not need to implement it.

**Signals:**

- Production calls use optional chaining for behavior whose absence makes the feature silently fail.
- Every real implementation provides a method, while only lightweight consumers rely on omission.
- Interface optionality describes implementation convenience rather than a supported runtime mode.

**Possible failure:** A new production adapter type-checks while omitting required behavior, turning
an integration error into a silent no-op.

**Questions:** Is absence a supported product state with defined semantics? Which production
consumer intentionally omits the capability? Was optionality introduced only to reduce fixture
churn?

**Counterexamples:** Diagnostics, progressive enhancement, and genuinely capability-negotiated
adapters may intentionally expose optional operations.

**Possible responses:** Make production behavior required, split genuinely narrower interfaces, or
provide an explicit adapter whose no-op semantics are named and supported.

## Representation Bridging Allocates in a Hot Loop

**Smell:** A high-frequency consumer repeatedly allocates a wrapper or converted representation for
an unchanged retained value.

**Signals:**

- Frame, audio, simulation, or input loops construct short-lived vectors, arrays, records, or class
  wrappers solely to satisfy a neighboring API.
- The source contract already has the required components but the consumer API demands another
  shape.
- Allocation repeats per view, pass, entity, or sample even though conversion has no semantic work.

**Possible failure:** Small bridging allocations multiply with cadence and fan-out, adding garbage
collection pressure while obscuring which representation the boundary actually owns.

**Questions:** Can the consumer accept the existing lossless representation? Is mutation or identity
part of the destination contract? Does the converted value change at the loop's cadence?

**Counterexamples:** Allocation can be appropriate for ownership isolation, infrequent cold paths,
or conversions whose result is itself retained.

**Possible responses:** Align adjacent contract shapes, accept structural read-only input, retain a
scratch value, or compute the conversion once at the producer that owns the change.

## Preflight Repeats the Real Traversal

**Smell:** A collection is scanned to count, classify, or decide whether work is needed, then scanned
again immediately to perform the work using the same admission predicate.

**Signals:**

- The same filter or guard appears in a preflight loop and the following execution loop.
- A boolean such as `hasEligibleItems` or a retained-item count is computed before processing even
  though execution could produce it.
- Cost grows with the same collection twice on a hot or high-volume path.
- The preflight and execution predicates can evolve independently.

**Possible failure:** Common-path work is duplicated, and later edits can make the decision disagree
with the items actually processed. A gate may admit work that produces nothing or suppress work that
would have produced output.

**Questions:** Does execution naturally know the count or eligibility result? Must a decision happen
before any item can be processed? Does processing have effects that make a speculative traversal
necessary?

**Counterexamples:** Preflight may be required to reserve exact storage, make an atomic all-or-none
decision, choose an algorithm, or avoid effects that cannot be rolled back.

**Possible responses:** Accumulate the summary during execution, return processing facts with the
result, or retain preflight only where its earlier decision has a concrete consumer.

## Reversible Policy Is Lost During Preparation

**Smell:** Loading, baking, batching, or compilation discards a semantic distinction that a later
runtime policy is expected to switch without rebuilding the prepared data.

**Signals:**

- A toggle requires reloading source assets or rebuilding geometry despite changing only admission
  or presentation.
- Prepared batches merge items that differ under a supported runtime policy.
- Consumers try to recover a discarded distinction from asset names, geometry, materials, or other
  incidental properties.
- One mode filters source data early while another mode needs the same loaded content intact.

**Possible failure:** Runtime changes become expensive or impossible, prepared batches leak excluded
items, and downstream consumers invent inconsistent heuristics to reconstruct lost intent.

**Questions:** At which stage is the distinction last authoritative? Is the later choice genuinely
reversible? Must the distinction participate in batch compatibility, or is object-level admission
sufficient?

**Counterexamples:** Early removal is appropriate when policy is immutable for the prepared
artifact's lifetime and rebuilding is the explicit ownership contract, especially when retaining
excluded data has material cost.

**Possible responses:** Preserve the smallest semantic discriminator through preparation, include it
in compatibility keys where unlike values must not merge, and apply reversible policy at the latest
shared admission boundary.

## Relay Components Become Wiring Buses

**Smell:** A component, controller, or service receives a broad set of values and callbacks primarily
to forward each one unchanged to one of several descendants.

**Signals:**

- Adding one leaf control requires edits at several intermediate layers with no new behavior there.
- Large parameter or prop lists contain many adjacent value/update pairs owned elsewhere.
- Intermediate code destructures and republishes fields without interpreting them.
- Related fields can be accidentally omitted or paired with the wrong callback during forwarding.

**Possible failure:** Routine changes create wide, low-value churn; wiring mistakes compile when
types are structurally similar; and the relay's apparent API obscures which descendant owns each
operation.

**Questions:** Does the intermediate layer enforce policy, adapt the contract, or coordinate the
children? Which fields form a coherent capability? Would grouping them expose too much authority to
the leaf?

**Counterexamples:** Explicit forwarding can be clearest for a small stable surface, and a relay may
intentionally be the composition boundary that makes dependencies visible and testable.

**Possible responses:** Pass focused capability objects, colocate state with the owning leaf, split
the relay by responsibility, or retain explicit wiring until a demonstrated cohesive boundary
emerges.

## Unrelated Work Shares One Ordering Lane

**Smell:** Operations with different correctness dependencies are placed behind one FIFO, promise
chain, lock, actor mailbox, or single-consumer queue merely because they enter through the same
component.

**Signals:**

- Fast state acceptance waits for unrelated resource loading, I/O, retries, or presentation work.
- One slow item delays later operations that neither read its result nor require its effects.
- A neighboring consumer bypasses the lane and therefore observes newer state than queued peers.
- Removing the queue raises no concrete ordering requirement between most item kinds.

**Possible failure:** Head-of-line blocking makes independent state diverge temporarily, turns
variable background latency into visible stalls, and encourages stale work to execute in a burst
after the blockage clears.

**Questions:** Which exact operation pairs require order? Does the lane protect accepted state,
effect completion, or both? Can slow completion be generation-guarded while acceptance remains
immediate?

**Counterexamples:** A transaction log, protocol sequence, rate-limited device, or destructive
resource lifecycle may genuinely require every operation to share one total order.

**Possible responses:** Separate acceptance from completion, retain ordering only for dependent
operations, use per-key lanes, or guard asynchronous publication by identity/generation rather than
serializing unrelated work.

## Acceptance Is Hidden in an Async Prefix

**Smell:** Correctness depends on an asynchronous function mutating accepted state before its first
`await`, while its type exposes only one eventual completion promise.

**Signals:**

- Callers intentionally invoke a promise-returning operation without awaiting it before dispatching
  later state.
- Moving or adding the first `await` would silently change ordering despite preserving the function's
  type.
- Comments or tests must explain that invocation means acceptance while resolution means effect
  completion.
- Rejection, cancellation, or teardown semantics differ between the synchronous prefix and the
  asynchronous suffix.

**Possible failure:** An innocent refactor delays acceptance, reintroduces races or starvation, or
causes callers to mistake completion for the only observable state transition.

**Questions:** Is immediate acceptance a public contract or only an implementation coincidence? Is
the language's run-to-first-suspension behavior stable for every implementation? Do callers need
separate acceptance and completion facts?

**Counterexamples:** A small, closed implementation may deliberately use the language guarantee
when the contract is prominently documented and a focused test fails if suspension moves ahead of
acceptance.

**Possible responses:** Return a completion handle from a synchronous acceptance method, split
acceptance and realization into named operations, model both phases in the return type, or retain the
compact API with explicit contract documentation and ordering tests.

## Elapsed Time Stands In for Observable Readiness

**Smell:** A test, harness, or coordinator waits a fixed duration and assumes an asynchronous state
transition or resource effect has completed when the timer expires.

**Signals:**

- A delay immediately follows a setting change, request, or lifecycle command.
- Correctness varies with machine speed, workload size, scheduling, or rendering backend.
- The accepted setting is observable before the subsystem that consumes it has completed a cycle.
- Increasing the delay appears to fix the failure without proving which condition became true.

**Possible failure:** Fast runs waste time, slow runs capture an intermediate state, and load or
architecture changes turn deterministic checks into intermittent failures.

**Questions:** What exact fact proves completion? Which layer owns that fact? Can the caller poll an
existing diagnostic, await a generation change, or receive an explicit completion signal?

**Counterexamples:** A deliberate soak interval, animation sample, debounce contract, or performance
window measures elapsed time itself rather than using time as a proxy for readiness.

**Possible responses:** Wait for an observable state predicate with a bounded timeout, expose a
generation or completion handle, or make synchronous lifecycle effects complete before the command
returns when their cost and ownership permit it.

## Cleanup Exists Only on the Success Path

**Smell:** A test, command, request handler, or scoped operation releases resources only after all
ordinary work and assertions succeed.

**Signals:**

- Teardown appears at the end of a test instead of in `finally` or an owner-managed fixture.
- A deferred promise, lock, temporary file, renderer, worker, or connection remains live when an
  intermediate assertion throws.
- One test failure causes later hangs, port conflicts, open-handle warnings, or misleading secondary
  failures.
- Cleanup is duplicated across success branches but absent from rejection paths.

**Possible failure:** The original defect is masked by leaked state or a hung suite, and later work
observes resources or authority left behind by an operation that already failed.

**Questions:** What must be released after partial construction? Can cleanup itself fail? Does the
owner need to aggregate the primary and cleanup failures without losing either?

**Counterexamples:** Pure value tests and operations whose complete state is transactionally owned by
an external runner may have nothing local to release.

**Possible responses:** Establish cleanup immediately after acquisition with `try`/`finally`, use a
fixture that owns disposal, make teardown idempotent, and aggregate cleanup failures where dropping
the primary failure would be misleading.

## State Preserves a Control-Flow-Impossible Outcome

**Smell:** A flag, enum variant, or optional value records an outcome that every path reaching its
consumer has already made impossible.

**Signals:**

- A value is initialized defensively and assigned the same result on every loop iteration or branch
  that can reach its later test.
- Early returns remove all paths for one state, but downstream code still handles that state.
- Tests cannot produce one branch without bypassing the function's real control flow.
- Comments describe the impossible arm as a fallback despite no supported input reaching it.

**Possible failure:** Readers and future changes preserve a fictitious failure mode, real omissions
hide among dead handling, and added branches may accidentally give the stale state new semantics.

**Questions:** Which concrete path reaches each state? Does the state carry information not already
proved by loop completion, an early return, or a discriminated result? Can control flow return the
real outcomes directly?

**Counterexamples:** A value may intentionally mirror externally observable state for diagnostics,
serialization, or model checking even when one local caller currently narrows it further.

**Possible responses:** Delete the redundant state and return from the decisive branch, encode the
remaining outcomes in a smaller discriminated type, or move the distinction to the boundary where
both outcomes can actually occur.

## Coordinate Spaces Are Compared Implicitly

**Smell:** Geometry from different coordinate systems, units, scales, or origins is compared as if
the values shared one basis.

**Signals:**

- Pointer coordinates in CSS pixels are tested against a canvas backing store, framebuffer, image,
  or device-pixel grid without an explicit conversion.
- Local, world, viewport, screen, or transformed coordinates share bare numeric types and names.
- Correctness depends on two independently sized surfaces currently having nearly equal dimensions.
- Scaling, zoom, device-pixel ratio, scrolling, or a layout transform changes only one side of a
  geometry calculation.

**Possible failure:** Hit testing, selection, overlays, and spatial effects drift or fail only under
particular display scales, layouts, transforms, or devices.

**Questions:** What space owns each value? Where are origin, axis direction, scale, and units
converted? Does the conversion use one coherent geometry snapshot?

**Counterexamples:** Direct comparison is correct when an owning boundary proves both values use the
same coordinate contract and preserves that invariant across resizing and transformation.

**Possible responses:** Name coordinate spaces in types and fields, convert once at the interaction
boundary, derive scale from the two current extents, or expose a single projection/unprojection
operation owned by the renderer.

## Derived Interaction State Outlives Its Inputs

**Smell:** Hover, focus, selection, snapping, or another derived interaction result updates only on
input events even though the underlying targets can change independently.

**Signals:**

- A tooltip is recomputed on pointer movement but not when its target moves, disappears, or changes
  identity.
- Cached hit targets are replaced without reconciling the active hover or selection.
- Animated, streamed, virtualized, or presentation-rate content can change beneath a stationary
  pointer.
- Interaction state stores a derived label or object without the source identity or invalidation
  path needed to confirm it remains valid.

**Possible failure:** The interface presents stale identity or actions for an object no longer under
the pointer, and the error persists until unrelated user input forces recomputation.

**Questions:** Which inputs determine the interaction result? Which of them can change without a new
input event? Who owns invalidation when targets are replaced or removed?

**Counterexamples:** Event-only recomputation is sufficient when targets and geometry are immutable
for the entire interaction or when stale output is deliberately frozen by capture semantics.

**Possible responses:** Reconcile derived interaction state whenever either input side changes,
retain the pointer query and rerun it against new targets, or represent explicit capture whose
lifetime ends on a named event.

## Sibling Outputs Disagree on Eligibility

**Smell:** One logical producer drives several observable outputs, but each output independently
decides whether the producer is currently eligible.

**Signals:**

- Rendering, audio, notifications, persistence, telemetry, or other sibling consumers repeat
  similar visibility, authorization, lifecycle, or context gates.
- Disabling or hiding a feature removes one output while another remains active.
- A producer continues advancing because one output may still need its state, leaving every other
  consumer responsible for suppressing its own effects.
- Tests verify each output in isolation but never assert that their admission decisions agree.

**Possible failure:** Users observe contradictory state, such as invisible effects that remain
audible, hidden operations that still notify, or unauthorized work that is omitted from one surface
but persists through another.

**Questions:** Which layer owns eligibility? Must every output share one decision, or do some have
legitimate exceptions? Does an output need the producer stopped, its new effects rejected, its
existing effects withdrawn, or some combination of those?

**Counterexamples:** Outputs may intentionally use different admission policies when their
semantics differ—for example, an accessibility channel can remain active when a visual channel is
hidden—but the distinction should be explicit and independently named.

**Possible responses:** Compute shared eligibility once and carry it to sibling consumers, or name
and test each genuinely distinct policy. For effects that outlive dispatch, preserve a live
eligibility input or explicit cancellation path so a later policy change reaches existing work as
well as future emissions.

## A Lossy Classifier Governs an Orthogonal Policy

**Smell:** A mutually exclusive class created for one decision is reused as a proxy for an
independent capability, eligibility rule, or behavior.

**Signals:**

- A display, reporting, storage, or routing class appears in authorization, physics, lifecycle, or
  other unrelated control flow.
- One catch-all class becomes shorthand for a positive capability such as selectable, mutable, or
  executable.
- Adding or splitting a class requires unrelated behavioral code to preserve old outcomes.
- Entities can possess several relevant traits, but the reused classifier forces exactly one to
  win by precedence.

**Possible failure:** A cosmetic or organizational taxonomy change silently enables or disables
behavior. Overlapping traits are discarded, and the catch-all class accumulates meanings that
cannot be stated or tested independently.

**Questions:** What decision originally owns the classifier? Does the second policy truly share the
same partition and precedence? Which inputs differ between the two decisions? Can a new class alter
behavior without any underlying capability changing?

**Counterexamples:** A domain state machine or protocol discriminant may legitimately govern many
consequences when those consequences are defined by that exact state and the representation is
lossless for them.

**Possible responses:** Give the orthogonal policy its own predicate or capability fact, derive
each decision independently from authoritative traits, or replace the lossy partition with a
composite representation when consumers genuinely need overlapping facts.

## Configuration Describes Only Its Current Value

**Smell:** A configuration, policy, fixture, or declarative object has no independent complete
contract; its accepted shape is inferred from the value currently present or weakened to a partial
shape for editing convenience.

**Signals:**

- The authoritative type is `typeof` the configured object, so it cannot guide completion while
  that object is being authored.
- Missing required fields receive no editor suggestions until a distant consumer reports an error.
- `Partial`, a recursive optional mapping, an index signature, or a broad record is introduced so
  incomplete literals type-check during editing.
- Misspelled or omitted fields survive because every key is optional or because only consumers are
  typed.
- A separate schema exists, but it restates domain-owned subcontracts instead of reusing them and
  can drift independently.

**Possible failure:** Configuration becomes valid only by convention. New required fields are
silently omitted, typos become inert knobs, editor assistance disappears at the point of change,
or a duplicated schema and runtime contract accept different shapes.

**Questions:** Which fields are genuinely optional product semantics, and which are merely awkward
to enter? Does an independent contract exist before the value? Can it reuse the types owned by
runtime consumers? Must literals retain narrow types after completeness is checked?

**Counterexamples:** Open-ended property bags, sparse patches, negotiated capabilities, and formats
whose omission semantics are intrinsic may legitimately be partial or index-based. Data inferred
from an external schema can also have a single source of truth without a handwritten contract.

**Possible responses:** Define a complete authoring contract independently of the value, reuse
domain-owned component types, check the literal with a non-widening conformance mechanism, and use
a narrowly named override or patch contract only where omission has explicit semantics.

## A Bit Pattern Pretends to Be a Semantic Range

**Smell:** A mask, prefix, modulo, truncation, or other compact bit test is used as though it exactly
described a domain-owned numeric range or identifier class.

**Signals:**

- A prefix comparison admits reserved endpoints or holes excluded by the authoritative range.
- Classification code uses bit layout folklore while a protocol, schema, or source system defines
  explicit minimum and maximum values.
- Tests cover ordinary members of each class but omit boundary, sentinel, and adjacent values.
- A helper named for domain meaning implements only a convenient representation approximation.

**Possible failure:** Reserved, malformed, or future identifiers acquire valid-looking semantics and
flow into authorization, routing, presentation, ownership, or persistence as members of the wrong
class.

**Questions:** Is the class formally prefix-defined or merely stored near values with that prefix?
Are endpoints, gaps, and sentinels part of the class? Which source owns the partition?

**Counterexamples:** A bit test is exact when the external contract defines membership by those bits
and reserves every matching value for that class.

**Possible responses:** Encode the authoritative inclusive ranges or discriminant rules in one
owner, test members plus adjacent and reserved values, and name representation-level prefix helpers
differently from semantic classifiers when both are useful.

## An Auxiliary Subset Masquerades as the Canonical Collection

**Smell:** A subset built for traversal, acceleration, partitioning, caching, or another local
purpose is treated as the authoritative inventory for an independent operation.

**Signals:**

- Membership in a spatial index, tree node, cache, manifest, or work queue is used to filter the
  source collection without an explicit completeness guarantee.
- A structural field is renamed to behavioral language such as visible, valid, supported, or
  renderable even though its producer establishes only membership.
- Records absent from the auxiliary structure remain valid in the primary collection.
- Sparse or partial auxiliary data silently removes output instead of reporting a violated
  invariant.

**Possible failure:** Valid records disappear from rendering, serialization, search, processing, or
publication according to incidental index coverage. The failure follows data layout rather than
the operation's real eligibility rules, so it often appears as irregular holes or missing cases.

**Questions:** What operation owns the subset? Does its format guarantee exhaustive membership for
the consuming operation? Can the primary collection contain valid records absent from it? How does
the authoritative implementation enumerate the operation's inputs?

**Counterexamples:** An index may be the canonical inventory when its contract explicitly defines
complete membership, or when construction validates equality with the primary collection before
consumers rely on it.

**Possible responses:** Enumerate the authoritative collection directly, keep auxiliary membership
scoped to the operation it serves, name raw structural facts without inferred behavior, and add a
regression where valid primary records are absent from the subset.

## Correctness Depends on Ambient Mutable State

**Smell:** An operation establishes only part of the state its result requires and silently relies
on whatever a previous, unrelated operation left behind.

**Signals:**

- Reordering callers, enabling another feature, or adding an otherwise valid predecessor changes
  the operation's result.
- Code binds a resource but omits its associated mode, policy, transaction, locale, permissions,
  namespace, or other interpretation state.
- A subsystem works in isolation or in one environment but fails after a different code path runs.
- Cleanup resets shared state, but the next consumer still assumes that reset occurred rather than
  declaring its own prerequisites.

**Possible failure:** Valid local changes expose distant failures through execution order. Results
become scene-, request-, test-, thread-, or environment-dependent even though the operation's
inputs appear unchanged.

**Questions:** What complete state determines the result? Which component owns each part? Can any
predecessor legally leave a different value? Is inherited state an intentional protocol or merely
an optimization assumption?

**Counterexamples:** Explicitly stateful protocols may define inheritance as part of their public
contract, especially inside a single tightly owned command sequence. The dependency should still
be named and bounded by that owner.

**Possible responses:** Bind or pass every required state at the operation boundary, bundle
interdependent resource and policy values into one contract, or centralize transitions in a state
owner that can prove the required predecessor state.

## A State Mirror Tracks Logical Paths Instead of Physical Aliases

**Smell:** A cache or state applicator models several API paths independently even though those
paths mutate one shared physical slot, resource, or piece of ambient state.

**Signals:**

- Separate maps cache bindings by resource kind while another property, such as a sampler, mode,
  lock, namespace, or active selector, is shared across those kinds.
- One path changes shared state without updating or invalidating the sibling path's cached value.
- A repeated logical binding is skipped after an intervening operation reached the same physical
  state through a different API.
- Tests transition between categories only on different slots, so they never exercise aliasing.

**Possible failure:** The cache suppresses a required mutation and leaves the physical system in a
state that disagrees with its mirror. Correctness then depends on reserved slots or current call
ordering rather than the applicator's stated contract.

**Questions:** Which logical operations alias the same physical state? Does every mutation update
all cached views of that state? Can a sibling operation change a value while leaving the primary
resource identity unchanged?

**Counterexamples:** Independent caches are sound when the underlying API guarantees disjoint
state, or when a stronger owner proves the logical paths can never share a slot and the API encodes
that separation.

**Possible responses:** Model the shared physical state once, invalidate every alias on mutation,
encode disjoint slot domains in the type/API, and test same-slot transitions across logical paths.

## Registrations Outlive Their Owner

**Smell:** An operation registers callbacks with a longer-lived object, but cleanup exists only on
the operation's expected completion path rather than on disposal of the owner that initiated it.

**Signals:**

- A component or request installs listeners on a window, document, process, bus, timer, observer,
  or shared service without retaining a cancellation handle.
- Cleanup depends on a success, release, response, or other terminal event that may never arrive.
- Replacing an in-progress operation starts another registration without cancelling the first.
- The callback closes over state whose owner can unmount, disconnect, time out, or be superseded.

**Possible failure:** Retired callbacks mutate stale state, duplicate later work, retain resources,
or act on a replacement owner. The defect often appears only when disposal interrupts an operation,
so normal completion tests do not expose it.

**Questions:** Which lifetime owns the registration? Can that owner disappear before the normal
terminal event? Are cancellation and completion both idempotent? Does starting a replacement
operation first retire the previous one?

**Counterexamples:** A process-lifetime singleton may intentionally retain a process-lifetime
registration, and a target proven to have the same or shorter lifetime than its owner needs no
separate owner cleanup.

**Possible responses:** Return and retain an idempotent disposer, bind registration to an abort
signal, cancel the previous operation before replacement, and invoke cancellation from owner
teardown as well as normal completion.

## Adding Observations

An observation belongs here when it has:

- a domain-independent shape;
- concrete signals a reviewer can look for;
- a plausible failure beyond formatting or taste;
- questions that distinguish the smell from legitimate designs; and
- responses expressed as options rather than mandatory patterns.

Do not reorganize the worksheet into a scored or comprehensive rubric until enough observations
exist to justify coverage, grouping, severity, and evaluation rules with evidence.
