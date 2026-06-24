import type { HostAssetKey, PreparedAsset } from "../../assets/contracts";
import type { StaticResolverJob, StaticScopePayload } from "../contracts";

export type StaticResolverWorkerMainMessage =
	| {
			readonly kind: "resolve-static-scope";
			readonly requestId: string;
			readonly job: StaticResolverJob;
	  }
	| {
			readonly kind: "prepared-asset-request-resolved";
			readonly requestId: string;
			readonly asset: PreparedAsset;
	  }
	| {
			readonly kind: "prepared-asset-request-failed";
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
			readonly kind: "prepared-asset-requested";
			readonly requestId: string;
			readonly key: HostAssetKey;
	  };

export type StaticResolverWorkerRequest = Extract<
	StaticResolverWorkerMainMessage,
	{ readonly kind: "resolve-static-scope" }
>;

export type StaticResolverWorkerResponse = Extract<
	StaticResolverWorkerThreadMessage,
	{ readonly kind: "static-scope-resolved" | "static-scope-resolve-failed" }
>;

export type StaticResolverPreparedAssetResponse = Extract<
	StaticResolverWorkerMainMessage,
	{
		readonly kind:
			| "prepared-asset-request-resolved"
			| "prepared-asset-request-failed";
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
