import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	browserDestinationToInteriorCellId,
	isIndoorBrowserDestination,
} from "../../app/browser-mode";
import type {
	PreparedEnvCellPayload,
	PreparedAssetRecord,
	PreparedGfxObjPayload,
	PreparedLandblockOutdoorPayload,
	PreparedSetupAppearancePayload,
	PreparedSetupModelPayload,
	PreparedTextureVelocity,
} from "../assets/types";
import {
	deriveTopologyEnvCellIdsForLandblocksFromAssets,
	deriveTerrainFocusLandblockId,
} from "../assets/scene-asset-request-planner";
import {
	deriveStructuredInteriorCoverageFromLookup,
	type StructuredInteriorCoverage,
} from "../assets/structured-interior-coverage";
import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
import {
	buildOutdoorCoverageLandblockIds,
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
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
	createBaseMaterialAppearanceContext,
	createSetupAppearanceMaterialAppearanceContext,
	describeMaterialAppearanceSignature,
	type MaterialAppearanceContext,
} from "./material-appearance";
import {
	applyRenderGeometryMaterialVariants,
	type ResolvedMaterialSlot,
} from "./material-plan";
import { formatMaterialAssetId } from "./material-signatures";
import { describeMaterialVariantSignature } from "./material-variants";
import {
	describeRegionDetailRoleSignature,
	type RegionDetailRoleKind,
} from "./region-detail-overlays";
import {
	describeTextureVelocitySignature,
	normalizeTextureVelocity,
	type TextureVelocityRenderState,
} from "./texture-velocity";
import type { RendererAssetReadModel } from "./renderer-asset-read-model";

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
	regionNumber: number;
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
	regionNumber: number;
	owningEnvCellId: number | null;
	renderChunk: RenderChunkPlacement;
	kind: StaticRenderableInstanceKind;
	partIndex: number;
	gfxObjId: number;
	gfxObjAssetId: string;
	materialAppearanceContext: MaterialAppearanceContext;
	materialSlots: ResolvedMaterialSlot[];
	materialSignature: string;
	parentPlacements: PlacementTransformDto[];
	chunkLocalInstancePlacement: PlacementTransformDto;
	partPlacements: PlacementTransformDto[];
	scale: Vec3Dto;
	debugColorKey: string;
	textureVelocity: TextureVelocityRenderState | null;
	textureVelocitySignature: string;
	detailRoleKind: RegionDetailRoleKind;
	detailSignature: string;
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
	assetReadModel: RendererAssetReadModel,
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
			assetReadModel,
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
			deriveStructuredInteriorCoverageFromLookup(
				{
					kind: "landblock-closure",
					seedEnvCellIds: [
						...deriveTopologyEnvCellIdsForLandblocksFromAssets(
							assetReadModel.values(),
							envCellLandblockSet,
						),
					],
				},
				assetReadModel,
			).envCellIds,
	);
	const sourceInstances = collectOutdoorStaticRenderableSourceInstances(
		assetReadModel,
		{
			buildingLandblockIds: buildingLandblockSet,
			detailLandblockIds: detailLandblockSet,
		},
	)
		.concat(
			collectEnvCellStaticRenderableSourceInstances(
				assetReadModel,
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
			assetReadModel,
			{
				buildingLandblockIds: buildingLandblockSet,
				detailLandblockIds: detailLandblockSet,
			},
			missingSourceAssetIds,
			missingGfxAssetIds,
			missingSetupAppearanceAssetIds,
		),
		...collectEnvCellStaticRenderableParts(
			assetReadModel,
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
	assetReadModel: RendererAssetReadModel,
	browserDestination: BrowserLocationSelection | null,
	structuredInteriorCoverage: StructuredInteriorCoverage | null,
): StaticRenderableSceneModel {
	const activeEnvCellIds = deriveActiveInteriorCellIds(
		assetReadModel,
		browserDestination,
		structuredInteriorCoverage,
	);
	const sourceInstances = collectEnvCellStaticRenderableSourceInstances(
		assetReadModel,
		activeEnvCellIds,
	).sort(compareSourceInstances);
	const missingSourceAssetIds = new Set<string>();
	const missingGfxAssetIds = new Set<string>();
	const missingSetupAppearanceAssetIds = new Set<string>();
	const parts: StaticRenderablePart[] = collectEnvCellStaticRenderableParts(
		assetReadModel,
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
	textureVelocitySignature: string,
	detailSignature: string,
): string {
	return `${renderDomain}|${chunkKey}|${gfxObjAssetId}|${materialSignature}|${textureVelocitySignature}|${detailSignature}`;
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
			part.textureVelocitySignature,
			part.detailSignature,
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
	asset: PreparedAssetRecord | null | undefined,
): asset is PreparedAssetRecord & { payload: PreparedGfxObjPayload } {
	return asset?.payload.kind === "gfx-obj";
}

function isPreparedSetupModelAsset(
	asset: PreparedAssetRecord | null | undefined,
): asset is PreparedAssetRecord & { payload: PreparedSetupModelPayload } {
	return asset?.payload.kind === "setup-model";
}

function isPreparedSetupAppearanceAsset(
	asset: PreparedAssetRecord | null | undefined,
): asset is PreparedAssetRecord & { payload: PreparedSetupAppearancePayload } {
	return asset?.payload.kind === "setup-appearance";
}

function isPreparedLandblockOutdoorAsset(
	asset: PreparedAssetRecord | null | undefined,
): asset is PreparedAssetRecord & { payload: PreparedLandblockOutdoorPayload } {
	return asset?.payload.kind === "landblock-outdoor";
}

function isPreparedEnvCellAsset(
	asset: PreparedAssetRecord | null | undefined,
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
	assetReadModel: RendererAssetReadModel,
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
		const asset = assetReadModel.get(formatLandblockOutdoorAssetId(landblockId));
		if (!isPreparedLandblockOutdoorAsset(asset)) {
			return [];
		}
		return asset.payload.statics
			.map((member) => deriveOutdoorStaticSourceInstance(member, asset.payload))
			.filter((instance) =>
				isOutdoorStaticInstanceSelected(instance, selection),
			);
	});
}

function collectEnvCellStaticRenderableSourceInstances(
	assetReadModel: RendererAssetReadModel,
	activeEnvCellIds: ReadonlySet<number>,
): StaticRenderableSourceInstance[] {
	return [...activeEnvCellIds].flatMap((envCellId) => {
		const asset = assetReadModel.get(formatEnvCellAssetId(envCellId));
		if (!isPreparedEnvCellAsset(asset)) {
			return [];
		}
		return asset.payload.statics.map((member) =>
			normalizeEnvCellStaticSourceInstance(member, asset.payload),
		);
	});
}

function deriveOutdoorStaticSourceInstance(
	member: PreparedLandblockOutdoorPayload["statics"][number],
	payload: PreparedLandblockOutdoorPayload,
): StaticRenderableSourceInstance {
	return {
		kind:
			member.kind === "explicit-object"
				? "scenery"
				: member.kind === "generated-scenery"
					? "generated-scenery"
					: "building",
		instanceId: member.instanceId,
		owningLandblockId: normalizeOutdoorLandblockId(payload.landblockId),
		regionNumber: payload.regionNumber,
		owningEnvCellId: null,
		sourceDid: member.sourceDid,
		sourceAssetId: member.sourceAssetId,
		sourceIndex: member.sourceIndex,
		parentPlacements: [],
		chunkLocalInstancePlacement: member.localPlacement,
		sourceScale: member.sourceScale,
		numLeaves: member.building?.numLeaves ?? null,
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
		regionNumber: payload.regionNumber,
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
		materialAppearanceContext: MaterialAppearanceContext;
		materialSlots: ResolvedMaterialSlot[];
		partPlacements: PlacementTransformDto[];
		scale: Vec3Dto;
		textureVelocity?: TextureVelocityRenderState | null;
		assetReadModel: RendererAssetReadModel;
	},
): StaticRenderablePart {
	const debugColorKey = `${instance.sourceAssetId}:${formatHexId(part.gfxObjId)}:${part.partIndex}`;
	const renderChunk = deriveStaticRenderablePartRenderChunk(instance);
	const renderDomain = staticRenderableRenderDomainForKind(instance.kind);
	const localRenderKey = `${instance.instanceId}/part/${part.partIndex}/${part.gfxObjAssetId}`;
	const materialAppearanceContext = part.materialAppearanceContext;
	const textureVelocity = normalizeTextureVelocity(
		part.textureVelocity ?? null,
	);
	const textureVelocitySignature =
		describeTextureVelocitySignature(textureVelocity);
	const detailRoleKind = staticRenderableDetailRoleKindForKind(instance.kind);
	const detailSignature = describeRegionDetailRoleSignature({
		assetReadModel: part.assetReadModel,
		regionNumber: instance.regionNumber,
		roleKind: detailRoleKind,
	});
	return {
		renderKey: formatRenderDomainKey(renderDomain, localRenderKey),
		renderDomain,
		instanceId: instance.instanceId,
		sourceAssetId: instance.sourceAssetId,
		sourceDid: instance.sourceDid,
		owningLandblockId: instance.owningLandblockId,
		regionNumber: instance.regionNumber,
		owningEnvCellId: instance.owningEnvCellId,
		renderChunk,
		kind: instance.kind,
		partIndex: part.partIndex,
		gfxObjId: part.gfxObjId,
		gfxObjAssetId: part.gfxObjAssetId,
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
		textureVelocity,
		textureVelocitySignature,
		detailRoleKind,
		detailSignature,
	};
}

function staticRenderableRenderDomainForKind(
	kind: StaticRenderableInstanceKind,
): StaticRenderableRenderDomain {
	return kind === "indoor-static"
		? WORLD_RENDER_DOMAIN.interiorStatic
		: WORLD_RENDER_DOMAIN.exteriorStatic;
}

function staticRenderableDetailRoleKindForKind(
	kind: StaticRenderableInstanceKind,
): RegionDetailRoleKind {
	return kind === "building" ? "building" : "object";
}

function multiplyScale(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.x * right.x,
		y: left.y * right.y,
		z: left.z * right.z,
	};
}

function deriveActiveInteriorCellIds(
	assetReadModel: RendererAssetReadModel,
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
			deriveStructuredInteriorCoverageFromLookup(
				{
					kind: "landblock-closure",
					seedEnvCellIds: [browserFocusEnvCellId],
				},
				assetReadModel,
			).envCellIds,
		);
	}

	return new Set();
}

function collectOutdoorStaticRenderableParts(
	assetReadModel: RendererAssetReadModel,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
	},
	missingSourceAssetIds: Set<string>,
	missingGfxAssetIds: Set<string>,
	missingSetupAppearanceAssetIds: Set<string>,
): StaticRenderablePart[] {
	return collectOutdoorStaticRenderableSourceInstances(
		assetReadModel,
		selection,
	).flatMap((instance) =>
		expandStaticRenderableSourceInstanceParts(
			instance,
			assetReadModel,
			missingSourceAssetIds,
			missingGfxAssetIds,
			missingSetupAppearanceAssetIds,
		),
	);
}

function collectEnvCellStaticRenderableParts(
	assetReadModel: RendererAssetReadModel,
	activeEnvCellIds: ReadonlySet<number>,
	missingSourceAssetIds: Set<string>,
	missingGfxAssetIds: Set<string>,
	missingSetupAppearanceAssetIds: Set<string>,
): StaticRenderablePart[] {
	return collectEnvCellStaticRenderableSourceInstances(
		assetReadModel,
		activeEnvCellIds,
	).flatMap((instance) =>
		expandStaticRenderableSourceInstanceParts(
			instance,
			assetReadModel,
			missingSourceAssetIds,
			missingGfxAssetIds,
			missingSetupAppearanceAssetIds,
		),
	);
}

function expandStaticRenderableSourceInstanceParts(
	instance: StaticRenderableSourceInstance,
	assetReadModel: RendererAssetReadModel,
	missingSourceAssetIds: Set<string>,
	missingGfxAssetIds: Set<string>,
	missingSetupAppearanceAssetIds: Set<string>,
): StaticRenderablePart[] {
	const sourceAsset = assetReadModel.get(instance.sourceAssetId);
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
				materialAppearanceContext: createBaseMaterialAppearanceContext("base"),
				materialSlots: resolveGfxObjMaterialSlots(sourceAsset.payload),
				partPlacements: [],
				scale: UNIT_SCALE,
				assetReadModel,
			}),
		];
	}

	if (isPreparedSetupModelAsset(sourceAsset)) {
		const setupAppearance = findPreparedSetupAppearance(
			assetReadModel,
			sourceAsset.payload,
		);
		if (setupAppearance) {
			return expandSetupAppearanceParts({
				instance,
				assetReadModel,
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
				!isPreparedGfxObjAsset(assetReadModel.get(part.gfxObjAssetId))
			) {
				missingGfxAssetIds.add(part.gfxObjAssetId);
				return [];
			}

			return [
				createStaticRenderablePart(instance, {
					partIndex: part.partIndex,
					gfxObjId: part.gfxObjId,
					gfxObjAssetId: part.gfxObjAssetId,
					materialAppearanceContext:
						createBaseMaterialAppearanceContext("setup-base"),
					materialSlots: resolveSetupPartMaterialSlots(assetReadModel, part),
					partPlacements: deriveSetupPartDefaultPlacements(
						sourceAsset.payload,
						part.partIndex,
					),
					scale: part.scale ?? UNIT_SCALE,
					textureVelocity: deriveSetupPartTextureVelocity(
						sourceAsset.payload,
						part.partIndex,
					),
					assetReadModel,
				}),
			];
		});
	}

	missingSourceAssetIds.add(instance.sourceAssetId);
	return [];
}

function findPreparedSetupAppearance(
	assetReadModel: RendererAssetReadModel,
	setupModel: PreparedSetupModelPayload,
): PreparedSetupAppearancePayload | null {
	const asset = assetReadModel.get(
		formatSetupAppearanceAssetId(setupModel.setupModelId),
	);
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
	assetReadModel: RendererAssetReadModel;
	setupModel: PreparedSetupModelPayload;
	setupAppearance: PreparedSetupAppearancePayload;
	missingGfxAssetIds: Set<string>;
}): StaticRenderablePart[] {
	const appearanceContext = createSetupAppearanceMaterialAppearanceContext(
		options.setupAppearance,
	);
	return options.setupAppearance.parts.flatMap((part) => {
		if (
			!isPreparedGfxObjAsset(options.assetReadModel.get(part.gfxObjAssetId))
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
				materialAppearanceContext: appearanceContext,
				materialSlots: resolveSetupAppearancePartMaterialSlots(
					options.assetReadModel,
					part,
				),
				partPlacements: deriveSetupPartDefaultPlacements(
					options.setupModel,
					part.partIndex,
				),
				scale: setupModelPart?.scale ?? UNIT_SCALE,
				textureVelocity: deriveSetupPartTextureVelocity(
					options.setupModel,
					part.partIndex,
				),
				assetReadModel: options.assetReadModel,
			}),
		];
	});
}

function deriveSetupPartTextureVelocity(
	setupModel: PreparedSetupModelPayload,
	partIndex: number,
): TextureVelocityRenderState | null {
	const placementSet = selectDefaultSetupPlacementSet(setupModel);
	if (!placementSet) {
		return null;
	}

	let selected: PreparedTextureVelocity | null = null;
	for (const velocity of placementSet.textureVelocities) {
		if (velocity.kind === "all-parts") {
			selected = velocity;
			continue;
		}
		if (velocity.partIndex === partIndex) {
			selected = velocity;
		}
	}

	return selected ? { uSpeed: selected.uSpeed, vSpeed: selected.vSpeed } : null;
}

function resolveSetupAppearancePartMaterialSlots(
	assetReadModel: RendererAssetReadModel,
	part: PreparedSetupAppearancePayload["parts"][number],
): ResolvedMaterialSlot[] {
	const gfxObjAsset = assetReadModel.get(part.gfxObjAssetId);
	return isPreparedGfxObjAsset(gfxObjAsset)
		? applyRenderGeometryMaterialVariants({
				slots: part.materialSlots,
				renderGeometry: gfxObjAsset.payload.renderGeometry,
			})
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
	return applyRenderGeometryMaterialVariants({
		slots: gfxObj.surfaceIds.map((surfaceId, slotIndex) => ({
			slotIndex,
			surfaceId,
			materialAssetId: formatMaterialAssetId(surfaceId),
		})),
		renderGeometry: gfxObj.renderGeometry,
	});
}

function resolveSetupPartMaterialSlots(
	assetReadModel: RendererAssetReadModel,
	part: PreparedSetupModelPayload["parts"][number],
): ResolvedMaterialSlot[] {
	const gfxObjAsset = assetReadModel.get(part.gfxObjAssetId);
	return isPreparedGfxObjAsset(gfxObjAsset)
		? resolveGfxObjMaterialSlots(gfxObjAsset.payload)
		: [];
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
