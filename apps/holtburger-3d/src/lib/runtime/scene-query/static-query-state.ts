import type { RenderMat4 } from "../../math/ac-placement-transform";
import type {
	EnvCellSystemStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
	StaticBounds,
	StaticEnvCellSpatialRecord,
	StaticObjectInstanceFacts,
	StaticPortalProjectionRecord,
	StaticPortalInteriorRecord,
	TerrainMeshQuadFacts,
	TerrainStaticScopePayload,
} from "../../static/contracts";
import type { OutdoorStaticObjectSourceDiagnostics } from "./contracts";

type TerrainBvh = TerrainStaticScopePayload["sourceSpatial"]["terrainBvh"];

type BvhNode =
	| NonNullable<
			OutdoorStaticObjectsScopePayload["sourceSpatial"]["outdoorBvh"]
	  >["nodes"][number]
	| TerrainBvh["nodes"][number]
	| EnvCellSystemStaticScopePayload["residencySpatial"]["envCellSystemBvh"]["nodes"][number];

export type EnvCellInteriorPortal =
	StaticPortalInteriorRecord["envCells"][number]["portals"][number];

export interface OutdoorStaticBvhRoot {
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly landblockId: number;
	readonly translation: readonly [number, number, number];
	readonly nodes: readonly BvhNode[];
	readonly items: readonly (OutdoorStaticBvhRuntimeItem | null)[];
}

export interface OutdoorStaticBvhRuntimeItem {
	readonly bvhItemIndex: number;
	readonly kind: "static" | "building";
	readonly object: StaticObjectInstanceFacts;
}

export interface TerrainBvhRoot {
	readonly landblockId: number;
	readonly translation: readonly [number, number, number];
	readonly nodes: readonly BvhNode[];
	readonly items: readonly (TerrainBvhRuntimeItem | null)[];
}

export interface TerrainBvhRuntimeItem {
	readonly bvhItemIndex: number;
	readonly quad: TerrainMeshQuadFacts;
}

export interface OutdoorSourceDiagnosticsRoot {
	readonly objectsByInstanceId: ReadonlyMap<
		string,
		OutdoorStaticObjectSourceDiagnostics
	>;
}

export interface EnvCellLandblockBvhRoot {
	readonly acceptedEnvCellIds: readonly number[];
	readonly cellsByEnvCellId: ReadonlyMap<number, EnvCellBvhRoot>;
	readonly items: readonly (EnvCellLandblockBvhRuntimeItem | null)[];
	readonly landblockId: number;
	readonly nodes: readonly BvhNode[];
	readonly translation: readonly [number, number, number];
}

export interface EnvCellBvhRoot {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly items: readonly EnvCellBvhRuntimeItem[];
}

export type EnvCellBvhRuntimeItem = {
	readonly kind: "static";
	readonly seed: EnvCellStaticSeedRuntimeRecord;
};

export interface EnvCellStaticSeedRuntimeRecord {
	readonly envCellId: number;
	readonly seed: EnvCellSystemStaticScopePayload["envCells"][number]["staticObjectSeeds"][number];
}

export interface EnvCellLandblockBvhRuntimeItem {
	readonly bounds: StaticBounds;
	readonly cellBsp: StaticEnvCellSpatialRecord["cellBsp"];
	readonly envCellId: number;
	readonly graphEvidence: EnvCellResidencyGraphEvidence;
	readonly inverseCellRenderMatrix: RenderMat4;
	readonly localPlacement: StaticEnvCellSpatialRecord["localPlacement"];
	readonly memberId: string;
	readonly source: "env-cell-root" | "derived";
}

export interface EnvCellResidencyGraphEvidence {
	readonly incomingEnvCellPortalRefs: number;
	readonly reciprocalEnvCellPortalRefs: number;
	readonly visibleListRefs: number;
}

export interface EnvCellResidencyCandidate {
	readonly item: EnvCellLandblockBvhRuntimeItem;
	readonly nodeIndex: number;
}

export interface LandblockSpatialBucket {
	readonly envCellRoot: EnvCellLandblockBvhRoot | null;
	readonly landblockId: number;
	readonly outdoorRootsByDomain: ReadonlyMap<
		OutdoorStaticObjectsScopePayload["domain"],
		OutdoorStaticBvhRoot
	>;
	readonly terrainRoot: TerrainBvhRoot | null;
}

export interface LandblockSpatialCandidate {
	readonly distance: number;
	readonly envCellRoot: EnvCellLandblockBvhRoot | null;
	readonly landblockId: number;
	readonly outdoorRoots: readonly OutdoorStaticBvhRoot[];
	readonly terrainRoot: TerrainBvhRoot | null;
}

export interface CommittedRecordEntry<TRecord> {
	readonly ownerKey: string;
	readonly record: TRecord;
}

export interface CachedEnvCellPortalProjection {
	readonly projection: StaticPortalProjectionRecord | null;
	readonly sourceKey: string;
}
