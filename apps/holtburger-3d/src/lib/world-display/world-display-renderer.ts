import { readWorldRenderBackend } from "../app-config/render-backend";
import { createLumaWorldDisplayRenderer } from "./luma-world-display-renderer";
import { createThreeWorldDisplayRenderer } from "./three-world-display-renderer";
import type {
	WorldDisplayRenderer,
	WorldDisplayRendererOptions,
} from "./world-display-renderer-contract";

export type {
	WorldDisplayRenderer,
	WorldDisplayRendererOptions,
} from "./world-display-renderer-contract";

export function createWorldDisplayRenderer(
	host: HTMLDivElement,
	options: WorldDisplayRendererOptions,
): WorldDisplayRenderer {
	const rendererBackend = readWorldRenderBackend();
	switch (rendererBackend) {
		case "three":
			return createThreeWorldDisplayRenderer(host, options);
		case "luma":
			return createLumaWorldDisplayRenderer(host, options);
	}
}
