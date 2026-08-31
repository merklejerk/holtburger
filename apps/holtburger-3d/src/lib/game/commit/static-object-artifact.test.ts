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
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import { assembleStaticObjectArtifact } from "./static-object-artifact";
import type {
	FrameStreamedObjectInstanceTemplate,
	StaticObjectDrawUnit,
	ObjectMaterialBinding,
} from "./artifacts";
import type { StaticObjectGeometryPreparationResult } from "./static-object-geometry-worker";
import { landblockVec3 } from "../../assets/ac-frame";

const INSTALL_NAMESPACE = "static-install:artifact-test" as const;
const GEOMETRY_KEY =
	"static-install-geometry:static-install:artifact-test/geometry" as const;
const BASE_TEXTURE = createAssetTextureKey(
	TexturePurpose.ObjectDirectColor,
	"0x05000001",
);

describe("assembleStaticObjectArtifact", () => {
	it.each(["baked", "frame-streamed"] as const)(
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

	it("accepts one logical requirement shared by baked and frame-streamed draws", () => {
		const geometry = geometryResult("baked");
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

		expect(artifact?.textureRequirements).toHaveLength(1);
	});

	it("publishes every worker render object as an independently bounded scene object", () => {
		const geometry = geometryResult("baked");
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
	strategy: "baked" | "frame-streamed",
): StaticObjectGeometryPreparationResult {
	const drawUnits: StaticObjectDrawUnit[] =
		strategy === "frame-streamed" ? [] : [drawUnit()];
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
						retailVisibility: "normally-visible",
						transparentSort: {
							center: landblockVec3(Vec3.zero()),
							stableId: "transparent:0",
						},
					},
				]
			: [];
	return {
		geometry: [],
		objects: [{ bounds: AABB3.zero(), drawUnits, frameStreamedInstances }],
		metrics: {
			bakedDrawUnitCount: strategy === "baked" ? 1 : 0,
			bakedGeometryBytes: 0,
			instancedGeometryBytes: 0,
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

function drawUnit(): StaticObjectDrawUnit {
	return {
		geometry: GEOMETRY_KEY,
		indexCount: 3,
		indexStart: 0,
		material: material(),
		ordering: "opaque" as const,
		retailVisibility: "normally-visible",
		transparentSort: null,
	};
}

function material(): ObjectMaterialBinding {
	return {
		detailRole: null,
		palettedClipMap: false,
		polygon: {
			cullFace: "back",
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
			paletteComposite: null,
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
			motionTableId: null,
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
				intensity:
					100 *
					SHARED_FRONTEND_TUNING.rendering.outdoorAuthoredLights.intensityScale,
			},
		]);
	});
});
