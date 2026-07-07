import type { AssetService } from "../../../assets/contracts";
import type { DynamicVisualBaker } from "../../../dynamic/visual-baker";
import type { DynamicVisualRecipeResolver } from "../../../dynamic/visual-recipe-resolver";
import type { RuntimeHost } from "../../../host/runtime-contracts";
import type { Renderer } from "../../../renderer/types";
import type {
	StaticBaker,
	StaticLandblockSceneLodSourceResolver,
	StaticResolver,
} from "../../../static/contracts";

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
	readonly createDynamicVisualBaker: () => DynamicVisualBaker;
	readonly createDynamicVisualRecipeResolver: () => DynamicVisualRecipeResolver;
	readonly createStaticBaker: () => StaticBaker;
	readonly createStaticSourceResolver: () => StaticResolver &
		StaticLandblockSceneLodSourceResolver;
}
