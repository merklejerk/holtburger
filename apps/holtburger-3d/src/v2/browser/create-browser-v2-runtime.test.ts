import { describe, expect, it } from "vitest";
import type { PreparedAssetReader } from "../assets/contracts";
import type { StaticResolverWorkerPort } from "../static/resolver/protocol";
import {
	createWorkerStaticResolver,
	shouldUseBrowserSourceResolver,
	shouldUseBrowserWorkerBaker,
} from "./create-browser-v2-runtime";

describe("browser V2 runtime routing", () => {
	it("routes outdoor-detail through source resolver and worker baker", () => {
		expect(
			shouldUseBrowserSourceResolver({
				domain: "outdoor-detail",
				scope: {
					kind: "landblock",
					landblockId: 0xda55ffff,
				},
			}),
		).toBe(true);
		expect(shouldUseBrowserWorkerBaker("outdoor-detail")).toBe(true);
	});

	it("routes env-cell bundles through source resolver and worker baking", () => {
		expect(
			shouldUseBrowserSourceResolver({
				domain: "landblock-env-cells",
				scope: {
					kind: "landblock",
					landblockId: 0xda55ffff,
				},
			}),
		).toBe(true);
		expect(shouldUseBrowserWorkerBaker("landblock-env-cells")).toBe(true);
	});

	it("backs static resolver worker bridges with the supplied asset reader", () => {
		const assetReader: PreparedAssetReader = {
			requestPreparedAsset: () =>
				Promise.reject(new Error("test asset reader should not be called")),
		};
		const createdWorkers = [
			new FixtureStaticResolverWorker(),
			new FixtureStaticResolverWorker(),
		];
		const pendingWorkers = [...createdWorkers];
		const bridgedReaders: PreparedAssetReader[] = [];
		let disposedBridges = 0;
		const resolver = createWorkerStaticResolver(
			assetReader,
			createdWorkers.length,
			{
				createBridge: (_port, bridgedAssetReader) => {
					bridgedReaders.push(bridgedAssetReader);
					return {
						dispose: () => {
							disposedBridges += 1;
						},
					};
				},
				createWorker: () => {
					const worker = pendingWorkers.shift();
					if (!worker) {
						throw new Error("No fixture resolver worker left.");
					}
					return worker;
				},
			},
		);

		expect(bridgedReaders).toEqual([assetReader, assetReader]);
		disposeResolver(resolver);
		expect(disposedBridges).toBe(2);
		expect(createdWorkers.map((worker) => worker.terminated)).toEqual([
			true,
			true,
		]);
	});
});

class FixtureStaticResolverWorker implements StaticResolverWorkerPort {
	terminated = false;

	postMessage(): void {
		throw new Error(
			"Fixture static resolver worker does not process messages.",
		);
	}

	addEventListener(): void {
		// The worker client registers listeners during construction.
	}

	removeEventListener(): void {
		// The worker client unregisters listeners during disposal.
	}

	terminate(): void {
		this.terminated = true;
	}
}

function disposeResolver(resolver: unknown): void {
	if (
		typeof resolver !== "object" ||
		resolver === null ||
		!("dispose" in resolver) ||
		typeof resolver.dispose !== "function"
	) {
		throw new Error("Expected resolver to expose dispose().");
	}

	resolver.dispose();
}
