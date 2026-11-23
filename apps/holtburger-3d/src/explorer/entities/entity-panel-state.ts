import { renderVector } from "../../lib/assets/ac-frame";
import {
	createLandblockWorldOrigin,
	getLandblockCoordinates,
	isOutdoorLandblock,
	landblockChebyshevDistance,
	normalizeLandblockOwner,
} from "../../lib/game/landblocks";
import type { LandblockOwnerId } from "../../lib/game/game-types";
import type { Vec3 } from "../../lib/game/math/types";
import type {
	DynamicEntityAdvance,
	DynamicEntityView,
} from "../../lib/game/runtime/dynamic-entity-feed";
import type { ExplorerSceneInterestSnapshot } from "../camera/camera-coordinator";

type ExplorerEntityPanelRelevantEvent =
	| { readonly kind: "snapshot" | "upserted" | "removed" }
	| {
			readonly kind: "ticked";
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
		event.kind !== "ticked" ||
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
	| { readonly kind: "reset-all" }
	| { readonly kind: "despawn"; readonly target: ExplorerEntitySelection }
	| { readonly kind: "relocate"; readonly target: ExplorerEntitySelection }
	| { readonly kind: "launch"; readonly target: ExplorerEntitySelection }
	| { readonly kind: "physics-state"; readonly target: ExplorerEntitySelection }
	| {
			readonly kind: "possession";
			readonly target: ExplorerEntitySelection;
	  }
	| {
			readonly kind: "stance";
			readonly target: ExplorerEntitySelection;
	  }
	| {
			readonly kind: "run-rate";
			readonly target: ExplorerEntitySelection;
	  };

/** Whether an entity-scoped operation belongs beside one exact selected generation. */
export function explorerEntityOperationTargets(
	operation: ExplorerEntityOperation,
	selection: ExplorerEntitySelection,
): boolean {
	return (
		operation.kind !== "spawn" &&
		operation.kind !== "reset-all" &&
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

function entityOwnerLandblockId(cellId: number): LandblockOwnerId {
	const ownerHex = `0x${((cellId >>> 16) & 0xffff).toString(16).padStart(4, "0")}ffff`;
	return normalizeLandblockOwner(ownerHex);
}

/** Whether a world-placed Explorer entity remains inside the active scene interest. */
export function isExplorerEntityWithinSceneInterest(
	entity: DynamicEntityView,
	sceneInterest: ExplorerSceneInterestSnapshot,
): boolean {
	if (entity.placement.kind !== "world") return true;
	const entityOwner = entityOwnerLandblockId(entity.placement.pose.landblockId);
	const anchorOwner = normalizeLandblockOwner(
		sceneInterest.residency.landblockId,
	);
	if (sceneInterest.target.kind === "dungeon") {
		return entityOwner === anchorOwner;
	}
	const coords = getLandblockCoordinates(entityOwner);
	if (!isOutdoorLandblock(coords.x, coords.y)) return false;
	return (
		landblockChebyshevDistance(coords, getLandblockCoordinates(anchorOwner)) <=
		sceneInterest.radii.terrainRadius
	);
}

/** Cycle nearby world-placed spawned entities sorted by distance from the camera (Tab / Shift+Tab). */
export function cycleNearbyExplorerEntity(
	entities: readonly DynamicEntityView[],
	currentSelection: ExplorerEntitySelection | null,
	possessedGuid: number | null,
	cameraPosition: Vec3 | null,
	direction: 1 | -1,
	maxDistanceMeters: number,
): ExplorerEntitySelection | null {
	const maxDistanceSq = maxDistanceMeters * maxDistanceMeters;
	const candidates = entities
		.filter(
			(entity) =>
				entity.placement.kind === "world" &&
				entity.identity.guid !== possessedGuid,
		)
		.map((entity) => {
			if (cameraPosition === null || entity.placement.kind !== "world") {
				return { entity, distanceSq: 0 };
			}
			const origin = createLandblockWorldOrigin(
				entityOwnerLandblockId(entity.placement.pose.landblockId),
			);
			const { x, y, z } = entity.placement.pose.coords;
			const offset = renderVector(x, y, z);
			const dx = origin.x + offset.x - cameraPosition.x;
			const dy = origin.y + offset.y - cameraPosition.y;
			const dz = origin.z + offset.z - cameraPosition.z;
			return { entity, distanceSq: dx * dx + dy * dy + dz * dz };
		})
		.filter(({ distanceSq }) => distanceSq <= maxDistanceSq)
		.sort(
			(left, right) =>
				left.distanceSq - right.distanceSq ||
				left.entity.identity.guid - right.entity.identity.guid,
		);
	if (candidates.length === 0) return null;
	const currentIndex =
		currentSelection === null
			? -1
			: candidates.findIndex(
					({ entity }) =>
						entity.identity.guid === currentSelection.guid &&
						entity.generation === currentSelection.generation,
				);
	const nextIndex =
		currentIndex === -1
			? direction > 0
				? 0
				: candidates.length - 1
			: (currentIndex + direction + candidates.length) % candidates.length;
	return explorerEntitySelection(candidates[nextIndex]!.entity);
}
