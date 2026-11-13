import {
	createPortalModelAperture,
	createPortalModelScene,
	portalModelBatchId,
	portalModelCrossingId,
	portalModelDepth,
	portalModelDomainId,
	portalModelFragmentId,
	portalModelPixel,
	portalModelScopeId,
	portalModelSubmissionId,
	type PortalModelScene,
	type PortalModelScopeId,
} from "./portal-model";
import { getLandblockCoordinates } from "../landblocks";
import {
	createOrthographicMat4,
	createPerspectiveMat4,
} from "../math/matrices";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type {
	ScenePortalCrossing,
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import { scopeKey } from "../scene/scope";
import type { PlanarAperture } from "../scene/planar-aperture";
import { composePortalReferenceFrameThroughPathDepth } from "./portal-reference-compositor";
import {
	createPortalRenderCapacityPolicy,
	PORTAL_RENDER_CAPACITY_POLICY,
} from "./portal-render-capacity-policy";
import { PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS } from "./portal-envelope-sampling-glsl";
import {
	PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE,
	PORTAL_ARRIVAL_METADATA_JUNCTION_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
	PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES,
} from "./portal-arrival-metadata";
import {
	PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL,
	PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL,
	PORTAL_CROSSING_NEAR_CLIP_RAY_FLAG,
	PORTAL_CROSSING_TRIANGLE_POLICY_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
	PortalPropagationStreamArena,
	type PortalCrossingTriangleStreamView,
	type PortalPropagationExecutionScheduleView,
	type PortalPropagationMetadataStreamView,
} from "./portal-crossing-triangle-stream";
import {
	PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES,
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
	portalPropagationMetadataUsedByteLength,
} from "./portal-propagation-metadata";
import { writePortalScopeTileMetadata } from "./portal-scope-tile-metadata";
import { createCameraNearClipVolume } from "./portal-near-plane";
import {
	PORTAL_QUAD_MODE_MAX_REDUCE,
	PORTAL_QUAD_MODE_ROOT_ROUND0_CLAMP,
	PortalScopeAtlasPlanner,
	type PortalScopeAtlasFrameView,
} from "./portal-scope-atlas-planner";
import { WebGL2PortalScopeAtlasExecutor } from "./webgl2-portal-scope-atlas-executor";
import {
	WebGL2PortalScopeAtlasTargets,
	type WebGL2PortalScopeAtlasTargetSet,
} from "./webgl2-portal-scope-atlas-targets";
import {
	bindWebGL2PortalDeferredVisibilityProgram,
	PORTAL_DEFERRED_VISIBILITY_GLSL,
	type WebGL2PortalDeferredVisibilityUniforms,
} from "./portal-deferred-visibility-glsl";
import { PORTAL_SCOPE_ATLAS_TEXTURE_UNITS } from "./portal-scope-atlas-command-model";
import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import { PARTICLE_FRAGMENT_SHADER } from "./webgl2-particle-program";

// Tile interiors must exceed the resolve shader's 2-texel envelope gutter or confinement becomes
// untestable: on the original 4x4 tiles the gutter's 5x5 search spanned every texel, so every
// domain leaked everywhere and the nearest tile won the whole screen.
const DRAWING_EXTENT = { height: 12, width: 12 } as const;
const ATLAS_EXTENT = { height: 12, width: 48 } as const;
const METADATA_BINDING_POINT = 0;
const ROOT_COLOR = [204, 51, 26, 255] as const;
const MIDDLE_COLOR = [204, 204, 26, 255] as const;
const DEEP_COLOR = [26, 204, 204, 255] as const;
const LEAF_COLOR = [51, 204, 51, 255] as const;
const WEATHER_COLOR = [77, 128, 230, 255] as const;
const CLEAR_COLOR = [26, 51, 204, 255] as const;
const CLEAR_COLOR_NORMALIZED = [
	CLEAR_COLOR[0] / 255,
	CLEAR_COLOR[1] / 255,
	CLEAR_COLOR[2] / 255,
	CLEAR_COLOR[3] / 255,
] as const;
const STALE_OUTPUT_COLOR = [13, 240, 99, 255] as const;
/** Screen pixels covered by the fixture crossings' NDC [-0.5, 0.5] quad. */
const CENTER_PIXELS = new Set(
	Array.from(
		{ length: DRAWING_EXTENT.width * DRAWING_EXTENT.height },
		(_, pixel) => pixel,
	).filter((pixel) => {
		const x = pixel % DRAWING_EXTENT.width;
		const y = Math.floor(pixel / DRAWING_EXTENT.width);
		const low = DRAWING_EXTENT.width / 4;
		const high = (DRAWING_EXTENT.width * 3) / 4 - 1;
		return x >= low && x <= high && y >= low && y <= high;
	}),
);
const FIXTURE_LANDBLOCK_ID = "0x0001ffff";
const STRADDLE_CLIP_FROM_ANCHOR = createPerspectiveMat4(90, 1, 0.5, 100);
const FIXTURE_ROOT_SCOPE = { kind: "outdoor" } as const satisfies SceneScope;
const FIXTURE_CHILD_SCOPE = {
	envCellId: "scope-atlas-packed-child",
	kind: "env-cell",
	landblockId: FIXTURE_LANDBLOCK_ID,
} as const satisfies SceneScope;
const PRODUCTION_PACKED_FIXTURE_POLICY = createPortalRenderCapacityPolicy({
	maximumAuthoredApertureVertexCount: 4,
	maximumPathDepth: 1,
	maximumProjectionPrimitiveCount: 256,
	maximumScopeWindowWorkItemCount: 4,
	scopeAtlas: {
		columnCount: 4,
		maximumArrivalStateCount: 2,
		maximumCrossingTriangleVertexCount: 6,
		rowCount: 1,
	},
});

/** Numeric real-GPU evidence for the shader substrate against the independent ray oracle. */
export interface WebGL2PortalScopeAtlasExecutorFixtureResult {
	readonly deferredCompositionMatchesOracle: boolean;
	readonly deferredPixels: readonly number[];
	readonly depth16BranchingChildCycleDeferredMatchesOracle: boolean;
	readonly depth16BranchingChildCycleMetrics: {
		readonly atlasHeight: number;
		readonly atlasWidth: number;
		readonly drawingBufferHeight: number;
		readonly drawingBufferWidth: number;
		readonly maskPropagationInstanceCount: number;
		readonly minimumRoundCrossingCount: number;
		readonly opaqueCompositeInstanceCount: number;
		readonly round0ApertureCoverageRatio: number;
		readonly round0ScissorCoverageRatio: number;
		readonly scopeEnvelopeReductionInstanceCount: number;
		readonly tileCount: number;
		readonly traversalDepth: number;
	};
	readonly depth16BranchingChildCycleResolveMatchesOracle: boolean;
	readonly depth16CyclicMultiWindowDeferredMatchesOracle: boolean;
	readonly depth16CyclicMultiWindowResolveMatchesOracle: boolean;
	readonly exteriorWeatherComposesBehindChildOpaque: boolean;
	readonly frontierMatchesOracle: boolean;
	/** Shared junction ids license the zero-thickness A->exterior->B advance at equal depth. */
	readonly junctionZeroThicknessTransitMatchesOracle: boolean;
	readonly junctionPixels: readonly number[];
	readonly expectedJunctionPixels: readonly number[];
	/** Without a junction id, the same equal-depth advance stays rejected (today's behavior). */
	readonly junctionAbsentEqualDepthIsRejected: boolean;
	/** A covered coplanar source surface wins despite independent transform rounding. */
	readonly materialBearingCoplanarSurfaceOccludesMask: boolean;
	/** A one-pixel opening remains visible even when its neighbors are coplanar walls. */
	readonly materialBearingOpeningRetainsBoundaryPixels: boolean;
	readonly strictPixels: readonly number[];
	readonly expectedStrictPixels: readonly number[];
	readonly straddlePixels: readonly number[];
	readonly expectedStraddlePixels: readonly number[];
	readonly opaqueOcclusionMatchesOracle: boolean;
	readonly nearPlaneStraddleMatchesOracle: boolean;
	readonly nearPlaneStraddleOrdinaryPolicyIsRejected: boolean;
	readonly productionPackedHostileSamplerResolveMatchesOracle: boolean;
	readonly productionPackedResolveMatchesOracle: boolean;
	readonly propagatedResolveMatchesOracle: boolean;
	/** Particle alpha layers use resolved opaque depth; the independent oracle has no scope filter. */
	readonly particleDepthCompositionMatchesOracle: boolean;
	readonly expectedParticlePixels: readonly number[];
	readonly particlePixels: readonly number[];
	readonly rootOnlyResolveMatchesOracle: boolean;
	/** Consecutive frames with shrinking windows, camera pan/zoom, and parity flips without full clears. */
	readonly shrinkingMultiFrameFrontierMatchesOracle: boolean;
	readonly weatherPixels: readonly number[];
	readonly propagatedPixels: readonly number[];
	readonly expectedPropagatedPixels: readonly number[];
}

/** Execute actual GLSL; this fixture has no screenshot or timing dependency. */
export function runWebGL2PortalScopeAtlasExecutorFixture(
	gl: WebGL2RenderingContext,
): WebGL2PortalScopeAtlasExecutorFixtureResult {
	if (
		gl.drawingBufferWidth < DRAWING_EXTENT.width ||
		gl.drawingBufferHeight < DRAWING_EXTENT.height
	) {
		throw new Error(
			`Portal shader fixture requires a ${DRAWING_EXTENT.width}x${DRAWING_EXTENT.height} drawing buffer.`,
		);
	}
	const materialBearingBoundary = runMaterialBearingBoundaryFixture(gl);
	const depth16CyclicMultiWindow = runDepth16CyclicMultiWindowFixture(gl);
	const depth16BranchingChildCycle = runDepth16BranchingChildCycleFixture(gl);
	const shrinkingMultiFrameFrontier = runShrinkingMultiFrameFrontierFixture(gl);
	const state = captureState(gl, METADATA_BINDING_POINT);
	const targetOwner = new WebGL2PortalScopeAtlasTargets(gl);
	const executor = new WebGL2PortalScopeAtlasExecutor(
		gl,
		18,
		METADATA_BINDING_POINT,
	);
	try {
		const targets = targetOwner.resize({
			atlas: ATLAS_EXTENT,
			drawingBuffer: DRAWING_EXTENT,
		});
		seedSceneAtlas(gl, targets);
		clearOutput(gl);
		const propagatedStream = createPropagationStream();
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream: propagatedStream,
			targets,
			traversalDepth: 3,
		});
		const propagatedPixels = readOutput(gl);
		const frontier = readFrontier(gl, targets);
		const expectedPropagatedPixels = expectedPixelsFromOracle(8);

		seedSceneAtlas(gl, targets, 0.2);
		clearOutput(gl);
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream: propagatedStream,
			targets,
			traversalDepth: 3,
		});
		const occludedPixels = readOutput(gl);
		const expectedOccludedPixels = expectedPixelsFromOracle(2);

		seedSceneAtlas(gl, targets);
		clearOutput(gl);
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream: createRootOnlyStream(),
			targets,
			traversalDepth: 0,
		});
		const rootOnlyPixels = readOutput(gl);

		const junctionStream = createJunctionStream(true);
		seedJunctionSceneAtlas(gl, targets);
		clearOutput(gl);
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream: junctionStream,
			targets,
			traversalDepth: 2,
		});
		const junctionPixels = readOutput(gl);
		const expectedJunctionPixels = expectedWinnerPixels(DEEP_COLOR, null);

		const strictStream = createJunctionStream(false);
		seedJunctionSceneAtlas(gl, targets);
		clearOutput(gl);
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream: strictStream,
			targets,
			traversalDepth: 2,
		});
		const strictPixels = readOutput(gl);
		const expectedStrictPixels = expectedWinnerPixels(MIDDLE_COLOR, null);

		const productionPackedFrame = createProductionPackedFrame();
		const productionPackedStream = new PortalPropagationStreamArena(
			6,
			PRODUCTION_PACKED_FIXTURE_POLICY.maximumPathDepth,
		).prepare(
			productionPackedFrame,
			getLandblockCoordinates(FIXTURE_LANDBLOCK_ID),
			Mat4.identity(),
		);
		seedProductionPackedSceneAtlas(gl, targets, productionPackedFrame);
		clearOutput(gl);
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream: productionPackedStream,
			targets,
			traversalDepth: productionPackedFrame.commands.traversalDepth,
		});
		const productionPackedPixels = readOutput(gl);
		const expectedProductionPackedPixels = solidPixels(ROOT_COLOR);
		for (const pixel of CENTER_PIXELS) {
			expectedProductionPackedPixels.set(LEAF_COLOR, pixel * 4);
		}

		const straddleFrame = createProductionPackedFrame("near-plane-straddle");
		const straddleStream = new PortalPropagationStreamArena(
			6,
			PRODUCTION_PACKED_FIXTURE_POLICY.maximumPathDepth,
		).prepare(
			straddleFrame,
			getLandblockCoordinates(FIXTURE_LANDBLOCK_ID),
			STRADDLE_CLIP_FROM_ANCHOR,
		);
		setNearClipRayPolicy(straddleStream, false);
		// Root opaque sits behind the aperture. The ordinary-policy control is blocked by near-plane
		// clipping of the straddling aperture, not by source-depth occlusion; a nearer root seed
		// would win the resolve outright and make the straddle result indistinguishable from it.
		seedProductionPackedSceneAtlas(gl, targets, straddleFrame);
		clearOutput(gl);
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream: straddleStream,
			targets,
			traversalDepth: straddleFrame.commands.traversalDepth,
		});
		const ordinaryPolicyStraddlePixels = readOutput(gl);
		setNearClipRayPolicy(straddleStream, true);
		seedProductionPackedSceneAtlas(gl, targets, straddleFrame);
		clearOutput(gl);
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream: straddleStream,
			targets,
			traversalDepth: straddleFrame.commands.traversalDepth,
		});
		const straddlePixels = readOutput(gl);
		const expectedStraddlePixels = expectedWinnerPixels(LEAF_COLOR, {
			height: straddleFrame.tileHeight(1),
			width: straddleFrame.tileWidth(1),
			x: straddleFrame.tileScreenX(1),
			y: straddleFrame.tileScreenY(1),
		});

		seedProductionPackedSceneAtlas(gl, targets, productionPackedFrame);
		clearOutput(gl);
		const productionPackedHostileSampler = executeWithHostileSamplers(
			gl,
			() => {
				executor.execute({
					clearColor: CLEAR_COLOR_NORMALIZED,
					outputExtent: DRAWING_EXTENT,
					outputFramebuffer: null,
					stream: productionPackedStream,
					targets,
					traversalDepth: productionPackedFrame.commands.traversalDepth,
				});
				return readOutput(gl);
			},
		);
		seedProductionPackedSceneAtlas(gl, targets, productionPackedFrame);
		paintPlannedTileColor(gl, targets, productionPackedFrame, 0, WEATHER_COLOR);
		clearOutput(gl);
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream: productionPackedStream,
			targets,
			traversalDepth: productionPackedFrame.commands.traversalDepth,
		});
		const weatherPixels = readOutput(gl);
		const expectedWeatherPixels = solidPixels(WEATHER_COLOR);
		for (const pixel of CENTER_PIXELS) {
			expectedWeatherPixels.set(LEAF_COLOR, pixel * 4);
		}
		const deferred = runDeferredCompositionFixture(
			gl,
			executor,
			targets,
			productionPackedStream,
			productionPackedFrame,
		);
		requireNoWebGL2Error(gl, "after portal scope-atlas shader execution");

		return {
			deferredCompositionMatchesOracle: pixelRgbMatches(
				deferred.transparentPixels,
				deferred.expectedTransparentPixels,
			),
			deferredPixels: [...deferred.transparentPixels],
			...depth16BranchingChildCycle,
			...depth16CyclicMultiWindow,
			exteriorWeatherComposesBehindChildOpaque: pixelsMatch(
				weatherPixels,
				expectedWeatherPixels,
			),
			expectedPropagatedPixels: [...expectedPropagatedPixels],
			frontierMatchesOracle: frontier.every(
				(value, pixel) => value === (CENTER_PIXELS.has(pixel) ? 4 : 0),
			),
			junctionZeroThicknessTransitMatchesOracle: pixelsMatch(
				junctionPixels,
				expectedJunctionPixels,
			),
			junctionPixels: [...junctionPixels],
			expectedJunctionPixels: [...expectedJunctionPixels],
			junctionAbsentEqualDepthIsRejected: pixelsMatch(
				strictPixels,
				expectedStrictPixels,
			),
			...materialBearingBoundary,
			strictPixels: [...strictPixels],
			expectedStrictPixels: [...expectedStrictPixels],
			opaqueOcclusionMatchesOracle: pixelsMatch(
				occludedPixels,
				expectedOccludedPixels,
			),
			nearPlaneStraddleMatchesOracle: pixelsMatch(
				straddlePixels,
				expectedStraddlePixels,
			),
			straddlePixels: [...straddlePixels],
			expectedStraddlePixels: [...expectedStraddlePixels],
			nearPlaneStraddleOrdinaryPolicyIsRejected: pixelsMatch(
				ordinaryPolicyStraddlePixels,
				solidPixels(ROOT_COLOR),
			),
			particleDepthCompositionMatchesOracle: pixelRgbMatches(
				deferred.particlePixels,
				deferred.expectedParticlePixels,
			),
			expectedParticlePixels: [...deferred.expectedParticlePixels],
			particlePixels: [...deferred.particlePixels],
			productionPackedResolveMatchesOracle: pixelsMatch(
				productionPackedPixels,
				expectedProductionPackedPixels,
			),
			productionPackedHostileSamplerResolveMatchesOracle:
				productionPackedHostileSampler.error === gl.NO_ERROR &&
				pixelsMatch(
					productionPackedHostileSampler.pixels,
					expectedProductionPackedPixels,
				),
			propagatedPixels: [...propagatedPixels],
			propagatedResolveMatchesOracle: pixelsMatch(
				propagatedPixels,
				expectedPropagatedPixels,
			),
			rootOnlyResolveMatchesOracle: pixelsMatch(
				rootOnlyPixels,
				solidPixels(ROOT_COLOR),
			),
			...shrinkingMultiFrameFrontier,
			weatherPixels: [...weatherPixels],
		};
	} finally {
		executor.destroy();
		targetOwner.destroy();
		restoreState(gl, state, METADATA_BINDING_POINT);
	}
}

/** Build the smallest real planner-to-arena stream containing a conservative child tile. */
function createProductionPackedFrame(
	kind: "ordinary" | "near-plane-straddle" = "ordinary",
): PortalScopeAtlasFrameView {
	const planner = new PortalScopeAtlasPlanner(
		PRODUCTION_PACKED_FIXTURE_POLICY.culler,
		PRODUCTION_PACKED_FIXTURE_POLICY.maximumPathDepth,
	);
	const input = createProductionPackedInput(kind);
	const frame = planner.plan(createProductionPackedTopology(kind), input, {
		atlas: ATLAS_EXTENT,
		drawingBuffer: DRAWING_EXTENT,
		maximumArrivalStateCount:
			PRODUCTION_PACKED_FIXTURE_POLICY.scopeAtlas.maximumArrivalStateCount,
		maximumCrossingTriangleVertexCount:
			PRODUCTION_PACKED_FIXTURE_POLICY.scopeAtlas
				.maximumCrossingTriangleVertexCount,
	});
	// The two variants have different child-tile contracts. Ordinary admission projects the
	// aperture to a tight window; near-plane-straddle admission cannot project a polygon crossing
	// the eye plane and instead admits conservatively through the finite near-clip volume, which
	// yields a wider origin-anchored window. Both are asserted exactly so culler drift in either
	// path fails loudly here rather than surfacing as a silent pixel change.
	const expectedTile =
		kind === "near-plane-straddle"
			? { screenX: 2, screenY: 2, size: 7 }
			: { screenX: 3, screenY: 3, size: 6 };
	if (
		frame.tileCount !== 2 ||
		frame.visibility.selectedCrossingCount !== 1 ||
		frame.tileScreenX(1) !== expectedTile.screenX ||
		frame.tileScreenY(1) !== expectedTile.screenY ||
		frame.tileWidth(1) !== expectedTile.size ||
		frame.tileHeight(1) !== expectedTile.size
	) {
		throw new Error(
			`Production-packed fixture did not retain its ${expectedTile.size}x${expectedTile.size} child tile: ` +
				`tiles=${frame.tileCount} crossings=${frame.visibility.selectedCrossingCount} ` +
				`screen=(${frame.tileScreenX(1)},${frame.tileScreenY(1)}) ` +
				`extent=${frame.tileWidth(1)}x${frame.tileHeight(1)}.`,
		);
	}
	return frame;
}

function createProductionPackedInput(kind: "ordinary" | "near-plane-straddle") {
	const straddlesNearPlane = kind === "near-plane-straddle";
	return {
		anchorCoordinates: getLandblockCoordinates(FIXTURE_LANDBLOCK_ID),
		clipFromAnchor: straddlesNearPlane
			? STRADDLE_CLIP_FROM_ANCHOR
			: Mat4.identity(),
		nearClipVolume: createCameraNearClipVolume(
			{ fov: 90, near: 0.5 },
			{
				position: new Vec3(0, 0, straddlesNearPlane ? 0 : 1),
				rotation: Quat.identity(),
			},
			1,
		),
		portalFootprint: { drawingBuffer: DRAWING_EXTENT, minimumPixelArea: 0 },
		rootScope: FIXTURE_ROOT_SCOPE,
	};
}

function createProductionPackedTopology(
	kind: "ordinary" | "near-plane-straddle",
): SceneTopologyView {
	const straddlesNearPlane = kind === "near-plane-straddle";
	const crossing = createFixtureCrossing(
		"scope-atlas-packed-child",
		FIXTURE_ROOT_SCOPE,
		FIXTURE_CHILD_SCOPE,
		straddlesNearPlane ? -0.25 : 0,
		straddlesNearPlane ? 0.125 : 0.5,
	);
	const scopes: readonly SceneTopologyScope[] = [
		{
			potentiallyVisibleEnvCellIds: new Set(),
			scope: FIXTURE_ROOT_SCOPE,
			visibilityIslandId: null,
		},
		{
			potentiallyVisibleEnvCellIds: new Set(),
			scope: FIXTURE_CHILD_SCOPE,
			visibilityIslandId: "env-cell-island:scope-atlas-packed-child",
		},
	];
	return {
		crossings: [crossing],
		outgoing: (scope) => (scope.kind === "outdoor" ? [crossing] : []),
		revision: 1,
		scopes,
	};
}

function createFixtureCrossing(
	id: string,
	source: SceneScope,
	target: SceneScope,
	z: number,
	halfExtent: number,
): ScenePortalCrossing {
	const aperture = rectangleAperture(
		-halfExtent,
		-halfExtent,
		halfExtent,
		halfExtent,
		z,
	);
	const sceneAperture: ScenePortalCrossing["sourceAperture"] = {
		id: `portal-aperture:${id}` as const,
		indices: aperture.indices,
		landblockBounds: boundsForAperture(aperture),
		landblockId: FIXTURE_LANDBLOCK_ID,
		plane: aperture.plane,
		vertices: aperture.vertices,
	};
	return {
		acceptedSide: "positive",
		exactMatch: true,
		id: `portal-crossing:${id}`,
		junctionGroupId: null,
		maskDepthPolicy: "allow-equal-depth",
		reciprocalCrossingId: null,
		source,
		sourceAperture: sceneAperture,
		spatialRelationship: {
			kind: "indoor-topology-boundary",
			reason: "synthetic-boundary",
		},
		target,
		visibilityAperture: sceneAperture,
	};
}

function rectangleAperture(
	minimumX: number,
	minimumY: number,
	maximumX: number,
	maximumY: number,
	z: number,
): PlanarAperture {
	return {
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
		plane: { d: -z, normal: new Vec3(0, 0, 1) },
		vertices: new Float32Array([
			minimumX,
			minimumY,
			z,
			maximumX,
			minimumY,
			z,
			maximumX,
			maximumY,
			z,
			minimumX,
			maximumY,
			z,
		]),
	};
}

function boundsForAperture(aperture: PlanarAperture): AABB3 {
	const minimum = new Vec3(
		aperture.vertices[0]!,
		aperture.vertices[1]!,
		aperture.vertices[2]!,
	);
	const bounds = new AABB3(minimum.clone(), minimum.clone());
	for (let index = 3; index < aperture.vertices.length; index += 3) {
		const x = aperture.vertices[index]!;
		const y = aperture.vertices[index + 1]!;
		const z = aperture.vertices[index + 2]!;
		bounds.min.x = Math.min(bounds.min.x, x);
		bounds.min.y = Math.min(bounds.min.y, y);
		bounds.min.z = Math.min(bounds.min.z, z);
		bounds.max.x = Math.max(bounds.max.x, x);
		bounds.max.y = Math.max(bounds.max.y, y);
		bounds.max.z = Math.max(bounds.max.z, z);
	}
	return bounds;
}

type SyntheticExecutorStream = PortalCrossingTriangleStreamView &
	PortalPropagationMetadataStreamView &
	PortalPropagationExecutionScheduleView;

function createPropagationStream(): SyntheticExecutorStream {
	const crossingDepths = [-0.4, 0, 0.4] as const;
	const arena = new ArrayBuffer(
		18 * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	);
	const floats = new Float32Array(arena);
	const uints = new Uint32Array(arena);
	const slotsPerVertex =
		PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES /
		Uint32Array.BYTES_PER_ELEMENT;
	for (const [crossing, depth] of crossingDepths.entries()) {
		const positions = crossingPositions(depth);
		for (const [localVertex, position] of positions.entries()) {
			const vertex = crossing * positions.length + localVertex;
			const output = vertex * slotsPerVertex;
			const [x, y, z] = position;
			floats[output] = x;
			floats[output + 1] = y;
			floats[output + 2] = z;
			uints[output + 3] = crossing + 2;
			uints[output + 4] = crossing;
			uints[output + 5] = PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL;
		}
	}
	return withSyntheticFullTileSchedule(
		{
			arrivalMetadataStateCount: 4,
			bytes: new Uint8Array(arena),
			propagationMetadataBytes: createMetadata(4),
			renderDomainMetadataStateCount: 4,
			usedByteLength: arena.byteLength,
			usedPropagationMetadataByteLength:
				portalPropagationMetadataUsedByteLength(4),
			vertexCount: 18,
		},
		3,
		4,
	);
}

/**
 * Model the production CellStruct seam where an aperture transform lands fractionally nearer than
 * the opaque polygon authored on the same plane.
 */
function createMaterialBearingCoplanarStream(
	arrivalPlaneNormalZ: -1 | 1,
): SyntheticExecutorStream {
	const arena = new ArrayBuffer(
		6 * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	);
	const floats = new Float32Array(arena);
	const uints = new Uint32Array(arena);
	const slotsPerVertex =
		PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES /
		Uint32Array.BYTES_PER_ELEMENT;
	for (const [vertex, position] of crossingPositions(-0.0001).entries()) {
		const output = vertex * slotsPerVertex;
		const [x, y, z] = position;
		floats[output] = x;
		floats[output + 1] = y;
		floats[output + 2] = z;
		uints[output + 3] = 2;
		uints[output + 4] = 0;
		uints[output + 5] = PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL;
	}
	const metadata = createMetadata(4);
	writeArrivalPlane(
		new Float32Array(metadata.buffer),
		1,
		arrivalPlaneNormalZ,
		0,
	);
	return withSyntheticFullTileSchedule(
		{
			arrivalMetadataStateCount: 2,
			bytes: new Uint8Array(arena),
			propagationMetadataBytes: metadata,
			renderDomainMetadataStateCount: 2,
			usedByteLength: arena.byteLength,
			usedPropagationMetadataByteLength:
				portalPropagationMetadataUsedByteLength(2),
			vertexCount: 6,
		},
		1,
		2,
	);
}

/** Check covered walls and genuine openings without changing the main fixture's atlas history. */
function runMaterialBearingBoundaryFixture(
	gl: WebGL2RenderingContext,
): Pick<
	WebGL2PortalScopeAtlasExecutorFixtureResult,
	| "materialBearingCoplanarSurfaceOccludesMask"
	| "materialBearingOpeningRetainsBoundaryPixels"
> {
	const state = captureState(gl, METADATA_BINDING_POINT);
	const targetOwner = new WebGL2PortalScopeAtlasTargets(gl);
	const executor = new WebGL2PortalScopeAtlasExecutor(
		gl,
		6,
		METADATA_BINDING_POINT,
	);
	try {
		const targets = targetOwner.resize({
			atlas: ATLAS_EXTENT,
			drawingBuffer: DRAWING_EXTENT,
		});
		let materialBearingCoplanarSurfaceOccludesMask = true;
		seedSceneAtlas(gl, targets, 0.5);
		for (const arrivalPlaneNormalZ of [-1, 1] as const) {
			clearOutput(gl);
			executor.execute({
				clearColor: CLEAR_COLOR_NORMALIZED,
				outputExtent: DRAWING_EXTENT,
				outputFramebuffer: null,
				stream: createMaterialBearingCoplanarStream(arrivalPlaneNormalZ),
				targets,
				traversalDepth: 1,
			});
			materialBearingCoplanarSurfaceOccludesMask &&= pixelsMatch(
				readOutput(gl),
				solidPixels(ROOT_COLOR),
			);
		}
		// Clear color and depth together: an uncovered pixel is a real opening, even when
		// coplanar wall samples surround it. Depth-only dilation must not close that opening.
		const openingX = Math.floor(DRAWING_EXTENT.width / 2);
		const expectedOpeningPixels = solidPixels(ROOT_COLOR);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.framebuffer);
		gl.enable(gl.SCISSOR_TEST);
		for (const pixel of CENTER_PIXELS) {
			if (pixel % DRAWING_EXTENT.width !== openingX) continue;
			gl.scissor(openingX, Math.floor(pixel / DRAWING_EXTENT.width), 1, 1);
			clearCurrentTile(gl, CLEAR_COLOR, 1);
			expectedOpeningPixels.set(MIDDLE_COLOR, pixel * 4);
		}
		gl.disable(gl.SCISSOR_TEST);
		clearOutput(gl);
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream: createMaterialBearingCoplanarStream(1),
			targets,
			traversalDepth: 1,
		});
		return {
			materialBearingCoplanarSurfaceOccludesMask,
			materialBearingOpeningRetainsBoundaryPixels: pixelsMatch(
				readOutput(gl),
				expectedOpeningPixels,
			),
		};
	} finally {
		executor.destroy();
		targetOwner.destroy();
		restoreState(gl, state, METADATA_BINDING_POINT);
	}
}

/** Seed the shared atlas, then order the junction chain's tiles by strictly decreasing depth. */
function seedJunctionSceneAtlas(
	gl: WebGL2RenderingContext,
	targets: WebGL2PortalScopeAtlasTargetSet,
): void {
	seedSceneAtlas(gl, targets);
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.framebuffer);
	gl.viewport(0, 0, ATLAS_EXTENT.width, ATLAS_EXTENT.height);
	gl.enable(gl.SCISSOR_TEST);
	clearTile(gl, DRAWING_EXTENT.width, MIDDLE_COLOR, 0.7);
	clearTile(gl, DRAWING_EXTENT.width * 2, DEEP_COLOR, 0.5);
	gl.disable(gl.SCISSOR_TEST);
}

/**
 * Two crossings on one shared plane: scope0 -> scope1 and scope1 -> scope2, both at NDC depth
 * zero — the archive's zero-thickness junction. `tagJunction` stamps one shared junction group on
 * both arrival records; without it the second advance measures zero entry-plane progress and the
 * strict test must reject it.
 */
function createJunctionStream(tagJunction: boolean): SyntheticExecutorStream {
	const arena = new ArrayBuffer(
		12 * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	);
	const floats = new Float32Array(arena);
	const uints = new Uint32Array(arena);
	const slotsPerVertex =
		PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES /
		Uint32Array.BYTES_PER_ELEMENT;
	for (let crossing = 0; crossing < 2; crossing += 1) {
		const positions = crossingPositions(0);
		for (const [localVertex, position] of positions.entries()) {
			const vertex = crossing * positions.length + localVertex;
			const output = vertex * slotsPerVertex;
			const [x, y, z] = position;
			floats[output] = x;
			floats[output + 1] = y;
			floats[output + 2] = z;
			uints[output + 3] = crossing + 2;
			uints[output + 4] = crossing;
			uints[output + 5] = PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL;
		}
	}
	const metadata = createMetadata(4);
	const metadataUints = new Uint32Array(metadata.buffer);
	// Both arrivals cross the same z = 0 plane; rewrite record 1's plane from the chain default.
	const metadataFloats = new Float32Array(metadata.buffer);
	writeArrivalPlane(metadataFloats, 1, 1, 0);
	if (tagJunction) {
		const junction = 7;
		for (const record of [1, 2]) {
			metadataUints[
				(PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES +
					record * 32 +
					PORTAL_ARRIVAL_METADATA_JUNCTION_OFFSET_BYTES) /
					Uint32Array.BYTES_PER_ELEMENT
			] = junction;
		}
	}
	return withSyntheticFullTileSchedule(
		{
			arrivalMetadataStateCount: 3,
			bytes: new Uint8Array(arena),
			propagationMetadataBytes: metadata,
			renderDomainMetadataStateCount: 3,
			usedByteLength: arena.byteLength,
			usedPropagationMetadataByteLength:
				portalPropagationMetadataUsedByteLength(3),
			vertexCount: 12,
		},
		2,
		3,
	);
}

function crossingPositions(depth: number) {
	return [
		[-0.5, -0.5, depth],
		[0.5, -0.5, depth],
		[0.5, 0.5, depth],
		[-0.5, -0.5, depth],
		[0.5, 0.5, depth],
		[-0.5, 0.5, depth],
	] as const;
}

function createRootOnlyStream(): SyntheticExecutorStream {
	return withSyntheticFullTileSchedule(
		{
			arrivalMetadataStateCount: 1,
			bytes: new Uint8Array(0),
			propagationMetadataBytes: createMetadata(1),
			renderDomainMetadataStateCount: 1,
			usedByteLength: 0,
			usedPropagationMetadataByteLength:
				portalPropagationMetadataUsedByteLength(1),
			vertexCount: 0,
		},
		0,
		1,
	);
}

function withSyntheticFullTileSchedule(
	base: PortalCrossingTriangleStreamView & PortalPropagationMetadataStreamView,
	traversalDepth: number,
	tileCount: number,
): SyntheticExecutorStream {
	const indexCount = traversalDepth * base.vertexCount;
	const indices = new Uint16Array(indexCount);
	for (let round = 0; round < traversalDepth; round += 1) {
		for (let vertex = 0; vertex < base.vertexCount; vertex += 1) {
			indices[round * base.vertexCount + vertex] = vertex;
		}
	}
	const quads: number[] = [];
	const roundReductionOffsets: number[] = [];
	const roundReductionCounts: number[] = [];
	const pushQuad = (domain: number, mode: number) => {
		quads.push(
			domain * DRAWING_EXTENT.width,
			0,
			0,
			0,
			DRAWING_EXTENT.width,
			DRAWING_EXTENT.height,
			domain,
			mode,
		);
	};
	for (let round = 0; round < traversalDepth; round += 1) {
		const offset = quads.length / 8;
		if (round === 0) {
			pushQuad(0, PORTAL_QUAD_MODE_ROOT_ROUND0_CLAMP);
			if (traversalDepth === 1) {
				for (let domain = 1; domain < tileCount; domain += 1) {
					pushQuad(domain, PORTAL_QUAD_MODE_MAX_REDUCE);
				}
			}
		} else {
			for (let domain = 0; domain < tileCount; domain += 1) {
				pushQuad(domain, PORTAL_QUAD_MODE_MAX_REDUCE);
			}
		}
		roundReductionOffsets.push(offset);
		roundReductionCounts.push(quads.length / 8 - offset);
	}
	const resolveQuadOffset = quads.length / 8;
	for (let domain = 0; domain < tileCount; domain += 1) {
		pushQuad(domain, PORTAL_QUAD_MODE_MAX_REDUCE);
	}
	const quadArray = new Uint16Array(quads);
	const quadCount = quadArray.length / 8;
	return {
		...base,
		indexBytes: new Uint8Array(indices.buffer),
		indexCount,
		quadBytes: new Uint8Array(quadArray.buffer),
		quadCount,
		resolveQuadCount: tileCount,
		resolveQuadOffset,
		roundFrontierScissorHeight: () => DRAWING_EXTENT.height,
		roundFrontierScissorWidth: () => DRAWING_EXTENT.width,
		roundFrontierScissorX: () => 0,
		roundFrontierScissorY: () => 0,
		roundIndexCount: () => base.vertexCount,
		roundIndexOffset: (round) => round * base.vertexCount,
		roundReductionQuadCount: (round) => roundReductionCounts[round]!,
		roundReductionQuadOffset: (round) => roundReductionOffsets[round]!,
		usedIndexByteLength: indices.byteLength,
		usedQuadByteLength: quadCount * PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
	};
}

/** Toggle the packed policy bit to retain an executable ordinary-path negative control. */
function setNearClipRayPolicy(
	stream: PortalCrossingTriangleStreamView,
	enabled: boolean,
): void {
	const slots = new Uint32Array(stream.bytes.buffer);
	const slotsPerVertex =
		PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES /
		Uint32Array.BYTES_PER_ELEMENT;
	const policySlotOffset =
		PORTAL_CROSSING_TRIANGLE_POLICY_OFFSET_BYTES /
		Uint32Array.BYTES_PER_ELEMENT;
	for (let vertex = 0; vertex < stream.vertexCount; vertex += 1) {
		const policySlot = vertex * slotsPerVertex + policySlotOffset;
		slots[policySlot] = enabled
			? slots[policySlot]! | PORTAL_CROSSING_NEAR_CLIP_RAY_FLAG
			: slots[policySlot]! & ~PORTAL_CROSSING_NEAR_CLIP_RAY_FLAG;
	}
}

function createMetadata(scopeCount: 1 | 4): Uint8Array {
	const buffer = new ArrayBuffer(PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES);
	const floats = new Float32Array(buffer);
	const uints = new Uint32Array(buffer);
	floats[0] = 1;
	floats[5] = 1;
	floats[10] = 1;
	floats[15] = 1;
	writeArrivalRoute(uints, 0, 0, 0, 0);
	if (scopeCount === 4) {
		writeArrivalRoute(uints, 1, 1, 0, PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE);
		writeArrivalPlane(floats, 1, 1, 0.4);
		writeArrivalRoute(uints, 2, 2, 0, PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE);
		writeArrivalPlane(floats, 2, 1, 0);
		writeArrivalRoute(uints, 3, 3, 0, PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE);
		writeArrivalPlane(floats, 3, 1, -0.4);
	}
	const scopeOffset =
		PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES /
		Uint32Array.BYTES_PER_ELEMENT;
	writePortalScopeTileMetadata(
		uints,
		scopeOffset,
		0,
		0,
		0,
		0,
		DRAWING_EXTENT.width,
		DRAWING_EXTENT.height,
		scopeCount === 1,
	);
	if (scopeCount === 4) {
		for (let scope = 1; scope < scopeCount; scope += 1) {
			writePortalScopeTileMetadata(
				uints,
				scopeOffset + scope * 8,
				scope * DRAWING_EXTENT.width,
				0,
				0,
				0,
				DRAWING_EXTENT.width,
				DRAWING_EXTENT.height,
				false,
			);
		}
	}
	return new Uint8Array(buffer);
}

function writeArrivalPlane(
	metadata: Float32Array,
	recordOrdinal: number,
	normalZ: -1 | 1,
	d: number,
): void {
	const floatOffset =
		(PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES +
			recordOrdinal * PORTAL_ARRIVAL_METADATA_RECORD_BYTES) /
		Float32Array.BYTES_PER_ELEMENT;
	metadata[floatOffset + 2] = normalZ;
	metadata[floatOffset + 3] = d;
}

function writeArrivalRoute(
	metadata: Uint32Array,
	recordOrdinal: number,
	scopeOrdinal: number,
	reciprocalArrival: number,
	flags: number,
): void {
	const byteOffset =
		PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES +
		recordOrdinal * PORTAL_ARRIVAL_METADATA_RECORD_BYTES;
	metadata[
		(byteOffset + PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES) /
			Uint32Array.BYTES_PER_ELEMENT
	] = scopeOrdinal;
	metadata[
		(byteOffset + PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES) /
			Uint32Array.BYTES_PER_ELEMENT
	] = reciprocalArrival;
	metadata[
		(byteOffset + PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES) /
			Uint32Array.BYTES_PER_ELEMENT
	] = flags;
}

function seedSceneAtlas(
	gl: WebGL2RenderingContext,
	targets: WebGL2PortalScopeAtlasTargetSet,
	rootDepth = 0.8,
): void {
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.framebuffer);
	gl.viewport(0, 0, ATLAS_EXTENT.width, ATLAS_EXTENT.height);
	gl.enable(gl.SCISSOR_TEST);
	clearTile(gl, 0, ROOT_COLOR, rootDepth);
	clearTile(gl, DRAWING_EXTENT.width, MIDDLE_COLOR, 0.8);
	clearTile(gl, DRAWING_EXTENT.width * 2, DEEP_COLOR, 0.8);
	clearTile(gl, DRAWING_EXTENT.width * 3, LEAF_COLOR, 0.6);
	gl.disable(gl.SCISSOR_TEST);
}

function seedProductionPackedSceneAtlas(
	gl: WebGL2RenderingContext,
	targets: WebGL2PortalScopeAtlasTargetSet,
	frame: PortalScopeAtlasFrameView,
	rootDepth = 0.8,
): void {
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.framebuffer);
	gl.viewport(0, 0, ATLAS_EXTENT.width, ATLAS_EXTENT.height);
	gl.enable(gl.SCISSOR_TEST);
	clearPlannedTile(gl, frame, 0, ROOT_COLOR, rootDepth);
	clearPlannedTile(gl, frame, 1, LEAF_COLOR, 0.6);
	gl.disable(gl.SCISSOR_TEST);
}

function clearPlannedTile(
	gl: WebGL2RenderingContext,
	frame: PortalScopeAtlasFrameView,
	ordinal: number,
	color: readonly [number, number, number, number],
	depth: number,
): void {
	gl.scissor(
		frame.tileX(ordinal),
		frame.tileY(ordinal),
		frame.tileWidth(ordinal),
		frame.tileHeight(ordinal),
	);
	clearCurrentTile(gl, color, depth);
}

/** Paint depth-always exterior weather into one scope tile without changing its opaque depth. */
function paintPlannedTileColor(
	gl: WebGL2RenderingContext,
	targets: WebGL2PortalScopeAtlasTargetSet,
	frame: PortalScopeAtlasFrameView,
	ordinal: number,
	color: readonly [number, number, number, number],
): void {
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.framebuffer);
	gl.viewport(0, 0, ATLAS_EXTENT.width, ATLAS_EXTENT.height);
	gl.enable(gl.SCISSOR_TEST);
	gl.scissor(
		frame.tileX(ordinal),
		frame.tileY(ordinal),
		frame.tileWidth(ordinal),
		frame.tileHeight(ordinal),
	);
	gl.colorMask(true, true, true, true);
	gl.clearBufferfv(
		gl.COLOR,
		0,
		new Float32Array(color.map((component) => component / 255)),
	);
	gl.disable(gl.SCISSOR_TEST);
}

function clearTile(
	gl: WebGL2RenderingContext,
	x: number,
	color: readonly [number, number, number, number],
	depth: number,
): void {
	gl.scissor(x, 0, DRAWING_EXTENT.width, DRAWING_EXTENT.height);
	clearCurrentTile(gl, color, depth);
}

function clearCurrentTile(
	gl: WebGL2RenderingContext,
	color: readonly [number, number, number, number],
	depth: number,
): void {
	gl.clearBufferfv(
		gl.COLOR,
		0,
		new Float32Array(color.map((component) => component / 255)),
	);
	gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([depth]));
}

function clearOutput(gl: WebGL2RenderingContext): void {
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
	gl.viewport(0, 0, DRAWING_EXTENT.width, DRAWING_EXTENT.height);
	gl.disable(gl.SCISSOR_TEST);
	// Pre-dirty the output with stale color and near depth so the root `ALWAYS` resolve pass must
	// overwrite every output pixel (filling uncovered root holes from `uClearColor`) without any
	// caller pre-clear.
	gl.colorMask(true, true, true, true);
	gl.depthMask(true);
	gl.clearBufferfv(
		gl.COLOR,
		0,
		new Float32Array(STALE_OUTPUT_COLOR.map((component) => component / 255)),
	);
	gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([0.05]));
}

function readOutput(gl: WebGL2RenderingContext): Uint8Array {
	const pixels = new Uint8Array(
		DRAWING_EXTENT.width * DRAWING_EXTENT.height * 4,
	);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
	gl.readBuffer(gl.BACK);
	gl.readPixels(
		0,
		0,
		DRAWING_EXTENT.width,
		DRAWING_EXTENT.height,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		pixels,
	);
	return pixels;
}

interface DeferredFixtureProgram {
	readonly program: WebGLProgram;
	readonly portal: WebGL2PortalDeferredVisibilityUniforms;
	readonly color: WebGLUniformLocation;
	readonly depth: WebGLUniformLocation;
}

interface ParticleFixtureProgram {
	readonly program: WebGLProgram;
	readonly color: WebGLUniformLocation;
	readonly depth: WebGLUniformLocation;
	readonly translucency: WebGLUniformLocation;
}

/** Numeric alpha/particle composition over the executor's real envelope and resolved depth. */
function runDeferredCompositionFixture(
	gl: WebGL2RenderingContext,
	executor: WebGL2PortalScopeAtlasExecutor,
	targets: WebGL2PortalScopeAtlasTargetSet,
	stream: SyntheticExecutorStream,
	frame: PortalScopeAtlasFrameView,
): {
	readonly expectedTransparentPixels: Uint8Array;
	readonly expectedParticlePixels: Uint8Array;
	readonly particlePixels: Uint8Array;
	readonly transparentPixels: Uint8Array;
} {
	const transparent = createDeferredFixtureProgram(gl);
	const particle = createParticleFixtureProgram(gl);
	const vertexArray = gl.createVertexArray();
	const materialTexture = createFixtureMaterialTexture(gl);
	if (!vertexArray) {
		gl.deleteProgram(transparent.program);
		gl.deleteProgram(particle.program);
		gl.deleteTexture(materialTexture);
		throw new Error("Failed to allocate the deferred-composition fixture VAO.");
	}
	try {
		seedProductionPackedSceneAtlas(gl, targets, frame);
		clearOutput(gl);
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream,
			targets,
			traversalDepth: frame.commands.traversalDepth,
		});
		beginDeferredFixture(gl, targets, vertexArray);
		drawDeferredFixtureSchedule(gl, transparent);
		const transparentPixels = readOutput(gl);

		seedProductionPackedSceneAtlas(gl, targets, frame);
		clearOutput(gl);
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream,
			targets,
			traversalDepth: frame.commands.traversalDepth,
		});
		beginDeferredFixture(gl, targets, vertexArray);
		bindFixtureMaterialTexture(gl, materialTexture);
		drawParticleFixtureSchedule(gl, particle);
		const particlePixels = readOutput(gl);

		return {
			expectedTransparentPixels: expectedDeferredCompositionPixels(),
			expectedParticlePixels: expectedParticleCompositionPixels(),
			particlePixels,
			transparentPixels,
		};
	} finally {
		gl.deleteTexture(materialTexture);
		gl.deleteVertexArray(vertexArray);
		gl.deleteProgram(transparent.program);
		gl.deleteProgram(particle.program);
	}
}

function beginDeferredFixture(
	gl: WebGL2RenderingContext,
	targets: WebGL2PortalScopeAtlasTargetSet,
	vertexArray: WebGLVertexArrayObject,
): void {
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
	gl.viewport(0, 0, DRAWING_EXTENT.width, DRAWING_EXTENT.height);
	gl.disable(gl.SCISSOR_TEST);
	gl.enable(gl.DEPTH_TEST);
	gl.depthFunc(gl.LESS);
	gl.depthMask(false);
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.bindVertexArray(vertexArray);
	const envelopeUnit = PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth;
	gl.bindSampler(envelopeUnit, null);
	gl.activeTexture(gl.TEXTURE0 + envelopeUnit);
	gl.bindTexture(gl.TEXTURE_2D, targets.envelope.depth);
}

function drawDeferredFixtureSchedule(
	gl: WebGL2RenderingContext,
	fixture: DeferredFixtureProgram,
): void {
	gl.useProgram(fixture.program);
	drawDeferredFixture(gl, fixture, 0, 0.55, [0, 0, 1, 0.5]);
	drawDeferredFixture(gl, fixture, 1, 0.5, [1, 1, 0, 0.5]);
	drawDeferredFixture(gl, fixture, 0, 0.4, [1, 0, 1, 0.5]);
}

function drawDeferredFixture(
	gl: WebGL2RenderingContext,
	fixture: DeferredFixtureProgram,
	renderDomain: number,
	depth: number,
	color: readonly [number, number, number, number],
): void {
	gl.uniform1ui(fixture.portal.renderDomain, renderDomain);
	gl.uniform1f(fixture.depth, depth);
	gl.uniform4f(fixture.color, ...color);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function drawParticleFixtureSchedule(
	gl: WebGL2RenderingContext,
	fixture: ParticleFixtureProgram,
): void {
	gl.useProgram(fixture.program);
	gl.uniform1f(fixture.translucency, 0.5);
	// The far green layer is visible over root depth 0.8, but occluded by child depth 0.6.
	drawParticleFixture(gl, fixture, 0.7, [0, 1, 0, 1]);
	drawParticleFixture(gl, fixture, 0.55, [0, 0, 1, 1]);
	drawParticleFixture(gl, fixture, 0.5, [1, 1, 0, 1]);
	drawParticleFixture(gl, fixture, 0.4, [1, 0, 1, 1]);
}

function drawParticleFixture(
	gl: WebGL2RenderingContext,
	fixture: ParticleFixtureProgram,
	depth: number,
	color: readonly [number, number, number, number],
): void {
	gl.uniform1f(fixture.depth, depth);
	gl.uniform4f(fixture.color, ...color);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function createDeferredFixtureProgram(
	gl: WebGL2RenderingContext,
): DeferredFixtureProgram {
	const program = linkFixtureProgram(
		gl,
		DEFERRED_FIXTURE_VERTEX_SHADER,
		DEFERRED_FIXTURE_FRAGMENT_SHADER,
	);
	return {
		color: requireWebGL2Uniform(gl, program, "uColor"),
		depth: requireWebGL2Uniform(gl, program, "uDepth"),
		portal: bindWebGL2PortalDeferredVisibilityProgram(gl, program),
		program,
	};
}

function createParticleFixtureProgram(
	gl: WebGL2RenderingContext,
): ParticleFixtureProgram {
	const program = linkFixtureProgram(
		gl,
		PARTICLE_FIXTURE_VERTEX_SHADER,
		PARTICLE_FRAGMENT_SHADER,
	);
	gl.useProgram(program);
	gl.uniform1i(requireWebGL2Uniform(gl, program, "uBase"), 0);
	gl.uniform1i(requireWebGL2Uniform(gl, program, "uPalette"), 1);
	gl.uniform1i(requireWebGL2Uniform(gl, program, "uMaterialKind"), 0);
	gl.uniform1i(requireWebGL2Uniform(gl, program, "uPalettedClipMap"), 0);
	gl.uniform1f(requireWebGL2Uniform(gl, program, "uAlphaTest"), 0);
	// Match production opacity; the uniform's initial zero otherwise hides every fixture particle.
	gl.uniform1f(requireWebGL2Uniform(gl, program, "uOpacityScale"), 1);
	gl.uniform1i(requireWebGL2Uniform(gl, program, "uCanvasEmissionMode"), 0);
	return {
		color: requireWebGL2Uniform(gl, program, "uMaterialColor"),
		depth: requireWebGL2Uniform(gl, program, "uDepth"),
		program,
		translucency: requireWebGL2Uniform(gl, program, "uTranslucency"),
	};
}

function linkFixtureProgram(
	gl: WebGL2RenderingContext,
	vertexSource: string,
	fragmentSource: string,
): WebGLProgram {
	const vertex = compileWebGL2Shader(gl, gl.VERTEX_SHADER, vertexSource);
	const fragment = compileWebGL2Shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
	const program = gl.createProgram();
	if (!program) {
		gl.deleteShader(vertex);
		gl.deleteShader(fragment);
		throw new Error(
			"Failed to allocate a deferred-composition fixture program.",
		);
	}
	try {
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Deferred-composition fixture failed to link: ${gl.getProgramInfoLog(program) ?? "unknown"}`,
			);
		}
		return program;
	} catch (error) {
		gl.deleteProgram(program);
		throw error;
	} finally {
		gl.deleteShader(vertex);
		gl.deleteShader(fragment);
	}
}

function createFixtureMaterialTexture(
	gl: WebGL2RenderingContext,
): WebGLTexture {
	const texture = gl.createTexture();
	if (!texture) throw new Error("Failed to allocate fixture material texture.");
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA8,
		1,
		1,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		new Uint8Array([255, 255, 255, 255]),
	);
	return texture;
}

function bindFixtureMaterialTexture(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
): void {
	for (const unit of [0, 1]) {
		gl.bindSampler(unit, null);
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, texture);
	}
}

function expectedDeferredCompositionPixels(): Uint8Array {
	const outside = blendHalf(blendHalf(ROOT_COLOR, [0, 0, 255]), [255, 0, 255]);
	const center = blendHalf(blendHalf(LEAF_COLOR, [255, 255, 0]), [255, 0, 255]);
	const pixels = new Uint8Array(
		DRAWING_EXTENT.width * DRAWING_EXTENT.height * 4,
	);
	for (let pixel = 0; pixel < pixels.length / 4; pixel += 1) {
		pixels.set(CENTER_PIXELS.has(pixel) ? center : outside, pixel * 4);
	}
	return pixels;
}

/** Ordinary scene depth admits every near particle layer, independent of its source scope. */
function expectedParticleCompositionPixels(): Uint8Array {
	const layers = (background: readonly [number, number, number, number]) =>
		blendHalf(
			blendHalf(blendHalf(background, [0, 0, 255]), [255, 255, 0]),
			[255, 0, 255],
		);
	const outside = layers(blendHalf(ROOT_COLOR, [0, 255, 0]));
	const center = layers(LEAF_COLOR);
	const pixels = new Uint8Array(
		DRAWING_EXTENT.width * DRAWING_EXTENT.height * 4,
	);
	for (let pixel = 0; pixel < pixels.length / 4; pixel += 1) {
		pixels.set(CENTER_PIXELS.has(pixel) ? center : outside, pixel * 4);
	}
	return pixels;
}

function blendHalf(
	destination: readonly [number, number, number, number],
	sourceRgb: readonly [number, number, number],
): readonly [number, number, number, number] {
	return [
		Math.round(sourceRgb[0] * 0.5 + destination[0] * 0.5),
		Math.round(sourceRgb[1] * 0.5 + destination[1] * 0.5),
		Math.round(sourceRgb[2] * 0.5 + destination[2] * 0.5),
		255,
	];
}

const DEFERRED_FIXTURE_VERTEX_SHADER = `#version 300 es
precision highp float;
uniform float uDepth;
void main() {
	const vec2 positions[3] = vec2[3](
		vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0)
	);
	gl_Position = vec4(positions[gl_VertexID], uDepth * 2.0 - 1.0, 1.0);
}
`;

const DEFERRED_FIXTURE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
${PORTAL_DEFERRED_VISIBILITY_GLSL}
uniform vec4 uColor;
out vec4 outColor;
void main() {
	if (!portalDeferredFragmentVisible()) discard;
	outColor = uColor;
}
`;

const PARTICLE_FIXTURE_VERTEX_SHADER = `#version 300 es
precision highp float;
uniform float uDepth;
uniform float uTranslucency;
out vec2 vTextureCoordinate;
out float vTranslucency;
void main() {
	const vec2 positions[3] = vec2[3](
		vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0)
	);
	vTextureCoordinate = vec2(0.0);
	vTranslucency = uTranslucency;
	gl_Position = vec4(positions[gl_VertexID], uDepth * 2.0 - 1.0, 1.0);
}
`;

function executeWithHostileSamplers(
	gl: WebGL2RenderingContext,
	execute: () => Uint8Array,
): { readonly error: GLenum; readonly pixels: Uint8Array } {
	const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as GLenum;
	const previousSamplers = Array.from({ length: 7 }, (_, unit) => {
		gl.activeTexture(gl.TEXTURE0 + unit);
		return gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
	});
	gl.activeTexture(activeTexture);
	const hostileSampler = gl.createSampler();
	if (!hostileSampler) {
		throw new Error("Failed to allocate the portal hostile-sampler fixture.");
	}
	gl.samplerParameteri(hostileSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.samplerParameteri(hostileSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	try {
		for (let unit = 0; unit < previousSamplers.length; unit += 1) {
			gl.bindSampler(unit, hostileSampler);
		}
		const pixels = execute();
		return { error: gl.getError(), pixels };
	} finally {
		for (const [unit, sampler] of previousSamplers.entries()) {
			gl.bindSampler(unit, sampler);
		}
		gl.deleteSampler(hostileSampler);
	}
}

function readFrontier(
	gl: WebGL2RenderingContext,
	targets: WebGL2PortalScopeAtlasTargetSet,
): Uint8Array {
	const pixels = new Uint8Array(DRAWING_EXTENT.width * DRAWING_EXTENT.height);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, targets.frontiers[0].framebuffer);
	gl.readBuffer(gl.COLOR_ATTACHMENT0);
	gl.readPixels(
		0,
		0,
		DRAWING_EXTENT.width,
		DRAWING_EXTENT.height,
		gl.RED_INTEGER,
		gl.UNSIGNED_BYTE,
		pixels,
	);
	return pixels;
}

function expectedPixelsFromOracle(rootDepth: number): Uint8Array {
	const frame = composePortalReferenceFrameThroughPathDepth(
		createOracleScene(rootDepth),
		3,
	);
	const leafPixels = new Set<number>();
	for (const result of frame.pixels) {
		if (result.opaque?.fragmentId?.startsWith("leaf-")) {
			leafPixels.add(result.pixel);
		}
	}
	// The reference oracle models exact envelope confinement. Production resolve additionally
	// applies the envelope gutter, which lets a domain win pixels up to the gutter radius outside
	// its exact region wherever its content is nearest and its declared window admits the pixel.
	// The chain scenario declares full-screen windows, so the gutter's whole dilation is visible.
	const winnable = dilatePixels(
		leafPixels,
		PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
	);
	const pixels = new Uint8Array(
		DRAWING_EXTENT.width * DRAWING_EXTENT.height * 4,
	);
	for (let pixel = 0; pixel < pixels.length / 4; pixel += 1) {
		pixels.set(winnable.has(pixel) ? LEAF_COLOR : ROOT_COLOR, pixel * 4);
	}
	return pixels;
}

/** Chebyshev-dilate a screen pixel set by the envelope gutter radius, clipped to the screen. */
function dilatePixels(base: ReadonlySet<number>, radius: number): Set<number> {
	return dilatePixelsWithinBounds(base, DRAWING_EXTENT.width, radius, {
		height: DRAWING_EXTENT.height,
		width: DRAWING_EXTENT.width,
		x: 0,
		y: 0,
	});
}

function dilatePixelsWithinBounds(
	base: ReadonlySet<number>,
	stride: number,
	radius: number,
	bounds: {
		readonly height: number;
		readonly width: number;
		readonly x: number;
		readonly y: number;
	},
): Set<number> {
	const dilated = new Set<number>();
	const maxX = bounds.x + bounds.width;
	const maxY = bounds.y + bounds.height;
	for (const pixel of base) {
		const pixelX = pixel % stride;
		const pixelY = Math.floor(pixel / stride);
		for (let y = pixelY - radius; y <= pixelY + radius; y += 1) {
			for (let x = pixelX - radius; x <= pixelX + radius; x += 1) {
				if (x >= bounds.x && y >= bounds.y && x < maxX && y < maxY) {
					dilated.add(y * stride + x);
				}
			}
		}
	}
	return dilated;
}

function rectPixels(
	stride: number,
	minX: number,
	minY: number,
	rectWidth: number,
	rectHeight: number,
): number[] {
	const indices: number[] = [];
	for (let y = minY; y < minY + rectHeight; y += 1) {
		for (let x = minX; x < minX + rectWidth; x += 1) {
			indices.push(y * stride + x);
		}
	}
	return indices;
}

function createFixtureTopology(
	revision: number,
	scopes: readonly SceneTopologyScope[],
	crossings: readonly ScenePortalCrossing[],
): SceneTopologyView {
	const outgoingByKey = new Map<string, ScenePortalCrossing[]>();
	for (const edge of crossings) {
		const key = scopeKey(edge.source);
		const list = outgoingByKey.get(key) ?? [];
		list.push(edge);
		outgoingByKey.set(key, list);
	}
	return {
		crossings,
		outgoing: (scope) => outgoingByKey.get(scopeKey(scope)) ?? [],
		revision,
		scopes,
	};
}

/** Expected solid-tile output for one gutter-dilated winner clipped by its declared window. */
function expectedWinnerPixels(
	winner: readonly [number, number, number, number],
	window: { x: number; y: number; width: number; height: number } | null,
): Uint8Array {
	const winnable = dilatePixels(
		CENTER_PIXELS,
		PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
	);
	const pixels = new Uint8Array(
		DRAWING_EXTENT.width * DRAWING_EXTENT.height * 4,
	);
	for (let pixel = 0; pixel < pixels.length / 4; pixel += 1) {
		const x = pixel % DRAWING_EXTENT.width;
		const y = Math.floor(pixel / DRAWING_EXTENT.width);
		const insideWindow =
			window === null ||
			(x >= window.x &&
				y >= window.y &&
				x < window.x + window.width &&
				y < window.y + window.height);
		pixels.set(
			winnable.has(pixel) && insideWindow ? winner : ROOT_COLOR,
			pixel * 4,
		);
	}
	return pixels;
}

function createOracleScene(rootDepth: number): PortalModelScene {
	const pixelCount = DRAWING_EXTENT.width * DRAWING_EXTENT.height;
	const rootScope = portalModelScopeId("root");
	const middleScope = portalModelScopeId("middle");
	const deepScope = portalModelScopeId("deep");
	const leafScope = portalModelScopeId("leaf");
	const rootDomain = portalModelDomainId("root-domain");
	const middleDomain = portalModelDomainId("middle-domain");
	const deepDomain = portalModelDomainId("deep-domain");
	const leafDomain = portalModelDomainId("leaf-domain");
	return createPortalModelScene({
		crossings: [
			oracleCrossing(rootScope, middleScope, "root-middle", 3, pixelCount),
			oracleCrossing(middleScope, deepScope, "middle-deep", 5, pixelCount),
			oracleCrossing(deepScope, leafScope, "deep-leaf", 7, pixelCount),
		],
		domains: [
			{
				fragments: opaqueFragments("root", rootScope, rootDepth, pixelCount),
				id: rootDomain,
			},
			{
				fragments: opaqueFragments("middle", middleScope, 8, pixelCount),
				id: middleDomain,
			},
			{
				fragments: opaqueFragments("deep", deepScope, 8, pixelCount),
				id: deepDomain,
			},
			{
				fragments: opaqueFragments("leaf", leafScope, 6, pixelCount),
				id: leafDomain,
			},
		],
		pixelCount,
		rootScopeId: rootScope,
		scopes: [
			{ domainId: rootDomain, id: rootScope },
			{ domainId: middleDomain, id: middleScope },
			{ domainId: deepDomain, id: deepScope },
			{ domainId: leafDomain, id: leafScope },
		],
	});
}

function oracleCrossing(
	sourceScopeId: PortalModelScopeId,
	targetScopeId: PortalModelScopeId,
	id: string,
	depth: number,
	pixelCount: number,
) {
	return {
		aperture: createPortalModelAperture(
			pixelCount,
			[...CENTER_PIXELS].map((pixel) => ({
				depth: portalModelDepth(depth),
				pixel: portalModelPixel(pixel, pixelCount),
			})),
		),
		id: portalModelCrossingId(id),
		junctionGroupId: null,
		reciprocalCrossingId: null,
		relationship: "indoor-boundary" as const,
		sourceScopeId,
		targetScopeId,
	};
}

function opaqueFragments(
	prefix: string,
	scopeId: ReturnType<typeof portalModelScopeId>,
	depth: number,
	pixelCount: number,
) {
	return Array.from({ length: pixelCount }, (_, pixel) => {
		const id = `${prefix}-${pixel}`;
		return {
			batchId: portalModelBatchId(id),
			depth: portalModelDepth(depth),
			id: portalModelFragmentId(id),
			kind: "opaque" as const,
			pixel: portalModelPixel(pixel, pixelCount),
			scopeId,
			submissionId: portalModelSubmissionId(id),
		};
	});
}

function solidPixels(
	color: readonly [number, number, number, number],
): Uint8Array {
	const pixels = new Uint8Array(
		DRAWING_EXTENT.width * DRAWING_EXTENT.height * 4,
	);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels.set(color, offset);
	}
	return pixels;
}

function pixelsMatch(actual: Uint8Array, expected: Uint8Array): boolean {
	if (actual.length !== expected.length) return false;
	for (let index = 0; index < actual.length; index += 1) {
		const actualComponent = actual[index];
		const expectedComponent = expected[index];
		if (
			actualComponent === undefined ||
			expectedComponent === undefined ||
			Math.abs(actualComponent - expectedComponent) > 2
		) {
			return false;
		}
	}
	return true;
}

function pixelRgbMatches(actual: Uint8Array, expected: Uint8Array): boolean {
	if (actual.length !== expected.length || actual.length % 4 !== 0)
		return false;
	for (let offset = 0; offset < actual.length; offset += 4) {
		for (let component = 0; component < 3; component += 1) {
			const actualComponent = actual[offset + component];
			const expectedComponent = expected[offset + component];
			if (
				actualComponent === undefined ||
				expectedComponent === undefined ||
				Math.abs(actualComponent - expectedComponent) > 2
			) {
				return false;
			}
		}
	}
	return true;
}

interface CapturedState {
	readonly activeTexture: GLenum;
	readonly arrayBuffer: WebGLBuffer | null;
	readonly blend: boolean;
	readonly colorMask: readonly [boolean, boolean, boolean, boolean];
	readonly cullFace: boolean;
	readonly depthFunction: GLenum;
	readonly depthMask: boolean;
	readonly depthTest: boolean;
	readonly drawFramebuffer: WebGLFramebuffer | null;
	readonly indexedUniformBuffer: WebGLBuffer | null;
	readonly polygonOffsetFill: boolean;
	readonly program: WebGLProgram | null;
	readonly readBuffer: GLenum;
	readonly readFramebuffer: WebGLFramebuffer | null;
	readonly scissorTest: boolean;
	readonly samplers: readonly (WebGLSampler | null)[];
	readonly stencilTest: boolean;
	readonly textures: readonly (WebGLTexture | null)[];
	readonly uniformBuffer: WebGLBuffer | null;
	readonly vertexArray: WebGLVertexArrayObject | null;
	readonly viewport: readonly [number, number, number, number];
}

function captureState(
	gl: WebGL2RenderingContext,
	metadataBindingPoint: number,
): CapturedState {
	const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as GLenum;
	const textures: (WebGLTexture | null)[] = [];
	const samplers: (WebGLSampler | null)[] = [];
	for (let unit = 0; unit <= 6; unit += 1) {
		gl.activeTexture(gl.TEXTURE0 + unit);
		textures.push(
			gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null,
		);
		samplers.push(gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null);
	}
	gl.activeTexture(activeTexture);
	return {
		activeTexture,
		arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
		blend: gl.isEnabled(gl.BLEND),
		colorMask: captureColorMask(gl),
		cullFace: gl.isEnabled(gl.CULL_FACE),
		depthFunction: gl.getParameter(gl.DEPTH_FUNC) as GLenum,
		depthMask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
		depthTest: gl.isEnabled(gl.DEPTH_TEST),
		drawFramebuffer: gl.getParameter(
			gl.DRAW_FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null,
		indexedUniformBuffer: gl.getIndexedParameter(
			gl.UNIFORM_BUFFER_BINDING,
			metadataBindingPoint,
		) as WebGLBuffer | null,
		polygonOffsetFill: gl.isEnabled(gl.POLYGON_OFFSET_FILL),
		program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
		readBuffer: gl.getParameter(gl.READ_BUFFER) as GLenum,
		readFramebuffer: gl.getParameter(
			gl.READ_FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null,
		samplers,
		scissorTest: gl.isEnabled(gl.SCISSOR_TEST),
		stencilTest: gl.isEnabled(gl.STENCIL_TEST),
		textures,
		uniformBuffer: gl.getParameter(
			gl.UNIFORM_BUFFER_BINDING,
		) as WebGLBuffer | null,
		vertexArray: gl.getParameter(
			gl.VERTEX_ARRAY_BINDING,
		) as WebGLVertexArrayObject | null,
		viewport: captureViewport(gl),
	};
}

function restoreState(
	gl: WebGL2RenderingContext,
	state: CapturedState,
	metadataBindingPoint: number,
): void {
	for (const [unit, texture] of state.textures.entries()) {
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, texture);
	}
	for (const [unit, sampler] of state.samplers.entries()) {
		gl.bindSampler(unit, sampler);
	}
	gl.activeTexture(state.activeTexture);
	gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
	gl.bindBufferBase(
		gl.UNIFORM_BUFFER,
		metadataBindingPoint,
		state.indexedUniformBuffer,
	);
	// Indexed binds may also change the generic binding, so restore the latter last.
	gl.bindBuffer(gl.UNIFORM_BUFFER, state.uniformBuffer);
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.drawFramebuffer);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer);
	gl.readBuffer(state.readBuffer);
	gl.useProgram(state.program);
	gl.bindVertexArray(state.vertexArray);
	gl.viewport(...state.viewport);
	gl.colorMask(...state.colorMask);
	gl.depthMask(state.depthMask);
	gl.depthFunc(state.depthFunction);
	setCapability(gl, gl.BLEND, state.blend);
	setCapability(gl, gl.CULL_FACE, state.cullFace);
	setCapability(gl, gl.DEPTH_TEST, state.depthTest);
	setCapability(gl, gl.POLYGON_OFFSET_FILL, state.polygonOffsetFill);
	setCapability(gl, gl.SCISSOR_TEST, state.scissorTest);
	setCapability(gl, gl.STENCIL_TEST, state.stencilTest);
}

function captureColorMask(
	gl: WebGL2RenderingContext,
): readonly [boolean, boolean, boolean, boolean] {
	const mask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
	const [red, green, blue, alpha] = mask;
	if (
		red === undefined ||
		green === undefined ||
		blue === undefined ||
		alpha === undefined
	) {
		throw new Error("WebGL2 returned an invalid color-write mask.");
	}
	return [red, green, blue, alpha];
}

function captureViewport(
	gl: WebGL2RenderingContext,
): readonly [number, number, number, number] {
	const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
	const [x, y, width, height] = viewport;
	if (
		x === undefined ||
		y === undefined ||
		width === undefined ||
		height === undefined
	) {
		throw new Error("WebGL2 returned an invalid viewport.");
	}
	return [x, y, width, height];
}

function setCapability(
	gl: WebGL2RenderingContext,
	capability: GLenum,
	enabled: boolean,
): void {
	if (enabled) gl.enable(capability);
	else gl.disable(capability);
}

function requireNoWebGL2Error(
	gl: WebGL2RenderingContext,
	checkpoint: string,
): void {
	const error = gl.getError();
	if (error !== gl.NO_ERROR) {
		throw new Error(`WebGL2 error ${error} observed ${checkpoint}.`);
	}
}

const DEPTH16_DRAWING_EXTENT = { height: 16, width: 24 } as const;
const DEPTH16_ATLAS_EXTENT = { height: 48, width: 96 } as const;

/**
 * Exercise the complete planner -> stream -> executor -> deferred path on a genuine 16-hop
 * cyclic chain returning to outdoor plus a wide 2-window child domain, and compare every pixel
 * against `composePortalReferenceFrameThroughPathDepth`.
 */
function runDepth16CyclicMultiWindowFixture(
	gl: WebGL2RenderingContext,
): Pick<
	WebGL2PortalScopeAtlasExecutorFixtureResult,
	| "depth16CyclicMultiWindowDeferredMatchesOracle"
	| "depth16CyclicMultiWindowResolveMatchesOracle"
> {
	const maxDepth = PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth;
	const state = captureState(gl, METADATA_BINDING_POINT);
	const targetOwner = new WebGL2PortalScopeAtlasTargets(gl);
	const executor = new WebGL2PortalScopeAtlasExecutor(
		gl,
		120,
		METADATA_BINDING_POINT,
	);
	const output = createOffscreenOutputTarget(gl, DEPTH16_DRAWING_EXTENT);
	const deferredProgram = createDeferredFixtureProgram(gl);
	const deferredVao = gl.createVertexArray();
	if (!deferredVao) {
		gl.deleteProgram(deferredProgram.program);
		output.destroy();
		executor.destroy();
		targetOwner.destroy();
		restoreState(gl, state, METADATA_BINDING_POINT);
		throw new Error("Failed to allocate depth-16 deferred fixture VAO.");
	}
	try {
		const chainScopes = Array.from({ length: maxDepth - 1 }, (_, index) => ({
			envCellId: `depth16-cell-${String(index).padStart(2, "0")}`,
			kind: "env-cell" as const,
			landblockId: FIXTURE_LANDBLOCK_ID,
		}));
		const wideHallScope: SceneScope = {
			envCellId: "depth16-wide-hall",
			kind: "env-cell",
			landblockId: FIXTURE_LANDBLOCK_ID,
		};
		const crossings: ScenePortalCrossing[] = [];
		for (let step = 0; step < maxDepth; step += 1) {
			const source = step === 0 ? FIXTURE_ROOT_SCOPE : chainScopes[step - 1]!;
			const target =
				step === maxDepth - 1 ? FIXTURE_ROOT_SCOPE : chainScopes[step]!;
			crossings.push(
				createRectCrossing(
					`chain-${String(step).padStart(2, "0")}`,
					source,
					target,
					-0.75,
					-0.5,
					-0.25,
					0.5,
					-(step + 1),
				),
			);
		}
		crossings.push(
			createRectCrossing(
				"wide-bottom",
				FIXTURE_ROOT_SCOPE,
				wideHallScope,
				0.25,
				-0.875,
				0.75,
				-0.5,
				-2,
			),
			createRectCrossing(
				"wide-top",
				FIXTURE_ROOT_SCOPE,
				wideHallScope,
				0.25,
				0.5,
				0.75,
				0.875,
				-2,
			),
		);
		const topology = createFixtureTopology(
			1,
			[
				{
					potentiallyVisibleEnvCellIds: new Set(),
					scope: FIXTURE_ROOT_SCOPE,
					visibilityIslandId: null,
				},
				...chainScopes.map((scope) => ({
					potentiallyVisibleEnvCellIds: new Set<string>(),
					scope,
					visibilityIslandId:
						`env-cell-island:${scope.envCellId}` as SceneTopologyScope["visibilityIslandId"],
				})),
				{
					potentiallyVisibleEnvCellIds: new Set(),
					scope: wideHallScope,
					visibilityIslandId: "env-cell-island:depth16-wide-hall",
				},
			],
			crossings,
		);
		const clipFromAnchor = createOrthographicMat4(-1, 1, -1, 1, 0, 20);
		const cullInput = {
			anchorCoordinates: getLandblockCoordinates(FIXTURE_LANDBLOCK_ID),
			clipFromAnchor,
			nearClipVolume: createCameraNearClipVolume(
				{ fov: 90, near: 0.5 },
				{ position: new Vec3(0, 0, 1), rotation: Quat.identity() },
				DEPTH16_DRAWING_EXTENT.width / DEPTH16_DRAWING_EXTENT.height,
			),
			portalFootprint: {
				drawingBuffer: DEPTH16_DRAWING_EXTENT,
				minimumPixelArea: 0,
			},
			rootScope: FIXTURE_ROOT_SCOPE,
		};
		const planner = new PortalScopeAtlasPlanner(
			PORTAL_RENDER_CAPACITY_POLICY.culler,
			maxDepth,
		);
		const frame = planner.plan(topology, cullInput, {
			atlas: DEPTH16_ATLAS_EXTENT,
			drawingBuffer: DEPTH16_DRAWING_EXTENT,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			maximumCrossingTriangleVertexCount: 120,
		});
		if (frame.commands.traversalDepth !== maxDepth) {
			throw new Error(
				`Depth-16 fixture converged early at ${frame.commands.traversalDepth} instead of ${maxDepth}.`,
			);
		}
		if (frame.roundCrossingCount(0) !== 3) {
			throw new Error(
				`Depth-16 fixture expected 3 Round-0 crossings, got ${frame.roundCrossingCount(0)}.`,
			);
		}
		for (let round = 1; round < maxDepth; round += 1) {
			if (frame.roundCrossingCount(round) !== 1) {
				throw new Error(
					`Depth-16 fixture expected 1 crossing at round ${round}, got ${frame.roundCrossingCount(round)}.`,
				);
			}
		}

		const stream = new PortalPropagationStreamArena(120, maxDepth).prepare(
			frame,
			cullInput.anchorCoordinates,
			clipFromAnchor,
		);
		const targets = targetOwner.resize({
			atlas: DEPTH16_ATLAS_EXTENT,
			drawingBuffer: DEPTH16_DRAWING_EXTENT,
		});

		const cell7Tile = frame.tileOrdinalForRenderScopeKey(
			chainScopes[7]!.envCellId,
		);
		const wideHallTile = frame.tileOrdinalForRenderScopeKey(
			wideHallScope.envCellId,
		);
		const seedDepth16Scene = () => {
			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.framebuffer);
			gl.viewport(
				0,
				0,
				DEPTH16_ATLAS_EXTENT.width,
				DEPTH16_ATLAS_EXTENT.height,
			);
			gl.colorMask(true, true, true, true);
			gl.depthMask(true);
			gl.disable(gl.SCISSOR_TEST);
			clearCurrentTile(gl, CLEAR_COLOR, 1);

			gl.enable(gl.SCISSOR_TEST);
			clearPlannedSubRect(
				gl,
				frame,
				0,
				0,
				0,
				DEPTH16_DRAWING_EXTENT.width,
				DEPTH16_DRAWING_EXTENT.height,
				ROOT_COLOR,
				0.5,
			);
			clearPlannedSubRect(gl, frame, 0, 4, 4, 5, 8, DEEP_COLOR, 0.95);
			clearPlannedSubRect(gl, frame, 0, 3, 4, 1, 8, ROOT_COLOR, 0.025);
			clearPlannedSubRect(gl, frame, 0, 4, 8, 1, 4, WEATHER_COLOR, 0.25);
			clearPlannedSubRect(
				gl,
				frame,
				cell7Tile,
				3,
				8,
				6,
				4,
				MIDDLE_COLOR,
				0.425,
			);
			clearPlannedSubRect(
				gl,
				frame,
				wideHallTile,
				frame.tileScreenX(wideHallTile),
				frame.tileScreenY(wideHallTile),
				frame.tileWidth(wideHallTile),
				frame.tileHeight(wideHallTile),
				LEAF_COLOR,
				0.15,
			);
			gl.disable(gl.SCISSOR_TEST);

			// Pre-dirty both frontier attachments with nonzero arrival ids and near depth so any
			// missing scissor coverage across shrinking/disjoint rounds fails loudly.
			for (const frontier of targets.frontiers) {
				gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, frontier.framebuffer);
				gl.viewport(
					0,
					0,
					DEPTH16_DRAWING_EXTENT.width,
					DEPTH16_DRAWING_EXTENT.height,
				);
				gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([2, 0, 0, 0]));
				gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([0.01]));
			}
		};

		seedDepth16Scene();
		output.clear();
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: DEPTH16_DRAWING_EXTENT,
			outputFramebuffer: output.framebuffer,
			stream,
			targets,
			traversalDepth: frame.commands.traversalDepth,
		});
		const resolvedPixels = output.readPixels();

		// Now compose deferred transparent layers on top of the resolved depth + envelope:
		// 1. cell_7 interior layer at 0.41 (between c_7=0.40 and cell_7 wall=0.425),
		// 2. outdoor post-cycle distant layer at 0.85 (between c_15=0.80 and backdrop=0.95),
		// 3. outdoor upper-band layer at 0.30 (must be blocked over cell_7 at y in [8,12)).
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, output.framebuffer);
		gl.viewport(
			0,
			0,
			DEPTH16_DRAWING_EXTENT.width,
			DEPTH16_DRAWING_EXTENT.height,
		);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);
		gl.depthMask(false);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.bindVertexArray(deferredVao);
		const envelopeUnit = PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth;
		gl.bindSampler(envelopeUnit, null);
		gl.activeTexture(gl.TEXTURE0 + envelopeUnit);
		gl.bindTexture(gl.TEXTURE_2D, targets.envelope.depth);
		gl.useProgram(deferredProgram.program);
		drawDeferredFixture(gl, deferredProgram, 0, 0.85, [1, 0, 1, 0.5]);
		drawDeferredFixture(gl, deferredProgram, cell7Tile, 0.41, [1, 1, 0, 0.5]);
		gl.enable(gl.SCISSOR_TEST);
		gl.scissor(0, 8, 12, 8);
		drawDeferredFixture(gl, deferredProgram, 0, 0.3, [0, 0, 1, 0.5]);
		gl.disable(gl.SCISSOR_TEST);
		const deferredPixels = output.readPixels();

		const expected = expectedDepth16OraclePixels(maxDepth, {
			height: frame.tileHeight(wideHallTile),
			width: frame.tileWidth(wideHallTile),
			x: frame.tileScreenX(wideHallTile),
			y: frame.tileScreenY(wideHallTile),
		});
		requireNoWebGL2Error(gl, "after depth-16 cyclic multi-window fixture");
		return {
			depth16CyclicMultiWindowDeferredMatchesOracle: pixelRgbMatches(
				deferredPixels,
				expected.deferredPixels,
			),
			depth16CyclicMultiWindowResolveMatchesOracle: pixelsMatch(
				resolvedPixels,
				expected.resolvedPixels,
			),
		};
	} finally {
		gl.deleteVertexArray(deferredVao);
		gl.deleteProgram(deferredProgram.program);
		output.destroy();
		executor.destroy();
		targetOwner.destroy();
		restoreState(gl, state, METADATA_BINDING_POINT);
	}
}

function createRectCrossing(
	id: string,
	source: SceneScope,
	target: SceneScope,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
	z: number,
): ScenePortalCrossing {
	const aperture = rectangleAperture(minX, minY, maxX, maxY, z);
	const sceneAperture: ScenePortalCrossing["sourceAperture"] = {
		id: `portal-aperture:${id}` as const,
		indices: aperture.indices,
		landblockBounds: boundsForAperture(aperture),
		landblockId: FIXTURE_LANDBLOCK_ID,
		plane: aperture.plane,
		vertices: aperture.vertices,
	};
	return {
		acceptedSide: "positive",
		exactMatch: true,
		id: `portal-crossing:${id}`,
		junctionGroupId: null,
		maskDepthPolicy: "allow-equal-depth",
		reciprocalCrossingId: null,
		source,
		sourceAperture: sceneAperture,
		spatialRelationship: {
			kind: "indoor-topology-boundary",
			reason: "synthetic-boundary",
		},
		target,
		visibilityAperture: sceneAperture,
	};
}

function clearPlannedSubRect(
	gl: WebGL2RenderingContext,
	frame: PortalScopeAtlasFrameView,
	ordinal: number,
	screenX: number,
	screenY: number,
	width: number,
	height: number,
	color: readonly [number, number, number, number],
	depth: number,
): void {
	const atlasX = frame.tileX(ordinal) + (screenX - frame.tileScreenX(ordinal));
	const atlasY = frame.tileY(ordinal) + (screenY - frame.tileScreenY(ordinal));
	gl.scissor(atlasX, atlasY, width, height);
	clearCurrentTile(gl, color, depth);
}

function createOffscreenOutputTarget(
	gl: WebGL2RenderingContext,
	extent: { readonly width: number; readonly height: number },
) {
	const framebuffer = gl.createFramebuffer();
	const color = gl.createTexture();
	const depth = gl.createRenderbuffer();
	if (!framebuffer || !color || !depth) {
		if (framebuffer) gl.deleteFramebuffer(framebuffer);
		if (color) gl.deleteTexture(color);
		if (depth) gl.deleteRenderbuffer(depth);
		throw new Error("Failed to allocate offscreen fixture framebuffer.");
	}
	gl.bindTexture(gl.TEXTURE_2D, color);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA8,
		extent.width,
		extent.height,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		null,
	);
	gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
	gl.renderbufferStorage(
		gl.RENDERBUFFER,
		gl.DEPTH_COMPONENT24,
		extent.width,
		extent.height,
	);
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(
		gl.DRAW_FRAMEBUFFER,
		gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D,
		color,
		0,
	);
	gl.framebufferRenderbuffer(
		gl.DRAW_FRAMEBUFFER,
		gl.DEPTH_ATTACHMENT,
		gl.RENDERBUFFER,
		depth,
	);
	return {
		clear() {
			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
			gl.viewport(0, 0, extent.width, extent.height);
			gl.disable(gl.SCISSOR_TEST);
			gl.colorMask(true, true, true, true);
			gl.depthMask(true);
			clearCurrentTile(gl, STALE_OUTPUT_COLOR, 0.05);
		},
		destroy() {
			gl.deleteFramebuffer(framebuffer);
			gl.deleteTexture(color);
			gl.deleteRenderbuffer(depth);
		},
		framebuffer,
		readPixels(): Uint8Array {
			const pixels = new Uint8Array(extent.width * extent.height * 4);
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
			gl.readBuffer(gl.COLOR_ATTACHMENT0);
			gl.readPixels(
				0,
				0,
				extent.width,
				extent.height,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				pixels,
			);
			return pixels;
		},
	};
}

function expectedDepth16OraclePixels(
	maxDepth: number,
	wideHallWindow: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	},
): {
	readonly deferredPixels: Uint8Array;
	readonly resolvedPixels: Uint8Array;
} {
	const width = DEPTH16_DRAWING_EXTENT.width;
	const height = DEPTH16_DRAWING_EXTENT.height;
	const pixelCount = width * height;
	const rootScope = portalModelScopeId("root");
	const rootDomain = portalModelDomainId("root-domain");
	const chainScopeIds = Array.from({ length: maxDepth - 1 }, (_, index) =>
		portalModelScopeId(`cell-${index}`),
	);
	const chainDomainIds = Array.from({ length: maxDepth - 1 }, (_, index) =>
		portalModelDomainId(`cell-domain-${index}`),
	);
	const wideScope = portalModelScopeId("wide-hall");
	const wideDomain = portalModelDomainId("wide-hall-domain");

	const chainAperturePixels = rectPixels(width, 3, 4, 6, 8);
	const bottomWindowPixels = rectPixels(width, 15, 1, 6, 3);
	const topWindowPixels = rectPixels(width, 15, 12, 6, 3);
	const modelDepthFromWindow = (windowDepth: number) =>
		portalModelDepth(Math.round(windowDepth * 1000));

	const rootFragments: NonNullable<
		Parameters<typeof createPortalModelScene>[0]["domains"][number]["fragments"]
	>[number][] = [];
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const pixel = y * width + x;
			let tag = "root-base";
			let depth = 0.5;
			if (x === 3 && y >= 4 && y < 12) {
				tag = "root-near";
				depth = 0.025;
			} else if (x === 4 && y >= 8 && y < 12) {
				tag = "root-mid-occluder";
				depth = 0.25;
			} else if (x >= 4 && x < 9 && y >= 4 && y < 12) {
				tag = "root-distant";
				depth = 0.95;
			}
			const id = `${tag}-${pixel}`;
			rootFragments.push({
				batchId: portalModelBatchId(id),
				depth: modelDepthFromWindow(depth),
				id: portalModelFragmentId(id),
				kind: "opaque",
				pixel: portalModelPixel(pixel, pixelCount),
				scopeId: rootScope,
				submissionId: portalModelSubmissionId(id),
			});
			const postCycleId = `blend-distant-${pixel}`;
			rootFragments.push({
				batchId: portalModelBatchId("blend-distant"),
				depth: modelDepthFromWindow(0.85),
				id: portalModelFragmentId(postCycleId),
				kind: "alpha-blended",
				pixel: portalModelPixel(pixel, pixelCount),
				scopeId: rootScope,
				submissionId: portalModelSubmissionId("2-blend-distant"),
			});
			if (x < 12 && y >= 8) {
				const upperBlendId = `blend-upper-${pixel}`;
				rootFragments.push({
					batchId: portalModelBatchId("blend-upper"),
					depth: modelDepthFromWindow(0.3),
					id: portalModelFragmentId(upperBlendId),
					kind: "alpha-blended",
					pixel: portalModelPixel(pixel, pixelCount),
					scopeId: rootScope,
					submissionId: portalModelSubmissionId("3-blend-upper"),
				});
			}
		}
	}

	const cell7Fragments: typeof rootFragments = [];
	for (const pixel of rectPixels(width, 3, 8, 6, 4)) {
		const id = `cell7-wall-${pixel}`;
		cell7Fragments.push({
			batchId: portalModelBatchId(id),
			depth: modelDepthFromWindow(0.425),
			id: portalModelFragmentId(id),
			kind: "opaque",
			pixel: portalModelPixel(pixel, pixelCount),
			scopeId: chainScopeIds[7]!,
			submissionId: portalModelSubmissionId(id),
		});
	}
	for (const pixel of chainAperturePixels) {
		const id = `blend-cell7-${pixel}`;
		cell7Fragments.push({
			batchId: portalModelBatchId("blend-cell7"),
			depth: modelDepthFromWindow(0.41),
			id: portalModelFragmentId(id),
			kind: "alpha-blended",
			pixel: portalModelPixel(pixel, pixelCount),
			scopeId: chainScopeIds[7]!,
			submissionId: portalModelSubmissionId("1-blend-cell7"),
		});
	}

	const wideHallFragments: typeof rootFragments = [];
	for (const pixel of rectPixels(
		width,
		wideHallWindow.x,
		wideHallWindow.y,
		wideHallWindow.width,
		wideHallWindow.height,
	)) {
		const id = `wide-leaf-${pixel}`;
		wideHallFragments.push({
			batchId: portalModelBatchId(id),
			depth: modelDepthFromWindow(0.15),
			id: portalModelFragmentId(id),
			kind: "opaque",
			pixel: portalModelPixel(pixel, pixelCount),
			scopeId: wideScope,
			submissionId: portalModelSubmissionId(id),
		});
	}

	const modelCrossings = Array.from({ length: maxDepth }, (_, step) => ({
		aperture: createPortalModelAperture(
			pixelCount,
			chainAperturePixels.map((pixel) => ({
				depth: modelDepthFromWindow((step + 1) / 20),
				pixel: portalModelPixel(pixel, pixelCount),
			})),
		),
		id: portalModelCrossingId(`chain-${step}`),
		junctionGroupId: null,
		reciprocalCrossingId: null,
		relationship: "indoor-boundary" as const,
		sourceScopeId: step === 0 ? rootScope : chainScopeIds[step - 1]!,
		targetScopeId: step === maxDepth - 1 ? rootScope : chainScopeIds[step]!,
	}));
	modelCrossings.push(
		{
			aperture: createPortalModelAperture(
				pixelCount,
				bottomWindowPixels.map((pixel) => ({
					depth: modelDepthFromWindow(0.1),
					pixel: portalModelPixel(pixel, pixelCount),
				})),
			),
			id: portalModelCrossingId("wide-bottom"),
			junctionGroupId: null,
			reciprocalCrossingId: null,
			relationship: "indoor-boundary",
			sourceScopeId: rootScope,
			targetScopeId: wideScope,
		},
		{
			aperture: createPortalModelAperture(
				pixelCount,
				topWindowPixels.map((pixel) => ({
					depth: modelDepthFromWindow(0.1),
					pixel: portalModelPixel(pixel, pixelCount),
				})),
			),
			id: portalModelCrossingId("wide-top"),
			junctionGroupId: null,
			reciprocalCrossingId: null,
			relationship: "indoor-boundary",
			sourceScopeId: rootScope,
			targetScopeId: wideScope,
		},
	);

	const oracleFrame = composePortalReferenceFrameThroughPathDepth(
		createPortalModelScene({
			crossings: modelCrossings,
			domains: [
				{ fragments: rootFragments, id: rootDomain },
				...chainDomainIds.map((id, index) => ({
					fragments: index === 7 ? cell7Fragments : [],
					id,
				})),
				{ fragments: wideHallFragments, id: wideDomain },
			],
			pixelCount,
			rootScopeId: rootScope,
			scopes: [
				{ domainId: rootDomain, id: rootScope },
				...chainScopeIds.map((id, index) => ({
					domainId: chainDomainIds[index]!,
					id,
				})),
				{ domainId: wideDomain, id: wideScope },
			],
		}),
		maxDepth,
	);

	const exactWidePixels = new Set<number>();
	for (const result of oracleFrame.pixels) {
		if (result.opaque?.fragmentId.startsWith("wide-leaf-")) {
			exactWidePixels.add(result.pixel);
		}
	}
	const dilatedWidePixels = dilatePixelsWithinBounds(
		exactWidePixels,
		width,
		PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
		wideHallWindow,
	);

	const colorForOpaqueFragment = (
		fragmentId: string | undefined,
	): readonly [number, number, number, number] => {
		if (!fragmentId) return CLEAR_COLOR;
		if (fragmentId.startsWith("wide-leaf-")) return LEAF_COLOR;
		if (fragmentId.startsWith("cell7-wall-")) return MIDDLE_COLOR;
		if (fragmentId.startsWith("root-distant-")) return DEEP_COLOR;
		if (fragmentId.startsWith("root-mid-occluder-")) return WEATHER_COLOR;
		return ROOT_COLOR;
	};
	const rgbForAlphaFragment = (
		fragmentId: string,
	): readonly [number, number, number] => {
		if (fragmentId.startsWith("blend-cell7-")) return [255, 255, 0];
		if (fragmentId.startsWith("blend-distant-")) return [255, 0, 255];
		return [0, 0, 255];
	};

	const resolvedPixels = new Uint8Array(pixelCount * 4);
	const deferredPixels = new Uint8Array(pixelCount * 4);
	for (const result of oracleFrame.pixels) {
		const baseColor = dilatedWidePixels.has(result.pixel)
			? LEAF_COLOR
			: colorForOpaqueFragment(result.opaque?.fragmentId);
		resolvedPixels.set(baseColor, result.pixel * 4);
		let color = baseColor;
		for (const layer of result.alphaBlended) {
			color = blendHalf(color, rgbForAlphaFragment(layer.fragmentId));
		}
		deferredPixels.set(color, result.pixel * 4);
	}
	return { deferredPixels, resolvedPixels };
}

/**
 * Exercise broad viewport coverage (~47% exact doorway area, ~82% Round-0 scissor), true branching
 * fan-out (`roundCrossingCount >= 2` on every round `0..15`), and repeated non-root child-domain
 * re-entry (`3` shared indoor visibility islands cycled 5+ times each across non-adjacent rounds
 * before returning to `outdoor` on Round 15), verified against `composePortalReferenceFrameThroughPathDepth`.
 */
function runDepth16BranchingChildCycleFixture(
	gl: WebGL2RenderingContext,
): Pick<
	WebGL2PortalScopeAtlasExecutorFixtureResult,
	| "depth16BranchingChildCycleDeferredMatchesOracle"
	| "depth16BranchingChildCycleMetrics"
	| "depth16BranchingChildCycleResolveMatchesOracle"
> {
	const branchingDrawingExtent = { height: 32, width: 32 } as const;
	const branchingAtlasExtent = { height: 96, width: 128 } as const;
	const maxDepth = PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth;
	const state = captureState(gl, METADATA_BINDING_POINT);
	const targetOwner = new WebGL2PortalScopeAtlasTargets(gl);
	const executor = new WebGL2PortalScopeAtlasExecutor(
		gl,
		240,
		METADATA_BINDING_POINT,
	);
	const output = createOffscreenOutputTarget(gl, branchingDrawingExtent);
	const deferredProgram = createDeferredFixtureProgram(gl);
	const deferredVao = gl.createVertexArray();
	if (!deferredVao) {
		gl.deleteProgram(deferredProgram.program);
		output.destroy();
		executor.destroy();
		targetOwner.destroy();
		restoreState(gl, state, METADATA_BINDING_POINT);
		throw new Error(
			"Failed to allocate branching depth-16 deferred fixture VAO.",
		);
	}
	try {
		const leftScopes = Array.from({ length: maxDepth - 1 }, (_, index) => ({
			envCellId: `branch-left-${String(index).padStart(2, "0")}`,
			kind: "env-cell" as const,
			landblockId: FIXTURE_LANDBLOCK_ID,
		}));
		const rightScopes = Array.from({ length: maxDepth - 1 }, (_, index) => ({
			envCellId: `branch-right-${String(index).padStart(2, "0")}`,
			kind: "env-cell" as const,
			landblockId: FIXTURE_LANDBLOCK_ID,
		}));
		const islandIds = [
			"env-cell-island:shared-hub-0",
			"env-cell-island:shared-hub-1",
			"env-cell-island:shared-hub-2",
		] as const satisfies readonly NonNullable<
			SceneTopologyScope["visibilityIslandId"]
		>[];

		// Power-of-two 32x32 drawing buffer makes every doorway edge an exact binary32 NDC coordinate:
		// Left doorway covers x in [3, 13), y in [4, 28); Right doorway covers x in [19, 29), y in [4, 28).
		const leftMinNdcX = (2 * 3) / branchingDrawingExtent.width - 1;
		const leftMaxNdcX = (2 * 13) / branchingDrawingExtent.width - 1;
		const rightMinNdcX = (2 * 19) / branchingDrawingExtent.width - 1;
		const rightMaxNdcX = (2 * 29) / branchingDrawingExtent.width - 1;
		const doorwayMinNdcY = (2 * 4) / branchingDrawingExtent.height - 1;
		const doorwayMaxNdcY = (2 * 28) / branchingDrawingExtent.height - 1;

		const crossings: ScenePortalCrossing[] = [];
		for (let step = 0; step < maxDepth; step += 1) {
			const leftSource =
				step === 0 ? FIXTURE_ROOT_SCOPE : leftScopes[step - 1]!;
			const leftTarget =
				step === maxDepth - 1 ? FIXTURE_ROOT_SCOPE : leftScopes[step]!;
			crossings.push(
				createRectCrossing(
					`left-${String(step).padStart(2, "0")}`,
					leftSource,
					leftTarget,
					leftMinNdcX,
					doorwayMinNdcY,
					leftMaxNdcX,
					doorwayMaxNdcY,
					-(step + 1),
				),
			);
			const rightSource =
				step === 0 ? FIXTURE_ROOT_SCOPE : rightScopes[step - 1]!;
			const rightTarget =
				step === maxDepth - 1 ? FIXTURE_ROOT_SCOPE : rightScopes[step]!;
			crossings.push(
				createRectCrossing(
					`right-${String(step).padStart(2, "0")}`,
					rightSource,
					rightTarget,
					rightMinNdcX,
					doorwayMinNdcY,
					rightMaxNdcX,
					doorwayMaxNdcY,
					-(step + 1),
				),
			);
		}

		const topology = createFixtureTopology(
			1,
			[
				{
					potentiallyVisibleEnvCellIds: new Set(),
					scope: FIXTURE_ROOT_SCOPE,
					visibilityIslandId: null,
				},
				...leftScopes.map((scope, index) => ({
					potentiallyVisibleEnvCellIds: new Set<string>(),
					scope,
					visibilityIslandId: islandIds[index % 3]!,
				})),
				...rightScopes.map((scope, index) => ({
					potentiallyVisibleEnvCellIds: new Set<string>(),
					scope,
					visibilityIslandId: islandIds[(index + 1) % 3]!,
				})),
			],
			crossings,
		);

		const clipFromAnchor = createOrthographicMat4(-1, 1, -1, 1, 0, 20);
		const cullInput = {
			anchorCoordinates: getLandblockCoordinates(FIXTURE_LANDBLOCK_ID),
			clipFromAnchor,
			nearClipVolume: createCameraNearClipVolume(
				{ fov: 90, near: 0.5 },
				{ position: new Vec3(0, 0, 1), rotation: Quat.identity() },
				branchingDrawingExtent.width / branchingDrawingExtent.height,
			),
			portalFootprint: {
				drawingBuffer: branchingDrawingExtent,
				minimumPixelArea: 0,
			},
			rootScope: FIXTURE_ROOT_SCOPE,
		};
		const planner = new PortalScopeAtlasPlanner(
			PORTAL_RENDER_CAPACITY_POLICY.culler,
			maxDepth,
		);
		const frame = planner.plan(topology, cullInput, {
			atlas: branchingAtlasExtent,
			drawingBuffer: branchingDrawingExtent,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			maximumCrossingTriangleVertexCount: 240,
		});
		if (frame.commands.traversalDepth !== maxDepth) {
			throw new Error(
				`Branching depth-16 fixture converged at ${frame.commands.traversalDepth} instead of ${maxDepth}.`,
			);
		}
		if (frame.tileCount !== 4) {
			throw new Error(
				`Branching depth-16 fixture expected 4 shared render-domain tiles, got ${frame.tileCount}.`,
			);
		}
		let minimumRoundCrossingCount = Number.POSITIVE_INFINITY;
		for (let round = 0; round < maxDepth; round += 1) {
			minimumRoundCrossingCount = Math.min(
				minimumRoundCrossingCount,
				frame.roundCrossingCount(round),
			);
		}
		if (minimumRoundCrossingCount < 2) {
			throw new Error(
				`Branching depth-16 fixture expected >= 2 active crossings on every round, got ${minimumRoundCrossingCount}.`,
			);
		}

		const stream = new PortalPropagationStreamArena(240, maxDepth).prepare(
			frame,
			cullInput.anchorCoordinates,
			clipFromAnchor,
		);
		const targets = targetOwner.resize({
			atlas: branchingAtlasExtent,
			drawingBuffer: branchingDrawingExtent,
		});

		// `leftScopes[7]` (step 7, [0.40, 0.45)) maps to `islandIds[1]`, visited 5 times on each branch.
		const hub1Tile = frame.tileOrdinalForRenderScopeKey(
			leftScopes[7]!.envCellId,
		);
		// `rightScopes[10]` (step 10, [0.55, 0.60)) maps to `islandIds[2]`, visited 5 times on each branch.
		const hub2Tile = frame.tileOrdinalForRenderScopeKey(
			rightScopes[10]!.envCellId,
		);

		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.framebuffer);
		gl.viewport(0, 0, branchingAtlasExtent.width, branchingAtlasExtent.height);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.disable(gl.SCISSOR_TEST);
		clearCurrentTile(gl, CLEAR_COLOR, 1);

		gl.enable(gl.SCISSOR_TEST);
		// Root wall at 0.50 outside doorways; distant post-cycle sky at 0.95 inside both doorways;
		// near pillar at x = 3 (depth 0.025) blocking the leftmost column of the left doorway.
		clearPlannedSubRect(
			gl,
			frame,
			0,
			0,
			0,
			branchingDrawingExtent.width,
			branchingDrawingExtent.height,
			ROOT_COLOR,
			0.5,
		);
		clearPlannedSubRect(gl, frame, 0, 4, 4, 9, 24, DEEP_COLOR, 0.95);
		clearPlannedSubRect(gl, frame, 0, 3, 4, 1, 24, ROOT_COLOR, 0.025);
		clearPlannedSubRect(gl, frame, 0, 19, 4, 10, 24, DEEP_COLOR, 0.95);
		// Shared `hub1` interior wall on upper Left doorway at 0.425 (skipped on visits 1..2, hits on visit 3).
		clearPlannedSubRect(
			gl,
			frame,
			hub1Tile,
			3,
			16,
			10,
			12,
			MIDDLE_COLOR,
			0.425,
		);
		// Shared `hub2` interior wall on lower Right doorway at 0.575 (skipped on visits 1..3, hits on visit 4).
		clearPlannedSubRect(gl, frame, hub2Tile, 19, 4, 10, 12, LEAF_COLOR, 0.575);
		gl.disable(gl.SCISSOR_TEST);

		for (const frontier of targets.frontiers) {
			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, frontier.framebuffer);
			gl.viewport(
				0,
				0,
				branchingDrawingExtent.width,
				branchingDrawingExtent.height,
			);
			gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([3, 0, 0, 0]));
			gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([0.01]));
		}

		output.clear();
		executor.execute({
			clearColor: CLEAR_COLOR_NORMALIZED,
			outputExtent: branchingDrawingExtent,
			outputFramebuffer: output.framebuffer,
			stream,
			targets,
			traversalDepth: frame.commands.traversalDepth,
		});
		const resolvedPixels = output.readPixels();

		// Compose deferred transparent layers across both half-screens and the post-cycle outdoor backdrop.
		// Extending `hub1Tile` across x in [0, 16) tests tile-window rejection at x in [0, 3), gutter
		// tolerance at x in [13, 15), and envelope confinement at x = 15 inside the coalesced [3, 29) tile.
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, output.framebuffer);
		gl.viewport(
			0,
			0,
			branchingDrawingExtent.width,
			branchingDrawingExtent.height,
		);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);
		gl.depthMask(false);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.bindVertexArray(deferredVao);
		const envelopeUnit = PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth;
		gl.bindSampler(envelopeUnit, null);
		gl.activeTexture(gl.TEXTURE0 + envelopeUnit);
		gl.bindTexture(gl.TEXTURE_2D, targets.envelope.depth);
		gl.useProgram(deferredProgram.program);
		drawDeferredFixture(gl, deferredProgram, 0, 0.85, [1, 0, 1, 0.5]);
		gl.enable(gl.SCISSOR_TEST);
		gl.scissor(0, 0, 16, branchingDrawingExtent.height);
		drawDeferredFixture(gl, deferredProgram, hub1Tile, 0.41, [1, 1, 0, 0.5]);
		gl.scissor(16, 0, 16, branchingDrawingExtent.height);
		drawDeferredFixture(gl, deferredProgram, hub2Tile, 0.56, [0, 1, 1, 0.5]);
		gl.disable(gl.SCISSOR_TEST);
		const deferredPixels = output.readPixels();

		const expected = expectedDepth16BranchingChildCycleOraclePixels(
			maxDepth,
			branchingDrawingExtent,
			{
				height: frame.tileHeight(hub1Tile),
				width: frame.tileWidth(hub1Tile),
				x: frame.tileScreenX(hub1Tile),
				y: frame.tileScreenY(hub1Tile),
			},
		);
		const totalViewportPixels =
			branchingDrawingExtent.width * branchingDrawingExtent.height;
		const round0AperturePixels = 2 * 10 * 24;
		const round0ScissorPixels =
			frame.roundFrontierScissorWidth(0) * frame.roundFrontierScissorHeight(0);
		requireNoWebGL2Error(gl, "after branching depth-16 child-cycle fixture");
		return {
			depth16BranchingChildCycleDeferredMatchesOracle: pixelRgbMatches(
				deferredPixels,
				expected.deferredPixels,
			),
			depth16BranchingChildCycleMetrics: {
				atlasHeight: branchingAtlasExtent.height,
				atlasWidth: branchingAtlasExtent.width,
				drawingBufferHeight: branchingDrawingExtent.height,
				drawingBufferWidth: branchingDrawingExtent.width,
				maskPropagationInstanceCount:
					frame.commands.maskPropagationInstanceCount,
				minimumRoundCrossingCount,
				opaqueCompositeInstanceCount:
					frame.commands.opaqueCompositeInstanceCount,
				round0ApertureCoverageRatio: round0AperturePixels / totalViewportPixels,
				round0ScissorCoverageRatio: round0ScissorPixels / totalViewportPixels,
				scopeEnvelopeReductionInstanceCount:
					frame.commands.scopeEnvelopeReductionInstanceCount,
				tileCount: frame.tileCount,
				traversalDepth: frame.commands.traversalDepth,
			},
			depth16BranchingChildCycleResolveMatchesOracle: pixelsMatch(
				resolvedPixels,
				expected.resolvedPixels,
			),
		};
	} finally {
		gl.deleteVertexArray(deferredVao);
		gl.deleteProgram(deferredProgram.program);
		output.destroy();
		executor.destroy();
		targetOwner.destroy();
		restoreState(gl, state, METADATA_BINDING_POINT);
	}
}

function expectedDepth16BranchingChildCycleOraclePixels(
	maxDepth: number,
	extent: { readonly height: number; readonly width: number },
	hub1Window: {
		readonly height: number;
		readonly width: number;
		readonly x: number;
		readonly y: number;
	},
): {
	readonly deferredPixels: Uint8Array;
	readonly resolvedPixels: Uint8Array;
} {
	const width = extent.width;
	const height = extent.height;
	const pixelCount = width * height;
	const rootScope = portalModelScopeId("root");
	const rootDomain = portalModelDomainId("root-domain");
	const sharedDomains = [
		portalModelDomainId("shared-hub-0"),
		portalModelDomainId("shared-hub-1"),
		portalModelDomainId("shared-hub-2"),
	] as const;
	const leftScopeIds = Array.from({ length: maxDepth - 1 }, (_, index) =>
		portalModelScopeId(`left-${index}`),
	);
	const rightScopeIds = Array.from({ length: maxDepth - 1 }, (_, index) =>
		portalModelScopeId(`right-${index}`),
	);
	const leftDoorwayPixels = rectPixels(width, 3, 4, 10, 24);
	const rightDoorwayPixels = rectPixels(width, 19, 4, 10, 24);
	const modelDepthFromWindow = (windowDepth: number) =>
		portalModelDepth(Math.round(windowDepth * 1000));

	type ModelFragment = NonNullable<
		Parameters<typeof createPortalModelScene>[0]["domains"][number]["fragments"]
	>[number];
	const rootFragments: ModelFragment[] = [];
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const pixel = y * width + x;
			let tag = "root-wall";
			let depth = 0.5;
			if (x === 3 && y >= 4 && y < 28) {
				tag = "root-pillar";
				depth = 0.025;
			} else if (
				((x >= 4 && x < 13) || (x >= 19 && x < 29)) &&
				y >= 4 &&
				y < 28
			) {
				tag = "root-distant";
				depth = 0.95;
			}
			const id = `${tag}-${pixel}`;
			rootFragments.push({
				batchId: portalModelBatchId(id),
				depth: modelDepthFromWindow(depth),
				id: portalModelFragmentId(id),
				kind: "opaque",
				pixel: portalModelPixel(pixel, pixelCount),
				scopeId: rootScope,
				submissionId: portalModelSubmissionId(id),
			});
			const distantBlendId = `blend-distant-${pixel}`;
			rootFragments.push({
				batchId: portalModelBatchId("blend-distant"),
				depth: modelDepthFromWindow(0.85),
				id: portalModelFragmentId(distantBlendId),
				kind: "alpha-blended",
				pixel: portalModelPixel(pixel, pixelCount),
				scopeId: rootScope,
				submissionId: portalModelSubmissionId("1-blend-distant"),
			});
		}
	}

	const hubFragments: [ModelFragment[], ModelFragment[], ModelFragment[]] = [
		[],
		[],
		[],
	];
	for (const pixel of rectPixels(width, 3, 16, 10, 12)) {
		const id = `hub1-wall-${pixel}`;
		hubFragments[1].push({
			batchId: portalModelBatchId(id),
			depth: modelDepthFromWindow(0.425),
			id: portalModelFragmentId(id),
			kind: "opaque",
			pixel: portalModelPixel(pixel, pixelCount),
			scopeId: leftScopeIds[7]!,
			submissionId: portalModelSubmissionId(id),
		});
	}
	for (const pixel of rectPixels(width, 0, 0, 16, height)) {
		const id = `blend-hub1-${pixel}`;
		hubFragments[1].push({
			batchId: portalModelBatchId("blend-hub1"),
			depth: modelDepthFromWindow(0.41),
			id: portalModelFragmentId(id),
			kind: "alpha-blended",
			pixel: portalModelPixel(pixel, pixelCount),
			scopeId: leftScopeIds[7]!,
			submissionId: portalModelSubmissionId("2-blend-hub1"),
		});
	}
	for (const pixel of rectPixels(width, 19, 4, 10, 12)) {
		const id = `hub2-wall-${pixel}`;
		hubFragments[2].push({
			batchId: portalModelBatchId(id),
			depth: modelDepthFromWindow(0.575),
			id: portalModelFragmentId(id),
			kind: "opaque",
			pixel: portalModelPixel(pixel, pixelCount),
			scopeId: rightScopeIds[10]!,
			submissionId: portalModelSubmissionId(id),
		});
	}
	for (const pixel of rectPixels(width, 16, 0, 16, height)) {
		const id = `blend-hub2-${pixel}`;
		hubFragments[2].push({
			batchId: portalModelBatchId("blend-hub2"),
			depth: modelDepthFromWindow(0.56),
			id: portalModelFragmentId(id),
			kind: "alpha-blended",
			pixel: portalModelPixel(pixel, pixelCount),
			scopeId: rightScopeIds[10]!,
			submissionId: portalModelSubmissionId("3-blend-hub2"),
		});
	}

	const modelCrossings: Parameters<
		typeof createPortalModelScene
	>[0]["crossings"][number][] = [];
	for (let step = 0; step < maxDepth; step += 1) {
		modelCrossings.push(
			{
				aperture: createPortalModelAperture(
					pixelCount,
					leftDoorwayPixels.map((pixel) => ({
						depth: modelDepthFromWindow((step + 1) / 20),
						pixel: portalModelPixel(pixel, pixelCount),
					})),
				),
				id: portalModelCrossingId(`left-${step}`),
				junctionGroupId: null,
				reciprocalCrossingId: null,
				relationship: "indoor-boundary",
				sourceScopeId: step === 0 ? rootScope : leftScopeIds[step - 1]!,
				targetScopeId: step === maxDepth - 1 ? rootScope : leftScopeIds[step]!,
			},
			{
				aperture: createPortalModelAperture(
					pixelCount,
					rightDoorwayPixels.map((pixel) => ({
						depth: modelDepthFromWindow((step + 1) / 20),
						pixel: portalModelPixel(pixel, pixelCount),
					})),
				),
				id: portalModelCrossingId(`right-${step}`),
				junctionGroupId: null,
				reciprocalCrossingId: null,
				relationship: "indoor-boundary",
				sourceScopeId: step === 0 ? rootScope : rightScopeIds[step - 1]!,
				targetScopeId: step === maxDepth - 1 ? rootScope : rightScopeIds[step]!,
			},
		);
	}

	const oracleFrame = composePortalReferenceFrameThroughPathDepth(
		createPortalModelScene({
			crossings: modelCrossings,
			domains: [
				{ fragments: rootFragments, id: rootDomain },
				{ fragments: hubFragments[0], id: sharedDomains[0] },
				{ fragments: hubFragments[1], id: sharedDomains[1] },
				{ fragments: hubFragments[2], id: sharedDomains[2] },
			],
			pixelCount,
			rootScopeId: rootScope,
			scopes: [
				{ domainId: rootDomain, id: rootScope },
				...leftScopeIds.map((id, index) => ({
					domainId: sharedDomains[index % 3]!,
					id,
				})),
				...rightScopeIds.map((id, index) => ({
					domainId: sharedDomains[(index + 1) % 3]!,
					id,
				})),
			],
		}),
		maxDepth,
	);

	// Production deferred visibility dilates exact domain ownership by `PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS`
	// inside the domain's declared tile window (`hub1Window`), admitting `blend-hub1` (`0.41 < 0.50` root wall)
	// within `PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS` texels of the Left doorway while still rejecting `x = 15`.
	const exactHub1BlendPixels = new Set<number>();
	for (const result of oracleFrame.pixels) {
		if (
			result.alphaBlended.some((layer) =>
				layer.fragmentId.startsWith("blend-hub1-"),
			)
		) {
			exactHub1BlendPixels.add(result.pixel);
		}
	}
	const clampedHub1LeftMinX = Math.max(0, hub1Window.x);
	const clampedHub1LeftMaxX = Math.min(16, hub1Window.x + hub1Window.width);
	const dilatedHub1BlendPixels =
		clampedHub1LeftMinX < clampedHub1LeftMaxX
			? dilatePixelsWithinBounds(
					exactHub1BlendPixels,
					width,
					PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
					{
						height: hub1Window.height,
						width: clampedHub1LeftMaxX - clampedHub1LeftMinX,
						x: clampedHub1LeftMinX,
						y: hub1Window.y,
					},
				)
			: new Set<number>();
	const gutterOnlyHub1BlendPixels = new Set<number>();
	for (const candidate of dilatedHub1BlendPixels) {
		if (!exactHub1BlendPixels.has(candidate)) {
			gutterOnlyHub1BlendPixels.add(candidate);
		}
	}

	const colorForOpaque = (
		fragmentId: string | undefined,
	): readonly [number, number, number, number] => {
		if (!fragmentId) return CLEAR_COLOR;
		if (fragmentId.startsWith("hub1-wall-")) return MIDDLE_COLOR;
		if (fragmentId.startsWith("hub2-wall-")) return LEAF_COLOR;
		if (fragmentId.startsWith("root-distant-")) return DEEP_COLOR;
		return ROOT_COLOR;
	};
	const rgbForAlpha = (
		fragmentId: string,
	): readonly [number, number, number] => {
		if (fragmentId.startsWith("blend-hub1-")) return [255, 255, 0];
		if (fragmentId.startsWith("blend-hub2-")) return [0, 255, 255];
		return [255, 0, 255];
	};

	const resolvedPixels = new Uint8Array(pixelCount * 4);
	const deferredPixels = new Uint8Array(pixelCount * 4);
	for (const result of oracleFrame.pixels) {
		const baseColor = colorForOpaque(result.opaque?.fragmentId);
		resolvedPixels.set(baseColor, result.pixel * 4);
		let color = baseColor;
		for (const layer of result.alphaBlended) {
			color = blendHalf(color, rgbForAlpha(layer.fragmentId));
		}
		if (
			gutterOnlyHub1BlendPixels.has(result.pixel) &&
			(result.opaque?.depth ?? Number.POSITIVE_INFINITY) >
				modelDepthFromWindow(0.41)
		) {
			color = blendHalf(color, [255, 255, 0]);
		}
		deferredPixels.set(color, result.pixel * 4);
	}
	return { deferredPixels, resolvedPixels };
}

/**
 * Execute 4 consecutive frames on one persistent target set, planner, stream, and executor without
 * full-clearing `targets.frontiers` between frames, exercising odd/even traversal-depth parities
 * (`3 -> 2 -> 4 -> 1`), shrinking scissors, and camera pan/zoom across previously dirtied regions.
 */
function runShrinkingMultiFrameFrontierFixture(
	gl: WebGL2RenderingContext,
): Pick<
	WebGL2PortalScopeAtlasExecutorFixtureResult,
	"shrinkingMultiFrameFrontierMatchesOracle"
> {
	const state = captureState(gl, METADATA_BINDING_POINT);
	const targetOwner = new WebGL2PortalScopeAtlasTargets(gl);
	const executor = new WebGL2PortalScopeAtlasExecutor(
		gl,
		48,
		METADATA_BINDING_POINT,
	);
	const output = createOffscreenOutputTarget(gl, DEPTH16_DRAWING_EXTENT);
	try {
		const targets = targetOwner.resize({
			atlas: DEPTH16_ATLAS_EXTENT,
			drawingBuffer: DEPTH16_DRAWING_EXTENT,
		});
		// Pre-dirty both ping-pong frontier attachments once before Frame 0 and never full-clear again.
		for (const frontier of targets.frontiers) {
			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, frontier.framebuffer);
			gl.viewport(
				0,
				0,
				DEPTH16_DRAWING_EXTENT.width,
				DEPTH16_DRAWING_EXTENT.height,
			);
			gl.disable(gl.SCISSOR_TEST);
			gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([4, 0, 0, 0]));
			gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([0.01]));
		}

		const planner = new PortalScopeAtlasPlanner(
			PORTAL_RENDER_CAPACITY_POLICY.culler,
			4,
		);
		const streamArena = new PortalPropagationStreamArena(48, 4);
		const roomScopes = Array.from({ length: 4 }, (_, index) => ({
			envCellId: `multi-frame-room-${index}`,
			kind: "env-cell" as const,
			landblockId: FIXTURE_LANDBLOCK_ID,
		}));
		const roomColors = [
			WEATHER_COLOR,
			MIDDLE_COLOR,
			DEEP_COLOR,
			LEAF_COLOR,
		] as const;
		const roomDepths = [0.65, 0.7, 0.75, 0.8] as const;

		// World doorway is [-3, 3] x [-3, 3]; orthographic frusta map it onto exact pixel boxes:
		// Frame 0 (depth 3, odd):  [2, 22) x [2, 14) (broad coverage)
		// Frame 1 (depth 2, even): [3, 9)  x [4, 12) (shrunk left pan, parity flip)
		// Frame 2 (depth 4, even): [15, 21) x [4, 12) (pan onto Frame-0-dirty / Frame-1-untouched region)
		// Frame 3 (depth 1, odd):  [10, 14) x [6, 10) (shrunk center zoom-out, parity flip)
		const frameSpecs = [
			{
				bottom: -4,
				depth: 3,
				left: -3.6,
				minX: 2,
				minY: 2,
				rectHeight: 12,
				rectWidth: 20,
				revision: 1,
				right: 3.6,
				top: 4,
			},
			{
				bottom: -6,
				depth: 2,
				left: -6,
				minX: 3,
				minY: 4,
				rectHeight: 8,
				rectWidth: 6,
				revision: 2,
				right: 18,
				top: 6,
			},
			{
				bottom: -6,
				depth: 4,
				left: -18,
				minX: 15,
				minY: 4,
				rectHeight: 8,
				rectWidth: 6,
				revision: 3,
				right: 6,
				top: 6,
			},
			{
				bottom: -12,
				depth: 1,
				left: -18,
				minX: 10,
				minY: 6,
				rectHeight: 4,
				rectWidth: 4,
				revision: 4,
				right: 18,
				top: 12,
			},
		] as const;

		let allFramesMatchOracle = true;
		for (const spec of frameSpecs) {
			const activeRooms = roomScopes.slice(0, spec.depth);
			const crossings = Array.from({ length: spec.depth }, (_, step) =>
				createRectCrossing(
					`mf-${spec.revision}-${step}`,
					step === 0 ? FIXTURE_ROOT_SCOPE : activeRooms[step - 1]!,
					activeRooms[step]!,
					-3,
					-3,
					3,
					3,
					-((step + 1) * 2),
				),
			);
			const topology = createFixtureTopology(
				spec.revision,
				[
					{
						potentiallyVisibleEnvCellIds: new Set(),
						scope: FIXTURE_ROOT_SCOPE,
						visibilityIslandId: null,
					},
					...activeRooms.map((scope) => ({
						potentiallyVisibleEnvCellIds: new Set<string>(),
						scope,
						visibilityIslandId:
							`env-cell-island:${scope.envCellId}` as SceneTopologyScope["visibilityIslandId"],
					})),
				],
				crossings,
			);
			const clipFromAnchor = createOrthographicMat4(
				spec.left,
				spec.right,
				spec.bottom,
				spec.top,
				0,
				20,
			);
			const cullInput = {
				anchorCoordinates: getLandblockCoordinates(FIXTURE_LANDBLOCK_ID),
				clipFromAnchor,
				nearClipVolume: createCameraNearClipVolume(
					{ fov: 90, near: 0.5 },
					{ position: new Vec3(0, 0, 5), rotation: Quat.identity() },
					DEPTH16_DRAWING_EXTENT.width / DEPTH16_DRAWING_EXTENT.height,
				),
				portalFootprint: {
					drawingBuffer: DEPTH16_DRAWING_EXTENT,
					minimumPixelArea: 0,
				},
				rootScope: FIXTURE_ROOT_SCOPE,
			};
			const frame = planner.plan(topology, cullInput, {
				atlas: DEPTH16_ATLAS_EXTENT,
				drawingBuffer: DEPTH16_DRAWING_EXTENT,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
				maximumCrossingTriangleVertexCount: 48,
			});
			if (frame.commands.traversalDepth !== spec.depth) {
				throw new Error(
					`Multi-frame fixture revision ${spec.revision} expected depth ${spec.depth}, got ${frame.commands.traversalDepth}.`,
				);
			}
			const stream = streamArena.prepare(
				frame,
				cullInput.anchorCoordinates,
				clipFromAnchor,
			);

			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.framebuffer);
			gl.viewport(
				0,
				0,
				DEPTH16_ATLAS_EXTENT.width,
				DEPTH16_ATLAS_EXTENT.height,
			);
			gl.colorMask(true, true, true, true);
			gl.depthMask(true);
			gl.disable(gl.SCISSOR_TEST);
			clearCurrentTile(gl, CLEAR_COLOR, 1);

			gl.enable(gl.SCISSOR_TEST);
			clearPlannedSubRect(
				gl,
				frame,
				0,
				0,
				0,
				DEPTH16_DRAWING_EXTENT.width,
				DEPTH16_DRAWING_EXTENT.height,
				ROOT_COLOR,
				0.5,
			);
			clearPlannedSubRect(
				gl,
				frame,
				0,
				spec.minX,
				spec.minY,
				spec.rectWidth,
				spec.rectHeight,
				ROOT_COLOR,
				0.95,
			);
			const deepestRoom = activeRooms[spec.depth - 1]!;
			const deepestTile = frame.tileOrdinalForRenderScopeKey(
				deepestRoom.envCellId,
			);
			clearPlannedSubRect(
				gl,
				frame,
				deepestTile,
				frame.tileScreenX(deepestTile),
				frame.tileScreenY(deepestTile),
				frame.tileWidth(deepestTile),
				frame.tileHeight(deepestTile),
				roomColors[spec.depth - 1]!,
				roomDepths[spec.depth - 1]!,
			);
			gl.disable(gl.SCISSOR_TEST);

			output.clear();
			executor.execute({
				clearColor: CLEAR_COLOR_NORMALIZED,
				outputExtent: DEPTH16_DRAWING_EXTENT,
				outputFramebuffer: output.framebuffer,
				stream,
				targets,
				traversalDepth: frame.commands.traversalDepth,
			});
			const actualPixels = output.readPixels();
			const expectedPixels = expectedMultiFrameOraclePixels(
				spec.depth,
				spec.minX,
				spec.minY,
				spec.rectWidth,
				spec.rectHeight,
				roomColors[spec.depth - 1]!,
				roomDepths[spec.depth - 1]!,
			);
			allFramesMatchOracle &&= pixelsMatch(actualPixels, expectedPixels);
		}
		requireNoWebGL2Error(gl, "after shrinking multi-frame frontier fixture");
		return {
			shrinkingMultiFrameFrontierMatchesOracle: allFramesMatchOracle,
		};
	} finally {
		output.destroy();
		executor.destroy();
		targetOwner.destroy();
		restoreState(gl, state, METADATA_BINDING_POINT);
	}
}

function expectedMultiFrameOraclePixels(
	depth: number,
	minX: number,
	minY: number,
	rectWidth: number,
	rectHeight: number,
	leafColor: readonly [number, number, number, number],
	leafDepth: number,
): Uint8Array {
	const width = DEPTH16_DRAWING_EXTENT.width;
	const height = DEPTH16_DRAWING_EXTENT.height;
	const pixelCount = width * height;
	const rootScope = portalModelScopeId("mf-root");
	const rootDomain = portalModelDomainId("mf-root-domain");
	const roomScopes = Array.from({ length: depth }, (_, index) =>
		portalModelScopeId(`mf-room-${index}`),
	);
	const roomDomains = Array.from({ length: depth }, (_, index) =>
		portalModelDomainId(`mf-room-domain-${index}`),
	);
	const modelDepth = (windowDepth: number) =>
		portalModelDepth(Math.round(windowDepth * 1000));
	const doorwayPixels = rectPixels(width, minX, minY, rectWidth, rectHeight);
	const doorwaySet = new Set(doorwayPixels);
	const rootFragments = Array.from({ length: pixelCount }, (_, pixel) => {
		const id = `mf-root-${pixel}`;
		return {
			batchId: portalModelBatchId(id),
			depth: modelDepth(doorwaySet.has(pixel) ? 0.95 : 0.5),
			id: portalModelFragmentId(id),
			kind: "opaque" as const,
			pixel: portalModelPixel(pixel, pixelCount),
			scopeId: rootScope,
			submissionId: portalModelSubmissionId(id),
		};
	});
	const deepestScope = roomScopes[depth - 1]!;
	const deepestFragments = doorwayPixels.map((pixel) => {
		const id = `mf-leaf-${pixel}`;
		return {
			batchId: portalModelBatchId(id),
			depth: modelDepth(leafDepth),
			id: portalModelFragmentId(id),
			kind: "opaque" as const,
			pixel: portalModelPixel(pixel, pixelCount),
			scopeId: deepestScope,
			submissionId: portalModelSubmissionId(id),
		};
	});
	const oracleFrame = composePortalReferenceFrameThroughPathDepth(
		createPortalModelScene({
			crossings: Array.from({ length: depth }, (_, step) => ({
				aperture: createPortalModelAperture(
					pixelCount,
					doorwayPixels.map((pixel) => ({
						depth: modelDepth(((step + 1) * 2) / 20),
						pixel: portalModelPixel(pixel, pixelCount),
					})),
				),
				id: portalModelCrossingId(`mf-${step}`),
				junctionGroupId: null,
				reciprocalCrossingId: null,
				relationship: "indoor-boundary",
				sourceScopeId: step === 0 ? rootScope : roomScopes[step - 1]!,
				targetScopeId: roomScopes[step]!,
			})),
			domains: [
				{ fragments: rootFragments, id: rootDomain },
				...roomDomains.map((id, index) => ({
					fragments: index === depth - 1 ? deepestFragments : [],
					id,
				})),
			],
			pixelCount,
			rootScopeId: rootScope,
			scopes: [
				{ domainId: rootDomain, id: rootScope },
				...roomScopes.map((id, index) => ({
					domainId: roomDomains[index]!,
					id,
				})),
			],
		}),
		depth,
	);
	const resolved = new Uint8Array(pixelCount * 4);
	for (const result of oracleFrame.pixels) {
		const color = result.opaque?.fragmentId.startsWith("mf-leaf-")
			? leafColor
			: ROOT_COLOR;
		resolved.set(color, result.pixel * 4);
	}
	return resolved;
}
