import type { StaticScopePayload, StaticWorkRequest } from "../contracts";

export type StaticResolverWorkerRequest = {
	readonly kind: "resolve-static-scope";
	readonly requestId: string;
	readonly request: StaticWorkRequest;
};

export type StaticResolverWorkerResponse =
	| {
			readonly kind: "static-scope-resolved";
			readonly requestId: string;
			readonly payload: StaticScopePayload;
	  }
	| {
			readonly kind: "static-scope-resolve-failed";
			readonly requestId: string;
			readonly message: string;
	  };

export interface StaticResolverWorkerPort {
	postMessage(message: StaticResolverWorkerRequest): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<StaticResolverWorkerResponse>) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (event: MessageEvent<StaticResolverWorkerResponse>) => void,
	): void;
}
