import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
import type {
	ClientEntityFacts,
	ClientEntityRead,
} from "./client-entity-mirror";

/** One selected identity, independent of whether it participates in the rendered scene. */
export interface ClientSelectedEntity {
	/** Selection owner's GUID, retained while replacement facts are pending. */
	readonly guid: number;
	/** Shared world/inventory facts; null during recovery or when the identity is absent. */
	readonly facts: ClientEntityFacts | null;
	/** Optional scene-specific details, never a fallback source for shared facts. */
	readonly presentation: DynamicEntityView | null;
}

/** Join current reads by GUID without caching another copy of selection or entity state. */
export function clientSelectedEntity(
	guid: number | null,
	entities: ClientEntityRead,
	presentation: readonly DynamicEntityView[],
): ClientSelectedEntity | null {
	if (guid === null) return null;
	if (entities.kind === "pending")
		return { guid, facts: null, presentation: null };
	return {
		guid,
		facts: entities.level.entities.get(guid) ?? null,
		presentation:
			presentation.find((entity) => entity.identity.guid === guid) ?? null,
	};
}
