import type { DynamicEntityRecipe } from "./contracts";
import type { DynamicVisualRecipeResolutionRequest } from "./visual-recipe-resolver";
import type {
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse,
} from "../workers/prepared-asset-service";
import type {
	WorkerHandlerInputMessage,
	WorkerHandlerOutputMessage,
	WorkerHandlerPort,
} from "../workers/handler";
import type {
	WorkerMessagePort,
	WorkerPoolRequestMessage,
	WorkerPoolResponseMessage,
} from "../workers/pool";

export type DynamicVisualRecipeWorkerRequestPayload = Omit<
	DynamicVisualRecipeResolutionRequest,
	"assetReader"
>;

export type DynamicVisualRecipeWorkerMainMessage = WorkerHandlerInputMessage<
	DynamicVisualRecipeWorkerRequestPayload,
	PreparedAssetServiceResponse
>;

export type DynamicVisualRecipeWorkerThreadMessage = WorkerHandlerOutputMessage<
	DynamicEntityRecipe,
	never,
	PreparedAssetServiceRequest
>;

export type DynamicVisualRecipeWorkerPort = WorkerMessagePort<
	WorkerPoolRequestMessage<
		DynamicVisualRecipeWorkerRequestPayload,
		PreparedAssetServiceResponse
	>,
	WorkerPoolResponseMessage<
		DynamicEntityRecipe,
		never,
		PreparedAssetServiceRequest
	>
>;

export type DynamicVisualRecipeWorkerGlobalPort = WorkerHandlerPort<
	DynamicVisualRecipeWorkerRequestPayload,
	DynamicEntityRecipe,
	never,
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse
>;
