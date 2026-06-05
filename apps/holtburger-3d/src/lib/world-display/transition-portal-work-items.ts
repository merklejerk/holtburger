import { deriveStructuredInteriorCoverage } from "../assets/structured-interior-coverage";
import type { AssetChannelState } from "../assets/types";
import type { Vec3Dto } from "../host/contracts";
import { normalizeOutdoorLandblockId } from "../landblocks";
import {
	getDetailedLandblockRenderArtifacts,
	type DetailedLandblockRenderArtifacts,
} from "./landblock-render-product";
import {
	decodePortalVisibleSide,
	derivePortalAperturesFromStructuredInteriorScene,
	oppositePortalVisibleSide,
	type PortalAperturePlane,
	type PortalAperture,
	type PortalApertureTargetStatus,
	type PortalApertureVisibleSide,
} from "./portal-apertures";
import type { RenderChunkPlacement } from "./render-chunks";
import type { StaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";

type TransitionPortalSource = "browser-free-camera" | "walkabout" | "runtime";

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

interface TransitionPortalCandidateDiagnostics {
	loadedEnvCellPortalFactCount: number;
	topologyPortalCount: number;
	linkedTopologyPortalCount: number;
	apertureCandidateCount: number;
	workItemCandidateCount: number;
	skippedMissingApertureCount: number;
	skippedMissingPolygonCount: number;
	truncatedInteriorGroupCount: number;
}

interface OutdoorBuildingPortalLink {
	portalId: string;
	linkedEnvCellIds: number[];
	stabList: number[];
}

interface DetailedOutdoorBuildingPortalLink {
	portalId: string;
	linkedEnvCellIds: readonly number[];
	requestedInteriorEnvCellIds: readonly number[];
}

export interface TransitionPortalCandidateModel {
	candidates: TransitionPortalCandidate[];
	diagnostics: TransitionPortalCandidateDiagnostics;
}

export interface TransitionPortalCandidateInput {
	assetState: AssetChannelState;
	structuredInteriorScene: StructuredInteriorSceneModel;
	activeLandblockIds: readonly number[];
	source?: TransitionPortalSource;
}

export function createEmptyTransitionPortalCandidateModel(): TransitionPortalCandidateModel {
	return {
		candidates: [],
		diagnostics: {
			loadedEnvCellPortalFactCount: 0,
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
	source = "browser-free-camera",
}: TransitionPortalCandidateInput): TransitionPortalCandidateModel {
	const activeLandblockIdSet = new Set(
		activeLandblockIds.map(normalizeOutdoorLandblockId),
	);
	const aperturesBySourceEnvCellId = groupOutsideAperturesBySourceEnvCellId(
		derivePortalAperturesFromStructuredInteriorScene(structuredInteriorScene),
	);
	const diagnostics: TransitionPortalCandidateDiagnostics = {
		loadedEnvCellPortalFactCount: structuredInteriorScene.cells.reduce(
			(count, cell) => count + cell.portals.length,
			0,
		),
		topologyPortalCount: 0,
		linkedTopologyPortalCount: 0,
		apertureCandidateCount: 0,
		workItemCandidateCount: 0,
		skippedMissingApertureCount: 0,
		skippedMissingPolygonCount: 0,
		truncatedInteriorGroupCount: 0,
	};
	const candidates: TransitionPortalCandidate[] = [];
	const coverageBySeedKey = new Map<
		string,
		ReturnType<typeof deriveStructuredInteriorCoverage>
	>();
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
					coverageBySeedKey,
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

export function deriveTransitionPortalCandidatesFromLandblockArtifacts({
	artifacts,
	activeLandblockIds,
	source = "browser-free-camera",
}: {
	artifacts: StaticLandblockRenderProductSet;
	activeLandblockIds: readonly number[];
	source?: TransitionPortalSource;
}): TransitionPortalCandidateModel | null {
	const activeLandblockIdSet = new Set(
		activeLandblockIds.map(normalizeOutdoorLandblockId),
	);
	const detailedArtifacts = artifacts.artifacts
		.map(getDetailedLandblockRenderArtifacts)
		.filter((artifact): artifact is DetailedLandblockRenderArtifacts => {
			if (!artifact) {
				return false;
			}
			return activeLandblockIdSet.has(
				normalizeOutdoorLandblockId(artifact.landblockId),
			);
		});
	if (detailedArtifacts.length === 0) {
		return null;
	}

	const aperturesBySourceEnvCellId = groupOutsideAperturesBySourceEnvCellId(
		createPortalAperturesFromDetailedArtifacts(detailedArtifacts),
	);
	const diagnostics: TransitionPortalCandidateDiagnostics = {
		loadedEnvCellPortalFactCount: detailedArtifacts.reduce(
			(count, artifact) =>
				count +
				artifact.structuredInteriorCells.reduce(
					(cellCount, cell) => cellCount + cell.portals.length,
					0,
				),
			0,
		),
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
	for (const portal of collectDetailedOutdoorBuildingPortals(detailedArtifacts)) {
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
				const candidate = createTransitionPortalCandidateFromResolvedCoverage({
					aperture,
					portal,
					stencilRef: nextStencilRef,
					source,
				});
				if (candidate.kind === "skip") {
					diagnostics[candidate.reason] += 1;
					continue;
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
): OutdoorBuildingPortalLink[] {
	return Object.values(assetState.preparedByAssetId).flatMap((asset) => {
		if (
			asset.payload.kind !== "landblock-outdoor" ||
			!activeLandblockIds.has(
				normalizeOutdoorLandblockId(asset.payload.landblockId),
			)
		) {
			return [];
		}

		return asset.payload.statics.flatMap((member) =>
			member.kind === "building" && member.building
				? member.building.portals.map((portal) => ({
						portalId: portal.portalId,
						linkedEnvCellIds: portal.linkedEnvCellIds,
						stabList: portal.stabLocalCellIds,
					}))
				: [],
		);
	});
}

function collectDetailedOutdoorBuildingPortals(
	artifacts: readonly DetailedLandblockRenderArtifacts[],
): DetailedOutdoorBuildingPortalLink[] {
	const portalsById = new Map<
		string,
		{
			portalId: string;
			linkedEnvCellIds: Set<number>;
			requestedInteriorEnvCellIds: Set<number>;
		}
	>();
	for (const artifact of artifacts) {
		for (const link of artifact.portalLinks) {
			const buildingEndpoint =
				link.source.kind === "landblock-building"
					? link.source
					: link.target.kind === "landblock-building"
						? link.target
						: null;
			const envEndpoint =
				link.source.kind === "env-cell"
					? link.source
					: link.target.kind === "env-cell"
						? link.target
						: null;
			if (!buildingEndpoint || !envEndpoint) {
				continue;
			}
			const portal = portalsById.get(buildingEndpoint.portalId) ?? {
				portalId: buildingEndpoint.portalId,
				linkedEnvCellIds: new Set<number>(),
				requestedInteriorEnvCellIds: new Set<number>(),
			};
			portal.linkedEnvCellIds.add(envEndpoint.envCellId);
			for (const envCellId of artifact.selectedEnvCellIds) {
				portal.requestedInteriorEnvCellIds.add(envCellId);
			}
			portalsById.set(buildingEndpoint.portalId, portal);
		}
	}
	return [...portalsById.values()]
		.map((portal) => ({
			portalId: portal.portalId,
			linkedEnvCellIds: uniqueSorted([...portal.linkedEnvCellIds]),
			requestedInteriorEnvCellIds: uniqueSorted([
				...portal.requestedInteriorEnvCellIds,
			]),
		}))
		.sort((left, right) => left.portalId.localeCompare(right.portalId));
}

function createPortalAperturesFromDetailedArtifacts(
	artifacts: readonly DetailedLandblockRenderArtifacts[],
): PortalAperture[] {
	return artifacts.flatMap((artifact) => {
		const cellsByEnvCellId = new Map(
			artifact.structuredInteriorCells.map((cell) => [cell.envCellId, cell]),
		);
		const portalsByKey = new Map(
			artifact.structuredInteriorCells.flatMap((cell) =>
				cell.portals.map(
					(portal) =>
						[
							describeDetailedPortalKey(portal.envCellId, portal.portalId),
							portal,
						] as const,
				),
			),
		);
		const activeEnvCellIds = new Set(artifact.selectedEnvCellIds);
		return artifact.portalApertures.flatMap((aperture): PortalAperture[] => {
			const cell = cellsByEnvCellId.get(aperture.envCellId);
			const portal = portalsByKey.get(
				describeDetailedPortalKey(aperture.envCellId, aperture.portalId),
			);
			if (!cell || !portal) {
				return [];
			}
			const targetEnvCellId = normalizeDetailedPortalTargetEnvCellId(
				aperture.envCellId,
				portal,
			);
			return [
				{
					id: aperture.portalId,
					source: {
						kind: "env-cell",
						envCellId: aperture.envCellId,
						portalId: aperture.portalId,
						sourceIndex: aperture.sourceIndex,
						polygonId: aperture.polygonId,
						flags: portal.flags,
						otherPortalId: portal.otherPortalId,
					},
					renderChunk: cell.renderChunk,
					chunkLocalPlacement: cell.localPlacement,
					points: [...aperture.points],
					plane: aperture.plane,
					visibleSide: decodePortalVisibleSide(portal.flags),
					targetEnvCellId,
					targetStatus: resolveDetailedTargetStatus(
						targetEnvCellId,
						activeEnvCellIds,
						aperture.points,
					),
					outsideTransition: portal.isOutsideTransition,
				},
			];
		});
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
	coverageBySeedKey,
}: {
	aperture: PortalAperture;
	portal: OutdoorBuildingPortalLink;
	stencilRef: number;
	source: TransitionPortalSource;
	assetState: AssetChannelState;
	coverageBySeedKey: Map<
		string,
		ReturnType<typeof deriveStructuredInteriorCoverage>
	>;
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
	const seedKey = seedEnvCellIds.join(",");
	let coverage = coverageBySeedKey.get(seedKey);
	if (!coverage) {
		coverage = deriveStructuredInteriorCoverage(
			{
				kind: "landblock-closure",
				seedEnvCellIds,
			},
			assetState.preparedByAssetId,
		);
		coverageBySeedKey.set(seedKey, coverage);
	}

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

function createTransitionPortalCandidateFromResolvedCoverage({
	aperture,
	portal,
	stencilRef,
	source,
}: {
	aperture: PortalAperture;
	portal: DetailedOutdoorBuildingPortalLink;
	stencilRef: number;
	source: TransitionPortalSource;
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

	return {
		kind: "candidate",
		truncatedInteriorCoverage: false,
		candidate: {
			id: `${portal.portalId}:${aperture.id}`,
			source,
			outdoorPortalId: portal.portalId,
			aperture,
			insideVisibleSide: aperture.visibleSide,
			outsideVisibleSide: oppositePortalVisibleSide(aperture.visibleSide),
			renderChunk: aperture.renderChunk,
			entryEnvCellId: aperture.source.envCellId,
			requestedInteriorEnvCellIds: uniqueSorted(
				portal.requestedInteriorEnvCellIds,
			),
			targetStatus: aperture.targetStatus,
			stencilRef,
		},
	};
}

function normalizeDetailedPortalTargetEnvCellId(
	envCellId: number,
	portal: DetailedLandblockRenderArtifacts["structuredInteriorCells"][number]["portals"][number],
): number | null {
	if (portal.isOutsideTransition) {
		return (envCellId & 0xffff_0000) | 0xffff;
	}
	if (portal.otherCellId === 0) {
		return null;
	}
	return portal.targetEnvCellId;
}

function resolveDetailedTargetStatus(
	targetEnvCellId: number | null,
	activeEnvCellIds: ReadonlySet<number>,
	points: readonly Vec3Dto[],
): PortalApertureTargetStatus {
	if (points.length < 3) {
		return "missing-polygon";
	}
	if (targetEnvCellId !== null && (targetEnvCellId & 0xffff) === 0xffff) {
		return "outside";
	}
	if (targetEnvCellId === null) {
		return "unsupported";
	}
	if (activeEnvCellIds.has(targetEnvCellId)) {
		return "loaded-visible";
	}
	return "known-unloaded";
}

function describeDetailedPortalKey(envCellId: number, portalId: string): string {
	return `${envCellId}:${portalId}`;
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
