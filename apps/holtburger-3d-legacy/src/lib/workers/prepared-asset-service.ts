import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../assets/contracts";
import { describeHostAssetKey } from "../assets/keys";
import { prepareHostAssetResponse } from "../assets/preparation";
import { createResolverEnvCellPreparedAssetView } from "../assets/preparation/env-cell-views";
import { createResolverGfxObjPreparedAssetView } from "../assets/preparation/gfx-obj-views";
import { createResolverRenderSurfacePreparedAssetView } from "../assets/preparation/render-surface-views";
import type { RuntimeHost } from "../host/runtime-contracts";
import type { WorkerExecuteContext } from "./handler";
import type { WorkerServiceHandler } from "./pool";

export interface PreparedAssetServiceRequest {
	readonly kind: "prepared-asset";
	readonly key: HostAssetKey;
}

export type PreparedAssetServiceResponse =
	| {
			readonly asset: PreparedAsset;
			readonly kind: "prepared-asset";
	  }
	| {
			readonly key: HostAssetKey;
			readonly kind: "host-asset-response";
			readonly requestId: string;
			readonly response: Awaited<
				ReturnType<RuntimeHost["lookupAssetResponse"]>
			>["response"];
			readonly revision: number;
	  };

export type PreparedAssetServicePayloadView = "full" | "resolver";

export function createPreparedAssetServiceHandler(
	assetReader: PreparedAssetReader,
	options: {
		readonly payloadView: PreparedAssetServicePayloadView;
	} = { payloadView: "resolver" },
): WorkerServiceHandler<
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse
> {
	return async (request) => {
		if (request.kind !== "prepared-asset") {
			throw new Error(`Unsupported worker service request '${request.kind}'.`);
		}
		const asset = await assetReader.requestPreparedAsset(request.key);
		return {
			response: {
				asset: createWorkerPreparedAssetView(asset, options.payloadView),
				kind: "prepared-asset",
			},
		};
	};
}

export function createHostPreparedAssetServiceHandler(
	host: RuntimeHost,
): WorkerServiceHandler<
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse
> {
	let revision = 0;
	const pending = new Map<string, Promise<PreparedAssetServiceResponse>>();
	const committed = new Map<string, PreparedAssetServiceResponse>();
	return async (request) => {
		if (request.kind !== "prepared-asset") {
			throw new Error(`Unsupported worker service request '${request.kind}'.`);
		}
		const cacheKey = describeHostAssetKey(request.key);
		const cached = committed.get(cacheKey);
		if (cached) {
			return { response: cached };
		}
		const existing = pending.get(cacheKey);
		if (existing) {
			return { response: await existing };
		}
		revision += 1;
		const currentRevision = revision;
		const next = host
			.lookupAssetResponse(request.key)
			.then(({ requestId, response }) => ({
				key: request.key,
				kind: "host-asset-response" as const,
				requestId,
				response,
				revision: currentRevision,
			}))
			.then((response) => {
				committed.set(cacheKey, response);
				pending.delete(cacheKey);
				return response;
			})
			.catch((error: unknown) => {
				pending.delete(cacheKey);
				throw error;
			});
		pending.set(cacheKey, next);
		return { response: await next };
	};
}

export function createRequestScopedPreparedAssetReader<
	TProgress,
	TServiceRequest extends PreparedAssetServiceRequest,
	TServiceResponse extends PreparedAssetServiceResponse,
>(
	context: WorkerExecuteContext<TProgress, TServiceRequest, TServiceResponse>,
): PreparedAssetReader {
	return createRequestScopedPreparedAssetReaderFromReader(
		new PreparedAssetServiceContextReader(context),
	);
}

export function createRequestScopedPreparedAssetReaderFromReader(
	reader: PreparedAssetReader,
): PreparedAssetReader {
	return new RequestScopedPreparedAssetReader(reader);
}

class PreparedAssetServiceContextReader<
	TProgress,
	TServiceRequest extends PreparedAssetServiceRequest,
	TServiceResponse extends PreparedAssetServiceResponse,
> implements PreparedAssetReader {
	readonly #context: WorkerExecuteContext<
		TProgress,
		TServiceRequest,
		TServiceResponse
	>;

	constructor(
		context: WorkerExecuteContext<TProgress, TServiceRequest, TServiceResponse>,
	) {
		this.#context = context;
	}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		return this.#context
			.requestService({
				kind: "prepared-asset",
				key,
			} as TServiceRequest)
			.then((response) => {
				if (response.kind === "prepared-asset") {
					return response.asset;
				}
				return createWorkerPreparedAssetView(
					prepareHostAssetResponse({
						key: response.key,
						requestId: response.requestId,
						response: response.response,
						revision: response.revision,
					}),
					"resolver",
				);
			});
	}
}

class RequestScopedPreparedAssetReader implements PreparedAssetReader {
	readonly #pending = new Map<string, Promise<PreparedAsset>>();
	readonly #reader: PreparedAssetReader;

	constructor(reader: PreparedAssetReader) {
		this.#reader = reader;
	}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		const cacheKey = describeHostAssetKey(key);
		const pending = this.#pending.get(cacheKey);
		if (pending) {
			return pending;
		}

		const next = this.#reader.requestPreparedAsset(key);
		this.#pending.set(cacheKey, next);
		return next;
	}
}

function createWorkerPreparedAssetView(
	asset: PreparedAsset,
	payloadView: PreparedAssetServicePayloadView,
): PreparedAsset {
	if (payloadView === "full") {
		return asset;
	}

	return createResolverEnvCellPreparedAssetView(
		createResolverGfxObjPreparedAssetView(
			createResolverRenderSurfacePreparedAssetView(asset),
		),
	);
}
