import { Mat4 } from "../math/types";
import type { ResolvedObjectLayerSource } from "../resolution/landblock-layer";
import type { StaticObjectLayerArtifact } from "./artifacts";
import type { BuildingGeometryResult } from "./building-geometry-worker";
import type { BuildingTexturePackResult } from "./building-texture-worker";
import type { StaticInstallResourceNamespace } from "../systems/static-resources";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";

/** Assemble a complete publishable building artifact only after both closed worker jobs finish. */
export function assembleBuildingArtifact(options: {
	readonly source: ResolvedObjectLayerSource;
	readonly resourceNamespace: StaticInstallResourceNamespace;
	readonly geometry: BuildingGeometryResult | null;
	/** Logical requirements staged beside legacy page artifacts during the resident-atlas transition. */
	readonly textureRequirements: readonly AssetTextureFact[];
	readonly textures: BuildingTexturePackResult;
}): StaticObjectLayerArtifact | null {
	const geometry = options.geometry;
	if (geometry === null) {
		if (options.textures.pages.length !== 0) {
			throw new Error("A building layer with no static geometry produced packed textures.");
		}
		return null;
	}
	const coveredTextures = new Set<AssetTextureKey>();
	for (const page of options.textures.pages) {
		for (const texture of page.textures) coveredTextures.add(texture.key);
	}
	for (const range of geometry.ranges) {
		for (const texture of [range.material.textures.base, range.material.textures.palette]) {
			if (texture !== null && !coveredTextures.has(texture)) {
				throw new Error(`Baked building range lacks a physical texture placement for ${texture}.`);
			}
		}
	}
	return {
		geometry: [geometry.geometry],
		instanceStreams: [],
		objects: [
			{
				localBounds: geometry.bounds,
				placement: {
					envCellId: null,
					landblockId: options.source.landblockId,
					localTransform: Mat4.identity(),
				},
				renderable: {
					drawUnits: geometry.ranges.map((range) => ({
						geometry: geometry.geometry.key,
						indexCount: range.indexCount,
						indexStart: range.indexStart,
						kind: "baked" as const,
						material: range.material,
						ordering: range.ordering,
						transparentSort: range.transparentSort,
					})),
				},
			},
		],
		resourceNamespace: options.resourceNamespace,
		textureRequirements: options.textureRequirements,
		texturePages: options.textures.pages,
	};
}
