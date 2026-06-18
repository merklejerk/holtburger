import type {
	OutdoorStaticObjectsScopePayload,
	StaticVec3,
	TransitionApertureBatch,
	TransitionApertureExteriorEndpoint,
	TransitionApertureRange,
} from "../../contracts";

type TransitionPortalVisibleSide = "positive" | "negative";

export function deriveBuildingTransitionApertureBatch(
	payload: OutdoorStaticObjectsScopePayload,
): TransitionApertureBatch | null {
	if (payload.domain !== "outdoor-buildings") {
		return null;
	}

	const vertices: StaticVec3[] = [];
	const indices: number[] = [];
	const ranges: TransitionApertureRange[] = [];
	const planes: null[] = [];
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
			decodeTransitionPortalVisibleSide(aperture.flags),
		);
		if (apertureIndices.length === 0) {
			continue;
		}

		const firstIndex = indices.length;
		const firstVertex = vertices.length;
		vertices.push(...aperture.points);
		indices.push(...apertureIndices.map((index) => firstVertex + index));

		const exterior: TransitionApertureExteriorEndpoint = {
			buildingInstanceId: aperture.buildingInstanceId,
			buildingPortalId: aperture.buildingPortalId,
			kind: "landblock-building",
		};
		ranges.push({
			exterior,
			firstIndex,
			indexCount: apertureIndices.length,
			portalId: createBuildingTransitionAperturePortalId({
				apertureId: aperture.apertureId,
				landblockId: payload.landblock.landblockId,
			}),
			source: {
				buildingInstanceId: aperture.buildingInstanceId,
				buildingPortalId: aperture.buildingPortalId,
				buildingPortalSourceIndex: aperture.buildingPortalSourceIndex,
				kind: "building-portal",
				linkedEnvCellIds: aperture.linkedEnvCellIds,
				otherCellId: aperture.otherCellId,
				otherPortalId: aperture.otherPortalId,
				polyId: aperture.polyId,
				portalIndex: aperture.portalIndex,
				sourceAssetId: aperture.sourceAssetId,
				sourceDid: aperture.sourceDid,
			},
		});
		planes.push(null);
	}

	if (indices.length === 0) {
		return null;
	}

	return {
		apertureBatchId: createBuildingTransitionApertureBatchId(
			payload.landblock.landblockId,
		),
		coordinateSpace: "landblock-render-local",
		frontFace: "indoor-visible",
		indices,
		kind: "transition-aperture-batch",
		landblockId: payload.landblock.landblockId,
		planes,
		ranges,
		sourceDomain: "outdoor-buildings",
		vertices,
	};
}

function createBuildingTransitionApertureBatchId(landblockId: number): string {
	return `transition-apertures:outdoor-buildings:${landblockId >>> 0}`;
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
