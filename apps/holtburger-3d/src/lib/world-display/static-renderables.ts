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
	PreparedLandblockSummaryPayload,
	PreparedLandblockStaticInstance,
	PreparedLandblockStaticMesh,
	PreparedSetupModelPayload,
	PreparedSetupAppearancePayload,
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
	formatLandblockPackAssetId,
	formatLandblockSummaryAssetId,
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
import {
	formatMaterialAssetId,
	type ResolvedMaterialSlot,
} from "./material-resources";

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

interface LandblockPackStaticRenderableResource {
	sourceInstances: StaticRenderableSourceInstance[];
	parts: StaticRenderablePart[];
}

interface LandblockSummaryStaticRenderableResource {
	sourceInstances: StaticRenderableSourceInstance[];
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
	materialAppearanceKey: string;
	materialSlots: ResolvedMaterialSlot[];
	materialSignature: string;
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

export class StaticRenderableResourceCache {
	private readonly packResources = new WeakMap<
		PreparedAssetRecord & { payload: PreparedLandblockPackPayload },
		LandblockPackStaticRenderableResource
	>();
	private readonly summaryResources = new WeakMap<
		PreparedAssetRecord & { payload: PreparedLandblockSummaryPayload },
		LandblockSummaryStaticRenderableResource
	>();

	getLandblockPackResource(
		asset: PreparedAssetRecord & { payload: PreparedLandblockPackPayload },
	): LandblockPackStaticRenderableResource {
		const cached = this.packResources.get(asset);
		if (cached) {
			return cached;
		}

		const resource = {
			sourceInstances: asset.payload.prepared.outdoorStaticInstances.map(
				normalizePackStaticSourceInstance,
			),
			parts: asset.payload.prepared.staticMeshes.map(
				normalizePackStaticRenderablePart,
			),
		};
		this.packResources.set(asset, resource);
		return resource;
	}

	getLandblockSummaryResource(
		asset: PreparedAssetRecord & { payload: PreparedLandblockSummaryPayload },
	): LandblockSummaryStaticRenderableResource {
		const cached = this.summaryResources.get(asset);
		if (cached) {
			return cached;
		}

		const resource = {
			sourceInstances: asset.payload.sourceFacts.buildings
				.filter(isRenderableSummaryBuilding)
				.map(normalizeSummaryBuildingSourceInstance),
		};
		this.summaryResources.set(asset, resource);
		return resource;
	}
}

export function deriveStaticRenderableSceneModel(
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null = null,
	detailLodRadius = 1,
	structuredInteriorCoverage: StructuredInteriorCoverage | null = null,
	outdoorSelection: OutdoorStaticRenderableSelection | null = null,
	cache: StaticRenderableResourceCache | null = null,
): StaticRenderableSceneModel {
	if (!browserDestination) {
		return createEmptyStaticRenderableSceneModel();
	}

	if (isIndoorBrowserDestination(browserDestination)) {
		return deriveIndoorStaticRenderableSceneModel(
			assetState,
			browserDestination,
			structuredInteriorCoverage,
			cache,
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
		cache,
	)
		.concat(
			collectSummaryBuildingSourceInstances(
				assetState,
				{
					buildingLandblockIds: buildingLandblockSet,
				},
				cache,
			),
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
			cache,
		),
		...collectSummaryBuildingStaticRenderableParts(
			assetState,
			{ buildingLandblockIds: buildingLandblockSet },
			missingSourceAssetIds,
			missingGfxAssetIds,
			cache,
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
	cache: StaticRenderableResourceCache | null,
): StaticRenderableSceneModel {
	const activeEnvCellIds = deriveActiveInteriorCellIds(
		assetState,
		browserDestination,
		structuredInteriorCoverage,
	);
	const sourceInstances = collectPackIndoorStaticRenderableSourceInstances(
		assetState,
		activeEnvCellIds,
		cache,
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
		cache,
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

function formatStaticRenderableRenderGroupKey(
	renderDomain: StaticRenderableRenderDomain,
	chunkKey: RenderChunkKey,
	gfxObjAssetId: string,
	materialSignature: string,
): string {
	return `${renderDomain}|${chunkKey}|${gfxObjAssetId}|${materialSignature}`;
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
			part.materialSignature,
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

function isPreparedLandblockPackAsset(
	asset: PreparedAssetRecord | undefined,
): asset is PreparedAssetRecord & { payload: PreparedLandblockPackPayload } {
	return asset?.payload.kind === "landblock-pack";
}

function isPreparedLandblockSummaryAsset(
	asset: PreparedAssetRecord | undefined,
): asset is PreparedAssetRecord & { payload: PreparedLandblockSummaryPayload } {
	return asset?.payload.kind === "landblock-summary";
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
	cache: StaticRenderableResourceCache | null,
): StaticRenderableSourceInstance[] {
	return collectSelectedLandblockPackResources(assetState, selection, cache)
		.flatMap((resource) => resource.sourceInstances)
		.filter((instance) => isPackStaticInstanceSelected(instance, selection));
}

function collectPackIndoorStaticRenderableSourceInstances(
	assetState: AssetChannelState,
	activeEnvCellIds: ReadonlySet<number>,
	cache: StaticRenderableResourceCache | null,
): StaticRenderableSourceInstance[] {
	const selection = {
		buildingLandblockIds: new Set<number>(),
		detailLandblockIds: new Set<number>(),
		envCellIds: activeEnvCellIds,
	};
	return collectLandblockPackResourcesForEnvCells(
		assetState,
		activeEnvCellIds,
		cache,
	)
		.flatMap((resource) => resource.sourceInstances)
		.filter((instance) => isPackStaticInstanceSelected(instance, selection));
}

function collectSummaryBuildingSourceInstances(
	assetState: AssetChannelState,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
	},
	cache: StaticRenderableResourceCache | null,
): StaticRenderableSourceInstance[] {
	return [...selection.buildingLandblockIds].flatMap((landblockId) => {
		if (isLandblockPackPrepared(assetState, landblockId)) {
			return [];
		}

		const asset =
			assetState.preparedByAssetId[formatLandblockSummaryAssetId(landblockId)];
		if (!isPreparedLandblockSummaryAsset(asset)) {
			return [];
		}

		return getLandblockSummaryResource(asset, cache).sourceInstances;
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
		materialAppearanceKey: string;
		materialSlots: ResolvedMaterialSlot[];
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
		materialAppearanceKey: part.materialAppearanceKey,
		materialSlots: part.materialSlots,
		materialSignature: describeMaterialSignature(
			part.materialAppearanceKey,
			part.materialSlots,
		),
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
	cache: StaticRenderableResourceCache | null,
): StaticRenderablePart[] {
	return collectSelectedLandblockPackResources(assetState, selection, cache)
		.flatMap((resource) => resource.parts)
		.filter((part) => isStaticRenderablePartSelected(part, selection))
		.flatMap((part) => {
			const gfxObjAsset = assetState.preparedByAssetId[part.gfxObjAssetId];
			if (!isPreparedGfxObjAsset(gfxObjAsset)) {
				missingGfxAssetIds.add(part.gfxObjAssetId);
				return [];
			}
			const materialAppearance = resolveStaticRenderablePartMaterialAppearance(
				assetState,
				part,
				gfxObjAsset.payload,
			);
			return [
				{
					...part,
					materialAppearanceKey: materialAppearance.appearanceKey,
					materialSlots: materialAppearance.slots,
					materialSignature: describeMaterialSignature(
						materialAppearance.appearanceKey,
						materialAppearance.slots,
					),
				},
			];
		});
}

function collectSummaryBuildingStaticRenderableParts(
	assetState: AssetChannelState,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
	},
	missingSourceAssetIds: Set<string>,
	missingGfxAssetIds: Set<string>,
	cache: StaticRenderableResourceCache | null,
): StaticRenderablePart[] {
	return collectSummaryBuildingSourceInstances(
		assetState,
		selection,
		cache,
	).flatMap((instance) =>
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
				materialAppearanceKey: "base",
				materialSlots: resolveGfxObjMaterialSlots(sourceAsset.payload),
				partPlacements: [],
				scale: UNIT_SCALE,
			}),
		];
	}

	if (isPreparedSetupModelAsset(sourceAsset)) {
		const setupAppearance = resolveSetupAppearance(
			assetState,
			sourceAsset.payload,
		);
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
					materialAppearanceKey: setupAppearance?.appearanceKey ?? "setup-base",
					materialSlots: resolveSetupPartMaterialSlots(
						assetState,
						part,
						setupAppearance,
					),
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
		materialAppearanceKey: "base",
		materialSlots: [],
		partPlacements: mesh.partPlacements,
		scale: mesh.partScale,
	});
}

function resolveGfxObjMaterialSlots(
	gfxObj: PreparedGfxObjPayload,
): ResolvedMaterialSlot[] {
	return gfxObj.surfaceIds.map((surfaceId, slotIndex) => ({
		slotIndex,
		surfaceId,
		materialAssetId: formatMaterialAssetId(surfaceId),
	}));
}

function resolveSetupAppearance(
	assetState: AssetChannelState,
	setupModel: PreparedSetupModelPayload,
): PreparedSetupAppearancePayload | null {
	const setupAppearanceAssetId =
		setupModel.dependencies?.setupAppearanceAssetId ?? null;
	if (!setupAppearanceAssetId) {
		return null;
	}
	const asset = assetState.preparedByAssetId[setupAppearanceAssetId];
	return asset?.payload.kind === "setup-appearance" ? asset.payload : null;
}

function resolveSetupPartMaterialSlots(
	assetState: AssetChannelState,
	part: PreparedSetupModelPayload["parts"][number],
	setupAppearance: PreparedSetupAppearancePayload | null,
): ResolvedMaterialSlot[] {
	const appearancePart = setupAppearance?.parts.find(
		(candidate) => candidate.partIndex === part.partIndex,
	);
	if (appearancePart) {
		return appearancePart.materialSlots.map((slot) => ({
			slotIndex: slot.slotIndex,
			surfaceId: slot.surfaceId,
			materialAssetId: slot.materialAssetId,
		}));
	}

	const gfxObjAsset = assetState.preparedByAssetId[part.gfxObjAssetId];
	return isPreparedGfxObjAsset(gfxObjAsset)
		? resolveGfxObjMaterialSlots(gfxObjAsset.payload)
		: [];
}

function resolveStaticRenderablePartMaterialAppearance(
	assetState: AssetChannelState,
	part: StaticRenderablePart,
	gfxObj: PreparedGfxObjPayload,
): { appearanceKey: string; slots: ResolvedMaterialSlot[] } {
	const sourceAsset = assetState.preparedByAssetId[part.sourceAssetId];
	if (isPreparedSetupModelAsset(sourceAsset)) {
		const setupAppearance = resolveSetupAppearance(
			assetState,
			sourceAsset.payload,
		);
		const setupPart = sourceAsset.payload.parts.find(
			(candidate) => candidate.partIndex === part.partIndex,
		);
		if (setupPart) {
			return {
				appearanceKey: setupAppearance?.appearanceKey ?? "setup-base",
				slots: resolveSetupPartMaterialSlots(
					assetState,
					setupPart,
					setupAppearance,
				),
			};
		}
	}

	return {
		appearanceKey: "base",
		slots: resolveGfxObjMaterialSlots(gfxObj),
	};
}

function describeMaterialSignature(
	appearanceKey: string,
	slots: readonly ResolvedMaterialSlot[],
): string {
	return [
		appearanceKey,
		...slots
			.map(
				(slot) => `${slot.slotIndex}:${slot.surfaceId}:${slot.materialAssetId}`,
			)
			.sort(),
	].join(",");
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

function isStaticRenderablePartSelected(
	part: StaticRenderablePart,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
		envCellIds: ReadonlySet<number>;
	},
): boolean {
	return isPackStaticInstanceSelected(part, selection);
}

function formatHexId(value: number): string {
	return `0x${formatHex32(value)}`;
}

function collectSelectedLandblockPackResources(
	assetState: AssetChannelState,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
		envCellIds: ReadonlySet<number>;
	},
	cache: StaticRenderableResourceCache | null,
): LandblockPackStaticRenderableResource[] {
	const landblockIds = new Set<number>();
	for (const landblockId of selection.buildingLandblockIds) {
		landblockIds.add(normalizeOutdoorLandblockId(landblockId));
	}
	for (const landblockId of selection.detailLandblockIds) {
		landblockIds.add(normalizeOutdoorLandblockId(landblockId));
	}
	for (const envCellId of selection.envCellIds) {
		landblockIds.add(normalizeOutdoorLandblockId(envCellId));
	}

	return collectLandblockPackResources(assetState, landblockIds, cache);
}

function collectLandblockPackResourcesForEnvCells(
	assetState: AssetChannelState,
	envCellIds: ReadonlySet<number>,
	cache: StaticRenderableResourceCache | null,
): LandblockPackStaticRenderableResource[] {
	return collectLandblockPackResources(
		assetState,
		new Set([...envCellIds].map(normalizeOutdoorLandblockId)),
		cache,
	);
}

function collectLandblockPackResources(
	assetState: AssetChannelState,
	landblockIds: ReadonlySet<number>,
	cache: StaticRenderableResourceCache | null,
): LandblockPackStaticRenderableResource[] {
	const resources: LandblockPackStaticRenderableResource[] = [];
	for (const landblockId of landblockIds) {
		const asset =
			assetState.preparedByAssetId[formatLandblockPackAssetId(landblockId)];
		if (isPreparedLandblockPackAsset(asset)) {
			resources.push(getLandblockPackResource(asset, cache));
		}
	}
	return resources;
}

function getLandblockPackResource(
	asset: PreparedAssetRecord & { payload: PreparedLandblockPackPayload },
	cache: StaticRenderableResourceCache | null,
): LandblockPackStaticRenderableResource {
	return cache
		? cache.getLandblockPackResource(asset)
		: {
				sourceInstances: asset.payload.prepared.outdoorStaticInstances.map(
					normalizePackStaticSourceInstance,
				),
				parts: asset.payload.prepared.staticMeshes.map(
					normalizePackStaticRenderablePart,
				),
			};
}

function getLandblockSummaryResource(
	asset: PreparedAssetRecord & { payload: PreparedLandblockSummaryPayload },
	cache: StaticRenderableResourceCache | null,
): LandblockSummaryStaticRenderableResource {
	return cache
		? cache.getLandblockSummaryResource(asset)
		: {
				sourceInstances: asset.payload.sourceFacts.buildings
					.filter(isRenderableSummaryBuilding)
					.map(normalizeSummaryBuildingSourceInstance),
			};
}

function isLandblockPackPrepared(
	assetState: AssetChannelState,
	landblockId: number,
): boolean {
	return isPreparedLandblockPackAsset(
		assetState.preparedByAssetId[formatLandblockPackAssetId(landblockId)],
	);
}

function isRenderableSummaryBuilding(
	building: PreparedLandblockSummaryBuilding,
): building is PreparedLandblockSummaryBuilding & { sourceAssetId: string } {
	return building.sourceAssetId !== null;
}
