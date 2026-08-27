import type {
	CommitPipeline,
	LandblockLayerCommit,
} from "../../lib/game/commit/types";
import type { LandblockOwnerId } from "../../lib/game/game-types";
import { createTranslationMat4 } from "../../lib/game/math/matrices";
import { AABB3, Mat4, Vec3 } from "../../lib/game/math/types";
import type {
	ResolvedObjectResident,
	ResolvedOutdoorStaticLayerSource,
} from "../../lib/game/resolution/landblock-layer";
import type {
	ResolvedGeometry,
	ResolvedMaterial,
	ResolvedObjectPresentation,
} from "../../lib/game/resolution/presentation";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../../lib/game/runtime/scene-interest";

const LOCAL_BOUNDS = new AABB3(new Vec3(-2, 0, 0), new Vec3(2, 6, 0));

/** Closed source-first fixture proving generated-static and camera-ordered instance submission. */
export class SyntheticInstancedObjectPipeline implements CommitPipeline {
	async prepareLandblockLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<readonly LandblockLayerCommit[]> {
		return [...layers]
			.filter(({ layer }) => layer === LandblockLayerKind.Generated)
			.map(({ id }) => generatedBundle(id));
	}

	async destroy(): Promise<void> {}
}

function generatedBundle(landblockId: LandblockOwnerId): LandblockLayerCommit {
	const opaque = presentation("opaque", [
		material("opaque", 0x10, 1),
		material("alpha-test", 0x04, 0.7),
		material("additive", 0x10100, 0.55),
	]);
	const transparentAlpha = presentation("transparent-alpha", [
		material("transparent-alpha", 0x100, 0.55),
	]);
	const transparentInverse = presentation("transparent-inverse", [
		material("transparent-inverse", 0x200, 0.55),
	]);
	const source: ResolvedOutdoorStaticLayerSource = {
		dynamicSources: [],
		kind: LandblockLayerKind.Generated,
		landblockId,
		staticResidents: [
			resident(landblockId, "opaque-red", opaque, 88, 70, -112),
			resident(landblockId, "opaque-green", opaque, 100, 70, -112),
			resident(
				landblockId,
				"source-first-yellow",
				transparentAlpha,
				90,
				88,
				-100,
			),
			resident(landblockId, "middle-blue", transparentInverse, 96, 88, -104),
			resident(landblockId, "camera-far-red", transparentAlpha, 102, 88, -106),
		],
	};
	return {
		commit: { source },
		landblockId,
		layer: LandblockLayerKind.Generated,
	};
}

function resident(
	landblockId: LandblockOwnerId,
	id: string,
	presentation: ResolvedObjectPresentation,
	x: number,
	y: number,
	z: number,
): ResolvedObjectResident {
	return {
		behavior: {
			animationId: null,
			kind: "none",
			physicsScriptId: null,
			physicsScriptTableId: null,
			motionTableId: null,
			soundTableId: null,
		},
		identity: { kind: "authored", sourceId: `synthetic-instanced:${id}` },
		localBounds: LOCAL_BOUNDS,
		placement: {
			envCellId: null,
			landblockId,
			localTransform: createTranslationMat4(new Vec3(x, y, z)),
		},
		presentation,
		scale: new Vec3(1, 1, 1),
		setupId: null,
	};
}

function presentation(
	id: string,
	materials: readonly ResolvedMaterial[],
): ResolvedObjectPresentation {
	return {
		appearanceKey: `appearance:synthetic-instanced:${id}`,
		id: `presentation:synthetic-instanced:${id}`,
		parts: [
			{
				defaultScale: new Vec3(1, 1, 1),
				geometry: geometry(id, materials.length),
				materials,
				partIndex: 0,
			},
		],
		lights: [],
		holdingLocations: new Map(),
		placementPoses: new Map([
			[0, { partTransforms: [Mat4.identity()], placementId: 0 }],
		]),
		selectionBounds: LOCAL_BOUNDS,
		sortingBounds: LOCAL_BOUNDS,
		sourceAssetId: "0x01000001",
	};
}

function geometry(id: string, triangleCount: number): ResolvedGeometry {
	const positions: number[] = [];
	const normals: number[] = [];
	const textureCoordinates: number[] = [];
	const indices: number[] = [];
	for (let triangle = 0; triangle < triangleCount; triangle += 1) {
		const vertex = positions.length / 3;
		const z = triangle * 0.01;
		positions.push(-2, 0, z, 2, 0, z, 0, 6, z);
		normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
		textureCoordinates.push(0, 0, 1, 0, 0.5, 1);
		indices.push(vertex, vertex + 1, vertex + 2);
	}
	return {
		bounds: LOCAL_BOUNDS,
		id: `geometry:synthetic-instanced:${id}`,
		indices: Uint32Array.from(indices),
		materialSideKinds: new Uint8Array(triangleCount),
		materialSideTypes: new Uint8Array(triangleCount),
		materialSlotIndices: Uint16Array.from(
			{ length: triangleCount },
			(_, index) => index,
		),
		materialStippling: new Uint8Array(triangleCount),
		materialWrapModes: new Uint8Array(triangleCount),
		normals: Float32Array.from(normals),
		positions: Float32Array.from(positions),
		sourceDiagnostics: { rejectedDegenerateTriangles: [] },
		textureCoordinates: Float32Array.from(textureCoordinates),
	};
}

function material(
	id: string,
	rawSurfaceFlags: number,
	alpha: number,
): ResolvedMaterial {
	return {
		color: [1, 1, 1, alpha],
		diffuseScale: 1,
		id: `material:synthetic-instanced:${id}`,
		kind: "solid-color",
		luminosity: 0,
		rawSurfaceFlags,
		translucency: 0,
	};
}
