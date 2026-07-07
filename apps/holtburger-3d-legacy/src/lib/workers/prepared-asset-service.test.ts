import { describe, expect, it } from "vitest";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../assets/contracts";
import {
	createPreparedAssetServiceHandler,
	createRequestScopedPreparedAssetReader,
	type PreparedAssetServiceRequest,
	type PreparedAssetServiceResponse,
} from "./prepared-asset-service";
import type { WorkerExecuteContext } from "./handler";

describe("prepared asset worker service", () => {
	it("reads prepared assets through the service handler", async () => {
		const key: HostAssetKey = { id: "06000010", kind: "prepared-texture" };
		const asset = createPreparedAsset(key);
		const reader = new FixturePreparedAssetReader([asset]);
		const serviceHandler = createPreparedAssetServiceHandler(reader);

		await expect(
			serviceHandler({
				key,
				kind: "prepared-asset",
			}),
		).resolves.toMatchObject({
			response: {
				asset: {
					key,
					revision: 1,
				},
				kind: "prepared-asset",
			},
		});
		expect(reader.requests).toEqual([key]);
	});

	it("deduplicates repeated prepared asset requests inside one worker job", async () => {
		const key: HostAssetKey = { id: "02000001", kind: "gfx-obj" };
		const asset = createPreparedAsset(key);
		const context = new FixtureWorkerExecuteContext(asset);
		const reader = createRequestScopedPreparedAssetReader(context);

		const [first, second] = await Promise.all([
			reader.requestPreparedAsset(key),
			reader.requestPreparedAsset(key),
		]);

		expect(first).toBe(asset);
		expect(second).toBe(asset);
		expect(context.requests).toEqual([{ key, kind: "prepared-asset" }]);
	});

	it("retains request-scoped entries after resolution", async () => {
		const key: HostAssetKey = { id: "02000001", kind: "gfx-obj" };
		const asset = createPreparedAsset(key);
		const context = new FixtureWorkerExecuteContext(asset);
		const reader = createRequestScopedPreparedAssetReader(context);

		await reader.requestPreparedAsset(key);
		await reader.requestPreparedAsset(key);

		expect(context.requests).toEqual([{ key, kind: "prepared-asset" }]);
	});
});

class FixturePreparedAssetReader implements PreparedAssetReader {
	readonly requests: HostAssetKey[] = [];
	readonly #assetsById: Map<string, PreparedAsset>;

	constructor(assets: readonly PreparedAsset[]) {
		this.#assetsById = new Map(assets.map((asset) => [asset.key.id, asset]));
	}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		this.requests.push(key);
		const asset = this.#assetsById.get(key.id);
		if (!asset) {
			return Promise.reject(new Error(`Missing asset ${key.id}.`));
		}
		return Promise.resolve(asset);
	}
}

class FixtureWorkerExecuteContext implements WorkerExecuteContext<
	never,
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse
> {
	readonly requestId = "fixture-job";
	readonly signal = new AbortController().signal;
	readonly requests: PreparedAssetServiceRequest[] = [];
	readonly #asset: PreparedAsset;

	constructor(asset: PreparedAsset) {
		this.#asset = asset;
	}

	report(): void {
		throw new Error("Progress is not used by this fixture.");
	}

	requestService(
		request: PreparedAssetServiceRequest,
	): Promise<PreparedAssetServiceResponse> {
		this.requests.push(request);
		return Promise.resolve({ asset: this.#asset, kind: "prepared-asset" });
	}
}

function createPreparedAsset(key: HostAssetKey): PreparedAsset {
	return {
		key,
		payload: { kind: "fixture-payload" },
		preparedAt: "2026-07-04T00:00:00.000Z",
		revision: 1,
		sourceAssetId: key.id,
	};
}
