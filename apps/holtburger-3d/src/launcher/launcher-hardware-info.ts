import { APP_BUILD_LABEL } from "../app/app-build";
import type { HardwareInfoRequest } from "../app/hardware-info-contract";
import { readWebGL2DiagnosticIdentity } from "../lib/game/renderer/webgl2-diagnostic-identity";

/** Probe on button activation, without starting the game or retaining GPU resources. */
export function probeLauncherHardware(): HardwareInfoRequest {
	const canvas = document.createElement("canvas");
	const gl = canvas.getContext("webgl2", {
		powerPreference: "high-performance",
	});
	if (gl === null) return { build: APP_BUILD_LABEL, webgl: null };
	try {
		return { build: APP_BUILD_LABEL, webgl: readWebGL2DiagnosticIdentity(gl) };
	} finally {
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	}
}
