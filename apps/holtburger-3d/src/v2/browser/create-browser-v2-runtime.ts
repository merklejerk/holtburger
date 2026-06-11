import { createBrowserRuntimeHost } from "../host/tauri-runtime-host";
import type { RuntimeHost } from "../host/contracts";
import { createWebgl2Renderer } from "../renderer/webgl2/webgl2-renderer";
import {
	createClientRuntime,
	type ClientRuntime,
} from "../runtime/client-runtime";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type {
	StaticBakeInput,
	StaticBakeResult,
	StaticBakerClient,
	StaticResolverJob,
	StaticResolverClient,
	StaticScopePayload,
} from "../static/contracts";
import {
	ImmediateStaticBakerClient,
	ImmediateStaticResolverClient,
} from "../static/fake-workers";
import { StaticBakeWorkerClient } from "../static/bake/worker-client";
import { createStaticResolverMainHostBridge } from "../static/resolver/host-bridge";
import { StaticResolverWorkerClient } from "../static/resolver/worker-client";
import { WorkerTexturePacker } from "../textures/packing/worker-client";

export function createBrowserV2Runtime(
	canvas: HTMLCanvasElement,
): ClientRuntime {
	const renderer = createWebgl2Renderer(canvas);
	const host = createBrowserRuntimeHost();
	const hostSnapshot = host.createSnapshot();
	const staticCoordinator = hostSnapshot.isAvailable
		? createTauriStaticCoordinator(host)
		: undefined;
	const texturePackingWorker = hostSnapshot.isAvailable
		? new Worker(
				new URL(
					"../textures/packing/texture-packing.worker.ts",
					import.meta.url,
				),
				{ type: "module" },
			)
		: null;
	const texturePacker = texturePackingWorker
		? new WorkerTexturePacker(texturePackingWorker, {
				disposePort: () => texturePackingWorker.terminate(),
			})
		: undefined;

	return createClientRuntime({
		host,
		renderer,
		staticCoordinator,
		texturePacker,
	});
}

function createTauriStaticCoordinator(host: RuntimeHost): StaticCoordinator {
	const worker = new Worker(
		new URL("../static/resolver/static-resolver.worker.ts", import.meta.url),
		{ type: "module" },
	);
	const bakeWorker = new Worker(
		new URL("../static/bake/static-bake.worker.ts", import.meta.url),
		{ type: "module" },
	);
	const bridge = createStaticResolverMainHostBridge(worker, host);
	const terrainResolver = new StaticResolverWorkerClient(worker);
	const terrainBaker = new StaticBakeWorkerClient(bakeWorker);
	const placeholderBaker = new ImmediateStaticBakerClient();
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
	const baker = new BrowserStaticBaker({
		onDispose: () => {
			terrainBaker.dispose();
			bakeWorker.terminate();
		},
		placeholderBaker,
		terrainBaker,
	});

	return new StaticCoordinator({
		baker,
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

	resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("BrowserStaticResolver has been disposed."),
			);
		}

		if (job.domain === "outdoor-terrain" && job.scope.kind === "landblock") {
			return this.#terrainResolver.resolve(job);
		}

		return this.#placeholderResolver.resolve(job);
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		this.#onDispose();
	}
}

class BrowserStaticBaker implements StaticBakerClient {
	readonly #terrainBaker: StaticBakerClient;
	readonly #placeholderBaker: StaticBakerClient;
	readonly #onDispose: () => void;
	#disposed = false;

	constructor(options: {
		readonly terrainBaker: StaticBakerClient;
		readonly placeholderBaker: StaticBakerClient;
		readonly onDispose: () => void;
	}) {
		this.#terrainBaker = options.terrainBaker;
		this.#placeholderBaker = options.placeholderBaker;
		this.#onDispose = options.onDispose;
	}

	bake(input: StaticBakeInput): Promise<StaticBakeResult> {
		if (this.#disposed) {
			return Promise.reject(new Error("BrowserStaticBaker has been disposed."));
		}

		if (
			input.work.job.domain === "outdoor-terrain" &&
			input.payload.scope.kind === "terrain"
		) {
			return this.#terrainBaker.bake(input);
		}

		return this.#placeholderBaker.bake(input);
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		this.#onDispose();
	}
}
