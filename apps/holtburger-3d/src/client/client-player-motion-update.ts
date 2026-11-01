import type {
	DynamicEntityEvent,
	DynamicEntityMirror,
	DynamicEntityView,
} from "../lib/game/runtime/dynamic-entity-feed";

/** Read this player's accepted update; absent or stale batch records cannot complete playback. */
export function playerMotionUpdate(
	event: DynamicEntityEvent,
	guid: number,
	mirror: Pick<DynamicEntityMirror, "entity">,
): DynamicEntityView | "removed" | null {
	let candidate: DynamicEntityView | "removed" | null;
	switch (event.kind) {
		case "snapshot":
			candidate =
				event.snapshot.entities.find(
					(entity) => entity.identity.guid === guid,
				) ?? "removed";
			break;
		case "upserted":
			candidate = event.entity.identity.guid === guid ? event.entity : null;
			break;
		case "removed":
			candidate = event.guid === guid ? "removed" : null;
			break;
		case "ticked":
			candidate =
				event.batch.updates.find((entity) => entity.identity.guid === guid) ??
				event.batch.advances.find(
					(advance) => advance.entity.identity.guid === guid,
				)?.entity ??
				null;
			break;
	}
	if (candidate === null || candidate === "removed") return candidate;
	return mirror.entity(guid, candidate.generation) === candidate
		? candidate
		: null;
}
