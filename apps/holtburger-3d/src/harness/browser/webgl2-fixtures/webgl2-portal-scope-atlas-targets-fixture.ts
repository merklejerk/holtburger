import type { PortalWarpDriveTuning } from "../../../lib/game/renderer/portal/portal-warp-drive-tuning";
import type { RenderWorld } from "../../../lib/game/renderer/render-world";
import {
	WebGL2Device,
	type WebGL2DeviceStatus,
} from "../../../lib/game/renderer/webgl2/webgl2-device";
import {
	WebGL2PortalScopeAtlasTargets,
	type WebGL2PortalScopeAtlasTargetDiagnostics,
	type WebGL2PortalScopeAtlasTargetSet,
} from "../../../lib/game/renderer/portal/webgl2-portal-scope-atlas-targets";
import type { WebGL2Renderer } from "../../../lib/game/renderer/webgl2/webgl2-renderer";
import { PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT } from "../../../lib/game/renderer/portal/portal-arrival-metadata";

const INITIAL_EXTENTS = {
	atlas: { height: 8, width: 8 },
	drawingBuffer: { height: 4, width: 4 },
} as const;
const RESIZED_EXTENTS = {
	atlas: { height: 8, width: 16 },
	drawingBuffer: { height: 4, width: 8 },
} as const;

/** Browser evidence that context loss invalidates every operation without claiming restoration. */
export interface WebGL2ContextLossPolicyProbe {
	/** The intentional loss reached the same first-failure reporter used by applications. */
	readonly failureCaptured: boolean;
	readonly lossEventCanceled: boolean;
	readonly operationRejected: boolean;
	readonly rejectionMessage: string;
	readonly rendererDrawRejected: boolean;
	readonly rendererRejectionMessage: string;
	readonly status: WebGL2DeviceStatus;
}

/** Exercise context loss on an isolated device so the active renderer remains usable. */
export async function probeWebGL2ContextLossPolicy(
	portalWarpDriveTuning: PortalWarpDriveTuning,
): Promise<WebGL2ContextLossPolicyProbe> {
	const canvas = document.createElement("canvas");
	let failureCaptured = false;
	const device = await WebGL2Device.build(canvas, portalWarpDriveTuning, () => {
		failureCaptured = true;
	});
	const renderer = await device.buildRenderer({} as RenderWorld);
	try {
		const extension = device.runDiagnostic((gl) =>
			gl.getExtension("WEBGL_lose_context"),
		);
		if (!extension) {
			throw new Error(
				"WEBGL_lose_context is unavailable for the lifecycle probe.",
			);
		}
		const lossEventPromise = new Promise<Event>((resolve, reject) => {
			const timeout = window.setTimeout(() => {
				reject(new Error("Timed out waiting for WebGL context loss."));
			}, 5_000);
			canvas.addEventListener(
				"webglcontextlost",
				(lossEvent) => {
					window.clearTimeout(timeout);
					resolve(lossEvent);
				},
				{ once: true },
			);
		});
		extension.loseContext();
		const lossEvent = await lossEventPromise;

		let rejectionMessage = "";
		let rendererRejectionMessage = "";
		try {
			device.runDiagnostic((gl) => runWebGL2PortalScopeAtlasTargetsFixture(gl));
		} catch (cause) {
			rejectionMessage = cause instanceof Error ? cause.message : String(cause);
		}
		try {
			renderer.drawFrame({} as Parameters<WebGL2Renderer["drawFrame"]>[0]);
		} catch (cause) {
			rendererRejectionMessage =
				cause instanceof Error ? cause.message : String(cause);
		}
		return {
			failureCaptured,
			lossEventCanceled: lossEvent.defaultPrevented,
			operationRejected: rejectionMessage.includes("restart is required"),
			rejectionMessage,
			rendererDrawRejected: rendererRejectionMessage.includes(
				"restart is required",
			),
			rendererRejectionMessage,
			status: device.getStatus(),
		};
	} finally {
		await renderer.destroy();
		await device.destroy();
	}
}

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
 * Run direct WebGL2 validation against the production target-set lifecycle.
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
		PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT,
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
		return actual[0] === PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT;
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
			targets.dilation.framebuffer,
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
		gl.isFramebuffer(targets.dilation.framebuffer) &&
		gl.isTexture(targets.frontierDepth) &&
		gl.isTexture(targets.scene.color) &&
		gl.isTexture(targets.scene.depth) &&
		gl.isTexture(targets.frontiers[0].state) &&
		gl.isTexture(targets.frontiers[1].state) &&
		gl.isTexture(targets.envelope.depth) &&
		gl.isTexture(targets.dilation.scratch)
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
