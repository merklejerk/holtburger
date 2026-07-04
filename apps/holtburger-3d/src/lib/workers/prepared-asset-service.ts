import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../assets/contracts";
import { describeHostAssetKey } from "../assets/keys";
import { createResolverEnvCellPreparedAssetView } from "../assets/preparation/env-cell-views";
import { createResolverGfxObjPreparedAssetView } from "../assets/preparation/gfx-obj-views";
import { createResolverRenderSurfacePreparedAssetView } from "../assets/preparation/render-surface-views";
import type { WorkerExecuteContext } from "./handler";
import type { WorkerServiceHandler } from "./pool";

export interface PreparedAssetServiceRequest {
	readonly kind: "prepared-asset";
	readonly key: HostAssetKey;
}

export interface PreparedAssetServiceResponse {
	readonly asset: PreparedAsset;
}

export function createPreparedAssetServiceHandler(
	assetReader: PreparedAssetReader,
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
				asset: createWorkerPreparedAssetView(asset),
			},
		};
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
			.then((response) => response.asset);
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

function createWorkerPreparedAssetView(asset: PreparedAsset): PreparedAsset {
	return createResolverEnvCellPreparedAssetView(
		createResolverGfxObjPreparedAssetView(
			createResolverRenderSurfacePreparedAssetView(asset),
		),
	);
}
