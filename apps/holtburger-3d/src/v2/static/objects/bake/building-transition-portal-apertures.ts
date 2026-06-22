import type {
	OutdoorStaticObjectsScopePayload,
	StaticBuildingTransitionApertureRange,
	StaticPortalApertureResource,
	StaticVec3,
} from "../../contracts";
import {
	createBuildingTransitionApertureRangeId,
	createBuildingTransitionApertureSourceId,
	createBuildingTransitionPortalApertureResourceId,
	createBuildingTransitionTargetEnvCellId,
} from "../../portal-aperture-resources";

type TransitionPortalVisibleSide = "positive" | "negative";

export function deriveBuildingTransitionPortalApertureResource(
	payload: OutdoorStaticObjectsScopePayload,
): StaticPortalApertureResource | null {
	if (payload.domain !== "outdoor-buildings") {
		return null;
	}

	const vertices: StaticVec3[] = [];
	const indices: number[] = [];
	const ranges: StaticBuildingTransitionApertureRange[] = [];
	const apertureResourceId = createBuildingTransitionPortalApertureResourceId(
		payload.landblock.landblockId,
	);
	const sortedApertures = [...payload.buildingTransitionApertures].sort(
		(left, right) => left.apertureId.localeCompare(right.apertureId),
	);

	for (const aperture of sortedApertures) {
		if (aperture.points.length < 3) {
			console.error("Failed to derive building transition aperture geometry.", {
				apertureId: aperture.apertureId,
				buildingInstanceId: aperture.buildingInstanceId,
				landblockId: payload.landblock.landblockId,
				reason: "malformed-building-aperture",
			});
			continue;
		}

		const apertureIndices = triangulatePortalApertureFan(
			aperture.points,
			decodeBuildingTransitionPortalInteriorVisibleSide(aperture.flags),
		);
		if (apertureIndices.length === 0) {
			continue;
		}

		const firstIndex = indices.length;
		const firstVertex = vertices.length;
		const portalId = createBuildingTransitionAperturePortalId({
			apertureId: aperture.apertureId,
			landblockId: payload.landblock.landblockId,
		});
		const sourceId = createBuildingTransitionApertureSourceId({
			apertureResourceId,
			portalId,
			rangeFirstIndex: firstIndex,
			rangeIndexCount: apertureIndices.length,
		});
		const targetEnvCellId = createBuildingTransitionTargetEnvCellId({
			landblockId: payload.landblock.landblockId,
			otherCellId: aperture.otherCellId,
			sourceId,
		});

		vertices.push(...aperture.points);
		indices.push(...apertureIndices.map((index) => firstVertex + index));
		ranges.push({
			firstIndex,
			indexCount: apertureIndices.length,
			rangeId: createBuildingTransitionApertureRangeId({
				apertureResourceId,
				portalId,
				rangeFirstIndex: firstIndex,
				rangeIndexCount: apertureIndices.length,
			}),
			source: {
				buildingInstanceId: aperture.buildingInstanceId,
				buildingPortalId: aperture.buildingPortalId,
				buildingPortalSourceIndex: aperture.buildingPortalSourceIndex,
				kind: "building-transition",
				landblockId: payload.landblock.landblockId,
				linkedEnvCellIds: aperture.linkedEnvCellIds,
				otherCellId: aperture.otherCellId,
				otherPortalId: aperture.otherPortalId,
				polyId: aperture.polyId,
				portalId,
				portalIndex: aperture.portalIndex,
				sourceAssetId: aperture.sourceAssetId,
				sourceDid: aperture.sourceDid,
				targetEnvCellId,
			},
			sourceId,
			sourceKind: "building-transition",
		});
	}

	if (indices.length === 0) {
		return null;
	}

	return {
		apertureResourceId,
		coordinateSpace: "landblock-render-local",
		indices,
		kind: "portal-aperture-resource",
		landblockId: payload.landblock.landblockId,
		ranges,
		sourceDomain: "outdoor-buildings",
		vertices,
	};
}

function createBuildingTransitionAperturePortalId(options: {
	readonly apertureId: string;
	readonly landblockId: number;
}): string {
	return [
		"transition-portal",
		"outdoor-buildings",
		options.landblockId >>> 0,
		options.apertureId,
	].join(":");
}

function triangulatePortalApertureFan(
	vertices: readonly StaticVec3[],
	insideVisibleSide: TransitionPortalVisibleSide,
): readonly number[] {
	if (vertices.length < 3) {
		return [];
	}

	const indices: number[] = [];
	for (let index = 1; index < vertices.length - 1; index += 1) {
		if (insideVisibleSide === "positive") {
			indices.push(0, index, index + 1);
		} else {
			indices.push(0, index + 1, index);
		}
	}
	return indices;
}

function decodeTransitionPortalVisibleSide(
	flags: number,
): TransitionPortalVisibleSide {
	return (flags & 0x2) === 0 ? "negative" : "positive";
}

function decodeBuildingTransitionPortalInteriorVisibleSide(
	flags: number,
): TransitionPortalVisibleSide {
	// CBldPortal flags describe the building/outdoor side of the aperture. V2
	// stores building transition aperture ranges as indoor-visible.
	return oppositeTransitionPortalVisibleSide(
		decodeTransitionPortalVisibleSide(flags),
	);
}

function oppositeTransitionPortalVisibleSide(
	side: TransitionPortalVisibleSide,
): TransitionPortalVisibleSide {
	return side === "positive" ? "negative" : "positive";
}
