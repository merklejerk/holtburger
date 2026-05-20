import {
	deriveStructuredInteriorCoverage,
	type StructuredInteriorCoverageOptions,
} from "../assets/structured-interior-coverage";
import type {
	AssetChannelState,
	PreparedOutdoorStaticSceneBuildingPortal,
} from "../assets/types";
import type { Vec3Dto } from "../host/contracts";
import { normalizeOutdoorLandblockId } from "../landblocks";
import {
	derivePortalAperturesFromStructuredInteriorScene,
	oppositePortalVisibleSide,
	type PortalAperturePlane,
	type PortalAperture,
	type PortalApertureTargetStatus,
	type PortalApertureVisibleSide,
} from "./portal-apertures";
import type { RenderChunkPlacement } from "./render-chunks";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";

export type TransitionPortalSource =
	| "browser-free-camera"
	| "walkabout"
	| "runtime";

export type TransitionPortalDirection =
	| "outdoor-to-indoor"
	| "indoor-to-outdoor";

export type TransitionPortalScene = "exterior" | "interior";

export interface TransitionPortalCandidate {
	id: string;
	source: TransitionPortalSource;
	outdoorPortalId: string;
	aperture: PortalAperture;
	insideVisibleSide: PortalApertureVisibleSide;
	outsideVisibleSide: PortalApertureVisibleSide;
	renderChunk: RenderChunkPlacement;
	entryEnvCellId: number;
	requestedInteriorEnvCellIds: number[];
	targetStatus: PortalApertureTargetStatus;
	stencilRef: number;
}

export interface TransitionPortalWorkItem extends TransitionPortalCandidate {
	direction: TransitionPortalDirection;
	baseScene: TransitionPortalScene;
	compositeScene: TransitionPortalScene;
	visibleSide: PortalApertureVisibleSide;
}

export interface TransitionPortalCandidateDiagnostics {
	topologyPortalCount: number;
	linkedTopologyPortalCount: number;
	apertureCandidateCount: number;
	workItemCandidateCount: number;
	skippedMissingApertureCount: number;
	skippedMissingPolygonCount: number;
	truncatedInteriorGroupCount: number;
}

export interface TransitionPortalCandidateModel {
	candidates: TransitionPortalCandidate[];
	diagnostics: TransitionPortalCandidateDiagnostics;
}

export interface TransitionPortalCandidateInput {
	assetState: AssetChannelState;
	structuredInteriorScene: StructuredInteriorSceneModel;
	activeLandblockIds: readonly number[];
	coverageOptions: StructuredInteriorCoverageOptions;
	source?: TransitionPortalSource;
}

export function createEmptyTransitionPortalCandidateModel(): TransitionPortalCandidateModel {
	return {
		candidates: [],
		diagnostics: {
			topologyPortalCount: 0,
			linkedTopologyPortalCount: 0,
			apertureCandidateCount: 0,
			workItemCandidateCount: 0,
			skippedMissingApertureCount: 0,
			skippedMissingPolygonCount: 0,
			truncatedInteriorGroupCount: 0,
		},
	};
}

export function deriveTransitionPortalCandidates({
	assetState,
	structuredInteriorScene,
	activeLandblockIds,
	coverageOptions,
	source = "browser-free-camera",
}: TransitionPortalCandidateInput): TransitionPortalCandidateModel {
	const activeLandblockIdSet = new Set(
		activeLandblockIds.map(normalizeOutdoorLandblockId),
	);
	const aperturesBySourceEnvCellId = groupOutsideAperturesBySourceEnvCellId(
		derivePortalAperturesFromStructuredInteriorScene(structuredInteriorScene),
	);
	const diagnostics: TransitionPortalCandidateDiagnostics = {
		topologyPortalCount: 0,
		linkedTopologyPortalCount: 0,
		apertureCandidateCount: 0,
		workItemCandidateCount: 0,
		skippedMissingApertureCount: 0,
		skippedMissingPolygonCount: 0,
		truncatedInteriorGroupCount: 0,
	};
	const candidates: TransitionPortalCandidate[] = [];
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
				const candidate = createTransitionPortalCandidate({
					aperture,
					portal,
					stencilRef: nextStencilRef,
					source,
					assetState,
					coverageOptions,
				});
				if (candidate.kind === "skip") {
					diagnostics[candidate.reason] += 1;
					continue;
				}

				if (candidate.truncatedInteriorCoverage) {
					diagnostics.truncatedInteriorGroupCount += 1;
				}
				candidates.push(candidate.candidate);
				nextStencilRef += 1;
			}
		}

		if (apertureCountForPortal === 0) {
			diagnostics.skippedMissingApertureCount += 1;
		}
		diagnostics.apertureCandidateCount += apertureCountForPortal;
	}

	candidates.sort(compareTransitionPortalCandidates);
	diagnostics.workItemCandidateCount = candidates.length;
	return { candidates, diagnostics };
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

export function createTransitionPortalWorkItem({
	candidate,
	cameraPosition,
	worldPlane,
}: {
	candidate: TransitionPortalCandidate;
	cameraPosition: Vec3Dto;
	worldPlane: PortalAperturePlane | null;
}): TransitionPortalWorkItem | null {
	const direction = classifyTransitionPortalDirection({
		cameraPosition,
		worldPlane,
		insideVisibleSide: candidate.insideVisibleSide,
	});
	if (!direction) {
		return null;
	}

	return {
		...candidate,
		direction,
		visibleSide:
			direction === "indoor-to-outdoor"
				? candidate.insideVisibleSide
				: candidate.outsideVisibleSide,
		baseScene: direction === "indoor-to-outdoor" ? "interior" : "exterior",
		compositeScene: direction === "indoor-to-outdoor" ? "exterior" : "interior",
	};
}

export function classifyTransitionPortalDirection({
	cameraPosition,
	worldPlane,
	insideVisibleSide,
}: {
	cameraPosition: Vec3Dto;
	worldPlane: PortalAperturePlane | null;
	insideVisibleSide: PortalApertureVisibleSide;
}): TransitionPortalDirection | null {
	if (!worldPlane) {
		return null;
	}

	const normalLength = Math.hypot(
		worldPlane.normal.x,
		worldPlane.normal.y,
		worldPlane.normal.z,
	);
	if (normalLength === 0) {
		return null;
	}

	const signedDistance =
		(worldPlane.normal.x * cameraPosition.x +
			worldPlane.normal.y * cameraPosition.y +
			worldPlane.normal.z * cameraPosition.z) /
			normalLength -
		worldPlane.constant / normalLength;
	if (signedDistance === 0) {
		return null;
	}

	const cameraSide: PortalApertureVisibleSide =
		signedDistance > 0 ? "positive" : "negative";
	return cameraSide === insideVisibleSide
		? "indoor-to-outdoor"
		: "outdoor-to-indoor";
}

type TransitionPortalCandidateCreationResult =
	| {
			kind: "candidate";
			candidate: TransitionPortalCandidate;
			truncatedInteriorCoverage: boolean;
	  }
	| {
			kind: "skip";
			reason: "skippedMissingPolygonCount";
	  };

function createTransitionPortalCandidate({
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
	source: TransitionPortalSource;
	assetState: AssetChannelState;
	coverageOptions: StructuredInteriorCoverageOptions;
}): TransitionPortalCandidateCreationResult {
	if (
		aperture.targetStatus === "missing-polygon" ||
		aperture.points.length < 3
	) {
		return {
			kind: "skip",
			reason: "skippedMissingPolygonCount",
		};
	}
	if (aperture.targetStatus !== "outside") {
		throw new Error(
			`Transition portal candidate ${portal.portalId} joined non-outside aperture ${aperture.id}.`,
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
		kind: "candidate",
		truncatedInteriorCoverage: coverage.truncated,
		candidate: {
			id: `${portal.portalId}:${aperture.id}`,
			source,
			outdoorPortalId: portal.portalId,
			aperture,
			insideVisibleSide: aperture.visibleSide,
			outsideVisibleSide: oppositePortalVisibleSide(aperture.visibleSide),
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

function compareTransitionPortalCandidates(
	left: TransitionPortalCandidate,
	right: TransitionPortalCandidate,
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
