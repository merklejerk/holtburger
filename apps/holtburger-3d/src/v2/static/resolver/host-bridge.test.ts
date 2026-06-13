import { describe, expect, it } from "vitest";
import type { HostAssetKey, PreparedAsset } from "../../assets/contracts";
import { createHostAssetKey } from "../../assets/keys";
import type { RuntimeHost, RuntimeHostSnapshot } from "../../host/contracts";
import {
	createStaticResolverMainHostBridge,
	StaticResolverWorkerRuntimeHost,
} from "./host-bridge";
import type {
	StaticResolverWorkerGlobalPort,
	StaticResolverWorkerMainMessage,
	StaticResolverWorkerPort,
	StaticResolverWorkerThreadMessage,
} from "./protocol";

describe("V2 static resolver host bridge", () => {
	it("round-trips typed host asset lookup requests through the worker boundary", async () => {
		const channel = new FixtureWorkerChannel();
		const key = createHostAssetKey("landblock-outdoor", 0xda55ffff);
		const asset = createPreparedAsset(key);
		const bridge = createStaticResolverMainHostBridge(
			channel.mainPort,
			new FixtureRuntimeHost(asset),
		);
		const workerHost = new StaticResolverWorkerRuntimeHost(channel.workerPort);

		await expect(workerHost.lookupAsset(key, 7)).resolves.toEqual(asset);
		expect(channel.threadMessages).toEqual([
			{
				key,
				kind: "host-asset-lookup-requested",
				requestId: "resolver-host-1",
				revision: 7,
			},
		]);

		workerHost.dispose();
		bridge.dispose();
	});

	it("surfaces host lookup failures inside the worker", async () => {
		const channel = new FixtureWorkerChannel();
		const key = createHostAssetKey("landblock-outdoor", 0xda55ffff);
		const bridge = createStaticResolverMainHostBridge(
			channel.mainPort,
			new FixtureRuntimeHost(new Error("host said no")),
		);
		const workerHost = new StaticResolverWorkerRuntimeHost(channel.workerPort);

		await expect(workerHost.lookupAsset(key, 1)).rejects.toThrow(
			"host said no",
		);
		expect(workerHost.createSnapshot().failure).toBe("host said no");

		workerHost.dispose();
		bridge.dispose();
	});
});

class FixtureWorkerChannel {
	readonly threadMessages: StaticResolverWorkerThreadMessage[] = [];
	readonly #mainListeners = new Set<
		(event: MessageEvent<StaticResolverWorkerThreadMessage>) => void
	>();
	readonly #workerListeners = new Set<
		(event: MessageEvent<StaticResolverWorkerMainMessage>) => void
	>();

	readonly mainPort: StaticResolverWorkerPort = {
		addEventListener: (_type, listener) => {
			this.#mainListeners.add(listener);
		},
		postMessage: (message) => {
			this.#emitWorkerMessage(message);
		},
		removeEventListener: (_type, listener) => {
			this.#mainListeners.delete(listener);
		},
	};

	readonly workerPort: StaticResolverWorkerGlobalPort = {
		addEventListener: (_type, listener) => {
			this.#workerListeners.add(listener);
		},
		postMessage: (message) => {
			this.threadMessages.push(message);
			this.#emitThreadMessage(message);
		},
		removeEventListener: (_type, listener) => {
			this.#workerListeners.delete(listener);
		},
	};

	#emitThreadMessage(message: StaticResolverWorkerThreadMessage): void {
		const event = {
			data: message,
		} as MessageEvent<StaticResolverWorkerThreadMessage>;
		for (const listener of this.#mainListeners) {
			listener(event);
		}
	}

	#emitWorkerMessage(message: StaticResolverWorkerMainMessage): void {
		const event = {
			data: message,
		} as MessageEvent<StaticResolverWorkerMainMessage>;
		for (const listener of this.#workerListeners) {
			listener(event);
		}
	}
}

class FixtureRuntimeHost implements RuntimeHost {
	constructor(private readonly result: PreparedAsset | Error) {}

	lookupAsset(): Promise<PreparedAsset> {
		if (this.result instanceof Error) {
			return Promise.reject(this.result);
		}

		return Promise.resolve(this.result);
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: this.result instanceof Error ? this.result.message : null,
			isAvailable: !(this.result instanceof Error),
		};
	}
}

function createPreparedAsset(key: HostAssetKey): PreparedAsset {
	return {
		key,
		payload: {
			kind: "landblock-outdoor",
		},
		preparedAt: "2026-06-10T00:00:00.000Z",
		revision: 7,
		sourceAssetId: "landblock/da55ffff/outdoor",
	};
}
