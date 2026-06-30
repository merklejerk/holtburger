import type {
	DynamicVisualBakeInput,
	DynamicVisualBakeResult,
} from "./contracts";

export type DynamicVisualBakeWorkerMainMessage = {
	readonly input: DynamicVisualBakeInput;
	readonly kind: "bake-dynamic-visual-batch";
	readonly requestId: string;
};

export type DynamicVisualBakeWorkerThreadMessage =
	| {
			readonly kind: "dynamic-visual-batch-baked";
			readonly requestId: string;
			readonly result: DynamicVisualBakeResult;
	  }
	| {
			readonly kind: "dynamic-visual-batch-bake-failed";
			readonly message: string;
			readonly requestId: string;
	  };

export type DynamicVisualBakeWorkerRequest = DynamicVisualBakeWorkerMainMessage;
export type DynamicVisualBakeWorkerResponse =
	DynamicVisualBakeWorkerThreadMessage;

export interface DynamicVisualBakeWorkerPort {
	postMessage(message: DynamicVisualBakeWorkerMainMessage): void;
	addEventListener(
		type: "message",
		listener: (
			event: MessageEvent<DynamicVisualBakeWorkerThreadMessage>,
		) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (
			event: MessageEvent<DynamicVisualBakeWorkerThreadMessage>,
		) => void,
	): void;
}

export interface DynamicVisualBakeWorkerGlobalPort {
	postMessage(message: DynamicVisualBakeWorkerThreadMessage): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<DynamicVisualBakeWorkerMainMessage>) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (event: MessageEvent<DynamicVisualBakeWorkerMainMessage>) => void,
	): void;
}
