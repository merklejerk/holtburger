import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import {
	queryRenderSpaceBvhSources,
	type PortalCompositeRenderBvhSources,
	type RenderSpaceBvhSource,
} from "./prepared-bvh-render-sources";
import {
	crossRenderVec3,
	dotRenderVec3,
	normalizeRenderVec3,
	type RenderFrustum,
	type RenderPlane,
	type RenderVec3,
} from "./render-spatial-math";

export interface PortalClippedBvhVisibilityInput {
	renderSources: PortalCompositeRenderBvhSources;
	cameraFrustum: RenderFrustum;
	cameraPosition: RenderVec3;
	apertureWorldPoints: readonly RenderVec3[];
	compositeScene: "exterior" | "interior";
	requestedInteriorEnvCellIds: readonly number[];
}

export interface PortalClippedBvhVisibilityResult {
	visibleItemKeys: ReadonlySet<RenderBvhItemKey>;
	fallbackReasons: readonly string[];
}

export function derivePortalClippedBvhVisibility(
	options: PortalClippedBvhVisibilityInput,
): PortalClippedBvhVisibilityResult {
	const visibleItemKeys = new Set<RenderBvhItemKey>();
	const fallbackReasons: string[] = [];
	const frustum = buildPortalClippedRenderFrustum({
		cameraFrustum: options.cameraFrustum,
		cameraPosition: options.cameraPosition,
		apertureWorldPoints: options.apertureWorldPoints,
	});
	if (!frustum) {
		return {
			visibleItemKeys,
			fallbackReasons: ["portal clipped BVH query missing aperture volume"],
		};
	}
	fallbackReasons.push(...options.renderSources.fallbackReasons);

	if (options.compositeScene === "interior") {
		queryInteriorPortalVisibility({
			renderSources: options.renderSources,
			requestedInteriorEnvCellIds: options.requestedInteriorEnvCellIds,
			frustum,
			visibleItemKeys,
			fallbackReasons,
		});
		return { visibleItemKeys, fallbackReasons };
	}

	queryExteriorPortalVisibility({
		renderSources: options.renderSources,
		frustum,
		visibleItemKeys,
		fallbackReasons,
	});
	return { visibleItemKeys, fallbackReasons };
}

export function buildPortalClippedRenderFrustum(options: {
	cameraFrustum: RenderFrustum;
	cameraPosition: RenderVec3;
	apertureWorldPoints: readonly RenderVec3[];
}): RenderFrustum | null {
	const points = options.apertureWorldPoints;
	if (points.length < 3) {
		return null;
	}

	const centroid = averageRenderVec3(points);
	const planes = [...options.cameraFrustum.planes];
	const aperturePlane = buildApertureForwardPlane(
		points,
		centroid,
		options.cameraPosition,
	);
	if (aperturePlane) {
		planes.push(aperturePlane);
	}

	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		if (!current || !next) {
			continue;
		}
		const plane = buildEdgePlane({
			cameraPosition: options.cameraPosition,
			edgeStart: current,
			edgeEnd: next,
			insidePoint: centroid,
		});
		if (plane) {
			planes.push(plane);
		}
	}

	return { planes };
}

function queryInteriorPortalVisibility(options: {
	renderSources: PortalCompositeRenderBvhSources;
	requestedInteriorEnvCellIds: readonly number[];
	frustum: RenderFrustum;
	visibleItemKeys: Set<RenderBvhItemKey>;
	fallbackReasons: string[];
}): void {
	const requestedIds = new Set(options.requestedInteriorEnvCellIds);
	if (requestedIds.size === 0) {
		options.fallbackReasons.push("portal interior composite has no requested env cells");
		return;
	}
	const sources: RenderSpaceBvhSource[] = [];
	for (const envCellId of requestedIds) {
		const source = options.renderSources.envCellSourcesById.get(envCellId);
		if (source) {
			sources.push(source);
		}
	}
	if (sources.length === 0) {
		options.fallbackReasons.push(
			"portal interior composite had no loaded structured cells to query",
		);
		return;
	}
	mergePortalVisibilityResult(
		queryRenderSpaceBvhSources(sources, options.frustum),
		options,
	);
}

function queryExteriorPortalVisibility(options: {
	renderSources: PortalCompositeRenderBvhSources;
	frustum: RenderFrustum;
	visibleItemKeys: Set<RenderBvhItemKey>;
	fallbackReasons: string[];
}): void {
	const sources = [
		...options.renderSources.terrainSources,
		...options.renderSources.outdoorStaticSources,
	];
	if (sources.length === 0) {
		options.fallbackReasons.push(
			"portal exterior composite had no loaded outdoor sources to query",
		);
		return;
	}
	mergePortalVisibilityResult(
		queryRenderSpaceBvhSources(sources, options.frustum),
		options,
	);
}

function mergePortalVisibilityResult(
	result: PortalClippedBvhVisibilityResult,
	options: {
		visibleItemKeys: Set<RenderBvhItemKey>;
		fallbackReasons: string[];
	},
): void {
	for (const itemKey of result.visibleItemKeys) {
		options.visibleItemKeys.add(itemKey);
	}
	options.fallbackReasons.push(...result.fallbackReasons);
}

function buildApertureForwardPlane(
	points: readonly RenderVec3[],
	centroid: RenderVec3,
	cameraPosition: RenderVec3,
): RenderPlane | null {
	const first = points[0];
	const second = points[1];
	const third = points[2];
	if (!first || !second || !third) {
		return null;
	}
	let normal = normalizeRenderVec3(
		crossRenderVec3(
			{
				x: second.x - first.x,
				y: second.y - first.y,
				z: second.z - first.z,
			},
			{
				x: third.x - first.x,
				y: third.y - first.y,
				z: third.z - first.z,
			},
		),
	);
	if (isZeroVector(normal)) {
		return null;
	}
	if (dotRenderVec3(normal, vectorBetween(centroid, cameraPosition)) > 0) {
		normal = scaleRenderVec3(normal, -1);
	}
	return planeFromPointAndNormal(centroid, normal);
}

function buildEdgePlane(options: {
	cameraPosition: RenderVec3;
	edgeStart: RenderVec3;
	edgeEnd: RenderVec3;
	insidePoint: RenderVec3;
}): RenderPlane | null {
	const edge = vectorBetween(options.edgeStart, options.edgeEnd);
	const toCamera = vectorBetween(options.edgeStart, options.cameraPosition);
	let normal = normalizeRenderVec3(crossRenderVec3(edge, toCamera));
	if (isZeroVector(normal)) {
		return null;
	}
	let plane = planeFromPointAndNormal(options.edgeStart, normal);
	if (signedPlaneDistance(plane, options.insidePoint) < 0) {
		normal = scaleRenderVec3(normal, -1);
		plane = planeFromPointAndNormal(options.edgeStart, normal);
	}
	return plane;
}


function averageRenderVec3(points: readonly RenderVec3[]): RenderVec3 {
	const sum = points.reduce(
		(total, point) => ({
			x: total.x + point.x,
			y: total.y + point.y,
			z: total.z + point.z,
		}),
		{ x: 0, y: 0, z: 0 },
	);
	return {
		x: sum.x / points.length,
		y: sum.y / points.length,
		z: sum.z / points.length,
	};
}

function vectorBetween(from: RenderVec3, to: RenderVec3): RenderVec3 {
	return {
		x: to.x - from.x,
		y: to.y - from.y,
		z: to.z - from.z,
	};
}

function scaleRenderVec3(vector: RenderVec3, scale: number): RenderVec3 {
	return {
		x: vector.x * scale,
		y: vector.y * scale,
		z: vector.z * scale,
	};
}

function planeFromPointAndNormal(
	point: RenderVec3,
	normal: RenderVec3,
): RenderPlane {
	return {
		normal,
		constant: -dotRenderVec3(normal, point),
	};
}

function signedPlaneDistance(plane: RenderPlane, point: RenderVec3): number {
	return dotRenderVec3(plane.normal, point) + plane.constant;
}

function isZeroVector(vector: RenderVec3): boolean {
	return (
		Math.abs(vector.x) < 1e-8 &&
		Math.abs(vector.y) < 1e-8 &&
		Math.abs(vector.z) < 1e-8
	);
}
