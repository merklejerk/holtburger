import {
	installWorkerHandler,
	type InstalledWorkerHandler,
	type WorkerExecuteContext,
} from "../../../../workers/handler";
import type { PreparedAssetReader } from "../../../../assets/contracts";
import { collectOpenWorldTexturePageBuildTransfers } from "./transfers";
import type {
	OpenWorldTexturePageBuildInput,
	OpenWorldTexturePageBuildOutput,
	OpenWorldTexturePageBuildWorkerGlobalPort,
} from "./protocol";
import type {
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse,
} from "../../../../workers/prepared-asset-service";
import type { OpenWorldTexturePageBuilder } from "./worker-client";

export function installOpenWorldTexturePageBuildWorkerHandler(
	createBuilder: (assetReader: PreparedAssetReader) => OpenWorldTexturePageBuilder,
	createAssetReader: (
		context: WorkerExecuteContext<
			never,
			PreparedAssetServiceRequest,
			PreparedAssetServiceResponse
		>,
	) => PreparedAssetReader,
	port: OpenWorldTexturePageBuildWorkerGlobalPort,
): InstalledWorkerHandler {
	return installWorkerHandler<
		OpenWorldTexturePageBuildInput,
		OpenWorldTexturePageBuildOutput,
		never,
		PreparedAssetServiceRequest,
		PreparedAssetServiceResponse
	>({
		execute: async (input, context) => {
			const output = await createBuilder(
				createAssetReader(context),
			).buildPage(input);
			return {
				output,
				transfer: collectOpenWorldTexturePageBuildTransfers(output),
			};
		},
		port,
	});
}
