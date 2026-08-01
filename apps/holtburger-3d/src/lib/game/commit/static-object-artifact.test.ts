import { describe, expect, it } from "vitest";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { ResolvedOutdoorStaticLayerSource } from "../resolution/landblock-layer";
import { LandblockLayerKind } from "../runtime/scene-interest";
import {
	createAssetTextureKey,
	TexturePurpose,
	TextureWrapMode,
} from "../textures/types";
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

	it("accepts one logical requirement shared by persistent and frame-streamed draws", () => {
		const geometry = geometryResult("instanced");
		const frameStreamedInstances =
			geometryResult("frame-streamed").frameStreamedInstances;

		const artifact = assembleStaticObjectArtifact({
			geometry: { ...geometry, frameStreamedInstances },
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
		bounds: AABB3.zero(),
		drawUnits,
		frameStreamedInstances,
		geometry: [],
		instanceStreams:
			strategy === "instanced"
				? [{ data: { instances: [instance()] }, key: STREAM_KEY }]
				: [],
		metrics: {
			bakedDrawUnitCount: strategy === "baked" ? 1 : 0,
			bakedGeometryBytes: 0,
			instancedGeometryBytes: 0,
			persistentCohortCount: strategy === "instanced" ? 1 : 0,
			persistentDrawUnitCount: strategy === "instanced" ? 1 : 0,
			persistentInstanceCount: strategy === "instanced" ? 1 : 0,
			persistentStreamBytes: 0,
			persistentStreamCount: strategy === "instanced" ? 1 : 0,
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
		: { ...common, instances: STREAM_KEY, kind: "instanced" };
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

function source(): ResolvedOutdoorStaticLayerSource {
	return {
		dynamicSources: [],
		kind: LandblockLayerKind.Generated,
		landblockId: "0xda55ffff",
		staticResidents: [],
	};
}
