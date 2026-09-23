import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
import { dynamicEntityWorldOrigin } from "../lib/game/runtime/dynamic-entity-presentation";
import type { ClientEntityMirror } from "./client-entity-mirror";

/** Borrow just the accepted identity and pose facts needed by this policy. */
interface VendorPoseSource {
	currentEntities(): Iterable<
		Pick<DynamicEntityView, "identity" | "placement">
	>;
	isAwaitingSnapshot(): boolean;
}

/** App-local distance from accepted world poses, independent of renderer residency. */
export function sampleVendorDistanceMeters(
	entities: Pick<ClientEntityMirror, "read">,
	motion: VendorPoseSource,
	vendorGuid: number,
): number | null {
	const read = entities.read();
	if (
		read.kind !== "current" ||
		read.level.playerGuid === null ||
		motion.isAwaitingSnapshot()
	)
		return null;
	let player = null;
	let vendor = null;
	for (const entity of motion.currentEntities()) {
		if (entity.placement.kind !== "world") continue;
		if (entity.identity.guid === read.level.playerGuid)
			player = dynamicEntityWorldOrigin(entity.placement);
		else if (entity.identity.guid === vendorGuid)
			vendor = dynamicEntityWorldOrigin(entity.placement);
		if (player !== null && vendor !== null) break;
	}
	return player === null || vendor === null
		? null
		: Math.hypot(player.x - vendor.x, player.y - vendor.y, player.z - vendor.z);
}
