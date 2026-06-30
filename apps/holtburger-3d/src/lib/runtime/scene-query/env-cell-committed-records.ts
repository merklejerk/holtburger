import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	invertMat4,
} from "../../math/ac-placement-transform";
import type { EnvCellSystemLayerPayload } from "../../renderer/types";
import type {
	StaticAuthoredDynamicSeedRecord,
	StaticBounds,
	StaticDomain,
	StaticEnvCellSpatialRecord,
	StaticPortalApertureResource,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticPortalProjectionRecord,
	StaticResourceKey,
	LayerOwnerKey,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticVisibilityRecord,
} from "../../static/contracts";
import { createLayerOwnerKeyId } from "../../static/layer-owners";
import { createOutdoorLandblockRootTranslation } from "../static-placement";
import type { StaticSceneCommittedEnvCellRecords } from "./contracts";
import { EnvCellPortalProjectionCache } from "./env-cell-portal-projections";
import type {
	CommittedRecordEntry,
	EnvCellBvhRoot,
	EnvCellBvhRuntimeItem,
	EnvCellInteriorPortal,
	EnvCellLandblockBvhRoot,
	EnvCellLandblockBvhRuntimeItem,
	EnvCellResidencyGraphEvidence,
	EnvCellStaticSeedRuntimeRecord,
} from "./static-query-state";

export interface EnvCellCommittedRecordSnapshot {
	readonly committedEnvCellLandblockCount: number;
	readonly committedEnvCellPortalGraphRecordCount: number;
	readonly committedEnvCellPortalInteriorRecordCount: number;
	readonly committedEnvCellSourceMappingRecordCount: number;
	readonly committedEnvCellSpatialRecordCount: number;
	readonly committedEnvCellVisibilityRecordCount: number;
	readonly envCellLandblockCount: number;
}

/** Owns committed env-cell records and the runtime roots derived from them. */
export class EnvCellCommittedRecordStore {
	readonly #authoredDynamicSeedRecordsByKey = new Map<
		string,
		CommittedRecordEntry<StaticAuthoredDynamicSeedRecord>
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
	readonly #envCellSystemLayersByLandblockId = new Map<
		number,
		EnvCellSystemLayerPayload
	>();
	readonly #portalInteriorRecordsByKey = new Map<
		string,
		CommittedRecordEntry<StaticPortalInteriorRecord>
	>();
	readonly #portalGraphsByKey = new Map<
		string,
		CommittedRecordEntry<StaticPortalGraphRecord>
	>();
	readonly #portalProjectionCache = new EnvCellPortalProjectionCache();
	readonly #sourceMappingsByKey = new Map<
		string,
		CommittedRecordEntry<StaticSourceMappingRecord>
	>();
	readonly #spatialRecordsByKey = new Map<
		string,
		CommittedRecordEntry<StaticSpatialRecord>
	>();
	readonly #visibilityRecordsByKey = new Map<
		string,
		CommittedRecordEntry<StaticVisibilityRecord>
	>();

	applyStaticPeerRecords(options: {
		readonly authoredDynamicSeeds?: readonly StaticAuthoredDynamicSeedRecord[];
		readonly outdoorAnchorLandblockId: number | null;
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
		this.rebuildRoots(options.outdoorAnchorLandblockId);
	}

	clear(): void {
		this.#authoredDynamicSeedRecordsByKey.clear();
		this.#envCellRootsByLandblockId.clear();
		this.#envCellStaticBoundsOverridesByKey.clear();
		this.#envCellSystemLayersByLandblockId.clear();
		this.#portalInteriorRecordsByKey.clear();
		this.#portalGraphsByKey.clear();
		this.#portalProjectionCache.clear();
		this.#sourceMappingsByKey.clear();
		this.#spatialRecordsByKey.clear();
		this.#visibilityRecordsByKey.clear();
	}

	clearEnvCellSystemLayer(
		landblockId: number,
		outdoorAnchorLandblockId: number | null,
	): void {
		const normalizedLandblockId = landblockId >>> 0;
		this.#clearEnvCellSystemLayerRecords(normalizedLandblockId);
		this.rebuildRoots(outdoorAnchorLandblockId);
		this.#portalProjectionCache.invalidateLandblock(normalizedLandblockId);
	}

	envCellRoot(landblockId: number): EnvCellLandblockBvhRoot | null {
		return this.#envCellRootsByLandblockId.get(landblockId) ?? null;
	}

	envCellRoots(): Iterable<EnvCellLandblockBvhRoot> {
		return this.#envCellRootsByLandblockId.values();
	}

	getAcceptedEnvCellIds(landblockId: number): readonly number[] | null {
		const acceptedEnvCellIds = new Set<number>();
		for (const entry of this.#visibilityRecordsByKey.values()) {
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

	getEnvCellStaticSeedBounds(
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

	hasCommittedEnvCellRecords(landblockId: number): boolean {
		for (const recordsByKey of [
			this.#spatialRecordsByKey,
			this.#visibilityRecordsByKey,
			this.#portalInteriorRecordsByKey,
			this.#portalGraphsByKey,
			this.#sourceMappingsByKey,
		]) {
			for (const entry of recordsByKey.values()) {
				if (
					getCommittedRecordDomain(entry.record) === "env-cell-system" &&
					getCommittedRecordLandblockId(entry.record) === landblockId
				) {
					return true;
				}
			}
		}
		return false;
	}

	hasCommittedPortalInteriorScene(options: {
		readonly landblockId: number;
	}): boolean {
		for (const entry of this.#portalGraphsByKey.values()) {
			if (entry.record.landblockId === options.landblockId) {
				return true;
			}
		}
		for (const entry of this.#portalInteriorRecordsByKey.values()) {
			if (entry.record.landblockId === options.landblockId) {
				return true;
			}
		}
		return false;
	}

	queryCommittedEnvCellRecords(options: {
		readonly landblockId: number;
	}): StaticSceneCommittedEnvCellRecords | null {
		const portalInteriorRecords = collectCommittedRecordsByLandblock(
			this.#portalInteriorRecordsByKey,
			options.landblockId,
		);
		const portalGraphs = collectCommittedRecordsByLandblock(
			this.#portalGraphsByKey,
			options.landblockId,
		);
		const sourceMappings = collectCommittedRecordsByLandblock(
			this.#sourceMappingsByKey,
			options.landblockId,
		);
		const spatialRecords = collectCommittedRecordsByLandblock(
			this.#spatialRecordsByKey,
			options.landblockId,
		);
		const visibilityRecords = collectCommittedRecordsByLandblock(
			this.#visibilityRecordsByKey,
			options.landblockId,
		);
		const authoredDynamicSeeds = collectCommittedRecordsByLandblock(
			this.#authoredDynamicSeedRecordsByKey,
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

	queryEnvCellSystemLayers(): readonly EnvCellSystemLayerPayload[] {
		return [...this.#envCellSystemLayersByLandblockId.values()].sort(
			(left, right) => left.landblockId - right.landblockId,
		);
	}

	queryEnvCellSystemLayerLandblockIds(): readonly number[] {
		return [...this.#envCellSystemLayersByLandblockId.keys()].sort(
			(left, right) => left - right,
		);
	}

	hasEnvCellSystemLayer(landblockId: number): boolean {
		return this.#envCellSystemLayersByLandblockId.has(landblockId >>> 0);
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

	queryPortalApertureResources(options: {
		readonly landblockId: number;
	}): readonly StaticPortalApertureResource[] {
		return (
			this.#envCellSystemLayersByLandblockId.get(options.landblockId >>> 0)
				?.portalApertureResources ?? []
		);
	}

	queryPortalGraphs(
		options: {
			readonly landblockId?: number;
		} = {},
	): readonly StaticPortalGraphRecord[] {
		return [...this.#portalGraphsByKey.values()]
			.map((entry) => entry.record)
			.filter(
				(record) =>
					options.landblockId === undefined ||
					record.landblockId === options.landblockId,
			)
			.sort((left, right) => left.landblockId - right.landblockId);
	}

	queryPortalInteriorRecords(
		options: {
			readonly landblockId?: number;
		} = {},
	): readonly StaticPortalInteriorRecord[] {
		return [...this.#portalInteriorRecordsByKey.values()]
			.map((entry) => entry.record)
			.filter(
				(record) =>
					options.landblockId === undefined ||
					record.landblockId === options.landblockId,
			)
			.sort((left, right) => left.landblockId - right.landblockId);
	}

	queryEnvCellPortalProjection(options: {
		readonly landblockId: number;
		readonly startEnvCellId: number;
	}): StaticPortalProjectionRecord | null {
		const landblockId = options.landblockId >>> 0;
		return this.#portalProjectionCache.query({
			landblockId,
			portalApertureResources: this.queryPortalApertureResources({
				landblockId,
			}),
			portalGraphs: this.queryPortalGraphs({ landblockId }),
			portalInteriorRecords: this.queryPortalInteriorRecords({ landblockId }),
			startEnvCellId: options.startEnvCellId >>> 0,
		});
	}

	removeStaticResources(
		resources: readonly StaticResourceKey[],
		outdoorAnchorLandblockId: number | null,
	): void {
		const removedDrawUnitResourceIds = new Set(
			resources.flatMap((resource) =>
				resource.kind === "draw-unit" ? [resource.drawUnitId] : [],
			),
		);
		if (removedDrawUnitResourceIds.size > 0) {
			this.#deleteDrawUnitOwnedCommittedRecords(removedDrawUnitResourceIds);
			this.rebuildRoots(outdoorAnchorLandblockId);
		}
	}

	retainLayerOwners(
		layerOwners: readonly LayerOwnerKey[],
		outdoorAnchorLandblockId: number | null,
	): void {
		this.#pruneCommittedRecordsByRetainedLayerOwners(layerOwners);
		const retainedLandblockIds = new Set(
			layerOwners
				.filter((owner) => owner.kind === "env-cell-system")
				.map((owner) => owner.landblockId),
		);
		for (const key of this.#envCellStaticBoundsOverridesByKey.keys()) {
			const landblockId = parseEnvCellStaticObjectBoundsKeyLandblockId(key);
			const retained =
				landblockId !== null && retainedLandblockIds.has(landblockId);
			if (landblockId !== null && !retained) {
				this.#envCellStaticBoundsOverridesByKey.delete(key);
			}
		}
		this.rebuildRoots(outdoorAnchorLandblockId);
	}

	rebuildRoots(outdoorAnchorLandblockId: number | null): void {
		const rootsByLandblock = new Map<number, EnvCellLandblockBvhRoot>();
		const spatialRecordsByLandblock = groupEnvCellSpatialRecordsByLandblock(
			this.#spatialRecordsByKey,
		);
		const seedsByLandblockAndEnvCell = groupEnvCellSeedsByLandblockAndEnvCell(
			this.#authoredDynamicSeedRecordsByKey,
		);

		for (const [landblockId, spatialRecords] of spatialRecordsByLandblock) {
			const residencyBvh = spatialRecords[0]?.residencyBvh;
			if (!residencyBvh || residencyBvh.nodes.length === 0) {
				continue;
			}
			const spatialRecordsByEnvCellId = new Map(
				spatialRecords.map((record) => [record.envCellId, record]),
			);
			const graphEvidenceByEnvCellId =
				this.#deriveCommittedEnvCellResidencyGraphEvidence(
					landblockId,
					spatialRecordsByEnvCellId,
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
			const items = residencyBvh.items.map((item) => {
				const spatialRecord = spatialRecordsByEnvCellId.get(
					item.identity.envCellId,
				);
				return spatialRecord
					? {
							bounds: item.bounds,
							cellBsp: spatialRecord.cellBsp,
							envCellId: item.identity.envCellId,
							graphEvidence:
								graphEvidenceByEnvCellId.get(item.identity.envCellId) ??
								createEmptyEnvCellResidencyGraphEvidence(),
							inverseCellRenderMatrix: createInverseEnvCellRenderMatrix(
								spatialRecord.localPlacement,
							),
							localPlacement: spatialRecord.localPlacement,
							memberId: item.memberId,
							source: item.source,
						}
					: null;
			});

			rootsByLandblock.set(landblockId, {
				acceptedEnvCellIds:
					this.getAcceptedEnvCellIds(landblockId) ??
					spatialRecords.map((record) => record.envCellId),
				cellsByEnvCellId,
				items,
				landblockId,
				nodes: residencyBvh.nodes,
				translation: createOutdoorLandblockRootTranslation(
					landblockId,
					outdoorAnchorLandblockId,
				),
			});
		}

		this.#envCellRootsByLandblockId.clear();
		for (const [landblockId, root] of rootsByLandblock) {
			this.#envCellRootsByLandblockId.set(landblockId, root);
		}
	}

	setEnvCellSystemLayer(
		payload: EnvCellSystemLayerPayload | null,
		outdoorAnchorLandblockId: number | null,
	): void {
		if (!payload) {
			return;
		}
		const landblockId = payload.landblockId >>> 0;
		this.#clearEnvCellSystemLayerRecords(landblockId);
		this.#envCellSystemLayersByLandblockId.set(landblockId, payload);
		this.applyStaticPeerRecords({
			authoredDynamicSeeds: payload.authoredDynamicSeedRecords,
			outdoorAnchorLandblockId,
			portalGraphs: payload.portalGraphRecords,
			portalInteriorRecords: payload.portalInteriorRecords,
			sourceMappings: payload.sourceMappingRecords,
			spatialRecords: payload.spatialRecords,
			visibilityRecords: payload.visibilityRecords,
		});
		this.#portalProjectionCache.invalidateLandblock(landblockId);
	}

	setOutdoorAnchorLandblockId(outdoorAnchorLandblockId: number | null): void {
		for (const [landblockId, root] of this.#envCellRootsByLandblockId) {
			this.#envCellRootsByLandblockId.set(landblockId, {
				...root,
				translation: createOutdoorLandblockRootTranslation(
					landblockId,
					outdoorAnchorLandblockId,
				),
			});
		}
	}

	snapshot(): EnvCellCommittedRecordSnapshot {
		return {
			committedEnvCellLandblockCount: countCommittedEnvCellLandblocks([
				this.#spatialRecordsByKey,
				this.#visibilityRecordsByKey,
				this.#portalInteriorRecordsByKey,
				this.#portalGraphsByKey,
				this.#sourceMappingsByKey,
				this.#authoredDynamicSeedRecordsByKey,
			]),
			committedEnvCellPortalGraphRecordCount: this.#portalGraphsByKey.size,
			committedEnvCellPortalInteriorRecordCount:
				this.#portalInteriorRecordsByKey.size,
			committedEnvCellSourceMappingRecordCount: this.#sourceMappingsByKey.size,
			committedEnvCellSpatialRecordCount: this.#spatialRecordsByKey.size,
			committedEnvCellVisibilityRecordCount: this.#visibilityRecordsByKey.size,
			envCellLandblockCount: this.#envCellRootsByLandblockId.size,
		};
	}

	envCellLandblockCount(): number {
		return this.#envCellRootsByLandblockId.size;
	}

	#clearEnvCellSystemLayerRecords(landblockId: number): void {
		const normalizedLandblockId = landblockId >>> 0;
		this.#envCellSystemLayersByLandblockId.delete(normalizedLandblockId);
		for (const recordsByKey of [
			this.#spatialRecordsByKey,
			this.#visibilityRecordsByKey,
			this.#portalInteriorRecordsByKey,
			this.#portalGraphsByKey,
			this.#sourceMappingsByKey,
			this.#authoredDynamicSeedRecordsByKey,
		]) {
			for (const [key, entry] of recordsByKey) {
				if (
					getCommittedRecordDomain(entry.record) === "env-cell-system" &&
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

	#collectOwnerReplacementLandblockIds<
		TRecord extends {
			readonly landblockId: number;
			readonly owner: {
				readonly kind: string;
				readonly drawUnitId?: string;
				readonly domain?: StaticDomain;
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

	#deleteCommittedRecordsForOwners<
		TRecord extends {
			readonly owner: {
				readonly kind: string;
				readonly drawUnitId?: string;
				readonly domain?: StaticDomain;
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

	#deleteDrawUnitOwnedCommittedRecords(drawUnitIds: ReadonlySet<string>): void {
		const affectedPortalLandblockIds = new Set<number>();
		for (const recordsByKey of [
			this.#spatialRecordsByKey,
			this.#visibilityRecordsByKey,
			this.#portalInteriorRecordsByKey,
			this.#portalGraphsByKey,
			this.#sourceMappingsByKey,
			this.#authoredDynamicSeedRecordsByKey,
		]) {
			for (const [key, entry] of recordsByKey) {
				const owner = entry.record.owner;
				if (owner.kind === "draw-unit" && drawUnitIds.has(owner.drawUnitId)) {
					if (
						recordsByKey === this.#portalInteriorRecordsByKey ||
						recordsByKey === this.#portalGraphsByKey
					) {
						affectedPortalLandblockIds.add(
							getCommittedRecordLandblockId(entry.record) ?? 0,
						);
					}
					recordsByKey.delete(key);
				}
			}
		}
		this.#portalProjectionCache.invalidate(affectedPortalLandblockIds);
	}

	#deriveCommittedEnvCellResidencyGraphEvidence(
		landblockId: number,
		spatialRecordsByEnvCellId: ReadonlyMap<number, StaticEnvCellSpatialRecord>,
	): ReadonlyMap<number, EnvCellResidencyGraphEvidence> {
		const graphEvidenceByEnvCellId = new Map<
			number,
			EnvCellResidencyGraphEvidence
		>();
		for (const envCellId of spatialRecordsByEnvCellId.keys()) {
			graphEvidenceByEnvCellId.set(
				envCellId,
				createEmptyEnvCellResidencyGraphEvidence(),
			);
		}

		for (const entry of this.#visibilityRecordsByKey.values()) {
			const record = entry.record;
			if (
				record.kind !== "env-cell-visibility" ||
				record.landblockId !== landblockId
			) {
				continue;
			}
			for (const link of record.visibleLinks) {
				if (!spatialRecordsByEnvCellId.has(link.targetEnvCellId)) {
					continue;
				}
				incrementEnvCellGraphEvidence(
					graphEvidenceByEnvCellId,
					link.targetEnvCellId,
					"visibleListRefs",
				);
			}
		}

		const portalsByEnvCellId = new Map<
			number,
			readonly EnvCellInteriorPortal[]
		>();
		for (const entry of this.#portalInteriorRecordsByKey.values()) {
			const record = entry.record;
			if (record.landblockId !== landblockId) {
				continue;
			}
			for (const cell of record.envCells) {
				if (!spatialRecordsByEnvCellId.has(cell.envCellId)) {
					continue;
				}
				portalsByEnvCellId.set(cell.envCellId, cell.portals);
			}
		}

		for (const [sourceEnvCellId, portals] of portalsByEnvCellId) {
			for (const portal of portals) {
				const targetEnvCellId = portal.targetEnvCellId;
				if (
					portal.isOutsideTransition ||
					targetEnvCellId === null ||
					!spatialRecordsByEnvCellId.has(targetEnvCellId)
				) {
					continue;
				}

				incrementEnvCellGraphEvidence(
					graphEvidenceByEnvCellId,
					targetEnvCellId,
					"incomingEnvCellPortalRefs",
				);
				if (
					isReciprocalCommittedEnvCellPortal(
						sourceEnvCellId,
						portal,
						portalsByEnvCellId.get(targetEnvCellId) ?? [],
					)
				) {
					incrementEnvCellGraphEvidence(
						graphEvidenceByEnvCellId,
						targetEnvCellId,
						"reciprocalEnvCellPortalRefs",
					);
				}
			}
		}

		return graphEvidenceByEnvCellId;
	}

	#pruneCommittedRecordsByRetainedLayerOwners(
		layerOwners: readonly LayerOwnerKey[],
	): void {
		const retainedOwnerKeys = new Set(layerOwners.map(createLayerOwnerKeyId));
		const affectedPortalLandblockIds = new Set<number>();
		for (const recordsByKey of [
			this.#spatialRecordsByKey,
			this.#visibilityRecordsByKey,
			this.#portalInteriorRecordsByKey,
			this.#portalGraphsByKey,
			this.#sourceMappingsByKey,
		]) {
			for (const [key, entry] of recordsByKey) {
				if (!retainedOwnerKeys.has(entry.ownerKey)) {
					if (
						recordsByKey === this.#portalInteriorRecordsByKey ||
						recordsByKey === this.#portalGraphsByKey
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
		this.#portalProjectionCache.invalidate(affectedPortalLandblockIds);
	}

	#upsertCommittedAuthoredDynamicSeedRecords(
		records: readonly StaticAuthoredDynamicSeedRecord[],
	): void {
		this.#deleteCommittedRecordsForOwners(
			this.#authoredDynamicSeedRecordsByKey,
			records,
		);

		for (const record of records) {
			this.#authoredDynamicSeedRecordsByKey.set(
				createCommittedAuthoredDynamicSeedRecordKey(record),
				{
					ownerKey: createStaticPeerOwnerKey(record.owner),
					record,
				},
			);
		}
	}

	#upsertCommittedPortalGraphs(
		records: readonly StaticPortalGraphRecord[],
	): void {
		const affectedLandblockIds = this.#collectOwnerReplacementLandblockIds(
			this.#portalGraphsByKey,
			records,
		);
		for (const record of records) {
			affectedLandblockIds.add(record.landblockId >>> 0);
			this.#portalGraphsByKey.set(createCommittedPortalGraphRecordKey(record), {
				ownerKey: createStaticPeerOwnerKey(record.owner),
				record,
			});
		}
		this.#portalProjectionCache.invalidate(affectedLandblockIds);
	}

	#upsertCommittedPortalInteriorRecords(
		records: readonly StaticPortalInteriorRecord[],
	): void {
		const affectedLandblockIds = this.#collectOwnerReplacementLandblockIds(
			this.#portalInteriorRecordsByKey,
			records,
		);
		for (const record of records) {
			affectedLandblockIds.add(record.landblockId >>> 0);
			this.#portalInteriorRecordsByKey.set(
				createCommittedPortalInteriorRecordKey(record),
				{
					ownerKey: createStaticPeerOwnerKey(record.owner),
					record,
				},
			);
		}
		this.#portalProjectionCache.invalidate(affectedLandblockIds);
	}

	#upsertCommittedSourceMappings(
		records: readonly StaticSourceMappingRecord[],
	): void {
		this.#deleteCommittedRecordsForOwners(this.#sourceMappingsByKey, records);
		for (const record of records) {
			this.#sourceMappingsByKey.set(
				createCommittedSourceMappingRecordKey(record),
				{
					ownerKey: createStaticPeerOwnerKey(record.owner),
					record,
				},
			);
		}
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
		for (const [key, entry] of this.#spatialRecordsByKey) {
			if (
				replacementKeys.has(key) ||
				completeScopeOwnerKeys.has(entry.ownerKey)
			) {
				this.#spatialRecordsByKey.delete(key);
			}
		}

		for (const record of records) {
			this.#spatialRecordsByKey.set(createCommittedSpatialRecordKey(record), {
				ownerKey: createStaticPeerOwnerKey(record.owner),
				record,
			});
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
			this.#visibilityRecordsByKey,
			records,
		);
		for (const record of records) {
			this.#visibilityRecordsByKey.set(
				createCommittedVisibilityRecordKey(record),
				{
					ownerKey: createStaticPeerOwnerKey(record.owner),
					record,
				},
			);
		}
	}
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

function compareNullableNumbers(
	left: number | null,
	right: number | null,
): number {
	return (left ?? -1) - (right ?? -1);
}

function compareStrings(left: string, right: string): number {
	return left.localeCompare(right);
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
				getCommittedRecordDomain(entry.record) === "env-cell-system"
			) {
				landblockIds.add(landblockId);
			}
		}
	}
	return landblockIds.size;
}

function createCommittedAuthoredDynamicSeedRecordKey(
	record: StaticAuthoredDynamicSeedRecord,
): string {
	switch (record.kind) {
		case "env-cell-static-object-seed":
			return `env-cell-static-object-seed:${record.landblockId >>> 0}:${record.envCellId >>> 0}:${record.seed.identity.instanceId}`;
		case "env-cell-static-object-dynamic-seed":
			return `env-cell-static-object-dynamic-seed:${record.seed.landblockId >>> 0}:${record.seed.envCellId >>> 0}:${record.seed.object.instanceId}`;
		case "outdoor-static-object-dynamic-seed":
			return `outdoor-static-object-dynamic-seed:${record.seed.landblockId >>> 0}:${record.seed.domain}:${record.seed.object.instanceId}`;
	}
}

function createCommittedPortalGraphRecordKey(
	record: StaticPortalGraphRecord,
): string {
	return [
		"static-portal-graph",
		record.landblockId >>> 0,
		createStaticPeerOwnerKey(record.owner),
		createStaticPortalGraphContentKey(record),
	].join(":");
}

function createStaticPortalGraphContentKey(
	record: StaticPortalGraphRecord,
): string {
	return record.edges
		.map((edge) =>
			[
				edge.edgeId,
				edge.linkId,
				edge.sourceNodeId,
				edge.targetNodeId,
				edge.sourceIndex,
				edge.polygonId ?? "none",
			].join("/"),
		)
		.sort()
		.join("|");
}

function createCommittedPortalInteriorRecordKey(
	record: StaticPortalInteriorRecord,
): string {
	return `env-cell-portal-interior:${record.landblockId >>> 0}`;
}

function createCommittedRecordOwnerSortKey(record: unknown): string {
	if (!isRecordWithPeerOwner(record)) {
		return "";
	}
	return createStaticPeerOwnerKey(record.owner);
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
		case "env-cell-static-object-dynamic-seed":
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

function createEmptyEnvCellResidencyGraphEvidence(): EnvCellResidencyGraphEvidence {
	return {
		incomingEnvCellPortalRefs: 0,
		reciprocalEnvCellPortalRefs: 0,
		visibleListRefs: 0,
	};
}

function createEnvCellStaticObjectBoundsKey(input: {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
}): string {
	return `${input.landblockId >>> 0}:${input.envCellId >>> 0}:${input.instanceId}`;
}

function createInverseEnvCellRenderMatrix(
	localPlacement: StaticEnvCellSpatialRecord["localPlacement"],
): EnvCellLandblockBvhRuntimeItem["inverseCellRenderMatrix"] {
	return invertMat4(buildAcPlacementMatrix(localPlacement, AC_UNIT_SCALE));
}

function createStaticPeerOwnerKey(owner: {
	readonly kind: string;
	readonly drawUnitId?: string;
	readonly domain?: StaticDomain;
	readonly ownerId?: string;
}): string {
	if (owner.kind === "draw-unit" && typeof owner.drawUnitId === "string") {
		return `draw-unit:${owner.drawUnitId}`;
	}
	if (owner.kind === "layer-owner" && typeof owner.ownerId === "string") {
		return owner.ownerId;
	}
	throw new Error(
		`Static scene query cannot commit peer record with unknown owner ${owner.kind}.`,
	);
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
	if (isRecordWithLayerOwner(record)) {
		return record.owner.domain;
	}
	if (isEnvCellRecord(record)) {
		return "env-cell-system";
	}
	if (isTerrainSourceMappingRecord(record)) {
		return "outdoor-terrain";
	}
	return "outdoor-generated-scenery";
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

function groupEnvCellSeedsByLandblockAndEnvCell(
	recordsByKey: ReadonlyMap<
		string,
		CommittedRecordEntry<StaticAuthoredDynamicSeedRecord>
	>,
): ReadonlyMap<
	number,
	ReadonlyMap<
		number,
		readonly Extract<
			StaticAuthoredDynamicSeedRecord,
			{ readonly kind: "env-cell-static-object-seed" }
		>[]
	>
> {
	type EnvCellSeedRecord = Extract<
		StaticAuthoredDynamicSeedRecord,
		{ readonly kind: "env-cell-static-object-seed" }
	>;
	const recordsByLandblockAndEnvCell = new Map<
		number,
		Map<number, EnvCellSeedRecord[]>
	>();
	for (const entry of recordsByKey.values()) {
		const record = entry.record;
		if (record.kind !== "env-cell-static-object-seed") {
			continue;
		}
		let recordsByEnvCell = recordsByLandblockAndEnvCell.get(record.landblockId);
		if (!recordsByEnvCell) {
			recordsByEnvCell = new Map<number, EnvCellSeedRecord[]>();
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

function incrementEnvCellGraphEvidence(
	graphEvidenceByEnvCellId: Map<number, EnvCellResidencyGraphEvidence>,
	envCellId: number,
	field: keyof EnvCellResidencyGraphEvidence,
): void {
	const graphEvidence =
		graphEvidenceByEnvCellId.get(envCellId) ??
		createEmptyEnvCellResidencyGraphEvidence();
	graphEvidenceByEnvCellId.set(envCellId, {
		...graphEvidence,
		[field]: graphEvidence[field] + 1,
	});
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

function isRecordWithPeerOwner(record: unknown): record is {
	readonly owner: {
		readonly kind: string;
		readonly drawUnitId?: string;
		readonly domain?: StaticDomain;
	};
} {
	return (
		typeof record === "object" &&
		record !== null &&
		"owner" in record &&
		typeof (record as { owner?: { kind?: unknown } }).owner?.kind === "string"
	);
}

function isRecordWithLayerOwner(record: unknown): record is {
	readonly owner: {
		readonly kind: "layer-owner";
		readonly domain: StaticDomain;
	};
} {
	return (
		typeof record === "object" &&
		record !== null &&
		"owner" in record &&
		(record as { owner?: { kind?: unknown } }).owner?.kind ===
			"layer-owner" &&
		typeof (record as { owner?: { domain?: unknown } }).owner?.domain ===
			"string"
	);
}

function isReciprocalCommittedEnvCellPortal(
	sourceEnvCellId: number,
	sourcePortal: EnvCellInteriorPortal,
	targetPortals: readonly EnvCellInteriorPortal[],
): boolean {
	if (sourcePortal.otherPortalId === 0xffff) {
		return false;
	}
	const targetPortal = targetPortals.find(
		(portal) => portal.sourceIndex === sourcePortal.otherPortalId,
	);
	return (
		targetPortal !== undefined &&
		!targetPortal.isOutsideTransition &&
		targetPortal.targetEnvCellId === sourceEnvCellId &&
		targetPortal.otherPortalId === sourcePortal.sourceIndex
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

function parseEnvCellStaticObjectBoundsKeyLandblockId(
	key: string,
): number | null {
	const landblockId = Number.parseInt(key.split(":", 1)[0] ?? "", 10);
	return Number.isFinite(landblockId) ? landblockId : null;
}
