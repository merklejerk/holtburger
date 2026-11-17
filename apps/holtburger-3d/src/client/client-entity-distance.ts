import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";
import type {
	DynamicEntityMirror,
	DynamicEntityWorldPlacement,
} from "../lib/game/runtime/dynamic-entity-feed";
import type { ClientEntityMirror } from "./client-entity-mirror";

type WorldPose = DynamicEntityWorldPlacement["pose"];

/** AC-space vector from `origin` to `target` in meters without allocating landblock origins. */
export function deltaBetweenDynamicWorldPoses(
	origin: WorldPose,
	target: WorldPose,
): { readonly dx: number; readonly dy: number; readonly dz: number } {
	const dx =
		(((target.landblockId >>> 24) & 0xff) -
			((origin.landblockId >>> 24) & 0xff)) *
			OUTDOOR_LANDBLOCK_WORLD_SIZE +
		target.coords.x -
		origin.coords.x;
	const dy =
		(((target.landblockId >>> 16) & 0xff) -
			((origin.landblockId >>> 16) & 0xff)) *
			OUTDOOR_LANDBLOCK_WORLD_SIZE +
		target.coords.y -
		origin.coords.y;
	const dz = target.coords.z - origin.coords.z;
	return { dx, dy, dz };
}

/** Squared 3D Euclidean distance between accepted AC poses in meters. */
export function distanceSquaredBetweenDynamicWorldPoses(
	player: WorldPose,
	target: WorldPose,
): number {
	const { dx, dy, dz } = deltaBetweenDynamicWorldPoses(player, target);
	return dx * dx + dy * dy + dz * dz;
}

/** Distance between accepted AC poses in canonical scene space without allocating origins. */
export function distanceBetweenDynamicWorldPoses(
	player: WorldPose,
	target: WorldPose,
): number {
	const { dx, dy, dz } = deltaBetweenDynamicWorldPoses(player, target);
	return Math.hypot(dx, dy, dz);
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
