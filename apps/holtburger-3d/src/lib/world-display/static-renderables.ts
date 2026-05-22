import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	browserDestinationToInteriorCellId,
	isIndoorBrowserDestination,
} from "../../app/browser-mode";
import type {
	AssetChannelState,
	PreparedAssetRecord,
	PreparedGfxObjPayload,
	PreparedLandblockPackPayload,
	PreparedLandblockSummaryBuilding,
	PreparedLandblockStaticInstance,
	PreparedLandblockStaticMesh,
	PreparedSetupModelPayload,
} from "../assets/types";
import {
	derivePackInteriorEnvCellIdsForLandblocks,
	deriveTerrainFocusLandblockId,
} from "../assets/scene-asset-request-planner";
import {
	deriveStructuredInteriorCoverage,
	type StructuredInteriorCoverage,
} from "../assets/structured-interior-coverage";
import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
import {
	buildOutdoorCoverageLandblockIds,
	formatHex32,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import {
	deriveStaticRenderablePartRenderChunk,
	type RenderChunkKey,
	type RenderChunkPlacement,
} from "./render-chunks";
import {
	WORLD_RENDER_DOMAIN,
	formatRenderDomainKey,
	type StaticRenderableRenderDomain,
} from "./render-domains";

type StaticRenderableInstanceKind =
	| "indoor-static"
	| "scenery"
	| "building"
	| "generated-scenery";

const UNIT_SCALE: Vec3Dto = { x: 1, y: 1, z: 1 };

interface StaticRenderableSourceInstance {
	kind: StaticRenderableInstanceKind;
	instanceId: string;
	owningLandblockId: number;
	owningEnvCellId: number | null;
	sourceDid: number;
	sourceAssetId: string;
	sourceIndex: number;
	parentPlacements: PlacementTransformDto[];
	chunkLocalInstancePlacement: PlacementTransformDto;
	sourceScale: Vec3Dto;
	numLeaves: number | null;
}

export interface StaticRenderablePart {
	renderKey: string;
	renderDomain: StaticRenderableRenderDomain;
	instanceId: string;
	sourceAssetId: string;
	sourceDid: number;
	owningLandblockId: number;
	owningEnvCellId: number | null;
	renderChunk: RenderChunkPlacement;
	kind: StaticRenderableInstanceKind;
	partIndex: number;
	gfxObjId: number;
	gfxObjAssetId: string;
	parentPlacements: PlacementTransformDto[];
	chunkLocalInstancePlacement: PlacementTransformDto;
	partPlacements: PlacementTransformDto[];
	scale: Vec3Dto;
	debugColorKey: string;
}

export interface StaticRenderableSceneModel {
	focusLandblockId: number | null;
	activeLandblockIds: number[];
	sourceInstances: StaticRenderableSourceInstance[];
	parts: StaticRenderablePart[];
	partsByRenderDomainChunkAndGfxAssetId: Map<string, StaticRenderablePart[]>;
	missingSourceAssetIds: string[];
	missingGfxAssetIds: string[];
}

export interface OutdoorStaticRenderableSelection {
	buildingLandblockIds: readonly number[];
	detailLandblockIds: readonly number[];
	envCellLandblockIds: readonly number[];
}

export function deriveStaticRenderableSceneModel(
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null = null,
	detailLodRadius = 1,
	structuredInteriorCoverage: StructuredInteriorCoverage | null = null,
	outdoorSelection: OutdoorStaticRenderableSelection | null = null,
): StaticRenderableSceneModel {
	if (!browserDestination) {
		return createEmptyStaticRenderableSceneModel();
	}

	if (isIndoorBrowserDestination(browserDestination)) {
		return deriveIndoorStaticRenderableSceneModel(
			assetState,
			browserDestination,
			structuredInteriorCoverage,
		);
	}

	const focusLandblockId = deriveTerrainFocusLandblockId(browserDestination);
	const detailLandblockIds =
		outdoorSelection?.detailLandblockIds ??
		buildOutdoorCoverageLandblockIds(focusLandblockId, detailLodRadius);
	const buildingLandblockIds =
		outdoorSelection?.buildingLandblockIds ?? detailLandblockIds;
	const envCellLandblockIds =
		outdoorSelection?.envCellLandblockIds ?? detailLandblockIds;
	const detailLandblockSet = new Set(detailLandblockIds);
	const buildingLandblockSet = new Set(buildingLandblockIds);
	const envCellLandblockSet = new Set(envCellLandblockIds);
	const activeLandblockSet = new Set([
		...detailLandblockIds,
		...buildingLandblockIds,
		...envCellLandblockIds,
	]);
	const activeLandblockIds = [...activeLandblockSet].sort(
		(left, right) => left - right,
	);
	const activeInteriorEnvCellIds = new Set(
		structuredInteriorCoverage?.envCellIds ??
			deriveStructuredInteriorCoverage(
				{
					kind: "landblock-closure",
					seedEnvCellIds: [
						...derivePackInteriorEnvCellIdsForLandblocks(
							assetState.preparedByAssetId,
							envCellLandblockSet,
						),
					],
				},
				assetState.preparedByAssetId,
			).envCellIds,
	);
	const sourceInstances = collectPackStaticRenderableSourceInstances(
		assetState,
		{
			buildingLandblockIds: buildingLandblockSet,
			detailLandblockIds: detailLandblockSet,
			envCellIds: activeInteriorEnvCellIds,
		},
	)
		.concat(
			collectSummaryBuildingSourceInstances(assetState, {
				buildingLandblockIds: buildingLandblockSet,
			}),
		)
		.filter((instance) => activeLandblockSet.has(instance.owningLandblockId))
		.sort(compareSourceInstances);
	const missingSourceAssetIds = new Set<string>();
	const missingGfxAssetIds = new Set<string>();
	const parts: StaticRenderablePart[] = [
		...collectPackStaticRenderableParts(
			assetState,
			{
				buildingLandblockIds: buildingLandblockSet,
				detailLandblockIds: detailLandblockSet,
				envCellIds: activeInteriorEnvCellIds,
			},
			missingGfxAssetIds,
		),
		...collectSummaryBuildingStaticRenderableParts(
			assetState,
			{ buildingLandblockIds: buildingLandblockSet },
			missingSourceAssetIds,
			missingGfxAssetIds,
		),
	];

	return {
		focusLandblockId,
		activeLandblockIds,
		sourceInstances,
		parts,
		partsByRenderDomainChunkAndGfxAssetId:
			groupStaticRenderablePartsByRenderDomainChunkAndGfxAssetId(parts),
		missingSourceAssetIds: [...missingSourceAssetIds].sort(),
		missingGfxAssetIds: [...missingGfxAssetIds].sort(),
	};
}

function deriveIndoorStaticRenderableSceneModel(
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null,
	structuredInteriorCoverage: StructuredInteriorCoverage | null,
): StaticRenderableSceneModel {
	const activeEnvCellIds = deriveActiveInteriorCellIds(
		assetState,
		browserDestination,
		structuredInteriorCoverage,
	);
	const sourceInstances = collectPackIndoorStaticRenderableSourceInstances(
		assetState,
		activeEnvCellIds,
	).sort(compareSourceInstances);
	const missingSourceAssetIds = new Set<string>();
	const missingGfxAssetIds = new Set<string>();
	const parts: StaticRenderablePart[] = collectPackStaticRenderableParts(
		assetState,
		{
			buildingLandblockIds: new Set(),
			detailLandblockIds: new Set(),
			envCellIds: activeEnvCellIds,
		},
		missingGfxAssetIds,
	);

	return {
		focusLandblockId: null,
		activeLandblockIds: [],
		sourceInstances,
		parts,
		partsByRenderDomainChunkAndGfxAssetId:
			groupStaticRenderablePartsByRenderDomainChunkAndGfxAssetId(parts),
		missingSourceAssetIds: [...missingSourceAssetIds].sort(),
		missingGfxAssetIds: [...missingGfxAssetIds].sort(),
	};
}

export function formatStaticRenderableRenderGroupKey(
	renderDomain: StaticRenderableRenderDomain,
	chunkKey: RenderChunkKey,
	gfxObjAssetId: string,
): string {
	return `${renderDomain}|${chunkKey}|${gfxObjAssetId}`;
}

function groupStaticRenderablePartsByRenderDomainChunkAndGfxAssetId(
	parts: StaticRenderablePart[],
): Map<string, StaticRenderablePart[]> {
	const partsByDomainChunkAndGfxAssetId = new Map<
		string,
		StaticRenderablePart[]
	>();
	for (const part of parts) {
		const groupKey = formatStaticRenderableRenderGroupKey(
			part.renderDomain,
			part.renderChunk.chunkKey,
			part.gfxObjAssetId,
		);
		const groupedParts = partsByDomainChunkAndGfxAssetId.get(groupKey);
		if (groupedParts) {
			groupedParts.push(part);
		} else {
			partsByDomainChunkAndGfxAssetId.set(groupKey, [part]);
		}
	}

	return partsByDomainChunkAndGfxAssetId;
}

export function isPreparedGfxObjAsset(
	asset: PreparedAssetRecord | undefined,
): asset is PreparedAssetRecord & { payload: PreparedGfxObjPayload } {
	return asset?.payload.kind === "gfx-obj";
}

function isPreparedSetupModelAsset(
	asset: PreparedAssetRecord | undefined,
): asset is PreparedAssetRecord & { payload: PreparedSetupModelPayload } {
	return asset?.payload.kind === "setup-model";
}

export function createEmptyStaticRenderableSceneModel(): StaticRenderableSceneModel {
	return {
		focusLandblockId: null,
		activeLandblockIds: [],
		sourceInstances: [],
		parts: [],
		partsByRenderDomainChunkAndGfxAssetId: new Map(),
		missingSourceAssetIds: [],
		missingGfxAssetIds: [],
	};
}

function collectPackStaticRenderableSourceInstances(
	assetState: AssetChannelState,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
		envCellIds: ReadonlySet<number>;
	},
): StaticRenderableSourceInstance[] {
	return Object.values(assetState.preparedByAssetId).flatMap((asset) => {
		if (asset.payload.kind === "landblock-pack") {
			return collectPackStaticRenderableSourceInstancesFromPack(
				asset.payload,
				selection,
			);
		}
		return [];
	});
}

function collectPackStaticRenderableSourceInstancesFromPack(
	pack: PreparedLandblockPackPayload,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
		envCellIds: ReadonlySet<number>;
	},
): StaticRenderableSourceInstance[] {
	return pack.prepared.outdoorStaticInstances
		.filter((instance) => isPackStaticInstanceSelected(instance, selection))
		.map(normalizePackStaticSourceInstance);
}

function collectPackIndoorStaticRenderableSourceInstances(
	assetState: AssetChannelState,
	activeEnvCellIds: ReadonlySet<number>,
): StaticRenderableSourceInstance[] {
	return Object.values(assetState.preparedByAssetId).flatMap((asset) =>
		asset.payload.kind === "landblock-pack"
			? collectPackStaticRenderableSourceInstancesFromPack(asset.payload, {
					buildingLandblockIds: new Set(),
					detailLandblockIds: new Set(),
					envCellIds: activeEnvCellIds,
				})
			: [],
	);
}

function collectSummaryBuildingSourceInstances(
	assetState: AssetChannelState,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
	},
): StaticRenderableSourceInstance[] {
	const preparedPackLandblockIds = collectPreparedPackLandblockIds(assetState);
	return Object.values(assetState.preparedByAssetId).flatMap((asset) => {
		if (asset.payload.kind !== "landblock-summary") {
			return [];
		}

		const landblockId = normalizeOutdoorLandblockId(asset.payload.landblockId);
		if (
			!selection.buildingLandblockIds.has(landblockId) ||
			preparedPackLandblockIds.has(landblockId)
		) {
			return [];
		}

		return asset.payload.sourceFacts.buildings
			.filter(isRenderableSummaryBuilding)
			.map(normalizeSummaryBuildingSourceInstance);
	});
}

function normalizePackStaticSourceInstance(
	instance: PreparedLandblockStaticInstance,
): StaticRenderableSourceInstance {
	return {
		kind: instance.kind,
		instanceId: instance.instanceId,
		owningLandblockId: normalizeOutdoorLandblockId(instance.owningLandblockId),
		owningEnvCellId: instance.owningEnvCellId,
		sourceDid: instance.sourceDid,
		sourceAssetId: instance.sourceAssetId,
		sourceIndex: instance.sourceIndex,
		parentPlacements: [],
		chunkLocalInstancePlacement: instance.localPlacement,
		sourceScale: instance.sourceScale,
		numLeaves: null,
	};
}

function normalizeSummaryBuildingSourceInstance(
	building: PreparedLandblockSummaryBuilding & { sourceAssetId: string },
): StaticRenderableSourceInstance {
	return {
		kind: "building",
		instanceId: building.instanceId,
		owningLandblockId: normalizeOutdoorLandblockId(building.owningLandblockId),
		owningEnvCellId: null,
		sourceDid: building.sourceDid,
		sourceAssetId: building.sourceAssetId,
		sourceIndex: building.sourceIndex,
		parentPlacements: [],
		chunkLocalInstancePlacement: building.localPlacement,
		sourceScale: UNIT_SCALE,
		numLeaves: building.numLeaves,
	};
}

function compareSourceInstances(
	left: StaticRenderableSourceInstance,
	right: StaticRenderableSourceInstance,
): number {
	if (left.owningLandblockId !== right.owningLandblockId) {
		return left.owningLandblockId - right.owningLandblockId;
	}
	if (left.kind !== right.kind) {
		return left.kind.localeCompare(right.kind);
	}
	return left.instanceId.localeCompare(right.instanceId);
}

function createStaticRenderablePart(
	instance: StaticRenderableSourceInstance,
	part: {
		partIndex: number;
		gfxObjId: number;
		gfxObjAssetId: string;
		partPlacements: PlacementTransformDto[];
		scale: Vec3Dto;
	},
): StaticRenderablePart {
	const debugColorKey = `${instance.sourceAssetId}:${formatHexId(part.gfxObjId)}:${part.partIndex}`;
	const renderChunk = deriveStaticRenderablePartRenderChunk(instance);
	const renderDomain = staticRenderableRenderDomainForKind(instance.kind);
	const localRenderKey = `${instance.instanceId}/part/${part.partIndex}/${part.gfxObjAssetId}`;
	return {
		renderKey: formatRenderDomainKey(renderDomain, localRenderKey),
		renderDomain,
		instanceId: instance.instanceId,
		sourceAssetId: instance.sourceAssetId,
		sourceDid: instance.sourceDid,
		owningLandblockId: instance.owningLandblockId,
		owningEnvCellId: instance.owningEnvCellId,
		renderChunk,
		kind: instance.kind,
		partIndex: part.partIndex,
		gfxObjId: part.gfxObjId,
		gfxObjAssetId: part.gfxObjAssetId,
		parentPlacements: instance.parentPlacements,
		chunkLocalInstancePlacement: instance.chunkLocalInstancePlacement,
		partPlacements: part.partPlacements,
		scale: multiplyScale(instance.sourceScale, part.scale),
		debugColorKey,
	};
}

function staticRenderableRenderDomainForKind(
	kind: StaticRenderableInstanceKind,
): StaticRenderableRenderDomain {
	return kind === "indoor-static"
		? WORLD_RENDER_DOMAIN.interiorStatic
		: WORLD_RENDER_DOMAIN.exteriorStatic;
}

function multiplyScale(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.x * right.x,
		y: left.y * right.y,
		z: left.z * right.z,
	};
}

function deriveActiveInteriorCellIds(
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null,
	structuredInteriorCoverage: StructuredInteriorCoverage | null,
): Set<number> {
	if (structuredInteriorCoverage !== null) {
		return new Set(structuredInteriorCoverage.envCellIds);
	}

	const browserFocusEnvCellId =
		browserDestinationToInteriorCellId(browserDestination);
	if (browserFocusEnvCellId !== null) {
		return new Set(
			deriveStructuredInteriorCoverage(
				{
					kind: "landblock-closure",
					seedEnvCellIds: [browserFocusEnvCellId],
				},
				assetState.preparedByAssetId,
			).envCellIds,
		);
	}

	return new Set();
}

function collectPackStaticRenderableParts(
	assetState: AssetChannelState,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
		envCellIds: ReadonlySet<number>;
	},
	missingGfxAssetIds: Set<string>,
): StaticRenderablePart[] {
	return Object.values(assetState.preparedByAssetId)
		.flatMap((asset) =>
			asset.payload.kind === "landblock-pack"
				? asset.payload.prepared.staticMeshes
				: [],
		)
		.filter((mesh) => isPackStaticMeshSelected(mesh, selection))
		.flatMap((mesh) => {
			if (
				!isPreparedGfxObjAsset(assetState.preparedByAssetId[mesh.gfxObjAssetId])
			) {
				missingGfxAssetIds.add(mesh.gfxObjAssetId);
				return [];
			}
			return [normalizePackStaticRenderablePart(mesh)];
		});
}

function collectSummaryBuildingStaticRenderableParts(
	assetState: AssetChannelState,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
	},
	missingSourceAssetIds: Set<string>,
	missingGfxAssetIds: Set<string>,
): StaticRenderablePart[] {
	return collectSummaryBuildingSourceInstances(assetState, selection).flatMap(
		(instance) =>
			expandStaticRenderableSourceInstanceParts(
				instance,
				assetState,
				missingSourceAssetIds,
				missingGfxAssetIds,
			),
	);
}

function expandStaticRenderableSourceInstanceParts(
	instance: StaticRenderableSourceInstance,
	assetState: AssetChannelState,
	missingSourceAssetIds: Set<string>,
	missingGfxAssetIds: Set<string>,
): StaticRenderablePart[] {
	const sourceAsset = assetState.preparedByAssetId[instance.sourceAssetId];
	if (!sourceAsset) {
		missingSourceAssetIds.add(instance.sourceAssetId);
		return [];
	}

	if (isPreparedGfxObjAsset(sourceAsset)) {
		return [
			createStaticRenderablePart(instance, {
				partIndex: 0,
				gfxObjId: sourceAsset.payload.gfxObjId,
				gfxObjAssetId: instance.sourceAssetId,
				partPlacements: [],
				scale: UNIT_SCALE,
			}),
		];
	}

	if (isPreparedSetupModelAsset(sourceAsset)) {
		return sourceAsset.payload.parts.flatMap((part) => {
			if (
				!isPreparedGfxObjAsset(assetState.preparedByAssetId[part.gfxObjAssetId])
			) {
				missingGfxAssetIds.add(part.gfxObjAssetId);
				return [];
			}

			return [
				createStaticRenderablePart(instance, {
					partIndex: part.partIndex,
					gfxObjId: part.gfxObjId,
					gfxObjAssetId: part.gfxObjAssetId,
					partPlacements: [],
					scale: part.scale ?? UNIT_SCALE,
				}),
			];
		});
	}

	missingSourceAssetIds.add(instance.sourceAssetId);
	return [];
}

function normalizePackStaticRenderablePart(
	mesh: PreparedLandblockStaticMesh,
): StaticRenderablePart {
	const instance: StaticRenderableSourceInstance = {
		kind: mesh.kind,
		instanceId: mesh.instanceId,
		owningLandblockId: normalizeOutdoorLandblockId(mesh.owningLandblockId),
		owningEnvCellId: mesh.owningEnvCellId,
		sourceDid: mesh.sourceDid,
		sourceAssetId: mesh.sourceAssetId,
		sourceIndex: mesh.sourceIndex,
		parentPlacements: [],
		chunkLocalInstancePlacement: mesh.localPlacement,
		sourceScale: mesh.sourceScale,
		numLeaves: null,
	};
	return createStaticRenderablePart(instance, {
		partIndex: mesh.partIndex,
		gfxObjId: mesh.gfxObjId,
		gfxObjAssetId: mesh.gfxObjAssetId,
		partPlacements: mesh.partPlacements,
		scale: mesh.partScale,
	});
}

function isPackStaticInstanceSelected(
	instance: Pick<
		PreparedLandblockStaticInstance,
		"kind" | "owningEnvCellId" | "owningLandblockId"
	>,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
		envCellIds: ReadonlySet<number>;
	},
): boolean {
	if (instance.kind === "indoor-static") {
		return (
			instance.owningEnvCellId !== null &&
			selection.envCellIds.has(instance.owningEnvCellId)
		);
	}
	const landblockId = normalizeOutdoorLandblockId(instance.owningLandblockId);
	return instance.kind === "building"
		? selection.buildingLandblockIds.has(landblockId)
		: selection.detailLandblockIds.has(landblockId);
}

function isPackStaticMeshSelected(
	mesh: PreparedLandblockStaticMesh,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
		envCellIds: ReadonlySet<number>;
	},
): boolean {
	return isPackStaticInstanceSelected(mesh, selection);
}

function formatHexId(value: number): string {
	return `0x${formatHex32(value)}`;
}

function collectPreparedPackLandblockIds(
	assetState: AssetChannelState,
): Set<number> {
	const landblockIds = new Set<number>();
	for (const asset of Object.values(assetState.preparedByAssetId)) {
		if (asset.payload.kind === "landblock-pack") {
			landblockIds.add(normalizeOutdoorLandblockId(asset.payload.landblockId));
		}
	}
	return landblockIds;
}

function isRenderableSummaryBuilding(
	building: PreparedLandblockSummaryBuilding,
): building is PreparedLandblockSummaryBuilding & { sourceAssetId: string } {
	return building.sourceAssetId !== null;
}
