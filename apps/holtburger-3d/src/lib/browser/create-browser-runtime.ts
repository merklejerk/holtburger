import { HostBackedAssetService } from "../assets/asset-service";
import type { PreparedAssetReader } from "../assets/contracts";
import type { DynamicVisualBaker } from "../dynamic/visual-baker";
import { WorkerPoolDynamicVisualBaker } from "../dynamic/visual-bake-worker-client";
import type { DynamicVisualBakeWorkerPort } from "../dynamic/visual-bake-protocol";
import { WorkerPoolDynamicVisualRecipeResolver } from "../dynamic/visual-recipe-worker-client";
import type { DynamicVisualRecipeResolver } from "../dynamic/visual-recipe-resolver";
import type { DynamicVisualRecipeWorkerPort } from "../dynamic/visual-recipe-protocol";
import { createBrowserRuntimeHost } from "../host/runtime-host";
import { createWebgl2Renderer } from "../renderer/webgl2/webgl2-renderer";
import {
	createClientRuntime,
	type ClientRuntime,
} from "../runtime/client-runtime";
import { CompositeStaticBakeResourceProvider } from "../static/bake/resources";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type {
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBaker,
	StaticBakerDiagnosticsSnapshot,
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticResolverJob,
	StaticResolver,
	StaticScopePayload,
} from "../static/contracts";
import { ImmediateStaticBaker } from "../static/fake-workers";
import { EnvCellSystemGeometryResourceProvider } from "../static/env-cells/bake/env-cell-system-geometry-resources";
import { StaticObjectBakeResourceProvider } from "../static/objects/bake/static-object-bake-resources";
import { WorkerPoolStaticBaker } from "../static/bake/worker-client";
import type { StaticBakeWorkerPort } from "../static/bake/protocol";
import { WorkerPoolStaticResolver } from "../static/resolver/worker-client";
import type { StaticResolverWorkerPort } from "../static/resolver/protocol";
import type { TexturePackingWorkerPort } from "../textures/packing/protocol";
import type { TexturePacker } from "../textures/packing/packer";
import { WorkerPoolTexturePacker } from "../textures/packing/worker-client";

const DEFAULT_STATIC_RESOLVER_WORKER_COUNT = 2;
const DEFAULT_STATIC_BAKER_WORKER_COUNT = 2;
const DEFAULT_DYNAMIC_VISUAL_RECIPE_RESOLVER_WORKER_COUNT = 1;
const DEFAULT_DYNAMIC_VISUAL_BAKER_WORKER_COUNT = 1;
const DEFAULT_TEXTURE_PACKING_WORKER_COUNT = 2;

export function createBrowserRuntime(canvas: HTMLCanvasElement): ClientRuntime {
	const renderer = createWebgl2Renderer(canvas);
	const host = createBrowserRuntimeHost();
	const assetService = new HostBackedAssetService({ host });
	const hostSnapshot = host.createSnapshot();
	const dynamicVisualBaker = hostSnapshot.isAvailable
		? createWorkerDynamicVisualBaker(DEFAULT_DYNAMIC_VISUAL_BAKER_WORKER_COUNT)
		: undefined;
	const staticCoordinator = hostSnapshot.isAvailable
		? createTauriStaticCoordinator(assetService, dynamicVisualBaker)
		: undefined;
	const texturePacker = hostSnapshot.isAvailable
		? createWorkerTexturePacker(DEFAULT_TEXTURE_PACKING_WORKER_COUNT)
		: undefined;
	const dynamicVisualRecipeResolver = hostSnapshot.isAvailable
		? createWorkerDynamicVisualRecipeResolver(
				assetService,
				DEFAULT_DYNAMIC_VISUAL_RECIPE_RESOLVER_WORKER_COUNT,
			)
		: undefined;

	return createClientRuntime({
		host,
		assetService,
		dynamicVisualBaker,
		dynamicVisualRecipeResolver,
		renderer,
		staticCoordinator,
		texturePacker,
	});
}

function createTauriStaticCoordinator(
	assetReader: PreparedAssetReader,
	dynamicVisualBaker: DynamicVisualBaker | undefined,
): StaticCoordinator {
	const terrainResolver = createWorkerStaticResolver(
		assetReader,
		DEFAULT_STATIC_RESOLVER_WORKER_COUNT,
	);
	const workerBaker = createWorkerStaticBaker(
		DEFAULT_STATIC_BAKER_WORKER_COUNT,
	);
	const placeholderBaker = new ImmediateStaticBaker();
	const resolver = new BrowserStaticResolver({
		terrainResolver,
	});
	const baker = new BrowserStaticBaker({
		placeholderBaker,
		workerBaker,
	});

	return new StaticCoordinator({
		resourceProvider: new CompositeStaticBakeResourceProvider([
			new StaticObjectBakeResourceProvider({
				assetReader,
			}),
			new EnvCellSystemGeometryResourceProvider(),
		]),
		baker,
		dynamicVisualBaker,
		dynamicVisualGeometryAssetReader: assetReader,
		textureIdentityAssetReader: assetReader,
		resolver,
	});
}

interface StaticResolverBrowserWorker extends StaticResolverWorkerPort {
	terminate(): void;
}

interface DynamicVisualRecipeBrowserWorker extends DynamicVisualRecipeWorkerPort {
	terminate(): void;
}

export interface WorkerStaticResolverFactories {
	readonly createWorker?: () => StaticResolverBrowserWorker;
}

export function createWorkerStaticResolver(
	assetReader: PreparedAssetReader,
	workerCount: number,
	factories: WorkerStaticResolverFactories = {},
): StaticResolver & StaticLandblockSceneLodSourceResolver {
	assertPositiveInteger(workerCount, "static resolver worker count");
	const createWorker =
		factories.createWorker ?? createStaticResolverBrowserWorker;

	return new WorkerPoolStaticResolver({
		assetReader,
		createWorker,
		workerCount,
	});
}

function createStaticResolverBrowserWorker(): StaticResolverBrowserWorker {
	return new Worker(
		new URL("../static/resolver/static-resolver.worker.ts", import.meta.url),
		{ type: "module" },
	) as StaticResolverBrowserWorker;
}

export interface WorkerDynamicVisualRecipeResolverFactories {
	readonly createWorker?: () => DynamicVisualRecipeBrowserWorker;
}

export function createWorkerDynamicVisualRecipeResolver(
	assetReader: PreparedAssetReader,
	workerCount: number,
	factories: WorkerDynamicVisualRecipeResolverFactories = {},
): DynamicVisualRecipeResolver {
	assertPositiveInteger(
		workerCount,
		"dynamic visual recipe resolver worker count",
	);
	const createWorker =
		factories.createWorker ?? createDynamicVisualRecipeBrowserWorker;

	return new WorkerPoolDynamicVisualRecipeResolver({
		assetReader,
		createWorker,
		workerCount,
	});
}

function createDynamicVisualRecipeBrowserWorker(): DynamicVisualRecipeBrowserWorker {
	return new Worker(
		new URL("../dynamic/visual-recipe.worker.ts", import.meta.url),
		{ type: "module" },
	) as DynamicVisualRecipeBrowserWorker;
}

function createWorkerStaticBaker(workerCount: number): StaticBaker {
	assertPositiveInteger(workerCount, "static baker worker count");

	return new WorkerPoolStaticBaker({
		createWorker: () =>
			new Worker(
				new URL("../static/bake/static-bake.worker.ts", import.meta.url),
				{
					type: "module",
				},
			) as StaticBakeWorkerPort,
		workerCount,
	});
}

interface DynamicVisualBakerBrowserWorker extends DynamicVisualBakeWorkerPort {
	terminate(): void;
}

interface WorkerDynamicVisualBakerFactories {
	readonly createWorker?: () => DynamicVisualBakerBrowserWorker;
}

export function createWorkerDynamicVisualBaker(
	workerCount: number,
	factories: WorkerDynamicVisualBakerFactories = {},
): DynamicVisualBaker {
	assertPositiveInteger(workerCount, "dynamic visual baker worker count");
	const createWorker =
		factories.createWorker ?? createDynamicVisualBakerBrowserWorker;

	return new WorkerPoolDynamicVisualBaker({
		createWorker,
		workerCount,
	});
}

function createDynamicVisualBakerBrowserWorker(): DynamicVisualBakerBrowserWorker {
	return new Worker(
		new URL("../dynamic/visual-bake.worker.ts", import.meta.url),
		{ type: "module" },
	) as DynamicVisualBakerBrowserWorker;
}

function createWorkerTexturePacker(workerCount: number): TexturePacker {
	assertPositiveInteger(workerCount, "texture packing worker count");

	return new WorkerPoolTexturePacker({
		createWorker: () =>
			new Worker(
				new URL(
					"../textures/packing/texture-packing.worker.ts",
					import.meta.url,
				),
				{ type: "module" },
			) as TexturePackingWorkerPort,
		workerCount,
	});
}

function assertPositiveInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive integer. Received ${value}.`);
	}
}

class BrowserStaticResolver
	implements StaticResolver, StaticLandblockSceneLodSourceResolver
{
	readonly #sceneLodSourceResolver: StaticLandblockSceneLodSourceResolver;
	#disposed = false;

	constructor(options: {
		readonly terrainResolver: StaticResolver &
			StaticLandblockSceneLodSourceResolver;
	}) {
		this.#sceneLodSourceResolver = options.terrainResolver;
	}

	resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("BrowserStaticResolver has been disposed."),
			);
		}

		return Promise.reject(
			new Error(
				`BrowserStaticResolver direct static-scope resolution is retired; use resolveSource for ${job.domain}.`,
			),
		);
	}

	resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("BrowserStaticResolver has been disposed."),
			);
		}

		return this.#sceneLodSourceResolver.resolveSource(request);
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		disposeIfAvailable(this.#sceneLodSourceResolver);
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

	bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		if (this.#disposed) {
			return Promise.reject(new Error("BrowserStaticBaker has been disposed."));
		}

		if (shouldUseBrowserWorkerBaker(input.domain)) {
			return this.#workerBaker.bake(input);
		}

		return this.#placeholderBaker.bake(input);
	}

	createDiagnosticsSnapshot(): StaticBakerDiagnosticsSnapshot {
		return (
			this.#workerBaker.createDiagnosticsSnapshot?.() ?? {
				kind: "static-baker",
				pendingJobs: [],
				workerCount: null,
			}
		);
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

export function shouldUseBrowserWorkerBaker(
	domain: StaticBakeJobInput["domain"],
): boolean {
	return (
		domain === "outdoor-terrain" ||
		domain === "outdoor-buildings" ||
		domain === "outdoor-explicit-objects" ||
		domain === "outdoor-generated-scenery" ||
		domain === "env-cell-system"
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
