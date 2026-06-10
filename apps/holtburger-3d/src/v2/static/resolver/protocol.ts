import type { HostAssetKey, PreparedAsset } from "../../assets/contracts";
import type { StaticScopePayload, StaticWorkRequest } from "../contracts";

export type StaticResolverWorkerMainMessage =
	| {
			readonly kind: "resolve-static-scope";
			readonly requestId: string;
			readonly request: StaticWorkRequest;
	  }
	| {
			readonly kind: "host-asset-lookup-resolved";
			readonly requestId: string;
			readonly asset: PreparedAsset;
	  }
	| {
			readonly kind: "host-asset-lookup-failed";
			readonly requestId: string;
			readonly message: string;
	  };

export type StaticResolverWorkerThreadMessage =
	| {
			readonly kind: "static-scope-resolved";
			readonly requestId: string;
			readonly payload: StaticScopePayload;
	  }
	| {
			readonly kind: "static-scope-resolve-failed";
			readonly requestId: string;
			readonly message: string;
	  }
	| {
			readonly kind: "host-asset-lookup-requested";
			readonly requestId: string;
			readonly key: HostAssetKey;
			readonly revision: number;
	  };

export type StaticResolverWorkerRequest = Extract<
	StaticResolverWorkerMainMessage,
	{ readonly kind: "resolve-static-scope" }
>;

export type StaticResolverWorkerResponse = Extract<
	StaticResolverWorkerThreadMessage,
	{ readonly kind: "static-scope-resolved" | "static-scope-resolve-failed" }
>;

export type StaticResolverHostLookupRequest = Extract<
	StaticResolverWorkerThreadMessage,
	{ readonly kind: "host-asset-lookup-requested" }
>;

export type StaticResolverHostLookupResponse = Extract<
	StaticResolverWorkerMainMessage,
	{
		readonly kind:
			| "host-asset-lookup-resolved"
			| "host-asset-lookup-failed";
	}
>;

export interface StaticResolverWorkerPort {
	postMessage(message: StaticResolverWorkerMainMessage): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<StaticResolverWorkerThreadMessage>) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (event: MessageEvent<StaticResolverWorkerThreadMessage>) => void,
	): void;
}

export interface StaticResolverWorkerGlobalPort {
	postMessage(message: StaticResolverWorkerThreadMessage): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<StaticResolverWorkerMainMessage>) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (event: MessageEvent<StaticResolverWorkerMainMessage>) => void,
	): void;
}
