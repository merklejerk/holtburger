import { Mat4 } from "../math/types";
import type { ResolvedOutdoorStaticLayerSource } from "../resolution/landblock-layer";
import type { StaticObjectLayerArtifact } from "./artifacts";
import type { StaticObjectGeometryResult } from "./static-object-geometry-worker";
import type { StaticInstallResourceNamespace } from "../systems/static-resources";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";

/** Assemble a logical static-object artifact after geometry and texture-requirement validation. */
export function assembleStaticObjectArtifact(options: {
	readonly source: ResolvedOutdoorStaticLayerSource;
	readonly resourceNamespace: StaticInstallResourceNamespace;
	readonly geometry: StaticObjectGeometryResult | null;
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
					`Baked static-object range lacks a logical texture requirement for ${texture}.`,
				);
			}
		}
	}
	const { workerDurationMs, ...bakeMetrics } = geometry.metrics;
	return {
		bakeDiagnostics: {
			...bakeMetrics,
			geometryWorkerDurationMs: workerDurationMs,
		},
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
