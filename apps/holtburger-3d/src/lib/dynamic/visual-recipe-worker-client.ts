import type { PreparedAssetReader } from "../assets/contracts";
import type { DynamicEntityRecipe } from "./contracts";
import type {
	DynamicVisualRecipeWorkerPort,
	DynamicVisualRecipeWorkerRequestPayload,
} from "./visual-recipe-protocol";
import type {
	DynamicVisualRecipeResolutionRequest,
	DynamicVisualRecipeResolver,
} from "./visual-recipe-resolver";
import {
	createPreparedAssetServiceHandler,
	type PreparedAssetServiceRequest,
	type PreparedAssetServiceResponse,
} from "../workers/prepared-asset-service";
import { StandardWorkerPool } from "../workers/pool";

export class WorkerPoolDynamicVisualRecipeResolver implements DynamicVisualRecipeResolver {
	readonly #pool: StandardWorkerPool<
		DynamicVisualRecipeWorkerRequestPayload,
		DynamicEntityRecipe,
		never,
		PreparedAssetServiceRequest,
		PreparedAssetServiceResponse
	>;

	constructor(options: {
		readonly assetReader: PreparedAssetReader;
		readonly createWorker: () => DynamicVisualRecipeWorkerPort;
		readonly workerCount: number;
	}) {
		this.#pool = new StandardWorkerPool({
			createWorker: options.createWorker,
			requestIdPrefix: "dynamic-visual-recipe",
			serviceHandler: createPreparedAssetServiceHandler(options.assetReader),
			size: options.workerCount,
		});
	}

	resolveRecipe(
		request: DynamicVisualRecipeResolutionRequest,
	): Promise<DynamicEntityRecipe> {
		return this.#pool.submit(createWorkerRequestPayload(request));
	}

	dispose(): void {
		this.#pool.dispose();
	}
}

function createWorkerRequestPayload(
	request: DynamicVisualRecipeResolutionRequest,
): DynamicVisualRecipeWorkerRequestPayload {
	return {
		animationSelection: request.animationSelection,
		baseTransform: request.baseTransform,
		entityId: request.entityId,
		materialPolicy: request.materialPolicy,
		modelData: request.modelData,
		setupModelId: request.setupModelId,
		source: request.source,
	};
}
