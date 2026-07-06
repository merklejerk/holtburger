import {
	installWorkerHandler,
	type InstalledWorkerHandler,
} from "../../../../workers/handler";
import { collectOpenWorldTexturePageBuildTransfers } from "./transfers";
import type {
	OpenWorldTexturePageBuildInput,
	OpenWorldTexturePageBuildOutput,
	OpenWorldTexturePageBuildWorkerGlobalPort,
} from "./protocol";
import type { OpenWorldTexturePageBuilder } from "./worker-client";

export function installOpenWorldTexturePageBuildWorkerHandler(
	builder: OpenWorldTexturePageBuilder,
	port: OpenWorldTexturePageBuildWorkerGlobalPort,
): InstalledWorkerHandler {
	return installWorkerHandler<
		OpenWorldTexturePageBuildInput,
		OpenWorldTexturePageBuildOutput
	>({
		execute: async (input) => {
			const output = await builder.buildPage(input);
			return {
				output,
				transfer: collectOpenWorldTexturePageBuildTransfers(output),
			};
		},
		port,
	});
}
