import {
	createPortalModelFootprint,
	portalModelPixel,
	portalModelViewId,
	validatePortalModelScene,
	type PortalModelCrossing,
	type PortalModelCrossingId,
	type PortalModelDepth,
	type PortalModelDomainId,
	type PortalModelFragment,
	type PortalModelFragmentId,
	type PortalModelFootprint,
	type PortalModelPixel,
	type PortalModelScene,
	type PortalModelScopeId,
	type PortalModelViewId,
	portalEntryAdvanceAdmitted,
} from "./portal-model";

/** Exact crossing ancestry that admits one symbolic fragment or view. */
export interface PortalReferencePath {
	readonly crossingIds: readonly PortalModelCrossingId[];
}

/** One visible symbolic fragment and every equivalent path that admitted it. */
export interface PortalReferenceFragment {
	readonly depth: PortalModelDepth;
	readonly fragmentId: PortalModelFragmentId;
	readonly paths: readonly PortalReferencePath[];
}

/** Exact semantic result for one finite-screen pixel. */
export interface PortalReferencePixelResult {
	readonly additive: readonly PortalReferenceFragment[];
	readonly alphaBlended: readonly PortalReferenceFragment[];
	readonly opaque: PortalReferenceFragment | null;
	readonly pixel: PortalModelPixel;
}

/** One path-specific scope appearance aggregated across every pixel that followed that path. */
export interface PortalReferenceView {
	readonly coverage: PortalModelFootprint;
	readonly crossingIds: readonly PortalModelCrossingId[];
	readonly domainId: PortalModelDomainId;
	/** Null on covered root pixels; consult coverage to distinguish uncovered pixels. */
	readonly entryDepthByPixel: readonly (PortalModelDepth | null)[];
	readonly id: PortalModelViewId;
	readonly parentViewId: PortalModelViewId | null;
	readonly scopeId: PortalModelScopeId;
}

/** Auditable finite work needed by the independent ray oracle. */
interface PortalReferenceDiagnostics {
	readonly maximumPathLength: number;
	readonly raySegmentCount: number;
	readonly viewCount: number;
}

/** Complete exact symbolic frame independent from any renderer schedule or GPU state. */
export interface PortalReferenceFrame {
	readonly diagnostics: PortalReferenceDiagnostics;
	readonly pixels: readonly PortalReferencePixelResult[];
	readonly views: readonly PortalReferenceView[];
}

interface ModelIndex {
	readonly crossingsBySourceScope: ReadonlyMap<
		PortalModelScopeId,
		readonly PortalModelCrossing[]
	>;
	readonly domainIdByScope: ReadonlyMap<
		PortalModelScopeId,
		PortalModelDomainId
	>;
	readonly fragmentsByScopePixel: ReadonlyMap<
		PortalModelScopeId,
		ReadonlyMap<PortalModelPixel, readonly PortalModelFragment[]>
	>;
}

interface MutableObservedFragment {
	readonly fragment: PortalModelFragment;
	readonly paths: PortalReferencePath[];
}

interface MutableViewObservation {
	readonly coverageByPixel: boolean[];
	readonly crossingIds: readonly PortalModelCrossingId[];
	readonly depthByPixel: (PortalModelDepth | null)[];
	readonly domainId: PortalModelDomainId;
	readonly id: PortalModelViewId;
	readonly parentViewId: PortalModelViewId | null;
	readonly scopeId: PortalModelScopeId;
}

interface RayTrace {
	readonly additive: Map<PortalModelFragmentId, MutableObservedFragment>;
	readonly alphaBlended: Map<PortalModelFragmentId, MutableObservedFragment>;
	maximumPathLength: number;
	opaque: MutableObservedFragment | null;
	raySegmentCount: number;
}

/**
 * Evaluate the physical ray contract without layers, stencil labels, render domains, or targets.
 *
 * At each scope the nearest passing opaque fragment or deeper portal plane ends that scope's ray
 * segment. A portal wins only when its plane is in front of local opaque geometry. Target fragments
 * may protrude in front of the entry plane.
 *
 * RETAIL QUIRK: `PView::ClipPortals` passes only the clipped screen aperture into the target view
 * (`acclient.c:441813-441942`); `Render::copy_view` builds eye-to-aperture edge planes
 * (`acclient.c:364969-365337`), and `Render::viewconeCheck` tests only those plus the camera near
 * plane (`acclient.c:363285-363330`). There is no entry-portal clip plane. Adding one would erase
 * shipped geometry that protrudes through a portal and would require per-segment rather than
 * per-scope visibility envelopes. Model census: the explicit protrusion fixture and all 3,980
 * bounded scenes retain this rule; no shipped-DAT protrusion census was run because this preserves
 * retail behavior rather than departing from it.
 *
 * Portal depths must nevertheless increase along a ray, which both matches a forward camera ray
 * and supplies the finite traversal measure.
 */
export function composePortalReferenceFrame(
	scene: PortalModelScene,
): PortalReferenceFrame {
	return composePortalReferenceFrameWithPathLimit(scene, null);
}

/** Exact semantic result after declining every portal beyond one complete path-depth frontier. */
export function composePortalReferenceFrameThroughPathDepth(
	scene: PortalModelScene,
	maximumPathDepth: number,
): PortalReferenceFrame {
	if (!Number.isInteger(maximumPathDepth) || maximumPathDepth < 0) {
		throw new Error(
			"Portal reference path-depth limit must be a non-negative integer.",
		);
	}
	return composePortalReferenceFrameWithPathLimit(scene, maximumPathDepth);
}

function composePortalReferenceFrameWithPathLimit(
	scene: PortalModelScene,
	maximumPathDepth: number | null,
): PortalReferenceFrame {
	validatePortalModelScene(scene);
	const index = indexScene(scene);
	const viewByPath = new Map<string, MutableViewObservation>();
	const pixelResults: PortalReferencePixelResult[] = [];
	let maximumPathLength = 0;
	let raySegmentCount = 0;

	for (let pixelValue = 0; pixelValue < scene.pixelCount; pixelValue += 1) {
		const pixel = portalModelPixel(pixelValue, scene.pixelCount);
		const trace: RayTrace = {
			additive: new Map(),
			alphaBlended: new Map(),
			maximumPathLength: 0,
			opaque: null,
			raySegmentCount: 0,
		};
		traceRay(
			scene,
			index,
			viewByPath,
			trace,
			pixel,
			scene.rootScopeId,
			null,
			null,
			[],
			maximumPathDepth,
		);
		maximumPathLength = Math.max(maximumPathLength, trace.maximumPathLength);
		raySegmentCount += trace.raySegmentCount;
		const opaque = trace.opaque ? freezeObserved(trace.opaque) : null;
		const opaqueDepth = opaque?.depth ?? Number.POSITIVE_INFINITY;
		pixelResults.push(
			Object.freeze({
				additive: Object.freeze(
					visibleObserved(trace.additive, opaqueDepth, pixel, false),
				),
				alphaBlended: Object.freeze(
					visibleObserved(trace.alphaBlended, opaqueDepth, pixel, true),
				),
				opaque,
				pixel,
			}),
		);
	}

	const views = [...viewByPath.values()]
		.sort(compareViewPaths)
		.map((view): PortalReferenceView =>
			Object.freeze({
				coverage: createPortalModelFootprint(
					scene.pixelCount,
					view.coverageByPixel.flatMap((covered, pixel) =>
						covered ? [pixel] : [],
					),
				),
				crossingIds: Object.freeze([...view.crossingIds]),
				domainId: view.domainId,
				entryDepthByPixel: Object.freeze([...view.depthByPixel]),
				id: view.id,
				parentViewId: view.parentViewId,
				scopeId: view.scopeId,
			}),
		);
	return Object.freeze({
		diagnostics: Object.freeze({
			maximumPathLength,
			raySegmentCount,
			viewCount: views.length,
		}),
		pixels: Object.freeze(pixelResults),
		views: Object.freeze(views),
	});
}

function traceRay(
	scene: PortalModelScene,
	index: ModelIndex,
	viewByPath: Map<string, MutableViewObservation>,
	trace: RayTrace,
	pixel: PortalModelPixel,
	scopeId: PortalModelScopeId,
	entryDepth: PortalModelDepth | null,
	incomingCrossing: PortalModelCrossing | null,
	crossingIds: readonly PortalModelCrossingId[],
	maximumPathDepth: number | null,
): void {
	trace.raySegmentCount += 1;
	trace.maximumPathLength = Math.max(
		trace.maximumPathLength,
		crossingIds.length,
	);
	recordView(scene, index, viewByPath, pixel, scopeId, entryDepth, crossingIds);

	const fragments = index.fragmentsByScopePixel.get(scopeId)?.get(pixel) ?? [];
	const nearestOpaque = fragments
		.filter(isPassingOpaque)
		.reduce<PortalModelFragment | null>(
			(nearest, fragment) =>
				nearest === null || fragment.depth < nearest.depth ? fragment : nearest,
			null,
		);
	const reciprocalId = incomingCrossing?.reciprocalCrossingId ?? null;
	const nearestCrossing =
		maximumPathDepth !== null && crossingIds.length >= maximumPathDepth
			? null
			: (
					index.crossingsBySourceScope.get(scopeId) ?? []
				).reduce<PortalModelCrossing | null>((nearest, crossing) => {
					if (crossing.id === reciprocalId) return nearest;
					const depth = crossing.aperture.depthByPixel[pixel];
					if (
						depth === null ||
						!portalEntryAdvanceAdmitted(
							incomingCrossing,
							entryDepth,
							crossing,
							depth,
						)
					) {
						return nearest;
					}
					// Same-scope candidates cannot tie: `createPortalModelScene` rejects equal-depth
					// same-scope crossings at construction, so strict comparison is total here.
					const nearestDepth =
						nearest === null ? null : nearest.aperture.depthByPixel[pixel];
					return nearestDepth === null || depth < nearestDepth
						? crossing
						: nearest;
				}, null);
	const crossingDepth = nearestCrossing?.aperture.depthByPixel[pixel] ?? null;
	const opaqueWins =
		nearestOpaque !== null &&
		(crossingDepth === null || nearestOpaque.depth < crossingDepth);
	const segmentEndDepth = opaqueWins
		? nearestOpaque.depth
		: (crossingDepth ?? Number.POSITIVE_INFINITY);

	for (const fragment of fragments) {
		if (fragment.depth >= segmentEndDepth) continue;
		if (isAlphaBlended(fragment)) {
			recordObserved(trace.alphaBlended, fragment, crossingIds);
		} else if (isAdditive(fragment)) {
			recordObserved(trace.additive, fragment, crossingIds);
		}
	}
	if (opaqueWins) {
		trace.opaque = {
			fragment: nearestOpaque,
			paths: [freezePath(crossingIds)],
		};
		return;
	}
	if (nearestCrossing === null || crossingDepth === null) return;
	traceRay(
		scene,
		index,
		viewByPath,
		trace,
		pixel,
		nearestCrossing.targetScopeId,
		crossingDepth,
		nearestCrossing,
		[...crossingIds, nearestCrossing.id],
		maximumPathDepth,
	);
}

function recordView(
	scene: PortalModelScene,
	index: ModelIndex,
	viewByPath: Map<string, MutableViewObservation>,
	pixel: PortalModelPixel,
	scopeId: PortalModelScopeId,
	entryDepth: PortalModelDepth | null,
	crossingIds: readonly PortalModelCrossingId[],
): void {
	const key = JSON.stringify(crossingIds);
	const existing = viewByPath.get(key);
	if (existing) {
		if (existing.scopeId !== scopeId) {
			throw new Error(
				`Portal reference path ${key} resolves to multiple scopes.`,
			);
		}
		existing.coverageByPixel[pixel] = true;
		existing.depthByPixel[pixel] = entryDepth;
		return;
	}
	const domainId = index.domainIdByScope.get(scopeId);
	if (!domainId) {
		throw new Error(`Portal reference scope ${scopeId} has no content domain.`);
	}
	const id = viewId(crossingIds);
	const depthByPixel = Array<PortalModelDepth | null>(scene.pixelCount).fill(
		null,
	);
	depthByPixel[pixel] = entryDepth;
	const coverageByPixel = Array<boolean>(scene.pixelCount).fill(false);
	coverageByPixel[pixel] = true;
	viewByPath.set(key, {
		coverageByPixel,
		crossingIds: Object.freeze([...crossingIds]),
		depthByPixel,
		domainId,
		id,
		parentViewId:
			crossingIds.length === 0 ? null : viewId(crossingIds.slice(0, -1)),
		scopeId,
	});
}

function viewId(
	crossingIds: readonly PortalModelCrossingId[],
): PortalModelViewId {
	return portalModelViewId(
		crossingIds.length === 0
			? "portal-model-view:root"
			: `portal-model-view:${crossingIds.join(">")}`,
	);
}

function recordObserved(
	observedById: Map<PortalModelFragmentId, MutableObservedFragment>,
	fragment: PortalModelFragment,
	crossingIds: readonly PortalModelCrossingId[],
): void {
	const path = freezePath(crossingIds);
	const existing = observedById.get(fragment.id);
	if (existing) {
		if (!existing.paths.some((candidate) => samePath(candidate, path))) {
			existing.paths.push(path);
		}
		return;
	}
	observedById.set(fragment.id, { fragment, paths: [path] });
}

function visibleObserved(
	observedById: ReadonlyMap<PortalModelFragmentId, MutableObservedFragment>,
	opaqueDepth: number,
	pixel: PortalModelPixel,
	ordered: boolean,
): PortalReferenceFragment[] {
	const visible = [...observedById.values()].filter(
		({ fragment }) => fragment.depth < opaqueDepth,
	);
	visible.sort((left, right) => {
		if (left.fragment.depth === right.fragment.depth) {
			if (!ordered) {
				return left.fragment.id.localeCompare(right.fragment.id);
			}
			throw new Error(
				`Portal reference has an unresolved transparent depth tie at pixel ${pixel}: ${left.fragment.id} and ${right.fragment.id}.`,
			);
		}
		return ordered
			? right.fragment.depth - left.fragment.depth
			: left.fragment.id.localeCompare(right.fragment.id);
	});
	return visible.map(freezeObserved);
}

function freezeObserved(
	observed: MutableObservedFragment,
): PortalReferenceFragment {
	return Object.freeze({
		depth: observed.fragment.depth,
		fragmentId: observed.fragment.id,
		paths: Object.freeze(
			observed.paths
				.map((path) => freezePath(path.crossingIds))
				.sort((left, right) => pathKey(left).localeCompare(pathKey(right))),
		),
	});
}

function freezePath(
	crossingIds: readonly PortalModelCrossingId[],
): PortalReferencePath {
	return Object.freeze({ crossingIds: Object.freeze([...crossingIds]) });
}

function samePath(
	left: PortalReferencePath,
	right: PortalReferencePath,
): boolean {
	return pathKey(left) === pathKey(right);
}

function pathKey(path: PortalReferencePath): string {
	return JSON.stringify(path.crossingIds);
}

function isPassingOpaque(fragment: PortalModelFragment): boolean {
	return (
		fragment.kind === "opaque" ||
		(fragment.kind === "alpha-test" && fragment.passes)
	);
}

function isAlphaBlended(fragment: PortalModelFragment): boolean {
	return (
		fragment.kind === "alpha-blended" ||
		(fragment.kind === "particle" && fragment.blend === "alpha-blended")
	);
}

function isAdditive(fragment: PortalModelFragment): boolean {
	return (
		fragment.kind === "additive" ||
		(fragment.kind === "particle" && fragment.blend === "additive")
	);
}

function indexScene(scene: PortalModelScene): ModelIndex {
	const domainIdByScope = new Map<PortalModelScopeId, PortalModelDomainId>();
	for (const scope of scene.scopes)
		domainIdByScope.set(scope.id, scope.domainId);

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
				[...crossings].sort((left, right) => left.id.localeCompare(right.id)),
			),
		);
	}

	const mutableFragments = new Map<
		PortalModelScopeId,
		Map<PortalModelPixel, PortalModelFragment[]>
	>();
	for (const domain of scene.domains) {
		for (const fragment of domain.fragments) {
			let fragmentsByPixel = mutableFragments.get(fragment.scopeId);
			if (!fragmentsByPixel) {
				fragmentsByPixel = new Map();
				mutableFragments.set(fragment.scopeId, fragmentsByPixel);
			}
			const fragments = fragmentsByPixel.get(fragment.pixel) ?? [];
			fragments.push(fragment);
			fragmentsByPixel.set(fragment.pixel, fragments);
		}
	}
	const fragmentsByScopePixel = new Map<
		PortalModelScopeId,
		ReadonlyMap<PortalModelPixel, readonly PortalModelFragment[]>
	>();
	for (const [scopeId, mutableByPixel] of mutableFragments) {
		const byPixel = new Map<PortalModelPixel, readonly PortalModelFragment[]>();
		for (const [pixel, fragments] of mutableByPixel) {
			byPixel.set(
				pixel,
				Object.freeze(
					[...fragments].sort((left, right) => left.depth - right.depth),
				),
			);
		}
		fragmentsByScopePixel.set(scopeId, byPixel);
	}
	return { crossingsBySourceScope, domainIdByScope, fragmentsByScopePixel };
}

function compareViewPaths(
	left: MutableViewObservation,
	right: MutableViewObservation,
): number {
	return (
		left.crossingIds.length - right.crossingIds.length ||
		left.id.localeCompare(right.id)
	);
}
