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
import type { OpenWorldObjectVisualAtlasBuilder } from "../systems/open-world-streaming/texture-residency/atlas-build/object-visual-atlas-builder";
import { WorkerPoolOpenWorldObjectVisualAtlasBuilder } from "../systems/open-world-streaming/texture-residency/atlas-build/object-visual-atlas-worker-client";
import type { OpenWorldObjectVisualAtlasWorkerPort } from "../systems/open-world-streaming/texture-residency/atlas-build/object-visual-atlas-worker-protocol";
import type { OpenWorldTexturePageBuildWorkerPort } from "../systems/open-world-streaming/texture-residency/page-build/protocol";
import {
	WorkerPoolOpenWorldTexturePageBuilder,
	type OpenWorldTexturePageBuilder,
} from "../systems/open-world-streaming/texture-residency/page-build/worker-client";
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

const DEFAULT_STATIC_RESOLVER_WORKER_COUNT = 2;
const DEFAULT_STATIC_BAKER_WORKER_COUNT = 2;
const DEFAULT_DYNAMIC_VISUAL_RECIPE_RESOLVER_WORKER_COUNT = 1;
const DEFAULT_DYNAMIC_VISUAL_BAKER_WORKER_COUNT = 1;
const DEFAULT_TEXTURE_LAYOUT_WORKER_COUNT = 2;
const DEFAULT_TEXTURE_PAGE_BUILD_WORKER_COUNT = 2;

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
			createObjectVisualAtlasBuilder: () =>
				createWorkerObjectVisualAtlasBuilder(
					options.assetService,
					DEFAULT_TEXTURE_LAYOUT_WORKER_COUNT,
					{ host: options.host },
				),
			createStaticBaker: () =>
				createWorkerStaticBaker(DEFAULT_STATIC_BAKER_WORKER_COUNT),
			createStaticSourceResolver: () =>
				createWorkerStaticResolver(
					options.assetService,
					DEFAULT_STATIC_RESOLVER_WORKER_COUNT,
					{ host: options.host },
				),
			createTexturePageBuilder: () =>
				createWorkerTexturePageBuilder(
					options.assetService,
					DEFAULT_TEXTURE_PAGE_BUILD_WORKER_COUNT,
					{ host: options.host },
				),
		},
	};
}

interface StaticResolverBrowserWorker extends StaticResolverWorkerPort {
	terminate(): void;
}

interface DynamicVisualRecipeBrowserWorker extends DynamicVisualRecipeWorkerPort {
	terminate(): void;
}

interface ObjectVisualAtlasBrowserWorker extends OpenWorldObjectVisualAtlasWorkerPort {
	terminate(): void;
}

interface TexturePageBuildBrowserWorker extends OpenWorldTexturePageBuildWorkerPort {
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

interface WorkerObjectVisualAtlasBuilderFactories {
	readonly createWorker?: () => ObjectVisualAtlasBrowserWorker;
	readonly host?: ReturnType<typeof createBrowserRuntimeHost>;
}

export function createWorkerObjectVisualAtlasBuilder(
	assetReader: PreparedAssetReader,
	workerCount: number,
	factories: WorkerObjectVisualAtlasBuilderFactories = {},
): OpenWorldObjectVisualAtlasBuilder {
	assertPositiveInteger(workerCount, "texture layout worker count");
	const createWorker =
		factories.createWorker ?? createObjectVisualAtlasBrowserWorker;

	return new WorkerPoolOpenWorldObjectVisualAtlasBuilder({
		assetReader,
		createWorker,
		host: factories.host,
		workerCount,
	});
}

function createObjectVisualAtlasBrowserWorker(): ObjectVisualAtlasBrowserWorker {
	return new Worker(
		new URL(
			"../systems/open-world-streaming/texture-residency/atlas-build/object-visual-atlas.worker.ts",
			import.meta.url,
		),
		{ type: "module" },
	) as ObjectVisualAtlasBrowserWorker;
}

interface WorkerTexturePageBuilderFactories {
	readonly createWorker?: () => TexturePageBuildBrowserWorker;
	readonly host?: ReturnType<typeof createBrowserRuntimeHost>;
}

function createWorkerTexturePageBuilder(
	assetReader: PreparedAssetReader,
	workerCount: number,
	factories: WorkerTexturePageBuilderFactories = {},
): OpenWorldTexturePageBuilder {
	assertPositiveInteger(workerCount, "texture page build worker count");
	const createWorker = factories.createWorker ?? createTexturePageBuildWorker;

	return new WorkerPoolOpenWorldTexturePageBuilder({
		assetReader,
		createWorker,
		host: factories.host,
		workerCount,
	});
}

function createTexturePageBuildWorker(): TexturePageBuildBrowserWorker {
	return new Worker(
		new URL(
			"../systems/open-world-streaming/texture-residency/page-build/page-build.worker.ts",
			import.meta.url,
		),
		{ type: "module" },
	) as TexturePageBuildBrowserWorker;
}

function assertPositiveInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive integer. Received ${value}.`);
	}
}
