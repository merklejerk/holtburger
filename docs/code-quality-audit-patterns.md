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

## Adding Observations

An observation belongs here when it has:

- a domain-independent shape;
- concrete signals a reviewer can look for;
- a plausible failure beyond formatting or taste;
- questions that distinguish the smell from legitimate designs; and
- responses expressed as options rather than mandatory patterns.

Do not reorganize the worksheet into a scored or comprehensive rubric until enough observations
exist to justify coverage, grouping, severity, and evaluation rules with evidence.
