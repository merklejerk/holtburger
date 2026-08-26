import type { DynamicEntityView } from "../game/runtime/dynamic-entity-feed";
import type { DecodedStaticPresentation } from "./decode-static-source-record";

/** Async content boundary for one exact live-entity SetupModel appearance. */
export interface DynamicEntityVisualSource {
	load(
		presentation: DynamicEntityView["presentation"],
	): Promise<DecodedStaticPresentation>;
	/** Stop queued content work when the owning presentation is torn down. */
	destroy?(): void;
}
