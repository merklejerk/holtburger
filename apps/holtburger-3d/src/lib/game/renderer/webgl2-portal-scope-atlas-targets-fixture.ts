import {
	PORTAL_SCOPE_ATLAS_MAXIMUM_ARRIVAL_STATE_COUNT,
	WebGL2PortalScopeAtlasTargets,
	type WebGL2PortalScopeAtlasTargetDiagnostics,
	type WebGL2PortalScopeAtlasTargetSet,
} from "./webgl2-portal-scope-atlas-targets";
import {
	PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL,
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	type PortalCrossingTriangleStreamView,
} from "./portal-crossing-triangle-stream";
import { compileWebGL2Shader } from "./webgl2-shader-utils";
import { WebGL2PortalCrossingTriangleBuffer } from "./webgl2-portal-crossing-triangle-buffer";

const INITIAL_EXTENTS = {
	atlas: { height: 8, width: 8 },
	drawingBuffer: { height: 4, width: 4 },
} as const;
const RESIZED_EXTENTS = {
	atlas: { height: 8, width: 16 },
	drawingBuffer: { height: 4, width: 8 },
} as const;

/** Focused browser evidence for fixed atlas formats and transactional target ownership. */
export interface WebGL2PortalScopeAtlasTargetsFixtureResult {
	/** Interleaved float/integer crossing attributes survive the production upload/draw owner. */
	readonly crossingStreamIntegerAttributePassed: boolean;
	readonly disposedDiagnostics: WebGL2PortalScopeAtlasTargetDiagnostics;
	readonly frontierR8uiRoundTripPassed: boolean;
	readonly initialDiagnostics: WebGL2PortalScopeAtlasTargetDiagnostics;
	readonly initialFramebuffersComplete: boolean;
	readonly initialResourcesValid: boolean;
	readonly resizedDiagnostics: WebGL2PortalScopeAtlasTargetDiagnostics;
	readonly resizedFramebuffersComplete: boolean;
	readonly resizedResourcesValid: boolean;
	readonly resizedTargetReplaced: boolean;
	readonly sameExtentTargetReused: boolean;
}

/**
 * Exercise only browser-owned allocation semantics; symbolic tests remain the compositor oracle.
 *
 * This fixture performs no screenshot comparison and no wall-clock sampling. Framebuffer
 * completeness is the browser/driver fact that the TypeScript allocation tests cannot establish.
 */
export function runWebGL2PortalScopeAtlasTargetsFixture(
	gl: WebGL2RenderingContext,
): WebGL2PortalScopeAtlasTargetsFixtureResult {
	requireNoWebGL2Error(gl, "before portal scope-atlas target fixture");
	const targets = new WebGL2PortalScopeAtlasTargets(gl);
	try {
		const initial = targets.resize(INITIAL_EXTENTS);
		const initialDiagnostics = targets.getDiagnostics();
		const initialFramebuffersComplete = framebuffersComplete(gl, initial);
		const frontierR8uiRoundTripPassed = frontierR8uiRoundTrip(
			gl,
			initial.frontiers[0],
		);
		const crossingStreamIntegerAttributePassed = crossingStreamRoundTrip(
			gl,
			initial.frontiers[0],
		);
		const initialResourcesValid = resourcesValid(gl, initial);
		const sameExtentTargetReused =
			targets.resize({
				atlas: { ...INITIAL_EXTENTS.atlas },
				drawingBuffer: { ...INITIAL_EXTENTS.drawingBuffer },
			}) === initial;
		const resized = targets.resize(RESIZED_EXTENTS);
		const resizedDiagnostics = targets.getDiagnostics();
		const resizedFramebuffersComplete = framebuffersComplete(gl, resized);
		const resizedResourcesValid = resourcesValid(gl, resized);
		requireNoWebGL2Error(gl, "after portal scope-atlas target fixture");
		targets.destroy();
		return {
			crossingStreamIntegerAttributePassed,
			disposedDiagnostics: targets.getDiagnostics(),
			frontierR8uiRoundTripPassed,
			initialDiagnostics,
			initialFramebuffersComplete,
			initialResourcesValid,
			resizedDiagnostics,
			resizedFramebuffersComplete,
			resizedResourcesValid,
			resizedTargetReplaced: resized !== initial,
			sameExtentTargetReused,
		};
	} finally {
		targets.destroy();
	}
}

/** Prove the fixed interleaved layout with the actual integer shader attribute path. */
function crossingStreamRoundTrip(
	gl: WebGL2RenderingContext,
	target: WebGL2PortalScopeAtlasTargetSet["frontiers"][number],
): boolean {
	const vertexCount = 3;
	const recordSlotCount =
		PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES /
		Uint32Array.BYTES_PER_ELEMENT;
	const arena = new ArrayBuffer(
		vertexCount * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	);
	const floats = new Float32Array(arena);
	const uints = new Uint32Array(arena);
	const positions = [-1, -1, 0, 3, -1, 0, -1, 3, 0] as const;
	for (let vertex = 0; vertex < vertexCount; vertex += 1) {
		const output = vertex * recordSlotCount;
		const input = vertex * 3;
		floats[output] = positions[input]!;
		floats[output + 1] = positions[input + 1]!;
		floats[output + 2] = positions[input + 2]!;
		uints[output + 3] = 250;
		uints[output + 4] = 4;
		uints[output + 5] = PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL;
	}
	const bytes = new Uint8Array(arena);
	const stream: PortalCrossingTriangleStreamView = {
		bytes,
		trace: {
			arenaCapacityBytes: bytes.byteLength,
			arenaGrowthCount: 0,
			crossingInputCount: 1,
			portalOwnedFrameHeapRecordCreationCount: 0,
			positionScalarReadCount: vertexCount * 3,
			triangleIndexReadCount: vertexCount,
			vertexHighWaterCount: vertexCount,
		},
		usedByteLength: bytes.byteLength,
		vertexCount,
	};
	const owner = new WebGL2PortalCrossingTriangleBuffer(gl, vertexCount);
	const program = linkCrossingStreamFixtureProgram(gl);
	const previousArrayBuffer = gl.getParameter(
		gl.ARRAY_BUFFER_BINDING,
	) as WebGLBuffer | null;
	const previousBlend = gl.isEnabled(gl.BLEND);
	const previousDepthTest = gl.isEnabled(gl.DEPTH_TEST);
	const previousDraw = gl.getParameter(
		gl.DRAW_FRAMEBUFFER_BINDING,
	) as WebGLFramebuffer | null;
	const previousProgram = gl.getParameter(
		gl.CURRENT_PROGRAM,
	) as WebGLProgram | null;
	const previousRead = gl.getParameter(
		gl.READ_FRAMEBUFFER_BINDING,
	) as WebGLFramebuffer | null;
	const previousReadBuffer = gl.getParameter(gl.READ_BUFFER) as GLenum;
	const previousScissorTest = gl.isEnabled(gl.SCISSOR_TEST);
	const previousVertexArray = gl.getParameter(
		gl.VERTEX_ARRAY_BINDING,
	) as WebGLVertexArrayObject | null;
	const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
	const clear = new Uint32Array([0, 0, 0, 0]);
	const actual = new Uint8Array(1);
	try {
		gl.disable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.SCISSOR_TEST);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
		gl.viewport(
			0,
			0,
			INITIAL_EXTENTS.drawingBuffer.width,
			INITIAL_EXTENTS.drawingBuffer.height,
		);
		gl.clearBufferuiv(gl.COLOR, 0, clear);
		gl.useProgram(program);
		owner.upload(stream);
		owner.draw();
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
		gl.readBuffer(gl.COLOR_ATTACHMENT0);
		gl.readPixels(0, 0, 1, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, actual);
		return actual[0] === PORTAL_SCOPE_ATLAS_MAXIMUM_ARRIVAL_STATE_COUNT;
	} finally {
		owner.destroy();
		gl.deleteProgram(program);
		setCapability(gl, gl.BLEND, previousBlend);
		setCapability(gl, gl.DEPTH_TEST, previousDepthTest);
		setCapability(gl, gl.SCISSOR_TEST, previousScissorTest);
		gl.useProgram(previousProgram);
		gl.bindVertexArray(previousVertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, previousArrayBuffer);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
		gl.readBuffer(previousReadBuffer);
		gl.viewport(
			previousViewport[0]!,
			previousViewport[1]!,
			previousViewport[2]!,
			previousViewport[3]!,
		);
	}
}

function linkCrossingStreamFixtureProgram(
	gl: WebGL2RenderingContext,
): WebGLProgram {
	const vertex = compileWebGL2Shader(
		gl,
		gl.VERTEX_SHADER,
		`#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in uint aOutputArrival;
layout(location = 2) in uint aSourceScope;
layout(location = 3) in uint aDepthPolicy;
flat out highp uint vValue;
void main() {
	gl_Position = vec4(aPosition, 1.0);
	vValue = aOutputArrival + aSourceScope + aDepthPolicy;
}`,
	);
	let fragment: WebGLShader | null = null;
	let program: WebGLProgram | null = null;
	try {
		fragment = compileWebGL2Shader(
			gl,
			gl.FRAGMENT_SHADER,
			`#version 300 es
precision highp float;
flat in highp uint vValue;
layout(location = 0) out highp uint outState;
void main() {
	outState = vValue;
}`,
		);
		program = gl.createProgram();
		if (!program) {
			throw new Error("Failed to allocate portal crossing fixture program.");
		}
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Failed to link portal crossing fixture program: ${gl.getProgramInfoLog(program) ?? "unknown error"}.`,
			);
		}
		return program;
	} catch (cause) {
		if (program) gl.deleteProgram(program);
		throw cause;
	} finally {
		if (fragment) gl.deleteShader(fragment);
		gl.deleteShader(vertex);
	}
}

function setCapability(
	gl: WebGL2RenderingContext,
	capability: GLenum,
	enabled: boolean,
): void {
	if (enabled) gl.enable(capability);
	else gl.disable(capability);
}

/** Prove the selected integer attachment preserves every usable arrival-state bit. */
function frontierR8uiRoundTrip(
	gl: WebGL2RenderingContext,
	target: WebGL2PortalScopeAtlasTargetSet["frontiers"][number],
): boolean {
	const previousDraw = gl.getParameter(
		gl.DRAW_FRAMEBUFFER_BINDING,
	) as WebGLFramebuffer | null;
	const previousRead = gl.getParameter(
		gl.READ_FRAMEBUFFER_BINDING,
	) as WebGLFramebuffer | null;
	const expected = new Uint32Array([
		PORTAL_SCOPE_ATLAS_MAXIMUM_ARRIVAL_STATE_COUNT,
		0,
		0,
		0,
	]);
	const actual = new Uint8Array(1);
	try {
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
		gl.clearBufferuiv(gl.COLOR, 0, expected);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
		gl.readBuffer(gl.COLOR_ATTACHMENT0);
		gl.readPixels(0, 0, 1, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, actual);
		return actual[0] === PORTAL_SCOPE_ATLAS_MAXIMUM_ARRIVAL_STATE_COUNT;
	} finally {
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
	}
}

function framebuffersComplete(
	gl: WebGL2RenderingContext,
	targets: WebGL2PortalScopeAtlasTargetSet,
): boolean {
	const previousDraw = gl.getParameter(
		gl.DRAW_FRAMEBUFFER_BINDING,
	) as WebGLFramebuffer | null;
	const previousRead = gl.getParameter(
		gl.READ_FRAMEBUFFER_BINDING,
	) as WebGLFramebuffer | null;
	try {
		for (const framebuffer of [
			targets.scene.framebuffer,
			targets.frontiers[0].framebuffer,
			targets.frontiers[1].framebuffer,
			targets.envelope.framebuffer,
		]) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			if (
				gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
			) {
				return false;
			}
		}
		return true;
	} finally {
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
	}
}

function resourcesValid(
	gl: WebGL2RenderingContext,
	targets: WebGL2PortalScopeAtlasTargetSet,
): boolean {
	return (
		gl.isFramebuffer(targets.scene.framebuffer) &&
		gl.isFramebuffer(targets.frontiers[0].framebuffer) &&
		gl.isFramebuffer(targets.frontiers[1].framebuffer) &&
		gl.isFramebuffer(targets.envelope.framebuffer) &&
		gl.isRenderbuffer(targets.frontierDepth) &&
		gl.isTexture(targets.scene.color) &&
		gl.isTexture(targets.scene.depth) &&
		gl.isTexture(targets.frontiers[0].state) &&
		gl.isTexture(targets.frontiers[1].state) &&
		gl.isTexture(targets.envelope.depth)
	);
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
