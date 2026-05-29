const WORLD_RENDER_BACKEND_ENV_NAME = "VITE_HOLTBURGER_RENDER_BACKEND";

export type WorldRenderBackend = "three" | "luma" | "webgl2";

export function parseWorldRenderBackend(value: unknown): WorldRenderBackend {
	if (value === undefined || value === null || value === "") {
		return "three";
	}
	if (value === "three" || value === "luma" || value === "webgl2") {
		return value;
	}

	throw new Error(
		`Unsupported ${WORLD_RENDER_BACKEND_ENV_NAME} value ${JSON.stringify(value)}. Expected "three", "luma", or "webgl2".`,
	);
}
