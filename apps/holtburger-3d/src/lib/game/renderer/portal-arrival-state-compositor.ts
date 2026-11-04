import {
	createPortalModelFootprint,
	portalModelFootprintContains,
	portalModelFootprintHas,
	portalModelPixel,
	validatePortalModelScene,
	type PortalModelCrossing,
	type PortalModelCrossingId,
	type PortalModelDepth,
	type PortalModelFragment,
	type PortalModelPixel,
	type PortalModelScene,
	type PortalModelScopeId,
	portalEntryAdvanceAdmitted,
} from "./portal-model";
import type {
	PortalReferenceFragment,
	PortalReferencePixelResult,
} from "./portal-reference-compositor";
import type { PortalScopeVisibilityEnvelope } from "./portal-visibility-envelope";

/** Root or directed-crossing identity that completely determines one scope entry plane. */
type PortalArrivalStateId = "portal-arrival:root" | PortalModelCrossingId;

/** One path-quotiented visibility state; coverage retains no crossing ancestry. */
interface PortalArrivalState {
	readonly coverage: ReturnType<typeof createPortalModelFootprint>;
	/** Null for the root and for pixels outside this state's coverage. */
	readonly entryDepthByPixel: readonly (PortalModelDepth | null)[];
	/** Null on covered pixels whose scope segment has no admitted child portal. */
	readonly exitDepthByPixel: readonly (PortalModelDepth | null)[];
	readonly id: PortalArrivalStateId;
	readonly incomingCrossingId: PortalModelCrossingId | null;
	readonly scopeId: PortalModelScopeId;
}

/** Exact unweighted work performed by the finite arrival-state proof executor. */
interface PortalArrivalStateDiagnostics {
	/** Root plus directed-crossing states that received at least one pixel. */
	readonly arrivalStateCount: number;
	/** First admissions of a pixel into an arrival state. */
	readonly arrivalStatePixelAdmissionCount: number;
	/** Physical deferred fragments inspected once during final composition. */
	readonly deferredFragmentTestCount: number;
	/** Attempts to merge a transitioned pixel into its directed-crossing state. */
	readonly maskUnionCount: number;
	/** Physical opaque or alpha-tested fragments inspected once during final composition. */
	readonly opaqueFragmentTestCount: number;
	/** Unique physical opaque/alpha-test compatibility batches selected by visibility. */
	readonly physicalOpaqueBatchCount: number;
	/** Unique compatible physical particle batches selected by visibility. */
	readonly physicalParticleBatchCount: number;
	/** Covered state pixels reduced into authored-scope envelopes. */
	readonly scopeEnvelopePixelReductionCount: number;
	/** State pixels whose deterministic local ray transition was evaluated. */
	readonly statePixelVisitCount: number;
	/** Outgoing physical crossings checked while selecting the next portal plane. */
	readonly transitionCrossingTestCount: number;
}

/** Correct finite frame produced without path records, labels, targets, or renderer callbacks. */
export interface PortalArrivalStateFrame {
	readonly diagnostics: PortalArrivalStateDiagnostics;
	readonly envelopes: readonly PortalScopeVisibilityEnvelope[];
	readonly family: "arrival-state-masks";
	readonly pixels: readonly PortalReferencePixelResult[];
	readonly states: readonly PortalArrivalState[];
}

/** One conservative path-free scope window used only for resource culling and atlas bounds. */
interface PortalConservativeScopeCoverage {
	readonly coverage: ReturnType<typeof createPortalModelFootprint>;
	readonly scopeId: PortalModelScopeId;
}

/** Exact finite work performed by monotone scope-union culling. */
interface PortalConservativeScopeCullingDiagnostics {
	/** First admissions of a pixel into an authored scope. */
	readonly admittedScopePixelCount: number;
	/** Scope pixels whose outgoing physical crossings were scanned once. */
	readonly scopePixelVisitCount: number;
	/** Outgoing crossing aperture samples checked without path or entry-depth state. */
	readonly transitionCrossingTestCount: number;
}

/** Path-free scope-union culling result; correctness only requires conservative coverage. */
export interface PortalConservativeScopeCullingFrame {
	readonly coverages: readonly PortalConservativeScopeCoverage[];
	readonly diagnostics: PortalConservativeScopeCullingDiagnostics;
}

interface ArrivalIndex {
	readonly crossingsBySourceScope: ReadonlyMap<
		PortalModelScopeId,
		readonly PortalModelCrossing[]
	>;
	readonly fragments: readonly PortalModelFragment[];
	readonly fragmentsByScopePixel: ReadonlyMap<
		PortalModelScopeId,
		ReadonlyMap<PortalModelPixel, readonly PortalModelFragment[]>
	>;
}

interface MutableArrivalState {
	readonly covered: boolean[];
	readonly entryDepthByPixel: (PortalModelDepth | null)[];
	readonly exitDepthByPixel: (PortalModelDepth | null)[];
	readonly id: PortalArrivalStateId;
	readonly incomingCrossing: PortalModelCrossing | null;
	readonly minimumPathDepthByPixel: (number | null)[];
	readonly processedPathDepthByPixel: (number | null)[];
	readonly scopeId: PortalModelScopeId;
}

interface MutableDiagnostics {
	arrivalStatePixelAdmissionCount: number;
	deferredFragmentTestCount: number;
	maskUnionCount: number;
	opaqueFragmentTestCount: number;
	physicalOpaqueBatchCount: number;
	physicalParticleBatchCount: number;
	scopeEnvelopePixelReductionCount: number;
	statePixelVisitCount: number;
	transitionCrossingTestCount: number;
}

interface PendingStatePixel {
	readonly pathDepth: number;
	readonly pixel: PortalModelPixel;
	readonly stateId: PortalArrivalStateId;
}

/** Execute the complete finite arrival-state fixed point. */
export function executePortalArrivalStateCompositor(
	scene: PortalModelScene,
): PortalArrivalStateFrame {
	return executePortalArrivalStateCompositorWithDepth(scene, null);
}

/** Execute through one deepest complete crossing frontier. */
export function executePortalArrivalStateCompositorThroughPathDepth(
	scene: PortalModelScene,
	maximumPathDepth: number,
): PortalArrivalStateFrame {
	if (!Number.isInteger(maximumPathDepth) || maximumPathDepth < 0) {
		throw new Error(
			"Portal arrival-state path-depth limit must be a non-negative integer.",
		);
	}
	return executePortalArrivalStateCompositorWithDepth(scene, maximumPathDepth);
}

/**
 * Union portal coverage by authored scope without interpreting opaque or entry-depth semantics.
 *
 * This intentionally overselects. It is suitable for resource resolution and atlas allocation
 * because every exact arrival transition is also one of these aperture intersections.
 */
export function cullPortalScopesConservatively(
	scene: PortalModelScene,
): PortalConservativeScopeCullingFrame {
	validatePortalModelScene(scene);
	const index = indexScene(scene);
	const coveredByScope = new Map<PortalModelScopeId, boolean[]>();
	const pending: {
		readonly pixel: PortalModelPixel;
		readonly scopeId: PortalModelScopeId;
	}[] = [];
	let admittedScopePixelCount = 0;
	let scopePixelVisitCount = 0;
	let transitionCrossingTestCount = 0;
	const admit = (
		scopeId: PortalModelScopeId,
		pixel: PortalModelPixel,
	): void => {
		let covered = coveredByScope.get(scopeId);
		if (!covered) {
			covered = Array<boolean>(scene.pixelCount).fill(false);
			coveredByScope.set(scopeId, covered);
		}
		if (covered[pixel]) return;
		covered[pixel] = true;
		admittedScopePixelCount += 1;
		pending.push({ pixel, scopeId });
	};
	for (let pixelValue = 0; pixelValue < scene.pixelCount; pixelValue += 1) {
		admit(scene.rootScopeId, portalModelPixel(pixelValue, scene.pixelCount));
	}
	for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
		const { pixel, scopeId } = pending[pendingIndex]!;
		scopePixelVisitCount += 1;
		for (const crossing of index.crossingsBySourceScope.get(scopeId) ?? []) {
			transitionCrossingTestCount += 1;
			if (!portalModelFootprintHas(crossing.aperture.footprint, pixel))
				continue;
			admit(crossing.targetScopeId, pixel);
		}
	}
	return Object.freeze({
		coverages: Object.freeze(
			[...coveredByScope]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([scopeId, covered]) =>
					Object.freeze({
						coverage: createPortalModelFootprint(
							scene.pixelCount,
							covered.flatMap((value, pixel) => (value ? [pixel] : [])),
						),
						scopeId,
					}),
				),
		),
		diagnostics: Object.freeze({
			admittedScopePixelCount,
			scopePixelVisitCount,
			transitionCrossingTestCount,
		}),
	});
}

/** Report whether the culler contains every exact arrival-state pixel. */
export function portalCullingContainsArrivalStates(
	culling: PortalConservativeScopeCullingFrame,
	arrival: PortalArrivalStateFrame,
): boolean {
	const coverageByScope = new Map(
		culling.coverages.map(({ coverage, scopeId }) => [scopeId, coverage]),
	);
	return arrival.states.every((state) => {
		const coverage = coverageByScope.get(state.scopeId);
		return (
			coverage !== undefined &&
			portalModelFootprintContains(coverage, state.coverage)
		);
	});
}

function executePortalArrivalStateCompositorWithDepth(
	scene: PortalModelScene,
	maximumPathDepth: number | null,
): PortalArrivalStateFrame {
	validatePortalModelScene(scene);
	const index = indexScene(scene);
	const diagnostics = createDiagnostics();
	const stateById = new Map<PortalArrivalStateId, MutableArrivalState>();
	const pending: PendingStatePixel[] = [];
	const root = createMutableState(
		scene,
		"portal-arrival:root",
		scene.rootScopeId,
		null,
	);
	stateById.set(root.id, root);
	for (let pixelValue = 0; pixelValue < scene.pixelCount; pixelValue += 1) {
		admitStatePixel(
			root,
			portalModelPixel(pixelValue, scene.pixelCount),
			0,
			pending,
			diagnostics,
		);
	}

	for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
		const work = pending[pendingIndex]!;
		const state = stateById.get(work.stateId);
		if (!state) throw new Error(`Missing arrival state ${work.stateId}.`);
		if (state.minimumPathDepthByPixel[work.pixel] !== work.pathDepth) continue;
		const processedDepth = state.processedPathDepthByPixel[work.pixel];
		if (processedDepth !== null && processedDepth <= work.pathDepth) continue;
		state.processedPathDepthByPixel[work.pixel] = work.pathDepth;
		diagnostics.statePixelVisitCount += 1;
		processStatePixel(
			scene,
			index,
			stateById,
			state,
			work.pixel,
			work.pathDepth,
			maximumPathDepth,
			pending,
			diagnostics,
		);
	}

	const states = materializeStates(scene, stateById);
	const envelopes = createScopeEnvelopes(scene, states, diagnostics);
	const pixels = composePhysicalFragments(scene, index, envelopes, diagnostics);
	return Object.freeze({
		diagnostics: Object.freeze({
			arrivalStateCount: states.length,
			arrivalStatePixelAdmissionCount:
				diagnostics.arrivalStatePixelAdmissionCount,
			deferredFragmentTestCount: diagnostics.deferredFragmentTestCount,
			maskUnionCount: diagnostics.maskUnionCount,
			opaqueFragmentTestCount: diagnostics.opaqueFragmentTestCount,
			physicalOpaqueBatchCount: diagnostics.physicalOpaqueBatchCount,
			physicalParticleBatchCount: diagnostics.physicalParticleBatchCount,
			scopeEnvelopePixelReductionCount:
				diagnostics.scopeEnvelopePixelReductionCount,
			statePixelVisitCount: diagnostics.statePixelVisitCount,
			transitionCrossingTestCount: diagnostics.transitionCrossingTestCount,
		}),
		envelopes,
		family: "arrival-state-masks",
		pixels,
		states,
	});
}

function processStatePixel(
	scene: PortalModelScene,
	index: ArrivalIndex,
	stateById: Map<PortalArrivalStateId, MutableArrivalState>,
	state: MutableArrivalState,
	pixel: PortalModelPixel,
	pathDepth: number,
	maximumPathDepth: number | null,
	pending: PendingStatePixel[],
	diagnostics: MutableDiagnostics,
): void {
	const fragments =
		index.fragmentsByScopePixel.get(state.scopeId)?.get(pixel) ?? [];
	const nearestOpaque = fragments
		.filter(isPassingOpaque)
		.reduce<PortalModelFragment | null>(
			(nearest, fragment) =>
				nearest === null || fragment.depth < nearest.depth ? fragment : nearest,
			null,
		);
	const mayTraverse = maximumPathDepth === null || pathDepth < maximumPathDepth;
	const entryDepth = state.entryDepthByPixel[pixel];
	const reciprocalId = state.incomingCrossing?.reciprocalCrossingId ?? null;
	const nearestCrossing = mayTraverse
		? (
				index.crossingsBySourceScope.get(state.scopeId) ?? []
			).reduce<PortalModelCrossing | null>((nearest, crossing) => {
				diagnostics.transitionCrossingTestCount += 1;
				if (crossing.id === reciprocalId) return nearest;
				const depth = crossing.aperture.depthByPixel[pixel];
				if (
					depth === null ||
					!portalEntryAdvanceAdmitted(
						state.incomingCrossing,
						entryDepth,
						crossing,
						depth,
					)
				) {
					return nearest;
				}
				const nearestDepth =
					nearest === null ? null : nearest.aperture.depthByPixel[pixel];
				return nearestDepth === null || depth < nearestDepth
					? crossing
					: nearest;
			}, null)
		: null;
	const crossingDepth = nearestCrossing?.aperture.depthByPixel[pixel] ?? null;
	const opaqueWins =
		nearestOpaque !== null &&
		(crossingDepth === null || nearestOpaque.depth < crossingDepth);
	if (opaqueWins || nearestCrossing === null || crossingDepth === null) {
		state.exitDepthByPixel[pixel] = null;
		return;
	}
	state.exitDepthByPixel[pixel] = crossingDepth;
	diagnostics.maskUnionCount += 1;
	let target = stateById.get(nearestCrossing.id);
	if (!target) {
		target = createMutableState(
			scene,
			nearestCrossing.id,
			nearestCrossing.targetScopeId,
			nearestCrossing,
		);
		stateById.set(target.id, target);
	}
	admitStatePixel(
		target,
		pixel,
		pathDepth + 1,
		pending,
		diagnostics,
		crossingDepth,
	);
}

function admitStatePixel(
	state: MutableArrivalState,
	pixel: PortalModelPixel,
	pathDepth: number,
	pending: PendingStatePixel[],
	diagnostics: MutableDiagnostics,
	entryDepth: PortalModelDepth | null = null,
): void {
	const previousDepth = state.minimumPathDepthByPixel[pixel];
	if (previousDepth !== null && previousDepth <= pathDepth) return;
	if (!state.covered[pixel]) {
		state.covered[pixel] = true;
		diagnostics.arrivalStatePixelAdmissionCount += 1;
	}
	state.entryDepthByPixel[pixel] = entryDepth;
	state.minimumPathDepthByPixel[pixel] = pathDepth;
	pending.push({ pathDepth, pixel, stateId: state.id });
}

function createMutableState(
	scene: PortalModelScene,
	id: PortalArrivalStateId,
	scopeId: PortalModelScopeId,
	incomingCrossing: PortalModelCrossing | null,
): MutableArrivalState {
	return {
		covered: Array<boolean>(scene.pixelCount).fill(false),
		entryDepthByPixel: Array<PortalModelDepth | null>(scene.pixelCount).fill(
			null,
		),
		exitDepthByPixel: Array<PortalModelDepth | null>(scene.pixelCount).fill(
			null,
		),
		id,
		incomingCrossing,
		minimumPathDepthByPixel: Array<number | null>(scene.pixelCount).fill(null),
		processedPathDepthByPixel: Array<number | null>(scene.pixelCount).fill(
			null,
		),
		scopeId,
	};
}

function materializeStates(
	scene: PortalModelScene,
	stateById: ReadonlyMap<PortalArrivalStateId, MutableArrivalState>,
): readonly PortalArrivalState[] {
	return Object.freeze(
		[...stateById.values()]
			.sort((left, right) => {
				if (left.id === "portal-arrival:root") return -1;
				if (right.id === "portal-arrival:root") return 1;
				return left.id.localeCompare(right.id);
			})
			.map((state) =>
				Object.freeze({
					coverage: createPortalModelFootprint(
						scene.pixelCount,
						state.covered.flatMap((covered, pixel) => (covered ? [pixel] : [])),
					),
					entryDepthByPixel: Object.freeze([...state.entryDepthByPixel]),
					exitDepthByPixel: Object.freeze([...state.exitDepthByPixel]),
					id: state.id,
					incomingCrossingId: state.incomingCrossing?.id ?? null,
					scopeId: state.scopeId,
				}),
			),
	);
}

function createScopeEnvelopes(
	scene: PortalModelScene,
	states: readonly PortalArrivalState[],
	diagnostics: MutableDiagnostics,
): readonly PortalScopeVisibilityEnvelope[] {
	const mutableByScope = new Map<
		PortalModelScopeId,
		{
			readonly covered: boolean[];
			readonly maximumExitDepthByPixel: (PortalModelDepth | null)[];
			readonly unbounded: boolean[];
		}
	>();
	for (const state of states) {
		let envelope = mutableByScope.get(state.scopeId);
		if (!envelope) {
			envelope = {
				covered: Array<boolean>(scene.pixelCount).fill(false),
				maximumExitDepthByPixel: Array<PortalModelDepth | null>(
					scene.pixelCount,
				).fill(null),
				unbounded: Array<boolean>(scene.pixelCount).fill(false),
			};
			mutableByScope.set(state.scopeId, envelope);
		}
		for (let pixelValue = 0; pixelValue < scene.pixelCount; pixelValue += 1) {
			const pixel = portalModelPixel(pixelValue, scene.pixelCount);
			if (!portalModelFootprintHas(state.coverage, pixel)) continue;
			diagnostics.scopeEnvelopePixelReductionCount += 1;
			envelope.covered[pixel] = true;
			const exitDepth = state.exitDepthByPixel[pixel];
			if (exitDepth === null) {
				envelope.unbounded[pixel] = true;
				envelope.maximumExitDepthByPixel[pixel] = null;
				continue;
			}
			if (envelope.unbounded[pixel]) continue;
			const previous = envelope.maximumExitDepthByPixel[pixel];
			if (previous === null || exitDepth > previous) {
				envelope.maximumExitDepthByPixel[pixel] = exitDepth;
			}
		}
	}
	return Object.freeze(
		[...mutableByScope.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([scopeId, envelope]) =>
				Object.freeze({
					coverage: createPortalModelFootprint(
						scene.pixelCount,
						envelope.covered.flatMap((covered, pixel) =>
							covered ? [pixel] : [],
						),
					),
					maximumExitDepthByPixel: Object.freeze([
						...envelope.maximumExitDepthByPixel,
					]),
					scopeId,
				}),
			),
	);
}

function composePhysicalFragments(
	scene: PortalModelScene,
	index: ArrivalIndex,
	envelopes: readonly PortalScopeVisibilityEnvelope[],
	diagnostics: MutableDiagnostics,
): readonly PortalReferencePixelResult[] {
	const envelopeByScope = new Map(
		envelopes.map((envelope) => [envelope.scopeId, envelope]),
	);
	const selectedScopeIds = new Set(envelopeByScope.keys());
	const selectedOpaqueBatchIds = new Set(
		index.fragments.flatMap((fragment) =>
			selectedScopeIds.has(fragment.scopeId) &&
			(fragment.kind === "opaque" || fragment.kind === "alpha-test")
				? [fragment.batchId]
				: [],
		),
	);
	const selectedParticleBatchIds = new Set(
		index.fragments.flatMap((fragment) =>
			selectedScopeIds.has(fragment.scopeId) && fragment.kind === "particle"
				? [fragment.batchId]
				: [],
		),
	);
	const pixels: PortalReferencePixelResult[] = [];
	for (let pixelValue = 0; pixelValue < scene.pixelCount; pixelValue += 1) {
		const pixel = portalModelPixel(pixelValue, scene.pixelCount);
		let opaque: PortalModelFragment | null = null;
		for (const fragment of index.fragments) {
			if (!isPassingOpaque(fragment)) continue;
			diagnostics.opaqueFragmentTestCount += 1;
			if (!fragmentVisibleInEnvelope(fragment, pixel, envelopeByScope))
				continue;
			if (opaque === null || fragment.depth < opaque.depth) opaque = fragment;
		}
		const opaqueDepth = opaque?.depth ?? Number.POSITIVE_INFINITY;
		const alphaBlended: PortalModelFragment[] = [];
		const additive: PortalModelFragment[] = [];
		for (const fragment of index.fragments) {
			if (!isDeferred(fragment)) continue;
			diagnostics.deferredFragmentTestCount += 1;
			if (
				fragment.depth >= opaqueDepth ||
				!fragmentVisibleInEnvelope(fragment, pixel, envelopeByScope)
			) {
				continue;
			}
			if (isAlphaBlended(fragment)) alphaBlended.push(fragment);
			else additive.push(fragment);
		}
		alphaBlended.sort((left, right) => {
			if (left.depth === right.depth) {
				throw new Error(
					`Portal arrival-state alpha depth tie at pixel ${pixel}: ${left.id} and ${right.id}.`,
				);
			}
			return right.depth - left.depth;
		});
		additive.sort((left, right) => left.id.localeCompare(right.id));
		pixels.push(
			Object.freeze({
				additive: Object.freeze(additive.map(asObservedFragment)),
				alphaBlended: Object.freeze(alphaBlended.map(asObservedFragment)),
				opaque: opaque === null ? null : asObservedFragment(opaque),
				pixel,
			}),
		);
	}
	diagnostics.physicalOpaqueBatchCount = selectedOpaqueBatchIds.size;
	diagnostics.physicalParticleBatchCount = selectedParticleBatchIds.size;
	return Object.freeze(pixels);
}

function fragmentVisibleInEnvelope(
	fragment: PortalModelFragment,
	pixel: PortalModelPixel,
	envelopeByScope: ReadonlyMap<
		PortalModelScopeId,
		PortalScopeVisibilityEnvelope
	>,
): boolean {
	if (fragment.pixel !== pixel) return false;
	const envelope = envelopeByScope.get(fragment.scopeId);
	if (!envelope || !portalModelFootprintHas(envelope.coverage, pixel))
		return false;
	const exitDepth = envelope.maximumExitDepthByPixel[pixel];
	// Entry depth is intentionally absent; the reference compositor owns the cited retail rule.
	return exitDepth === null || fragment.depth < exitDepth;
}

function asObservedFragment(
	fragment: PortalModelFragment,
): PortalReferenceFragment {
	return Object.freeze({
		depth: fragment.depth,
		fragmentId: fragment.id,
		paths: Object.freeze([]),
	});
}

function isPassingOpaque(fragment: PortalModelFragment): boolean {
	return (
		fragment.kind === "opaque" ||
		(fragment.kind === "alpha-test" && fragment.passes)
	);
}

function isDeferred(fragment: PortalModelFragment): boolean {
	return (
		fragment.kind === "alpha-blended" ||
		fragment.kind === "additive" ||
		fragment.kind === "particle"
	);
}

function isAlphaBlended(fragment: PortalModelFragment): boolean {
	return (
		fragment.kind === "alpha-blended" ||
		(fragment.kind === "particle" && fragment.blend === "alpha-blended")
	);
}

function indexScene(scene: PortalModelScene): ArrivalIndex {
	const mutableCrossings = new Map<PortalModelScopeId, PortalModelCrossing[]>();
	for (const crossing of scene.crossings) {
		const crossings = mutableCrossings.get(crossing.sourceScopeId) ?? [];
		crossings.push(crossing);
		mutableCrossings.set(crossing.sourceScopeId, crossings);
	}
	const crossingsBySourceScope = new Map<
		PortalModelScopeId,
		readonly PortalModelCrossing[]
	>();
	for (const [scopeId, crossings] of mutableCrossings) {
		crossingsBySourceScope.set(
			scopeId,
			Object.freeze(
				crossings.toSorted((left, right) => left.id.localeCompare(right.id)),
			),
		);
	}
	const fragments = Object.freeze(
		scene.domains.flatMap((domain) => domain.fragments),
	);
	const mutableFragments = new Map<
		PortalModelScopeId,
		Map<PortalModelPixel, PortalModelFragment[]>
	>();
	for (const fragment of fragments) {
		let byPixel = mutableFragments.get(fragment.scopeId);
		if (!byPixel) {
			byPixel = new Map();
			mutableFragments.set(fragment.scopeId, byPixel);
		}
		const atPixel = byPixel.get(fragment.pixel) ?? [];
		atPixel.push(fragment);
		byPixel.set(fragment.pixel, atPixel);
	}
	const fragmentsByScopePixel = new Map<
		PortalModelScopeId,
		ReadonlyMap<PortalModelPixel, readonly PortalModelFragment[]>
	>();
	for (const [scopeId, mutableByPixel] of mutableFragments) {
		const byPixel = new Map<PortalModelPixel, readonly PortalModelFragment[]>();
		for (const [pixel, atPixel] of mutableByPixel) {
			byPixel.set(
				pixel,
				Object.freeze(
					atPixel.toSorted((left, right) => left.depth - right.depth),
				),
			);
		}
		fragmentsByScopePixel.set(scopeId, byPixel);
	}
	return { crossingsBySourceScope, fragments, fragmentsByScopePixel };
}

function createDiagnostics(): MutableDiagnostics {
	return {
		arrivalStatePixelAdmissionCount: 0,
		deferredFragmentTestCount: 0,
		maskUnionCount: 0,
		opaqueFragmentTestCount: 0,
		physicalOpaqueBatchCount: 0,
		physicalParticleBatchCount: 0,
		scopeEnvelopePixelReductionCount: 0,
		statePixelVisitCount: 0,
		transitionCrossingTestCount: 0,
	};
}
