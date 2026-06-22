import type {
	LandblockEnvCellsStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
	StaticBounds,
	StaticObjectInstanceFacts,
	StaticObjectMaterialSourceFacts,
	StaticObjectPartSourceFacts,
	StaticDomain,
	StaticAuthoredDynamicSeedRecord,
	StaticEnvCellSpatialRecord,
	StaticPortalProjectionRecord,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticScopePayload,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticObjectTextureRefFacts,
	StaticResourceKey,
	StaticScopeOwnerKey,
	TerrainMeshQuadFacts,
	TerrainStaticScopePayload,
	StaticVisibilityRecord,
} from "../static/contracts";
import type { EnvCellSystemLayerPayload } from "../renderer/types";
import {
	createEnvCellPortalProjectionRoot,
	createStaticPortalProjection,
	createStaticPortalProjectionSourceKey,
} from "../static/portal-graphs";
import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	getOutdoorLandblockCoords,
} from "../../lib/landblocks";
import {
	createOutdoorLandblockRootTranslation,
	deriveOutdoorCameraLandblockResidency,
} from "./static-placement";

export interface StaticSceneRay {
	readonly origin: Vec3;
	readonly direction: Vec3;
}

export type StaticScenePickContext =
	| {
			readonly kind: "outdoor";
	  }
	| {
			readonly kind: "env-cell";
			readonly landblockId: number;
			readonly envCellId: number;
			readonly acceptedEnvCellIds?: readonly number[];
	  };

export interface StaticScenePickRequest {
	readonly context: StaticScenePickContext;
	readonly ray: StaticSceneRay;
	readonly filters?: StaticScenePickFilters;
}

interface StaticScenePickFilters {
	readonly itemKinds?: readonly StaticSceneSelectionKey["itemKind"][];
	readonly domains?: readonly StaticSceneSelectionKey["domain"][];
	readonly ignoreContainingOrigin?: boolean;
}

export type StaticScenePickHit =
	| OutdoorStaticObjectScenePickHit
	| EnvCellStaticScenePickHit
	| EnvCellPortalScenePickHit
	| TerrainQuadScenePickHit;

export type StaticSceneSelectionKey =
	| OutdoorStaticObjectSceneSelectionKey
	| EnvCellStaticSceneSelectionKey
	| EnvCellPortalSceneSelectionKey
	| TerrainQuadSceneSelectionKey;

export interface OutdoorStaticObjectSceneSelectionKey {
	readonly itemKind: "outdoor-static-object";
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly landblockId: number;
	readonly instanceId: string;
}

export interface EnvCellStaticSceneSelectionKey {
	readonly itemKind: "env-cell-static-object";
	readonly domain: "landblock-env-cells";
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
}

export interface EnvCellPortalSceneSelectionKey {
	readonly itemKind: "env-cell-portal";
	readonly domain: "landblock-env-cells";
	readonly landblockId: number;
	readonly envCellId: number;
	readonly portalId: string;
}

export interface TerrainQuadSceneSelectionKey {
	readonly itemKind: "terrain-quad";
	readonly domain: "outdoor-terrain";
	readonly landblockId: number;
	readonly quadIndex: number;
}

export interface OutdoorStaticObjectScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly distance: number;
	readonly hitPoint: Vec3;
	readonly bounds: StaticBounds;
	readonly selectionKey: OutdoorStaticObjectSceneSelectionKey;
}

export interface EnvCellStaticScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly distance: number;
	readonly hitPoint: Vec3;
	readonly bounds: StaticBounds;
	readonly selectionKey: EnvCellStaticSceneSelectionKey;
}

interface EnvCellPortalScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly distance: number;
	readonly hitPoint: Vec3;
	readonly bounds: StaticBounds;
	readonly selectionKey: EnvCellPortalSceneSelectionKey;
}

export interface TerrainQuadScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly distance: number;
	readonly hitPoint: Vec3;
	readonly bounds: StaticBounds;
	readonly selectionKey: TerrainQuadSceneSelectionKey;
}

export interface OutdoorStaticObjectScenePickDetails {
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly landblockId: number;
	readonly instanceId: string;
	readonly object: StaticObjectInstanceFacts;
	readonly bvhItemIndex: number;
	readonly bvhItemKind: "static" | "building";
}

export interface OutdoorStaticObjectSourceDiagnostics {
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly instanceId: string;
	readonly landblockId: number;
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly materialSlots: readonly OutdoorStaticObjectMaterialSlotDiagnostics[];
	readonly object: StaticObjectInstanceFacts;
	readonly sourceAsset: OutdoorStaticObjectSourceAssetDiagnostics | null;
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
}

type OutdoorStaticObjectPartDiagnostics = Omit<
	StaticObjectPartSourceFacts,
	"normals" | "positions" | "texCoords" | "triangles"
>;

type OutdoorStaticObjectSourceAssetDiagnostics = Omit<
	OutdoorStaticObjectsScopePayload["sourceAssets"][number],
	"parts"
> & {
	readonly parts: readonly OutdoorStaticObjectPartDiagnostics[];
};

interface OutdoorStaticObjectMaterialSlotDiagnostics {
	readonly material: StaticObjectMaterialSourceFacts | null;
	readonly slot: OutdoorStaticObjectsScopePayload["materialSlots"][number];
}

export interface EnvCellStaticScenePickDetails {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
	readonly seed: LandblockEnvCellsStaticScopePayload["envCells"][number]["staticObjectSeeds"][number];
}

export interface TerrainQuadScenePickDetails {
	readonly landblockId: number;
	readonly quad: TerrainMeshQuadFacts;
	readonly bvhItemIndex: number;
}

export interface StaticSceneSelectionDebugBounds {
	readonly bounds: StaticBounds;
	readonly selectionKey: StaticSceneSelectionKey;
}

export interface StaticSceneEnvCellBounds {
	readonly bounds: StaticBounds;
	readonly envCellId: number;
	readonly landblockId: number;
}

export interface StaticSceneTerrainLandblockBounds {
	readonly bounds: StaticBounds;
	readonly landblockId: number;
}

export interface StaticSceneEnvCellAabbDebugBounds {
	readonly bounds: StaticBounds;
	readonly envCellId: number;
	readonly landblockId: number;
	readonly memberId: string;
	readonly source: "env-cell-root" | "derived";
}

export interface StaticSceneQuerySnapshot {
	readonly landblockBucketCount: number;
	readonly terrainLandblockCount: number;
	readonly terrainRecordCount: number;
	readonly outdoorRecordCount: number;
	readonly envCellRecordCount: number;
	readonly envCellLandblockCount: number;
	readonly committedEnvCellLandblockCount: number;
	readonly committedEnvCellPortalGraphRecordCount: number;
	readonly committedEnvCellPortalInteriorRecordCount: number;
	readonly committedEnvCellSourceMappingRecordCount: number;
	readonly committedEnvCellSpatialRecordCount: number;
	readonly committedEnvCellVisibilityRecordCount: number;
}

export interface RetainedOutdoorSourceLandblock {
	readonly landblockId: number;
	readonly domains: {
		readonly terrain: boolean;
		readonly buildings: boolean;
		readonly detail: boolean;
		readonly envCells: boolean;
	};
}

export interface StaticSceneQuerySourcePayloadOptions {
	readonly outdoorAnchorLandblockId?: number | null;
}

export interface Vec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export type StaticSceneCameraResidency =
	| {
			readonly kind: "outdoor-landblock";
			readonly landblockId: number;
	  }
	| {
			readonly kind: "env-cell";
			readonly landblockId: number;
			readonly envCellId: number;
	  }
	| {
			readonly kind: "unknown";
			readonly landblockId: number | null;
	  };

type TerrainBvh = TerrainStaticScopePayload["sourceSpatial"]["terrainBvh"];
type BvhNode =
	| NonNullable<
			OutdoorStaticObjectsScopePayload["sourceSpatial"]["outdoorBvh"]
	  >["nodes"][number]
	| TerrainBvh["nodes"][number]
	| LandblockEnvCellsStaticScopePayload["residencySpatial"]["landblockEnvCellBvh"]["nodes"][number];

interface OutdoorStaticBvhRoot {
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly landblockId: number;
	readonly translation: readonly [number, number, number];
	readonly nodes: readonly BvhNode[];
	readonly items: readonly (OutdoorStaticBvhRuntimeItem | null)[];
}

interface OutdoorStaticBvhRuntimeItem {
	readonly bvhItemIndex: number;
	readonly kind: "static" | "building";
	readonly object: StaticObjectInstanceFacts;
}

interface EnvCellBvhRoot {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly items: readonly EnvCellBvhRuntimeItem[];
}

interface TerrainBvhRoot {
	readonly landblockId: number;
	readonly translation: readonly [number, number, number];
	readonly nodes: readonly BvhNode[];
	readonly items: readonly (TerrainBvhRuntimeItem | null)[];
}

interface TerrainBvhRuntimeItem {
	readonly bvhItemIndex: number;
	readonly quad: TerrainMeshQuadFacts;
}

interface OutdoorSourceDiagnosticsRoot {
	readonly objectsByInstanceId: ReadonlyMap<
		string,
		OutdoorStaticObjectSourceDiagnostics
	>;
}

interface EnvCellLandblockBvhRoot {
	readonly acceptedEnvCellIds: readonly number[];
	readonly cellsByEnvCellId: ReadonlyMap<number, EnvCellBvhRoot>;
	readonly items: readonly (EnvCellLandblockBvhRuntimeItem | null)[];
	readonly landblockId: number;
	readonly nodes: readonly BvhNode[];
	readonly translation: readonly [number, number, number];
}

interface EnvCellLandblockBvhRuntimeItem {
	readonly bounds: StaticBounds;
	readonly envCellId: number;
	readonly memberId: string;
	readonly source: "env-cell-root" | "derived";
}

interface LandblockSpatialBucket {
	readonly envCellRoot: EnvCellLandblockBvhRoot | null;
	readonly landblockId: number;
	readonly outdoorRootsByDomain: ReadonlyMap<
		OutdoorStaticObjectsScopePayload["domain"],
		OutdoorStaticBvhRoot
	>;
	readonly terrainRoot: TerrainBvhRoot | null;
}

interface LandblockSpatialCandidate {
	readonly distance: number;
	readonly envCellRoot: EnvCellLandblockBvhRoot | null;
	readonly landblockId: number;
	readonly outdoorRoots: readonly OutdoorStaticBvhRoot[];
	readonly terrainRoot: TerrainBvhRoot | null;
}

export interface LandblockGridRayBounds {
	readonly maxCellX: number;
	readonly maxCellZ: number;
	readonly minCellX: number;
	readonly minCellZ: number;
}

export interface LandblockGridRayCell {
	readonly cellX: number;
	readonly cellZ: number;
	readonly distance: number;
}

export interface LandblockGridRayTraceOptions {
	readonly cellSize?: number;
	readonly getMaxDistance?: () => number | null;
}

type EnvCellBvhRuntimeItem = {
	readonly kind: "static";
	readonly seed: EnvCellStaticSeedRuntimeRecord;
};

interface EnvCellStaticSeedRuntimeRecord {
	readonly envCellId: number;
	readonly seed: LandblockEnvCellsStaticScopePayload["envCells"][number]["staticObjectSeeds"][number];
}

export interface StaticSceneCommittedEnvCellRecords {
	readonly authoredDynamicSeeds: readonly StaticAuthoredDynamicSeedRecord[];
	readonly landblockId: number;
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly sourceMappings: readonly StaticSourceMappingRecord[];
	readonly spatialRecords: readonly StaticSpatialRecord[];
	readonly visibilityRecords: readonly StaticVisibilityRecord[];
}

interface CommittedRecordEntry<TRecord> {
	readonly ownerKey: string;
	readonly record: TRecord;
}

interface CachedEnvCellPortalProjection {
	readonly projection: StaticPortalProjectionRecord | null;
	readonly sourceKey: string;
}

class LandblockGridSpatialIndex {
	#outdoorAnchorLandblockId: number | null = null;
	readonly #bucketsByLandblockId = new Map<number, LandblockSpatialBucket>();
	readonly #bucketsByRenderCell = new Map<string, LandblockSpatialBucket[]>();

	get bucketCount(): number {
		return this.#bucketsByLandblockId.size;
	}

	setOutdoorAnchorLandblockId(outdoorAnchorLandblockId: number | null): void {
		if (this.#outdoorAnchorLandblockId === outdoorAnchorLandblockId) {
			return;
		}

		this.#outdoorAnchorLandblockId = outdoorAnchorLandblockId;
		this.#rebuildRenderCellIndex();
	}

	upsertTerrainRoot(root: TerrainBvhRoot): void {
		const bucket = this.#getOrCreateBucket(root.landblockId);
		this.#setBucket(root.landblockId, {
			...bucket,
			terrainRoot: root,
		});
	}

	deleteTerrainRoot(landblockId: number): void {
		const bucket = this.#bucketsByLandblockId.get(landblockId);
		if (!bucket) {
			return;
		}

		this.#setOrDeleteBucket({
			...bucket,
			terrainRoot: null,
		});
	}

	upsertOutdoorRoot(root: OutdoorStaticBvhRoot): void {
		const bucket = this.#getOrCreateBucket(root.landblockId);
		const outdoorRootsByDomain = new Map(bucket.outdoorRootsByDomain);
		outdoorRootsByDomain.set(root.domain, root);
		this.#setBucket(root.landblockId, {
			...bucket,
			outdoorRootsByDomain,
		});
	}

	deleteOutdoorRoot(
		domain: OutdoorStaticObjectsScopePayload["domain"],
		landblockId: number,
	): void {
		const bucket = this.#bucketsByLandblockId.get(landblockId);
		if (!bucket) {
			return;
		}

		const outdoorRootsByDomain = new Map(bucket.outdoorRootsByDomain);
		outdoorRootsByDomain.delete(domain);
		this.#setOrDeleteBucket({
			...bucket,
			outdoorRootsByDomain,
		});
	}

	upsertEnvCellRoot(root: EnvCellLandblockBvhRoot): void {
		const bucket = this.#getOrCreateBucket(root.landblockId);
		this.#setBucket(root.landblockId, {
			...bucket,
			envCellRoot: root,
		});
	}

	deleteEnvCellRoot(landblockId: number): void {
		const bucket = this.#bucketsByLandblockId.get(landblockId);
		if (!bucket) {
			return;
		}

		this.#setOrDeleteBucket({
			...bucket,
			envCellRoot: null,
		});
	}

	*traceOutdoorRay(
		ray: StaticSceneRay,
		options: {
			readonly getMaxDistance: () => number | null;
		},
	): Iterable<LandblockSpatialCandidate> {
		if (this.#outdoorAnchorLandblockId === null) {
			for (const bucket of [...this.#bucketsByLandblockId.values()].sort(
				compareLandblockSpatialBuckets,
			)) {
				const candidate = createLandblockSpatialCandidate(bucket, 0);
				if (candidate) {
					yield candidate;
				}
			}
			return;
		}

		const bounds = this.#createRenderCellBounds();
		if (!bounds) {
			return;
		}

		const visitedLandblockIds = new Set<number>();
		for (const cell of traceLandblockGridRayCells(ray, bounds, {
			cellSize: OUTDOOR_LANDBLOCK_WORLD_SIZE,
			getMaxDistance: options.getMaxDistance,
		})) {
			const buckets = this.#bucketsByRenderCell.get(
				createRenderCellKey(cell.cellX, cell.cellZ),
			);
			if (!buckets) {
				continue;
			}
			for (const bucket of buckets) {
				if (visitedLandblockIds.has(bucket.landblockId)) {
					continue;
				}
				visitedLandblockIds.add(bucket.landblockId);
				const candidateDistance = estimateLandblockSpatialCandidateDistance(
					ray,
					bucket,
				);
				const maxDistance = options.getMaxDistance();
				if (
					candidateDistance === null ||
					(maxDistance !== null && candidateDistance > maxDistance)
				) {
					continue;
				}
				const candidate = createLandblockSpatialCandidate(
					bucket,
					candidateDistance,
				);
				if (candidate) {
					yield candidate;
				}
			}
		}
	}

	clear(): void {
		this.#outdoorAnchorLandblockId = null;
		this.#bucketsByLandblockId.clear();
		this.#bucketsByRenderCell.clear();
	}

	#createRenderCellBounds(): LandblockGridRayBounds | null {
		if (this.#bucketsByRenderCell.size === 0) {
			return null;
		}

		let minCellX = Number.POSITIVE_INFINITY;
		let minCellZ = Number.POSITIVE_INFINITY;
		let maxCellX = Number.NEGATIVE_INFINITY;
		let maxCellZ = Number.NEGATIVE_INFINITY;

		for (const key of this.#bucketsByRenderCell.keys()) {
			const cell = parseRenderCellKey(key);
			minCellX = Math.min(minCellX, cell.cellX);
			minCellZ = Math.min(minCellZ, cell.cellZ);
			maxCellX = Math.max(maxCellX, cell.cellX);
			maxCellZ = Math.max(maxCellZ, cell.cellZ);
		}

		return { maxCellX, maxCellZ, minCellX, minCellZ };
	}

	#getOrCreateBucket(landblockId: number): LandblockSpatialBucket {
		return (
			this.#bucketsByLandblockId.get(landblockId) ?? {
				envCellRoot: null,
				landblockId,
				outdoorRootsByDomain: new Map(),
				terrainRoot: null,
			}
		);
	}

	#setOrDeleteBucket(bucket: LandblockSpatialBucket): void {
		if (
			bucket.envCellRoot === null &&
			bucket.outdoorRootsByDomain.size === 0 &&
			bucket.terrainRoot === null
		) {
			this.#bucketsByLandblockId.delete(bucket.landblockId);
			this.#rebuildRenderCellIndex();
			return;
		}

		this.#setBucket(bucket.landblockId, bucket);
	}

	#setBucket(landblockId: number, bucket: LandblockSpatialBucket): void {
		this.#bucketsByLandblockId.set(landblockId, bucket);
		this.#rebuildRenderCellIndex();
	}

	#rebuildRenderCellIndex(): void {
		this.#bucketsByRenderCell.clear();
		if (this.#outdoorAnchorLandblockId === null) {
			return;
		}

		for (const bucket of this.#bucketsByLandblockId.values()) {
			for (const cellKey of createBucketRenderCellKeys(
				bucket,
				this.#outdoorAnchorLandblockId,
			)) {
				const buckets = this.#bucketsByRenderCell.get(cellKey) ?? [];
				buckets.push(bucket);
				this.#bucketsByRenderCell.set(cellKey, buckets);
			}
		}
	}
}

export class StaticSceneQuery {
	#outdoorAnchorLandblockId: number | null = null;
	readonly #landblockGridIndex = new LandblockGridSpatialIndex();
	readonly #terrainBvhRootsByLandblockId = new Map<number, TerrainBvhRoot>();
	readonly #outdoorBvhRootsByDomainAndLandblock = new Map<
		string,
		OutdoorStaticBvhRoot
	>();
	readonly #outdoorSourceDiagnosticsByDomainAndLandblock = new Map<
		string,
		OutdoorSourceDiagnosticsRoot
	>();
	readonly #envCellRootsByLandblockId = new Map<
		number,
		EnvCellLandblockBvhRoot
	>();
	readonly #envCellStaticBoundsOverridesByKey = new Map<
		string,
		{
			readonly bounds: StaticBounds;
		}
	>();
	readonly #committedSpatialRecordsByKey = new Map<
		string,
		CommittedRecordEntry<StaticSpatialRecord>
	>();
	readonly #committedVisibilityRecordsByKey = new Map<
		string,
		CommittedRecordEntry<StaticVisibilityRecord>
	>();
	readonly #committedPortalInteriorRecordsByKey = new Map<
		string,
		CommittedRecordEntry<StaticPortalInteriorRecord>
	>();
	readonly #committedPortalGraphsByKey = new Map<
		string,
		CommittedRecordEntry<StaticPortalGraphRecord>
	>();
	readonly #committedSourceMappingsByKey = new Map<
		string,
		CommittedRecordEntry<StaticSourceMappingRecord>
	>();
	readonly #committedAuthoredDynamicSeedRecordsByKey = new Map<
		string,
		CommittedRecordEntry<StaticAuthoredDynamicSeedRecord>
	>();
	readonly #envCellPortalProjectionCacheByRootKey = new Map<
		string,
		CachedEnvCellPortalProjection
	>();
	readonly #envCellSystemLayersByLandblockId = new Map<
		number,
		EnvCellSystemLayerPayload
	>();

	ingestSourcePayload(
		payload: StaticScopePayload,
		options: StaticSceneQuerySourcePayloadOptions = {},
	): void {
		if (payload.scope.kind === "terrain") {
			this.ingestTerrain(
				payload.scope,
				options.outdoorAnchorLandblockId ?? null,
			);
			return;
		}

		if (payload.scope.kind === "outdoor-static-objects") {
			this.ingestOutdoorStaticObjects(
				payload.scope,
				options.outdoorAnchorLandblockId ?? null,
			);
			return;
		}

		if (payload.scope.kind === "landblock-env-cells") {
			this.ingestLandblockEnvCells(payload.scope);
		}
	}

	setOutdoorAnchorLandblockId(outdoorAnchorLandblockId: number | null): void {
		this.#setOutdoorAnchorLandblockId(outdoorAnchorLandblockId);
	}

	retainScopes(scopes: readonly StaticScopeOwnerKey[]): void {
		const terrainLandblockIds = new Set(
			scopes
				.filter((scope) => scope.domain === "outdoor-terrain")
				.map((scope) => scope.scope.landblockId),
		);
		const outdoorRootKeys = new Set(
			scopes
				.filter(
					(
						scope,
					): scope is StaticScopeOwnerKey & {
						readonly domain: OutdoorStaticObjectsScopePayload["domain"];
					} =>
						scope.domain === "outdoor-buildings" ||
						scope.domain === "outdoor-detail",
				)
				.map((scope) =>
					createOutdoorRootKey(scope.domain, scope.scope.landblockId),
				),
		);
		const envCellLandblockIds = new Set(
			scopes
				.filter((scope) => scope.domain === "landblock-env-cells")
				.map((scope) => scope.scope.landblockId),
		);

		for (const landblockId of this.#terrainBvhRootsByLandblockId.keys()) {
			if (!terrainLandblockIds.has(landblockId)) {
				this.#terrainBvhRootsByLandblockId.delete(landblockId);
			}
		}
		for (const key of this.#outdoorBvhRootsByDomainAndLandblock.keys()) {
			if (!outdoorRootKeys.has(key)) {
				this.#outdoorBvhRootsByDomainAndLandblock.delete(key);
			}
		}
		for (const key of this.#outdoorSourceDiagnosticsByDomainAndLandblock.keys()) {
			if (!outdoorRootKeys.has(key)) {
				this.#outdoorSourceDiagnosticsByDomainAndLandblock.delete(key);
			}
		}
		for (const landblockId of this.#envCellRootsByLandblockId.keys()) {
			if (!envCellLandblockIds.has(landblockId)) {
				this.#envCellRootsByLandblockId.delete(landblockId);
			}
		}
		for (const key of this.#envCellStaticBoundsOverridesByKey.keys()) {
			const landblockId = parseEnvCellStaticObjectBoundsKeyLandblockId(key);
			if (landblockId !== null && !envCellLandblockIds.has(landblockId)) {
				this.#envCellStaticBoundsOverridesByKey.delete(key);
			}
		}
		this.#pruneCommittedRecordsByRetainedScopes(scopes);
		this.#rebuildCommittedEnvCellRoots();
	}

	applyStaticSpatialRecords(options: {
		readonly records: readonly StaticSpatialRecord[];
	}): void {
		this.applyStaticPeerRecords({
			spatialRecords: options.records,
		});
	}

	removeStaticResources(resources: readonly StaticResourceKey[]): void {
		const removedDrawUnitResourceIds = new Set(
			resources.flatMap((resource) =>
				resource.kind === "draw-unit" ? [resource.drawUnitId] : [],
			),
		);
		if (removedDrawUnitResourceIds.size > 0) {
			this.#deleteDrawUnitOwnedCommittedRecords(removedDrawUnitResourceIds);
		}
	}

	hasCommittedPortalInteriorScene(options: {
		readonly landblockId: number;
	}): boolean {
		for (const entry of this.#committedPortalGraphsByKey.values()) {
			if (entry.record.landblockId === options.landblockId) {
				return true;
			}
		}
		for (const entry of this.#committedPortalInteriorRecordsByKey.values()) {
			if (entry.record.landblockId === options.landblockId) {
				return true;
			}
		}
		return false;
	}

	applyStaticPeerRecords(options: {
		readonly authoredDynamicSeeds?: readonly StaticAuthoredDynamicSeedRecord[];
		readonly portalGraphs?: readonly StaticPortalGraphRecord[];
		readonly portalInteriorRecords?: readonly StaticPortalInteriorRecord[];
		readonly sourceMappings?: readonly StaticSourceMappingRecord[];
		readonly spatialRecords?: readonly StaticSpatialRecord[];
		readonly visibilityRecords?: readonly StaticVisibilityRecord[];
	}): void {
		this.#upsertCommittedSpatialRecords(options.spatialRecords ?? []);
		this.#upsertCommittedVisibilityRecords(options.visibilityRecords ?? []);
		this.#upsertCommittedPortalInteriorRecords(
			options.portalInteriorRecords ?? [],
		);
		this.#upsertCommittedPortalGraphs(options.portalGraphs ?? []);
		this.#upsertCommittedSourceMappings(options.sourceMappings ?? []);
		this.#upsertCommittedAuthoredDynamicSeedRecords(
			options.authoredDynamicSeeds ?? [],
		);
		this.#rebuildCommittedEnvCellRoots();
	}

	setEnvCellSystemLayer(payload: EnvCellSystemLayerPayload | null): void {
		if (!payload) {
			return;
		}
		const landblockId = payload.landblockId >>> 0;
		this.#clearEnvCellSystemLayerRecords(landblockId);
		this.#envCellSystemLayersByLandblockId.set(landblockId, payload);
		this.applyStaticPeerRecords({
			authoredDynamicSeeds: payload.authoredDynamicSeedRecords,
			portalGraphs: payload.portalGraphRecords,
			portalInteriorRecords: payload.portalInteriorRecords,
			sourceMappings: payload.sourceMappingRecords,
			spatialRecords: payload.spatialRecords,
			visibilityRecords: payload.visibilityRecords,
		});
		this.#invalidateEnvCellPortalProjectionsForLandblock(landblockId);
	}

	clearEnvCellSystemLayer(landblockId: number): void {
		const normalizedLandblockId = landblockId >>> 0;
		this.#clearEnvCellSystemLayerRecords(normalizedLandblockId);
		this.#rebuildCommittedEnvCellRoots();
		this.#invalidateEnvCellPortalProjectionsForLandblock(normalizedLandblockId);
	}

	queryEnvCellSystemLayers(): readonly EnvCellSystemLayerPayload[] {
		return [...this.#envCellSystemLayersByLandblockId.values()].sort(
			(left, right) => left.landblockId - right.landblockId,
		);
	}

	ingestTerrain(
		payload: TerrainStaticScopePayload,
		outdoorAnchorLandblockId: number | null = null,
	): void {
		this.#setOutdoorAnchorLandblockId(outdoorAnchorLandblockId);
		const landblockId = payload.landblock.landblockId;
		const bvh = payload.sourceSpatial.terrainBvh;
		if (bvh.nodes.length === 0) {
			this.#terrainBvhRootsByLandblockId.delete(landblockId);
			this.#landblockGridIndex.deleteTerrainRoot(landblockId);
			return;
		}

		const quadsByIndex = new Map(
			payload.mesh.quads.map((quad) => [quad.quadIndex, quad] as const),
		);
		const items = bvh.items.map(
			(item, bvhItemIndex): TerrainBvhRuntimeItem | null => {
				const quad = quadsByIndex.get(item.quadIndex);
				if (!quad) {
					return null;
				}

				return {
					bvhItemIndex,
					quad,
				};
			},
		);

		const root = {
			items,
			landblockId,
			nodes: bvh.nodes,
			translation: createOutdoorLandblockRootTranslation(
				landblockId,
				this.#outdoorAnchorLandblockId,
			),
		};
		this.#terrainBvhRootsByLandblockId.set(landblockId, root);
		this.#landblockGridIndex.upsertTerrainRoot(root);
	}

	ingestOutdoorStaticObjects(
		payload: OutdoorStaticObjectsScopePayload,
		outdoorAnchorLandblockId: number | null = null,
	): void {
		this.#setOutdoorAnchorLandblockId(outdoorAnchorLandblockId);
		const rootKey = createOutdoorRootKey(
			payload.domain,
			payload.landblock.landblockId,
		);
		this.#outdoorSourceDiagnosticsByDomainAndLandblock.set(
			rootKey,
			createOutdoorSourceDiagnosticsRoot(payload),
		);
		const bvh = payload.sourceSpatial.outdoorBvh;
		if (!bvh || bvh.nodes.length === 0) {
			this.#outdoorBvhRootsByDomainAndLandblock.delete(rootKey);
			this.#landblockGridIndex.deleteOutdoorRoot(
				payload.domain,
				payload.landblock.landblockId,
			);
			return;
		}

		const items = bvh.items.map((item): OutdoorStaticBvhRuntimeItem | null =>
			item.object
				? {
						bvhItemIndex: item.bvhItemIndex,
						kind: item.kind,
						object: item.object,
					}
				: null,
		);
		const root = {
			domain: payload.domain,
			items,
			landblockId: payload.landblock.landblockId,
			nodes: bvh.nodes,
			translation: createOutdoorLandblockRootTranslation(
				payload.landblock.landblockId,
				this.#outdoorAnchorLandblockId,
			),
		};
		this.#outdoorBvhRootsByDomainAndLandblock.set(rootKey, root);
		this.#landblockGridIndex.upsertOutdoorRoot(root);
	}

	ingestLandblockEnvCells(payload: LandblockEnvCellsStaticScopePayload): void {
		void payload;
	}

	pickRay(request: StaticScenePickRequest): StaticScenePickHit | null {
		const ray = normalizeRay(request.ray);
		const hits =
			request.context.kind === "outdoor"
				? this.#pickOutdoorScene(ray, request)
				: this.#pickEnvCell(ray, request);

		return hits.sort(comparePickHits)[0] ?? null;
	}

	queryOutdoorStaticObjectDetails(options: {
		readonly domain: OutdoorStaticObjectsScopePayload["domain"];
		readonly landblockId: number;
		readonly instanceId: string;
	}): OutdoorStaticObjectScenePickDetails | null {
		const root = this.#outdoorBvhRootsByDomainAndLandblock.get(
			createOutdoorRootKey(options.domain, options.landblockId),
		);
		if (!root) {
			return null;
		}

		for (const item of root.items) {
			if (item?.object.identity.instanceId === options.instanceId) {
				return {
					bvhItemIndex: item.bvhItemIndex,
					bvhItemKind: item.kind,
					domain: root.domain,
					instanceId: options.instanceId,
					landblockId: root.landblockId,
					object: item.object,
				};
			}
		}

		return null;
	}

	queryOutdoorStaticObjectSourceDiagnostics(options: {
		readonly domain: OutdoorStaticObjectsScopePayload["domain"];
		readonly landblockId: number;
		readonly instanceId: string;
	}): OutdoorStaticObjectSourceDiagnostics | null {
		const root = this.#outdoorSourceDiagnosticsByDomainAndLandblock.get(
			createOutdoorRootKey(options.domain, options.landblockId),
		);
		if (!root) {
			return null;
		}

		return root.objectsByInstanceId.get(options.instanceId) ?? null;
	}

	queryEnvCellStaticObjectDetails(options: {
		readonly landblockId: number;
		readonly envCellId: number;
		readonly instanceId: string;
	}): EnvCellStaticScenePickDetails | null {
		const landblockRoot = this.#envCellRootsByLandblockId.get(
			options.landblockId,
		);
		const root = landblockRoot?.cellsByEnvCellId.get(options.envCellId);
		if (!root) {
			return null;
		}

		for (const item of root.items) {
			if (
				item.kind === "static" &&
				item.seed.seed.identity.instanceId === options.instanceId
			) {
				return {
					envCellId: options.envCellId,
					instanceId: options.instanceId,
					landblockId: options.landblockId,
					seed: item.seed.seed,
				};
			}
		}

		return null;
	}

	queryPortalInteriorRecords(
		options: {
			readonly landblockId?: number;
		} = {},
	): readonly StaticPortalInteriorRecord[] {
		return [...this.#committedPortalInteriorRecordsByKey.values()]
			.map((entry) => entry.record)
			.filter(
				(record) =>
					options.landblockId === undefined ||
					record.landblockId === options.landblockId,
			)
			.sort((left, right) => left.landblockId - right.landblockId);
	}

	queryPortalGraphs(
		options: {
			readonly landblockId?: number;
		} = {},
	): readonly StaticPortalGraphRecord[] {
		return [...this.#committedPortalGraphsByKey.values()]
			.map((entry) => entry.record)
			.filter(
				(record) =>
					options.landblockId === undefined ||
					record.landblockId === options.landblockId,
			)
			.sort((left, right) => left.landblockId - right.landblockId);
	}

	queryOutdoorPortalProjection(options: {
		readonly landblockId: number;
	}): StaticPortalProjectionRecord | null {
		const landblockId = options.landblockId >>> 0;
		return (
			this.#envCellSystemLayersByLandblockId
				.get(landblockId)
				?.portalProjectionRecords.find(
					(projection) => projection.root.kind === "outdoor-root",
				) ?? null
		);
	}

	queryRetainedOutdoorSourceLandblocks(): readonly RetainedOutdoorSourceLandblock[] {
		const landblockIds = new Set<number>();
		for (const landblockId of this.#terrainBvhRootsByLandblockId.keys()) {
			landblockIds.add(landblockId);
		}
		for (const root of this.#outdoorBvhRootsByDomainAndLandblock.values()) {
			landblockIds.add(root.landblockId);
		}
		for (const key of this.#outdoorSourceDiagnosticsByDomainAndLandblock.keys()) {
			const landblockId = parseOutdoorRootKeyLandblockId(key);
			if (landblockId !== null) {
				landblockIds.add(landblockId);
			}
		}
		for (const landblockId of this.#envCellSystemLayersByLandblockId.keys()) {
			landblockIds.add(landblockId);
		}

		return [...landblockIds]
			.sort((left, right) => left - right)
			.map((landblockId) => ({
				domains: {
					buildings: this.#hasRetainedOutdoorStaticDomain(
						"outdoor-buildings",
						landblockId,
					),
					detail: this.#hasRetainedOutdoorStaticDomain(
						"outdoor-detail",
						landblockId,
					),
					envCells: this.#envCellSystemLayersByLandblockId.has(landblockId),
					terrain: this.#terrainBvhRootsByLandblockId.has(landblockId),
				},
				landblockId,
			}));
	}

	queryRetainedOutdoorPortalProjections(
		landblockIds: readonly number[],
	): readonly StaticPortalProjectionRecord[] {
		const uniqueLandblockIds = [...new Set(landblockIds.map((id) => id >>> 0))];
		return uniqueLandblockIds
			.map((landblockId) => this.queryOutdoorPortalProjection({ landblockId }))
			.filter(
				(
					projection,
				): projection is StaticPortalProjectionRecord => projection !== null,
			)
			.sort((left, right) => left.landblockId - right.landblockId);
	}

	queryEnvCellPortalProjection(options: {
		readonly landblockId: number;
		readonly startEnvCellId: number;
	}): StaticPortalProjectionRecord | null {
		const landblockId = options.landblockId >>> 0;
		const startEnvCellId = options.startEnvCellId >>> 0;
		const portalGraphs = this.queryPortalGraphs({ landblockId });
		const portalInteriorRecords = this.queryPortalInteriorRecords({
			landblockId,
		});
		const portalApertureResources =
			this.#envCellSystemLayersByLandblockId.get(landblockId)
				?.portalApertureResources ?? [];
		const root = createEnvCellPortalProjectionRoot({
			envCellId: startEnvCellId,
			landblockId,
		});
		const sourceKey = createStaticPortalProjectionSourceKey({
			landblockId,
			portalApertureResources,
			portalGraphs,
			portalInteriorRecords,
			root,
		});
		const cacheKey = createEnvCellPortalProjectionCacheKey({
			landblockId,
			startEnvCellId,
		});
		const cached = this.#envCellPortalProjectionCacheByRootKey.get(cacheKey);
		if (cached?.sourceKey === sourceKey) {
			return cached.projection;
		}
		const projection = createStaticPortalProjection({
			landblockId,
			portalApertureResources,
			portalGraphs,
			portalInteriorRecords,
			root,
		});
		this.#envCellPortalProjectionCacheByRootKey.set(cacheKey, {
			projection,
			sourceKey,
		});
		return projection;
	}

	#hasRetainedOutdoorStaticDomain(
		domain: OutdoorStaticObjectsScopePayload["domain"],
		landblockId: number,
	): boolean {
		const key = createOutdoorRootKey(domain, landblockId);
		return (
			this.#outdoorBvhRootsByDomainAndLandblock.has(key) ||
			this.#outdoorSourceDiagnosticsByDomainAndLandblock.has(key)
		);
	}

	queryTerrainQuadDetails(options: {
		readonly landblockId: number;
		readonly quadIndex: number;
	}): TerrainQuadScenePickDetails | null {
		const root = this.#terrainBvhRootsByLandblockId.get(options.landblockId);
		if (!root) {
			return null;
		}

		for (const item of root.items) {
			if (item?.quad.quadIndex === options.quadIndex) {
				return {
					bvhItemIndex: item.bvhItemIndex,
					landblockId: root.landblockId,
					quad: item.quad,
				};
			}
		}

		return null;
	}

	queryTerrainLandblockBounds(options: {
		readonly landblockId: number;
	}): StaticSceneTerrainLandblockBounds | null {
		const root = this.#terrainBvhRootsByLandblockId.get(options.landblockId);
		const rootBounds = root?.nodes[0]?.bounds;
		if (!root || !rootBounds) {
			return null;
		}

		return {
			bounds: translateBounds(rootBounds, root.translation),
			landblockId: root.landblockId,
		};
	}

	querySelectionDebugBounds(
		selectionKey: StaticSceneSelectionKey,
	): StaticSceneSelectionDebugBounds | null {
		if (selectionKey.itemKind === "outdoor-static-object") {
			const root = this.#outdoorBvhRootsByDomainAndLandblock.get(
				createOutdoorRootKey(selectionKey.domain, selectionKey.landblockId),
			);
			if (!root) {
				return null;
			}

			for (const item of root.items) {
				if (
					item?.object.identity.instanceId === selectionKey.instanceId &&
					item.object.instanceBounds
				) {
					return {
						bounds: translateBounds(
							item.object.instanceBounds,
							root.translation,
						),
						selectionKey,
					};
				}
			}

			return null;
		}

		if (selectionKey.itemKind === "terrain-quad") {
			const root = this.#terrainBvhRootsByLandblockId.get(
				selectionKey.landblockId,
			);
			if (!root) {
				return null;
			}

			for (const item of root.items) {
				if (item?.quad.quadIndex === selectionKey.quadIndex) {
					return {
						bounds: translateBounds(item.quad.bounds, root.translation),
						selectionKey,
					};
				}
			}

			return null;
		}

		if (selectionKey.itemKind === "env-cell-portal") {
			return null;
		}

		const landblockRoot = this.#envCellRootsByLandblockId.get(
			selectionKey.landblockId,
		);
		const root = landblockRoot?.cellsByEnvCellId.get(selectionKey.envCellId);
		if (!root) {
			return null;
		}

		for (const item of root.items) {
			if (
				item.kind === "static" &&
				item.seed.seed.identity.instanceId === selectionKey.instanceId
			) {
				const bounds = this.#getEnvCellStaticSeedBounds(root, item.seed);
				if (!bounds) {
					return null;
				}
				return {
					bounds,
					selectionKey,
				};
			}
		}

		return null;
	}

	queryEnvCellAtPoint(options: {
		readonly acceptedEnvCellIds?: readonly number[];
		readonly landblockId: number;
		readonly point: Vec3;
	}): number | null {
		const root = this.#envCellRootsByLandblockId.get(options.landblockId);
		if (!root) {
			return null;
		}

		const acceptedEnvCellIds = new Set(
			options.acceptedEnvCellIds ?? root.acceptedEnvCellIds,
		);
		const candidates = traverseBvhPoint(root.nodes, options.point)
			.flatMap((candidate) =>
				candidate.itemIndices.map((itemIndex) => ({
					item: root.items[itemIndex],
					nodeIndex: candidate.nodeIndex,
				})),
			)
			.filter(
				(
					candidate,
				): candidate is {
					readonly item: EnvCellLandblockBvhRuntimeItem;
					readonly nodeIndex: number;
				} =>
					candidate.item !== null &&
					containsPoint(candidate.item.bounds, options.point) &&
					isAcceptedEnvCellId(acceptedEnvCellIds, candidate.item.envCellId),
			)
			.sort(
				(left, right) =>
					left.item.envCellId - right.item.envCellId ||
					left.nodeIndex - right.nodeIndex,
			);

		return candidates[0]?.item.envCellId ?? null;
	}

	queryEnvCellBounds(options: {
		readonly envCellId: number;
		readonly landblockId: number;
	}): StaticSceneEnvCellBounds | null {
		const root = this.#envCellRootsByLandblockId.get(options.landblockId);
		if (!root) {
			return null;
		}

		let bounds: StaticBounds | null = null;
		for (const item of root.items) {
			if (item === null || item.envCellId !== options.envCellId) {
				continue;
			}

			const renderBounds = translateBounds(item.bounds, root.translation);
			bounds = bounds ? unionBounds(bounds, renderBounds) : renderBounds;
		}

		return bounds
			? {
					bounds,
					envCellId: options.envCellId,
					landblockId: options.landblockId,
				}
			: null;
	}

	queryEnvCellAabbDebugBounds(options?: {
		readonly landblockId?: number | null;
	}): readonly StaticSceneEnvCellAabbDebugBounds[] {
		const requestedRoot =
			options?.landblockId === undefined || options.landblockId === null
				? null
				: this.#envCellRootsByLandblockId.get(options.landblockId);
		const roots =
			options?.landblockId === undefined || options.landblockId === null
				? [...this.#envCellRootsByLandblockId.values()]
				: requestedRoot
					? [requestedRoot]
					: [];
		const seenKeys = new Set<string>();
		const bounds: StaticSceneEnvCellAabbDebugBounds[] = [];
		for (const root of roots) {
			for (const item of root.items) {
				if (item === null) {
					continue;
				}
				const key = `${root.landblockId}:${item.envCellId}:${item.memberId}`;
				if (seenKeys.has(key)) {
					continue;
				}
				seenKeys.add(key);
				bounds.push({
					bounds: translateBounds(item.bounds, root.translation),
					envCellId: item.envCellId,
					landblockId: root.landblockId,
					memberId: item.memberId,
					source: item.source,
				});
			}
		}
		return bounds.sort(
			(left, right) =>
				left.landblockId - right.landblockId ||
				left.envCellId - right.envCellId ||
				left.memberId.localeCompare(right.memberId),
		);
	}

	queryCameraResidencyAtPoint(options: {
		readonly outdoorAnchorLandblockId: number;
		readonly point: Vec3;
	}): StaticSceneCameraResidency {
		const outdoorResidency = deriveOutdoorCameraLandblockResidency({
			anchorLandblockId: options.outdoorAnchorLandblockId,
			cameraPosition: [options.point.x, options.point.y, options.point.z],
		});
		if (!outdoorResidency) {
			return {
				kind: "unknown",
				landblockId: null,
			};
		}

		const landblockId = outdoorResidency.landblockId;
		if (this.#hasCommittedEnvCellRecords(landblockId)) {
			const envCellId = this.queryEnvCellAtPoint({
				acceptedEnvCellIds:
					this.#getCommittedAcceptedEnvCellIds(landblockId) ?? undefined,
				landblockId,
				point: {
					x: outdoorResidency.localCameraPosition[0],
					y: outdoorResidency.localCameraPosition[1],
					z: outdoorResidency.localCameraPosition[2],
				},
			});
			if (envCellId !== null) {
				return {
					envCellId,
					kind: "env-cell",
					landblockId,
				};
			}
		}

		return {
			kind: "outdoor-landblock",
			landblockId,
		};
	}

	queryCameraResidencyAtLandblockPoint(options: {
		readonly landblockId: number;
		readonly point: Vec3;
	}): StaticSceneCameraResidency {
		const landblockId = options.landblockId >>> 0;
		if (this.#hasCommittedEnvCellRecords(landblockId)) {
			const envCellId = this.queryEnvCellAtPoint({
				acceptedEnvCellIds:
					this.#getCommittedAcceptedEnvCellIds(landblockId) ?? undefined,
				landblockId,
				point: options.point,
			});
			if (envCellId !== null) {
				return {
					envCellId,
					kind: "env-cell",
					landblockId,
				};
			}
		}

		return {
			kind: "unknown",
			landblockId,
		};
	}

	queryCommittedEnvCellRecords(options: {
		readonly landblockId: number;
	}): StaticSceneCommittedEnvCellRecords | null {
		const portalInteriorRecords = collectCommittedRecordsByLandblock(
			this.#committedPortalInteriorRecordsByKey,
			options.landblockId,
		);
		const portalGraphs = collectCommittedRecordsByLandblock(
			this.#committedPortalGraphsByKey,
			options.landblockId,
		);
		const sourceMappings = collectCommittedRecordsByLandblock(
			this.#committedSourceMappingsByKey,
			options.landblockId,
		);
		const spatialRecords = collectCommittedRecordsByLandblock(
			this.#committedSpatialRecordsByKey,
			options.landblockId,
		);
		const visibilityRecords = collectCommittedRecordsByLandblock(
			this.#committedVisibilityRecordsByKey,
			options.landblockId,
		);
		const authoredDynamicSeeds = collectCommittedRecordsByLandblock(
			this.#committedAuthoredDynamicSeedRecordsByKey,
			options.landblockId,
		);

		if (
			authoredDynamicSeeds.length === 0 &&
			portalGraphs.length === 0 &&
			portalInteriorRecords.length === 0 &&
			sourceMappings.length === 0 &&
			spatialRecords.length === 0 &&
			visibilityRecords.length === 0
		) {
			return null;
		}

		return {
			authoredDynamicSeeds,
			landblockId: options.landblockId,
			portalGraphs,
			portalInteriorRecords,
			sourceMappings,
			spatialRecords,
			visibilityRecords,
		};
	}

	createSnapshot(): StaticSceneQuerySnapshot {
		let envCellRecordCount = 0;
		for (const root of this.#envCellRootsByLandblockId.values()) {
			for (const cellRoot of root.cellsByEnvCellId.values()) {
				envCellRecordCount += cellRoot.items.length;
			}
		}

		const outdoorBvhRecordCount = [
			...this.#outdoorBvhRootsByDomainAndLandblock.values(),
		].reduce((count, root) => count + root.items.filter(Boolean).length, 0);
		const terrainRecordCount = [
			...this.#terrainBvhRootsByLandblockId.values(),
		].reduce((count, root) => count + root.items.filter(Boolean).length, 0);

		return {
			landblockBucketCount: this.#landblockGridIndex.bucketCount,
			committedEnvCellLandblockCount: countCommittedEnvCellLandblocks([
				this.#committedSpatialRecordsByKey,
				this.#committedVisibilityRecordsByKey,
				this.#committedPortalInteriorRecordsByKey,
				this.#committedPortalGraphsByKey,
				this.#committedSourceMappingsByKey,
				this.#committedAuthoredDynamicSeedRecordsByKey,
			]),
			committedEnvCellPortalGraphRecordCount:
				this.#committedPortalGraphsByKey.size,
			committedEnvCellPortalInteriorRecordCount:
				this.#committedPortalInteriorRecordsByKey.size,
			committedEnvCellSourceMappingRecordCount:
				this.#committedSourceMappingsByKey.size,
			committedEnvCellSpatialRecordCount:
				this.#committedSpatialRecordsByKey.size,
			committedEnvCellVisibilityRecordCount:
				this.#committedVisibilityRecordsByKey.size,
			envCellLandblockCount: this.#envCellRootsByLandblockId.size,
			envCellRecordCount,
			outdoorRecordCount: outdoorBvhRecordCount,
			terrainLandblockCount: this.#terrainBvhRootsByLandblockId.size,
			terrainRecordCount,
		};
	}

	clear(): void {
		this.#outdoorAnchorLandblockId = null;
		this.#landblockGridIndex.clear();
		this.#terrainBvhRootsByLandblockId.clear();
		this.#outdoorBvhRootsByDomainAndLandblock.clear();
		this.#outdoorSourceDiagnosticsByDomainAndLandblock.clear();
		this.#envCellRootsByLandblockId.clear();
		this.#envCellStaticBoundsOverridesByKey.clear();
		this.#committedSpatialRecordsByKey.clear();
		this.#committedVisibilityRecordsByKey.clear();
		this.#committedPortalInteriorRecordsByKey.clear();
		this.#committedPortalGraphsByKey.clear();
		this.#committedSourceMappingsByKey.clear();
		this.#committedAuthoredDynamicSeedRecordsByKey.clear();
		this.#envCellPortalProjectionCacheByRootKey.clear();
	}

	#upsertCommittedSpatialRecords(
		records: readonly StaticSpatialRecord[],
	): void {
		const replacementKeys = new Set(
			records.map(createCommittedSpatialRecordKey),
		);
		const completeScopeOwnerKeys = new Set(
			records
				.filter((record) => record.kind === "env-cell-spatial")
				.map((record) => createStaticPeerOwnerKey(record.owner)),
		);
		for (const [key, entry] of this.#committedSpatialRecordsByKey) {
			if (
				replacementKeys.has(key) ||
				completeScopeOwnerKeys.has(entry.ownerKey)
			) {
				this.#committedSpatialRecordsByKey.delete(key);
			}
		}

		for (const record of records) {
			this.#committedSpatialRecordsByKey.set(
				createCommittedSpatialRecordKey(record),
				{
					ownerKey: createStaticPeerOwnerKey(record.owner),
					record,
				},
			);
			if (record.kind !== "env-cell-static-object-bounds") {
				continue;
			}
			this.#envCellStaticBoundsOverridesByKey.set(
				createEnvCellStaticObjectBoundsKey({
					envCellId: record.envCellId,
					instanceId: record.instanceId,
					landblockId: record.landblockId,
				}),
				{
					bounds: record.bounds,
				},
			);
		}
	}

	#upsertCommittedVisibilityRecords(
		records: readonly StaticVisibilityRecord[],
	): void {
		this.#deleteCommittedRecordsForOwners(
			this.#committedVisibilityRecordsByKey,
			records,
		);
		for (const record of records) {
			this.#committedVisibilityRecordsByKey.set(
				createCommittedVisibilityRecordKey(record),
				{
					ownerKey: createStaticPeerOwnerKey(record.owner),
					record,
				},
			);
		}
	}

	#upsertCommittedPortalInteriorRecords(
		records: readonly StaticPortalInteriorRecord[],
	): void {
		const affectedLandblockIds = this.#collectOwnerReplacementLandblockIds(
			this.#committedPortalInteriorRecordsByKey,
			records,
		);
		for (const record of records) {
			affectedLandblockIds.add(record.landblockId >>> 0);
			this.#committedPortalInteriorRecordsByKey.set(
				createCommittedPortalInteriorRecordKey(record),
				{
					ownerKey: createStaticPeerOwnerKey(record.owner),
					record,
				},
			);
		}
		this.#invalidateEnvCellPortalProjections(affectedLandblockIds);
	}

	#upsertCommittedPortalGraphs(
		records: readonly StaticPortalGraphRecord[],
	): void {
		const affectedLandblockIds = this.#collectOwnerReplacementLandblockIds(
			this.#committedPortalGraphsByKey,
			records,
		);
		for (const record of records) {
			affectedLandblockIds.add(record.landblockId >>> 0);
			this.#committedPortalGraphsByKey.set(
				createCommittedPortalGraphRecordKey(record),
				{
					ownerKey: createStaticPeerOwnerKey(record.owner),
					record,
				},
			);
		}
		this.#invalidateEnvCellPortalProjections(affectedLandblockIds);
	}

	#upsertCommittedSourceMappings(
		records: readonly StaticSourceMappingRecord[],
	): void {
		this.#deleteCommittedRecordsForOwners(
			this.#committedSourceMappingsByKey,
			records,
		);
		for (const record of records) {
			this.#committedSourceMappingsByKey.set(
				createCommittedSourceMappingRecordKey(record),
				{
					ownerKey: createStaticPeerOwnerKey(record.owner),
					record,
				},
			);
		}
	}

	#upsertCommittedAuthoredDynamicSeedRecords(
		records: readonly StaticAuthoredDynamicSeedRecord[],
	): void {
		this.#deleteCommittedRecordsForOwners(
			this.#committedAuthoredDynamicSeedRecordsByKey,
			records,
		);

		for (const record of records) {
			this.#committedAuthoredDynamicSeedRecordsByKey.set(
				createCommittedAuthoredDynamicSeedRecordKey(record),
				{
					ownerKey: createStaticPeerOwnerKey(record.owner),
					record,
				},
			);
		}
	}

	#rebuildCommittedEnvCellRoots(): void {
		const rootsByLandblock = new Map<number, EnvCellLandblockBvhRoot>();
		const spatialRecordsByLandblock = groupEnvCellSpatialRecordsByLandblock(
			this.#committedSpatialRecordsByKey,
		);
		const seedsByLandblockAndEnvCell = groupEnvCellSeedsByLandblockAndEnvCell(
			this.#committedAuthoredDynamicSeedRecordsByKey,
		);

		for (const [landblockId, spatialRecords] of spatialRecordsByLandblock) {
			const residencyBvh = spatialRecords[0]?.residencyBvh;
			if (!residencyBvh || residencyBvh.nodes.length === 0) {
				continue;
			}
			const spatialRecordsByEnvCellId = new Map(
				spatialRecords.map((record) => [record.envCellId, record]),
			);
			const cellsByEnvCellId = new Map<number, EnvCellBvhRoot>();
			for (const record of spatialRecords) {
				const seeds =
					seedsByLandblockAndEnvCell.get(landblockId)?.get(record.envCellId) ??
					[];
				cellsByEnvCellId.set(record.envCellId, {
					envCellId: record.envCellId,
					items: seeds.map((seedRecord): EnvCellBvhRuntimeItem => {
						const seed = seedRecord.seed;
						return {
							kind: "static",
							seed: {
								envCellId: record.envCellId,
								seed,
							},
						};
					}),
					landblockId,
				});
			}
			const items = residencyBvh.items.map((item) =>
				spatialRecordsByEnvCellId.has(item.identity.envCellId)
					? {
							bounds: item.bounds,
							envCellId: item.identity.envCellId,
							memberId: item.memberId,
							source: item.source,
						}
					: null,
			);

			rootsByLandblock.set(landblockId, {
				acceptedEnvCellIds:
					this.#getCommittedAcceptedEnvCellIds(landblockId) ??
					spatialRecords.map((record) => record.envCellId),
				cellsByEnvCellId,
				items,
				landblockId,
				nodes: residencyBvh.nodes,
				translation: createOutdoorLandblockRootTranslation(
					landblockId,
					this.#outdoorAnchorLandblockId,
				),
			});
		}

		this.#envCellRootsByLandblockId.clear();
		for (const [landblockId, root] of rootsByLandblock) {
			this.#envCellRootsByLandblockId.set(landblockId, root);
		}
		this.#rebuildLandblockGridIndex();
	}

	#deleteCommittedRecordsForOwners<
		TRecord extends {
			readonly owner: {
				readonly kind: string;
				readonly drawUnitId?: string;
				readonly domain?: StaticDomain;
				readonly scopeKey?: string;
				readonly workId?: string;
			};
		},
	>(
		recordsByKey: Map<string, CommittedRecordEntry<TRecord>>,
		records: readonly TRecord[],
	): void {
		const ownerKeys = new Set(
			records.map((record) => createStaticPeerOwnerKey(record.owner)),
		);
		for (const [key, entry] of recordsByKey) {
			if (ownerKeys.has(entry.ownerKey)) {
				recordsByKey.delete(key);
			}
		}
	}

	#collectOwnerReplacementLandblockIds<
		TRecord extends {
			readonly landblockId: number;
			readonly owner: {
				readonly kind: string;
				readonly drawUnitId?: string;
				readonly domain?: StaticDomain;
				readonly scopeKey?: string;
				readonly workId?: string;
			};
		},
	>(
		recordsByKey: Map<string, CommittedRecordEntry<TRecord>>,
		records: readonly TRecord[],
	): Set<number> {
		const ownerKeys = new Set(
			records.map((record) => createStaticPeerOwnerKey(record.owner)),
		);
		const affectedLandblockIds = new Set<number>();
		for (const [key, entry] of recordsByKey) {
			if (!ownerKeys.has(entry.ownerKey)) {
				continue;
			}
			affectedLandblockIds.add(entry.record.landblockId >>> 0);
			recordsByKey.delete(key);
		}
		return affectedLandblockIds;
	}

	#deleteDrawUnitOwnedCommittedRecords(drawUnitIds: ReadonlySet<string>): void {
		const affectedPortalLandblockIds = new Set<number>();
		for (const recordsByKey of [
			this.#committedSpatialRecordsByKey,
			this.#committedVisibilityRecordsByKey,
			this.#committedPortalInteriorRecordsByKey,
			this.#committedPortalGraphsByKey,
			this.#committedSourceMappingsByKey,
			this.#committedAuthoredDynamicSeedRecordsByKey,
		]) {
			for (const [key, entry] of recordsByKey) {
				const owner = entry.record.owner;
				if (owner.kind === "draw-unit" && drawUnitIds.has(owner.drawUnitId)) {
					if (
						recordsByKey === this.#committedPortalInteriorRecordsByKey ||
						recordsByKey === this.#committedPortalGraphsByKey
					) {
						affectedPortalLandblockIds.add(
							getCommittedRecordLandblockId(entry.record) ?? 0,
						);
					}
					recordsByKey.delete(key);
				}
			}
		}
		this.#invalidateEnvCellPortalProjections(affectedPortalLandblockIds);
	}

	#clearEnvCellSystemLayerRecords(landblockId: number): void {
		const normalizedLandblockId = landblockId >>> 0;
		this.#envCellSystemLayersByLandblockId.delete(normalizedLandblockId);
		for (const recordsByKey of [
			this.#committedSpatialRecordsByKey,
			this.#committedVisibilityRecordsByKey,
			this.#committedPortalInteriorRecordsByKey,
			this.#committedPortalGraphsByKey,
			this.#committedSourceMappingsByKey,
			this.#committedAuthoredDynamicSeedRecordsByKey,
		]) {
			for (const [key, entry] of recordsByKey) {
				if (
					getCommittedRecordDomain(entry.record) === "landblock-env-cells" &&
					getCommittedRecordLandblockId(entry.record) === normalizedLandblockId
				) {
					recordsByKey.delete(key);
				}
			}
		}
		for (const key of this.#envCellStaticBoundsOverridesByKey.keys()) {
			if (
				parseEnvCellStaticObjectBoundsKeyLandblockId(key) ===
				normalizedLandblockId
			) {
				this.#envCellStaticBoundsOverridesByKey.delete(key);
			}
		}
	}

	#hasCommittedEnvCellRecords(landblockId: number): boolean {
		for (const recordsByKey of [
			this.#committedSpatialRecordsByKey,
			this.#committedVisibilityRecordsByKey,
			this.#committedPortalInteriorRecordsByKey,
			this.#committedPortalGraphsByKey,
			this.#committedSourceMappingsByKey,
		]) {
			for (const entry of recordsByKey.values()) {
				if (
					getCommittedRecordDomain(entry.record) === "landblock-env-cells" &&
					getCommittedRecordLandblockId(entry.record) === landblockId
				) {
					return true;
				}
			}
		}
		return false;
	}

	#getCommittedAcceptedEnvCellIds(
		landblockId: number,
	): readonly number[] | null {
		const acceptedEnvCellIds = new Set<number>();
		for (const entry of this.#committedVisibilityRecordsByKey.values()) {
			const record = entry.record;
			if (
				record.kind === "env-cell-visibility" &&
				record.landblockId === landblockId
			) {
				for (const envCellId of record.acceptedEnvCellIds) {
					acceptedEnvCellIds.add(envCellId);
				}
			}
		}
		return acceptedEnvCellIds.size > 0
			? [...acceptedEnvCellIds].sort((left, right) => left - right)
			: null;
	}

	#pruneCommittedRecordsByRetainedScopes(
		scopes: readonly StaticScopeOwnerKey[],
	): void {
		const retainedScopeKeys = new Set(
			scopes.map((scope) =>
				createRetainedScopeKey(scope.domain, scope.scope.landblockId),
			),
		);
		const affectedPortalLandblockIds = new Set<number>();
		for (const recordsByKey of [
			this.#committedSpatialRecordsByKey,
			this.#committedVisibilityRecordsByKey,
			this.#committedPortalInteriorRecordsByKey,
			this.#committedPortalGraphsByKey,
			this.#committedSourceMappingsByKey,
		]) {
			for (const [key, entry] of recordsByKey) {
				if (
					!retainedScopeKeys.has(
						createRetainedScopeKey(
							getCommittedRecordDomain(entry.record),
							getCommittedRecordLandblockId(entry.record),
						),
					)
				) {
					if (
						recordsByKey === this.#committedPortalInteriorRecordsByKey ||
						recordsByKey === this.#committedPortalGraphsByKey
					) {
						const landblockId = getCommittedRecordLandblockId(entry.record);
						if (landblockId !== null) {
							affectedPortalLandblockIds.add(landblockId >>> 0);
						}
					}
					recordsByKey.delete(key);
				}
			}
		}
		this.#invalidateEnvCellPortalProjections(affectedPortalLandblockIds);
	}

	#invalidateEnvCellPortalProjections(landblockIds: ReadonlySet<number>): void {
		for (const cacheKey of this.#envCellPortalProjectionCacheByRootKey.keys()) {
			const landblockId =
				parseEnvCellPortalProjectionCacheKeyLandblockId(cacheKey);
			if (landblockId !== null && landblockIds.has(landblockId)) {
				this.#envCellPortalProjectionCacheByRootKey.delete(cacheKey);
			}
		}
	}

	#invalidateEnvCellPortalProjectionsForLandblock(landblockId: number): void {
		this.#invalidateEnvCellPortalProjections(new Set([landblockId >>> 0]));
	}

	#pickOutdoorScene(
		ray: StaticSceneRay,
		request: StaticScenePickRequest,
	): StaticScenePickHit[] {
		let nearestHit: StaticScenePickHit | null = null;

		for (const candidate of this.#landblockGridIndex.traceOutdoorRay(ray, {
			getMaxDistance: () => nearestHit?.distance ?? null,
		})) {
			if (candidate.terrainRoot) {
				nearestHit = selectNearestHit(
					nearestHit,
					this.#pickTerrainRoot(
						ray,
						request,
						candidate.terrainRoot,
						nearestHit,
					),
				);
			}

			for (const root of candidate.outdoorRoots) {
				nearestHit = selectNearestHit(
					nearestHit,
					this.#pickOutdoorRoot(ray, request, root, nearestHit),
				);
			}

			if (candidate.envCellRoot) {
				const envCellHit = this.#pickEnvCellLandblockRoot(
					ray,
					request,
					candidate.envCellRoot,
					createAcceptedEnvCellSet(candidate.envCellRoot.acceptedEnvCellIds),
					nearestHit,
				);
				nearestHit = selectNearestHit(nearestHit, envCellHit);
			}
		}

		return nearestHit ? [nearestHit] : [];
	}

	#pickOutdoorRoot(
		ray: StaticSceneRay,
		request: StaticScenePickRequest,
		root: OutdoorStaticBvhRoot,
		currentNearestHit: StaticScenePickHit | null,
	): OutdoorStaticObjectScenePickHit | null {
		let nearestHit: OutdoorStaticObjectScenePickHit | null =
			isOutdoorStaticObjectScenePickHit(currentNearestHit)
				? currentNearestHit
				: null;
		const localRay = translateRay(ray, negateTranslation(root.translation));
		traverseBvhNearest(root.nodes, localRay, {
			getMaxDistance: () =>
				currentNearestHit === null
					? (nearestHit?.distance ?? null)
					: Math.min(
							currentNearestHit.distance,
							nearestHit?.distance ?? Number.POSITIVE_INFINITY,
						),
			visitCandidate: (candidate) => {
				for (const itemIndex of candidate.itemIndices) {
					const item = root.items[itemIndex];
					if (!item?.object.instanceBounds) {
						continue;
					}

					const distance = intersectRayBounds(
						localRay,
						item.object.instanceBounds,
					);
					if (distance === null) {
						continue;
					}

					const hit: OutdoorStaticObjectScenePickHit = {
						bounds: translateBounds(
							item.object.instanceBounds,
							root.translation,
						),
						distance,
						hitPoint: pointOnRay(ray, distance),
						kind: "static-scene-pick-hit",
						selectionKey: createOutdoorStaticObjectSelectionKey({
							domain: root.domain,
							instanceId: item.object.identity.instanceId,
							landblockId: root.landblockId,
						}),
					};
					if (matchesFilters(hit, request.filters, ray.origin)) {
						nearestHit =
							nearestHit === null || comparePickHits(hit, nearestHit) < 0
								? hit
								: nearestHit;
					}
				}
			},
		});

		return nearestHit === currentNearestHit ? null : nearestHit;
	}

	#pickTerrainRoot(
		ray: StaticSceneRay,
		request: StaticScenePickRequest,
		root: TerrainBvhRoot,
		currentNearestHit: StaticScenePickHit | null,
	): TerrainQuadScenePickHit | null {
		let nearestHit: TerrainQuadScenePickHit | null = isTerrainQuadScenePickHit(
			currentNearestHit,
		)
			? currentNearestHit
			: null;
		const localRay = translateRay(ray, negateTranslation(root.translation));
		traverseBvhNearest(root.nodes, localRay, {
			getMaxDistance: () =>
				currentNearestHit === null
					? (nearestHit?.distance ?? null)
					: Math.min(
							currentNearestHit.distance,
							nearestHit?.distance ?? Number.POSITIVE_INFINITY,
						),
			visitCandidate: (candidate) => {
				for (const itemIndex of candidate.itemIndices) {
					const item = root.items[itemIndex];
					if (!item) {
						continue;
					}

					const distance = intersectRayBounds(localRay, item.quad.bounds);
					if (distance === null) {
						continue;
					}

					const hit: TerrainQuadScenePickHit = {
						bounds: translateBounds(item.quad.bounds, root.translation),
						distance,
						hitPoint: pointOnRay(ray, distance),
						kind: "static-scene-pick-hit",
						selectionKey: createTerrainQuadSelectionKey({
							landblockId: root.landblockId,
							quadIndex: item.quad.quadIndex,
						}),
					};
					if (matchesFilters(hit, request.filters, ray.origin)) {
						nearestHit =
							nearestHit === null || comparePickHits(hit, nearestHit) < 0
								? hit
								: nearestHit;
					}
				}
			},
		});

		return nearestHit === currentNearestHit ? null : nearestHit;
	}

	#pickEnvCell(
		ray: StaticSceneRay,
		request: StaticScenePickRequest,
	): EnvCellStaticScenePickHit[] {
		if (request.context.kind !== "env-cell") {
			return [];
		}

		const landblockRoot = this.#envCellRootsByLandblockId.get(
			request.context.landblockId,
		);
		if (!landblockRoot) {
			return [];
		}
		const acceptedEnvCellIds = new Set(
			request.context.acceptedEnvCellIds ?? [request.context.envCellId],
		);
		const nearestHit = this.#pickEnvCellLandblockRoot(
			ray,
			request,
			landblockRoot,
			acceptedEnvCellIds,
			null,
		);

		return nearestHit ? [nearestHit] : [];
	}

	#pickEnvCellLandblockRoot(
		ray: StaticSceneRay,
		request: StaticScenePickRequest,
		landblockRoot: EnvCellLandblockBvhRoot,
		acceptedEnvCellIds: ReadonlySet<number>,
		currentNearestHit: StaticScenePickHit | null,
	): EnvCellStaticScenePickHit | null {
		let nearestHit: EnvCellStaticScenePickHit | null =
			isEnvCellStaticScenePickHit(currentNearestHit) ? currentNearestHit : null;
		const localRay = translateRay(
			ray,
			negateTranslation(landblockRoot.translation),
		);

		traverseBvhNearest(landblockRoot.nodes, localRay, {
			getMaxDistance: () => nearestHit?.distance ?? null,
			visitCandidate: (broadCandidate) => {
				for (const landblockItemIndex of broadCandidate.itemIndices) {
					const landblockItem = landblockRoot.items[landblockItemIndex];
					if (!landblockItem) {
						continue;
					}
					if (
						!isAcceptedEnvCellId(acceptedEnvCellIds, landblockItem.envCellId)
					) {
						continue;
					}
					const root = landblockRoot.cellsByEnvCellId.get(
						landblockItem.envCellId,
					);
					if (!root) {
						continue;
					}
					const hit = this.#pickEnvCellStaticObjects(
						ray,
						localRay,
						landblockRoot.translation,
						request,
						root,
						nearestHit,
					);
					nearestHit =
						hit !== null &&
						(nearestHit === null || comparePickHits(hit, nearestHit) < 0)
							? hit
							: nearestHit;
				}
			},
		});

		return nearestHit === currentNearestHit ? null : nearestHit;
	}

	#pickEnvCellStaticObjects(
		renderRay: StaticSceneRay,
		localRay: StaticSceneRay,
		landblockTranslation: readonly [number, number, number],
		request: StaticScenePickRequest,
		root: EnvCellBvhRoot,
		currentNearestHit: EnvCellStaticScenePickHit | null,
	): EnvCellStaticScenePickHit | null {
		let nearestHit = currentNearestHit;
		for (const item of root.items) {
			const bounds = this.#getEnvCellStaticSeedBounds(root, item.seed);
			if (!bounds) {
				continue;
			}
			const distance = intersectRayBounds(localRay, bounds);
			if (distance === null) {
				continue;
			}
			const renderBounds = translateBounds(bounds, landblockTranslation);
			const hit: EnvCellStaticScenePickHit = {
				bounds: renderBounds,
				distance,
				hitPoint: pointOnRay(renderRay, distance),
				kind: "static-scene-pick-hit",
				selectionKey: createEnvCellStaticObjectSelectionKey({
					envCellId: item.seed.envCellId,
					instanceId: item.seed.seed.identity.instanceId,
					landblockId: root.landblockId,
				}),
			};
			if (matchesFilters(hit, request.filters, renderRay.origin)) {
				nearestHit =
					nearestHit === null || comparePickHits(hit, nearestHit) < 0
						? hit
						: nearestHit;
			}
		}

		return nearestHit === currentNearestHit ? null : nearestHit;
	}

	#getEnvCellStaticSeedBounds(
		root: EnvCellBvhRoot,
		record: EnvCellStaticSeedRuntimeRecord,
	): StaticBounds | null {
		return (
			this.#envCellStaticBoundsOverridesByKey.get(
				createEnvCellStaticObjectBoundsKey({
					envCellId: record.envCellId,
					instanceId: record.seed.identity.instanceId,
					landblockId: root.landblockId,
				}),
			)?.bounds ?? null
		);
	}

	#setOutdoorAnchorLandblockId(outdoorAnchorLandblockId: number | null): void {
		if (this.#outdoorAnchorLandblockId === outdoorAnchorLandblockId) {
			return;
		}

		this.#outdoorAnchorLandblockId = outdoorAnchorLandblockId;
		for (const [landblockId, root] of this.#terrainBvhRootsByLandblockId) {
			this.#terrainBvhRootsByLandblockId.set(landblockId, {
				...root,
				translation: createOutdoorLandblockRootTranslation(
					landblockId,
					outdoorAnchorLandblockId,
				),
			});
		}
		for (const [key, root] of this.#outdoorBvhRootsByDomainAndLandblock) {
			this.#outdoorBvhRootsByDomainAndLandblock.set(key, {
				...root,
				translation: createOutdoorLandblockRootTranslation(
					root.landblockId,
					outdoorAnchorLandblockId,
				),
			});
		}
		for (const [landblockId, root] of this.#envCellRootsByLandblockId) {
			this.#envCellRootsByLandblockId.set(landblockId, {
				...root,
				translation: createOutdoorLandblockRootTranslation(
					landblockId,
					outdoorAnchorLandblockId,
				),
			});
		}
		this.#rebuildLandblockGridIndex();
	}

	#rebuildLandblockGridIndex(): void {
		this.#landblockGridIndex.clear();
		this.#landblockGridIndex.setOutdoorAnchorLandblockId(
			this.#outdoorAnchorLandblockId,
		);
		for (const root of this.#terrainBvhRootsByLandblockId.values()) {
			this.#landblockGridIndex.upsertTerrainRoot(root);
		}
		for (const root of this.#outdoorBvhRootsByDomainAndLandblock.values()) {
			this.#landblockGridIndex.upsertOutdoorRoot(root);
		}
		for (const root of this.#envCellRootsByLandblockId.values()) {
			this.#landblockGridIndex.upsertEnvCellRoot(root);
		}
	}
}

function createLandblockSpatialCandidate(
	bucket: LandblockSpatialBucket,
	distance: number,
): LandblockSpatialCandidate | null {
	const outdoorRoots = [...bucket.outdoorRootsByDomain.values()].sort(
		(left, right) => left.domain.localeCompare(right.domain),
	);
	if (!bucket.terrainRoot && outdoorRoots.length === 0 && !bucket.envCellRoot) {
		return null;
	}

	return {
		distance,
		envCellRoot: bucket.envCellRoot,
		landblockId: bucket.landblockId,
		outdoorRoots,
		terrainRoot: bucket.terrainRoot,
	};
}

function compareLandblockSpatialBuckets(
	left: LandblockSpatialBucket,
	right: LandblockSpatialBucket,
): number {
	return left.landblockId - right.landblockId;
}

function createBucketRenderCellKeys(
	bucket: LandblockSpatialBucket,
	outdoorAnchorLandblockId: number,
): readonly string[] {
	const cellKeys = new Set<string>();
	const baseCell = projectLandblockIdToRenderCell(
		bucket.landblockId,
		outdoorAnchorLandblockId,
	);
	cellKeys.add(createRenderCellKey(baseCell.cellX, baseCell.cellZ));

	for (const bounds of getBucketOutdoorRenderBounds(bucket)) {
		for (const cellKey of createRenderCellKeysForBounds(bounds)) {
			cellKeys.add(cellKey);
		}
	}

	return [...cellKeys].sort();
}

function getBucketOutdoorRenderBounds(
	bucket: LandblockSpatialBucket,
): readonly StaticBounds[] {
	const bounds: StaticBounds[] = [];
	if (bucket.terrainRoot?.nodes[0]) {
		bounds.push(
			translateBounds(
				bucket.terrainRoot.nodes[0].bounds,
				bucket.terrainRoot.translation,
			),
		);
	}

	for (const root of bucket.outdoorRootsByDomain.values()) {
		if (!root.nodes[0]) {
			continue;
		}
		bounds.push(translateBounds(root.nodes[0].bounds, root.translation));
	}

	if (bucket.envCellRoot?.nodes[0]) {
		bounds.push(
			translateBounds(
				bucket.envCellRoot.nodes[0].bounds,
				bucket.envCellRoot.translation,
			),
		);
	}

	return bounds;
}

function createRenderCellKeysForBounds(
	bounds: StaticBounds,
): readonly string[] {
	const minCellX = gridCellAt(bounds.min.x, 1, OUTDOOR_LANDBLOCK_WORLD_SIZE);
	const maxCellX = gridCellAt(bounds.max.x, -1, OUTDOOR_LANDBLOCK_WORLD_SIZE);
	const minCellZ = gridCellAt(bounds.min.z, 1, OUTDOOR_LANDBLOCK_WORLD_SIZE);
	const maxCellZ = gridCellAt(bounds.max.z, -1, OUTDOOR_LANDBLOCK_WORLD_SIZE);
	const cellKeys: string[] = [];

	for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
		for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
			cellKeys.push(createRenderCellKey(cellX, cellZ));
		}
	}

	return cellKeys;
}

function estimateLandblockSpatialCandidateDistance(
	ray: StaticSceneRay,
	bucket: LandblockSpatialBucket,
): number | null {
	let nearestDistance: number | null = null;
	for (const bounds of getBucketOutdoorRenderBounds(bucket)) {
		const distance = intersectRayBounds(ray, bounds);
		if (distance === null) {
			continue;
		}
		nearestDistance =
			nearestDistance === null ? distance : Math.min(nearestDistance, distance);
	}

	return nearestDistance;
}

export function* traceLandblockGridRayCells(
	ray: StaticSceneRay,
	bounds: LandblockGridRayBounds,
	options: LandblockGridRayTraceOptions = {},
): Iterable<LandblockGridRayCell> {
	const cellSize = options.cellSize ?? OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const startDistance = intersectRayGridBounds(ray, bounds, cellSize);
	if (startDistance === null) {
		return;
	}

	let currentDistance = startDistance;
	const startPoint = pointOnRay(ray, currentDistance);
	let cellX = gridCellAt(startPoint.x, ray.direction.x, cellSize);
	let cellZ = gridCellAt(startPoint.z, ray.direction.z, cellSize);

	const stepX = Math.sign(ray.direction.x);
	const stepZ = Math.sign(ray.direction.z);
	let nextDistanceX = nextGridBoundaryDistance(
		ray.origin.x,
		ray.direction.x,
		cellX,
		stepX,
		cellSize,
	);
	let nextDistanceZ = nextGridBoundaryDistance(
		ray.origin.z,
		ray.direction.z,
		cellZ,
		stepZ,
		cellSize,
	);
	const deltaDistanceX =
		stepX === 0
			? Number.POSITIVE_INFINITY
			: cellSize / Math.abs(ray.direction.x);
	const deltaDistanceZ =
		stepZ === 0
			? Number.POSITIVE_INFINITY
			: cellSize / Math.abs(ray.direction.z);

	while (containsGridCell(bounds, cellX, cellZ)) {
		const maxDistance = options.getMaxDistance?.() ?? null;
		if (maxDistance !== null && currentDistance > maxDistance) {
			return;
		}

		yield {
			cellX,
			cellZ,
			distance: normalizeDistanceZero(currentDistance),
		};

		const nextDistance = Math.min(nextDistanceX, nextDistanceZ);
		if (!Number.isFinite(nextDistance)) {
			return;
		}

		const advanceX = nextDistanceX <= nextDistance + GRID_EPSILON;
		const advanceZ = nextDistanceZ <= nextDistance + GRID_EPSILON;
		currentDistance = nextDistance;
		if (advanceX) {
			cellX += stepX;
			nextDistanceX += deltaDistanceX;
		}
		if (advanceZ) {
			cellZ += stepZ;
			nextDistanceZ += deltaDistanceZ;
		}
	}
}

function projectLandblockIdToRenderCell(
	landblockId: number,
	outdoorAnchorLandblockId: number,
): { readonly cellX: number; readonly cellZ: number } {
	const landblockCoords = getOutdoorLandblockCoords(landblockId);
	const anchorCoords = getOutdoorLandblockCoords(outdoorAnchorLandblockId);

	return {
		cellX: landblockCoords.x - anchorCoords.x,
		// Local outdoor render Z runs from -landblockSize to 0, so the anchor
		// landblock lives in render cell Z -1 rather than 0.
		cellZ: anchorCoords.y - landblockCoords.y - 1,
	};
}

function createRenderCellKey(cellX: number, cellZ: number): string {
	return `${cellX}:${cellZ}`;
}

function parseRenderCellKey(key: string): {
	readonly cellX: number;
	readonly cellZ: number;
} {
	const [cellX, cellZ] = key
		.split(":")
		.map((entry) => Number.parseInt(entry, 10));
	if (!Number.isFinite(cellX) || !Number.isFinite(cellZ)) {
		throw new Error(`Invalid landblock render cell key: ${key}`);
	}

	return { cellX, cellZ };
}

function intersectRayGridBounds(
	ray: StaticSceneRay,
	bounds: LandblockGridRayBounds,
	cellSize: number,
): number | null {
	let tMin = Number.NEGATIVE_INFINITY;
	let tMax = Number.POSITIVE_INFINITY;
	const minX = bounds.minCellX * cellSize;
	const maxX = (bounds.maxCellX + 1) * cellSize;
	const minZ = bounds.minCellZ * cellSize;
	const maxZ = (bounds.maxCellZ + 1) * cellSize;

	for (const slab of [
		{ direction: ray.direction.x, max: maxX, min: minX, origin: ray.origin.x },
		{ direction: ray.direction.z, max: maxZ, min: minZ, origin: ray.origin.z },
	]) {
		if (Math.abs(slab.direction) < GRID_EPSILON) {
			if (slab.origin < slab.min || slab.origin > slab.max) {
				return null;
			}
			continue;
		}

		const inverse = 1 / slab.direction;
		const t1 = (slab.min - slab.origin) * inverse;
		const t2 = (slab.max - slab.origin) * inverse;
		tMin = Math.max(tMin, Math.min(t1, t2));
		tMax = Math.min(tMax, Math.max(t1, t2));
		if (tMin > tMax) {
			return null;
		}
	}

	if (tMax < 0) {
		return null;
	}

	return Math.max(tMin, 0);
}

function gridCellAt(
	value: number,
	direction: number,
	cellSize: number,
): number {
	const scaled = value / cellSize;
	const rounded = Math.round(scaled);
	if (direction < 0 && Math.abs(scaled - rounded) < GRID_EPSILON) {
		return rounded - 1;
	}

	return Math.floor(scaled);
}

function nextGridBoundaryDistance(
	origin: number,
	direction: number,
	cell: number,
	step: number,
	cellSize: number,
): number {
	if (step === 0) {
		return Number.POSITIVE_INFINITY;
	}

	const boundary = (step > 0 ? cell + 1 : cell) * cellSize;
	return (boundary - origin) / direction;
}

function containsGridCell(
	bounds: LandblockGridRayBounds,
	cellX: number,
	cellZ: number,
): boolean {
	return (
		cellX >= bounds.minCellX &&
		cellX <= bounds.maxCellX &&
		cellZ >= bounds.minCellZ &&
		cellZ <= bounds.maxCellZ
	);
}

function normalizeDistanceZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}

function selectNearestHit(
	left: StaticScenePickHit | null,
	right: StaticScenePickHit | null,
): StaticScenePickHit | null {
	if (!right) {
		return left;
	}
	if (!left) {
		return right;
	}

	return comparePickHits(right, left) < 0 ? right : left;
}

function isOutdoorStaticObjectScenePickHit(
	hit: StaticScenePickHit | null,
): hit is OutdoorStaticObjectScenePickHit {
	return hit?.selectionKey.itemKind === "outdoor-static-object";
}

function isTerrainQuadScenePickHit(
	hit: StaticScenePickHit | null,
): hit is TerrainQuadScenePickHit {
	return hit?.selectionKey.itemKind === "terrain-quad";
}

function isEnvCellStaticScenePickHit(
	hit: StaticScenePickHit | null,
): hit is EnvCellStaticScenePickHit {
	return hit?.selectionKey.itemKind === "env-cell-static-object";
}

const GRID_EPSILON = 1e-8;

interface BvhCandidate {
	readonly distance: number;
	readonly itemIndices: readonly number[];
	readonly nodeIndex: number;
}

function traverseBvhNearest(
	nodes: readonly BvhNode[],
	ray: StaticSceneRay,
	options: {
		readonly getMaxDistance: () => number | null;
		readonly visitCandidate: (candidate: BvhCandidate) => void;
	},
): void {
	if (nodes.length === 0) {
		return;
	}

	const root = nodes[0];
	if (!root) {
		return;
	}
	const rootDistance = intersectRayBounds(ray, root.bounds);
	if (rootDistance === null) {
		return;
	}

	const pending: BvhCandidate[] = [
		{ distance: rootDistance, itemIndices: [], nodeIndex: 0 },
	];
	while (pending.length > 0) {
		pending.sort(
			(left, right) =>
				right.distance - left.distance || right.nodeIndex - left.nodeIndex,
		);
		const candidate = pending.pop();
		if (!candidate) {
			continue;
		}
		const maxDistance = options.getMaxDistance();
		if (maxDistance !== null && candidate.distance > maxDistance) {
			continue;
		}

		const node = nodes[candidate.nodeIndex];
		if (!node) {
			continue;
		}
		if (node.itemIndices.length > 0) {
			options.visitCandidate({
				distance: candidate.distance,
				itemIndices: node.itemIndices,
				nodeIndex: candidate.nodeIndex,
			});
		}
		for (const childIndex of [node.left, node.right]) {
			if (childIndex === null) {
				continue;
			}
			const child = nodes[childIndex];
			if (!child) {
				continue;
			}
			const childDistance = intersectRayBounds(ray, child.bounds);
			const updatedMaxDistance = options.getMaxDistance();
			if (
				childDistance === null ||
				(updatedMaxDistance !== null && childDistance > updatedMaxDistance)
			) {
				continue;
			}
			pending.push({
				distance: childDistance,
				itemIndices: [],
				nodeIndex: childIndex,
			});
		}
	}
}

function traverseBvhPoint(
	nodes: readonly BvhNode[],
	point: Vec3,
): readonly BvhCandidate[] {
	if (nodes.length === 0) {
		return [];
	}

	const candidates: BvhCandidate[] = [];
	const stack = [0];
	while (stack.length > 0) {
		const nodeIndex = stack.pop() ?? 0;
		const node = nodes[nodeIndex];
		if (!node || !containsPoint(node.bounds, point)) {
			continue;
		}

		if (node.itemIndices.length > 0) {
			candidates.push({
				distance: boundsCenterDistanceSquared(node.bounds, point),
				itemIndices: node.itemIndices,
				nodeIndex,
			});
		}
		if (node.right !== null) {
			stack.push(node.right);
		}
		if (node.left !== null) {
			stack.push(node.left);
		}
	}

	return candidates.sort(
		(left, right) =>
			left.distance - right.distance || left.nodeIndex - right.nodeIndex,
	);
}

function matchesFilters(
	hit: StaticScenePickHit,
	filters: StaticScenePickFilters | undefined,
	rayOrigin: Vec3,
): boolean {
	return (
		(!filters?.itemKinds ||
			filters.itemKinds.includes(hit.selectionKey.itemKind)) &&
		(!filters?.domains || filters.domains.includes(hit.selectionKey.domain)) &&
		(!filters?.ignoreContainingOrigin || !containsPoint(hit.bounds, rayOrigin))
	);
}

function createAcceptedEnvCellSet(
	acceptedEnvCellIds: readonly number[],
): ReadonlySet<number> {
	return new Set(acceptedEnvCellIds);
}

function isAcceptedEnvCellId(
	acceptedEnvCellIds: ReadonlySet<number>,
	envCellId: number,
): boolean {
	return acceptedEnvCellIds.size === 0 || acceptedEnvCellIds.has(envCellId);
}

function createEnvCellStaticObjectBoundsKey(input: {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
}): string {
	return `${input.landblockId >>> 0}:${input.envCellId >>> 0}:${input.instanceId}`;
}

function parseEnvCellStaticObjectBoundsKeyLandblockId(
	key: string,
): number | null {
	const landblockId = Number.parseInt(key.split(":", 1)[0] ?? "", 10);
	return Number.isFinite(landblockId) ? landblockId : null;
}

function createCommittedSpatialRecordKey(record: StaticSpatialRecord): string {
	switch (record.kind) {
		case "draw-unit-bounds":
			return `draw-unit-bounds:${record.drawUnitId}`;
		case "env-cell-static-object-bounds":
			return `env-cell-static-object-bounds:${record.landblockId >>> 0}:${record.envCellId >>> 0}:${record.instanceId}`;
		case "env-cell-spatial":
			return `env-cell-spatial:${record.landblockId >>> 0}:${record.envCellId >>> 0}:${record.memberId}`;
	}
}

function createCommittedVisibilityRecordKey(
	record: StaticVisibilityRecord,
): string {
	return `env-cell-visibility:${record.landblockId >>> 0}`;
}

function createCommittedPortalInteriorRecordKey(
	record: StaticPortalInteriorRecord,
): string {
	return `env-cell-portal-interior:${record.landblockId >>> 0}`;
}

function createCommittedPortalGraphRecordKey(
	record: StaticPortalGraphRecord,
): string {
	return `static-portal-graph:${record.landblockId >>> 0}:${createStaticPeerOwnerKey(record.owner)}`;
}

function createCommittedSourceMappingRecordKey(
	record: StaticSourceMappingRecord,
): string {
	switch (record.kind) {
		case "terrain-source-triangle":
			return `terrain-source-triangle:${record.drawUnitId}:${record.sourceTriangleId}`;
		case "env-cell-source":
			return `env-cell-source:${record.landblockId >>> 0}:${record.envCellId >>> 0}:${record.memberId}`;
	}
}

function createCommittedAuthoredDynamicSeedRecordKey(
	record: StaticAuthoredDynamicSeedRecord,
): string {
	return `env-cell-static-object-seed:${record.landblockId >>> 0}:${record.envCellId >>> 0}:${record.seed.identity.instanceId}`;
}

function createStaticPeerOwnerKey(owner: {
	readonly kind: string;
	readonly drawUnitId?: string;
	readonly domain?: StaticDomain;
	readonly scopeKey?: string;
	readonly workId?: string;
}): string {
	if (owner.kind === "draw-unit" && typeof owner.drawUnitId === "string") {
		return `draw-unit:${owner.drawUnitId}`;
	}
	if (
		owner.kind === "work" &&
		typeof owner.domain === "string" &&
		typeof owner.scopeKey === "string"
	) {
		return createStaticScopeOwnerKey({
			domain: owner.domain,
			scopeKey: owner.scopeKey,
		});
	}
	throw new Error(
		`Static scene query cannot commit peer record with unknown owner ${owner.kind}.`,
	);
}

function createStaticScopeOwnerKey(owner: {
	readonly domain: string;
	readonly scopeKey: string;
}): string {
	return `${owner.domain}:${owner.scopeKey}`;
}

function collectCommittedRecordsByLandblock<TRecord>(
	recordsByKey: ReadonlyMap<string, CommittedRecordEntry<TRecord>>,
	landblockId: number,
): readonly TRecord[] {
	return [...recordsByKey.values()]
		.map((entry) => entry.record)
		.filter((record) => getCommittedRecordLandblockId(record) === landblockId)
		.sort(compareCommittedRecords);
}

function groupEnvCellSpatialRecordsByLandblock(
	recordsByKey: ReadonlyMap<string, CommittedRecordEntry<StaticSpatialRecord>>,
): ReadonlyMap<number, readonly StaticEnvCellSpatialRecord[]> {
	const recordsByLandblock = new Map<number, StaticEnvCellSpatialRecord[]>();
	for (const entry of recordsByKey.values()) {
		const record = entry.record;
		if (record.kind !== "env-cell-spatial") {
			continue;
		}
		const records = recordsByLandblock.get(record.landblockId) ?? [];
		records.push(record);
		recordsByLandblock.set(record.landblockId, records);
	}
	for (const records of recordsByLandblock.values()) {
		records.sort(compareCommittedRecords);
	}
	return recordsByLandblock;
}

function groupEnvCellSeedsByLandblockAndEnvCell(
	recordsByKey: ReadonlyMap<
		string,
		CommittedRecordEntry<StaticAuthoredDynamicSeedRecord>
	>,
): ReadonlyMap<
	number,
	ReadonlyMap<number, readonly StaticAuthoredDynamicSeedRecord[]>
> {
	const recordsByLandblockAndEnvCell = new Map<
		number,
		Map<number, StaticAuthoredDynamicSeedRecord[]>
	>();
	for (const entry of recordsByKey.values()) {
		const record = entry.record;
		let recordsByEnvCell = recordsByLandblockAndEnvCell.get(record.landblockId);
		if (!recordsByEnvCell) {
			recordsByEnvCell = new Map<number, StaticAuthoredDynamicSeedRecord[]>();
			recordsByLandblockAndEnvCell.set(record.landblockId, recordsByEnvCell);
		}
		const records = recordsByEnvCell.get(record.envCellId) ?? [];
		records.push(record);
		recordsByEnvCell.set(record.envCellId, records);
	}
	for (const recordsByEnvCell of recordsByLandblockAndEnvCell.values()) {
		for (const records of recordsByEnvCell.values()) {
			records.sort(compareCommittedRecords);
		}
	}
	return recordsByLandblockAndEnvCell;
}

function countCommittedEnvCellLandblocks(
	recordMaps: readonly ReadonlyMap<
		string,
		CommittedRecordEntry<
			| StaticPortalInteriorRecord
			| StaticPortalGraphRecord
			| StaticSourceMappingRecord
			| StaticSpatialRecord
			| StaticAuthoredDynamicSeedRecord
			| StaticVisibilityRecord
		>
	>[],
): number {
	const landblockIds = new Set<number>();
	for (const recordsByKey of recordMaps) {
		for (const entry of recordsByKey.values()) {
			const landblockId = getCommittedRecordLandblockId(entry.record);
			if (
				landblockId !== null &&
				getCommittedRecordDomain(entry.record) === "landblock-env-cells"
			) {
				landblockIds.add(landblockId);
			}
		}
	}
	return landblockIds.size;
}

function compareCommittedRecords<TRecord>(
	left: TRecord,
	right: TRecord,
): number {
	return (
		compareStrings(
			getCommittedRecordDomain(left),
			getCommittedRecordDomain(right),
		) ||
		compareNullableNumbers(
			getCommittedRecordLandblockId(left),
			getCommittedRecordLandblockId(right),
		) ||
		compareStrings(
			createCommittedRecordSortKey(left),
			createCommittedRecordSortKey(right),
		) ||
		compareStrings(
			createCommittedRecordOwnerSortKey(left),
			createCommittedRecordOwnerSortKey(right),
		)
	);
}

function createCommittedRecordSortKey(record: unknown): string {
	if (!isRecordWithKind(record)) {
		throw new Error(
			"Static scene query cannot sort committed record without kind.",
		);
	}

	switch (record.kind) {
		case "draw-unit-bounds":
		case "env-cell-static-object-bounds":
		case "env-cell-spatial":
			return createCommittedSpatialRecordKey(record as StaticSpatialRecord);
		case "env-cell-visibility":
			return createCommittedVisibilityRecordKey(
				record as StaticVisibilityRecord,
			);
		case "env-cell-portal-interior":
			return createCommittedPortalInteriorRecordKey(
				record as StaticPortalInteriorRecord,
			);
		case "static-portal-graph":
			return createCommittedPortalGraphRecordKey(
				record as StaticPortalGraphRecord,
			);
		case "terrain-source-triangle":
		case "env-cell-source":
			return createCommittedSourceMappingRecordKey(
				record as StaticSourceMappingRecord,
			);
		case "env-cell-static-object-seed":
			return createCommittedAuthoredDynamicSeedRecordKey(
				record as StaticAuthoredDynamicSeedRecord,
			);
		default:
			throw new Error(
				`Static scene query cannot sort unsupported committed record kind ${record.kind}.`,
			);
	}
}

function createCommittedRecordOwnerSortKey(record: unknown): string {
	if (!isRecordWithPeerOwner(record)) {
		return "";
	}
	return createStaticPeerOwnerKey(record.owner);
}

function compareStrings(left: string, right: string): number {
	return left.localeCompare(right);
}

function compareNullableNumbers(
	left: number | null,
	right: number | null,
): number {
	return (left ?? -1) - (right ?? -1);
}

function createEnvCellPortalProjectionCacheKey(options: {
	readonly landblockId: number;
	readonly startEnvCellId: number;
}): string {
	return `${options.landblockId >>> 0}:${options.startEnvCellId >>> 0}`;
}

function parseEnvCellPortalProjectionCacheKeyLandblockId(
	cacheKey: string,
): number | null {
	const [landblockIdPart] = cacheKey.split(":", 1);
	if (!landblockIdPart) {
		return null;
	}
	const landblockId = Number(landblockIdPart);
	return Number.isFinite(landblockId) ? landblockId >>> 0 : null;
}

function getCommittedRecordDomain(
	record:
		| StaticPortalInteriorRecord
		| StaticPortalGraphRecord
		| StaticSourceMappingRecord
		| StaticSpatialRecord
		| StaticAuthoredDynamicSeedRecord
		| StaticVisibilityRecord
		| unknown,
): StaticDomain {
	if (isRecordWithWorkOwner(record)) {
		return record.owner.domain;
	}
	if (isEnvCellRecord(record)) {
		return "landblock-env-cells";
	}
	if (isTerrainSourceMappingRecord(record)) {
		return "outdoor-terrain";
	}
	return "outdoor-detail";
}

function getCommittedRecordLandblockId(
	record:
		| StaticPortalInteriorRecord
		| StaticPortalGraphRecord
		| StaticSourceMappingRecord
		| StaticSpatialRecord
		| StaticAuthoredDynamicSeedRecord
		| StaticVisibilityRecord
		| unknown,
): number | null {
	if (isRecordWithLandblock(record)) {
		return record.landblockId;
	}
	return null;
}

function createRetainedScopeKey(
	domain: StaticDomain,
	landblockId: number | null,
): string {
	return `${domain}:${landblockId ?? "none"}`;
}

function isRecordWithWorkOwner(record: unknown): record is {
	readonly owner: { readonly kind: "work"; readonly domain: StaticDomain };
} {
	return (
		typeof record === "object" &&
		record !== null &&
		"owner" in record &&
		(record as { owner?: { kind?: unknown } }).owner?.kind === "work" &&
		typeof (record as { owner?: { domain?: unknown } }).owner?.domain ===
			"string"
	);
}

function isRecordWithPeerOwner(record: unknown): record is {
	readonly owner: {
		readonly kind: string;
		readonly drawUnitId?: string;
		readonly domain?: StaticDomain;
		readonly scopeKey?: string;
		readonly workId?: string;
	};
} {
	return (
		typeof record === "object" &&
		record !== null &&
		"owner" in record &&
		typeof (record as { owner?: { kind?: unknown } }).owner?.kind === "string"
	);
}

function isRecordWithKind(
	record: unknown,
): record is { readonly kind: string } {
	return (
		typeof record === "object" &&
		record !== null &&
		"kind" in record &&
		typeof (record as { kind?: unknown }).kind === "string"
	);
}

function isRecordWithLandblock(
	record: unknown,
): record is { readonly landblockId: number } {
	return (
		typeof record === "object" &&
		record !== null &&
		"landblockId" in record &&
		typeof (record as { landblockId?: unknown }).landblockId === "number"
	);
}

function isEnvCellRecord(record: unknown): boolean {
	return (
		typeof record === "object" &&
		record !== null &&
		"kind" in record &&
		typeof (record as { kind?: unknown }).kind === "string" &&
		(record as { kind: string }).kind.startsWith("env-cell")
	);
}

function isTerrainSourceMappingRecord(
	record: unknown,
): record is { readonly kind: "terrain-source-triangle" } {
	return (
		typeof record === "object" &&
		record !== null &&
		(record as { kind?: unknown }).kind === "terrain-source-triangle"
	);
}

function comparePickHits(
	left: StaticScenePickHit,
	right: StaticScenePickHit,
): number {
	return (
		left.distance - right.distance ||
		left.selectionKey.itemKind.localeCompare(right.selectionKey.itemKind) ||
		compareStaticSceneSelectionKeys(left.selectionKey, right.selectionKey)
	);
}

export function createOutdoorStaticObjectSelectionKey(options: {
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly landblockId: number;
	readonly instanceId: string;
}): OutdoorStaticObjectSceneSelectionKey {
	return {
		domain: options.domain,
		instanceId: options.instanceId,
		itemKind: "outdoor-static-object",
		landblockId: options.landblockId,
	};
}

export function createEnvCellStaticObjectSelectionKey(options: {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
}): EnvCellStaticSceneSelectionKey {
	return {
		domain: "landblock-env-cells",
		envCellId: options.envCellId,
		instanceId: options.instanceId,
		itemKind: "env-cell-static-object",
		landblockId: options.landblockId,
	};
}

export function createEnvCellPortalSelectionKey(options: {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly portalId: string;
}): EnvCellPortalSceneSelectionKey {
	return {
		domain: "landblock-env-cells",
		envCellId: options.envCellId,
		itemKind: "env-cell-portal",
		landblockId: options.landblockId,
		portalId: options.portalId,
	};
}

export function createTerrainQuadSelectionKey(options: {
	readonly landblockId: number;
	readonly quadIndex: number;
}): TerrainQuadSceneSelectionKey {
	return {
		domain: "outdoor-terrain",
		itemKind: "terrain-quad",
		landblockId: options.landblockId,
		quadIndex: options.quadIndex,
	};
}

export function compareStaticSceneSelectionKeys(
	left: StaticSceneSelectionKey,
	right: StaticSceneSelectionKey,
): number {
	return describeStaticSceneSelectionKey(left).localeCompare(
		describeStaticSceneSelectionKey(right),
	);
}

export function describeStaticSceneSelectionKey(
	selectionKey: StaticSceneSelectionKey,
): string {
	if (selectionKey.itemKind === "outdoor-static-object") {
		return [
			selectionKey.itemKind,
			selectionKey.domain,
			selectionKey.landblockId.toString(16),
			selectionKey.instanceId,
		].join(":");
	}
	if (selectionKey.itemKind === "terrain-quad") {
		return [
			selectionKey.itemKind,
			selectionKey.domain,
			selectionKey.landblockId.toString(16),
			selectionKey.quadIndex,
		].join(":");
	}
	if (selectionKey.itemKind === "env-cell-portal") {
		return [
			selectionKey.itemKind,
			selectionKey.domain,
			selectionKey.landblockId.toString(16),
			selectionKey.envCellId.toString(16),
			selectionKey.portalId,
		].join(":");
	}

	return [
		selectionKey.itemKind,
		selectionKey.domain,
		selectionKey.landblockId.toString(16),
		selectionKey.envCellId.toString(16),
		selectionKey.instanceId,
	].join(":");
}

function createOutdoorRootKey(
	domain: OutdoorStaticObjectsScopePayload["domain"],
	landblockId: number,
): string {
	return `${domain}:${landblockId.toString(16)}`;
}

function parseOutdoorRootKeyLandblockId(key: string): number | null {
	const [, landblockHex] = key.split(":");
	if (!landblockHex) {
		return null;
	}
	const landblockId = Number.parseInt(landblockHex, 16);
	return Number.isFinite(landblockId) ? landblockId >>> 0 : null;
}

function createOutdoorSourceDiagnosticsRoot(
	payload: OutdoorStaticObjectsScopePayload,
): OutdoorSourceDiagnosticsRoot {
	const sourceAssetsByKey = new Map(
		payload.sourceAssets.map((sourceAsset) => [
			createStaticObjectSourceKey(sourceAsset.identity),
			sourceAsset,
		]),
	);
	const materialSourcesById = new Map(
		payload.materialSources.map((material) => [
			material.identity.materialId,
			material,
		]),
	);
	const objectsByInstanceId = new Map<
		string,
		OutdoorStaticObjectSourceDiagnostics
	>();

	for (const object of payload.objects) {
		const sourceAsset =
			sourceAssetsByKey.get(createStaticObjectSourceKey(object.source)) ?? null;
		const sourceAssetDiagnostics =
			sourceAsset === null ? null : createSourceAssetDiagnostics(sourceAsset);
		const materialSlots = [
			...payload.materialSlots
				.filter(
					(slot) =>
						slot.object.landblockId === object.identity.landblockId &&
						slot.object.instanceId === object.identity.instanceId,
				)
				.map(
					(slot): OutdoorStaticObjectMaterialSlotDiagnostics => ({
						material: materialSourcesById.get(slot.material.materialId) ?? null,
						slot,
					}),
				),
		].sort(compareMaterialSlotDiagnostics);
		const materialIds = new Set([
			...materialSlots.map((entry) => entry.slot.material.materialId),
			...(sourceAssetDiagnostics?.parts.flatMap((part) =>
				part.materialSlots.map((slot) => slot.material.materialId),
			) ?? []),
		]);
		const materialSources = payload.materialSources
			.filter((material) => materialIds.has(material.identity.materialId))
			.sort(compareMaterialSources);
		objectsByInstanceId.set(object.identity.instanceId, {
			domain: payload.domain,
			instanceId: object.identity.instanceId,
			landblockId: payload.landblock.landblockId,
			materialSlots,
			materialSources,
			object,
			sourceAsset: sourceAssetDiagnostics,
			textureRefs: filterTextureRefsForMaterials(
				payload.textureRefs,
				materialSources,
			),
		});
	}

	return { objectsByInstanceId };
}

function createSourceAssetDiagnostics(
	sourceAsset: OutdoorStaticObjectsScopePayload["sourceAssets"][number],
): OutdoorStaticObjectSourceAssetDiagnostics {
	return {
		...sourceAsset,
		parts: sourceAsset.parts.map(stripPartGeometryBuffers),
	};
}

function stripPartGeometryBuffers(
	part: StaticObjectPartSourceFacts,
): OutdoorStaticObjectPartDiagnostics {
	return {
		bounds: part.bounds,
		defaultPlacements: part.defaultPlacements,
		geometry: part.geometry,
		gfxObj: part.gfxObj,
		invalidPolygonCount: part.invalidPolygonCount,
		materialSlotCount: part.materialSlotCount,
		materialSlots: part.materialSlots,
		partIndex: part.partIndex,
		physicsPolygonCount: part.physicsPolygonCount,
		renderTriangleCount: part.renderTriangleCount,
		scale: part.scale,
		skippedPolygonCount: part.skippedPolygonCount,
		source: part.source,
	};
}

function filterTextureRefsForMaterials(
	textureRefs: readonly StaticObjectTextureRefFacts[],
	materials: readonly StaticObjectMaterialSourceFacts[],
): readonly StaticObjectTextureRefFacts[] {
	const surfaceTextureIds = new Set<number>();
	const renderSurfaceIds = new Set<number>();
	const paletteIds = new Set<number>();

	for (const material of materials) {
		if (material.source.kind !== "texture") {
			continue;
		}
		surfaceTextureIds.add(material.source.texture.surfaceTextureId);
		if (material.source.selectedRenderSurface) {
			renderSurfaceIds.add(
				material.source.selectedRenderSurface.renderSurfaceId,
			);
		}
		if (material.source.palette) {
			paletteIds.add(material.source.palette.paletteId);
		}
		for (const palette of material.source.renderSurfaceDefaultPalettes) {
			paletteIds.add(palette.paletteId);
		}
	}

	return textureRefs.filter((textureRef) => {
		if (textureRef.role === "surface-texture") {
			return (
				surfaceTextureIds.has(textureRef.texture.surfaceTextureId) ||
				(textureRef.renderSurface !== null &&
					renderSurfaceIds.has(textureRef.renderSurface.renderSurfaceId)) ||
				(textureRef.palette !== null &&
					paletteIds.has(textureRef.palette.paletteId))
			);
		}

		return (
			renderSurfaceIds.has(textureRef.renderSurface.renderSurfaceId) ||
			(textureRef.palette !== null &&
				paletteIds.has(textureRef.palette.paletteId))
		);
	});
}

function compareMaterialSlotDiagnostics(
	left: OutdoorStaticObjectMaterialSlotDiagnostics,
	right: OutdoorStaticObjectMaterialSlotDiagnostics,
): number {
	return (
		left.slot.identity.part.partIndex - right.slot.identity.part.partIndex ||
		left.slot.identity.slotIndex - right.slot.identity.slotIndex ||
		left.slot.identity.geometrySurfaceId -
			right.slot.identity.geometrySurfaceId ||
		left.slot.identity.materialSurfaceId - right.slot.identity.materialSurfaceId
	);
}

function compareMaterialSources(
	left: StaticObjectMaterialSourceFacts,
	right: StaticObjectMaterialSourceFacts,
): number {
	return left.identity.materialId - right.identity.materialId;
}

function createStaticObjectSourceKey(
	source: OutdoorStaticObjectsScopePayload["sourceAssets"][number]["identity"],
): string {
	return [
		source.kind,
		source.sourceAssetKind,
		(source.sourceDid >>> 0).toString(16).padStart(8, "0"),
	].join(":");
}

function normalizeRay(ray: StaticSceneRay): StaticSceneRay {
	return {
		direction: normalizeVec3(ray.direction),
		origin: ray.origin,
	};
}

function intersectRayBounds(
	ray: StaticSceneRay,
	bounds: StaticBounds,
): number | null {
	let tMin = Number.NEGATIVE_INFINITY;
	let tMax = Number.POSITIVE_INFINITY;

	for (const axis of ["x", "y", "z"] as const) {
		const origin = ray.origin[axis];
		const direction = ray.direction[axis];
		const min = bounds.min[axis];
		const max = bounds.max[axis];

		if (Math.abs(direction) < 1e-8) {
			if (origin < min || origin > max) {
				return null;
			}
			continue;
		}

		const inverse = 1 / direction;
		const t1 = (min - origin) * inverse;
		const t2 = (max - origin) * inverse;
		tMin = Math.max(tMin, Math.min(t1, t2));
		tMax = Math.min(tMax, Math.max(t1, t2));

		if (tMin > tMax) {
			return null;
		}
	}

	if (tMax < 0) {
		return null;
	}

	return Math.max(tMin, 0);
}

function containsPoint(bounds: StaticBounds, point: Vec3): boolean {
	return (
		point.x >= bounds.min.x &&
		point.x <= bounds.max.x &&
		point.y >= bounds.min.y &&
		point.y <= bounds.max.y &&
		point.z >= bounds.min.z &&
		point.z <= bounds.max.z
	);
}

function boundsCenterDistanceSquared(
	bounds: StaticBounds,
	point: Vec3,
): number {
	const center = {
		x: (bounds.min.x + bounds.max.x) * 0.5,
		y: (bounds.min.y + bounds.max.y) * 0.5,
		z: (bounds.min.z + bounds.max.z) * 0.5,
	};
	const dx = center.x - point.x;
	const dy = center.y - point.y;
	const dz = center.z - point.z;
	return dx * dx + dy * dy + dz * dz;
}

function pointOnRay(ray: StaticSceneRay, distance: number): Vec3 {
	return {
		x: ray.origin.x + ray.direction.x * distance,
		y: ray.origin.y + ray.direction.y * distance,
		z: ray.origin.z + ray.direction.z * distance,
	};
}

function translateRay(
	ray: StaticSceneRay,
	translation: readonly [number, number, number],
): StaticSceneRay {
	return {
		direction: ray.direction,
		origin: {
			x: ray.origin.x + translation[0],
			y: ray.origin.y + translation[1],
			z: ray.origin.z + translation[2],
		},
	};
}

function negateTranslation(
	translation: readonly [number, number, number],
): readonly [number, number, number] {
	return [-translation[0], -translation[1], -translation[2]];
}

function translateBounds(
	bounds: StaticBounds,
	translation: readonly [number, number, number],
): StaticBounds {
	return {
		max: {
			x: bounds.max.x + translation[0],
			y: bounds.max.y + translation[1],
			z: bounds.max.z + translation[2],
		},
		min: {
			x: bounds.min.x + translation[0],
			y: bounds.min.y + translation[1],
			z: bounds.min.z + translation[2],
		},
	};
}

function unionBounds(left: StaticBounds, right: StaticBounds): StaticBounds {
	return {
		max: {
			x: Math.max(left.max.x, right.max.x),
			y: Math.max(left.max.y, right.max.y),
			z: Math.max(left.max.z, right.max.z),
		},
		min: {
			x: Math.min(left.min.x, right.min.x),
			y: Math.min(left.min.y, right.min.y),
			z: Math.min(left.min.z, right.min.z),
		},
	};
}

function normalizeVec3(vector: Vec3): Vec3 {
	const length = Math.hypot(vector.x, vector.y, vector.z);
	if (length === 0) {
		return { x: 0, y: 0, z: -1 };
	}

	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length,
	};
}
