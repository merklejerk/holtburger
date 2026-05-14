import type { BrowserLocationSelection } from "../../app/browser-mode";
import { isIndoorBrowserDestination } from "../../app/browser-mode";
import type {
	AssetChannelState,
	PreparedAssetRecord,
	PreparedGfxObjPayload,
	PreparedOutdoorStaticSceneBuilding,
	PreparedOutdoorStaticSceneGeneratedSceneryInstance,
	PreparedOutdoorStaticSceneInstance,
	PreparedSetupModelPart,
	PreparedSetupModelPayload,
} from "../assets/types";
import { deriveTerrainFocusLandblockId } from "../assets/asset-channel";
import type {
	PlacementTransformDto,
	RuntimeBatchDto,
	Vec3Dto,
} from "../host/contracts";
import {
	buildOutdoorCoverageLandblockIds,
	formatHex32,
	getOutdoorLandblockCoords,
	normalizeOutdoorLandblockId,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";

type StaticRenderableInstanceKind =
	| "scenery"
	| "building"
	| "generated-scenery";

interface StaticRenderableSourceInstance {
	kind: StaticRenderableInstanceKind;
	instanceId: string;
	owningLandblockId: number;
	sourceDid: number;
	sourceAssetId: string;
	sourceIndex: number;
	localPlacement: PlacementTransformDto;
	landblockWorldOffset: Vec3Dto;
	sourceScale: Vec3Dto;
	numLeaves: number | null;
}

export interface StaticRenderablePart {
	renderKey: string;
	instanceId: string;
	sourceAssetId: string;
	sourceDid: number;
	owningLandblockId: number;
	kind: StaticRenderableInstanceKind;
	partIndex: number;
	gfxObjId: number;
	gfxObjAssetId: string;
	instancePlacement: PlacementTransformDto;
	partPlacements: PlacementTransformDto[];
	landblockWorldOffset: Vec3Dto;
	scale: Vec3Dto;
	debugColorKey: string;
}

export interface StaticRenderableSceneModel {
	focusLandblockId: number | null;
	activeLandblockIds: number[];
	sourceInstances: StaticRenderableSourceInstance[];
	parts: StaticRenderablePart[];
	partsByGfxAssetId: Map<string, StaticRenderablePart[]>;
	missingSourceAssetIds: string[];
	missingGfxAssetIds: string[];
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
	landblockCoverageRadius = 1,
): StaticRenderableSceneModel {
	if (
		!runtimeBatch ||
		runtimeBatch.residency.indoors ||
		isIndoorBrowserDestination(browserDestination)
	) {
		return emptyStaticRenderableSceneModel();
	}

	const focusLandblockId = deriveTerrainFocusLandblockId(
		runtimeBatch,
		browserDestination,
	);
	const activeLandblockIds = buildOutdoorCoverageLandblockIds(
		focusLandblockId,
		landblockCoverageRadius,
	).sort((left, right) => left - right);
	const activeLandblockSet = new Set(activeLandblockIds);
	const sourceInstances = collectStaticRenderableSourceInstances(
		assetState,
		activeLandblockSet,
		focusLandblockId,
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
		partsByGfxAssetId: groupStaticRenderablePartsByGfxAssetId(parts),
		missingSourceAssetIds: [...missingSourceAssetIds].sort(),
		missingGfxAssetIds: [...missingGfxAssetIds].sort(),
	};
}

function groupStaticRenderablePartsByGfxAssetId(
	parts: StaticRenderablePart[],
): Map<string, StaticRenderablePart[]> {
	const partsByGfxAssetId = new Map<string, StaticRenderablePart[]>();
	for (const part of parts) {
		const groupedParts = partsByGfxAssetId.get(part.gfxObjAssetId);
		if (groupedParts) {
			groupedParts.push(part);
		} else {
			partsByGfxAssetId.set(part.gfxObjAssetId, [part]);
		}
	}

	return partsByGfxAssetId;
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

function emptyStaticRenderableSceneModel(): StaticRenderableSceneModel {
	return {
		focusLandblockId: null,
		activeLandblockIds: [],
		sourceInstances: [],
		parts: [],
		partsByGfxAssetId: new Map(),
		missingSourceAssetIds: [],
		missingGfxAssetIds: [],
	};
}

function collectStaticRenderableSourceInstances(
	assetState: AssetChannelState,
	activeLandblockSet: Set<number>,
	focusLandblockId: number,
): StaticRenderableSourceInstance[] {
	return Object.values(assetState.preparedByAssetId).flatMap((asset) => {
		if (
			asset.payload.kind !== "outdoor-static-scene" ||
			!activeLandblockSet.has(asset.payload.landblockId)
		) {
			return [];
		}

		return [
			...asset.payload.sceneryInstances.map((instance) =>
				normalizeSourceInstance("scenery", instance, null, focusLandblockId),
			),
			...asset.payload.buildingInstances.map((instance) =>
				normalizeSourceInstance(
					"building",
					instance,
					instance.numLeaves,
					focusLandblockId,
				),
			),
			...asset.payload.generatedSceneryInstances.map((instance) =>
				normalizeGeneratedScenerySourceInstance(instance, focusLandblockId),
			),
		];
	});
}

function normalizeSourceInstance(
	kind: StaticRenderableInstanceKind,
	instance:
		| PreparedOutdoorStaticSceneInstance
		| PreparedOutdoorStaticSceneBuilding,
	numLeaves: number | null,
	focusLandblockId: number,
): StaticRenderableSourceInstance {
	const owningLandblockId = normalizeOutdoorLandblockId(
		instance.owningLandblockId,
	);
	return {
		kind,
		instanceId: instance.instanceId,
		owningLandblockId,
		sourceDid: instance.sourceDid,
		sourceAssetId: instance.sourceAssetId,
		sourceIndex: instance.sourceIndex,
		localPlacement: instance.localPlacement,
		landblockWorldOffset: deriveLandblockWorldOffset(
			owningLandblockId,
			focusLandblockId,
		),
		sourceScale: UNIT_SCALE,
		numLeaves,
	};
}

function normalizeGeneratedScenerySourceInstance(
	instance: PreparedOutdoorStaticSceneGeneratedSceneryInstance,
	focusLandblockId: number,
): StaticRenderableSourceInstance {
	const owningLandblockId = normalizeOutdoorLandblockId(
		instance.owningLandblockId,
	);
	return {
		kind: "generated-scenery",
		instanceId: instance.instanceId,
		owningLandblockId,
		sourceDid: instance.sourceDid,
		sourceAssetId: instance.sourceAssetId,
		sourceIndex: instance.sourceIndex,
		localPlacement: instance.localPlacement,
		landblockWorldOffset: deriveLandblockWorldOffset(
			owningLandblockId,
			focusLandblockId,
		),
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
	return {
		renderKey: `${instance.instanceId}/part/${part.partIndex}/${part.gfxObjAssetId}`,
		instanceId: instance.instanceId,
		sourceAssetId: instance.sourceAssetId,
		sourceDid: instance.sourceDid,
		owningLandblockId: instance.owningLandblockId,
		kind: instance.kind,
		partIndex: part.partIndex,
		gfxObjId: part.gfxObjId,
		gfxObjAssetId: part.gfxObjAssetId,
		instancePlacement: instance.localPlacement,
		partPlacements: part.partPlacements,
		landblockWorldOffset: instance.landblockWorldOffset,
		scale: multiplyScale(instance.sourceScale, part.scale),
		debugColorKey,
	};
}

function multiplyScale(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.x * right.x,
		y: left.y * right.y,
		z: left.z * right.z,
	};
}

function deriveLandblockWorldOffset(
	owningLandblockId: number,
	focusLandblockId: number,
): Vec3Dto {
	const owningCoords = getOutdoorLandblockCoords(owningLandblockId);
	const focusCoords = getOutdoorLandblockCoords(focusLandblockId);

	return {
		x: (owningCoords.x - focusCoords.x) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		y: (owningCoords.y - focusCoords.y) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		z: 0,
	};
}

function deriveSetupPartLocalPlacements(
	part: PreparedSetupModelPart,
	setupModel: PreparedSetupModelPayload,
): PlacementTransformDto[] {
	const defaultPlacement = selectDefaultPlacementSet(setupModel);
	if (!defaultPlacement || defaultPlacement.length === 0) {
		return [];
	}

	const placementsByPartIndex = new Map(
		setupModel.parts.map((entry) => [
			entry.partIndex,
			defaultPlacement[entry.partIndex] ?? IDENTITY_PLACEMENT,
		]),
	);
	const partsByIndex = new Map(
		setupModel.parts.map((entry) => [entry.partIndex, entry]),
	);
	const chain: PlacementTransformDto[] = [];
	const visitedPartIndexes = new Set<number>();
	let currentPart: PreparedSetupModelPart | undefined = part;

	while (currentPart && !visitedPartIndexes.has(currentPart.partIndex)) {
		visitedPartIndexes.add(currentPart.partIndex);
		chain.unshift(
			placementsByPartIndex.get(currentPart.partIndex) ?? IDENTITY_PLACEMENT,
		);
		currentPart =
			currentPart.parentIndex === null
				? undefined
				: partsByIndex.get(currentPart.parentIndex);
	}

	return chain;
}

function selectDefaultPlacementSet(
	setupModel: PreparedSetupModelPayload,
): PlacementTransformDto[] | null {
	const keyZeroPlacement = setupModel.placementSets.find(
		(placement) => placement.key === 0,
	);
	return (
		keyZeroPlacement?.localPlacements ??
		setupModel.placementSets.toSorted((left, right) => left.key - right.key)[0]
			?.localPlacements ??
		null
	);
}

function formatHexId(value: number): string {
	return `0x${formatHex32(value)}`;
}
