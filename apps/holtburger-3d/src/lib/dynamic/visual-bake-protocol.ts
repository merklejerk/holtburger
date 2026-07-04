import type {
	DynamicVisualBakeInput,
	DynamicVisualBakeResult,
} from "./contracts";
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

export type DynamicVisualBakeWorkerMainMessage =
	WorkerHandlerInputMessage<DynamicVisualBakeInput>;

export type DynamicVisualBakeWorkerThreadMessage = WorkerHandlerOutputMessage<
	DynamicVisualBakeResult,
	never
>;

export type DynamicVisualBakeWorkerRequest = DynamicVisualBakeWorkerMainMessage;
export type DynamicVisualBakeWorkerResponse =
	DynamicVisualBakeWorkerThreadMessage;

export type DynamicVisualBakeWorkerPort = WorkerMessagePort<
	WorkerPoolRequestMessage<DynamicVisualBakeInput>,
	WorkerPoolResponseMessage<DynamicVisualBakeResult, never>
>;

export type DynamicVisualBakeWorkerGlobalPort = WorkerHandlerPort<
	DynamicVisualBakeInput,
	DynamicVisualBakeResult,
	never
>;
