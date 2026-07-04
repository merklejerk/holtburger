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

export type StaticBakeWorkerRequest =
	WorkerHandlerInputMessage<StaticBakeJobInput>;

export type StaticBakeWorkerResponse = WorkerHandlerOutputMessage<
	StaticBakeJobResult,
	StaticBakeWorkerProgress
>;

export type StaticBakeWorkerPort = WorkerMessagePort<
	WorkerPoolRequestMessage<StaticBakeJobInput>,
	WorkerPoolResponseMessage<StaticBakeJobResult, StaticBakeWorkerProgress>
>;

export type StaticBakeWorkerGlobalPort = WorkerHandlerPort<
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBakeWorkerProgress
>;
