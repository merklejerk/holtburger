import { createWebgl2Renderer } from "../renderer/webgl2/webgl2-renderer";
import {
	createClientRuntime,
	type ClientRuntime,
} from "../runtime/client-runtime";

export function createBrowserV2Runtime(
	canvas: HTMLCanvasElement,
): ClientRuntime {
	const renderer = createWebgl2Renderer(canvas);

	return createClientRuntime({ renderer });
}
