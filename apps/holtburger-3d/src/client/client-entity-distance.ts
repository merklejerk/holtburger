import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
import { dynamicEntityWorldOrigin } from "../lib/game/runtime/dynamic-entity-presentation";
import type { ClientEntityMirror } from "./client-entity-mirror";

/** Borrow just the accepted identity and pose facts needed by this policy. */
interface EntityPoseSource {
	currentEntities(): Iterable<
		Pick<DynamicEntityView, "identity" | "placement">
	>;
	isAwaitingSnapshot(): boolean;
}

/** App-local distance from accepted world poses, independent of renderer residency. */
export function sampleEntityDistanceMeters(
	entities: Pick<ClientEntityMirror, "read">,
	motion: EntityPoseSource,
	entityGuid: number,
): number | null {
	const read = entities.read();
	if (
		read.kind !== "current" ||
		read.level.playerGuid === null ||
		motion.isAwaitingSnapshot()
	)
		return null;
	let player = null;
	let target = null;
	for (const entity of motion.currentEntities()) {
		if (entity.placement.kind !== "world") continue;
		if (entity.identity.guid === read.level.playerGuid)
			player = dynamicEntityWorldOrigin(entity.placement);
		else if (entity.identity.guid === entityGuid)
			target = dynamicEntityWorldOrigin(entity.placement);
		if (player !== null && target !== null) break;
	}
	return player === null || target === null
		? null
		: Math.hypot(player.x - target.x, player.y - target.y, player.z - target.z);
}
