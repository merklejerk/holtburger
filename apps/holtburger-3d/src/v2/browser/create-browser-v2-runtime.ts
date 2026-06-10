import { createBrowserRuntimeHost } from "../host/tauri-runtime-host";
import type { RuntimeHost } from "../host/contracts";
import { createWebgl2Renderer } from "../renderer/webgl2/webgl2-renderer";
import {
	createClientRuntime,
	type ClientRuntime,
} from "../runtime/client-runtime";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type {
	StaticResolverClient,
	StaticScopePayload,
	StaticWorkRequest,
} from "../static/contracts";
import {
	ImmediateStaticBakerClient,
	ImmediateStaticResolverClient,
} from "../static/fake-workers";
import { createStaticResolverMainHostBridge } from "../static/resolver/host-bridge";
import { StaticResolverWorkerClient } from "../static/resolver/worker-client";

export function createBrowserV2Runtime(
	canvas: HTMLCanvasElement,
): ClientRuntime {
	const renderer = createWebgl2Renderer(canvas);
	const host = createBrowserRuntimeHost();
	const hostSnapshot = host.createSnapshot();
	const staticCoordinator = hostSnapshot.isAvailable
		? createTauriStaticCoordinator(host)
		: undefined;

	return createClientRuntime({ host, renderer, staticCoordinator });
}

function createTauriStaticCoordinator(host: RuntimeHost): StaticCoordinator {
	const worker = new Worker(
		new URL("../static/resolver/static-resolver.worker.ts", import.meta.url),
		{ type: "module" },
	);
	const bridge = createStaticResolverMainHostBridge(worker, host);
	const terrainResolver = new StaticResolverWorkerClient(worker);
	const placeholderResolver = new ImmediateStaticResolverClient();
	const resolver = new BrowserStaticResolver({
		placeholderResolver,
		terrainResolver,
		onDispose: () => {
			terrainResolver.dispose();
			bridge.dispose();
			worker.terminate();
		},
	});

	return new StaticCoordinator({
		baker: new ImmediateStaticBakerClient(),
		resolver,
	});
}

class BrowserStaticResolver implements StaticResolverClient {
	readonly #terrainResolver: StaticResolverClient;
	readonly #placeholderResolver: StaticResolverClient;
	readonly #onDispose: () => void;
	#disposed = false;

	constructor(options: {
		readonly terrainResolver: StaticResolverClient;
		readonly placeholderResolver: StaticResolverClient;
		readonly onDispose: () => void;
	}) {
		this.#terrainResolver = options.terrainResolver;
		this.#placeholderResolver = options.placeholderResolver;
		this.#onDispose = options.onDispose;
	}

	resolve(request: StaticWorkRequest): Promise<StaticScopePayload> {
		if (this.#disposed) {
			return Promise.reject(new Error("BrowserStaticResolver has been disposed."));
		}

		if (request.domain === "terrain" && request.scope.kind === "landblock") {
			return this.#terrainResolver.resolve(request);
		}

		return this.#placeholderResolver.resolve(request);
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		this.#onDispose();
	}
}
