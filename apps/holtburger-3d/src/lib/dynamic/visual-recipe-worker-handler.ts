import type {
	DynamicVisualRecipeWorkerGlobalPort,
	DynamicVisualRecipeWorkerRequestPayload,
} from "./visual-recipe-protocol";
import { resolveDynamicVisualRecipe } from "./visual-recipe-resolver";
import {
	createRequestScopedPreparedAssetReader,
	type PreparedAssetServiceRequest,
	type PreparedAssetServiceResponse,
} from "../workers/prepared-asset-service";
import {
	installWorkerHandler,
	type InstalledWorkerHandler,
} from "../workers/handler";

export function installDynamicVisualRecipeWorkerHandler(
	port: DynamicVisualRecipeWorkerGlobalPort,
): InstalledWorkerHandler {
	return installWorkerHandler<
		DynamicVisualRecipeWorkerRequestPayload,
		Awaited<ReturnType<typeof resolveDynamicVisualRecipe>>,
		never,
		PreparedAssetServiceRequest,
		PreparedAssetServiceResponse
	>({
		execute: async (request, context) => ({
			output: await resolveDynamicVisualRecipe({
				...request,
				assetReader: createRequestScopedPreparedAssetReader(context),
			}),
		}),
		port,
	});
}
