import {
	PORTAL_SCOPE_ATLAS_MAXIMUM_ARRIVAL_STATE_COUNT,
	WebGL2PortalScopeAtlasTargets,
	type WebGL2PortalScopeAtlasTargetDiagnostics,
	type WebGL2PortalScopeAtlasTargetSet,
} from "./webgl2-portal-scope-atlas-targets";

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
