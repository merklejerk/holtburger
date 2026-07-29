import type { PortalCrossingId, SceneScope } from "../scene";
import { Vec2 } from "../math/types";
import type { GeometryResourceKey } from "./resource-manager";
import type { PortalRenderWorkPlan } from "./portal-render-graph";
import { createPortalViewWindow } from "./portal-view-window";
import {
	executePortalGraph,
	type PortalFrameDiagnostics,
} from "./webgl2-portal-executor";
import { WebGL2PortalSubstrate } from "./webgl2-portal-substrate";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";
import {
	createPortalFixtureGeometry,
	emptyFixtureProjectionDiagnostics,
	FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
} from "./webgl2-portal-fixture-support";
import {
	createPortalFixtureSceneProgram as createSceneProgram,
	destroyPortalFixtureSceneProgram,
	drawPortalFixtureScene as drawScene,
	fixturePixelMatches as pixelMatches,
	normalizedFixtureColor as normalized,
	readFixturePixel as readPixel,
	type PortalFixtureSceneProgram as SceneProgram,
} from "./webgl2-portal-fixture-scene";

const FIXTURE_EXTENT = { height: 8, width: 8 } as const;
const EXTERIOR_NODE_ID = "portal-render-node:outdoor";
const INTERIOR_NODE_ID = "portal-render-node:env-cell-island:fixture";
const OTHER_INTERIOR_NODE_ID =
	"portal-render-node:env-cell-island:other-building";
const CROSSING_A = "portal-crossing:fixture/a" as PortalCrossingId;
const CROSSING_B = "portal-crossing:fixture/b" as PortalCrossingId;
const CROSSING_INTERNAL =
	"portal-crossing:fixture/internal" as PortalCrossingId;
const CROSSING_RETURN = "portal-crossing:fixture/return" as PortalCrossingId;
const APERTURE_A = "portal-aperture:fixture/a";
const APERTURE_B = "portal-aperture:fixture/b";
const APERTURE_INTERNAL = "portal-aperture:fixture/internal";
const SUFFIX_NODE_ID = "portal-render-node:env-cell-island:fixture-suffix";
const RED = [204, 51, 26, 255] as const;
const ORANGE = [230, 128, 26, 255] as const;
const YELLOW = [230, 230, 26, 255] as const;
const BLUE = [26, 51, 204, 255] as const;
const CYAN = [26, 204, 204, 255] as const;
const INDOOR_BLEND = [64, 102, 115, 255] as const;

/** Browser-read evidence for exterior composition and unified hybrid execution. */
export interface WebGL2HybridPortalExecutionFixtureResult {
	/** Opaque, transparent, and additive indoor passes retain their established order. */
	readonly blendOrderingPassed: boolean;
	/** A nearer exterior occluder remains in front of an outdoor-to-indoor transition. */
	readonly exteriorDepthOcclusionPassed: boolean;
	/** Outdoor content was copied with depth, not color alone, into an indoor root. */
	readonly interiorColorDepthCopyPassed: boolean;
	/** Unified executor composed an exterior cycle and re-entered indoor suffix once. */
	readonly hybridCyclePassed: boolean;
	/** Unified executor consumed executable seeds in both transition directions. */
	readonly hybridStraddlePassed: boolean;
	/** Unified graph execution counts retained for Phase 12B acceptance. */
	readonly hybridTrace: PortalFrameDiagnostics;
	/** Distinct transition apertures union before one target-domain contribution pass. */
	readonly multiWindowUnionPassed: boolean;
	/** The second independent view contains no color from the first exterior render. */
	readonly noStaleViewReusePassed: boolean;
	/** Exterior-root sequencing and bounded draw counts consumed by Gate F. */
	readonly outdoorRoot: PortalFrameDiagnostics;
	/** Indoor-root sequencing and bounded draw counts consumed by Gate F. */
	readonly indoorRoot: PortalFrameDiagnostics;
	/** Indoor-root transition straddle execution retained independently from ordinary masks. */
	readonly indoorStraddle: PortalFrameDiagnostics;
	/** Outdoor-root transition straddle execution retained independently from ordinary masks. */
	readonly outdoorStraddle: PortalFrameDiagnostics;
	/** Sampled pixels retained for failure diagnosis rather than runtime telemetry. */
	readonly pixels: {
		readonly copiedDepthNear: readonly number[];
		readonly copiedDepthRejected: readonly number[];
		readonly exteriorOccluder: readonly number[];
		readonly hybridExterior: readonly number[];
		readonly hybridNotch: readonly number[];
		readonly hybridSuffix: readonly number[];
		readonly interiorOutside: readonly number[];
		readonly indoorStraddleExterior: readonly number[];
		readonly indoorStraddleInterior: readonly number[];
		readonly multiWindow: readonly number[];
		readonly outdoorStraddleInterior: readonly number[];
		readonly straddleClipped: readonly number[];
		readonly tunnel: readonly number[];
		readonly tunnelNotch: readonly number[];
	};
	/** Both residency directions composite the adjacent domain through an NDC straddle mask. */
	readonly straddleDualSidePassed: boolean;
	/** Outdoor-sourced building portals remain reachable behind an indoor-root straddle. */
	readonly straddleExteriorBranchPassed: boolean;
	/** Both independent views reused the same fixed two target objects sequentially. */
	readonly targetReusePassed: boolean;
	/** Portal depth replacement exposes indoor content behind farther exterior terrain. */
	readonly tunnelDepthResetPassed: boolean;
}

/** Execute both root directions through production targets, masks, copy shaders, and depth state. */
export function runWebGL2HybridPortalExecutionFixture(
	gl: WebGL2RenderingContext,
	resources: WebGL2ResourceManager,
): WebGL2HybridPortalExecutionFixtureResult {
	const destinationExtent = {
		height: gl.drawingBufferHeight,
		width: gl.drawingBufferWidth,
	};
	const substrate = new WebGL2PortalSubstrate(gl);
	const sceneProgram = createSceneProgram(gl);
	const geometryKeys: GeometryResourceKey[] = [];
	try {
		const apertureAKey = createPortalFixtureGeometry(resources, {
			indices: new Uint16Array([0, 1, 3, 1, 2, 3, 0, 3, 5, 3, 4, 5]),
			positions: new Float32Array([
				-0.9, -0.8, 0, 0, -0.8, 0, 0, -0.2, -0.75, -0.4, -0.2, -0.75, -0.4, 0.8,
				-2, -0.9, 0.8, -2,
			]),
		});
		const apertureBKey = createPortalFixtureGeometry(resources, {
			indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
			positions: new Float32Array([
				0.2, 0.2, 0, 0.8, 0.2, 0, 0.8, 0.8, 0, 0.2, 0.8, 0,
			]),
		});
		const internalApertureKey = createPortalFixtureGeometry(resources, {
			indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
			positions: new Float32Array([
				-0.8, -0.8, 0, -0.2, -0.8, 0, -0.2, -0.2, 0, -0.8, -0.2, 0,
			]),
		});
		geometryKeys.push(apertureAKey, apertureBKey, internalApertureKey);
		const apertureById = new Map([
			[APERTURE_A, resources.getGeometry(apertureAKey)],
			[APERTURE_B, resources.getGeometry(apertureBKey)],
			[APERTURE_INTERNAL, resources.getGeometry(internalApertureKey)],
		]);
		const resolveVisibilityAperture = (apertureId: string) => {
			const geometry = apertureById.get(apertureId);
			if (!geometry) {
				throw new Error(`Missing fixture aperture ${apertureId}.`);
			}
			return {
				clipFromLocal: FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
				geometry,
				indexCount: geometry.indexCount,
				indexStart: 0,
			};
		};
		let outdoorIndoorDrawCount = 0;
		const outdoorRoot = executePortalGraph(substrate, {
			clearColor: [0, 0, 0, 1],
			destination: null,
			extent: FIXTURE_EXTENT,
			plan: transitionPlan("exterior", false),
			renderExterior: () => {
				drawScene(gl, sceneProgram, {
					color: normalized(RED),
					depth: 0.8,
					kind: "opaque",
					maximum: [1, 1],
					minimum: [-1, -1],
				});
				drawScene(gl, sceneProgram, {
					color: normalized(YELLOW),
					depth: 0.2,
					kind: "opaque",
					maximum: [-0.45, -0.3],
					minimum: [-0.8, -0.45],
				});
			},
			renderIndoorNodes: () => {
				outdoorIndoorDrawCount += 1;
				drawIndoorBlendSequence(gl, sceneProgram);
			},
			resolveVisibilityAperture,
		});
		const tunnelPixel = readPixel(gl, 1, 1);
		const multiWindowPixel = readPixel(gl, 6, 6);
		const occluderPixel = readPixel(gl, 1, 2);
		const straddleClippedPixel = readPixel(gl, 1, 6);
		const tunnelNotchPixel = readPixel(gl, 3, 6);
		const firstTargets = substrate.getTargets();

		let indoorRootDrawCount = 0;
		const indoorRoot = executePortalGraph(substrate, {
			clearColor: [0, 0, 0, 1],
			destination: null,
			extent: FIXTURE_EXTENT,
			plan: transitionPlan("interior", false),
			renderExterior: () =>
				drawScene(gl, sceneProgram, {
					color: normalized(ORANGE),
					depth: 0.6,
					kind: "opaque",
					maximum: [1, 1],
					minimum: [-1, -1],
				}),
			renderIndoorNodes: () => {
				indoorRootDrawCount += 1;
				drawScene(gl, sceneProgram, {
					color: normalized(BLUE),
					depth: 0.7,
					kind: "opaque",
					maximum: [1, 1],
					minimum: [-1, -1],
				});
			},
			resolveVisibilityAperture,
		});
		const secondTargets = substrate.getTargets();
		const interiorOutsidePixel = readPixel(gl, 4, 4);

		substrate.beginMaskedPass(secondTargets.composite, 1);
		drawScene(gl, sceneProgram, {
			color: [0.8, 0.1, 0.8, 1],
			depth: 0.65,
			kind: "opaque",
			maximum: [1, 1],
			minimum: [-1, -1],
		});
		drawScene(gl, sceneProgram, {
			color: normalized(CYAN),
			depth: 0.55,
			kind: "opaque",
			maximum: [-0.45, -0.25],
			minimum: [-0.85, -0.75],
		});
		substrate.present(secondTargets.composite, null, FIXTURE_EXTENT);
		const copiedDepthNearPixel = readPixel(gl, 1, 1);
		const copiedDepthRejectedPixel = readPixel(gl, 6, 6);
		substrate.restoreOrdinaryPass(null, destinationExtent);

		const outdoorStraddle = executePortalGraph(substrate, {
			clearColor: [0, 0, 0, 1],
			destination: null,
			extent: FIXTURE_EXTENT,
			plan: transitionPlan("exterior", true),
			renderExterior: () =>
				drawScene(gl, sceneProgram, {
					color: normalized(RED),
					depth: 0.8,
					kind: "opaque",
					maximum: [1, 1],
					minimum: [-1, -1],
				}),
			renderIndoorNodes: (_target, nodeIds) => {
				if (nodeIds.includes(INTERIOR_NODE_ID as never)) {
					drawScene(gl, sceneProgram, {
						color: normalized(BLUE),
						depth: 0.7,
						kind: "opaque",
						maximum: [1, 1],
						minimum: [-1, -1],
					});
				}
				if (nodeIds.includes(OTHER_INTERIOR_NODE_ID as never)) {
					drawScene(gl, sceneProgram, {
						color: normalized(CYAN),
						depth: 0.5,
						kind: "opaque",
						maximum: [0.8, 0.8],
						minimum: [0.2, 0.2],
					});
				}
			},
			resolveVisibilityAperture,
		});
		const outdoorStraddleInteriorPixel = readPixel(gl, 1, 6);

		const indoorStraddle = executePortalGraph(substrate, {
			clearColor: [0, 0, 0, 1],
			destination: null,
			extent: FIXTURE_EXTENT,
			plan: transitionPlan("interior", true),
			renderExterior: () =>
				drawScene(gl, sceneProgram, {
					color: normalized(ORANGE),
					depth: 0.6,
					kind: "opaque",
					maximum: [1, 1],
					minimum: [-1, -1],
				}),
			renderIndoorNodes: (_target, nodeIds) => {
				if (nodeIds.includes(INTERIOR_NODE_ID as never)) {
					drawScene(gl, sceneProgram, {
						color: normalized(BLUE),
						depth: 0.4,
						kind: "opaque",
						maximum: [1, 1],
						minimum: [0, -1],
					});
				}
				if (nodeIds.includes(OTHER_INTERIOR_NODE_ID as never)) {
					drawScene(gl, sceneProgram, {
						color: normalized(CYAN),
						depth: 0.5,
						kind: "opaque",
						maximum: [1, 1],
						minimum: [-1, -1],
					});
				}
			},
			resolveVisibilityAperture,
		});
		const indoorStraddleExteriorPixel = readPixel(gl, 1, 6);
		const indoorStraddleInteriorPixel = readPixel(gl, 6, 1);
		const indoorStraddleExteriorBranchPixel = readPixel(gl, 1, 1);

		const hybridTrace = executePortalGraph(substrate, {
			clearColor: [0, 0, 0, 1],
			destination: null,
			extent: FIXTURE_EXTENT,
			plan: hybridCyclePlan(),
			renderExterior: () =>
				drawScene(gl, sceneProgram, {
					color: normalized(RED),
					depth: 0.8,
					kind: "opaque",
					maximum: [1, 1],
					minimum: [-1, -1],
				}),
			renderIndoorNodes: (_target, renderNodeIds) => {
				if (renderNodeIds.includes(INTERIOR_NODE_ID as never)) {
					drawScene(gl, sceneProgram, {
						color: normalized(BLUE),
						depth: 0.7,
						kind: "opaque",
						maximum: [1, 1],
						minimum: [-1, -1],
					});
				}
				if (renderNodeIds.includes(SUFFIX_NODE_ID as never)) {
					drawIndoorBlendSequence(gl, sceneProgram);
				}
			},
			resolveVisibilityAperture,
		});
		const hybridSuffixPixel = readPixel(gl, 1, 1);
		const hybridExteriorPixel = readPixel(gl, 6, 6);
		const hybridNotchPixel = readPixel(gl, 3, 6);

		const webGlError = gl.getError();
		if (webGlError !== gl.NO_ERROR) {
			throw new Error(
				`Exterior transition composition fixture failed with WebGL error ${webGlError}.`,
			);
		}
		return {
			blendOrderingPassed:
				pixelMatches(tunnelPixel, INDOOR_BLEND) &&
				pixelMatches(multiWindowPixel, INDOOR_BLEND),
			exteriorDepthOcclusionPassed: pixelMatches(occluderPixel, YELLOW),
			hybridCyclePassed:
				hybridTrace.exteriorRenderCount === 1 &&
				hybridTrace.exteriorCompositeCount === 1 &&
				hybridTrace.submittedRenderNodeCount === 3 &&
				pixelMatches(hybridSuffixPixel, INDOOR_BLEND) &&
				pixelMatches(hybridExteriorPixel, RED) &&
				pixelMatches(hybridNotchPixel, BLUE),
			hybridStraddlePassed:
				outdoorStraddle.nearPlaneSeedCount === 1 &&
				indoorStraddle.nearPlaneSeedCount === 1 &&
				outdoorStraddle.maskDrawCount === 2 &&
				indoorStraddle.maskDrawCount === 2,
			hybridTrace,
			interiorColorDepthCopyPassed:
				indoorRootDrawCount === 1 &&
				pixelMatches(copiedDepthNearPixel, CYAN) &&
				pixelMatches(copiedDepthRejectedPixel, ORANGE),
			indoorRoot,
			indoorStraddle,
			multiWindowUnionPassed:
				outdoorIndoorDrawCount === 1 &&
				pixelMatches(tunnelPixel, INDOOR_BLEND) &&
				pixelMatches(multiWindowPixel, INDOOR_BLEND),
			noStaleViewReusePassed:
				pixelMatches(copiedDepthRejectedPixel, ORANGE) &&
				!pixelMatches(copiedDepthRejectedPixel, RED),
			outdoorRoot,
			outdoorStraddle,
			pixels: {
				copiedDepthNear: [...copiedDepthNearPixel],
				copiedDepthRejected: [...copiedDepthRejectedPixel],
				exteriorOccluder: [...occluderPixel],
				hybridExterior: [...hybridExteriorPixel],
				hybridNotch: [...hybridNotchPixel],
				hybridSuffix: [...hybridSuffixPixel],
				interiorOutside: [...interiorOutsidePixel],
				indoorStraddleExterior: [...indoorStraddleExteriorPixel],
				indoorStraddleInterior: [...indoorStraddleInteriorPixel],
				multiWindow: [...multiWindowPixel],
				outdoorStraddleInterior: [...outdoorStraddleInteriorPixel],
				straddleClipped: [...straddleClippedPixel],
				tunnel: [...tunnelPixel],
				tunnelNotch: [...tunnelNotchPixel],
			},
			straddleDualSidePassed:
				outdoorStraddle.exteriorRenderCount === 1 &&
				outdoorStraddle.submittedRenderNodeCount === 3 &&
				indoorStraddle.exteriorRenderCount === 1 &&
				indoorStraddle.submittedRenderNodeCount === 3 &&
				pixelMatches(outdoorStraddleInteriorPixel, BLUE) &&
				pixelMatches(indoorStraddleExteriorPixel, ORANGE) &&
				pixelMatches(indoorStraddleInteriorPixel, BLUE),
			straddleExteriorBranchPassed: pixelMatches(
				indoorStraddleExteriorBranchPixel,
				CYAN,
			),
			targetReusePassed:
				firstTargets.exterior === secondTargets.exterior &&
				firstTargets.composite === secondTargets.composite,
			tunnelDepthResetPassed:
				pixelMatches(tunnelPixel, INDOOR_BLEND) &&
				pixelMatches(tunnelNotchPixel, RED),
		};
	} finally {
		substrate.destroy();
		for (const key of geometryKeys) resources.releaseResource(key);
		destroyPortalFixtureSceneProgram(gl, sceneProgram);
	}
}

function drawIndoorBlendSequence(
	gl: WebGL2RenderingContext,
	program: SceneProgram,
): void {
	drawScene(gl, program, {
		color: [0.1, 0.5, 0.1, 1],
		depth: 0.7,
		kind: "opaque",
		maximum: [1, 1],
		minimum: [-1, -1],
	});
	drawScene(gl, program, {
		color: [0.2, 0.2, 0.8, 0.5],
		depth: 0.6,
		kind: "transparent",
		maximum: [1, 1],
		minimum: [-1, -1],
	});
	drawScene(gl, program, {
		color: [0.1, 0.05, 0, 0.25],
		depth: 0.5,
		kind: "additive",
		maximum: [1, 1],
		minimum: [-1, -1],
	});
}

function hybridCyclePlan(): PortalRenderWorkPlan {
	const entryA = hybridEdge(
		CROSSING_A,
		INTERIOR_NODE_ID,
		EXTERIOR_NODE_ID,
		APERTURE_A,
	);
	const entryB = hybridEdge(
		CROSSING_B,
		INTERIOR_NODE_ID,
		EXTERIOR_NODE_ID,
		APERTURE_B,
	);
	const internal = hybridEdge(
		CROSSING_INTERNAL,
		EXTERIOR_NODE_ID,
		SUFFIX_NODE_ID,
		APERTURE_INTERNAL,
	);
	const returnEdge = hybridEdge(
		CROSSING_RETURN,
		SUFFIX_NODE_ID,
		EXTERIOR_NODE_ID,
		APERTURE_INTERNAL,
	);
	const maskEdges = [entryA, entryB, internal, returnEdge];
	const nodes = [
		{
			...node(INTERIOR_NODE_ID, "indoor-visibility-island", 0),
			incomingMaskEdgeIds: [],
		},
		{
			...node(SUFFIX_NODE_ID, "indoor-visibility-island", 1),
			incomingMaskEdgeIds: [CROSSING_INTERNAL],
		},
		{
			...node(EXTERIOR_NODE_ID, "outdoor", 1),
			incomingMaskEdgeIds: [CROSSING_A, CROSSING_B, CROSSING_RETURN],
		},
	] as const;
	return {
		capacity: {
			maximumAvailableStencilValue: 255,
			maximumRenderLayer: 1,
			requiredMaximumStencilValue: 1,
		},
		diagnostics: {
			admittedWindowStateCount: 4,
			attemptedCrossingCount: 4,
			componentCount: 2,
			cyclicComponentCount: 1,
			duplicateOrSubsumedWindowStateCount: 1,
			emptyWindowCount: 0,
			maximumRetainedFragmentsPerNode: 2,
			nearPlaneSeedCount: 0,
			projection: emptyFixtureProjectionDiagnostics(),
			rejectedFacingCrossingCount: 0,
			sameDomainBoundaryCrossingCount: 0,
			retainedMaskEdgeCount: maskEdges.length,
			retainedRenderNodeCount: nodes.length,
			workItemCount: 4,
		},
		exteriorComponent: {
			compositionStencilValue: 1,
			componentNodeIds: [SUFFIX_NODE_ID, EXTERIOR_NODE_ID],
			entryMaskEdgeIds: [CROSSING_A, CROSSING_B],
			indoorNodeIds: [SUFFIX_NODE_ID],
			internalIndoorMaskEdgeIds: [CROSSING_INTERNAL],
			outdoorNodeId: EXTERIOR_NODE_ID,
			renderLayer: 1,
			returnMaskEdgeIds: [CROSSING_RETURN],
			rootContained: false,
		},
		exteriorTransitions: maskEdges.map((edge) => ({
			crossingId: edge.crossingId,
			exteriorLandblockId: "0x0001ffff",
			sourceNodeId: edge.sourceNodeId,
			targetNodeId: edge.targetNodeId,
		})),
		maskEdges,
		nodes,
		renderLayers: [
			{
				incomingMaskEdgeIds: [],
				renderLayer: 0,
				renderNodeIds: [INTERIOR_NODE_ID],
			},
			{
				incomingMaskEdgeIds: [
					CROSSING_A,
					CROSSING_B,
					CROSSING_INTERNAL,
					CROSSING_RETURN,
				],
				renderLayer: 1,
				renderNodeIds: [SUFFIX_NODE_ID, EXTERIOR_NODE_ID],
			},
		],
		rootNodeId: INTERIOR_NODE_ID,
		selectedScopes: nodes.flatMap((value) => value.scopes),
		topologyRevision: 1,
	} as PortalRenderWorkPlan;
}

function hybridEdge(
	crossingId: PortalCrossingId,
	sourceNodeId: string,
	targetNodeId: string,
	visibilityApertureId: string,
): PortalRenderWorkPlan["maskEdges"][number] {
	return {
		crossingId,
		maskSource: {
			kind: "world-aperture",
			visibilityApertureId,
		},
		sourceNodeId,
		spatialRelationship: {
			exteriorLandblockId: "0x0001ffff",
			kind: "exterior-transition",
		},
		targetNodeId,
	} as PortalRenderWorkPlan["maskEdges"][number];
}

function transitionPlan(
	rootKind: "exterior" | "interior",
	nearPlaneStraddle: boolean,
): PortalRenderWorkPlan {
	const rootNodeId =
		rootKind === "exterior" ? EXTERIOR_NODE_ID : INTERIOR_NODE_ID;
	const targetNodeId =
		rootKind === "exterior" ? INTERIOR_NODE_ID : EXTERIOR_NODE_ID;
	const crossings = [CROSSING_A, CROSSING_B] as const;
	const apertureIds = [
		APERTURE_A,
		nearPlaneStraddle ? APERTURE_INTERNAL : APERTURE_B,
	] as const;
	const targetRenderLayer = 1;
	const otherInteriorRenderLayer =
		rootKind === "exterior" ? 1 : targetRenderLayer + 1;
	const maskEdges = crossings.map((crossingId, index) => ({
		crossingId,
		maskSource:
			nearPlaneStraddle && index === 0
				? ({
						kind: "near-clip-window",
						window: createFixtureStraddleWindow(),
					} as const)
				: ({
						kind: "world-aperture",
						visibilityApertureId: apertureIds[index]!,
					} as const),
		sourceNodeId:
			nearPlaneStraddle && index === 1 ? EXTERIOR_NODE_ID : rootNodeId,
		spatialRelationship: {
			exteriorLandblockId: "0x0001ffff",
			kind: "exterior-transition" as const,
		},
		targetNodeId:
			nearPlaneStraddle && index === 1 ? OTHER_INTERIOR_NODE_ID : targetNodeId,
	}));
	const maximumRenderLayer = nearPlaneStraddle
		? otherInteriorRenderLayer
		: targetRenderLayer;
	const exteriorRoot = rootKind === "exterior";
	return {
		capacity: {
			maximumAvailableStencilValue: 255,
			maximumRenderLayer,
			requiredMaximumStencilValue: maximumRenderLayer,
		},
		diagnostics: {
			admittedWindowStateCount: 0,
			attemptedCrossingCount: 0,
			componentCount: 0,
			cyclicComponentCount: 0,
			duplicateOrSubsumedWindowStateCount: 0,
			emptyWindowCount: 0,
			maximumRetainedFragmentsPerNode: 0,
			nearPlaneSeedCount: nearPlaneStraddle ? 1 : 0,
			projection: emptyFixtureProjectionDiagnostics(),
			rejectedFacingCrossingCount: 0,
			sameDomainBoundaryCrossingCount: 0,
			retainedMaskEdgeCount: crossings.length,
			retainedRenderNodeCount: nearPlaneStraddle ? 3 : 2,
			workItemCount: 0,
		},
		exteriorComponent: {
			compositionStencilValue: exteriorRoot ? 0 : 1,
			componentNodeIds: [EXTERIOR_NODE_ID],
			entryMaskEdgeIds:
				rootKind === "interior"
					? nearPlaneStraddle
						? [CROSSING_A]
						: crossings
					: [],
			indoorNodeIds: [],
			internalIndoorMaskEdgeIds: [],
			outdoorNodeId: EXTERIOR_NODE_ID,
			renderLayer: exteriorRoot ? 0 : 1,
			returnMaskEdgeIds: [],
			rootContained: exteriorRoot,
		},
		exteriorTransitions: maskEdges.map((edge) => ({
			crossingId: edge.crossingId,
			exteriorLandblockId: "0x0001ffff",
			sourceNodeId: edge.sourceNodeId,
			targetNodeId: edge.targetNodeId,
		})),
		maskEdges,
		nodes: [
			node(
				rootNodeId,
				rootKind === "exterior" ? "outdoor" : "indoor-visibility-island",
				0,
			),
			node(
				targetNodeId,
				rootKind === "exterior" ? "indoor-visibility-island" : "outdoor",
				targetRenderLayer,
			),
			...(nearPlaneStraddle
				? [
						node(
							OTHER_INTERIOR_NODE_ID,
							"indoor-visibility-island",
							otherInteriorRenderLayer,
						),
					]
				: []),
		],
		renderLayers: nearPlaneStraddle
			? exteriorRoot
				? [
						{
							incomingMaskEdgeIds: [],
							renderLayer: 0,
							renderNodeIds: [rootNodeId],
						},
						{
							incomingMaskEdgeIds: crossings,
							renderLayer: 1,
							renderNodeIds: [targetNodeId, OTHER_INTERIOR_NODE_ID],
						},
					]
				: [
						{
							incomingMaskEdgeIds: [],
							renderLayer: 0,
							renderNodeIds: [rootNodeId],
						},
						{
							incomingMaskEdgeIds: [CROSSING_A],
							renderLayer: 1,
							renderNodeIds: [targetNodeId],
						},
						{
							incomingMaskEdgeIds: [CROSSING_B],
							renderLayer: 2,
							renderNodeIds: [OTHER_INTERIOR_NODE_ID],
						},
					]
			: [
					{
						incomingMaskEdgeIds: [],
						renderLayer: 0,
						renderNodeIds: [rootNodeId],
					},
					{
						incomingMaskEdgeIds: crossings,
						renderLayer: 1,
						renderNodeIds: [targetNodeId],
					},
				],
		rootNodeId,
		selectedScopes: [],
		topologyRevision: 1,
	} as PortalRenderWorkPlan;
}

function createFixtureStraddleWindow() {
	const window = createPortalViewWindow([
		[new Vec2(-0.9, -0.8), new Vec2(0, -0.8), new Vec2(-0.4, -0.2)],
		[new Vec2(0, -0.8), new Vec2(0, -0.2), new Vec2(-0.4, -0.2)],
		[new Vec2(-0.9, -0.8), new Vec2(-0.4, -0.2), new Vec2(-0.9, 0.8)],
		[new Vec2(-0.4, -0.2), new Vec2(-0.4, 0.8), new Vec2(-0.9, 0.8)],
	]);
	if (!window) throw new Error("Fixture straddle window is empty.");
	return window;
}

function node(
	id: string,
	kind: "indoor-visibility-island" | "outdoor",
	renderLayer: number,
): PortalRenderWorkPlan["nodes"][number] {
	return {
		id,
		incomingMaskEdgeIds: [],
		kind,
		renderLayer,
		scopes:
			kind === "outdoor"
				? [{ kind: "outdoor" } satisfies SceneScope]
				: [
						{
							envCellId: "0x00010100",
							kind: "env-cell",
							landblockId: "0x0001ffff",
						} satisfies SceneScope,
					],
	} as PortalRenderWorkPlan["nodes"][number];
}
