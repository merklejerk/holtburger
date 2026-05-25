import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	browserDestinationToInteriorCellId,
	isIndoorBrowserDestination,
} from "../../app/browser-mode";
import type {
	AssetChannelState,
	PreparedEnvCellPayload,
	PreparedAssetRecord,
	PreparedGfxObjPayload,
	PreparedLandblockOutdoorPayload,
	PreparedSetupAppearancePayload,
	PreparedSetupModelPayload,
} from "../assets/types";
import {
	deriveTopologyEnvCellIdsForLandblocks,
	deriveTerrainFocusLandblockId,
} from "../assets/scene-asset-request-planner";
import {
	deriveStructuredInteriorCoverage,
	type StructuredInteriorCoverage,
} from "../assets/structured-interior-coverage";
import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
import {
	buildOutdoorCoverageLandblockIds,
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
	formatHex32,
	getOutdoorLandblockCoords,
	makeOutdoorLandblockId,
	normalizeOutdoorLandblockId,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
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
	createBaseMaterialAppearanceContext,
	createSetupAppearanceMaterialAppearanceContext,
	describeMaterialAppearanceSignature,
	type MaterialAppearanceContext,
} from "./material-appearance";
import {
	formatMaterialAssetId,
	type ResolvedMaterialSlot,
} from "./material-resources";
import { describeMaterialVariantSignature } from "./material-variants";

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
	materialAppearanceKey: string;
	materialAppearanceContext: MaterialAppearanceContext;
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
	partsByRenderGroupKey: Map<string, StaticRenderablePart[]>;
	missingSourceAssetIds: string[];
	missingGfxAssetIds: string[];
	missingSetupAppearanceAssetIds: string[];
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
						...deriveTopologyEnvCellIdsForLandblocks(
							assetState.preparedByAssetId,
							envCellLandblockSet,
						),
					],
				},
				assetState.preparedByAssetId,
			).envCellIds,
	);
	const sourceInstances = collectOutdoorStaticRenderableSourceInstances(
		assetState,
		{
			buildingLandblockIds: buildingLandblockSet,
			detailLandblockIds: detailLandblockSet,
		},
	)
		.concat(
			collectEnvCellStaticRenderableSourceInstances(
				assetState,
				activeInteriorEnvCellIds,
			),
		)
		.filter((instance) => activeLandblockSet.has(instance.owningLandblockId))
		.sort(compareSourceInstances);
	const missingSourceAssetIds = new Set<string>();
	const missingGfxAssetIds = new Set<string>();
	const missingSetupAppearanceAssetIds = new Set<string>();
	const parts: StaticRenderablePart[] = [
		...collectOutdoorStaticRenderableParts(
			assetState,
			{
				buildingLandblockIds: buildingLandblockSet,
				detailLandblockIds: detailLandblockSet,
			},
			missingSourceAssetIds,
			missingGfxAssetIds,
			missingSetupAppearanceAssetIds,
		),
		...collectEnvCellStaticRenderableParts(
			assetState,
			activeInteriorEnvCellIds,
			missingSourceAssetIds,
			missingGfxAssetIds,
			missingSetupAppearanceAssetIds,
		),
	];

	return {
		focusLandblockId,
		activeLandblockIds,
		sourceInstances,
		parts,
		partsByRenderGroupKey: groupStaticRenderablePartsByRenderGroupKey(parts),
		missingSourceAssetIds: [...missingSourceAssetIds].sort(),
		missingGfxAssetIds: [...missingGfxAssetIds].sort(),
		missingSetupAppearanceAssetIds: [...missingSetupAppearanceAssetIds].sort(),
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
	const sourceInstances = collectEnvCellStaticRenderableSourceInstances(
		assetState,
		activeEnvCellIds,
	).sort(compareSourceInstances);
	const missingSourceAssetIds = new Set<string>();
	const missingGfxAssetIds = new Set<string>();
	const missingSetupAppearanceAssetIds = new Set<string>();
	const parts: StaticRenderablePart[] = collectEnvCellStaticRenderableParts(
		assetState,
		activeEnvCellIds,
		missingSourceAssetIds,
		missingGfxAssetIds,
		missingSetupAppearanceAssetIds,
	);

	return {
		focusLandblockId: null,
		activeLandblockIds: [],
		sourceInstances,
		parts,
		partsByRenderGroupKey: groupStaticRenderablePartsByRenderGroupKey(parts),
		missingSourceAssetIds: [...missingSourceAssetIds].sort(),
		missingGfxAssetIds: [...missingGfxAssetIds].sort(),
		missingSetupAppearanceAssetIds: [...missingSetupAppearanceAssetIds].sort(),
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

function groupStaticRenderablePartsByRenderGroupKey(
	parts: StaticRenderablePart[],
): Map<string, StaticRenderablePart[]> {
	const partsByGroupKey = new Map<string, StaticRenderablePart[]>();
	for (const part of parts) {
		const groupKey = formatStaticRenderableRenderGroupKey(
			part.renderDomain,
			part.renderChunk.chunkKey,
			part.gfxObjAssetId,
			part.materialSignature,
		);
		const groupedParts = partsByGroupKey.get(groupKey);
		if (groupedParts) {
			groupedParts.push(part);
		} else {
			partsByGroupKey.set(groupKey, [part]);
		}
	}

	return partsByGroupKey;
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

function isPreparedSetupAppearanceAsset(
	asset: PreparedAssetRecord | undefined,
): asset is PreparedAssetRecord & { payload: PreparedSetupAppearancePayload } {
	return asset?.payload.kind === "setup-appearance";
}

function isPreparedLandblockOutdoorAsset(
	asset: PreparedAssetRecord | undefined,
): asset is PreparedAssetRecord & { payload: PreparedLandblockOutdoorPayload } {
	return asset?.payload.kind === "landblock-outdoor";
}

function isPreparedEnvCellAsset(
	asset: PreparedAssetRecord | undefined,
): asset is PreparedAssetRecord & { payload: PreparedEnvCellPayload } {
	return asset?.payload.kind === "env-cell";
}

export function createEmptyStaticRenderableSceneModel(): StaticRenderableSceneModel {
	return {
		focusLandblockId: null,
		activeLandblockIds: [],
		sourceInstances: [],
		parts: [],
		partsByRenderGroupKey: new Map(),
		missingSourceAssetIds: [],
		missingGfxAssetIds: [],
		missingSetupAppearanceAssetIds: [],
	};
}

function collectOutdoorStaticRenderableSourceInstances(
	assetState: AssetChannelState,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
	},
): StaticRenderableSourceInstance[] {
	const landblockIds = new Set([
		...selection.buildingLandblockIds,
		...selection.detailLandblockIds,
	]);
	return [...landblockIds].flatMap((landblockId) => {
		const asset =
			assetState.preparedByAssetId[formatLandblockOutdoorAssetId(landblockId)];
		if (!isPreparedLandblockOutdoorAsset(asset)) {
			return [];
		}
		return asset.payload.statics
			.map((member) =>
				normalizeOutdoorStaticSourceInstance(member, asset.payload),
			)
			.filter((instance) =>
				isOutdoorStaticInstanceSelected(instance, selection),
			);
	});
}

function collectEnvCellStaticRenderableSourceInstances(
	assetState: AssetChannelState,
	activeEnvCellIds: ReadonlySet<number>,
): StaticRenderableSourceInstance[] {
	return [...activeEnvCellIds].flatMap((envCellId) => {
		const asset = assetState.preparedByAssetId[formatEnvCellAssetId(envCellId)];
		if (!isPreparedEnvCellAsset(asset)) {
			return [];
		}
		return asset.payload.statics.map((member) =>
			normalizeEnvCellStaticSourceInstance(member, asset.payload),
		);
	});
}

function normalizeOutdoorStaticSourceInstance(
	member: PreparedLandblockOutdoorPayload["statics"][number],
	payload: PreparedLandblockOutdoorPayload,
): StaticRenderableSourceInstance {
	const normalizedPlacement = normalizeOutdoorStaticPlacement(
		member.localPlacement,
		payload.landblockId,
	);
	return {
		kind:
			member.kind === "explicit-object"
				? "scenery"
				: member.kind === "generated-scenery"
					? "generated-scenery"
					: "building",
		instanceId: member.instanceId,
		owningLandblockId: normalizedPlacement.landblockId,
		owningEnvCellId: null,
		sourceDid: member.sourceDid,
		sourceAssetId: member.sourceAssetId,
		sourceIndex: member.sourceIndex,
		parentPlacements: [],
		chunkLocalInstancePlacement: normalizedPlacement.localPlacement,
		sourceScale: member.sourceScale,
		numLeaves: member.building?.numLeaves ?? null,
	};
}

function normalizeOutdoorStaticPlacement(
	localPlacement: PlacementTransformDto,
	landblockId: number,
): { landblockId: number; localPlacement: PlacementTransformDto } {
	const blockDeltaX = Math.floor(
		localPlacement.origin.x / OUTDOOR_LANDBLOCK_WORLD_SIZE,
	);
	const blockDeltaY = Math.floor(
		localPlacement.origin.y / OUTDOOR_LANDBLOCK_WORLD_SIZE,
	);
	if (blockDeltaX === 0 && blockDeltaY === 0) {
		return {
			landblockId: normalizeOutdoorLandblockId(landblockId),
			localPlacement,
		};
	}

	const coords = getOutdoorLandblockCoords(landblockId);
	return {
		landblockId: makeOutdoorLandblockId(
			coords.x + blockDeltaX,
			coords.y + blockDeltaY,
		),
		localPlacement: {
			origin: {
				...localPlacement.origin,
				x: localPlacement.origin.x - blockDeltaX * OUTDOOR_LANDBLOCK_WORLD_SIZE,
				y: localPlacement.origin.y - blockDeltaY * OUTDOOR_LANDBLOCK_WORLD_SIZE,
			},
			orientation: localPlacement.orientation,
		},
	};
}

function normalizeEnvCellStaticSourceInstance(
	member: PreparedEnvCellPayload["statics"][number],
	payload: PreparedEnvCellPayload,
): StaticRenderableSourceInstance {
	return {
		kind: "indoor-static",
		instanceId: member.instanceId,
		owningLandblockId: normalizeOutdoorLandblockId(payload.envCellId),
		owningEnvCellId: payload.envCellId,
		sourceDid: member.sourceDid,
		sourceAssetId: member.sourceAssetId,
		sourceIndex: member.sourceIndex,
		parentPlacements: [],
		chunkLocalInstancePlacement: member.localPlacement,
		sourceScale: member.sourceScale,
		numLeaves: null,
	};
}

function isOutdoorStaticInstanceSelected(
	instance: StaticRenderableSourceInstance,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
	},
): boolean {
	return instance.kind === "building"
		? selection.buildingLandblockIds.has(instance.owningLandblockId)
		: selection.detailLandblockIds.has(instance.owningLandblockId);
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
		materialAppearanceContext?: MaterialAppearanceContext;
		materialSlots: ResolvedMaterialSlot[];
		partPlacements: PlacementTransformDto[];
		scale: Vec3Dto;
	},
): StaticRenderablePart {
	const debugColorKey = `${instance.sourceAssetId}:${formatHexId(part.gfxObjId)}:${part.partIndex}`;
	const renderChunk = deriveStaticRenderablePartRenderChunk(instance);
	const renderDomain = staticRenderableRenderDomainForKind(instance.kind);
	const localRenderKey = `${instance.instanceId}/part/${part.partIndex}/${part.gfxObjAssetId}`;
	const materialAppearanceContext =
		part.materialAppearanceContext ??
		createBaseMaterialAppearanceContext(part.materialAppearanceKey);
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
		materialAppearanceContext,
		materialSlots: part.materialSlots,
		materialSignature: describeMaterialSignature(
			materialAppearanceContext,
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

function collectOutdoorStaticRenderableParts(
	assetState: AssetChannelState,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
	},
	missingSourceAssetIds: Set<string>,
	missingGfxAssetIds: Set<string>,
	missingSetupAppearanceAssetIds: Set<string>,
): StaticRenderablePart[] {
	return collectOutdoorStaticRenderableSourceInstances(
		assetState,
		selection,
	).flatMap((instance) =>
		expandStaticRenderableSourceInstanceParts(
			instance,
			assetState,
			missingSourceAssetIds,
			missingGfxAssetIds,
			missingSetupAppearanceAssetIds,
		),
	);
}

function collectEnvCellStaticRenderableParts(
	assetState: AssetChannelState,
	activeEnvCellIds: ReadonlySet<number>,
	missingSourceAssetIds: Set<string>,
	missingGfxAssetIds: Set<string>,
	missingSetupAppearanceAssetIds: Set<string>,
): StaticRenderablePart[] {
	return collectEnvCellStaticRenderableSourceInstances(
		assetState,
		activeEnvCellIds,
	).flatMap((instance) =>
		expandStaticRenderableSourceInstanceParts(
			instance,
			assetState,
			missingSourceAssetIds,
			missingGfxAssetIds,
			missingSetupAppearanceAssetIds,
		),
	);
}

function expandStaticRenderableSourceInstanceParts(
	instance: StaticRenderableSourceInstance,
	assetState: AssetChannelState,
	missingSourceAssetIds: Set<string>,
	missingGfxAssetIds: Set<string>,
	missingSetupAppearanceAssetIds: Set<string>,
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
		const setupAppearance = findPreparedSetupAppearance(
			assetState,
			sourceAsset.payload,
		);
		if (setupAppearance) {
			return expandSetupAppearanceParts({
				instance,
				assetState,
				setupModel: sourceAsset.payload,
				setupAppearance,
				missingGfxAssetIds,
			});
		}
		missingSetupAppearanceAssetIds.add(
			formatSetupAppearanceAssetId(sourceAsset.payload.setupModelId),
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
					materialAppearanceKey: "setup-base",
					materialSlots: resolveSetupPartMaterialSlots(assetState, part),
					partPlacements: deriveSetupPartDefaultPlacements(
						sourceAsset.payload,
						part.partIndex,
					),
					scale: part.scale ?? UNIT_SCALE,
				}),
			];
		});
	}

	missingSourceAssetIds.add(instance.sourceAssetId);
	return [];
}

function findPreparedSetupAppearance(
	assetState: AssetChannelState,
	setupModel: PreparedSetupModelPayload,
): PreparedSetupAppearancePayload | null {
	const asset =
		assetState.preparedByAssetId[
			formatSetupAppearanceAssetId(setupModel.setupModelId)
		];
	if (
		!isPreparedSetupAppearanceAsset(asset) ||
		asset.payload.setupModelId !== setupModel.setupModelId
	) {
		return null;
	}
	return asset.payload;
}

function expandSetupAppearanceParts(options: {
	instance: StaticRenderableSourceInstance;
	assetState: AssetChannelState;
	setupModel: PreparedSetupModelPayload;
	setupAppearance: PreparedSetupAppearancePayload;
	missingGfxAssetIds: Set<string>;
}): StaticRenderablePart[] {
	const appearanceContext = createSetupAppearanceMaterialAppearanceContext(
		options.setupAppearance,
	);
	return options.setupAppearance.parts.flatMap((part) => {
		if (
			!isPreparedGfxObjAsset(
				options.assetState.preparedByAssetId[part.gfxObjAssetId],
			)
		) {
			options.missingGfxAssetIds.add(part.gfxObjAssetId);
			return [];
		}

		const setupModelPart = options.setupModel.parts.find(
			(modelPart) => modelPart.partIndex === part.partIndex,
		);
		return [
			createStaticRenderablePart(options.instance, {
				partIndex: part.partIndex,
				gfxObjId: part.gfxObjId,
				gfxObjAssetId: part.gfxObjAssetId,
				materialAppearanceKey: options.setupAppearance.appearanceKey,
				materialAppearanceContext: appearanceContext,
				materialSlots: resolveSetupAppearancePartMaterialSlots(
					options.assetState,
					part,
				),
				partPlacements: deriveSetupPartDefaultPlacements(
					options.setupModel,
					part.partIndex,
				),
				scale: setupModelPart?.scale ?? UNIT_SCALE,
			}),
		];
	});
}

function resolveSetupAppearancePartMaterialSlots(
	assetState: AssetChannelState,
	part: PreparedSetupAppearancePayload["parts"][number],
): ResolvedMaterialSlot[] {
	const gfxObjAsset = assetState.preparedByAssetId[part.gfxObjAssetId];
	return isPreparedGfxObjAsset(gfxObjAsset)
		? applyRenderGeometryMaterialVariants(
				part.materialSlots,
				gfxObjAsset.payload,
			)
		: part.materialSlots;
}

function deriveSetupPartDefaultPlacements(
	setupModel: PreparedSetupModelPayload,
	partIndex: number,
): PlacementTransformDto[] {
	const placementSet = selectDefaultSetupPlacementSet(setupModel);
	const placement = placementSet?.localPlacements[partIndex];
	return placement ? [placement] : [];
}

function selectDefaultSetupPlacementSet(
	setupModel: PreparedSetupModelPayload,
): PreparedSetupModelPayload["placementSets"][number] | null {
	return (
		setupModel.placementSets.find(
			(placementSet) => placementSet.key === 0x65,
		) ??
		setupModel.placementSets.find((placementSet) => placementSet.key === 0) ??
		setupModel.placementSets.reduce<
			PreparedSetupModelPayload["placementSets"][number] | null
		>(
			(selectedPlacementSet, placementSet) =>
				selectedPlacementSet === null ||
				placementSet.key < selectedPlacementSet.key
					? placementSet
					: selectedPlacementSet,
			null,
		)
	);
}

function resolveGfxObjMaterialSlots(
	gfxObj: PreparedGfxObjPayload,
): ResolvedMaterialSlot[] {
	return applyRenderGeometryMaterialVariants(
		gfxObj.surfaceIds.map((surfaceId, slotIndex) => ({
			slotIndex,
			surfaceId,
			materialAssetId: formatMaterialAssetId(surfaceId),
		})),
		gfxObj,
	);
}

function resolveSetupPartMaterialSlots(
	assetState: AssetChannelState,
	part: PreparedSetupModelPayload["parts"][number],
): ResolvedMaterialSlot[] {
	const gfxObjAsset = assetState.preparedByAssetId[part.gfxObjAssetId];
	return isPreparedGfxObjAsset(gfxObjAsset)
		? resolveGfxObjMaterialSlots(gfxObjAsset.payload)
		: [];
}

function applyRenderGeometryMaterialVariants(
	slots: readonly ResolvedMaterialSlot[],
	gfxObj: PreparedGfxObjPayload,
): ResolvedMaterialSlot[] {
	const variantsBySlotIndex = collectMaterialVariantsBySlotIndex(gfxObj);
	return slots.flatMap((slot): ResolvedMaterialSlot[] => {
		const variants = variantsBySlotIndex.get(slot.slotIndex);
		if (!variants || variants.size === 0) {
			return [{ ...slot, materialVariantSignature: null }];
		}
		return [...variants]
			.sort(compareMaterialVariantSignatures)
			.map((materialVariantSignature) => ({
				...slot,
				materialVariantSignature,
			}));
	});
}

function compareMaterialVariantSignatures(
	left: string | null,
	right: string | null,
): number {
	return (left ?? "").localeCompare(right ?? "");
}

function collectMaterialVariantsBySlotIndex(
	gfxObj: PreparedGfxObjPayload,
): Map<number, Set<string | null>> {
	const variantsBySlotIndex = new Map<number, Set<string | null>>();
	for (const triangle of gfxObj.renderGeometry.triangles) {
		if (triangle.surfaceId === null) {
			continue;
		}
		const slotIndex = triangle.surfaceId - 1;
		if (slotIndex < 0 || slotIndex >= gfxObj.surfaceIds.length) {
			continue;
		}
		let variants: Set<string | null> | undefined =
			variantsBySlotIndex.get(slotIndex);
		if (!variants) {
			variants = new Set<string | null>();
			variantsBySlotIndex.set(slotIndex, variants);
		}
		variants.add(triangle.materialVariantSignature ?? null);
	}
	return variantsBySlotIndex;
}

function describeMaterialSignature(
	appearance: MaterialAppearanceContext,
	slots: readonly ResolvedMaterialSlot[],
): string {
	return [
		describeMaterialAppearanceSignature(appearance),
		...slots
			.map((slot) =>
				[
					slot.slotIndex,
					slot.surfaceId,
					slot.materialAssetId,
					describeMaterialVariantSignature(slot.materialVariantSignature),
				].join(":"),
			)
			.sort(),
	].join(",");
}

function formatHexId(value: number): string {
	return `0x${formatHex32(value)}`;
}

function formatSetupAppearanceAssetId(setupModelId: number): string {
	return `setup-appearance/${setupModelId.toString(16).padStart(8, "0")}`;
}
