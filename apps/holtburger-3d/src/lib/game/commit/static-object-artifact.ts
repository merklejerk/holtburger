import { Mat4 } from "../math/types";
import type {
	ResolvedOutdoorStaticLayerSource,
	ResolvedStaticObjectLayerSource,
} from "../resolution/landblock-layer";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type { StaticObjectLayerArtifact } from "./artifacts";
import type { StaticObjectGeometryPreparationResult } from "./static-object-geometry-worker";
import type { StaticInstallResourceNamespace } from "../systems/static-resources";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";
import type { RuntimeLight } from "../environment/runtime-lights";
import { resolveObjectRuntimeLights } from "../environment/object-runtime-lights";

/**
 * Gather the authored lights an outdoor layer's residents emit, in canonical scene space.
 *
 * Runtime lights use retail's hardware `rangeAdjust` rather than the interior burn-in's
 * `static_light_factor`.
 *
 * Placements are landblock-local, which the bake consumes directly because its vertices are
 * landblock-local too. Runtime lights instead cross landblock boundaries and are compared against
 * anchor-relative vertices, so they are lifted to scene space here — at the one point that knows
 * which landblock the placements belong to.
 */
function gatherLayerLights(
	source: ResolvedOutdoorStaticLayerSource,
): readonly RuntimeLight[] {
	const gathered: RuntimeLight[] = [];
	for (const resident of source.staticResidents) {
		gathered.push(
			...resolveObjectRuntimeLights(
				resident.presentation.lights,
				resident.placement.localTransform,
				source.landblockId,
			),
		);
	}
	for (const dynamic of source.dynamicSources) {
		gathered.push(
			...resolveObjectRuntimeLights(
				dynamic.presentation.lights,
				dynamic.placement.localTransform,
				source.landblockId,
			),
		);
	}
	return gathered;
}

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
	// Interior residents carry their static lighting in baked vertex colours and bind an empty
	// runtime set, so gathering their emitters would produce a set nobody reads.
	const staticLights =
		options.source.kind === LandblockLayerKind.EnvCells
			? NO_STATIC_LIGHTS
			: gatherLayerLights(options.source);
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
	return {
		staticLights,
		geometryDiagnostics: {
			bakedRangeCount: geometry.metrics.bakedDrawUnitCount,
			bakedGeometryBytes: geometry.metrics.bakedGeometryBytes,
			geometryWorkerDurationMs: geometry.metrics.workerDurationMs,
			instancedGeometryBytes: geometry.metrics.instancedGeometryBytes,
			sourceMaterialSlotCount: geometry.metrics.sourceMaterialSlotCount,
			sourcePartCount: geometry.metrics.sourcePartCount,
			sourceRangeCount: geometry.metrics.sourceRangeCount,
			sourceResidentCount: geometry.metrics.sourceResidentCount,
			transparentTemplateBytes: geometry.metrics.transparentTemplateBytes,
			transparentTemplateCohortCount:
				geometry.metrics.transparentTemplateCohortCount,
			transparentTemplateInstanceCount:
				geometry.metrics.transparentTemplateInstanceCount,
		},
		geometry: geometry.geometry,
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

/** Shared empty set, so interior artifacts allocate nothing for lights they never receive. */
const NO_STATIC_LIGHTS: readonly RuntimeLight[] = [];
