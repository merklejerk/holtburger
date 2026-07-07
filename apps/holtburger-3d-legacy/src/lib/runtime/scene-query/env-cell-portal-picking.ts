import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
} from "../../math/ac-placement-transform";
import type { StaticBounds } from "../../static/contracts";
import { createOutdoorLandblockRootTranslation } from "../static-placement";
import type {
	EnvCellPortalScenePickDetails,
	EnvCellPortalSceneSelectionKey,
	StaticScenePickRequest,
} from "./contracts";
import type { EnvCellCommittedRecordStore } from "./env-cell-committed-records";
import { createEnvCellPortalSelectionKey } from "./static-selection-keys";

export interface EnvCellPortalPickTarget {
	readonly bounds: StaticBounds;
	readonly portal: EnvCellPortalScenePickDetails["portal"];
	readonly portalAperture: EnvCellPortalScenePickDetails["portalAperture"];
	readonly selectionKey: EnvCellPortalSceneSelectionKey;
	readonly vertices: readonly (readonly [number, number, number])[];
}

interface EnvCellPortalPickTargetQuery {
	readonly envCellCommittedRecords: EnvCellCommittedRecordStore;
	readonly outdoorAnchorLandblockId: number | null;
	readonly request?: StaticScenePickRequest;
}

export function queryEnvCellPortalPickTargets(
	query: EnvCellPortalPickTargetQuery,
): readonly EnvCellPortalPickTarget[] {
	const targets: EnvCellPortalPickTarget[] = [];
	for (const record of query.envCellCommittedRecords.queryPortalInteriorRecords()) {
		if (
			query.request?.context.kind === "env-cell" &&
			record.landblockId !== query.request.context.landblockId
		) {
			continue;
		}
		const translation = createOutdoorLandblockRootTranslation(
			record.landblockId,
			query.outdoorAnchorLandblockId,
		);
		for (const envCell of record.envCells) {
			if (!envCellMatchesPortalPickRequest(envCell.envCellId, query.request)) {
				continue;
			}
			const matrix = buildAcPlacementMatrix(
				envCell.localPlacement,
				AC_UNIT_SCALE,
			);
			for (const aperture of envCell.portalApertures) {
				const vertices = triangulateEnvCellPortalAperture(
					aperture.points,
					matrix,
					translation,
				);
				if (vertices.length === 0) {
					continue;
				}
				targets.push({
					bounds: createBoundsForVertices(vertices),
					portal:
						envCell.portals.find(
							(portal) => portal.portalId === aperture.portalId,
						) ?? null,
					portalAperture: aperture,
					selectionKey: createEnvCellPortalSelectionKey({
						envCellId: envCell.envCellId,
						landblockId: record.landblockId,
						portalId: aperture.portalId,
					}),
					vertices,
				});
			}
		}
	}

	return targets;
}

export function queryEnvCellPortalPickTarget(
	query: EnvCellPortalPickTargetQuery & {
		readonly selectionKey: EnvCellPortalSceneSelectionKey;
	},
): EnvCellPortalPickTarget | null {
	for (const target of queryEnvCellPortalPickTargets(query)) {
		if (
			target.selectionKey.landblockId === query.selectionKey.landblockId &&
			target.selectionKey.envCellId === query.selectionKey.envCellId &&
			target.selectionKey.portalId === query.selectionKey.portalId
		) {
			return target;
		}
	}

	return null;
}

function envCellMatchesPortalPickRequest(
	envCellId: number,
	request: StaticScenePickRequest | undefined,
): boolean {
	if (request?.context.kind !== "env-cell") {
		return true;
	}
	const acceptedEnvCellIds = request.context.acceptedEnvCellIds ?? [
		request.context.envCellId,
	];
	return (
		acceptedEnvCellIds.length === 0 || acceptedEnvCellIds.includes(envCellId)
	);
}

function triangulateEnvCellPortalAperture(
	points: EnvCellPortalScenePickDetails["portalAperture"]["points"],
	matrix: Float32Array,
	translation: readonly [number, number, number],
): readonly (readonly [number, number, number])[] {
	if (points.length < 3) {
		return [];
	}
	const vertices: Array<readonly [number, number, number]> = [];
	for (let index = 1; index < points.length - 1; index += 1) {
		vertices.push(
			transformEnvCellPortalPoint(points[0], matrix, translation),
			transformEnvCellPortalPoint(points[index], matrix, translation),
			transformEnvCellPortalPoint(points[index + 1], matrix, translation),
		);
	}
	return vertices;
}

function transformEnvCellPortalPoint(
	point: EnvCellPortalScenePickDetails["portalAperture"]["points"][number],
	matrix: Float32Array,
	translation: readonly [number, number, number],
): readonly [number, number, number] {
	return [
		matrix[0] * point.x +
			matrix[4] * point.y +
			matrix[8] * point.z +
			matrix[12] +
			translation[0],
		matrix[1] * point.x +
			matrix[5] * point.y +
			matrix[9] * point.z +
			matrix[13] +
			translation[1],
		matrix[2] * point.x +
			matrix[6] * point.y +
			matrix[10] * point.z +
			matrix[14] +
			translation[2],
	];
}

function createBoundsForVertices(
	vertices: readonly (readonly [number, number, number])[],
): StaticBounds {
	if (vertices.length === 0) {
		throw new Error("Cannot create debug bounds for empty vertex list.");
	}

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (const [x, y, z] of vertices) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		minZ = Math.min(minZ, z);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
		maxZ = Math.max(maxZ, z);
	}

	return {
		max: { x: maxX, y: maxY, z: maxZ },
		min: { x: minX, y: minY, z: minZ },
	};
}
