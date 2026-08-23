import type {
	DynamicEntityAdvance,
	DynamicEntityView,
} from "../lib/game/runtime/dynamic-entity-feed";

type ExplorerEntityPanelRelevantEvent =
	| { readonly kind: "snapshot" | "upserted" | "removed" }
	| {
			readonly kind: "advanced";
			readonly batch: {
				readonly advances: readonly Pick<DynamicEntityAdvance, "kind">[];
			};
	  };

/**
 * Whether an accepted feed event changes panel-worthy identity or discontinuous placement state.
 *
 * Integrated advances are the 30 Hz presentation path. Publishing them into Svelte would rebuild
 * the entity tree on every host tick; teleport/reset corrections are rare and deserve a fresh
 * inspector snapshot.
 */
export function refreshesExplorerEntityPanel(
	event: ExplorerEntityPanelRelevantEvent,
): boolean {
	return (
		event.kind !== "advanced" ||
		event.batch.advances.some((advance) => advance.kind !== "integrated")
	);
}

/** Exact live identity selected in the current atomic entity feed generation. */
export interface ExplorerEntitySelection {
	readonly guid: number;
	readonly generation: number;
}

/** One mutation currently owning the Entities panel's serialized action surface. */
export type ExplorerEntityOperation =
	| { readonly kind: "spawn" }
	| { readonly kind: "despawn"; readonly target: ExplorerEntitySelection }
	| {
			readonly kind: "possession";
			readonly target: ExplorerEntitySelection;
	  }
	| {
			readonly kind: "stance";
			readonly target: ExplorerEntitySelection;
	  };

/** One action-local failure retained after its operation releases the panel. */
export interface ExplorerEntityOperationFailure {
	readonly operation: ExplorerEntityOperation;
	readonly message: string;
}

/** Whether an entity-scoped operation belongs beside one exact selected generation. */
export function explorerEntityOperationTargets(
	operation: ExplorerEntityOperation,
	selection: ExplorerEntitySelection,
): boolean {
	return (
		operation.kind !== "spawn" &&
		operation.target.guid === selection.guid &&
		operation.target.generation === selection.generation
	);
}

/** Resolve selection against both GUID and generation so replacement cannot inherit old focus. */
export function findSelectedExplorerEntity(
	entities: readonly DynamicEntityView[],
	selection: ExplorerEntitySelection | null,
): DynamicEntityView | null {
	if (selection === null) return null;
	return (
		entities.find(
			(entity) =>
				entity.identity.guid === selection.guid &&
				entity.generation === selection.generation,
		) ?? null
	);
}

/** Resolve an attached selection's current wearer without inventing lifecycle for the child. */
export function findExplorerEntityWearer(
	entities: readonly DynamicEntityView[],
	selected: DynamicEntityView | null,
): DynamicEntityView | null {
	if (selected?.placement.kind !== "attached") return null;
	const parentGuid = selected.placement.parent;
	return entities.find((entity) => entity.identity.guid === parentGuid) ?? null;
}

/** Capture the complete identity used by selection and mutation receipts. */
export function explorerEntitySelection(
	entity: DynamicEntityView,
): ExplorerEntitySelection {
	return { guid: entity.identity.guid, generation: entity.generation };
}
