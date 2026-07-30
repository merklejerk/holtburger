import type { GeometryResourceKey } from "./resource-manager";
import type { PortalCrossingId, SceneScope } from "../scene";
import type { PortalRenderWorkPlan } from "./portal-render-graph";
import { Vec2 } from "../math/types";
import {
	createPortalViewWindow,
	type PortalViewWindow,
} from "./portal-view-window";
import { executePortalGraph } from "./webgl2-portal-executor";
import {
	createPortalFixtureSceneProgram,
	destroyPortalFixtureSceneProgram,
	drawPortalFixtureScene,
	fixturePixelMatches,
	normalizedFixtureColor,
	readFixturePixel,
} from "./webgl2-portal-fixture-scene";
import { WebGL2PortalSubstrate } from "./webgl2-portal-substrate";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";
import {
	createPortalFixtureGeometry,
	emptyFixtureProjectionDiagnostics,
	FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
} from "./webgl2-portal-fixture-support";

const EXTENT = { height: 8, width: 12 } as const;
const ROOT = "portal-render-node:fixture/root";
const LEFT = "portal-render-node:fixture/left";
const RIGHT = "portal-render-node:fixture/right";
const TARGET = "portal-render-node:fixture/target";
const ROOT_LEFT = "portal-crossing:fixture/root-left" as PortalCrossingId;
const ROOT_RIGHT = "portal-crossing:fixture/root-right" as PortalCrossingId;
const LEFT_TARGET = "portal-crossing:fixture/left-target" as PortalCrossingId;
const RIGHT_TARGET = "portal-crossing:fixture/right-target" as PortalCrossingId;
const BLUE = [26, 51, 204, 255] as const;
const GREEN = [26, 128, 26, 255] as const;
const MASKED_BLEND = [64, 102, 115, 255] as const;
const MASKED_ALPHA_TEST_BLEND = [64, 140, 204, 255] as const;

/** Gate-G pixel and trace evidence from the production indoor graph executor. */
export interface WebGL2InternalPortalExecutionFixtureResult {
	readonly alphaTestPassed: boolean;
	readonly exactMaskConfinementPassed: boolean;
	readonly layerUnionPassed: boolean;
	readonly materialOrderingPassed: boolean;
	readonly nearPlaneDualSidePassed: boolean;
	readonly nestedDepthConfinementPassed: boolean;
	readonly pixels: {
		readonly alphaDiscard: readonly number[];
		readonly alphaKeep: readonly number[];
		readonly concaveNotch: readonly number[];
		readonly leftTarget: readonly number[];
		readonly parentWall: readonly number[];
		readonly rightTarget: readonly number[];
		readonly rootWall: readonly number[];
	};
	readonly reversePixels: {
		readonly oppositeOpening: readonly number[];
		readonly reachedTarget: readonly number[];
	};
	readonly reverseTrace: ReturnType<typeof executePortalGraph>;
	readonly trace: ReturnType<typeof executePortalGraph>;
	readonly uniqueNodeSubmissionPassed: boolean;
}

/**
 * Execute a physically valid nested indoor graph through production masks and target state.
 *
 * Source and intermediate rooms write wall depth while leaving actual portal openings at far
 * depth. Oversized child masks therefore expose any loss of the legacy-proven `LEQUAL` boundary.
 */
export function runWebGL2InternalPortalExecutionFixture(
	gl: WebGL2RenderingContext,
	resources: WebGL2ResourceManager,
): WebGL2InternalPortalExecutionFixtureResult {
	const destinationExtent = {
		height: gl.drawingBufferHeight,
		width: gl.drawingBufferWidth,
	};
	const substrate = new WebGL2PortalSubstrate(gl);
	const program = createPortalFixtureSceneProgram(gl);
	const geometryKeys: GeometryResourceKey[] = [];
	try {
		const apertures = new Map<
			string,
			ReturnType<typeof resources.getGeometry>
		>();
		const concaveRootKey = createConcaveRootPortalGeometry(resources);
		geometryKeys.push(concaveRootKey);
		apertures.set(
			"portal-aperture:fixture/root-left",
			resources.getGeometry(concaveRootKey),
		);
		for (const [id, bounds] of [
			["portal-aperture:fixture/root-right", [0.1, -0.8, 0.9, 0.8]],
			["portal-aperture:fixture/left-target", [-0.75, -0.4, 0.15, 0.4]],
			["portal-aperture:fixture/right-target", [-0.15, -0.4, 0.75, 0.4]],
		] as const) {
			const key = createPortalGeometry(resources, bounds);
			geometryKeys.push(key);
			apertures.set(id, resources.getGeometry(key));
		}
		const submittedNodeIds: string[] = [];
		const trace = executePortalGraph(substrate, {
			clearColor: normalizedFixtureColor(BLUE),
			destination: null,
			extent: EXTENT,
			plan: internalFixturePlan(),
			renderExterior: () => undefined,
			renderIndoorNodes: (_target, nodeIds) => {
				submittedNodeIds.push(...nodeIds);
				if (nodeIds.includes(ROOT as never)) drawRootRoom(gl, program);
				if (nodeIds.includes(LEFT as never)) drawLeftRoom(gl, program);
				if (nodeIds.includes(RIGHT as never)) drawRightRoom(gl, program);
				if (nodeIds.includes(TARGET as never)) drawTargetRoom(gl, program);
			},
			resolveVisibilityAperture: (apertureId) => {
				const geometry = apertures.get(apertureId);
				if (!geometry)
					throw new Error(`Missing fixture aperture ${apertureId}.`);
				return {
					clipFromLocal: FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
					geometry,
					indexCount: geometry.indexCount,
					indexStart: 0,
				};
			},
		});
		const leftTarget = readFixturePixel(gl, 2, 4);
		const rightTarget = readFixturePixel(gl, 8, 4);
		const parentWall = readFixturePixel(gl, 6, 4);
		const rootWall = readFixturePixel(gl, 6, 7);
		const concaveNotch = readFixturePixel(gl, 4, 6);
		const alphaDiscard = readFixturePixel(gl, 3, 3);
		const alphaKeep = readFixturePixel(gl, 9, 3);
		const reverseTrace = executePortalGraph(substrate, {
			clearColor: normalizedFixtureColor(BLUE),
			destination: null,
			extent: EXTENT,
			plan: reverseStraddlePlan(),
			renderExterior: () => undefined,
			renderIndoorNodes: (_target, nodeIds) => {
				if (nodeIds.includes(TARGET as never)) drawRootRoom(gl, program);
				if (nodeIds.includes(LEFT as never)) drawTargetRoom(gl, program);
			},
			resolveVisibilityAperture: () => {
				throw new Error(
					"Reverse straddle fixture must execute its near-clip window directly.",
				);
			},
		});
		const reverseReachedTarget = readFixturePixel(gl, 2, 4);
		const reverseOppositeOpening = readFixturePixel(gl, 8, 4);
		substrate.restoreOrdinaryPass(null, destinationExtent);
		const webGlError = gl.getError();
		if (webGlError !== gl.NO_ERROR) {
			throw new Error(
				`Internal portal execution fixture failed with WebGL error ${webGlError}.`,
			);
		}
		return {
			alphaTestPassed:
				fixturePixelMatches(alphaDiscard, MASKED_BLEND) &&
				fixturePixelMatches(alphaKeep, MASKED_ALPHA_TEST_BLEND),
			exactMaskConfinementPassed:
				fixturePixelMatches(rootWall, BLUE) &&
				fixturePixelMatches(concaveNotch, BLUE) &&
				fixturePixelMatches(parentWall, BLUE),
			layerUnionPassed:
				fixturePixelMatches(leftTarget, MASKED_BLEND) &&
				fixturePixelMatches(rightTarget, MASKED_BLEND),
			materialOrderingPassed:
				fixturePixelMatches(leftTarget, MASKED_BLEND) &&
				fixturePixelMatches(rightTarget, MASKED_BLEND),
			nearPlaneDualSidePassed:
				trace.nearPlaneSeedCount === 0 &&
				reverseTrace.nearPlaneSeedCount === 1 &&
				fixturePixelMatches(leftTarget, MASKED_BLEND) &&
				fixturePixelMatches(rootWall, BLUE) &&
				fixturePixelMatches(reverseReachedTarget, MASKED_BLEND) &&
				fixturePixelMatches(reverseOppositeOpening, BLUE),
			nestedDepthConfinementPassed:
				fixturePixelMatches(parentWall, BLUE) &&
				fixturePixelMatches(leftTarget, MASKED_BLEND) &&
				fixturePixelMatches(rightTarget, MASKED_BLEND),
			pixels: {
				alphaDiscard: [...alphaDiscard],
				alphaKeep: [...alphaKeep],
				concaveNotch: [...concaveNotch],
				leftTarget: [...leftTarget],
				parentWall: [...parentWall],
				rightTarget: [...rightTarget],
				rootWall: [...rootWall],
			},
			reversePixels: {
				oppositeOpening: [...reverseOppositeOpening],
				reachedTarget: [...reverseReachedTarget],
			},
			reverseTrace,
			trace,
			uniqueNodeSubmissionPassed:
				submittedNodeIds.length === 4 &&
				new Set(submittedNodeIds).size === submittedNodeIds.length,
		};
	} finally {
		substrate.destroy();
		for (const key of geometryKeys) resources.releaseResource(key);
		destroyPortalFixtureSceneProgram(gl, program);
	}
}

function reverseStraddlePlan(): PortalRenderWorkPlan {
	const reverseCrossing =
		"portal-crossing:fixture/target-left" as PortalCrossingId;
	const reverseEdge = edge(
		reverseCrossing,
		TARGET,
		LEFT,
		"root-left",
		createReverseStraddleWindow(),
	);
	const nodes = [
		node(TARGET, 0, "0x00010103", []),
		node(LEFT, 1, "0x00010101", [reverseCrossing]),
	];
	return {
		capacity: {
			maximumAvailableStencilValue: 255,
			maximumRenderLayer: 1,
			requiredMaximumStencilValue: 1,
		},
		diagnostics: {
			admittedScopeWindowStateCount: 2,
			attemptedCrossingCount: 1,
			componentCount: 2,
			cyclicComponentCount: 0,
			duplicateOrSubsumedWindowStateCount: 0,
			emptyWindowCount: 0,
			maximumRetainedFragmentsPerScope: 1,
			nearPlaneSeedCount: 1,
			projection: emptyFixtureProjectionDiagnostics(),
			rejectedFacingCrossingCount: 0,
			sameDomainBoundaryCrossingCount: 0,
			retainedMaskEdgeCount: 1,
			retainedRenderNodeCount: 2,
			workItemCount: 2,
		},
		exteriorTransitions: [],
		maskEdges: [reverseEdge],
		nodes,
		renderLayers: [
			indoorLayer(0, [TARGET]),
			indoorLayer(1, [LEFT], [reverseCrossing]),
		],
		rootNodeId: TARGET,
		selectedScopes: nodes.flatMap((value) => value.scopes),
		topologyRevision: 1,
	} as PortalRenderWorkPlan;
}

type SceneProgram = ReturnType<typeof createPortalFixtureSceneProgram>;

function drawRootRoom(gl: WebGL2RenderingContext, program: SceneProgram): void {
	for (const [minimum, maximum] of [
		[
			[-1, -1],
			[1, -0.8],
		],
		[
			[-1, 0.8],
			[1, 1],
		],
		[
			[-1, -0.8],
			[-0.9, 0.8],
		],
		[
			[-0.1, -0.8],
			[0.1, 0.8],
		],
		[
			[0.9, -0.8],
			[1, 0.8],
		],
		[
			[-0.5, 0],
			[-0.1, 0.8],
		],
	] as const) {
		drawPortalFixtureScene(gl, program, {
			color: normalizedFixtureColor(BLUE),
			depth: 0.4,
			kind: "opaque",
			maximum,
			minimum,
		});
	}
}

function drawLeftRoom(gl: WebGL2RenderingContext, program: SceneProgram): void {
	drawRoomWithOpening(
		gl,
		program,
		[-0.9, -0.8, -0.1, 0.8],
		[-0.75, -0.4, -0.35, 0.4],
	);
}

function drawRightRoom(
	gl: WebGL2RenderingContext,
	program: SceneProgram,
): void {
	drawRoomWithOpening(
		gl,
		program,
		[0.1, -0.8, 0.9, 0.8],
		[0.35, -0.4, 0.75, 0.4],
	);
}

function drawRoomWithOpening(
	gl: WebGL2RenderingContext,
	program: SceneProgram,
	room: readonly [number, number, number, number],
	opening: readonly [number, number, number, number],
): void {
	const [roomMinX, roomMinY, roomMaxX, roomMaxY] = room;
	const [openMinX, openMinY, openMaxX, openMaxY] = opening;
	for (const [minimum, maximum] of [
		[
			[roomMinX, roomMinY],
			[roomMaxX, openMinY],
		],
		[
			[roomMinX, openMaxY],
			[roomMaxX, roomMaxY],
		],
		[
			[roomMinX, openMinY],
			[openMinX, openMaxY],
		],
		[
			[openMaxX, openMinY],
			[roomMaxX, openMaxY],
		],
	] as const) {
		drawPortalFixtureScene(gl, program, {
			color: normalizedFixtureColor(GREEN),
			depth: 0.5,
			kind: "opaque",
			maximum,
			minimum,
		});
	}
}

function drawTargetRoom(
	gl: WebGL2RenderingContext,
	program: SceneProgram,
): void {
	for (const [minimum, maximum] of [
		[
			[-0.75, -0.4],
			[-0.35, 0.4],
		],
		[
			[0.35, -0.4],
			[0.75, 0.4],
		],
	] as const) {
		drawPortalFixtureScene(gl, program, {
			color: [0.1, 0.5, 0.1, 1],
			depth: 0.7,
			kind: "opaque",
			maximum,
			minimum,
		});
	}
	drawPortalFixtureScene(gl, program, {
		color: [1, 0, 0, -1],
		depth: 0.6,
		kind: "alpha-test",
		maximum: [-0.5, 0],
		minimum: [-0.75, -0.4],
	});
	drawPortalFixtureScene(gl, program, {
		color: [0.1, 0.8, 0.8, 1],
		depth: 0.6,
		kind: "alpha-test",
		maximum: [0.75, 0],
		minimum: [0.5, -0.4],
	});
	for (const [minimum, maximum] of [
		[
			[-0.75, -0.4],
			[-0.35, 0.4],
		],
		[
			[0.35, -0.4],
			[0.75, 0.4],
		],
	] as const) {
		drawPortalFixtureScene(gl, program, {
			color: [0.2, 0.2, 0.8, 0.5],
			depth: 0.55,
			kind: "transparent",
			maximum,
			minimum,
		});
		drawPortalFixtureScene(gl, program, {
			color: [0.1, 0.05, 0, 0.25],
			depth: 0.5,
			kind: "additive",
			maximum,
			minimum,
		});
	}
}

function internalFixturePlan(): PortalRenderWorkPlan {
	const rootLeft = edge(ROOT_LEFT, ROOT, LEFT, "root-left");
	const rootRight = edge(ROOT_RIGHT, ROOT, RIGHT, "root-right");
	const leftTarget = edge(LEFT_TARGET, LEFT, TARGET, "left-target");
	const rightTarget = edge(RIGHT_TARGET, RIGHT, TARGET, "right-target");
	const nodes = [
		node(ROOT, 0, "0x00010100", []),
		node(LEFT, 1, "0x00010101", [ROOT_LEFT]),
		node(RIGHT, 1, "0x00010102", [ROOT_RIGHT]),
		node(TARGET, 2, "0x00010103", [LEFT_TARGET, RIGHT_TARGET]),
	];
	return {
		capacity: {
			maximumAvailableStencilValue: 255,
			maximumRenderLayer: 2,
			requiredMaximumStencilValue: 2,
		},
		diagnostics: {
			admittedScopeWindowStateCount: 5,
			attemptedCrossingCount: 4,
			componentCount: 4,
			cyclicComponentCount: 0,
			duplicateOrSubsumedWindowStateCount: 1,
			emptyWindowCount: 0,
			maximumRetainedFragmentsPerScope: 2,
			nearPlaneSeedCount: 0,
			projection: emptyFixtureProjectionDiagnostics(),
			rejectedFacingCrossingCount: 0,
			sameDomainBoundaryCrossingCount: 0,
			retainedMaskEdgeCount: 4,
			retainedRenderNodeCount: 4,
			workItemCount: 5,
		},
		exteriorTransitions: [],
		maskEdges: [rootLeft, rootRight, leftTarget, rightTarget],
		nodes,
		renderLayers: [
			indoorLayer(0, [ROOT]),
			indoorLayer(1, [LEFT, RIGHT], [ROOT_LEFT, ROOT_RIGHT]),
			indoorLayer(2, [TARGET], [LEFT_TARGET, RIGHT_TARGET]),
		],
		rootNodeId: ROOT,
		selectedScopes: nodes.flatMap((value) => value.scopes),
		topologyRevision: 1,
	} as PortalRenderWorkPlan;
}

function indoorLayer(
	renderLayer: number,
	renderNodeIds: readonly PortalRenderWorkPlan["nodes"][number]["id"][],
	maskEdgeIds: readonly PortalCrossingId[] = [],
): PortalRenderWorkPlan["renderLayers"][number] {
	return {
		contributions: [
			{
				kind: "indoor",
				maskEdgeIds,
				renderNodeIds,
				stencilValue: renderLayer,
			},
		],
		renderLayer,
	};
}

function edge(
	crossingId: PortalCrossingId,
	sourceNodeId: string,
	targetNodeId: string,
	apertureSuffix: string,
	nearClipWindow: PortalViewWindow | null = null,
): PortalRenderWorkPlan["maskEdges"][number] {
	return {
		crossingId,
		maskSource: nearClipWindow
			? { kind: "near-clip-window", window: nearClipWindow }
			: {
					kind: "world-aperture",
					visibilityApertureId: `portal-aperture:fixture/${apertureSuffix}`,
				},
		sourceNodeId,
		spatialRelationship: {
			kind: "indoor-topology-boundary",
			reason: "fixture",
		},
		targetNodeId,
	} as PortalRenderWorkPlan["maskEdges"][number];
}

/** Confine the reverse straddle to the left opening instead of granting full-screen ownership. */
function createReverseStraddleWindow(): PortalViewWindow {
	const window = createPortalViewWindow([
		[
			new Vec2(-0.9, -0.8),
			new Vec2(-0.1, -0.8),
			new Vec2(-0.1, 0.8),
			new Vec2(-0.9, 0.8),
		],
	]);
	if (!window) throw new Error("Reverse straddle fixture window is empty.");
	return window;
}

function node(
	id: string,
	renderLayer: number,
	envCellId: string,
	incomingMaskEdgeIds: readonly PortalCrossingId[],
): PortalRenderWorkPlan["nodes"][number] {
	return {
		id,
		incomingMaskEdgeIds,
		kind: "indoor-visibility-island",
		renderLayer,
		scopes: [
			{
				envCellId,
				kind: "env-cell",
				landblockId: "0x0001ffff",
			} satisfies SceneScope,
		],
	} as PortalRenderWorkPlan["nodes"][number];
}

function createPortalGeometry(
	resources: WebGL2ResourceManager,
	bounds: readonly [number, number, number, number],
): GeometryResourceKey {
	const [minX, minY, maxX, maxY] = bounds;
	return createPortalFixtureGeometry(resources, {
		indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
		positions: new Float32Array([
			minX,
			minY,
			0,
			maxX,
			minY,
			0,
			maxX,
			maxY,
			0,
			minX,
			maxY,
			0,
		]),
	});
}

/** Left root opening with a missing upper-right notch to prove non-rectangular confinement. */
function createConcaveRootPortalGeometry(
	resources: WebGL2ResourceManager,
): GeometryResourceKey {
	return resources.createGeometry({
		indices: new Uint16Array([0, 1, 3, 1, 2, 3, 0, 3, 5, 3, 4, 5]),
		kind: "portal-aperture",
		positions: new Float32Array([
			-0.9, -0.8, 0, -0.1, -0.8, 0, -0.1, 0, 0, -0.5, 0, 0, -0.5, 0.8, 0, -0.9,
			0.8, 0,
		]),
	});
}
