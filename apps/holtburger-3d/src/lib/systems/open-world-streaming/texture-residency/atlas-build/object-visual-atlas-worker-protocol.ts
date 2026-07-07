import type {
	WorkerHandlerInputMessage,
	WorkerHandlerOutputMessage,
	WorkerHandlerPort,
} from "../../../../workers/handler";
import type {
	WorkerMessagePort,
	WorkerPoolRequestMessage,
	WorkerPoolResponseMessage,
} from "../../../../workers/pool";
import type {
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse,
} from "../../../../workers/prepared-asset-service";
import type {
	OpenWorldObjectVisualAtlasBuildInput,
	OpenWorldObjectVisualAtlasPlacementOutput,
} from "./object-visual-atlas-builder";

export type OpenWorldObjectVisualAtlasWorkerRequest = WorkerHandlerInputMessage<
	OpenWorldObjectVisualAtlasBuildInput,
	PreparedAssetServiceResponse
>;

export type OpenWorldObjectVisualAtlasWorkerResponse =
	WorkerHandlerOutputMessage<
		OpenWorldObjectVisualAtlasPlacementOutput,
		never,
		PreparedAssetServiceRequest
	>;

export type OpenWorldObjectVisualAtlasWorkerPort = WorkerMessagePort<
	WorkerPoolRequestMessage<
		OpenWorldObjectVisualAtlasBuildInput,
		PreparedAssetServiceResponse
	>,
	WorkerPoolResponseMessage<
		OpenWorldObjectVisualAtlasPlacementOutput,
		never,
		PreparedAssetServiceRequest
	>
>;

export type OpenWorldObjectVisualAtlasWorkerGlobalPort = WorkerHandlerPort<
	OpenWorldObjectVisualAtlasBuildInput,
	OpenWorldObjectVisualAtlasPlacementOutput,
	never,
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse
>;
