import {
	browserDestinationToInteriorCellId,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import type {
	AssetChannelState,
	PreparedInteriorCellStructure,
	PreparedAssetRecord,
	PreparedEnvCellPayload,
	PreparedIndoorCellPortal,
	PreparedPolygonSetBspNode,
	PreparedPolygonSetRenderGeometry,
	PreparedPortalAperture,
} from "../assets/types";
import {
	deriveBrowserFocusedStructuredInteriorMembershipPolicy,
	deriveStructuredInteriorCoverage,
	type StructuredInteriorCoverage,
} from "../assets/structured-interior-coverage";
import type { PlacementTransformDto } from "../host/contracts";
import {
	formatEnvCellAssetId,
	formatHex32,
	formatLandblockTopologyAssetId,
} from "../landblocks";
import {
	deriveStructuredCellRenderChunk,
	type RenderChunkPlacement,
} from "./render-chunks";
import { WORLD_RENDER_DOMAIN, formatRenderDomainKey } from "./render-domains";
import { describeRegionDetailRoleSignature } from "./region-detail-overlays";
import {
	getDetailedLandblockRenderArtifacts,
	type DetailedLandblockRenderArtifacts,
} from "./landblock-render-product";
import type { StaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";

export interface LinkedOutdoorInteriorSelection {
	envCellIds: number[];
}

export interface StructuredInteriorCell {
	renderKey: string;
	envCellId: number;
	regionNumber: number;
	renderChunk: RenderChunkPlacement;
	environmentId: number;
	cellStructureId: number;
	isFocus: boolean;
	chunkLocalPlacement: PlacementTransformDto;
	surfaceIds: number[];
	portalCount: number;
	portals: PreparedIndoorCellPortal[];
	portalApertures: PreparedPortalAperture[];
	staticObjectCount: number;
	cellStructure: PreparedInteriorCellStructure | null;
	cellBsp: PreparedPolygonSetBspNode | null;
	renderGeometry: PreparedPolygonSetRenderGeometry;
	debugColorKey: string;
	detailSignature: string;
}

export interface StructuredInteriorSceneModel {
	focusEnvCellId: number | null;
	activeEnvCellIds: number[];
	cells: StructuredInteriorCell[];
	missingEnvCellAssetIds: string[];
	missingInteriorGeometryAssetIds: string[];
	missingCellStructureKeys: string[];
	statusText: string;
	cacheText: string;
}

export function createEmptyStructuredInteriorSceneModel(): StructuredInteriorSceneModel {
	return emptyStructuredInteriorSceneModel(
		null,
		[],
		"Structured interior rendering is waiting for scene input.",
		"Structured interior cache is idle.",
	);
}

export function deriveStructuredInteriorSceneModel(
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection | null = null,
	linkedOutdoorInteriors: LinkedOutdoorInteriorSelection | null = null,
	structuredInteriorCoverage: StructuredInteriorCoverage | null = null,
): StructuredInteriorSceneModel {
	const browserFocusEnvCellId =
		browserDestinationToInteriorCellId(browserDestination);
	if (browserFocusEnvCellId !== null) {
		return deriveBrowserFocusedStructuredInteriorSceneModel(
			browserFocusEnvCellId,
			assetState,
			structuredInteriorCoverage,
		);
	}

	if (linkedOutdoorInteriors && linkedOutdoorInteriors.envCellIds.length > 0) {
		return deriveStructuredInteriorSceneForEnvCells(
			null,
			structuredInteriorCoverage?.envCellIds ??
				deriveStructuredInteriorCoverage(
					{
						kind: "landblock-closure",
						seedEnvCellIds: linkedOutdoorInteriors.envCellIds,
					},
					assetState.preparedByAssetId,
				).envCellIds,
			assetState,
		);
	}

	return emptyStructuredInteriorSceneModel(
		null,
		[],
		"Structured interior scene is dormant until the browser destination or outdoor links select env cells.",
		"Structured interior cache is idle.",
	);
}

export function deriveStructuredInteriorSceneModelFromLandblockArtifacts(
	artifacts: StaticLandblockRenderProductSet,
	browserDestination: BrowserLocationSelection | null = null,
	structuredInteriorCoverage: StructuredInteriorCoverage | null = null,
): StructuredInteriorSceneModel | null {
	const focusEnvCellId = browserDestinationToInteriorCellId(browserDestination);
	const detailedArtifacts = artifacts.artifacts
		.map(getDetailedLandblockRenderArtifacts)
		.filter((artifact): artifact is DetailedLandblockRenderArtifacts =>
			Boolean(artifact),
		);
	if (detailedArtifacts.length === 0) {
		return null;
	}

	const coveredEnvCellIds =
		structuredInteriorCoverage?.envCellIds ??
		uniqueSortedNumbers(
			detailedArtifacts.flatMap((artifact) => artifact.selectedEnvCellIds),
		);
	const coveredEnvCellIdSet = new Set(coveredEnvCellIds);
	const cells = detailedArtifacts
		.flatMap((artifact) => artifact.structuredInteriorCells)
		.filter((cell) => coveredEnvCellIdSet.has(cell.envCellId))
		.map((cell): StructuredInteriorCell => {
			const renderKey = formatRenderDomainKey(
				WORLD_RENDER_DOMAIN.interiorCellShell,
				`env-cell/${formatHex32(cell.envCellId)}`,
			);
			return {
				renderKey,
				envCellId: cell.envCellId,
				regionNumber: cell.regionNumber,
				renderChunk: cell.renderChunk,
				environmentId: cell.environmentId,
				cellStructureId: cell.cellStructureId,
				isFocus: focusEnvCellId !== null && cell.envCellId === focusEnvCellId,
				chunkLocalPlacement: cell.localPlacement,
				surfaceIds: [...cell.surfaceIds],
				portalCount: cell.portals.length,
				portals: cell.portals.map((portal) => ({
					portalId: portal.portalId,
					sourceIndex: portal.sourceIndex,
					flags: portal.flags,
					polygonId: portal.polygonId,
					otherCellId: portal.otherCellId,
					otherPortalId: portal.otherPortalId,
					targetEnvCellId:
						portal.targetEnvCellId ??
						(cell.envCellId & 0xffff0000) | portal.otherCellId,
				})),
				portalApertures: cell.portals.flatMap((portal) =>
					cell.portalApertureKeys
						.map((key) =>
							detailedArtifacts
								.flatMap((artifact) => artifact.portalApertures)
								.find(
									(aperture) =>
										aperture.key === key &&
										aperture.portalId === portal.portalId,
								),
						)
						.filter((aperture): aperture is NonNullable<typeof aperture> =>
							Boolean(aperture),
						)
						.map((aperture) => ({
							portalId: aperture.portalId,
							sourceIndex: aperture.sourceIndex,
							polygonId: aperture.polygonId,
							points: [...aperture.points],
							plane: aperture.plane,
						})),
				),
				staticObjectCount: cell.staticObjectCount,
				cellStructure: null,
				cellBsp: cell.cellBsp,
				renderGeometry: cell.renderGeometry,
				debugColorKey: `env-cell:${cell.envCellId}:${cell.environmentId}:${formatHex32(cell.cellStructureId)}`,
				detailSignature: `worker-artifact:${cell.regionNumber}:${cell.environmentId}`,
			};
		})
		.sort(compareStructuredInteriorCells);

	if (cells.length === 0) {
		return null;
	}

	const loadedEnvCellIds = new Set(cells.map((cell) => cell.envCellId));
	const missingEnvCellAssetIds = coveredEnvCellIds
		.filter((envCellId) => !loadedEnvCellIds.has(envCellId))
		.map(formatEnvCellAssetId);

	return {
		focusEnvCellId,
		activeEnvCellIds: coveredEnvCellIds,
		cells,
		missingEnvCellAssetIds,
		missingInteriorGeometryAssetIds: [],
		missingCellStructureKeys: [],
		statusText: describeStructuredInteriorStatus(cells, focusEnvCellId),
		cacheText: `Structured interior cache is backed by ${detailedArtifacts.length} resident landblock detailed artifact${detailedArtifacts.length === 1 ? "" : "s"}.`,
	};
}

function deriveBrowserFocusedStructuredInteriorSceneModel(
	focusEnvCellId: number,
	assetState: AssetChannelState,
	structuredInteriorCoverage: StructuredInteriorCoverage | null,
): StructuredInteriorSceneModel {
	const activeEnvCellIds =
		structuredInteriorCoverage?.envCellIds ??
		deriveBrowserFocusedEnvCellIdsFromTopology(focusEnvCellId, assetState) ??
		deriveStructuredInteriorCoverage(
			deriveBrowserFocusedStructuredInteriorMembershipPolicy(focusEnvCellId),
			assetState.preparedByAssetId,
		).envCellIds;

	return deriveStructuredInteriorSceneForEnvCells(
		focusEnvCellId,
		activeEnvCellIds,
		assetState,
	);
}

function deriveStructuredInteriorSceneForEnvCells(
	focusEnvCellId: number | null,
	activeEnvCellIds: number[],
	assetState: AssetChannelState,
): StructuredInteriorSceneModel {
	const cells: StructuredInteriorCell[] = [];

	for (const envCellId of activeEnvCellIds) {
		const envCell = findPreparedEnvCell(
			assetState.preparedByAssetId,
			envCellId,
		);
		if (envCell) {
			const renderChunk = deriveStructuredCellRenderChunk(envCellId);
			cells.push({
				renderKey: formatRenderDomainKey(
					WORLD_RENDER_DOMAIN.interiorCellShell,
					`env-cell/${formatHex32(envCellId)}`,
				),
				envCellId,
				regionNumber: envCell.regionNumber,
				renderChunk,
				environmentId: envCell.environmentId,
				cellStructureId: envCell.cellStructureId,
				isFocus: focusEnvCellId !== null && envCellId === focusEnvCellId,
				chunkLocalPlacement: envCell.localPlacement,
				surfaceIds: envCell.surfaces.map((surface) => surface.surfaceId),
				portalCount: envCell.portals.length,
				portals: envCell.portals.map((portal) => ({
					portalId: portal.portalId,
					sourceIndex: portal.sourceIndex,
					flags: portal.flags,
					polygonId: portal.polygonId,
					otherCellId: portal.otherCellId,
					otherPortalId: portal.otherPortalId,
					targetEnvCellId:
						portal.targetEnvCellId ??
						(envCellId & 0xffff0000) | portal.otherCellId,
				})),
				portalApertures: envCell.portalApertures,
				staticObjectCount: envCell.statics.length,
				cellStructure: null,
				cellBsp: envCell.cellBsp,
				renderGeometry: envCell.renderGeometry,
				debugColorKey: `env-cell:${envCellId}:${envCell.environmentId}:${formatHex32(envCell.cellStructureId)}`,
				detailSignature: describeRegionDetailRoleSignature({
					assetState,
					regionNumber: envCell.regionNumber,
					roleKind: "environment",
				}),
			});
			continue;
		}
	}

	return {
		focusEnvCellId,
		activeEnvCellIds,
		cells: cells.sort(compareStructuredInteriorCells),
		missingEnvCellAssetIds: [],
		missingInteriorGeometryAssetIds: [],
		missingCellStructureKeys: [],
		statusText: describeStructuredInteriorStatus(cells, focusEnvCellId),
		cacheText: describePreparedIndoorCache(assetState),
	};
}

function deriveBrowserFocusedEnvCellIdsFromTopology(
	focusEnvCellId: number,
	assetState: AssetChannelState,
): number[] | null {
	const focusLandblockPrefix = focusEnvCellId & 0xffff0000;
	const focusLandblockAsset =
		assetState.preparedByAssetId[
			formatLandblockTopologyAssetId(focusEnvCellId)
		];
	const envCellIds =
		focusLandblockAsset?.payload.kind === "landblock-topology"
			? focusLandblockAsset.payload.envCells
					.filter(
						(cell) => (cell.envCellId & 0xffff0000) === focusLandblockPrefix,
					)
					.map((cell) => cell.envCellId)
			: [];

	return envCellIds.length > 0
		? [...new Set(envCellIds)].sort((left, right) => left - right)
		: null;
}

function findPreparedEnvCell(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	envCellId: number,
): PreparedEnvCellPayload | null {
	const asset = preparedByAssetId[formatEnvCellAssetId(envCellId)];
	if (asset?.payload.kind !== "env-cell") {
		return null;
	}

	return asset.payload.envCellId === envCellId ? asset.payload : null;
}

function compareStructuredInteriorCells(
	left: StructuredInteriorCell,
	right: StructuredInteriorCell,
): number {
	if (left.isFocus !== right.isFocus) {
		return left.isFocus ? -1 : 1;
	}

	return left.envCellId - right.envCellId;
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function describeStructuredInteriorStatus(
	cells: StructuredInteriorCell[],
	focusEnvCellId: number | null,
): string {
	if (focusEnvCellId === null) {
		if (cells.length === 0) {
			return "Renderer is waiting for outdoor-linked structured-interior geometry.";
		}

		return `Renderer has ${cells.length} outdoor-linked structured interior cell${cells.length === 1 ? "" : "s"} ready.`;
	}

	const focusLabel = formatEnvCellLabel(focusEnvCellId);
	if (cells.length === 0) {
		return `Renderer is waiting for structured-interior geometry around focus ${focusLabel}.`;
	}

	return `Renderer has ${cells.length} structured interior cell${cells.length === 1 ? "" : "s"} ready around focus ${focusLabel}.`;
}

function describePreparedIndoorCache(assetState: AssetChannelState): string {
	const preparedEnvCellCount = Object.values(
		assetState.preparedByAssetId,
	).filter((asset) => asset.payload.kind === "env-cell").length;

	return `Structured interior cache contains ${preparedEnvCellCount} prepared env-cell asset${preparedEnvCellCount === 1 ? "" : "s"}.`;
}

function emptyStructuredInteriorSceneModel(
	focusEnvCellId: number | null,
	activeEnvCellIds: number[],
	statusText: string,
	cacheText: string,
): StructuredInteriorSceneModel {
	return {
		focusEnvCellId,
		activeEnvCellIds,
		cells: [],
		missingEnvCellAssetIds: [],
		missingInteriorGeometryAssetIds: [],
		missingCellStructureKeys: [],
		statusText,
		cacheText,
	};
}

function formatEnvCellLabel(envCellId: number): string {
	return `0x${formatHex32(envCellId)}`;
}
