import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
} from "../../lib/game/commit/types";
import type {
	StaticObjectLayerArtifact,
	StaticObjectMaterialBinding,
} from "../../lib/game/commit/artifacts";
import type { LandblockId } from "../../lib/game/game-types";
import { AABB3, Mat4, Vec3 } from "../../lib/game/math/types";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../../lib/game/runtime/scene-interest";
import {
	TextureFilteringMode,
	TextureWrapMode,
} from "../../lib/game/textures/types";

/** Closed synthetic fixture used only to prove the renderer's blended building phases. */
export class SyntheticBlendedBuildingPipeline implements CommitPipeline {
	async prepareLandblockLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<readonly CommitBundle[]> {
		return [...layers]
			.filter(({ layer }) => layer === LandblockLayerKind.Buildings)
			.map(({ id }) => buildingBundle(id));
	}

	async destroy(): Promise<void> {}
}

function buildingBundle(landblockId: LandblockId): CommitBundle {
	const materialFlags = [0x10, 0x100, 0x200, 0x10000, 0x10100, 0x10200];
	const positions: number[] = [];
	const normals: number[] = [];
	const textureCoordinates: number[] = [];
	const indices: number[] = [];
	const drawUnits = materialFlags.map((flags, index) => {
		const vertexOffset = positions.length / 3;
		const x = 84 + index * 4;
		positions.push(x, 0, -120, x + 3, 0, -120, x + 1.5, 5, -120);
		normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
		textureCoordinates.push(0, 0, 1, 0, 0.5, 1);
		indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2);
		const ordering: "additive" | "transparent" =
			flags & 0x10000 ? "additive" : "transparent";
		return {
			geometry:
				"static-install-geometry:static-install:synthetic-blended/building-layer" as const,
			indexCount: 3,
			indexStart: index * 3,
			kind: "baked" as const,
			material: fixtureMaterial(flags, index),
			ordering,
			transparentSort:
				ordering === "transparent"
					? { center: new Vec3(x + 1.5, 2, -120), stableId: `fixture:${index}` }
					: null,
		};
	});
	const artifact: StaticObjectLayerArtifact = {
		geometry: [
			{
				geometry: {
					indices: Uint32Array.from(indices),
					kind: "object",
					normals: Float32Array.from(normals),
					positions: Float32Array.from(positions),
					textureCoordinates: Float32Array.from(textureCoordinates),
				},
				key: "static-install-geometry:static-install:synthetic-blended/building-layer",
			},
		],
		instanceStreams: [],
		objects: [
			{
				localBounds: new AABB3(new Vec3(80, -1, -122), new Vec3(112, 6, -118)),
				placement: {
					envCellId: null,
					landblockId,
					localTransform: Mat4.identity(),
				},
				renderable: { drawUnits },
			},
		],
		resourceNamespace: "static-install:synthetic-blended" as const,
		textureRequirements: [],
		texturePages: [],
	};
	return {
		commit: {
			diagnostics: {
				additiveRangeCount: 3,
				atlasPageCount: 0,
				bakedRangeCount: 6,
				expectedResidentCount: 6,
				geometryBytes:
					indices.length * Uint32Array.BYTES_PER_ELEMENT +
					normals.length * Float32Array.BYTES_PER_ELEMENT +
					positions.length * Float32Array.BYTES_PER_ELEMENT +
					textureCoordinates.length * Float32Array.BYTES_PER_ELEMENT,
				geometryWorkerDurationMs: 0,
				materializedStaticResidentCount: 6,
				packedTextureBytes: 0,
				promotedDynamicResidentCount: 0,
				resolvedStaticResidentCount: 6,
				sourceMaterialSlotCount: 6,
				sourceRangeCount: 6,
				textureWorkerDurationMs: 0,
				transparentRangeCount: 3,
			},
			staticObjects: artifact,
		},
		dynamicEntities: [],
		kind: CommitBundleSourceKind.LandblockLayer,
		landblockId,
		layer: LandblockLayerKind.Buildings,
	};
}

function fixtureMaterial(
	flags: number,
	index: number,
): StaticObjectMaterialBinding {
	return {
		palettedClipMap: false,
		polygon: { cullMode: "double", renderSide: "positive", stippled: false },
		sampler: {
			filtering: TextureFilteringMode.Linear,
			wrap: TextureWrapMode.Clamp,
		},
		source: {
			color: [index % 2, (index + 1) % 2, 1, 0.5],
			diffuseScale: 1,
			id: `material:fixture:${flags}` as const,
			kind: "solid-color",
			luminosity: 0,
			rawSurfaceFlags: flags,
			translucency: 0,
		},
		textures: { base: null, palette: null },
	};
}
