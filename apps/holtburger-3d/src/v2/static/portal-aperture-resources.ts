import type {
	StaticPortalApertureRange,
	StaticPortalApertureResource,
	StaticPortalInteriorRecord,
	StaticVec3,
	TransitionApertureBatch,
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

export function createTransitionPortalApertureResource(
	batch: TransitionApertureBatch,
): StaticPortalApertureResource {
	return {
		apertureResourceId: createTransitionPortalApertureResourceId(
			batch.apertureBatchId,
		),
		coordinateSpace: "landblock-render-local",
		indices: batch.indices,
		kind: "portal-aperture-resource",
		landblockId: batch.landblockId,
		ranges: batch.ranges.map((range) => ({
			firstIndex: range.firstIndex,
			indexCount: range.indexCount,
			rangeId: createBuildingTransitionApertureRangeId({
				apertureBatchId: batch.apertureBatchId,
				portalId: range.portalId,
				rangeFirstIndex: range.firstIndex,
				rangeIndexCount: range.indexCount,
			}),
			sourceId: createBuildingTransitionApertureSourceId({
				apertureBatchId: batch.apertureBatchId,
				portalId: range.portalId,
				rangeFirstIndex: range.firstIndex,
				rangeIndexCount: range.indexCount,
			}),
			sourceKind: "building-transition",
		})),
		sourceDomain: batch.sourceDomain,
		vertices: batch.vertices,
	};
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
	readonly apertureBatchId: string;
	readonly portalId: string;
	readonly rangeFirstIndex: number;
	readonly rangeIndexCount: number;
}): string {
	return [
		"portal-aperture",
		"building-transition",
		options.apertureBatchId,
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
	readonly apertureBatchId: string;
	readonly portalId: string;
	readonly rangeFirstIndex: number;
	readonly rangeIndexCount: number;
}): string {
	return [
		"building-transition",
		options.apertureBatchId,
		options.portalId,
		options.rangeFirstIndex,
		options.rangeIndexCount,
	].join(":");
}

export function createBuildingTransitionTargetEnvCellId(
	batch: TransitionApertureBatch,
	range: TransitionApertureBatch["ranges"][number],
): number {
	if (range.source.otherCellId === 0xffff) {
		throw new Error(
			`Building transition aperture ${range.portalId} in ${batch.apertureBatchId} does not target an env cell.`,
		);
	}
	return ((batch.landblockId & 0xffff_0000) | range.source.otherCellId) >>> 0;
}

function createEnvCellPortalApertureResourceId(landblockId: number): string {
	return `portal-aperture-resource:landblock-env-cells:${formatHex32(landblockId)}`;
}

function createTransitionPortalApertureResourceId(
	apertureBatchId: string,
): string {
	return `portal-aperture-resource:building-transition:${apertureBatchId}`;
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
