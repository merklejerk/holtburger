import type {
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceProjectionEvent,
	StaticLandblockSceneLodSourceRequest,
	StaticResolverJob,
	StaticScopePayload,
} from "../contracts";
import type {
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse,
} from "../../workers/prepared-asset-service";
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

export type StaticResolverWorkerInput =
	| {
			readonly kind: "resolve-static-scope";
			readonly job: StaticResolverJob;
	  }
	| {
			readonly kind: "resolve-landblock-scene-lod-source";
			readonly sourceRequest: StaticLandblockSceneLodSourceRequest;
	  }
	| {
			readonly kind: "stream-landblock-scene-lod-source";
			readonly sourceRequest: StaticLandblockSceneLodSourceRequest;
	  };

export type StaticResolverWorkerOutput =
	| {
			readonly kind: "static-scope-resolved";
			readonly payload: StaticScopePayload;
	  }
	| {
			readonly kind: "landblock-scene-lod-source-resolved";
			readonly resolution: StaticLandblockSceneLodResolution;
	  }
	| {
			readonly kind: "landblock-scene-lod-source-stream-complete";
	  };

export type StaticResolverWorkerProgress =
	StaticLandblockSceneLodSourceProjectionEvent;

export type StaticResolverWorkerMainMessage = WorkerHandlerInputMessage<
	StaticResolverWorkerInput,
	PreparedAssetServiceResponse
>;

export type StaticResolverWorkerThreadMessage = WorkerHandlerOutputMessage<
	StaticResolverWorkerOutput,
	StaticResolverWorkerProgress,
	PreparedAssetServiceRequest
>;

type StaticResolverWorkerRequest = WorkerPoolRequestMessage<
	StaticResolverWorkerInput,
	PreparedAssetServiceResponse
>;

export type StaticResolverWorkerResponse = WorkerPoolResponseMessage<
	StaticResolverWorkerOutput,
	StaticResolverWorkerProgress,
	PreparedAssetServiceRequest
>;

export type StaticResolverWorkerPort = WorkerMessagePort<
	StaticResolverWorkerRequest,
	StaticResolverWorkerResponse
>;

export type StaticResolverWorkerGlobalPort = WorkerHandlerPort<
	StaticResolverWorkerInput,
	StaticResolverWorkerOutput,
	StaticResolverWorkerProgress,
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse
>;
