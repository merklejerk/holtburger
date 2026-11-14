import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";
import type {
	DynamicEntityMirror,
	DynamicEntityWorldPlacement,
} from "../lib/game/runtime/dynamic-entity-feed";
import type { ClientEntityMirror } from "./client-entity-mirror";

type WorldPose = DynamicEntityWorldPlacement["pose"];

/** Distance between accepted AC poses in canonical scene space without allocating origins. */
export function distanceBetweenDynamicWorldPoses(
	player: WorldPose,
	target: WorldPose,
): number {
	const x =
		(((player.landblockId >>> 24) & 0xff) -
			((target.landblockId >>> 24) & 0xff)) *
			OUTDOOR_LANDBLOCK_WORLD_SIZE +
		player.coords.x -
		target.coords.x;
	const z =
		(((player.landblockId >>> 16) & 0xff) -
			((target.landblockId >>> 16) & 0xff)) *
			OUTDOOR_LANDBLOCK_WORLD_SIZE +
		player.coords.y -
		target.coords.y;
	return Math.hypot(x, z, player.coords.z - target.coords.z);
}

/** Event-driven distance query for vendor and house interaction policy. */
export function sampleEntityDistanceMeters(
	entities: Pick<ClientEntityMirror, "read">,
	motion: Pick<DynamicEntityMirror, "entityByGuid" | "isAwaitingSnapshot">,
	entityGuid: number,
): number | null {
	const read = entities.read();
	if (
		read.kind !== "current" ||
		read.level.playerGuid === null ||
		motion.isAwaitingSnapshot()
	)
		return null;
	const player = motion.entityByGuid(read.level.playerGuid);
	const target = motion.entityByGuid(entityGuid);
	return player?.placement.kind !== "world" ||
		target?.placement.kind !== "world"
		? null
		: distanceBetweenDynamicWorldPoses(
				player.placement.pose,
				target.placement.pose,
			);
}
