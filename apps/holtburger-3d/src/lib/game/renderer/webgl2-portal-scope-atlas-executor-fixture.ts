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
import { composePortalReferenceFrameThroughPathDepth } from "./portal-reference-compositor";
import {
	PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE,
	PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES,
} from "./portal-arrival-metadata";
import {
	PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL,
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	type PortalCrossingTriangleStreamView,
	type PortalPropagationMetadataStreamView,
} from "./portal-crossing-triangle-stream";
import {
	PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES,
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
} from "./portal-propagation-metadata";
import { writePortalScopeTileMetadata } from "./portal-scope-tile-metadata";
import { WebGL2PortalScopeAtlasExecutor } from "./webgl2-portal-scope-atlas-executor";
import {
	WebGL2PortalScopeAtlasTargets,
	type WebGL2PortalScopeAtlasTargetSet,
} from "./webgl2-portal-scope-atlas-targets";

const DRAWING_EXTENT = { height: 4, width: 4 } as const;
const ATLAS_EXTENT = { height: 4, width: 16 } as const;
const METADATA_BINDING_POINT = 0;
const ROOT_COLOR = [204, 51, 26, 255] as const;
const MIDDLE_COLOR = [204, 204, 26, 255] as const;
const DEEP_COLOR = [26, 204, 204, 255] as const;
const LEAF_COLOR = [51, 204, 51, 255] as const;
const CLEAR_COLOR = [26, 51, 204, 255] as const;
const CENTER_PIXELS = new Set([5, 6, 9, 10]);

/** Numeric real-GPU evidence for the shader substrate against the independent ray oracle. */
export interface WebGL2PortalScopeAtlasExecutorFixtureResult {
	readonly frontierMatchesOracle: boolean;
	readonly opaqueOcclusionMatchesOracle: boolean;
	readonly propagatedResolveMatchesOracle: boolean;
	readonly rootOnlyResolveMatchesOracle: boolean;
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
		throw new Error("Portal shader fixture requires a 4x4 drawing buffer.");
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
		requireNoWebGL2Error(gl, "after portal scope-atlas shader execution");

		return {
			expectedPropagatedPixels: [...expectedPropagatedPixels],
			frontierMatchesOracle: frontier.every(
				(value, pixel) => value === (CENTER_PIXELS.has(pixel) ? 4 : 0),
			),
			opaqueOcclusionMatchesOracle: pixelsMatch(
				occludedPixels,
				expectedOccludedPixels,
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
		};
	} finally {
		executor.destroy();
		targetOwner.destroy();
		restoreState(gl, state, METADATA_BINDING_POINT);
	}
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
		scopeMetadataStateCount: 4,
		usedByteLength: arena.byteLength,
		usedPropagationMetadataByteLength:
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		vertexCount: 18,
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
		scopeMetadataStateCount: 1,
		usedByteLength: 0,
		usedPropagationMetadataByteLength:
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		vertexCount: 0,
	};
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
	writePortalScopeTileMetadata(uints, scopeOffset, 0, 0, 0, 0, 4, 4);
	if (scopeCount === 4) {
		for (let scope = 1; scope < scopeCount; scope += 1) {
			writePortalScopeTileMetadata(
				uints,
				scopeOffset + scope * 8,
				scope * 4,
				0,
				0,
				0,
				4,
				4,
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
	clearTile(gl, 4, MIDDLE_COLOR, 0.8);
	clearTile(gl, 8, DEEP_COLOR, 0.8);
	clearTile(gl, 12, LEAF_COLOR, 0.6);
	gl.disable(gl.SCISSOR_TEST);
}

function clearTile(
	gl: WebGL2RenderingContext,
	x: number,
	color: readonly [number, number, number, number],
	depth: number,
): void {
	gl.scissor(x, 0, 4, 4);
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
	const pixels = new Uint8Array(frame.pixels.length * 4);
	for (const result of frame.pixels) {
		const fragment = result.opaque?.fragmentId;
		const color = fragment?.startsWith("leaf-") ? LEAF_COLOR : ROOT_COLOR;
		pixels.set(color, result.pixel * 4);
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
	for (let unit = 0; unit <= 5; unit += 1) {
		gl.activeTexture(gl.TEXTURE0 + unit);
		textures.push(
			gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null,
		);
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
