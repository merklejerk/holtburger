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

interface ScenePickDynamicPolicy {
	/** Whether dynamic hits should be marked selectable by normal browser selection. */
	readonly defaultSelectable: boolean;
}

export interface ScenePickRequest {
	readonly context: StaticScenePickContext;
	readonly dynamic?: ScenePickDynamicPolicy;
	readonly filters?: StaticScenePickFilters;
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
	readonly sourceResidence:
		| {
				readonly kind: "outdoor-landblock";
				readonly landblockId: number;
		  }
		| {
				readonly envCellId: number;
				readonly kind: "env-cell";
				readonly landblockId: number;
		  };
}
