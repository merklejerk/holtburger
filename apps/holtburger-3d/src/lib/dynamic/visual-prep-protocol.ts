import type {
	DynamicVisualBakeResult,
	DynamicVisualPrepInput,
} from "./contracts";
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

export type DynamicVisualPrepWorkerMainMessage = WorkerHandlerInputMessage<
	DynamicVisualPrepInput,
	PreparedAssetServiceResponse
>;

export type DynamicVisualPrepWorkerThreadMessage = WorkerHandlerOutputMessage<
	DynamicVisualBakeResult,
	never,
	PreparedAssetServiceRequest
>;

export type DynamicVisualPrepWorkerRequest = DynamicVisualPrepWorkerMainMessage;
export type DynamicVisualPrepWorkerResponse =
	DynamicVisualPrepWorkerThreadMessage;

export type DynamicVisualPrepWorkerPort = WorkerMessagePort<
	WorkerPoolRequestMessage<DynamicVisualPrepInput, PreparedAssetServiceResponse>,
	WorkerPoolResponseMessage<
		DynamicVisualBakeResult,
		never,
		PreparedAssetServiceRequest
	>
>;

export type DynamicVisualPrepWorkerGlobalPort = WorkerHandlerPort<
	DynamicVisualPrepInput,
	DynamicVisualBakeResult,
	never,
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse
>;
