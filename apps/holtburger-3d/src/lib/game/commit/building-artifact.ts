import { Mat4 } from "../math/types";
import type { ResolvedObjectLayerSource } from "../resolution/landblock-layer";
import type { StaticObjectLayerArtifact } from "./artifacts";
import type { BuildingGeometryResult } from "./building-geometry-worker";
import type { StaticInstallResourceNamespace } from "../systems/static-resources";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";

/** Assemble a logical building artifact after geometry and texture-requirement validation. */
export function assembleBuildingArtifact(options: {
	readonly source: ResolvedObjectLayerSource;
	readonly resourceNamespace: StaticInstallResourceNamespace;
	readonly geometry: BuildingGeometryResult | null;
	readonly textureRequirements: readonly AssetTextureFact[];
}): StaticObjectLayerArtifact | null {
	const geometry = options.geometry;
	if (geometry === null) {
		return null;
	}
	const requiredTextures = new Set<AssetTextureKey>(
		options.textureRequirements.map(({ key }) => key),
	);
	for (const range of geometry.ranges) {
		for (const texture of [
			range.material.textures.base,
			range.material.textures.palette,
		]) {
			if (texture !== null && !requiredTextures.has(texture)) {
				throw new Error(
					`Baked building range lacks a logical texture requirement for ${texture}.`,
				);
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
	};
}
