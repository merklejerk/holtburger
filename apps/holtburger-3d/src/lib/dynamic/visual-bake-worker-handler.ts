import type { DynamicVisualBaker } from "./visual-baker";
import type { DynamicVisualBakeWorkerGlobalPort } from "./visual-bake-protocol";
import {
	installWorkerHandler,
	type InstalledWorkerHandler,
} from "../workers/handler";

export function installDynamicVisualBakeWorkerHandler(
	baker: DynamicVisualBaker,
	port: DynamicVisualBakeWorkerGlobalPort,
): InstalledWorkerHandler {
	return installWorkerHandler({
		execute: async (input) => ({
			output: await baker.bake(input),
		}),
		port,
	});
}
