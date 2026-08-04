import { describe, expect, it } from "vitest";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { ResolvedOutdoorStaticLayerSource } from "../resolution/landblock-layer";
import { LandblockLayerKind } from "../runtime/scene-interest";
import {
	createAssetTextureKey,
	TexturePurpose,
	TextureWrapMode,
} from "../textures/types";
import { createLandblockWorldOrigin } from "../landblocks";
import { RUNTIME_LIGHT_RANGE_SCALE } from "../environment/runtime-lights";
import { assembleStaticObjectArtifact } from "./static-object-artifact";
import type {
	FrameStreamedObjectInstanceTemplate,
	StaticObjectDrawUnit,
	ObjectMaterialBinding,
} from "./artifacts";
import type { StaticObjectGeometryPreparationResult } from "./static-object-geometry-worker";

const INSTALL_NAMESPACE = "static-install:artifact-test" as const;
const GEOMETRY_KEY =
	"static-install-geometry:static-install:artifact-test/geometry" as const;
const STREAM_KEY =
	"static-instance-stream:static-install:artifact-test/instances" as const;
const BASE_TEXTURE = createAssetTextureKey(
	TexturePurpose.ObjectDirectColor,
	"0x05000001",
);

describe("assembleStaticObjectArtifact", () => {
	it.each(["baked", "instanced", "frame-streamed"] as const)(
		"rejects a missing %s texture requirement",
		(strategy) => {
			expect(() =>
				assembleStaticObjectArtifact({
					geometry: geometryResult(strategy),
					resourceNamespace: INSTALL_NAMESPACE,
					source: source(),
					textureRequirements: [],
				}),
			).toThrow(`lacks a logical texture requirement for ${BASE_TEXTURE}`);
		},
	);

	it("accepts one logical requirement shared by static fragments and frame-streamed draws", () => {
		const geometry = geometryResult("instanced");
		const frameStreamedInstances =
			geometryResult("frame-streamed").objects[0]!.frameStreamedInstances;

		const artifact = assembleStaticObjectArtifact({
			geometry: {
				...geometry,
				objects: [{ ...geometry.objects[0]!, frameStreamedInstances }],
			},
			resourceNamespace: INSTALL_NAMESPACE,
			source: source(),
			textureRequirements: [
				{
					key: BASE_TEXTURE,
					kind: "asset",
					purpose: TexturePurpose.ObjectDirectColor,
					sourceAssetId: "0x05000001",
				},
			],
		});

		expect(artifact?.geometryDiagnostics.strategy).toBe("instanced");
		expect(artifact?.textureRequirements).toHaveLength(1);
	});

	it("publishes every worker cluster as an independently bounded scene object", () => {
		const geometry = geometryResult("instanced");
		const first = geometry.objects[0]!;
		const secondBounds = new AABB3(
			new Vec3(96, 0, -48),
			new Vec3(120, 20, -24),
		);

		const artifact = assembleStaticObjectArtifact({
			geometry: {
				...geometry,
				objects: [first, { ...first, bounds: secondBounds }],
			},
			resourceNamespace: INSTALL_NAMESPACE,
			source: source(),
			textureRequirements: [
				{
					key: BASE_TEXTURE,
					kind: "asset",
					purpose: TexturePurpose.ObjectDirectColor,
					sourceAssetId: "0x05000001",
				},
			],
		});

		expect(artifact?.objects).toHaveLength(2);
		expect(artifact?.objects[1]?.localBounds).toBe(secondBounds);
	});
});

function geometryResult(
	strategy: "baked" | "instanced" | "frame-streamed",
): StaticObjectGeometryPreparationResult {
	const drawUnits: StaticObjectDrawUnit[] =
		strategy === "frame-streamed" ? [] : [drawUnit(strategy)];
	const frameStreamedInstances: FrameStreamedObjectInstanceTemplate[] =
		strategy === "frame-streamed"
			? [
					{
						cohortKey: "transparent",
						geometry: GEOMETRY_KEY,
						indexCount: 3,
						indexStart: 0,
						instance: instance(),
						material: material(),
						transparentSort: {
							center: Vec3.zero(),
							stableId: "transparent:0",
						},
					},
				]
			: [];
	return {
		geometry: [],
		instanceStreams:
			strategy === "instanced"
				? [
						{
							data: { instances: [instance()], sourceEnvelope: AABB3.zero() },
							key: STREAM_KEY,
						},
					]
				: [],
		objects: [{ bounds: AABB3.zero(), drawUnits, frameStreamedInstances }],
		metrics: {
			bakedDrawUnitCount: strategy === "baked" ? 1 : 0,
			bakedGeometryBytes: 0,
			instancedGeometryBytes: 0,
			staticFragmentBytes: 0,
			staticFragmentCohortCount: strategy === "instanced" ? 1 : 0,
			staticFragmentCount: strategy === "instanced" ? 1 : 0,
			staticFragmentDrawUnitCount: strategy === "instanced" ? 1 : 0,
			staticFragmentInstanceCount: strategy === "instanced" ? 1 : 0,
			sourceMaterialSlotCount: 1,
			sourcePartCount: 1,
			sourceRangeCount: 1,
			sourceResidentCount: 1,
			transparentTemplateBytes: 0,
			transparentTemplateCohortCount: strategy === "frame-streamed" ? 1 : 0,
			transparentTemplateInstanceCount: strategy === "frame-streamed" ? 1 : 0,
			workerDurationMs: 0,
		},
	};
}

function drawUnit(strategy: "baked" | "instanced"): StaticObjectDrawUnit {
	const common = {
		geometry: GEOMETRY_KEY,
		indexCount: 3,
		indexStart: 0,
		material: material(),
		ordering: "opaque" as const,
		transparentSort: null,
	};
	return strategy === "baked"
		? { ...common, kind: "baked" }
		: {
				...common,
				cohortKey: "fixture-partition",
				instances: STREAM_KEY,
				kind: "instanced",
			};
}

function material(): ObjectMaterialBinding {
	return {
		detailRole: null,
		palettedClipMap: false,
		polygon: {
			authoredCullMode: "landblock",
			cullFace: "back",
			renderSide: "positive",
			stippled: false,
		},
		sampler: {
			wrap: TextureWrapMode.Clamp,
		},
		source: {
			colorTextureId: "0x05000001",
			diffuseScale: 1,
			id: "material:artifact-test",
			kind: "texture",
			luminosity: 0,
			paletteTextureId: null,
			rawSurfaceFlags: 0,
			renderSurfaceId: "0x06000001",
			textureEncoding: "direct-color",
			translucency: 0,
		},
		textures: { base: BASE_TEXTURE, palette: null },
	};
}

function instance() {
	return {
		color: { a: 1, b: 1, g: 1, r: 1 },
		sourceToLandblock: Mat4.identity(),
	};
}

/** One resident emitting a single authored light, placed at a landblock-local point. */
function litResident(x: number, y: number, z: number) {
	return {
		identity: { instanceId: 1, sourceAssetId: "setup-model/02000337" },
		setupId: "0x02000337",
		presentation: {
			appearanceKey: "test",
			id: "presentation:test",
			sourceAssetId: "setup-model/02000337",
			parts: [],
			lights: [
				{
					offset: new Vec3(0, 0, 0),
					color: { red: 1, green: 1, blue: 1 },
					intensity: 100,
					falloff: 4,
				},
			],
			holdingLocations: new Map(),
			placementPoses: new Map(),
			selectionBounds: null,
			sortingBounds: null,
		},
		behavior: {
			animationId: null,
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		},
		placement: {
			landblockId: "0xda55ffff",
			envCellId: null,
			localTransform: Object.assign(Mat4.identity(), {
				m41: x,
				m42: y,
				m43: z,
			}),
		},
		scale: new Vec3(1, 1, 1),
		localBounds: null,
	} as unknown as ResolvedOutdoorStaticLayerSource["staticResidents"][number];
}

function source(): ResolvedOutdoorStaticLayerSource {
	return {
		dynamicSources: [],
		kind: LandblockLayerKind.Generated,
		landblockId: "0xda55ffff",
		staticResidents: [],
	};
}

describe("outdoor static light gathering", () => {
	// Placements are landblock-local, but runtime lights are compared against anchor-relative
	// vertices in landblocks other than their own, so they must leave here in scene space.
	it("lifts gathered lights out of landblock-local space", () => {
		const artifact = assembleStaticObjectArtifact({
			source: { ...source(), staticResidents: [litResident(10, 20, -30)] },
			resourceNamespace: INSTALL_NAMESPACE,
			geometry: geometryResult("baked"),
			textureRequirements: [
				{
					key: BASE_TEXTURE,
					kind: "asset",
					purpose: TexturePurpose.ObjectDirectColor,
					sourceAssetId: "0x05000001",
				},
			],
		});
		const origin = createLandblockWorldOrigin("0xda55ffff");
		expect(artifact?.staticLights).toEqual([
			{
				position: { x: origin.x + 10, y: 20, z: origin.z - 30 },
				color: { red: 1, green: 1, blue: 1 },
				range: 4 * RUNTIME_LIGHT_RANGE_SCALE,
				intensity: 100,
			},
		]);
	});
});
