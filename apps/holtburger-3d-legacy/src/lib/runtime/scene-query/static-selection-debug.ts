import type {
	OutdoorStaticObjectsScopePayload,
	StaticBounds,
	StaticObjectMaterialSourceFacts,
	StaticObjectPartSourceFacts,
	StaticObjectTextureRefFacts,
} from "../../static/contracts";
import type {
	EnvCellStaticScenePickDetails,
	OutdoorStaticObjectMaterialSlotDiagnostics,
	OutdoorStaticObjectPartDiagnostics,
	OutdoorStaticObjectScenePickDetails,
	OutdoorStaticObjectSourceAssetDiagnostics,
	OutdoorStaticObjectSourceDiagnostics,
	StaticSceneEnvCellAabbDebugBounds,
	StaticSceneEnvCellBounds,
	StaticSceneSelectionDebugBounds,
	StaticSceneSelectionKey,
	StaticSceneTerrainLandblockBounds,
	TerrainQuadScenePickDetails,
} from "./contracts";
import type { EnvCellCommittedRecordStore } from "./env-cell-committed-records";
import { translateBounds, unionBounds } from "./geometry";
import type {
	OutdoorSourceDiagnosticsRoot,
	OutdoorStaticBvhRoot,
	TerrainBvhRoot,
} from "./static-query-state";

export interface StaticSelectionDebugState {
	/** Committed env-cell roots and static bounds overrides used by env-cell details. */
	readonly envCellCommittedRecords: EnvCellCommittedRecordStore;
	/** Outdoor static BVH roots keyed by `createOutdoorRootKey`. */
	readonly outdoorBvhRootsByDomainAndLandblock: ReadonlyMap<
		string,
		OutdoorStaticBvhRoot
	>;
	/** Outdoor source diagnostic roots keyed by `createOutdoorRootKey`. */
	readonly outdoorSourceDiagnosticsByDomainAndLandblock: ReadonlyMap<
		string,
		OutdoorSourceDiagnosticsRoot
	>;
	/** Terrain BVH roots keyed by landblock id. */
	readonly terrainBvhRootsByLandblockId: ReadonlyMap<number, TerrainBvhRoot>;
}

export function queryOutdoorStaticObjectDetails(
	state: StaticSelectionDebugState,
	options: {
		readonly domain: OutdoorStaticObjectsScopePayload["domain"];
		readonly landblockId: number;
		readonly instanceId: string;
	},
): OutdoorStaticObjectScenePickDetails | null {
	const root = state.outdoorBvhRootsByDomainAndLandblock.get(
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

export function queryOutdoorStaticObjectSourceDiagnostics(
	state: StaticSelectionDebugState,
	options: {
		readonly domain: OutdoorStaticObjectsScopePayload["domain"];
		readonly landblockId: number;
		readonly instanceId: string;
	},
): OutdoorStaticObjectSourceDiagnostics | null {
	const root = state.outdoorSourceDiagnosticsByDomainAndLandblock.get(
		createOutdoorRootKey(options.domain, options.landblockId),
	);
	if (!root) {
		return null;
	}

	return root.objectsByInstanceId.get(options.instanceId) ?? null;
}

export function queryEnvCellStaticObjectDetails(
	state: StaticSelectionDebugState,
	options: {
		readonly landblockId: number;
		readonly envCellId: number;
		readonly instanceId: string;
	},
): EnvCellStaticScenePickDetails | null {
	const landblockRoot = state.envCellCommittedRecords.envCellRoot(
		options.landblockId,
	);
	const root = landblockRoot?.cellsByEnvCellId.get(options.envCellId);
	if (!root) {
		return null;
	}

	for (const item of root.items) {
		if (
			item.kind === "static" &&
			item.placement.placement.identity.instanceId === options.instanceId
		) {
			return {
				envCellId: options.envCellId,
				instanceId: options.instanceId,
				landblockId: options.landblockId,
				placement: item.placement.placement,
			};
		}
	}

	return null;
}

export function queryTerrainQuadDetails(
	state: StaticSelectionDebugState,
	options: {
		readonly landblockId: number;
		readonly quadIndex: number;
	},
): TerrainQuadScenePickDetails | null {
	const root = state.terrainBvhRootsByLandblockId.get(options.landblockId);
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

export function queryTerrainLandblockBounds(
	state: StaticSelectionDebugState,
	options: {
		readonly landblockId: number;
	},
): StaticSceneTerrainLandblockBounds | null {
	const root = state.terrainBvhRootsByLandblockId.get(options.landblockId);
	const rootBounds = root?.nodes[0]?.bounds;
	if (!root || !rootBounds) {
		return null;
	}

	return {
		bounds: translateBounds(rootBounds, root.translation),
		landblockId: root.landblockId,
	};
}

export function querySelectionDebugBounds(
	state: StaticSelectionDebugState,
	selectionKey: StaticSceneSelectionKey,
): StaticSceneSelectionDebugBounds | null {
	if (selectionKey.itemKind === "outdoor-static-object") {
		const root = state.outdoorBvhRootsByDomainAndLandblock.get(
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
					bounds: translateBounds(item.object.instanceBounds, root.translation),
					selectionKey,
				};
			}
		}

		return null;
	}

	if (selectionKey.itemKind === "terrain-quad") {
		const root = state.terrainBvhRootsByLandblockId.get(
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

	const landblockRoot = state.envCellCommittedRecords.envCellRoot(
		selectionKey.landblockId,
	);
	const root = landblockRoot?.cellsByEnvCellId.get(selectionKey.envCellId);
	if (!root) {
		return null;
	}

	for (const item of root.items) {
		if (
			item.kind === "static" &&
			item.placement.placement.identity.instanceId === selectionKey.instanceId
		) {
			const bounds =
				state.envCellCommittedRecords.getEnvCellStaticPlacementBounds(
					root,
					item.placement,
				);
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

export function queryEnvCellBounds(
	state: StaticSelectionDebugState,
	options: {
		readonly envCellId: number;
		readonly landblockId: number;
	},
): StaticSceneEnvCellBounds | null {
	const root = state.envCellCommittedRecords.envCellRoot(options.landblockId);
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

export function queryEnvCellAabbDebugBounds(
	state: StaticSelectionDebugState,
	options?: {
		readonly landblockId?: number | null;
	},
): readonly StaticSceneEnvCellAabbDebugBounds[] {
	const requestedRoot =
		options?.landblockId === undefined || options.landblockId === null
			? null
			: state.envCellCommittedRecords.envCellRoot(options.landblockId);
	const roots =
		options?.landblockId === undefined || options.landblockId === null
			? [...state.envCellCommittedRecords.envCellRoots()]
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

export function createOutdoorRootKey(
	domain: OutdoorStaticObjectsScopePayload["domain"],
	landblockId: number,
): string {
	return `${domain}:${landblockId.toString(16)}`;
}

export function parseOutdoorRootKeyLandblockId(key: string): number | null {
	const [, landblockHex] = key.split(":");
	if (!landblockHex) {
		return null;
	}
	const landblockId = Number.parseInt(landblockHex, 16);
	return Number.isFinite(landblockId) ? landblockId >>> 0 : null;
}

export function createOutdoorSourceDiagnosticsRoot(
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
