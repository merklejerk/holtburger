import { createLandblockOffset, getLandblockCoordinates } from "../landblocks";
import type {
	ScenePortalCrossingInput,
	SceneScope,
	SceneTopologyView,
} from "../scene";
import {
	PORTAL_QUERY_EPSILON,
	signedPlaneDistance,
	type PlanarAperture,
} from "../scene/planar-aperture";
import { sameScope, scopeKey } from "../scene/scope";
import { apertureIntersectsCameraNearClipVolume } from "./portal-near-plane";
import type { PortalScopeWindowCullInput } from "./portal-scope-window-culler";
import {
	admitPortalViewWindow,
	createFullPortalViewWindow,
	portalViewWindowNdcArea,
	preparePortalApertureProjectionInput,
	PortalWindowProjector,
	type PortalApertureProjectionInput,
	type PortalViewWindow,
	validatePreparedPortalProjection,
} from "./portal-view-window";

/** Immutable proof input with a corruption guard independent from production capacity policy. */
export interface PortalScopeWindowReferenceInput extends PortalScopeWindowCullInput {
	/** Maximum queue/crossing operations accepted before the reference fails loudly. */
	readonly safetyWorkItemLimit: number;
}

/** One selected authored scope and its immutable accumulated NDC coverage. */
interface PortalScopeWindowReferenceSelection {
	readonly scope: SceneScope;
	readonly window: PortalViewWindow;
}

/** Branch evidence retained by differential tests without carrying retired render scheduling. */
interface PortalScopeWindowReferenceDiagnostics {
	readonly admittedStateCount: number;
	readonly nearPlaneSeedCount: number;
	readonly rejectedPortalFootprintCount: number;
}

/** Complete immutable proof result used only to judge the arena-backed production culler. */
export interface PortalScopeWindowReferenceResult {
	readonly diagnostics: PortalScopeWindowReferenceDiagnostics;
	readonly selections: readonly PortalScopeWindowReferenceSelection[];
}

/** Projection input paired with the stable authored aperture identity. */
interface IndexedPortalAperture extends PortalApertureProjectionInput {
	readonly id: ScenePortalCrossingInput["visibilityAperture"]["id"];
}

/** Novel immutable window coverage waiting to expand from one authored scope. */
interface ReferenceWorkItem {
	readonly incomingCrossing: ScenePortalCrossingInput | null;
	readonly scope: SceneScope;
	readonly window: PortalViewWindow;
}

/**
 * Readable allocation-bearing scope-window traversal kept deliberately separate from the packed
 * production culler. Differential equivalence, not a shared allocation strategy, prevents drift.
 */
export function cullPortalScopeWindowsReference(
	topology: SceneTopologyView,
	input: PortalScopeWindowReferenceInput,
): PortalScopeWindowReferenceResult {
	validateInput(input);
	const domainByScopeKey = indexTopology(topology);
	const rootKey = scopeKey(input.rootScope);
	if (!domainByScopeKey.has(rootKey)) {
		throw new Error(`Portal reference root scope ${rootKey} is unavailable.`);
	}
	const anchorApertureById = new Map<string, PlanarAperture>();
	const coverageByScopeKey = new Map<string, PortalViewWindow>();
	const scopeByKey = new Map<string, SceneScope>();
	const nearPlaneCrossingIds = new Set<string>();
	const queue: ReferenceWorkItem[] = [];
	const projector = new PortalWindowProjector(input, null);
	const pixelsPerNdcArea =
		(input.portalFootprint.drawingBuffer.width *
			input.portalFootprint.drawingBuffer.height) /
		4;
	let admittedStateCount = 1;
	let rejectedPortalFootprintCount = 0;
	let workItemCount = 0;

	const rootWindow = createFullPortalViewWindow();
	coverageByScopeKey.set(rootKey, rootWindow);
	scopeByKey.set(rootKey, input.rootScope);
	queue.push({
		incomingCrossing: null,
		scope: input.rootScope,
		window: rootWindow,
	});

	const consumeWorkItem = (): void => {
		workItemCount += 1;
		if (workItemCount > input.safetyWorkItemLimit) {
			throw new Error(
				"Portal scope-window reference exceeded its safety work limit.",
			);
		}
	};

	for (let cursor = 0; cursor < queue.length; cursor += 1) {
		consumeWorkItem();
		const item = queue[cursor]!;
		const sourceDomain = domainByScopeKey.get(scopeKey(item.scope));
		if (sourceDomain === undefined) {
			throw new Error(
				`Portal reference scope ${scopeKey(item.scope)} is unavailable.`,
			);
		}
		for (const crossing of topology.outgoing(item.scope)) {
			if (
				item.incomingCrossing !== null &&
				(crossing.id === item.incomingCrossing.reciprocalCrossingId ||
					crossing.sourceAperture.id ===
						item.incomingCrossing.sourceAperture.id)
			) {
				continue;
			}
			consumeWorkItem();
			if (!sameScope(crossing.source, item.scope)) {
				throw new Error(
					`Portal topology returned ${crossing.id} from the wrong source scope.`,
				);
			}
			const targetKey = scopeKey(crossing.target);
			const targetDomain = domainByScopeKey.get(targetKey);
			if (targetDomain === undefined) {
				throw new Error(`Portal crossing ${crossing.id} has no target scope.`);
			}
			const apertureInput = createApertureInput(crossing.visibilityAperture);
			const anchorAperture = resolveAnchorAperture(
				anchorApertureById,
				apertureInput,
				input,
			);
			const nearPlaneStraddle = apertureIntersectsCameraNearClipVolume(
				input.nearClipVolume,
				anchorAperture,
			);
			if (
				!nearPlaneStraddle &&
				!facesCamera(crossing, anchorApertureById, input)
			) {
				continue;
			}
			const projection = nearPlaneStraddle
				? projector.clipThroughNearClipAperture(
						item.window,
						preparePortalApertureProjectionInput(apertureInput),
					)
				: projector.clipThroughAperture(
						item.window,
						preparePortalApertureProjectionInput(apertureInput),
					);
			if (projection.kind === "empty") continue;
			if (
				!nearPlaneStraddle &&
				portalViewWindowNdcArea(projection.window) * pixelsPerNdcArea <
					input.portalFootprint.minimumPixelArea
			) {
				rejectedPortalFootprintCount += 1;
				continue;
			}
			if (nearPlaneStraddle && sourceDomain !== targetDomain) {
				nearPlaneCrossingIds.add(crossing.id);
			}
			const admission = admitPortalViewWindow(
				coverageByScopeKey.get(targetKey) ?? null,
				projection.window,
			);
			if (admission.delta === null) continue;
			coverageByScopeKey.set(targetKey, admission.coverage);
			scopeByKey.set(targetKey, crossing.target);
			admittedStateCount += 1;
			queue.push({
				incomingCrossing: crossing,
				scope: crossing.target,
				window: admission.delta,
			});
		}
	}

	const selections = [...scopeByKey.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, scope]) => {
			const window = coverageByScopeKey.get(key);
			if (window === undefined) {
				throw new Error(`Portal reference scope ${key} lost its coverage.`);
			}
			return Object.freeze({ scope, window });
		});
	return Object.freeze({
		diagnostics: Object.freeze({
			admittedStateCount,
			nearPlaneSeedCount: nearPlaneCrossingIds.size,
			rejectedPortalFootprintCount,
		}),
		selections: Object.freeze(selections),
	});
}

function indexTopology(
	topology: SceneTopologyView,
): ReadonlyMap<string, string> {
	const domainByScopeKey = new Map<string, string>();
	for (const topologyScope of topology.scopes) {
		const key = scopeKey(topologyScope.scope);
		if (domainByScopeKey.has(key)) {
			throw new Error(`Portal topology repeats scope ${key}.`);
		}
		if (topologyScope.scope.kind === "outdoor") {
			if (topologyScope.visibilityIslandId !== null) {
				throw new Error("Outdoor scope cannot belong to a visibility island.");
			}
			domainByScopeKey.set(key, "outdoor");
		} else {
			if (topologyScope.visibilityIslandId === null) {
				throw new Error(`EnvCell scope ${key} has no visibility island.`);
			}
			domainByScopeKey.set(key, topologyScope.visibilityIslandId);
		}
	}
	const crossingIds = new Set<string>();
	for (const crossing of topology.crossings) {
		if (crossingIds.has(crossing.id)) {
			throw new Error(`Portal topology repeats crossing ${crossing.id}.`);
		}
		if (
			!domainByScopeKey.has(scopeKey(crossing.source)) ||
			!domainByScopeKey.has(scopeKey(crossing.target))
		) {
			throw new Error(
				`Portal crossing ${crossing.id} references an unavailable scope.`,
			);
		}
		crossingIds.add(crossing.id);
	}
	return domainByScopeKey;
}

function createApertureInput(
	source: ScenePortalCrossingInput["sourceAperture"],
): IndexedPortalAperture {
	return {
		aperture: source,
		id: source.id,
		landblockCoordinates: getLandblockCoordinates(source.landblockId),
	};
}

function resolveAnchorAperture(
	cache: Map<string, PlanarAperture>,
	input: IndexedPortalAperture,
	view: PortalScopeWindowReferenceInput,
): PlanarAperture {
	const cached = cache.get(input.id);
	if (cached !== undefined) return cached;
	const offset = createLandblockOffset(
		input.landblockCoordinates,
		view.anchorCoordinates,
	);
	const vertices = new Float32Array(input.aperture.vertices.length);
	for (let index = 0; index < input.aperture.vertices.length; index += 3) {
		vertices[index] = input.aperture.vertices[index]! + offset.x;
		vertices[index + 1] = input.aperture.vertices[index + 1]!;
		vertices[index + 2] = input.aperture.vertices[index + 2]! + offset.z;
	}
	const normal = input.aperture.plane.normal;
	const aperture = {
		indices: input.aperture.indices,
		plane: {
			d: input.aperture.plane.d - normal.x * offset.x - normal.z * offset.z,
			normal,
		},
		vertices,
	};
	cache.set(input.id, aperture);
	return aperture;
}

function facesCamera(
	crossing: ScenePortalCrossingInput,
	cache: Map<string, PlanarAperture>,
	input: PortalScopeWindowReferenceInput,
): boolean {
	const aperture = resolveAnchorAperture(
		cache,
		createApertureInput(crossing.sourceAperture),
		input,
	);
	const distance = signedPlaneDistance(
		aperture.plane,
		input.nearClipVolume.eye,
	);
	return crossing.acceptedSide === "positive"
		? distance > PORTAL_QUERY_EPSILON
		: distance < -PORTAL_QUERY_EPSILON;
}

function validateInput(input: PortalScopeWindowReferenceInput): void {
	validatePreparedPortalProjection(input);
	if (
		!Number.isFinite(input.portalFootprint.minimumPixelArea) ||
		input.portalFootprint.minimumPixelArea < 0
	) {
		throw new Error(
			"Portal footprint minimum must be a non-negative finite number.",
		);
	}
	if (
		!Number.isInteger(input.portalFootprint.drawingBuffer.width) ||
		input.portalFootprint.drawingBuffer.width <= 0 ||
		!Number.isInteger(input.portalFootprint.drawingBuffer.height) ||
		input.portalFootprint.drawingBuffer.height <= 0
	) {
		throw new Error(
			"Portal footprint drawing buffer must have positive integer dimensions.",
		);
	}
	if (
		!Number.isInteger(input.safetyWorkItemLimit) ||
		input.safetyWorkItemLimit <= 0
	) {
		throw new Error(
			"Portal scope-window reference safety work limit must be a positive integer.",
		);
	}
}
