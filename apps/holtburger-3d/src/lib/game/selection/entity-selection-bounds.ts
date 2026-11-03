import type { DynamicEntityView } from "../runtime/dynamic-entity-feed";
import type { DynamicEntitySelectionGeometry } from "../systems/dynamic-entity-system";

/** Borrowed posed boxes; matrices and bounds must not escape the synchronous visit. */
export type EntitySelectionBounds = Pick<
	DynamicEntitySelectionGeometry,
	"landblockId" | "sourceToLandblock"
> & {
	/** Selectable rigid parts, without aggregate envelopes or particle proxies. */
	readonly parts: readonly Pick<
		DynamicEntitySelectionGeometry["parts"][number],
		"localBounds" | "sourceToLandblock"
	>[];
};

/** Population of installed world entities with their current published selection boxes. */
export interface RealizedEntitySelectionSource {
	/** Visit identity and geometry together; acquisition never waits for missing visuals. */
	visitRealizedEntitySelectionBounds(
		visit: (entity: DynamicEntityView, bounds: EntitySelectionBounds) => void,
	): void;
}
