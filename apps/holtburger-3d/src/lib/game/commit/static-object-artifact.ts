import { Mat4 } from "../math/types";
import type { ResolvedStaticObjectLayerSource } from "../resolution/landblock-layer";
import type { StaticObjectLayerArtifact } from "./artifacts";
import type { StaticObjectGeometryPreparationResult } from "./static-object-geometry-worker";
import type { StaticInstallResourceNamespace } from "../systems/static-resources";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";
import {
	placeObjectLights,
	type PlacedStaticLight,
} from "./interior-static-lighting";
import {
	RUNTIME_LIGHT_RANGE_SCALE,
	type RuntimeLight,
} from "../environment/runtime-lights";
import { createLandblockWorldOrigin } from "../landblocks";

/** Assemble a logical static-object artifact after geometry and texture-requirement validation. */
/**
 * Gather the authored lights a layer's residents emit, in canonical scene space.
 *
 * Composing offsets with placements is the same operation the interior bake performs, so it
 * reuses `placeObjectLights`; only the falloff-to-range conversion differs, because runtime
 * lights take retail's hardware `rangeAdjust` rather than the burn-in's `static_light_factor`.
 *
 * Placements are landblock-local, which the bake consumes directly because its vertices are
 * landblock-local too. Runtime lights instead cross landblock boundaries and are compared against
 * anchor-relative vertices, so they are lifted to scene space here — at the one point that knows
 * which landblock the placements belong to.
 */
function gatherLayerLights(
	source: ResolvedStaticObjectLayerSource,
): readonly RuntimeLight[] {
	const origin = createLandblockWorldOrigin(source.landblockId);
	const placed: PlacedStaticLight[] = [];
	for (const resident of source.staticResidents) {
		placeObjectLights(
			resident.presentation.lights,
			resident.placement.localTransform,
			placed,
		);
	}
	for (const dynamic of source.dynamicSources) {
		placeObjectLights(
			dynamic.presentation.lights,
			dynamic.placement.localTransform,
			placed,
		);
	}
	return placed.map((light) => ({
		position: {
			x: light.position.x + origin.x,
			y: light.position.y,
			z: light.position.z + origin.z,
		},
		color: light.color,
		range: light.falloff * RUNTIME_LIGHT_RANGE_SCALE,
		intensity: light.intensity,
	}));
}

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
	const staticLights = gatherLayerLights(options.source);
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
		geometry.metrics.staticFragmentDrawUnitCount > 0 ||
		geometry.metrics.transparentTemplateInstanceCount > 0;
	return {
		staticLights,
		geometryDiagnostics: {
			bakedFallbackRangeCount: geometry.metrics.bakedDrawUnitCount,
			bakedGeometryBytes: geometry.metrics.bakedGeometryBytes,
			geometryWorkerDurationMs: geometry.metrics.workerDurationMs,
			instancedGeometryBytes: geometry.metrics.instancedGeometryBytes,
			staticFragmentBytes: geometry.metrics.staticFragmentBytes,
			staticFragmentCohortCount: geometry.metrics.staticFragmentCohortCount,
			staticFragmentCount: geometry.metrics.staticFragmentCount,
			staticFragmentDrawUnitCount: geometry.metrics.staticFragmentDrawUnitCount,
			staticFragmentInstanceCount: geometry.metrics.staticFragmentInstanceCount,
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
