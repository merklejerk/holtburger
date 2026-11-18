import {
	acFrameTransform,
	sceneVec3,
	writeAcFrameTransform,
	type SceneVec3,
} from "../../assets/ac-frame";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import type { DatAssetId, EnvCellId, LandblockOwnerId } from "../game-types";
import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	createLandblockWorldOrigin,
} from "../landblocks";
import { Mat4, Vec3 } from "../math/types";
import type { ResolvedObjectBehavior } from "../resolution/landblock-layer";
import type { PlacedDynamicPresentationSource } from "../systems/dynamic-presentation-source";
import type {
	DynamicEntityAdvance,
	DynamicEntityView,
	DynamicEntityWorldPlacement,
} from "./dynamic-entity-feed";
import type {
	SceneResidency,
	SceneScope,
	SceneSpatialPlacement,
} from "../scene";

/** A retained body is the previous usable appearance after a replacement rolled back. */
export type DynamicEntityRealizationDisposition =
	"installed" | "retained" | "deferred" | "unavailable";

/** Whether this receipt supplies geometry that can be used for rendering and interaction. */
export function hasUsableDynamicBody(
	disposition: DynamicEntityRealizationDisposition | undefined,
): boolean {
	return disposition === "installed" || disposition === "retained";
}

/** Per-entity realization result produced at an explicit population/readiness boundary. */
export type DynamicEntityRealizationResults = ReadonlyMap<
	number,
	DynamicEntityRealizationDisposition
>;

/** Build the generation-qualified identity shared by runtime ownership and renderer policy. */
export function dynamicEntityPresentationIdentity(
	guid: number,
	generation: number,
): string {
	return `dynamic-entity:${formatGuid(guid)}/${generation}`;
}

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
		playback: { kind: "source-owned" },
		initialPresentationState: {
			cloaked: entity.physics.cloaked,
			hidden: entity.physics.hidden,
			lighting: entity.physics.lighting,
			noDraw: entity.physics.noDraw,
			translucency: entity.physics.translucency,
		},
		source: {
			entityClass: entity.presentation.entityClass,
			nameplate: { ...entity.display, indicators: [], strikeThrough: false },
			behavior: {
				...withPhysicsScriptTableOverride(
					visual.behavior,
					entity.presentation.content.physicsEffectTableDid === null
						? null
						: datAssetId(entity.presentation.content.physicsEffectTableDid),
				),
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
			identity: dynamicEntityPresentationIdentity(
				entity.identity.guid,
				entity.generation,
			),
			localBounds: visual.localBounds,
			presentation: visual.presentation,
			placementFrame: entity.presentation.placementFrame,
			scale: new Vec3(
				entity.presentation.objectScale,
				entity.presentation.objectScale,
				entity.presentation.objectScale,
			),
			setupId: expectedSetupId,
		},
	};
}

/** Apply an entity table override without breaking the closed setup-behavior classification. */
function withPhysicsScriptTableOverride(
	behavior: ResolvedObjectBehavior,
	override: DatAssetId | null,
): ResolvedObjectBehavior {
	if (override === null) return behavior;
	if (behavior.kind === "none") {
		return {
			...behavior,
			kind: "script-only",
			physicsScriptTableId: override,
		};
	}
	if (behavior.kind === "animation-only") {
		return {
			...behavior,
			kind: "animation-and-script",
			physicsScriptTableId: override,
		};
	}
	return { ...behavior, physicsScriptTableId: override };
}

/** Accepted root origin in canonical scene space; no EnvCell topology or mesh is required. */
export function dynamicEntityWorldOrigin(
	placement: DynamicEntityWorldPlacement,
): SceneVec3 {
	const { pose } = placement;
	const origin = createLandblockWorldOrigin(
		landblockCoordinates(pose.landblockId),
	);
	// Same AC Z-up to scene Y-up conversion as acFrameTransform, without building a matrix.
	return sceneVec3(
		new Vec3(origin.x + pose.coords.x, pose.coords.z, origin.z - pose.coords.y),
	);
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

/** Resident owner/cell identity shared by scene admission and encounter membership. */
export function dynamicEntityResidency(
	point: Pick<DynamicEntityWorldPlacement, "pose">,
): SceneResidency {
	const cellId = point.pose.landblockId >>> 0;
	return {
		landblockId: datAssetId(
			(cellId & 0xffff_0000) | 0xffff,
		) as LandblockOwnerId,
		envCellId:
			(cellId & 0xffff) >= 0x0100 ? (datAssetId(cellId) as EnvCellId) : null,
	};
}

/** Convert one host-authored root point without re-deriving its plural spatial membership. */
export function dynamicEntityPlacementFromPoint(
	point: DynamicEntityWorldPlacement | DynamicEntityAdvance["path"]["initial"],
): SceneSpatialPlacement {
	const { pose, spatialMembership } = point;
	return {
		...dynamicEntityResidency(point),
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
	const residency = dynamicEntityResidency(start);
	return {
		...residency,
		localTransform: interpolateDynamicEntityTransform(
			start,
			end,
			fraction,
			Mat4.zero(),
		),
		spatialMembership: {
			scopes: spatialMembershipScopes(start.spatialMembership),
		},
	};
}

/** Interpolate only the mutable root transform; path residency is selected at leg boundaries. */
export function interpolateDynamicEntityTransform(
	start: DynamicEntityAdvance["path"]["initial"],
	end: DynamicEntityAdvance["path"]["initial"],
	fraction: number,
	target: Mat4,
): Mat4 {
	const startId = start.pose.landblockId;
	const endId = end.pose.landblockId;
	const startWorldX =
		((startId >>> 24) & 0xff) * OUTDOOR_LANDBLOCK_WORLD_SIZE +
		start.pose.coords.x;
	const startWorldY =
		((startId >>> 16) & 0xff) * OUTDOOR_LANDBLOCK_WORLD_SIZE +
		start.pose.coords.y;
	const endWorldX =
		((endId >>> 24) & 0xff) * OUTDOOR_LANDBLOCK_WORLD_SIZE + end.pose.coords.x;
	const endWorldY =
		((endId >>> 16) & 0xff) * OUTDOOR_LANDBLOCK_WORLD_SIZE + end.pose.coords.y;
	const from = start.pose.rotation;
	const to = end.pose.rotation;
	const dot = from.w * to.w + from.x * to.x + from.y * to.y + from.z * to.z;
	const sign = dot < 0 ? -1 : 1;
	let w = from.w + (to.w * sign - from.w) * fraction;
	let x = from.x + (to.x * sign - from.x) * fraction;
	let y = from.y + (to.y * sign - from.y) * fraction;
	let z = from.z + (to.z * sign - from.z) * fraction;
	const length = Math.hypot(w, x, y, z);
	if (!Number.isFinite(length) || length <= Number.EPSILON)
		throw new Error("Dynamic-entity path produced an invalid rotation.");
	w /= length;
	x /= length;
	y /= length;
	z /= length;
	return writeAcFrameTransform(
		start.pose.coords.x + (endWorldX - startWorldX) * fraction,
		start.pose.coords.y + (endWorldY - startWorldY) * fraction,
		start.pose.coords.z + (end.pose.coords.z - start.pose.coords.z) * fraction,
		w,
		x,
		y,
		z,
		1,
		1,
		1,
		target,
	);
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

function landblockCoordinates(cellId: number): { x: number; y: number } {
	return { x: (cellId >>> 24) & 0xff, y: (cellId >>> 16) & 0xff };
}

/** The feed carries dat ids as numbers; every asset repository keys on the canonical hex form. */
export function datAssetId(value: number): DatAssetId {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function formatGuid(value: number): string {
	return datAssetId(value);
}
