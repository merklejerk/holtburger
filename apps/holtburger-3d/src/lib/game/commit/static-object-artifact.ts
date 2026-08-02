import { Mat4 } from "../math/types";
import type { ResolvedStaticObjectLayerSource } from "../resolution/landblock-layer";
import type { StaticObjectLayerArtifact } from "./artifacts";
import type { StaticObjectGeometryPreparationResult } from "./static-object-geometry-worker";
import type { StaticInstallResourceNamespace } from "../systems/static-resources";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";

/** Assemble a logical static-object artifact after geometry and texture-requirement validation. */
export function assembleStaticObjectArtifact(options: {
	readonly source: ResolvedStaticObjectLayerSource;
	readonly resourceNamespace: StaticInstallResourceNamespace;
	readonly geometry: StaticObjectGeometryPreparationResult | null;
	readonly textureRequirements: readonly AssetTextureFact[];
}): StaticObjectLayerArtifact | null {
	const geometry = options.geometry;
	if (geometry === null) {
		return null;
	}
	const requiredTextures = new Set<AssetTextureKey>(
		options.textureRequirements.map(({ key }) => key),
	);
	for (const range of geometry.objects.flatMap((object) => [
		...object.drawUnits,
		...object.frameStreamedInstances,
	])) {
		for (const texture of [
			range.material.textures.base,
			range.material.textures.palette,
		]) {
			if (texture !== null && !requiredTextures.has(texture)) {
				throw new Error(
					`Static-object draw contribution lacks a logical texture requirement for ${texture}.`,
				);
			}
		}
	}
	const hasBakedOutput = geometry.metrics.bakedDrawUnitCount > 0;
	const hasInstancedOutput =
		geometry.metrics.persistentDrawUnitCount > 0 ||
		geometry.metrics.transparentTemplateInstanceCount > 0;
	return {
		geometryDiagnostics: {
			bakedFallbackRangeCount: geometry.metrics.bakedDrawUnitCount,
			bakedGeometryBytes: geometry.metrics.bakedGeometryBytes,
			geometryWorkerDurationMs: geometry.metrics.workerDurationMs,
			instancedGeometryBytes: geometry.metrics.instancedGeometryBytes,
			persistentCohortCount: geometry.metrics.persistentCohortCount,
			persistentDrawUnitCount: geometry.metrics.persistentDrawUnitCount,
			persistentInstanceCount: geometry.metrics.persistentInstanceCount,
			persistentStreamBytes: geometry.metrics.persistentStreamBytes,
			persistentStreamCount: geometry.metrics.persistentStreamCount,
			sourceMaterialSlotCount: geometry.metrics.sourceMaterialSlotCount,
			sourcePartCount: geometry.metrics.sourcePartCount,
			sourceRangeCount: geometry.metrics.sourceRangeCount,
			sourceResidentCount: geometry.metrics.sourceResidentCount,
			strategy:
				hasBakedOutput && hasInstancedOutput
					? "mixed"
					: hasInstancedOutput
						? "instanced"
						: "baked",
			transparentTemplateBytes: geometry.metrics.transparentTemplateBytes,
			transparentTemplateCohortCount:
				geometry.metrics.transparentTemplateCohortCount,
			transparentTemplateInstanceCount:
				geometry.metrics.transparentTemplateInstanceCount,
		},
		geometry: geometry.geometry,
		instanceStreams: geometry.instanceStreams,
		objects: geometry.objects.map((object) => ({
			localBounds: object.bounds,
			placement: {
				envCellId:
					options.source.kind === "env-cells" ? options.source.envCellId : null,
				landblockId: options.source.landblockId,
				localTransform: Mat4.identity(),
			},
			renderable: {
				drawUnits: object.drawUnits,
				frameStreamedInstances: object.frameStreamedInstances,
			},
		})),
		resourceNamespace: options.resourceNamespace,
		textureRequirements: options.textureRequirements,
	};
}
