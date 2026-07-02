import type {
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBakerTraceEvent,
} from "../contracts";

export type StaticBakeWorkerMainMessage = {
	readonly kind: "bake-static-job";
	readonly requestId: string;
	readonly input: StaticBakeJobInput;
};

export type StaticBakeWorkerThreadMessage =
	| {
			readonly kind: "static-job-bake-started";
			readonly requestId: string;
	  }
	| {
			readonly kind: "static-job-bake-trace";
			readonly requestId: string;
			readonly event: StaticBakerTraceEvent;
	  }
	| {
			readonly kind: "static-job-baked";
			readonly requestId: string;
			readonly result: StaticBakeJobResult;
	  }
	| {
			readonly kind: "static-job-bake-failed";
			readonly requestId: string;
			readonly message: string;
	  };

export type StaticBakeWorkerRequest = StaticBakeWorkerMainMessage;
export type StaticBakeWorkerResponse = StaticBakeWorkerThreadMessage;

export interface StaticBakeWorkerPort {
	postMessage(message: StaticBakeWorkerMainMessage): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<StaticBakeWorkerThreadMessage>) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (event: MessageEvent<StaticBakeWorkerThreadMessage>) => void,
	): void;
}

export interface StaticBakeWorkerGlobalPort {
	postMessage(message: StaticBakeWorkerThreadMessage): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<StaticBakeWorkerMainMessage>) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (event: MessageEvent<StaticBakeWorkerMainMessage>) => void,
	): void;
}
