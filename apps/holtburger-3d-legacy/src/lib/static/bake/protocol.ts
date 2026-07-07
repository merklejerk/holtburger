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
			/** Worker-side timestamp captured immediately before returning the bake result. */
			readonly completedAtEpochMs: number;
			readonly drawUnitCount: number;
			readonly kind: "result-ready";
			readonly objectVisualResourceCount: number;
			readonly transferByteLength: number;
			readonly transferCount: number;
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
