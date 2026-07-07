import type { AssetService } from "../../../assets/contracts";
import type { DynamicVisualPrepper } from "../../../dynamic/visual-prepper";
import type { DynamicVisualRecipeResolver } from "../../../dynamic/visual-recipe-resolver";
import type { RuntimeHost } from "../../../host/runtime-contracts";
import type { Renderer } from "../../../renderer/types";
import type {
	StaticBaker,
	StaticLandblockSceneLodSourceResolver,
	StaticResolver,
} from "../../../static/contracts";
import type { OpenWorldTexturePageBuilder } from "../texture-residency/page-build/worker-client";
import type { OpenWorldObjectVisualAtlasBuilder } from "../texture-residency/atlas-build/object-visual-atlas-builder";

/** Durable browser/host boundary consumed by the replacement system. */
export interface OpenWorldStreamingBoundaryAdapters {
	readonly assets: OpenWorldStreamingAssetAdapter;
	readonly renderer: OpenWorldStreamingRendererAdapter;
	readonly workers: OpenWorldStreamingWorkerAdapters;
}

/** Asset and host access kept behind an adapter so source policy stays local. */
interface OpenWorldStreamingAssetAdapter {
	readonly assetService: AssetService;
	readonly host: RuntimeHost;
}

/** Main-loop renderer mutation boundary for scene and texture commits. */
interface OpenWorldStreamingRendererAdapter {
	readonly renderer: Renderer;
}

/** Existing worker-backed transforms exposed as factories, not eager work. */
interface OpenWorldStreamingWorkerAdapters {
	readonly createDynamicVisualPrepper: () => DynamicVisualPrepper;
	readonly createDynamicVisualRecipeResolver: () => DynamicVisualRecipeResolver;
	readonly createObjectVisualAtlasBuilder: () => OpenWorldObjectVisualAtlasBuilder;
	readonly createStaticBaker: () => StaticBaker;
	readonly createStaticSourceResolver: () => StaticResolver &
		StaticLandblockSceneLodSourceResolver;
	readonly createTexturePageBuilder: () => OpenWorldTexturePageBuilder;
}
