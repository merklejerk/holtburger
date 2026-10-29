import type { Mat4, Vec3 } from "../math/types";
import type { SceneTopologyView } from "../scene";
import { sameScope } from "../scene/scope";
import type { PlanarAperturePlane } from "../scene/planar-aperture";
import type { CameraNearClipVolume } from "./portal-near-plane";
import type { PortalScopeAtlasResource } from "./portal-scope-atlas-planner";
import type { PortalScopeWindowCullInput } from "./portal-scope-window-culler";

/** Owned inputs for one view's retained plan; borrowed camera/resource objects may mutate. */
export class PortalScopeAtlasPlanInput {
	/** Identity and revision jointly bound the lifetime of topology-owned crossing references. */
	readonly #topology: {
		readonly view: SceneTopologyView;
		readonly revision: number;
	};
	/** Copy only the planning contract, excluding unrelated prepared-view state. */
	readonly #input: PortalScopeWindowCullInput;
	/** Extents and format limits are mutable on the pipeline's view resource. */
	readonly #resource: PortalScopeAtlasResource;

	constructor(
		topology: SceneTopologyView,
		input: PortalScopeWindowCullInput,
		resource: PortalScopeAtlasResource,
	) {
		this.#topology = { view: topology, revision: topology.revision };
		const near = input.nearClipVolume;
		this.#input = {
			anchorCoordinates: { ...input.anchorCoordinates },
			clipFromAnchor: input.clipFromAnchor.clone(),
			nearClipVolume: {
				eye: near.eye.clone(),
				corners: [
					near.corners[0].clone(),
					near.corners[1].clone(),
					near.corners[2].clone(),
					near.corners[3].clone(),
				],
				clippingPlanes: [
					copyPlane(near.clippingPlanes[0]),
					copyPlane(near.clippingPlanes[1]),
					copyPlane(near.clippingPlanes[2]),
					copyPlane(near.clippingPlanes[3]),
					copyPlane(near.clippingPlanes[4]),
				],
			},
			portalFootprint: {
				drawingBuffer: { ...input.portalFootprint.drawingBuffer },
				minimumPixelArea: input.portalFootprint.minimumPixelArea,
			},
			rootScope: { ...input.rootScope },
		};
		this.#resource = {
			atlas: { ...resource.atlas },
			drawingBuffer: { ...resource.drawingBuffer },
			maximumArrivalStateCount: resource.maximumArrivalStateCount,
			maximumCrossingTriangleVertexCount:
				resource.maximumCrossingTriangleVertexCount,
		};
	}

	/** Exact value comparisons allocate nothing; equal object identity alone is insufficient. */
	matches(
		topology: SceneTopologyView,
		input: PortalScopeWindowCullInput,
		resource: PortalScopeAtlasResource,
	): boolean {
		const previous = this.#input;
		return (
			this.#topology.view === topology &&
			this.#topology.revision === topology.revision &&
			sameScope(previous.rootScope, input.rootScope) &&
			previous.anchorCoordinates.x === input.anchorCoordinates.x &&
			previous.anchorCoordinates.y === input.anchorCoordinates.y &&
			previous.portalFootprint.minimumPixelArea ===
				input.portalFootprint.minimumPixelArea &&
			previous.portalFootprint.drawingBuffer.width ===
				input.portalFootprint.drawingBuffer.width &&
			previous.portalFootprint.drawingBuffer.height ===
				input.portalFootprint.drawingBuffer.height &&
			this.#resource.atlas.width === resource.atlas.width &&
			this.#resource.atlas.height === resource.atlas.height &&
			this.#resource.drawingBuffer.width === resource.drawingBuffer.width &&
			this.#resource.drawingBuffer.height === resource.drawingBuffer.height &&
			this.#resource.maximumArrivalStateCount ===
				resource.maximumArrivalStateCount &&
			this.#resource.maximumCrossingTriangleVertexCount ===
				resource.maximumCrossingTriangleVertexCount &&
			sameMatrix(previous.clipFromAnchor, input.clipFromAnchor) &&
			sameNearClipVolume(previous.nearClipVolume, input.nearClipVolume)
		);
	}
}

function copyPlane(plane: PlanarAperturePlane): PlanarAperturePlane {
	return { d: plane.d, normal: plane.normal.clone() };
}

function sameVector(left: Vec3, right: Vec3): boolean {
	return left.x === right.x && left.y === right.y && left.z === right.z;
}

function samePlane(
	left: PlanarAperturePlane,
	right: PlanarAperturePlane,
): boolean {
	return left.d === right.d && sameVector(left.normal, right.normal);
}

function sameNearClipVolume(
	left: CameraNearClipVolume,
	right: CameraNearClipVolume,
): boolean {
	return (
		sameVector(left.eye, right.eye) &&
		sameVector(left.corners[0], right.corners[0]) &&
		sameVector(left.corners[1], right.corners[1]) &&
		sameVector(left.corners[2], right.corners[2]) &&
		sameVector(left.corners[3], right.corners[3]) &&
		samePlane(left.clippingPlanes[0], right.clippingPlanes[0]) &&
		samePlane(left.clippingPlanes[1], right.clippingPlanes[1]) &&
		samePlane(left.clippingPlanes[2], right.clippingPlanes[2]) &&
		samePlane(left.clippingPlanes[3], right.clippingPlanes[3]) &&
		samePlane(left.clippingPlanes[4], right.clippingPlanes[4])
	);
}

function sameMatrix(left: Mat4, right: Mat4): boolean {
	return (
		left.m11 === right.m11 &&
		left.m12 === right.m12 &&
		left.m13 === right.m13 &&
		left.m14 === right.m14 &&
		left.m21 === right.m21 &&
		left.m22 === right.m22 &&
		left.m23 === right.m23 &&
		left.m24 === right.m24 &&
		left.m31 === right.m31 &&
		left.m32 === right.m32 &&
		left.m33 === right.m33 &&
		left.m34 === right.m34 &&
		left.m41 === right.m41 &&
		left.m42 === right.m42 &&
		left.m43 === right.m43 &&
		left.m44 === right.m44
	);
}
