import type {
	LandblockEnvCellsStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
	StaticBounds,
	StaticObjectInstanceFacts,
	StaticObjectMaterialSourceFacts,
	StaticObjectPartSourceFacts,
	StaticPlacementTransform,
	StaticDomain,
	StaticScopePayload,
	StaticObjectTextureRefFacts,
	StaticVec3,
	TerrainMeshQuadFacts,
	TerrainStaticScopePayload,
} from "../static/contracts";
import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	getOutdoorLandblockCoords,
} from "../../lib/landblocks";
import { createOutdoorLandblockRootTranslation } from "./static-placement";

export interface StaticSceneRay {
	readonly origin: StaticSceneVec3;
	readonly direction: StaticSceneVec3;
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
	| TerrainQuadScenePickHit;

export type StaticSceneSelectionKey =
	| OutdoorStaticObjectSceneSelectionKey
	| EnvCellStaticSceneSelectionKey
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

export interface TerrainQuadSceneSelectionKey {
	readonly itemKind: "terrain-quad";
	readonly domain: "outdoor-terrain";
	readonly landblockId: number;
	readonly quadIndex: number;
}

export interface OutdoorStaticObjectScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly distance: number;
	readonly hitPoint: StaticSceneVec3;
	readonly bounds: StaticBounds;
	readonly selectionKey: OutdoorStaticObjectSceneSelectionKey;
}

export interface EnvCellStaticScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly distance: number;
	readonly hitPoint: StaticSceneVec3;
	readonly bounds: StaticBounds;
	readonly selectionKey: EnvCellStaticSceneSelectionKey;
}

export interface TerrainQuadScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly distance: number;
	readonly hitPoint: StaticSceneVec3;
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

export type OutdoorStaticObjectPartDiagnostics = Omit<
	StaticObjectPartSourceFacts,
	"normals" | "positions" | "texCoords" | "triangles"
>;

export type OutdoorStaticObjectSourceAssetDiagnostics = Omit<
	OutdoorStaticObjectsScopePayload["sourceAssets"][number],
	"parts"
> & {
	readonly parts: readonly OutdoorStaticObjectPartDiagnostics[];
};

export interface OutdoorStaticObjectMaterialSlotDiagnostics {
	readonly material: StaticObjectMaterialSourceFacts | null;
	readonly slot: OutdoorStaticObjectsScopePayload["materialSlots"][number];
}

export interface EnvCellStaticScenePickDetails {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
	readonly seed: LandblockEnvCellsStaticScopePayload["envCells"][number]["staticObjectSeeds"][number];
	readonly bvhItemIndex: number;
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

export interface StaticSceneQuerySnapshot {
	readonly landblockBucketCount: number;
	readonly terrainLandblockCount: number;
	readonly terrainRecordCount: number;
	readonly outdoorRecordCount: number;
	readonly envCellRecordCount: number;
	readonly envCellLandblockCount: number;
}

export interface StaticSceneQuerySourcePayloadOptions {
	readonly outdoorAnchorLandblockId?: number | null;
}

export interface StaticSceneQueryRetainedScope {
	readonly domain: StaticDomain;
	readonly landblockId: number;
}

interface StaticSceneVec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

type TerrainBvh = TerrainStaticScopePayload["sourceSpatial"]["terrainBvh"];
type BvhNode =
	| NonNullable<
			OutdoorStaticObjectsScopePayload["sourceSpatial"]["outdoorBvh"]
	  >["nodes"][number]
	| TerrainBvh["nodes"][number]
	| LandblockEnvCellsStaticScopePayload["residencySpatial"]["landblockEnvCellBvh"]["nodes"][number]
	| LandblockEnvCellsStaticScopePayload["envCells"][number]["localSpatial"]["localBvh"]["nodes"][number];

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
	readonly acceptedEnvCellIds: readonly number[];
	readonly envCellId: number;
	readonly landblockId: number;
	readonly placement: StaticPlacementTransform;
	readonly nodes: readonly BvhNode[];
	readonly items: readonly (EnvCellBvhRuntimeItem | null)[];
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

type EnvCellBvhRuntimeItem =
	| {
			readonly kind: "static";
			readonly bvhItemIndex: number;
			readonly seed: EnvCellStaticSeedRuntimeRecord;
	  }
	| {
			readonly kind: "cell-structure-geometry" | "portal";
			readonly bvhItemIndex: number;
			readonly sourceItem: unknown;
	  };

interface EnvCellStaticSeedRuntimeRecord {
	readonly bounds: StaticBounds;
	readonly envCellId: number;
	readonly seed: LandblockEnvCellsStaticScopePayload["envCells"][number]["staticObjectSeeds"][number];
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

	retainScopes(scopes: readonly StaticSceneQueryRetainedScope[]): void {
		const terrainLandblockIds = new Set(
			scopes
				.filter((scope) => scope.domain === "outdoor-terrain")
				.map((scope) => scope.landblockId),
		);
		const outdoorRootKeys = new Set(
			scopes
				.filter(
					(
						scope,
					): scope is StaticSceneQueryRetainedScope & {
						readonly domain: OutdoorStaticObjectsScopePayload["domain"];
					} =>
						scope.domain === "outdoor-buildings" ||
						scope.domain === "outdoor-detail",
				)
				.map((scope) => createOutdoorRootKey(scope.domain, scope.landblockId)),
		);
		const envCellLandblockIds = new Set(
			scopes
				.filter((scope) => scope.domain === "landblock-env-cells")
				.map((scope) => scope.landblockId),
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
		this.#rebuildLandblockGridIndex();
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
		const acceptedEnvCellIds = new Set(payload.acceptedEnvCellIds);
		const cellsByEnvCellId = new Map<number, EnvCellBvhRoot>();

		for (const envCell of payload.envCells) {
			const envCellId = envCell.identity.envCellId;
			if (acceptedEnvCellIds.size > 0 && !acceptedEnvCellIds.has(envCellId)) {
				continue;
			}

			const seedsByInstanceId = new Map(
				envCell.staticObjectSeeds.flatMap(
					(seed): [string, EnvCellStaticSeedRuntimeRecord][] => {
						if (!seed.instanceBounds) {
							return [];
						}
						return [
							[
								seed.identity.instanceId,
								{
									bounds: seed.instanceBounds,
									envCellId,
									seed,
								},
							],
						];
					},
				),
			);

			const bvh = envCell.localSpatial.localBvh;
			const items = bvh.items.map(
				(item, bvhItemIndex): EnvCellBvhRuntimeItem | null => {
					if (item.kind === "static") {
						const seed = seedsByInstanceId.get(item.instanceId);
						if (seed) {
							return {
								bvhItemIndex,
								kind: "static",
								seed,
							};
						}
						return null;
					}

					return {
						bvhItemIndex,
						kind: item.kind,
						sourceItem: item,
					};
				},
			);
			cellsByEnvCellId.set(envCellId, {
				acceptedEnvCellIds: payload.acceptedEnvCellIds,
				envCellId,
				items,
				landblockId: payload.landblock.landblockId,
				nodes: bvh.nodes,
				placement: envCell.localPlacement,
			});
		}

		const landblockBvh = payload.residencySpatial.landblockEnvCellBvh;
		if (landblockBvh.nodes.length === 0) {
			this.#envCellRootsByLandblockId.delete(payload.landblock.landblockId);
			this.#landblockGridIndex.deleteEnvCellRoot(payload.landblock.landblockId);
			return;
		}
		const items = landblockBvh.items.map((item) =>
			cellsByEnvCellId.has(item.identity.envCellId)
				? {
						bounds: item.bounds,
						envCellId: item.identity.envCellId,
						memberId: item.memberId,
						source: item.source,
					}
				: null,
		);

		const root = {
			acceptedEnvCellIds: payload.acceptedEnvCellIds,
			cellsByEnvCellId,
			items,
			landblockId: payload.landblock.landblockId,
			nodes: landblockBvh.nodes,
		};
		this.#envCellRootsByLandblockId.set(payload.landblock.landblockId, root);
		this.#landblockGridIndex.upsertEnvCellRoot(root);
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
				item?.kind === "static" &&
				item.seed.seed.identity.instanceId === options.instanceId
			) {
				return {
					bvhItemIndex: item.bvhItemIndex,
					envCellId: options.envCellId,
					instanceId: options.instanceId,
					landblockId: options.landblockId,
					seed: item.seed.seed,
				};
			}
		}

		return null;
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

		const landblockRoot = this.#envCellRootsByLandblockId.get(
			selectionKey.landblockId,
		);
		const root = landblockRoot?.cellsByEnvCellId.get(selectionKey.envCellId);
		if (!root) {
			return null;
		}

		for (const item of root.items) {
			if (
				item?.kind === "static" &&
				item.seed.seed.identity.instanceId === selectionKey.instanceId
			) {
				return {
					bounds: transformBounds(item.seed.bounds, root.placement),
					selectionKey,
				};
			}
		}

		return null;
	}

	queryEnvCellAtPoint(options: {
		readonly acceptedEnvCellIds?: readonly number[];
		readonly landblockId: number;
		readonly point: StaticSceneVec3;
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
					acceptedEnvCellIds.has(candidate.item.envCellId),
			)
			.sort(
				(left, right) =>
					left.item.envCellId - right.item.envCellId ||
					left.nodeIndex - right.nodeIndex,
			);

		return candidates[0]?.item.envCellId ?? null;
	}

	createSnapshot(): StaticSceneQuerySnapshot {
		let envCellRecordCount = 0;
		for (const root of this.#envCellRootsByLandblockId.values()) {
			for (const cellRoot of root.cellsByEnvCellId.values()) {
				envCellRecordCount += cellRoot.items.filter(
					(item) => item?.kind === "static",
				).length;
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
		let nearestHit: EnvCellStaticScenePickHit | null = null;

		traverseBvhNearest(landblockRoot.nodes, ray, {
			getMaxDistance: () => nearestHit?.distance ?? null,
			visitCandidate: (broadCandidate) => {
				for (const landblockItemIndex of broadCandidate.itemIndices) {
					const landblockItem = landblockRoot.items[landblockItemIndex];
					if (
						!landblockItem ||
						!acceptedEnvCellIds.has(landblockItem.envCellId)
					) {
						continue;
					}
					const root = landblockRoot.cellsByEnvCellId.get(
						landblockItem.envCellId,
					);
					if (!root) {
						continue;
					}
					const hit = this.#pickEnvCellLocalRoot(
						ray,
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

		return nearestHit ? [nearestHit] : [];
	}

	#pickEnvCellLocalRoot(
		ray: StaticSceneRay,
		request: StaticScenePickRequest,
		root: EnvCellBvhRoot,
		currentNearestHit: EnvCellStaticScenePickHit | null,
	): EnvCellStaticScenePickHit | null {
		let nearestHit = currentNearestHit;
		const localRay = transformRayToLocal(ray, root.placement);
		traverseBvhNearest(root.nodes, localRay, {
			getMaxDistance: () => nearestHit?.distance ?? null,
			visitCandidate: (candidate) => {
				for (const itemIndex of candidate.itemIndices) {
					const item = root.items[itemIndex];
					if (item?.kind !== "static") {
						continue;
					}

					const distance = intersectRayBounds(localRay, item.seed.bounds);
					if (distance === null) {
						continue;
					}

					const hit: EnvCellStaticScenePickHit = {
						bounds: transformBounds(item.seed.bounds, root.placement),
						distance,
						hitPoint: pointOnRay(ray, distance),
						kind: "static-scene-pick-hit",
						selectionKey: createEnvCellStaticObjectSelectionKey({
							envCellId: item.seed.envCellId,
							instanceId: item.seed.seed.identity.instanceId,
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
	if (!bucket.terrainRoot && outdoorRoots.length === 0) {
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
	point: StaticSceneVec3,
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
	rayOrigin: StaticSceneVec3,
): boolean {
	return (
		(!filters?.itemKinds ||
			filters.itemKinds.includes(hit.selectionKey.itemKind)) &&
		(!filters?.domains || filters.domains.includes(hit.selectionKey.domain)) &&
		(!filters?.ignoreContainingOrigin || !containsPoint(hit.bounds, rayOrigin))
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

function containsPoint(bounds: StaticBounds, point: StaticSceneVec3): boolean {
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
	point: StaticSceneVec3,
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

function pointOnRay(ray: StaticSceneRay, distance: number): StaticSceneVec3 {
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

function transformRayToLocal(
	ray: StaticSceneRay,
	placement: StaticPlacementTransform,
): StaticSceneRay {
	const translatedOrigin = {
		x: ray.origin.x - placement.origin.x,
		y: ray.origin.y - placement.origin.y,
		z: ray.origin.z - placement.origin.z,
	};
	return {
		direction: rotateVec3ByInverseQuaternion(
			ray.direction,
			placement.orientation,
		),
		origin: rotateVec3ByInverseQuaternion(
			translatedOrigin,
			placement.orientation,
		),
	};
}

function transformBounds(
	bounds: StaticBounds,
	placement: StaticPlacementTransform,
): StaticBounds {
	const corners: StaticSceneVec3[] = [];
	for (const x of [bounds.min.x, bounds.max.x]) {
		for (const y of [bounds.min.y, bounds.max.y]) {
			for (const z of [bounds.min.z, bounds.max.z]) {
				const rotated = rotateVec3ByQuaternion(
					{ x, y, z },
					placement.orientation,
				);
				corners.push({
					x: rotated.x + placement.origin.x,
					y: rotated.y + placement.origin.y,
					z: rotated.z + placement.origin.z,
				});
			}
		}
	}

	return boundsFromPoints(corners);
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

function boundsFromPoints(points: readonly StaticSceneVec3[]): StaticBounds {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		minZ = Math.min(minZ, point.z);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
		maxZ = Math.max(maxZ, point.z);
	}

	return {
		max: { x: maxX, y: maxY, z: maxZ },
		min: { x: minX, y: minY, z: minZ },
	};
}

function rotateVec3ByQuaternion(
	vector: StaticVec3,
	quaternion: StaticPlacementTransform["orientation"],
): StaticSceneVec3 {
	const qx = quaternion.x;
	const qy = quaternion.y;
	const qz = quaternion.z;
	const qw = quaternion.w;
	const ix = qw * vector.x + qy * vector.z - qz * vector.y;
	const iy = qw * vector.y + qz * vector.x - qx * vector.z;
	const iz = qw * vector.z + qx * vector.y - qy * vector.x;
	const iw = -qx * vector.x - qy * vector.y - qz * vector.z;

	return {
		x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
		y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
		z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
	};
}

function rotateVec3ByInverseQuaternion(
	vector: StaticVec3,
	quaternion: StaticPlacementTransform["orientation"],
): StaticSceneVec3 {
	return rotateVec3ByQuaternion(vector, {
		w: quaternion.w,
		x: -quaternion.x,
		y: -quaternion.y,
		z: -quaternion.z,
	});
}

function normalizeVec3(vector: StaticSceneVec3): StaticSceneVec3 {
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
