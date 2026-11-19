import {
	createPortalModelFootprint,
	portalModelFootprintHas,
	portalModelPixel,
	type PortalModelCrossingId,
	type PortalModelDepth,
	type PortalModelFragment,
	type PortalModelPixel,
	type PortalModelScene,
	type PortalModelScopeId,
} from "./portal-model";
import type {
	PortalReferenceFragment,
	PortalReferenceFrame,
	PortalReferencePath,
	PortalReferencePixelResult,
	PortalReferenceView,
} from "./portal-reference-compositor";

/**
 * Union of every admitted appearance of one authored scope.
 *
 * Null on a covered pixel means the ray remains in that scope without another exit. Coverage
 * distinguishes that unbounded case from an uncovered pixel.
 */
export interface PortalScopeVisibilityEnvelope {
	readonly coverage: ReturnType<typeof createPortalModelFootprint>;
	readonly maximumExitDepthByPixel: readonly (PortalModelDepth | null)[];
	readonly scopeId: PortalModelScopeId;
}

interface MutableEnvelope {
	readonly covered: boolean[];
	readonly maximumExitDepthByPixel: (PortalModelDepth | null)[];
	readonly scopeId: PortalModelScopeId;
	readonly unbounded: boolean[];
}

/** One pixel's deferred survivors in the caller's original physical submission order. */
export interface PortalDeferredSequencePixelResult {
	readonly fragments: readonly PortalModelFragment[];
	readonly pixel: PortalModelPixel;
}

/** Collapse path appearances into the exact per-scope predicate consumed by deferred fragments. */
export function createPortalScopeVisibilityEnvelopes(
	scene: PortalModelScene,
	frame: PortalReferenceFrame,
): readonly PortalScopeVisibilityEnvelope[] {
	const childViewsByParentPath = new Map<string, PortalReferenceView[]>();
	for (const view of frame.views) {
		if (view.crossingIds.length === 0) continue;
		const parentKey = pathKey(view.crossingIds.slice(0, -1));
		const children = childViewsByParentPath.get(parentKey) ?? [];
		children.push(view);
		childViewsByParentPath.set(parentKey, children);
	}
	const mutableByScope = new Map<PortalModelScopeId, MutableEnvelope>();
	for (const view of frame.views) {
		let envelope = mutableByScope.get(view.scopeId);
		if (!envelope) {
			envelope = {
				covered: Array<boolean>(scene.pixelCount).fill(false),
				maximumExitDepthByPixel: Array<PortalModelDepth | null>(
					scene.pixelCount,
				).fill(null),
				scopeId: view.scopeId,
				unbounded: Array<boolean>(scene.pixelCount).fill(false),
			};
			mutableByScope.set(view.scopeId, envelope);
		}
		const children =
			childViewsByParentPath.get(pathKey(view.crossingIds)) ?? [];
		for (let pixelValue = 0; pixelValue < scene.pixelCount; pixelValue += 1) {
			const pixel = portalModelPixel(pixelValue, scene.pixelCount);
			if (!portalModelFootprintHas(view.coverage, pixel)) continue;
			envelope.covered[pixel] = true;
			const child = children.find((candidate) =>
				portalModelFootprintHas(candidate.coverage, pixel),
			);
			if (!child) {
				envelope.unbounded[pixel] = true;
				envelope.maximumExitDepthByPixel[pixel] = null;
				continue;
			}
			if (envelope.unbounded[pixel]) continue;
			const exitDepth = child.entryDepthByPixel[pixel];
			if (exitDepth === null) {
				throw new Error(
					`Portal child view ${child.id} has no entry depth at covered pixel ${pixel}.`,
				);
			}
			const previous = envelope.maximumExitDepthByPixel[pixel];
			if (previous === null || exitDepth > previous) {
				envelope.maximumExitDepthByPixel[pixel] = exitDepth;
			}
		}
	}
	return Object.freeze(
		[...mutableByScope.values()]
			.sort((left, right) => left.scopeId.localeCompare(right.scopeId))
			.map((envelope) =>
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
					scopeId: envelope.scopeId,
				}),
			),
	);
}

/** Re-evaluate deferred composition using only scope envelopes plus completed opaque depth. */
export function composePortalDeferredFromEnvelopes(
	scene: PortalModelScene,
	reference: PortalReferenceFrame,
	envelopes: readonly PortalScopeVisibilityEnvelope[],
): readonly PortalReferencePixelResult[] {
	const envelopeByScope = new Map(
		envelopes.map((envelope) => [envelope.scopeId, envelope]),
	);
	const fragments = scene.domains.flatMap((domain) => domain.fragments);
	return Object.freeze(
		reference.pixels.map((referencePixel): PortalReferencePixelResult => {
			const opaqueDepth =
				referencePixel.opaque?.depth ?? Number.POSITIVE_INFINITY;
			const visible = fragments.filter((fragment) =>
				isDeferredVisible(
					fragment,
					referencePixel.pixel,
					opaqueDepth,
					envelopeByScope,
				),
			);
			const alphaBlended = visible
				.filter(isAlphaBlended)
				.sort((left, right) => right.depth - left.depth)
				.map(asObservedFragment);
			const additive = visible
				.filter(isAdditive)
				.sort((left, right) => left.id.localeCompare(right.id))
				.map(asObservedFragment);
			return Object.freeze({
				additive: Object.freeze(additive),
				alphaBlended: Object.freeze(alphaBlended),
				opaque: referencePixel.opaque,
				pixel: referencePixel.pixel,
			});
		}),
	);
}

/**
 * Apply portal visibility to an already-ordered physical deferred stream without reordering it.
 *
 * Portal composition owns only admission through the scope envelope and completed opaque depth.
 * Object/particle ordering is an orthogonal renderer policy: preserving the supplied sequence lets
 * the production renderer keep its bounded object ordering and compatible particle instancing.
 */
export function filterPortalDeferredSequenceFromEnvelopes(
	reference: PortalReferenceFrame,
	envelopes: readonly PortalScopeVisibilityEnvelope[],
	orderedFragments: readonly PortalModelFragment[],
): readonly PortalDeferredSequencePixelResult[] {
	const envelopeByScope = new Map(
		envelopes.map((envelope) => [envelope.scopeId, envelope]),
	);
	return Object.freeze(
		reference.pixels.map((referencePixel) => {
			const opaqueDepth =
				referencePixel.opaque?.depth ?? Number.POSITIVE_INFINITY;
			return Object.freeze({
				fragments: Object.freeze(
					orderedFragments.filter((fragment) =>
						isDeferredVisible(
							fragment,
							referencePixel.pixel,
							opaqueDepth,
							envelopeByScope,
						),
					),
				),
				pixel: referencePixel.pixel,
			});
		}),
	);
}

function isDeferredVisible(
	fragment: PortalModelFragment,
	pixel: PortalModelPixel,
	opaqueDepth: number,
	envelopeByScope: ReadonlyMap<
		PortalModelScopeId,
		PortalScopeVisibilityEnvelope
	>,
): boolean {
	if (!isAlphaBlended(fragment) && !isAdditive(fragment)) return false;
	if (fragment.pixel !== pixel || fragment.depth >= opaqueDepth) return false;
	const envelope = envelopeByScope.get(fragment.scopeId);
	if (!envelope || !portalModelFootprintHas(envelope.coverage, pixel)) {
		return false;
	}
	const exitDepth = envelope.maximumExitDepthByPixel[pixel];
	return exitDepth === null || fragment.depth < exitDepth;
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

function asObservedFragment(
	fragment: PortalModelFragment,
): PortalReferenceFragment {
	return Object.freeze({
		depth: fragment.depth,
		fragmentId: fragment.id,
		paths: Object.freeze<PortalReferencePath[]>([]),
	});
}

function pathKey(crossingIds: readonly PortalModelCrossingId[]): string {
	return JSON.stringify(crossingIds);
}
