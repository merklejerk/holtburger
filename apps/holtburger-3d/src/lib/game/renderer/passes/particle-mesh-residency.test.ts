import { expect, it, vi } from "vitest";
import type { DecodedParticleMesh } from "../../../assets/decode-particle-mesh-record";
import { Vec3 } from "../../math/types";
import { resolveObjectBehavior } from "../../resolution/object-resident-classifier";
import { TexturePixelFormat } from "../../textures/types";
import { ParticleMeshResidency } from "./particle-mesh-residency";
import type { Texture2DResourceKey } from "../resource-manager";

it("installs one shared placeholder before resolving solid-color particle draws", async () => {
	const format = TexturePixelFormat.RGBA8;
	const texture: WebGLTexture = {};
	const vertexArray: WebGLVertexArrayObject = {};
	const placeholder = "texture-2d-resource:0";
	let nextGeometry = 0;
	const resources = {
		createGeometry: vi.fn(() => `geometry-resource:${nextGeometry++}` as const),
		createTexture2D: vi.fn((): Texture2DResourceKey => placeholder),
		getGeometry: vi.fn(() => ({
			vertexArray,
			indexCount: 3,
			indexType: 0x1405,
			indexElementBytes: Uint32Array.BYTES_PER_ELEMENT,
		})),
		getTexture2D: vi.fn(() => ({
			texture,
			format,
			height: 1,
			width: 1,
			mipLevels: 1,
		})),
		releaseResource: vi.fn(() => true),
	} satisfies ConstructorParameters<typeof ParticleMeshResidency>[0];
	const residency = new ParticleMeshResidency(resources);
	const first = "0x01000001";
	const second = "0x01000002";
	await residency.install(
		{
			presentations: new Map([
				[first, solidMesh(first)],
				[second, solidMesh(second)],
			]),
			textureDependencies: [],
		},
		{
			destroy: async () => {},
			prepare: async () => {
				throw new Error("Solid-color meshes have no texture assets to fetch.");
			},
		},
	);

	expect(resources.createTexture2D).toHaveBeenCalledExactlyOnceWith({
		data: new Uint8Array([255, 255, 255, 255]),
		format,
		height: 1,
		width: 1,
		mipLevels: 1,
	});
	resources.createTexture2D.mockImplementation(() => {
		throw new Error(
			"Texture allocation during resolution would disturb the active unit.",
		);
	});
	for (const id of [first, second])
		expect(residency.resolve(id)?.baseTexture).toBe(texture);
	residency.destroy();
	expect(resources.releaseResource.mock.calls.flat()).toEqual([
		"geometry-resource:0",
		"geometry-resource:1",
		placeholder,
	]);
});

function solidMesh(id: `0x${string}`): DecodedParticleMesh {
	return {
		orientation: "authored",
		presentation: {
			setupId: null,
			partParents: [],
			localBounds: null,
			behavior: resolveObjectBehavior({
				animationId: null,
				motionTableId: null,
				physicsScriptId: null,
				physicsScriptTableId: null,
				soundTableId: null,
			}),
			presentation: {
				id: `presentation:${id}`,
				appearanceKey: id,
				sourceAssetId: id,
				lights: [],
				holdingLocations: new Map(),
				selectionBounds: null,
				sortingBounds: null,
				placementPoses: new Map(),
				parts: [
					{
						partIndex: 0,
						retailVisibility: "normally-visible",
						defaultScale: new Vec3(1, 1, 1),
						geometry: {
							id: `geometry:${id}`,
							bounds: null,
							positions: new Float32Array(9),
							normals: new Float32Array(9),
							textureCoordinates: new Float32Array(6),
							indices: new Uint32Array([0, 1, 2]),
							materialSlotIndices: new Uint16Array(1),
							materialWrapModes: new Uint8Array(1),
							materialSideKinds: new Uint8Array(1),
							materialSideTypes: new Uint8Array(1),
							materialStippling: new Uint8Array(1),
							sourceDiagnostics: { rejectedDegenerateTriangles: [] },
						},
						materials: [
							{
								kind: "solid-color",
								id: "material:solid",
								color: [1, 1, 1, 1],
								diffuseScale: 1,
								luminosity: 0,
								translucency: 0,
								rawSurfaceFlags: 0,
							},
						],
					},
				],
			},
		},
	};
}
