import type { DynamicVisualBaker } from "./visual-baker";
import type { DynamicVisualBakeWorkerGlobalPort } from "./visual-bake-protocol";
import {
	installWorkerHandler,
	type InstalledWorkerHandler,
} from "../workers/handler";
import { collectDynamicVisualBakeResultTransfers } from "./visual-bake-transfers";

export function installDynamicVisualBakeWorkerHandler(
	baker: DynamicVisualBaker,
	port: DynamicVisualBakeWorkerGlobalPort,
): InstalledWorkerHandler {
	return installWorkerHandler({
		execute: async (input) => {
			const result = await baker.bake(input);
			return {
				output: result,
				transfer: collectDynamicVisualBakeResultTransfers(result),
			};
		},
		port,
	});
}
