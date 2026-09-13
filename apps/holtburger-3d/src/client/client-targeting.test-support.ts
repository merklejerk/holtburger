import {
	cellId,
	type DynamicEntityView,
	type DynamicEntityWorldPlacement,
} from "../lib/game/runtime/dynamic-entity-feed";
import { sceneVec3 } from "../lib/assets/ac-frame";
import { datAssetId } from "../lib/game/runtime/dynamic-entity-presentation";
import type { LandblockOwnerId } from "../lib/game/game-types";
import { Quat, Vec3 } from "../lib/game/math/types";
import type { PrimaryCameraView } from "../lib/game/runtime/types";

/** Asset-free accepted entity; scenarios control pose and semantic facts independently. */
export function targetingEntity(
	guid: number,
	generation: number,
): DynamicEntityView & { placement: DynamicEntityWorldPlacement } {
	return {
		generation,
		motion: null,
		identity: { guid, wcid: 42 },
		display: { name: "Drudge", level: null },
		presentation: {
			entityClass: "other",
			content: {
				motionTableDid: null,
				setupDid: 0x02000001,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			objectScale: 1,
			radar: {
				behavior: null,
				category: "other",
				obviousRange: null,
			},
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
			translucency: 0,
			lighting: false,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			kind: "world",
			spatialMembership: {
				reachesOutdoors: true,
				reachedEnvCellIds: [],
			},
			pose: {
				landblockId: cellId(0x00000100),
				coords: { x: 0, y: 0, z: 0 },
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			contact: "unknown",
			sampleMode: "authoritative-only",
		},
	};
}

/** Camera looking along canonical -Z; no EnvCell topology is loaded. */
export const TARGETING_TEST_VIEW: PrimaryCameraView = {
	camera: {
		far: 2000,
		near: 0.1,
		fov: 90,
		placement: {
			envCellId: null,
			landblockId: datAssetId(0x0000ffff) as LandblockOwnerId,
			position: sceneVec3(Vec3.zero()),
			rotation: Quat.identity(),
		},
	},
	extent: { width: 100, height: 100 },
};
