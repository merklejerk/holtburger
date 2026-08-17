import { acFrameTransform } from "../../assets/ac-frame";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import type { DatAssetId, EnvCellId, LandblockId } from "../game-types";
import { Vec3 } from "../math/types";
import type { PlacedDynamicPresentationSource } from "../systems/dynamic-presentation-source";
import type { DynamicEntityView } from "./dynamic-entity-feed";
import type { ScenePlacement } from "../scene";

/** Join one host-projected live entity with its separately resolved immutable visual closure. */
export function adaptSpawnedDynamicPresentation(
	entity: DynamicEntityView,
	visual: DecodedStaticPresentation,
): PlacedDynamicPresentationSource {
	const expectedSetupId = datId(entity.presentation.content.setupDid);
	if (visual.setupId?.toLowerCase() !== expectedSetupId) {
		throw new Error(
			`Dynamic entity ${formatGuid(entity.identity.guid)} visual resolved ${visual.setupId ?? "no setup"}, expected ${expectedSetupId}.`,
		);
	}
	return {
		placement: spawnedDynamicPlacement(entity),
		source: {
			behavior: {
				...visual.behavior,
				soundTableId:
					entity.presentation.content.soundTableDid === null
						? visual.behavior.soundTableId
						: (datId(entity.presentation.content.soundTableDid) as DatAssetId),
			},
			identity: `dynamic-entity:${formatGuid(entity.identity.guid)}/${entity.generation}`,
			localBounds: visual.localBounds,
			presentation: visual.presentation,
			scale: new Vec3(
				entity.presentation.objectScale,
				entity.presentation.objectScale,
				entity.presentation.objectScale,
			),
			setupId: expectedSetupId,
		},
	};
}

/** Convert one host-accepted AC pose without re-resolving portal residency in the frontend. */
export function spawnedDynamicPlacement(
	entity: DynamicEntityView,
): ScenePlacement {
	const pose = entity.placement.pose;
	const cellId = pose.landblockId >>> 0;
	const selector = cellId & 0xffff;
	return {
		envCellId: selector >= 0x0100 ? (datId(cellId) as EnvCellId) : null,
		landblockId: datId((cellId & 0xffff_0000) | 0xffff) as LandblockId,
		localTransform: acFrameTransform(
			{
				origin: [pose.coords.x, pose.coords.y, pose.coords.z],
				orientation: [
					pose.rotation.w,
					pose.rotation.x,
					pose.rotation.y,
					pose.rotation.z,
				],
			},
			[1, 1, 1],
		),
	};
}

function datId(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function formatGuid(value: number): string {
	return datId(value);
}
