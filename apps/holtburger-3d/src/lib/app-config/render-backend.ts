const WORLD_RENDER_BACKEND_ENV_NAME = "VITE_HOLTBURGER_RENDER_BACKEND";

export type WorldRenderBackend = "three" | "luma";

export function parseWorldRenderBackend(value: unknown): WorldRenderBackend {
	if (value === undefined || value === null || value === "") {
		return "three";
	}
	if (value === "three" || value === "luma") {
		return value;
	}

	throw new Error(
		`Unsupported ${WORLD_RENDER_BACKEND_ENV_NAME} value ${JSON.stringify(value)}. Expected "three" or "luma".`,
	);
}

export function readWorldRenderBackend(): WorldRenderBackend {
	return parseWorldRenderBackend(
		import.meta.env.VITE_HOLTBURGER_RENDER_BACKEND,
	);
}
