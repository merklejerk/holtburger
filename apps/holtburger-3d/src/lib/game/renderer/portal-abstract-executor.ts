import {
	portalModelPixel,
	validatePortalModelScene,
	type PortalModelCrossing,
	type PortalModelCrossingId,
	type PortalModelDepth,
	type PortalModelDomainId,
	type PortalModelFragment,
	type PortalModelFragmentId,
	type PortalModelPixel,
	type PortalModelScene,
	type PortalModelScopeId,
	portalEntryAdvanceAdmitted,
} from "./portal-model";
import type {
	PortalReferenceFragment,
	PortalReferencePath,
	PortalReferencePixelResult,
} from "./portal-reference-compositor";

/** One pure operation exposing how domain-owned execution loses semantic state. */
type PortalDomainOwnedOperation =
	| {
			readonly domainId: PortalModelDomainId;
			readonly kind: "begin-domain";
			readonly path: PortalReferencePath;
			readonly pixel: PortalModelPixel;
	  }
	| {
			readonly crossingId: PortalModelCrossingId;
			readonly kind: "write-portal-mask";
			readonly pixel: PortalModelPixel;
	  }
	| {
			readonly fragmentId: PortalModelFragmentId;
			readonly kind: "draw-opaque" | "draw-transparent";
			readonly pixel: PortalModelPixel;
	  }
	| {
			readonly domainId: PortalModelDomainId;
			readonly kind: "reject-repeated-domain-view";
			readonly path: PortalReferencePath;
			readonly pixel: PortalModelPixel;
	  }
	| {
			readonly fragmentIds: readonly PortalModelFragmentId[];
			readonly kind: "overwrite-parent-transparency";
			readonly pixel: PortalModelPixel;
	  };

/** Deliberately flawed result matching the rejected domain-owned scheduling assumptions. */
export interface PortalDomainOwnedFrame {
	readonly operations: readonly PortalDomainOwnedOperation[];
	readonly pixels: readonly PortalReferencePixelResult[];
}

/** Constructive recursive-view operation used as the first correct executor candidate. */
type PortalRecursiveOperation =
	| {
			readonly domainId: PortalModelDomainId;
			readonly kind: "begin-view";
			readonly path: PortalReferencePath;
			readonly pixel: PortalModelPixel;
	  }
	| {
			readonly crossingId: PortalModelCrossingId;
			readonly kind: "write-child-mask";
			readonly pixel: PortalModelPixel;
	  }
	| {
			readonly fragmentId: PortalModelFragmentId;
			readonly kind: "draw-view-opaque";
			readonly pixel: PortalModelPixel;
	  }
	| {
			readonly crossingId: PortalModelCrossingId;
			readonly kind: "composite-child";
			readonly pixel: PortalModelPixel;
	  }
	| {
			readonly fragmentId: PortalModelFragmentId;
			readonly kind: "draw-deferred-additive" | "draw-deferred-alpha";
			readonly pixel: PortalModelPixel;
	  };

/** Correct recursive opaque composition followed by exact frame-global deferred work. */
export interface PortalRecursiveFrame {
	readonly operations: readonly PortalRecursiveOperation[];
	readonly pixels: readonly PortalReferencePixelResult[];
}

/** First observable mismatch between a candidate and the semantic oracle. */
export interface PortalFrameDivergence {
	readonly actual: readonly PortalModelFragmentId[];
	readonly expected: readonly PortalModelFragmentId[];
	readonly field: "additive" | "alphaBlended" | "opaque";
	readonly pixel: PortalModelPixel;
}

interface AbstractIndex {
	readonly crossingsByScope: ReadonlyMap<
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

interface MutableDomainResult {
	readonly additive: PortalReferenceFragment[];
	readonly alphaBlended: PortalReferenceFragment[];
	readonly opaque: PortalReferenceFragment | null;
}

/**
 * Execute the rejected model in which one content domain also owns one compositing appearance.
 *
 * This is intentionally not production code. A repeated domain view is rejected because the
 * schedule has already consumed that domain, and parent transparent work is lost when a later
 * complete-domain callback replaces its aperture. Both defects are executable counterexamples.
 */
export function executeDomainOwnedPortalModel(
	scene: PortalModelScene,
): PortalDomainOwnedFrame {
	validatePortalModelScene(scene);
	const index = indexScene(scene);
	const operations: PortalDomainOwnedOperation[] = [];
	const pixels: PortalReferencePixelResult[] = [];
	for (let pixelValue = 0; pixelValue < scene.pixelCount; pixelValue += 1) {
		const pixel = portalModelPixel(pixelValue, scene.pixelCount);
		const rootDomainId = requiredDomain(index, scene.rootScopeId);
		const result = executeDomainRay(
			index,
			operations,
			pixel,
			scene.rootScopeId,
			null,
			null,
			[],
			new Set([rootDomainId]),
		);
		pixels.push(
			Object.freeze({
				additive: Object.freeze(result.additive),
				alphaBlended: Object.freeze(result.alphaBlended),
				opaque: result.opaque,
				pixel,
			}),
		);
	}
	return Object.freeze({
		operations: Object.freeze(operations),
		pixels: Object.freeze(pixels),
	});
}

/**
 * Construct opaque path views recursively, then submit transparent work in exact global order.
 *
 * Unlike the oracle, this is expressed as an executable surface-composition schedule. It retains
 * every path appearance even when a domain was already prepared for an ancestor view.
 */
export function executeRecursivePortalModel(
	scene: PortalModelScene,
): PortalRecursiveFrame {
	validatePortalModelScene(scene);
	const index = indexScene(scene);
	const operations: PortalRecursiveOperation[] = [];
	const pixels: PortalReferencePixelResult[] = [];
	for (let pixelValue = 0; pixelValue < scene.pixelCount; pixelValue += 1) {
		const pixel = portalModelPixel(pixelValue, scene.pixelCount);
		const result = executeRecursiveRay(
			index,
			operations,
			pixel,
			scene.rootScopeId,
			null,
			null,
			[],
			true,
		);
		for (const fragment of result.alphaBlended) {
			operations.push({
				fragmentId: fragment.fragmentId,
				kind: "draw-deferred-alpha",
				pixel,
			});
		}
		for (const fragment of result.additive) {
			operations.push({
				fragmentId: fragment.fragmentId,
				kind: "draw-deferred-additive",
				pixel,
			});
		}
		pixels.push(
			Object.freeze({
				additive: Object.freeze(result.additive),
				alphaBlended: Object.freeze(result.alphaBlended),
				opaque: result.opaque,
				pixel,
			}),
		);
	}
	return Object.freeze({
		operations: Object.freeze(operations),
		pixels: Object.freeze(pixels),
	});
}

/** Rejected path-label variant whose child masks are not constrained by parent opaque depth. */
export function executeUnconstrainedPathLabelPortalModel(
	scene: PortalModelScene,
): PortalRecursiveFrame {
	validatePortalModelScene(scene);
	const index = indexScene(scene);
	const operations: PortalRecursiveOperation[] = [];
	const pixels: PortalReferencePixelResult[] = [];
	for (let pixelValue = 0; pixelValue < scene.pixelCount; pixelValue += 1) {
		const pixel = portalModelPixel(pixelValue, scene.pixelCount);
		const result = executeRecursiveRay(
			index,
			operations,
			pixel,
			scene.rootScopeId,
			null,
			null,
			[],
			false,
		);
		pixels.push(
			Object.freeze({
				additive: Object.freeze(result.additive),
				alphaBlended: Object.freeze(result.alphaBlended),
				opaque: result.opaque,
				pixel,
			}),
		);
	}
	return Object.freeze({
		operations: Object.freeze(operations),
		pixels: Object.freeze(pixels),
	});
}

export function findPortalFrameDivergence(
	expected: readonly PortalReferencePixelResult[],
	actual: readonly PortalReferencePixelResult[],
): PortalFrameDivergence | null {
	if (expected.length !== actual.length) {
		throw new Error(
			`Portal frame sizes differ: expected ${expected.length}, received ${actual.length}.`,
		);
	}
	for (let index = 0; index < expected.length; index += 1) {
		const expectedPixel = expected[index]!;
		const actualPixel = actual[index]!;
		if (expectedPixel.pixel !== actualPixel.pixel) {
			throw new Error(
				`Portal frame pixel order differs at index ${index}: ${expectedPixel.pixel} and ${actualPixel.pixel}.`,
			);
		}
		const expectedOpaque = expectedPixel.opaque
			? [expectedPixel.opaque.fragmentId]
			: [];
		const actualOpaque = actualPixel.opaque
			? [actualPixel.opaque.fragmentId]
			: [];
		if (!sameIds(expectedOpaque, actualOpaque)) {
			return {
				actual: actualOpaque,
				expected: expectedOpaque,
				field: "opaque",
				pixel: expectedPixel.pixel,
			};
		}
		const expectedAlpha = fragmentIds(expectedPixel.alphaBlended);
		const actualAlpha = fragmentIds(actualPixel.alphaBlended);
		if (!sameIds(expectedAlpha, actualAlpha)) {
			return {
				actual: actualAlpha,
				expected: expectedAlpha,
				field: "alphaBlended",
				pixel: expectedPixel.pixel,
			};
		}
		const expectedAdditive = fragmentIds(expectedPixel.additive);
		const actualAdditive = fragmentIds(actualPixel.additive);
		if (!sameIds(expectedAdditive, actualAdditive)) {
			return {
				actual: actualAdditive,
				expected: expectedAdditive,
				field: "additive",
				pixel: expectedPixel.pixel,
			};
		}
	}
	return null;
}

function executeDomainRay(
	index: AbstractIndex,
	operations: PortalDomainOwnedOperation[],
	pixel: PortalModelPixel,
	scopeId: PortalModelScopeId,
	entryDepth: PortalModelDepth | null,
	incomingCrossing: PortalModelCrossing | null,
	crossingIds: readonly PortalModelCrossingId[],
	consumedDomainIds: ReadonlySet<PortalModelDomainId>,
): MutableDomainResult {
	const domainId = requiredDomain(index, scopeId);
	const path = freezePath(crossingIds);
	operations.push({ domainId, kind: "begin-domain", path, pixel });
	const fragments = index.fragmentsByScopePixel.get(scopeId)?.get(pixel) ?? [];
	const nearestOpaque = fragments
		.filter(isPassingOpaque)
		.reduce<PortalModelFragment | null>(
			(nearest, fragment) =>
				nearest === null || fragment.depth < nearest.depth ? fragment : nearest,
			null,
		);
	const reciprocalId = incomingCrossing?.reciprocalCrossingId ?? null;
	const nearestCrossing = (
		index.crossingsByScope.get(scopeId) ?? []
	).reduce<PortalModelCrossing | null>((nearest, crossing) => {
		if (crossing.id === reciprocalId) return nearest;
		const depth = crossing.aperture.depthByPixel[pixel];
		if (
			depth === null ||
			!portalEntryAdvanceAdmitted(incomingCrossing, entryDepth, crossing, depth)
		) {
			return nearest;
		}
		const nearestDepth =
			nearest === null ? null : nearest.aperture.depthByPixel[pixel];
		return nearestDepth === null || depth < nearestDepth ? crossing : nearest;
	}, null);
	const crossingDepth = nearestCrossing?.aperture.depthByPixel[pixel] ?? null;
	const opaqueWins =
		nearestOpaque !== null &&
		(crossingDepth === null || nearestOpaque.depth < crossingDepth);
	const segmentEndDepth = opaqueWins
		? nearestOpaque.depth
		: (crossingDepth ?? Number.POSITIVE_INFINITY);
	const local = localTransparentResult(fragments, segmentEndDepth, crossingIds);
	for (const fragment of [...local.alphaBlended, ...local.additive]) {
		operations.push({
			fragmentId: fragment.fragmentId,
			kind: "draw-transparent",
			pixel,
		});
	}
	if (opaqueWins) {
		const opaque = observedFragment(nearestOpaque, crossingIds);
		operations.push({
			fragmentId: opaque.fragmentId,
			kind: "draw-opaque",
			pixel,
		});
		return { ...local, opaque };
	}
	if (nearestCrossing === null || crossingDepth === null) {
		return { ...local, opaque: null };
	}
	operations.push({
		crossingId: nearestCrossing.id,
		kind: "write-portal-mask",
		pixel,
	});
	const targetDomainId = requiredDomain(index, nearestCrossing.targetScopeId);
	const continuesSameDomain =
		targetDomainId === domainId &&
		nearestCrossing.relationship === "depth-continuous";
	if (consumedDomainIds.has(targetDomainId) && !continuesSameDomain) {
		operations.push({
			domainId: targetDomainId,
			kind: "reject-repeated-domain-view",
			path: freezePath([...crossingIds, nearestCrossing.id]),
			pixel,
		});
		return { additive: [], alphaBlended: [], opaque: null };
	}
	const childConsumedDomainIds = new Set(consumedDomainIds);
	childConsumedDomainIds.add(targetDomainId);
	const child = executeDomainRay(
		index,
		operations,
		pixel,
		nearestCrossing.targetScopeId,
		crossingDepth,
		nearestCrossing,
		[...crossingIds, nearestCrossing.id],
		childConsumedDomainIds,
	);
	if (continuesSameDomain) {
		return mergeTransparent(local, child);
	}
	const overwritten = fragmentIds([...local.alphaBlended, ...local.additive]);
	if (overwritten.length > 0) {
		operations.push({
			fragmentIds: Object.freeze(overwritten),
			kind: "overwrite-parent-transparency",
			pixel,
		});
	}
	return child;
}

function executeRecursiveRay(
	index: AbstractIndex,
	operations: PortalRecursiveOperation[],
	pixel: PortalModelPixel,
	scopeId: PortalModelScopeId,
	entryDepth: PortalModelDepth | null,
	incomingCrossing: PortalModelCrossing | null,
	crossingIds: readonly PortalModelCrossingId[],
	portalDepthConstrained: boolean,
): MutableDomainResult {
	const domainId = requiredDomain(index, scopeId);
	operations.push({
		domainId,
		kind: "begin-view",
		path: freezePath(crossingIds),
		pixel,
	});
	const fragments = index.fragmentsByScopePixel.get(scopeId)?.get(pixel) ?? [];
	const nearestOpaque = fragments
		.filter(isPassingOpaque)
		.reduce<PortalModelFragment | null>(
			(nearest, fragment) =>
				nearest === null || fragment.depth < nearest.depth ? fragment : nearest,
			null,
		);
	const reciprocalId = incomingCrossing?.reciprocalCrossingId ?? null;
	const nearestCrossing = (
		index.crossingsByScope.get(scopeId) ?? []
	).reduce<PortalModelCrossing | null>((nearest, crossing) => {
		if (crossing.id === reciprocalId) return nearest;
		const depth = crossing.aperture.depthByPixel[pixel];
		if (
			depth === null ||
			!portalEntryAdvanceAdmitted(incomingCrossing, entryDepth, crossing, depth)
		) {
			return nearest;
		}
		const nearestDepth =
			nearest === null ? null : nearest.aperture.depthByPixel[pixel];
		return nearestDepth === null || depth < nearestDepth ? crossing : nearest;
	}, null);
	const crossingDepth = nearestCrossing?.aperture.depthByPixel[pixel] ?? null;
	const opaqueWins =
		nearestOpaque !== null &&
		(crossingDepth === null ||
			(portalDepthConstrained && nearestOpaque.depth < crossingDepth));
	const segmentEndDepth = opaqueWins
		? nearestOpaque.depth
		: (crossingDepth ?? Number.POSITIVE_INFINITY);
	const local = localTransparentResult(fragments, segmentEndDepth, crossingIds);
	if (opaqueWins) {
		const opaque = observedFragment(nearestOpaque, crossingIds);
		operations.push({
			fragmentId: opaque.fragmentId,
			kind: "draw-view-opaque",
			pixel,
		});
		return { ...local, opaque };
	}
	if (nearestCrossing === null || crossingDepth === null) {
		return { ...local, opaque: null };
	}
	operations.push({
		crossingId: nearestCrossing.id,
		kind: "write-child-mask",
		pixel,
	});
	const child = executeRecursiveRay(
		index,
		operations,
		pixel,
		nearestCrossing.targetScopeId,
		crossingDepth,
		nearestCrossing,
		[...crossingIds, nearestCrossing.id],
		portalDepthConstrained,
	);
	operations.push({
		crossingId: nearestCrossing.id,
		kind: "composite-child",
		pixel,
	});
	return mergeTransparent(local, child);
}

function localTransparentResult(
	fragments: readonly PortalModelFragment[],
	segmentEndDepth: number,
	crossingIds: readonly PortalModelCrossingId[],
): Omit<MutableDomainResult, "opaque"> {
	const alphaBlended: PortalReferenceFragment[] = [];
	const additive: PortalReferenceFragment[] = [];
	for (const fragment of fragments) {
		if (fragment.depth >= segmentEndDepth) continue;
		if (isAlphaBlended(fragment)) {
			alphaBlended.push(observedFragment(fragment, crossingIds));
		} else if (isAdditive(fragment)) {
			additive.push(observedFragment(fragment, crossingIds));
		}
	}
	alphaBlended.sort((left, right) => right.depth - left.depth);
	additive.sort((left, right) =>
		left.fragmentId.localeCompare(right.fragmentId),
	);
	return { additive, alphaBlended };
}

function mergeTransparent(
	local: Omit<MutableDomainResult, "opaque">,
	child: MutableDomainResult,
): MutableDomainResult {
	const opaqueDepth = child.opaque?.depth ?? Number.POSITIVE_INFINITY;
	const alphaBlended = mergeObservedFragments(
		[...local.alphaBlended, ...child.alphaBlended],
		opaqueDepth,
		true,
	);
	const additive = mergeObservedFragments(
		[...local.additive, ...child.additive],
		opaqueDepth,
		false,
	);
	return { additive, alphaBlended, opaque: child.opaque };
}

function mergeObservedFragments(
	fragments: readonly PortalReferenceFragment[],
	opaqueDepth: number,
	ordered: boolean,
): PortalReferenceFragment[] {
	const byId = new Map<PortalModelFragmentId, PortalReferenceFragment>();
	for (const fragment of fragments) {
		if (fragment.depth >= opaqueDepth) continue;
		const existing = byId.get(fragment.fragmentId);
		if (!existing) {
			byId.set(fragment.fragmentId, fragment);
			continue;
		}
		const paths = [...existing.paths];
		for (const path of fragment.paths) {
			if (!paths.some((candidate) => pathKey(candidate) === pathKey(path))) {
				paths.push(path);
			}
		}
		byId.set(
			fragment.fragmentId,
			Object.freeze({
				...fragment,
				paths: Object.freeze(
					paths.sort((left, right) =>
						pathKey(left).localeCompare(pathKey(right)),
					),
				),
			}),
		);
	}
	const merged = [...byId.values()];
	merged.sort((left, right) => {
		if (left.depth === right.depth) {
			if (ordered) {
				throw new Error(
					`Portal recursive executor has unresolved alpha depth tie ${left.fragmentId} and ${right.fragmentId}.`,
				);
			}
			return left.fragmentId.localeCompare(right.fragmentId);
		}
		return ordered
			? right.depth - left.depth
			: left.fragmentId.localeCompare(right.fragmentId);
	});
	return merged;
}

function observedFragment(
	fragment: PortalModelFragment,
	crossingIds: readonly PortalModelCrossingId[],
): PortalReferenceFragment {
	return Object.freeze({
		depth: fragment.depth,
		fragmentId: fragment.id,
		paths: Object.freeze([freezePath(crossingIds)]),
	});
}

function freezePath(
	crossingIds: readonly PortalModelCrossingId[],
): PortalReferencePath {
	return Object.freeze({ crossingIds: Object.freeze([...crossingIds]) });
}

function pathKey(path: PortalReferencePath): string {
	return JSON.stringify(path.crossingIds);
}

function requiredDomain(
	index: AbstractIndex,
	scopeId: PortalModelScopeId,
): PortalModelDomainId {
	const domainId = index.domainIdByScope.get(scopeId);
	if (!domainId)
		throw new Error(`Portal abstract scope ${scopeId} has no domain.`);
	return domainId;
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

function fragmentIds(
	fragments: readonly PortalReferenceFragment[],
): PortalModelFragmentId[] {
	return fragments.map(({ fragmentId }) => fragmentId);
}

function sameIds(
	left: readonly PortalModelFragmentId[],
	right: readonly PortalModelFragmentId[],
): boolean {
	return (
		left.length === right.length &&
		left.every((fragmentId, index) => fragmentId === right[index])
	);
}

function indexScene(scene: PortalModelScene): AbstractIndex {
	const domainIdByScope = new Map<PortalModelScopeId, PortalModelDomainId>();
	for (const scope of scene.scopes)
		domainIdByScope.set(scope.id, scope.domainId);
	const mutableCrossings = new Map<PortalModelScopeId, PortalModelCrossing[]>();
	for (const crossing of scene.crossings) {
		const crossings = mutableCrossings.get(crossing.sourceScopeId) ?? [];
		crossings.push(crossing);
		mutableCrossings.set(crossing.sourceScopeId, crossings);
	}
	const crossingsByScope = new Map<
		PortalModelScopeId,
		readonly PortalModelCrossing[]
	>();
	for (const [scopeId, crossings] of mutableCrossings) {
		crossingsByScope.set(scopeId, Object.freeze([...crossings]));
	}
	const mutableFragments = new Map<
		PortalModelScopeId,
		Map<PortalModelPixel, PortalModelFragment[]>
	>();
	for (const domain of scene.domains) {
		for (const fragment of domain.fragments) {
			let byPixel = mutableFragments.get(fragment.scopeId);
			if (!byPixel) {
				byPixel = new Map();
				mutableFragments.set(fragment.scopeId, byPixel);
			}
			const fragments = byPixel.get(fragment.pixel) ?? [];
			fragments.push(fragment);
			byPixel.set(fragment.pixel, fragments);
		}
	}
	return {
		crossingsByScope,
		domainIdByScope,
		fragmentsByScopePixel: mutableFragments,
	};
}
