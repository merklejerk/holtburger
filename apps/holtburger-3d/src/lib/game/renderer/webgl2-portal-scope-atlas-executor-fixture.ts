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
import { createPerspectiveMat4 } from "../math/matrices";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type {
	ScenePortalCrossingInput,
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import type { PlanarAperture } from "../scene/planar-aperture";
import { composePortalReferenceFrameThroughPathDepth } from "./portal-reference-compositor";
import { createPortalRenderCapacityPolicy } from "./portal-render-capacity-policy";
import { PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS } from "./portal-envelope-sampling-glsl";
import {
	PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE,
	PORTAL_ARRIVAL_METADATA_JUNCTION_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES,
} from "./portal-arrival-metadata";
import {
	PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL,
	PORTAL_CROSSING_NEAR_CLIP_RAY_FLAG,
	PORTAL_CROSSING_TRIANGLE_POLICY_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	PortalPropagationStreamArena,
	type PortalCrossingTriangleStreamView,
	type PortalPropagationMetadataStreamView,
} from "./portal-crossing-triangle-stream";
import {
	PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES,
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
} from "./portal-propagation-metadata";
import { writePortalScopeTileMetadata } from "./portal-scope-tile-metadata";
import { createCameraNearClipVolume } from "./portal-near-plane";
import {
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
} from "./webgl2-shader-utils";
import { createParticleFragmentShader } from "./webgl2-particle-program";

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
	readonly exteriorWeatherComposesBehindChildOpaque: boolean;
	readonly frontierMatchesOracle: boolean;
	/** Shared junction ids license the zero-thickness A->exterior->B advance at equal depth. */
	readonly junctionZeroThicknessTransitMatchesOracle: boolean;
	readonly junctionPixels: readonly number[];
	readonly expectedJunctionPixels: readonly number[];
	/** Without a junction id, the same equal-depth advance stays rejected (today's behavior). */
	readonly junctionAbsentEqualDepthIsRejected: boolean;
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
	readonly particleMatchesEquivalentTransparency: boolean;
	readonly particlePixels: readonly number[];
	readonly rootOnlyResolveMatchesOracle: boolean;
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
			outputExtent: DRAWING_EXTENT,
			outputFramebuffer: null,
			stream: strictStream,
			targets,
			traversalDepth: 2,
		});
		const strictPixels = readOutput(gl);
		const expectedStrictPixels = expectedWinnerPixels(MIDDLE_COLOR, null);

		const productionPackedFrame = createProductionPackedFrame();
		const productionPackedStream = new PortalPropagationStreamArena(6).prepare(
			productionPackedFrame,
			getLandblockCoordinates(FIXTURE_LANDBLOCK_ID),
			Mat4.identity(),
		);
		seedProductionPackedSceneAtlas(gl, targets, productionPackedFrame);
		clearOutput(gl);
		executor.execute({
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
		const straddleStream = new PortalPropagationStreamArena(6).prepare(
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
				deferred.expectedPixels,
			),
			deferredPixels: [...deferred.transparentPixels],
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
			particleMatchesEquivalentTransparency: pixelsMatch(
				deferred.particlePixels,
				deferred.transparentPixels,
			),
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
): ScenePortalCrossingInput {
	const aperture = rectangleAperture(
		-halfExtent,
		-halfExtent,
		halfExtent,
		halfExtent,
		z,
	);
	const sceneAperture = {
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

function createPropagationStream(): PortalCrossingTriangleStreamView &
	PortalPropagationMetadataStreamView {
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
	return {
		arrivalMetadataStateCount: 4,
		bytes: new Uint8Array(arena),
		propagationMetadataBytes: createMetadata(4),
		renderDomainMetadataStateCount: 4,
		usedByteLength: arena.byteLength,
		usedPropagationMetadataByteLength:
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		vertexCount: 18,
	};
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
function createJunctionStream(
	tagJunction: boolean,
): PortalCrossingTriangleStreamView & PortalPropagationMetadataStreamView {
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
	writeArrivalPlane(metadataFloats, 1, 0);
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
	return {
		arrivalMetadataStateCount: 3,
		bytes: new Uint8Array(arena),
		propagationMetadataBytes: metadata,
		renderDomainMetadataStateCount: 3,
		usedByteLength: arena.byteLength,
		usedPropagationMetadataByteLength:
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		vertexCount: 12,
	};
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

function createRootOnlyStream(): PortalCrossingTriangleStreamView &
	PortalPropagationMetadataStreamView {
	return {
		arrivalMetadataStateCount: 1,
		bytes: new Uint8Array(0),
		propagationMetadataBytes: createMetadata(1),
		renderDomainMetadataStateCount: 1,
		usedByteLength: 0,
		usedPropagationMetadataByteLength:
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		vertexCount: 0,
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
		writeArrivalPlane(floats, 1, 0.4);
		writeArrivalRoute(uints, 2, 2, 0, PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE);
		writeArrivalPlane(floats, 2, 0);
		writeArrivalRoute(uints, 3, 3, 0, PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE);
		writeArrivalPlane(floats, 3, -0.4);
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
			);
		}
	}
	return new Uint8Array(buffer);
}

function writeArrivalPlane(
	metadata: Float32Array,
	recordOrdinal: number,
	d: number,
): void {
	const floatOffset =
		(PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES + recordOrdinal * 32) /
		Float32Array.BYTES_PER_ELEMENT;
	metadata[floatOffset + 2] = 1;
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
		PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES + recordOrdinal * 32;
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
	// Fixture stages deliberately leave depth writes disabled. Reset both attachments so a repeated
	// executor resolve cannot retain stale color or depth. Resolve deliberately accepts equal clear
	// depth because terminal sky/background pixels remain at one.
	gl.colorMask(true, true, true, true);
	gl.depthMask(true);
	gl.clearBufferfv(
		gl.COLOR,
		0,
		new Float32Array(CLEAR_COLOR.map((component) => component / 255)),
	);
	gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([1]));
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
	readonly portal: WebGL2PortalDeferredVisibilityUniforms;
	readonly color: WebGLUniformLocation;
	readonly depth: WebGLUniformLocation;
	readonly translucency: WebGLUniformLocation;
}

/** Numeric alpha/particle composition over the executor's real envelope and resolved depth. */
function runDeferredCompositionFixture(
	gl: WebGL2RenderingContext,
	executor: WebGL2PortalScopeAtlasExecutor,
	targets: WebGL2PortalScopeAtlasTargetSet,
	stream: PortalCrossingTriangleStreamView &
		PortalPropagationMetadataStreamView,
	frame: PortalScopeAtlasFrameView,
): {
	readonly expectedPixels: Uint8Array;
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
			expectedPixels: expectedDeferredCompositionPixels(),
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
	drawParticleFixture(gl, fixture, 0, 0.55, [0, 0, 1, 1]);
	drawParticleFixture(gl, fixture, 1, 0.5, [1, 1, 0, 1]);
	drawParticleFixture(gl, fixture, 0, 0.4, [1, 0, 1, 1]);
}

function drawParticleFixture(
	gl: WebGL2RenderingContext,
	fixture: ParticleFixtureProgram,
	renderDomain: number,
	depth: number,
	color: readonly [number, number, number, number],
): void {
	gl.uniform1ui(fixture.portal.renderDomain, renderDomain);
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
		createParticleFragmentShader(true),
	);
	gl.useProgram(program);
	gl.uniform1i(requireWebGL2Uniform(gl, program, "uBase"), 0);
	gl.uniform1i(requireWebGL2Uniform(gl, program, "uPalette"), 1);
	gl.uniform1i(requireWebGL2Uniform(gl, program, "uMaterialKind"), 0);
	gl.uniform1i(requireWebGL2Uniform(gl, program, "uPalettedClipMap"), 0);
	gl.uniform1f(requireWebGL2Uniform(gl, program, "uAlphaTest"), 0);
	return {
		color: requireWebGL2Uniform(gl, program, "uMaterialColor"),
		depth: requireWebGL2Uniform(gl, program, "uDepth"),
		portal: bindWebGL2PortalDeferredVisibilityProgram(gl, program),
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
	const previousSamplers = Array.from({ length: 6 }, (_, unit) => {
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
	const dilated = new Set<number>();
	for (const pixel of base) {
		const pixelX = pixel % DRAWING_EXTENT.width;
		const pixelY = Math.floor(pixel / DRAWING_EXTENT.width);
		for (let y = pixelY - radius; y <= pixelY + radius; y += 1) {
			for (let x = pixelX - radius; x <= pixelX + radius; x += 1) {
				if (
					x >= 0 &&
					y >= 0 &&
					x < DRAWING_EXTENT.width &&
					y < DRAWING_EXTENT.height
				) {
					dilated.add(y * DRAWING_EXTENT.width + x);
				}
			}
		}
	}
	return dilated;
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
	for (let unit = 0; unit <= 5; unit += 1) {
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
