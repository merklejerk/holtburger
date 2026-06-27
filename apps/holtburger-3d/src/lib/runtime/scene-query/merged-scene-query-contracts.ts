import type {
	DynamicEntityBoundsPrecision,
	DynamicEntityId,
} from "../../dynamic/contracts";
import type { StaticBounds } from "../../static/contracts";
import type {
	StaticScenePickContext,
	StaticScenePickFilters,
	StaticScenePickHit,
	StaticSceneRay,
	Vec3,
} from "./contracts";

type ScenePickMode =
	| "default-selection"
	| "debug-inspection"
	| "diagnostics";

export interface ScenePickRequest {
	readonly context: StaticScenePickContext;
	readonly filters?: StaticScenePickFilters;
	readonly mode: ScenePickMode;
	readonly ray: StaticSceneRay;
}

export type ScenePickHit = StaticScenePickSourceHit | DynamicScenePickHit;

interface StaticScenePickSourceHit {
	readonly bounds: StaticBounds;
	readonly distance: number;
	readonly hitPoint: Vec3;
	readonly kind: "scene-pick-hit";
	readonly source: "static";
	readonly staticHit: StaticScenePickHit;
}

interface DynamicScenePickHit {
	readonly bounds: StaticBounds;
	readonly defaultSelectable: boolean;
	readonly distance: number;
	readonly entityId: DynamicEntityId;
	readonly hitPoint: Vec3;
	readonly kind: "scene-pick-hit";
	readonly precision: DynamicEntityBoundsPrecision;
	readonly source: "dynamic";
	readonly sourceResidence: {
		readonly kind: "outdoor-landblock";
		readonly landblockId: number;
	};
}
