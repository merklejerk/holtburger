import {
	FRAME_STREAMED_STATIC_INSTANCE_TEMPLATE_BYTES,
	type FrameStreamedStaticInstanceTemplate,
	type StaticObjectLayerArtifact,
	type StaticObjectMaterialBinding,
} from "../../lib/game/commit/artifacts";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
} from "../../lib/game/commit/types";
import type { LandblockId } from "../../lib/game/game-types";
import { createTranslationMat4 } from "../../lib/game/math/matrices";
import { AABB3, Mat4, Vec3 } from "../../lib/game/math/types";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../../lib/game/runtime/scene-interest";
import {
	STATIC_INSTANCE_RECORD_BYTES,
	type StaticInstanceData,
	type StaticInstanceStreamSource,
} from "../../lib/game/systems/static-resources";
import {
	TextureFilteringMode,
	TextureWrapMode,
} from "../../lib/game/textures/types";

const INSTALL_NAMESPACE = "static-install:synthetic-instanced" as const;
const GEOMETRY_KEY =
	"static-install-geometry:static-install:synthetic-instanced/shared-triangle" as const;
const STREAM_KEY =
	"static-instance-stream:static-install:synthetic-instanced/persistent" as const;

/** Closed synthetic fixture proving persistent and camera-ordered frame instance submission. */
export class SyntheticInstancedObjectPipeline implements CommitPipeline {
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
	const persistentInstances: StaticInstanceStreamSource = {
		data: {
			instances: [
				instance(88, 70, -112, [1, 0.2, 0.2, 1]),
				instance(100, 70, -112, [0.2, 1, 0.2, 1]),
			],
		},
		key: STREAM_KEY,
	};
	const opaqueMaterial = fixtureMaterial("opaque", 0x10, 1);
	const alphaTestMaterial = fixtureMaterial("alpha-test", 0x10, 0.7);
	const additiveMaterial = fixtureMaterial("additive", 0x10100, 0.55);
	const transparentAlpha = fixtureMaterial("transparent-alpha", 0x100, 0.55);
	const transparentInverse = fixtureMaterial(
		"transparent-inverse",
		0x200,
		0.55,
	);
	const frameStreamedInstances: FrameStreamedStaticInstanceTemplate[] = [
		frameTemplate(
			"alpha",
			"source-first-yellow",
			90,
			-100,
			transparentAlpha,
			[1, 1, 0, 1],
		),
		frameTemplate(
			"inverse",
			"middle-blue",
			96,
			-104,
			transparentInverse,
			[0, 0, 1, 1],
		),
		frameTemplate(
			"alpha",
			"camera-far-red",
			102,
			-106,
			transparentAlpha,
			[1, 0, 0, 1],
		),
	];
	const artifact: StaticObjectLayerArtifact = {
		geometryDiagnostics: {
			bakedFallbackRangeCount: 0,
			bakedGeometryBytes: 0,
			geometryWorkerDurationMs: 0,
			instancedGeometryBytes: 3 * (3 + 3 + 2) * Float32Array.BYTES_PER_ELEMENT,
			persistentCohortCount: 1,
			persistentDrawUnitCount: 3,
			persistentInstanceCount: persistentInstances.data.instances.length,
			persistentStreamBytes:
				persistentInstances.data.instances.length *
				STATIC_INSTANCE_RECORD_BYTES,
			persistentStreamCount: 1,
			sourceMaterialSlotCount: 6,
			sourcePartCount: 5,
			sourceRangeCount: 6,
			sourceResidentCount: 5,
			strategy: "instanced",
			transparentTemplateBytes:
				frameStreamedInstances.length *
				FRAME_STREAMED_STATIC_INSTANCE_TEMPLATE_BYTES,
			transparentTemplateCohortCount: 2,
			transparentTemplateInstanceCount: frameStreamedInstances.length,
		},
		geometry: [
			{
				geometry: {
					indices: Uint16Array.of(0, 1, 2),
					kind: "object",
					normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
					positions: Float32Array.of(-2, 0, 0, 2, 0, 0, 0, 6, 0),
					textureCoordinates: Float32Array.of(0, 0, 1, 0, 0.5, 1),
				},
				key: GEOMETRY_KEY,
			},
		],
		instanceStreams: [persistentInstances],
		objects: [
			{
				localBounds: new AABB3(new Vec3(84, 69, -114), new Vec3(106, 95, -98)),
				placement: {
					envCellId: null,
					landblockId,
					localTransform: Mat4.identity(),
				},
				renderable: {
					drawUnits: [
						{
							geometry: GEOMETRY_KEY,
							indexCount: 3,
							indexStart: 0,
							instances: STREAM_KEY,
							kind: "instanced",
							material: opaqueMaterial,
							ordering: "opaque",
							transparentSort: null,
						},
						{
							geometry: GEOMETRY_KEY,
							indexCount: 3,
							indexStart: 0,
							instances: STREAM_KEY,
							kind: "instanced",
							material: alphaTestMaterial,
							ordering: "alpha-test",
							transparentSort: null,
						},
						{
							geometry: GEOMETRY_KEY,
							indexCount: 3,
							indexStart: 0,
							instances: STREAM_KEY,
							kind: "instanced",
							material: additiveMaterial,
							ordering: "additive",
							transparentSort: null,
						},
					],
					frameStreamedInstances,
				},
			},
		],
		resourceNamespace: INSTALL_NAMESPACE,
		textureRequirements: [],
	};
	return {
		commit: {
			diagnostics: {
				...artifact.geometryDiagnostics,
				expectedResidentCount: 5,
				materializedStaticResidentCount: 5,
				promotedDynamicResidentCount: 0,
				resolvedStaticResidentCount: 5,
			},
			staticObjects: artifact,
		},
		dynamicEntities: [],
		kind: CommitBundleSourceKind.LandblockLayer,
		landblockId,
		layer: LandblockLayerKind.Buildings,
	} as unknown as CommitBundle;
}

function frameTemplate(
	cohort: string,
	stableId: string,
	x: number,
	z: number,
	material: StaticObjectMaterialBinding,
	color: readonly [number, number, number, number],
): FrameStreamedStaticInstanceTemplate {
	return {
		cohortKey: `synthetic:${cohort}`,
		geometry: GEOMETRY_KEY,
		indexCount: 3,
		indexStart: 0,
		instance: instance(x, 88, z, color),
		material,
		transparentSort: { center: new Vec3(0, 2, 0), stableId },
	};
}

function instance(
	x: number,
	y: number,
	z: number,
	color: readonly [number, number, number, number],
): StaticInstanceData {
	return {
		color: { a: color[3], b: color[2], g: color[1], r: color[0] },
		sourceToLandblock: createTranslationMat4(new Vec3(x, y, z)),
	};
}

function fixtureMaterial(
	id: string,
	rawSurfaceFlags: number,
	alpha: number,
): StaticObjectMaterialBinding {
	return {
		palettedClipMap: false,
		polygon: { cullMode: "double", renderSide: "positive", stippled: false },
		sampler: {
			filtering: TextureFilteringMode.Linear,
			wrap: TextureWrapMode.Clamp,
		},
		source: {
			color: [1, 1, 1, alpha],
			diffuseScale: 1,
			id: `material:synthetic-instanced:${id}` as const,
			kind: "solid-color",
			luminosity: 0,
			rawSurfaceFlags,
			translucency: 0,
		},
		textures: { base: null, palette: null },
	};
}
