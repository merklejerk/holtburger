import type { StaticBakeBatchInput, StaticBakeBatchResult } from "../contracts";

export type StaticBakeWorkerMainMessage = {
	readonly kind: "bake-static-batch";
	readonly requestId: string;
	readonly input: StaticBakeBatchInput;
};

export type StaticBakeWorkerThreadMessage =
	| {
			readonly kind: "static-batch-baked";
			readonly requestId: string;
			readonly result: StaticBakeBatchResult;
	  }
	| {
			readonly kind: "static-batch-bake-failed";
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
