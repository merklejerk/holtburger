import type {
	LandblockEnvCellsStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
	StaticAuthoredDynamicSeedRecord,
	StaticPortalProjectionRecord,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticPortalApertureResource,
	StaticScopePayload,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticResourceKey,
	LayerOwnerKey,
	TerrainStaticScopePayload,
	StaticVisibilityRecord,
} from "../static/contracts";
import type { EnvCellSystemLayerPayload } from "../renderer/types";
import { createOutdoorLandblockRootTranslation } from "./static-placement";
import type {
	EnvCellPortalScenePickDetails,
	EnvCellStaticScenePickDetails,
	OutdoorStaticObjectScenePickDetails,
	OutdoorStaticObjectSourceDiagnostics,
	RetainedOutdoorSourceLandblock,
	StaticSceneCameraResidency,
	StaticSceneCommittedEnvCellRecords,
	StaticSceneEnvCellAabbDebugBounds,
	StaticSceneEnvCellBounds,
	StaticScenePickHit,
	StaticScenePickRequest,
	StaticSceneQueryOverviewSnapshot,
	StaticSceneQuerySnapshot,
	StaticSceneQuerySourcePayloadOptions,
	StaticSceneSelectionDebugBounds,
	StaticSceneSelectionKey,
	StaticSceneTerrainLandblockBounds,
	TerrainQuadScenePickDetails,
	Vec3,
} from "./scene-query/contracts";
import { EnvCellCommittedRecordStore } from "./scene-query/env-cell-committed-records";
import { queryEnvCellPortalPickTarget } from "./scene-query/env-cell-portal-picking";
import { EnvCellResidencyQuery } from "./scene-query/env-cell-residency";
import { LandblockGridSpatialIndex } from "./scene-query/landblock-grid-spatial-index";
import {
	createOutdoorRootKey,
	createOutdoorSourceDiagnosticsRoot,
	parseOutdoorRootKeyLandblockId,
	queryEnvCellAabbDebugBounds,
	queryEnvCellBounds,
	queryEnvCellStaticObjectDetails,
	queryOutdoorStaticObjectDetails,
	queryOutdoorStaticObjectSourceDiagnostics,
	querySelectionDebugBounds,
	queryTerrainLandblockBounds,
	queryTerrainQuadDetails,
	type StaticSelectionDebugState,
} from "./scene-query/static-selection-debug";
import { pickStaticSceneRay } from "./scene-query/static-picking";
import type {
	OutdoorSourceDiagnosticsRoot,
	OutdoorStaticBvhRoot,
	OutdoorStaticBvhRuntimeItem,
	TerrainBvhRoot,
	TerrainBvhRuntimeItem,
} from "./scene-query/static-query-state";

export class StaticSceneQuery {
	#outdoorAnchorLandblockId: number | null = null;
	readonly #envCellCommittedRecords = new EnvCellCommittedRecordStore();
	readonly #envCellResidency = new EnvCellResidencyQuery();
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

	retainLayerOwners(layerOwners: readonly LayerOwnerKey[]): void {
		const terrainLandblockIds = new Set(
			layerOwners
				.filter((owner) => owner.kind === "terrain")
				.map((owner) => owner.landblockId),
		);
		const outdoorRootKeys = new Set(
			layerOwners
				.map((owner) => createOutdoorDomainRetentionRootKey(owner))
				.filter((key): key is string => key !== null),
		);
		this.#envCellCommittedRecords.retainLayerOwners(
			layerOwners.filter((owner) => owner.kind === "env-cell-system"),
			this.#outdoorAnchorLandblockId,
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
		this.#rebuildLandblockGridIndex();
	}

	applyStaticSpatialRecords(options: {
		readonly records: readonly StaticSpatialRecord[];
	}): void {
		this.applyStaticPeerRecords({
			spatialRecords: options.records,
		});
	}

	removeStaticResources(resources: readonly StaticResourceKey[]): void {
		this.#envCellCommittedRecords.removeStaticResources(
			resources,
			this.#outdoorAnchorLandblockId,
		);
		this.#rebuildLandblockGridIndex();
	}

	hasCommittedPortalInteriorScene(options: {
		readonly landblockId: number;
	}): boolean {
		return this.#envCellCommittedRecords.hasCommittedPortalInteriorScene(
			options,
		);
	}

	applyStaticPeerRecords(options: {
		readonly authoredDynamicSeeds?: readonly StaticAuthoredDynamicSeedRecord[];
		readonly portalGraphs?: readonly StaticPortalGraphRecord[];
		readonly portalInteriorRecords?: readonly StaticPortalInteriorRecord[];
		readonly sourceMappings?: readonly StaticSourceMappingRecord[];
		readonly spatialRecords?: readonly StaticSpatialRecord[];
		readonly visibilityRecords?: readonly StaticVisibilityRecord[];
	}): void {
		this.#envCellCommittedRecords.applyStaticPeerRecords({
			...options,
			outdoorAnchorLandblockId: this.#outdoorAnchorLandblockId,
		});
		this.#rebuildLandblockGridIndex();
	}

	setEnvCellSystemLayer(payload: EnvCellSystemLayerPayload | null): void {
		this.#envCellCommittedRecords.setEnvCellSystemLayer(
			payload,
			this.#outdoorAnchorLandblockId,
		);
		this.#rebuildLandblockGridIndex();
	}

	clearEnvCellSystemLayer(landblockId: number): void {
		this.#envCellCommittedRecords.clearEnvCellSystemLayer(
			landblockId,
			this.#outdoorAnchorLandblockId,
		);
		this.#rebuildLandblockGridIndex();
	}

	queryEnvCellSystemLayers(): readonly EnvCellSystemLayerPayload[] {
		return this.#envCellCommittedRecords.queryEnvCellSystemLayers();
	}

	queryPortalApertureResources(options: {
		readonly landblockId: number;
	}): readonly StaticPortalApertureResource[] {
		return this.#envCellCommittedRecords.queryPortalApertureResources(options);
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
		return pickStaticSceneRay(
			{
				envCellCommittedRecords: this.#envCellCommittedRecords,
				landblockGridIndex: this.#landblockGridIndex,
				outdoorAnchorLandblockId: this.#outdoorAnchorLandblockId,
			},
			request,
		);
	}

	queryOutdoorStaticObjectDetails(options: {
		readonly domain: OutdoorStaticObjectsScopePayload["domain"];
		readonly landblockId: number;
		readonly instanceId: string;
	}): OutdoorStaticObjectScenePickDetails | null {
		return queryOutdoorStaticObjectDetails(
			this.#selectionDebugState(),
			options,
		);
	}

	queryOutdoorStaticObjectSourceDiagnostics(options: {
		readonly domain: OutdoorStaticObjectsScopePayload["domain"];
		readonly landblockId: number;
		readonly instanceId: string;
	}): OutdoorStaticObjectSourceDiagnostics | null {
		return queryOutdoorStaticObjectSourceDiagnostics(
			this.#selectionDebugState(),
			options,
		);
	}

	queryEnvCellStaticObjectDetails(options: {
		readonly landblockId: number;
		readonly envCellId: number;
		readonly instanceId: string;
	}): EnvCellStaticScenePickDetails | null {
		return queryEnvCellStaticObjectDetails(
			this.#selectionDebugState(),
			options,
		);
	}

	queryPortalInteriorRecords(
		options: {
			readonly landblockId?: number;
		} = {},
	): readonly StaticPortalInteriorRecord[] {
		return this.#envCellCommittedRecords.queryPortalInteriorRecords(options);
	}

	queryPortalGraphs(
		options: {
			readonly landblockId?: number;
		} = {},
	): readonly StaticPortalGraphRecord[] {
		return this.#envCellCommittedRecords.queryPortalGraphs(options);
	}

	queryOutdoorPortalProjection(options: {
		readonly landblockId: number;
	}): StaticPortalProjectionRecord | null {
		return this.#envCellCommittedRecords.queryOutdoorPortalProjection(options);
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
		for (const landblockId of this.#envCellCommittedRecords.queryEnvCellSystemLayerLandblockIds()) {
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
					envCells:
						this.#envCellCommittedRecords.hasEnvCellSystemLayer(landblockId),
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
				(projection): projection is StaticPortalProjectionRecord =>
					projection !== null,
			)
			.sort((left, right) => left.landblockId - right.landblockId);
	}

	queryEnvCellPortalProjection(options: {
		readonly landblockId: number;
		readonly startEnvCellId: number;
	}): StaticPortalProjectionRecord | null {
		return this.#envCellCommittedRecords.queryEnvCellPortalProjection(options);
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

	#selectionDebugState(): StaticSelectionDebugState {
		return {
			envCellCommittedRecords: this.#envCellCommittedRecords,
			outdoorBvhRootsByDomainAndLandblock:
				this.#outdoorBvhRootsByDomainAndLandblock,
			outdoorSourceDiagnosticsByDomainAndLandblock:
				this.#outdoorSourceDiagnosticsByDomainAndLandblock,
			terrainBvhRootsByLandblockId: this.#terrainBvhRootsByLandblockId,
		};
	}

	queryTerrainQuadDetails(options: {
		readonly landblockId: number;
		readonly quadIndex: number;
	}): TerrainQuadScenePickDetails | null {
		return queryTerrainQuadDetails(this.#selectionDebugState(), options);
	}

	queryTerrainLandblockBounds(options: {
		readonly landblockId: number;
	}): StaticSceneTerrainLandblockBounds | null {
		return queryTerrainLandblockBounds(this.#selectionDebugState(), options);
	}

	queryEnvCellPortalDetails(
		selectionKey: StaticSceneSelectionKey & {
			readonly itemKind: "env-cell-portal";
		},
	): EnvCellPortalScenePickDetails | null {
		const target = queryEnvCellPortalPickTarget({
			envCellCommittedRecords: this.#envCellCommittedRecords,
			outdoorAnchorLandblockId: this.#outdoorAnchorLandblockId,
			selectionKey,
		});
		return target === null
			? null
			: {
					envCellId: selectionKey.envCellId,
					landblockId: selectionKey.landblockId,
					portal: target.portal,
					portalAperture: target.portalAperture,
				};
	}

	querySelectionDebugBounds(
		selectionKey: StaticSceneSelectionKey,
	): StaticSceneSelectionDebugBounds | null {
		if (selectionKey.itemKind === "env-cell-portal") {
			const target = queryEnvCellPortalPickTarget({
				envCellCommittedRecords: this.#envCellCommittedRecords,
				outdoorAnchorLandblockId: this.#outdoorAnchorLandblockId,
				selectionKey,
			});
			return target === null ? null : { bounds: target.bounds, selectionKey };
		}

		return querySelectionDebugBounds(this.#selectionDebugState(), selectionKey);
	}

	queryEnvCellAtPoint(options: {
		readonly acceptedEnvCellIds?: readonly number[];
		readonly landblockId: number;
		readonly point: Vec3;
	}): number | null {
		return this.#envCellResidency.queryEnvCellAtPoint(
			this.#envCellCommittedRecords,
			options,
		);
	}

	queryEnvCellBounds(options: {
		readonly envCellId: number;
		readonly landblockId: number;
	}): StaticSceneEnvCellBounds | null {
		return queryEnvCellBounds(this.#selectionDebugState(), options);
	}

	queryEnvCellAabbDebugBounds(options?: {
		readonly landblockId?: number | null;
	}): readonly StaticSceneEnvCellAabbDebugBounds[] {
		return queryEnvCellAabbDebugBounds(this.#selectionDebugState(), options);
	}

	queryCameraResidencyAtPoint(options: {
		readonly outdoorAnchorLandblockId: number;
		readonly point: Vec3;
	}): StaticSceneCameraResidency {
		return this.#envCellResidency.queryCameraResidencyAtPoint(
			this.#envCellCommittedRecords,
			options,
		);
	}

	queryCameraResidencyAtLandblockPoint(options: {
		readonly landblockId: number;
		readonly point: Vec3;
	}): StaticSceneCameraResidency {
		return this.#envCellResidency.queryCameraResidencyAtLandblockPoint(
			this.#envCellCommittedRecords,
			options,
		);
	}

	queryCommittedEnvCellRecords(options: {
		readonly landblockId: number;
	}): StaticSceneCommittedEnvCellRecords | null {
		return this.#envCellCommittedRecords.queryCommittedEnvCellRecords(options);
	}

	createSnapshot(): StaticSceneQuerySnapshot {
		let envCellRecordCount = 0;
		for (const root of this.#envCellCommittedRecords.envCellRoots()) {
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

		const committedSnapshot = this.#envCellCommittedRecords.snapshot();
		const residencySnapshot = this.#envCellResidency.snapshot();
		return {
			landblockBucketCount: this.#landblockGridIndex.bucketCount,
			committedEnvCellLandblockCount:
				committedSnapshot.committedEnvCellLandblockCount,
			committedEnvCellPortalGraphRecordCount:
				committedSnapshot.committedEnvCellPortalGraphRecordCount,
			committedEnvCellPortalInteriorRecordCount:
				committedSnapshot.committedEnvCellPortalInteriorRecordCount,
			committedEnvCellSourceMappingRecordCount:
				committedSnapshot.committedEnvCellSourceMappingRecordCount,
			committedEnvCellSpatialRecordCount:
				committedSnapshot.committedEnvCellSpatialRecordCount,
			committedEnvCellVisibilityRecordCount:
				committedSnapshot.committedEnvCellVisibilityRecordCount,
			envCellResidencyBspAcceptedCandidateCount:
				residencySnapshot.envCellResidencyBspAcceptedCandidateCount,
			envCellResidencyBspFallbackCount:
				residencySnapshot.envCellResidencyBspFallbackCount,
			envCellResidencyBspTestedCandidateCount:
				residencySnapshot.envCellResidencyBspTestedCandidateCount,
			envCellResidencyCoarseCandidateCount:
				residencySnapshot.envCellResidencyCoarseCandidateCount,
			envCellLandblockCount: committedSnapshot.envCellLandblockCount,
			envCellRecordCount,
			outdoorRecordCount: outdoorBvhRecordCount,
			terrainLandblockCount: this.#terrainBvhRootsByLandblockId.size,
			terrainRecordCount,
		};
	}

	createOverviewSnapshot(): StaticSceneQueryOverviewSnapshot {
		let envCellRecordCount = 0;
		for (const root of this.#envCellCommittedRecords.envCellRoots()) {
			for (const cellRoot of root.cellsByEnvCellId.values()) {
				envCellRecordCount += cellRoot.items.length;
			}
		}

		const outdoorRecordCount = [
			...this.#outdoorBvhRootsByDomainAndLandblock.values(),
		].reduce((count, root) => count + root.items.filter(Boolean).length, 0);

		return {
			envCellLandblockCount:
				this.#envCellCommittedRecords.envCellLandblockCount(),
			envCellRecordCount,
			outdoorRecordCount,
		};
	}

	clear(): void {
		this.#outdoorAnchorLandblockId = null;
		this.#landblockGridIndex.clear();
		this.#terrainBvhRootsByLandblockId.clear();
		this.#outdoorBvhRootsByDomainAndLandblock.clear();
		this.#outdoorSourceDiagnosticsByDomainAndLandblock.clear();
		this.#envCellCommittedRecords.clear();
		this.#envCellResidency.clear();
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
		this.#envCellCommittedRecords.setOutdoorAnchorLandblockId(
			outdoorAnchorLandblockId,
		);
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
		for (const root of this.#envCellCommittedRecords.envCellRoots()) {
			this.#landblockGridIndex.upsertEnvCellRoot(root);
		}
	}
}

function createOutdoorDomainRetentionRootKey(owner: LayerOwnerKey): string | null {
	switch (owner.kind) {
		case "outdoor-buildings":
		case "outdoor-explicit-objects":
		case "outdoor-generated-scenery":
			return createOutdoorRootKey(owner.kind, owner.landblockId);
		case "env-cell-system":
		case "terrain":
			return null;
	}
}
