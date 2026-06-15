import { HostBackedAssetService } from "../assets/asset-service";
import type { PreparedAssetReader } from "../assets/contracts";
import { createBrowserRuntimeHost } from "../host/tauri-runtime-host";
import { createWebgl2Renderer } from "../renderer/webgl2/webgl2-renderer";
import {
	createClientRuntime,
	type ClientRuntime,
} from "../runtime/client-runtime";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type {
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBaker,
	StaticResolverJob,
	StaticResolver,
	StaticScopePayload,
} from "../static/contracts";
import {
	ImmediateStaticBaker,
	ImmediateStaticResolver,
} from "../static/fake-workers";
import { StaticObjectBakeAttachmentProvider } from "../static/objects/bake/static-object-bake-attachments";
import {
	StaticBakeWorkerClient,
	WorkerPoolStaticBaker,
} from "../static/bake/worker-client";
import {
	createStaticResolverMainAssetBridge,
	type StaticResolverMainAssetBridge,
} from "../static/resolver/asset-bridge";
import {
	StaticResolverWorkerClient,
	WorkerPoolStaticResolver,
} from "../static/resolver/worker-client";
import type { StaticResolverWorkerPort } from "../static/resolver/protocol";
import type { TexturePacker } from "../textures/packing/packer";
import {
	WorkerPoolTexturePacker,
	WorkerTexturePacker,
} from "../textures/packing/worker-client";

const DEFAULT_STATIC_RESOLVER_WORKER_COUNT = 2;
const DEFAULT_STATIC_BAKER_WORKER_COUNT = 2;
const DEFAULT_TEXTURE_PACKING_WORKER_COUNT = 2;

export function createBrowserV2Runtime(
	canvas: HTMLCanvasElement,
): ClientRuntime {
	const renderer = createWebgl2Renderer(canvas);
	const host = createBrowserRuntimeHost();
	const assetService = new HostBackedAssetService({ host });
	const hostSnapshot = host.createSnapshot();
	const staticCoordinator = hostSnapshot.isAvailable
		? createTauriStaticCoordinator(assetService)
		: undefined;
	const texturePacker = hostSnapshot.isAvailable
		? createWorkerTexturePacker(DEFAULT_TEXTURE_PACKING_WORKER_COUNT)
		: undefined;

	return createClientRuntime({
		host,
		assetService,
		renderer,
		staticCoordinator,
		texturePacker,
	});
}

function createTauriStaticCoordinator(
	assetReader: PreparedAssetReader,
): StaticCoordinator {
	const terrainResolver = createWorkerStaticResolver(
		assetReader,
		DEFAULT_STATIC_RESOLVER_WORKER_COUNT,
	);
	const workerBaker = createWorkerStaticBaker(
		DEFAULT_STATIC_BAKER_WORKER_COUNT,
	);
	const placeholderBaker = new ImmediateStaticBaker();
	const placeholderResolver = new ImmediateStaticResolver();
	const resolver = new BrowserStaticResolver({
		placeholderResolver,
		terrainResolver,
	});
	const baker = new BrowserStaticBaker({
		placeholderBaker,
		workerBaker,
	});

	return new StaticCoordinator({
		attachmentProvider: new StaticObjectBakeAttachmentProvider({
			assetReader,
		}),
		baker,
		resolver,
	});
}

interface StaticResolverBrowserWorker extends StaticResolverWorkerPort {
	terminate(): void;
}

export interface WorkerStaticResolverFactories {
	readonly createBridge?: (
		port: StaticResolverWorkerPort,
		assetReader: PreparedAssetReader,
	) => StaticResolverMainAssetBridge;
	readonly createWorker?: () => StaticResolverBrowserWorker;
}

export function createWorkerStaticResolver(
	assetReader: PreparedAssetReader,
	workerCount: number,
	factories: WorkerStaticResolverFactories = {},
): StaticResolver {
	assertPositiveInteger(workerCount, "static resolver worker count");
	const createWorker =
		factories.createWorker ?? createStaticResolverBrowserWorker;
	const createBridge =
		factories.createBridge ?? createStaticResolverMainAssetBridge;

	const resolvers = Array.from({ length: workerCount }, () => {
		const worker = createWorker();
		const bridge = createBridge(worker, assetReader);

		return new StaticResolverWorkerClient(worker, {
			disposePort: () => {
				bridge.dispose();
				worker.terminate();
			},
		});
	});

	return new WorkerPoolStaticResolver(resolvers);
}

function createStaticResolverBrowserWorker(): StaticResolverBrowserWorker {
	return new Worker(
		new URL("../static/resolver/static-resolver.worker.ts", import.meta.url),
		{ type: "module" },
	) as StaticResolverBrowserWorker;
}

function createWorkerStaticBaker(workerCount: number): StaticBaker {
	assertPositiveInteger(workerCount, "static baker worker count");

	const bakers = Array.from({ length: workerCount }, () => {
		const worker = new Worker(
			new URL("../static/bake/static-bake.worker.ts", import.meta.url),
			{ type: "module" },
		);

		return new StaticBakeWorkerClient(worker, {
			disposePort: () => worker.terminate(),
		});
	});

	return new WorkerPoolStaticBaker(bakers);
}

function createWorkerTexturePacker(workerCount: number): TexturePacker {
	assertPositiveInteger(workerCount, "texture packing worker count");

	const packers = Array.from({ length: workerCount }, () => {
		const worker = new Worker(
			new URL("../textures/packing/texture-packing.worker.ts", import.meta.url),
			{ type: "module" },
		);

		return new WorkerTexturePacker(worker, {
			disposePort: () => worker.terminate(),
		});
	});

	return new WorkerPoolTexturePacker(packers);
}

function assertPositiveInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive integer. Received ${value}.`);
	}
}

class BrowserStaticResolver implements StaticResolver {
	readonly #sourceResolver: StaticResolver;
	readonly #placeholderResolver: StaticResolver;
	#disposed = false;

	constructor(options: {
		readonly terrainResolver: StaticResolver;
		readonly placeholderResolver: StaticResolver;
	}) {
		this.#sourceResolver = options.terrainResolver;
		this.#placeholderResolver = options.placeholderResolver;
	}

	resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("BrowserStaticResolver has been disposed."),
			);
		}

		if (shouldUseBrowserSourceResolver(job)) {
			return this.#sourceResolver.resolve(job);
		}

		return this.#placeholderResolver.resolve(job);
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		disposeIfAvailable(this.#sourceResolver);
		disposeIfAvailable(this.#placeholderResolver);
	}
}

class BrowserStaticBaker implements StaticBaker {
	readonly #workerBaker: StaticBaker;
	readonly #placeholderBaker: StaticBaker;
	#disposed = false;

	constructor(options: {
		readonly workerBaker: StaticBaker;
		readonly placeholderBaker: StaticBaker;
	}) {
		this.#workerBaker = options.workerBaker;
		this.#placeholderBaker = options.placeholderBaker;
	}

	bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		if (this.#disposed) {
			return Promise.reject(new Error("BrowserStaticBaker has been disposed."));
		}

		if (shouldUseBrowserWorkerBaker(input.domain)) {
			return this.#workerBaker.bake(input);
		}

		return this.#placeholderBaker.bake(input);
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		disposeIfAvailable(this.#workerBaker);
		disposeIfAvailable(this.#placeholderBaker);
	}
}

export function shouldUseBrowserSourceResolver(
	job: StaticResolverJob,
): boolean {
	return (
		(job.domain === "outdoor-terrain" ||
			job.domain === "outdoor-buildings" ||
			job.domain === "outdoor-detail" ||
			job.domain === "landblock-env-cells") &&
		job.scope.kind === "landblock"
	);
}

export function shouldUseBrowserWorkerBaker(
	domain: StaticBakeBatchInput["domain"],
): boolean {
	return (
		domain === "outdoor-terrain" ||
		domain === "outdoor-buildings" ||
		domain === "outdoor-detail"
	);
}

function disposeIfAvailable(value: unknown): void {
	if (
		typeof value === "object" &&
		value !== null &&
		"dispose" in value &&
		typeof value.dispose === "function"
	) {
		value.dispose();
	}
}
