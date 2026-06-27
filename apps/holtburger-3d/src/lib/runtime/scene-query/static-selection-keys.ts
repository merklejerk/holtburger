import type {
	EnvCellPortalSceneSelectionKey,
	EnvCellStaticSceneSelectionKey,
	OutdoorStaticObjectSceneSelectionKey,
	StaticSceneSelectionKey,
	TerrainQuadSceneSelectionKey,
} from "./contracts";

export function createOutdoorStaticObjectSelectionKey(options: {
	readonly domain: OutdoorStaticObjectSceneSelectionKey["domain"];
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
