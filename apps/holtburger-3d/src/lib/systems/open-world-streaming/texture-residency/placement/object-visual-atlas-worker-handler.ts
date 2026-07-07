import type { PreparedAssetReader } from "../../../../assets/contracts";
import {
	installWorkerHandler,
	type InstalledWorkerHandler,
	type WorkerExecuteContext,
} from "../../../../workers/handler";
import type {
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse,
} from "../../../../workers/prepared-asset-service";
import type {
	OpenWorldObjectVisualAtlasBuildInput,
	OpenWorldObjectVisualAtlasBuilder,
	OpenWorldObjectVisualAtlasPlacementOutput,
} from "./object-visual-atlas-builder";
import type { OpenWorldObjectVisualAtlasWorkerGlobalPort } from "./object-visual-atlas-worker-protocol";

export function installOpenWorldObjectVisualAtlasWorkerHandler(
	createBuilder: (assetReader: PreparedAssetReader) => OpenWorldObjectVisualAtlasBuilder,
	createAssetReader: (
		context: WorkerExecuteContext<
			never,
			PreparedAssetServiceRequest,
			PreparedAssetServiceResponse
		>,
	) => PreparedAssetReader,
	port: OpenWorldObjectVisualAtlasWorkerGlobalPort,
): InstalledWorkerHandler {
	return installWorkerHandler<
		OpenWorldObjectVisualAtlasBuildInput,
		OpenWorldObjectVisualAtlasPlacementOutput,
		never,
		PreparedAssetServiceRequest,
		PreparedAssetServiceResponse
	>({
		execute: async (input, context) => ({
			output: await createBuilder(createAssetReader(context)).planAtlasPlacement(
				input,
			),
		}),
		port,
	});
}
