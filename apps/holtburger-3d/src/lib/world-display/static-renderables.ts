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
	const parts: StaticRenderablePart[] = [
		...collectOutdoorStaticRenderableParts(
			assetState,
			{
				buildingLandblockIds: buildingLandblockSet,
				detailLandblockIds: detailLandblockSet,
			},
			missingSourceAssetIds,
			missingGfxAssetIds,
		),
		...collectEnvCellStaticRenderableParts(
			assetState,
			activeInteriorEnvCellIds,
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
	const sourceInstances = collectEnvCellStaticRenderableSourceInstances(
		assetState,
		activeEnvCellIds,
	).sort(compareSourceInstances);
	const missingSourceAssetIds = new Set<string>();
	const missingGfxAssetIds = new Set<string>();
	const parts: StaticRenderablePart[] = collectEnvCellStaticRenderableParts(
		assetState,
		activeEnvCellIds,
		missingSourceAssetIds,
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
		partsByRenderDomainChunkAndGfxAssetId: new Map(),
		missingSourceAssetIds: [],
		missingGfxAssetIds: [],
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
	return {
		kind:
			member.kind === "explicit-object"
				? "scenery"
				: member.kind === "generated-scenery"
					? "generated-scenery"
					: "building",
		instanceId: member.instanceId,
		owningLandblockId: normalizeOutdoorLandblockId(payload.landblockId),
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

function collectOutdoorStaticRenderableParts(
	assetState: AssetChannelState,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
	},
	missingSourceAssetIds: Set<string>,
	missingGfxAssetIds: Set<string>,
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
		),
	);
}

function collectEnvCellStaticRenderableParts(
	assetState: AssetChannelState,
	activeEnvCellIds: ReadonlySet<number>,
	missingSourceAssetIds: Set<string>,
	missingGfxAssetIds: Set<string>,
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
					partPlacements: [],
					scale: part.scale ?? UNIT_SCALE,
				}),
			];
		});
	}

	missingSourceAssetIds.add(instance.sourceAssetId);
	return [];
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

function resolveSetupPartMaterialSlots(
	assetState: AssetChannelState,
	part: PreparedSetupModelPayload["parts"][number],
): ResolvedMaterialSlot[] {
	const gfxObjAsset = assetState.preparedByAssetId[part.gfxObjAssetId];
	return isPreparedGfxObjAsset(gfxObjAsset)
		? resolveGfxObjMaterialSlots(gfxObjAsset.payload)
		: [];
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

function formatHexId(value: number): string {
	return `0x${formatHex32(value)}`;
}
