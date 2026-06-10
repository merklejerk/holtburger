import type { StaticBakeInput, StaticBakeResult } from "../contracts";

export type StaticBakeWorkerMainMessage = {
	readonly kind: "bake-static-scope";
	readonly requestId: string;
	readonly input: StaticBakeInput;
};

export type StaticBakeWorkerThreadMessage =
	| {
			readonly kind: "static-scope-baked";
			readonly requestId: string;
			readonly result: StaticBakeResult;
	  }
	| {
			readonly kind: "static-scope-bake-failed";
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
