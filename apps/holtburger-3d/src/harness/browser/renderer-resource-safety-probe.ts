import { WebGL2Device } from "../../lib/game/renderer/webgl2-device";
import { EXPLORER_TUNING } from "../../explorer/explorer-tuning";
import { WebGL2ResourceManager } from "../../lib/game/renderer/webgl2-resource-manager";
import {
	WebGL2FailureDiagnostics,
	type WebGL2FailureReport,
} from "../../lib/game/renderer/webgl2-failure-diagnostics";
import { linkWebGL2Program } from "../../lib/game/webgl/shader-program";
import { TexturePixelFormat } from "../../lib/game/textures/types";
import type { PortalGeometryData } from "../../lib/game/renderer/geometry";
import {
	readRendererFailure,
	retainRendererFailure,
} from "../../app/app-failure-report";

/** Exercise real uploads/draws while injecting an allocation error, without exhausting GPU memory. */
export async function probeRendererResourceSafety() {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 4;
	const raw = canvas.getContext("webgl2", { antialias: false });
	if (raw === null) throw new Error("Resource safety probe requires WebGL2.");
	let failNextBuffer = false;
	let pendingError: GLenum = raw.NO_ERROR;
	let constrained = false;
	let deletedBuffers = 0;
	// Fault injection is confined to this harness context. All other calls reach the real driver.
	const gl = new Proxy(raw, {
		get(target, property) {
			if (property === "getParameter")
				return (parameter: GLenum) =>
					constrained && parameter === raw.MAX_TEXTURE_SIZE
						? 1
						: raw.getParameter(parameter);
			if (property === "getError")
				return () => {
					const error = pendingError;
					pendingError = raw.NO_ERROR;
					return error === raw.NO_ERROR ? raw.getError() : error;
				};
			if (property === "bufferData")
				return (target: GLenum, data: BufferSource, usage: GLenum) => {
					if (failNextBuffer) {
						failNextBuffer = false;
						pendingError = raw.OUT_OF_MEMORY;
					} else raw.bufferData(target, data, usage);
				};
			if (property === "deleteBuffer")
				return (buffer: WebGLBuffer) => {
					deletedBuffers += 1;
					raw.deleteBuffer(buffer);
				};
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const failures: WebGL2FailureReport[] = [];
	new WebGL2FailureDiagnostics(gl, (report) => {
		failures.push(report);
		retainRendererFailure(report);
	});
	const resources = new WebGL2ResourceManager(gl);
	const geometry: PortalGeometryData = {
		kind: "portal-aperture",
		positions: new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
		indices: new Uint16Array([0, 1, 2]),
	};
	const program = linkWebGL2Program(
		gl,
		"resource-safety probe",
		"#version 300 es\nlayout(location=0) in vec3 position; void main(){gl_Position=vec4(position,1.0);}",
		"#version 300 es\nprecision highp float; out vec4 color; void main(){color=vec4(1.0,0.0,0.0,1.0);}",
	);
	try {
		const key = resources.createGeometry(geometry, "probe installed geometry");
		const installed = resources.getGeometry(key);
		failNextBuffer = true;
		let rejected = false;
		try {
			resources.replaceGeometry(key, geometry);
		} catch (error) {
			rejected = error instanceof Error && error.message.includes("0x505");
		}
		if (
			!rejected ||
			resources.getGeometry(key) !== installed ||
			deletedBuffers !== 2
		)
			throw new Error(
				"Failed replacement did not retain the installed resource and clean staging.",
			);
		// Draw the installed resource after failure: proves its buffers/VAO were not retired.
		gl.useProgram(program);
		gl.bindVertexArray(installed.vertexArray);
		gl.drawElements(gl.TRIANGLES, installed.indexCount, installed.indexType, 0);
		const pixel = new Uint8Array(4);
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
		if (pixel[0] !== 255 || raw.getError() !== raw.NO_ERROR)
			throw new Error(
				"Installed geometry stopped drawing after rejected replacement.",
			);
		constrained = true;
		let oversizedRejected = false;
		try {
			resources.createTexture2D({
				width: 2,
				height: 1,
				format: TexturePixelFormat.RGBA8,
				mipLevels: 1,
				data: new Uint8Array(8),
			});
		} catch (error) {
			oversizedRejected =
				error instanceof Error && error.message.includes("device limit");
		}
		constrained = false;
		if (!oversizedRejected)
			throw new Error("Constrained texture limit was ignored.");
		const persisted = readRendererFailure();
		if (
			failures.length !== 1 ||
			persisted === null ||
			!persisted.includes("0x505") ||
			!Object.values(window.localStorage).includes(persisted)
		)
			throw new Error("First allocation failure was not retained for export.");
		resources.replaceGeometry(key, geometry);
		const contextLoss = await probeContextLoss();
		return {
			contextLoss,
			allocationErrorRejected: rejected,
			installedGeometryStillDraws: pixel[0] === 255,
			oversizedTextureRejected: oversizedRejected,
			failurePersisted: true,
			failures,
		};
	} finally {
		await resources.destroy();
		gl.deleteProgram(program);
		raw.getExtension("WEBGL_lose_context")?.loseContext();
	}
}

/** Prove the device event retains healthy identity and persists evidence after context loss. */
async function probeContextLoss() {
	const canvas = document.createElement("canvas");
	const reports: WebGL2FailureReport[] = [];
	const device = await WebGL2Device.build(
		canvas,
		EXPLORER_TUNING.portalTransition.visual,
		(report) => {
			reports.push(report);
			retainRendererFailure(report);
		},
	);
	try {
		const gl = canvas.getContext("webgl2");
		const extension = gl?.getExtension("WEBGL_lose_context");
		if (!extension)
			throw new Error("Context-loss probe requires WEBGL_lose_context.");
		await new Promise<void>((resolve, reject) => {
			const timeout = window.setTimeout(
				() => reject(new Error("Context-loss event timed out.")),
				5000,
			);
			canvas.addEventListener(
				"webglcontextlost",
				() => {
					window.clearTimeout(timeout);
					resolve();
				},
				{ once: true },
			);
			extension.loseContext();
		});
		const persisted = readRendererFailure();
		if (
			device.getStatus().kind !== "restart-required" ||
			reports.length !== 1 ||
			persisted === null ||
			!persisted.includes("WebGL2 context lost") ||
			!Object.values(window.localStorage).includes(persisted)
		)
			throw new Error(
				"Context loss did not retain restart state and a persisted report.",
			);
		return { restartRequired: true, failurePersisted: true, reports };
	} finally {
		await device.destroy();
	}
}
