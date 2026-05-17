import {
	deriveStructuredInteriorCoverage,
	type StructuredInteriorCoverageOptions,
} from "../assets/structured-interior-coverage";
import type {
	AssetChannelState,
	PreparedOutdoorStaticSceneBuildingPortal,
} from "../assets/types";
import { normalizeOutdoorLandblockId } from "../landblocks";
import {
	derivePortalAperturesFromStructuredInteriorScene,
	type PortalAperture,
	type PortalApertureTargetStatus,
} from "./portal-apertures";
import type { RenderChunkPlacement } from "./render-chunks";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";

export type OutdoorPortalViewGroupSource =
	| "browser-free-camera"
	| "walkabout"
	| "runtime";

export interface OutdoorPortalViewGroup {
	id: string;
	source: OutdoorPortalViewGroupSource;
	outdoorPortalId: string;
	aperture: PortalAperture;
	renderChunk: RenderChunkPlacement;
	entryEnvCellId: number;
	requestedInteriorEnvCellIds: number[];
	targetStatus: PortalApertureTargetStatus;
	stencilRef: number;
}

export interface OutdoorPortalViewGroupDiagnostics {
	topologyPortalCount: number;
	linkedTopologyPortalCount: number;
	apertureCandidateCount: number;
	viewGroupCount: number;
	skippedMissingApertureCount: number;
	skippedMissingPolygonCount: number;
	truncatedInteriorGroupCount: number;
}

export interface OutdoorPortalViewGroupModel {
	groups: OutdoorPortalViewGroup[];
	diagnostics: OutdoorPortalViewGroupDiagnostics;
}

export interface OutdoorPortalViewGroupInput {
	assetState: AssetChannelState;
	structuredInteriorScene: StructuredInteriorSceneModel;
	activeLandblockIds: readonly number[];
	coverageOptions: StructuredInteriorCoverageOptions;
	source?: OutdoorPortalViewGroupSource;
}

export function deriveOutdoorPortalViewGroups({
	assetState,
	structuredInteriorScene,
	activeLandblockIds,
	coverageOptions,
	source = "browser-free-camera",
}: OutdoorPortalViewGroupInput): OutdoorPortalViewGroupModel {
	const activeLandblockIdSet = new Set(
		activeLandblockIds.map(normalizeOutdoorLandblockId),
	);
	const aperturesBySourceEnvCellId = groupOutsideAperturesBySourceEnvCellId(
		derivePortalAperturesFromStructuredInteriorScene(structuredInteriorScene),
	);
	const diagnostics: OutdoorPortalViewGroupDiagnostics = {
		topologyPortalCount: 0,
		linkedTopologyPortalCount: 0,
		apertureCandidateCount: 0,
		viewGroupCount: 0,
		skippedMissingApertureCount: 0,
		skippedMissingPolygonCount: 0,
		truncatedInteriorGroupCount: 0,
	};
	const groups: OutdoorPortalViewGroup[] = [];
	let nextStencilRef = 1;

	for (const portal of collectActiveOutdoorBuildingPortals(
		assetState,
		activeLandblockIdSet,
	)) {
		diagnostics.topologyPortalCount += 1;
		if (portal.linkedEnvCellIds.length === 0) {
			continue;
		}
		diagnostics.linkedTopologyPortalCount += 1;

		let apertureCountForPortal = 0;
		for (const linkedEnvCellId of uniqueSorted(portal.linkedEnvCellIds)) {
			const apertures = aperturesBySourceEnvCellId.get(linkedEnvCellId) ?? [];
			apertureCountForPortal += apertures.length;
			for (const aperture of apertures) {
				const group = createOutdoorPortalViewGroup({
					aperture,
					portal,
					stencilRef: nextStencilRef,
					source,
					assetState,
					coverageOptions,
				});
				if (group.kind === "skip") {
					diagnostics[group.reason] += 1;
					continue;
				}

				if (group.truncatedInteriorCoverage) {
					diagnostics.truncatedInteriorGroupCount += 1;
				}
				groups.push(group.viewGroup);
				nextStencilRef += 1;
			}
		}

		if (apertureCountForPortal === 0) {
			diagnostics.skippedMissingApertureCount += 1;
		}
		diagnostics.apertureCandidateCount += apertureCountForPortal;
	}

	groups.sort(compareOutdoorPortalViewGroups);
	diagnostics.viewGroupCount = groups.length;
	return { groups, diagnostics };
}

function collectActiveOutdoorBuildingPortals(
	assetState: AssetChannelState,
	activeLandblockIds: ReadonlySet<number>,
): PreparedOutdoorStaticSceneBuildingPortal[] {
	return Object.values(assetState.preparedByAssetId).flatMap((asset) => {
		if (
			asset.payload.kind !== "outdoor-static-scene" ||
			!activeLandblockIds.has(
				normalizeOutdoorLandblockId(asset.payload.landblockId),
			)
		) {
			return [];
		}

		return asset.payload.buildingInstances.flatMap(
			(building) => building.portals,
		);
	});
}

function groupOutsideAperturesBySourceEnvCellId(
	apertures: PortalAperture[],
): Map<number, PortalAperture[]> {
	const grouped = new Map<number, PortalAperture[]>();
	for (const aperture of apertures) {
		if (!aperture.outsideTransition) {
			continue;
		}

		const existing = grouped.get(aperture.source.envCellId);
		if (existing) {
			existing.push(aperture);
		} else {
			grouped.set(aperture.source.envCellId, [aperture]);
		}
	}

	for (const aperturesForCell of grouped.values()) {
		aperturesForCell.sort(comparePortalApertures);
	}
	return grouped;
}

type OutdoorPortalGroupCreationResult =
	| {
			kind: "group";
			viewGroup: OutdoorPortalViewGroup;
			truncatedInteriorCoverage: boolean;
	  }
	| {
			kind: "skip";
			reason: "skippedMissingPolygonCount";
	  };

function createOutdoorPortalViewGroup({
	aperture,
	portal,
	stencilRef,
	source,
	assetState,
	coverageOptions,
}: {
	aperture: PortalAperture;
	portal: PreparedOutdoorStaticSceneBuildingPortal;
	stencilRef: number;
	source: OutdoorPortalViewGroupSource;
	assetState: AssetChannelState;
	coverageOptions: StructuredInteriorCoverageOptions;
}): OutdoorPortalGroupCreationResult {
	if (aperture.targetStatus === "missing-polygon" || aperture.points.length < 3) {
		return {
			kind: "skip",
			reason: "skippedMissingPolygonCount",
		};
	}
	if (aperture.targetStatus !== "outside") {
		throw new Error(
			`Outdoor portal group ${portal.portalId} joined non-outside aperture ${aperture.id}.`,
		);
	}

	const seedEnvCellIds = uniqueSorted([
		aperture.source.envCellId,
		...portal.linkedEnvCellIds,
		...portal.stabList.filter(isEnvCellId),
	]);
	const coverage = deriveStructuredInteriorCoverage(
		{
			kind: "visible-cell-closure",
			seedEnvCellIds,
		},
		assetState.preparedByAssetId,
		coverageOptions,
	);

	return {
		kind: "group",
		truncatedInteriorCoverage: coverage.truncated,
		viewGroup: {
			id: `${portal.portalId}:${aperture.id}`,
			source,
			outdoorPortalId: portal.portalId,
			aperture,
			renderChunk: aperture.renderChunk,
			entryEnvCellId: aperture.source.envCellId,
			requestedInteriorEnvCellIds: coverage.envCellIds,
			targetStatus: aperture.targetStatus,
			stencilRef,
		},
	};
}

function isEnvCellId(cellId: number): boolean {
	return (cellId & 0xffff) !== 0xffff;
}

function compareOutdoorPortalViewGroups(
	left: OutdoorPortalViewGroup,
	right: OutdoorPortalViewGroup,
): number {
	return (
		left.entryEnvCellId - right.entryEnvCellId ||
		left.outdoorPortalId.localeCompare(right.outdoorPortalId) ||
		left.aperture.id.localeCompare(right.aperture.id)
	);
}

function comparePortalApertures(
	left: PortalAperture,
	right: PortalAperture,
): number {
	return (
		left.source.envCellId - right.source.envCellId ||
		left.source.sourceIndex - right.source.sourceIndex ||
		left.id.localeCompare(right.id)
	);
}

function uniqueSorted(values: readonly number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}
