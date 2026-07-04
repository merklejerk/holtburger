import type {
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBakerTraceEvent,
} from "../contracts";
import type {
	WorkerHandlerInputMessage,
	WorkerHandlerOutputMessage,
	WorkerHandlerPort,
} from "../../workers/handler";
import type {
	WorkerMessagePort,
	WorkerPoolRequestMessage,
	WorkerPoolResponseMessage,
} from "../../workers/pool";

export type StaticBakeWorkerProgress =
	| {
			readonly kind: "started";
	  }
	| {
			readonly kind: "trace";
			readonly event: StaticBakerTraceEvent;
	  };

export type StaticBakeWorkerMainMessage =
	WorkerHandlerInputMessage<StaticBakeJobInput>;

export type StaticBakeWorkerThreadMessage = WorkerHandlerOutputMessage<
	StaticBakeJobResult,
	StaticBakeWorkerProgress
>;

export type StaticBakeWorkerRequest = StaticBakeWorkerMainMessage;
export type StaticBakeWorkerResponse = StaticBakeWorkerThreadMessage;

export type StaticBakeWorkerPort = WorkerMessagePort<
	WorkerPoolRequestMessage<StaticBakeJobInput>,
	WorkerPoolResponseMessage<StaticBakeJobResult, StaticBakeWorkerProgress>
>;

export type StaticBakeWorkerGlobalPort = WorkerHandlerPort<
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBakeWorkerProgress
>;
