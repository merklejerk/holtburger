import { acFrameTransform } from "../../assets/ac-frame";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import type { DatAssetId, EnvCellId, LandblockOwnerId } from "../game-types";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { Vec3 } from "../math/types";
import type { PlacedDynamicPresentationSource } from "../systems/dynamic-presentation-source";
import type {
	DynamicEntityAttachedPlacement,
	DynamicEntityAdvance,
	DynamicEntityView,
	DynamicEntityWorldPlacement,
} from "./dynamic-entity-feed";
import type { SceneScope, SceneSpatialPlacement } from "../scene";

/** Join one host-projected live entity with its separately resolved immutable visual closure. */
export function adaptDynamicEntityPresentation(
	entity: DynamicEntityView,
	visual: DecodedStaticPresentation,
	placement = dynamicEntityPlacement(entity),
): PlacedDynamicPresentationSource {
	const expectedSetupId = datAssetId(entity.presentation.content.setupDid);
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
				// The entity names the table it animates from; the setup's own default already
				// resolved host-side, so an absent id here means the entity has no motion at all.
				motionTableId:
					entity.presentation.content.motionTableDid === null
						? null
						: datAssetId(entity.presentation.content.motionTableDid),
				soundTableId:
					entity.presentation.content.soundTableDid === null
						? visual.behavior.soundTableId
						: datAssetId(entity.presentation.content.soundTableDid),
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
export function dynamicEntityPlacement(
	entity: DynamicEntityView,
): SceneSpatialPlacement {
	if (entity.placement.kind !== "world") {
		throw new Error(
			`Attached dynamic entity ${formatGuid(entity.identity.guid)} has no world placement.`,
		);
	}
	return dynamicEntityPlacementFromPoint(entity.placement);
}

/** Convert one host-authored root point without re-deriving its plural spatial membership. */
export function dynamicEntityPlacementFromPoint(
	point: DynamicEntityWorldPlacement | DynamicEntityAdvance["path"]["initial"],
): SceneSpatialPlacement {
	const { pose, spatialMembership } = point;
	const cellId = pose.landblockId >>> 0;
	const selector = cellId & 0xffff;
	const landblockId = datAssetId(
		(cellId & 0xffff_0000) | 0xffff,
	) as LandblockOwnerId;
	return {
		envCellId: selector >= 0x0100 ? (datAssetId(cellId) as EnvCellId) : null,
		landblockId,
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
		spatialMembership: {
			scopes: spatialMembershipScopes(spatialMembership),
		},
	};
}

/** Interpolate one placement-stable half-open path leg in its starting residency. */
export function interpolateDynamicEntityPlacement(
	start: DynamicEntityAdvance["path"]["initial"],
	end: DynamicEntityAdvance["path"]["initial"],
	fraction: number,
): SceneSpatialPlacement {
	const startPlacement = dynamicEntityPlacementFromPoint(start);
	const startOwner = landblockCoordinates(start.pose.landblockId);
	const endOwner = landblockCoordinates(end.pose.landblockId);
	const startWorldX =
		startOwner.x * OUTDOOR_LANDBLOCK_WORLD_SIZE + start.pose.coords.x;
	const startWorldY =
		startOwner.y * OUTDOOR_LANDBLOCK_WORLD_SIZE + start.pose.coords.y;
	const endWorldX =
		endOwner.x * OUTDOOR_LANDBLOCK_WORLD_SIZE + end.pose.coords.x;
	const endWorldY =
		endOwner.y * OUTDOOR_LANDBLOCK_WORLD_SIZE + end.pose.coords.y;
	const rotation = interpolateQuaternion(
		start.pose.rotation,
		end.pose.rotation,
		fraction,
	);
	return {
		envCellId: startPlacement.envCellId,
		landblockId: startPlacement.landblockId,
		localTransform: acFrameTransform(
			{
				origin: [
					start.pose.coords.x + (endWorldX - startWorldX) * fraction,
					start.pose.coords.y + (endWorldY - startWorldY) * fraction,
					start.pose.coords.z +
						(end.pose.coords.z - start.pose.coords.z) * fraction,
				],
				orientation: [rotation.w, rotation.x, rotation.y, rotation.z],
			},
			[1, 1, 1],
		),
		spatialMembership: startPlacement.spatialMembership,
	};
}

function spatialMembershipScopes(
	membership: DynamicEntityWorldPlacement["spatialMembership"],
): readonly SceneScope[] {
	const scopes: SceneScope[] = membership.reachesOutdoors
		? [{ kind: "outdoor" }]
		: [];
	for (const rawEnvCellId of membership.reachedEnvCellIds) {
		const envCellId = rawEnvCellId >>> 0;
		if ((envCellId & 0xffff) < 0x0100) {
			throw new Error(
				`Dynamic spatial membership contains non-EnvCell 0x${envCellId.toString(16).padStart(8, "0")}.`,
			);
		}
		scopes.push({
			envCellId: datAssetId(envCellId) as EnvCellId,
			kind: "env-cell",
			landblockId: datAssetId(
				(envCellId & 0xffff_0000) | 0xffff,
			) as LandblockOwnerId,
		});
	}
	return scopes;
}

/** Numeric DAT key for one typed feed placement. */
export function dynamicEntityPlacementKey(
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

/** The feed carries dat ids as numbers; every asset repository keys on the canonical hex form. */
export function datAssetId(value: number): DatAssetId {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function formatGuid(value: number): string {
	return datAssetId(value);
}
