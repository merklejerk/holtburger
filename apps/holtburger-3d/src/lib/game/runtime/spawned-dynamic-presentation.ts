import { acFrameTransform } from "../../assets/ac-frame";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import type { DatAssetId, EnvCellId, LandblockId } from "../game-types";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { Vec3 } from "../math/types";
import type { PlacedDynamicPresentationSource } from "../systems/dynamic-presentation-source";
import type {
	DynamicEntityAttachedPlacement,
	DynamicEntityView,
	DynamicEntityWorldPlacement,
} from "./dynamic-entity-feed";
import type { ScenePlacement } from "../scene";

/** Join one host-projected live entity with its separately resolved immutable visual closure. */
export function adaptSpawnedDynamicPresentation(
	entity: DynamicEntityView,
	visual: DecodedStaticPresentation,
	placement = spawnedDynamicPlacement(entity),
): PlacedDynamicPresentationSource {
	const expectedSetupId = datId(entity.presentation.content.setupDid);
	if (visual.setupId?.toLowerCase() !== expectedSetupId) {
		throw new Error(
			`Dynamic entity ${formatGuid(entity.identity.guid)} visual resolved ${visual.setupId ?? "no setup"}, expected ${expectedSetupId}.`,
		);
	}
	return {
		placement,
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
	if (entity.placement.kind !== "world") {
		throw new Error(
			`Attached dynamic entity ${formatGuid(entity.identity.guid)} has no world placement.`,
		);
	}
	return spawnedDynamicPlacementFromPose(entity.placement.pose);
}

/** Convert one host-authored root pose while preserving its exact placement selector. */
export function spawnedDynamicPlacementFromPose(
	pose: DynamicEntityWorldPlacement["pose"],
): ScenePlacement {
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

/** Interpolate one placement-stable half-open path leg in its starting residency. */
export function interpolateSpawnedDynamicPlacement(
	start: DynamicEntityWorldPlacement["pose"],
	end: DynamicEntityWorldPlacement["pose"],
	fraction: number,
): ScenePlacement {
	const startPlacement = spawnedDynamicPlacementFromPose(start);
	const startOwner = landblockCoordinates(start.landblockId);
	const endOwner = landblockCoordinates(end.landblockId);
	const startWorldX =
		startOwner.x * OUTDOOR_LANDBLOCK_WORLD_SIZE + start.coords.x;
	const startWorldY =
		startOwner.y * OUTDOOR_LANDBLOCK_WORLD_SIZE + start.coords.y;
	const endWorldX = endOwner.x * OUTDOOR_LANDBLOCK_WORLD_SIZE + end.coords.x;
	const endWorldY = endOwner.y * OUTDOOR_LANDBLOCK_WORLD_SIZE + end.coords.y;
	const rotation = interpolateQuaternion(
		start.rotation,
		end.rotation,
		fraction,
	);
	return {
		envCellId: startPlacement.envCellId,
		landblockId: startPlacement.landblockId,
		localTransform: acFrameTransform(
			{
				origin: [
					start.coords.x + (endWorldX - startWorldX) * fraction,
					start.coords.y + (endWorldY - startWorldY) * fraction,
					start.coords.z + (end.coords.z - start.coords.z) * fraction,
				],
				orientation: [rotation.w, rotation.x, rotation.y, rotation.z],
			},
			[1, 1, 1],
		),
	};
}

/** Numeric DAT key for one typed feed placement. */
export function spawnedDynamicPlacementKey(
	placement: DynamicEntityAttachedPlacement["placement"],
): number {
	return PLACEMENT_KEYS[placement];
}

const PLACEMENT_KEYS: Readonly<
	Record<DynamicEntityAttachedPlacement["placement"], number>
> = {
	default: 0,
	"right-hand-combat": 1,
	"right-hand-non-combat": 2,
	"left-hand": 3,
	belt: 4,
	quiver: 5,
	shield: 6,
	"left-weapon": 7,
	"left-unarmed": 8,
	"unknown0-a": 0x0a,
	"unknown0-f": 0x0f,
	unknown14: 0x14,
	"unknown1-e": 0x1e,
	unknown20: 0x20,
	"special-crossbow-bolt": 51,
	"missile-flight": 52,
	"unknown3-c": 0x3c,
	unknown63: 0x63,
	resting: 0x65,
	other: 0x66,
	hook: 0x67,
	unknown68: 0x68,
	unknown69: 0x69,
	"unknown6-a": 0x6a,
	unknown78: 0x78,
	random1: 121,
	random2: 122,
	random3: 123,
	random4: 124,
	random5: 125,
	random6: 126,
	random7: 127,
	random8: 128,
	random9: 129,
	random10: 130,
	unknown84: 0x84,
	"unknown-f0": 0xf0,
	"unknown3-f2": 0x3f2,
};

function landblockCoordinates(cellId: number): { x: number; y: number } {
	return { x: (cellId >>> 24) & 0xff, y: (cellId >>> 16) & 0xff };
}

function interpolateQuaternion(
	start: DynamicEntityWorldPlacement["pose"]["rotation"],
	end: DynamicEntityWorldPlacement["pose"]["rotation"],
	fraction: number,
): DynamicEntityWorldPlacement["pose"]["rotation"] {
	const dot =
		start.w * end.w + start.x * end.x + start.y * end.y + start.z * end.z;
	const sign = dot < 0 ? -1 : 1;
	const w = start.w + (end.w * sign - start.w) * fraction;
	const x = start.x + (end.x * sign - start.x) * fraction;
	const y = start.y + (end.y * sign - start.y) * fraction;
	const z = start.z + (end.z * sign - start.z) * fraction;
	const length = Math.hypot(w, x, y, z);
	if (!Number.isFinite(length) || length <= Number.EPSILON) {
		throw new Error("Dynamic-entity path produced an invalid rotation.");
	}
	return { w: w / length, x: x / length, y: y / length, z: z / length };
}

function datId(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function formatGuid(value: number): string {
	return datId(value);
}
