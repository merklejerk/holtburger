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
import type { ClientRuntime } from "../runtime/client-runtime";
import { createOpenWorldStreamingClientRuntime } from "../systems/open-world-streaming";
import type { OpenWorldStreamingStaticPublicationMode } from "../systems/open-world-streaming/composition/open-world-streaming-controller";
import type { OpenWorldStreamingBoundaryAdapters } from "../systems/open-world-streaming/adapters";
import type {
	StaticBaker,
	StaticLandblockSceneLodSourceResolver,
	StaticResolver,
} from "../static/contracts";
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

export interface CreateBrowserRuntimeOptions {
	readonly staticPublicationMode?: OpenWorldStreamingStaticPublicationMode;
}

export function createBrowserRuntime(
	canvas: HTMLCanvasElement,
	options: CreateBrowserRuntimeOptions = {},
): ClientRuntime {
	const renderer = createWebgl2Renderer(canvas);
	const host = createBrowserRuntimeHost();
	const assetService = new HostBackedAssetService({ host });

	return createOpenWorldStreamingClientRuntime({
		adapters: createOpenWorldStreamingBoundaryAdapters({
			assetService,
			host,
			renderer,
		}),
		staticPublicationMode: options.staticPublicationMode,
	});
}

function createOpenWorldStreamingBoundaryAdapters(options: {
	readonly assetService: PreparedAssetReader & HostBackedAssetService;
	readonly host: ReturnType<typeof createBrowserRuntimeHost>;
	readonly renderer: ReturnType<typeof createWebgl2Renderer>;
}): OpenWorldStreamingBoundaryAdapters {
	return {
		assets: {
			assetService: options.assetService,
			host: options.host,
		},
		renderer: {
			renderer: options.renderer,
		},
		workers: {
			createDynamicVisualBaker: () =>
				createWorkerDynamicVisualBaker(
					DEFAULT_DYNAMIC_VISUAL_BAKER_WORKER_COUNT,
				),
			createDynamicVisualRecipeResolver: () =>
				createWorkerDynamicVisualRecipeResolver(
					options.assetService,
					DEFAULT_DYNAMIC_VISUAL_RECIPE_RESOLVER_WORKER_COUNT,
				),
			createStaticBaker: () =>
				createWorkerStaticBaker(DEFAULT_STATIC_BAKER_WORKER_COUNT),
			createStaticSourceResolver: () =>
				createWorkerStaticResolver(
					options.assetService,
					DEFAULT_STATIC_RESOLVER_WORKER_COUNT,
					{ host: options.host },
				),
			createTexturePacker: () =>
				createWorkerTexturePacker(DEFAULT_TEXTURE_PACKING_WORKER_COUNT),
		},
	};
}

interface StaticResolverBrowserWorker extends StaticResolverWorkerPort {
	terminate(): void;
}

interface DynamicVisualRecipeBrowserWorker extends DynamicVisualRecipeWorkerPort {
	terminate(): void;
}

export interface WorkerStaticResolverFactories {
	readonly createWorker?: () => StaticResolverBrowserWorker;
	readonly host?: ReturnType<typeof createBrowserRuntimeHost>;
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
		host: factories.host,
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
