import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	browserDestinationToIndoorEnvCellId,
	isIndoorBrowserDestination,
} from "../../app/browser-mode";
import type {
	AssetChannelState,
	PreparedAssetRecord,
	PreparedGfxObjPayload,
	PreparedIndoorEnvCellPayload,
	PreparedIndoorStaticObject,
	PreparedOutdoorStaticSceneBuilding,
	PreparedOutdoorStaticSceneGeneratedSceneryInstance,
	PreparedOutdoorStaticSceneInstance,
	PreparedSetupModelPart,
	PreparedSetupModelPayload,
} from "../assets/types";
import {
	deriveOutdoorInteriorSeedEnvCellIds,
	deriveTerrainFocusLandblockId,
} from "../assets/scene-asset-request-planner";
import {
	deriveStructuredInteriorCoverage,
	formatIndoorEnvCellAssetId,
	type StructuredInteriorCoverage,
} from "../assets/structured-interior-coverage";
import type {
	PlacementTransformDto,
	RuntimeBatchDto,
	Vec3Dto,
} from "../host/contracts";
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

const IDENTITY_PLACEMENT: PlacementTransformDto = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

const UNIT_SCALE: Vec3Dto = { x: 1, y: 1, z: 1 };

export function deriveStaticRenderableSceneModel(
	runtimeBatch: RuntimeBatchDto | null,
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null = null,
	detailLodRadius = 1,
	structuredInteriorCoverage: StructuredInteriorCoverage | null = null,
	outdoorSelection: OutdoorStaticRenderableSelection | null = null,
): StaticRenderableSceneModel {
	if (!runtimeBatch) {
		return createEmptyStaticRenderableSceneModel();
	}

	if (
		runtimeBatch.residency.indoors ||
		isIndoorBrowserDestination(browserDestination)
	) {
		return deriveIndoorStaticRenderableSceneModel(
			runtimeBatch,
			assetState,
			browserDestination,
			structuredInteriorCoverage,
		);
	}

	const focusLandblockId = deriveTerrainFocusLandblockId(
		runtimeBatch,
		browserDestination,
	);
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
	const sourceInstances = collectStaticRenderableSourceInstances(assetState, {
		buildingLandblockIds: buildingLandblockSet,
		detailLandblockIds: detailLandblockSet,
	})
		.concat(
			collectIndoorStaticRenderableSourceInstances(
				assetState,
				new Set(
					structuredInteriorCoverage?.envCellIds ??
						deriveStructuredInteriorCoverage(
							{
								kind: "landblock-closure",
								seedEnvCellIds: [
									...deriveOutdoorInteriorSeedEnvCellIds(
										assetState.preparedByAssetId,
										envCellLandblockSet,
									),
								],
							},
							assetState.preparedByAssetId,
						).envCellIds,
				),
			),
		)
		.filter((instance) => activeLandblockSet.has(instance.owningLandblockId))
		.sort(compareSourceInstances);
	const missingSourceAssetIds = new Set<string>();
	const missingGfxAssetIds = new Set<string>();
	const parts: StaticRenderablePart[] = [];

	for (const instance of sourceInstances) {
		const sourceAsset = assetState.preparedByAssetId[instance.sourceAssetId];
		if (!sourceAsset) {
			missingSourceAssetIds.add(instance.sourceAssetId);
			continue;
		}

		const normalizedParts = normalizeStaticRenderableParts(
			instance,
			sourceAsset,
		);
		if (normalizedParts === null) {
			missingSourceAssetIds.add(instance.sourceAssetId);
			continue;
		}

		for (const part of normalizedParts) {
			if (
				!isPreparedGfxObjAsset(assetState.preparedByAssetId[part.gfxObjAssetId])
			) {
				missingGfxAssetIds.add(part.gfxObjAssetId);
				continue;
			}
			parts.push(part);
		}
	}

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
	runtimeBatch: RuntimeBatchDto,
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null,
	structuredInteriorCoverage: StructuredInteriorCoverage | null,
): StaticRenderableSceneModel {
	const activeEnvCellIds = deriveActiveIndoorEnvCellIds(
		runtimeBatch,
		assetState,
		browserDestination,
		structuredInteriorCoverage,
	);
	const sourceInstances = collectIndoorStaticRenderableSourceInstances(
		assetState,
		activeEnvCellIds,
	).sort(compareSourceInstances);
	const missingSourceAssetIds = new Set<string>();
	const missingGfxAssetIds = new Set<string>();
	const parts: StaticRenderablePart[] = [];

	for (const instance of sourceInstances) {
		const sourceAsset = assetState.preparedByAssetId[instance.sourceAssetId];
		if (!sourceAsset) {
			missingSourceAssetIds.add(instance.sourceAssetId);
			continue;
		}

		const normalizedParts = normalizeStaticRenderableParts(
			instance,
			sourceAsset,
		);
		if (normalizedParts === null) {
			missingSourceAssetIds.add(instance.sourceAssetId);
			continue;
		}

		for (const part of normalizedParts) {
			if (
				!isPreparedGfxObjAsset(assetState.preparedByAssetId[part.gfxObjAssetId])
			) {
				missingGfxAssetIds.add(part.gfxObjAssetId);
				continue;
			}
			parts.push(part);
		}
	}

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

function collectStaticRenderableSourceInstances(
	assetState: AssetChannelState,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
	},
): StaticRenderableSourceInstance[] {
	return Object.values(assetState.preparedByAssetId).flatMap((asset) => {
		if (asset.payload.kind !== "outdoor-static-scene") {
			return [];
		}

		const landblockId = normalizeOutdoorLandblockId(asset.payload.landblockId);
		return [
			...(selection.detailLandblockIds.has(landblockId)
				? asset.payload.sceneryInstances.map((instance) =>
						normalizeSourceInstance("scenery", instance, null),
					)
				: []),
			...(selection.buildingLandblockIds.has(landblockId)
				? asset.payload.buildingInstances.map((instance) =>
						normalizeSourceInstance("building", instance, instance.numLeaves),
					)
				: []),
			...(selection.detailLandblockIds.has(landblockId)
				? asset.payload.generatedSceneryInstances.map((instance) =>
						normalizeGeneratedScenerySourceInstance(instance),
					)
				: []),
		];
	});
}

function normalizeSourceInstance(
	kind: StaticRenderableInstanceKind,
	instance:
		| PreparedOutdoorStaticSceneInstance
		| PreparedOutdoorStaticSceneBuilding,
	numLeaves: number | null,
): StaticRenderableSourceInstance {
	const owningLandblockId = normalizeOutdoorLandblockId(
		instance.owningLandblockId,
	);
	return {
		kind,
		instanceId: instance.instanceId,
		owningLandblockId,
		owningEnvCellId: null,
		sourceDid: instance.sourceDid,
		sourceAssetId: instance.sourceAssetId,
		sourceIndex: instance.sourceIndex,
		parentPlacements: [],
		chunkLocalInstancePlacement: instance.localPlacement,
		sourceScale: UNIT_SCALE,
		numLeaves,
	};
}

function normalizeGeneratedScenerySourceInstance(
	instance: PreparedOutdoorStaticSceneGeneratedSceneryInstance,
): StaticRenderableSourceInstance {
	const owningLandblockId = normalizeOutdoorLandblockId(
		instance.owningLandblockId,
	);
	return {
		kind: "generated-scenery",
		instanceId: instance.instanceId,
		owningLandblockId,
		owningEnvCellId: null,
		sourceDid: instance.sourceDid,
		sourceAssetId: instance.sourceAssetId,
		sourceIndex: instance.sourceIndex,
		parentPlacements: [],
		chunkLocalInstancePlacement: instance.localPlacement,
		sourceScale: {
			x: instance.scale,
			y: instance.scale,
			z: instance.scale,
		},
		numLeaves: null,
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

function normalizeStaticRenderableParts(
	instance: StaticRenderableSourceInstance,
	sourceAsset: PreparedAssetRecord,
): StaticRenderablePart[] | null {
	if (isPreparedGfxObjAsset(sourceAsset)) {
		return [
			createStaticRenderablePart(instance, {
				partIndex: 0,
				gfxObjId: sourceAsset.payload.gfxObjId,
				gfxObjAssetId: sourceAsset.request.assetId,
				partPlacements: [],
				scale: UNIT_SCALE,
			}),
		];
	}

	if (!isPreparedSetupModelAsset(sourceAsset)) {
		return null;
	}

	return sourceAsset.payload.parts.map((part) =>
		createStaticRenderablePart(instance, {
			partIndex: part.partIndex,
			gfxObjId: part.gfxObjId,
			gfxObjAssetId: part.gfxObjAssetId,
			partPlacements: deriveSetupPartLocalPlacements(part, sourceAsset.payload),
			scale: part.scale ?? UNIT_SCALE,
		}),
	);
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

function deriveActiveIndoorEnvCellIds(
	runtimeBatch: RuntimeBatchDto,
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null,
	structuredInteriorCoverage: StructuredInteriorCoverage | null,
): Set<number> {
	if (structuredInteriorCoverage !== null) {
		return new Set(structuredInteriorCoverage.envCellIds);
	}

	const browserFocusEnvCellId =
		browserDestinationToIndoorEnvCellId(browserDestination);
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

	const focusEnvCellId = runtimeBatch.residency.focusEnvCellId;
	if (focusEnvCellId === null) {
		return new Set();
	}

	return new Set(
		deriveStructuredInteriorCoverage(
			{
				kind: "landblock-closure",
				seedEnvCellIds: [
					focusEnvCellId,
					...runtimeBatch.residency.visibleCellIds,
				],
			},
			assetState.preparedByAssetId,
		).envCellIds,
	);
}

function collectIndoorStaticRenderableSourceInstances(
	assetState: AssetChannelState,
	activeEnvCellIds: Set<number>,
): StaticRenderableSourceInstance[] {
	return [...activeEnvCellIds].flatMap((envCellId) => {
		const envCell = getPreparedIndoorEnvCell(assetState, envCellId);
		if (!envCell) {
			return [];
		}

		return envCell.staticObjects.map((staticObject) =>
			normalizeIndoorStaticSourceInstance(staticObject),
		);
	});
}

function normalizeIndoorStaticSourceInstance(
	staticObject: PreparedIndoorStaticObject,
): StaticRenderableSourceInstance {
	const owningLandblockId = normalizeOutdoorLandblockId(
		staticObject.owningEnvCellId,
	);
	return {
		kind: "indoor-static",
		instanceId: staticObject.instanceId,
		owningLandblockId,
		owningEnvCellId: staticObject.owningEnvCellId,
		sourceDid: staticObject.sourceDid,
		sourceAssetId: staticObject.sourceAssetId,
		sourceIndex: staticObject.sourceIndex,
		parentPlacements: [],
		chunkLocalInstancePlacement: staticObject.localPlacement,
		sourceScale: UNIT_SCALE,
		numLeaves: null,
	};
}

function getPreparedIndoorEnvCell(
	assetState: AssetChannelState,
	envCellId: number,
): PreparedIndoorEnvCellPayload | null {
	const asset =
		assetState.preparedByAssetId[formatIndoorEnvCellAssetId(envCellId)];
	return asset?.payload.kind === "indoor-env-cell" ? asset.payload : null;
}

function deriveSetupPartLocalPlacements(
	part: PreparedSetupModelPart,
	setupModel: PreparedSetupModelPayload,
): PlacementTransformDto[] {
	const defaultPlacement = selectDefaultPlacementSet(setupModel);
	if (!defaultPlacement || defaultPlacement.length === 0) {
		return [];
	}

	return [defaultPlacement[part.partIndex] ?? IDENTITY_PLACEMENT];
}

function selectDefaultPlacementSet(
	setupModel: PreparedSetupModelPayload,
): PlacementTransformDto[] | null {
	const retailDefaultPlacement = setupModel.placementSets.find(
		(placement) => placement.key === 0x65,
	);
	const keyZeroPlacement = setupModel.placementSets.find(
		(placement) => placement.key === 0,
	);

	return (
		retailDefaultPlacement?.localPlacements ??
		keyZeroPlacement?.localPlacements ??
		setupModel.placementSets.toSorted((left, right) => left.key - right.key)[0]
			?.localPlacements ??
		null
	);
}

function formatHexId(value: number): string {
	return `0x${formatHex32(value)}`;
}
