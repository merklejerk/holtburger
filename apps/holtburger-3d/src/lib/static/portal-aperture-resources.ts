import type {
	StaticPortalApertureRange,
	StaticPortalApertureResource,
	StaticPortalInteriorRecord,
	StaticVec3,
} from "./contracts";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
} from "./bake/ac-placement-transform";

type PortalAperture =
	StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number];

export function createEnvCellPortalApertureResource(
	record: StaticPortalInteriorRecord,
): StaticPortalApertureResource | null {
	const vertices: StaticVec3[] = [];
	const indices: number[] = [];
	const ranges: StaticPortalApertureRange[] = [];

	for (const envCell of record.envCells) {
		const placementMatrix = buildAcPlacementMatrix(
			envCell.localPlacement,
			AC_UNIT_SCALE,
		);
		for (const aperture of envCell.portalApertures) {
			if (aperture.points.length < 3) {
				continue;
			}
			const firstVertex = vertices.length;
			const firstIndex = indices.length;
			vertices.push(
				...aperture.points.map((point) =>
					transformEnvCellPortalPoint(point, placementMatrix),
				),
			);
			indices.push(
				...triangulatePortalApertureFan(aperture.points.length).map(
					(index) => firstVertex + index,
				),
			);
			ranges.push({
				firstIndex,
				indexCount: indices.length - firstIndex,
				rangeId: createEnvCellPortalApertureRangeId({
					envCellId: envCell.envCellId,
					landblockId: record.landblockId,
					polygonId: aperture.polygonId,
					portalId: aperture.portalId,
					sourceIndex: aperture.sourceIndex,
				}),
				sourceId: createEnvCellPortalApertureSourceId({
					envCellId: envCell.envCellId,
					landblockId: record.landblockId,
					polygonId: aperture.polygonId,
					portalId: aperture.portalId,
					sourceIndex: aperture.sourceIndex,
				}),
				source: {
					envCellId: envCell.envCellId,
					kind: "env-cell-portal",
					landblockId: record.landblockId,
					polygonId: aperture.polygonId,
					portalId: aperture.portalId,
					sourceIndex: aperture.sourceIndex,
				},
				sourceKind: "env-cell-portal",
			});
		}
	}

	return indices.length > 0
		? {
				apertureResourceId: createEnvCellPortalApertureResourceId(
					record.landblockId,
				),
				coordinateSpace: "landblock-render-local",
				indices,
				kind: "portal-aperture-resource",
				landblockId: record.landblockId,
				ranges,
				sourceDomain: "landblock-env-cells",
				vertices,
			}
		: null;
}

export function createEnvCellPortalApertureRangeId(options: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly polygonId: number | null;
	readonly portalId: string;
	readonly sourceIndex: number;
}): string {
	return [
		"portal-aperture",
		"env-cell-portal",
		formatHex32(options.landblockId),
		formatHex32(options.envCellId),
		options.portalId,
		options.sourceIndex,
		options.polygonId ?? "none",
	].join(":");
}

export function createBuildingTransitionApertureRangeId(options: {
	readonly apertureResourceId: string;
	readonly portalId: string;
	readonly rangeFirstIndex: number;
	readonly rangeIndexCount: number;
}): string {
	return [
		"portal-aperture",
		"building-transition",
		options.apertureResourceId,
		options.portalId,
		options.rangeFirstIndex,
		options.rangeIndexCount,
	].join(":");
}

export function createEnvCellPortalApertureSourceId(options: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly polygonId: number | null;
	readonly portalId: string;
	readonly sourceIndex: number;
}): string {
	return [
		"env-cell-portal",
		formatHex32(options.landblockId),
		formatHex32(options.envCellId),
		options.portalId,
		options.sourceIndex,
		options.polygonId ?? "none",
	].join(":");
}

export function createBuildingTransitionApertureSourceId(options: {
	readonly apertureResourceId: string;
	readonly portalId: string;
	readonly rangeFirstIndex: number;
	readonly rangeIndexCount: number;
}): string {
	return [
		"building-transition",
		options.apertureResourceId,
		options.portalId,
		options.rangeFirstIndex,
		options.rangeIndexCount,
	].join(":");
}

export function createBuildingTransitionTargetEnvCellId(options: {
	readonly landblockId: number;
	readonly otherCellId: number;
	readonly sourceId: string;
}): number {
	if (options.otherCellId === 0xffff) {
		throw new Error(
			`Building transition aperture ${options.sourceId} does not target an env cell.`,
		);
	}
	return ((options.landblockId & 0xffff_0000) | options.otherCellId) >>> 0;
}

function createEnvCellPortalApertureResourceId(landblockId: number): string {
	return `portal-aperture-resource:landblock-env-cells:${formatHex32(landblockId)}`;
}

export function createBuildingTransitionPortalApertureResourceId(
	landblockId: number,
): string {
	return `portal-aperture-resource:building-transition:${formatHex32(landblockId)}`;
}

function triangulatePortalApertureFan(vertexCount: number): readonly number[] {
	const indices: number[] = [];
	for (let index = 1; index < vertexCount - 1; index += 1) {
		indices.push(0, index, index + 1);
	}
	return indices;
}

function transformEnvCellPortalPoint(
	point: PortalAperture["points"][number],
	matrix: Float32Array,
): StaticVec3 {
	return {
		x:
			matrix[0] * point.x +
			matrix[4] * point.y +
			matrix[8] * point.z +
			matrix[12],
		y:
			matrix[1] * point.x +
			matrix[5] * point.y +
			matrix[9] * point.z +
			matrix[13],
		z:
			matrix[2] * point.x +
			matrix[6] * point.y +
			matrix[10] * point.z +
			matrix[14],
	};
}

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
